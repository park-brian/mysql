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
import type { ColumnDef, Table, TableDef, ViewDef } from '@myjs/engine'
import { NODE, QUERY, REF, TOKEN, deparse, lex, parseStatement, type Expression, type OrderItem, type QueryBody, type QueryExpression, type SelectNode, type SetOperationNode, type TableName, type Token } from '@myjs/parser'
import { messages, sqlError, type ColumnDefinition, type ResultSet, type RowValue } from '@myjs/protocol'
import { intValue, toInteger, truth, withoutHex, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type CompileContext, type Compiled, type Env, type GroupKeys, type Scope, type SubqueryPlan } from './compile.ts'
import { AggregateSink, chooseStrategy, containsAggregate, groupRows, isAggregate } from './group.ts'
import { WindowSink, applyWindows, containsWindow } from './window.ts'
import { columnDefinition, intType, type ResultType } from './meta.ts'
import { expectTyped } from '@myjs/bytes'
import { distinct, filter, limit, project, sort, type SortKey } from './operators.ts'
import { isConstant, splitAnd } from './plan.ts'
import { TableScope } from './scope.ts'
import { planFrom, type DerivedPlan, type DerivedSource, type FromContext, type FromPlan, type JoinCondition } from './from.ts'
import { rowKey } from './keys.ts'
import { planNode, wrap, type PlanNode } from './explain.ts'
import { describeStages, runStages, type Rowed, type Stage } from './pipeline.ts'
import { convert as convertSetValue, nestedNullability, setOperation, setOperationType } from './setop.ts'
import { constTablesHaveRows, neverEqual, optimizerFacts } from './optimize.ts'
import { informationSchemaTable } from './information-schema.ts'
import { statisticsOf } from './stats.ts'
import type { SqlSession } from './session.ts'
import { toWire, type WireProtocol } from './wire.ts'
import type { Trx } from '@myjs/engine'
import { isTemporary, type CatalogApi } from './temporary.ts'
import { modeOf } from './mode.ts'
import { finish } from './session.ts'

/** Everything one statement execution needs. */
export interface Run {
  readonly catalog: CatalogApi | undefined
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
  /** The enclosing query's scope, where a subquery's correlated names resolve (M5.1). */
  readonly parent?: Scope
  /** The common table expressions in scope, by name. */
  readonly ctes?: ReadonlyMap<string, () => DerivedSource>
  /**
   * The database an unqualified table name is in, when it is not the
   * session's: inside a view, the one that was current at its CREATE VIEW.
   */
  readonly database?: string | null
  /** The views being expanded, outermost first, as `schema.name`: one met again is 1146. */
  readonly views?: readonly string[]
  /** The subqueries the SELECT being planned compiles, each with the clause it is in: what its EXPLAIN prints beside it. */
  readonly subqueries?: { readonly clause: string; readonly query: QueryExpression; readonly plan: SelectPlan }[]
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
    subquery: (q, outer) => {
      const plan = planSubquery(run, q, outer)
      run.subqueries?.push({ clause, query: q, plan: plan.plan })
      return plan
    },
    table: (schema, name) => run.catalog?.table(schema, name),
    ...(run.env.conditions === undefined ? {} : { conditions: run.env.conditions }),
    sql: run.sql,
  }
}

/** What planning a FROM needs from the statement: its tables, and a compiler for ON clauses. */
export function fromContext(run: Run): FromContext {
  return {
    open: (name, alias) => openTable(run, name, alias),
    compileOn: (e, scope) => compile(e, compileContext(run, scope, 'on clause')),
    env: run.env,
    ...(run.catalog === undefined ? {} : { statistics: (def: TableDef, table: Table) => statisticsOf(def, table, (run.catalog as CatalogApi).store) }),
    derived: (ref, lateral) => derivedTable(run, ref.query, ref.alias as string, ref.columns, lateral),
    cte: (name) => run.ctes?.get(name)?.(),
    view: (name, alias) => viewTable(run, name, alias),
    system: (name, alias) => informationSchemaTable(run, name, alias, defaultDatabase(run)),
    ...(run.parent === undefined ? {} : { parent: run.parent }),
  }
}

/** A table a statement names, opened: ER_NO_DB_ERROR with no schema, ER_NO_SUCH_TABLE with no table. */
export function openTable(run: Run, name: TableName, alias = name.name): { readonly schema: string; readonly def: TableDef; readonly table: Table } {
  const schema = name.schema ?? defaultDatabase(run)
  if (schema === null || schema === undefined) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
  // M5.12: refused by name until its tables exist, never answered as a missing table.
  if (schema.toLowerCase() === 'information_schema') throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('INFORMATION_SCHEMA'))
  if (run.catalog === undefined) throw sqlError('ER_NO_SUCH_TABLE', messages.noSuchTable(schema, name.name))
  const def = run.catalog.definition(schema, name.name)
  // A temporary table is opened once a statement: a second reference to it is 1137, naming the first (8.4.11).
  if (isTemporary(def)) {
    let opened = run.env.memo?.get(OPENED) as Map<string, { readonly at: TableName; readonly alias: string }> | undefined
    if (opened === undefined) {
      opened = new Map()
      run.env.memo?.set(OPENED, opened)
    }
    const key = `${schema}\0${name.name}`
    const first = opened.get(key)
    if (first !== undefined && first.at !== name) throw sqlError('ER_CANT_REOPEN_TABLE', `Can't reopen table: '${first.alias}'`)
    opened.set(key, { at: name, alias })
  }
  return { schema, def, table: run.catalog.table(schema, name.name) }
}

/** The statement's memo entry for the temporary tables it has opened. */
const OPENED = Symbol('temporary tables opened')

const defaultDatabase = (run: Run): string | null => (run.database === undefined ? run.env.session.database : run.database)

/** A view met again inside itself: its 1146 is the statement's, through every view between. */
const recursion = new WeakSet<object>()

/** The errors that mean a view's query no longer resolves: 1356 in its place (8.4.11). */
const INVALID_VIEW = new Set([1054, 1146, 1305, 1353])

/**
 * A view, planned for one reference to it, as a derived table whose query is
 * its stored text: parsed again, in the database that was current when it was
 * made, with nothing of the statement around it in scope — no CTE, no
 * enclosing query, no parameter. A query that no longer resolves is 1356; a
 * view that names itself, by any path, is 1146 on its own name, as it is when
 * CREATE VIEW meets it.
 */
export function viewTable(run: Run, name: TableName, alias: string, given?: ViewDef): { schema: string; source: DerivedSource } | undefined {
  const schema = name.schema ?? defaultDatabase(run)
  if (schema === null || schema === undefined || run.catalog === undefined) return undefined
  const view = given ?? run.catalog.view(schema, name.name)
  if (view === undefined) return undefined
  const path = `${schema}.${view.name}`
  if (run.views?.includes(path) === true && given === undefined) {
    const e = sqlError('ER_NO_SUCH_TABLE', messages.noSuchTable(schema, view.name))
    recursion.add(e)
    throw e
  }
  const query = parseStatement(view.query) as QueryExpression
  const inner: Run = {
    catalog: run.catalog,
    state: run.state,
    env: run.env,
    sql: view.query,
    protocol: run.protocol,
    serverVersion: run.serverVersion,
    ...(run.preparing === true ? { preparing: true } : {}),
    database: view.database ?? null,
    views: [...(run.views ?? []), path],
  }
  try {
    return { schema, source: derivedTable(inner, query, alias, view.columns, undefined, view) }
  } catch (e) {
    // Only once it is stored: CREATE VIEW reports the error itself.
    if (given === undefined && !recursion.has(e as object) && INVALID_VIEW.has((e as { errno?: number }).errno ?? 0)) {
      throw sqlError('ER_VIEW_INVALID', `View '${schema}.${view.name}' references invalid table(s) or column(s) or function(s) or definer/invoker of view lack rights to use them`)
    }
    throw e
  }
}

/**
 * A view's stored query, planned as its CREATE resolved it, for what its
 * columns are made of: INFORMATION_SCHEMA.COLUMNS lists a view's columns with
 * the types and the base columns behind them (M5.12).
 */
export function planViewQuery(run: Run, view: ViewDef): { query: QueryExpression; plan: SelectPlan } {
  const query = parseStatement(view.query) as QueryExpression
  const inner: Run = { catalog: run.catalog, state: run.state, env: run.env, sql: view.query, protocol: run.protocol, serverVersion: run.serverVersion, preparing: true, database: view.database ?? null, views: [`${view.schema}.${view.name}`] }
  return { query, plan: planQuery(inner, query) }
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
    tokens = lex(run.sql, { sqlMode: modeOf(run.env.session.sqlMode) })
  } catch (e) {
    expectTyped(e)
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
    const end = t === undefined || t.kind === TOKEN.EOF || (depth === 0 && (CLAUSE_WORDS.has(word(t)) || t.text === ';' || (t.kind === TOKEN.OPERATOR && t.text === ')')))
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
  /**
   * The rows, as values. Runs the scan: call inside the statement's
   * transaction. `env` is the statement's unless a correlated subquery
   * passes its own, carrying the outer row.
   */
  rows(trx: Trx | undefined, env?: Env): Iterable<Value[]>
  /** `FOR UPDATE` / `FOR SHARE`: the read takes the writer slot. */
  readonly locking: boolean
  /**
   * A set operation's SELECTs' column types, in order: an enclosing set
   * operation types its columns over these, not over this one's (8.4.11).
   */
  readonly leaves?: readonly (readonly ResultType[])[]
  /**
   * The columns as the statement's execution reports them, when that depends
   * on data the optimizer reads while planning — a const table's row, whose
   * absence makes the result empty and its metadata unmaterialized (M5.4).
   */
  columnsAt?(trx: Trx | undefined): readonly { readonly name: string; readonly type: ResultType }[]
  /**
   * The plan as 8.4.11's iterators (M5.44): the tree, then each subquery's,
   * as EXPLAIN FORMAT=TREE prints them. Absent where the plan is not yet
   * described, which EXPLAIN refuses. `materialized`: a sort or a limit
   * reads it from a table, so a UNION ALL is no longer streamed (Append).
   */
  explain?(materialized?: boolean): readonly PlanNode[] | undefined
  /** A set operation's branches, for an enclosing one of the same operator to flatten into its own. */
  readonly members?: SetMembers
}

/** One set operator's branches, flattened as 8.4.11 flattens a chain of it: each with whether it joined the chain with ALL. */
interface SetMembers {
  readonly op: SetOperationNode['op']
  readonly items: readonly { readonly node: PlanNode; readonly all: boolean }[]
}

/**
 * Any query: a SELECT, a parenthesised query with its own ORDER BY and
 * LIMIT, or a set operation, under the CTEs its WITH defines.
 */
export function planQuery(run: Run, q: QueryExpression): SelectPlan {
  if (q.into !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('SELECT … INTO'))
  const r = q.with === undefined ? run : withClause(run, q.with)
  const body = q.body
  switch (body.kind) {
    case QUERY.SELECT:
      return planSelect({ ...r, subqueries: [] }, q, body)
    case QUERY.QUERY:
      if (q.orderBy === undefined && q.limit === undefined) return planQuery(r, body)
      return orderedResult(r, q, planQuery(r, body))
    case QUERY.SET_OPERATION:
      return orderedResult(r, q, planSetOperation(r, body))
    default:
      throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(body.kind.toUpperCase()))
  }
}

