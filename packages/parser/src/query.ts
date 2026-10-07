// M3.3 — query expressions.
//
// Three groupings decide what a query *means*, and none of them is visible in a
// tree that merely parses. Each is checked against a real server by M3.16's
// corpus rather than trusted from the manual:
//
//   - **Set operations.** `INTERSECT` binds tighter than `UNION` and `EXCEPT`,
//     which share a level and associate left (8.0.31). A trailing `ORDER BY` or
//     `LIMIT` applies to the whole query expression, never to its last branch.
//   - **Comma against `JOIN`.** The comma binds loosest, so `FROM a, b JOIN c
//     ON …` is `a, (b JOIN c ON …)` — and an `ON` there may not name `a`.
//   - **`JOIN` against `JOIN`, which is two rules, not one.** MySQL's grammar
//     gives a condition-less inner join the lowest precedence of all (`%prec
//     CONDITIONLESS_JOIN`), so the right side of a join *keeps absorbing*
//     joins until a condition closes one: `a JOIN b JOIN c ON x ON y` is legal
//     and means `a JOIN (b JOIN c ON x) ON y`. But the condition-less join is
//     then **re-hung** — its action calls `add_cross_join`, which walks down
//     the left spine of its right operand and attaches itself to the leftmost
//     table there — so `a JOIN b JOIN c ON x` ends as `(a JOIN b) JOIN c ON
//     x`, and `x` may name `a`. Parentheses stop the walk. The first version
//     of this parser had the absorbing half and not the re-hanging half, and
//     M3.16's corpus found it on its first run: 8.4 answers `t1 CROSS JOIN t2
//     CROSS JOIN t3 ON t1.b < t1.a` with rows, where a tree that kept `t1` out
//     of the `ON`'s reach says ER_BAD_FIELD_ERROR.
import { unsupportedStatement } from './errors.ts'
import type { Cursor } from './cursor.ts'
import { TOKEN } from './tokens.ts'
import { NODE, type Expression } from './ast.ts'
import { parseExpressionFrom } from './expression.ts'
import type { SqlMode } from './sql-mode.ts'
import type { TableName } from './statement-ast.ts'
import {
  QUERY,
  REF,
  type CommonTable,
  type FrameBound,
  type GroupBy,
  type IndexHint,
  type Into,
  type JoinNode,
  type Limit,
  type Locking,
  type OrderItem,
  type QueryBody,
  type QueryExpression,
  type SelectItem,
  type SelectNode,
  type TableReference,
  type WindowSpec,
  type With,
} from './query-ast.ts'

/** Words that only ever modify a `SELECT`, between the keyword and its list. */
const SELECT_OPTIONS = new Set([
  'HIGH_PRIORITY', 'STRAIGHT_JOIN', 'SQL_SMALL_RESULT', 'SQL_BIG_RESULT', 'SQL_BUFFER_RESULT',
  'SQL_NO_CACHE', 'SQL_CALC_FOUND_ROWS',
])

/** True when a query starts `ahead` tokens on: `SELECT`, `WITH`, `VALUES ROW`, `TABLE t`. */
export function atQueryStart(c: Cursor, ahead = 0): boolean {
  if (c.atWord('SELECT', ahead) || c.atWord('WITH', ahead)) return true
  if (c.atWord('VALUES', ahead)) return c.atWord('ROW', ahead + 1)
  if (c.atWord('TABLE', ahead)) return c.peek(ahead + 1).kind === TOKEN.IDENTIFIER
  return false
}

/**
 * True at `(` … `(` followed by the start of a query — a parenthesised query,
 * however deeply. Used only where a `(` cannot be anything else that matters:
 * a derived table, and a statement that opens with a parenthesis.
 */
export function atParenthesisedQuery(c: Cursor): boolean {
  let i = 0
  while (c.atOp('(', i)) i++
  return i > 0 && atQueryStart(c, i)
}

/**
 * Parse a query expression from a cursor another parser is driving.
 *
 * `statement` is true only for a query that *is* the statement. That is the
 * one place `INTO` is legal: a real 8.4 refuses it inside any subquery, derived
 * table or CTE with ER_MISPLACED_INTO, and refuses it on a branch of a `UNION`
 * other than the last.
 */
