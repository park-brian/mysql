// M5.17 — SELECT over one table: scan, filter, sort, project, distinct, limit.
//
// The pipeline is the Volcano operators of `operators.ts` in MySQL's logical
// order, and each clause it does not run yet is refused by name rather than
// ignored — a `GROUP BY` silently dropped would be a wrong answer that looks
// like a right one. Joins are M5.4, grouping and aggregates M5.5, windows
// M5.6, subqueries and set operations M5.1's remainder.
//
// A result column is named as MySQL names it: its alias, else a bare column's
// name as written, else the expression's own source text — `SELECT 1+1`
// returns a column called `1+1`, spaces and all, which only the text has.
import type { Catalog, ColumnDef, Table, TableDef } from '@myjs/engine'
import { NODE, QUERY, REF, TOKEN, deparse, lex, parseSqlMode, type Expression, type OrderItem, type QueryExpression, type SelectNode, type TableName, type Token } from '@myjs/parser'
import { messages, sqlError, type ColumnDefinition, type ResultSet, type RowValue } from '@myjs/protocol'
import { intValue, integerRange, toInteger, truth, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type CompileContext, type Compiled, type Env, type GroupKeys, type Row, type Scope } from './compile.ts'
import { AggregateSink, chooseStrategy, containsAggregate, groupRows, isAggregate } from './group.ts'
import { columnDefinition, intType, type ResultType } from './meta.ts'
import { FIELD_TYPE } from '@myjs/bytes'
import { distinct, filter, limit, project, scan, sort, type ScannedRow, type SortKey } from './operators.ts'
import { chooseAccess, type Access } from './plan.ts'
import { TableScope } from './scope.ts'
import type { SqlSession } from './session.ts'
import { toWire, type WireProtocol } from './wire.ts'
import type { Trx } from '@myjs/engine'

/** Everything one statement execution needs. */
export interface Run {
  readonly catalog: Catalog | undefined
  readonly state: SqlSession
  readonly env: Env
  /** The statement's text, which names unaliased result columns. */
  readonly sql: string
  readonly protocol: WireProtocol
  readonly serverVersion: string
  /** Parameter values, when they are known (an execute rather than a prepare). */
  readonly params?: readonly Value[]
  /** Planning for COM_STMT_PREPARE's metadata: what MySQL reports before it optimizes. */
  readonly preparing?: boolean
}

export function compileContext(run: Run, scope: Scope, clause: string): CompileContext {
  return {
    scope,
    clause,
    connectionCollation: run.env.session.characterSet,
    session: run.env.session,
    state: run.state,
    serverVersion: run.serverVersion,
    ...(run.params === undefined ? {} : { params: run.params }),
  }
}

/** A table a statement names, opened: ER_NO_DB_ERROR with no schema, ER_NO_SUCH_TABLE with no table. */
export function openTable(run: Run, name: TableName): { readonly schema: string; readonly def: TableDef; readonly table: Table } {
  const schema = name.schema ?? run.env.session.database
  if (schema === null || schema === undefined) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
  if (run.catalog === undefined) throw sqlError('ER_NO_SUCH_TABLE', messages.noSuchTable(schema, name.name))
  const def = run.catalog.definition(schema, name.name)
  return { schema, def, table: run.catalog.table(schema, name.name) }
}

const CLAUSE_WORDS = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'WINDOW', 'ORDER', 'LIMIT', 'INTO', 'FOR', 'LOCK', 'UNION', 'EXCEPT', 'INTERSECT'])
const MODIFIERS = new Set(['ALL', 'DISTINCT', 'DISTINCTROW', 'HIGH_PRIORITY', 'STRAIGHT_JOIN', 'SQL_SMALL_RESULT', 'SQL_BIG_RESULT', 'SQL_BUFFER_RESULT', 'SQL_NO_CACHE', 'SQL_CALC_FOUND_ROWS'])

/**
 * The source text of each select item, from the tokens between `SELECT` and
 * its first clause, split at top-level commas. `undefined` when the tokens do
 * not line up with the tree, in which case the caller deparses instead.
 */
function itemTexts(run: Run, node: SelectNode): (string | undefined)[] {
  let tokens
  try {
    tokens = lex(run.sql, { sqlMode: parseSqlMode(run.env.session.sqlMode) })
  } catch {
    return []
  }
  let i = tokens.findIndex((t) => t.start === node.at)
  if (i < 0) return []
  i++
  const word = (t: Token): string => (t.kind === TOKEN.IDENTIFIER && t.quoted !== true ? t.text.toUpperCase() : '')
  while (i < tokens.length && MODIFIERS.has(word(tokens[i] as Token))) i++
  const out: (string | undefined)[] = []
  let depth = 0
  let first = i
  for (; i <= tokens.length; i++) {
    const t = tokens[i]
    const end = t === undefined || (depth === 0 && (CLAUSE_WORDS.has(word(t)) || t.text === ';' || (t.kind === TOKEN.OPERATOR && t.text === ')')))
    if (end || (depth === 0 && t?.kind === TOKEN.OPERATOR && t.text === ',')) {
      const a = tokens[first]
      const b = tokens[i - 1]
      // An item ending in a word — `-id`, `age IS NULL` — runs on to the next
      // token, whitespace and all: `SELECT -id FROM t` names its column `-id `.
      // One ending in a number, a string or a parenthesis ends where it ends.
      // Both read off 8.4.11, and so is the exception: once the session has
      // assigned its own `sql_mode`, the whitespace is not kept.
      const stop = b !== undefined && b.kind === TOKEN.IDENTIFIER && !run.state.sqlModeAssigned ? (t?.start ?? run.sql.length) : b?.end
      out.push(a === undefined || b === undefined || i === first ? undefined : run.sql.slice(a.start, stop))
      first = i + 1
      if (end) break
      continue
    }
    if (t?.kind === TOKEN.OPERATOR && t.text === '(') depth++
    if (t?.kind === TOKEN.OPERATOR && t.text === ')') depth--
  }
  return out
}

