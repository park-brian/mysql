// M5.25 — foreign keys: what one is, what makes one, and what it does to a write.
//
// A foreign key lives in its child table's definition (`options.foreignKeys`),
// named, with its parent's schema and both actions resolved, so nothing reads
// one back by guessing. Everything below was put to 8.4.11 first.
//
// Making one (CREATE TABLE, ALTER TABLE … ADD):
//
//   - An unnamed one is `<table>_ibfk_<n>`, n one past the table's highest, and
//     a name is unique in its schema, not its table (1826).
//   - The child needs an index whose leading columns are the key's, in order.
//     Without one, an index is added after the others, named by the
//     constraint, else by `FOREIGN KEY <name>`, else by its first column.
//   - The parent needs a PRIMARY or UNIQUE key on exactly the referenced
//     columns, in order (6125): a prefix of a wider key is not one in 8.4.
//   - Column types must be InnoDB's "equal" (`cmp_cols_are_equal`): strings by
//     collation, whatever their length or CHAR-ness; integers by width and
//     sign; and the types InnoDB stores as fixed binary — DECIMAL, the
//     temporal types, BINARY, VARBINARY — with each other, however unlike.
//   - A MEMORY child keeps the index and drops the key, silently; a MEMORY
//     parent cannot be opened as one (1824).
//   - With `foreign_key_checks = 0` a parent need not exist, nor the rows match.
//
// Enforcing one, through `guarded()`, which every INSERT, UPDATE, DELETE,
// REPLACE and upsert writes through:
//
//   - A child row whose key has a NULL in it is not checked (MATCH SIMPLE).
//     Otherwise its parent must exist, matched through the parent's key — so
//     by its collation — after the row is written, so that a duplicate is
//     still 1062 and a row may reference itself (1452).
//   - A parent row deleted, or its referenced columns changed, finds its
//     children through their index. RESTRICT and NO ACTION refuse (1451), as
//     SET DEFAULT does, because InnoDB does not implement it; CASCADE and SET
//     NULL change the children, through the same guard, to a depth of 15.
//   - A cascaded update into a table an update further up the chain is
//     changing is refused (1451): InnoDB "plays safe" rather than know.
//   - `foreign_key_checks = 0` turns all of it off, cascades included.
import { quoteName } from '@myjs/parser'
import { FIELD_TYPE, CHARSET_BINARY, expectTyped } from '@myjs/bytes'
import { sqlError } from '@myjs/protocol'
import type { ColumnDef, FieldBytes, IndexDef, KeyRange, ReadMode, Row, RowId, Table, TableDef, TableSpec, Trx } from '@myjs/engine'
import type { KeyDefinition } from '@myjs/parser'
import type { ColumnType } from '@myjs/types'
import { decodeField, encodeField, type StoreContext } from '@myjs/types'
import type { Run } from './query.ts'
import { isTemporary, type CatalogApi } from './temporary.ts'
import { generationOf } from './generated.ts'

export type ReferentialAction = 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT'

export interface ForeignKeyDef {
  readonly name: string
  readonly columns: readonly string[]
  readonly references: { readonly schema: string; readonly table: string; readonly columns: readonly string[] }
  readonly onDelete: ReferentialAction
  readonly onUpdate: ReferentialAction
}

const ACTIONS: ReadonlySet<string> = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'])
const action = (a: unknown): ReferentialAction => (typeof a === 'string' && ACTIONS.has(a.toUpperCase()) ? (a.toUpperCase() as ReferentialAction) : 'NO ACTION')

/**
 * A table's foreign keys. One stored before M5.25 — kept and not enforced,
 * with no schema, no actions and perhaps no name — reads as InnoDB would have
 * named and resolved it.
 */
