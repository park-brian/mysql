// D-41, M4.17 — pages 0 and 1: what a database file is, where its directory
// lives, and the checkpoint a recovery starts from (doc 21 §Our file).
//
// There are two copies and they are written **alternately**, the generation
// deciding which slot: InnoDB's `LOG_CHECKPOINT_1`/`LOG_CHECKPOINT_2`. A crash
// while one is being written leaves the other whole, and the log it points
// into is still there, because the log's tail moves only once the new copy is
// durable. Open reads both and takes the newer one that verifies.
//
// A superblock is read before anything else and refused, not guessed at, when
// it is not one this build understands (D-26).
import type { VfsFile } from '@myjs/vfs'
import { EngineError, badFormat, corrupt } from './errors.ts'
import { LOG_BLOCKS_MAX } from './wal.ts'
import { FRAME_HEADER, PAGE_TYPE, initPage, pageType, sealPage, setPageLsn, verifyPage } from './page.ts'

/** `myjs-db\0`. */
const MAGIC = Uint8Array.from([0x6d, 0x79, 0x6a, 0x73, 0x2d, 0x64, 0x62, 0x00])

/**
 * The one format this build reads and writes. A change is a new number and a
 * documented migration (D-26). Version 1 had no log, version 2 no versions on
 * its rows, version 3 no catalog; none was released, so all are refused
 * rather than migrated.
 */
export const FORMAT_VERSION = 4

const REFUSED: Record<number, string> = {
  1: 'version 1 had no log and was never crash-safe',
  2: 'version 2 stored rows without transaction ids',
  3: 'version 3 had no catalog and no reserved index ids',
}

export interface Superblock {
  readonly pageSize: number
  /** Which write this is; slot `generation % 2` holds it. */
  readonly generation: number
  /** The salt every log block written after this checkpoint carries. */
  readonly salt: number
  /** The log's length in 4 KiB blocks. */
  readonly logBlocks: number
  /** Where recovery starts: an LSN, and the log block that holds it. */
  readonly checkpointLsn: number
  readonly checkpointBlock: number
  /** How many pages the file has allocated, as of the checkpoint. */
  readonly pageCount: number
  readonly nextIndexId: number
  /** Root page of the directory tree (index id 0), fixed for the file's life. */
  readonly directoryRoot: number
  /** Root page of the transaction directory (M4.20), fixed likewise. */
  readonly trxRoot: number
  /** The next transaction id, as of the checkpoint. */
  readonly nextTrxId: number
}

const at = FRAME_HEADER

/** Initialise and seal a superblock page for slot `generation % 2`. */
export function writeSuperblock(page: Uint8Array, s: Superblock): void {
  initPage(page, s.generation % 2, PAGE_TYPE.SUPERBLOCK)
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
  page.set(MAGIC, at)
  v.setUint16(at + 8, FORMAT_VERSION)
  v.setUint32(at + 12, s.pageSize)
  v.setUint32(at + 16, s.generation)
  v.setUint32(at + 20, s.salt)
  v.setUint32(at + 24, s.logBlocks)
  v.setUint32(at + 28, Math.floor(s.checkpointLsn / 2 ** 32))
  v.setUint32(at + 32, s.checkpointLsn >>> 0)
  v.setUint32(at + 36, s.checkpointBlock)
  v.setUint32(at + 40, s.pageCount)
  v.setUint32(at + 44, s.nextIndexId)
  v.setUint32(at + 48, s.directoryRoot)
  v.setUint32(at + 52, s.trxRoot)
  v.setUint16(at + 56, Math.floor(s.nextTrxId / 2 ** 32))
  v.setUint32(at + 58, s.nextTrxId >>> 0)
  setPageLsn(page, s.checkpointLsn)
  sealPage(page)
}

/** Read a verified superblock page. The frame is checked by the caller; this checks what the frame cannot. */
export function readSuperblock(page: Uint8Array, pageSize: number): Superblock {
  if (page.length < at + 62 || pageType(page) !== PAGE_TYPE.SUPERBLOCK) throw badFormat('not a superblock')
  for (let i = 0; i < MAGIC.length; i++) if (page[at + i] !== MAGIC[i]) throw badFormat('not a myjs database file')
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
  const version = v.getUint16(at + 8)
  if (version !== FORMAT_VERSION) {
    const why = REFUSED[version]
    throw badFormat(`format version ${version}; this build reads ${FORMAT_VERSION}${why === undefined ? '' : ` (${why}: recreate the database)`}`)
  }
  const stored = v.getUint32(at + 12)
  if (stored !== pageSize) throw badFormat(`written with ${stored}-byte pages, opened with ${pageSize}`)
  const s: Superblock = {
    pageSize: stored,
    generation: v.getUint32(at + 16),
    salt: v.getUint32(at + 20),
    logBlocks: v.getUint32(at + 24),
    checkpointLsn: v.getUint32(at + 28) * 2 ** 32 + v.getUint32(at + 32),
    checkpointBlock: v.getUint32(at + 36),
    pageCount: v.getUint32(at + 40),
    nextIndexId: v.getUint32(at + 44),
    directoryRoot: v.getUint32(at + 48),
    trxRoot: v.getUint32(at + 52),
    nextTrxId: v.getUint16(at + 56) * 2 ** 32 + v.getUint32(at + 58),
  }
  if (s.logBlocks < 4 || s.logBlocks > LOG_BLOCKS_MAX || s.checkpointBlock >= s.logBlocks) throw corrupt(0, `a checkpoint at block ${s.checkpointBlock} of a ${s.logBlocks}-block log`)
  return s
}

/**
 * The newer of the two superblocks that verifies. Neither verifying is
 * `ENGINE_BAD_FORMAT` — with the more specific reason when a slot gave one,
 * such as a format version this build does not read.
 */
export function readSuperblocks(file: VfsFile): Superblock {
  const page = new Uint8Array(file.pageSize)
  let best: Superblock | undefined
  let refusal: EngineError | undefined
  for (const slot of [0, 1]) {
    try {
      file.readPage(slot, page)
      verifyPage(page, slot, file.pageSize)
      const s = readSuperblock(page, file.pageSize)
      if (s.generation % 2 !== slot) throw corrupt(slot, `generation ${s.generation} in slot ${slot}`)
      if (best === undefined || s.generation > best.generation) best = s
    } catch (e) {
      if (!(e instanceof EngineError)) throw e
      if (e.code === 'ENGINE_BAD_FORMAT') refusal ??= e
    }
  }
  if (best !== undefined) return best
  throw refusal ?? badFormat('neither superblock verifies: not a database, or one whose creation never finished')
}
