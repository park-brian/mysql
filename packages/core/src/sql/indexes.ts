import type { IndexDef, TableDef } from '@myjs/engine'

/** The index a table's rows are stored in: its PRIMARY KEY, or the unique key InnoDB chose in its place; none for a hidden row id. */
export function clusteredIndex(def: TableDef): IndexDef | undefined {
  return def.indexes.find((i) => i.kind === 'primary' || i.name === def.clustered)
}

/** The schema key parts, with PRIMARY parts appended only for columns absent from a secondary key. */
export function indexParts(def: TableDef, index: IndexDef): IndexDef['parts'] {
  const clustered = clusteredIndex(def)
  const parts = index.parts
  if (clustered === undefined || index === clustered) return parts
  return [...parts, ...clustered.parts.filter((p) => !parts.some((q) => q.column.toLowerCase() === p.column.toLowerCase()))]
}