function planSelect(run: Run, q: QueryExpression, node: SelectNode): SelectPlan {

  // FROM: nothing, `DUAL`, or tables joined (M5.4).
  const refs = (node.from ?? []).filter((r) => !(r.kind === REF.TABLE && r.table.schema === undefined && r.table.name.toLowerCase() === 'dual' && r.alias === undefined && (node.from ?? []).length === 1))
  const from = refs.length === 0 ? undefined : planFrom(refs, fromContext(run), node.where, (node.options ?? []).includes('STRAIGHT_JOIN'))
  const scope = from?.scope
  const source = from?.single
  const lookup: Scope = scope ?? run.parent ?? EMPTY_SCOPE
  if (from !== undefined && scope !== undefined) from.reads(columnsRead(scope, node, q))

  // An aggregate anywhere in the select list or HAVING makes the query a
  // grouped one, even with no GROUP BY; one in ORDER BY alone does not, and
  // is 3029 (8.4.11).
  const grouped = node.groupBy !== undefined || node.items.some((i) => containsAggregate(i.expr)) || (node.having !== undefined && containsAggregate(node.having))
  if (!grouped && (q.orderBy ?? []).some((o) => containsAggregate(o.expr))) {
    const at = (q.orderBy ?? []).findIndex((o) => containsAggregate(o.expr)) + 1
    throw sqlError('ER_AGGREGATE_ORDER_NON_AGG_QUERY', `Expression #${at} of ORDER BY contains aggregate function and applies to the result of a non-aggregated query`)
  }
  const windowed = node.items.some((i) => containsWindow(i.expr)) || (q.orderBy ?? []).some((o) => containsWindow(o.expr))
  if (grouped) return planGrouped(run, q, node, from, lookup, windowed)
  // Window functions (M5.6) write into slots past the FROM row.
  const windowBase = from?.width ?? 0
  const windows = windowed ? new WindowSink(compileContext(run, lookup, 'window order by'), windowBase, node.windows) : undefined

  // The select list, `*` expanded. A table a correlated, aggregating scalar
  // subquery in it reads is reported nullable there (8.4.11: `SELECT a.x,
  // (SELECT MAX(b.id) FROM b WHERE b.id = a.id) FROM a` drops `a.x`'s
  // NOT_NULL, the same without the MAX does not).
  const nullableTables = scope === undefined ? new Set<string>() : aggregatingSubqueryTables(node, scope)
  const selectScope: Scope = nullableTables.size === 0 || scope === undefined ? lookup : nullableView(scope, nullableTables)
  const texts = itemTexts(run, node)
  const items: { name: string; compiled: Compiled; alias?: string; expr?: Expression }[] = []
  node.items.forEach((item, i) => {
    const e = item.expr
    if (e.kind === NODE.COLUMN && e.parts[e.parts.length - 1] === '*') {
      if (scope === undefined) throw sqlError('ER_NO_TABLES_USED', 'No tables used')
      const table = e.parts.length >= 2 ? e.parts[e.parts.length - 2] : undefined
      for (const s of scope.star(table)) items.push({ name: s.name, compiled: { eval: (row) => row[s.index] ?? null, type: nullableTables.has(scope.columnAt(s.index)?.table.alias ?? '') ? { ...s.type, nullable: true } : s.type }, expr: { kind: NODE.COLUMN, parts: [scope.columnAt(s.index)?.table.alias as string, s.name], at: e.at } })
      return
    }
    const compiled = compile(e, { ...compileContext(run, selectScope, 'field list'), ...(windows === undefined ? {} : { windows }) })
    items.push({ name: sourceName(scope, item, itemName(item, texts[i])), compiled, expr: e, ...(item.alias === undefined ? {} : { alias: item.alias }) })
  })
  // Read through the windows' temporary table: every column a field of it (8.4.11: `id` loses PRI).
  if (windows !== undefined && windows.windows.length > 0) {
    for (const item of items) if (item.compiled.type.temporary === undefined) item.compiled = { ...item.compiled, type: { ...item.compiled.type, temporary: 'stream' } }
  }

  // `SELECT DISTINCT` is run through a temporary table — which changes the
  // metadata a client sees — unless the select list holds a whole key of NOT
  // NULL columns, in which case every row is distinct already and MySQL drops
  // the DISTINCT.
  let dataColumns: ((trx: Trx | undefined) => readonly ResultType[]) | undefined
  // What runs through a temporary table, as the metadata rules below decide: EXPLAIN shows the same.
  let deduplicated = false
  let streamed = false
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
      deduplicated = true
      // A constant is not copied into the table: `SELECT DISTINCT NULL, x`
      // reports its NULL as it always does (8.4.11).
      for (const item of items) {
        if (item.expr !== undefined && !refersToRow(item.expr, lookup)) continue
        // Read through a window's table already, a column keeps what that gives it (8.4.11).
        if (item.compiled.type.temporary === 'stream') continue
        item.compiled = { ...item.compiled, type: { ...item.compiled.type, temporary: pinnedName(item) ? 'pinned' : true } }
      }
    }
  } else if (from !== undefined && scope !== undefined && run.preparing !== true && (source === undefined || semijoinSubqueries(node.where).length > 0 || (q.orderBy !== undefined && node.items.some((i) => correlatedIn(i.expr, scope)))) && (node.distinct === true || (q.orderBy ?? []).length > 0)) {
    // Over a join, a DISTINCT is a temporary table and a sort reads the join's
    // rows streamed into one ("Stream results"): every item that reads the row
    // is copied, a column losing its key flags without gaining GROUP_FLAG, an
    // expression keeping only NOT_NULL (8.4.11, M5.18's corpus) — unless the
    // optimizer proved the result empty, when there is no table at all.
    const facts = optimizerFacts(from, node.where, limitCount, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, (node.options ?? []).includes('STRAIGHT_JOIN'))
    // A sort over the first table alone, ahead of nested-loop joins or a
    // nested-loop semijoin, needs no stream.
    // An ORDER BY on columns the WHERE holds to constants orders nothing, and
    // MySQL drops it before it plans a sort (8.4.11: `WHERE SCHEMA_NAME = ?
    // ORDER BY SCHEMA_NAME` over INFORMATION_SCHEMA's join streams nothing).
    const constantOrder = node.distinct !== true && (q.orderBy ?? []).every((o) => o.expr.kind === NODE.COLUMN && pinnedByWhere(node.where, o.expr.parts))
    const sortedFirst = constantOrder || (node.distinct !== true && (source === undefined ? from.sortsFirst(orderAliases(q, items, lookup)) : nestedLoopSemijoin(node.where, scope) && !node.items.some((i) => correlatedIn(i.expr, scope))))
    if (!facts.empty && !sortedFirst) {
      if (node.distinct === true) deduplicated = true
      else streamed = true
      const consts = new Set(facts.constTables.map((t) => t.alias))
      const fixed = new Set([...consts, ...(facts.nullTables ?? [])])
      const own = items.map((i) => i.compiled.type)
      // With every other table a constant, a DISTINCT is one table's, and its
      // temporary table is keyed as one table's is: GROUP_FLAG on what can be
      // NULL (8.4.11: `SELECT DISTINCT b.nl, a.x FROM a LEFT JOIN b ON FALSE`).
      const alone = node.distinct === true && source === undefined && from.tables.filter((t) => !fixed.has(t.alias)).length === 1
      items.forEach((item) => {
        if (item.expr !== undefined && !refersToRow(item.expr, lookup, consts)) return
        const temporary = !alone ? 'stream' : item.expr === undefined || refersToRow(item.expr, lookup, fixed) ? true : 'pinned'
        item.compiled = { ...item.compiled, type: { ...item.compiled.type, temporary } }
      })
      if (facts.constTables.length > 0) {
        const materialized = items.map((i) => i.compiled.type)
        dataColumns = (trx) => (constTablesHaveRows(facts, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, trx) ? materialized : own)
      }
    }
  }

  // The WHERE, compiled where MySQL resolves it, after the select list: a FROM
  // applies it itself, each condition at its iterator (M5.43).
  const whereCtx = compileContext(run, lookup, 'where clause')
  let where: Compiled | undefined
  if (from !== undefined) {
    // [NOT] EXISTS over one indexed equality is a nested loop: the subquery probed for each row, in the outer table's order.
    const semijoins = scope !== undefined && source !== undefined && nestedLoopSemijoin(node.where, scope)
    from.filter(node.where, (e) => compile(e, whereCtx), semijoins ? (e) => semijoinNode(run, e) : undefined)
  } else if (node.where !== undefined) where = compile(node.where, whereCtx)
  const having = node.having === undefined ? undefined : compile(substituteAliases(node.having, items), compileContext(run, selectedOnly(lookup, items, [], node.having), 'having clause'))
  const keys = (q.orderBy ?? []).map((o) => orderKey(run, o, items, lookup, windows))
  // A window ORDER BY alone names reads the rows through its table as well.
  if (windows !== undefined && windows.windows.length > 0) {
    for (const item of items) if (item.compiled.type.temporary === undefined) item.compiled = { ...item.compiled, type: { ...item.compiled.type, temporary: 'stream' } }
  }
  // A MATCH in the WHERE of one table is read through its full-text index,
  // which yields rows by relevance, highest first: with no ORDER BY of its
  // own that is the order they come in (8.4.11, M5.26).
  const match = keys.length === 0 && refs.length === 1 && refs[0]?.kind === REF.TABLE ? matchConjunct(node.where) : undefined
  if (match !== undefined) keys.push({ expr: compile(match, compileContext(run, lookup, 'where clause')), desc: true })
  const locking = (q.locking ?? []).length > 0
  // An ORDER BY the index the table is read by already gives: read in its order, and nothing to sort.
  const read = source !== undefined && from !== undefined ? from.access(run.env) : undefined
  // Not under windows, which reorder the rows before the ORDER BY sorts them.
  const ordered = source !== undefined && read !== undefined && !deduplicated && !windowed && match === undefined && keys.length > 0 && read.ranges === undefined ? orderingIndex(source.def, source.alias, q.orderBy ?? [], items, lookup, read.index) : undefined
  if (ordered !== undefined) from?.readInOrder(ordered, false, (q.orderBy ?? [])[0]?.desc === true)

  const stages: Stage[] = [
    ...(where === undefined ? [] : [filterStage(where)]),
    // HAVING without grouping filters the rows WHERE kept, before any window sees them.
    ...(having === undefined ? [] : [{ ...filterStage(having), describe: (n: PlanNode) => withSubqueries(run, planNode('Filter', [n]), 'having clause') }]),
    ...(windows === undefined || windows.windows.length === 0 ? [] : [windowStage(windows, windowBase)]),
    deliverStage(items.map((i) => i.compiled), ordered === undefined ? keys : [], node.distinct === true, { deduplicated, streamed, keep: limitCount === undefined ? undefined : offset + limitCount }),
    ...(limitCount === undefined && offset === 0 ? [] : [limitStage(offset, limitCount)]),
  ]
  return {
    columns: items.map((i) => ({ name: i.name, type: i.compiled.type })),
    locking,
    ...(dataColumns === undefined ? {} : { columnsAt: (trx: Trx | undefined) => (dataColumns as (t: Trx | undefined) => readonly ResultType[])(trx).map((type, i) => ({ name: (items[i] as { name: string }).name, type })) }),
    explain() {
      // An empty result the optimizer proves is no plan at all.
      if (facts?.impossible === true || provedEmpty(run, from, node, limitCount)) return [planNode('Zero rows')]
      const source = from === undefined ? planNode('Rows fetched before execution') : withSubqueries(run, from.explain(run.env), 'where clause')
      const n = describeStages(source, stages)
      return n === undefined ? undefined : [n, ...subqueryNodes(run, 'field list')]
    },
    rows(trx, given) {
      const env = given ?? { ...run.env, ...(trx === undefined ? {} : { trx }) }
      let rows: Iterable<Rowed>
      if (from === undefined) rows = [{ row: [] }]
      else if (facts?.impossible === true) rows = []
      else rows = from.rows(trx, env, { locking })
      return values(runStages(rows, stages, env))
    },
  }
}

