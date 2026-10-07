// M5.8 / M5.17 — INSERT, UPDATE and DELETE on one table.
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
//   - `insertId` is the first AUTO_INCREMENT value the statement generated.
//
// UPDATE and DELETE read every row they will change before changing any
// (doc 30: a scan is not interleaved with writes to its own table), so a row
// an UPDATE moves within the clustered order is never met twice.
import { FIELD_TYPE } from '@myjs/bytes'
import { CLIENT, hasCap, messages, sqlError, type OkResult } from '@myjs/protocol'
import type { ColumnDef, Table, TableDef, Trx } from '@myjs/engine'
import { EngineError } from '@myjs/engine'
import { NODE, REF, parseExpression, type Assignment, type DeleteNode, type Expression, type InsertNode, type UpdateNode } from '@myjs/parser'
import { encodeField, intValue, toInteger, toText, type StoreContext, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type Compiled, type Row } from './compile.ts'
import { filter, limit, sort, type ScannedRow } from './operators.ts'
import { chooseAccess } from './plan.ts'
import { accessRows, compileContext, limitValue, openTable, type Run } from './query.ts'
import { TableScope } from './scope.ts'
import { NULL_TYPE } from './meta.ts'

const isStrict = (sqlMode: string): boolean => /\bSTRICT_(TRANS|ALL)_TABLES\b/.test(sqlMode)

/** A column's DEFAULT, compiled: its expression, or NULL, or "none" for a NOT NULL column without one. */
function defaultOf(run: Run, column: ColumnDef): Compiled | 'none' {
  const text = column.attributes?.['default']
  if (typeof text === 'string') return compile(parseExpression(text), compileContext(run, EMPTY_SCOPE, 'field list'))
  if (column.nullable) return { eval: () => null, type: NULL_TYPE }
  return 'none'
}

/**
 * ER_DUP_ENTRY as MySQL words it: the duplicate key's values joined by `-`,
 * and the key named `table.index`. The engine knows the index but not the SQL
 * rendering of a value, so the message is finished here.
 */
function duplicateEntry(e: unknown, def: TableDef, values: readonly Value[]): unknown {
  if (!(e instanceof EngineError) || e.code !== 'ER_DUP_ENTRY') return e
  const name = /'([^']*)'/.exec(e.message)?.[1]
  const index = def.indexes.find((i) => i.name === name)
  if (index === undefined) return e
  const text = index.parts
    .map((p) => {
      const v = values[def.columns.findIndex((c) => c.name === p.column)] ?? null
      const s = v === null ? 'NULL' : toText(v)
      return p.prefix === undefined ? s : [...s].slice(0, p.prefix).join('')
    })
    .join('-')
  return sqlError('ER_DUP_ENTRY', messages.duplicateEntry(text, `${def.name}.${index.name}`))
}

function encodeRow(def: TableDef, values: readonly Value[], ctx: StoreContext): (Uint8Array | null)[] {
  return def.columns.map((c, i) => encodeField(values[i] ?? null, c, ctx))
}

const okInfo = (records: number, duplicates: number, warnings: number): string => `Records: ${records}  Duplicates: ${duplicates}  Warnings: ${warnings}`

export function insert(run: Run, node: InsertNode, trx: Trx): OkResult {
  if (node.replace === true) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('REPLACE'))
  if (node.ignore === true) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('INSERT IGNORE'))
  if (node.onDuplicate !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('ON DUPLICATE KEY UPDATE'))
  if (node.query !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('INSERT … SELECT'))
  if (node.partitions !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Partitions'))

  const { def, table } = openTable(run, node.table)
  const columnIndex = (name: string): number => {
    const i = def.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
    if (i < 0) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(name, 'field list'))
    return i
  }

  // Which column each written value goes to, and the rows of expressions.
  let targets: number[]
  let rows: (readonly (Expression | undefined)[])[]
  if (node.set !== undefined) {
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

  const ctx = compileContext(run, EMPTY_SCOPE, 'field list')
  const compiledRows = rows.map((r) => r.map((e) => (e === undefined || isDefaultKeyword(e) ? undefined : compile(e, ctx))))
  const defaults = def.columns.map((c) => defaultOf(run, c))
  const strict = isStrict(run.env.session.sqlMode)
  const store: StoreContext = { strict, row: 1, warnings: 0 }
  // The first value the statement generated; failing that, the last one it was given.
  let generated = 0n
  let explicit = 0n

  compiledRows.forEach((row, n) => {
    store.row = n + 1
    const values: Value[] = def.columns.map(() => null)
    const given = new Set<number>()
    row.forEach((c, i) => {
      const target = targets[i] as number
      if (c === undefined) return
      values[target] = c.eval([], run.env)
      given.add(target)
    })
    def.columns.forEach((column, i) => {
      if (given.has(i) || column.autoIncrement === true) return
      const d = defaults[i] as Compiled | 'none'
      if (d === 'none') {
        if (strict) throw sqlError('ER_NO_DEFAULT_FOR_FIELD', messages.noDefaultForField(column.name))
        store.warnings++
        values[i] = implicitDefault(column)
      } else values[i] = d.eval([], run.env)
    })
    // Every value is converted before AUTO_INCREMENT takes one, as
    // `write_row` takes it after `fill_record`: a row refused for an
    // out-of-range value costs no id, and one refused as a duplicate does
    // (both read off 8.4.11).
    const auto = def.columns.findIndex((c) => c.autoIncrement === true)
    const fields = def.columns.map((c, i) => (i === auto ? null : encodeField(values[i] ?? null, c, store)))
    if (auto >= 0) {
      const column = def.columns[auto] as ColumnDef
      const v = values[auto] ?? null
      if (v === null || (v.kind !== 'string' && toInteger(v) === 0n)) {
        const next = table.nextAutoIncrement(1)
        values[auto] = intValue(next, column.type.unsigned === true)
        if (generated === 0n) generated = next
      } else explicit = toInteger(v)
      fields[auto] = encodeField(values[auto] ?? null, column, store)
    }
    try {
      table.insert(fields, trx)
    } catch (e) {
      throw duplicateEntry(e, def, values)
    }
  })

  // `LAST_INSERT_ID()` moves only for a generated value; the OK packet also
  // reports an explicit one.
  if (generated !== 0n) run.state.lastInsertId = generated
  const insertId = generated !== 0n ? generated : explicit
  const affected = compiledRows.length
  return {
    affectedRows: affected,
    insertId,
    warnings: store.warnings,
    ...(compiledRows.length > 1 ? { info: okInfo(affected, 0, store.warnings) } : {}),
  }
}

