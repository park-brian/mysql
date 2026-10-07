// M4.6 — overflow pages: where a column too long for its record lives
// (doc 22 §Overflow pages, D-20).
//
// DYNAMIC's atomic-BLOB semantics: an off-page value leaves an 8-byte
// reference in the record — first page and total length — and no local prefix.
// The pages form a chain, each holding a `u32` next page and a `u32` byte count
// before its data. A chain belongs to its tree's overflow segment and is freed
// page by page when its record is deleted or replaced.
import { corrupt } from './errors.ts'
import { FRAME_HEADER, FRAME_TRAILER, PAGE_TYPE, initPage } from './page.ts'
import type { BufferPool } from './pool.ts'
import type { LsnClock } from './lsn.ts'

/** The inline size of an off-page reference. */
export const REF_SIZE = 8

const NEXT = FRAME_HEADER
const USED = FRAME_HEADER + 4
const DATA = FRAME_HEADER + 8

/** Where a tree's overflow pages come from and go back to. */
export interface OverflowPages {
  readonly pool: BufferPool
  readonly lsn: LsnClock
  allocate(): number
  free(page: number): void
}

const capacity = (pageSize: number): number => pageSize - DATA - FRAME_TRAILER

export interface ExternalRef {
  readonly page: number
  readonly length: number
}

export function encodeRef(ref: ExternalRef): Uint8Array {
  const out = new Uint8Array(REF_SIZE)
  const v = new DataView(out.buffer)
  v.setUint32(0, ref.page)
  v.setUint32(4, ref.length)
  return out
}

export function decodeRef(bytes: Uint8Array): ExternalRef {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { page: v.getUint32(0), length: v.getUint32(4) }
}

/** Write `bytes` to a new chain and return its reference. */
export function writeChain(pages: OverflowPages, bytes: Uint8Array): Uint8Array {
  const cap = capacity(pages.pool.pageSize)
  const count = Math.max(1, Math.ceil(bytes.length / cap))
  const numbers: number[] = []
  for (let i = 0; i < count; i++) numbers.push(pages.allocate())
  for (let i = 0; i < count; i++) {
    const pageNo = numbers[i] as number
    const page = pages.pool.create(pageNo)
    try {
      initPage(page, pageNo, PAGE_TYPE.OVERFLOW)
      const chunk = bytes.subarray(i * cap, (i + 1) * cap)
      const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
      v.setUint32(NEXT, numbers[i + 1] ?? 0)
      v.setUint32(USED, chunk.length)
      page.set(chunk, DATA)
      pages.pool.markDirty(page, pages.lsn.next())
    } finally {
      pages.pool.release(page)
    }
  }
  return encodeRef({ page: numbers[0] as number, length: bytes.length })
}

/**
 * The page numbers of a chain, checked as it is walked: every page an overflow
 * page, the byte counts summing to the reference's length, and no more pages
 * than that length needs — so a cycle is a typed error rather than a hang.
 */
export function chainPages(pool: BufferPool, ref: ExternalRef): number[] {
  const cap = capacity(pool.pageSize)
  const limit = Math.max(1, Math.ceil(ref.length / cap))
  const out: number[] = []
  let total = 0
  for (let pageNo = ref.page; pageNo !== 0; ) {
    if (out.length === limit) throw corrupt(ref.page, 'overflow chain is longer than its length needs')
    out.push(pageNo)
    const page = pool.fetch(pageNo)
    try {
      const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
      if (page[16] !== PAGE_TYPE.OVERFLOW) throw corrupt(pageNo, 'not an overflow page')
      const used = v.getUint32(USED)
      if (used > cap) throw corrupt(pageNo, `overflow page claims ${used} bytes`)
      total += used
      pageNo = v.getUint32(NEXT)
    } finally {
      pool.release(page)
    }
  }
  if (total !== ref.length) throw corrupt(ref.page, `overflow chain holds ${total} bytes, its reference says ${ref.length}`)
  return out
}

export function readChain(pool: BufferPool, refBytes: Uint8Array): Uint8Array {
  const ref = decodeRef(refBytes)
  // Walked and checked before the buffer is sized by a length it vouches for.
  const pages = chainPages(pool, ref)
  const out = new Uint8Array(ref.length)
  let at = 0
  for (const pageNo of pages) {
    const page = pool.fetch(pageNo)
    try {
      const used = new DataView(page.buffer, page.byteOffset, page.byteLength).getUint32(USED)
      out.set(page.subarray(DATA, DATA + used), at)
      at += used
    } finally {
      pool.release(page)
    }
  }
  return out
}

export function freeChain(pages: OverflowPages, refBytes: Uint8Array): void {
  for (const pageNo of chainPages(pages.pool, decodeRef(refBytes))) pages.free(pageNo)
}