export interface SelectPlan {
  readonly columns: readonly { readonly name: string; readonly type: ResultType }[]
  /** The rows, as values. Runs the scan: call once, inside the statement's transaction. */
  rows(trx: Trx | undefined): Iterable<Value[]>
  /** `FOR UPDATE` / `FOR SHARE`: the read takes the writer slot. */
  readonly locking: boolean
}

/** The one query shape this executor runs: a SELECT, possibly in parentheses, with no set operation. */
export function selectOf(q: QueryExpression): SelectNode {
  if (q.with !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('WITH'))
  if (q.into !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('SELECT … INTO'))
  const body = q.body
  if (body.kind === QUERY.QUERY && body.orderBy === undefined && body.limit === undefined && q.orderBy === undefined && q.limit === undefined) return selectOf(body)
  if (body.kind !== QUERY.SELECT) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(body.kind === QUERY.SET_OPERATION ? body.op : body.kind.toUpperCase()))
  return body
}

export function planSelect(run: Run, q: QueryExpression): SelectPlan {
  const node = selectOf(q)
  if (node.windows !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('WINDOW'))

  // FROM: nothing, `DUAL`, or one table.
  let source: { readonly alias: string; readonly def: TableDef; readonly table: Table } | undefined
  const from = node.from ?? []
  if (from.length > 1) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Joins'))
  const ref = from[0]
  if (ref !== undefined) {
    if (ref.kind !== REF.TABLE) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(ref.kind === REF.DERIVED ? 'Derived tables' : 'Joins'))
    if (!(ref.table.schema === undefined && ref.table.name.toLowerCase() === 'dual' && ref.alias === undefined)) {
      const opened = openTable(run, ref.table)
      source = { alias: ref.alias ?? ref.table.name, def: opened.def, table: opened.table }
    }
  }
  const scope = source === undefined ? undefined : new TableScope([{ alias: source.alias, def: source.def }])
  const lookup: Scope = scope ?? EMPTY_SCOPE

  // An aggregate anywhere in the select list or HAVING makes the query a
  // grouped one, even with no GROUP BY; one in ORDER BY alone does not, and
  // is 3029 (8.4.11).
  const grouped = node.groupBy !== undefined || node.items.some((i) => containsAggregate(i.expr)) || (node.having !== undefined && containsAggregate(node.having))
  if (!grouped && (q.orderBy ?? []).some((o) => containsAggregate(o.expr))) {
    const at = (q.orderBy ?? []).findIndex((o) => containsAggregate(o.expr)) + 1
    throw sqlError('ER_AGGREGATE_ORDER_NON_AGG_QUERY', `Expression #${at} of ORDER BY contains aggregate function and applies to the result of a non-aggregated query`)
  }
  if (!grouped && node.having !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('HAVING without grouping'))
  if (grouped) return planGrouped(run, q, node, source, scope, lookup)

  // The select list, `*` expanded.
  const texts = itemTexts(run, node)
  const items: { name: string; compiled: Compiled; alias?: string }[] = []
  node.items.forEach((item, i) => {
    const e = item.expr
    if (e.kind === NODE.COLUMN && e.parts[e.parts.length - 1] === '*') {
      if (scope === undefined) throw sqlError('ER_NO_TABLES_USED', 'No tables used')
      const table = e.parts.length >= 2 ? e.parts[e.parts.length - 2] : undefined
      for (const s of scope.star(table)) items.push({ name: s.name, compiled: { eval: (row) => row[s.index] ?? null, type: s.type } })
      return
    }
    const compiled = compile(e, compileContext(run, lookup, 'field list'))
    items.push({ name: itemName(item, texts[i]), compiled, ...(item.alias === undefined ? {} : { alias: item.alias }) })
  })

  // `SELECT DISTINCT` is run through a temporary table — which changes the
  // metadata a client sees — unless the select list holds a whole key of NOT
  // NULL columns, in which case every row is distinct already and MySQL drops
  // the DISTINCT.
  const limitCount = q.limit === undefined ? undefined : limitValue(run, q.limit.count, 'LIMIT')
  const offset = q.limit?.offset === undefined ? 0 : limitValue(run, q.limit.offset, 'LIMIT')
  const facts = source === undefined ? undefined : whereFacts(run, source.def, source.alias, node.where)
  // A prepare reports a statement before MySQL optimizes it, so it never sees
  // the temporary table: COM_STMT_PREPARE's metadata has no GROUP_FLAG where
  // the execute's does (8.4.11, found by review).
  if (node.distinct === true && source !== undefined && facts !== undefined && run.preparing !== true && !holdsKey(source.def, node.items, source.alias)) {
    // `LIMIT 0` returns nothing before a row is read — unless an offset must
    // be counted off sorted rows: `ORDER BY 1 LIMIT 0 OFFSET 1` still makes
    // the table, and the same without the ORDER BY does not (8.4.11).
    const zero = limitCount === 0 && (offset === 0 || q.orderBy === undefined)
    const pinnedName = (item: { compiled: Compiled }): boolean => {
      const name = item.compiled.type.column?.orgName.toLowerCase()
      return name !== undefined && [...facts.pins].some((c) => c.name.toLowerCase() === name)
    }
    const constant = zero || facts.impossible || facts.constTable || items.every((item) => pinnedName(item))
    if (!constant) {
      for (const item of items) item.compiled = { ...item.compiled, type: { ...item.compiled.type, temporary: pinnedName(item) ? 'pinned' : true } }
    }
  }

  const where = node.where === undefined ? undefined : compile(node.where, compileContext(run, lookup, 'where clause'))
  const keys = (q.orderBy ?? []).map((o) => orderKey(run, o, items, lookup))
  const locking = (q.locking ?? []).length > 0
  const env = run.env

  return {
    columns: items.map((i) => ({ name: i.name, type: i.compiled.type })),
    locking,
    rows(trx) {
      let rows: Iterable<{ readonly row: Row }>
      if (source === undefined) rows = [{ row: [] }]
      else if (facts?.impossible === true) rows = []
      else {
        const access = chooseAccess(source.def, source.alias, node.where, env)
        rows = accessRows(source.table, source.def, access, trx, locking)
      }
      let filtered: Iterable<{ readonly row: Row }> = filter(rows, where, env)
      if (keys.length > 0) filtered = sort(filtered, keys, env)
      let out: Iterable<Value[]> = project(filtered, items.map((i) => i.compiled), env)
      if (node.distinct === true) out = distinct(out)
      return limit(out, offset, limitCount)
    },
  }
}

