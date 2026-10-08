// M5.8 / M5.17 — INSERT (with IGNORE, ON DUPLICATE KEY UPDATE and REPLACE),
// UPDATE and DELETE on one table.
//
// What a client is told matters as much as what is stored, and MySQL's rules
// for it are not the obvious ones (each read off 8.4.11 through `mysql2`):
//
//   - `affectedRows` for an UPDATE counts rows *changed*, not rows matched —
//     unless the client asked for `CLIENT_FOUND_ROWS`, as `mysql2` does by
//     default, in which case it counts matched rows. `info` always says both:
//     "Rows matched: 4  Changed: 2  Warnings: 0".
//   - A multi-row INSERT says "Records: 3  Duplicates: 0  Warnings: 0"; a
//     single-row one says nothing.
//   - INSERT's counters and `insertId`, and the AUTO_INCREMENT values it
//     hands out, are `insert`'s and `AutoIncrement`'s to explain, below.
//
// UPDATE and DELETE read every row they will change before changing any
// (doc 30: a scan is not interleaved with writes to its own table), so a row
// an UPDATE moves within the clustered order is never met twice.
import { CHARSET_BINARY, FIELD_TYPE, MyjsError } from '@myjs/bytes'
import { CLIENT, hasCap, messages, sqlError, type OkResult } from '@myjs/protocol'
import type { ColumnDef, FieldBytes, IndexDef, RowId, Table, TableDef, Trx } from '@myjs/engine'
import { EngineError } from '@myjs/engine'
import { NODE, QUERY, REF, parseExpression, type Assignment, type ColumnNode, type DeleteNode, type Expression, type InsertNode, type TableName, type UpdateNode } from '@myjs/parser'
import { decodeField, encodeField, integerRange, intValue, toInteger, toText, type StoreContext, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type Compiled, type Row, type Scope } from './compile.ts'
import { checker, checkViolated } from './checks.ts'
import { guarded, isReferenced } from './foreign-keys.ts'
import { containsAggregate } from './group.ts'
import { filter, limit, sort, type ScannedRow } from './operators.ts'
import { accessRows, chooseAccess } from './plan.ts'
import { checkTargetNotRead, compileContext, limitValue, openTable, planQuery, withClause, type Run } from './query.ts'
import { TableScope } from './scope.ts'
import { NULL_TYPE, type ResultType } from './meta.ts'

const isStrict = (sqlMode: string): boolean => /\bSTRICT_(TRANS|ALL)_TABLES\b/.test(sqlMode)

/** A column's DEFAULT, compiled: its expression, or NULL, or "none" for a NOT NULL column without one. */
/** Whether an expression names a column anywhere in it. */
function namesColumn(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  if (Array.isArray(e)) return e.some(namesColumn)
  if ((e as { kind?: unknown }).kind === NODE.COLUMN) return true
  return Object.values(e).some((v) => typeof v === 'object' && namesColumn(v))
}

/**
 * Whether a column's default names another column of its row, `DEFAULT (x +
 * 1)`: such a default is evaluated over the row once its given values are in
 * (8.4.11), and the others before.
 */
export function rowDependent(column: ColumnDef): boolean {
  const text = column.attributes?.['default']
  return typeof text === 'string' && namesColumn(parseExpression(text))
}

/**
 * A literal default must store in its column as a strict INSERT would, or
 * the definition is 1067 — `TINYINT DEFAULT 1000`, `VARCHAR(5) DEFAULT
 * 'toolongvalue'`, an ENUM's non-member. What stores with a note, a
 * DECIMAL's extra digits, is kept rounded and counted. Returns the notes.
 */
export function checkDefaults(run: Run, columns: readonly ColumnDef[]): number {
  let notes = 0
  for (const column of columns) {
    const text = column.attributes?.['default']
    if (typeof text !== 'string') continue
    const e = parseExpression(text)
    const literal = e.kind === NODE.LITERAL || (e.kind === NODE.UNARY && (e.op === '-' || e.op === '+') && e.operand.kind === NODE.LITERAL)
    if (!literal || (e.kind === NODE.LITERAL && e.type === 'null')) continue
    const ctx: StoreContext = { strict: true, row: 1, warnings: 0 }
    try {
      encodeField((defaultOf(run, column) as Compiled).eval([], run.env), { ...column, nullable: true }, ctx)
    } catch (err) {
      if (err instanceof MyjsError) throw sqlError('ER_INVALID_DEFAULT', `Invalid default value for '${column.name}'`)
      throw err
    }
    notes += ctx.warnings
  }
  return notes
}

/**
 * A column's default, compiled; `'none'` for a NOT NULL column without one.
 * One that names a column of the row needs the row's `def` and is evaluated
 * over the row.
 */
export function defaultOf(run: Run, column: ColumnDef, def?: TableDef): Compiled | 'none' {
  // An AUTO_INCREMENT column's DEFAULT is 0: `UPDATE t SET id = DEFAULT` stores 0 (8.4.11).
  if (column.autoIncrement === true) return { eval: () => intValue(0n), type: NULL_TYPE }
  const text = column.attributes?.['default']
  if (typeof text === 'string') {
    const scope = def !== undefined && rowDependent(column) ? new TableScope([{ alias: def.name, def }]) : EMPTY_SCOPE
    return compile(parseExpression(text), compileContext(run, scope, 'field list'))
  }
  // `ALTER COLUMN … DROP DEFAULT` leaves none, not even NULL (8.4.11: 1364).
  if (column.attributes?.['noDefault'] === true) return 'none'
  if (column.nullable) return { eval: () => null, type: NULL_TYPE }
  // A NOT NULL ENUM has a default all the same, its first member: leaving it
  // out is neither 1364 nor a warning (8.4.11).
  if (column.type.type === FIELD_TYPE.ENUM) {
    const first = implicitDefault(column)
    return { eval: () => first, type: NULL_TYPE }
  }
  return 'none'
}

