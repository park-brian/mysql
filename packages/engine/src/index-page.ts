// M4.7 — the index page: a slotted page with a dense, sorted directory
// (doc 22 §Our index page, D-19, D-43).
//
// Cells grow up from the header and a `u16` slot per cell grows down from the
// trailer, kept in key order, so a lookup is a pure binary search with no linear
// tail. There is no record chain and there are no infimum/supremum records: the
// slot array is the order. A cell is `varint keyLength · varint valueLength ·
// key · value`, and on an internal page the value is a 4-byte child page.
//
// A deleted cell leaves garbage in the heap, counted in the header; an insert
// that finds the free gap too small but the garbage large enough compacts the
// heap in place first. Every function here takes the page as bytes, so the page
// can be verified, fuzzed and dumped with nothing else in hand.
import { corrupt } from './errors.ts'
import { FRAME_TRAILER, PAGE_TYPE, initPage, pageType } from './page.ts'

export const INDEX_HEADER_END = 60

const LEVEL = 24
const N_CELLS = 26
const HEAP_TOP = 28
const GARBAGE = 30
const INDEX_ID = 32
const SCHEMA_VERSION = 36
const LEFT = 40
const RIGHT = 44
const LAST_INSERT = 48
const N_DIRECTION = 50
const DIRECTION = 52
const FRAGMENTS = 54

const DIRECTION_NONE = 0
export const DIRECTION_ASC = 1
export const DIRECTION_DESC = 2
const NO_SLOT = 0xffff
/** Bytes per slot in the directory. */
export const SLOT = 2

const view = (page: Uint8Array): DataView => new DataView(page.buffer, page.byteOffset, page.byteLength)

/** The bytes a page offers its cells and slots. */
export const usableSpace = (pageSize: number): number => pageSize - INDEX_HEADER_END - FRAME_TRAILER

/**
 * The largest cell a page accepts: a third of the usable space, less its slot.
 * A leaf then always holds two cells and an internal page three children, so a
 * split always has room for both halves (doc 22).
 */
export const maxCellSize = (pageSize: number): number => Math.floor(usableSpace(pageSize) / 3) - SLOT

export function initIndexPage(page: Uint8Array, pageNo: number, level: number, indexId: number, schemaVersion = 0): void {
  initPage(page, pageNo, PAGE_TYPE.INDEX)
  const v = view(page)
  v.setUint16(LEVEL, level)
  v.setUint16(HEAP_TOP, INDEX_HEADER_END)
  v.setUint32(INDEX_ID, indexId)
  v.setUint32(SCHEMA_VERSION, schemaVersion)
  v.setUint16(LAST_INSERT, NO_SLOT)
}

// --- header fields ------------------------------------------------------------

export const level = (p: Uint8Array): number => u16(p, LEVEL)
/** A big-endian `uint16` read straight from the bytes: the binary search reads one per probe, and a DataView each was most of its cost. */
const u16 = (p: Uint8Array, at: number): number => ((p[at] as number) << 8) | (p[at + 1] as number)
const u32 = (p: Uint8Array, at: number): number => (((p[at] as number) << 24) | ((p[at + 1] as number) << 16) | ((p[at + 2] as number) << 8) | (p[at + 3] as number)) >>> 0

export const cellCount = (p: Uint8Array): number => u16(p, N_CELLS)
export const indexIdOf = (p: Uint8Array): number => u32(p, INDEX_ID)
export const schemaVersion = (p: Uint8Array): number => u32(p, SCHEMA_VERSION)
export const leftSibling = (p: Uint8Array): number => u32(p, LEFT)
export const rightSibling = (p: Uint8Array): number => u32(p, RIGHT)
export const lastInsert = (p: Uint8Array): number => u16(p, LAST_INSERT)
export const direction = (p: Uint8Array): number => (p[DIRECTION] as number)
export const directionCount = (p: Uint8Array): number => u16(p, N_DIRECTION)
export const garbage = (p: Uint8Array): number => u16(p, GARBAGE)
/** A root's count of fragment pages in segment `i`: 0 leaf, 1 internal, 2 overflow (doc 21). */
export const fragments = (p: Uint8Array, i: number): number => u16(p, FRAGMENTS + 2 * i)

export const setSchemaVersion = (p: Uint8Array, n: number): void => view(p).setUint32(SCHEMA_VERSION, n)
export const setLeftSibling = (p: Uint8Array, n: number): void => view(p).setUint32(LEFT, n)
export const setRightSibling = (p: Uint8Array, n: number): void => view(p).setUint32(RIGHT, n)
export const setFragments = (p: Uint8Array, i: number, n: number): void => view(p).setUint16(FRAGMENTS + 2 * i, n)