/** A result column's name: its alias, a bare column's name as written, a string literal's value, else its source text. */
function itemName(item: SelectNode['items'][number], text: string | undefined): string {
  const e = item.expr
  return item.alias ?? (e.kind === NODE.COLUMN ? (e.parts[e.parts.length - 1] as string) : e.kind === NODE.LITERAL && e.type === 'string' ? (e.value as string) : text === undefined ? deparseName(e) : text)
}

/**
 * A grouped query (M5.5): GROUP BY, an aggregate, or both. See `group.ts`
 * for the grouped row it compiles its select list against, and for how the
 * strategy — index, sort, temporary table — is chosen as 8.4.11 chooses it.
 */
function planGrouped(
  run: Run,
  q: QueryExpression,
  node: SelectNode,
  source: { readonly alias: string; readonly def: TableDef; readonly table: Table } | undefined,
  scope: TableScope | undefined,
  lookup: Scope,
): SelectPlan {
  const width = scope?.width ?? 0
  const rollup = node.groupBy?.rollup === true
  const texts = itemTexts(run, node)

  // The select list with `*` expanded to its columns, as expressions, since
  // above the grouping a column is not simply its slot.
  const selectItems: { expr: Expression; name: string; alias?: string }[] = []
  node.items.forEach((item, i) => {
    const e = item.expr
    if (e.kind === NODE.COLUMN && e.parts[e.parts.length - 1] === '*') {
      if (scope === undefined) throw sqlError('ER_NO_TABLES_USED', 'No tables used')
      const table = e.parts.length >= 2 ? e.parts[e.parts.length - 2] : undefined
      for (const t of scope.tables) {
        if (table !== undefined && t.alias !== table) continue
        for (const c of t.def.columns) selectItems.push({ expr: { kind: NODE.COLUMN, parts: [t.alias, c.name], at: e.at }, name: c.name })
      }
      scope.star(table)
      return
    }
    selectItems.push({ expr: e, name: itemName(item, texts[i]), ...(item.alias === undefined ? {} : { alias: item.alias }) })
  })

  // GROUP BY: a table column first, then a select-list alias, then a
  // position. `SELECT k AS s … GROUP BY s` groups by the column `s` (8.4.11).
  const rowCtx = compileContext(run, lookup, 'group statement')
  const keys = (node.groupBy?.items ?? []).map((g) => {
    let expr: Expression = g
    if (g.kind === NODE.LITERAL && g.type === 'int') {
      const item = selectItems[Number(g.value as bigint) - 1]
      if (item === undefined) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(String(g.value), 'group statement'))
      expr = item.expr
    } else if (g.kind === NODE.COLUMN && g.parts.length === 1) {
      try {
        lookup.resolve(g.parts, 'group statement')
      } catch (e) {
        const alias = selectItems.find((i) => i.alias?.toLowerCase() === (g.parts[0] as string).toLowerCase())
        if (alias === undefined) throw e
        expr = alias.expr
      }
    }
    if (containsAggregate(expr)) throw sqlError('ER_WRONG_GROUP_FIELD', `Can't group on '${deparse(g)}'`)
    const compiled = compile(expr, rowCtx)
    const index = expr.kind === NODE.COLUMN ? lookup.resolve(expr.parts, 'group statement').index : undefined
    return { expr, compiled, index, text: deparse(expr) }
  })

  // The strategy, which decides the order the groups come out in and whether
  // their columns go through a temporary table.
  const keyColumns = keys.map((k) => (k.index === undefined || source === undefined ? undefined : source.def.columns[k.index]?.name))
  const distinctAggregate = [...node.items.map((i) => i.expr), ...(node.having === undefined ? [] : [node.having]), ...(q.orderBy ?? []).map((o) => o.expr)].some((e) => needsSortedGroups(e))
  const { strategy, index: groupIndex } = chooseStrategy(source?.def, keyColumns, rollup, distinctAggregate)

  const level = width + keys.length
  const sink = new AggregateSink(compileContext(run, lookup, 'field list'), level + 1)
  const groupKeys: GroupKeys = {
    match(e) {
      // Only ROLLUP needs a key read from its slot: elsewhere the group's
      // first row holds the same value.
      if (!rollup) return undefined
      let j = -1
      if (e.kind === NODE.COLUMN) {
        let at: number | undefined
        try {
          at = lookup.resolve(e.parts, 'field list').index
        } catch {
          return undefined
        }
        j = keys.findIndex((k) => k.index === at)
      } else {
        const text = deparse(e)
        j = keys.findIndex((k) => k.index === undefined && k.text === text)
      }
      if (j < 0) return undefined
      const key = keys[j] as (typeof keys)[number]
      const slot = width + j
      const { column: _c, temporary: _t, blobBytes: _b, ...type } = key.compiled.type
      return { eval: (row) => row[slot] ?? null, type: { ...type, nullable: true } }
    },
    grouping(args) {
      if (!rollup) throw sqlError('ER_INVALID_GROUP_FUNC_USE', 'Invalid use of group function')
      const positions = args.map((a, n) => {
        const text = deparse(a)
        const j = keys.findIndex((k) => k.text === text || (a.kind === NODE.COLUMN && k.index !== undefined && safeIndex(lookup, a.parts) === k.index))
        if (j < 0) throw sqlError('ER_FIELD_IN_GROUPING_NOT_GROUP_BY', `Argument #${n + 1} of GROUPING function is not in GROUP BY`)
        return j
      })
      return {
        eval: (row) => {
          const kept = Number(toInteger(row[level] ?? intValue(0n)))
          let bits = 0n
          for (const j of positions) bits = (bits << 1n) | (j >= kept ? 1n : 0n)
          return intValue(bits)
        },
        type: intType(21, true),
      }
    },
  }
  const postCtx = (clause: string, at: Scope = lookup): CompileContext => ({ ...compileContext(run, at, clause), aggregates: sink, groupKeys })

  const items = selectItems.map((s) => ({ name: s.name, compiled: compile(s.expr, postCtx('field list')), expr: s.expr, ...(s.alias === undefined ? {} : { alias: s.alias }) }))

  // HAVING sees the select list's aliases, its columns and the keys; a column
  // that is none of those is 1054 even when the table has it (8.4.11).
  let having: Compiled | undefined
  if (node.having !== undefined) {
    const allowed = new Set<number>()
    for (const k of keys) if (k.index !== undefined) allowed.add(k.index)
    for (const s of selectItems) if (s.expr.kind === NODE.COLUMN) allowed.add(lookup.resolve(s.expr.parts, 'having clause').index)
    const havingScope: Scope = {
      resolve(parts, clause) {
        const r = lookup.resolve(parts, clause)
        if (!allowed.has(r.index)) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(parts.join('.'), clause))
        return r
      },
    }
    having = compile(substituteAliases(node.having, selectItems), postCtx('having clause', havingScope))
  }

  const orderItems = items.map((i) => ({ name: i.name, compiled: i.compiled, ...(i.alias === undefined ? {} : { alias: i.alias }) }))
  const orderKeys = (q.orderBy ?? []).map((o) => {
    const e = o.expr
    if ((e.kind === NODE.LITERAL && e.type === 'int') || (e.kind === NODE.COLUMN && e.parts.length === 1 && items.some((i) => i.alias?.toLowerCase() === (e.parts[0] as string).toLowerCase()))) {
      return orderKey(run, o, orderItems, lookup)
    }
    return { expr: compile(e, postCtx('order clause')), desc: o.desc === true }
  })

  if (/(^|,)ONLY_FULL_GROUP_BY(,|$)/i.test(run.env.session.sqlMode)) {
    checkFullGroupBy(lookup, scope, keys, node.where, items.map((i) => i.expr), (q.orderBy ?? []).filter((o) => !(o.expr.kind === NODE.LITERAL && o.expr.type === 'int') && !(o.expr.kind === NODE.COLUMN && o.expr.parts.length === 1 && items.some((i) => i.alias?.toLowerCase() === (o.expr as unknown as { parts: string[] }).parts[0]?.toLowerCase()))).map((o) => o.expr), node.groupBy === undefined)
  }

  // What a client is told depends on what MySQL copies through a temporary
  // table (8.4.11, M5.18):
  //   - An aggregating temporary table holds the keys, the aggregates, the
  //     other columns and the expressions over columns.
  //   - Grouping by index or sort, then sorting for an ORDER BY that is not the
  //     keys' own ascending order, streams the same items into one first
  //     ("Stream results"). Under ROLLUP that happens for any ORDER BY.
  //   - What is computed over an aggregate (`COUNT(*) + 2`), and a constant,
  //     is computed after and keeps its own metadata.
  //   - Without a GROUP BY, a column can be NULL: the group may be empty.
  // A prepare reports the statement before it is optimized, so none of this.
  const orderMatchesKeys =
    !rollup &&
    (q.orderBy ?? []).length <= keys.length &&
    (q.orderBy ?? []).every((o, i) => {
      if (o.desc === true) return false
      const key = keys[i] as (typeof keys)[number]
      const e = o.expr.kind === NODE.LITERAL && o.expr.type === 'int' ? selectItems[Number(o.expr.value as bigint) - 1]?.expr : o.expr
      if (e === undefined) return false
      if (key.index !== undefined && e.kind === NODE.COLUMN) return safeIndex(lookup, e.parts) === key.index
      return deparse(e) === key.text
    })
  const stream = (strategy === 'sort' || strategy === 'index') && (q.orderBy ?? []).length > 0 && !orderMatchesKeys
  if (run.preparing !== true) {
    const seenKeys = new Set<number>()
    for (const item of items) {
      const e = item.expr
      const t = item.compiled.type
      if (!refersToRow(e)) continue
      const aggregateCall = e.kind === NODE.CALL && isAggregate(e)
      if (!aggregateCall && containsAggregate(e)) continue
      if (strategy === 'implicit') {
        if (!aggregateCall) item.compiled = { ...item.compiled, type: { ...t, nullable: true } }
        continue
      }
      // A key named twice is one field of the table: only its first mention
      // carries GROUP_FLAG (8.4.11, `SELECT t, t … GROUP BY t`).
      const at = e.kind === NODE.COLUMN ? safeIndex(lookup, e.parts) : undefined
      const isKey = at !== undefined && keys.some((k) => k.index === at) && !seenKeys.has(at)
      if (at !== undefined) seenKeys.add(at)
      if (strategy === 'temp') item.compiled = { ...item.compiled, type: { ...t, temporary: t.column === undefined || isKey ? true : 'pinned' } }
      else if (stream) {
        // A ROLLUP key is copied as the BIGINT it evaluates to (8.4.11: an INT key reports type 8 once sorted).
        const rollupInt = rollup && t.column === undefined && t.kind === 'int' && !aggregateCall
        item.compiled = { ...item.compiled, type: { ...t, temporary: 'stream', ...(rollupInt ? { field: FIELD_TYPE.LONGLONG } : {}) } }
      }
    }
  }

  const where = node.where === undefined ? undefined : compile(node.where, compileContext(run, lookup, 'where clause'))
  const limitCount = q.limit === undefined ? undefined : limitValue(run, q.limit.count, 'LIMIT')
  const offset = q.limit?.offset === undefined ? 0 : limitValue(run, q.limit.offset, 'LIMIT')
  const locking = (q.locking ?? []).length > 0
  const env = run.env
  const plan = { width, keys: keys.map((k) => k.compiled), specs: sink.specs, strategy, rollup }

  return {
    columns: items.map((i) => ({ name: i.name, type: i.compiled.type })),
    locking,
    rows(trx) {
      let rows: Iterable<{ readonly row: Row }>
      if (source === undefined) rows = [{ row: [] }]
      else {
        let access = chooseAccess(source.def, source.alias, node.where, env)
        // An index-ordered grouping reads that index whole, in its order.
        if (strategy === 'index' && groupIndex !== undefined) {
          const clustered = source.def.indexes.find((i) => i.name === groupIndex)?.kind === 'primary' || source.def.clustered === groupIndex
          const sameIndex = clustered ? access.index === undefined : access.index === groupIndex
          if (!sameIndex) access = clustered ? {} : { index: groupIndex }
        }
        rows = accessRows(source.table, source.def, access, trx, locking)
      }
      let out: Iterable<{ readonly row: Row }> = groupRows(filter(rows, where, env), plan, env)
      out = filter(out, having, env)
      if (orderKeys.length > 0) out = sort(out, orderKeys, env)
      let projected: Iterable<Value[]> = project(out, items.map((i) => i.compiled), env)
      if (node.distinct === true) projected = distinct(projected)
      return limit(projected, offset, limitCount)
    },
  }
}