export function foreignKeysOf(def: TableDef): ForeignKeyDef[] {
  const stored = def.options['foreignKeys']
  if (!Array.isArray(stored)) return []
  let auto = 0
  return stored.map((k: { name?: string; columns?: string[]; references?: { schema?: string; table?: string | { schema?: string; name: string }; columns?: string[] }; onDelete?: string; onUpdate?: string }) => {
    const r = k.references
    const table = typeof r?.table === 'string' ? { schema: r.schema, name: r.table } : r?.table
    return {
      name: k.name ?? `${def.name}_ibfk_${++auto}`,
      columns: k.columns ?? [],
      references: { schema: table?.schema ?? def.schema, table: table?.name ?? '', columns: r?.columns ?? [] },
      onDelete: action(k.onDelete ?? (r as { onDelete?: string } | undefined)?.onDelete),
      onUpdate: action(k.onUpdate ?? (r as { onUpdate?: string } | undefined)?.onUpdate),
    }
  })
}


/**
 * `FOREIGN KEY (…) REFERENCES … (…)` and its actions, as SHOW CREATE TABLE and
 * the 1451/1452 messages print it: the parent's schema only when it is not the
 * child's, NO ACTION never, and SET DEFAULT only where the server, not InnoDB,
 * prints it (`forError` is InnoDB's text).
 */
export function referenceText(fk: ForeignKeyDef, childSchema: string, forError: boolean): string {
  const parent = fk.references.schema === childSchema ? quoteName(fk.references.table) : `${quoteName(fk.references.schema)}.${quoteName(fk.references.table)}`
  let out = `FOREIGN KEY (${fk.columns.map(quoteName).join(', ')}) REFERENCES ${parent} (${fk.references.columns.map(quoteName).join(', ')})`
  const shown = (a: ReferentialAction) => a !== 'NO ACTION' && !(forError && a === 'SET DEFAULT')
  if (shown(fk.onDelete)) out += ` ON DELETE ${fk.onDelete}`
  if (shown(fk.onUpdate)) out += ` ON UPDATE ${fk.onUpdate}`
  return out
}

const constraintText = (fk: ForeignKeyDef, schema: string, table: string): string => `(${quoteName(schema)}.${quoteName(table)}, CONSTRAINT ${quoteName(fk.name)} ${referenceText(fk, schema, true)})`
const noParent = (fk: ForeignKeyDef, schema: string, table: string) => sqlError('ER_NO_REFERENCED_ROW_2', `Cannot add or update a child row: a foreign key constraint fails ${constraintText(fk, schema, table)}`)
const rowIsReferenced = (fk: ForeignKeyDef, schema: string, table: string) => sqlError('ER_ROW_IS_REFERENCED_2', `Cannot delete or update a parent row: a foreign key constraint fails ${constraintText(fk, schema, table)}`)
const tooDeep = () => sqlError('ER_FK_DEPTH_EXCEEDED', 'Foreign key cascade delete/update exceeds max depth of 15.')

/** `FK_MAX_CASCADE_DEL`. */
const MAX_DEPTH = 15

export const foreignKeyChecks = (run: Run): boolean => {
  const v = run.state.systemVariable('foreign_key_checks', undefined, run.env.session)
  return !(v !== null && v !== undefined && v.kind === 'int' && v.v === 0n)
}

// --- making one -------------------------------------------------------------------

const INT_BYTES: Readonly<Record<number, number>> = { [FIELD_TYPE.TINY]: 1, [FIELD_TYPE.SHORT]: 2, [FIELD_TYPE.INT24]: 3, [FIELD_TYPE.LONG]: 4, [FIELD_TYPE.LONGLONG]: 8, [FIELD_TYPE.YEAR]: 1 }
const STRINGS: ReadonlySet<number> = new Set([FIELD_TYPE.STRING, FIELD_TYPE.VAR_STRING, FIELD_TYPE.VARCHAR, FIELD_TYPE.TINY_BLOB, FIELD_TYPE.BLOB, FIELD_TYPE.MEDIUM_BLOB, FIELD_TYPE.LONG_BLOB])

