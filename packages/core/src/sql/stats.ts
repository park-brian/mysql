// M5.45 — a table's statistics, as InnoDB's persistent statistics give them
// to the optimizer (D-83).
//
// Two figures matter to the cost model (M5.7), and they live differently:
//
//   - The row count is live: InnoDB's `stat_n_rows`, which every insert and
//     delete moves (the optimizer reads 0 as 1).
//   - Rows per key value — `n_rows / n_diff` for each prefix of each index,
//     never below 1 — is what statistics were last computed. A table under
//     `STATS_AUTO_RECALC=0` keeps what ANALYZE TABLE computed, or 1 if it was
//     never analysed (it was empty when first opened). Any other table is
//     recomputed in the background once a tenth of its rows have changed;
//     here, when the row count has moved by a tenth, which is the state the
//     server settles to.
//
// `n_diff` counts each prefix's distinct values, NULLs as one value (InnoDB's
// `nulls_equal`). A non-unique index's prefixes run on through the clustered
// key it carries (`n_diff_pfx02` of KEY(g) is (g, id)); a unique one's stop
// at its own columns. 8.4.11's `innodb_index_stats` after ANALYZE, probed.
import type { IndexDef, Store, Table, TableDef, TableStats } from '@myjs/engine'
import { clusteredKeyOf, keyColumnsOf } from '@myjs/engine'
import { encodeKey } from '@myjs/types'

/** What ANALYZE computes and a `STATS_AUTO_RECALC=0` table keeps: the row count then, and each index's `n_diff` by prefix. */
export interface IndexStatistics {
  readonly rows: number
  readonly keys: Readonly<Record<string, readonly number[]>>
}

/** The figures the optimizer reads of a table. */
export interface TableStatistics {
  /** Live rows, as `stats.records`: at least 1. */
  readonly rows: number
  /** Pages of the clustered index: what a table scan reads. */
  readonly pages: number
  /** Rows per value of the first `parts` columns of an index, at least 1. */
  recordsPerKey(index: IndexDef, parts: number): number
}

/** Each index's `n_diff` by prefix, counted over the table's rows (ANALYZE TABLE). */
export function analyze(def: TableDef, table: Table): IndexStatistics {
  const rows = [...table.scan()].map(([, row]) => row)
  const clustered = clusteredKeyOf(def)
  const keys: Record<string, number[]> = {}
  for (const index of def.indexes) {
    const own = keyColumnsOf(def, index)
    // A non-unique index's key goes on through the clustered key it carries; a hidden row id makes every row distinct.
    const suffix = index.kind === 'index' ? clustered.filter((c) => !own.some((o) => o.field === c.field)) : []
    const columns = [...own, ...suffix]
    keys[index.name] = columns.map((_, k) => {
      if (columns[k]?.field === def.columns.length) return rows.length
      const prefix = columns.slice(0, k + 1)
      const parts = prefix.map((c) => c.part)
      const seen = new Set<string>()
      for (const row of rows) seen.add(String.fromCharCode(...encodeKey(prefix.map((c) => row[c.field] ?? null), parts)))
      return seen.size
    })
  }
  return { rows: rows.length, keys }
}

/** The statistics a table's definition keeps from its last ANALYZE, if any. */
const stored = (def: TableDef): IndexStatistics | undefined => def.options['stats'] as IndexStatistics | undefined

/** Per database (its catalog's store), by table id: figures and the stored statistics they were taken after. */
type Cache<T> = WeakMap<object, Map<number, { readonly after: IndexStatistics | undefined; value: T }>>

/**
 * The entry for a table, made afresh when an ANALYZE has stored new
 * statistics since — and, unless `onlyAnalyze`, when a TRUNCATE or an ALTER
 * has dropped them.
 */
function cached<T>(cache: Cache<T>, owner: Store, def: TableDef, make: () => T, onlyAnalyze = false): { readonly after: IndexStatistics | undefined; value: T } {
  let tables = cache.get(owner)
  if (tables === undefined) cache.set(owner, (tables = new Map()))
  let entry = tables.get(def.id)
  const now = stored(def)
  if (entry === undefined || (entry.after !== now && (now !== undefined || !onlyAnalyze))) tables.set(def.id, (entry = { after: now, value: make() }))
  return entry
}

