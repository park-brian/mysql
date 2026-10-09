// RENAME TABLE, as 8.4.11 answered a script of them.
//
//   - The pairs are applied in order, as one change: all of them or none
//     (`RENAME TABLE a TO b, nope TO c` leaves `a`), so a swap through a
//     third name works. The rows stay where they are; only names move.
//   - A table may move to another schema; a view may not (1450). A session's
//     temporary table is not seen (1146). A name in use is 1050, the table's
//     own included; a schema that is not there is 1049, before anything else.
//   - The names MySQL made follow the table's: `t_ibfk_1` and `t_chk_1`
//     become `u_ibfk_1` and `u_chk_1`, a name written in that shape too. A
//     name given otherwise stays. The keys of other tables that name a
//     renamed one name it by its new name.
import type { RenameTableNode } from '@myjs/parser'
import { messages, sqlError, type OkResult } from '@myjs/protocol'
import type { TableDef, Trx } from '@myjs/engine'
import { checksOf } from './checks.ts'
import { foreignKeysOf, type ForeignKeyDef } from './foreign-keys.ts'
import type { CatalogApi } from './temporary.ts'

type Place = { readonly schema: string; readonly name: string }

export function renameTables(catalog: CatalogApi, node: RenameTableNode, database: string | null): OkResult {
  const placeOf = (t: { readonly schema?: string; readonly name: string }): Place => {
    const schema = t.schema ?? database
    if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
    return { schema, name: t.name }
  }
  const pairs = node.pairs.map((p) => ({ from: placeOf(p.from), to: placeOf(p.to) }))
  catalog.ddlTransaction((trx) => {
    for (const { from, to } of pairs) {
      // The schemas first, then whether a view would leave its own (8.4.11).
      catalog.schema(from.schema)
      catalog.schema(to.schema)
      if (from.schema !== to.schema && catalog.view(from.schema, from.name) !== undefined) {
        throw sqlError('ER_FORBID_SCHEMA_CHANGE', `Changing schema from '${from.schema}' to '${to.schema}' is not allowed.`)
      }
      catalog.renameTable(from.schema, from.name, to, { trx, rewrite: (def) => withNamesFollowing(def, from.name, to.name) })
    }
    followReferences(catalog, pairs, trx)
  })
  return { affectedRows: 0 }
}

/** A generated constraint name, in the table's new name: `t_ibfk_2` as `u_ibfk_2`. */
function following(name: string, from: string, to: string, kind: 'ibfk' | 'chk'): string {
  const prefix = `${from}_${kind}_`
  return name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)) ? `${to}_${kind}_${name.slice(prefix.length)}` : name
}

/** The options of a table renamed `from` → `to`: its generated foreign key and CHECK names in its new name. */
function withNamesFollowing(def: TableDef, from: string, to: string): TableDef['options'] {
  const options: Record<string, unknown> = { ...def.options }
  // `def` already carries the new name: a foreign key stored without one is named from the old.
  const fks = foreignKeysOf({ ...def, name: from })
  if (fks.length > 0) options['foreignKeys'] = fks.map((fk) => ({ ...fk, name: following(fk.name, from, to, 'ibfk') }))
  const checks = checksOf(def)
  if (checks.length > 0) options['checks'] = checks.map((c) => ({ ...c, name: following(c.name, from, to, 'chk') }))
  return options
}

/**
 * Every foreign key, the renamed tables' own included, naming its parent by
 * where the pairs took it: each pair in turn, so a parent swapped through a
 * third name is followed to where it ends up.
 */
function followReferences(catalog: CatalogApi, pairs: readonly { readonly from: Place; readonly to: Place }[], trx: Trx): void {
  const moved = (r: ForeignKeyDef['references']): ForeignKeyDef['references'] => {
    let at: Place = { schema: r.schema, name: r.table }
    for (const { from, to } of pairs) if (at.schema === from.schema && at.name === from.name) at = to
    return at.schema === r.schema && at.name === r.table ? r : { ...r, schema: at.schema, table: at.name }
  }
  for (const s of catalog.schemas()) {
    for (const def of catalog.tables(s.name, trx)) {
      const fks = foreignKeysOf(def)
      const next = fks.map((fk) => ({ ...fk, references: moved(fk.references) }))
      if (next.every((fk, i) => fk.references === (fks[i] as ForeignKeyDef).references)) continue
      catalog.setTableOptions(s.name, def.name, { ...def.options, foreignKeys: next }, { trx })
    }
  }
}
