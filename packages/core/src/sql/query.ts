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
import type { ColumnDef, IndexDef, Table, TableDef, ViewDef } from '@myjs/engine'
import { LITERAL, NODE, QUERY, REF, TOKEN, deparse, lex, parseStatement, type CallNode, type Expression, type OrderItem, type QueryBody, type QueryExpression, type SelectNode, type TableReference, type SetOperationNode, type TableName, type Token } from '@myjs/parser'
import { messages, sqlError, type ColumnDefinition, type ResultSet, type RowValue } from '@myjs/protocol'
import { MAX_UNSIGNED, MIN_SIGNED, intValue, storageWidth, toInteger, truth, withoutHex, type Value } from '@myjs/types'
import { compile, constantNode, memoValue, logicalOperand, convertTo, fieldValue, decimalField, EMPTY_SCOPE, readSlot, type CompileContext, type Compiled, type Env, type GroupKeys, type QuantifiedSubquery, type Scope, type SubqueryPlan } from './compile.ts'
import { AggregateSink, chooseStrategy, containsAggregate, groupRows, isAggregate } from './group.ts'
import { WindowSink, applyWindows, containsWindow } from './window.ts'
import { CHARSET_UTF8MB4_BIN, EMPTY_NAMES, columnDefinition, copiedLength, intType, type ResultType } from './meta.ts'
import { FIELD_TYPE, expectTyped } from '@myjs/bytes'
import { distinct, filter, limit, project, sort, type SortKey } from './operators.ts'
import { isConstant, optimizerEnabled, splitAnd, tableColumn } from './plan.ts'
import { and, columnRefs, integerLiteral, nativeCallName, queryBody, someNode } from './ast.ts'
import { invalidGroupFunction } from './registry.ts'
import { notSupported, wrongArgumentsError } from './errors.ts'
import { clusteredIndex, indexParts } from './indexes.ts'
import { collationInfoByName, encodeCollation } from '@myjs/charsets'
import { ambiguousColumnError, unknownColumnError, requireSchema, safeResolve, TableScope, columnIndex as indexOfColumn } from './scope.ts'
import { holdsRead, planFrom, type DerivedPlan, type DerivedSource, type FromContext, type FromPlan, type JoinCondition } from './from.ts'
import { firstKey, rowKey, valueKey } from './keys.ts'
import { indexLookup, planNode, wrap, type PlanNode } from './explain.ts'
import { describeStages, runStages, type Rowed, type Stage } from './pipeline.ts'
import { convert as convertSetValue, checkSetWidth, nestedNullability, setOperation, setOperationType } from './setop.ts'
import { constTablesHaveRows, neverEqual, optimizerFacts, uniqueKey, type OptimizerFacts } from './optimize.ts'
import { informationSchemaTable } from './information-schema.ts'
import { performanceSchemaTable } from './performance-schema.ts'
import { statisticsOf } from './stats.ts'
import type { SqlSession } from './session.ts'
import { toWire, type WireProtocol } from './wire.ts'
import type { Trx } from '@myjs/engine'
import { isTemporary, type CatalogApi } from './temporary.ts'
import { modeOf } from './mode.ts'
import { finish } from './session.ts'
import { escapedBytes } from './builtins.ts'

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
  readonly subqueries?: BoundSubquery[]
  /** Those subqueries compiled as `[NOT] IN`, `= ALL` and their like, and how (M5.47). */
  readonly quantified?: Map<QueryExpression, QuantifiedSubquery>
  /** The SELECT's WHERE and HAVING, where a subquery's predicate may stand at the top, for EXPLAIN (M5.47). */
  readonly clauses?: Readonly<Record<string, Expression | undefined>>
}

export function compileContext(run: Run, scope: Scope, clause: string, windows?: WindowSink): CompileContext {
  const { env: { session, conditions }, params } = run
  return {
    scope,
    clause,
    connectionCollation: session.characterSet,
    session,
    state: run.state,
    serverVersion: run.serverVersion,
    params,
    subquery: (q, outer) => {
      let correlated = false
      const plan = planQuery({ ...run, parent: enclosing(outer, () => (correlated = true)) }, q)
      const checkRead = plan.checkRead?.bind(plan)
      const bound: BoundSubquery = {
        clause,
        query: q,
        plan,
        columns: plan.columns,
        get correlated() {
          return correlated
        },
        hasFrom: hasFrom(q),
        ...(checkRead === undefined ? {} : { checkRead }),
        rows: (env) => plan.rows(env.trx, env),
      }
      run.subqueries?.push(bound)
      return bound
    },
    quantified: (q, how) => void run.quantified?.set(q, how),
    table: (schema, name) => run.catalog?.table(schema, name),
    conditions,
    sql: run.sql,
    windows,
  }
}

/** A caller's environment wins; otherwise bind this execution's transaction. */
function executionEnv(run: Run, trx: Trx | undefined, given?: Env): Env {
  return given ?? { ...run.env, trx: trx ?? run.env.trx }
}

/** What planning a FROM needs from the statement: its tables, and a compiler for ON clauses. */
export function fromContext(run: Run): FromContext {
  const catalog = run.catalog
  return {
    open: (name, alias) => openTable(run, name, alias),
    compileOn: (e, scope) => compile(e, compileContext(run, scope, 'on clause')),
    env: run.env,
    statistics: catalog && ((def, table) => statisticsOf(def, table, catalog.store)),
    derived: (ref, lateral) => derivedTable(run, ref.query, ref.alias as string, ref.columns, lateral),
    cte: (name) => run.ctes?.get(name)?.(),
    view: (name, alias) => viewTable(run, name, alias),
    system: (name, alias) => informationSchemaTable(run, name, alias, defaultDatabase(run)) ?? performanceSchemaTable(run, name, alias, defaultDatabase(run)),
    parent: run.parent,
  }
}

/** A table a statement names, opened: ER_NO_DB_ERROR with no schema, ER_NO_SUCH_TABLE with no table. */
export function openTable(run: Run, name: TableName, alias = name.name): { readonly schema: string; readonly def: TableDef; readonly table: Table } {
  const schema = requireSchema(name.schema ?? defaultDatabase(run))
  // M5.12: refused by name until its tables exist, never answered as a missing table.
  if (schema.toLowerCase() === 'information_schema') throw notSupported('INFORMATION_SCHEMA')
  if (run.catalog === undefined) throw sqlError('ER_NO_SUCH_TABLE', messages.noSuchTable(schema, name.name))
  const def = run.catalog.definition(schema, name.name)
  // A temporary table is opened once a statement: a second reference to it is 1137, naming the first (8.4.11).
  if (isTemporary(def)) {
    const opened = memoValue(run.env.memo, OPENED, () => new Map<string, { readonly at: TableName; readonly alias: string }>())
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

/** Stored views keep their creation database and exclude the caller's CTEs, parameters and enclosing scope. */
function viewContext(run: Run, view: ViewDef): Run {
  return { catalog: run.catalog, state: run.state, env: run.env, sql: view.query, protocol: run.protocol, serverVersion: run.serverVersion, database: view.database ?? null }
}

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
  const inner: Run = { ...viewContext(run, view), ...(run.preparing === true ? { preparing: true } : {}), views: [...(run.views ?? []), path] }
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
  const inner: Run = { ...viewContext(run, view), preparing: true, views: [`${view.schema}.${view.name}`] }
  return { query, plan: planQuery(inner, query) }
}

const CLAUSE_WORDS = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'WINDOW', 'ORDER', 'LIMIT', 'INTO', 'FOR', 'LOCK', 'UNION', 'EXCEPT', 'INTERSECT'])
const MODIFIERS = new Set(['ALL', 'DISTINCT', 'DISTINCTROW', 'HIGH_PRIORITY', 'STRAIGHT_JOIN', 'SQL_SMALL_RESULT', 'SQL_BIG_RESULT', 'SQL_BUFFER_RESULT', 'SQL_NO_CACHE', 'SQL_CALC_FOUND_ROWS'])

/** Only unquoted identifier tokens carry SQL keywords. */
function queryWord(t: Token): string {
  return t.kind === TOKEN.IDENTIFIER && t.quoted !== true ? t.text.toUpperCase() : ''
}

/** Naming and EXPLAIN share one lexical error boundary. */
function queryTokens(run: Run): Token[] {
  try {
    return lex(run.sql, { sqlMode: modeOf(run.env.session.sqlMode) })
  } catch (e) {
    expectTyped(e)
    return []
  }
}

/**
 * The source text of each select item, from the tokens between `SELECT` and
 * its first clause, split at top-level commas. `undefined` when the tokens do
 * not line up with the tree, in which case the caller deparses instead.
 */
