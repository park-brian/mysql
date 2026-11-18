import type { ColumnDef, IndexDef, IndexPartDef, TableDef } from '@myjs/engine'

/** The index a table's rows are stored in: its PRIMARY KEY, or the unique key InnoDB chose in its place; none for a hidden row id. */
export function clusteredIndex(def: TableDef): IndexDef | undefined {
  return def.indexes.find((i) => i.kind === 'primary' || i.name === def.clustered)
}

/** The schema key parts, plus any named clustered columns absent from a secondary key. */
export function indexParts(index: IndexDef, clustered: IndexDef | undefined): IndexDef['parts'] {
  const parts = index.parts
  if (!clustered || index === clustered) return parts
  return [...parts, ...clustered.parts.filter((p) => parts.every((q) => q.column.toLowerCase() !== p.column.toLowerCase()))]
}

/** Whether this part stores a complete column with the given folded name. */
export function indexPartMatchesColumn(part: IndexDef['parts'][number] | undefined, name: string): part is IndexDef['parts'][number] {
  return part?.column.toLowerCase() === name && part.prefix === undefined
}

/** The visible, complete leading key part. A single-column equality can also use DESC. */
export function forwardKeyPart(index: IndexDef, singlePoint = false): IndexPartDef | undefined {
  const part = index.parts[0]
  if (!part || index.invisible || part.prefix !== undefined) return undefined
  return !part.descending || (singlePoint && index.parts.length === 1) ? part : undefined
}

/** The canonical column that part reads. */
export function forwardKeyColumn(def: TableDef, index: IndexDef): ColumnDef | undefined {
  const part = forwardKeyPart(index)
  return part && def.columns.find((c) => c.name === part.column)
}

/** A one-part ascending nonunique ref access. Callers prove column coverage. */
export function singleRefIndex(index: IndexDef | undefined): index is IndexDef {
  return index?.kind === 'index' && index.parts.length === 1 && index.parts[0]?.descending !== true
}

/** Whether a complete point is unique. A nullable UNIQUE key can match multiple NULL rows. */
export function uniquePoint(index: IndexDef, matchesNull: boolean): boolean {
  return index.parts.length === 1 && (index.kind === 'primary' || (index.kind === 'unique' && !matchesNull))
}

/** The first visible index leading on the canonical column. */
export function leadingIndex(def: TableDef | undefined, column: ColumnDef | undefined, complete: boolean): IndexDef | undefined {
  if (column === undefined) return undefined
  return def?.indexes.find((i) => i.invisible !== true && i.parts[0]?.column === column.name && (!complete || i.parts[0].prefix === undefined))
}

