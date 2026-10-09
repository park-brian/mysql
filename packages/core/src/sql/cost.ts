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

/** The access a table is read by after `prefix`, and its position: by `key`, or whole. */
export interface Access {
  readonly lookup: boolean
  /** Rows fetched for each prefix row. */
  readonly fetched: number
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
  const whole: Access = { lookup: false, fetched: kept }
  if (key === undefined) return whole
  const fanout = key.kind === 'unique' ? 1 : key.fanout
  const read = key.kind === 'unique' ? distinctRows(prefix, key.keyFrom) * PAGE_READ : before * lookupRead(s, key)
  const lookup: Access = { lookup: true, fetched: fanout }
  if (fanout < s.rows && read <= scanCost(s)) return lookup
  if (t.coveredByAnyIndex) return lookup
  const refills = 1 + (rowBytes * before) / JOIN_BUFFER
  const scan = refills * (scanCost(s) + ROW_EVALUATE * (s.rows - kept)) + ROW_EVALUATE * before * kept
  return scan < read + ROW_EVALUATE * before * fanout ? whole : lookup
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