function itemTexts(run: Run, node: SelectNode): (string | undefined)[] {
  const tokens = queryTokens(run)
  let i = tokens.findIndex((t) => t.start === node.at)
  if (i < 0) return []
  i++
  while (i < tokens.length && MODIFIERS.has(queryWord(tokens[i] as Token))) i++
  const out: (string | undefined)[] = []
  let depth = 0
  let first = i
  for (; i <= tokens.length; i++) {
    const t = tokens[i]
    const end = t === undefined || t.kind === TOKEN.EOF || (depth === 0 && (CLAUSE_WORDS.has(queryWord(t)) || t.text === ';' || (t.kind === TOKEN.OPERATOR && t.text === ')')))
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
  /** An ordinary SELECT's bound single base source; opaque or grouped sources supply no such proof. */
  readonly source?: FromPlan['single']
  /** Validate the bound base source through this invocation's selected access. */
  checkRead?(env: Env): void
  /** Per-result optimization under the delivery transaction, before metadata or iterator initialization. */
  optimize?(trx: Trx | undefined): void
  readonly columns: readonly { readonly name: string; readonly type: ResultType }[]
  /**
   * The rows, as values. Runs the scan: call inside the statement's
   * transaction. `env` is the statement's unless a correlated subquery
   * passes its own, carrying the outer row.
   */
  rows(trx: Trx | undefined, env?: Env, ready?: () => void): Iterable<Value[]>
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
  readonly columnsAt?: ((trx: Trx | undefined) => readonly { readonly name: string; readonly type: ResultType }[]) | undefined
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
  if (q.into !== undefined) throw notSupported('SELECT … INTO')
  const r = q.with === undefined ? run : withClause(run, q.with)
  const body = q.body
  switch (body.kind) {
    case QUERY.SELECT:
      return planSelect({ ...r, subqueries: [], quantified: new Map(), clauses: { 'where clause': body.where, 'having clause': body.having } }, q, body)
    case QUERY.QUERY:
      if (q.orderBy === undefined && q.limit === undefined) return planQuery(r, body)
      return orderedResult(r, q, planQuery(r, body))
    case QUERY.SET_OPERATION:
      return orderedResult(r, q, planSetOperation(r, body))
    default:
      throw notSupported(body.kind.toUpperCase())
  }
}

function planSelect(run: Run, q: QueryExpression, node: SelectNode): SelectPlan {
  node = pushCountCondition(run, node)
  const order = q.orderBy ?? []

  // The parser normalizes unquoted DUAL; every retained reference names a table.
  const refs = node.from ?? []
  let from = refs.length === 0 ? undefined : planFrom(refs, fromContext(run), node.where, (node.options ?? []).includes('STRAIGHT_JOIN'))
  const scope = from?.scope
  let source = from?.single
  const lookup: Scope = scope ?? run.parent ?? EMPTY_SCOPE
  const reads = scope === undefined ? undefined : columnsRead(scope, node, q)
  if (from !== undefined && reads !== undefined) from.reads(reads)

  // An aggregate anywhere in the select list or HAVING makes the query a
  // grouped one, even with no GROUP BY; one in ORDER BY alone does not, and
  // is 3029 (8.4.11).
  const grouped = node.groupBy !== undefined || containsAggregate([node.items, node.having])
  if (!grouped) {
    const at = order.findIndex(containsAggregate)
    if (at >= 0) throw sqlError('ER_AGGREGATE_ORDER_NON_AGG_QUERY', `Expression #${at + 1} of ORDER BY contains aggregate function and applies to the result of a non-aggregated query`)
  }
  const windowed = containsWindow([node.items, order])
  if (grouped) return planGrouped(run, q, node, from, lookup, windowed)
  const semijoin = optimizerEnabled(run.env, 'semijoin')
  const anti = from === undefined || !semijoin ? undefined : costedAntijoin(run, q, node, from)
  // Window functions (M5.6) write into slots past the FROM row.
  const windowBase = from?.width ?? 0
  const windows = windowed ? new WindowSink(compileContext(run, lookup, 'window order by'), windowBase, node.windows) : undefined

  // The select list, `*` expanded. A table a correlated, aggregating scalar
  // subquery in it reads is reported nullable there (8.4.11: `SELECT a.x,
  // (SELECT MAX(b.id) FROM b WHERE b.id = a.id) FROM a` drops `a.x`'s
  // NOT_NULL, the same without the MAX does not).
  const nullableTables = scope === undefined ? new Set<string>() : aggregatingSubqueryTables(node, scope)
  const selectScope: Scope = nullableTables.size === 0 || scope === undefined ? lookup : nullableView(scope, nullableTables)
  const items: { name: string; compiled: Compiled; alias?: string; expr: Expression }[] = []
  const selectCtx = compileContext(run, selectScope, 'field list', windows)
  for (const entry of selectList(run, node, scope)) {
    const { item, slot } = entry
    const compiled = slot === undefined ? compile(item.expr, selectCtx)
      : readSlot(slot.index, nullableTables.has(scope?.columnAt(slot.index)?.table.alias ?? '') ? { ...slot.type, nullable: true } : slot.type)
    items.push({ ...item, name: selectName(entry, scope), compiled })
  }
  // Read through the windows' temporary table: every column a field of it (8.4.11: `id` loses PRI).
  windowColumns(items, windows)
  const [limitCount, offset] = queryLimit(run, q)
  const checkedOutput = anti?.kind === 'correlated' && checkedCorrelatedOutput(node, q, source, items, anti.query)
  let checkedWhere = false
  let whereCtx = compileContext(run, lookup, 'where clause')
  if (anti?.kind === 'correlated') {
    const key = compile(anti.key, whereCtx)
    const subquery = whereCtx.subquery!
    whereCtx = { ...whereCtx, subquery(query, outer) {
      const source = subquery(query, outer)
      // Keep original binding/registration; stop only this proved source,
      // after its equality qualifies a row, before asking for another.
      if (query !== anti.query) return source
      const checked = checkedOutput && source.checkRead !== undefined
      checkedWhere = checked
      return {
        columns: source.columns,
        get correlated() { return source.correlated },
        hasFrom: source.hasFrom,
        rows(env) {
          const outer = env.outer?.[0]
          if (outer !== undefined && key.eval(outer, env) === null) {
            // Broader projection startup remains a separate migration. In the
            // checked cohort, validate before suppressing a NULL-key search.
            if (!checkedOutput) return []
            if (checked) { source.checkRead!(env); return [] }
            // A source without the capability retains its qualified reader.
          }
          return limit(source.rows(env), 0, 1)
        },
      }
    } }
  }
  const resolved = resolveCondition(run, whereCtx, node.where, limitCount)
  const constants = constRows(run, from, node)

  // An ORDER BY item that reads only a STRAIGHT_JOIN's const tables is a constant, which nothing sorts by (8.4.11).
  const constantKey = (o: OrderItem): boolean => constants.size > 0 && !refersToRow(sortExpression(o.expr, items), lookup, constants)

  // `SELECT DISTINCT` is run through a temporary table — which changes the
  // metadata a client sees — unless the select list holds a whole key of NOT
  // NULL columns, in which case every row is distinct already and MySQL drops
  // the DISTINCT.
  let dataColumns: ((trx: Trx | undefined) => readonly ResultType[]) | undefined
  // What runs through a temporary table, as the metadata rules below decide: EXPLAIN shows the same.
  let deduplicated = false
  let constantDistinct: 'group' | 'limit' | undefined
  let streamed = false
  const sortBy = scope === undefined ? undefined : sortTable(order.map((o) => o.expr), undefined, items, scope)
  const keep = offset + (limitCount ?? Infinity)
  const semi = from === undefined || windowed || !semijoin ? undefined : costedIntegerSemijoin(run, q, node, from, sortBy, keep)
  if (semi !== undefined) {
    from = semi.from
    if (semi.innerFirst) source = undefined
  }
  const loopSemijoin = semijoin && scope !== undefined && (semi !== undefined || (anti !== undefined && anti.kind !== 'hash') || nestedLoopSemijoin(node.where, scope))
  if (from !== undefined) from.sortedBy(sortBy, keep)
  if (from !== undefined && node.distinct === true) from.distinctReads(keyAliases(items.map((i) => i.expr), items, scope!))
  const facts = source === undefined ? undefined : resolved.facts(source.def, source.alias)
  // A prepare reports a statement before MySQL optimizes it, so it never sees
  // the temporary table: COM_STMT_PREPARE's metadata has no GROUP_FLAG where
  // the execute's does (8.4.11, found by review).
  // A bounded unordered DISTINCT copies fields even over an indexed prefix.
  // Only whole-key uniqueness can remove that boundary; PREPARE precedes it.
  if (node.distinct === true && source !== undefined && facts !== undefined && run.preparing !== true && !distinctKey(source.def, items, lookup, limitCount !== undefined && q.orderBy === undefined)) {
    const pinnedName = (item: { compiled: Compiled }): boolean => {
      const name = item.compiled.type.column?.orgName.toLowerCase()
      return name !== undefined && facts.pins.has(name)
    }
    // The range optimizer's proofs too: `g BETWEEN NULL AND 4` over an indexed `g` (8.4.11).
    const impossible = facts.impossible || (from !== undefined && selectFacts(run, from, node, keep).empty)
    // LIMIT eliminates initialization only when count plus OFFSET is zero.
    const constant = keep === 0 || impossible || facts.constTable || items.every(pinnedName)
    if (!constant) {
      deduplicated = true
      const copied = new Set<string>()
      const fieldCtx = compileContext(run, lookup, 'field list')
      // A constant is not copied into the table: `SELECT DISTINCT NULL, x`
      // reports its NULL as it always does (8.4.11).
      for (const item of items) {
        if (!refersToRow(item.expr, lookup)) continue
        item.compiled = decimalField(item.compiled)
        // Read through a window's table already, a column keeps what that gives it (8.4.11).
        if (item.compiled.type.temporary === 'stream') continue
        // Fields can share key membership while retaining separate evaluators.
        // Only local source fields and proved deterministic SIGNED casts qualify.
        const e = item.expr
        const key = e.kind === NODE.COLUMN || e.kind === NODE.CAST ? JSON.stringify(expressionIdentity(e, fieldCtx, run.env, 'field')) : undefined
        const repeated = key !== undefined && copied.has(key)
        if (key !== undefined) copied.add(key)
        // A bounded unordered table copies fields without GROUP_FLAG (8.4.11).
        patchType(item, { temporary: repeated || pinnedName(item) || (limitCount !== undefined && q.orderBy === undefined) ? 'pinned' : true })
      }
    }
  } else if (from !== undefined && scope !== undefined && run.preparing !== true && (source === undefined || (semijoin && semijoinSubqueries(node.where).some((sq) => !emptySubquery(run, sq))) || (q.orderBy !== undefined && node.items.some((i) => correlatedIn(i.expr, scope)))) && (node.distinct === true || order.length > 0)) {
    // Over a join, a DISTINCT is a temporary table and a sort reads the join's
    // rows streamed into one ("Stream results"): every item that reads the row
    // is copied, a column losing its key flags without gaining GROUP_FLAG, an
    // expression keeping only NOT_NULL (8.4.11, M5.18's corpus) — unless the
    // optimizer proved the result empty, when there is no table at all.
    const facts = selectFacts(run, from, node, keep)
    // A sort over the first table alone, ahead of nested-loop joins or a
    // nested-loop semijoin, needs no stream.
    // An ORDER BY on columns the WHERE holds to constants orders nothing, and
    // MySQL drops it before it plans a sort (8.4.11: `WHERE SCHEMA_NAME = ?
    // ORDER BY SCHEMA_NAME` over INFORMATION_SCHEMA's join streams nothing).
    const constantOrder = node.distinct !== true && order.every((o) => (o.expr.kind === NODE.COLUMN && pinnedByWhere(node.where, o.expr.parts)) || constantKey(o))
    const sortedFirst = constantOrder || (node.distinct !== true && (source === undefined ? from.sortsFirst(keyAliases(order.map((o) => o.expr), items, lookup)) : loopSemijoin && !node.items.some((i) => correlatedIn(i.expr, scope))))
    const consts = new Set(facts.constTables.map((t) => t.alias))
    const fixed = new Set([...consts, ...(facts.nullTables ?? [])])
    // With every other table a constant, a DISTINCT is one table's, and its
    // temporary table is keyed as one table's is: GROUP_FLAG on what can be
    // NULL (8.4.11: `SELECT DISTINCT b.nl, a.x FROM a LEFT JOIN b ON FALSE`).
    const rest = from.tables.filter((t) => !fixed.has(t.alias))
    const alone = node.distinct === true && source === undefined && rest.length === 1
    // …and one that selects that table's unique key is no DISTINCT at all (8.4.11: `SELECT DISTINCT
    // lt.n, p1.name FROM lt LEFT JOIN pa AS p1 ON … AND p1.id <> NULL` reads lt alone, flags kept).
    const keyed = alone && facts.nullTables !== undefined && rest[0]?.def !== undefined && distinctKey(rest[0].def, items, lookup)
    // A DISTINCT of constants alone is one row (8.4.11): over NULL-complemented tables a `Group` of what
    // is read, keeping each column's flags; over const tables' rows the first row into a temporary table.
    const exprs = items.map((i) => i.expr)
    const reads = exprs.some((e) => refersToRow(e, lookup))
    if (node.distinct === true && source === undefined && !facts.empty && rest.length > 0 && reads && exprs.every((e) => !refersToRow(e, lookup, fixed))) {
      // …but with a LIMIT, NULL-complemented columns are deduplicated as any others.
      const nullOnly = facts.nullTables !== undefined && exprs.every((e) => !refersToRow(e, lookup, facts.nullTables))
      constantDistinct = !nullOnly ? 'limit' : limitCount === undefined ? 'group' : undefined
    }
    if (!facts.empty && !semijoinEmpty(run, node.where) && !sortedFirst && !keyed && constantDistinct !== 'group') {
      if (node.distinct === true) deduplicated = true
      else streamed = true
      const own = items.map((i) => i.compiled.type)
      items.forEach((item) => {
        if (!refersToRow(item.expr, lookup, consts)) return
        const temporary = !alone ? 'stream' : refersToRow(item.expr, lookup, fixed) ? true : 'pinned'
        patchType(item, { temporary })
        if (node.distinct === true) item.compiled = decimalField(item.compiled)
      })
      dataColumns = copiedColumns(run, facts, own, items)
    }
  }

  // The WHERE, compiled where MySQL resolves it, after the select list: a FROM
  // applies it itself, each condition at its iterator (M5.43).
  if (from !== undefined) {
    // A costed antijoin builds once; a nested loop probes its correlated subquery for each row.
    if (semi !== undefined) {
      const whereCtx = compileContext(run, semi.from.scope, 'where clause')
      from.filter(semi.where, (e) => resolved.read(e, whereCtx))
    } else if (anti?.kind === 'materialized' || anti?.kind === 'correlated') {
      from.filter(undefined, resolved.read)
    } else if (anti?.kind === 'hash') {
      from.filter(undefined, resolved.read)
      from.hashAntijoin(anti.key, (trx, env) => anti.inner.rows(trx, env), () => anti.plan)
    } else {
      const semijoins = source !== undefined && loopSemijoin
      from.filter(node.where, resolved.read, semijoins ? (e) => semijoinNode(run, e) : undefined)
    }
  }
  const having = node.having === undefined || neverNullTest(node.having) ? undefined : resolveCondition(run, compileContext(run, selectedOnly(lookup, items, [], node.having), 'having clause'), substituteAliases(node.having, items), limitCount).predicates
  const orderCtx = compileContext(run, lookup, 'order clause', windows)
  const base = !windowed && having === undefined && unhintedBase(q, node) && source
  const initialize: Compiled[] = []
  // The admitted single-base reader has no const-table ORDER keys to omit.
  let rowOrder = true
  const keys = order.filter((o) => !constantKey(o)).map((o) => {
    const key = orderKey(o, items, orderCtx)
    const e = sortExpression(o.expr, items)
    rowOrder &&= constantNode(e, true, true) && refersToRow(e, lookup)
    if (base && node.where === undefined && limitCount !== 0 && e?.kind === NODE.SUBQUERY) {
      const bound = run.subqueries?.find((s) => s.query === e.query)
      // Only ordinary single-base queries with bound independence enter this startup role.
      if (bound?.plan.source && !bound.correlated && constantNode(e.query, true, true)) initialize.push(key.expr)
    }
    return key
  })
  // Resolve every ORDER BY first: name errors precede DISTINCT admission.
  const copied = node.distinct === true && source !== undefined && scope !== undefined && !windowed && modeOf(run.env.session.sqlMode).onlyFullGroupBy ? checkDistinctOrder(run, order, items, orderCtx)?.filter((_, i) => !constantKey(order[i] as OrderItem)) : undefined
  // A window ORDER BY alone names reads the rows through its table as well.
  windowColumns(items, windows)
  // A MATCH in the WHERE of one table is read through its full-text index,
  // which yields rows by relevance, highest first: with no ORDER BY of its
  // own that is the order they come in (8.4.11, M5.26).
  const match = keys.length === 0 && refs.length === 1 && refs[0]?.kind === REF.TABLE ? splitAnd(node.where).find((c) => c.kind === NODE.MATCH) : undefined
  if (match !== undefined) keys.push({ expr: compile(match, compileContext(run, lookup, 'where clause')), desc: true })
  const locking = (q.locking?.length ?? 0) > 0
  // Metadata's indexed-prefix shortcut does not prove row uniqueness.
  // An outer field with the same name cannot supply a local UNIQUE key.
  const deduplicate = node.distinct === true && (source === undefined || !distinctKey(source.def, items, lookup, true))
  // An ORDER BY the index the table is read by already gives: read in its order, and nothing to sort.
  const read = source && from!.access(run.env)
  // Windows and hash antijoins still sort their delivered rows, even over an ordered index.
  const outerLoop = (semi?.innerFirst === false || anti?.kind === 'materialized' || anti?.kind === 'correlated') && source !== undefined && sortBy === source.alias
  // Reconsider PRIMARY for ordinary scans and the modeled outer-first loop.
  // A proved UNIQUE projection can reconsider PRIMARY as an ordinary scan does.
  const ordered = source !== undefined && !deduplicated && !windowed && (anti === undefined || anti.kind !== 'hash') && match === undefined && keys.length > 0 && read!.ranges === undefined ? orderingIndex(source.def, source.alias, order, items, lookup, read!.index, (outerLoop || (!loopSemijoin && !deduplicate)) && optimizerEnabled(run.env, 'prefer_ordering_index')) : undefined
  if (ordered !== undefined) from!.readInOrder(ordered.index, false, ordered.reverse, source!.alias)
  // Only whole scans can be replaced above, so this selected range is final.
  // A pinned complete PRIMARY point binds ORDER but needs none of its readers.
  const point = read?.ranges?.length === 1 ? read.ranges[0] : undefined
  if (base && point?.from?.values.length === 1 && point.from === point.to && base.def.indexes.some((i) => i.name === read!.index && i.kind === 'primary' && i.parts.length === 1 && facts?.pins.has(i.parts[0]!.column.toLowerCase()))) keys.length = 0
  const sortedFirst = outerLoop && ordered === undefined && keys.length > 0
  if (sortedFirst) from!.sortFirst(source!.alias, keys)
  // Whole single-table integer sorts have a known fixed record layout and
  // source estimate. Do not infer queue eligibility from the rows emitted.
  let buffer: { estimate: number; capacity: number } | undefined
  if (keep < 16 && ordered === undefined && source !== undefined && run.catalog !== undefined && read!.ranges === undefined && node.where === undefined && having === undefined && !windowed && !locking && node.distinct !== true && keys.length > 0 && keys.every((k) => exactInteger(k.expr)) && scope!.tables[0]!.columns.every(exactInteger)) {
    const readColumns = reads?.get(source.alias)
    const columns = source.def.columns.filter((c) => readColumns === 'all' || readColumns?.has(c.name.toLowerCase()))
    const width = keys.reduce((n, k) => n + 8 + Number(k.expr.type.nullable), 0)
      + columns.reduce((n, c) => n + (storageWidth(c.type) as number), 0)
      + Math.ceil(columns.filter((c) => c.nullable).length / 8)
    const memory = Number(toInteger(run.state.systemVariable('sort_buffer_size', undefined, run.env.session) ?? intValue(262144n)))
    buffer = { estimate: statisticsOf(source.def, source.table, run.catalog.store).rows, capacity: Math.floor(memory / (width + 8)) }
  }

  // Ordinary readers apply LIMIT after sorting and before SELECT evaluation.
  // Multi-table copies, written HAVING and windows retain their materialization boundary.
  const limitFirst = !windowed && !node.distinct && !loopSemijoin && (ordered === undefined ? !node.having && (source !== undefined || !streamed) : having === undefined)
  const readerReady = !windowed && (wholeReaderReady(q, node) || checkedWhere) && (from === undefined
    ? !order.length
    : !node.distinct && ((base && (!order.length || rowOrder || (checkedWhere && sortedFirst))) || (!order.length && !q.with && !node.options && from.tables.length === 1 && from.tables[0]?.derived)))
  const take = q.limit && limitStage(offset, limitCount)
  const stages: Stage[] = [
    ...(from === undefined && node.where !== undefined ? [filterStage(resolved.predicates)] : []),
    ...(anti?.kind === 'materialized' ? [filterStage(anti.read, undefined, anti.plan)] : []),
    // Retain the clause's bound correlated reader above its physical outer sort.
    ...(anti?.kind === 'correlated' ? [filterStage(resolved.predicates, undefined, semijoinNode(run, node.where!, anti.explicitLimit)?.children[0])] : []),
    // HAVING without grouping filters the rows WHERE kept, before any window sees them.
    ...(having === undefined ? [] : [filterStage(having, run)]),
    ...(windows === undefined || windows.windows.length === 0 ? [] : [windowStage(windows)]),
    deliverStage(items.map((i) => i.compiled), ordered === undefined && !sortedFirst ? keys : [], deduplicate, { deduplicated, streamed, copied, keep: q.limit && keep, buffer, constant: constantDistinct, limit: limitFirst ? take : undefined }),
    ...(!limitFirst && take ? [take] : []),
  ]
  return {
    ...resultColumns(items, dataColumns),
    source,
    locking,
    ...(source?.table.checkRead === undefined ? {} : {
      checkRead(env: Env) { source.table.checkRead!(env.trx, locking ? 'current' : 'consistent', from!.access(env).index) },
    }),
    optimize(trx) {
      if (!initialize.length) return
      const env = executionEnv(run, trx)
      for (const read of initialize) read.eval([], env)
    },
    explain() {
      // An empty result the optimizer proves is no plan at all.
      if (facts?.impossible === true || provedEmpty(run, from, node, keep)) return [planNode('Zero rows')]
      // A constant table is read while planning: its row, if the WHERE holds of it, is all there is to fetch.
      // An uncorrelated scalar subquery a unique key equals is evaluated while planning too, so it pins the key (8.4.11).
      if ((from?.single !== undefined && (facts?.constTable === true || subqueryPinsKey(from.single.def, from.single.alias, node.where, from.scope))) || (from !== undefined && from.tables.every((t) => t.derived?.constant === true))) {
        for (const _ of from.rows(undefined, run.env, { locking: false })) return [planNode('Rows fetched before execution')]
        return [planNode('Zero rows')]
      }
      const source = from === undefined ? planNode('Rows fetched before execution') : withSubqueries(run, from.explain(run.env), 'where clause')
      const n = describeStages(source, stages)
      return n === undefined ? undefined : [n, ...subqueryNodes(run, 'field list')]
    },
    rows(trx, given, ready) {
      // A zero count with no offset has no iterator to initialize, including its sort.
      if (keep === 0 && !windowed) return []
      let env = executionEnv(run, trx, given)
      if (anti?.kind === 'materialized' && env.memo === undefined) env = { ...env, memo: new Map() }
      let rows: Iterable<Rowed>
      if (from === undefined) {
        rows = [{ row: [] }]
        // The unit source is ready before ordinary projection, just as a physical reader is.
        if (readerReady) ready?.()
      } else if (facts?.impossible === true) rows = []
      else rows = from.rows(trx, env, { locking, ready: readerReady ? ready : undefined })
      return values(runStages(rows, stages, env))
    },
  }
}

/** Filter one grouped derived COUNT output before its rows are materialized (M5.49). */
function pushCountCondition(run: Run, node: SelectNode): SelectNode {
  const ref = node.from?.[0]
  const where = node.where
  if (node.from?.length !== 1 || ref?.kind !== REF.DERIVED || ref.lateral === true || ref.columns !== undefined || ref.alias === undefined) return node
  if (where?.kind !== NODE.BINARY || !['=', '<>', '!=', '<', '<=', '>', '>='].includes(where.op) || where.left.kind !== NODE.COLUMN) return node
  if (where.right.kind !== NODE.PLACEHOLDER && !(where.right.kind === NODE.LITERAL && (where.right.type === LITERAL.INT || where.right.type === LITERAL.NULL))) return node
  const parts = where.left.parts
  if (parts.length !== 1 && !(parts.length === 2 && parts[0]?.toLowerCase() === ref.alias.toLowerCase())) return node
  const query = ref.query
  const body = query.body
  if (query.with !== undefined || query.limit !== undefined || query.orderBy !== undefined || query.locking !== undefined || body.kind !== QUERY.SELECT || body.groupBy === undefined || body.groupBy.rollup === true || body.having !== undefined || body.windows !== undefined || body.distinct === true || (body.options?.length ?? 0) > 0) return node
  const count = (e: Expression): boolean => e.kind === NODE.CALL && nativeCallName(e) === 'COUNT' && e.over === undefined && e.args.length === 1 && e.args[0]?.kind === NODE.COLUMN
  // Columns and COUNT of a column or star cannot assign variables or evaluate volatile expressions.
  if (!body.items.every((i) => i.expr.kind === NODE.COLUMN || count(i.expr)) || !body.groupBy.items.every((e) => e.kind === NODE.COLUMN || integerLiteral(e))) return node
  const name = parts[parts.length - 1]?.toLowerCase()
  const matches = body.items.filter((i) => (i.alias ?? (i.expr.kind === NODE.COLUMN ? i.expr.parts[i.expr.parts.length - 1] : undefined))?.toLowerCase() === name)
  const item = matches.length === 1 ? matches[0] : undefined
  if (item === undefined || !count(item.expr)) return node
  if (!optimizerEnabled(run.env, 'derived_condition_pushdown')) return node
  const having: Expression = { ...where, left: item.expr }
  const { where: _where, ...rest } = node
  return { ...rest, from: [{ ...ref, query: { ...query, body: { ...body, having } } }] }
}

// --- the stages above the FROM (M5.43) -----------------------------------------------

/** A Filter or keyed antijoin; HAVING includes the clause's subquery plans. */
function filterStage(condition: Pick<Compiled, 'eval'> | readonly Pick<Compiled, 'eval'>[], having?: Run, antijoin?: PlanNode): Stage {
  return {
    run: (rows, env) => filter(rows, condition, env),
    describe(n) {
      if (antijoin !== undefined) return planNode('Nested loop antijoin', [n, antijoin])
      const out = planNode('Filter', [n])
      return having === undefined ? out : withSubqueries(having, out, 'having clause')
    },
  }
}

/** Window functions (M5.6), over the whole input: not yet named as 8.4.11 names them, so not explained. */
function windowStage(windows: WindowSink): Stage {
  const base = windows.base
  return {
    run(rows, env) {
      const width = base + windows.windows.length
      const all = Array.from(rows, ({ row }) => {
        const r = row.slice() as Value[]
        while (r.length < width) r.push(null)
        return r
      })
      return rowed(applyWindows(all, windows.windows, env, base))
    },
    describe: () => undefined,
  }
}

/**
 * ORDER BY, the select list and DISTINCT, as one iterator. The server writes
 * DISTINCT's rows into a temporary table and sorts that. Selected aliases,
 * positions and columns sort their copied values here, without evaluating
 * their expressions again. Unmapped sort expressions retain the old order
 * of evaluation; only verified repeated SIGNED casts also name copied slots.
 * Other repeated expressions remain open (M5.49). A sort
 * over a join reads its rows streamed into a table first ("Stream results").
 */
function deliverStage(items: readonly Compiled[], keys: readonly SortKey[], deduplicate: boolean, through: { readonly deduplicated: boolean; readonly streamed: boolean; readonly copied?: readonly (number | undefined)[] | undefined; readonly described?: boolean; readonly keep?: number | undefined; readonly buffer?: { readonly estimate: number; readonly capacity: number } | undefined; readonly constant?: 'group' | 'limit' | undefined; readonly limit?: Stage | undefined }): Stage {
  // A LIMIT needs only its first rows of the order, unless a DISTINCT between would drop some.
  const keep = deduplicate ? undefined : through.keep
  const ordered = keys.length > 0
  const bounded = through.keep !== undefined && !ordered
  const copied = through.deduplicated ? keys.flatMap((key, i) => {
    const column = key.expr.type.column
    const index = through.copied?.[i] ?? items.findIndex((item) => item === key.expr || (column !== undefined && item.type.column === column))
    return index < 0 ? [] : [{ desc: key.desc, expr: readSlot(index, key.expr.type) }]
  }) : []
  return {
    run(rows, env) {
      if (ordered && copied.length === keys.length) return sort(rowed(distinct(project(rows, items, env))), copied, env)
      const sorted = ordered ? sort(rows, keys, env, keep, through.buffer) : rows
      let projected = project(through.limit?.run(sorted, env) ?? sorted, items, env)
      if (deduplicate) projected = distinct(projected)
      // Initialize a bounded temporary table even when the enclosing LIMIT returns no rows.
      if (through.deduplicated && bounded) return rowed([...limit(projected, 0, through.keep)])
      return rowed(projected)
    },
    describe(n) {
      if (through.described === false) return undefined
      // A LIMIT with nothing to sort above the temporary table stops filling it once it holds enough (8.4.11).
      if (through.constant === 'group') return planNode('Group (no aggregates)', [n])
      if (through.constant === 'limit') return planNode('Limit: 1 row(s)', [planNode('Table scan on <temporary>', [planNode('Temporary table', [bounded ? planNode(`Limit table size: ${through.keep} row(s)`, [n]) : n])])])
      let out = through.deduplicated ? planNode('Table scan on <temporary>', [planNode('Temporary table with deduplication', [bounded ? planNode(`Limit table size: ${through.keep} unique row(s)`, [n]) : n])]) : n
      if (ordered) out = planNode('Sort', [wrap(through.streamed, 'Stream results', out)])
      return through.limit?.describe(out) ?? out
    },
  }
}

/** Patch output metadata without replacing the expression's evaluator. */
function patchType(item: { compiled: Compiled }, type: Partial<ResultType>): void {
  item.compiled = { ...item.compiled, type: { ...item.compiled.type, ...type } }
}

/** Mark fields copied by SELECT windows or windows introduced by ORDER BY. */
function windowColumns(items: readonly { compiled: Compiled }[], windows: WindowSink | undefined): void {
  if (windows !== undefined && windows.windows.length > 0) {
    for (const item of items) if (item.compiled.type.temporary === undefined) patchType(item, { temporary: 'stream' })
  }
}

/** Both planners report copied field metadata from the current execution's facts. */
function resultColumns(items: readonly { name: string; compiled: Compiled }[], read?: (trx: Trx | undefined) => readonly ResultType[]): Pick<SelectPlan, 'columns' | 'columnsAt'> {
  const columns = items.map((i) => ({ name: i.name, type: i.compiled.type }))
  return {
    columns,
    columnsAt: read && ((trx) => read(trx).map((type, i) => ({ name: columns[i]!.name, type }))),
  }
}

/** LIMIT and OFFSET. */
function limitStage(offset: number, count: number | undefined): Stage {
  return {
    run: (rows) => limit(rows, offset, count),
    describe: (n) => planNode(offset > 0 ? 'Limit/Offset' : 'Limit', [n]),
  }
}

function* rowed(rows: Iterable<readonly Value[]>): Generator<Rowed> {
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
    if (s.clause !== clause || !firstKey(seen, s.query)) continue
    const roots = s.plan.explain?.()
    const how = run.quantified?.get(s.query)
    const rewritten = how === undefined || how.correlated ? undefined : quantifiedPlan(run, s.query, how, topLevel(run.clauses?.[clause], s.query), roots)
    out.push(planNode(`Select #${selectNumber(run, s.query)}`, rewritten !== undefined ? [rewritten] : roots))
  }
  return out
}