const safeIndex = (scope: Scope, parts: readonly string[]): number | undefined => {
  try {
    return scope.resolve(parts, 'field list').index
  } catch {
    return undefined
  }
}

/** Whether an aggregate in `e` needs its groups sorted: a DISTINCT one, or any GROUP_CONCAT (8.4.11's plans). */
function needsSortedGroups(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const n = e as { kind?: string; distinct?: boolean; name?: string }
  if (n.kind === NODE.SUBQUERY) return false
  if (n.kind === NODE.CALL && isAggregate(n as Expression)) {
    const name = (n.name as string).toUpperCase()
    if (name === 'GROUP_CONCAT' || (n.distinct === true && name !== 'MIN' && name !== 'MAX')) return true
  }
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(needsSortedGroups) : typeof v === 'object' && needsSortedGroups(v)))
}

/** Whether `e` reads the row at all: a column or an aggregate. A constant does not, and is never copied into a temporary table. */
function refersToRow(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const n = e as { kind?: string }
  if (n.kind === NODE.COLUMN) return true
  if (n.kind === NODE.CALL && isAggregate(n as Expression)) return true
  if (n.kind === NODE.SUBQUERY) return false
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(refersToRow) : typeof v === 'object' && refersToRow(v)))
}

/** HAVING's bare names that are select-list aliases, replaced by the expressions they name. */
function substituteAliases(e: Expression, items: readonly { readonly expr: Expression; readonly alias?: string }[]): Expression {
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x
    if (Array.isArray(x)) return x.map(walk)
    const node = x as { kind?: string; parts?: readonly string[] }
    if (node.kind === NODE.SUBQUERY) return x
    if (node.kind === NODE.COLUMN && node.parts?.length === 1) {
      const hit = items.find((i) => i.alias?.toLowerCase() === (node.parts?.[0] as string).toLowerCase())
      if (hit !== undefined) return hit.expr
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) out[k] = typeof v === 'object' ? walk(v) : v
    return out
  }
  return walk(e) as Expression
}

