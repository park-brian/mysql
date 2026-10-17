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
import { compareBytes } from '@myjs/bytes'
import { collation, encodeCollation } from '@myjs/charsets'
import { compareJsonSortHashes, decodeField, jsonSortHash, sortValues, truth, type Value } from '@myjs/types'
import { firstKey, rowKey } from './keys.ts'
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
 * Rows ordered by `keys`. Verified integer buffers retain native queue slots
 * and small-buffer preselection ties; other sorts preserve arrival order.
 * NULL sorts first ascending and last descending. Materialises: spilling a
 * sort larger than memory is M5.5's.
 */
export function sort<T extends { readonly row: Row }>(source: Iterable<T>, keys: readonly SortKey[], env: Env, keep?: number, buffer?: { readonly estimate: number; readonly capacity: number }): T[] {
  const queued = keep !== undefined && keep < 16 && buffer !== undefined && (buffer.estimate < buffer.capacity ? keep < buffer.estimate / 3 : keep + 1 < buffer.capacity)
  // JSON keys append their combined hash after the ordinary sort keys.
  const json = keys.flatMap((k, i) => (k.expr.type.kind === 'json' ? [i] : []))
  const decorated = [...source].map((item, order) => {
    const values = keys.map((k) => k.expr.eval(item.row, env))
    let hash = 0n
    for (const i of json) {
      const v = values[i]
      if (v !== null && v !== undefined && v.kind === 'json') hash = jsonSortHash(v.v, hash)
    }
    return { item, values, sortKeys: values.map(sortKeyOf), hash, order }
  })
  // The small fixed-record buffer fits entirely in memory. The native
  // half-input threshold uses rows actually read, not the queue's estimate.
  const selected = !queued && buffer !== undefined && decorated.length <= 16 && decorated.length <= buffer.capacity && keep !== undefined && keep < decorated.length / 2
  warnNonScalar(decorated.map((d) => d.values), env)
  const compare = (a: (typeof decorated)[number], b: (typeof decorated)[number]): number => {
    for (let i = 0; i < keys.length; i++) {
      const x = a.sortKeys[i]
      const y = b.sortKeys[i]
      const c = x !== undefined && y !== undefined && x.id === y.id ? compareBytes(x.key, y.key) : sortValues(a.values[i] ?? null, b.values[i] ?? null)
      if (c !== 0) return (keys[i] as SortKey).desc ? -c : c
    }
    return (json.length === 0 ? 0 : compareJsonSortHashes(a.hash, b.hash)) || (queued || selected ? 0 : a.order - b.order)
  }
  if (keep === 0) return []
  type Entry = (typeof decorated)[number]
  // Queue insertion moves equal parents; queue replacement stops at equals.
  // Selection repairs descend to a leaf with right-child ties, then rise.
  const repair = (heap: Entry[], i: number, value: Entry, mode: 'insert' | 'replace' | 'select') => {
    const top = mode === 'insert' ? 0 : i
    if (mode !== 'insert') {
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1
        if (child + 1 < heap.length) {
          const c = compare(heap[child]!, heap[child + 1]!)
          if (c < 0 || (mode === 'select' && c === 0)) child++
        }
        if (mode === 'replace' && compare(value, heap[child]!) >= 0) break
        heap[i] = heap[child]!
        i = child
      }
    }
    if (mode !== 'replace') {
      while (i > top) {
        const parent = (i - 1) >>> 1
        const c = compare(value, heap[parent]!)
        if (c < 0 || (mode === 'select' && c === 0)) break
        heap[i] = heap[parent]!
        i = parent
      }
    }
    heap[i] = value
  }
  let ordered = decorated
  if (!queued && keep !== undefined && keep < decorated.length / 2) {
    // Partition around a median pivot; bound adversarial work by switching
    // to heap selection when the partition depth is exhausted.
    let first = 0
    let last = decorated.length
    let depth = 2 * Math.floor(Math.log2(last))
    const less = (a: number, b: number) => compare(decorated[a]!, decorated[b]!) < 0
    const swap = (a: number, b: number) => {
      const value = decorated[a]!
      decorated[a] = decorated[b]!
      decorated[b] = value
    }
    while (last - first > 3 && depth-- > 0) {
      const a = first + 1
      const b = first + ((last - first) >>> 1)
      const c = last - 1
      let pivot = b
      if (less(a, b)) {
        if (!less(b, c)) pivot = less(a, c) ? c : a
      } else if (less(a, c)) pivot = a
      else if (less(b, c)) pivot = c
      swap(first, pivot)
      let left = first + 1
      let right = last
      for (;;) {
        while (less(left, first)) left++
        while (less(first, --right)) {}
        if (left >= right) break
        swap(left++, right)
      }
      if (left <= keep - 1) first = left
      else last = left
    }
    if (last - first > 3) {
      const heap = decorated.slice(first, keep)
      // Bottom-up construction and replacement descend to a leaf, preferring
      // the right equal child, then restore the value upward. This differs
      // from the queue's equal-child policy and physical-slot ownership.
      for (let i = (heap.length >>> 1) - 1; i >= 0; i--) repair(heap, i, heap[i]!, 'select')
      for (let i = keep; i < last; i++) if (compare(decorated[i]!, heap[0]!) < 0) repair(heap, 0, decorated[i]!, 'select')
      const root = heap[0]!
      heap[0] = heap[heap.length - 1]!
      heap[heap.length - 1] = root
      ordered = [...decorated.slice(0, first), ...heap]
    } else {
      // Earlier partitions precede this final window. One stable sort of that
      // prefix both orders the window and chooses its remaining winners.
      ordered = decorated.slice(0, last)
    }
  } else if (queued) {
    const slots = decorated.slice(0, keep + 1)
    const heap: typeof decorated = []
    for (const d of slots) {
      heap.push(d)
      repair(heap, heap.length - 1, d, 'insert')
    }
    for (let n = slots.length; n < decorated.length; n++) {
      // Heap entries point to fixed slots; replacing the root keeps that
      // slot's position in the final sort buffer.
      const root = Object.assign(heap[0]!, decorated[n])
      repair(heap, 0, root, 'replace')
    }
    ordered = slots
  }
  return ordered.sort(compare).slice(0, keep).map((d) => d.item)
}

/**
 * A string's sort key, once a row rather than once a comparison: its
 * collation's `sortKey`, compared as bytes. Only under a NO PAD collation,
 * where that order is the comparison's exactly; a PAD SPACE one compares
 * `'a'` equal to `'a '`, which
 * a key without the column's width cannot say (D-35), and an ENUM sorts by
 * its member index. Two values sort by their keys only under one collation.
 */
function sortKeyOf(v: Value): { readonly id: number; readonly key: Uint8Array } | undefined {
  if (v === null || v.kind !== 'string' || v.ordinal !== undefined) return undefined
  const c = collation(v.collationId)
  if (c.padAttribute !== 'NO PAD') return undefined
  return { id: v.collationId, key: c.sortKey(encodeCollation(v.v, v.collationId)) }
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
 * sort together but are distinct (M5.21), so projected rows key on `rowKey`.
 * A keyed source may instead exclude a row by returning undefined.
 */
export function distinct(source: Iterable<Value[]>): Generator<Value[]>
export function distinct<T>(source: Iterable<T>, key: (row: T) => string | undefined): Generator<T>
export function* distinct<T>(source: Iterable<T>, key: (row: T) => string | undefined = rowKey as (row: T) => string): Generator<T> {
  const seen = new Set<string>()
  for (const row of source) {
    const k = key(row)
    if (k !== undefined && firstKey(seen, k)) yield row
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