/**
 * Whether the predicate comparing with `query` stands at the top of a WHERE
 * or HAVING, under nothing but AND and OR: there a NULL is as good as false,
 * so an IN need not tell them apart.
 */
function topLevel(root: Expression | undefined, query: QueryExpression): boolean {
  if (root === undefined) return false
  if (root.kind === NODE.BINARY && ['AND', 'OR', '&&', '||'].includes(root.op.toUpperCase())) return topLevel(root.left, query) || topLevel(root.right, query)
  return root.kind === NODE.BINARY && root.right.kind === NODE.SUBQUERY && root.right.query === query
}

/**
 * How 8.4.11 runs an uncorrelated `[NOT] IN`, `= ALL` or `<> ANY` subquery it
 * does not join (M5.47), as its plan shows; `undefined` for any other shape.
 * The subquery is one column of one base table. An equality over an indexed
 * column becomes EXISTS: a `Limit` of one over a lookup by the outer value,
 * with a Filter for its WHERE. Where a NULL is not as good as false — NOT IN,
 * outside the top of a WHERE — a nullable inner column adds two Filters (its
 * `<is_not_null_test>`, then the equality or its NULL), and a nullable outer
 * value one, over `Alternative plans for IN subquery`: the lookup, or a scan
 * when the outer value is NULL. An equality over a column no index leads is
 * materialized instead, deduplicated, and looked up by its own key. `= ALL`
 * and `<> ANY` are EXISTS over a scan, the comparison its Filter. Each shape,
 * and each count of Filters, as 8.4.11 printed it for every combination of
 * nullable and indexed (M5.47's probes).
 */
function quantifiedPlan(run: Run, query: QueryExpression, how: QuantifiedSubquery, top: boolean, roots: readonly PlanNode[] | undefined): PlanNode | undefined {
  const body = query.body
  if (body.kind !== QUERY.SELECT || query.with !== undefined || query.orderBy !== undefined || body.groupBy !== undefined || body.having !== undefined || body.windows !== undefined) return undefined
  const ref = body.from?.length === 1 ? body.from[0] : undefined
  const item = body.items.length === 1 ? body.items[0]?.expr : undefined
  if (ref?.kind !== REF.TABLE || item === undefined) return undefined
  const def = definitionForProof(run, ref.table)
  if (def === undefined) return undefined
  const alias = ref.alias ?? ref.table.name
  const column = tableColumn(item, def, alias)
  if (column === undefined) return undefined
  const equality = (how.op === '=' && how.quantifier === 'ANY') || (how.op === '<>' && how.quantifier === 'ALL')
  if (!equality && !(how.op === '=' && how.quantifier === 'ALL') && !(how.op === '<>' && how.quantifier === 'ANY')) return undefined
  const nulls = !top || !equality || how.op === '<>'
  const read = keyReads(column.name, body.where)
  const index = def.indexes.find((i) => i.invisible !== true && i.parts[0]?.column === column.name && i.parts[0].prefix === undefined)
  const where = body.where !== undefined ? 1 : 0
  let access: PlanNode
  let filters: number
  if (equality) {
    if (index === undefined) {
      const materialized = planNode('Materialize with deduplication', roots)
      return planNode('Filter', [planNode('Limit', [planNode('Index lookup on <materialized_subquery> using <auto_distinct_key>', [materialized])])])
    }
    const unique = index.parts.length === 1 && (index.kind === 'primary' || index.kind === 'unique')
    const covering = holdsRead(def, index, read)
    access = indexLookup(alias, index.name, unique, covering)
    if (nulls && how.outerNullable) access = planNode('Alternative plans for IN subquery', [access, planNode(`Table scan on ${alias}`)])
    filters = Math.max(nulls ? (column.nullable ? 2 : how.outerNullable ? 1 : 0) : 0, where)
  } else {
    const cover = def.indexes.find((i) => holdsRead(def, i, read) && i.kind !== 'primary')
    access = planNode(cover === undefined ? `Table scan on ${alias}` : `Covering index scan on ${alias} using ${cover.name}`)
    filters = column.nullable ? 2 : 1
  }
  for (let i = 0; i < filters; i++) access = planNode('Filter', [access])
  return planNode('Limit', [access])
}

/** A lookup key and the columns its residual condition reads, by folded name. */
function keyReads(column: string, where: unknown): Set<string> {
  const read = new Set([column.toLowerCase()])
  for (const parts of columnRefs(where)) read.add((parts.at(-1) as string).toLowerCase())
  return read
}

/** BIT and YEAR have their own comparison representations rather than exact integer keys. */
function exactInteger(c: { readonly type: ResultType }): boolean {
  return c.type.kind === 'int' && c.type.field !== FIELD_TYPE.BIT && c.type.field !== FIELD_TYPE.YEAR
}

/** Structural boundary shared by the bounded semijoin and antijoin candidates. */
type BaseSubquery = SelectNode & { readonly from: readonly [Extract<TableReference, { kind: typeof REF.TABLE }>]; readonly items: readonly [SelectNode['items'][number]] }

function boundedSubquery(q: QueryExpression): BaseSubquery | undefined {
  const body = q.body
  return q.limit === undefined && q.orderBy === undefined && q.locking === undefined && body.kind === QUERY.SELECT && unhintedBase(q, body) !== undefined && body.items.length === 1 && body.groupBy === undefined && body.having === undefined && body.distinct !== true ? body as BaseSubquery : undefined
}

/** The unhinted single base-table shape shared by outer and inner join proofs. */
function unhintedBase(q: QueryExpression, node: SelectNode) {
  const table = node.from?.[0]
  return node.from?.length === 1 && table?.kind === REF.TABLE && table.indexHints === undefined && q.with === undefined && node.windows === undefined && (node.options?.length ?? 0) === 0 ? table : undefined
}

/** Written binding/initialization fences, after the caller proves its source shape. */
function wholeReaderReady(q: QueryExpression, node: SelectNode): boolean {
  return !node.where && !node.having && !node.windows && !q.locking?.length &&
    !someNode([node, q.orderBy], (n) => (n as Expression).kind === NODE.MATCH || undefined)
}

/** Joint visibility/header migration: bound canonical columns, no alias constructors. */
function checkedCorrelatedOutput(node: SelectNode, q: QueryExpression, source: FromPlan['single'], items: readonly { readonly expr: Expression; readonly alias?: string; readonly compiled: Compiled }[], query: QueryExpression): boolean {
  const parent = node.from?.[0]
  const body = boundedSubquery(query)
  const inner = body?.from[0]
  if (source === undefined || parent?.kind !== REF.TABLE || inner?.kind !== REF.TABLE || node.windows !== undefined || parent.alias !== undefined || inner.alias !== undefined || body?.items[0].alias !== undefined) return false
  const simple = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
  if (parent.table.name !== source.def.name || ![source.def.schema, parent.table.name, parent.table.schema, inner.table.name, inner.table.schema].every((name) => name === undefined || simple(name))) return false
  const equality = body?.where
  if (equality?.kind !== NODE.BINARY || ![equality.left, equality.right].every((e) => e.kind === NODE.COLUMN && e.parts.every(simple))) return false
  const column = (e: Expression): boolean => e.kind === NODE.COLUMN && e.parts.length === 1 && simple(e.parts[0]!) && source.def.columns.some((c) => c.name === e.parts[0])
  if (!items.length || !items.every((i) => i.alias === undefined && i.compiled.type.column !== undefined && column(i.expr))) return false
  return (q.orderBy ?? []).every(({ expr }) => column(expr) || (expr.kind === NODE.LITERAL && expr.type === LITERAL.INT && typeof expr.value === 'bigint' && expr.value > 0n && expr.value <= BigInt(items.length)))
}

type QualifiedColumn = Extract<Expression, { kind: typeof NODE.COLUMN }> & { readonly parts: readonly [string, string] }

function isQualifiedColumn(e: Expression, alias: string, fold = false): e is QualifiedColumn {
  return e.kind === NODE.COLUMN && e.parts.length === 2 && typeof e.parts[1] === 'string' && (fold ? e.parts[0]?.toLowerCase() === alias.toLowerCase() : e.parts[0] === alias)
}

/** The qualified equality and at most one residual shared by correlated join candidates. */
function correlatedPair(where: Expression | undefined, inner: string, outer: string, fold = false) {
  const parts = splitAnd(where)
  if (parts.length > 2) return undefined
  for (const equality of parts) {
    if (equality.kind !== NODE.BINARY || equality.op !== '=') continue
    let innerKey = equality.left
    let outerKey = equality.right
    if (!isQualifiedColumn(innerKey, inner, fold) || !isQualifiedColumn(outerKey, outer, fold)) {
      innerKey = equality.right
      outerKey = equality.left
      if (!isQualifiedColumn(innerKey, inner, fold) || !isQualifiedColumn(outerKey, outer, fold)) continue
    }
    return { innerKey, outerKey, extra: parts.find((e) => e !== equality) }
  }
  return undefined
}

/** Existing root-session plan proofs may decline a missing definition; binding reports the name error. */
function definitionForProof(run: Run, name: TableName): TableDef | undefined {
  try {
    return run.catalog?.definition(name.schema ?? run.env.session.database ?? '', name.name)
  } catch (e) {
    expectTyped(e)
    return undefined
  }
}