const recalculated: Cache<IndexStatistics> = new WeakMap()

/** A table's live figures by the store's log position they were counted at: counting walks every page, and a plan asks for each table. */
const counted = new WeakMap<Store, Map<number, { readonly lsn: number; readonly stats: TableStats }>>()

function liveStats(def: TableDef, table: Table, store: Store): TableStats {
  let tables = counted.get(store)
  if (tables === undefined) counted.set(store, (tables = new Map()))
  const lsn = store.lsn
  const seen = tables.get(def.id)
  if (seen !== undefined && seen.lsn === lsn) return seen.stats
  const stats = table.stats()
  tables.set(def.id, { lsn, stats })
  return stats
}

/**
 * The figures statistics hold for `table` now: what ANALYZE stored, for a
 * `STATS_AUTO_RECALC=0` table (none before it); otherwise recomputed once a
 * tenth of the rows have changed since they were last. `owner` scopes the
 * figures to one database, so two databases with one table id never share them.
 */
function figuresOf(def: TableDef, table: Table, owner: Store, live: number): IndexStatistics | undefined {
  if (def.options['statsAutoRecalc'] === false) return stored(def)
  const entry = cached(recalculated, owner, def, () => stored(def) ?? analyze(def, table))
  if (Math.abs(live - entry.value.rows) > entry.value.rows / 10) entry.value = analyze(def, table)
  return entry.value
}

/** The statistics the optimizer reads of `table` now. */
export function statisticsOf(def: TableDef, table: Table, owner: Store): TableStatistics {
  const { rows: live, dataLength } = liveStats(def, table, owner)
  const figures = figuresOf(def, table, owner, live)
  return {
    rows: Math.max(1, live),
    pages: Math.max(1, Math.ceil(dataLength / 16384)),
    recordsPerKey(index, parts) {
      const nDiff = figures?.keys[index.name]?.[parts - 1]
      if (figures === undefined || figures.rows === 0) return 1
      if (nDiff === undefined || nDiff === 0) return figures.rows
      // A float in InnoDB (`rec_per_key_t`): 4 rows over 3 values is 1.3333334, and ties turn on it.
      return Math.max(1, Math.fround(figures.rows / nDiff))
    },
  }
}

const shown: Cache<ReadonlyMap<string, readonly number[]>> = new WeakMap()

/** TRUNCATE TABLE makes the table again under a new id; the server's cache of what SHOW INDEX shows, kept by name, outlives it. */
export function keepShown(owner: Store, from: number, to: number): void {
  const tables = shown.get(owner)
  const entry = tables?.get(from)
  if (tables !== undefined && entry !== undefined) tables.set(to, entry)
}

/**
 * Each index's CARDINALITY by part, as SHOW INDEX and `STATISTICS` show it:
 * the live row count over rows per key (a never-computed `n_diff` makes that
 * every row, so 1), rounded — and kept, as the server keeps it in its
 * statistics cache (`information_schema_stats_expiry`), from the first time
 * it is read, or from the last ANALYZE TABLE, which writes it. 8.4.11, probed: a table grown,
 * or truncated, after its first SHOW INDEX shows what it showed. A FULLTEXT key's columns
 * are each the row count. `fulltext` names those keys' columns.
 */
export function cardinalities(def: TableDef, table: Table, owner: Store, fulltext: readonly { readonly name: string; readonly columns: readonly string[] }[]): ReadonlyMap<string, readonly number[]> {
  return cached(shown, owner, def, () => {
    // ANALYZE writes the cache as it stores its figures; a table never analysed is read as it is now.
    const analysed = stored(def)
    const live = analysed?.rows ?? liveStats(def, table, owner).rows
    const figures = analysed ?? figuresOf(def, table, owner, live)
    const out = new Map<string, readonly number[]>()
    for (const index of def.indexes) {
      out.set(
        index.name,
        index.parts.map((_, i) => {
          if (live === 0) return 0
          const nDiff = figures?.keys[index.name]?.[i] ?? 0
          const perKey = nDiff === 0 ? live : Math.max(1, Math.fround(live / nDiff))
          return Math.round(live / perKey)
        }),
      )
    }
    for (const index of fulltext) out.set(index.name, index.columns.map(() => live))
    return out
  }, true).value
}
