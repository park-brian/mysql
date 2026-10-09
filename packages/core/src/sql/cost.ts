// M5.7 — what reading a table costs, as 8.4.11's classic optimizer reckons
// it (D-84), for the choices that decide a plan's rows and their order: an
// index lookup or a hash join, and later the join order.
//
// The constants are the server's defaults (`mysql.server_cost` and
// `mysql.engine_cost`, read from 8.4.11): evaluating a row costs 0.1 and
// reading a page from memory 0.25. A small table is wholly in the buffer
// pool, so every page read is a memory read. The rules are the classic
// optimizer's (`best_access_path`), read from `sql_planner.cc` and
// reimplemented here, and checked against its optimizer trace:
//
//   - A join is planned table by table, in join order. Each table's
//     *position* records the rows it fetches for each row before it, the
//     fraction of those the conditions then keep (its filter), and the tables
//     its index lookup reads its key from.
//   - A unique key looked up is read once for each distinct row of the tables
//     its key comes from (`prev_record_reads`), not once for each row of the
//     whole prefix; any other lookup is read once for each prefix row, and
//     costs a page for each row it finds, capped at `worst_seeks`, or the
//     index's own pages when the index covers the query.
//   - A table read whole for a hash join is read once for each join
//     buffer's worth of the prefix, the rows its own conditions discard
//     evaluated each time.
//   - The lookup wins outright when it finds fewer rows than the table holds
//     at no more than one scan's cost, or when some index covers what the
//     query reads of the table; otherwise the scan wins only when it is
//     strictly cheaper.
import type { TableStatistics } from './stats.ts'

/** `row_evaluate_cost`. */
export const ROW_EVALUATE = 0.1
/** `memory_block_read_cost`: a page of a table in the buffer pool. */
export const PAGE_READ = 0.25
/** `join_buffer_size`'s default, in bytes. */
const JOIN_BUFFER = 262_144
/** InnoDB's page size, half of which an index's records are reckoned to fill. */
const PAGE_BYTES = 16_384

/** One table in a join order: what it gives each row of the tables before it. */
export interface Position {
  readonly alias: string
  /** Rows fetched for each row before it (`rows_fetched`). */
  readonly fetched: number
  /** The fraction of them its conditions keep (`filter_effect`). */
  readonly filter: number
  /** The earlier tables its index lookup takes its key from; empty for a scan. */
  readonly keyFrom: ReadonlySet<string>
}

/** The rows a join prefix gives: each position's kept rows, multiplied. */
export const prefixRows = (prefix: readonly Position[]): number => prefix.reduce((n, p) => n * p.fetched * p.filter, 1)

/**
 * The distinct rows of the tables a key is read from (`prev_record_reads`):
 * the product of those positions' rows, and of the ones they in turn read
 * their keys from; any other position counts only where it keeps less than
 * a row for each row before it.
 */
export function distinctRows(prefix: readonly Position[], keyFrom: ReadonlySet<string>): number {
  const from = new Set(keyFrom)
  let found = 1
  for (let i = prefix.length - 1; i >= 0; i--) {
    const p = prefix[i] as Position
    const fanout = p.fetched * p.filter
    if (from.has(p.alias)) {
      for (const a of p.keyFrom) from.add(a)
      if (p.fetched > Number.EPSILON) found *= fanout
    } else if (fanout < 1) found *= fanout
  }
  return found
}

/** An index lookup a table could be read by. */
export interface KeyChoice {
  /** `eq_ref` (one row at most), the clustered key read by a prefix of it, or any other index. */
  readonly kind: 'unique' | 'clustered' | 'ref'
  /** Rows found for each value looked up. */
  readonly fanout: number
  /** Whether the index holds every column the query reads of the table. */
  readonly covering: boolean
  /** An index record's bytes: its key and the clustered key it carries. */
  readonly recordBytes: number
  /** The earlier tables the key's value is read from. */
  readonly keyFrom: ReadonlySet<string>
}