/** Costed join alternatives read definitions without reopening temporary tables. */
function nonTemporaryDefinition(run: Run, table: { readonly schema?: string; readonly name: string }): TableDef | undefined {
  const schema = table.schema ?? defaultDatabase(run)
  const def = schema === null ? undefined : run.catalog?.definition(schema, table.name)
  return def === undefined || isTemporary(def) ? undefined : def
}

/** Both costed join proofs require one nontemporary outer table in the root query. */
function joinOuter(run: Run, q: QueryExpression, node: SelectNode, from: FromPlan) {
  return run.parent === undefined && from.single !== undefined && !isTemporary(from.single.def) ? unhintedBase(q, node) : undefined
}

/** A bounded integer semijoin using the existing cost search and indexed join iterators. */
function costedIntegerSemijoin(run: Run, q: QueryExpression, node: SelectNode, from: FromPlan, sortBy: string | undefined, keep: number): { readonly from: FromPlan; readonly where: Expression; readonly innerFirst: boolean } | undefined {
  const outer = joinOuter(run, q, node, from)
  const where = node.where
  if (outer === undefined || node.having !== undefined || node.distinct === true) return undefined
  const sub = positiveSubquery(where)
  if (sub === undefined) return undefined
  const body = boundedSubquery(sub)
  if (body === undefined) return undefined
  const inner = body.from[0]
  const item = body.items[0].expr
  const outerAlias = outer.alias ?? outer.table.name
  const innerAlias = inner.alias ?? inner.table.name
  if (outerAlias === innerAlias) return undefined
  const column = (e: Expression | undefined, alias: string): e is Extract<Expression, { kind: typeof NODE.COLUMN }> => e?.kind === NODE.COLUMN && (e.parts.length === 1 || isQualifiedColumn(e, alias))
  let innerKey: Expression | undefined
  let outerKey: Expression | undefined
  let extra = body.where
  if (where?.kind === NODE.BINARY) {
    innerKey = item
    outerKey = where.left
  } else {
    if (!integerLiteral(item)) return undefined
    const pair = correlatedPair(body.where, innerAlias, outerAlias)
    if (pair === undefined) return undefined
    innerKey = pair.innerKey
    outerKey = pair.outerKey
    extra = pair.extra
  }
  if (!column(innerKey, innerAlias) || !column(outerKey, outerAlias)) return undefined
  const innerColumn = innerKey.parts.at(-1) as string
  if (extra !== undefined && !(extra.kind === NODE.BINARY && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(extra.op) && column(extra.left, innerAlias) && extra.right.kind === NODE.LITERAL && numeric(extra.right))) return undefined
  try {
    const def = nonTemporaryDefinition(run, inner.table)
    if (def === undefined) return undefined
    const index = def.indexes.find((i) => i.kind === 'index' && i.invisible !== true && i.parts.length === 1 && i.parts[0]?.column.toLowerCase() === innerColumn.toLowerCase() && i.parts[0].prefix === undefined && i.parts[0].descending !== true)
    if (index === undefined) return undefined
    const qualify = (e: Extract<Expression, { kind: typeof NODE.COLUMN }>, alias: string): Expression => ({ ...e, parts: [alias, e.parts.at(-1) as string] })
    innerKey = qualify(innerKey, innerAlias)
    outerKey = qualify(outerKey, outerAlias)
    if (extra?.kind === NODE.BINARY && extra.left.kind === NODE.COLUMN) extra = { ...extra, left: qualify(extra.left, innerAlias) }
    const equality: Expression = { kind: NODE.BINARY, op: '=', left: innerKey, right: outerKey, at: where?.at ?? node.at }
    const predicate: Expression = and(equality, extra)
    // Keep the outer table's slots first: its logical scope remains the SELECT's scope.
    const alternative = planFrom([outer, inner], fromContext(run), predicate)
    const ctx = compileContext(run, alternative.scope, 'where clause')
    const key = compile(innerKey, ctx)
    if (!exactInteger(key) || !exactInteger(compile(outerKey, ctx)) || (extra?.kind === NODE.BINARY && !exactInteger(compile(extra.left, ctx)))) return undefined
    const read = columnsRead(from.scope, node, q)
    const innerRead = keyReads(innerColumn, extra)
    read.set(innerAlias, innerRead)
    alternative.reads(read)
    alternative.sortedBy(sortBy, keep)
    if (!holdsRead(def, index, innerRead)) return undefined
    const innerFirst = alternative.integerSemijoin(innerAlias, index, key, extra, node.groupBy === undefined && !someNode([node.items, q.orderBy], (n) => (n as { kind?: string }).kind === NODE.SUBQUERY ? true : undefined))
    return innerFirst === undefined ? undefined : { from: alternative, where: predicate, innerFirst }
  } catch (error) {
    expectTyped(error)
    return undefined
  }
}

/** One decorrelatable integer antijoin, costed through the existing preserved-side join planner. */
type Antijoin = { readonly kind: 'correlated'; readonly query: QueryExpression; readonly key: QualifiedColumn; readonly explicitLimit: boolean }
  | { readonly kind: 'materialized'; readonly read: Compiled; readonly plan: PlanNode }
  | { readonly kind: 'lookup' | 'hash'; readonly key: Compiled; readonly inner: SelectPlan; readonly plan: PlanNode }

function costedAntijoin(run: Run, q: QueryExpression, node: SelectNode, from: FromPlan): Antijoin | undefined {
  const outer = joinOuter(run, q, node, from)
  const where = node.where
  if (outer === undefined) return undefined
  const sub = negativeExistsSubquery(where)
  if (sub === undefined || where === undefined) return undefined
  const body = boundedSubquery(sub)
  if (body === undefined) return undefined
  const item = body.items[0].expr
  if (!integerLiteral(item)) return undefined
  if (body.where === undefined) return undefined
  const inner = body.from[0]
  const outerAlias = outer.alias ?? outer.table.name
  const innerAlias = inner.alias ?? inner.table.name
  if (outerAlias.toLowerCase() === innerAlias.toLowerCase()) return undefined
  const pair = correlatedPair(body.where, innerAlias, outerAlias, true)
  if (pair === undefined) return undefined
  const { innerKey, outerKey, extra } = pair
  if (extra !== undefined) {
    if (extra.kind !== NODE.BINARY || !['=', '<>', '!=', '<', '<=', '>', '>='].includes(extra.op)) return undefined
    if (!isQualifiedColumn(extra.left, innerAlias, true) || !integerLiteral(extra.right)) return undefined
  } else if (run.preparing === true || run.env.memo === undefined || q.locking !== undefined || node.distinct === true || node.having !== undefined || someNode([node.items, q.orderBy], (n) => {
    const kind = (n as Expression).kind
    return kind === NODE.SUBQUERY || kind === NODE.MATCH || kind === NODE.CALL || kind === NODE.VARIABLE || undefined
  })) return undefined
  const keyColumn = innerKey.parts[1]
  const predicateColumn = extra === undefined ? undefined : (extra.left as QualifiedColumn).parts[1]
  try {
    const definition = nonTemporaryDefinition(run, inner.table)
    if (definition === undefined) return undefined
    // Cost the preserved-side alternative through the existing join planner.
    // An outer join's ON does not reduce its build estimate, as for this antijoin.
    const alternative = planFrom([{ kind: REF.JOIN, type: 'LEFT', left: outer, right: inner, on: body.where, at: where.at }], fromContext(run))
    const innerTable = alternative.tables.find((t) => t.alias === innerAlias)
    if (innerTable?.def === undefined || innerTable.table === undefined || (predicateColumn !== undefined && innerTable.def.indexes.some((i) => i.parts.some((p) => p.column.toLowerCase() === predicateColumn.toLowerCase())))) return undefined
    if (extra === undefined && [from.single!.def, definition].some((d) => d.columns.some((c) => c.attributes?.['generated'] !== undefined))) return undefined
    const ctx = compileContext(run, alternative.scope, 'where clause')
    if (!exactInteger(compile(innerKey, ctx)) || !exactInteger(compile(outerKey, ctx)) || (extra !== undefined && !exactInteger(compile(extra.left, ctx)))) return undefined
    const read = columnsRead(from.scope, node, q)
    read.set(innerAlias, keyReads(keyColumn, extra))
    alternative.reads(read)
    if (extra === undefined) {
      const strategy = alternative.antijoinStrategy(innerAlias)
      if (strategy === undefined) return undefined
      // The proved correlated alternative keeps its original predicate, with
      // the same outer access/sort placement as the materialized alternative.
      if (strategy === 'lookup') return { kind: 'correlated', query: sub, key: outerKey, explicitLimit: !optimizerEnabled(run.env, 'firstmatch') }
      const { where: _correlation, ...source } = body
      const projected: QueryExpression = { ...sub, body: { ...source, items: [{ expr: innerKey }] } }
      const plan = planQuery(run, projected)
      const described = plan.explain?.()?.[0]
      if (described === undefined) return undefined
      // Exact one-column equality: IN's FALSE and UNKNOWN both mean no matching row.
      // Reuse its invocation-owned membership build, including NULL and failed-build rules.
      const { quantified: _quantified, ...context } = compileContext(run, from.scope, 'where clause')
      const read = compile({ kind: NODE.UNARY, op: 'IS NOT TRUE', at: where.at, operand: {
        kind: NODE.BINARY, op: 'IN', left: outerKey, at: where.at,
        right: { kind: NODE.SUBQUERY, query: projected, at: sub.at },
      } }, { ...context, subquery: () => ({ columns: plan.columns, correlated: false, hasFrom: true, rows: (env) => plan.rows(env.trx, env) }) })
      const nullable = definition.columns.find((c) => c.name.toLowerCase() === keyColumn.toLowerCase())?.nullable === true
      return { kind: 'materialized', read, plan: indexLookup('<subquery2>', '<auto_distinct_key>', true, false, [planNode('Materialize with deduplication', [wrap(nullable, 'Filter', described)])]) }
    }
    const projected: QueryExpression = { ...sub, body: { ...body, items: [{ expr: innerKey }], where: extra } }
    const plan = planQuery(run, projected)
    const described = plan.explain?.()?.[0]
    if (described === undefined) return undefined
    return { kind: alternative.usesLookup(innerAlias) ? 'lookup' : 'hash', key: compile(outerKey, compileContext(run, from.scope, 'where clause')), inner: plan, plan: described }
  } catch (error) {
    expectTyped(error)
    // The ordinary compiler owns errors and their original clause names.
    return undefined
  }
}

/** A nested-loop EXISTS conjunct with its real correlated subquery as the inner iterator. */
function semijoinNode(run: Run, e: Expression, explicitLimit = false): PlanNode | undefined {
  const anti = negativeExistsSubquery(e)
  const query = anti ?? (e.kind === NODE.UNARY && e.op === 'EXISTS' ? positiveSubquery(e) : undefined)
  if (query === undefined) return undefined
  const sub = (run.subqueries ?? []).find((s) => s.query === query)?.plan.explain?.()?.[0]
  return sub === undefined ? undefined : planNode(anti !== undefined ? 'Nested loop antijoin' : 'Nested loop semijoin', [wrap(explicitLimit, 'Limit: 1 row(s)', sub)])
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
  return queryTokens(run).filter((t) => t.start <= at && queryWord(t) === 'SELECT').length
}

/** `IS NOT NULL` of an aggregate that is never NULL — COUNT and the BIT_ aggregates — which the server folds to TRUE and drops (8.4.11: no Filter). */
function neverNullTest(e: Expression): boolean {
  return e.kind === NODE.UNARY && e.op === 'IS NOT NULL' && e.operand.kind === NODE.CALL && ['COUNT', 'BIT_AND', 'BIT_OR', 'BIT_XOR'].includes(nativeCallName(e.operand))
}

/** Whether the WHERE equals a single-column PRIMARY or NOT NULL UNIQUE key to an uncorrelated scalar subquery. */
function subqueryPinsKey(def: TableDef, alias: string, where: Expression | undefined, scope: TableScope): boolean {
  const unique = (e: Expression): boolean => {
    const column = tableColumn(e, def, alias)
    return column !== undefined && !column.nullable && def.indexes.some((i) => i.kind !== 'index' && i.parts.length === 1 && i.parts[0]?.column === column.name && i.parts[0].prefix === undefined)
  }
  return splitAnd(where).some((c) => c.kind === NODE.BINARY && c.op === '=' && ([[c.left, c.right], [c.right, c.left]] as const).some(([key, value]) => value.kind === NODE.SUBQUERY && !correlatedIn(value, scope) && unique(key)))
}

/**
 * Under STRAIGHT_JOIN a const table is not read ahead of the join order but
 * joined as a constant row (M5.48): its aliases, which an ORDER BY over them
 * alone does not sort by, since they are constants.
 */
function constRows(run: Run, from: FromPlan | undefined, node: SelectNode): ReadonlySet<string> {
  if (from === undefined || from.tables.length < 2) return new Set()
  const facts = selectFacts(run, from, node, undefined)
  if (facts.empty) return new Set()
  const aliases = new Set(facts.constTables.map((t) => t.alias))
  const readAhead = facts.readAhead ?? new Set<string>()
  if (aliases.size > 0 || facts.nullTables !== undefined || facts.outerConstants !== undefined) from.constants(new Set([...aliases].filter((a) => !readAhead.has(a))), readAhead, facts.nullTables, facts.outerConstants)
  // An outer join's tables whose ON never holds are NULL throughout: constants as well.
  for (const alias of facts.nullTables ?? []) aliases.add(alias)
  return aliases
}

/**
 * Whether the optimizer proves the result empty — an impossible condition, a
 * join that cannot match, a const table with no row for its key, LIMIT 0 — and
 * plans nothing ("Zero rows (no matching row in const table)", 8.4.11).
 */
function provedEmpty(run: Run, from: FromPlan | undefined, node: SelectNode, limitCount: number | undefined): boolean {
  if (limitCount === 0) return true
  if (from === undefined) return false
  const facts = selectFacts(run, from, node, limitCount)
  return facts.empty || semijoinEmpty(run, node.where) || (facts.constTables.length > 0 && !constTablesHaveRows(facts, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, run.env.trx))
}

/** The SELECT's static proofs, in their own scope; row existence is checked separately. */
function selectFacts(run: Run, from: FromPlan | undefined, node: SelectNode, count: number | undefined): OptimizerFacts {
  return optimizerFacts(from, node.where, count, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, (node.options ?? []).includes('STRAIGHT_JOIN'))
}

/** Copied fields apply only while all constant tables still have rows. */
function copiedColumns(run: Run, facts: OptimizerFacts, own: readonly ResultType[], items: readonly { readonly compiled: Compiled }[]): ((trx: Trx | undefined) => readonly ResultType[]) | undefined {
  if (facts.constTables.length === 0) return undefined
  const copied = items.map((item) => item.compiled.type)
  // Each delivery checks its own transaction; row existence is never cached.
  return (trx) => constTablesHaveRows(facts, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env, trx) ? copied : own
}

/**
 * Whether an IN or EXISTS the WHERE joins as a semijoin can never match: its
 * subquery's own WHERE is impossible, so the whole query is empty (8.4.11:
 * `id IN (SELECT pa_id FROM ch WHERE ch.id IS NULL)` is "Zero rows"). Only an
 * uncorrelated subquery over one base table is judged, every column it names
 * its own; NOT EXISTS keeps every row instead.
 */
function semijoinEmpty(run: Run, where: Expression | undefined): boolean {
  return splitAnd(where).some((c) => {
    const query = positiveSubquery(c)
    return query !== undefined && emptySubquery(run, query)
  })
}

/** Whether an uncorrelated subquery over one base table has an impossible WHERE, judged as the optimizer judges a query's. */
function emptySubquery(run: Run, query: QueryExpression): boolean {
  const body = query.body
  if (body.kind !== QUERY.SELECT || body.where === undefined || body.groupBy !== undefined || body.having !== undefined || query.limit !== undefined) return false
  const ref = body.from?.length === 1 ? body.from[0] : undefined
  if (ref?.kind !== REF.TABLE) return false
  const alias = ref.alias ?? ref.table.name
  const def = definitionForProof(run, ref.table)
  if (def === undefined) return false
  const own = (parts: readonly string[]): boolean => (parts.length === 1 ? def.columns.some((col) => col.name.toLowerCase() === (parts[0] as string).toLowerCase()) : parts[parts.length - 2] === alias)
  if (!columnRefs(body.where).every(own)) return false
  try {
    const { parent: _outer, ...alone } = run
    const sub = planFrom([ref], fromContext(alone), body.where, false)
    return optimizerFacts(sub, body.where, undefined, compileContext(run, EMPTY_SCOPE, 'where clause'), run.env).empty
  } catch (e) {
    expectTyped(e)
    return false
  }
}

/**
 * The index a table read whole is read by — its covering index, else its
 * clustered one — when an ORDER BY agrees on one physical scan direction
 * over a prefix of that index's key, which for a secondary index ends with
 * the clustered key it carries. 8.4.11 reads the index in that order and sorts nothing ("Index
 * scan on t using PRIMARY", "Covering index scan on t using name").
 */