// --- the stages above the FROM (M5.43) -----------------------------------------------

/** A condition over the rows: a Filter. */
function filterStage(condition: Compiled): Stage {
  return { run: (rows, env) => filter(rows, condition, env), describe: (n) => planNode('Filter', [n]) }
}

/** Window functions (M5.6), over the whole input: not yet named as 8.4.11 names them, so not explained. */
function windowStage(windows: WindowSink, base: number): Stage {
  return {
    run(rows, env) {
      const width = base + windows.windows.length
      const all = [...rows].map(({ row }) => {
        const r = row.slice() as Value[]
        while (r.length < width) r.push(null)
        return r
      })
      return applyWindows(all, windows.windows, env, base).map((row) => ({ row }))
    },
    describe: () => undefined,
  }
}

/**
 * ORDER BY, the select list and DISTINCT, as one iterator. The server writes
 * DISTINCT's rows into a temporary table and sorts that; here the rows are
 * sorted, projected and then de-duplicated, which keeps the same rows in the
 * same order, since duplicates are identical. A sort over a join reads its
 * rows streamed into a table first ("Stream results").
 */
function deliverStage(items: readonly Compiled[], keys: readonly SortKey[], unique: boolean, through: { readonly deduplicated: boolean; readonly streamed: boolean; readonly described?: boolean; readonly keep?: number | undefined }): Stage {
  // A LIMIT needs only its first rows of the order, unless a DISTINCT between would drop some.
  const keep = unique ? undefined : through.keep
  return {
    run(rows, env) {
      const sorted = keys.length > 0 ? sort(rows, keys, env, keep) : rows
      const projected = project(sorted, items, env)
      return rowed(unique ? distinct(projected) : projected)
    },
    describe(n) {
      if (through.described === false) return undefined
      let out = through.deduplicated ? planNode('Table scan on <temporary>', [planNode('Temporary table with deduplication', [n])]) : n
      if (keys.length > 0) out = planNode('Sort', [wrap(through.streamed, 'Stream results', out)])
      return out
    },
  }
}

/** LIMIT and OFFSET. */
function limitStage(offset: number, count: number | undefined): Stage {
  return {
    run: (rows) => rowed(limit(values(rows), offset, count)),
    describe: (n) => planNode(offset > 0 ? 'Limit/Offset' : 'Limit', [n]),
  }
}

function* rowed(rows: Iterable<Value[]>): Generator<Rowed> {
  for (const row of rows) yield { row }
}

function* values(rows: Iterable<Rowed>): Generator<Value[]> {
  for (const { row } of rows) yield row as Value[]
}

// --- what MySQL's plan reads, and how ----------------------------------------------

/**
 * The subqueries a clause compiled, as EXPLAIN prints them: `Select #n` over
 * the subquery's own plan, `n` the query block's number, which the server
 * gives each SELECT in the order the statement's text has them.
 */
function subqueryNodes(run: Run, clause: string): PlanNode[] {
  const out: PlanNode[] = []
  // A clause may be compiled more than once (its metadata, then its rows): each subquery is one block.
  const seen = new Set<QueryExpression>()
  for (const s of run.subqueries ?? []) {
    if (s.clause !== clause || seen.has(s.query)) continue
    seen.add(s.query)
    const roots = s.plan.explain?.()
    out.push(planNode(`Select #${selectNumber(run, s.query)}`, roots === undefined ? [] : [...roots]))
  }
  return out
}

/**
 * A WHERE's EXISTS or NOT EXISTS conjunct as the join 8.4.11 makes of it:
 * the join, with the subquery's plan as its inner side; the outer side is
 * the Filter's input (`filterOp`). `undefined` for any other conjunct.
 */
function semijoinNode(run: Run, e: Expression): PlanNode | undefined {
  const anti = e.kind === NODE.UNARY && e.op === 'NOT' && e.operand.kind === NODE.UNARY && e.operand.op === 'EXISTS'
  if (!anti && !(e.kind === NODE.UNARY && e.op === 'EXISTS')) return undefined
  const query = semijoinSubqueries(e)[0]
  const sub = (run.subqueries ?? []).find((s) => s.query === query)?.plan.explain?.()?.[0]
  return sub === undefined ? undefined : planNode(anti ? 'Nested loop antijoin' : 'Nested loop semijoin', [sub])
}

/** A Filter with a clause's subqueries beside its input, as the server lists them; anything else as it is. */
function withSubqueries(run: Run, n: PlanNode, clause: string): PlanNode {
  const subs = subqueryNodes(run, clause)
  return subs.length === 0 || n.label !== 'Filter' ? n : { ...n, children: [...n.children, ...subs] }
}

/** A query block's number: how many SELECTs the statement's text has up to its own. */
function selectNumber(run: Run, q: QueryExpression): number {
  let body: QueryBody = q.body
  while (body.kind === QUERY.QUERY) body = body.body
  const at = body.kind === QUERY.SELECT ? body.at : q.at
  try {
    return lex(run.sql, { sqlMode: modeOf(run.env.session.sqlMode) }).filter((t) => t.start <= at && t.kind === TOKEN.IDENTIFIER && t.quoted !== true && t.text.toUpperCase() === 'SELECT').length
  } catch (e) {
    expectTyped(e)
    return 0
  }
}

/** Whether the optimizer proves the result empty — an impossible condition, a join that cannot match, LIMIT 0 — and plans nothing. */
function provedEmpty(run: Run, from: FromPlan | undefined, node: SelectNode, limitCount: number | undefined): boolean {
  if (limitCount === 0) return true
  if (from === undefined) return false
  return optimizerFacts(from, node.where, limitCount, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, (node.options ?? []).includes('STRAIGHT_JOIN')).empty
}

/**
 * The index a table read whole is read by — its covering index, else its
 * clustered one — when an ORDER BY is one direction over a prefix of that
 * index's key, which for a secondary index ends with the clustered key it
 * carries; or the whole key and more, since nothing after a unique key orders
 * anything. 8.4.11 reads the index in that order and sorts nothing ("Index
 * scan on t using PRIMARY", "Covering index scan on t using name").
 */
function orderingIndex(def: TableDef, alias: string, order: readonly OrderItem[], items: readonly { compiled: Compiled; expr?: Expression }[], scope: Scope, readBy: string | undefined): string | undefined {
  const clustered = def.indexes.find((i) => i.kind === 'primary' || i.name === def.clustered)
  const index = readBy === undefined ? clustered : def.indexes.find((i) => i.name === readBy)
  if (index === undefined || clustered === undefined || order.length === 0) return undefined
  const desc = order[0]?.desc === true
  const names: string[] = []
  for (const o of order) {
    if ((o.desc === true) !== desc) return undefined
    let e: Expression | undefined = o.expr
    if (e.kind === NODE.LITERAL && e.type === 'int') e = items[Number(e.value as bigint) - 1]?.expr
    if (e === undefined || e.kind !== NODE.COLUMN) return undefined
    let name: string | undefined
    try {
      const r = scope.resolve(e.parts, 'order clause')
      const column = r.type.column
      name = r.depth === undefined && column !== undefined && column.table === alias ? column.orgName : undefined
    } catch (err) {
      expectTyped(err)
    }
    if (name === undefined) return undefined
    names.push(name.toLowerCase())
  }
  const own = index.parts.map((p) => p.column.toLowerCase())
  const parts = index === clustered ? own : [...own, ...clustered.parts.map((p) => p.column.toLowerCase()).filter((c) => !own.includes(c))]
  const covered = names.length <= parts.length ? names.every((n, i) => n === parts[i]) : parts.every((p, i) => p === names[i])
  return covered ? index.name : undefined
}

/** The WHERE's IN and EXISTS subqueries MySQL runs as semijoins (NOT EXISTS, antijoins), each with the subquery. */
function semijoinSubqueries(where: Expression | undefined): QueryExpression[] {
  if (where === undefined) return []
  if (where.kind === NODE.BINARY && (where.op === 'AND' || where.op === '&&')) return [...semijoinSubqueries(where.left), ...semijoinSubqueries(where.right)]
  if (where.kind === NODE.BINARY && where.op === 'IN' && where.right.kind === NODE.SUBQUERY) return [where.right.query]
  if (where.kind === NODE.UNARY && where.op === 'EXISTS' && where.operand.kind === NODE.SUBQUERY) return [where.operand.query]
  if (where.kind === NODE.UNARY && where.op === 'NOT' && where.operand.kind === NODE.UNARY && where.operand.op === 'EXISTS' && where.operand.operand.kind === NODE.SUBQUERY) return [where.operand.operand.query]
  return []
}

/**
 * Whether every semijoin is a nested loop over an index: an EXISTS whose only
 * condition is its own indexed column equal to an outer column (8.4.11:
 * "Nested loop antijoin / Covering index lookup on ch using pa_id"). Then a
 * sort on the outer table goes first, and nothing is streamed; anything more
 * in the condition makes it a hash join, and the rows are.
 */
function nestedLoopSemijoin(where: Expression | undefined, scope: TableScope): boolean {
  const subqueries = semijoinSubqueries(where)
  if (subqueries.length === 0 || (where?.kind === NODE.BINARY && where.op === 'IN')) return false
  return subqueries.every((q) => {
    const body = q.body
    if (body.kind !== QUERY.SELECT || (body.from ?? []).length !== 1) return false
    const ref = body.from?.[0]
    const w = body.where
    if (ref === undefined || ref.kind !== REF.TABLE || w === undefined || w.kind !== NODE.BINARY || w.op !== '=') return false
    const innerAlias = ref.alias ?? ref.table.name
    const sides = [w.left, w.right]
    const outer = sides.some((e) => e.kind === NODE.COLUMN && e.parts.length >= 2 && e.parts[e.parts.length - 2] !== innerAlias && scope.tables.some((t) => t.alias === e.parts[e.parts.length - 2]))
    const inner = sides.find((e) => e.kind === NODE.COLUMN && e.parts.length >= 2 && e.parts[e.parts.length - 2] === innerAlias)
    if (!outer || inner === undefined || inner.kind !== NODE.COLUMN) return false
    return true
  })
}