/**
 * ER_DUP_ENTRY as MySQL words it: the duplicate key's values joined by `-`,
 * and the key named `table.index`. The engine knows the index but not the SQL
 * rendering of a value, so the message is finished here.
 */
function duplicateEntry(def: TableDef, index: IndexDef, values: readonly Value[]): unknown {
  const text = index.parts
    .map((p) => {
      const v = values[def.columns.findIndex((c) => c.name === p.column)] ?? null
      const s = v === null ? 'NULL' : toText(v)
      return p.prefix === undefined ? s : [...s].slice(0, p.prefix).join('')
    })
    .join('-')
  return sqlError('ER_DUP_ENTRY', messages.duplicateEntry(text, `${def.name}.${index.name}`))
}

const isDuplicate = (e: unknown): boolean => e instanceof EngineError && e.code === 'ER_DUP_ENTRY'

/**
 * A table's UNIQUE indexes in MySQL's `sort_keys` order, which is the order
 * InnoDB checks them in: NOT NULL keys before nullable ones, PRIMARY first
 * among them, keys without a prefix part before keys with one, then the order
 * declared. So the key a duplicate names, the row an upsert updates, and
 * whether REPLACE may update rather than delete are all decided by it.
 */
function uniqueKeys(def: TableDef): IndexDef[] {
  const nullable = new Map(def.columns.map((c) => [c.name.toLowerCase(), c.nullable]))
  const rank = (i: IndexDef): number[] => [
    i.parts.some((p) => nullable.get(p.column.toLowerCase()) === true) ? 1 : 0,
    i.kind === 'primary' ? 0 : 1,
    i.parts.some((p) => p.prefix !== undefined) ? 1 : 0,
  ]
  return def.indexes
    .map((index, at) => ({ index, at, r: rank(index) }))
    .filter((x) => x.index.kind !== 'index')
    .sort((a, b) => (a.r[0] as number) - (b.r[0] as number) || (a.r[1] as number) - (b.r[1] as number) || (a.r[2] as number) - (b.r[2] as number) || a.at - b.at)
    .map((x) => x.index)
}

/** The first key, in `uniqueKeys` order, on which `fields` collide with a row other than `except`. */
function conflictOf(table: Table, keys: readonly IndexDef[], fields: readonly FieldBytes[], trx: Trx, except?: RowId): { index: IndexDef; id: RowId } | undefined {
  for (const index of keys) {
    const id = table.duplicateOf(index.name, fields, trx)
    if (id !== undefined && (except === undefined || !sameBytes(id, except))) return { index, id }
  }
  return undefined
}

/**
 * The error a 1062 from the engine becomes: named by the first key that
 * collides, as InnoDB finds it — `hit`, when the caller has looked already.
 */
function duplicateError(e: unknown, def: TableDef, table: Table, keys: readonly IndexDef[], fields: readonly FieldBytes[], trx: Trx, except?: RowId, hit = conflictOf(table, keys, fields, trx, except)): unknown {
  if (!isDuplicate(e)) return e
  const named = hit?.index ?? def.indexes.find((i) => i.name === /'([^']*)'/.exec((e as Error).message)?.[1])
  if (named === undefined) return e
  // Named by the values as stored: `VALUES (1.6)` colliding with id 2 is
  // "Duplicate entry '2'", not '1.6'.
  return duplicateEntry(def, named, def.columns.map((c, i) => decodeField(fields[i] ?? null, c.type)))
}

/** How a NULL meets a NOT NULL column: refused (1048), or stored as the type's zero with a warning. */
type NullPolicy = 'error' | 'warn'

/**
 * A value into its column, as `encodeField` stores it, with `nulls` deciding
 * what a NULL into NOT NULL does. An INSERT warns once per column, however
 * many rows it gives a NULL (8.4.11: three rows, two of them NULL in `a` and
 * one in `b`, is two warnings); an UPDATE warns per row, and passes no `warned`.
 */
function storeField(v: Value, column: ColumnDef, store: StoreContext, nulls: NullPolicy, warned?: Set<ColumnDef>): FieldBytes {
  try {
    return encodeField(v, column, store)
  } catch (e) {
    if (nulls === 'error' || !(e instanceof MyjsError) || e.code !== 'ER_BAD_NULL_ERROR') throw e
    if (warned === undefined || !warned.has(column)) store.warnings++
    warned?.add(column)
    return encodeField(implicitDefault(column), column, store)
  }
}

/**
 * The AUTO_INCREMENT values one statement hands out: the server's handler
 * and InnoDB's counter, together, because what a client sees comes from
 * both. Read off `handler::update_auto_increment` and InnoDB's
 * `get_auto_increment` and `write_row` (innodb_autoinc_lock_mode = 2, 8.4's
 * default), and checked against 8.4.11, which agrees on every case:
 *
 *   - The first row that needs a value reserves one per row the statement
 *     has (`INSERT … VALUES (…), (…), (…)` reserves three), and what is left
 *     of the block when the statement ends is lost. So a three-row INSERT
 *     that fails on its second row costs three ids, not one.
 *   - InnoDB counts rows down as each is written, and a later reservation —
 *     when an explicit value has carried the handler past the block — is for
 *     the rows still to come, from the handler's value.
 *   - An explicit value past the handler's next value moves it.
 *   - A row that loses to a duplicate under IGNORE, or is upserted instead,
 *     gives its value back to the next row (`restore_auto_increment`).
 */
class AutoIncrement {
  readonly #table: Table
  readonly #rows: number
  /** The handler's `next_insert_id`: the value the next row that needs one takes. */
  next = 0n
  /** The value the current row was given, 0 for an explicit one (`insert_id_for_cur_row`). */
  current = 0n
  #lo = 0n
  #hi = 0n
  #intervals = 0
  /** InnoDB's `n_autoinc_rows`: the rows the statement has still to write. */
  #remaining = 0

  constructor(table: Table, rows: number) {
    this.#table = table
    this.#rows = rows
  }

