// M4.2 — the page frame every page shares (doc 22 §Our index page).
//
// The frame makes a page self-identifying: its own number, its type, the LSN
// of its last change at both ends, and a CRC32C over everything after the
// checksum. A torn write shows up as a checksum failure or as head and tail
// LSNs that disagree, and either is visible with nothing but the page — no
// log, no other page (D-18).
//
// The checksum is sealed once, when the buffer pool writes the page out, rather
// than on every change. LSNs are read as two `u32` halves, so the hot path holds
// no `BigInt`; a counter that reaches 2^53 is a problem for another century.
import { crc32c } from './crc32c.ts'
import { corrupt } from './errors.ts'

/** A big-endian u32 at `at`: how a page, a log record and a catalog key write every integer. */
export const readU32 = (b: Uint8Array, at = 0): number => (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0

/** `n` as four big-endian bytes. */
export const be32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}

export const PAGE_TYPE = {
  SUPERBLOCK: 1,
  ALLOC_MAP: 2,
  INDEX: 3,
  OVERFLOW: 4,
} as const

export type PageType = (typeof PAGE_TYPE)[keyof typeof PAGE_TYPE]

/** Bytes before a page's own content. */
export const FRAME_HEADER = 24
/** Bytes after it: the LSN again. */
export const FRAME_TRAILER = 8

const KNOWN_TYPES: ReadonlySet<number> = new Set(Object.values(PAGE_TYPE))

const view = (page: Uint8Array): DataView => new DataView(page.buffer, page.byteOffset, page.byteLength)

/** Zero a page and write its frame: number, type, and an LSN of 0. */
export function initPage(page: Uint8Array, pageNo: number, type: PageType): void {
  page.fill(0)
  const v = view(page)
  v.setUint32(4, pageNo)
  v.setUint8(16, type)
}

export function pageNumber(page: Uint8Array): number {
  return (((page[4] as number) << 24) | ((page[5] as number) << 16) | ((page[6] as number) << 8) | (page[7] as number)) >>> 0
}

/** Read straight from the bytes, as every fetch of a tree's page checks it: a DataView each time was measurable. */
export function pageType(page: Uint8Array): number {
  return page[16] as number
}

export function pageLsn(page: Uint8Array): number {
  const v = view(page)
  return v.getUint32(8) * 2 ** 32 + v.getUint32(12)
}

/** Stamp the LSN of a change at both ends of the page. */
export function setPageLsn(page: Uint8Array, lsn: number): void {
  const v = view(page)
  const hi = Math.floor(lsn / 2 ** 32)
  const lo = lsn >>> 0
  v.setUint32(8, hi)
  v.setUint32(12, lo)
  v.setUint32(page.length - 8, hi)
  v.setUint32(page.length - 4, lo)
}

/** Write the checksum. The last thing done to a page before it leaves memory. */
export function sealPage(page: Uint8Array): void {
  view(page).setUint32(0, crc32c(page, 4))
}

/**
 * Check a page read from storage is the page that was written, whole.
 *
 * Throws `ENGINE_CORRUPT_PAGE` for a bad checksum, an LSN that differs between
 * head and tail, a page number that is not `pageNo`, or a type this build does
 * not know. Any byte string may be passed: a check that could read out of
 * bounds on a short or hostile input would itself be the bug (ground rule 5).
 */
export function verifyPage(page: Uint8Array, pageNo: number, pageSize: number): void {
  if (page.length !== pageSize || pageSize < FRAME_HEADER + FRAME_TRAILER) {
    throw corrupt(pageNo, `expected ${pageSize} bytes, got ${page.length}`)
  }
  const v = view(page)
  if (v.getUint32(0) !== crc32c(page, 4)) throw corrupt(pageNo, 'checksum mismatch')
  if (v.getUint32(8) !== v.getUint32(pageSize - 8) || v.getUint32(12) !== v.getUint32(pageSize - 4)) {
    throw corrupt(pageNo, 'torn: head and tail LSN differ')
  }
  if (v.getUint32(4) !== pageNo) throw corrupt(pageNo, `holds page ${v.getUint32(4)}`)
  if (!KNOWN_TYPES.has(v.getUint8(16))) throw corrupt(pageNo, `unknown page type ${v.getUint8(16)}`)
}
