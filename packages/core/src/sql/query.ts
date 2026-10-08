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
import { FIELD_TYPE } from '@myjs/bytes'
import { messages, sqlError, type ColumnDefinition, type ResultSet, type RowValue } from '@myjs/protocol'
import { toInteger, truth, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type CompileContext, type Compiled, type Env, type Row, type Scope } from './compile.ts'
import { columnDefinition, type ResultType } from './meta.ts'
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
  if (node.groupBy !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('GROUP BY'))
  if (node.having !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('HAVING'))
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
    const text = texts[i]
    // A column is named by its own name as written, a string literal by its
    // value, and anything else by its source text.
    const name =
      item.alias ??
      (e.kind === NODE.COLUMN ? (e.parts[e.parts.length - 1] as string) : e.kind === NODE.LITERAL && e.type === 'string' ? (e.value as string) : text === undefined ? deparseName(e) : text)
    items.push({ name, compiled, ...(item.alias === undefined ? {} : { alias: item.alias }) })
  })

  // `SELECT DISTINCT` is run through a temporary table — which changes the
  // metadata a client sees — unless the select list holds a whole key of NOT
  // NULL columns, in which case every row is distinct already and MySQL drops
  // the DISTINCT.
  const limitCount = q.limit === undefined ? undefined : limitValue(run, q.limit.count, 'LIMIT')
  const offset = q.limit?.offset === undefined ? 0 : limitValue(run, q.limit.offset, 'LIMIT')
  if (node.distinct === true && source !== undefined && !holdsKey(source.def, node.items, source.alias)) {
    // `LIMIT 0` returns nothing before a row is read — unless an offset must
    // be counted off sorted rows: `ORDER BY 1 LIMIT 0 OFFSET 1` still makes
    // the table, and the same without the ORDER BY does not (8.4.11).
    const zero = limitCount === 0 && (offset === 0 || q.orderBy === undefined)
    const constant = distinctConstant(run, source.def, source.alias, node, zero)
    if (constant !== true) {
      for (const item of items) {
        const pinned = item.compiled.type.column !== undefined && constant.has(item.compiled.type.column.orgName.toLowerCase())
        item.compiled = { ...item.compiled, type: { ...item.compiled.type, temporary: pinned ? 'pinned' : true } }
      }
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
 * `true` when MySQL answers a `SELECT DISTINCT` without its temporary table
 * because it can tell before reading a row that the rows it returns are all
 * alike, or that there are none; otherwise the columns the WHERE pins, which
 * the table holds but does not group by. Each rule is 8.4.11's, probed shape
 * by shape:
 *
 *   - A zero limit, and a WHERE that folds to false — a NOT NULL column `IS
 *     NULL`, or a conjunct with no column in it that is not true — return
 *     nothing, and no table is made.
 *   - A WHERE that binds every part of the primary key or of a UNIQUE key to a
 *     constant makes the table a constant one: a row or none.
 *   - A DISTINCT column that the WHERE pins to one value — `c = 5` at its top
 *     level, or `<=>`, `IN (5)`, `NOT (c <> 5)`, or an OR of one of those
 *     with itself — is dropped from the grouping DISTINCT becomes, and when
 *     every column is dropped there is nothing to group. A string column
 *     against a number pins nothing (`b = 5` holds for `'5'` and `'5.0'`),
 *     and neither does `IS NULL`, on 8.4.
 */
function distinctConstant(run: Run, def: TableDef, alias: string, node: SelectNode, zeroLimit: boolean): true | Set<string> {
  if (zeroLimit) return true
  const columnOf = (e: Expression): ColumnDef | undefined => {
    if (e.kind !== NODE.COLUMN || e.parts.length > 3 || (e.parts.length >= 2 && e.parts[e.parts.length - 2] !== alias)) return undefined
    const name = (e.parts[e.parts.length - 1] as string).toLowerCase()
    return def.columns.find((c) => c.name.toLowerCase() === name)
  }
  const constant = (e: Expression): boolean =>
    e.kind === NODE.LITERAL || e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && constant(e.operand))
  const numeric = (e: Expression): boolean => (e.kind === NODE.LITERAL && (e.type === 'int' || e.type === 'decimal' || e.type === 'double')) || (e.kind === NODE.UNARY && numeric(e.operand))
  /** The column a conjunct pins to one value, and that value's text. */
  const pinned = (e: Expression): { column: ColumnDef; value: string } | undefined => {
    if (e.kind === NODE.UNARY && e.op === 'NOT' && e.operand.kind === NODE.BINARY && (e.operand.op === '<>' || e.operand.op === '!=')) return pinned({ ...e.operand, op: '=' })
    if (e.kind !== NODE.BINARY) return undefined
    if (e.op === 'OR' || e.op === '||') {
      const a = pinned(e.left)
      const b = pinned(e.right)
      return a !== undefined && b !== undefined && a.column === b.column && a.value === b.value ? a : undefined
    }
    let column: ColumnDef | undefined
    let value: Expression | undefined
    if (e.op === 'IN' && e.right.kind === NODE.ROW && e.right.items.length === 1) {
      column = columnOf(e.left)
      value = e.right.items[0]
    } else if (e.op === '=' || e.op === '<=>') {
      column = columnOf(e.left) ?? columnOf(e.right)
      value = columnOf(e.left) !== undefined ? e.right : e.left
    }
    if (column === undefined || value === undefined || !constant(value)) return undefined
    if (column.type.collationId !== undefined && numeric(value)) return undefined
    return { column, value: deparse(value) }
  }
  const conjuncts: Expression[] = []
  const flatten = (e: Expression): void => {
    if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) {
      flatten(e.left)
      flatten(e.right)
    } else conjuncts.push(e)
  }
  if (node.where !== undefined) flatten(node.where)
  const pins = new Set<ColumnDef>()
  for (const c of conjuncts) {
    if (c.kind === NODE.UNARY && c.op === 'IS NULL' && columnOf(c.operand)?.nullable === false) return true
    if (neverEqual(c, columnOf)) return true
    if (!hasColumn(c)) {
      try {
        if (truth(compile(c, compileContext(run, EMPTY_SCOPE, 'where clause')).eval([], run.env)) !== true) return true
      } catch {
        // Not something the optimizer folds; the scan will say.
      }
    }
    const p = pinned(c)
    if (p !== undefined) pins.add(p.column)
  }
  const named = (n: string): ColumnDef | undefined => def.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())
  if (def.indexes.some((i) => i.kind !== 'index' && i.parts.every((p) => p.prefix === undefined && pins.has(named(p.column) as ColumnDef)))) return true
  const all = node.items.every((item) => {
    const column = columnOf(item.expr)
    return column !== undefined && pins.has(column)
  })
  return all ? true : new Set([...pins].map((c) => c.name.toLowerCase()))
}