  /**
   * A value for a row that did not give one. A new block is taken from the
   * table's counter: under one writer the handler's value is never past it,
   * so InnoDB's "continue from the handler's value" lands on the counter too.
   * The one case it would not — an upsert that raised the counter with an
   * explicit value, then a later row that has run past its block — is not
   * modelled: InnoDB would continue below the counter, and this does not.
   *
   * A value past the column's range is its largest, silently, and the
   * handler carries on from there: the next row collides, as 1062 and not
   * 1264 (8.4.11).
   */
  generate(max: bigint): bigint {
    let nr = this.next
    if (nr >= this.#hi) {
      if (this.#remaining === 0) this.#remaining = Math.max(this.#intervals === 0 && this.#rows > 0 ? this.#rows : Math.min(1 << this.#intervals, 65535), 1)
      nr = this.#table.nextAutoIncrement(this.#remaining)
      this.#lo = nr
      this.#hi = nr + BigInt(this.#remaining)
      this.#intervals++
    }
    if (nr > max) nr = max
    this.current = nr
    this.next = nr + 1n
    return nr
  }

  /** A row that gave its own value. */
  explicit(v: bigint): void {
    this.current = 0n
    if (this.next > 0n && v >= this.next) this.next = v + 1n
  }

  /** InnoDB's count of a write attempted, whether it succeeded or not. */
  written(): void {
    if (this.#remaining > 0) this.#remaining--
  }

  /** `restore_auto_increment`: the next row takes `prev`, or this row's value back. */
  restore(prev: bigint): void {
    this.next = prev > 0n ? prev : this.current
  }

  /** Whether `v` is in the block the statement holds, and so promised to one of its rows. */
  reserved(v: bigint): boolean {
    return v >= this.#lo && v < this.#hi
  }
}

/** An `ON DUPLICATE KEY UPDATE`, compiled against the old row, the row alias and the row the INSERT tried. */
interface Upsert {
  readonly assignments: readonly Assigned[]
  readonly onUpdate: readonly (Compiled | undefined)[]
  /** `VALUES(c)` calls, each a 1287 deprecation warning. */
  readonly deprecated: number
  /** The INSERT's target columns, which a row alias exposes, in order; none without an alias. */
  readonly aliased: readonly number[]
}

/**
 * `INSERT … SELECT … ON DUPLICATE KEY UPDATE` may read the SELECT's own
 * columns, of the row that made the one in the way — when the SELECT is one
 * query block that neither groups nor aggregates (8.4.11: a GROUP BY or a
 * UNION leaves only the target's, and the rest is 1054). Each reference the
 * SELECT resolves rides along as a hidden item at the end of its list.
 */
function selectReferences(run: Run, node: InsertNode): ColumnNode[] {
  const q = node.query
  if (q === undefined || node.onDuplicate === undefined) return []
  const body = q.body
  if (body.kind !== QUERY.SELECT || body.from === undefined || body.groupBy !== undefined || body.having !== undefined || body.distinct === true) return []
  if (body.items.some((i) => containsAggregate(i.expr))) return []
  const refs = new Map<string, ColumnNode>()
  const walk = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(walk)
    const n = x as Expression
    if (n.kind === NODE.SUBQUERY || (n.kind === NODE.CALL && n.name.toUpperCase() === 'VALUES')) return
    if (n.kind === NODE.COLUMN) {
      refs.set(n.parts.join('.').toLowerCase(), n)
      return
    }
    for (const v of Object.values(x)) walk(v)
  }
  for (const a of node.onDuplicate) walk(a.value)
  return [...refs.values()].filter((ref) => {
    try {
      planQuery(run, { kind: QUERY.QUERY, ...(q.with === undefined ? {} : { with: q.with }), body: { ...body, items: [{ expr: ref }] }, at: q.at })
      return true
    } catch (e) {
      if (e instanceof MyjsError && e.errno === 1054) return false
      throw e
    }
  })
}

/**
 * The scope an upsert's expressions see (8.4.11, each probed): the table's
 * columns, then — with `AS n` or `AS n(a, b)` — the alias's, which are the
 * INSERT's own target columns and no others (`n.id` is 1054 when `id` was not
 * inserted). A bare name searches both, so `age` under `AS n` is 1052. Then,
 * out of sight, the whole row the INSERT tried, which `VALUES(c)` reads.
 */
function compileUpsert(run: Run, def: TableDef, node: InsertNode, targets: readonly number[], selectRefs: readonly { readonly ref: ColumnNode; readonly type: ResultType }[] = []): Upsert {
  const n = def.columns.length
  const alias = node.rowAlias
  const scoped: { alias: string; def: TableDef }[] = [{ alias: def.name, def }]
  if (alias !== undefined) {
    if (alias.columns !== undefined && alias.columns.length !== targets.length) {
      throw sqlError('ER_VIEW_WRONG_LIST', 'In definition of view, derived table or common table expression, SELECT list and column names list have different column counts')
    }
    // `AS n(a, A)` is 1060: the alias's names are column names (8.4.11).
    const named = new Set<string>()
    for (const c of alias.columns ?? []) {
      if (named.has(c.toLowerCase())) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${c}'`)
      named.add(c.toLowerCase())
    }
    const columns = targets.map((t, i) => ({ ...(def.columns[t] as ColumnDef), name: alias.columns?.[i] ?? (def.columns[t] as ColumnDef).name }))
    scoped.push({ alias: alias.name, def: { ...def, name: alias.name, columns } })
  }
  const scope = new TableScope(scoped)
  const own = new TableScope([{ alias: def.name, def }])
  const tried = n + (alias === undefined ? 0 : targets.length)
  const insertValues = {
    resolve: (name: string) => {
      const i = def.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
      if (i < 0) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(name, 'field list'))
      return { index: tried + i, type: own.resolve([name], 'field list').type }
    },
    calls: 0,
  }
  // The SELECT's columns sit after the row the INSERT tried. A bare name both
  // sides hold is 1052 (8.4.11: `n = n + 1` when the SELECT reads an `n`).
  const keyOf = (parts: readonly string[]): string => parts.join('.').toLowerCase()
  const fromSelect = new Map(selectRefs.map((r, i) => [keyOf(r.ref.parts), { index: tried + n + i, type: r.type }]))
  const resolver: Scope = {
    resolve: (parts, clause) => {
      const selected = fromSelect.get(keyOf(parts))
      if (selected === undefined) return scope.resolve(parts, clause)
      let target: ReturnType<Scope['resolve']>
      try {
        target = scope.resolve(parts, clause)
      } catch (e) {
        if (e instanceof MyjsError && e.errno === 1054) return selected
        throw e
      }
      if (parts.length === 1) throw sqlError('ER_NON_UNIQ_ERROR', messages.ambiguousColumn(parts.join('.'), clause))
      return target
    },
  }
  const ctx = { ...compileContext(run, resolver, 'field list'), insertValues }
  const assignments = (node.onDuplicate ?? []).map((a) => ({
    // The target is the table's column, whatever the alias says.
    index: own.resolve(a.column.parts, 'field list').index,
    value: isDefaultKeyword(a.value) ? undefined : compile(a.value, ctx),
  }))
  return { assignments, onUpdate: onUpdateOf(run, def), deprecated: insertValues.calls, aliased: alias === undefined ? [] : targets }
}

