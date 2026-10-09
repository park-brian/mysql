// M4.23 — the catalog (doc 27 §Our catalog).
//
// Schemas and tables are rows in system tables — ordinary MVCC clustered
// indexes on trees with reserved ids — so DDL is transactional for free, and
// crash-atomic the same way a row is:
//
//   `_myjs_catalog`  name → value: `version`, `lower_case_table_names`
//   `_myjs_schemas`  name → id, definition (JSON)
//   `_myjs_tables`   schema id, name → id, definition (JSON: `TableDef`)
//
// A view is a `_myjs_tables` row too, with id 0, which no table has (the
// counter starts at 1), and a `ViewDef` for its definition. Tables and views
// share one namespace in MySQL — CREATE TABLE over a view's name is 1050 — and
// one key gives that for nothing.
//
// Those ids and layouts are the bootstrap descriptor: constants in this file,
// which `FORMAT_VERSION` pins, so no page has to be read to find them (D-56).
// A table's definition is its `_myjs_tables` row and nowhere else — one copy,
// changed by the transaction that changes the table (D-57).
//
// **DDL is a transaction of its own**, as MySQL's implicit commit makes it:
// CREATE TABLE makes its trees with undo records that drop them on rollback,
// and inserts its row; DROP TABLE deletes the row and leaves a record that
// drops the trees on purge, so a view older than the DROP keeps reading them
// until it closes. A crash anywhere in either rolls back to before it.
//
// **Lookups read the latest committed definition**, never a view's — as
// MySQL's data dictionary, behind its metadata locks, does. A table handle
// re-checks before every write that its table is still the one in the
// catalog, so a write cannot land in a tree purge is about to drop; a
// consistent read through a view older than the definition is
// `ER_TABLE_DEF_CHANGED`, InnoDB's answer (review, M4.23).
//
// **Versioning is M4.23's done-when.** The catalog's version is a row. Opening
// one older than this build runs each registered migration in order, inside
// one transaction that also writes the new version: a crash leaves it old and
// unmigrated or new and migrated, never half. One newer, or older with a step
// missing, is `ENGINE_BAD_FORMAT` naming both. Migrations rewrite definitions;
// the system tables' own layout is the store format's, which is refused, not
// migrated (D-26).
import { TypeError as TypeError_ } from '@myjs/types'
import { badFormat, corruptCatalog, misuse, dbExists, dbMissingOnDrop, noSuchTable, notAView, notSupportedYet, tableExists, unknownDb, unknownTable, writerBusy, wrongDbName, wrongTableName } from './errors.ts'
import { ClusteredIndex, type KeyColumn, type Row } from './indexes.ts'
import { decodeRecord, externalRefs, type FieldBytes, type RecordLayout } from './record.ts'
import { NAME_BYTES, checkName, clusteredKeyOf, decodeTableDef, encodeTableDef, keyColumnsOf, layoutOf, resolveTable, secondariesOf, type TableDef, type TableSpec } from './schema.ts'
import type { Store } from './store.ts'
import { MemoryEngine, NativeEngine, type StorageEngine, type Table, type TableHooks } from './table.ts'
import { CLUSTERED_HEADER, versionOf, type Trx } from './trx.ts'
import type { VerifyOptions } from './verify.ts'

/** This build's catalog version. */
export const CATALOG_VERSION = 1

/** The system tables' reserved index ids (below `FIRST_USER_INDEX`; 1 is the store's counters). */
export const SYSTEM_INDEX = { CATALOG: 2, SCHEMAS: 3, TABLES: 4 } as const

const name = { nullable: false } as const
const id = { nullable: false, fixed: 4 } as const
const SYSTEM: Record<keyof typeof SYSTEM_INDEX, { layout: RecordLayout; key: KeyColumn[] }> = {
  CATALOG: { layout: [name, name], key: [{ field: 0, part: { kind: 'bytes', nullable: false, width: 64 } }] },
  SCHEMAS: { layout: [name, id, name], key: [{ field: 0, part: { kind: 'bytes', nullable: false, width: NAME_BYTES } }] },
  TABLES: {
    layout: [id, name, id, name],
    key: [
      { field: 0, part: { kind: 'bytes', nullable: false } },
      { field: 1, part: { kind: 'bytes', nullable: false, width: NAME_BYTES } },
    ],
  },
}