export function parseQueryFrom(c: Cursor, mode: SqlMode, statement = false, withClause?: With): QueryExpression {
  return new QueryParser(c, mode, statement).query(withClause)
}

/**
 * A `WITH` clause on its own, for the dispatcher: `WITH` opens a query, an
 * `UPDATE` or a `DELETE`, and which one is known only after the clause. Read
 * once and handed on, rather than re-read once the dispatcher knows.
 */
export function parseWithFrom(c: Cursor, mode: SqlMode): With {
  return new QueryParser(c, mode, false).with()
}

/**
 * Continue a query whose first, parenthesised branch has already been read.
 *
 * The expression parser needs this for `((SELECT 1) UNION (SELECT 2))`: it
 * reads `(SELECT 1)` as a scalar subquery — which is what it is in
 * `((SELECT 1) + 1)` — and only learns at `UNION` that it was the first branch
 * of a query instead. Deciding that from a token of lookahead, rather than by
 * trying one parse and backtracking to the other, keeps the parser linear: a
 * backtracking parse of nested parentheses is exponential in their depth.
 */
export function continueQueryFrom(c: Cursor, mode: SqlMode, first: QueryExpression): QueryExpression {
  return new QueryParser(c, mode, false).queryAfter(first)
}

/** True at a word that continues a query past a parenthesised branch. */
export function atQueryContinuation(c: Cursor): boolean {
  return c.atWord('UNION') || c.atWord('INTERSECT') || c.atWord('EXCEPT') || c.atWords('ORDER', 'BY') || c.atWord('LIMIT')
}

/** `PARTITION BY …  ORDER BY …  ROWS …`, with the cursor after the `(`. */
export function parseWindowSpec(c: Cursor, mode: SqlMode): WindowSpec {
  return new QueryParser(c, mode, false).windowSpec()
}

/** `ORDER BY a, b DESC`, with the cursor on `ORDER`. */
export function parseOrderBy(c: Cursor, mode: SqlMode): OrderItem[] {
  return new QueryParser(c, mode, false).orderBy()
}

class QueryParser {
  readonly #c: Cursor
  readonly #mode: SqlMode
  /** Whether the query being read may carry `INTO` — see `parseQueryFrom`. */
  #intoAllowed: boolean
  /** An `INTO` read inside a `SELECT`, waiting to be lifted to its query expression. */
  #pendingInto: Into | undefined

  constructor(c: Cursor, mode: SqlMode, intoAllowed: boolean) {
    this.#c = c
    this.#mode = mode
    this.#intoAllowed = intoAllowed
  }