function encodeRow(def: TableDef, values: readonly Value[], ctx: StoreContext): FieldBytes[] {
  return def.columns.map((c, i) => encodeField(values[i] ?? null, c, ctx))
}

const okInfo = (records: number, duplicates: number, warnings: number): string => `Records: ${records}  Duplicates: ${duplicates}  Warnings: ${warnings}`

/**
 * INSERT, INSERT IGNORE, `ON DUPLICATE KEY UPDATE` and REPLACE: MySQL's
 * `write_record`, a row at a time, with its four counters. What 8.4.11 tells
 * a client, all read off it through `mysql2`:
 *
 *   - `affectedRows` is rows inserted, plus rows REPLACE deleted, plus rows an
 *     upsert updated — or, under `CLIENT_FOUND_ROWS`, every row an upsert met,
 *     changed or not. So an upsert that changes a row is 2, one that finds
 *     it already as asked is 1 (0 without FOUND_ROWS), and an insert 1.
 *   - REPLACE deletes the row in its way and tries again, unless the key it
 *     collided on is the table's last UNIQUE key, when it updates that row in
 *     place — and an update that changes nothing is not a deletion, so
 *     replacing a row with itself is 1, not 2.
 *   - `insertId` is the first value the statement generated for a row it
 *     wrote; failing that, `LAST_INSERT_ID(x)`'s x if the statement called it;
 *     failing that, the AUTO_INCREMENT value of the last row it handled, if it
 *     wrote any — so an upsert that updated row 7 reports 7.
 *   - IGNORE turns 1062 and the conversion errors into warnings and skips or
 *     adjusts the row, and its `Duplicates` is rows not written.
 */
