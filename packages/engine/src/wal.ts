// M4.14 — the log file: 4 KiB blocks, each verifying itself (doc 26 §Our log,
// D-45).
//
// A block is a 20-byte header and 4,076 bytes of payload:
//
//   0  u32  CRC32C of bytes 4–4095
//   4  u32  salt — the database's, and a new one at every open
//   8  u64  LSN of the block's first payload byte (two u32s, as page LSNs are)
//  16  u16  payload bytes used
//  18  u16  offset of the first group that starts here, or 0xFFFF
//
// The LSN counts payload bytes, so it is the position in the stream of groups
// that `redo.ts` writes. Three rules make the log safe on storage that may tear
// a write or lose an unflushed one:
//
//   - **A block that has been written is never written again.** Making a
//     commit durable seals the block it ends in, padding included, and the next
//     group starts a new block. Rewriting a half-full block in place would put
//     an acknowledged commit inside a write that can tear.
//   - **Each block must continue the one before it**: the same salt, and an LSN
//     equal to the previous block's LSN plus its `used`. A block that fails its
//     checksum, belongs to another salt, or does not continue is where the log
//     ends — so a stale block from an earlier lap, or one written after a lost
//     one, can never be read as the next.
//   - **The salt changes at every open**, after a checkpoint that needs nothing
//     from the old log, and the log starts again at block 0 (SQLite's WAL
//     reset). Every block from before is then refused by its salt.
//
// The file is a ring of `blocks` blocks with no header: where the scan starts,
// and with which salt, is the superblock's to say.
import type { VfsFile } from '@myjs/vfs'
import { crc32c } from './crc32c.ts'
import { corruptLog, logFull } from './errors.ts'
import { decodeGroup, groupLength, type Group } from './redo.ts'

export const LOG_BLOCK = 4096
export const LOG_HEADER = 20
export const LOG_PAYLOAD = LOG_BLOCK - LOG_HEADER
const NO_GROUP = 0xffff
/** The longest log: 4 GiB. A superblock claiming more is corrupt, not a reason to allocate. */
export const LOG_BLOCKS_MAX = 1 << 20

export interface BlockHeader {
  readonly salt: number
  readonly lsn: number
  readonly used: number
  /** Payload offset of the first group that starts in this block, or `undefined`. */
  readonly firstGroup: number | undefined
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** Write a block's header and checksum. The payload is already in place. */
export function sealBlock(block: Uint8Array, h: BlockHeader): void {
  const v = view(block)
  v.setUint32(4, h.salt)
  v.setUint32(8, Math.floor(h.lsn / 2 ** 32))
  v.setUint32(12, h.lsn >>> 0)
  v.setUint16(16, h.used)
  v.setUint16(18, h.firstGroup ?? NO_GROUP)
  v.setUint32(0, crc32c(block, 4))
}

/** A block's header, or `undefined` for anything that is not a whole, sealed block. Any bytes may be passed. */
export function readBlock(block: Uint8Array): BlockHeader | undefined {
  if (block.length !== LOG_BLOCK) return undefined
  const v = view(block)
  if (v.getUint32(0) !== crc32c(block, 4)) return undefined
  const used = v.getUint16(16)
  const first = v.getUint16(18)
  if (used > LOG_PAYLOAD || (first !== NO_GROUP && first >= used)) return undefined
  return { salt: v.getUint32(4), lsn: v.getUint32(8) * 2 ** 32 + v.getUint32(12), used, firstGroup: first === NO_GROUP ? undefined : first }
}

/** Where a scan starts: the checkpoint the superblock records. */
export interface LogStart {
  readonly salt: number
  readonly blocks: number
  /** Ring index of the block holding `lsn`. */
  readonly block: number
  readonly lsn: number
}

/**
 * The log, open for appending. It exists only once recovery is over: the log
 * being replayed is read by `scanLog` and never written, so a replay cannot
 * seal a block in the middle of what it is reading.
 */
export class Log {
  readonly file: VfsFile
  readonly blocks: number
  readonly salt: number
  readonly #block = new Uint8Array(LOG_BLOCK)
  /** Block sequence numbers count up forever; a block's place in the ring is its number mod `blocks`. */
  #head = 0
  #headLsn: number
  #used = 0
  #firstGroup: number | undefined
  #tail = 0
  #tailLsn: number
  #written: number
  #durable: number
  /** The first LSN of each block from the tail to the head, by ring index. */
  readonly #starts: Float64Array

