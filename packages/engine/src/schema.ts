// M4.23 — a table's definition, as the engine keeps it (doc 27 §Our catalog).
//
// Not SQL. The parser's AST says what a statement *wrote*; this says what a
// table *is*, resolved: a column's type is `@myjs/types`' `ColumnType`, with
// its collation decided, and an index is named columns with prefixes and
// directions. What only SQL reads — a default's text, a comment, a generated
// column's expression — rides along in `attributes` for M5, unread here.
//
// Three joins nothing made before live here, because a definition is the first
// thing that has all their inputs: a column list to a record layout, an index
// to the key columns its tree is encoded with, and a table to the index that
// clusters it — InnoDB's rule, which decides the order a full scan returns.
//
// A definition is stored as JSON, one per `_myjs_tables` row, and decoded with
// every field checked: a definition that does not parse, or does not hang
// together, is `ENGINE_CORRUPT_CATALOG`, never a crash and never a table read
// with the wrong layout (D-26).
import { FIELD_TYPE } from '@myjs/bytes'
import { keyPartOf, storageWidth, type ColumnType } from '@myjs/types'
import {
  corruptCatalog,
  dupFieldName,
  dupKeyName,
  keyColumnMissing,
  multiplePriKey,
  mustHaveColumns,
  tooLongIdent,
  tooManyKeyParts,
  tooManyKeys,
  unknownEngine,
  misuse,
  wrongAutoKey,
  wrongColumnName,
  wrongFieldSpec,
  wrongIndexName,
  wrongTableName,
} from './errors.ts'
import type { KeyColumn } from './indexes.ts'
import type { RecordLayout } from './record.ts'

export type EngineName = 'native' | 'memory'

export interface ColumnDef {
  readonly name: string
  readonly type: ColumnType
  readonly nullable: boolean
  readonly autoIncrement?: boolean
  /** What only SQL reads: carried for M5, never interpreted by the engine. */
  readonly attributes?: Readonly<Record<string, unknown>>
}

export interface IndexPartDef {
  readonly column: string
  /** Characters for a collated string, bytes for a binary one. */
  readonly prefix?: number
  readonly descending?: boolean
}

export interface IndexDef {
  /** `PRIMARY` for the primary key, as MySQL names it. */
  readonly name: string
  readonly kind: 'primary' | 'unique' | 'index'
  readonly parts: readonly IndexPartDef[]
  /** The tree, for a native table. */
  readonly indexId?: number
}

/** What CREATE TABLE asks for. */
export interface TableSpec {
  readonly name: string
  readonly engine?: EngineName
  readonly columns: readonly ColumnDef[]
  readonly indexes?: readonly IndexDef[]
  readonly options?: Readonly<Record<string, unknown>>
}

/** What the catalog keeps: a spec resolved, with ids, the clustered index chosen, and its trees named. */
export interface TableDef {
  readonly id: number
  readonly schema: string
  readonly name: string
  readonly engine: EngineName
  readonly columns: readonly ColumnDef[]
  readonly indexes: readonly IndexDef[]
  /**
   * The index rows are clustered by: an index's name, or `null` for InnoDB's
   * `GEN_CLUST_INDEX` — a hidden 6-byte row id, appended to the record.
   */
  readonly clustered: string | null
  /** The hidden row id index's tree, for a native table with `clustered` null. */
  readonly rowIdIndexId?: number
  readonly options: Readonly<Record<string, unknown>>
}

/** MySQL's identifier limit (`NAME_CHAR_LEN`), in characters. */
export const NAME_CHARS = 64
/** The bytes a name can take: 64 characters of the BMP, as utf8mb3 — MySQL's identifiers have no others. */
export const NAME_BYTES = NAME_CHARS * 3
export const MAX_INDEXES = 64
export const MAX_KEY_PARTS = 16
/** The hidden row id's width: InnoDB's `DATA_ROW_ID_LEN`. */
export const ROW_ID_BYTES = 6

const lower = (s: string): string => s.toLowerCase()

/**
 * A name MySQL would accept: at most 64 characters, none outside the BMP, not
 * empty and not ending in a space. `kind` picks the error the refusal is.
 */