export function insert(run: Run, node: InsertNode, trx: Trx): OkResult {
  // A subquery, or the SELECT of `INSERT … SELECT`, reads in the statement's transaction.
  run = { ...run, env: { ...run.env, trx } }
  if (node.partitions !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Partitions'))

  const opened = openTarget(run, node.table)
  const def = opened.def
  // Every write keeps the foreign keys on both sides of the table (M5.25).
  const table = guarded(run, opened.table, trx)
  const referenced = node.replace === true && isReferenced(run, def)
  const check = checker(run, def)
  // A VALUES or SET subquery reading the table being written is 1093, as an
  // UPDATE's is; INSERT … SELECT from it is legal, read in full first (8.4.11).
  if (node.query === undefined) checkTargetNotRead({ schema: def.schema, name: def.name }, [...(node.values ?? []).flat(), ...(node.set ?? []).map((a) => a.value), ...(node.onDuplicate ?? []).map((a) => a.value)], run.env.session.database)
  const columnIndex = (name: string): number => {
    const i = def.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
    if (i < 0) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(name, 'field list'))
    return i
  }

  // Which column each written value goes to, and the rows of expressions.
  let targets: number[]
  let rows: (readonly (Expression | undefined)[])[]
  // `INSERT … SELECT` (M5.20): the query's rows, read in full before the first
  // is written — as MySQL does through a temporary table when the query reads
  // the table it inserts into — and in the order the query returns them,
  // which is the order they take AUTO_INCREMENT values in.
  let selected: (readonly Value[])[] | undefined
  // The columns the SELECT gives a table column: copied field to field, where
  // a string too long is "Data truncated" (1265), not "Data too long" (1406) —
  // through a join, a merged CTE, a grouping or a set operation alike (8.4.11).
  const fieldCopies = new Set<number>()
  let selectRefs: { readonly ref: ColumnNode; readonly type: ResultType }[] = []
  if (node.query !== undefined) {
    targets = node.columns === undefined ? def.columns.map((_, i) => i) : node.columns.map((c) => columnIndex(c.parts[c.parts.length - 1] as string))
    const refs = selectReferences(run, node)
    const query = node.query
    const augmented = refs.length === 0 || query.body.kind !== QUERY.SELECT ? query : { ...query, body: { ...query.body, items: [...query.body.items, ...refs.map((ref) => ({ expr: ref }))] } }
    const plan = planQuery(run, augmented)
    if (plan.columns.length !== targets.length + refs.length) throw sqlError('ER_WRONG_VALUE_COUNT_ON_ROW', messages.wrongValueCount(1))
    selectRefs = refs.map((ref, i) => ({ ref, type: (plan.columns[targets.length + i] as { type: ResultType }).type }))
    plan.columns.slice(0, targets.length).forEach((c, i) => {
      if (c.type.column !== undefined || c.type.fromField === true) fieldCopies.add(targets[i] as number)
    })
    selected = [...plan.rows(trx, run.env)]
    rows = []
  } else if (node.set !== undefined) {
    targets = node.set.map((a) => columnIndex(a.column.parts[a.column.parts.length - 1] as string))
    rows = [node.set.map((a) => a.value)]
  } else {
    targets = node.columns === undefined ? def.columns.map((_, i) => i) : node.columns.map((c) => columnIndex(c.parts[c.parts.length - 1] as string))
    rows = (node.values ?? []).map((r, n) => {
      // `VALUES ()` is a row of defaults, with or without a column list.
      if (r.length === 0 && (node.columns === undefined || node.columns.length === 0)) return []
      if (r.length !== targets.length) throw sqlError('ER_WRONG_VALUE_COUNT_ON_ROW', messages.wrongValueCount(n + 1))
      return r
    })
  }
  const seen = new Set<number>()
  for (const t of targets) {
    if (seen.has(t)) throw sqlError('ER_FIELD_SPECIFIED_TWICE', `Column '${(def.columns[t] as ColumnDef).name}' specified twice`)
    seen.add(t)
  }

  const ignore = node.ignore === true
  const mode = node.replace === true ? 'replace' : node.onDuplicate !== undefined ? 'upsert' : 'insert'
  const strictMode = isStrict(run.env.session.sqlMode)
  const store: StoreContext = { strict: strictMode && !ignore, row: 1, warnings: 0, table: def.name }
  // A NULL for a NOT NULL column is refused by a strict mode and by a
  // one-row INSERT, and stored as the type's zero by IGNORE or a multi-row
  // INSERT; an upsert's own assignment is refused unless IGNORE (8.4.11).
  const nulls: NullPolicy = ignore || (!strictMode && (rows.length > 1 || selected !== undefined)) ? 'warn' : 'error'
  const warnedNull = new Set<ColumnDef>()
  const upsertNulls: NullPolicy = ignore ? 'warn' : 'error'

  // A VALUES or SET expression reads the row being written: each column as
  // it stands when the expression is reached, in the list's order (8.4.11:
  // `VALUES ('x', UPPER(a))` stores 'X'; Drizzle's `$onUpdateFn` writes that).
  const ctx = compileContext(run, new TableScope([{ alias: def.name, def }]), 'field list')
  const compiledRows: (readonly (Compiled | undefined)[])[] =
    selected !== undefined ? selected.map((r) => r.slice(0, targets.length).map((v) => ({ eval: () => v, type: NULL_TYPE }))) : rows.map((r) => r.map((e) => (e === undefined || isDefaultKeyword(e) ? undefined : compile(e, ctx))))
  const upsert = mode === 'upsert' ? compileUpsert(run, def, node, targets, selectRefs) : undefined
  // The SELECT's hidden columns of the row being written, for the upsert.
  let selectExtras: readonly Value[] = []
  const defaults = def.columns.map((c) => defaultOf(run, c, def))
  const dependent = def.columns.flatMap((c, i) => (rowDependent(c) ? [i] : []))
  const keys = uniqueKeys(def)
  const autoAt = def.columns.findIndex((c) => c.autoIncrement === true)
  // The key the AUTO_INCREMENT column leads (`next_number_index`).
  const autoKey = autoAt < 0 ? undefined : keys.find((i) => i.parts[0]?.column.toLowerCase() === (def.columns[autoAt] as ColumnDef).name.toLowerCase())
  // InnoDB reserves a VALUES statement's rows at once, but cannot count a
  // SELECT's: it reserves 1, then 2, then 4 (`ha_start_bulk_insert(0)`), so an
  // INSERT … SELECT of two rows leaves a gap.
  const auto = new AutoIncrement(table, selected !== undefined ? 0 : compiledRows.length)
  const stats = { records: 0, copied: 0, deleted: 0, updated: 0, touched: 0 }
  // `first_successful_insert_id_in_cur_stmt`, and the last row's AUTO_INCREMENT value.
  let firstId = 0n
  let lastAuto = 0n
  run.state.insertIdSet = false

  compiledRows.forEach((row, n) => {
    store.row = n + 1
    stats.records++
    if (selected !== undefined) selectExtras = (selected[n] as readonly Value[]).slice(targets.length)
    // The row starts as its defaults — a column with none holds its type's
    // zero, an AUTO_INCREMENT one 0 — and each value written replaces one.
    const values: Value[] = def.columns.map((column, i) => {
      const d = defaults[i] as Compiled | 'none'
      return d === 'none' ? implicitDefault(column) : dependent.includes(i) ? null : d.eval([], run.env)
    })
    const given = new Set<number>()
    row.forEach((c, i) => {
      const target = targets[i] as number
      if (c === undefined) {
        // DEFAULT: the column's own, as the row began.
        given.delete(target)
        return
      }
      values[target] = c.eval(values, run.env)
      given.add(target)
    })
    for (const i of dependent) if (!given.has(i)) values[i] = (defaults[i] as Compiled).eval(values, run.env)
    def.columns.forEach((column, i) => {
      if (given.has(i)) return
      if (column.autoIncrement === true) values[i] = null
      else if (defaults[i] === 'none') {
        if (store.strict) throw sqlError('ER_NO_DEFAULT_FOR_FIELD', messages.noDefaultForField(column.name))
        store.warnings++
      }
    })
    // Every value is converted, in column order, before AUTO_INCREMENT takes
    // one, as `write_row` takes it after `fill_record`: a row refused for an
    // out-of-range value costs no id of its own, and an explicit id that will
    // not convert is the error reported, not a later column's (8.4.11).
    const fields = def.columns.map((c, i) => {
      if (i === autoAt && values[i] === null) return null
      try {
        return storeField(values[i] ?? null, c, store, nulls, warnedNull)
      } catch (e) {
        if (fieldCopies.has(i) && e instanceof MyjsError && e.errno === 1406) throw sqlError('WARN_DATA_TRUNCATED', `Data truncated for column '${c.name}' at row ${store.row}`)
        throw e
      }
    })
    // CHECK constraints, before the row is written: a violation is not a
    // duplicate first and costs no AUTO_INCREMENT value. IGNORE skips the
    // row, and it is not one of the "Records" (8.4.11).
    const violated = check?.(fields)
    if (violated !== undefined) {
      if (!ignore) throw checkViolated(violated)
      store.warnings++
      stats.records--
      return
    }
    // `prev_insert_id`: where the handler stood before this row.
    const prev = auto.next
    let generated = 0n
    if (autoAt >= 0) {
      const column = def.columns[autoAt] as ColumnDef
      // Whether to generate is decided on the value as stored: NULL, and
      // anything that stores as 0 — `'0'`, `0.4`, and `'abc'` under IGNORE —
      // takes the next value (8.4.11, without NO_AUTO_VALUE_ON_ZERO).
      const stored = autoOf(def, autoAt, fields)
      if (stored === 0n) {
        generated = auto.generate(integerMax(column))
        fields[autoAt] = encodeField(intValue(generated, column.type.unsigned === true), column, store)
      } else auto.explicit(stored)
      lastAuto = autoOf(def, autoAt, fields)
    }
    writeRecord(fields, generated, prev)
  })

  /** One row through `write_record`: write it, or settle its duplicate as the statement asks. */
  function writeRecord(fields: FieldBytes[], generated: bigint, prevNext: bigint): void {
    let prev = prevNext
    for (;;) {
      try {
        table.insert(fields, trx)
      } catch (e) {
        // IGNORE skips a row whose parent is missing, as it skips a duplicate:
        // a warning, and its value is given back (8.4.11).
        if (ignore && e instanceof MyjsError && e.errno === 1452) {
          auto.written()
          store.warnings++
          auto.restore(prev)
          return
        }
        if (!isDuplicate(e)) throw e
        auto.written()
        const hit = conflictOf(table, keys, fields, trx)
        if (hit === undefined) throw e
        if (mode === 'insert') {
          if (!ignore) throw duplicateError(e, def, table, keys, fields, trx, undefined, hit)
          store.warnings++
          auto.restore(prev)
          return
        }
        if (mode === 'replace') {
          // A generated value that collides on the AUTO_INCREMENT column's own
          // key is not allowed to replace the row that has it
          // (`write_record`): the column's range is used up, and it is 1062.
          if (generated > 0n && hit.index === autoKey) throw duplicateError(e, def, table, keys, fields, trx, undefined, hit)
          // The table's last UNIQUE key: no later key can collide, so the row
          // in the way is updated into this one rather than deleted — unless a
          // foreign key references the table, whose actions a delete must
          // fire (`write_record`, 8.4.11).
          if (hit.index === keys[keys.length - 1] && !referenced) {
            const old = table.get(hit.id, trx, 'current') as FieldBytes[]
            if (!sameRow(old, fields)) {
              table.update(hit.id, fields, trx)
              stats.deleted++
            }
            break
          }
          table.delete(hit.id, trx)
          stats.deleted++
          continue
        }
        if (generated > 0n) prev = generated
        upsertRow(hit.id, fields, generated, prev)
        return
      }
      auto.written()
      break
    }
    stats.copied++
    if (generated > 0n && firstId === 0n) firstId = generated
  }

  /** `ON DUPLICATE KEY UPDATE` on the row in the way, as an UPDATE of it would change it. */
  function upsertRow(id: RowId, tried: FieldBytes[], generated: bigint, prev: bigint): void {
    const u = upsert as Upsert
    const before = table.get(id, trx, 'current') as FieldBytes[]
    const current = def.columns.map((c, i) => decodeField(before[i] ?? null, c.type))
    const triedValues = def.columns.map((c, i) => decodeField(tried[i] ?? null, c.type))
    const extra = [...u.aliased.map((t) => triedValues[t] ?? null), ...triedValues, ...selectExtras]
    const result = assignAll(run, def, before, current, extra, u.assignments, u.onUpdate, defaults, store, upsertNulls)
    // An upsert that sets the AUTO_INCREMENT column to a value the statement
    // has promised another row is ER_AUTO_INCREMENT_CONFLICT; to this row's
    // own generated value, it keeps it.
    let consumed = false
    if (generated > 0n && autoAt >= 0 && u.assignments.some((a) => a.index === autoAt)) {
      const v = autoOf(def, autoAt, result.after)
      if (v === generated) consumed = true
      else if (v !== 0n && auto.reserved(v)) throw sqlError('ER_AUTO_INCREMENT_CONFLICT', 'Auto-increment value in UPDATE conflicts with internally generated values')
    }
    if (!consumed) auto.restore(prev)
    stats.touched++
    if (autoAt >= 0) lastAuto = autoOf(def, autoAt, result.after)
    if (!result.changed) return
    const violated = check?.(result.after)
    if (violated !== undefined) {
      if (!ignore) throw checkViolated(violated)
      store.warnings++
      return
    }
    try {
      table.update(id, result.after, trx)
    } catch (e) {
      if (!isDuplicate(e) || !ignore) throw duplicateError(e, def, table, keys, result.after, trx, id)
      store.warnings++
      return
    }
    stats.updated++
    stats.copied++
  }

  // A value generated and written becomes `LAST_INSERT_ID()`; an upsert's
  // update does not, as an UPDATE does not.
  if (firstId !== 0n) run.state.lastInsertId = firstId
  // The SELECT form falls back to no id at all once a row was upserted, even
  // beside rows it inserted with ids of their own (8.4.11).
  const lastHandled = autoAt >= 0 && stats.copied > 0 && !(selected !== undefined && stats.touched > 0) ? lastAuto : 0n
  const insertId = firstId !== 0n ? firstId : run.state.insertIdSet ? run.state.lastInsertId : lastHandled
  const updated = hasCap(run.env.session.capabilities, CLIENT.FOUND_ROWS) ? stats.touched : stats.updated
  const warnings = store.warnings + (upsert?.deprecated ?? 0)
  // The SELECT form names only the rows an upsert changed, whatever the
  // client's FOUND_ROWS: 8.4.11 reports 6 rows affected and "Duplicates: 1"
  // for three inserts, one row updated and one row left as it was.
  const duplicates = ignore ? stats.records - stats.copied : stats.deleted + (selected !== undefined ? stats.updated : updated)
  return {
    affectedRows: stats.copied + stats.deleted + updated,
    insertId,
    warnings,
    ...(compiledRows.length !== 1 || selected !== undefined ? { info: okInfo(stats.records, duplicates, warnings) } : {}),
  }
}