/** What the cost model knows of a table, beyond its statistics. */
export interface TableFacts {
  readonly stats: TableStatistics
  /** Whether any index holds every column the query reads of it. */
  readonly coveredByAnyIndex: boolean
  /** The fraction of its rows its conditions on constants keep. */
  readonly constantFilter: number
}

/** A table scan: each of its clustered index's pages. */
export const scanCost = (t: TableStatistics): number => PAGE_READ * t.pages

/** The most one lookup is costed at (`worst_seeks`): three scans' worth, never below two pages, nor below a tenth of the rows' pages. */
const worstSeeks = (t: TableStatistics): number => Math.max(Math.min(PAGE_READ * (t.rows / 10), 3 * scanCost(t)), PAGE_READ * 2)

/** One lookup's read (`find_cost_for_ref`). */
function lookupRead(t: TableStatistics, key: KeyChoice): number {
  if (key.covering) {
    const perPage = 1 + Math.floor(PAGE_BYTES / 2 / key.recordBytes)
    return ((key.fanout + perPage - 1) / perPage) * PAGE_READ
  }
  if (key.kind === 'clustered') {
    const rows = Math.trunc(key.fanout)
    return (rows <= 2 ? rows : t.rows < rows ? t.pages : 1 + (rows / t.rows) * t.pages) * PAGE_READ
  }
  return Math.min(PAGE_READ * key.fanout, worstSeeks(t))
}

/** The access a table is read by after `prefix`: by `key`, or whole. */
export interface Access {
  readonly lookup: boolean
  /** Rows fetched for each prefix row. */
  readonly fetched: number
  /** What reading them costs, before each row fetched is evaluated (`read_cost`). */
  readonly read: number
}

/**
 * Whether a table is read by its index lookup or whole after `prefix`
 * (`best_access_path`). `rowBytes` is what a join buffer holds for each
 * prefix row.
 */
export function bestAccess(t: TableFacts, prefix: readonly Position[], key: KeyChoice | undefined, rowBytes: number): Access {
  const s = t.stats
  const before = prefixRows(prefix)
  const kept = s.rows * t.constantFilter
  const refills = 1 + (rowBytes * before) / JOIN_BUFFER
  const whole: Access = { lookup: false, fetched: kept, read: refills * (scanCost(s) + ROW_EVALUATE * (s.rows - kept)) }
  if (key === undefined) return whole
  const fanout = key.kind === 'unique' ? 1 : key.fanout
  const read = key.kind === 'unique' ? distinctRows(prefix, key.keyFrom) * PAGE_READ : before * lookupRead(s, key)
  const lookup: Access = { lookup: true, fetched: fanout, read }
  if (fanout < s.rows && read <= scanCost(s)) return lookup
  if (t.coveredByAnyIndex) return lookup
  return whole.read + ROW_EVALUATE * before * kept < read + ROW_EVALUATE * before * fanout ? whole : lookup
}

/**
 * A position's filter (`calculate_condition_filter`'s floors): never below one
 * row of the table, nor below a twentieth of a row for each row fetched.
 */
export function floorFilter(filter: number, rows: number, fetched: number): number {
  let f = Math.max(Math.fround(filter), Math.fround(1 / rows))
  if (f * fetched < 0.05) f = 0.05 / fetched
  return f
}

/** A table placed in a join order: its position, how it is read, and what that costs. */
export interface Positioned extends Position {
  readonly lookup: boolean
  /** `read_cost`. */
  readonly read: number
}

/** A table the join order may put anywhere its dependencies allow. */
export interface Candidate {
  readonly alias: string
  /** Its estimated rows before any join (`found_records`), which orders the search. */
  readonly rows: number
  /** Tables that must come before it: an outer join's preserved side. */
  readonly dependent: ReadonlySet<string>
  /** Tables an index lookup into it could take its key from (`key_dependent`). */
  readonly keyDependent: ReadonlySet<string>
  /** How it is best read after `prefix` (`best_access_path`). */
  place(prefix: readonly Positioned[]): Positioned
}

interface Step {
  readonly placed: Positioned
  /** `prefix_rowcount`, `prefix_cost`. */
  readonly rows: number
  readonly cost: number
}