export function checkName(name: string, wrong: (name: string) => Error): void {
  if (name.length === 0 || name.endsWith(' ')) throw wrong(name)
  let chars = 0
  for (const c of name) {
    if ((c.codePointAt(0) as number) > 0xffff) throw wrong(name)
    chars++
  }
  if (chars > NAME_CHARS) throw tooLongIdent(name)
}

const INTEGER_TYPES: ReadonlySet<number> = new Set([FIELD_TYPE.TINY, FIELD_TYPE.SHORT, FIELD_TYPE.INT24, FIELD_TYPE.LONG, FIELD_TYPE.LONGLONG])

/**
 * The clustered index, by InnoDB's rule: the PRIMARY KEY; failing that, the
 * first UNIQUE index all of whose columns are NOT NULL and none of whose parts
 * is a prefix (MySQL's `sort_keys` puts those first, in declared order, and
 * `TABLE_SHARE` promotes the first); failing that, `null`, the hidden row id.
 */
export function clusteredIndexOf(columns: readonly ColumnDef[], indexes: readonly IndexDef[]): string | null {
  const primary = indexes.find((i) => i.kind === 'primary')
  if (primary !== undefined) return primary.name
  const notNull = new Map(columns.map((c) => [lower(c.name), !c.nullable]))
  const promoted = indexes.find((i) => i.kind === 'unique' && i.parts.every((p) => p.prefix === undefined && notNull.get(lower(p.column)) === true))
  return promoted?.name ?? null
}

/**
 * Resolve CREATE TABLE's spec into a definition, refusing what MySQL refuses
 * with its numbers. Primary key columns become NOT NULL, as MySQL makes them.
 * Every index's key parts are built once here, so a type that cannot be keyed
 * is refused at definition, never at the first insert.
 */
export function resolveTable(id: number, schema: string, spec: TableSpec): TableDef {
  checkName(spec.name, wrongTableName)
  if (spec.engine !== undefined && spec.engine !== 'native' && spec.engine !== 'memory') throw unknownEngine(String(spec.engine))
  if (spec.columns.length === 0) throw mustHaveColumns()
  const indexes = spec.indexes ?? []
  if (indexes.length > MAX_INDEXES) throw tooManyKeys(MAX_INDEXES)
  const seen = new Set<string>()
  for (const c of spec.columns) {
    checkName(c.name, wrongColumnName)
    // Every number a type carries is checked here as `decodeTableDef` will
    // check it, so a definition is never stored that the catalog cannot read
    // back. The executor fuzzer found the gap: `VARCHAR(18446744073709551615)`
    // made a table every later statement called corrupt.
    for (const field of ['length', 'precision', 'scale', 'decimals', 'bits', 'collationId'] as const) {
      const v = c.type[field]
      if (v !== undefined && (!Number.isSafeInteger(v) || v < 0)) throw wrongFieldSpec(c.name)
    }
    if (seen.has(lower(c.name))) throw dupFieldName(c.name)
    seen.add(lower(c.name))
  }
  const keyed = new Set<string>()
  for (const i of indexes) for (const p of i.parts) keyed.add(lower(p.column))
  const inPrimary = new Set(indexes.filter((i) => i.kind === 'primary').flatMap((i) => i.parts.map((p) => lower(p.column))))
  const columns = spec.columns.map((c) => (inPrimary.has(lower(c.name)) && c.nullable ? { ...c, nullable: false } : c))
  const names = new Set<string>()
  let primaries = 0
  for (const i of indexes) {
    if (i.kind === 'primary') {
      primaries++
      if (i.name !== 'PRIMARY') throw wrongIndexName(i.name)
    } else {
      checkName(i.name, wrongIndexName)
      if (lower(i.name) === 'primary') throw wrongIndexName(i.name)
    }
    if (primaries > 1) throw multiplePriKey()
    if (names.has(lower(i.name))) throw dupKeyName(i.name)
    names.add(lower(i.name))
    if (i.parts.length === 0) throw keyColumnMissing('')
    if (i.parts.length > MAX_KEY_PARTS) throw tooManyKeyParts(MAX_KEY_PARTS)
    const parts = new Set<string>()
    for (const p of i.parts) {
      if (parts.has(lower(p.column))) throw dupFieldName(p.column)
      parts.add(lower(p.column))
    }
  }
  // ER_WRONG_AUTO_KEY: one AUTO_INCREMENT column, an integer, first in some index.
  const auto = columns.filter((c) => c.autoIncrement === true)
  if (auto.length > 1) throw wrongAutoKey()
  for (const c of auto) {
    if (!INTEGER_TYPES.has(c.type.type)) throw wrongFieldSpec(c.name)
    if (!indexes.some((i) => lower(i.parts[0]?.column ?? '') === lower(c.name))) throw wrongAutoKey()
  }
  const def: TableDef = {
    id,
    schema,
    name: spec.name,
    engine: spec.engine ?? 'native',
    columns,
    indexes,
    clustered: clusteredIndexOf(columns, indexes),
    options: spec.options ?? {},
  }
  for (const i of indexes) keyColumnsOf(def, i)
  return def
}

