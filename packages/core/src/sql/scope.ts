// M5.1 — names, resolved against the tables a statement reads.
//
// The tables of a `FROM` lay their columns side by side in one row, in order,
// and a name resolves to a slot in it. The rules are MySQL's, and each is a
// refusal a real 8.4.11 gives:
//
//   - A bare `c` searches every table; two hits is ER_NON_UNIQ_ERROR (1052).
//   - `t.c` names the table as the statement calls it — its alias when it has
//     one, which hides the real name: `SELECT t.c FROM t AS q` is 1054.
//   - Column names compare case-insensitively; table names and aliases do
//     not, under `lower_case_table_names = 0`.
//
// Written for one table today and shaped for several: joins (M5.4) add tables
// to the list, and nothing that resolves through a `Scope` changes.
import type { TableDef } from '@myjs/engine'
import { messages, sqlError } from '@myjs/protocol'
import type { Scope } from './compile.ts'
import { columnResultType, type ResultType } from './meta.ts'

export interface ScopeTable {
  /** The name the statement uses for it: its alias, or its own name. */
  readonly alias: string
  readonly schema: string
  readonly def: TableDef
  /** Where its first column sits in the row. */
  readonly offset: number
  readonly types: readonly ResultType[]
}

export class TableScope implements Scope {
  readonly tables: readonly ScopeTable[]

  constructor(tables: readonly { readonly alias: string; readonly def: TableDef }[]) {
    let offset = 0
    const out: ScopeTable[] = []
    const seen = new Set<string>()
    for (const { alias, def } of tables) {
      if (seen.has(alias)) throw sqlError('ER_NONUNIQ_TABLE', messages.nonUniqueTable(alias))
      seen.add(alias)
      out.push({ alias, schema: def.schema, def, offset, types: def.columns.map((c) => columnResultType(def, c, alias)) })
      offset += def.columns.length
    }
    this.tables = out
  }

  /** How many values a row of this scope holds. */
  get width(): number {
    return this.tables.reduce((n, t) => n + t.def.columns.length, 0)
  }

  resolve(parts: readonly string[], clause: string): { readonly index: number; readonly type: ResultType } {
    const column = (parts[parts.length - 1] as string).toLowerCase()
    const tableName = parts.length >= 2 ? parts[parts.length - 2] : undefined
    const schemaName = parts.length === 3 ? parts[0] : undefined
    let found: { index: number; type: ResultType } | undefined
    for (const t of this.tables) {
      if (tableName !== undefined && t.alias !== tableName) continue
      // `db.t.c` names a table by its schema too, and an aliased table has none.
      if (schemaName !== undefined && (t.schema !== schemaName || t.alias !== t.def.name)) continue
      const i = t.def.columns.findIndex((c) => c.name.toLowerCase() === column)
      if (i < 0) continue
      if (found !== undefined) throw sqlError('ER_NON_UNIQ_ERROR', messages.ambiguousColumn(parts.join('.'), clause))
      found = { index: t.offset + i, type: t.types[i] as ResultType }
    }
    if (found === undefined) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(parts.join('.'), clause))
    return found
  }

  /** The slots `*` or `t.*` expands to, in order. ER_BAD_TABLE_ERROR for a `t.*` naming no table. */
  star(table: string | undefined): { readonly index: number; readonly name: string; readonly type: ResultType }[] {
    const out: { index: number; name: string; type: ResultType }[] = []
    let matched = false
    for (const t of this.tables) {
      if (table !== undefined && t.alias !== table) continue
      matched = true
      t.def.columns.forEach((c, i) => out.push({ index: t.offset + i, name: c.name, type: t.types[i] as ResultType }))
    }
    if (table !== undefined && !matched) throw sqlError('ER_BAD_TABLE_ERROR', `Unknown table '${table}'`)
    return out
  }
}