/** Record an insert at `slot`, for the split heuristic (M4.10). */
export function noteInsert(p: Uint8Array, slot: number): void {
  const v = view(p)
  const last = v.getUint16(LAST_INSERT)
  const dir = last === NO_SLOT ? DIRECTION_NONE : slot > last ? DIRECTION_ASC : DIRECTION_DESC
  const same = dir !== DIRECTION_NONE && dir === v.getUint8(DIRECTION)
  v.setUint8(DIRECTION, dir)
  v.setUint16(N_DIRECTION, same ? Math.min(v.getUint16(N_DIRECTION) + 1, 0xffff) : 0)
  v.setUint16(LAST_INSERT, slot)
}

// --- cells --------------------------------------------------------------------

const slotAt = (p: Uint8Array, i: number): number => p.length - FRAME_TRAILER - 2 * (i + 1)

function cellOffset(p: Uint8Array, i: number): number {
  return u16(p, slotAt(p, i))
}

const varintSize = (n: number): number => (n < 0x80 ? 1 : n < 0x4000 ? 2 : 3)

function writeVarint(p: Uint8Array, at: number, n: number): number {
  while (n >= 0x80) {
    p[at++] = (n & 0x7f) | 0x80
    n >>>= 7
  }
  p[at++] = n
  return at
}

/** `[value, next offset]`, or `null` when the varint runs past `end` or past three bytes. */
function readVarint(p: Uint8Array, at: number, end: number): [number, number] | null {
  let n = 0
  for (let shift = 0; shift < 21; shift += 7) {
    if (at >= end) return null
    const b = p[at++] as number
    n |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) return [n, at]
  }
  return null
}

/** The bytes a cell takes in the heap, not counting its slot. */
export const cellSize = (key: Uint8Array, value: Uint8Array): number =>
  varintSize(key.length) + varintSize(value.length) + key.length + value.length

/** The cell at slot `i`, as views into the page. Valid until the page changes. */
export function cell(p: Uint8Array, i: number): { key: Uint8Array; value: Uint8Array } {
  const at = cellOffset(p, i)
  const [keyLength, afterKey] = readVarint(p, at, p.length) as [number, number]
  const [valueLength, start] = readVarint(p, afterKey, p.length) as [number, number]
  return { key: p.subarray(start, start + keyLength), value: p.subarray(start + keyLength, start + keyLength + valueLength) }
}

/** The key of the cell at slot `i`, without the value's view `cell` builds too. */
export function keyAt(p: Uint8Array, i: number): Uint8Array {
  let at = cellOffset(p, i)
  // The key's length, then the value's, each a varint of at most three bytes.
  let keyLength = 0
  for (let shift = 0; ; shift += 7) {
    const b = p[at++] as number
    keyLength |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
  }
  while (((p[at++] as number) & 0x80) !== 0);
  return p.subarray(at, at + keyLength)
}

/** An internal page's child at slot `i`. */
export const childAt = (p: Uint8Array, i: number): number => {
  const { value } = cell(p, i)
  return new DataView(value.buffer, value.byteOffset, 4).getUint32(0)
}

export function childValue(child: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, child)
  return out
}

/** `memcmp`, the only order the tree knows (D-42). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number)
    if (d !== 0) return d
  }
  return a.length - b.length
}

/**
 * Binary search: the first slot whose key is ≥ `key`, and whether it is equal.
 * `index` is `cellCount` when every key is smaller.
 */
export function search(p: Uint8Array, key: Uint8Array): { index: number; found: boolean } {
  let lo = 0
  let hi = cellCount(p)
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (compareBytes(keyAt(p, mid), key) < 0) lo = mid + 1
    else hi = mid
  }
  return { index: lo, found: lo < cellCount(p) && compareBytes(keyAt(p, lo), key) === 0 }
}

/** Contiguous free bytes between the heap and the slot array. */
export function freeSpace(p: Uint8Array): number {
  return slotAt(p, cellCount(p) - 1) - u16(p, HEAP_TOP)
}

/** Whether a cell would fit, after compacting the heap if need be. */
export function fits(p: Uint8Array, key: Uint8Array, value: Uint8Array): boolean {
  return freeSpace(p) + garbage(p) >= cellSize(key, value) + SLOT
}

/** Bytes in use by cells and slots — what the merge and split policies weigh. */
export function usedSpace(p: Uint8Array): number {
  return u16(p, HEAP_TOP) - INDEX_HEADER_END - garbage(p) + SLOT * cellCount(p)
}

/** Insert a cell at slot `index`. The caller checks `fits` first; this compacts when it must. */
export function insertCell(p: Uint8Array, index: number, key: Uint8Array, value: Uint8Array): void {
  const size = cellSize(key, value)
  if (freeSpace(p) < size + SLOT) defragment(p)
  const v = view(p)
  const n = cellCount(p)
  const at = v.getUint16(HEAP_TOP)
  let w = writeVarint(p, at, key.length)
  w = writeVarint(p, w, value.length)
  p.set(key, w)
  p.set(value, w + key.length)
  v.setUint16(HEAP_TOP, at + size)
  // Open slot `index`: the slots below it move down by one. Slot i sits at a
  // lower address than slot i-1, so the block [slot n-1, slot index] shifts left.
  const low = slotAt(p, n)
  p.copyWithin(low, low + SLOT, slotAt(p, index) + SLOT)
  v.setUint16(slotAt(p, index), at)
  v.setUint16(N_CELLS, n + 1)
}