/** A column's position, by name, as MySQL finds one: case-insensitively. */
export function columnIndex(def: Pick<TableDef, 'columns'>, name: string): number {
  const at = def.columns.findIndex((c) => lower(c.name) === lower(name))
  if (at === -1) throw keyColumnMissing(name)
  return at
}

/**
 * The record a row is stored as: a field per column, fixed where the type's
 * width is, and the hidden row id after them when the table has no key to
 * cluster by.
 */
export function layoutOf(def: TableDef): RecordLayout {
  const fields = def.columns.map((c) => {
    const fixed = storageWidth(c.type)
    return fixed === undefined ? { nullable: c.nullable } : { nullable: c.nullable, fixed }
  })
  return def.clustered === null ? [...fields, { nullable: false, fixed: ROW_ID_BYTES }] : fields
}

/** The key columns an index's tree is encoded with. */
export function keyColumnsOf(def: TableDef, index: IndexDef): KeyColumn[] {
  return index.parts.map((p) => {
    const field = columnIndex(def, p.column)
    const c = def.columns[field] as ColumnDef
    const options = { ...(p.prefix === undefined ? {} : { prefix: p.prefix }), ...(p.descending === true ? { descending: true } : {}) }
    return { field, part: keyPartOf(c.type, c.nullable, options) }
  })
}

/** The clustered index's key columns: the chosen index's, or the hidden row id's. */
export function clusteredKeyOf(def: TableDef): KeyColumn[] {
  if (def.clustered === null) return [{ field: def.columns.length, part: { kind: 'bytes', nullable: false } }]
  return keyColumnsOf(def, indexNamed(def, def.clustered))
}

/** Every index but the clustered one, in declared order. */
export function secondariesOf(def: TableDef): IndexDef[] {
  return def.indexes.filter((i) => i.name !== def.clustered)
}

export function indexNamed(def: TableDef, name: string): IndexDef {
  const index = def.indexes.find((i) => lower(i.name) === lower(name))
  if (index === undefined) throw keyColumnMissing(name)
  return index
}

/** The collations a table's keys compare with: what to `loadCollation` before opening it. */
export function collationsOf(def: TableDef): number[] {
  const ids = new Set<number>()
  for (const c of def.columns) if (c.type.collationId !== undefined) ids.add(c.type.collationId)
  return [...ids]
}

// --- JSON ---------------------------------------------------------------------