/**
 * ONLY_FULL_GROUP_BY: every column a select item or an ORDER BY item reads
 * outside an aggregate must be a key, or be determined by the keys — through
 * a PRIMARY KEY or a NOT NULL UNIQUE key all of whose columns are, or through
 * an equality in the WHERE with a constant or with a column that is (8.4.11,
 * WL#2489). 1055 names the first column that is not; without a GROUP BY the
 * error is 1140.
 */
function checkFullGroupBy(
  lookup: Scope,
  scope: TableScope | undefined,
  keys: readonly { readonly index: number | undefined; readonly text: string }[],
  where: Expression | undefined,
  selectExprs: readonly Expression[],
  orderExprs: readonly Expression[],
  implicit: boolean,
): void {
  const determined = new Set<number>()
  for (const k of keys) if (k.index !== undefined) determined.add(k.index)
  const keyTexts = new Set(keys.filter((k) => k.index === undefined).map((k) => k.text))
  const conjuncts: Expression[] = []
  const flatten = (e: Expression | undefined): void => {
    if (e === undefined) return
    if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) {
      flatten(e.left)
      flatten(e.right)
    } else conjuncts.push(e)
  }
  flatten(where)
  const constant = (e: Expression): boolean => e.kind === NODE.LITERAL ? e.type !== 'null' : e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && constant(e.operand))
  const edges: [number, number][] = []
  for (const c of conjuncts) {
    if (c.kind !== NODE.BINARY || (c.op !== '=' && c.op !== '<=>')) continue
    const l = c.left.kind === NODE.COLUMN ? safeIndex(lookup, c.left.parts) : undefined
    const r = c.right.kind === NODE.COLUMN ? safeIndex(lookup, c.right.parts) : undefined
    if (l !== undefined && r !== undefined) edges.push([l, r], [r, l])
    else if (l !== undefined && constant(c.right)) determined.add(l)
    else if (r !== undefined && constant(c.left)) determined.add(r)
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const [a, b] of edges) {
      if (determined.has(a) && !determined.has(b)) {
        determined.add(b)
        changed = true
      }
    }
    for (const t of scope?.tables ?? []) {
      const offsetOf = (name: string): number => t.offset + t.def.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
      const unique = t.def.indexes.filter((i) => i.kind === 'primary' || (i.kind === 'unique' && i.parts.every((p) => p.prefix === undefined && t.def.columns.find((c) => c.name === p.column)?.nullable === false)))
      if (!unique.some((i) => i.parts.every((p) => determined.has(offsetOf(p.column))))) continue
      for (let i = 0; i < t.def.columns.length; i++) {
        if (!determined.has(t.offset + i)) {
          determined.add(t.offset + i)
          changed = true
        }
      }
    }
  }
  const nameOf = (index: number): string => {
    const t = (scope?.tables ?? []).find((x) => index >= x.offset && index < x.offset + x.def.columns.length)
    return t === undefined ? '?' : `${t.def.schema}.${t.def.name}.${(t.def.columns[index - t.offset] as { name: string }).name}`
  }
  const offending = (e: Expression): number | undefined => {
    if (keyTexts.has(deparse(e))) return undefined
    if (e.kind === NODE.CALL && (isAggregate(e) || e.name.toUpperCase() === 'ANY_VALUE')) return undefined
    if (e.kind === NODE.SUBQUERY) return undefined
    if (e.kind === NODE.COLUMN) {
      const at = safeIndex(lookup, e.parts)
      return at === undefined || determined.has(at) ? undefined : at
    }
    for (const v of Object.values(e)) {
      const children = Array.isArray(v) ? v : [v]
      for (const child of children) {
        if (child === null || typeof child !== 'object' || typeof (child as { kind?: unknown }).kind !== 'string') continue
        const hit = offending(child as Expression)
        if (hit !== undefined) return hit
      }
    }
    return undefined
  }
  selectExprs.forEach((e, i) => {
    const at = offending(e)
    if (at === undefined) return
    if (implicit) throw sqlError('ER_MIX_OF_GROUP_FUNC_AND_FIELDS', `In aggregated query without GROUP BY, expression #${i + 1} of SELECT list contains nonaggregated column '${nameOf(at)}'; this is incompatible with sql_mode=only_full_group_by`)
    throw sqlError('ER_WRONG_FIELD_WITH_GROUP', `Expression #${i + 1} of SELECT list is not in GROUP BY clause and contains nonaggregated column '${nameOf(at)}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`)
  })
  if (implicit) return
  orderExprs.forEach((e, i) => {
    const at = offending(e)
    if (at === undefined) return
    throw sqlError('ER_WRONG_FIELD_WITH_GROUP', `Expression #${i + 1} of ORDER BY clause is not in GROUP BY clause and contains nonaggregated column '${nameOf(at)}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`)
  })
}

