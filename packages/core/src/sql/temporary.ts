// CREATE TEMPORARY TABLE: a table one session sees, and only until it ends.
//
// Its rows live in the same store as every other table's, so a transaction
// covers them and ROLLBACK undoes them; its definition lives in a schema of
// its own, `#tmp#<session>#<n>`, which nothing lists. Each session reads the
// catalog through a facade (`sessionCatalog`) that sends a name to the
// session's temporary table first, as MySQL's lookup does, and otherwise to
// the table that everyone sees. What 8.4.11 answered:
//
//   - A temporary table hides a table of the same name, for its session only.
//     SHOW TABLES and INFORMATION_SCHEMA do not list it; SHOW CREATE TABLE
//     says CREATE TEMPORARY TABLE.
//   - CREATE and DROP TEMPORARY TABLE do not commit, and ROLLBACK, to a
//     savepoint or whole, does not undo them: a creation it cannot take back
//     is 1751 and the table stays, empty; a drop is 1752 and it stays gone.
//     Here they are made in the session's transaction, which holds the one
//     writer, and `reconcile` puts back after a rollback what it took.
//   - DROP TABLE drops the temporary table before the one beneath it; DROP
//     TEMPORARY TABLE drops nothing else (1051). ALTER TABLE, TRUNCATE and
//     ALTER … RENAME act on it; RENAME TABLE acts on the table everyone sees.
//   - One statement may name it once: a second reference, in a join or a
//     subquery, is 1137 (`Can't reopen table`).
//   - A view may not read it (1352), it may have no FULLTEXT key (1796), and
//     no foreign key may name it or be its own (1215).
import type { Catalog, SchemaDef, Table, TableDef, TableSpec, Trx } from '@myjs/engine'
import { messages, sqlError } from '@myjs/protocol'

/** What the executor uses of a catalog: the engine's, or a session's view of it. */
export type CatalogApi = Pick<
  Catalog,
  | 'store'
  | 'schema'
  | 'schemas'
  | 'createSchema'
  | 'dropSchema'
  | 'createTable'
  | 'dropTable'
  | 'truncateTable'
  | 'rebuildTable'
  | 'definition'
  | 'tables'
  | 'createView'
  | 'dropViews'
  | 'view'
  | 'views'
  | 'table'
  | 'ddlTransaction'
  | 'renameTable'
  | 'setTableOptions'
> & {
  /** The session's temporary tables, when this is a session's view. */
  readonly temporary?: TemporaryTables
}

const HIDDEN = '#tmp#'

/** A schema that holds temporary tables, which no listing shows. */
export const isHiddenSchema = (name: string): boolean => name.startsWith(HIDDEN)

/** A definition read through `sessionCatalog` that is a temporary table's. */
const temporaryDefs = new WeakSet<TableDef>()
export const isTemporary = (def: TableDef): boolean => temporaryDefs.has(def)

/** The temporary tables of one session: for each schema it names, the schema that holds them. */
export class TemporaryTables {
  readonly #base: Catalog
  readonly #id: number
  /** The session's transaction, when one is open: what its temporary DDL and lookups go through. */
  readonly #trx: () => Trx | undefined
  readonly #hidden = new Map<string, string>()
  readonly #names = new Map<string, Set<string>>()
  /** Each table's definition as created, to make it again when a rollback takes it. */
  readonly #specs = new Map<string, TableSpec>()
  /** Tables dropped while a transaction was open, which a rollback would bring back. */
  readonly #dropped = new Map<string, { readonly hidden: string; readonly name: string; readonly trx: Trx }>()
  readonly #defs = new WeakMap<TableDef, TableDef>()
  /** The transactions that made, and dropped, a temporary table: what their rollback warns of. */
  #made: Trx | undefined
  #gone: Trx | undefined

  constructor(base: Catalog, id: number, trx: () => Trx | undefined) {
    this.#base = base
    this.#id = id
    this.#trx = trx
  }

  has(schema: string, name: string): boolean {
    return this.#names.get(schema)?.has(name) === true
  }

