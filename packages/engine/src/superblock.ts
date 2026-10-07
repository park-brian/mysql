// D-41 — page 0: what a database file is, and where its directory lives
// (doc 21 §Our file).
//
// It is read before anything else and refused, not guessed at, when it is not
// a file this build understands (D-26). Page 1 is reserved for the second
// superblock M4.17 will alternate with.
import { badFormat } from './errors.ts'
import { FRAME_HEADER, PAGE_TYPE, initPage, pageType } from './page.ts'

/** `myjs-db\0`. */
const MAGIC = Uint8Array.from([0x6d, 0x79, 0x6a, 0x73, 0x2d, 0x64, 0x62, 0x00])

/** The one format this build reads and writes. A change is a new number and a documented migration (D-26). */
export const FORMAT_VERSION = 1

export interface Superblock {
  readonly pageSize: number
  /** The highest LSN issued, so the counter keeps rising across a reopen. */
  readonly lsn: number
  /** How many pages the file has allocated. */
  readonly pageCount: number
  readonly nextIndexId: number
  /** Root page of the directory tree (index id 0). */
  readonly directoryRoot: number
}

const at = FRAME_HEADER

export function writeSuperblock(page: Uint8Array, s: Superblock): void {
  initPage(page, 0, PAGE_TYPE.SUPERBLOCK)
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
  page.set(MAGIC, at)
  v.setUint16(at + 8, FORMAT_VERSION)
  v.setUint32(at + 12, s.pageSize)
  v.setUint32(at + 16, Math.floor(s.lsn / 2 ** 32))
  v.setUint32(at + 20, s.lsn >>> 0)
  v.setUint32(at + 24, s.pageCount)
  v.setUint32(at + 28, s.nextIndexId)
  v.setUint32(at + 32, s.directoryRoot)
}

/** Read a verified page 0. The frame is checked by the caller; this checks what the frame cannot. */
export function readSuperblock(page: Uint8Array, pageSize: number): Superblock {
  if (page.length < at + 36 || pageType(page) !== PAGE_TYPE.SUPERBLOCK) throw badFormat('page 0 is not a superblock')
  for (let i = 0; i < MAGIC.length; i++) if (page[at + i] !== MAGIC[i]) throw badFormat('not a myjs database file')
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
  const version = v.getUint16(at + 8)
  if (version !== FORMAT_VERSION) throw badFormat(`format version ${version}; this build reads ${FORMAT_VERSION}`)
  const stored = v.getUint32(at + 12)
  if (stored !== pageSize) throw badFormat(`written with ${stored}-byte pages, opened with ${pageSize}`)
  return {
    pageSize: stored,
    lsn: v.getUint32(at + 16) * 2 ** 32 + v.getUint32(at + 20),
    pageCount: v.getUint32(at + 24),
    nextIndexId: v.getUint32(at + 28),
    directoryRoot: v.getUint32(at + 32),
  }
}
