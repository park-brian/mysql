// M5.1 — names, resolved against the tables a statement reads.
//
// The tables of a `FROM` lay their columns side by side in one row, in order,
// and a name resolves to a slot in it. The rules are MySQL's, and each is a
// refusal a real 8.4.11 gives:
//
//   - A bare `c` searches every table; two hits is ER_NON_UNIQ_ERROR (1052) —
//     unless a `USING` or `NATURAL` join merged them into one column, which
//     the bare name then means (the preserved side's: the left one's, or the
//     right one's under a RIGHT JOIN).
//   - `t.c` names the table as the statement calls it — its alias when it has
//     one, which hides its real name: `SELECT t.c FROM t AS q` is 1054.
//   - Column names compare case-insensitively; table names and aliases do
//     not, under `lower_case_table_names = 0`.
//   - A table on the inner side of an outer join can be all NULL, so its
//     columns are reported nullable (8.4.11 drops their NOT_NULL flag).
//
// An `ON` sees only the tables of its own join (`restrict`): in
// `a, b JOIN c ON a.x = c.x` the comma binds last, so `a.x` is 1054 there.
import type { TableDef } from '@myjs/engine'
import { messages, sqlError } from '@myjs/protocol'
import type { Scope } from './compile.ts'
import { columnResultType, type ResultType } from './meta.ts'

export interface ScopeColumn {
  readonly name: string
  readonly type: ResultType
}

export interface ScopeTable {
  /** The name the statement uses for it: its alias, or its own name. */
  readonly alias: string
  /** Its schema; empty for a derived table, which has none. */
  readonly schema: string
  /** A base table's definition; absent for a derived table or a CTE. */
  readonly def?: TableDef
  readonly columns: readonly ScopeColumn[]
  /** Where its first column sits in the row. */
  readonly offset: number
  /** On the inner side of an outer join. */
  readonly nullable: boolean
}

/** A table as a statement names it, before it has a place in the row. */
export interface ScopeTableSpec {
  readonly alias: string
  readonly def?: TableDef
  readonly schema?: string
  /** A derived table's columns; a base table's come from `def`. */
  readonly columns?: readonly ScopeColumn[]
  readonly nullable?: boolean
}

export class TableScope implements Scope {
  readonly tables: readonly ScopeTable[]
  /** Slots a USING or NATURAL join merged, each group's first the one a bare name means. */
  readonly #coalesced: readonly (readonly number[])[]
  /** `*`'s columns, in order, where a join changed it from table order. */
  readonly #visible: readonly number[] | undefined
  readonly #parent: Scope | undefined

  constructor(specs: readonly ScopeTableSpec[], options: { readonly coalesced?: readonly (readonly number[])[]; readonly visible?: readonly number[]; readonly parent?: Scope } = {}) {
    let offset = 0
    const out: ScopeTable[] = []
    const seen = new Set<string>()
    for (const spec of specs) {
      if (seen.has(spec.alias)) throw sqlError('ER_NONUNIQ_TABLE', messages.nonUniqueTable(spec.alias))
      seen.add(spec.alias)
      const nullable = spec.nullable === true
      const def = spec.def
      const base = spec.columns ?? (def === undefined ? [] : def.columns.map((c) => ({ name: c.name, type: columnResultType(def, c, spec.alias) })))
      const columns = nullable ? base.map((c) => ({ name: c.name, type: { ...c.type, nullable: true } })) : base
      out.push({ alias: spec.alias, schema: spec.schema ?? def?.schema ?? '', ...(def === undefined ? {} : { def }), columns, offset, nullable })
      offset += columns.length
    }
    this.tables = out
    this.#coalesced = options.coalesced ?? []
    this.#visible = options.visible
    this.#parent = options.parent
  }

  /** The same row with only some of its tables visible — what an ON clause sees. */
  restrict(aliases: ReadonlySet<string>, coalesced: readonly (readonly number[])[] = []): Scope {
    const tables = this.tables.filter((t) => aliases.has(t.alias))
    const groups = coalesced
    // An enclosing query's columns stay visible: a correlated ON is legal.
    const parent = this.#parent
    return {
      resolve: (parts, clause) => resolveIn(tables, groups, parts, clause, parent),
    }
  }

  /** How many values a row of this scope holds. */
  get width(): number {
    return this.tables.reduce((n, t) => n + t.columns.length, 0)
  }

  resolve(parts: readonly string[], clause: string): { readonly index: number; readonly type: ResultType; readonly depth?: number } {
    return resolveIn(this.tables, this.#coalesced, parts, clause, this.#parent)
  }

  /** The slots `*` or `t.*` expands to, in order. ER_BAD_TABLE_ERROR for a `t.*` naming no table. */
  star(table: string | undefined): { readonly index: number; readonly name: string; readonly type: ResultType }[] {
    const at = (index: number): { index: number; name: string; type: ResultType } => {
      const t = this.tables.find((x) => index >= x.offset && index < x.offset + x.columns.length) as ScopeTable
      const c = t.columns[index - t.offset] as ScopeColumn
      return { index, name: c.name, type: c.type }
    }
    if (table === undefined && this.#visible !== undefined) return this.#visible.map(at)
    const out: { index: number; name: string; type: ResultType }[] = []
    let matched = false
    for (const t of this.tables) {
      if (table !== undefined && t.alias !== table) continue
      matched = true
      t.columns.forEach((c, i) => out.push({ index: t.offset + i, name: c.name, type: c.type }))
    }
    if (table !== undefined && !matched) throw sqlError('ER_BAD_TABLE_ERROR', `Unknown table '${table}'`)
    return out
  }

  /** The table a slot belongs to, and its column there. */
  columnAt(index: number): { readonly table: ScopeTable; readonly column: ScopeColumn } | undefined {
    const table = this.tables.find((x) => index >= x.offset && index < x.offset + x.columns.length)
    return table === undefined ? undefined : { table, column: table.columns[index - table.offset] as ScopeColumn }
  }
}

function resolveIn(
  tables: readonly ScopeTable[],
  coalesced: readonly (readonly number[])[],
  parts: readonly string[],
  clause: string,
  parent: Scope | undefined,
): { readonly index: number; readonly type: ResultType; readonly depth?: number } {
  const column = (parts[parts.length - 1] as string).toLowerCase()
  const tableName = parts.length >= 2 ? parts[parts.length - 2] : undefined
  const schemaName = parts.length === 3 ? parts[0] : undefined
  const found: { index: number; type: ResultType }[] = []
  for (const t of tables) {
    if (tableName !== undefined && t.alias !== tableName) continue
    // `db.t.c` names a table by its schema too, and an aliased table has none.
    if (schemaName !== undefined && (t.schema !== schemaName || t.def === undefined || t.alias !== t.def.name)) continue
    const i = t.columns.findIndex((c) => c.name.toLowerCase() === column)
    if (i < 0) continue
    found.push({ index: t.offset + i, type: (t.columns[i] as ScopeColumn).type })
  }
  if (found.length > 1) {
    // One merged column of a USING or NATURAL join, reached through each side.
    const group = coalesced.find((g) => found.every((f) => g.includes(f.index)))
    if (group === undefined) throw sqlError('ER_NON_UNIQ_ERROR', messages.ambiguousColumn(parts.join('.'), clause))
    const first = group[0] as number
    return found.find((f) => f.index === first) ?? (found[0] as { index: number; type: ResultType })
  }
  const hit = found[0]
  if (hit !== undefined) return hit
  if (parent !== undefined) return parent.resolve(parts, clause)
  throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(parts.join('.'), clause))
}