/** Whether `e` holds a subquery that reads a column of `scope`'s tables by a qualified name: a correlated one. */
function correlatedIn(e: unknown, scope: TableScope): boolean {
  if (e === null || typeof e !== 'object') return false
  const n = e as { kind?: string; query?: QueryExpression }
  if (n.kind === NODE.SUBQUERY && n.query !== undefined) return readsOuter(n.query, new Set(scope.tables.map((t) => t.alias)))
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some((x) => correlatedIn(x, scope)) : typeof v === 'object' && correlatedIn(v, scope)))
}

/** Whether a query names, by qualifier, one of `aliases` that its own FROM does not define. */
function readsOuter(q: unknown, aliases: ReadonlySet<string>): boolean {
  const own = new Set<string>()
  const collect = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    const n = x as { kind?: string; alias?: string; table?: TableName }
    if (n.kind === REF.TABLE) own.add(n.alias ?? n.table?.name ?? '')
    if (n.kind === REF.DERIVED && n.alias !== undefined) own.add(n.alias)
    for (const v of Object.values(x)) if (typeof v === 'object') Array.isArray(v) ? v.forEach(collect) : collect(v)
  }
  collect(q)
  const visit = (x: unknown): boolean => {
    if (x === null || typeof x !== 'object') return false
    const n = x as { kind?: string; parts?: readonly string[] }
    if (n.kind === NODE.COLUMN && n.parts !== undefined && n.parts.length >= 2) {
      const qualifier = n.parts[n.parts.length - 2] as string
      if (aliases.has(qualifier) && !own.has(qualifier)) return true
    }
    return Object.values(x).some((v) => (Array.isArray(v) ? v.some(visit) : typeof v === 'object' && visit(v)))
  }
  return visit(q)
}

/** The FROM tables a select-list scalar subquery that aggregates without GROUP BY reads, by qualified name. */
function aggregatingSubqueryTables(node: SelectNode, scope: TableScope): Set<string> {
  const out = new Set<string>()
  const aliases = new Set(scope.tables.map((t) => t.alias))
  const visit = (e: unknown, inside: boolean): void => {
    if (e === null || typeof e !== 'object') return
    const n = e as { kind?: string; query?: QueryExpression; parts?: readonly string[] }
    if (n.kind === NODE.SUBQUERY && n.query !== undefined) {
      const body = n.query.body
      const aggregating = body.kind === QUERY.SELECT && body.groupBy === undefined && body.items.some((i) => containsAggregate(i.expr))
      if (aggregating) visit(n.query, true)
      return
    }
    if (inside && n.kind === NODE.COLUMN && (n.parts?.length ?? 0) >= 2) {
      const alias = n.parts?.[(n.parts?.length ?? 0) - 2] as string
      if (aliases.has(alias)) out.add(alias)
    }
    for (const v of Object.values(e)) if (typeof v === 'object') Array.isArray(v) ? v.forEach((x) => visit(x, inside)) : visit(v, inside)
  }
  for (const item of node.items) visit(item.expr, false)
  return out
}

/** A scope whose columns of the named tables report nullable. */
function nullableView(scope: TableScope, aliases: ReadonlySet<string>): Scope {
  return {
    resolve(parts, clause) {
      const r = scope.resolve(parts, clause)
      if (r.depth === undefined && aliases.has(scope.columnAt(r.index)?.table.alias ?? '')) return { ...r, type: { ...r.type, nullable: true } }
      return r
    },
  }
}

/**
 * The columns a query reads of each table of its FROM, by name in lower case,
 * or 'all' for a table read whole (`*`): what decides which secondary index
 * holds everything it needs (`FromPlan.reads`).
 */
function columnsRead(scope: TableScope, node: SelectNode, q: QueryExpression): Map<string, ReadonlySet<string> | 'all'> {
  const used = new Map<string, Set<string> | 'all'>()
  const aliases = new Set(scope.tables.map((t) => t.alias))
  const add = (alias: string, column: string | 'all'): void => {
    const cur = used.get(alias)
    if (cur === 'all') return
    if (column === 'all') used.set(alias, 'all')
    else used.set(alias, (cur ?? new Set()).add(column.toLowerCase()))
  }
  const visit = (e: unknown, inside: boolean): void => {
    if (e === null || typeof e !== 'object') return
    const n = e as { kind?: string; parts?: readonly string[]; query?: unknown }
    if (n.kind === NODE.SUBQUERY || n.kind === REF.DERIVED) {
      visit(n.query, true)
      return
    }
    // COUNT(*) counts rows and reads no column.
    if (n.kind === NODE.CALL && String((n as { name?: unknown }).name).toUpperCase() === 'COUNT') {
      const args = (n as { args?: readonly Expression[] }).args ?? []
      if (args.length === 1 && args[0]?.kind === NODE.COLUMN && args[0].parts.length === 1 && args[0].parts[0] === '*') return
    }
    if (n.kind === NODE.COLUMN && n.parts !== undefined) {
      const last = n.parts[n.parts.length - 1] as string
      const qualifier = n.parts.length >= 2 ? (n.parts[n.parts.length - 2] as string) : undefined
      if (last === '*') {
        if (inside) return
        for (const t of scope.tables) if (qualifier === undefined || qualifier === t.alias) add(t.alias, 'all')
        return
      }
      if (inside) {
        if (qualifier !== undefined && aliases.has(qualifier)) add(qualifier, last)
        return
      }
      try {
        const r = scope.resolve(n.parts, 'field list')
        const at = r.depth === undefined ? scope.columnAt(r.index) : undefined
        if (at !== undefined) add(at.table.alias, at.column.name)
      } catch (e) {
        expectTyped(e)
        // An alias, or an error compiling will report.
      }
      return
    }
    for (const v of Object.values(e)) if (typeof v === 'object') Array.isArray(v) ? v.forEach((x) => visit(x, inside)) : visit(v, inside)
  }
  visit(node.items, false)
  visit(node.where, false)
  visit(node.groupBy, false)
  visit(node.having, false)
  visit(node.from, false)
  visit(q.orderBy, false)
  return used
}

/**
 * 1093: an UPDATE or DELETE whose own subqueries read the table it writes,
 * which MySQL refuses unless a derived table materializes the read first.
 */
export function checkTargetNotRead(target: { readonly schema: string; readonly name: string }, exprs: readonly (Expression | undefined)[], database: string | null): void {
  const visit = (e: unknown, inSubquery: boolean): void => {
    if (e === null || typeof e !== 'object') return
    const n = e as { kind?: string; table?: TableName; query?: unknown }
    if (n.kind === REF.DERIVED) return
    if (n.kind === NODE.SUBQUERY) {
      visit(n.query, true)
      return
    }
    if (inSubquery && n.kind === REF.TABLE && n.table !== undefined && n.table.name === target.name && (n.table.schema ?? database) === target.schema) {
      throw sqlError('ER_UPDATE_TABLE_USED', `You can't specify target table '${target.name}' for update in FROM clause`)
    }
    for (const v of Object.values(e)) if (typeof v === 'object') Array.isArray(v) ? v.forEach((x) => visit(x, inSubquery)) : visit(v, inSubquery)
  }
  for (const e of exprs) visit(e, false)
}

// --- subqueries, derived tables, CTEs and set operations (M5.1, M5.19) --------------

/** A scope one query further out: every name it resolves is a correlated reference, one level deeper. */
function enclosing(scope: Scope, seen: () => void): Scope {
  return {
    resolve(parts, clause) {
      const r = scope.resolve(parts, clause)
      seen()
      return { ...r, depth: (r.depth ?? 0) + 1 }
    },
  }
}

/** A subquery in an expression, planned with the expression's scope enclosing it. */
function planSubquery(run: Run, q: QueryExpression, outer: Scope): SubqueryPlan & { readonly plan: SelectPlan } {
  let correlated = false
  const plan = planQuery({ ...run, parent: enclosing(outer, () => (correlated = true)) }, q)
  return {
    plan,
    columns: plan.columns,
    get correlated() {
      return correlated
    },
    hasFrom: hasFrom(q),
    rows: (env) => plan.rows(env.trx, env),
  }
}

/** Whether a query reads a table: one with no FROM is a constant row. */
function hasFrom(q: QueryExpression): boolean {
  const body = q.body
  if (body.kind === QUERY.SELECT) return (body.from ?? []).some((r) => !(r.kind === REF.TABLE && r.table.schema === undefined && r.table.name.toLowerCase() === 'dual'))
  if (body.kind === QUERY.QUERY) return hasFrom(body)
  return true
}

/**
 * Whether MySQL merges a derived table or CTE into its outer query rather
 * than materializing it (`derived_merge`): a plain SELECT, with no grouping,
 * aggregate, DISTINCT, LIMIT or set operation. A merged one reports its
 * columns as their own, keys included; a materialized one as a temporary
 * table's copies (8.4.11).
 */
function mergeable(q: QueryExpression): boolean {
  if (q.limit !== undefined || q.with !== undefined) return false
  const body = q.body
  if (body.kind === QUERY.QUERY) return mergeable(body)
  if (body.kind !== QUERY.SELECT) return false
  // A derived table with no FROM is a constant row MySQL materializes ("Rows fetched before execution").
  if (!hasFrom(q)) return false
  return body.groupBy === undefined && body.having === undefined && body.distinct !== true && body.windows === undefined && !body.items.some((i) => containsAggregate(i.expr) || containsWindow(i.expr))
}

/** A derived table, or one reference to a CTE: its columns as the outer query sees them, and its rows. */
function derivedTable(run: Run, query: QueryExpression, alias: string, names: readonly string[] | undefined, lateral: Scope | undefined, view?: ViewDef, cte?: string): DerivedSource {
  let correlated = false
  const outer = lateral === undefined ? run.parent : enclosing(lateral, () => {})
  const parent: Scope | undefined =
    outer === undefined
      ? undefined
      : {
          resolve(parts, clause) {
            const r = outer.resolve(parts, clause)
            correlated = true
            return r
          },
        }
  const plan = planQuery({ ...run, ...(parent === undefined ? {} : { parent }) }, query)
  // A LATERAL one merges as any other does when it can (8.4.11: Drizzle's
  // `LEFT JOIN LATERAL (SELECT JSON_ARRAY(…) FROM (… LIMIT 1) p)` reports its
  // JSON_ARRAY as an expression, not a temporary table's field).
  //
  // Every column reports the derived table's alias as its table and its own
  // derived name as its original name. A view's merged columns report the view
  // as their original table and its schema as theirs, expressions excepted;
  // a materialized view's table columns keep their base table, and its
  // expressions take the view's names instead (8.4.11).
  const merged = mergeable(query) && view?.algorithm !== 'TEMPTABLE'
  const columns = renamed(plan.columns, names).map((c) => {
    const { column, ...rest } = c.type
    const derived = { table: alias, orgName: c.name }
    const asColumn = column === undefined ? undefined : { ...column, ...derived, ...(merged && view !== undefined ? { schema: view.schema, orgTable: view.name } : {}) }
    // A materialized derived table's field, merged into a view, is a field of
    // the view's: its schema is the view's (8.4.11).
    const field = rest.temporary !== undefined && rest.temporary !== false
    const asExpression =
      view === undefined
        ? { ...derived, schema: '', orgTable: '' }
        : merged && !field
          ? { ...derived, schema: '', orgTable: view.name, viewSchema: view.schema }
          : { ...derived, schema: view.schema, orgTable: view.name }
    const type = asColumn === undefined ? { ...rest, names: asExpression } : { ...rest, column: asColumn }
    return { name: c.name, type: merged ? type : { ...type, temporary: 'stream' as const } }
  })
  // Read once per statement unless it reads an enclosing query: so an UPDATE
  // whose subquery reads its own table through a derived table sees the
  // table as it was before the first row changed (8.4.11: `UPDATE t SET a =
  // a + (SELECT COUNT(*) FROM (SELECT a FROM t) d WHERE d.a > t.a)` is 3, 3, 3).
  const key = {}
  return {
    columns,
    explain: (): DerivedPlan | undefined => {
      const body = plan.explain?.()?.[0]
      if (body === undefined) return undefined
      return merged ? { merged, node: body } : { merged, materialize: cte === undefined ? 'Materialize' : `Materialize CTE ${cte}`, children: [body] }
    },
    // Its rows are a table's fields: a hex literal's number does not survive.
    rows: (trx, env, row) => {
      if (lateral !== undefined || correlated || env.memo === undefined) return fieldRows(plan.rows(trx, lateral === undefined || row === undefined ? env : { ...env, outer: [row, ...(env.outer ?? [])] }))
      let all = env.memo.get(key) as Value[][] | undefined
      if (all === undefined) {
        all = [...fieldRows(plan.rows(trx, env))]
        env.memo.set(key, all)
      }
      return all
    },
  }
}