  /** The schema holding `schema`'s temporary tables, made when first asked for. */
  #holder(schema: string): string {
    let hidden = this.#hidden.get(schema)
    if (hidden === undefined) {
      hidden = `${HIDDEN}${this.#id}#${this.#hidden.size}`
      this.#hidden.set(schema, hidden)
    }
    return hidden
  }

  create(schema: string, spec: TableSpec): TableDef {
    this.#base.schema(schema)
    if (this.has(schema, spec.name)) throw sqlError('ER_TABLE_EXISTS_ERROR', `Table '${spec.name}' already exists`)
    const hidden = this.#holder(schema)
    const trx = this.#trx()
    this.#base.createSchema(hidden, { ifNotExists: true, ...(trx === undefined ? {} : { trx }) })
    const def = this.#base.createTable(hidden, spec, trx === undefined ? {} : { trx })
    let names = this.#names.get(schema)
    if (names === undefined) this.#names.set(schema, (names = new Set()))
    names.add(spec.name)
    this.#specs.set(`${hidden}\0${spec.name}`, spec)
    this.#dropped.delete(`${hidden}\0${spec.name}`)
    if (trx !== undefined) this.#made = trx
    return this.#as(def, schema)
  }

  drop(schema: string, name: string): boolean {
    if (!this.has(schema, name)) return false
    const hidden = this.#holder(schema)
    const trx = this.#trx()
    this.#base.dropTable(hidden, name, trx === undefined ? {} : { trx })
    this.#names.get(schema)?.delete(name)
    this.#specs.delete(`${hidden}\0${name}`)
    if (trx !== undefined) {
      this.#dropped.set(`${hidden}\0${name}`, { hidden, name, trx })
      this.#gone = trx
    }
    return true
  }

  definition(schema: string, name: string): TableDef {
    return this.#as(this.#base.definition(this.#holder(schema), name, this.#trx()), schema)
  }

  table(schema: string, name: string): Table {
    const table = this.#base.table(this.#holder(schema), name, this.#trx())
    const def = this.#as(table.def, schema)
    // The engine's table, with the definition the session sees: a Proxy, so
    // its methods keep their own `this`.
    return new Proxy(table, {
      get: (t, key) => {
        if (key === 'def') return def
        const v = Reflect.get(t, key, t) as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
      },
    })
  }

  truncate(schema: string, name: string): TableDef {
    return this.#as(this.#base.truncateTable(this.#holder(schema), name), schema)
  }

  rebuild(schema: string, name: string, spec: TableSpec, copy: Parameters<Catalog['rebuildTable']>[3]): TableDef {
    if (spec.name !== name && this.has(schema, spec.name)) throw sqlError('ER_TABLE_EXISTS_ERROR', `Table '${spec.name}' already exists`)
    const hidden = this.#holder(schema)
    const def = this.#base.rebuildTable(hidden, name, spec, copy)
    const names = this.#names.get(schema) as Set<string>
    names.delete(name)
    names.add(def.name)
    this.#specs.delete(`${hidden}\0${name}`)
    this.#specs.set(`${hidden}\0${def.name}`, { name: def.name, engine: def.engine, columns: def.columns, indexes: def.indexes.map(({ indexId: _id, ...i }) => i), options: def.options })
    return this.#as(def, schema)
  }

  /**
   * After a rollback, to a savepoint or whole: the tables the session has are
   * made again, empty, where it took their creation, and the ones it dropped
   * are dropped again where it brought them back. What it warns of is what
   * the transaction did, made or dropped, as the server's flags record it
   * (8.4.11: a table made and dropped in one transaction draws both).
   */
  reconcile(rolledBack: Trx | undefined): { readonly made: boolean; readonly dropped: boolean } {
    const trx = this.#trx()
    const within = trx === undefined ? {} : { trx }
    for (const [key, spec] of this.#specs) {
      const hidden = key.slice(0, key.indexOf('\0'))
      try {
        this.#base.definition(hidden, spec.name, trx)
      } catch {
        this.#base.createSchema(hidden, { ifNotExists: true, ...within })
        this.#base.createTable(hidden, spec, within)
      }
    }
    for (const [key, d] of this.#dropped) if (d.trx === rolledBack && !this.#specs.has(key)) this.#base.dropTable(d.hidden, d.name, { ifExists: true, ...within })
    const out = { made: rolledBack !== undefined && this.#made === rolledBack, dropped: rolledBack !== undefined && this.#gone === rolledBack }
    if (trx === undefined) this.committed()
    return out
  }

  /** The transaction is over: what it dropped stays dropped, and there is nothing to warn of. */
  committed(): void {
    this.#dropped.clear()
    this.#made = undefined
    this.#gone = undefined
  }

  /** Every temporary table gone, as when the session ends. */
  dropAll(): void {
    for (const hidden of this.#hidden.values()) this.#base.dropSchema(hidden, { ifExists: true })
    this.#hidden.clear()
    this.#names.clear()
    this.#specs.clear()
    this.#dropped.clear()
  }

  /** The definition as the session sees it: in the schema it was created in. */
  #as(def: TableDef, schema: string): TableDef {
    let seen = this.#defs.get(def)
    if (seen === undefined) {
      seen = { ...def, schema }
      temporaryDefs.add(seen)
      this.#defs.set(def, seen)
    }
    return seen
  }
}

/** The catalog as one session sees it: its temporary tables first. */
export function sessionCatalog(base: Catalog, temporary: TemporaryTables): CatalogApi {
  // A schema that holds temporary tables is no schema to a statement that names it (8.4.11: 1049).
  const named = (schema: string): string => {
    if (isHiddenSchema(schema)) throw sqlError('ER_BAD_DB_ERROR', messages.unknownDatabase(schema))
    return schema
  }
  return {
    temporary,
    store: base.store,
    schema: (name) => base.schema(named(name)),
    schemas: () => base.schemas().filter((s: SchemaDef) => !isHiddenSchema(s.name)),
    createSchema: (name, options) => base.createSchema(name, options),
    dropSchema: (name, options) => base.dropSchema(name, options),
    createTable: (schema, spec, options) => base.createTable(schema, spec, options),
    dropTable: (schema, name, options) => {
      if (temporary.drop(schema, name)) return true
      if (isHiddenSchema(schema) && options?.ifExists === true) return false
      return base.dropTable(named(schema), name, options)
    },
    truncateTable: (schema, name) => (temporary.has(schema, name) ? temporary.truncate(schema, name) : base.truncateTable(schema, name)),
    rebuildTable: (schema, name, spec, copy) => (temporary.has(schema, name) ? temporary.rebuild(schema, name, spec, copy) : base.rebuildTable(schema, name, spec, copy)),
    definition: (schema, name) => (temporary.has(schema, name) ? temporary.definition(schema, name) : base.definition(named(schema), name)),
    tables: (schema, trx) => base.tables(schema, trx).filter((t) => !isHiddenSchema(t.schema)),
    createView: (view, options) => base.createView(view, options),
    dropViews: (schema, names, options) => base.dropViews(schema, names, options),
    view: (schema, name) => base.view(schema, name),
    views: (schema) => base.views(schema),
    table: (schema, name) => (temporary.has(schema, name) ? temporary.table(schema, name) : base.table(named(schema), name)),
    // RENAME TABLE acts on the tables everyone sees, never a session's own (8.4.11: 1146).
    ddlTransaction: (change) => base.ddlTransaction(change),
    renameTable: (schema, name, to, options) => base.renameTable(named(schema), name, { ...to, schema: named(to.schema) }, options),
    setTableOptions: (schema, name, tableOptions, options) => base.setTableOptions(named(schema), name, tableOptions, options),
  }
}

/** Temporary tables left by a process that ended without dropping them: gone at open. */
export function dropOrphans(base: Catalog): void {
  for (const s of base.schemas()) if (isHiddenSchema(s.name)) base.dropSchema(s.name, { ifExists: true })
}