/** A column as InnoDB stores it, which is what a foreign key compares (`get_innobase_type_from_mysql_type`). */
export function storageClass(t: ColumnType): string {
  const width = INT_BYTES[t.type]
  if (width !== undefined) return `int ${width} ${t.type === FIELD_TYPE.YEAR || t.unsigned === true ? 'unsigned' : 'signed'}`
  switch (t.type) {
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE:
      return 'int 3 signed'
    case FIELD_TYPE.ENUM:
      return `int ${(t.members?.length ?? 0) > 255 ? 2 : 1} signed`
    case FIELD_TYPE.SET: {
      const bytes = Math.ceil((t.members?.length ?? 0) / 8)
      return `int ${bytes > 4 ? 8 : Math.max(bytes, 1)} signed`
    }
    case FIELD_TYPE.FLOAT:
      return 'float'
    case FIELD_TYPE.DOUBLE:
      return 'double'
    default:
      if (STRINGS.has(t.type)) return t.collationId === undefined || t.collationId === CHARSET_BINARY ? 'binary' : `text ${t.collationId}`
      // DECIMAL, TIME, DATETIME, TIMESTAMP, BIT, JSON: fixed or binary bytes.
      return 'binary'
  }
}

/** The parsed `FOREIGN KEY` clauses of a CREATE TABLE or an ALTER TABLE's ADD. */
export interface ForeignKeyClause {
  readonly constraint?: string
  readonly index?: string
  readonly columns: readonly string[]
  readonly references: { readonly schema?: string; readonly table: string; readonly columns: readonly string[] }
  readonly onDelete?: string
  readonly onUpdate?: string
}

export function foreignKeyClause(k: KeyDefinition): ForeignKeyClause {
  const r = k.references
  return {
    ...(k.constraint === undefined ? {} : { constraint: k.constraint }),
    ...(k.name === undefined ? {} : { index: k.name }),
    columns: k.columns.map((c) => c.name ?? ''),
    references: { ...(r?.table.schema === undefined ? {} : { schema: r.table.schema }), table: r?.table.name ?? '', columns: (r?.columns ?? []).map((c) => c.name ?? '') },
    ...(r?.onDelete === undefined ? {} : { onDelete: r.onDelete }),
    ...(r?.onUpdate === undefined ? {} : { onUpdate: r.onUpdate }),
  }
}

/** The index that serves `columns` as a foreign key's: its leading parts are those columns, in order. */
export function supportingIndex(indexes: readonly IndexDef[], columns: readonly string[]): IndexDef | undefined {
  return indexes.find((i) => i.parts.length >= columns.length && columns.every((c, k) => i.parts[k]?.column.toLowerCase() === c.toLowerCase() && i.parts[k]?.prefix === undefined))
}

/** The parent's key a foreign key matches through: PRIMARY or UNIQUE, on exactly its columns. */
export function referencedIndex(parent: { readonly indexes: readonly IndexDef[] }, columns: readonly string[]): IndexDef | undefined {
  return parent.indexes.find((i) => i.kind !== 'index' && i.parts.length === columns.length && columns.every((c, k) => i.parts[k]?.column.toLowerCase() === c.toLowerCase() && i.parts[k]?.prefix === undefined))
}

/**
 * `spec` with `clauses` made into foreign keys beside the ones it has: each
 * named, checked against its parent, and given an index if it has none. Every
 * refusal is the one 8.4.11 gives, in its order.
 */