/** The first MATCH a WHERE requires: itself, or a conjunct of a top-level AND. */
function matchConjunct(e: Expression | undefined): Expression | undefined {
  if (e === undefined) return undefined
  if (e.kind === NODE.MATCH) return e
  if (e.kind === NODE.BINARY && (e.op.toUpperCase() === 'AND' || e.op === '&&')) return matchConjunct(e.left) ?? matchConjunct(e.right)
  return undefined
}

function plainColumn(t: ResultType): ResultType {
  if (t.literalInt === undefined) return t
  const { literalInt: _l, ...rest } = t
  return { ...rest, wasLiteralInt: true }
}

function* fieldRows(rows: Iterable<Value[]>): Generator<Value[]> {
  for (const r of rows) yield r.map(withoutHex)
}

/** A derived table's or CTE's column names: its own list, or its items' — 1353 when they differ in number, 1060 for a name twice. */
function renamed(columns: readonly { readonly name: string; readonly type: ResultType }[], names: readonly string[] | undefined): { name: string; type: ResultType }[] {
  if (names !== undefined && names.length !== columns.length) {
    throw sqlError('ER_VIEW_WRONG_LIST', 'In definition of view, derived table or common table expression, SELECT list and column names list have different column counts')
  }
  // A hex literal's column is bytes again, as its rows are (`fieldRows`).
  const out = columns.map((c, i) => ({ name: names?.[i] ?? c.name, type: plainColumn(c.type) }))
  const seen = new Set<string>()
  for (const c of out) {
    const k = c.name.toLowerCase()
    if (seen.has(k)) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${c.name}'`)
    seen.add(k)
  }
  return out
}

/** The CTEs a WITH defines, each visible to the ones after it and to the query. */
export function withClause(run: Run, w: NonNullable<QueryExpression['with']>): Run {
  const ctes = new Map(run.ctes ?? [])
  let at: Run = { ...run, ctes }
  for (const cte of w.tables) {
    const before: Run = at
    const recursive = w.recursive === true && references(cte.query, cte.name)
    const source = recursive ? recursiveCte(before, cte) : undefined
    ctes.set(cte.name, () => source ?? derivedTable(before, cte.query, cte.name, cte.columns, undefined, undefined, cte.name))
    at = { ...run, ctes: new Map(ctes) }
  }
  return at
}

/** Whether a query names a table `name` anywhere in its FROMs, subqueries included. */
function references(q: unknown, name: string): boolean {
  if (q === null || typeof q !== 'object') return false
  const n = q as { kind?: string; table?: TableName }
  if (n.kind === REF.TABLE && n.table?.schema === undefined && n.table?.name === name) return true
  return Object.values(q).some((v) => (Array.isArray(v) ? v.some((x) => references(x, name)) : typeof v === 'object' && references(v, name)))
}

/**
 * `WITH RECURSIVE r AS (anchor UNION [ALL|DISTINCT] step)`: the anchor's rows,
 * then the step over the rows the last round added, until a round adds none.
 * The columns are the anchor's, and nullable, as a temporary table holds them
 * (8.4.11: `SELECT 1` as an anchor reports a nullable BIGINT 2 wide). More
 * rounds than `cte_max_recursion_depth` is 3636.
 */
function recursiveCte(run: Run, cte: NonNullable<QueryExpression['with']>['tables'][number]): DerivedSource {
  const notYet = (what: string): Error => sqlError('ER_NOT_SUPPORTED_YET', `This version of MySQL doesn't yet support '${what}'`)
  // `AS ((SELECT 1 UNION ALL …))` is the same query (8.4.11).
  let query: QueryExpression = cte.query
  while (query.body.kind === QUERY.QUERY && query.with === undefined && query.orderBy === undefined && query.limit === undefined) query = query.body
  const body = query.body
  if (body.kind !== QUERY.SET_OPERATION || body.op !== 'UNION') {
    throw sqlError('ER_CTE_RECURSIVE_REQUIRES_UNION', `Recursive Common Table Expression '${cte.name}' should contain a UNION`)
  }
  if (query.orderBy !== undefined) throw notYet('ORDER BY over UNION in recursive Common Table Expression')
  // The UNION's members, in order: those that do not read the CTE are its
  // anchor, and every one that does runs each round (8.4.11 runs two).
  const members: QueryBody[] = []
  let distinctRows = false
  const flatten = (b: QueryBody): void => {
    if (b.kind === QUERY.SET_OPERATION && b.op === 'UNION') {
      if (b.all !== true) distinctRows = true
      flatten(b.left)
      flatten(b.right)
    } else members.push(b)
  }
  flatten(body)
  const recursive = members.filter((m) => references(m, cte.name))
  const anchors = members.filter((m) => !references(m, cte.name))
  for (const m of recursive) {
    const select = m.kind === QUERY.QUERY ? m.body : m
    if (m.kind === QUERY.QUERY && (m.orderBy !== undefined || m.limit !== undefined)) throw notYet('ORDER BY / LIMIT / SELECT DISTINCT in recursive query block of Common Table Expression')
    if (select.kind !== QUERY.SELECT) continue
    if (select.groupBy !== undefined || select.items.some((i) => containsAggregate(i.expr)) || (select.having !== undefined && containsAggregate(select.having))) {
      throw sqlError('ER_CTE_RECURSIVE_FORBIDS_AGGREGATION', `Recursive Common Table Expression '${cte.name}' can contain neither aggregation nor window functions in recursive query block`)
    }
    if (select.distinct === true) throw notYet('ORDER BY / LIMIT / SELECT DISTINCT in recursive query block of Common Table Expression')
  }
  const asQuery = (b: QueryBody): QueryExpression => (b.kind === QUERY.QUERY ? b : { kind: QUERY.QUERY, body: b, at: b.at })
  const anchorPlans = anchors.map((a) => planQuery(run, asQuery(a)))
  const anchor = anchorPlans[0]
  if (anchor === undefined) throw sqlError('ER_CTE_RECURSIVE_REQUIRES_NONRECURSIVE_FIRST', `Recursive Common Table Expression '${cte.name}' should have one or more non-recursive query blocks followed by one or more recursive ones`)
  // A recursive CTE's table is typed as a set operation's column is, from the anchor alone, and nullable.
  const columns = renamed(anchor.columns, cte.columns).map((c) => ({ name: c.name, type: { ...setOperationType([c.type], run.env.session.characterSet), nullable: true, names: { schema: '', table: cte.name, orgTable: '', orgName: c.name } } }))
  let working: readonly (readonly Value[])[] = []
  // What a recursive member reads of the CTE: the rows the last round added.
  const workingTable: DerivedSource = { columns, rows: () => working, explain: () => ({ merged: true, node: planNode(`Scan new records on ${cte.name}`) }) }
  const ctes = new Map(run.ctes ?? [])
  ctes.set(cte.name, () => workingTable)
  const steps = recursive.map((m) => planQuery({ ...run, ctes }, asQuery(m)))
  for (const p of [...anchorPlans, ...steps]) {
    if (p.columns.length !== columns.length) throw sqlError('ER_WRONG_NUMBER_OF_COLUMNS_IN_SELECT', 'The used SELECT statements have a different number of columns')
  }
  // A LIMIT on the whole CTE stops the recursion once it has its rows (8.4.11).
  const limitCount = query.limit === undefined ? undefined : limitValue(run, query.limit.count, 'LIMIT')
  const offset = query.limit?.offset === undefined ? 0 : limitValue(run, query.limit.offset, 'LIMIT')
  const enough = limitCount === undefined ? Infinity : offset + limitCount
  const types = columns.map((c) => c.type)
  return {
    columns,
    // The anchors once, then the recursive members until a round adds nothing.
    explain: () => {
      const roots = [...anchorPlans, ...steps].map((p) => p.explain?.()?.[0])
      if (roots.some((r) => r === undefined)) return undefined
      const body = roots as PlanNode[]
      return { merged: false, materialize: `Materialize recursive CTE ${cte.name}${distinctRows ? ' with deduplication' : ''}`, children: [...body.slice(0, anchorPlans.length), planNode('Repeat until convergence', body.slice(anchorPlans.length))] }
    },
    rows(trx, env) {
      const max = Number(toInteger(run.state.systemVariable('cte_max_recursion_depth', undefined, env.session) ?? intValue(1000n)))
      const seen = new Set<string>()
      const all: Value[][] = []
      const keep = (rows: Iterable<readonly Value[]>): Value[][] => {
        const out: Value[][] = []
        for (const r of rows) {
          if (all.length + out.length >= enough) break
          const row = r.map((v, i) => convertSetValue(v, types[i] as ResultType))
          if (distinctRows) {
            const k = rowKey(row)
            if (seen.has(k)) continue
            seen.add(k)
          }
          out.push(row)
        }
        return out
      }
      let current = keep(anchorPlans.flatMap((p) => [...p.rows(trx, env)]))
      all.push(...current)
      for (let round = 1; current.length > 0 && all.length < enough; round++) {
        if (round > max) throw sqlError('ER_CTE_MAX_RECURSION_DEPTH', `Recursive query aborted after ${round} iterations. Try increasing @@cte_max_recursion_depth to a larger value.`)
        working = current
        current = keep(steps.flatMap((p) => [...p.rows(trx, env)]))
        all.push(...current)
      }
      return all.slice(offset, enough)
    },
  }
}

