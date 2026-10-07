// M3.3 — an AST back to SQL.
//
// M3.3's acceptance clause is "round-trips through a deparser to semantically
// equivalent SQL", and the deparser is built *before* the grammar it checks so
// that every form lands with its check already in place: the census parses
// each statement, deparses it, parses that, and requires the two trees to be
// equal. A field the parser reads and the tree does not hold — M3.2's `COLLATE`
// name was one — is a field the deparser cannot write back, and the second
// tree comes out different.
//
// Two choices make the output trustworthy rather than merely plausible:
//
//   - **Every operator application is parenthesised.** The deparser contains no
//     precedence table, so it cannot share a precedence mistake with the
//     parser; `(a + (b * c))` means one thing under any table. The single
//     exception is a left-nested run of *one* operator, written flat because
//     every operator but `:=` associates left — see `chain`.
//   - **Every name is backticked.** A backtick-quoted name is a name under every
//     `sql_mode` and whatever the reserved-word list says.
//
// String literals are the one place `sql_mode` reaches in here: whether `\` is
// an escape character is `NO_BACKSLASH_ESCAPES`'s decision, so a literal is
// escaped for the mode it will be parsed under.
import { NODE, LITERAL, type CallNode, type Expression, type LiteralNode } from './ast.ts'
import type { DataType } from './data-type.ts'
import { RESERVED } from './keywords.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'
import {
  QUERY,
  REF,
  type FrameBound,
  type Into,
  type Locking,
  type OrderItem,
  type QueryBody,
  type QueryExpression,
  type SelectNode,
  type TableReference,
  type WindowSpec,
} from './query-ast.ts'
import {
  KEY,
  STATEMENT,
  type Assignment,
  type CheckConstraint,
  type ColumnDefinition,
  type CreateTableNode,
  type CreateViewNode,
  type Definer,
  type DeleteNode,
  type DropNode,
  type IndexColumn,
  type InsertNode,
  type KeyDefinition,
  type Reference,
  type Statement,
  type TableName,
  type UpdateNode,
  type CommitNode,
  type CallStatementNode,
  type CreateEventNode,
  type CreateRoutineNode,
  type CreateTriggerNode,
  type AlterAction,
  type AlterTableNode,
  type ColumnPosition,
  type CreateDatabaseNode,
  type PartitionDefinition,
  type PartitionMethod,
  type Partitioning,
  type DescribeNode,
  type ExplainNode,
  type RollbackNode,
  type SetItem,
  type SetTransactionNode,
  type ShowNode,
  type StartTransactionNode,
} from './statement-ast.ts'

export interface DeparseOptions {
  /** The mode the output will be parsed under. Only `NO_BACKSLASH_ESCAPES` matters. */
  readonly sqlMode?: SqlMode
}

/** A statement or an expression, as SQL text. */
export function deparse(node: Statement | Expression, options: DeparseOptions = {}): string {
  const d = new Deparser(options.sqlMode ?? NO_SQL_MODE)
  return isStatement(node) ? d.statement(node) : d.expr(node)
}

const STATEMENT_KINDS: ReadonlySet<string> = new Set(Object.values(STATEMENT))
const isStatement = (node: Statement | Expression): node is Statement => STATEMENT_KINDS.has(node.kind)