/**
 * Whether MySQL runs a `SELECT DISTINCT` without a temporary table: when the
 * select list names a whole key of NOT NULL columns, every row is distinct
 * already; when it is nothing but the leading columns of an index, the index
 * delivers them grouped (8.4.11 reports `SELECT DISTINCT age` with `age`'s own
 * key flags when `age` is indexed, and with GROUP_FLAG when it is not).
 */
function holdsKey(def: TableDef, items: SelectNode['items'], alias: string): boolean {
  const named = new Set<string>()
  let onlyColumns = true
  for (const item of items) {
    const e = item.expr
    if (e.kind !== NODE.COLUMN) {
      onlyColumns = false
      continue
    }
    const last = e.parts[e.parts.length - 1] as string
    if (last === '*' && (e.parts.length === 1 || e.parts[e.parts.length - 2] === alias)) return true
    named.add(last.toLowerCase())
  }
  if (onlyColumns && def.indexes.some((i) => i.parts.length >= named.size && i.parts.slice(0, named.size).every((p) => p.prefix === undefined && named.has(p.column.toLowerCase())))) return true
  return def.indexes.some(
    (i) =>
      (i.kind === 'primary' || (i.kind === 'unique' && i.parts.every((p) => def.columns.find((c) => c.name === p.column)?.nullable === false))) &&
      i.parts.every((p) => p.prefix === undefined && named.has(p.column.toLowerCase())),
  )
}