  /** Read a query that is nested in this one — a derived table, a CTE — where `INTO` is refused. */
  #nestedQuery(): QueryExpression {
    return this.#withoutInto(() => this.query())
  }

  #expr(): Expression {
    return parseExpressionFrom(this.#c, this.#mode)
  }

  // --- query expressions ----------------------------------------------------

  query(already?: With): QueryExpression {
    return this.#c.nested(() => {
      const at = this.#c.peek().start
      const withClause = already ?? (this.#c.atWord('WITH') ? this.with() : undefined)
      const body = this.#setOperation(this.#intersection(this.#primary()))
      return this.#tail(at, withClause, body)
    })
  }

  /**
   * Check, before another branch is read, that the last one left no `INTO`
   * behind: `SELECT 1 INTO @a UNION SELECT 2` is ER_MISPLACED_INTO.
   */
  #noPendingInto(): void {
    if (this.#pendingInto !== undefined) this.#c.fail()
  }

  queryAfter(first: QueryExpression): QueryExpression {
    return this.#c.nested(() => {
      const body = this.#setOperation(this.#intersection(first))
      return this.#tail(first.at, undefined, body)
    })
  }

  /** `ORDER BY`, `LIMIT`, `INTO` and locking — the clauses of the whole expression. */
  #tail(at: number, withClause: With | undefined, body: QueryBody): QueryExpression {
    const c = this.#c
    // A `SELECT`'s own `INTO` is lifted here. Only the branch read last can
    // have left one, since every set operator checks before reading another.
    let into = this.#pendingInto
    this.#pendingInto = undefined
    const orderBy = c.atWords('ORDER', 'BY') ? this.orderBy() : undefined
    const limit = c.atWord('LIMIT') ? this.#limit() : undefined
    into = this.#oneInto(into)
    const locking: Locking[] = []
    for (let lock = this.#locking(); lock !== undefined; lock = this.#locking()) locking.push(lock)
    into = this.#oneInto(into)
    return {
      kind: QUERY.QUERY,
      ...(withClause === undefined ? {} : { with: withClause }),
      body,
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(limit === undefined ? {} : { limit }),
      ...(into === undefined ? {} : { into }),
      ...(locking.length === 0 ? {} : { locking }),
      at,
    }
  }

  /**
   * `INTO`, if one is written here and none was before. It is one clause that
   * may be written in four places — after the select list, after `FROM`, after
   * `LIMIT`, after the locking clause — and is recorded in one, so the four
   * spellings are one tree. A second is ER_MULTIPLE_INTO_CLAUSES, and one where
   * `INTO` is not allowed at all is ER_MISPLACED_INTO; both are refused here.
   */
  #oneInto(already: Into | undefined): Into | undefined {
    if (!this.#c.atWord('INTO')) return already
    if (already !== undefined || !this.#intoAllowed) this.#c.fail()
    return this.#into()
  }

  /** `UNION` and `EXCEPT`, left-associative, over intersections. */
  #setOperation(first: QueryBody): QueryBody {
    let left = first
    for (;;) {
      const t = this.#c.peek()
      const op = this.#c.atWord('UNION') ? 'UNION' : this.#c.atWord('EXCEPT') ? 'EXCEPT' : null
      if (op === null) return left
      this.#noPendingInto()
      this.#c.skip()
      const all = this.#quantifier()
      const right = this.#intersection(this.#primary())
      left = { kind: QUERY.SET_OPERATION, op, ...(all ? { all } : {}), left, right, at: t.start }
    }
  }

  /** `INTERSECT`, which binds tighter than `UNION` and `EXCEPT`. */
  #intersection(first: QueryBody): QueryBody {
    let left = first
    for (;;) {
      const t = this.#c.peek()
      if (!this.#c.atWord('INTERSECT')) return left
      this.#noPendingInto()
      this.#c.skip()
      const all = this.#quantifier()
      const right = this.#primary()
      left = { kind: QUERY.SET_OPERATION, op: 'INTERSECT', ...(all ? { all } : {}), left, right, at: t.start }
    }
  }

  /** `ALL` or `DISTINCT` after a set operator; `DISTINCT` is the default. */
  #quantifier(): boolean {
    if (this.#c.takeWord('ALL')) return true
    this.#c.takeWord('DISTINCT')
    return false
  }

  /** One branch: a `SELECT`, a `VALUES`, a `TABLE`, or a parenthesised query. */
  #primary(): QueryBody {
    const c = this.#c
    if (c.atOp('(')) {
      c.skip()
      const inner = this.query()
      c.expectOp(')')
      return inner
    }
    if (c.atWord('SELECT')) return this.#select()
    if (c.atWord('VALUES')) return this.#values()
    if (c.atWord('TABLE')) {
      const at = c.take().start
      return { kind: QUERY.TABLE, table: this.#tableName(), at }
    }
    return c.fail()
  }

  with(): With {
    const c = this.#c
    c.expectWord('WITH')
    const recursive = c.takeWord('RECURSIVE')
    const tables: CommonTable[] = []
    do {
      const name = c.expectIdentifier()
      const columns = c.atOp('(') ? this.#nameList() : undefined
      c.expectWord('AS')
      c.expectOp('(')
      const query = this.#nestedQuery()
      c.expectOp(')')
      tables.push({ name, ...(columns === undefined ? {} : { columns }), query })
    } while (c.takeOp(','))
    return { ...(recursive ? { recursive } : {}), tables }
  }

  #values() {
    const c = this.#c
    const at = c.take().start
    const rows: Expression[][] = []
    do {
      c.expectWord('ROW')
      rows.push(this.#row())
    } while (c.takeOp(','))
    return { kind: QUERY.VALUES, rows, at }
  }

  /** `(a, DEFAULT, b)` — a row of values; `DEFAULT` is a keyword node. */
  #row(): Expression[] {
    const c = this.#c
    c.expectOp('(')
    const items: Expression[] = []
    if (!c.atOp(')')) {
      do items.push(this.valueOrDefault())
      while (c.takeOp(','))
    }
    c.expectOp(')')
    return items
  }

  /** An expression, or the bare `DEFAULT` a row of values may contain. */
  valueOrDefault(): Expression {
    const c = this.#c
    if (c.atWord('DEFAULT') && !c.atOp('(', 1)) {
      const t = c.take()
      return { kind: NODE.KEYWORD, word: 'DEFAULT', at: t.start }
    }
    return this.#expr()
  }

  // --- SELECT ---------------------------------------------------------------

  #select(): SelectNode {
    const c = this.#c
    const at = c.take().start
    let distinct = false
    const options: string[] = []
    for (;;) {
      if (c.takeWord('DISTINCT') || c.takeWord('DISTINCTROW')) {
        distinct = true
        continue
      }
      if (c.takeWord('ALL')) continue
      const t = c.peek()
      if (t.kind === TOKEN.IDENTIFIER && t.quoted !== true && SELECT_OPTIONS.has(t.text.toUpperCase())) {
        c.skip()
        options.push(t.text.toUpperCase())
        continue
      }
      break
    }

    // A bare `*` may only come first: `SELECT *, a` is legal and
    // `SELECT a, *` is ER_PARSE_ERROR. A qualified `t.*` may go anywhere.
    const items: SelectItem[] = [this.#selectItem(true)]
    while (c.takeOp(',')) items.push(this.#selectItem(false))

    let into = this.#oneInto(undefined)
    let from: TableReference[] | undefined
    if (c.takeWord('FROM')) {
      // `FROM DUAL` is the absence of a table, spelled out.
      if (!c.takeWord('DUAL')) from = this.#tableReferences()
    }
    into = this.#oneInto(into)
    this.#pendingInto = into
    const where = c.takeWord('WHERE') ? this.#expr() : undefined
    const groupBy = c.atWords('GROUP', 'BY') ? this.#groupBy() : undefined
    const having = c.takeWord('HAVING') ? this.#expr() : undefined
    const windows = c.atWord('WINDOW') ? this.#windows() : undefined

    return {
      kind: QUERY.SELECT,
      ...(distinct ? { distinct } : {}),
      ...(options.length === 0 ? {} : { options }),
      items,
      ...(from === undefined ? {} : { from }),
      ...(where === undefined ? {} : { where }),
      ...(groupBy === undefined ? {} : { groupBy }),
      ...(having === undefined ? {} : { having }),
      ...(windows === undefined ? {} : { windows }),
      at,
    }
  }

  #selectItem(first: boolean): SelectItem {
    const c = this.#c
    if (first && c.atOp('*')) {
      const t = c.take()
      return { expr: { kind: NODE.COLUMN, parts: ['*'], at: t.start } }
    }
    const expr = this.#expr()
    // `t.*` names many columns, and an alias names one: `SELECT t1.* AS x` is
    // a syntax error on a real 8.4. Found by the census's expected-failure
    // accounting, which saw twenty of them in `alias.test` accepted.
    if (expr.kind === NODE.COLUMN && expr.parts[expr.parts.length - 1] === '*') return { expr }
    const alias = this.#alias()
    return alias === undefined ? { expr } : { expr, alias }
  }

  /**
   * `[AS] alias`. Without `AS`, only a word that is not reserved — which is
   * what stops `FROM t JOIN u` reading `JOIN` as `t`'s alias. A string is an
   * alias too, in either form: `SELECT 1 'one'`.
   */
  #alias(): string | undefined {
    const c = this.#c
    if (c.takeWord('AS')) {
      if (c.peek().kind === TOKEN.STRING) return c.take().text
      return c.expectIdentifier()
    }
    if (c.atIdentifier()) return c.take().text
    if (c.peek().kind === TOKEN.STRING) return c.take().text
    return undefined
  }

  #groupBy(): GroupBy {
    const c = this.#c
    c.skip()
    c.skip()
    // Newer than the 8.4 this project targets (D-10), which refuses it; the
    // pinned test corpus is newer still and uses it.
    if (c.atWords('GROUPING', 'SETS')) throw unsupportedStatement('GROUP BY GROUPING SETS')
    const items: Expression[] = []
    do items.push(this.#expr())
    while (c.takeOp(','))
    const rollup = c.takeWords('WITH', 'ROLLUP')
    return { items, ...(rollup ? { rollup } : {}) }
  }

  orderBy(): OrderItem[] {
    const c = this.#c
    c.expectWord('ORDER')
    c.expectWord('BY')
    const items: OrderItem[] = []
    do {
      const expr = this.#expr()
      if (c.takeWord('DESC')) items.push({ expr, desc: true })
      else {
        c.takeWord('ASC')
        items.push({ expr })
      }
    } while (c.takeOp(','))
    return items
  }

  /** `LIMIT n`, `LIMIT offset, n`, `LIMIT n OFFSET offset`. */
  #limit(): Limit {
    const c = this.#c
    c.expectWord('LIMIT')
    const first = this.#limitValue()
    if (c.takeOp(',')) return { count: this.#limitValue(), offset: first }
    if (c.takeWord('OFFSET')) return { count: first, offset: this.#limitValue() }
    return { count: first }
  }

  /**
   * A number, a `?`, or — inside a stored program — a variable name. Not an
   * arbitrary expression: `LIMIT 1 + 1` is a syntax error.
   */
  #limitValue(): Expression {
    const c = this.#c
    const t = c.peek()
    if (t.kind === TOKEN.NUMBER && /^\d+$/.test(t.text)) {
      c.skip()
      return { kind: NODE.LITERAL, type: 'int', value: BigInt(t.text), at: t.start }
    }
    if (t.kind === TOKEN.PLACEHOLDER) {
      c.skip()
      return { kind: NODE.PLACEHOLDER, index: t.index ?? 0, at: t.start }
    }
    if (t.kind === TOKEN.VARIABLE) {
      c.skip()
      return { kind: NODE.VARIABLE, name: t.text, at: t.start }
    }
    if (c.atIdentifier()) {
      c.skip()
      return { kind: NODE.COLUMN, parts: [t.text], at: t.start }
    }
    return c.fail()
  }

  #into(): Into | undefined {
    const c = this.#c
    if (!c.takeWord('INTO')) return undefined
    if (c.takeWord('OUTFILE')) {
      const file = this.#string()
      let charset: string | undefined
      if (c.takeWords('CHARACTER', 'SET') || c.takeWord('CHARSET')) charset = this.#word().toLowerCase()
      const options: Record<string, string> = {}
      for (const section of ['FIELDS', 'COLUMNS', 'LINES']) {
        if (!c.takeWord(section)) continue
        const key = section === 'COLUMNS' ? 'FIELDS' : section
        for (;;) {
          if (c.takeWords('TERMINATED', 'BY')) options[`${key} TERMINATED BY`] = this.#string()
          else if (c.takeWords('OPTIONALLY', 'ENCLOSED', 'BY')) options[`${key} OPTIONALLY ENCLOSED BY`] = this.#string()
          else if (c.takeWords('ENCLOSED', 'BY')) options[`${key} ENCLOSED BY`] = this.#string()
          else if (c.takeWords('ESCAPED', 'BY')) options[`${key} ESCAPED BY`] = this.#string()
          else if (c.takeWords('STARTING', 'BY')) options[`${key} STARTING BY`] = this.#string()
          else break
        }
      }
      return { kind: 'outfile', file, ...(charset === undefined ? {} : { charset }), options }
    }
    if (c.takeWord('DUMPFILE')) return { kind: 'dumpfile', file: this.#string() }
    const targets: Expression[] = []
    do {
      const t = c.peek()
      if (t.kind === TOKEN.VARIABLE) {
        c.skip()
        targets.push({ kind: NODE.VARIABLE, name: t.text, at: t.start })
      } else {
        // A stored program's local variable.
        targets.push({ kind: NODE.COLUMN, parts: [c.expectIdentifier()], at: t.start })
      }
    } while (c.takeOp(','))
    return { kind: 'variables', targets }
  }

  #locking(): Locking | undefined {
    const c = this.#c
    if (c.takeWords('LOCK', 'IN', 'SHARE', 'MODE')) return { strength: 'SHARE', legacy: true }
    if (!c.atWord('FOR') || !(c.atWord('UPDATE', 1) || c.atWord('SHARE', 1))) return undefined
    c.skip()
    const strength = c.take().text.toUpperCase() as 'UPDATE' | 'SHARE'
    let of: TableName[] | undefined
    if (c.takeWord('OF')) {
      of = []
      do of.push(this.#tableName())
      while (c.takeOp(','))
    }
    let wait: 'NOWAIT' | 'SKIP LOCKED' | undefined
    if (c.takeWord('NOWAIT')) wait = 'NOWAIT'
    else if (c.takeWords('SKIP', 'LOCKED')) wait = 'SKIP LOCKED'
    return { strength, ...(of === undefined ? {} : { of }), ...(wait === undefined ? {} : { wait }) }
  }

  // --- windows --------------------------------------------------------------

  #windows(): { name: string; spec: WindowSpec }[] {
    const c = this.#c
    c.expectWord('WINDOW')
    const out: { name: string; spec: WindowSpec }[] = []
    do {
      const name = c.expectIdentifier()
      c.expectWord('AS')
      c.expectOp('(')
      const spec = this.windowSpec()
      c.expectOp(')')
      out.push({ name, spec })
    } while (c.takeOp(','))
    return out
  }

  windowSpec(): WindowSpec {
    const c = this.#c
    const base = c.atIdentifier() ? c.take().text : undefined
    let partitionBy: Expression[] | undefined
    if (c.takeWords('PARTITION', 'BY')) {
      partitionBy = []
      do partitionBy.push(this.#expr())
      while (c.takeOp(','))
    }
    const orderBy = c.atWords('ORDER', 'BY') ? this.orderBy() : undefined
    let frame: WindowSpec['frame']
    if (c.atWord('ROWS') || c.atWord('RANGE')) {
      const units = c.take().text.toUpperCase() as 'ROWS' | 'RANGE'
      if (c.takeWord('BETWEEN')) {
        const start = this.#frameBound()
        c.expectWord('AND')
        frame = { units, start, end: this.#frameBound() }
      } else {
        frame = { units, start: this.#frameBound() }
      }
    }
    return {
      ...(base === undefined ? {} : { base }),
      ...(partitionBy === undefined ? {} : { partitionBy }),
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(frame === undefined ? {} : { frame }),
    }
  }

  #frameBound(): FrameBound {
    const c = this.#c
    if (c.takeWords('CURRENT', 'ROW')) return { kind: 'current' }
    if (c.takeWord('UNBOUNDED')) return { kind: 'unbounded', direction: this.#direction() }
    // `INTERVAL 1 DAY PRECEDING` is a value like any other here.
    const value = this.#expr()
    return { kind: 'value', value, direction: this.#direction() }
  }

  #direction(): 'PRECEDING' | 'FOLLOWING' {
    if (this.#c.takeWord('PRECEDING')) return 'PRECEDING'
    this.#c.expectWord('FOLLOWING')
    return 'FOLLOWING'
  }

  // --- table references -----------------------------------------------------

  #tableReferences(): TableReference[] {
    const out: TableReference[] = []
    do out.push(this.tableReference())
    while (this.#c.takeOp(','))
    return out
  }

  /**
   * One table reference: a factor and the joins that follow it.
   *
   * The right side of an inner or outer join is itself a full table reference,
   * so it absorbs the joins after it until a condition closes it — the
   * yacc-precedence behaviour the file header describes. `NATURAL` takes only
   * a factor on its right, as MySQL's grammar has it.
   */
  tableReference(): TableReference {
    return this.#c.nested(() => {
      let left = this.#factor()
      for (;;) {
        const c = this.#c
        const at = c.peek().start
        if (c.atWord('NATURAL')) {
          c.skip()
          let type: 'INNER' | 'LEFT' | 'RIGHT' = 'INNER'
          if (c.takeWord('LEFT')) type = 'LEFT'
          else if (c.takeWord('RIGHT')) type = 'RIGHT'
          else c.takeWord('INNER')
          if (type !== 'INNER') c.takeWord('OUTER')
          c.expectWord('JOIN')
          left = { kind: REF.JOIN, type, natural: true, left, right: this.#factor(), at }
          continue
        }
        // `STRAIGHT_JOIN` is one of MySQL's `inner_join_type`s, so it groups
        // exactly as `JOIN` does — its right side absorbs what follows. Read
        // first as taking only a factor, which `derived_correlated.test`'s
        // `a STRAIGHT_JOIN b INNER JOIN c ON x ON y` refuted.
        let type: 'INNER' | 'LEFT' | 'RIGHT' | 'STRAIGHT'
        if (c.takeWord('JOIN') || c.takeWords('INNER', 'JOIN') || c.takeWords('CROSS', 'JOIN')) type = 'INNER'
        else if (c.takeWord('STRAIGHT_JOIN')) type = 'STRAIGHT'
        else if (c.atWord('LEFT') || c.atWord('RIGHT')) {
          type = c.take().text.toUpperCase() as 'LEFT' | 'RIGHT'
          c.takeWord('OUTER')
          c.expectWord('JOIN')
        } else return left
        const right = this.tableReference()
        if (c.takeWord('ON')) {
          left = { kind: REF.JOIN, type, left, right, on: this.#expr(), at }
        } else if (c.takeWord('USING')) {
          left = { kind: REF.JOIN, type, left, right, using: this.#nameList(), at }
        } else {
          // An outer join must say how; an inner one need not — and an inner
          // one that does not is re-hung on its right side's leftmost table.
          if (type === 'LEFT' || type === 'RIGHT') c.fail()
          const outer = left
          const crossType = type
          left = hangCrossJoin(right, (leaf) => ({ kind: REF.JOIN, type: crossType, left: outer, right: leaf, at }))
        }
      }
    })
  }

  /**
   * One table: a name, a derived table, or a parenthesised list.
   *
   * A `(` is a derived table when a query starts right after it, and a list
   * otherwise. The list may itself open with a derived table —
   * `((SELECT …) AS a JOIN t ON …)` — and `((SELECT 1) UNION (SELECT 2)) AS d`
   * is a derived table whose query only reveals itself at `UNION`; both are
   * decided from the token in hand, as the expression parser does, rather than
   * by trying one reading and backtracking.
   */
  #factor(): TableReference {
    const c = this.#c
    const at = c.peek().start
    const lateral = c.takeWord('LATERAL')
    if (lateral || (c.atOp('(') && atQueryStart(c, 1))) {
      c.expectOp('(')
      return this.#derived(at, this.#nestedQuery(), lateral)
    }
    // ODBC's outer-join escape, `{ OJ a LEFT JOIN b ON … }`: the braces add
    // nothing, so the reference inside is the reference.
    if (c.atOp('{') && c.atWord('OJ', 1)) {
      c.skip()
      c.skip()
      const inner = this.tableReference()
      c.expectOp('}')
      return inner
    }
    if (c.takeOp('(')) {
      const first = this.tableReference()
      if (first.kind === REF.DERIVED && first.alias === undefined && first.lateral !== true && atQueryContinuation(c)) {
        return this.#derived(at, this.#withoutInto(() => this.queryAfter(first.query)), false)
      }
      const items = [first]
      while (c.takeOp(',')) items.push(this.tableReference())
      c.expectOp(')')
      // `((SELECT 1)) AS d`: extra parentheses around a derived table, which
      // take the alias the inner one did not.
      if (items.length === 1 && first.kind === REF.DERIVED && first.alias === undefined && (c.atWord('AS') || c.atIdentifier())) {
        const alias = this.#alias() as string
        const columns = c.atOp('(') ? this.#nameList() : undefined
        return { ...first, alias, ...(columns === undefined ? {} : { columns }) }
      }
      return { kind: REF.LIST, items, at }
    }
    if (c.atWord('JSON_TABLE')) throw unsupportedStatement('JSON_TABLE')
    const table = this.#tableName()
    let partitions: string[] | undefined
    if (c.takeWord('PARTITION')) partitions = this.#nameList()
    const alias = this.#alias()
    const indexHints = this.#indexHints()
    return {
      kind: REF.TABLE,
      table,
      ...(partitions === undefined ? {} : { partitions }),
      ...(alias === undefined ? {} : { alias }),
      ...(indexHints.length === 0 ? {} : { indexHints }),
      at,
    }
  }

  /** The rest of a derived table, with the cursor after its query: `) AS d (a, b)`. */
  #derived(at: number, query: QueryExpression, lateral: boolean): TableReference {
    const c = this.#c
    c.expectOp(')')
    const alias = this.#alias()
    const columns = alias !== undefined && c.atOp('(') ? this.#nameList() : undefined
    return {
      kind: REF.DERIVED,
      query,
      ...(lateral ? { lateral } : {}),
      ...(alias === undefined ? {} : { alias }),
      ...(columns === undefined ? {} : { columns }),
      at,
    }
  }

  #withoutInto<T>(read: () => T): T {
    const allowed = this.#intoAllowed
    this.#intoAllowed = false
    try {
      return read()
    } finally {
      this.#intoAllowed = allowed
    }
  }

  #indexHints(): IndexHint[] {
    const c = this.#c
    const out: IndexHint[] = []
    for (;;) {
      const type = c.atWord('USE') || c.atWord('IGNORE') || c.atWord('FORCE') ? c.peek().text.toUpperCase() : null
      if (type === null || !(c.atWord('INDEX', 1) || c.atWord('KEY', 1))) return out
      c.skip()
      c.skip()
      let scope: IndexHint['for']
      if (c.takeWord('FOR')) {
        if (c.takeWord('JOIN')) scope = 'JOIN'
        else if (c.takeWords('ORDER', 'BY')) scope = 'ORDER BY'
        else if (c.takeWords('GROUP', 'BY')) scope = 'GROUP BY'
        else c.fail()
      }
      c.expectOp('(')
      const indexes: string[] = []
      if (!c.atOp(')')) {
        do indexes.push(c.takeWord('PRIMARY') ? 'PRIMARY' : c.expectIdentifier())
        while (c.takeOp(','))
      }
      c.expectOp(')')
      out.push({ type: type as IndexHint['type'], ...(scope === undefined ? {} : { for: scope }), indexes })
    }
  }

  // --- small pieces ---------------------------------------------------------

  #tableName(): TableName {
    const c = this.#c
    const first = c.expectIdentifier()
    if (!c.takeOp('.')) return { name: first }
    return { schema: first, name: c.expectNamePart() }
  }

  #nameList(): string[] {
    const c = this.#c
    c.expectOp('(')
    const out: string[] = []
    do out.push(c.expectIdentifier())
    while (c.takeOp(','))
    c.expectOp(')')
    return out
  }

  #string(): string {
    const t = this.#c.peek()
    if (t.kind !== TOKEN.STRING) this.#c.fail()
    this.#c.skip()
    return t.text
  }

  #word(): string {
    const t = this.#c.peek()
    if (t.kind !== TOKEN.IDENTIFIER && t.kind !== TOKEN.STRING) this.#c.fail()
    this.#c.skip()
    return t.text
  }
}