/** One more table on a plan (`set_prefix_join_cost`): its rows evaluated once for each it fetches, its filter applied after. */
function step(before: Step | undefined, placed: Positioned): Step {
  const fetched = (before?.rows ?? 1) * placed.fetched
  return { placed, rows: fetched * placed.filter, cost: (before?.cost ?? 0) + placed.read + ROW_EVALUATE * fetched }
}

const almostEqual = (a: number, b: number): boolean => a >= b * 0.9 && a <= b * 1.1

/**
 * The cheapest join order (`greedy_search` at the default search depth,
 * which on fewer than 62 tables is `best_extension_by_limited_search` over
 * every order). The tables are first sorted as the server sorts them: a table
 * after those it depends on, then after those its keys read from, then fewer
 * rows first, then as written. Each prefix is extended by each table it may
 * take next, in that order, and abandoned once it costs as much as the best
 * whole plan found. `prune_level=1`'s heuristics are kept, since they decide
 * which of two equal plans is found first: an extension no cheaper and no
 * smaller than an earlier one at the same depth is not explored, and a table
 * read by a unique key at one row per row draws the other such tables after
 * it in sequence, without exploring their permutations. A later whole plan
 * replaces the best only if strictly cheaper.
 *
 * `sort` is the one table an ORDER BY or GROUP BY reads (`sort_by_table`): a
 * plan that does not start with it pays a sort of its rows, one per row. Once
 * that table has been placed first and read whole where `limit` keeps at
 * least the rows it fetches, every plan pays the sort (`use_tmp_table`): the
 * server's own state, kept as it is, since it decides plans.
 */
export function joinOrder(candidates: readonly Candidate[], sort?: { readonly alias: string; readonly limit: number }): Positioned[] {
  let sortBy = sort?.alias
  const sorted = [...candidates].sort((a, b) => {
    if (a.dependent.has(b.alias)) return 1
    if (b.dependent.has(a.alias)) return -1
    const ab = a.keyDependent.has(b.alias)
    const ba = b.keyDependent.has(a.alias)
    if (ab && !ba) return 1
    if (ba && !ab) return -1
    if (a.rows !== b.rows) return a.rows - b.rows
    return candidates.indexOf(a) - candidates.indexOf(b)
  })
  let best: { readonly cost: number; readonly plan: readonly Positioned[] } | undefined
  const plan: Step[] = []
  const placedAliases = (): Set<string> => new Set(plan.map((p) => p.placed.alias))
  const available = (c: Candidate, remaining: ReadonlySet<string>): boolean => remaining.has(c.alias) && ![...c.dependent].some((d) => remaining.has(d))
  const place = (c: Candidate): Positioned => {
    const placed = c.place(plan.map((p) => p.placed))
    if (plan.length === 0 && c.alias === sortBy && !placed.lookup && sort !== undefined && sort.limit >= placed.fetched) sortBy = undefined
    return placed
  }
  const consider = (): void => {
    const last = plan.at(-1) as Step
    const cost = last.cost + (sort !== undefined && plan[0]?.placed.alias !== sortBy ? last.rows : 0)
    if (best === undefined || cost < best.cost) best = { cost, plan: plan.map((p) => p.placed) }
  }
  // The unique-key tables after the one just placed, each joined in turn while it costs what the one before did (`eq_ref_extension_by_limited_search`).
  const extendByUniqueKeys = (order: readonly Candidate[], remaining: Set<string>): Set<string> => {
    if (remaining.size === 0) return new Set()
    const done = placedAliases()
    for (const c of order) {
      if (!available(c, remaining) || c.keyDependent.size === 0 || ![...c.keyDependent].some((a) => done.has(a))) continue
      const placed = place(c)
      const previous = (plan.at(-1) as Step).placed
      if (!(placed.lookup && almostEqual(placed.read, previous.read) && almostEqual(placed.fetched, previous.fetched))) continue
      const next = step(plan.at(-1), placed)
      if (best !== undefined && next.cost >= best.cost) continue
      plan.push(next)
      remaining.delete(c.alias)
      const extended = new Set([c.alias, ...(remaining.size > 0 ? extendByUniqueKeys(order, remaining) : (consider(), []))])
      remaining.add(c.alias)
      plan.pop()
      return extended
    }
    search(order, remaining)
    return new Set()
  }
  const search = (order: readonly Candidate[], remaining: Set<string>): void => {
    let bestRows = Infinity
    let bestCost = Infinity
    let extended = new Set<string>()
    for (const c of order) {
      if (!available(c, remaining) || extended.has(c.alias)) continue
      const placed = place(c)
      const next = step(plan.at(-1), placed)
      if (best !== undefined && next.cost >= best.cost) continue
      if (bestRows > next.rows || bestCost > next.cost || (plan.length === 0 && c.alias === sortBy)) {
        if (bestRows >= next.rows && bestCost >= next.cost && (![...c.keyDependent].some((a) => remaining.has(a)) || placed.fetched < 2)) {
          bestRows = next.rows
          bestCost = next.cost
        }
      } else if (best !== undefined) continue
      plan.push(next)
      remaining.delete(c.alias)
      if (remaining.size === 0) consider()
      else if (placed.lookup && placed.fetched <= 1) {
        if (extended.size === 0) {
          extended = new Set([c.alias, ...extendByUniqueKeys(order, remaining)])
          remaining.add(c.alias)
          plan.pop()
          if ([...remaining].every((a) => extended.has(a))) return
          continue
        }
      } else search(order, remaining)
      remaining.add(c.alias)
      plan.pop()
    }
  }
  search(sorted, new Set(candidates.map((c) => c.alias)))
  return [...(best?.plan ?? [])]
}