/** A view: the query's text, which is parsed again at each use, and its own column names if it gave any. */
export interface ViewDef {
  readonly schema: string
  readonly name: string
  /** The query as written, so its unaliased columns are named as they were at CREATE VIEW. */
  readonly query: string
  /** The database its unqualified names are in: the one current at CREATE VIEW, if any (8.4.11). */
  readonly database?: string
  readonly columns?: readonly string[]
  readonly algorithm?: 'UNDEFINED' | 'MERGE' | 'TEMPTABLE'
  readonly checkOption?: 'CASCADED' | 'LOCAL'
  readonly security?: 'DEFINER' | 'INVOKER'
  /** Whether CREATE VIEW named the columns itself, which SHOW CREATE VIEW then lists. */
  readonly listed?: true
  /** Who made it, `user@host`, and the connection collation it was made in, as INFORMATION_SCHEMA.VIEWS reports them. */
  readonly definer?: string
  readonly collationConnection?: number
}

const VIEW_ID = 0

function encodeViewDef(v: ViewDef): Uint8Array {
  return utf8.encode(JSON.stringify({ view: v }))
}

function decodeViewDef(bytes: Uint8Array): ViewDef {
  let v: unknown
  try {
    v = JSON.parse(str(bytes, 'a view definition'))
  } catch (e) {
    throw corruptCatalog(`a view definition that is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const d = (v as { view?: unknown } | null)?.view as Record<string, unknown> | undefined
  const isStr = (x: unknown): x is string => typeof x === 'string'
  if (d === null || typeof d !== 'object' || !isStr(d['schema']) || !isStr(d['name']) || !isStr(d['query'])) throw corruptCatalog('a view definition without its schema, name and query')
  const database = d['database']
  if (database !== undefined && !isStr(database)) throw corruptCatalog('a view definition whose database is not a name')
  const columns = d['columns']
  if (columns !== undefined && !(Array.isArray(columns) && columns.every(isStr))) throw corruptCatalog('a view definition whose columns are not names')
  const algorithm = d['algorithm']
  if (algorithm !== undefined && algorithm !== 'UNDEFINED' && algorithm !== 'MERGE' && algorithm !== 'TEMPTABLE') throw corruptCatalog(`a view algorithm of ${JSON.stringify(algorithm)}`)
  const checkOption = d['checkOption']
  if (checkOption !== undefined && checkOption !== 'CASCADED' && checkOption !== 'LOCAL') throw corruptCatalog(`a view check option of ${JSON.stringify(checkOption)}`)
  const definer = d['definer']
  const collationConnection = d['collationConnection']
  if (definer !== undefined && !isStr(definer)) throw corruptCatalog('a view definition whose definer is not a name')
  if (collationConnection !== undefined && typeof collationConnection !== 'number') throw corruptCatalog('a view definition whose collation is not an id')
  const security = d['security']
  if (security !== undefined && security !== 'DEFINER' && security !== 'INVOKER') throw corruptCatalog(`a view security of ${JSON.stringify(security)}`)
  const listed = d['listed']
  if (listed !== undefined && listed !== true) throw corruptCatalog('a view definition whose column list flag is not true')
  return {
    schema: d['schema'],
    name: d['name'],
    query: d['query'],
    ...(database === undefined ? {} : { database }),
    ...(definer === undefined ? {} : { definer }),
    ...(collationConnection === undefined ? {} : { collationConnection }),
    ...(columns === undefined ? {} : { columns }),
    ...(algorithm === undefined ? {} : { algorithm }),
    ...(checkOption === undefined ? {} : { checkOption }),
    ...(security === undefined ? {} : { security }),
    ...(listed === undefined ? {} : { listed }),
  }
}

const isView = (row: readonly (Uint8Array | null)[]): boolean => readBe32(row[2]) === VIEW_ID

export interface SchemaDef {
  readonly id: number
  readonly name: string
  /** The default collation of the schema's tables' strings. */
  readonly collationId?: number
}

/** What a migration may do: read and rewrite every stored definition, inside the migrating transaction. */
export interface MigrationContext {
  readonly trx: Trx
  /** Every table's definition as stored — the old version's JSON, not yet a `TableDef`. */
  tables(): { readonly schemaId: number; readonly name: string; readonly definition: unknown }[]
  rewrite(schemaId: number, name: string, definition: unknown): void
}

export interface Migration {
  /** The version it migrates from, to `from + 1`. */
  readonly from: number
  migrate(context: MigrationContext): void
}

export interface CatalogOptions {
  /** The version this catalog is at — `CATALOG_VERSION`, but a test can be a later build. */
  readonly version?: number
  readonly migrations?: readonly Migration[]
  /** MySQL's setting, chosen when the catalog is made and kept; only 0 is implemented. */
  readonly lowerCaseTableNames?: 0 | 1
}

const utf8 = new TextEncoder()
const text = new TextDecoder('utf-8', { fatal: true })
const be32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}
const readBe32 = (b: Uint8Array | null | undefined): number => {
  if (!(b instanceof Uint8Array) || b.length !== 4) throw corruptCatalog('an id that is not four bytes')
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0)
}
const str = (b: Uint8Array | null | undefined, what: string): string => {
  if (!(b instanceof Uint8Array)) throw corruptCatalog(`${what} is missing`)
  try {
    return text.decode(b)
  } catch {
    throw corruptCatalog(`${what} is not UTF-8`)
  }
}

export class Catalog {
  readonly store: Store
  readonly version: number
  readonly engines: { readonly native: NativeEngine; readonly memory: MemoryEngine }
  readonly #catalog: ClusteredIndex
  readonly #schemas: ClusteredIndex
  readonly #tables: ClusteredIndex
  /** Counts the writes to `_myjs_tables`: a table found alive stays so until the next. */
  #generation = 0

  private constructor(store: Store, version: number) {
    this.store = store
    this.version = version
    this.engines = { native: new NativeEngine(store), memory: new MemoryEngine() }
    const open = (k: keyof typeof SYSTEM_INDEX) => new ClusteredIndex(store.openTree(SYSTEM_INDEX[k]), SYSTEM[k].layout, SYSTEM[k].key, `_myjs_${k.toLowerCase()}`)
    this.#catalog = open('CATALOG')
    this.#schemas = open('SCHEMAS')
    this.#tables = open('TABLES')
  }

  /**
   * The catalog of an open store: made, if the store has none, or checked and
   * migrated. Call it after `Store.open`, whose recovery has already rolled
   * back whatever a crash left open — a migration it interrupted included.
   */
  static open(store: Store, options: CatalogOptions = {}): Catalog {
    const version = options.version ?? CATALOG_VERSION
    if ((options.lowerCaseTableNames ?? 0) !== 0) throw notSupportedYet('lower_case_table_names = 1')
    if (!store.hasTree(SYSTEM_INDEX.CATALOG)) {
      ddl(store, undefined, (trx) => {
        for (const k of ['CATALOG', 'SCHEMAS', 'TABLES'] as const) {
          trx.write(() => {
            store.createTree({ indexId: SYSTEM_INDEX[k] })
            trx.undo({ trees: { onRollback: [{ indexId: SYSTEM_INDEX[k], layout: SYSTEM[k].layout }], onPurge: [] } })
          })
        }
        const c = new Catalog(store, version)
        c.#setting('version', String(version), trx)
        c.#setting('lower_case_table_names', '0', trx)
      })
      return new Catalog(store, version)
    }
    const c = new Catalog(store, version)
    const stored = c.#version()
    if (c.#settingOf('lower_case_table_names') !== '0') throw notSupportedYet('lower_case_table_names = 1')
    if (stored === version) return c
    if (stored > version) throw badFormat(`catalog version ${stored}; this build reads ${version} — open it with the build that wrote it, or a later one`)
    const chain: Migration[] = []
    for (let v = stored; v < version; v++) {
      const m = options.migrations?.find((x) => x.from === v)
      if (m === undefined) throw badFormat(`catalog version ${stored}; this build reads ${version} and has no migration from ${v}`)
      chain.push(m)
    }
    ddl(store, undefined, (trx) => {
      const context: MigrationContext = {
        trx,
        tables: () =>
          [...c.#tables.scan({}, trx, 'current')].map(([, r]) => {
            let definition: unknown
            try {
              definition = JSON.parse(str(r[3], 'a definition'))
            } catch (e) {
              throw corruptCatalog(`a definition that is not JSON: ${e instanceof Error ? e.message : String(e)}`)
            }
            return { schemaId: readBe32(r[0]), name: str(r[1], 'a table name'), definition }
          }),
        rewrite: (schemaId, name, definition) => {
          const key = c.#tableKey(schemaId, name)
          const r = c.#tables.get(key, trx, 'current')
          if (r === undefined) throw corruptCatalog(`a migration rewrote ${name}, which is not a table`)
          c.#tables.update([r[0] ?? null, r[1] ?? null, r[2] ?? null, utf8.encode(JSON.stringify(definition))], trx)
        },
      }
      for (const m of chain) m.migrate(context)
      c.#setting('version', String(version), trx)
    })
    return c
  }

  // --- schemas ------------------------------------------------------------------

  createSchema(name: string, options: { readonly ifNotExists?: boolean; readonly collationId?: number; readonly trx?: Trx } = {}): SchemaDef | undefined {
    checkName(name, wrongDbName)
    return ddl(this.store, options.trx, (trx) => {
      if (this.#schemaOf(name, trx) !== undefined) {
        if (options.ifNotExists === true) return undefined
        throw dbExists(name)
      }
      const def: SchemaDef = { id: Number(this.store.takeCounter(SYSTEM_INDEX.SCHEMAS, 0)), name, ...(options.collationId === undefined ? {} : { collationId: options.collationId }) }
      this.#schemas.insert([utf8.encode(name), be32(def.id), utf8.encode(JSON.stringify(def))], trx)
      return def
    })
  }

  /** Drop a schema and every table and view in it, in one transaction. Returns their names. */
  dropSchema(name: string, options: { readonly ifExists?: boolean; readonly trx?: Trx } = {}): string[] {
    const discards: (() => void)[] = []
    const dropped = ddl(this.store, options.trx, (trx) => {
      const s = this.#schemaOf(name, trx)
      if (s === undefined) {
        if (options.ifExists === true) return []
        throw dbMissingOnDrop(name)
      }
      const names: string[] = []
      for (const def of this.#definitions(s.id, trx)) {
        discards.push(this.#drop(def, s.id, trx))
        names.push(def.name)
      }
      for (const v of this.#views(s.id, trx)) {
        this.#changing().delete(this.#tableKey(s.id, v.name), trx)
        names.push(v.name)
      }
      this.#schemas.delete(this.#schemaKey(name), trx)
      return names
    })
    for (const d of discards) d()
    return dropped
  }

  schema(name: string): SchemaDef {
    const s = this.#schemaOf(name, undefined)
    if (s === undefined) throw unknownDb(name)
    return s
  }

  schemas(): SchemaDef[] {
    return [...this.#schemas.scan()].map(([, r]) => schemaDef(r[2]))
  }

  // --- tables -------------------------------------------------------------------

  /**
   * CREATE TABLE. The definition is resolved and checked — names, keys, the
   * clustered index — before anything is made, so a refusal leaves nothing.
   * With `ifNotExists`, an existing table's definition is returned instead.
   */
  createTable(schema: string, spec: TableSpec, options: { readonly ifNotExists?: boolean; readonly trx?: Trx } = {}): TableDef {
    return ddl(this.store, options.trx, (trx) => {
      const s = this.#schemaOf(schema, trx)
      if (s === undefined) throw unknownDb(schema)
      const existing = this.#definition(s.id, spec.name, trx)
      if (existing !== undefined) {
        if (options.ifNotExists === true) return existing
        throw tableExists(spec.name)
      }
      if (this.#row(s.id, spec.name, trx) !== undefined) throw tableExists(spec.name)
      const resolved = resolveTable(Number(this.store.takeCounter(SYSTEM_INDEX.TABLES, 0)), schema, spec)
      // Both engines refuse a key the page cannot hold, the same way.
      ClusteredIndex.check(this.store.pool.pageSize, layoutOf(resolved), clusteredKeyOf(resolved), secondariesOf(resolved).map((i) => keyColumnsOf(resolved, i)))
      const def = this.#engine(resolved).create(resolved, trx)
      this.#changing().insert([be32(s.id), utf8.encode(def.name), be32(def.id), encodeTableDef(def)], trx)
      return def
    })
  }

  /** DROP TABLE: the definition goes now, the storage when no view can need it. */
  dropTable(schema: string, name: string, options: { readonly ifExists?: boolean; readonly trx?: Trx } = {}): boolean {
    let discard: (() => void) | undefined
    const dropped = ddl(this.store, options.trx, (trx) => {
      const s = this.#schemaOf(schema, trx)
      const def = s === undefined ? undefined : this.#definition(s.id, name, trx)
      if (s === undefined || def === undefined) {
        if (options.ifExists === true) return false
        throw unknownTable(`${schema}.${name}`)
      }
      discard = this.#drop(def, s.id, trx)
      return true
    })
    discard?.()
    return dropped
  }

  /**
   * TRUNCATE TABLE: the table made again from its own definition, in one DDL,
   * so a crash leaves either the old table or the new one. It is empty, and
   * its AUTO_INCREMENT starts again from 1, since the counter belongs to the
   * clustered tree and the tree is new.
   */
  truncateTable(schema: string, name: string): TableDef {
    let discard: (() => void) | undefined
    const def = ddl(this.store, undefined, (trx) => {
      const s = this.#schemaOf(schema, trx)
      const old = s === undefined ? undefined : this.#definition(s.id, name, trx)
      if (s === undefined || old === undefined) throw noSuchTable(schema, name)
      discard = this.#drop(old, s.id, trx)
      const spec: TableSpec = { name: old.name, engine: old.engine, columns: old.columns, indexes: old.indexes, options: old.options }
      const resolved = resolveTable(Number(this.store.takeCounter(SYSTEM_INDEX.TABLES, 0)), schema, spec)
      const made = this.#engine(resolved).create(resolved, trx)
      this.#changing().insert([be32(s.id), utf8.encode(made.name), be32(made.id), encodeTableDef(made)], trx)
      return made
    })
    discard?.()
    return def
  }

  /**
   * ALTER TABLE by copy: a table made from `spec`, every row of the old one
   * passed through `copy` into it, its AUTO_INCREMENT counter carried over, and
   * the old one dropped — one DDL, so a crash or a refused row (a duplicate
   * under a new UNIQUE key, say) leaves the old table as it was.
   */
  rebuildTable(schema: string, name: string, spec: TableSpec, copy: (row: FieldBytes[]) => Row): TableDef {
    let discard: (() => void) | undefined
    let made: TableDef | undefined
    try {
      const def = ddl(this.store, undefined, (trx) => {
        const s = this.#schemaOf(schema, trx)
        const old = s === undefined ? undefined : this.#definition(s.id, name, trx)
        if (s === undefined || old === undefined) throw noSuchTable(schema, name)
        const resolved = resolveTable(Number(this.store.takeCounter(SYSTEM_INDEX.TABLES, 0)), schema, spec)
        ClusteredIndex.check(this.store.pool.pageSize, layoutOf(resolved), clusteredKeyOf(resolved), secondariesOf(resolved).map((i) => keyColumnsOf(resolved, i)))
        made = this.#engine(resolved).create(resolved, trx)
        // Both handles live only inside this DDL, which holds the writer.
        const hooks: TableHooks = { definedBy: 0, alive: () => {} }
        const from = this.#engine(old).open(old, hooks)
        const to = this.#engine(made).open(made, hooks)
        for (const [, row] of from.scan(undefined, trx, 'current')) to.insert(copy(row), trx)
        to.raiseAutoIncrement(from.peekAutoIncrement())
        discard = this.#drop(old, s.id, trx)
        this.#changing().insert([be32(s.id), utf8.encode(made.name), be32(made.id), encodeTableDef(made)], trx)
        return made
      })
      discard?.()
      return def
    } catch (e) {
      // A memory table's rows are not the transaction's to take back.
      if (made !== undefined && !this.#engine(made).transactional) this.#engine(made).discard(made)
      throw e
    }
  }

  /**
   * Several DDL steps as one: `change` runs in a transaction of its own,
   * which each step takes as its `trx`, and commits when it returns — so a
   * RENAME TABLE of many pairs, or a swap through a third name, is one
   * change, all of it or none.
   */
  ddlTransaction<T>(change: (trx: Trx) => T): T {
    return ddl(this.store, undefined, change)
  }

  /**
   * RENAME TABLE's step: a table's row moved to a new name, or to another
   * schema, and a view's to a new name — the trees untouched, since they are
   * keyed by the table's id. `rewrite` gives the options the moved definition
   * carries (constraint names that follow the table's own). The schemas are
   * looked up first, then the table, then the name it takes (8.4.11: 1049
   * before 1146, and 1050 for a name in use, its own included).
   */
  renameTable(schema: string, name: string, to: { readonly schema: string; readonly name: string }, options: { readonly trx?: Trx; readonly rewrite?: (def: TableDef) => TableDef['options'] } = {}): void {
    checkName(to.name, wrongTableName)
    ddl(this.store, options.trx, (trx) => {
      const s = this.#schemaOf(schema, trx)
      if (s === undefined) throw unknownDb(schema)
      const t = this.#schemaOf(to.schema, trx)
      if (t === undefined) throw unknownDb(to.schema)
      const row = this.#row(s.id, name, trx)
      if (row === undefined) throw noSuchTable(schema, name)
      if (this.#row(t.id, to.name, trx) !== undefined) throw tableExists(to.name)
      this.#changing().delete(this.#tableKey(s.id, name), trx)
      if (isView(row)) {
        if (t.id !== s.id) throw misuse('a view stays in its schema')
        this.#changing().insert([be32(s.id), utf8.encode(to.name), be32(VIEW_ID), encodeViewDef({ ...decodeViewDef(row[3] as Uint8Array), name: to.name })], trx)
        return
      }
      const moved: TableDef = { ...decodeTableDef(row[3] as Uint8Array), schema: to.schema, name: to.name }
      const def = options.rewrite === undefined ? moved : { ...moved, options: options.rewrite(moved) }
      this.#changing().insert([be32(t.id), utf8.encode(to.name), be32(def.id), encodeTableDef(def)], trx)
    })
  }

  /** A table's options rewritten where they are, its rows untouched: the foreign keys a child keeps after its parent is renamed. */
  setTableOptions(schema: string, name: string, tableOptions: TableDef['options'], options: { readonly trx?: Trx } = {}): void {
    ddl(this.store, options.trx, (trx) => {
      const s = this.#schemaOf(schema, trx)
      const def = s === undefined ? undefined : this.#definition(s.id, name, trx)
      if (s === undefined || def === undefined) throw noSuchTable(schema, name)
      this.#changing().update([be32(s.id), utf8.encode(def.name), be32(def.id), encodeTableDef({ ...def, options: tableOptions })], trx)
    })
  }

  /** A table's definition, as last committed. ER_NO_SUCH_TABLE if there is none. */
  /** A table's definition, as last committed, or as `trx` sees it. */
  definition(schema: string, name: string, trx?: Trx): TableDef {
    const s = this.#schemaOf(schema, trx)
    const def = s === undefined ? undefined : this.#definition(s.id, name, trx)
    if (def === undefined) throw noSuchTable(schema, name)
    return def
  }

  /** Every table, or every table in one schema, in name order: as last committed, or as `trx` sees them. */
  tables(schema?: string, trx?: Trx): TableDef[] {
    if (schema === undefined) return [...this.#tables.scan(undefined, trx, trx === undefined ? 'consistent' : 'current')].filter(([, r]) => !isView(r)).map(([, r]) => decodeTableDef(r[3] as Uint8Array))
    const s = this.#schemaOf(schema, trx)
    if (s === undefined) throw unknownDb(schema)
    return this.#definitions(s.id, trx)
  }

  // --- views --------------------------------------------------------------------

  /**
   * CREATE VIEW: the definition as one row, checked against the namespace it
   * shares with tables. `orReplace` replaces a view; over a table it is
   * ER_WRONG_OBJECT, as 8.4.11 answers.
   */
  createView(view: ViewDef, options: { readonly orReplace?: boolean } = {}): void {
    checkName(view.name, wrongTableName)
    ddl(this.store, undefined, (trx) => {
      const s = this.#schemaOf(view.schema, trx)
      if (s === undefined) throw unknownDb(view.schema)
      const row = this.#row(s.id, view.name, trx)
      const value: (Uint8Array | null)[] = [be32(s.id), utf8.encode(view.name), be32(VIEW_ID), encodeViewDef(view)]
      if (row === undefined) return void this.#changing().insert(value, trx)
      if (options.orReplace !== true) throw tableExists(view.name)
      if (!isView(row)) throw notAView(view.schema, view.name)
      this.#changing().update(value, trx)
    })
  }

  /**
   * DROP VIEW, all or nothing: a table among the names is ER_WRONG_OBJECT, and
   * the missing ones are one ER_BAD_TABLE_ERROR naming them all — or, with
   * `ifExists`, returned for the caller's notes.
   */
  dropViews(schema: string, names: readonly string[], options: { readonly ifExists?: boolean } = {}): string[] {
    return ddl(this.store, undefined, (trx) => {
      const s = this.#schemaOf(schema, trx)
      const missing: string[] = []
      for (const name of names) {
        const row = s === undefined ? undefined : this.#row(s.id, name, trx)
        if (row === undefined) missing.push(name)
        else if (!isView(row)) throw notAView(schema, name)
      }
      if (missing.length > 0 && options.ifExists !== true) throw unknownTable(missing.map((n) => `${schema}.${n}`).join(','))
      if (s !== undefined) for (const name of names) if (!missing.includes(name)) this.#changing().delete(this.#tableKey(s.id, name), trx)
      return missing
    })
  }

  /** A view's definition, as last committed, or `undefined` when the name is not a view. */
  view(schema: string, name: string): ViewDef | undefined {
    const s = this.#schemaOf(schema, undefined)
    const row = s === undefined ? undefined : this.#row(s.id, name, undefined)
    return row === undefined || !isView(row) ? undefined : decodeViewDef(row[3] as Uint8Array)
  }

  /** Every view in a schema, in name order. */
  views(schema: string): ViewDef[] {
    return this.#views(this.schema(schema).id, undefined)
  }

  /** A handle on a table, through the engine that stores it: as last committed, or as `trx` sees it. */
  table(schema: string, name: string, trx?: Trx): Table {
    const s = this.#schemaOf(schema, trx)
    if (s === undefined) throw noSuchTable(schema, name)
    const key = this.#tableKey(s.id, name)
    const value = this.#tables.tree.get(key)
    const def = this.#definition(s.id, name, trx)
    if (value === undefined || def === undefined) throw noSuchTable(schema, name)
    try {
      return this.#open(def, key, value, schema, name)
    } catch (e) {
      // A definition checked when it was made, whose keys no longer build, was
      // changed since: corruption. A collation not loaded yet is not (D-36).
      if (e instanceof TypeError_) throw corruptCatalog(`table ${schema}.${name}: ${e.message}`)
      throw e
    }
  }

  /** `_myjs_tables`, for a write to it. */
  #changing(): ClusteredIndex {
    this.#generation++
    return this.#tables
  }

  #open(def: TableDef, key: Uint8Array, value: Uint8Array, schema: string, name: string): Table {
    // The last transaction that found the table alive, as of which catalog write
    // and which of its own rollbacks: a bulk write asks once, not once a row.
    let seen: { trx: Trx; generation: number; rollbacks: number } | undefined
    return this.#engine(def).open(def, {
      definedBy: versionOf(value).trxId,
      alive: (trx) => {
        if (trx !== undefined && seen !== undefined && seen.trx === trx && seen.generation === this.#generation && seen.rollbacks === trx.rollbacks) return
        // The id field only: the definition may be off-page, and a write needs none of it.
        const record = this.#tables.read(trx, trx === undefined ? 'consistent' : 'current', (view) => this.#tables.recordAt(key, view))
        const fields = record === undefined ? undefined : decodeRecord(SYSTEM.TABLES.layout, record)
        if (fields === undefined || readBe32(fields[2] as Uint8Array) !== def.id) throw noSuchTable(schema, name)
        if (trx !== undefined) seen = { trx, generation: this.#generation, rollbacks: trx.rollbacks }
      },
    })
  }

  /**
   * What `verifyStore` needs to follow every overflow chain in the store: each
   * clustered tree's layout — the system tables', and every table's whose row
   * is still in `_myjs_tables`, a dropped one awaiting purge included, read
   * from the tree's latest versions rather than through a view.
   */
  verifyOptions(): VerifyOptions {
    const layouts = new Map<number, RecordLayout>()
    for (const k of ['CATALOG', 'SCHEMAS', 'TABLES'] as const) layouts.set(SYSTEM_INDEX[k], SYSTEM[k].layout)
    for (const [, value] of this.#tables.tree.entries()) {
      const record = value.subarray(CLUSTERED_HEADER)
      const row = this.#tables.rowOf(record)
      if (isView(row)) continue
      const def = decodeTableDef(row[3] as Uint8Array)
      if (def.engine !== 'native') continue
      const clustered = def.clustered === null ? def.rowIdIndexId : def.indexes.find((i) => i.name === def.clustered)?.indexId
      if (clustered !== undefined) layouts.set(clustered, layoutOf(def))
    }
    return {
      overflowRefs: (indexId, value) => {
        const layout = layouts.get(indexId)
        return layout === undefined || versionOf(value).marked ? [] : externalRefs(layout, value.subarray(CLUSTERED_HEADER))
      },
    }
  }

  // --- internals ----------------------------------------------------------------

  #engine(def: TableDef): StorageEngine {
    return def.engine === 'memory' ? this.engines.memory : this.engines.native
  }

  /**
   * Retire a table inside `trx`; returns what to do once it commits. The row
   * goes first, so its undo record is older than the one that drops the trees:
   * purge, newest first, drops the trees before it removes the row, and a crash
   * between the two leaves a definition without trees — never trees without
   * the definition that says how to free them.
   */
  #drop(def: TableDef, schemaId: number, trx: Trx): () => void {
    const engine = this.#engine(def)
    this.#changing().delete(this.#tableKey(schemaId, def.name), trx)
    engine.drop(def, trx)
    return () => engine.discard(def)
  }

  #schemaKey(name: string): Uint8Array {
    return this.#schemas.keyOf([utf8.encode(name), null, null])
  }

  #tableKey(schemaId: number, name: string): Uint8Array {
    return this.#tables.keyOf([be32(schemaId), utf8.encode(name), null, null])
  }

  /** Inside DDL, the latest version, the writer's own; outside it, the latest committed. */
  #schemaOf(name: string, trx: Trx | undefined): SchemaDef | undefined {
    if (utf8.encode(name).length > NAME_BYTES) return undefined
    const r = this.#schemas.get(this.#schemaKey(name), trx, trx === undefined ? 'consistent' : 'current')
    return r === undefined ? undefined : schemaDef(r[2])
  }

  /** A table's or a view's row. */
  #row(schemaId: number, name: string, trx: Trx | undefined): (Uint8Array | null)[] | undefined {
    if (utf8.encode(name).length > NAME_BYTES) return undefined
    return this.#tables.get(this.#tableKey(schemaId, name), trx, trx === undefined ? 'consistent' : 'current')
  }

  #definition(schemaId: number, name: string, trx: Trx | undefined): TableDef | undefined {
    const r = this.#row(schemaId, name, trx)
    return r === undefined || isView(r) ? undefined : decodeTableDef(r[3] as Uint8Array)
  }

  #rows(schemaId: number, trx: Trx | undefined): (Uint8Array | null)[][] {
    const from = be32(schemaId)
    const range = { from, to: be32(schemaId + 1) }
    return [...this.#tables.scan(range, trx, trx === undefined ? 'consistent' : 'current')].map(([, r]) => r)
  }

  #definitions(schemaId: number, trx: Trx | undefined): TableDef[] {
    return this.#rows(schemaId, trx)
      .filter((r) => !isView(r))
      .map((r) => decodeTableDef(r[3] as Uint8Array))
  }

  #views(schemaId: number, trx: Trx | undefined): ViewDef[] {
    return this.#rows(schemaId, trx)
      .filter(isView)
      .map((r) => decodeViewDef(r[3] as Uint8Array))
  }

  #version(): number {
    const v = this.#settingOf('version')
    if (v === undefined || !/^[0-9]{1,9}$/.test(v)) throw corruptCatalog(`a catalog version of ${JSON.stringify(v)}`)
    return Number(v)
  }

  #settingOf(key: string): string | undefined {
    const r = this.#catalog.get(this.#catalog.keyOf([utf8.encode(key), null]))
    return r === undefined ? undefined : str(r[1], `setting ${key}`)
  }

  #setting(key: string, value: string, trx: Trx): void {
    const row = [utf8.encode(key), utf8.encode(value)]
    if (this.#catalog.get(this.#catalog.keyOf(row), trx, 'current') === undefined) this.#catalog.insert(row, trx)
    else this.#catalog.update(row, trx)
  }
}

function schemaDef(bytes: Uint8Array | null | undefined): SchemaDef {
  let v: unknown
  try {
    v = JSON.parse(str(bytes, 'a schema definition'))
  } catch (e) {
    throw corruptCatalog(`a schema definition that is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const d = v as Record<string, unknown>
  if (typeof v !== 'object' || v === null || typeof d['name'] !== 'string' || !Number.isSafeInteger(d['id'])) throw corruptCatalog('a schema definition without a name and an id')
  if (d['collationId'] !== undefined && !Number.isSafeInteger(d['collationId'])) throw corruptCatalog('a schema collation that is not a number')
  return v as SchemaDef
}

/**
 * Run `change` as a DDL statement: a transaction of its own, committed, or
 * rolled back if it throws. Inside another transaction's write it is refused,
 * as the writer slot is taken; the executor commits the session's transaction
 * first, as MySQL's implicit commit does.
 */
/**
 * One DDL change in a transaction of its own, or in `within`, the caller's:
 * a session's temporary table is made and dropped in the session's
 * transaction, since the one writer is that transaction's.
 */
function ddl<T>(store: Store, within: Trx | undefined, change: (trx: Trx) => T): T {
  if (within !== undefined) return change(within)
  if (store.transactions.writer !== undefined) throw writerBusy()
  const trx = store.begin('READ COMMITTED')
  let out: T
  try {
    out = change(trx)
  } catch (e) {
    trx.rollback()
    throw e
  }
  trx.commit()
  return out
}