/**
 * `add_cross_join` in MySQL's grammar: a condition-less inner join `a ⋈ R`
 * replaces the leftmost table reference of `R`'s join tree with `a ⋈ that`.
 * Only a join node is descended; a table, a derived table and a parenthesised
 * list are leaves, which is how parentheses keep their grouping.
 */
function hangCrossJoin(ref: TableReference, make: (leaf: TableReference) => TableReference): TableReference {
  // A loop, not a recursion: the spine was built by `tableReference`'s loop,
  // so its length is bounded by nothing the cursor's nesting guard sees, and a
  // recursive walk of a 5,000-join chain was a `RangeError` at parse time.
  const spine: JoinNode[] = []
  let leaf = ref
  while (leaf.kind === REF.JOIN) {
    spine.push(leaf)
    leaf = leaf.left
  }
  let out = make(leaf)
  for (const join of spine.reverse()) out = { ...join, left: out }
  return out
}

/** For the DML parser: one value of a `VALUES` row, which may be `DEFAULT`. */
export function parseValueOrDefault(c: Cursor, mode: SqlMode): Expression {
  return new QueryParser(c, mode, false).valueOrDefault()
}

/** For the DML parser: a table reference, joins included. */
export function parseTableReference(c: Cursor, mode: SqlMode): TableReference {
  return new QueryParser(c, mode, false).tableReference()
}