/**
 * `int_col = 9.5` and `tinyint_col = 300`: an integer column against a
 * number it cannot hold, which MySQL folds to false before reading a row
 * (8.4.11 answers `SELECT DISTINCT score FROM p WHERE flag = 9.5` without its
 * temporary table).
 */
function neverEqual(e: Expression, columnOf: (e: Expression) => ColumnDef | undefined): boolean {
  if (e.kind !== NODE.BINARY || (e.op !== '=' && e.op !== '<=>')) return false
  const column = columnOf(e.left) ?? columnOf(e.right)
  const other = columnOf(e.left) !== undefined ? e.right : e.left
  const bits: Record<number, number> = { [FIELD_TYPE.TINY]: 8, [FIELD_TYPE.SHORT]: 16, [FIELD_TYPE.INT24]: 24, [FIELD_TYPE.LONG]: 32, [FIELD_TYPE.LONGLONG]: 64 }
  const n = column === undefined ? undefined : bits[column.type.type]
  if (column === undefined || n === undefined) return false
  const negative = other.kind === NODE.UNARY && other.op === '-'
  const literal = negative ? other.operand : other
  if (literal.kind !== NODE.LITERAL) return false
  // A string that is wholly a number is that number here (`flag = '9.5'`).
  const text = String(literal.value).trim()
  const number = literal.type === 'int' || literal.type === 'decimal' || literal.type === 'double' || (literal.type === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text))
  if (!number) return false
  if (!/^[+-]?\d+$/.test(text) && Number(text) % 1 !== 0) return true
  const v = (negative ? -1n : 1n) * (/^[+-]?\d+$/.test(text) ? BigInt(text) : BigInt(Math.trunc(Number(text))))
  const unsigned = column.type.unsigned === true
  const min = unsigned ? 0n : -(2n ** BigInt(n - 1))
  const max = unsigned ? 2n ** BigInt(n) - 1n : 2n ** BigInt(n - 1) - 1n
  return v < min || v > max
}

/** Whether an expression reads a column, or anything else a constant cannot (a subquery). */
function hasColumn(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const node = e as { kind?: string }
  if (node.kind === NODE.COLUMN || node.kind === NODE.SUBQUERY || node.kind === NODE.VARIABLE) return true
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(hasColumn) : typeof v === 'object' && hasColumn(v)))
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