export function withForeignKeys(catalog: CatalogApi, schema: string, spec: TableSpec, clauses: readonly ForeignKeyClause[], checks: boolean): TableSpec {
  if (clauses.length === 0) return spec
  const existing = spec.options?.['foreignKeys'] === undefined ? [] : foreignKeysOf({ ...(spec as TableDef), schema, options: spec.options })
  const indexes = [...(spec.indexes ?? [])]
  const made: ForeignKeyDef[] = []
  // Constraint names are the schema's, case-insensitively.
  const taken = new Set<string>()
  for (const t of catalog.tables(schema)) if (t.name !== spec.name) for (const fk of foreignKeysOf(t)) taken.add(fk.name.toLowerCase())
  for (const fk of existing) taken.add(fk.name.toLowerCase())
  const prefix = `${spec.name}_ibfk_`
  let next = 1 + Math.max(0, ...existing.map((fk) => (fk.name.startsWith(prefix) && /^\d+$/.test(fk.name.slice(prefix.length)) ? Number(fk.name.slice(prefix.length)) : 0)))
  const column = (name: string): ColumnDef | undefined => spec.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())

  for (const clause of clauses) {
    const name = clause.constraint ?? `${prefix}${next++}`
    if (clause.columns.length !== clause.references.columns.length) throw sqlError('ER_WRONG_FK_DEF', `Incorrect foreign key definition for '${clause.constraint ?? 'foreign key without name'}': Key reference and table reference don't match`)
    if (taken.has(name.toLowerCase())) throw sqlError('ER_FK_DUP_NAME', `Duplicate foreign key constraint name '${name}'`)
    taken.add(name.toLowerCase())
    const children = clause.columns.map((c) => {
      const col = column(c)
      if (col === undefined) throw sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', `Key column '${c}' doesn't exist in table`)
      // A VIRTUAL column holds no value an index could check (8.4.11: 3733).
      const generation = generationOf(col)
      if (generation !== undefined && !generation.stored) throw sqlError('ER_FK_CANNOT_USE_VIRTUAL_COLUMN', `Foreign key '${name}' uses virtual column '${col.name}' which is not supported.`)
      return col
    })
    const onDelete = action(clause.onDelete)
    const onUpdate = action(clause.onUpdate)
    for (const c of children) if (!c.nullable && (onDelete === 'SET NULL' || onUpdate === 'SET NULL')) throw sqlError('ER_FK_COLUMN_NOT_NULL', `Column '${c.name}' cannot be NOT NULL: needed in a foreign key constraint '${name}' SET NULL`)

    const parentSchema = clause.references.schema ?? schema
    // A MEMORY table cannot hold a key, so nothing about its parent is checked
    // (8.4.11 accepts one naming a parent column with no key): only its index is made.
    const memory = spec.engine === 'memory'
    const self = parentSchema === schema && clause.references.table === spec.name
    let parent: { readonly columns: readonly ColumnDef[]; readonly indexes: readonly IndexDef[]; readonly engine?: string } | undefined
    if (self) parent = { columns: spec.columns, indexes }
    else {
      try {
        parent = catalog.definition(parentSchema, clause.references.table)
        // A temporary table is no parent (8.4.11: 1215).
        if (isTemporary(parent as TableDef)) throw sqlError('ER_CANNOT_ADD_FOREIGN', 'Cannot add foreign key constraint')
      } catch (e) {
        expectTyped(e)
        parent = undefined
      }
    }
    let parentColumns = clause.references.columns
    if (!memory && (checks || parent !== undefined)) {
      if (parent === undefined || parent.engine === 'memory') throw sqlError('ER_FK_CANNOT_OPEN_PARENT', `Failed to open the referenced table '${clause.references.table}'`)
      const p = parent
      parentColumns = clause.references.columns.map((c, k) => {
        const col = p.columns.find((x) => x.name.toLowerCase() === c.toLowerCase())
        if (col === undefined) throw sqlError('ER_FK_NO_COLUMN_PARENT', `Failed to add the foreign key constraint. Missing column '${c}' for constraint '${name}' in the referenced table '${clause.references.table}'`)
        if (storageClass(col.type) !== storageClass((children[k] as ColumnDef).type)) throw sqlError('ER_FK_INCOMPATIBLE_COLUMNS', `Referencing column '${(children[k] as ColumnDef).name}' and referenced column '${col.name}' in foreign key constraint '${name}' are incompatible.`)
        // The parent's spelling, as the dictionary keeps it.
        return col.name
      })
      if (referencedIndex(p, parentColumns) === undefined) throw sqlError('ER_FK_NO_UNIQUE_INDEX_PARENT', `Failed to add the foreign key constraint. Missing unique key for constraint '${name}' in the referenced table '${clause.references.table}'`)
    }

    if (supportingIndex(indexes, children.map((c) => c.name)) === undefined) {
      const first = (children[0] as ColumnDef).name
      let index = clause.constraint ?? clause.index ?? first
      if (clause.constraint === undefined && clause.index === undefined) for (let i = 2; indexes.some((x) => x.name.toLowerCase() === index.toLowerCase()); i++) index = `${first}_${i}`
      else if (indexes.some((x) => x.name.toLowerCase() === index.toLowerCase())) throw sqlError('ER_DUP_KEYNAME', `Duplicate key name '${index}'`)
      indexes.push({ name: index, kind: 'index', parts: children.map((c) => ({ column: c.name })) })
    }
    made.push({ name, columns: children.map((c) => c.name), references: { schema: parentSchema, table: clause.references.table, columns: parentColumns }, onDelete, onUpdate })
  }
  // A MEMORY table keeps the index and not the key (8.4.11).
  const keys = spec.engine === 'memory' ? existing : [...existing, ...made]
  const options: Record<string, unknown> = { ...(spec.options ?? {}) }
  if (keys.length > 0) options['foreignKeys'] = keys
  else delete options['foreignKeys']
  return { ...spec, indexes, options }
}

/** Whether any foreign key references the table: `handler::referenced_by_foreign_key`, whatever the checks say. */
export function isReferenced(run: Run, def: TableDef): boolean {
  return run.catalog !== undefined && referencingKeys(run.catalog, def.schema, def.name).length > 0
}

/** The foreign keys in other tables that reference `schema.name`. */
export function referencingKeys(catalog: CatalogApi, schema: string, name: string): { readonly child: TableDef; readonly fk: ForeignKeyDef }[] {
  const out: { child: TableDef; fk: ForeignKeyDef }[] = []
  for (const child of catalog.tables()) for (const fk of foreignKeysOf(child)) if (fk.references.schema === schema && fk.references.table === name) out.push({ child, fk })
  return out
}

// --- enforcing one ------------------------------------------------------------------

const ctx = (): StoreContext => ({ strict: true, row: 1, warnings: 0 })

/**
 * A field of one column as another's: the same value, encoded for it;
 * `undefined` if it cannot be. A byte string must survive unchanged: BINARY
 * pads, and InnoDB compares `'ab'` with `'ab\0\0'` as different (8.4.11).
 */
function convert(field: Uint8Array, from: ColumnDef, to: ColumnDef): Uint8Array | undefined {
  try {
    const value = decodeField(field, from.type)
    const out = encodeField(value, { ...to, nullable: true }, ctx()) ?? undefined
    if (out !== undefined && value?.kind === 'bytes') {
      const back = decodeField(out, to.type)
      if (back?.kind !== 'bytes' || !same(back.v, value.v)) return undefined
    }
    return out
  } catch (e) {
    expectTyped(e)
    return undefined
  }
}

const same = (a: FieldBytes, b: FieldBytes): boolean => {
  if (a === null || b === null) return a === b
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const position = (def: TableDef, name: string): number => def.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())

/** What a statement's writes share: its tables, opened once, and the keys that reference each. */
class Enforcer {
  readonly #catalog: CatalogApi
  readonly #trx: Trx | undefined
  readonly #tables = new Map<string, Table>()
  #referencing: Map<string, { child: TableDef; fk: ForeignKeyDef }[]> | undefined

  /** The writer's latest, inside a statement; the latest committed, from inside a DDL. */
  readonly #mode: ReadMode | undefined

  constructor(catalog: CatalogApi, trx: Trx | undefined) {
    this.#mode = trx === undefined ? undefined : 'current'
    this.#catalog = catalog
    this.#trx = trx
  }

  table(schema: string, name: string): Table | undefined {
    const key = `${schema}\u0000${name}`
    let t = this.#tables.get(key)
    if (t === undefined) {
      try {
        t = this.#catalog.table(schema, name)
      } catch (e) {
        expectTyped(e)
        return undefined
      }
      this.#tables.set(key, t)
    }
    return t
  }

  referencing(def: TableDef): readonly { child: TableDef; fk: ForeignKeyDef }[] {
    if (this.#referencing === undefined) {
      this.#referencing = new Map()
      for (const child of this.#catalog.tables()) {
        for (const fk of foreignKeysOf(child)) {
          const key = `${fk.references.schema}\u0000${fk.references.table}`
          const list = this.#referencing.get(key) ?? []
          list.push({ child, fk })
          this.#referencing.set(key, list)
        }
      }
    }
    return this.#referencing.get(`${def.schema}\u0000${def.name}`) ?? []
  }

  /** 1452 unless the row's parent for `fk` exists. */
  checkParent(def: TableDef, fk: ForeignKeyDef, row: Row): void {
    const at = fk.columns.map((c) => position(def, c))
    const fields = at.map((i) => row[i] ?? null)
    if (fields.some((f) => f === null)) return
    const parent = this.table(fk.references.schema, fk.references.table)
    const index = parent === undefined ? undefined : referencedIndex(parent.def, fk.references.columns)
    if (parent !== undefined && index !== undefined) {
      const values: Uint8Array[] = []
      for (const [k, f] of fields.entries()) {
        const to = parent.def.columns[position(parent.def, fk.references.columns[k] as string)] as ColumnDef
        const v = convert(f as Uint8Array, def.columns[at[k] as number] as ColumnDef, to)
        if (v === undefined) throw noParent(fk, def.schema, def.name)
        values.push(v)
      }
      const range: KeyRange = { from: { values, inclusive: true }, to: { values, inclusive: true } }
      for (const _ of parent.indexScan(index.name, range, this.#trx, this.#mode)) return
    }
    throw noParent(fk, def.schema, def.name)
  }

  /** The rows of `child` whose key for `fk` matches `parentRow`'s referenced columns. */
  children(parentDef: TableDef, parentRow: readonly FieldBytes[], child: TableDef, fk: ForeignKeyDef): { table: Table; rows: [RowId, FieldBytes[]][] } | undefined {
    const table = this.table(child.schema, child.name)
    if (table === undefined) return undefined
    const index = supportingIndex(table.def.indexes, fk.columns)
    const values: Uint8Array[] = []
    for (const [k, c] of fk.references.columns.entries()) {
      const f = parentRow[position(parentDef, c)] ?? null
      if (f === null) return undefined
      const v = convert(f, parentDef.columns[position(parentDef, c)] as ColumnDef, table.def.columns[position(table.def, fk.columns[k] as string)] as ColumnDef)
      if (v === undefined) return undefined
      values.push(v)
    }
    if (index === undefined) return undefined
    const range: KeyRange = { from: { values, inclusive: true }, to: { values, inclusive: true } }
    return { table, rows: [...table.indexScan(index.name, range, this.#trx, this.#mode)] }
  }

  guard(table: Table, depth: number, updating: ReadonlySet<string>): Table {
    return new GuardedTable(this, table, depth, updating)
  }
}

const tableKey = (def: TableDef): string => `${def.schema}\u0000${def.name}`

/** A table whose writes keep its foreign keys, and the keys that reference it. */
class GuardedTable implements Table {
  readonly def: TableDef
  readonly #enforcer: Enforcer
  readonly #inner: Table
  readonly #depth: number
  /** The tables an update further up the cascade is changing — not a delete, and not this write. */
  readonly #updating: ReadonlySet<string>
  readonly #keys: readonly ForeignKeyDef[]

  constructor(enforcer: Enforcer, inner: Table, depth: number, updating: ReadonlySet<string>) {
    this.def = inner.def
    this.#enforcer = enforcer
    this.#inner = inner
    this.#depth = depth
    this.#updating = updating
    this.#keys = foreignKeysOf(inner.def)
  }

  insert(row: Row, trx?: Trx): RowId {
    const id = this.#inner.insert(row, trx)
    try {
      for (const fk of this.#keys) this.#enforcer.checkParent(this.def, fk, row)
    } catch (e) {
      // Taken back, so a statement that goes on (IGNORE) finds it gone.
      this.#inner.delete(id, trx)
      throw e
    }
    return id
  }

  update(id: RowId, row: Row, trx?: Trx): RowId | undefined {
    const before = this.#inner.get(id, trx, 'current')
    if (before === undefined) return this.#inner.update(id, row, trx)
    const changed = (columns: readonly string[]) => columns.some((c) => !same(before[position(this.def, c)] ?? null, row[position(this.def, c)] ?? null))
    // The children of the row as it was, and the value each key gives them:
    // one that does not fit the child's column refuses the update (1451),
    // as InnoDB's cascade does, rather than writing something else.
    const cascades: { fk: ForeignKeyDef; table: Table; rows: [RowId, FieldBytes[]][]; values: FieldBytes[] }[] = []
    for (const { child, fk } of this.#enforcer.referencing(this.def)) {
      if (!changed(fk.references.columns)) continue
      const found = this.#enforcer.children(this.def, before, child, fk)
      if (found === undefined || found.rows.length === 0) continue
      if (fk.onUpdate !== 'CASCADE' && fk.onUpdate !== 'SET NULL') throw rowIsReferenced(fk, child.schema, child.name)
      // A cascaded update into a table an update in the chain — this one
      // included — is changing: InnoDB "plays safe" and refuses.
      if (this.#updating.has(tableKey(child)) || tableKey(child) === tableKey(this.def)) throw rowIsReferenced(fk, child.schema, child.name)
      const values = fk.columns.map((c, k): FieldBytes => {
        const parentAt = position(this.def, fk.references.columns[k] as string)
        const value = row[parentAt] ?? null
        if (fk.onUpdate === 'SET NULL' || value === null) return null
        const v = convert(value, this.def.columns[parentAt] as ColumnDef, found.table.def.columns[position(found.table.def, c)] as ColumnDef)
        if (v === undefined) throw rowIsReferenced(fk, child.schema, child.name)
        return v
      })
      cascades.push({ fk, ...found, values })
    }
    // The row is written first and its parents looked for after, as InnoDB
    // does: a row may become its own parent, and a duplicate key is the
    // error before a missing parent. A changed primary key is a new index
    // record, and every key is checked again (8.4.11).
    const moved = this.#inner.update(id, row, trx)
    const all = this.def.indexes.some((i) => i.kind === 'primary' && changed(i.parts.map((p) => p.column)))
    try {
      for (const fk of this.#keys) if (all || changed(fk.columns)) this.#enforcer.checkParent(this.def, fk, row)
    } catch (e) {
      this.#inner.update(moved ?? id, before, trx)
      throw e
    }
    if (cascades.length > 0) {
      if (this.#depth >= MAX_DEPTH) throw tooDeep()
      const updating = new Set([...this.#updating, tableKey(this.def)])
      for (const { fk, table, rows, values } of cascades) {
        const guarded = this.#enforcer.guard(table, this.#depth + 1, updating)
        for (const [childId] of rows) {
          const current = table.get(childId, trx, 'current')
          if (current === undefined) continue
          const next = [...current]
          for (const [k, c] of fk.columns.entries()) next[position(table.def, c)] = values[k] ?? null
          guarded.update(childId, next, trx)
        }
      }
    }
    return moved
  }

  delete(id: RowId, trx?: Trx): boolean {
    const before = this.#inner.get(id, trx, 'current')
    if (before === undefined) return false
    const cascades: { fk: ForeignKeyDef; table: Table; rows: [RowId, FieldBytes[]][] }[] = []
    for (const { child, fk } of this.#enforcer.referencing(this.def)) {
      const found = this.#enforcer.children(this.def, before, child, fk)
      if (found === undefined) continue
      // A row that is its own parent does not hold itself.
      const rows = tableKey(child) === tableKey(this.def) ? found.rows.filter(([r]) => !same(r, id)) : found.rows
      if (rows.length === 0) continue
      if (fk.onDelete !== 'CASCADE' && fk.onDelete !== 'SET NULL') throw rowIsReferenced(fk, child.schema, child.name)
      if (fk.onDelete === 'SET NULL' && this.#updating.has(tableKey(child))) throw rowIsReferenced(fk, child.schema, child.name)
      cascades.push({ fk, table: found.table, rows })
    }
    const deleted = this.#inner.delete(id, trx)
    if (cascades.length > 0) {
      if (this.#depth >= MAX_DEPTH) throw tooDeep()
      for (const { fk, table, rows } of cascades) {
        const guarded = this.#enforcer.guard(table, this.#depth + 1, this.#updating)
        for (const [childId] of rows) {
          if (fk.onDelete === 'CASCADE') {
            guarded.delete(childId, trx)
            continue
          }
          const current = table.get(childId, trx, 'current')
          if (current === undefined) continue
          const next = [...current]
          for (const c of fk.columns) next[position(table.def, c)] = null
          guarded.update(childId, next, trx)
        }
      }
    }
    return deleted
  }

  duplicateOf(index: string, row: Row, trx?: Trx): RowId | undefined {
    return this.#inner.duplicateOf(index, row, trx)
  }
  get(id: RowId, trx?: Trx, mode?: ReadMode): FieldBytes[] | undefined {
    return this.#inner.get(id, trx, mode)
  }
  scan(range?: KeyRange, trx?: Trx, mode?: ReadMode): Generator<[RowId, FieldBytes[]]> {
    return this.#inner.scan(range, trx, mode)
  }
  indexScan(index: string, range?: KeyRange, trx?: Trx, mode?: ReadMode): Generator<[RowId, FieldBytes[]]> {
    return this.#inner.indexScan(index, range, trx, mode)
  }
  nextAutoIncrement(count?: number): bigint {
    return this.#inner.nextAutoIncrement(count)
  }
  peekAutoIncrement(): bigint {
    return this.#inner.peekAutoIncrement()
  }
  raiseAutoIncrement(next: bigint): void {
    this.#inner.raiseAutoIncrement(next)
  }
  stats(): ReturnType<Table['stats']> {
    return this.#inner.stats()
  }
}

/**
 * The table a DML statement writes through. With `foreign_key_checks = 0`, or
 * no catalog, the table itself; otherwise one whose writes keep every foreign
 * key that names it, on either side.
 */
export function guarded(run: Run, table: Table, trx: Trx): Table {
  if (run.catalog === undefined || !foreignKeyChecks(run)) return table
  return new Enforcer(run.catalog, trx).guard(table, 0, new Set())
}

/**
 * The child-side check alone, reading committed parents: ALTER TABLE … ADD
 * FOREIGN KEY on rows already there, from inside the DDL that copies them.
 */
export function checkParentOf(catalog: CatalogApi): (def: TableDef, fk: ForeignKeyDef, row: Row) => void {
  const enforcer = new Enforcer(catalog, undefined)
  return (def, fk, row) => enforcer.checkParent(def, fk, row)
}