/** An index's pages for `rows` of its records (`index_only_read_time`): half a page's bytes of records to a page. */
const indexPages = (rows: number, recordBytes: number): number => {
  const perPage = 1 + Math.floor(PAGE_BYTES / 2 / recordBytes)
  return (rows + perPage - 1) / perPage
}

/**
 * What the range optimizer must beat (`test_quick_select`): a table scan, with
 * the server's fixed 1.1 and 1 added; or, where an index covers the query, a
 * full scan of the shortest one (`coveringRecordBytes`), if that is cheaper.
 */
export function rangeBaseline(t: TableStatistics, coveringRecordBytes: number | undefined): number {
  const scan = PAGE_READ * t.pages + 1.1 + ROW_EVALUATE * t.rows + 1
  if (coveringRecordBytes === undefined) return scan
  return Math.min(scan, indexPages(t.rows, coveringRecordBytes) * PAGE_READ + ROW_EVALUATE * t.rows)
}

/** How an index is read for a range: through the clustered key, alone because it covers, or a secondary index with a row fetched for each entry. */
export interface RangeShape {
  readonly clustered: boolean
  readonly covering: boolean
  /** An index record's bytes: its key and the clustered key it carries. */
  readonly recordBytes: number
  /** The shortest a clustered record can be, which bounds the rows a page may hold (`estimate_rows_upper_bound`). */
  readonly minRecordBytes: number
}

/**
 * A range read's cost (`multi_range_read_info_const`): the index's pages for a
 * covering read; for the clustered key, its rows or the share of the table's
 * pages they fill, a page more per range (`ha_innobase::read_time`); for a
 * secondary index, a page per range and per row; then every row evaluated,
 * and 0.01.
 */
export function rangeCost(t: TableStatistics, shape: RangeShape, ranges: number, rows: number): number {
  let pages: number
  if (shape.covering) pages = indexPages(rows, shape.recordBytes)
  else if (shape.clustered) {
    const upper = Math.trunc((2 * t.pages * PAGE_BYTES) / shape.minRecordBytes)
    const whole = Math.trunc(rows)
    pages = whole <= 2 ? whole : upper < whole ? t.pages : ranges + (whole / upper) * t.pages
  } else pages = ranges + rows
  return pages * PAGE_READ + ROW_EVALUATE * rows + 0.01
}