/** An integer column's largest value; a non-integer AUTO_INCREMENT column has no bound here. */
function integerMax(column: ColumnDef): bigint {
  return integerRange(column.type)?.max ?? 2n ** 64n
}

/** The AUTO_INCREMENT column's value in a row's fields, 0 for NULL. */
function autoOf(def: TableDef, at: number, fields: readonly FieldBytes[]): bigint {
  const v = decodeField(fields[at] ?? null, (def.columns[at] as ColumnDef).type)
  return v === null ? 0n : toInteger(v)
}

/** A SET or ON DUPLICATE KEY UPDATE assignment, compiled: the column's slot, and its value or `undefined` for DEFAULT. */
interface Assigned {
  readonly index: number
  readonly value: Compiled | undefined
}

/** `ON UPDATE CURRENT_TIMESTAMP` and its kin, compiled, per column. */
function onUpdateOf(run: Run, def: TableDef): (Compiled | undefined)[] {
  return def.columns.map((c) => {
    const text = c.attributes?.['onUpdate']
    return typeof text === 'string' ? compile(parseExpression(text), compileContext(run, EMPTY_SCOPE, 'field list')) : undefined
  })
}

/**
 * Apply assignments to one row, as UPDATE and an upsert both do (8.4.11).
 * Left to right, each seeing the ones before it *as stored*: `SET d = 1.234,
 * x = d` on a DECIMAL(5,1) d gives x = 1.2, and outside strict mode `SET tiny
 * = 1000, j = tiny` gives j = 127 (found by review). So each value is
 * converted into its column as it is assigned, and read back from there —
 * which also counts each adjusted value's warning once. `ON UPDATE` columns
 * fire only for a row that changed, and only where the statement did not
 * assign. `extra` is what an expression may read after the row: an upsert's
 * alias and tried row.
 */