export function encodeTableDef(def: TableDef): Uint8Array {
  let json: string
  try {
    json = JSON.stringify(def)
  } catch (e) {
    throw misuse(`a table definition that is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  return new TextEncoder().encode(json)
}

/** A stored definition, checked field by field. Any bytes may be passed. */
export function decodeTableDef(bytes: Uint8Array): TableDef {
  let v: unknown
  try {
    v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (e) {
    throw corruptCatalog(`a table definition that is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const d = record(v, 'a table definition')
  const columns = array(d['columns'], 'columns').map((c) => columnDef(c))
  const indexes = array(d['indexes'], 'indexes').map((i) => indexDef(i))
  const def: TableDef = {
    id: uint(d['id'], 'id'),
    schema: str(d['schema'], 'schema'),
    name: str(d['name'], 'name'),
    engine: oneOf(d['engine'], ['native', 'memory'] as const, 'engine'),
    columns,
    indexes,
    clustered: d['clustered'] === null ? null : str(d['clustered'], 'clustered'),
    ...(d['rowIdIndexId'] === undefined ? {} : { rowIdIndexId: uint(d['rowIdIndexId'], 'rowIdIndexId') }),
    options: record(d['options'], 'options'),
  }
  // It must hang together: every key part names a column, the clustered index
  // exists, and a native table names every tree it uses. Key parts are built
  // when the table is opened, not here: they need its collations, which the
  // async edge loads first, from `collationsOf` (D-36).
  try {
    if (def.clustered !== null) indexNamed(def, def.clustered)
    for (const i of indexes) for (const p of i.parts) columnIndex(def, p.column)
  } catch (e) {
    throw corruptCatalog(`table ${def.schema}.${def.name}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (def.engine === 'native') {
    if (indexes.some((i) => i.indexId === undefined)) throw corruptCatalog(`native table ${def.schema}.${def.name} has an index with no tree`)
    if (def.clustered === null && def.rowIdIndexId === undefined) throw corruptCatalog(`native table ${def.schema}.${def.name} has no row id tree`)
  }
  return def
}

function columnDef(v: unknown): ColumnDef {
  const c = record(v, 'a column')
  const t = record(c['type'], 'a column type')
  const type: ColumnType = {
    type: uint(t['type'], 'type.type'),
    ...optional(t, 'unsigned', (x) => bool(x, 'type.unsigned')),
    ...optional(t, 'precision', (x) => uint(x, 'type.precision')),
    ...optional(t, 'scale', (x) => uint(x, 'type.scale')),
    ...optional(t, 'decimals', (x) => uint(x, 'type.decimals')),
    ...optional(t, 'members', (x) => array(x, 'type.members').map((m) => str(m, 'a member'))),
    ...optional(t, 'collationId', (x) => uint(x, 'type.collationId')),
    ...optional(t, 'bits', (x) => uint(x, 'type.bits')),
    ...optional(t, 'length', (x) => uint(x, 'type.length')),
  }
  return {
    name: str(c['name'], 'column name'),
    type,
    nullable: bool(c['nullable'], 'nullable'),
    ...optional(c, 'autoIncrement', (x) => bool(x, 'autoIncrement')),
    ...optional(c, 'attributes', (x) => record(x, 'attributes')),
  }
}

function indexDef(v: unknown): IndexDef {
  const i = record(v, 'an index')
  return {
    name: str(i['name'], 'index name'),
    kind: oneOf(i['kind'], ['primary', 'unique', 'index'] as const, 'index kind'),
    parts: array(i['parts'], 'parts').map((p) => {
      const r = record(p, 'a key part')
      return {
        column: str(r['column'], 'key part column'),
        ...optional(r, 'prefix', (x) => uint(x, 'prefix')),
        ...optional(r, 'descending', (x) => bool(x, 'descending')),
      }
    }),
    ...optional(i, 'indexId', (x) => uint(x, 'indexId')),
  }
}

function optional<K extends string, T>(o: Record<string, unknown>, key: K, read: (v: unknown) => T): { [P in K]?: T } {
  return (o[key] === undefined ? {} : { [key]: read(o[key]) }) as { [P in K]?: T }
}

function record(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw corruptCatalog(`${what} is not an object`)
  return v as Record<string, unknown>
}

function array(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw corruptCatalog(`${what} is not an array`)
  return v
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw corruptCatalog(`${what} is not a string`)
  return v
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw corruptCatalog(`${what} is not a boolean`)
  return v
}

function uint(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw corruptCatalog(`${what} is not a whole number`)
  return v
}

function oneOf<T extends string>(v: unknown, values: readonly T[], what: string): T {
  if (!values.includes(v as T)) throw corruptCatalog(`${what} is not one of ${values.join(', ')}`)
  return v as T
}