/** UNION, INTERSECT or EXCEPT over two branches, each any query (M5.19). `parent` is the operator it is a branch of. */
function planSetOperation(run: Run, node: SetOperationNode, parent?: SetOperationNode['op']): SelectPlan {
  const branch = (b: QueryBody): SelectPlan => {
    if (b.kind === QUERY.SET_OPERATION) return planSetOperation(run, b, node.op)
    // A parenthesised set operation is still a branch of this one.
    if (b.kind === QUERY.QUERY && b.body.kind === QUERY.SET_OPERATION && b.with === undefined) return orderedResult(run, b, planSetOperation(run, b.body, node.op))
    return planQuery(run, b.kind === QUERY.QUERY ? b : { kind: QUERY.QUERY, body: b, at: b.at })
  }
  const left = branch(node.left)
  const right = branch(node.right)
  const leavesOf = (p: SelectPlan): readonly (readonly ResultType[])[] => p.leaves ?? [p.columns.map((c) => c.type)]
  const leaves = [...leavesOf(left), ...leavesOf(right)]
  const op = setOperation(node, left.columns, right.columns, run.env.session.characterSet, leaves)
  const columns =
    parent === undefined || parent === node.op
      ? op.columns
      : op.columns.map((c, i) => ({ name: c.name, type: { ...c.type, nullable: nestedNullability(node.op, (left.columns[i] as { type: ResultType }).type.nullable, (right.columns[i] as { type: ResultType }).type.nullable) } }))
  // EXPLAIN: a chain of one operator is one temporary table, its branches in order.
  const described = (p: SelectPlan): PlanNode | undefined => p.explain?.(true)?.[0]
  const flatten = (p: SelectPlan, all: boolean): { node: PlanNode; all: boolean }[] | undefined => {
    if (p.members !== undefined && p.members.op === node.op) return p.members.items.map((m, i) => (i === 0 ? { ...m, all } : m))
    const n = described(p)
    return n === undefined ? undefined : [{ node: n, all }]
  }
  const l = flatten(left, false)
  const r = flatten(right, node.all === true)
  const members: SetMembers | undefined = l === undefined || r === undefined ? undefined : { op: node.op, items: [...l, ...r] }
  return {
    columns,
    locking: left.locking || right.locking,
    leaves,
    ...(members === undefined ? {} : { members, explain: (materialized?: boolean): readonly PlanNode[] => [setOperationNode(members, materialized === true || parent !== undefined)] }),
    rows: (trx, env) => {
      const rows = op.rows(() => left.rows(trx, env), () => right.rows(trx, env))
      if (parent !== undefined) return rows
      const types = op.columns.map((c) => c.type)
      return (function* () {
        for (const r of rows) yield r.map((v, i) => convertSetValue(v, types[i] as ResultType))
      })()
    },
  }
}

/**
 * A set operation as 8.4.11's iterators. Its branches are written into a
 * temporary table and read back, deduplicated as they are written unless
 * every branch joined with ALL; branches after the chain's last DISTINCT are
 * written without it ("Disable deduplication"). A UNION ALL nothing sorts or
 * limits is not materialized at all: each branch is streamed in turn (Append).
 */
function setOperationNode(m: SetMembers, materialized: boolean): PlanNode {
  const name = m.op === 'UNION' ? 'Union' : m.op === 'INTERSECT' ? 'Intersect' : 'Except'
  const lastDistinct = m.items.reduce((at, x, i) => (i > 0 && !x.all ? i : at), -1)
  if (lastDistinct < 0 && m.op === 'UNION' && !materialized) return planNode('Append', m.items.map((x) => planNode('Stream results', [x.node])))
  const children = m.items.map((x, i) => (lastDistinct >= 0 && i > lastDistinct ? planNode('Disable deduplication', [x.node]) : x.node))
  const how = lastDistinct < 0 ? `${name} all materialize` : `${name} materialize with deduplication`
  return planNode(`Table scan on <${m.op.toLowerCase()} temporary>`, [planNode(how, children)])
}

/**
 * A query's own ORDER BY and LIMIT over a result that is not a single SELECT's
 * — a set operation's, or a parenthesised query's. It sees only the result's
 * columns, by position or name; a table-qualified name is 1250.
 */
function orderedResult(run: Run, q: QueryExpression, plan: SelectPlan): SelectPlan {
  if (q.orderBy === undefined && q.limit === undefined) return plan
  const scope = new TableScope([{ alias: '\u0000result', columns: plan.columns.map((c) => ({ name: c.name, type: c.type })) }])
  const keys = (q.orderBy ?? []).map((o): SortKey => {
    const e = o.expr
    if (e.kind === NODE.LITERAL && e.type === 'int') {
      const n = Number(e.value as bigint)
      if (n < 1 || n > plan.columns.length) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(String(n), 'order clause'))
      return { expr: { eval: (row) => row[n - 1] ?? null, type: (plan.columns[n - 1] as { type: ResultType }).type }, desc: o.desc === true }
    }
    if (e.kind === NODE.COLUMN && e.parts.length >= 2) {
      throw sqlError('ER_TABLENAME_NOT_ALLOWED_HERE', `Table '${e.parts[e.parts.length - 2]}' from one of the SELECTs cannot be used in global ORDER clause`)
    }
    return { expr: compile(e, compileContext(run, scope, 'order clause')), desc: o.desc === true }
  })
  const limitCount = q.limit === undefined ? undefined : limitValue(run, q.limit.count, 'LIMIT')
  const offset = q.limit?.offset === undefined ? 0 : limitValue(run, q.limit.offset, 'LIMIT')
  const stages: Stage[] = [...(keys.length === 0 ? [] : [sortStage(keys)]), ...(limitCount === undefined && offset === 0 ? [] : [limitStage(offset, limitCount)])]
  return {
    columns: plan.columns,
    locking: plan.locking,
    ...(plan.leaves === undefined ? {} : { leaves: plan.leaves }),
    explain() {
      if (limitCount === 0) return [planNode('Zero rows')]
      // Read from a table, for the sort or the limit: a UNION ALL is no longer streamed.
      const [root, ...rest] = plan.explain?.(true) ?? []
      const n = root === undefined ? undefined : describeStages(root, stages)
      return n === undefined ? undefined : [n, ...rest]
    },
    rows(trx, given) {
      const env = given ?? { ...run.env, ...(trx === undefined ? {} : { trx }) }
      return values(runStages(rowed(plan.rows(trx, given)), stages, env))
    },
  }
}

/** A sort of rows that are already a result's values. */
function sortStage(keys: readonly SortKey[]): Stage {
  return { run: (rows, env) => sort(rows, keys, env), describe: (n) => planNode('Sort', [n]) }
}

/** The tables an ORDER BY reads, through positions and aliases to the items they name. */
function orderAliases(q: QueryExpression, items: readonly { readonly alias?: string; readonly expr?: Expression }[], scope: Scope): Set<string> {
  const out = new Set<string>()
  const visit = (e: unknown): void => {
    if (e === null || typeof e !== 'object') return
    const n = e as { kind?: string; parts?: readonly string[] }
    if (n.kind === NODE.COLUMN && scope instanceof TableScope) {
      try {
        const alias = scope.columnAt(scope.resolve(n.parts as string[], 'order clause').index)?.table.alias
        if (alias !== undefined) out.add(alias)
      } catch (e) {
        expectTyped(e)
        out.add('\u0000')
      }
      return
    }
    for (const v of Object.values(e)) if (typeof v === 'object') Array.isArray(v) ? v.forEach(visit) : visit(v)
  }
  for (const o of q.orderBy ?? []) {
    const e = o.expr
    if (e.kind === NODE.LITERAL && e.type === 'int') visit(items[Number(e.value as bigint) - 1]?.expr ?? { kind: NODE.COLUMN, parts: ['\u0000'] })
    else if (e.kind === NODE.COLUMN && e.parts.length === 1 && items.some((i) => i.alias?.toLowerCase() === (e.parts[0] as string).toLowerCase())) visit(items.find((i) => i.alias?.toLowerCase() === (e.parts[0] as string).toLowerCase())?.expr)
    else visit(e)
  }
  return out
}

/** A result column's name: its alias, a bare column's name as written, a string literal's value, else its source text. */
function itemName(item: SelectNode['items'][number], text: string | undefined): string {
  const e = item.expr
  if (item.alias !== undefined) {
    // A name is utf8mb3: a character past the BMP in an alias is refused (8.4.11).
    const astral = /[\u{10000}-\u{10FFFF}]/u.exec(item.alias)
    if (astral !== null) {
      const bytes = Array.from(new TextEncoder().encode(astral[0]), (b) => `\\x${b.toString(16).toUpperCase()}`).join('')
      throw sqlError('ER_CANNOT_CONVERT_STRING', `Cannot convert string '${bytes}' from utf8mb4 to utf8mb3`)
    }
    return item.alias
  }
  // A name made from the expression has such a character as '?'.
  const made = e.kind === NODE.COLUMN ? (e.parts[e.parts.length - 1] as string) : e.kind === NODE.LITERAL && e.type === 'string' ? (e.value as string) : text === undefined ? deparseName(e) : text
  return made.replace(/[\u{10000}-\u{10FFFF}]/gu, '?')
}

/**
 * A bare column of a view, a derived table, a CTE or an INFORMATION_SCHEMA
 * table is named as that source names it, whatever the query wrote: only a
 * base table's column takes the query's spelling (8.4.11 — `SELECT
 * table_name FROM information_schema.tables` reads as TABLE_NAME).
 */