  private constructor(file: VfsFile, blocks: number, salt: number, lsn: number) {
    this.file = file
    this.blocks = blocks
    this.salt = salt
    this.#headLsn = this.#tailLsn = this.#written = this.#durable = lsn
    this.#starts = new Float64Array(blocks)
  }

  /** A log that begins at block 0 with LSN `lsn`. Nothing is written until a group is. */
  static restart(file: VfsFile, blocks: number, salt: number, lsn: number): Log {
    return new Log(file, blocks, salt, lsn)
  }

  /** The LSN the next group will start at. */
  get end(): number {
    return this.#headLsn + this.#used
  }

  /** Everything before this LSN has been flushed. */
  get durable(): number {
    return this.#durable
  }

  /** The fraction of the ring between the checkpoint and the head. */
  get pressure(): number {
    return this.#inUse() / this.blocks
  }

  /** Where the checkpoint is: the block a recovery would start from. */
  get tail(): { block: number; lsn: number } {
    return { block: this.#tail % this.blocks, lsn: this.#tailLsn }
  }

  /** Blocks from the tail to the head, both included. */
  #inUse(): number {
    return this.#head - this.#tail + 1
  }

  /** Append a group. Refused, with nothing written, if the ring cannot hold it and still seal its last block. */
  append(group: Uint8Array): { start: number; end: number } {
    const total = this.#used + group.length
    const blocksAfter = this.#inUse() + Math.floor(total / LOG_PAYLOAD) + (total % LOG_PAYLOAD > 0 ? 1 : 0)
    if (blocksAfter > this.blocks) {
      throw logFull(group.length, (this.blocks - this.#inUse()) * LOG_PAYLOAD + LOG_PAYLOAD - this.#used)
    }
    const start = this.end
    this.#firstGroup ??= this.#used
    for (let done = 0; done < group.length; ) {
      const n = Math.min(LOG_PAYLOAD - this.#used, group.length - done)
      this.#block.set(group.subarray(done, done + n), LOG_HEADER + this.#used)
      this.#used += n
      done += n
      if (this.#used === LOG_PAYLOAD) this.#emit()
    }
    return { start, end: this.end }
  }

  /** Write the block in progress, sealed and padded, so the next group starts a new one. */
  write(): void {
    if (this.#used > 0) this.#emit()
  }

  /** Write and make durable everything appended. */
  flush(): void {
    this.write()
    if (this.#durable < this.#written) {
      this.file.flush()
      this.#durable = this.#written
    }
  }

  /** The WAL rule: before a page stamped `lsn` is written, the log through `lsn` is durable. */
  flushTo(lsn: number): void {
    if (lsn > this.#durable) this.flush()
  }

  /** The block holding `lsn`, an LSN between the tail and the end. */
  positionOf(lsn: number): { seq: number; lsn: number } {
    if (lsn >= this.#headLsn) return { seq: this.#head, lsn }
    let seq = this.#head - 1
    while (seq > this.#tail && (this.#starts[seq % this.blocks] as number) > lsn) seq--
    return { seq, lsn }
  }

  /** An LSN about half way through what is in use: flushing every page dirtied before it frees about half the ring. */
  middle(): number {
    const seq = this.#tail + Math.floor(this.#inUse() / 2)
    const lsn = seq >= this.#head ? this.#headLsn : (this.#starts[seq % this.blocks] as number)
    return Math.max(lsn, this.#tailLsn)
  }

  /** Move the checkpoint. Called only once the superblock that records it is durable. */
  advanceTail(position: { seq: number; lsn: number }): void {
    this.#tail = position.seq
    this.#tailLsn = position.lsn
  }

  close(): void {
    this.file.close()
  }

  #emit(): void {
    sealBlock(this.#block, { salt: this.salt, lsn: this.#headLsn, used: this.#used, firstGroup: this.#firstGroup })
    this.file.writeBytes((this.#head % this.blocks) * LOG_BLOCK, this.#block)
    this.#starts[this.#head % this.blocks] = this.#headLsn
    this.#head++
    this.#headLsn += this.#used
    this.#written = this.#headLsn
    this.#used = 0
    this.#firstGroup = undefined
    this.#block.fill(0)
  }
}

/**
 * Every whole group from a checkpoint to the end of the log, in order.
 *
 * The end is the first block that does not verify or does not continue, and a
 * group the end cuts short is not yielded — an incomplete mini-transaction did
 * not happen. A group that is whole and does not decode is `ENGINE_CORRUPT_LOG`:
 * a block that passed its checksum was written that way, so it is not a tear.
 */
export function* scanLog(file: VfsFile, from: LogStart): Generator<Group> {
  const block = new Uint8Array(LOG_BLOCK)
  const queue = new ByteQueue()
  let at = from.lsn
  let expect = -1
  /** Blocks read but not yet parsed past, for the first-group cross-check. */
  const open: { lsn: number; end: number; first: number | undefined; seen: boolean }[] = []
  for (let i = 0; i < from.blocks; i++) {
    const index = (from.block + i) % from.blocks
    if (file.readBytes(index * LOG_BLOCK, block) !== LOG_BLOCK) break
    const h = readBlock(block)
    if (h === undefined || h.salt !== from.salt) break
    let payload: Uint8Array
    if (i === 0) {
      // The checkpoint's own block: it must hold the checkpoint's LSN, or it
      // is a block from before and the log has nothing after the checkpoint.
      if (h.lsn > from.lsn || from.lsn > h.lsn + h.used) break
      payload = block.subarray(LOG_HEADER + (from.lsn - h.lsn), LOG_HEADER + h.used)
    } else {
      if (h.lsn !== expect) break
      payload = block.subarray(LOG_HEADER, LOG_HEADER + h.used)
      open.push({ lsn: h.lsn, end: h.lsn + h.used, first: h.firstGroup === undefined ? undefined : h.lsn + h.firstGroup, seen: false })
    }
    expect = h.lsn + h.used
    queue.push(payload.slice())
    for (;;) {
      const length = groupLength(queue.peek(9))
      if (length === undefined || length > queue.length) {
        if (length !== undefined && length > from.blocks * LOG_PAYLOAD) throw corruptLog(`a group of ${length} bytes, longer than the log`)
        break
      }
      const group = { start: at, end: at + length, records: decodeGroup(queue.take(length)) }
      checkBoundaries(open, group.start, group.end)
      yield group
      at = group.end
    }
  }
}

/**
 * The cross-check `firstGroup` exists for: the first group to start in a block
 * starts where the block says, and no group spans a block's stated start. A
 * group length that the checksum cannot catch — one written wrong — is found
 * here rather than read as the bytes of the next group.
 */
function checkBoundaries(open: { lsn: number; end: number; first: number | undefined; seen: boolean }[], start: number, end: number): void {
  for (const b of open) {
    if (start >= b.lsn && start < b.end && !b.seen) {
      if (b.first !== start) throw corruptLog(`a group starts at ${start}; its block says ${b.first ?? 'none does'}`)
      b.seen = true
    }
    if (b.first !== undefined && b.first > start && b.first < end) throw corruptLog(`a group spans the group start ${b.first}`)
  }
  while (open.length > 0 && (open[0] as { end: number }).end <= end) open.shift()
}

/** Payload bytes from consecutive blocks, joined only when a whole group is taken. */
class ByteQueue {
  #chunks: Uint8Array[] = []
  length = 0

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.#chunks.push(chunk)
    this.length += chunk.length
  }

  /** Up to `n` bytes from the front, not consumed. */
  peek(n: number): Uint8Array {
    return this.#join(Math.min(n, this.length), false)
  }

  take(n: number): Uint8Array {
    return this.#join(n, true)
  }

  #join(n: number, consume: boolean): Uint8Array {
    const out = new Uint8Array(n)
    let done = 0
    let i = 0
    while (done < n) {
      const c = this.#chunks[i] as Uint8Array
      const k = Math.min(c.length, n - done)
      out.set(c.subarray(0, k), done)
      done += k
      if (consume) {
        if (k === c.length) this.#chunks.shift()
        else this.#chunks[0] = c.subarray(k)
      } else i++
    }
    if (consume) this.length -= n
    return out
  }
}