function assignAll(
  run: Run,
  def: TableDef,
  before: readonly FieldBytes[],
  current: readonly Value[],
  extra: readonly Value[],
  assignments: readonly Assigned[],
  onUpdate: readonly (Compiled | undefined)[],
  defaults: readonly (Compiled | 'none')[],
  store: StoreContext,
  nulls: NullPolicy,
): { after: FieldBytes[]; values: Value[]; changed: boolean } {
  const after = [...before]
  const values: Value[] = [...current]
  const assign = (i: number, v: Value): void => {
    const column = def.columns[i] as ColumnDef
    const field = storeField(v, column, store, nulls)
    after[i] = field
    values[i] = decodeField(field, column.type)
  }
  const assigned = new Set<number>()
  for (const a of assignments) {
    assigned.add(a.index)
    if (a.value === undefined) {
      // `c = DEFAULT` on a column with none is 1364 under a strict mode and
      // the type's zero with a warning outside one, as a missing INSERT
      // value is (8.4.11).
      const d = defaults[a.index] as Compiled | 'none'
      const column = def.columns[a.index] as ColumnDef
      if (d === 'none') {
        if (store.strict) throw sqlError('ER_NO_DEFAULT_FOR_FIELD', messages.noDefaultForField(column.name))
        store.warnings++
      }
      assign(a.index, d === 'none' ? implicitDefault(column) : d.eval(values as Row, run.env))
    } else assign(a.index, a.value.eval(extra.length === 0 ? (values as Row) : [...values, ...extra], run.env))
  }
  if (sameRow(before, after)) return { after, values, changed: false }
  onUpdate.forEach((u, i) => {
    if (u !== undefined && !assigned.has(i)) assign(i, u.eval([], run.env))
  })
  return { after, values, changed: true }
}

const isDefaultKeyword = (e: Expression): boolean => e.kind === NODE.KEYWORD && e.word.toUpperCase() === 'DEFAULT'

/** What a NOT NULL column with no DEFAULT gets outside a strict mode: its type's zero. */
export function implicitDefault(column: ColumnDef): Value {
  const t = column.type.type
  if (t === FIELD_TYPE.TIMESTAMP || t === FIELD_TYPE.DATE || t === FIELD_TYPE.DATETIME) {
    return { kind: 'datetime', v: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }, type: t === FIELD_TYPE.DATE ? 'DATE' : 'DATETIME', fsp: 0 }
  }
  if (t === FIELD_TYPE.TIME) return { kind: 'time', v: { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }, fsp: 0 }
  // An ENUM's is its first member, JSON's the JSON null, a binary string's
  // no bytes (8.4.11).
  if (t === FIELD_TYPE.JSON) return { kind: 'json', v: { t: 'null' } }
  if (column.type.collationId === CHARSET_BINARY) return { kind: 'bytes', v: new Uint8Array(0) }
  if (column.type.collationId !== undefined) {
    const v = t === FIELD_TYPE.ENUM ? (column.type.members?.[0] ?? '') : ''
    return { kind: 'string', v, collationId: column.type.collationId, coercibility: 2 }
  }
  return intValue(0n)
}

/**
 * The table a write names. A view is refused by name: 8.4.11 writes through
 * an updatable one to its base table, which is not built yet.
 */
function openTarget(run: Run, name: TableName): ReturnType<typeof openTable> {
  try {
    return openTable(run, name)
  } catch (e) {
    const schema = name.schema ?? run.env.session.database
    if ((e as { errno?: number }).errno === 1146 && schema !== null && run.catalog?.view(schema, name.name) !== undefined) {
      throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('INSERT, UPDATE and DELETE through a view'))
    }
    throw e
  }
}

/** The single table an UPDATE or DELETE names; ER_NOT_SUPPORTED_YET for the multi-table forms. */
function singleTable(run: Run, tables: UpdateNode['tables'], what: string): { def: TableDef; table: Table; alias: string } {
  const ref = tables[0]
  if (tables.length !== 1 || ref === undefined || ref.kind !== REF.TABLE) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`Multiple-table ${what}`))
  const { def, table } = openTarget(run, ref.table)
  return { def, table, alias: ref.alias ?? ref.table.name }
}