function sourceName(scope: TableScope | undefined, item: SelectNode['items'][number], name: string): string {
  if (scope === undefined || item.alias !== undefined || item.expr.kind !== NODE.COLUMN) return name
  let at
  try {
    const r = scope.resolve(item.expr.parts, 'field list')
    if (r.depth !== undefined && r.depth > 0) return name
    at = scope.columnAt(r.index)
  } catch (e) {
    expectTyped(e)
    return name
  }
  return at === undefined || at.table.def !== undefined ? name : at.column.name
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
  from: FromPlan | undefined,
  lookup: Scope,
  windowed = false,
): SelectPlan {
  const scope = from?.scope
  const source = from?.single
  const width = from?.width ?? 0
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
      for (const s of scope.star(table)) {
        const at = scope.columnAt(s.index)
        selectItems.push({ expr: { kind: NODE.COLUMN, parts: [at?.table.alias as string, s.name], at: e.at }, name: s.name })
      }
      return
    }
    selectItems.push({ expr: e, name: sourceName(scope, item, itemName(item, texts[i])), ...(item.alias === undefined ? {} : { alias: item.alias }) })
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
  // A key the WHERE holds to one value does not order anything: GROUP BY
  // amt, name WHERE amt = -18 groups by the index on name (8.4.11).
  const pinned = source === undefined ? new Set<string>() : new Set([...whereFacts(run, source.def, source.alias, node.where).pins].map((c) => c.name))
  const keyColumns = keys.map((k) => (k.index === undefined || source === undefined ? undefined : source.def.columns[k.index]?.name)).filter((c) => c === undefined || !pinned.has(c))
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
        const at = safeIndex(lookup, e.parts)
        if (at === undefined) return undefined
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
  // Windows over the groups (M5.6): run after HAVING, over the grouped rows,
  // so their arguments and keys may be the groups' aggregates. Their slots
  // follow the aggregates', which are all known only once everything compiled.
  const windows = windowed ? new WindowSink(postCtx('window order by'), 0, node.windows) : undefined
  const withWindows = (ctx: CompileContext): CompileContext => (windows === undefined ? ctx : { ...ctx, windows })

  const items = selectItems.map((s) => ({ name: s.name, compiled: compile(s.expr, withWindows(postCtx('field list'))), expr: s.expr, ...(s.alias === undefined ? {} : { alias: s.alias }) }))

  // HAVING sees the select list's aliases, its columns and the keys; a column
  // that is none of those is 1054 even when the table has it (8.4.11).
  let having: Compiled | undefined
  if (node.having !== undefined) {
    const havingScope = selectedOnly(lookup, selectItems, keys.flatMap((k) => (k.index === undefined ? [] : [k.index])), node.having)
    having = compile(substituteAliases(node.having, selectItems), postCtx('having clause', havingScope))
  }

  const orderItems = items.map((i) => ({ name: i.name, compiled: i.compiled, ...(i.alias === undefined ? {} : { alias: i.alias }) }))
  const orderKeys = (q.orderBy ?? []).map((o) => {
    const e = o.expr
    if ((e.kind === NODE.LITERAL && e.type === 'int') || (e.kind === NODE.COLUMN && e.parts.length === 1 && items.some((i) => i.alias?.toLowerCase() === (e.parts[0] as string).toLowerCase()))) {
      return orderKey(run, o, orderItems, lookup)
    }
    return { expr: compile(e, withWindows(postCtx('order clause'))), desc: o.desc === true }
  })

  if (modeOf(run.env.session.sqlMode).onlyFullGroupBy) {
    checkFullGroupBy(lookup, scope, keys, node.where, from?.joins ?? [], items.map((i) => i.expr), (q.orderBy ?? []).filter((o) => !(o.expr.kind === NODE.LITERAL && o.expr.type === 'int') && !(o.expr.kind === NODE.COLUMN && o.expr.parts.length === 1 && items.some((i) => i.alias?.toLowerCase() === (o.expr as unknown as { parts: string[] }).parts[0]?.toLowerCase()))).map((o) => o.expr), node.groupBy === undefined, rollup)
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
  const groupedLimit = q.limit === undefined ? undefined : limitValue(run, q.limit.count, 'LIMIT')
  const facts = run.preparing === true ? undefined : optimizerFacts(from, node.where, groupedLimit, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, (node.options ?? []).includes('STRAIGHT_JOIN'))
  let dataColumns: ((trx: Trx | undefined) => readonly ResultType[]) | undefined
  if (facts !== undefined && !facts.empty) {
    const consts = new Set(facts.constTables.map((t) => t.alias))
    const fixed = new Set([...consts, ...(facts.nullTables ?? [])])
    const own = items.map((i) => i.compiled.type)
    const seenKeys = new Set<number>()
    for (const item of items) {
      const e = item.expr
      const t = item.compiled.type
      if (!refersToRow(e, lookup, consts)) continue
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
      // The keys are the temporary table's key, columns or expressions;
      // everything else is a field beside them.
      const isKeyExpression = e.kind !== NODE.COLUMN && !aggregateCall && keys.some((k) => k.index === undefined && k.text === deparse(e))
      // A key that reads only NULL-complemented tables is a constant, and no part of the table's key.
      const keyed = (isKey || isKeyExpression) && refersToRow(e, lookup, fixed)
      if (strategy === 'temp') item.compiled = { ...item.compiled, type: { ...t, temporary: keyed ? true : 'pinned', ...(aggregateCall ? { names: { schema: '', table: '', orgTable: '', orgName: '' } } : {}) } }
      else if (stream || (source === undefined && from !== undefined && strategy === 'sort' && t.column !== undefined)) {
        // A sort-based grouping over a join sorts the join's rows streamed
        // into a temporary table, so its columns are that table's copies.
        item.compiled = { ...item.compiled, type: { ...t, temporary: 'stream' } }
      }
    }
    if (facts.constTables.length > 0) {
      const materialized = items.map((i) => i.compiled.type)
      dataColumns = (trx) => (constTablesHaveRows(facts, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, trx) ? materialized : own)
    }
  }

  // The WHERE: a FROM applies it itself (M5.43); one with no FROM is a Filter here.
  const whereCtx = compileContext(run, lookup, 'where clause')
  let where: Compiled | undefined
  if (from !== undefined) from.filter(node.where, (e) => compile(e, whereCtx))
  else if (node.where !== undefined) where = compile(node.where, whereCtx)
  // An index-ordered grouping reads that index whole, in its order, whatever range the WHERE would choose.
  if (strategy === 'index' && groupIndex !== undefined) from?.readInOrder(groupIndex, true)
  const limitCount = q.limit === undefined ? undefined : limitValue(run, q.limit.count, 'LIMIT')
  const offset = q.limit?.offset === undefined ? 0 : limitValue(run, q.limit.offset, 'LIMIT')
  const locking = (q.locking ?? []).length > 0
  if (windows !== undefined) {
    windows.base = level + 1 + sink.specs.length
    // Read through the windows' temporary table, which takes the groups'
    // place; one row of an aggregate without GROUP BY needs none (8.4.11:
    // `COUNT(*), ROW_NUMBER() OVER ()` keeps BINARY on both).
    const temporary = node.groupBy === undefined ? undefined : ('stream' as const)
    for (const item of items) {
      const { temporary: _was, ...type } = item.compiled.type
      item.compiled = { ...item.compiled, type: temporary === undefined ? type : { ...type, temporary } }
    }
  }
  const plan = { width, keys: keys.map((k) => k.compiled), specs: sink.specs, strategy, rollup }
  const sortsOutput = orderKeys.length > 0 && !(orderMatchesKeys && strategy !== 'temp')
  const groups = rollup ? 'Group aggregate with rollup' : 'Group aggregate'
  const stages: Stage[] = [
    ...(where === undefined ? [] : [filterStage(where)]),
    {
      run: (rows, env) => groupRows(rows, plan, env),
      // As the strategy runs: an Aggregate of everything, a temporary table keyed by the groups, or groups read in order — sorted for them first, a join's rows streamed into a table to be.
      describe(n) {
        if (strategy === 'implicit') return planNode('Aggregate', [n])
        if (strategy === 'temp') return planNode('Table scan on <temporary>', [planNode('Aggregate using temporary table', [n])])
        if (strategy === 'sort') return planNode(groups, [planNode('Sort', [wrap(source === undefined, 'Stream results', n)])])
        return planNode(groups, [n])
      },
    },
    ...(having === undefined ? [] : [{ ...filterStage(having), describe: (n: PlanNode) => withSubqueries(run, planNode('Filter', [n]), 'having clause') }]),
    ...(windows === undefined || windows.windows.length === 0 ? [] : [windowStage(windows, windows.base)]),
    // A DISTINCT over groups is not described yet.
    deliverStage(items.map((i) => i.compiled), sortsOutput ? orderKeys : [], node.distinct === true, { deduplicated: false, streamed: stream, described: node.distinct !== true, keep: limitCount === undefined ? undefined : offset + limitCount }),
    ...(limitCount === undefined && offset === 0 ? [] : [limitStage(offset, limitCount)]),
  ]

  return {
    columns: items.map((i) => ({ name: i.name, type: i.compiled.type })),
    locking,
    ...(dataColumns === undefined ? {} : { columnsAt: (trx: Trx | undefined) => (dataColumns as (t: Trx | undefined) => readonly ResultType[])(trx).map((type, i) => ({ name: (items[i] as { name: string }).name, type })) }),
    explain() {
      // Implicit grouping answers one row even of nothing, so it is still an Aggregate.
      if (strategy !== 'implicit' && provedEmpty(run, from, node, limitCount)) return [planNode('Zero rows')]
      const source = from === undefined ? planNode('Rows fetched before execution') : withSubqueries(run, from.explain(run.env), 'where clause')
      const n = describeStages(source, stages)
      return n === undefined ? undefined : [n, ...subqueryNodes(run, 'field list')]
    },
    rows(trx, given) {
      const env = given ?? { ...run.env, ...(trx === undefined ? {} : { trx }) }
      return values(runStages(from === undefined ? [{ row: [] }] : from.rows(trx, env, { locking }), stages, env))
    },
  }
}

/** Whether a top-level conjunct of `where` equates the column `parts` with a literal or a parameter. */
function pinnedByWhere(where: Expression | undefined, parts: readonly string[]): boolean {
  if (where === undefined) return false
  if (where.kind === NODE.BINARY && (where.op === 'AND' || where.op === '&&')) return pinnedByWhere(where.left, parts) || pinnedByWhere(where.right, parts)
  if (where.kind !== NODE.BINARY || where.op !== '=') return false
  const same = (e: Expression) => e.kind === NODE.COLUMN && e.parts.length === parts.length && e.parts.every((p, i) => p.toLowerCase() === (parts[i] as string).toLowerCase())
  const constant = (e: Expression) => e.kind === NODE.LITERAL || e.kind === NODE.PLACEHOLDER
  return (same(where.left) && constant(where.right)) || (same(where.right) && constant(where.left))
}

/** A column's slot in this query's row; undefined for none, and for an enclosing query's column, which is a constant here. */
const safeIndex = (scope: Scope, parts: readonly string[]): number | undefined => {
  try {
    const r = scope.resolve(parts, 'field list')
    return (r.depth ?? 0) > 0 ? undefined : r.index
  } catch (e) {
    expectTyped(e)
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
    // JSON_ARRAYAGG and JSON_OBJECTAGG sort their groups as GROUP_CONCAT does (8.4.11, M5.21).
    if (name === 'GROUP_CONCAT' || name === 'JSON_ARRAYAGG' || name === 'JSON_OBJECTAGG' || (n.distinct === true && name !== 'MIN' && name !== 'MAX')) return true
  }
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(needsSortedGroups) : typeof v === 'object' && needsSortedGroups(v)))
}

/**
 * Whether `e` reads the row at all: a column or an aggregate. A constant does
 * not, and is never copied into a temporary table — nor is `c IS NULL` over a
 * column that cannot be NULL, which MySQL folds to a constant before it
 * plans (8.4.11: it keeps its 0x81 through a DISTINCT).
 */
function refersToRow(e: unknown, scope?: Scope, consts?: ReadonlySet<string>): boolean {
  if (e === null || typeof e !== 'object') return false
  const n = e as { kind?: string; op?: string; operand?: Expression; parts?: readonly string[] }
  // A const table's column is a constant: the optimizer read its one row.
  if (n.kind === NODE.COLUMN && consts !== undefined && consts.size > 0 && scope instanceof TableScope) {
    try {
      const alias = scope.columnAt(scope.resolve(n.parts as string[], 'field list').index)?.table.alias
      if (alias !== undefined && consts.has(alias)) return false
    } catch (e) {
      expectTyped(e)
      // Resolved, and reported, elsewhere.
    }
  }
  if (n.kind === NODE.UNARY && (n.op === 'IS NULL' || n.op === 'IS NOT NULL') && n.operand?.kind === NODE.COLUMN && scope !== undefined) {
    try {
      if (!scope.resolve(n.operand.parts, 'field list').type.nullable) return false
    } catch (e) {
      expectTyped(e)
      // Resolved, and reported, elsewhere.
    }
  }
  if (n.kind === NODE.COLUMN) return true
  if (n.kind === NODE.CALL && isAggregate(n as Expression)) return true
  // A correlated subquery is evaluated per row and copied like any value; an uncorrelated one is a constant.
  if (n.kind === NODE.SUBQUERY) return scope instanceof TableScope && correlatedIn(n, scope)
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some((x) => refersToRow(x, scope, consts)) : typeof v === 'object' && refersToRow(v, scope, consts)))
}