/** A backtick-quoted name, with any backtick inside it doubled. */
export function quoteName(name: string): string {
  return '`' + name.replaceAll('`', '``') + '`'
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

class Deparser {
  readonly #mode: SqlMode

  constructor(mode: SqlMode) {
    this.#mode = mode
  }

  // --- literals and names ---------------------------------------------------

  string(value: string): string {
    const body = this.#mode.noBackslashEscapes ? value : value.replaceAll('\\', '\\\\')
    return "'" + body.replaceAll("'", "''") + "'"
  }

  /**
   * A word the parser will read back as the same text: bare when it is a plain,
   * unreserved word, otherwise quoted. For option values, whose spelling the
   * tree keeps and whose quoting it does not.
   */
  word(value: string): string {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value) && !RESERVED.has(value.toUpperCase()) ? value : this.string(value)
  }

  table(t: TableName): string {
    return t.schema === undefined ? quoteName(t.name) : `${quoteName(t.schema)}.${quoteName(t.name)}`
  }

  literal(e: LiteralNode): string {
    let body: string
    switch (e.type) {
      case LITERAL.INT:
      case LITERAL.DECIMAL:
        body = String(e.value)
        break
      case LITERAL.DOUBLE: {
        // An exponent is what makes a literal a DOUBLE rather than a DECIMAL,
        // so it must survive: `1.5e0` written back as `1.5` is a different type.
        const n = e.value as number
        body = Number.isFinite(n) ? n.toExponential() : '1e999'
        break
      }
      case LITERAL.STRING:
        body = this.string(e.value as string)
        break
      case LITERAL.HEX:
        body = `X'${hex(e.value as Uint8Array)}'`
        break
      case LITERAL.BIT:
        body = `b'${(e.value as bigint).toString(2)}'`
        break
      case LITERAL.NULL:
        body = 'NULL'
        break
      case LITERAL.BOOL:
        body = e.value === true ? 'TRUE' : 'FALSE'
        break
      case LITERAL.TEMPORAL:
        body = `${e.unit} ${this.string(e.value as string)}`
        break
    }
    // A space after the introducer, always: `_latin1X'ff'` is one identifier.
    const introduced = e.charset === undefined ? body : `_${e.charset} ${body}`
    return e.collation === undefined ? introduced : `${introduced} COLLATE ${quoteName(e.collation)}`
  }

  // --- expressions ----------------------------------------------------------

  expr(e: Expression): string {
    switch (e.kind) {
      case NODE.LITERAL:
        return this.literal(e)
      case NODE.PLACEHOLDER:
        return '?'
      case NODE.COLUMN:
        return e.parts.map((p, i) => (p === '*' && i === e.parts.length - 1 ? '*' : quoteName(p))).join('.')
      case NODE.VARIABLE: {
        // `@a` stays as written; `@'a b'` is re-quoted. A system variable is
        // never quoted: `@@session.sql_mode` is three tokens' worth of name.
        const prefix = e.name.startsWith('@@') ? '@@' : '@'
        const name = e.name.slice(prefix.length)
        return prefix === '@@' || /^[A-Za-z0-9_$.]+$/.test(name) ? e.name : prefix + quoteName(name)
      }
      case NODE.UNARY:
        // `IS NULL` and its siblings are postfix; everything else is prefix.
        if (e.op.startsWith('IS ')) return `(${this.expr(e.operand)} ${e.op})`
        return `(${e.op} ${this.expr(e.operand)})`
      case NODE.BINARY:
        return this.binary(e.op, e.left, e.right, e.extra)
      case NODE.CALL:
        return this.call(e)
      case NODE.CASE: {
        const parts = ['CASE']
        if (e.operand !== undefined) parts.push(this.expr(e.operand))
        for (const w of e.whens) parts.push(`WHEN ${this.expr(w.when)} THEN ${this.expr(w.then)}`)
        if (e.else !== undefined) parts.push(`ELSE ${this.expr(e.else)}`)
        parts.push('END')
        return parts.join(' ')
      }
      case NODE.ROW:
        // A one-item row cannot be written as `(a)`, which is just `a`.
        return e.items.length === 1 ? `ROW(${this.expr(e.items[0]!)})` : `(${e.items.map((i) => this.expr(i)).join(', ')})`
      case NODE.INTERVAL:
        // Not parenthesised: `INTERVAL` is grammar beside `+` and `-`, not an
        // expression that can stand in parentheses on its own.
        return `INTERVAL ${this.expr(e.value)} ${e.unit}`
      case NODE.COLLATE:
        return `(${this.expr(e.expr)} COLLATE ${quoteName(e.collation)})`
      case NODE.SUBQUERY:
        return `${e.quantifier === undefined ? '' : e.quantifier + ' '}(${this.query(e.query)})`
      case NODE.CAST: {
        const zone = e.timeZone === undefined ? '' : ` AT TIME ZONE ${this.string(e.timeZone)}`
        return `CAST(${this.expr(e.expr)}${zone} AS ${this.dataType(e.type)}${e.array === true ? ' ARRAY' : ''})`
      }
      case NODE.CONVERT:
        return `CONVERT(${this.expr(e.expr)} USING ${quoteName(e.charset)})`
      case NODE.KEYWORD:
        return e.word
      case NODE.MATCH:
        return `MATCH (${e.columns.map((c) => this.expr(c)).join(', ')}) AGAINST (${this.expr(e.against)}${e.modifier === undefined ? '' : ' ' + e.modifier})`
    }
  }

  /**
   * A call. Most are a name and a comma-separated list; the few whose grammar
   * is not are written back in their own syntax, since `POSITION(a, b)` and
   * `EXTRACT(YEAR, d)` are not SQL at all.
   */
  call(e: CallNode): string {
    const args = e.args.map((a) => this.expr(a))
    let body: string
    switch (e.name.toUpperCase()) {
      case 'EXTRACT':
        body = `${args[0]} FROM ${args[1]}`
        break
      case 'POSITION':
        body = `${args[0]} IN ${args[1]}`
        break
      case 'WEIGHT_STRING':
        body =
          e.args[1]?.kind === NODE.KEYWORD
            ? [`${args[0]} AS ${args[1]}(${args[2]})`, ...args.slice(3)].join(', ')
            : args.join(', ')
        break
      case 'TRIM':
        body =
          e.args[0]?.kind === NODE.KEYWORD
            ? `${args[0]} ${args.length === 3 ? args[1] + ' ' : ''}FROM ${args[args.length - 1]}`
            : args.length === 2
              ? `${args[0]} FROM ${args[1]}`
              : (args[0] as string)
        break
      default: {
        const star = e.args.length === 1 && e.args[0]!.kind === NODE.COLUMN && e.args[0]!.parts.length === 1 && e.args[0]!.parts[0] === '*'
        body = star ? '*' : args.join(', ')
      }
    }
    if (e.distinct === true) body = `DISTINCT ${body}`
    if (e.orderBy !== undefined) body += ` ${this.orderBy(e.orderBy)}`
    if (e.separator !== undefined) body += ` SEPARATOR ${this.string(e.separator)}`
    if (e.using !== undefined) body += ` USING ${quoteName(e.using)}`
    const over = e.over === undefined ? '' : ` OVER ${typeof e.over === 'string' ? quoteName(e.over) : `(${this.windowSpec(e.over)})`}`
    return `${e.name}(${body})${over}`
  }

  binary(op: string, left: Expression, right: Expression, extra: Expression | readonly Expression[] | undefined): string {
    const l = this.expr(left)
    switch (op) {
      case ':=':
        // The one operator that associates right, so it is never flattened.
        return `(${l} := ${this.expr(right)})`
      case 'BETWEEN':
      case 'NOT BETWEEN':
        return `(${l} ${op} ${this.expr(right)} AND ${this.expr(extra as Expression)})`
      case 'LIKE':
      case 'NOT LIKE':
        return extra === undefined
          ? `(${l} ${op} ${this.expr(right)})`
          : `(${l} ${op} ${this.expr(right)} ESCAPE ${this.expr(extra as Expression)})`
      case 'IN':
      case 'NOT IN':
        // The right side is always a row here, written as the list itself — a
        // one-item list included, which a bare `this.expr` would lose.
        return right.kind === NODE.ROW
          ? `(${l} ${op} (${right.items.map((i) => this.expr(i)).join(', ')}))`
          : `(${l} ${op} ${this.expr(right)})`
      case 'MEMBER OF':
        // The parentheses are the syntax's own: `a MEMBER OF (j)`.
        return `(${l} MEMBER OF (${this.expr(right)}))`
      default:
        return `(${this.chain(op, left, right)})`
    }
  }

  /**
   * A left-nested run of one operator, written flat: `a OR b OR c`, not
   * `((a OR b) OR c)`. Every binary operator MySQL has except `:=` associates
   * left, so the flat text reads back as the same tree — and a 400-term chain,
   * which the parser accepts, does not come back as 400 nested parentheses,
   * which its nesting guard would refuse. The one fact about operators the
   * deparser knows, and the round-trip checks it.
   */
  chain(op: string, left: Expression, right: Expression): string {
    const l =
      left.kind === NODE.BINARY && left.op === op && left.extra === undefined ? this.chain(op, left.left, left.right) : this.expr(left)
    return `${l} ${op} ${this.expr(right)}`
  }



  // --- queries --------------------------------------------------------------

  query(q: QueryExpression): string {
    const out = this.withClause(q.with)
    out.push(this.queryBody(q.body))
    if (q.orderBy !== undefined) out.push(this.orderBy(q.orderBy))
    if (q.limit !== undefined) {
      out.push(`LIMIT ${this.expr(q.limit.count)}${q.limit.offset === undefined ? '' : ` OFFSET ${this.expr(q.limit.offset)}`}`)
    }
    if (q.into !== undefined) out.push(this.into(q.into))
    for (const lock of q.locking ?? []) out.push(this.locking(lock))
    return out.join(' ')
  }

  queryBody(b: QueryBody): string {
    switch (b.kind) {
      case QUERY.QUERY:
        return `(${this.query(b)})`
      case QUERY.SELECT:
        return this.select(b)
      case QUERY.SET_OPERATION:
        // Both sides are written bare, and that is faithful for every tree the
        // parser builds: a side that was parenthesised is a nested query
        // expression and brings its own parentheses, a left-nested chain
        // re-associates left, and the one set operation that can sit on the
        // right unparenthesised is an `INTERSECT` under a `UNION` or `EXCEPT`,
        // which binds tighter and so regroups the same way.
        return `${this.queryBody(b.left)} ${b.op}${b.all === true ? ' ALL' : ''} ${this.queryBody(b.right)}`
      case QUERY.VALUES:
        return `VALUES ${b.rows.map((r) => `ROW(${r.map((v) => this.expr(v)).join(', ')})`).join(', ')}`
      case QUERY.TABLE:
        return `TABLE ${this.table(b.table)}`
    }
  }

  select(s: SelectNode): string {
    const out = ['SELECT']
    if (s.distinct === true) out.push('DISTINCT')
    if (s.options !== undefined) out.push(...s.options)
    out.push(s.items.map((i) => (i.alias === undefined ? this.expr(i.expr) : `${this.expr(i.expr)} AS ${quoteName(i.alias)}`)).join(', '))
    if (s.from !== undefined) out.push(`FROM ${s.from.map((r) => this.tableReference(r)).join(', ')}`)
    if (s.where !== undefined) out.push(`WHERE ${this.expr(s.where)}`)
    if (s.groupBy !== undefined) {
      out.push(`GROUP BY ${s.groupBy.items.map((i) => this.expr(i)).join(', ')}${s.groupBy.rollup === true ? ' WITH ROLLUP' : ''}`)
    }
    if (s.having !== undefined) out.push(`HAVING ${this.expr(s.having)}`)
    if (s.windows !== undefined) {
      out.push(`WINDOW ${s.windows.map((w) => `${quoteName(w.name)} AS (${this.windowSpec(w.spec)})`).join(', ')}`)
    }
    return out.join(' ')
  }

  orderBy(items: readonly OrderItem[]): string {
    return `ORDER BY ${items.map((i) => `${this.expr(i.expr)}${i.desc === true ? ' DESC' : ''}`).join(', ')}`
  }

  windowSpec(w: WindowSpec): string {
    const out: string[] = []
    if (w.base !== undefined) out.push(quoteName(w.base))
    if (w.partitionBy !== undefined) out.push(`PARTITION BY ${w.partitionBy.map((e) => this.expr(e)).join(', ')}`)
    if (w.orderBy !== undefined) out.push(this.orderBy(w.orderBy))
    if (w.frame !== undefined) {
      const f = w.frame
      out.push(f.end === undefined ? `${f.units} ${this.bound(f.start)}` : `${f.units} BETWEEN ${this.bound(f.start)} AND ${this.bound(f.end)}`)
    }
    return out.join(' ')
  }

  bound(b: FrameBound): string {
    if (b.kind === 'current') return 'CURRENT ROW'
    if (b.kind === 'unbounded') return `UNBOUNDED ${b.direction}`
    return `${this.expr(b.value as Expression)} ${b.direction}`
  }

  into(i: Into): string {
    if (i.kind === 'variables') return `INTO ${i.targets.map((t) => this.expr(t)).join(', ')}`
    if (i.kind === 'dumpfile') return `INTO DUMPFILE ${this.string(i.file)}`
    const out = [`INTO OUTFILE ${this.string(i.file)}`]
    if (i.charset !== undefined) out.push(`CHARACTER SET ${quoteName(i.charset)}`)
    for (const section of ['FIELDS', 'LINES']) {
      const own = Object.entries(i.options).filter(([k]) => k.startsWith(section + ' '))
      if (own.length > 0) out.push(section, ...own.map(([k, v]) => `${k.slice(section.length + 1)} ${this.string(v)}`))
    }
    return out.join(' ')
  }

  locking(l: Locking): string {
    if (l.legacy === true) return 'LOCK IN SHARE MODE'
    const of = l.of === undefined ? '' : ` OF ${l.of.map((t) => this.table(t)).join(', ')}`
    return `FOR ${l.strength}${of}${l.wait === undefined ? '' : ' ' + l.wait}`
  }

  tableReference(r: TableReference): string {
    switch (r.kind) {
      case REF.TABLE: {
        const out = [this.table(r.table)]
        if (r.partitions !== undefined) out.push(`PARTITION (${r.partitions.map(quoteName).join(', ')})`)
        if (r.alias !== undefined) out.push(`AS ${quoteName(r.alias)}`)
        for (const h of r.indexHints ?? []) {
          out.push(`${h.type} INDEX${h.for === undefined ? '' : ` FOR ${h.for}`} (${h.indexes.map((i) => (i === 'PRIMARY' ? i : quoteName(i))).join(', ')})`)
        }
        return out.join(' ')
      }
      case REF.DERIVED: {
        const out = [`${r.lateral === true ? 'LATERAL ' : ''}(${this.query(r.query)})`]
        if (r.alias !== undefined) out.push(`AS ${quoteName(r.alias)}`)
        if (r.columns !== undefined) out.push(`(${r.columns.map(quoteName).join(', ')})`)
        return out.join(' ')
      }
      case REF.LIST:
        return `(${r.items.map((i) => this.tableReference(i)).join(', ')})`
      case REF.JOIN: {
        // The right side of a join absorbs the joins after it, so a join that
        // was on the right is wrapped to stop it absorbing anything here — and
        // reads back as a parenthesised list of one, which is a different tree.
        // Written bare instead, it re-absorbs exactly what it held, because a
        // join on the right was parsed by the same rule.
        const op = r.type === 'STRAIGHT' ? 'STRAIGHT_JOIN' : `${r.natural === true ? 'NATURAL ' : ''}${r.type === 'INNER' ? '' : r.type + ' '}JOIN`
        const head = `${this.tableReference(r.left)} ${op} ${this.tableReference(r.right)}`
        if (r.on !== undefined) return `${head} ON ${this.expr(r.on)}`
        if (r.using !== undefined) return `${head} USING (${r.using.map(quoteName).join(', ')})`
        return head
      }
    }
  }

  // --- statements -----------------------------------------------------------

  statement(s: Statement): string {
    switch (s.kind) {
      case STATEMENT.CREATE_TABLE:
        return this.createTable(s)
      case STATEMENT.CREATE_VIEW:
        return this.createView(s)
      case STATEMENT.DROP:
        return this.drop(s)
      case STATEMENT.ALTER_TABLE:
        return this.alterTable(s)
      case STATEMENT.CREATE_DATABASE:
        return this.createDatabase(s)
      case STATEMENT.CREATE_ROUTINE:
        return this.createRoutine(s)
      case STATEMENT.CREATE_TRIGGER:
        return this.createTrigger(s)
      case STATEMENT.CREATE_EVENT:
        return this.createEvent(s)
      case STATEMENT.CALL:
        return this.callStatement(s)
      case STATEMENT.QUERY:
        return this.query(s)
      case STATEMENT.INSERT:
        return this.insert(s)
      case STATEMENT.UPDATE:
        return this.update(s)
      case STATEMENT.DELETE:
        return this.delete(s)
      case STATEMENT.SET:
        return `SET ${s.items.map((i) => this.setItem(i)).join(', ')}`
      case STATEMENT.SET_TRANSACTION:
        return this.setTransaction(s)
      case STATEMENT.USE:
        return `USE ${quoteName(s.database)}`
      case STATEMENT.SHOW:
        return this.show(s)
      case STATEMENT.EXPLAIN:
        return this.explain(s)
      case STATEMENT.DESCRIBE:
        return this.describe(s)
      case STATEMENT.START_TRANSACTION:
        return this.startTransaction(s)
      case STATEMENT.COMMIT:
      case STATEMENT.ROLLBACK:
        return this.completion(s)
      case STATEMENT.SAVEPOINT:
        return `SAVEPOINT ${quoteName(s.name)}`
      case STATEMENT.RELEASE_SAVEPOINT:
        return `RELEASE SAVEPOINT ${quoteName(s.name)}`
      case STATEMENT.PREPARE:
        return `PREPARE ${quoteName(s.name)} FROM ${s.text === undefined ? this.userVariable(s.variable ?? '') : this.string(s.text)}`
      case STATEMENT.EXECUTE:
        return `EXECUTE ${quoteName(s.name)}${s.using === undefined ? '' : ` USING ${s.using.map((v) => this.userVariable(v)).join(', ')}`}`
      case STATEMENT.DEALLOCATE:
        return `DEALLOCATE PREPARE ${quoteName(s.name)}`
      case STATEMENT.DO:
        return `DO ${s.exprs.map((e) => this.expr(e)).join(', ')}`
    }
  }

  // --- M3.6: session statements ---------------------------------------------

  userVariable(name: string): string {
    return this.expr({ kind: NODE.VARIABLE, name: `@${name}`, at: 0 })
  }

  /**
   * One `SET` item. A scoped system variable is always written `@@scope.x`,
   * never `SCOPE x`, because the keyword form is sticky and would re-scope
   * the bare names after it on the way back in.
   */
  setItem(i: SetItem): string {
    switch (i.type) {
      case 'user':
        return `${this.userVariable(i.name)} = ${this.expr(i.value)}`
      case 'system': {
        const part = (p: string) => (/^[A-Za-z0-9_$]+$/.test(p) ? p : quoteName(p))
        const prefix = `@@${i.scope === undefined ? '' : `${i.scope.toLowerCase()}.`}${i.base === undefined ? '' : `${part(i.base)}.`}`
        return `${prefix}${part(i.name)} = ${this.expr(i.value)}`
      }
      case 'name':
        return `${i.base === undefined ? '' : `${quoteName(i.base)}.`}${quoteName(i.name)} = ${this.expr(i.value)}`
      case 'names':
        if (i.charset === undefined) return 'NAMES DEFAULT'
        return `NAMES ${this.word(i.charset)}${i.collation === undefined ? '' : ` COLLATE ${this.word(i.collation)}`}`
      case 'charset':
        return `CHARACTER SET ${i.charset === undefined ? 'DEFAULT' : this.word(i.charset)}`
    }
  }

  setTransaction(s: SetTransactionNode): string {
    const characteristics: string[] = []
    if (s.isolation !== undefined) characteristics.push(`ISOLATION LEVEL ${s.isolation}`)
    if (s.access !== undefined) characteristics.push(s.access)
    return `SET ${s.scope === undefined ? '' : `${s.scope} `}TRANSACTION ${characteristics.join(', ')}`
  }

  show(s: ShowNode): string {
    const out = ['SHOW']
    if (s.count === true) return `SHOW COUNT(*) ${s.what}`
    if (s.what === 'GRANTS' || s.what === 'CREATE USER') {
      out.push(s.what)
      if (s.user !== undefined) out.push(`${s.what === 'GRANTS' ? 'FOR ' : ''}${this.definer(s.user)}`)
      return out.join(' ')
    }
    if (s.what.startsWith('CREATE ')) {
      out.push(s.what)
      if (s.ifNotExists === true) out.push('IF NOT EXISTS')
      if (s.name !== undefined) out.push(s.what === 'CREATE DATABASE' ? quoteName(s.name.name) : this.table(s.name))
      return out.join(' ')
    }
    if (s.extended === true) out.push('EXTENDED')
    if (s.full === true) out.push('FULL')
    if (s.scope !== undefined) out.push(s.scope)
    out.push(s.what)
    if (s.name !== undefined) out.push(`FROM ${this.table(s.name)}`)
    if (s.database !== undefined) out.push(`FROM ${quoteName(s.database)}`)
    if (s.like !== undefined) out.push(`LIKE ${this.string(s.like)}`)
    if (s.where !== undefined) out.push(`WHERE ${this.expr(s.where)}`)
    if (s.limit !== undefined) {
      out.push(`LIMIT ${this.expr(s.limit.count)}${s.limit.offset === undefined ? '' : ` OFFSET ${this.expr(s.limit.offset)}`}`)
    }
    return out.join(' ')
  }

  explain(s: ExplainNode): string {
    const out = ['EXPLAIN']
    if (s.analyze === true) out.push('ANALYZE')
    if (s.format !== undefined) out.push(`FORMAT = ${this.word(s.format)}`)
    if (s.into !== undefined) out.push(`INTO ${this.userVariable(s.into)}`)
    if (s.connection !== undefined) out.push(`FOR CONNECTION ${s.connection}`)
    if (s.schema !== undefined) out.push(`FOR SCHEMA ${quoteName(s.schema)}`)
    if (s.statement !== undefined) out.push(this.statement(s.statement))
    return out.join(' ')
  }

  describe(s: DescribeNode): string {
    return `DESCRIBE ${this.table(s.table)}${s.column === undefined ? '' : ` ${this.string(s.column)}`}`
  }

  startTransaction(s: StartTransactionNode): string {
    const characteristics: string[] = []
    if (s.consistentSnapshot === true) characteristics.push('WITH CONSISTENT SNAPSHOT')
    if (s.access !== undefined) characteristics.push(s.access)
    return `START TRANSACTION${characteristics.length === 0 ? '' : ` ${characteristics.join(', ')}`}`
  }

  completion(s: CommitNode | RollbackNode): string {
    const out = [s.kind === STATEMENT.COMMIT ? 'COMMIT' : 'ROLLBACK']
    if (s.kind === STATEMENT.ROLLBACK && s.savepoint !== undefined) return `ROLLBACK TO SAVEPOINT ${quoteName(s.savepoint)}`
    if (s.chain !== undefined) out.push(s.chain ? 'AND CHAIN' : 'AND NO CHAIN')
    if (s.release !== undefined) out.push(s.release ? 'RELEASE' : 'NO RELEASE')
    return out.join(' ')
  }

  // --- DML ------------------------------------------------------------------

  assignments(list: readonly Assignment[]): string {
    return list.map((a) => `${this.expr(a.column)} = ${this.expr(a.value)}`).join(', ')
  }

  insert(s: InsertNode): string {
    const out = [s.replace === true ? 'REPLACE' : 'INSERT']
    if (s.priority !== undefined) out.push(s.priority)
    if (s.ignore === true) out.push('IGNORE')
    out.push(`INTO ${this.table(s.table)}`)
    if (s.partitions !== undefined) out.push(`PARTITION (${s.partitions.map(quoteName).join(', ')})`)
    if (s.columns !== undefined) out.push(`(${s.columns.map((c) => this.expr(c)).join(', ')})`)
    if (s.values !== undefined) out.push(`VALUES ${s.values.map((r) => `(${r.map((v) => this.expr(v)).join(', ')})`).join(', ')}`)
    if (s.set !== undefined) out.push(`SET ${this.assignments(s.set)}`)
    if (s.query !== undefined) out.push(this.query(s.query))
    if (s.rowAlias !== undefined) {
      out.push(`AS ${quoteName(s.rowAlias.name)}${s.rowAlias.columns === undefined ? '' : ` (${s.rowAlias.columns.map(quoteName).join(', ')})`}`)
    }
    if (s.onDuplicate !== undefined) out.push(`ON DUPLICATE KEY UPDATE ${this.assignments(s.onDuplicate)}`)
    return out.join(' ')
  }

  /** `WHERE`, `ORDER BY` and a bare `LIMIT n`, which `UPDATE` and `DELETE` share. */
  dmlTail(s: UpdateNode | DeleteNode, out: string[]): string {
    if (s.where !== undefined) out.push(`WHERE ${this.expr(s.where)}`)
    if (s.orderBy !== undefined) out.push(this.orderBy(s.orderBy))
    if (s.limit !== undefined) out.push(`LIMIT ${this.expr(s.limit)}`)
    return out.join(' ')
  }

  withClause(w: QueryExpression['with']): string[] {
    if (w === undefined) return []
    const tables = w.tables.map(
      (t) => `${quoteName(t.name)}${t.columns === undefined ? '' : ` (${t.columns.map(quoteName).join(', ')})`} AS (${this.query(t.query)})`,
    )
    return [`WITH ${w.recursive === true ? 'RECURSIVE ' : ''}${tables.join(', ')}`]
  }

  update(s: UpdateNode): string {
    const out = [...this.withClause(s.with), 'UPDATE']
    if (s.priority !== undefined) out.push(s.priority)
    if (s.ignore === true) out.push('IGNORE')
    out.push(s.tables.map((t) => this.tableReference(t)).join(', '), `SET ${this.assignments(s.set)}`)
    return this.dmlTail(s, out)
  }

  delete(s: DeleteNode): string {
    const out = [...this.withClause(s.with), 'DELETE']
    if (s.priority !== undefined) out.push(s.priority)
    if (s.quick === true) out.push('QUICK')
    if (s.ignore === true) out.push('IGNORE')
    if (s.targets !== undefined) {
      out.push(s.targets.map((t) => this.table(t)).join(', '), `FROM ${s.tables.map((t) => this.tableReference(t)).join(', ')}`)
      return this.dmlTail(s, out)
    }
    // The single-table form puts the alias *before* the partitions, unlike a
    // table reference in a `FROM` list.
    const t = s.tables[0]
    if (t === undefined || t.kind !== REF.TABLE) throw new Error('deparse: a single-table DELETE names one table')
    out.push(`FROM ${this.table(t.table)}`)
    if (t.alias !== undefined) out.push(`AS ${quoteName(t.alias)}`)
    if (t.partitions !== undefined) out.push(`PARTITION (${t.partitions.map(quoteName).join(', ')})`)
    return this.dmlTail(s, out)
  }

  createTable(s: CreateTableNode): string {
    const head = `CREATE ${s.temporary === true ? 'TEMPORARY ' : ''}TABLE ${s.ifNotExists === true ? 'IF NOT EXISTS ' : ''}${this.table(s.table)}`
    if (s.like !== undefined) return `${head} LIKE ${this.table(s.like)}`
    const elements = [
      ...s.columns.map((c) => this.column(c)),
      ...s.keys.map((k) => this.key(k)),
      ...s.checks.map((c) => this.check(c)),
    ]
    const body = elements.length === 0 ? '' : ` (${elements.join(', ')})`
    const options = this.tableOptions(s.options)
    const partition = s.partition === undefined ? '' : ` ${this.partitioning(s.partition)}`
    const query = s.query === undefined ? '' : ` ${s.duplicates === undefined ? '' : s.duplicates + ' '}AS ${this.query(s.query)}`
    return `${head}${body}${options === '' ? '' : ' ' + options}${partition}${query}`
  }

  partitioning(p: Partitioning): string {
    const out = [`PARTITION BY ${this.partitionMethod(p, 'PARTITIONS')}`]
    if (p.sub !== undefined) out.push(`SUBPARTITION BY ${this.partitionMethod(p.sub, 'SUBPARTITIONS')}`)
    if (p.partitions !== undefined) out.push(`(${p.partitions.map((d) => this.partitionDefinition(d)).join(', ')})`)
    return out.join(' ')
  }

  partitionMethod(m: PartitionMethod, countWord: string): string {
    const out: string[] = []
    if (m.linear === true) out.push('LINEAR')
    out.push(m.method)
    if (m.algorithm !== undefined) out.push(`ALGORITHM = ${m.algorithm}`)
    if (m.columns !== undefined) out.push(`${m.method === 'RANGE' || m.method === 'LIST' ? 'COLUMNS ' : ''}(${m.columns.map(quoteName).join(', ')})`)
    if (m.expr !== undefined) out.push(`(${this.expr(m.expr)})`)
    if (m.count !== undefined) out.push(`${countWord} ${m.count}`)
    return out.join(' ')
  }

  partitionDefinition(d: PartitionDefinition): string {
    const out = [`PARTITION ${quoteName(d.name)}`]
    if (d.lessThan !== undefined) out.push(`VALUES LESS THAN (${d.lessThan.map((e) => this.expr(e)).join(', ')})`)
    if (d.in !== undefined) out.push(`VALUES IN (${d.in.map((e) => this.expr(e)).join(', ')})`)
    out.push(...this.partitionOptions(d.options))
    if (d.subpartitions !== undefined) {
      out.push(`(${d.subpartitions.map((p) => [`SUBPARTITION ${quoteName(p.name)}`, ...this.partitionOptions(p.options)].join(' ')).join(', ')})`)
    }
    return out.join(' ')
  }

  partitionOptions(options: Readonly<Record<string, string>>): string[] {
    return Object.entries(options).map(([name, value]) => `${name} = ${STRING_OPTIONS.has(name) ? this.string(value) : /^\d+$/.test(value) ? value : this.word(value)}`)
  }

  // --- M3.8: stored programs ------------------------------------------------

  /** `CREATE [DEFINER = u] OBJECT [IF NOT EXISTS] name`. */
  programHead(object: string, s: CreateRoutineNode | CreateTriggerNode | CreateEventNode): string {
    const definer = s.definer === undefined ? '' : `DEFINER = ${this.definer(s.definer)} `
    return `CREATE ${definer}${object} ${s.ifNotExists === true ? 'IF NOT EXISTS ' : ''}${this.table(s.name)}`
  }

  createRoutine(s: CreateRoutineNode): string {
    const parameters = s.parameters.map((p) => `${p.mode === undefined ? '' : p.mode + ' '}${quoteName(p.name)} ${this.dataType(p.type)}`)
    const out = [`${this.programHead(s.object, s)} (${parameters.join(', ')})`]
    if (s.returns !== undefined) out.push(`RETURNS ${this.dataType(s.returns)}`)
    if (s.comment !== undefined) out.push(`COMMENT ${this.string(s.comment)}`)
    if (s.deterministic !== undefined) out.push(s.deterministic ? 'DETERMINISTIC' : 'NOT DETERMINISTIC')
    if (s.dataAccess !== undefined) out.push(s.dataAccess)
    if (s.security !== undefined) out.push(`SQL SECURITY ${s.security}`)
    out.push(s.body)
    return out.join(' ')
  }

  createTrigger(s: CreateTriggerNode): string {
    const order = s.order === undefined ? '' : ` ${s.order.position} ${quoteName(s.order.trigger)}`
    return `${this.programHead('TRIGGER', s)} ${s.timing} ${s.event} ON ${this.table(s.table)} FOR EACH ROW${order} ${s.body}`
  }

  createEvent(s: CreateEventNode): string {
    const out = [`${this.programHead('EVENT', s)} ON SCHEDULE`]
    const schedule = s.schedule
    if ('at' in schedule) out.push(`AT ${this.expr(schedule.at)}`)
    else {
      out.push(`EVERY ${this.expr(schedule.every)} ${schedule.unit}`)
      if (schedule.starts !== undefined) out.push(`STARTS ${this.expr(schedule.starts)}`)
      if (schedule.ends !== undefined) out.push(`ENDS ${this.expr(schedule.ends)}`)
    }
    if (s.preserve !== undefined) out.push(`ON COMPLETION ${s.preserve ? '' : 'NOT '}PRESERVE`)
    if (s.status !== undefined) out.push(s.status)
    if (s.comment !== undefined) out.push(`COMMENT ${this.string(s.comment)}`)
    out.push(`DO ${s.body}`)
    return out.join(' ')
  }

  callStatement(s: CallStatementNode): string {
    return `CALL ${this.table(s.name)}(${s.args.map((a) => this.expr(a)).join(', ')})`
  }

  createDatabase(s: CreateDatabaseNode): string {
    const out = [`CREATE DATABASE ${s.ifNotExists === true ? 'IF NOT EXISTS ' : ''}${quoteName(s.name)}`]
    for (const [name, value] of Object.entries(s.options)) {
      out.push(`${name} = ${name === 'ENCRYPTION' ? this.string(value) : value === 'DEFAULT' ? 'DEFAULT' : this.word(value)}`)
    }
    return out.join(' ')
  }

  alterTable(s: AlterTableNode): string {
    const items = s.actions.map((a) => this.alterAction(a))
    const options = this.tableOptions(s.options)
    if (options !== '') items.push(options)
    return `ALTER TABLE ${this.table(s.table)}${items.length === 0 ? '' : ' ' + items.join(', ')}`
  }

  position(p: ColumnPosition | undefined): string {
    if (p === undefined) return ''
    return p === 'FIRST' ? ' FIRST' : ` AFTER ${quoteName(p.after)}`
  }

  alterAction(a: AlterAction): string {
    switch (a.type) {
      case 'addColumn':
        return `ADD COLUMN ${this.column(a.column)}${this.position(a.position)}`
      case 'addKey':
        return `ADD ${this.key(a.key)}`
      case 'addCheck':
        return `ADD ${this.check(a.check)}`
      case 'changeColumn':
        return `CHANGE COLUMN ${quoteName(a.name)} ${this.column(a.column)}${this.position(a.position)}`
      case 'drop':
        return `DROP ${a.what}${a.name === undefined ? '' : ' ' + quoteName(a.name)}`
      case 'setDefault':
        return `ALTER COLUMN ${quoteName(a.column)} SET DEFAULT (${this.expr(a.value)})`
      case 'dropDefault':
        return `ALTER COLUMN ${quoteName(a.column)} DROP DEFAULT`
      case 'columnVisibility':
        return `ALTER COLUMN ${quoteName(a.column)} SET ${a.visible ? 'VISIBLE' : 'INVISIBLE'}`
      case 'indexVisibility':
        return `ALTER INDEX ${quoteName(a.index)} ${a.visible ? 'VISIBLE' : 'INVISIBLE'}`
      case 'enforce':
        return `ALTER ${a.what} ${quoteName(a.name)} ${a.enforced ? '' : 'NOT '}ENFORCED`
      case 'rename':
        return `RENAME TO ${this.table(a.to)}`
      case 'renameColumn':
        return `RENAME COLUMN ${quoteName(a.from)} TO ${quoteName(a.to)}`
      case 'renameIndex':
        return `RENAME INDEX ${quoteName(a.from)} TO ${quoteName(a.to)}`
      case 'orderBy':
        return `ORDER BY ${a.columns.map((c) => `${quoteName(c.name ?? '')}${c.desc === true ? ' DESC' : ''}`).join(', ')}`
      case 'convert':
        return `CONVERT TO CHARACTER SET ${a.charset === undefined ? 'DEFAULT' : this.word(a.charset)}${a.collation === undefined ? '' : ` COLLATE ${this.word(a.collation)}`}`
      case 'keys':
        return `${a.enable ? 'ENABLE' : 'DISABLE'} KEYS`
      case 'force':
        return 'FORCE'
      case 'tablespace':
        return `${a.action} TABLESPACE`
    }
  }

  createView(s: CreateViewNode): string {
    const out = ['CREATE']
    if (s.orReplace === true) out.push('OR REPLACE')
    if (s.algorithm !== undefined) out.push(`ALGORITHM = ${s.algorithm}`)
    if (s.definer !== undefined) out.push(`DEFINER = ${this.definer(s.definer)}`)
    if (s.security !== undefined) out.push(`SQL SECURITY ${s.security}`)
    out.push(`VIEW ${this.table(s.view)}`)
    if (s.columns !== undefined) out.push(`(${s.columns.map(quoteName).join(', ')})`)
    out.push(`AS ${this.query(s.query)}`)
    if (s.checkOption !== undefined) out.push(`WITH ${s.checkOption} CHECK OPTION`)
    return out.join(' ')
  }

  definer(d: Definer): string {
    if (d === 'CURRENT_USER') return d
    return d.host === undefined ? this.string(d.user) : `${this.string(d.user)}@${this.string(d.host)}`
  }

  dataType(t: DataType): string {
    if (t.serial === true) return 'SERIAL'
    const out = [t.name]
    if (t.values !== undefined) {
      out[0] += `(${t.values.map((v) => (typeof v === 'string' ? this.string(v) : `X'${hex(v)}'`)).join(', ')})`
    } else if (t.length !== undefined) {
      out[0] += t.scale === undefined ? `(${t.length})` : `(${t.length}, ${t.scale})`
    }
    // ZEROFILL implies UNSIGNED, and the parser records both; writing both back
    // is harmless and keeps this a field-by-field transcription.
    if (t.unsigned === true) out.push('UNSIGNED')
    if (t.unsigned === false) out.push('SIGNED')
    if (t.zerofill === true) out.push('ZEROFILL')
    if (t.charset !== undefined) out.push(`CHARACTER SET ${this.charsetName(t.charset)}`)
    if (t.collation !== undefined) out.push(`COLLATE ${this.charsetName(t.collation)}`)
    if (t.binary === true) out.push('BINARY')
    return out.join(' ')
  }

  /** `DEFAULT` is the keyword, not a charset named "default". */
  charsetName(name: string): string {
    return name === 'default' ? 'DEFAULT' : quoteName(name)
  }

  column(c: ColumnDefinition): string {
    const out = [quoteName(c.name), this.dataType(c.type)]
    // SERIAL implies these three, and the parser sets them; writing them again
    // after `SERIAL` is legal and changes nothing.
    if (c.notNull === true) out.push('NOT NULL')
    if (c.nullable === true) out.push('NULL')
    if (c.default !== undefined) out.push(`DEFAULT ${this.defaultValue(c.default)}`)
    if (c.onUpdate !== undefined) out.push(`ON UPDATE ${this.defaultValue(c.onUpdate)}`)
    if (c.autoIncrement === true) out.push('AUTO_INCREMENT')
    if (c.unique === true) out.push('UNIQUE KEY')
    if (c.primary === true) out.push('PRIMARY KEY')
    if (c.comment !== undefined) out.push(`COMMENT ${this.string(c.comment)}`)
    if (c.generated !== undefined) out.push(`GENERATED ALWAYS AS (${this.expr(c.generated.expr)}) ${c.generated.stored ? 'STORED' : 'VIRTUAL'}`)
    if (c.invisible === true) out.push('INVISIBLE')
    if (c.invisible === false) out.push('VISIBLE')
    if (c.srid !== undefined) out.push(`SRID ${c.srid}`)
    if (c.check !== undefined) out.push(`CHECK (${this.expr(c.check)})`)
    return out.join(' ')
  }

  /**
   * A `DEFAULT` or `ON UPDATE` value. A literal, a signed number or a
   * `NOW()`-family call may stand bare; anything else needs the parentheses
   * 8.0.13 made part of the syntax.
   */
  defaultValue(e: Expression): string {
    if (e.kind === NODE.LITERAL) return this.literal(e)
    if (e.kind === NODE.UNARY && (e.op === '-' || e.op === '+') && e.operand.kind === NODE.LITERAL) return this.expr(e)
    if (e.kind === NODE.CALL && DEFAULT_FUNCTIONS.has(e.name.toUpperCase())) return this.expr(e)
    return `(${this.expr(e)})`
  }

  indexColumns(columns: readonly IndexColumn[]): string {
    return `(${columns
      .map((col) => {
        const body =
          col.expr !== undefined
            ? `(${this.expr(col.expr)})`
            : `${quoteName(col.name as string)}${col.length === undefined ? '' : `(${col.length})`}`
        return col.desc === true ? `${body} DESC` : body
      })
      .join(', ')})`
  }

  key(k: KeyDefinition): string {
    const out: string[] = []
    if (k.constraint !== undefined) out.push(`CONSTRAINT ${quoteName(k.constraint)}`)
    out.push(KEY_WORDS[k.type])
    if (k.name !== undefined) out.push(quoteName(k.name))
    out.push(this.indexColumns(k.columns))
    if (k.references !== undefined) out.push(this.references(k.references))
    if (k.using !== undefined) out.push(`USING ${k.using}`)
    if (k.comment !== undefined) out.push(`COMMENT ${this.string(k.comment)}`)
    return out.join(' ')
  }

  references(r: Reference): string {
    const out = [`REFERENCES ${this.table(r.table)}`]
    if (r.columns.length > 0) out.push(this.indexColumns(r.columns))
    if (r.match !== undefined) out.push(`MATCH ${r.match}`)
    if (r.onDelete !== undefined) out.push(`ON DELETE ${r.onDelete}`)
    if (r.onUpdate !== undefined) out.push(`ON UPDATE ${r.onUpdate}`)
    return out.join(' ')
  }

  check(c: CheckConstraint): string {
    const name = c.name === undefined ? '' : `CONSTRAINT ${quoteName(c.name)} `
    return `${name}CHECK (${this.expr(c.expr)})${c.enforced ? '' : ' NOT ENFORCED'}`
  }

  tableOptions(options: Readonly<Record<string, string>>): string {
    const out: string[] = []
    for (const [name, value] of Object.entries(options)) {
      if (name === 'START TRANSACTION') out.push(name)
      else if (name === 'UNION') out.push(`UNION = (${value.split(',').map(quoteName).join(', ')})`)
      else if (STRING_OPTIONS.has(name)) out.push(`${name} = ${this.string(value)}`)
      else if (value === 'DEFAULT' && (name === 'CHARACTER SET' || name === 'COLLATE')) out.push(`${name} = DEFAULT`)
      else out.push(`${name} = ${/^\d+$/.test(value) ? value : this.word(value)}`)
    }
    return out.join(' ')
  }

  drop(s: DropNode): string {
    const out = ['DROP']
    if (s.temporary === true) out.push('TEMPORARY')
    out.push(s.object)
    if (s.ifExists === true) out.push('IF EXISTS')
    out.push(s.names.map((n) => this.table(n)).join(', '))
    if (s.on !== undefined) out.push(`ON ${this.table(s.on)}`)
    if (s.behaviour !== undefined) out.push(s.behaviour)
    return out.join(' ')
  }
}

const KEY_WORDS = {
  [KEY.PRIMARY]: 'PRIMARY KEY',
  [KEY.UNIQUE]: 'UNIQUE KEY',
  [KEY.INDEX]: 'KEY',
  [KEY.FULLTEXT]: 'FULLTEXT KEY',
  [KEY.SPATIAL]: 'SPATIAL KEY',
  [KEY.FOREIGN]: 'FOREIGN KEY',
} as const

/** The functions a `DEFAULT` may name without parentheses around it. */
const DEFAULT_FUNCTIONS = new Set(['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'UTC_TIMESTAMP'])

/** Table options MySQL's grammar types as a string literal rather than a word. */
const STRING_OPTIONS = new Set([
  'COMMENT', 'CONNECTION', 'PASSWORD', 'DATA DIRECTORY', 'INDEX DIRECTORY', 'COMPRESSION', 'ENCRYPTION',
  'ENGINE_ATTRIBUTE', 'SECONDARY_ENGINE_ATTRIBUTE',
])