/**
 * An UPDATE's or DELETE's WITH: its CTEs, for the statement's subqueries. Each
 * is read once, before the first row changes, so one that reads the table
 * being written is no 1093 (8.4.11 — Drizzle's `with … update` is that
 * shape). A CTE named as the target is 1288: it is not a table.
 */
function withCtes(run: Run, node: UpdateNode | DeleteNode, what: 'UPDATE' | 'DELETE'): Run {
  if (node.with === undefined) return run
  const ref = node.tables[0]
  if (ref?.kind === REF.TABLE && ref.table.schema === undefined && node.with.tables.some((c) => c.name.toLowerCase() === ref.table.name.toLowerCase())) {
    throw sqlError('ER_NON_UPDATABLE_TABLE', `The target table ${ref.alias ?? ref.table.name} of the ${what} is not updatable`)
  }
  return withClause(run, node.with)
}

/** The rows a WHERE / ORDER BY / LIMIT selects, read in full before any is written. */
function matching(run: Run, def: TableDef, table: Table, alias: string, node: UpdateNode | DeleteNode, trx: Trx): ScannedRow[] {
  const scope = new TableScope([{ alias, def }])
  const where = node.where === undefined ? undefined : compile(node.where, compileContext(run, scope, 'where clause'))
  const keys = (node.orderBy ?? []).map((o) => ({ expr: compile(o.expr, compileContext(run, scope, 'order clause')), desc: o.desc === true }))
  const count = node.limit === undefined ? undefined : limitValue(run, node.limit, 'LIMIT')
  const access = chooseAccess(def, alias, node.where, run.env)
  let rows: Iterable<ScannedRow> = filter(accessRows(table, def, access, trx, true), where, run.env)
  if (keys.length > 0) rows = sort(rows, keys, run.env)
  return [...limit(rows, 0, count)]
}

export function update(run: Run, node: UpdateNode, trx: Trx): OkResult {
  if (node.ignore === true) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('UPDATE IGNORE'))
  // A subquery reads in the statement's transaction.
  run = { ...run, env: { ...run.env, trx } }
  run = withCtes(run, node, 'UPDATE')
  const target = singleTable(run, node.tables, 'UPDATE')
  const { def, alias } = target
  const table = guarded(run, target.table, trx)
  checkTargetNotRead({ schema: def.schema, name: def.name }, [node.where, ...node.set.map((a) => a.value)], run.env.session.database)
  const scope = new TableScope([{ alias, def }])
  const assignments = node.set.map((a: Assignment) => {
    const { index } = scope.resolve(a.column.parts, 'field list')
    return { index, value: isDefaultKeyword(a.value) ? undefined : compile(a.value, compileContext(run, scope, 'field list')) }
  })
  const onUpdate = onUpdateOf(run, def)
  const defaults = def.columns.map((c) => defaultOf(run, c, def))
  const check = checker(run, def)
  const store: StoreContext = { strict: isStrict(run.env.session.sqlMode), row: 1, warnings: 0, table: def.name }
  const keys = uniqueKeys(def)
  run.state.insertIdSet = false

  const rows = matching(run, def, table, alias, node, trx)
  let changed = 0
  rows.forEach(({ id, row }, n) => {
    store.row = n + 1
    const before = encodeRow(def, row, { strict: false, row: n + 1, warnings: 0 })
    // A NULL into a NOT NULL column is the type's zero and a warning outside a strict mode (8.4.11).
    const result = assignAll(run, def, before, row, [], assignments, onUpdate, defaults, store, store.strict ? 'error' : 'warn')
    if (!result.changed) return
    const violated = check?.(result.after)
    if (violated !== undefined) throw checkViolated(violated)
    try {
      table.update(id, result.after, trx)
    } catch (e) {
      throw duplicateError(e, def, table, keys, result.after, trx, id)
    }
    changed++
  })

  const matched = rows.length
  const foundRows = hasCap(run.env.session.capabilities, CLIENT.FOUND_ROWS)
  return {
    affectedRows: foundRows ? matched : changed,
    // `UPDATE t SET id = LAST_INSERT_ID(id + 1)` reports the value it set.
    ...(run.state.insertIdSet ? { insertId: run.state.lastInsertId } : {}),
    warnings: store.warnings,
    info: `Rows matched: ${matched}  Changed: ${changed}  Warnings: ${store.warnings}`,
  }
}

function sameRow(a: readonly FieldBytes[], b: readonly FieldBytes[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? null
    const y = b[i] ?? null
    if (x === null || y === null) {
      if (x !== y) return false
      continue
    }
    if (!sameBytes(x, y)) return false
  }
  return true
}

function sameBytes(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false
  for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false
  return true
}

export function remove(run: Run, node: DeleteNode, trx: Trx): OkResult {
  if (node.targets !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Multiple-table DELETE'))
  run = { ...run, env: { ...run.env, trx } }
  run = withCtes(run, node, 'DELETE')
  const target = singleTable(run, node.tables, 'DELETE')
  const { def, alias } = target
  const table = guarded(run, target.table, trx)
  checkTargetNotRead({ schema: def.schema, name: def.name }, [node.where], run.env.session.database)
  const rows = matching(run, def, table, alias, node, trx)
  let deleted = 0
  let warnings = 0
  for (const { id } of rows) {
    // IGNORE keeps a row a child holds, with a warning, and undoes whatever
    // its cascades had done (8.4.11).
    const at = node.ignore === true ? trx.savepoint() : 0
    try {
      if (table.delete(id, trx)) deleted++
    } catch (e) {
      if (node.ignore !== true || !(e instanceof MyjsError) || e.errno !== 1451) throw e
      trx.rollbackTo(at)
      warnings++
    }
  }
  return warnings === 0 ? { affectedRows: deleted } : { affectedRows: deleted, warnings }
}