const isDefaultKeyword = (e: Expression): boolean => e.kind === NODE.KEYWORD && e.word.toUpperCase() === 'DEFAULT'

/** What a NOT NULL column with no DEFAULT gets outside a strict mode: its type's zero. */
function implicitDefault(column: ColumnDef): Value {
  const t = column.type.type
  if (t === FIELD_TYPE.TIMESTAMP || t === FIELD_TYPE.DATE || t === FIELD_TYPE.DATETIME) {
    return { kind: 'datetime', v: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }, type: t === FIELD_TYPE.DATE ? 'DATE' : 'DATETIME', fsp: 0 }
  }
  if (t === FIELD_TYPE.TIME) return { kind: 'time', v: { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }, fsp: 0 }
  if (column.type.collationId !== undefined) return { kind: 'string', v: '', collationId: column.type.collationId, coercibility: 2 }
  return intValue(0n)
}

/** The single table an UPDATE or DELETE names; ER_NOT_SUPPORTED_YET for the multi-table forms. */
function singleTable(run: Run, tables: UpdateNode['tables'], what: string): { def: TableDef; table: Table; alias: string } {
  const ref = tables[0]
  if (tables.length !== 1 || ref === undefined || ref.kind !== REF.TABLE) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`Multiple-table ${what}`))
  const { def, table } = openTable(run, ref.table)
  return { def, table, alias: ref.alias ?? ref.table.name }
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
  if (node.with !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('WITH'))
  if (node.ignore === true) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('UPDATE IGNORE'))
  const { def, table, alias } = singleTable(run, node.tables, 'UPDATE')
  const scope = new TableScope([{ alias, def }])
  const assignments = node.set.map((a: Assignment) => {
    const { index } = scope.resolve(a.column.parts, 'field list')
    return { index, value: isDefaultKeyword(a.value) ? undefined : compile(a.value, compileContext(run, scope, 'field list')) }
  })
  const onUpdate = def.columns.map((c) => {
    const text = c.attributes?.['onUpdate']
    return typeof text === 'string' ? compile(parseExpression(text), compileContext(run, EMPTY_SCOPE, 'field list')) : undefined
  })
  const defaults = def.columns.map((c) => defaultOf(run, c))
  const assigned = new Set(assignments.map((a) => a.index))
  const store: StoreContext = { strict: isStrict(run.env.session.sqlMode), row: 1, warnings: 0 }

  const rows = matching(run, def, table, alias, node, trx)
  let changed = 0
  rows.forEach(({ id, row }, n) => {
    store.row = n + 1
    // Assignments apply left to right, each seeing the ones before it, as a
    // single-table UPDATE does in MySQL: `SET a = a + 1, b = a` sets b to the new a.
    const values: Value[] = [...row]
    for (const a of assignments) {
      if (a.value === undefined) {
        const d = defaults[a.index] as Compiled | 'none'
        values[a.index] = d === 'none' ? implicitDefault(def.columns[a.index] as ColumnDef) : d.eval([], run.env)
      } else values[a.index] = a.value.eval(values as Row, run.env)
    }
    const before = encodeRow(def, row, { strict: false, row: n + 1, warnings: 0 })
    let after = encodeRow(def, values, store)
    if (sameRow(before, after)) return
    // `ON UPDATE CURRENT_TIMESTAMP` fires only for a row that changed, and
    // only on a column the statement did not set itself.
    if (onUpdate.some((u, i) => u !== undefined && !assigned.has(i))) {
      onUpdate.forEach((u, i) => {
        if (u !== undefined && !assigned.has(i)) values[i] = u.eval([], run.env)
      })
      after = encodeRow(def, values, store)
    }
    try {
      table.update(id, after, trx)
    } catch (e) {
      throw duplicateEntry(e, def, values)
    }
    changed++
  })

  const matched = rows.length
  const foundRows = hasCap(run.env.session.capabilities, CLIENT.FOUND_ROWS)
  return {
    affectedRows: foundRows ? matched : changed,
    warnings: store.warnings,
    info: `Rows matched: ${matched}  Changed: ${changed}  Warnings: ${store.warnings}`,
  }
}

function sameRow(a: readonly (Uint8Array | null)[], b: readonly (Uint8Array | null)[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? null
    const y = b[i] ?? null
    if (x === null || y === null) {
      if (x !== y) return false
      continue
    }
    if (x.length !== y.length) return false
    for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false
  }
  return true
}

export function remove(run: Run, node: DeleteNode, trx: Trx): OkResult {
  if (node.with !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('WITH'))
  if (node.targets !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Multiple-table DELETE'))
  const { def, table, alias } = singleTable(run, node.tables, 'DELETE')
  const rows = matching(run, def, table, alias, node, trx)
  let deleted = 0
  for (const { id } of rows) if (table.delete(id, trx)) deleted++
  return { affectedRows: deleted }
}