/** HAVING's bare names that are select-list aliases, replaced by the expressions they name. */
/**
 * The scope HAVING reads columns through: the select list's columns, and
 * `also` (a grouped query's keys), and nothing else of the row — a column
 * that is neither is 1054 even when the table has it (8.4.11).
 */
function selectedOnly(lookup: Scope, items: readonly { readonly expr?: Expression; readonly alias?: string }[], also: readonly number[] = [], having?: Expression): Scope {
  const allowed = new Set<number>(also)
  for (const i of items) {
    const at = i.expr?.kind === NODE.COLUMN ? safeIndex(lookup, i.expr.parts) : undefined
    if (at !== undefined) allowed.add(at)
  }
  // What an alias HAVING names reads is read through the alias: `a + 1 AS b
  // … HAVING b > 20` reads `a`, which is not itself selected.
  if (having !== undefined) {
    for (const i of items) {
      const alias = i.alias?.toLowerCase()
      if (alias === undefined || i.expr === undefined || !namesColumn(having, alias)) continue
      for (const parts of columnsIn(i.expr)) {
        const at = safeIndex(lookup, parts)
        if (at !== undefined) allowed.add(at)
      }
    }
  }
  // MATCH finds its index through the tables, then names its columns
  // through `resolve`: one not selected is 1054 there too (8.4.11).
  const tables = lookup instanceof TableScope ? lookup.tables : (lookup as { readonly tables?: TableScope['tables'] }).tables
  return {
    ...(tables === undefined ? {} : { tables }),
    resolve(parts, clause) {
      const r = lookup.resolve(parts, clause)
      // An enclosing query's column is a constant here, and always visible.
      if ((r.depth ?? 0) === 0 && !allowed.has(r.index)) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(parts.join('.'), clause))
      return r
    },
  }
}

/** Whether an expression names a column `name` (one part, any case), outside its subqueries. */
function namesColumn(e: Expression, name: string): boolean {
  return columnsIn(e).some((parts) => parts.length === 1 && (parts[0] as string).toLowerCase() === name)
}

/** Every column reference in an expression, outside its subqueries. */
function columnsIn(e: Expression): (readonly string[])[] {
  const out: (readonly string[])[] = []
  const walk = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(walk)
    const node = x as { kind?: string; parts?: readonly string[] }
    if (node.kind === NODE.SUBQUERY) return
    if (node.kind === NODE.COLUMN && node.parts !== undefined) out.push(node.parts)
    for (const v of Object.values(x)) if (typeof v === 'object') walk(v)
  }
  walk(e)
  return out
}

/**
 * HAVING's names, an alias replaced by what it names: two items of that
 * alias are 1052, and one holding a window function is 3594 (8.4.11).
 */
function substituteAliases(e: Expression, items: readonly { readonly expr?: Expression; readonly alias?: string }[]): Expression {
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x
    if (Array.isArray(x)) return x.map(walk)
    const node = x as { kind?: string; parts?: readonly string[] }
    if (node.kind === NODE.SUBQUERY) return x
    if (node.kind === NODE.COLUMN && node.parts?.length === 1) {
      const name = node.parts[0] as string
      const hits = items.filter((i) => i.expr !== undefined && i.alias?.toLowerCase() === name.toLowerCase())
      if (hits.length > 1) throw sqlError('ER_NON_UNIQ_ERROR', `Column '${name}' in having clause is ambiguous`)
      const hit = hits[0]
      if (hit?.expr !== undefined) {
        if (containsWindow(hit.expr)) throw sqlError('ER_WINDOW_INVALID_WINDOW_FUNC_ALIAS_USE', `You cannot use the alias '${name}' of an expression containing a window function in this context.'`)
        return hit.expr
      }
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
  joins: readonly JoinCondition[],
  selectExprs: readonly Expression[],
  orderExprs: readonly Expression[],
  implicit: boolean,
  rollup = false,
): void {
  const determined = new Set<number>()
  for (const k of keys) if (k.index !== undefined) determined.add(k.index)
  const keyTexts = new Set(keys.filter((k) => k.index === undefined).map((k) => k.text))
  // Under ROLLUP a key can be NULL where its row's other columns are not, so
  // nothing is functionally dependent on it: not through a key, a WHERE
  // equality or a constant (8.4.11: `WHERE grp = 1 GROUP BY id WITH ROLLUP`
  // selecting `grp` is 1055).
  if (rollup) where = undefined
  if (rollup) joins = []
  const conjuncts: Expression[] = []
  const flatten = (e: Expression | undefined): void => void splitAnd(e, conjuncts)
  flatten(where)
  // An inner join's ON is as good as the WHERE; an outer join's equality
  // determines its nullable side from the preserved one, never the reverse
  // (8.4.11: `g LEFT JOIN ge ON ge.x = g.id GROUP BY g.id` allows `ge.x`, the
  // same with the tables swapped does not).
  const directed: { readonly e: Expression; readonly into: ReadonlySet<string> | undefined }[] = conjuncts.map((e) => ({ e, into: undefined }))
  for (const j of joins) {
    const before = conjuncts.length
    flatten(j.on)
    for (const e of conjuncts.slice(before)) directed.push({ e, into: j.left ? j.innerAliases : undefined })
    conjuncts.length = before
  }
  const constant = (e: Expression): boolean => e.kind === NODE.LITERAL ? e.type !== 'null' : e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && constant(e.operand))
  const edges: [number, number][] = []
  const aliasOf = (index: number): string | undefined => scope?.columnAt(index)?.table.alias
  for (const { e: c, into } of directed) {
    if (c.kind !== NODE.BINARY || (c.op !== '=' && c.op !== '<=>')) continue
    const l = c.left.kind === NODE.COLUMN ? safeIndex(lookup, c.left.parts) : undefined
    const r = c.right.kind === NODE.COLUMN ? safeIndex(lookup, c.right.parts) : undefined
    const allowed = (to: number): boolean => into === undefined || into.has(aliasOf(to) ?? '')
    if (l !== undefined && r !== undefined) {
      if (allowed(r)) edges.push([l, r])
      if (allowed(l)) edges.push([r, l])
    } else if (l !== undefined && constant(c.right) && allowed(l)) determined.add(l)
    else if (r !== undefined && constant(c.left) && allowed(r)) determined.add(r)
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const [a, b] of edges) {
      if (determined.has(a) && !determined.has(b)) {
        determined.add(b)
        changed = true
      }
    }
    for (const t of rollup ? [] : (scope?.tables ?? [])) {
      const def = t.def
      if (def === undefined) continue
      const offsetOf = (name: string): number => t.offset + def.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
      const unique = def.indexes.filter((i) => i.kind === 'primary' || (i.kind === 'unique' && i.parts.every((p) => p.prefix === undefined && def.columns.find((c) => c.name === p.column)?.nullable === false)))
      if (!unique.some((i) => i.parts.every((p) => determined.has(offsetOf(p.column))))) continue
      for (let i = 0; i < def.columns.length; i++) {
        if (!determined.has(t.offset + i)) {
          determined.add(t.offset + i)
          changed = true
        }
      }
    }
  }
  const nameOf = (index: number): string => {
    const at = scope?.columnAt(index)
    if (at === undefined) return '?'
    // An aliased table is named by its alias, under its schema: `app.p0.id` (8.4.11).
    return at.table.def === undefined ? `${at.table.alias}.${at.column.name}` : `${at.table.def.schema}.${at.table.alias}.${at.column.name}`
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
  const flatten = (e: Expression): void => void splitAnd(e, conjuncts)
  flatten(where)
  for (const c of conjuncts) {
    if (c.kind === NODE.UNARY && c.op === 'IS NULL' && columnOf(c.operand)?.nullable === false) facts.impossible = true
    else if (neverEqualIn(c, columnOf)) facts.impossible = true
    else if (foldable(c, run.params !== undefined)) {
      try {
        if (truth(compile(c, compileContext(run, EMPTY_SCOPE, 'where clause')).eval([], run.env)) !== true) facts.impossible = true
      } catch (e) {
        expectTyped(e)
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
  if (value === undefined || !isConstant(value) || (value.kind === NODE.LITERAL && value.type === 'null')) return undefined
  if (column.type.collationId !== undefined && numeric(value)) return undefined
  return value.kind === NODE.PLACEHOLDER ? `?${value.at}` : deparse(value)
}

const numeric = (e: Expression): boolean => (e.kind === NODE.LITERAL && (e.type === 'int' || e.type === 'decimal' || e.type === 'double')) || (e.kind === NODE.UNARY && numeric(e.operand))

/**
 * `int_col = 9.5` and `tinyint_col = 300`: an integer column against a
 * number it can never equal, which MySQL folds to false before reading a row
 * (8.4.11 answers `SELECT DISTINCT score FROM p WHERE flag = 9.5` without its
 * temporary table). `c = NULL` is not folded, on 8.4.
 */
function neverEqualIn(e: Expression, columnOf: (e: Expression) => ColumnDef | undefined): boolean {
  if (e.kind !== NODE.BINARY || e.op !== '=') return false
  const left = columnOf(e.left)
  return neverEqual(left ?? columnOf(e.right), left !== undefined ? e.right : e.left)
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

function deparseName(e: Expression): string {
  return e.kind === NODE.LITERAL ? String(e.value) : e.kind
}

/** An `ORDER BY` item: a position in the select list, a select-list alias, or an expression over the table. */
function orderKey(run: Run, o: OrderItem, items: readonly { name: string; compiled: Compiled; alias?: string }[], scope: Scope, windows?: WindowSink): SortKey {
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
  // A window function in ORDER BY is the query's too (8.4.11).
  return { expr: compile(e, { ...compileContext(run, scope, 'order clause'), ...(windows === undefined ? {} : { windows }) }), desc }
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
  return finish(resultSteps(run, plan, trx))
}

/** Rows read between two chances for a query to pause (D-77). */
const PACE_ROWS = 256

/**
 * `resultSet`, pausing every `PACE_ROWS` rows (D-77). A read holds no writer
 * slot, so a write may come between two rows: the read's view keeps what it
 * sees the same, and a B+tree scan finds its place again by key (M5.38).
 */
export function* resultSteps(run: Run, plan: SelectPlan, trx: Trx | undefined): Generator<void, ResultSet> {
  const described = plan.columnsAt?.(trx) ?? plan.columns
  const columns = described.map((c) => columnDefinition(c.name, c.type, run.env.session.characterSet))
  const rows: RowValue[][] = []
  const types = described.map((c) => c.type)
  for (const values of plan.rows(trx)) {
    rows.push(values.map((v, i) => toWire(v, types[i] as ResultType, run.protocol, run.env.session)))
    if (rows.length % PACE_ROWS === 0) yield
  }
  return { columns, rows }
}