/**
 * Overwrite the value of the cell at slot `index` where it lies, when the new
 * value is the same length: a delete-mark or an update of fixed-width fields.
 * `false`, and the page untouched, when it is not. Removing and re-inserting
 * instead leaves the old bytes as garbage, and on a full page compacts the
 * whole heap for every row a DELETE marks.
 */
export function replaceValue(p: Uint8Array, index: number, value: Uint8Array): boolean {
  const { value: old } = cell(p, index)
  if (old.length !== value.length) return false
  p.set(value, old.byteOffset - p.byteOffset)
  return true
}

/** Remove the cell at slot `index`, leaving its bytes as garbage. */
export function removeCell(p: Uint8Array, index: number): void {
  const v = view(p)
  const n = cellCount(p)
  const { key, value } = cell(p, index)
  v.setUint16(GARBAGE, garbage(p) + cellSize(key, value))
  const low = slotAt(p, n - 1)
  p.copyWithin(low + SLOT, low, slotAt(p, index))
  v.setUint16(N_CELLS, n - 1)
  if (n === 1) {
    v.setUint16(HEAP_TOP, INDEX_HEADER_END)
    v.setUint16(GARBAGE, 0)
  }
}

/** Compact the heap: every live cell moved down, in slot order, and the garbage gone. */
function defragment(p: Uint8Array): void {
  const n = cellCount(p)
  const cells: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    const { key, value } = cell(p, i)
    const start = cellOffset(p, i)
    cells.push(p.slice(start, start + cellSize(key, value)))
  }
  const v = view(p)
  let at = INDEX_HEADER_END
  for (let i = 0; i < n; i++) {
    const c = cells[i] as Uint8Array
    p.set(c, at)
    v.setUint16(slotAt(p, i), at)
    at += c.length
  }
  v.setUint16(HEAP_TOP, at)
  v.setUint16(GARBAGE, 0)
  p.fill(0, at, slotAt(p, n - 1))
}

/**
 * Check an index page's structure: header fields in range, every slot pointing
 * at a cell that lies inside the heap, cells that do not overlap, and keys in
 * strictly ascending order. Any bytes may be passed — the fuzz target does —
 * and the answer is a typed error or nothing (ground rule 5).
 */
export function validateIndexPage(p: Uint8Array, pageNo: number): void {
  const size = p.length
  if (size < INDEX_HEADER_END + FRAME_TRAILER + 6 || size > 0x10000) throw corrupt(pageNo, `${size} bytes is not an index page`)
  if (pageType(p) !== PAGE_TYPE.INDEX) throw corrupt(pageNo, 'not an index page')
  const v = view(p)
  const n = v.getUint16(N_CELLS)
  const heapTop = v.getUint16(HEAP_TOP)
  const slotsStart = size - FRAME_TRAILER - 2 * n
  if (heapTop < INDEX_HEADER_END || slotsStart < heapTop) throw corrupt(pageNo, 'heap and slot array overlap')
  const spans: [number, number][] = []
  let live = 0
  let previous: Uint8Array | null = null
  for (let i = 0; i < n; i++) {
    const at = v.getUint16(slotAt(p, i))
    const k = readVarint(p, at, heapTop)
    const val = k === null ? null : readVarint(p, k[1], heapTop)
    if (at < INDEX_HEADER_END || k === null || val === null || val[1] + k[0] + val[0] > heapTop) {
      throw corrupt(pageNo, `slot ${i} points outside the heap`)
    }
    const end = val[1] + k[0] + val[0]
    spans.push([at, end])
    live += end - at
    const key = p.subarray(val[1], val[1] + k[0])
    if (previous !== null && compareBytes(previous, key) >= 0) throw corrupt(pageNo, `keys out of order at slot ${i}`)
    previous = key
    if (level(p) > 0 && val[0] !== 4) throw corrupt(pageNo, `internal cell ${i} does not hold a child page`)
    if (level(p) > 0 && i === 0 && k[0] !== 0) throw corrupt(pageNo, 'an internal page that does not start with the empty key')
  }
  if (level(p) > 0 && n === 0) throw corrupt(pageNo, 'an internal page with no children')
  spans.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < spans.length; i++) {
    if ((spans[i] as [number, number])[0] < (spans[i - 1] as [number, number])[1]) throw corrupt(pageNo, 'cells overlap')
  }
  if (live + v.getUint16(GARBAGE) !== heapTop - INDEX_HEADER_END) throw corrupt(pageNo, 'garbage count does not match the heap')
}