function orderingIndex(def: TableDef, alias: string, order: readonly OrderItem[], items: readonly { compiled: Compiled; expr: Expression; alias?: string }[], scope: Scope, readBy: string | undefined, primary: boolean): { readonly index: string; readonly reverse: boolean } | undefined {
  const clustered = clusteredIndex(def)
  const index = readBy === undefined ? clustered : def.indexes.find((i) => i.name === readBy)
  if (index === undefined || clustered === undefined) return undefined
  // The caller has nonempty ORDER keys; successful binding keeps this list nonempty.
  const keys: { name: string; desc: boolean }[] = []
  for (const o of order) {
    const e = sortExpression(o.expr, items)
    if (e === undefined || e.kind !== NODE.COLUMN) return undefined
    const r = safeResolve(scope, e.parts, 'order clause')
    const column = r?.type.column
    if (column === undefined || r?.depth !== undefined || column.table !== alias) return undefined
    const name = column.orgName.toLowerCase()
    // A later occurrence cannot break a tie on the very same field.
    if (!keys.some((k) => k.name === name)) keys.push({ name, desc: o.desc === true })
  }
  // A clustered scan covers every row field. For a whole-table scan,
  // MySQL prefers it over a scan plus sort when prefer_ordering_index is on.
  for (const candidate of primary ? [index, clustered] : [index]) {
    const parts = indexParts(def, candidate)
    const reverse = keys[0]!.desc !== (candidate.parts[0]?.descending === true)
    // Every requested key part must agree on the scan direction, including
    // the PRIMARY parts carried by a secondary index.
    if (keys.every((key, i) => {
      const part = parts[i]
      return part !== undefined && part.prefix === undefined && part.column.toLowerCase() === key.name && ((part.descending === true) !== key.desc) === reverse
    })) return { index: candidate.name, reverse }
  }
  return undefined
}

/** One positive IN or EXISTS predicate; NOT and conjunctions stay with their callers. */
function positiveSubquery(e: Expression | undefined): QueryExpression | undefined {
  if (e?.kind === NODE.BINARY && e.op === 'IN' && e.right.kind === NODE.SUBQUERY) return e.right.query
  if (e?.kind === NODE.UNARY && e.op === 'EXISTS' && e.operand.kind === NODE.SUBQUERY) return e.operand.query
  return undefined
}

/** The negative EXISTS form; a negated IN is a different nullable contract. */
function negativeExistsSubquery(e: Expression | undefined): QueryExpression | undefined {
  return e?.kind === NODE.UNARY && e.op === 'NOT' && e.operand.kind === NODE.UNARY && e.operand.op === 'EXISTS' ? positiveSubquery(e.operand) : undefined
}

/** The WHERE's IN and EXISTS subqueries MySQL runs as semijoins (NOT EXISTS, antijoins), each with the subquery. */
function semijoinSubqueries(where: Expression | undefined): QueryExpression[] {
  return splitAnd(where).flatMap((e) => {
    const query = positiveSubquery(e) ?? negativeExistsSubquery(e)
    return query === undefined ? [] : [query]
  })
}

/**
 * Whether every semijoin is a nested loop over an index: an EXISTS whose only
 * condition is its own indexed column equal to an outer column (8.4.11:
 * "Nested loop antijoin / Covering index lookup on ch using pa_id"). Then a
 * sort on the outer table goes first, and nothing is streamed. An additional
 * condition needs a costed choice rather than this equality-only shortcut.
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
    return outer && sides.some((e) => e.kind === NODE.COLUMN && e.parts.length >= 2 && e.parts[e.parts.length - 2] === innerAlias)
  })
}

/** Whether `e` holds a subquery that reads a column of `scope`'s tables by a qualified name: a correlated one. */
function correlatedIn(e: unknown, scope: TableScope): boolean {
  return someNode(e, (node) => {
    const n = node as { kind?: string; query?: QueryExpression }
    if (n.kind === NODE.SUBQUERY && n.query !== undefined) return readsOuter(n.query, new Set(scope.tables.map((t) => t.alias)))
    return undefined
  })
}

/** Whether a query names, by qualifier, one of `aliases` that its own FROM does not define. */
function readsOuter(q: unknown, aliases: ReadonlySet<string>): boolean {
  const own = new Set<string>()
  someNode(q, (x) => {
    const n = x as { kind?: string; alias?: string; table?: TableName }
    if (n.kind === REF.TABLE) own.add(n.alias ?? n.table?.name ?? '')
    if (n.kind === REF.DERIVED && n.alias !== undefined) own.add(n.alias)
    return undefined
  })
  return columnRefs(q, true).some((parts) => {
    const qualifier = parts.length >= 2 ? parts[parts.length - 2] as string : ''
    return aliases.has(qualifier) && !own.has(qualifier)
  })
}