/**
 * What MySQL's optimizer knows of a one-table WHERE before it reads a row,
 * which decides whether a `SELECT DISTINCT` makes its temporary table and
 * whether the scan runs at all. Each rule is 8.4.11's, probed shape by shape:
 *
 *   - `impossible`: a conjunct folds to false — a NOT NULL column `IS NULL`,
 *     `int_col = 9.5`, or a conjunct of constants that is not
 *     true. Nothing is read, so nothing in the WHERE is evaluated: `WHERE
 *     LAST_INSERT_ID(8) = 8 AND 1 = 0` leaves `LAST_INSERT_ID()` alone.
 *   - `pins`: the columns the WHERE holds to one value, as MySQL's
 *     `check_field_is_const` finds them — `c = 5`, `<=>`, `IN (5)`, `NOT (c <>
 *     5)`; through AND, any conjunct; through OR, every branch, with the same
 *     constant. Two placeholders are two values, whatever they are bound to,
 *     and NULL pins nothing.
 *     A string column against a number pins nothing (`b = 5` holds for `'5'`
 *     and `'5.0'`), and neither does `IS NULL`, on 8.4.
 *   - `constTable`: every part of the primary key or of a UNIQUE key pinned
 *     makes the table a constant one: a row or none. NULL pins nothing, which
 *     matters here: a nullable UNIQUE key holds many NULLs.
 *
 * Folding never evaluates a call, a variable or a subquery, and a placeholder
 * only once it is bound, so planning has no side effects and a prepare sees
 * what the statement says rather than NULLs.
 */
function whereFacts(run: Run, def: TableDef, alias: string, where: Expression | undefined): { impossible: boolean; pins: Set<ColumnDef>; constTable: boolean } {
  const facts = { impossible: false, pins: new Set<ColumnDef>(), constTable: false }
  if (where === undefined) return facts
  const columnOf = (e: Expression): ColumnDef | undefined => {
    if (e.kind !== NODE.COLUMN || e.parts.length > 3 || (e.parts.length >= 2 && e.parts[e.parts.length - 2] !== alias)) return undefined
    const name = (e.parts[e.parts.length - 1] as string).toLowerCase()
    return def.columns.find((c) => c.name.toLowerCase() === name)
  }
  const conjuncts: Expression[] = []
  const flatten = (e: Expression): void => {
    if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) {
      flatten(e.left)
      flatten(e.right)
    } else conjuncts.push(e)
  }
  flatten(where)
  for (const c of conjuncts) {
    if (c.kind === NODE.UNARY && c.op === 'IS NULL' && columnOf(c.operand)?.nullable === false) facts.impossible = true
    else if (neverEqual(c, columnOf)) facts.impossible = true
    else if (foldable(c, run.params !== undefined)) {
      try {
        if (truth(compile(c, compileContext(run, EMPTY_SCOPE, 'where clause')).eval([], run.env)) !== true) facts.impossible = true
      } catch {
        // Not something the optimizer folds; the scan will say.
      }
    }
  }
  for (const column of def.columns) if (pinOf(where, column, columnOf) !== undefined) facts.pins.add(column)
  const named = (n: string): ColumnDef | undefined => def.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())
  facts.constTable = def.indexes.some(
    (i) =>
      i.kind !== 'index' &&
      i.parts.every((p) => {
        const column = named(p.column) as ColumnDef
        return p.prefix === undefined && pinOf(where, column, columnOf) !== undefined
      }),
  )
  return facts
}

/**
 * The constant `cond` holds `column` to, as a key two pins can be compared by,
 * or `undefined` (`check_field_is_const`). A placeholder's key is its own
 * position, so no two are the same.
 */
function pinOf(cond: Expression, column: ColumnDef, columnOf: (e: Expression) => ColumnDef | undefined): string | undefined {
  if (cond.kind === NODE.UNARY && cond.op === 'NOT' && cond.operand.kind === NODE.BINARY && (cond.operand.op === '<>' || cond.operand.op === '!=')) {
    return pinOf({ ...cond.operand, op: '=' }, column, columnOf)
  }
  if (cond.kind !== NODE.BINARY) return undefined
  if (cond.op === 'AND' || cond.op === '&&') return pinOf(cond.left, column, columnOf) ?? pinOf(cond.right, column, columnOf)
  if (cond.op === 'OR' || cond.op === '||') {
    const a = pinOf(cond.left, column, columnOf)
    return a !== undefined && a === pinOf(cond.right, column, columnOf) ? a : undefined
  }
  let value: Expression | undefined
  if (cond.op === 'IN' && cond.right.kind === NODE.ROW && cond.right.items.length === 1 && columnOf(cond.left) === column) value = cond.right.items[0]
  else if (cond.op === '=' || cond.op === '<=>') {
    if (columnOf(cond.left) === column) value = cond.right
    else if (columnOf(cond.right) === column) value = cond.left
  }
  // NULL pins nothing: `c <=> NULL` leaves `c` grouped (8.4.11).
  if (value === undefined || !constant(value) || (value.kind === NODE.LITERAL && value.type === 'null')) return undefined
  if (column.type.collationId !== undefined && numeric(value)) return undefined
  return value.kind === NODE.PLACEHOLDER ? `?${value.at}` : deparse(value)
}

const constant = (e: Expression): boolean => e.kind === NODE.LITERAL || e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && constant(e.operand))
const numeric = (e: Expression): boolean => (e.kind === NODE.LITERAL && (e.type === 'int' || e.type === 'decimal' || e.type === 'double')) || (e.kind === NODE.UNARY && numeric(e.operand))

