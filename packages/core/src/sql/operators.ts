// M5.3 — the Volcano operators: each one a generator over the rows of the one
// below it, so a `LIMIT 1` over a million-row scan reads one row.
//
// They are deliberately ignorant of where rows come from: `scan` is the only
// one that touches a `Table`, and every other operator takes any iterable of
// rows. That is the item's done-when — each is testable over a fixed array —
// and it is what lets a join (M5.4) or a sort that spills (M5.5) slot in
// without the rest noticing.
import type { KeyRange, RowId, Table, Trx } from '@myjs/engine'
import type { ColumnType } from '@myjs/types'
import { collation, encodeCollation } from '@myjs/charsets'
import { compareJsonSortHashes, decodeField, jsonSortHash, sortValues, truth, type Value } from '@myjs/types'
import { rowKey } from './keys.ts'
import { raise, setRowNumber, type Compiled, type Env, type Row } from './compile.ts'

/** A row as a scan produces it: its values, and the id to write it back by. */
export interface ScannedRow {
  readonly id: RowId
  readonly row: Row
}

export interface ScanSource {
  readonly table: Table
  /** An index to read in its order, or the clustered order when absent. */
  readonly index?: string
  readonly range?: KeyRange
  readonly trx?: Trx
  /** `'current'` for a locking read or a write's own reads. */
  readonly mode?: 'consistent' | 'current'
  readonly types: readonly ColumnType[]
}

/** Every row of a table, or of a range of one of its indexes, decoded. */
export function* scan(source: ScanSource): Generator<ScannedRow> {
  const { table, types } = source
  const rows = source.index === undefined ? table.scan(source.range, source.trx, source.mode) : table.indexScan(source.index, source.range, source.trx, source.mode)
  for (const [id, fields] of rows) {
    const row = new Array<Value>(types.length)
    for (let i = 0; i < types.length; i++) row[i] = decodeField(fields[i] ?? null, types[i] as ColumnType)
    yield { id, row }
  }
}

/** The rows a predicate is TRUE for — not FALSE, and not NULL. */
export function* filter<T extends { readonly row: Row }>(source: Iterable<T>, predicate: Compiled | undefined, env: Env): Generator<T> {
  if (predicate === undefined) {
    yield* source
    return
  }
  for (const item of source) if (truth(predicate.eval(item.row, env)) === true) yield item
}

/** Each row through a list of expressions. */
export function* project(source: Iterable<{ readonly row: Row }>, items: readonly Compiled[], env: Env): Generator<Value[]> {
  let n = 0
  for (const { row } of source) {
    setRowNumber(env, ++n)
    yield items.map((item) => item.eval(row, env))
  }
}

export interface SortKey {
  readonly expr: Compiled
  readonly desc: boolean
}

/**
 * Rows ordered by `keys`, stably — rows that tie keep the order they arrived
 * in, which is what makes `ORDER BY` over a clustered scan agree with MySQL on
 * ties. NULL sorts first ascending and last descending. Materialises: spilling
 * a sort larger than memory is M5.5's.
 */
export function sort<T extends { readonly row: Row }>(source: Iterable<T>, keys: readonly SortKey[], env: Env): T[] {
  const decorated = [...source].map((item) => {
    const values = keys.map((k) => k.expr.eval(item.row, env))
    return { item, values, sortKeys: values.map(sortKeyOf), hash: 0n }
  })
  warnNonScalar(decorated.map((d) => d.values), env)
  // A JSON key adds the row's JSON hash after the keys (`jsonSortHash`): what orders two that tie.
  const json = keys.flatMap((k, i) => (k.expr.type.kind === 'json' ? [i] : []))
  if (json.length > 0) {
    for (const d of decorated) {
      for (const i of json) {
        const v = d.values[i]
        if (v !== null && v !== undefined && v.kind === 'json') d.hash = jsonSortHash(v.v, d.hash)
      }
    }
  }
  // Array.prototype.sort is stable: rows that tie keep the order they came in.
  decorated.sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const x = a.sortKeys[i]
      const y = b.sortKeys[i]
      const c = x !== undefined && y !== undefined && x.id === y.id ? (x.key < y.key ? -1 : x.key > y.key ? 1 : 0) : sortValues(a.values[i] ?? null, b.values[i] ?? null)
      if (c !== 0) return (keys[i] as SortKey).desc ? -c : c
    }
    return json.length === 0 ? 0 : compareJsonSortHashes(a.hash, b.hash)
  })
  return decorated.map((d) => d.item)
}

/**
 * A string's sort key, once a row rather than once a comparison: its
 * collation's `sortKey` as a string of one character a byte, which orders as
 * `memcmp` does. Only under a NO PAD collation, where that order is the
 * comparison's exactly; a PAD SPACE one compares `'a'` equal to `'a '`, which
 * a key without the column's width cannot say (D-35), and an ENUM sorts by
 * its member index. Two values sort by their keys only under one collation.
 */
function sortKeyOf(v: Value): { readonly id: number; readonly key: string } | undefined {
  if (v === null || v.kind !== 'string' || v.ordinal !== undefined) return undefined
  const c = collation(v.collationId)
  if (c.padAttribute !== 'NO PAD') return undefined
  const bytes = c.sortKey(encodeCollation(v.v, v.collationId))
  let key = ''
  for (let i = 0; i < bytes.length; i += 8192) key += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { id: v.collationId, key }
}

/**
 * A JSON array or object among a sort's keys: sorted, but with 8.4.11's
 * warning, once a statement (1235: "sorting of non-scalar JSON values").
 */
export function warnNonScalar(keys: readonly (readonly Value[])[], env: Env): void {
  if (env.memo?.has(NON_SCALAR) === true) return
  for (const values of keys) {
    for (const v of values) {
      if (v === null || v.kind !== 'json' || (v.v.t !== 'array' && v.v.t !== 'object')) continue
      env.memo?.set(NON_SCALAR, true)
      raise(env, 1235, "This version of MySQL doesn't yet support 'sorting of non-scalar JSON values'")
      return
    }
  }
}

const NON_SCALAR = Symbol('non-scalar JSON sorted')

/**
 * The first of each set of rows equal on every value — `SELECT DISTINCT`, over
 * projected rows. Equal, not "sorts the same": two JSON arrays of one length
 * sort together but are distinct (M5.21), so this keys on `rowKey`.
 */
export function* distinct(source: Iterable<Value[]>): Generator<Value[]> {
  const seen = new Set<string>()
  for (const row of source) {
    const k = rowKey(row)
    if (seen.has(k)) continue
    seen.add(k)
    yield row
  }
}

/** `LIMIT count OFFSET offset`. */
export function* limit<T>(source: Iterable<T>, offset: number, count: number | undefined): Generator<T> {
  if (count === 0) return
  let skipped = 0
  let taken = 0
  for (const item of source) {
    if (skipped < offset) {
      skipped++
      continue
    }
    yield item
    if (count !== undefined && ++taken >= count) return
  }
}