/** The FROM tables a select-list scalar subquery that aggregates without GROUP BY reads, by qualified name. */
function aggregatingSubqueryTables(node: SelectNode, scope: TableScope): Set<string> {
  const out = new Set<string>()
  const aliases = new Set(scope.tables.map((t) => t.alias))
  const visit = (e: unknown, inside: boolean): boolean => someNode(e, (e) => {
    const n = e as { kind?: string; query?: QueryExpression; parts?: readonly string[] }
    if (n.kind === NODE.SUBQUERY && n.query !== undefined) {
      const body = n.query.body
      const aggregating = body.kind === QUERY.SELECT && body.groupBy === undefined && containsAggregate(body.items)
      if (aggregating) visit(n.query, true)
      return false
    }
    if (inside && n.kind === NODE.COLUMN && (n.parts?.length ?? 0) >= 2) {
      const alias = n.parts?.[(n.parts?.length ?? 0) - 2] as string
      if (aliases.has(alias)) out.add(alias)
    }
    return undefined
  })
  visit(node.items, false)
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
 * The source columns a query reads of each FROM table, by name in lower case:
 * what decides which secondary index holds everything it needs (`FromPlan.reads`).
 * Stars conservatively require all source columns, including join inputs.
 */
function columnsRead(scope: TableScope, node: SelectNode, q: QueryExpression): Map<string, ReadonlySet<string> | 'all'> {
  const used = new Map<string, Set<string>>()
  const aliases = new Set(scope.tables.map((t) => t.alias))
  const add = (alias: string, column: string): void => { used.set(alias, (used.get(alias) ?? new Set()).add(column.toLowerCase())) }
  const visit = (e: unknown, inside: boolean): boolean => someNode(e, (e) => {
    const n = e as { kind?: string; parts?: readonly string[]; query?: unknown }
    if (n.kind === NODE.LITERAL || n.kind === NODE.PLACEHOLDER) return false
    if (n.kind === NODE.SUBQUERY || n.kind === REF.DERIVED) {
      visit(n.query, true)
      return false
    }
    // COUNT(*) counts rows and reads no column.
    if (n.kind === NODE.CALL && nativeCallName(n as CallNode) === 'COUNT') {
      const args = (n as { args?: readonly Expression[] }).args ?? []
      if (args.length === 1 && args[0]?.kind === NODE.COLUMN && args[0].parts.length === 1 && args[0].parts[0] === '*') return false
    }
    if (n.kind === NODE.COLUMN && n.parts !== undefined) {
      const last = n.parts[n.parts.length - 1] as string
      const qualifier = n.parts.length >= 2 ? (n.parts[n.parts.length - 2] as string) : undefined
      if (last === '*') {
        if (inside) return false
        for (const t of scope.tables) if (qualifier === undefined || qualifier === t.alias) for (const c of t.columns) add(t.alias, c.name)
        return false
      }
      if (inside) {
        if (qualifier !== undefined && aliases.has(qualifier)) add(qualifier, last)
        return false
      }
      const r = safeResolve(scope, n.parts, 'field list')
      const at = r?.depth === undefined && r !== undefined ? scope.columnAt(r.index) : undefined
      if (at !== undefined) add(at.table.alias, at.column.name)
      return false
    }
    return undefined
  })
  visit([node.items, node.where, node.groupBy, node.having, node.from, q.orderBy], false)
  return used
}

/**
 * 1093: an UPDATE or DELETE whose own subqueries read the table it writes,
 * which MySQL refuses unless a derived table materializes the read first.
 */
export function checkTargetNotRead(target: { readonly schema: string; readonly name: string }, exprs: readonly (Expression | undefined)[], database: string | null): void {
  const visit = (e: unknown, inSubquery: boolean): boolean => someNode(e, (e) => {
    const n = e as { kind?: string; table?: TableName; query?: unknown }
    if (n.kind === REF.DERIVED) return false
    if (n.kind === NODE.SUBQUERY) return visit(n.query, true)
    if (inSubquery && n.kind === REF.TABLE && n.table?.name === target.name && (n.table.schema ?? database) === target.schema) return true
    return undefined
  })
  if (visit(exprs, false)) throw sqlError('ER_UPDATE_TABLE_USED', `You can't specify target table '${target.name}' for update in FROM clause`)
}

// --- subqueries, derived tables, CTEs and set operations (M5.1, M5.19) --------------

/** Observe outer references; only a newly nested query adds a level. */
function enclosing(scope: Scope, seen: () => void, deeper = true): Scope {
  return {
    resolve(parts, clause) {
      const r = scope.resolve(parts, clause)
      seen()
      return deeper ? { ...r, depth: (r.depth ?? 0) + 1 } : r
    },
  }
}

interface BoundSubquery extends SubqueryPlan {
  readonly clause: string
  readonly query: QueryExpression
  readonly plan: SelectPlan
}

/** Whether a query reads a table: one with no FROM is a constant row. */
function hasFrom(q: QueryExpression): boolean {
  const body = queryBody(q)
  return body.kind !== QUERY.SELECT || (body.from?.length ?? 0) > 0
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
  return body.groupBy === undefined && body.having === undefined && body.distinct !== true && body.windows === undefined && !containsAggregate(body.items) && !containsWindow(body.items)
}

/** A derived table, or one reference to a CTE: its columns as the outer query sees them, and its rows. */
function derivedTable(run: Run, query: QueryExpression, alias: string, names: readonly string[] | undefined, lateral: Scope | undefined, view?: ViewDef, cte?: string): DerivedSource {
  let correlated = false
  const outer = lateral ?? run.parent
  const parent = outer === undefined ? undefined : enclosing(outer, () => (correlated = true), lateral !== undefined)
  const plan = planQuery(parent === undefined ? run : { ...run, parent }, query)
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
  const columns = renamed(plan.columns, names, (name, type) => {
    const column = type.column
    const derived = { table: alias, orgName: name }
    // A materialized field keeps its view's schema; a merged expression does not.
    if (column === undefined) {
      type.names = view === undefined
        ? { ...derived, schema: '', orgTable: '' }
        : merged && !type.temporary
          ? { ...derived, schema: '', orgTable: view.name, viewSchema: view.schema }
          : { ...derived, schema: view.schema, orgTable: view.name }
    } else type.column = { ...column, ...derived, ...(merged && view !== undefined ? { schema: view.schema, orgTable: view.name } : {}) }
    if (!merged) {
      type.temporary = 'stream'
      type.length = copiedLength(type)
    }
    return type
  })
  // Memoization can cache a merged query too; only an unmerged table copies fields.
  function* fieldRows(trx: Trx | undefined, env: Env, row?: readonly Value[]): Generator<Value[]> {
    const given = lateral === undefined || row === undefined ? env : { ...env, outer: [row, ...(env.outer ?? [])] }
    for (const r of plan.rows(trx, given)) yield r.map((v, i) => {
      const type = columns[i]!.type
      return withoutHex(!merged && (type.kind === 'decimal' || type.kind === 'time') ? fieldValue(v, type) : v)
    })
  }
  // Read once per statement unless it reads an enclosing query: so an UPDATE
  // whose subquery reads its own table through a derived table sees the
  // table as it was before the first row changed (8.4.11: `UPDATE t SET a =
  // a + (SELECT COUNT(*) FROM (SELECT a FROM t) d WHERE d.a > t.a)` is 3, 3, 3).
  const source: DerivedSource = {
    columns,
    constant: lateral === undefined && !hasFrom(query) && query.body.kind === QUERY.SELECT,
    merged,
    explain: (): DerivedPlan | undefined => {
      const body = plan.explain?.()?.[0]
      if (body === undefined) return undefined
      return merged ? { merged, node: body } : { merged, materialize: cte === undefined ? 'Materialize' : `Materialize CTE ${cte}`, children: [body] }
    },
    // Its rows are a table's fields: a hex literal's number does not survive.
    rows: (trx, env, row, ready) => {
      if (lateral !== undefined || correlated || env.memo === undefined) return fieldRows(trx, env, row)
      const rows = memoValue(env.memo, source, () => [...fieldRows(trx, env)])
      if (ready !== undefined && literalReader(query)) ready()
      return rows
    },
  }
  return source
}

/** Closed literal source grammar; cardinality alone cannot prove native initialization. */
function literalReader(q: QueryExpression): boolean {
  const body = q.body
  if (body.kind !== QUERY.SELECT || body.from || body.groupBy || body.distinct || body.options || q.with || q.orderBy || !wholeReaderReady(q, body)) return false
  if (q.limit && (q.limit.offset || !integerLiteral(q.limit.count) || q.limit.count.value > MAX_UNSIGNED)) return false
  return body.items.every(({ expr }) => {
    if (expr.kind === NODE.CAST && expr.array === undefined && expr.timeZone === undefined && (expr.type.name === 'SIGNED' || expr.type.name === 'UNSIGNED')) {
      expr = expr.expr
      if (expr.kind === NODE.UNARY && expr.op === '-' && integerLiteral(expr.operand)) expr = expr.operand
      // The materializer owns CAST conversion, including saturation and warnings.
      return expr.kind === NODE.LITERAL && (expr.type === LITERAL.NULL || (expr.charset === undefined && expr.collation === undefined && (expr.type === LITERAL.INT || expr.type === LITERAL.STRING || expr.type === LITERAL.BOOL)))
    }
    const value = sourceInteger(expr)
    return value === undefined ? expr.kind === NODE.LITERAL && expr.type === LITERAL.NULL : value >= MIN_SIGNED && value <= MAX_UNSIGNED
  })
}

/** The raw integer grammar; CAST conversion belongs to the materializer. */
function sourceInteger(e: Expression): bigint | undefined {
  if (integerLiteral(e)) return e.value
  if (e.kind === NODE.UNARY && e.op === '-' && integerLiteral(e.operand)) return -e.operand.value
  return undefined
}

/** Owned field types and names: 1353 for a mismatched list, 1060 for a name twice. */
function renamed(columns: readonly { readonly name: string; readonly type: ResultType }[], names: readonly string[] | undefined, fieldType: (name: string, type: { -readonly [K in keyof ResultType]: ResultType[K] }) => ResultType) {
  if (names !== undefined && names.length !== columns.length) {
    throw sqlError('ER_VIEW_WRONG_LIST', 'In definition of view, derived table or common table expression, SELECT list and column names list have different column counts')
  }
  const seen = new Set<string>()
  for (const [i, column] of columns.entries()) {
    const name = names?.[i] ?? column.name
    if (!firstKey(seen, name.toLowerCase())) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${name}'`)
  }
  // Validate every name before a caller's metadata conversion can fail.
  return columns.map((c, i) => {
    const name = names?.[i] ?? c.name
    const { literalInt, ...type } = c.type
    if (literalInt !== undefined) type.wasLiteralInt = true
    return { name, type: fieldType(name, type) }
  })
}

/** The CTEs a WITH defines, each visible to the ones after it and to the query. */
export function withClause(run: Run, w: NonNullable<QueryExpression['with']>): Run {
  const ctes = new Map(run.ctes)
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
  return someNode(q, (node) => {
    const n = node as { kind?: string; table?: TableName }
    if (n.kind === REF.TABLE && n.table?.schema === undefined && n.table?.name === name) return true
    return undefined
  })
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
  const recursive: QueryBody[] = []
  const anchors: QueryBody[] = []
  for (const member of members) (references(member, cte.name) ? recursive : anchors).push(member)
  for (const m of recursive) {
    const select = m.kind === QUERY.QUERY ? m.body : m
    if (m.kind === QUERY.QUERY && (m.orderBy !== undefined || m.limit !== undefined)) throw notYet('ORDER BY / LIMIT / SELECT DISTINCT in recursive query block of Common Table Expression')
    if (select.kind !== QUERY.SELECT) continue
    if (select.groupBy !== undefined || containsAggregate([select.items, select.having])) {
      throw sqlError('ER_CTE_RECURSIVE_FORBIDS_AGGREGATION', `Recursive Common Table Expression '${cte.name}' can contain neither aggregation nor window functions in recursive query block`)
    }
    if (select.distinct === true) throw notYet('ORDER BY / LIMIT / SELECT DISTINCT in recursive query block of Common Table Expression')
  }
  const anchorPlans = anchors.map((a) => planQuery(run, asQuery(a)))
  const anchor = anchorPlans[0]
  if (anchor === undefined) throw sqlError('ER_CTE_RECURSIVE_REQUIRES_NONRECURSIVE_FIRST', `Recursive Common Table Expression '${cte.name}' should have one or more non-recursive query blocks followed by one or more recursive ones`)
  // A recursive CTE's table is typed as a set operation's column is, from the anchor alone, and nullable.
  const columns = renamed(anchor.columns, cte.columns, (name, type) => ({ ...setOperationType([type], run.env.session.characterSet), nullable: true, names: { schema: '', table: cte.name, orgTable: '', orgName: name } }))
  let working: readonly (readonly Value[])[] = []
  // What a recursive member reads of the CTE: the rows the last round added.
  const workingTable: DerivedSource = { columns, rows: () => working, explain: () => ({ merged: true, node: planNode(`Scan new records on ${cte.name}`) }) }
  const ctes = new Map(run.ctes)
  ctes.set(cte.name, () => workingTable)
  const steps = recursive.map((m) => planQuery({ ...run, ctes }, asQuery(m)))
  const plans = [...anchorPlans, ...steps]
  for (const p of plans) checkSetWidth(p.columns, columns)
  // A LIMIT on the whole CTE stops the recursion once it has its rows (8.4.11).
  const [limitCount, offset] = queryLimit(run, query)
  const enough = offset + (limitCount ?? Infinity)
  const types = columns.map((c) => c.type)
  return {
    columns,
    // The anchors once, then the recursive members until a round adds nothing.
    explain: () => {
      const roots = plans.map((p) => p.explain?.()?.[0])
      if (roots.some((r) => r === undefined)) return undefined
      const body = roots as PlanNode[]
      body.push(planNode('Repeat until convergence', body.splice(anchorPlans.length)))
      return { merged: false, materialize: `Materialize recursive CTE ${cte.name}${distinctRows ? ' with deduplication' : ''}`, children: body }
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
            if (!firstKey(seen, k)) continue
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

/** Preserve an existing query block or wrap a bare body without changing its source position. */
function asQuery(body: QueryBody): QueryExpression {
  return body.kind === QUERY.QUERY ? body : { kind: QUERY.QUERY, body, at: body.at }
}

/** UNION, INTERSECT or EXCEPT over two branches, each any query (M5.19). `parent` is the operator it is a branch of. */
function planSetOperation(run: Run, node: SetOperationNode, parent?: { readonly op: SetOperationNode['op']; readonly types: () => readonly ResultType[] }): SelectPlan {
  // Nested set operations compare in the final holder, including DISTINCT.
  // The getter is read only during execution, after every branch is typed.
  const comparisonTypes = (): readonly ResultType[] => parent?.types() ?? op.columns.map((c) => c.type)
  const context = { op: node.op, types: comparisonTypes }
  const branch = (b: QueryBody): SelectPlan => {
    if (b.kind === QUERY.SET_OPERATION) return planSetOperation(run, b, context)
    // A parenthesised set operation is still a branch of this one.
    if (b.kind === QUERY.QUERY && b.body.kind === QUERY.SET_OPERATION && b.with === undefined) return orderedResult(run, b, planSetOperation(run, b.body, context))
    return planQuery(run, asQuery(b))
  }
  const left = branch(node.left)
  const right = branch(node.right)
  const leavesOf = (p: SelectPlan): readonly (readonly ResultType[])[] => p.leaves ?? [p.columns.map((c) => c.type)]
  const leaves = [...leavesOf(left), ...leavesOf(right)]
  const op = setOperation(node, left.columns, right.columns, run.env.session.characterSet, leaves)
  const columns =
    parent?.op !== 'UNION' || parent.op === node.op
      ? op.columns
      : op.columns.map((c, i) => ({ name: c.name, type: { ...c.type, nullable: nestedNullability(node.op, (left.columns[i] as { type: ResultType }).type.nullable, (right.columns[i] as { type: ResultType }).type.nullable) } }))
  // EXPLAIN: a chain of one operator is one temporary table, its branches in order.
  const flatten = (p: SelectPlan, all: boolean): { node: PlanNode; all: boolean }[] | undefined => {
    if (p.members !== undefined && p.members.op === node.op) return p.members.items.map((m, i) => (i === 0 ? { ...m, all } : m))
    const n = p.explain?.(true)?.[0]
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
      const types = comparisonTypes()
      const rows = op.rows(() => left.rows(trx, env), () => right.rows(trx, env), types)
      if (parent !== undefined) return rows
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
  const scope = new TableScope([{ alias: '\u0000result', columns: plan.columns }])
  const keys = (q.orderBy ?? []).map((o): SortKey => {
    const e = o.expr
    if (integerLiteral(e)) {
      const n = Number(e.value as bigint)
      if (n < 1 || n > plan.columns.length) throw unknownColumnError(String(n), 'order clause')
      return { expr: readSlot(n - 1, (plan.columns[n - 1] as { type: ResultType }).type), desc: o.desc === true }
    }
    if (e.kind === NODE.COLUMN && e.parts.length >= 2) {
      throw sqlError('ER_TABLENAME_NOT_ALLOWED_HERE', `Table '${e.parts[e.parts.length - 2]}' from one of the SELECTs cannot be used in global ORDER clause`)
    }
    return { expr: compile(e, compileContext(run, scope, 'order clause')), desc: o.desc === true }
  })
  const [limitCount, offset] = queryLimit(run, q)
  const stages: Stage[] = []
  if (keys.length > 0) stages.push({ run: (rows, env) => sort(rows, keys, env), describe: (n) => planNode('Sort', [n]) })
  if (q.limit) stages.push(limitStage(offset, limitCount))
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
      const env = executionEnv(run, trx, given)
      return values(runStages(rowed(plan.rows(trx, given)), stages, env))
    },
  }
}

/** Unary plus preserves reader identity without changing its written names or diagnostics. */
function withoutUnaryPlus(e: Expression): Expression {
  while (e.kind === NODE.UNARY && e.op === '+') e = e.operand
  return e
}

/** Resolve aliases and positions; GROUP BY gives source columns priority. */
function sortExpression(e: Expression, items: readonly { readonly alias?: string; readonly expr: Expression }[], scope?: Scope): Expression | undefined {
  if (scope && e.kind === NODE.COLUMN && safeResolve(scope, e.parts, 'group statement')) return e
  return selectedItem(e, items)?.expr ?? (integerLiteral(e) ? undefined : e)
}

/** A select-list position or first bare alias, using the SQL name fold. */
function selectedItem<T extends { readonly alias?: string }>(e: Expression, items: readonly T[]): T | undefined {
  if (integerLiteral(e)) return items[Number(e.value as bigint) - 1]
  if (e.kind !== NODE.COLUMN || e.parts.length !== 1) return undefined
  const name = (e.parts[0] as string).toLowerCase()
  return items.find((i) => i.alias?.toLowerCase() === name)
}

type IdentityMode = 'admission' | 'copy' | 'field'

/** Field equality can fold literals; copied-value reuse needs exact strings. */
function expressionIdentity(e: Expression | undefined, ctx: CompileContext, env: Env, mode: IdentityMode): unknown[] | undefined {
  if (e === undefined) return undefined
  let identity: unknown[]
  let args: readonly Expression[]
  switch (e.kind) {
    case NODE.COLUMN: {
      const r = ctx.scope.resolve(e.parts, ctx.clause)
      if (mode === 'field' && (r.depth ?? 0) > 0) return undefined
      return [e.kind, r.index, r.depth ?? 0]
    }
    case NODE.LITERAL: {
      // Only literals are evaluated: calls and statement state are opaque.
      // COLLATE wraps the original constant; it does not change Item equality
      // inside that wrapper. Introduced bytes become string constants, while
      // unintroduced hex and bit spellings share one binary constant class.
      const { collation, ...bare } = e
      const c = compile(bare, ctx)
      const v = c.eval([], env)
      const kind = e.type === LITERAL.BOOL ? LITERAL.BOOL : v?.kind === 'bytes' && v.hex === true ? LITERAL.HEX : c.type.kind
      return [e.kind, kind, c.type.collationId, mode === 'copy' && v?.kind === 'string' ? v.v : valueKey(v), collation === undefined ? undefined : collationInfoByName(collation)?.id]
    }
    case NODE.PLACEHOLDER: return [e.kind, e.index]
    case NODE.BINARY:
      if (e.op !== '+') return undefined
      identity = [e.kind]; args = [e.left, e.right]; break
    case NODE.CAST:
      if (e.type.name !== 'SIGNED' || e.array === true || e.timeZone !== undefined) return undefined
      identity = [e.kind]; args = [e.expr]; break
    case NODE.COLLATE:
      identity = [e.kind, collationInfoByName(e.collation)?.id]; args = [e.expr]; break
    case NODE.CALL: {
      const name = nativeCallName(e)
      const allowed = name === 'ABS' || name === 'CONCAT' || (mode === 'admission' && (name === 'RAND' || name === 'LAST_INSERT_ID'))
      if (!allowed || e.over !== undefined || e.distinct === true) return undefined
      identity = [e.kind, name]; args = e.args; break
    }
    default: return undefined
  }
  const keys = args.map((a) => expressionIdentity(a, ctx, env, mode))
  if (keys.includes(undefined)) return undefined
  identity.push(keys)
  return identity
}

/** The verified single-table scalar DISTINCT admission boundary (8.4.11). */
function checkDistinctOrder(run: Run, order: readonly OrderItem[], items: readonly { readonly expr: Expression; readonly compiled: Compiled; readonly alias?: string }[], ctx: CompileContext): readonly (number | undefined)[] | undefined {
  const scope = ctx.scope as TableScope
  const key = (e: Expression | undefined, mode: IdentityMode = 'admission'): string | undefined => JSON.stringify(expressionIdentity(e, ctx, run.env, mode))
  const selectedKeys = items.map((item) => key(item.expr))
  // An alias or position is already bound; null needs no expression proof.
  const orderKeys = order.map((item) => selectedItem(item.expr, items) !== undefined ? null : key(item.expr))
  if (selectedKeys.includes(undefined) || orderKeys.includes(undefined)) return
  const selected = items.map((item) => item.compiled.type.column)
  order.forEach(({ expr: e }, i) => {
    const k = orderKeys[i]
    if (k === null || selectedKeys.includes(k)) return
    for (const parts of columnRefs(e)) {
      const r = scope.resolve(parts, 'order clause')
      if ((r.depth ?? 0) > 0 || (r.type.column !== undefined && selected.includes(r.type.column))) continue
      throw sqlError('ER_FIELD_IN_ORDER_NOT_SELECT', `Expression #${i + 1} of ORDER BY clause is not in SELECT list, references column '${qualifiedColumn(scope, r.index)}' which is not in SELECT list; this is incompatible with DISTINCT`)
    }
  })
  // Admission equality is weaker than copied-value reuse. Only SIGNED casts
  // have a verified evaluation contract here; keep volatile calls conservative.
  const copied = items.map((item) => key(item.expr, 'copy'))
  if (copied.includes(undefined)) return
  return order.map(({ expr }) => {
    const index = expr.kind === NODE.CAST ? copied.indexOf(key(expr, 'copy')) : -1
    if (index >= 0) return index
  })
}

/** Error spelling for a resolved column, including its table alias and schema. */
function qualifiedColumn(scope: TableScope | undefined, index: number): string {
  const at = scope?.columnAt(index)
  if (at === undefined) return '?'
  const prefix = at.table.def === undefined ? '' : `${at.table.def.schema}.`
  return `${prefix}${at.table.alias}.${at.column.name}`
}

/**
 * The one table an ORDER BY, or a GROUP BY, reads (`get_sort_by_table`):
 * with both, only if they are the same list; none if any key reads anything
 * but that table's columns, or reads no table at all.
 */
function sortTable(order: readonly Expression[] | undefined, group: readonly Expression[] | undefined, items: readonly { readonly alias?: string; readonly expr: Expression }[], scope: TableScope): string | undefined {
  const keys = order ?? group
  if (keys === undefined || keys.length === 0) return undefined
  const text = (e: Expression | undefined): string => (e === undefined ? '\u0000' : deparse(e))
  if (order !== undefined && group !== undefined && (order.length !== group.length || order.some((o, i) => text(sortExpression(o, items)) !== text(sortExpression(group[i] as Expression, items))))) return undefined
  const aliases = keyAliases(keys, items, scope)
  return aliases.size === 1 && !aliases.has('\u0000') ? [...aliases][0] : undefined
}

/** The tables sort keys read, a position or an alias read through the select list; a name that resolves to nothing as `\u0000`. */
function keyAliases(keys: readonly Expression[], items: readonly { readonly alias?: string; readonly expr: Expression }[], scope: Scope): Set<string> {
  const out = new Set<string>()
  if (!(scope instanceof TableScope)) return out
  for (const e of keys) {
    for (const parts of columnRefs(sortExpression(e, items) ?? { kind: NODE.COLUMN, parts: ['\u0000'] }, true)) {
      const r = safeResolve(scope, parts, 'order clause')
      const alias = r === undefined ? '\u0000' : scope.columnAt(r.index)?.table.alias
      if (alias !== undefined) out.add(alias)
    }
  }
  return out
}

interface SelectEntry {
  readonly item: SelectNode['items'][number]
  readonly text?: string | undefined
  readonly slot?: { readonly index: number; readonly name: string; readonly type: ResultType }
}

/** Expand in source order; plain compilation precedes naming, grouped naming precedes its keys. */
function* selectList(run: Run, node: SelectNode, scope: TableScope | undefined): Generator<SelectEntry> {
  const texts = itemTexts(run, node)
  for (const [i, item] of node.items.entries()) {
    const e = item.expr
    if (e.kind === NODE.COLUMN && e.parts[e.parts.length - 1] === '*') {
      if (scope === undefined) throw sqlError('ER_NO_TABLES_USED', 'No tables used')
      const table = e.parts.length >= 2 ? e.parts[e.parts.length - 2] : undefined
      for (const slot of scope.star(table)) yield { item: { expr: { kind: NODE.COLUMN, parts: [scope.columnAt(slot.index)?.table.alias as string, slot.name], at: e.at } }, slot }
    } else yield { item, text: texts[i] }
  }
}

/**
 * A bare column of a view, a derived table, a CTE or an INFORMATION_SCHEMA
 * table is named as that source names it, whatever the query wrote: only a
 * base table's column takes the query's spelling (8.4.11 — `SELECT
 * table_name FROM information_schema.tables` reads as TABLE_NAME).
 */
function selectName(entry: SelectEntry, scope: TableScope | undefined): string {
  if (entry.slot !== undefined) return entry.slot.name
  const { item } = entry
  const name = itemName(item, entry.text)
  if (scope === undefined || item.alias !== undefined || item.expr.kind !== NODE.COLUMN) return name
  const index = safeIndex(scope, item.expr.parts)
  const source = index === undefined ? undefined : scope.columnAt(index)
  return source === undefined || source.table.def !== undefined ? name : source.column.name
}

/** A result column's name: its alias, a bare column's name as written, a string literal's value, else its source text. */
function itemName(item: SelectNode['items'][number], text: string | undefined): string {
  const e = item.expr
  if (item.alias !== undefined) {
    // String aliases require utf8mb3; identifier-alias admission remains M5.1.
    const astral = /[\u{10000}-\u{10FFFF}]/u.exec(item.alias)
    if (astral !== null) {
      const bytes = escapedBytes(encodeCollation(astral[0], CHARSET_UTF8MB4_BIN))
      throw sqlError('ER_CANNOT_CONVERT_STRING', `Cannot convert string '${bytes}' from utf8mb4 to utf8mb3`)
    }
    return item.alias
  }
  // A name made from the expression has such a character as '?'.
  const made = e.kind === NODE.COLUMN ? (e.parts[e.parts.length - 1] as string) : e.kind === NODE.LITERAL && e.type === 'string' ? (e.value as string) : text ?? (e.kind === NODE.LITERAL ? String(e.value) : e.kind)
  return made.replace(/[\u{10000}-\u{10FFFF}]/gu, '?')
}

/** Deferred GROUPING membership diagnostics are created only in their admitted binding phase. */
function checkGrouping(n: number): void {
  if (n >= 0) throw sqlError('ER_FIELD_IN_GROUPING_NOT_GROUP_BY', `Argument #${n + 1} of GROUPING function is not in GROUP BY`)
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
  windowed: boolean,
): SelectPlan {
  const order = q.orderBy ?? []
  const unordered = order.length === 0
  const scope = from?.scope
  const source = from?.single
  // A STRAIGHT_JOIN its const tables reduce to one base table groups as that table alone would (8.4.11, M5.48).
  const width = from?.width ?? 0
  const rollup = node.groupBy?.rollup === true
  // A grouped column is compiled above its grouping rather than read as a slot.
  type GroupItem = SelectNode['items'][number] & { name: string; compiled?: Compiled }
  const selectItems: GroupItem[] = Array.from(selectList(run, node, scope), (entry) => ({ ...entry.item, name: selectName(entry, scope) }))

  // GROUP BY: a table column first, then a select-list alias, then a
  // position. `SELECT k AS s … GROUP BY s` groups by the column `s` (8.4.11).
  const baseCtx = compileContext(run, lookup, 'field list')
  type KeyDescription = {
    readonly written: Expression
    readonly expr: Expression | undefined
    readonly index: number | undefined
    compiled?: Compiled
  }
  const descriptions = (node.groupBy?.items ?? []).map((g): KeyDescription => {
    const expr = sortExpression(g, selectItems, lookup)
    const index = expr?.kind === NODE.COLUMN ? safeResolve(lookup, expr.parts, 'group statement')?.index : undefined
    return { written: g, expr, index }
  })
  type GroupKey = (typeof descriptions)[number] & { expr: Expression; compiled: Compiled }
  let keys: GroupKey[] | undefined
  let missingGrouping = -1

  const matchesKey = (e: Expression | undefined, key: KeyDescription): boolean => {
    if (e === undefined || key.expr === undefined) return false
    e = withoutUnaryPlus(e)
    const bound = withoutUnaryPlus(key.expr)
    const at = key.index ?? localColumn(bound, lookup)
    return at !== undefined && e.kind === NODE.COLUMN ? safeIndex(lookup, e.parts) === at : deparse(e) === deparse(bound)
  }
  const level = width + descriptions.length
  const sink = new AggregateSink(baseCtx, level + 1)
  const aggregateReaders: readonly Compiled[] = sink.specs
  const groupKeys: GroupKeys = {
    match(e) {
      // Only ROLLUP needs a key read from its slot: elsewhere the group's
      // first row holds the same value.
      if (!rollup) return undefined
      const j = descriptions.findIndex((key) => matchesKey(e, key))
      if (j < 0) return undefined
      const key = descriptions[j]!
      const expr = key.expr
      if (expr === undefined || containsAggregate(expr) || containsWindow(expr)) return undefined
      key.compiled ??= compile(expr, baseCtx)
      const { column: _c, temporary: _t, blobBytes: _b, ...type } = key.compiled.type
      return readSlot(width + j, { ...type, nullable: true })
    },
    grouping(args, ctx) {
      if (!rollup) throw invalidGroupFunction()
      const { groupKeys: _groupKeys, ...binding } = ctx
      for (const arg of args) compile(arg, binding)
      const positions = args.map((a) => descriptions.findIndex((key) => matchesKey(a, key)))
      const n = positions.indexOf(-1)
      if (keys !== undefined) checkGrouping(n)
      else if (missingGrouping < 0) missingGrouping = n
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
  const postCtx = (clause: string, at: Scope = lookup, windows?: WindowSink): CompileContext => ({ ...compileContext(run, at, clause, windows), aggregates: sink, groupKeys })
  // Windows over the groups (M5.6): run after HAVING, over the grouped rows,
  // so their arguments and keys may be the groups' aggregates. Their slots
  // follow the aggregates', which are all known only once everything compiled.
  const windows = windowed ? new WindowSink(postCtx('window order by'), 0, node.windows) : undefined
  const selectCtx = postCtx('field list', lookup, windows)
  for (const item of selectItems) item.compiled = compile(item.expr, selectCtx)
  // Naming and binding complete before the same records become output fields.
  const items = selectItems as (GroupItem & { compiled: Compiled })[]
  const [limitCount, offset] = queryLimit(run, q)
  const resolved = resolveCondition(run, compileContext(run, lookup, 'where clause'), node.where, limitCount)
  const keep = offset + (limitCount ?? Infinity)
  const constants = constRows(run, from, node)
  const remaining = from?.tables.filter((table) => !constants.has(table.alias))
  const alone = remaining?.length === 1 ? remaining[0] : undefined
  const groupCtx = compileContext(run, lookup, 'group statement')
  for (const key of descriptions) {
    const expr = key.expr
    if (expr === undefined) throw unknownColumnError(deparse(key.written), 'group statement')
    if (containsAggregate(expr)) throw sqlError('ER_WRONG_GROUP_FIELD', `Can't group on '${deparse(key.written)}'`)
    key.compiled ??= compile(expr, groupCtx)
  }
  // Publish the same descriptions only after every key has completed binding.
  keys = descriptions as GroupKey[]
  // The strategy, which decides the order the groups come out in and whether
  // their columns go through a temporary table.
  // A key the WHERE holds to one value does not order anything: GROUP BY
  // amt, name WHERE amt = -18 groups by the index on name (8.4.11).
  const groupFacts = alone?.def === undefined ? undefined : resolved.facts(alone.def, alone.alias)
  const keyColumns = keys.map((k) => (k.index === undefined || alone?.def === undefined ? undefined : alone.def.columns[k.index - alone.offset]?.name)).filter((c) => c === undefined || !groupFacts!.pins.has(c.toLowerCase()))
  const distinctAggregate = needsSortedGroups([node.items, node.having, order])
  // Keys over const tables alone are constants, one group at most: grouped as they come, and not sorted
  // (8.4.11: `FROM p CROSS JOIN q WHERE p.id = 5 GROUP BY p.g ORDER BY 1, 2` is a Group aggregate over q).
  const constTable = source !== undefined && run.preparing !== true && groupFacts?.constTable
  const oneGroup = !rollup && keys.length > 0 && (constTable || (constants.size > 0 && keys.every((k) => !refersToRow(k.expr, lookup, constants))))

  // Retained grouping keys identify each output group; ROLLUP levels do not.
  const deduplicate = node.distinct === true && (rollup || (
    keys.length > 0 && !oneGroup && keyColumns.length > 0 &&
    !keys.every((key) => selectItems.some((item) => matchesKey(item.expr, key)))
  ))

  // Retained DISTINCT copies completed AVG values through the native group writer.
  const copiedAverage = run.preparing !== true && deduplicate && !windowed && source !== undefined && unhintedBase(q, node) !== undefined && wholeReaderReady(q, node) &&
    !rollup && q.limit === undefined && unordered &&
    keys.every((key) => constantNode(key.expr, true, true) && refersToRow(key.expr, lookup)) &&
    sink.specs.length > 0 && sink.specs.every((spec) => spec.name === 'AVG' && spec.type.kind === 'decimal') &&
    !items.some((item) => aggregateReaders.includes(item.compiled))
  const { strategy, index: groupIndex } = oneGroup ? { strategy: 'index' as const, index: undefined } : chooseStrategy(copiedAverage ? undefined : alone?.def, keyColumns, rollup, distinctAggregate)

  // HAVING sees the select list's aliases, its columns and the keys; a column
  // that is none of those is 1054 even when the table has it (8.4.11).
  let having: readonly Pick<Compiled, 'eval'>[] | undefined
  if (node.having !== undefined && !neverNullTest(node.having)) {
    const havingScope = selectedOnly(lookup, selectItems, keys.flatMap((k) => (k.index === undefined ? [] : [k.index])), node.having)
    having = resolveCondition(run, postCtx('having clause', havingScope), substituteAliases(node.having, selectItems), limitCount).predicates
  }

  checkGrouping(missingGrouping)

  const orderKeys = order.map((o) => orderKey(o, items, postCtx('order clause', lookup, windows)))

  if (modeOf(run.env.session.sqlMode).onlyFullGroupBy) {
    checkFullGroupBy(lookup, scope, keys, node.where, from?.joins ?? [], items.map((i) => i.expr), order.filter((o) => !integerLiteral(o.expr) && selectedItem(o.expr, items) === undefined).map((o) => o.expr), node.groupBy === undefined, rollup)
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
    order.length <= keys.length &&
    order.every((o, i) => {
      if (o.desc === true) return false
      const key = keys[i] as (typeof keys)[number]
      const e = integerLiteral(o.expr) ? selectItems[Number(o.expr.value as bigint) - 1]?.expr : o.expr
      return matchesKey(e, key)
    })
  const stream = (strategy === 'sort' || strategy === 'index') && !unordered && !orderMatchesKeys && !oneGroup
  if (from !== undefined && !copiedAverage) from.sortedBy(sortTable(q.orderBy?.map((o) => o.expr), node.groupBy?.items, selectItems, from.scope), keep)
  const firstOrder = strategy === 'sort' && !rollup ? from?.orderGroupsFirst(keys) : undefined
  let dataColumns: ((trx: Trx | undefined) => readonly ResultType[]) | undefined
  if (run.preparing !== true) {
    const facts = selectFacts(run, from, node, limitCount)
    if (copiedAverage || !facts.empty) {
      const consts = new Set(facts.constTables.map((t) => t.alias))
      const fixed = new Set([...consts, ...(facts.nullTables ?? [])])
      const own = items.map((i) => i.compiled.type)
      const seenKeys = new Set<number>()
      for (const item of items) {
        const e = withoutUnaryPlus(item.expr)
        const t = item.compiled.type
        if (!refersToRow(e, lookup, consts)) continue
        const aggregateCall = aggregateReaders.includes(item.compiled)
        if (!copiedAverage && !aggregateCall && containsAggregate(e)) continue
        if (strategy === 'implicit') {
          if (!aggregateCall) patchType(item, { nullable: true })
          continue
        }
        // A key named twice is one field of the table: only its first mention
        // carries GROUP_FLAG (8.4.11, `SELECT t, t … GROUP BY t`).
        const at = localColumn(e, lookup)
        const isKey = at !== undefined && keys.some((k) => k.index === at) && !seenKeys.has(at)
        if (at !== undefined) seenKeys.add(at)
        // The keys are the temporary table's key, columns or expressions;
        // everything else is a field beside them.
        const isKeyExpression = e.kind !== NODE.COLUMN && !aggregateCall && keys.some((k) => k.index === undefined && matchesKey(e, k))
        // A key that reads only NULL-complemented tables is a constant, and no part of the table's key.
        // …and so is one the WHERE holds to a constant over a join (8.4.11: `FROM p, q WHERE p.g = 1 GROUP BY q.t, p.g`).
        const keyed = (isKey || isKeyExpression) && refersToRow(e, lookup, fixed) && !(source === undefined && e.kind === NODE.COLUMN && pinnedByWhere(node.where, e.parts))
        if (strategy === 'temp' || copiedAverage) {
          patchType(item, { temporary: !copiedAverage && keyed ? true : 'pinned', ownInTemporary: !copiedAverage && t.ownInTemporary === true, length: copiedLength(t), ...(aggregateCall ? { names: EMPTY_NAMES } : {}) })
          // AVG and similar aggregates retain an intermediate, not this final value.
          if (copiedAverage || t.ownInTemporary !== true) item.compiled = decimalField(item.compiled)
        }
        else if (stream || (source === undefined && from !== undefined && strategy === 'sort' && firstOrder !== 'index' && t.column !== undefined)) {
          // Streamed output and sort-based grouping expose copied column metadata;
          // an ordered first-table index without an output sort keeps source flags.
          patchType(item, { temporary: 'stream', length: copiedLength(t) })
        }
      }
      dataColumns = copiedColumns(run, facts, own, items)
    }
  }

  // The WHERE: a FROM applies it itself (M5.43); one with no FROM is a Filter here.
  if (from !== undefined) from.filter(node.where, resolved.read)
  // An index-ordered grouping reads that index whole, in its order, whatever range the WHERE would choose.
  if (strategy === 'index' && groupIndex !== undefined) from?.readInOrder(groupIndex, true, false, alone?.alias)
  const locking = (q.locking?.length ?? 0) > 0
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
  const plan = { width, keys: keys.map((k) => k.compiled), specs: sink.specs, strategy: firstOrder === undefined ? strategy : 'index' as const, rollup }
  const copyResults = copiedAverage && distinctAggregate
  const sortsOutput = orderKeys.length > 0 && !(orderMatchesKeys && strategy !== 'temp') && !oneGroup
  const groups = rollup ? 'Group aggregate with rollup' : 'Group aggregate'
  const stages: Stage[] = [
    ...(from === undefined && node.where !== undefined ? [filterStage(resolved.predicates)] : []),
    {
      run(rows, env) {
        const grouped = groupRows(rows, plan, env)
        return copyResults ? Array.from(grouped, (item) => {
          let at = level + 1
          for (const spec of sink.specs) item.row[at++] = convertTo(spec.eval(item.row, env), spec.type)
          return item
        }) : grouped
      },
      // As the strategy runs: an Aggregate of everything, a temporary table keyed by the groups, or groups read in order — sorted for them first, a join's rows streamed into a table to be.
      describe(n) {
        if (strategy === 'implicit') return planNode('Aggregate', [n])
        let grouped: PlanNode
        if (strategy === 'temp') grouped = planNode('Aggregate using temporary table', [n])
        else grouped = planNode(groups, [strategy === 'sort' && firstOrder === undefined ? planNode('Sort', [wrap(source === undefined, 'Stream results', n)]) : n])
        if (copyResults) grouped = planNode('Temporary table', [grouped])
        return strategy === 'temp' || copyResults ? planNode('Table scan on <temporary>', [grouped, ...(copiedAverage ? subqueryNodes(run, 'field list') : [])]) : grouped
      },
    },
    ...(having === undefined ? [] : [filterStage(having, run)]),
    ...(windows === undefined || windows.windows.length === 0 ? [] : [windowStage(windows)]),
    // Retained DISTINCT and unverified ordered/limited forms remain unexplained.
    deliverStage(items.map((i) => i.compiled), sortsOutput ? orderKeys : [], deduplicate, { deduplicated: copiedAverage, streamed: stream, described: node.distinct !== true || copiedAverage || (!deduplicate && unordered && q.limit === undefined), keep: q.limit && keep }),
    ...(q.limit ? [limitStage(offset, limitCount)] : []),
  ]

  return {
    ...resultColumns(items, dataColumns),
    locking,
    explain() {
      // Implicit grouping answers one row even of nothing: proved empty, it is
      // "Zero input rows" in the Aggregate's place, with only its HAVING and
      // LIMIT around it; its one row is not sorted, and its list's subqueries
      // are not run (8.4.11).
      if (limitCount !== 0 && provedEmpty(run, from, node, limitCount)) {
        if (strategy !== 'implicit') return [planNode('Zero rows')]
        let n = planNode('Zero input rows')
        if (having !== undefined) n = withSubqueries(run, planNode('Filter', [n]), 'having clause')
        if (q.limit) n = limitStage(offset, limitCount).describe(n) ?? n
        return [n]
      }
      // A const table is read while planning: its row, if the WHERE holds of it, is what is grouped (8.4.11).
      let fetched = false
      if (constTable && from !== undefined) {
        for (const _ of from.rows(undefined, run.env, { locking: false })) fetched = true
        if (!fetched && strategy !== 'implicit') return [planNode('Zero rows')]
      }
      const source = from === undefined || fetched ? planNode('Rows fetched before execution') : withSubqueries(run, from.explain(run.env), 'where clause')
      const n = describeStages(source, stages)
      return n === undefined ? undefined : [n, ...(copiedAverage ? [] : subqueryNodes(run, 'field list'))]
    },
    rows(trx, given, ready) {
      const env = executionEnv(run, trx, given)
      const rows = values(runStages(from === undefined ? [{ row: [] }] : from.rows(trx, env, { locking, ready: copiedAverage ? ready : undefined }), stages, env))
      // The admitted unordered DISTINCT finishes its final field copy before delivery.
      return copiedAverage ? [...rows] : rows
    },
  }
}

/** Whether a top-level conjunct of `where` equates the column `parts` with a literal or a parameter. */
function pinnedByWhere(where: Expression | undefined, parts: readonly string[]): boolean {
  const same = (e: Expression) => e.kind === NODE.COLUMN && e.parts.length === parts.length && e.parts.every((p, i) => p.toLowerCase() === (parts[i] as string).toLowerCase())
  const constant = (e: Expression) => e.kind === NODE.LITERAL || e.kind === NODE.PLACEHOLDER
  return splitAnd(where).some((e) => e.kind === NODE.BINARY && e.op === '=' && ((same(e.left) && constant(e.right)) || (same(e.right) && constant(e.left))))
}

/** Resolve only bare source fields, keeping computed values and outer constants separate. */
function localColumn(e: Expression | undefined, scope: Scope): number | undefined {
  return e?.kind === NODE.COLUMN ? safeIndex(scope, e.parts) : undefined
}

/** A column's local slot; an enclosing query's column is a constant here. */
function safeIndex(scope: Scope, parts: readonly string[]): number | undefined {
  const r = safeResolve(scope, parts, 'field list')
  return r?.depth ? undefined : r?.index
}

/** Whether an aggregate in `e` needs its groups sorted: a DISTINCT one, or any GROUP_CONCAT (8.4.11's plans). */
function needsSortedGroups(e: unknown): boolean {
  return someNode(e, (node) => {
    const n = node as { kind?: string; distinct?: boolean; name?: string }
    if (n.kind === NODE.SUBQUERY) return false
    if (isAggregate(n as Expression)) {
      const name = nativeCallName(n as CallNode)
      // JSON aggregates sort their groups as GROUP_CONCAT does (M5.21).
      if (name === 'GROUP_CONCAT' || name === 'JSON_ARRAYAGG' || name === 'JSON_OBJECTAGG' || (n.distinct === true && name !== 'MIN' && name !== 'MAX')) return true
    }
    return undefined
  })
}

/**
 * Whether `e` reads the row at all: a column or an aggregate. A constant does
 * not, and is never copied into a temporary table — nor is `c IS NULL` over a
 * column that cannot be NULL, which MySQL folds to a constant before it
 * plans (8.4.11: it keeps its 0x81 through a DISTINCT).
 */
function refersToRow(e: unknown, scope?: Scope, consts?: ReadonlySet<string>): boolean {
  return someNode(e, (node) => {
    const n = node as { kind?: string; op?: string; operand?: Expression; parts?: readonly string[] }
    // A const table's column is a constant: the optimizer read its one row.
    if (n.kind === NODE.COLUMN) {
      if (consts !== undefined && consts.size > 0 && scope instanceof TableScope) {
        const r = safeResolve(scope, n.parts as string[], 'field list')
        const alias = r === undefined ? undefined : scope.columnAt(r.index)?.table.alias
        if (alias !== undefined && consts.has(alias)) return false
      }
      return true
    }
    if (n.kind === NODE.UNARY && (n.op === 'IS NULL' || n.op === 'IS NOT NULL') && n.operand?.kind === NODE.COLUMN && scope !== undefined) {
      if (safeResolve(scope, n.operand.parts, 'field list')?.type.nullable === false) return false
    }
    if (isAggregate(n as Expression)) return true
    // A correlated subquery is evaluated per row and copied like any value; an uncorrelated one is a constant.
    if (n.kind === NODE.SUBQUERY) return scope instanceof TableScope && correlatedIn(n, scope)
    return undefined
  })
}

/** HAVING's bare names that are select-list aliases, replaced by the expressions they name. */
/**
 * The scope HAVING reads columns through: the select list's columns, and
 * `also` (a grouped query's keys), and nothing else of the row — a column
 * that is neither is 1054 even when the table has it (8.4.11).
 */
function selectedOnly(lookup: Scope, items: readonly { readonly expr: Expression; readonly alias?: string }[], also: readonly number[], having: Expression): Scope {
  const allowed = new Set<number>(also)
  const names = new Set<string>()
  for (const parts of columnRefs(having)) if (parts.length === 1) names.add(parts[0]!.toLowerCase())
  for (const i of items) {
    const at = localColumn(i.expr, lookup)
    if (at !== undefined) allowed.add(at)
    // A named alias exposes its expression's columns through HAVING.
    const alias = i.alias?.toLowerCase()
    if (alias === undefined || !names.has(alias)) continue
    for (const parts of columnRefs(i.expr)) {
      const at = safeIndex(lookup, parts)
      if (at !== undefined) allowed.add(at)
    }
  }
  // MATCH finds its index through the tables, then names its columns
  // through `resolve`: one not selected is 1054 there too (8.4.11).
  const tables = (lookup as { readonly tables?: TableScope['tables'] }).tables
  return {
    ...(tables === undefined ? {} : { tables }),
    resolve(parts, clause) {
      const r = lookup.resolve(parts, clause)
      // An enclosing query's column is a constant here, and always visible.
      if ((r.depth ?? 0) === 0 && !allowed.has(r.index)) throw unknownColumnError(parts.join('.'), clause)
      return r
    },
  }
}

/**
 * HAVING's names, an alias replaced by what it names: two items of that
 * alias are 1052, and one holding a window function is 3594 (8.4.11).
 */
function substituteAliases(e: Expression, items: readonly { readonly expr: Expression; readonly alias?: string }[]): Expression {
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x
    if (Array.isArray(x)) return x.map(walk)
    const node = x as { kind?: string; parts?: readonly string[] }
    if (node.kind === NODE.SUBQUERY || node.kind === NODE.LITERAL) return x
    if (node.kind === NODE.COLUMN && node.parts?.length === 1) {
      const name = node.parts[0] as string
      const hits = items.filter((i) => i.alias?.toLowerCase() === name.toLowerCase())
      if (hits.length > 1) throw ambiguousColumnError(name, 'having clause')
      const hit = hits[0]
      if (hit !== undefined) {
        if (containsWindow(hit.expr)) throw sqlError('ER_WINDOW_INVALID_WINDOW_FUNC_ALIAS_USE', `You cannot use the alias '${name}' of an expression containing a window function in this context.'`)
        return hit.expr
      }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) out[k] = walk(v)
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
  keys: readonly { readonly index: number | undefined; readonly expr: Expression }[],
  where: Expression | undefined,
  joins: readonly JoinCondition[],
  selectExprs: readonly Expression[],
  orderExprs: readonly Expression[],
  implicit: boolean,
  rollup = false,
): void {
  const determined = new Set<number>()
  for (const k of keys) if (k.index !== undefined) determined.add(k.index)
  const keyTexts = new Set(keys.filter((k) => k.index === undefined).map((k) => deparse(k.expr)))
  // Under ROLLUP a key can be NULL where its row's other columns are not, so
  // nothing is functionally dependent on it: not through a key, a WHERE
  // equality or a constant (8.4.11: `WHERE grp = 1 GROUP BY id WITH ROLLUP`
  // selecting `grp` is 1055).
  if (rollup) where = undefined
  if (rollup) joins = []
  // An inner join's ON is as good as the WHERE; an outer join's equality
  // determines its nullable side from the preserved one, never the reverse
  // (8.4.11: `g LEFT JOIN ge ON ge.x = g.id GROUP BY g.id` allows `ge.x`, the
  // same with the tables swapped does not).
  const directed: { readonly e: Expression; readonly into: ReadonlySet<string> | undefined }[] = splitAnd(where).map((e) => ({ e, into: undefined }))
  for (const j of joins) {
    for (const e of splitAnd(j.on)) directed.push({ e, into: j.left ? j.innerAliases : undefined })
  }
  const constant = (e: Expression): boolean => e.kind === NODE.LITERAL ? e.type !== 'null' : e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && constant(e.operand))
  const edges: [number, number][] = []
  const aliasOf = (index: number): string | undefined => scope?.columnAt(index)?.table.alias
  // Only `=`: `<=>` determines nothing, with a constant or a column (8.4.11: `WHERE id <=> 0 GROUP BY g` selecting `n` is 1055).
  for (const { e: c, into } of directed) {
    if (c.kind !== NODE.BINARY || c.op !== '=') continue
    const l = localColumn(c.left, lookup)
    const r = localColumn(c.right, lookup)
    const allowed = (to: number): boolean => into === undefined || into.has(aliasOf(to) ?? '')
    if (l !== undefined && r !== undefined) {
      if (allowed(r)) edges.push([l, r])
      if (allowed(l)) edges.push([r, l])
    } else if (l !== undefined && constant(c.right) && allowed(l)) determined.add(l)
    else if (r !== undefined && constant(c.left) && allowed(r)) determined.add(r)
  }
  // Equality and unique keys only grow this set; its size is the fixed-point test.
  for (let before = -1; before !== determined.size; ) {
    before = determined.size
    for (const [a, b] of edges) if (determined.has(a)) determined.add(b)
    for (const t of rollup ? [] : (scope?.tables ?? [])) {
      const def = t.def
      if (def === undefined) continue
      const offsetOf = (name: string): number => t.offset + indexOfColumn(def.columns, name)
      if (!def.indexes.some((i) => uniqueKey(def, i) && (i.kind === 'primary' || i.parts.every((p) => p.prefix === undefined)) && i.parts.every((p) => determined.has(offsetOf(p.column))))) continue
      for (let i = 0; i < def.columns.length; i++) determined.add(t.offset + i)
    }
  }
  const offending = (root: Expression): number | undefined => {
    let hit: number | undefined
    someNode(root, (value) => {
      const e = value as Expression
      if (e.kind === undefined || keyTexts.has(deparse(e))) return false
      if (e.kind === NODE.CALL && (isAggregate(e) || nativeCallName(e) === 'ANY_VALUE')) return false
      if (e.kind === NODE.SUBQUERY) return false
      if (e.kind === NODE.COLUMN) {
        const at = safeIndex(lookup, e.parts)
        if (at !== undefined && !determined.has(at)) hit = at
        return hit !== undefined
      }
      return undefined
    })
    return hit
  }
  const check = (exprs: readonly Expression[], clause: string): void => exprs.forEach((e, i) => {
    const at = offending(e)
    if (at === undefined) return
    if (implicit) throw sqlError('ER_MIX_OF_GROUP_FUNC_AND_FIELDS', `In aggregated query without GROUP BY, expression #${i + 1} of SELECT list contains nonaggregated column '${qualifiedColumn(scope, at)}'; this is incompatible with sql_mode=only_full_group_by`)
    throw sqlError('ER_WRONG_FIELD_WITH_GROUP', `Expression #${i + 1} of ${clause} is not in GROUP BY clause and contains nonaggregated column '${qualifiedColumn(scope, at)}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`)
  })
  check(selectExprs, 'SELECT list')
  if (!implicit) check(orderExprs, 'ORDER BY clause')
}

/**
 * Whether MySQL runs a `SELECT DISTINCT` without a temporary table: when the
 * select list names a whole key of NOT NULL columns, every row is distinct
 * already; when it is nothing but the leading columns of an index, the index
 * delivers them grouped (8.4.11 reports `SELECT DISTINCT age` with `age`'s own
 * key flags when `age` is indexed, and with GROUP_FLAG when it is not).
 * Read the compiler's expanded select list through local resolution. Physical
 * elimination requires a whole UNIQUE key; metadata also accepts a visible
 * indexed prefix when every selected expression is a local source column.
 */
function distinctKey(def: TableDef, items: readonly { readonly expr: Expression }[], scope: Scope, whole = false): boolean {
  const named = new Set<string>()
  let onlyColumns = true
  for (const item of items) {
    const e = item.expr
    if (e.kind !== NODE.COLUMN || safeIndex(scope, e.parts) === undefined) {
      onlyColumns = false
      continue
    }
    named.add((e.parts.at(-1) as string).toLowerCase())
  }
  const covered = (parts: IndexDef['parts'], count = parts.length): boolean => parts.length >= count && parts.slice(0, count).every((p) => p.prefix === undefined && named.has(p.column.toLowerCase()))
  return def.indexes.some((i) => (uniqueKey(def, i) && covered(i.parts)) || (!whole && onlyColumns && i.invisible !== true && covered(i.parts, named.size)))
}

/** A clause's readers and written constant outcomes, bound in its own context. */
function resolveCondition(run: Run, ctx: CompileContext, condition: Expression | undefined, count: number | undefined) {
  type Predicate = { eval: Compiled['eval'] }
  const resolving = run.preparing || run.protocol === 'text'
  const { conditions: _conditions, ...fixedEnv } = run.env
  const conjuncts = splitAnd(condition)
  // Binding precedes evaluation, including warnings in an untaken conjunct.
  const entries = new Map<Expression, Predicate>(conjuncts.map((e) => {
    const c = compile(e, ctx)
    return [e, { eval: logicalOperand(c, e, resolving ? ctx : undefined) }]
  }))
  let impossible = false
  // Only a written constant stops this pass; inferred row facts cannot.
  for (const [e, c] of entries) {
    if (!constantNode(e, run.params !== undefined && (resolving || count !== 0))) continue
    // PREPARE owns fixed-literal diagnostics; bound parameters still execute here.
    const value = c.eval([], !resolving && constantNode(e, false) ? fixedEnv : run.env)
    c.eval = () => value
    if (truth(value) !== true) {
      impossible = true
      break
    }
  }
  return {
    // New semijoin nodes are verified integer comparisons, in their expanded scope.
    read: (e: Expression, at = ctx) => entries.get(e) ?? compile(e, at),
    predicates: [...entries.values()],
    facts(def: TableDef, alias: string) {
      // Column names are case-insensitive; share the same pin set with both readers.
      const facts = { impossible, pins: new Set<string>(), constTable: false }
      if (condition === undefined) return facts
      const columnOf = (e: Expression) => tableColumn(e, def, alias)
      facts.impossible ||= conjuncts.some((e) => impossiblePredicate(e, columnOf))
      for (const column of def.columns) if (pinOf(condition, column, columnOf) !== undefined) facts.pins.add(column.name.toLowerCase())
      facts.constTable = def.indexes.some((i) => i.kind !== 'index' && i.parts.every((p) => p.prefix === undefined && facts.pins.has(p.column.toLowerCase())))
      return facts
    },
  }
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
function impossiblePredicate(e: Expression, columnOf: (e: Expression) => ColumnDef | undefined): boolean {
  if (e.kind === NODE.UNARY && e.op === 'IS NULL') return columnOf(e.operand)?.nullable === false
  if (e.kind !== NODE.BINARY || e.op !== '=') return false
  const left = columnOf(e.left)
  return neverEqual(left ?? columnOf(e.right), left !== undefined ? e.right : e.left)
}

/** An `ORDER BY` item: a position in the select list, a select-list alias, or an expression over the table. */
function orderKey(o: OrderItem, items: readonly { name: string; compiled: Compiled; alias?: string }[], ctx: CompileContext): SortKey {
  const e = o.expr
  const item = selectedItem(e, items)
  if (integerLiteral(e) && item === undefined) throw unknownColumnError(String(Number(e.value as bigint)), 'order clause')
  // The caller supplies its aggregate/window context for unbound expressions.
  return { expr: item?.compiled ?? compile(e, ctx), desc: o.desc === true }
}

/** Parse the count before the offset, preserving LIMIT error precedence. */
function queryLimit(run: Run, q: QueryExpression): [count: number | undefined, offset: number] {
  const bound = q.limit
  return bound === undefined ? [undefined, 0] : [limitValue(run, bound.count), bound.offset === undefined ? 0 : limitValue(run, bound.offset)]
}

/**
 * A `LIMIT` operand: a non-negative integer literal, or `?`. A bound `?` takes
 * what 8.4.11 takes — an integer, a whole double, or a string read as an
 * integer (`'x'` is 0 rows) — and a fractional double is ER_WRONG_ARGUMENTS
 * naming `mysqld_stmt_execute`, as the server words it.
 */
export function limitValue(run: Run, e: Expression, what = 'LIMIT'): number {
  if (e.kind === NODE.PLACEHOLDER && run.params === undefined) return 0
  const v = compile(e, compileContext(run, EMPTY_SCOPE, what)).eval([], run.env)
  // Invalid representations and negative counts have the same argument error.
  const n = v === null || (v.kind === 'double' && !Number.isInteger(v.v)) || v.kind === 'decimal' || v.kind === 'datetime' || v.kind === 'time' ? -1n : toInteger(v)
  if (n < 0n) throw wrongArgumentsError(e.kind === NODE.PLACEHOLDER ? 'mysqld_stmt_execute' : what)
  return Math.min(Number.MAX_SAFE_INTEGER, Number(n))
}

/** The statement's column definitions, for its resultset and for `COM_STMT_PREPARE`. */
export function columnsOf(run: Run, columns: SelectPlan['columns']): ColumnDefinition[] {
  return columns.map((c) => columnDefinition(c.name, c.type, run.env.session.characterSet))
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
 * With `emit`, admitted reader construction first enqueues metadata with no rows.
 * Each pause then hands the rows read since the last one to it and
 * keeps none, so a streamed result holds a batch at most (M5.40); what it
 * returns is the rows after the last pause, and on a failure the rows read
 * since then are handed out before the error is thrown.
 */
export function* resultSteps(run: Run, plan: SelectPlan, trx: Trx | undefined, emit?: (batch: ResultSet) => void): Generator<void, ResultSet> {
  plan.optimize?.(trx)
  const described = plan.columnsAt?.(trx) ?? plan.columns
  const columns = columnsOf(run, described)
  let rows: RowValue[][] = []
  try {
    for (const values of plan.rows(trx, undefined, () => emit?.({ columns, rows: [] }))) {
      rows.push(values.map((v, i) => toWire(v, described[i]!.type, run.protocol, run.env.session)))
      if (rows.length % PACE_ROWS !== 0) continue
      if (emit !== undefined) {
        emit({ columns, rows })
        rows = []
      }
      yield
    }
  } catch (e) {
    // A server sends each row as it is read, so the rows before a failure
    // reach the client ahead of its error (8.4.11: a subquery's 1242 at the
    // 700th row follows 699 rows).
    if (rows.length > 0) emit?.({ columns, rows })
    throw e
  }
  return { columns, rows }
}