/**
 * `int_col = 9.5` and `tinyint_col = 300`: an integer column against a
 * number it can never equal, which MySQL folds to false before reading a row
 * (8.4.11 answers `SELECT DISTINCT score FROM p WHERE flag = 9.5` without its
 * temporary table). `c = NULL` is not folded, on 8.4.
 */
function neverEqual(e: Expression, columnOf: (e: Expression) => ColumnDef | undefined): boolean {
  if (e.kind !== NODE.BINARY || e.op !== '=') return false
  const column = columnOf(e.left) ?? columnOf(e.right)
  const other = columnOf(e.left) !== undefined ? e.right : e.left
  if (column === undefined) return false
  const range = integerRange(column.type)
  if (range === undefined) return false
  const negative = other.kind === NODE.UNARY && other.op === '-'
  const literal = negative ? other.operand : other
  if (literal.kind !== NODE.LITERAL) return false
  // A string that is wholly a number is that number here (`flag = '9.5'`).
  const text = String(literal.value).trim()
  const number = literal.type === 'int' || literal.type === 'decimal' || literal.type === 'double' || (literal.type === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text))
  if (!number) return false
  if (!/^[+-]?\d+$/.test(text) && Number(text) % 1 !== 0) return true
  const v = (negative ? -1n : 1n) * (/^[+-]?\d+$/.test(text) ? BigInt(text) : BigInt(Math.trunc(Number(text))))
  return v < range.min || v > range.max
}

/**
 * Whether the optimizer can evaluate an expression before reading a row:
 * literals and operators over them, and placeholders once bound — never a
 * column, a variable, a subquery or a call, any of which may have an effect
 * or depend on the row.
 */
function foldable(e: unknown, bound: boolean): boolean {
  if (e === null || typeof e !== 'object') return true
  const node = e as { kind?: string }
  if (node.kind === NODE.COLUMN || node.kind === NODE.SUBQUERY || node.kind === NODE.VARIABLE || node.kind === NODE.CALL) return false
  if (node.kind === NODE.PLACEHOLDER) return bound
  return Object.values(e).every((v) => (Array.isArray(v) ? v.every((x) => foldable(x, bound)) : typeof v !== 'object' || foldable(v, bound)))
}

/** The rows an access path reads, in its order. */
export function* accessRows(table: Table, def: TableDef, access: Access, trx: Trx | undefined, current: boolean): Generator<ScannedRow> {
  const types = def.columns.map((c) => c.type)
  const mode = current ? 'current' : 'consistent'
  const base = { table, types, mode, ...(trx === undefined ? {} : { trx }), ...(access.index === undefined ? {} : { index: access.index }) } as const
  if (access.ranges === undefined) {
    yield* scan(base)
    return
  }
  for (const range of access.ranges) yield* scan({ ...base, range })
}

function deparseName(e: Expression): string {
  return e.kind === NODE.LITERAL ? String(e.value) : e.kind
}

/** An `ORDER BY` item: a position in the select list, a select-list alias, or an expression over the table. */
function orderKey(run: Run, o: OrderItem, items: readonly { name: string; compiled: Compiled; alias?: string }[], scope: Scope): SortKey {
  const e = o.expr
  const desc = o.desc === true
  if (e.kind === NODE.LITERAL && e.type === 'int') {
    const n = Number(e.value as bigint)
    const item = items[n - 1]
    if (item === undefined) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(String(n), 'order clause'))
    return { expr: item.compiled, desc }
  }
  if (e.kind === NODE.COLUMN && e.parts.length === 1) {
    const name = (e.parts[0] as string).toLowerCase()
    const alias = items.find((i) => i.alias?.toLowerCase() === name)
    if (alias !== undefined) return { expr: alias.compiled, desc }
  }
  return { expr: compile(e, compileContext(run, scope, 'order clause')), desc }
}

/**
 * A `LIMIT` operand: a non-negative integer literal, or `?`. A bound `?` takes
 * what 8.4.11 takes — an integer, a whole double, or a string read as an
 * integer (`'x'` is 0 rows) — and a fractional double is ER_WRONG_ARGUMENTS
 * naming `mysqld_stmt_execute`, as the server words it.
 */
export function limitValue(run: Run, e: Expression, what: string): number {
  if (e.kind === NODE.PLACEHOLDER && run.params === undefined) return 0
  const v = compile(e, compileContext(run, EMPTY_SCOPE, what)).eval([], run.env)
  const where = e.kind === NODE.PLACEHOLDER ? 'mysqld_stmt_execute' : what
  if (v === null || (v.kind === 'double' && !Number.isInteger(v.v)) || v.kind === 'decimal' || v.kind === 'datetime' || v.kind === 'time') {
    throw sqlError('ER_WRONG_ARGUMENTS', `Incorrect arguments to ${where}`)
  }
  const n = toInteger(v)
  if (n < 0n) throw sqlError('ER_WRONG_ARGUMENTS', `Incorrect arguments to ${where}`)
  return n > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(n)
}

/** The statement's column definitions, for its resultset and for `COM_STMT_PREPARE`. */
export function columnsOf(run: Run, plan: SelectPlan): ColumnDefinition[] {
  return plan.columns.map((c) => columnDefinition(c.name, c.type, run.env.session.characterSet))
}

/** Run a planned SELECT in `trx`, materialising its rows for the wire. */
export function resultSet(run: Run, plan: SelectPlan, trx: Trx | undefined): ResultSet {
  const columns = columnsOf(run, plan)
  const rows: RowValue[][] = []
  const types = plan.columns.map((c) => c.type)
  for (const values of plan.rows(trx)) rows.push(values.map((v, i) => toWire(v, types[i] as ResultType, run.protocol, run.env.session)))
  return { columns, rows }
}
