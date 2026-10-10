// M4.20 — undo: roll pointers, undo records and the undo log (doc 25 §Our
// undo).
//
// Undo is kept per **index entry**, as redo is kept per page: a record says
// "index i: key k was inserted" or "index i: key k had value v". Rolling back,
// recovering and purging therefore need no catalog — they put a value back, or
// remove a key, by index id. What does need the schema, which overflow chains
// a value owns, is worked out by the index layer when the change is made and
// carried in the record as two lists: chains to free when the record is purged
// (owned by the old version only), and chains to free if it is rolled back
// (introduced by the new version). Every chain belongs to exactly one version,
// so each is freed exactly once, by exactly one of those lists.
//
// A record holds the old value whole, not a diff (doc 25's "differential"
// records): a value is at most a leaf cell, and its 14-byte header changes on
// every write, so a schema-blind diff would save little and make every walk
// and every rollback harder to reason about.
//
// The log is an append-only byte stream over a chain of overflow-format pages,
// from the transaction directory's overflow segment. A roll pointer addresses
// a record's first byte; a record may continue onto the next page.
import { Reader, Writer } from '@myjs/bytes'
import type { BufferPool } from './pool.ts'
import { EngineError } from './errors.ts'
import { decodeLayout, encodeLayout, type RecordLayout } from './record.ts'
import { DATA, NEXT, USED, capacity, type OverflowPages } from './overflow.ts'
import { PAGE_TYPE, initPage, pageType } from './page.ts'

// --- roll pointers ------------------------------------------------------------

/** Doc 25's `DB_ROLL_PTR`: 7 bytes. */
export const ROLL_PTR_SIZE = 7

export interface RollPtr {
  readonly isInsert: boolean
  readonly page: number
  readonly offset: number
}

/**
 * `trx0undo.ic`'s layout, byte for byte: bit 55 is_insert, bits 54–48 the undo
 * tablespace (always 0 here — there is one), 47–16 the page, 15–0 the offset.
 * All zero is "no previous version": page 0 is the superblock, never undo.
 */
export function writeRollPtr(out: Uint8Array, at: number, p: RollPtr | null): void {
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength)
  if (p === null) {
    out.fill(0, at, at + ROLL_PTR_SIZE)
    return
  }
  v.setUint8(at, p.isInsert ? 0x80 : 0)
  v.setUint32(at + 1, p.page)
  v.setUint16(at + 5, p.offset)
}

export function readRollPtr(bytes: Uint8Array, at: number): RollPtr | null {
  if (at < 0 || at + ROLL_PTR_SIZE > bytes.length) throw corruptUndo(`a roll pointer at ${at} runs past a ${bytes.length}-byte value`)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const page = v.getUint32(at + 1)
  if (page === 0) return null
  return { isInsert: (v.getUint8(at) & 0x80) !== 0, page, offset: v.getUint16(at + 5) }
}

/** The 56-bit integer doc 25 writes `roll_ptr` as, for the round-trip its item asks for. */
export function rollPtrBits(p: RollPtr): bigint {
  return (BigInt(p.isInsert ? 1 : 0) << 55n) | (BigInt(p.page) << 16n) | BigInt(p.offset)
}

// --- records ------------------------------------------------------------------

/** The entry did not exist before: rolling back removes it, and a reader that reaches this version finds nothing older. */
const IS_INSERT = 1
/** The new value was a delete-mark: purge removes the entry if the mark is still this transaction's. */
const PURGE_REMOVES = 2
/** Not an entry's change but a tree's: which trees rollback drops, and which purge does (M4.23). */
const TREES = 4

/** A change to one index entry. */
export interface EntryUndo {
  readonly isInsert: boolean
  readonly purgeRemoves: boolean
  readonly indexId: number
  readonly key: Uint8Array
  /** The value the change replaced, header included; `null` for an insert. */
  readonly old: Uint8Array | null
  readonly freeOnPurge: readonly Uint8Array[]
  readonly freeOnRollback: readonly Uint8Array[]
}

/**
 * A tree a DDL statement made or retired. A layout is carried for a clustered
 * tree, so dropping it can free the overflow chains its live values own —
 * the store keeps no schema, and this record is the one place that outlives
 * the catalog row describing the tree.
 */
export interface DroppedTree {
  readonly indexId: number
  readonly layout: RecordLayout | null
}

/**
 * DDL as undo (M4.23). CREATE TABLE leaves one per tree it makes, "drop on
 * rollback", in the mini-transaction that makes it, so a crash at any point
 * leaves no tree that nothing will drop. DROP TABLE leaves one "drop on
 * purge": the trees stay readable until no view can see the table, and purge's
 * oldest-first order means no older record still names them by then.
 */
export interface TreeUndo {
  readonly trees: { readonly onRollback: readonly DroppedTree[]; readonly onPurge: readonly DroppedTree[] }
}

export type UndoRecord = EntryUndo | TreeUndo

export const isTreeUndo = (r: UndoRecord): r is TreeUndo => 'trees' in r

const corruptUndo = (what: string): EngineError => new EngineError('ENGINE_CORRUPT_UNDO', what)

/** The one writer undo records are encoded in, reset each time (see `encodeGroup`). */
const undoWriter = new Writer(1024)

export function encodeUndo(r: UndoRecord): Uint8Array {
  const w = undoWriter
  w.reset()
  if (isTreeUndo(r)) {
    w.u8(TREES)
    for (const list of [r.trees.onRollback, r.trees.onPurge]) {
      w.lenEncInt(list.length)
      for (const t of list) {
        w.lenEncInt(t.indexId).u8(t.layout === null ? 0 : 1)
        if (t.layout !== null) encodeLayout(w, t.layout)
      }
    }
    return w.toBytes()
  }
  if (r.isInsert !== (r.old === null)) throw corruptUndo('an insert has no old value, and only an insert')
  w.u8((r.isInsert ? IS_INSERT : 0) | (r.purgeRemoves ? PURGE_REMOVES : 0))
  w.lenEncInt(r.indexId).lenEncBytes(r.key).lenEncBytes(r.old)
  for (const list of [r.freeOnPurge, r.freeOnRollback]) {
    w.lenEncInt(list.length)
    for (const ref of list) w.bytes(ref)
  }
  return w.toBytes()
}

/** Decode a record's body. Any bytes may be passed: the answer is a record or `ENGINE_CORRUPT_UNDO`. */
export function decodeUndo(bytes: Uint8Array): UndoRecord {
  try {
    const r = new Reader(bytes)
    const flags = r.u8()
    if (flags === TREES) {
      const lists: DroppedTree[][] = []
      for (let l = 0; l < 2; l++) {
        const n = Number(r.lenEncInt())
        if (n * 2 > r.remaining) throw corruptUndo('a tree list longer than its record')
        const list: DroppedTree[] = []
        for (let i = 0; i < n; i++) {
          const indexId = Number(r.lenEncInt())
          const has = r.u8()
          if (has > 1) throw corruptUndo(`a tree with layout flag ${has}`)
          list.push({ indexId, layout: has === 1 ? decodeLayout(r) : null })
        }
        lists.push(list)
      }
      if (r.remaining !== 0) throw corruptUndo('bytes after an undo record')
      return { trees: { onRollback: lists[0] as DroppedTree[], onPurge: lists[1] as DroppedTree[] } }
    }
    if ((flags & ~(IS_INSERT | PURGE_REMOVES)) !== 0) throw corruptUndo(`unknown undo flags ${flags}`)
    const indexId = Number(r.lenEncInt())
    const key = r.lenEncBytes()
    if (key === null) throw corruptUndo('an undo record with no key')
    const old = r.lenEncBytes()
    const lists: Uint8Array[][] = []
    for (let l = 0; l < 2; l++) {
      const n = Number(r.lenEncInt())
      if (n * 8 > r.remaining) throw corruptUndo('a ref list longer than its record')
      const list: Uint8Array[] = []
      for (let i = 0; i < n; i++) list.push(r.bytes(8).slice())
      lists.push(list)
    }
    if (r.remaining !== 0) throw corruptUndo('bytes after an undo record')
    const isInsert = (flags & IS_INSERT) !== 0
    if (isInsert !== (old === null)) throw corruptUndo('an insert has no old value, and only an insert')
    return { isInsert, purgeRemoves: (flags & PURGE_REMOVES) !== 0, indexId, key: key.slice(), old: old?.slice() ?? null, freeOnPurge: lists[0] as Uint8Array[], freeOnRollback: lists[1] as Uint8Array[] }
  } catch (e) {
    if (e instanceof EngineError && e.code === 'ENGINE_CORRUPT_UNDO') throw e
    throw corruptUndo(e instanceof Error ? e.message : String(e))
  }
}

// --- the log ------------------------------------------------------------------

/** A byte in an undo log: a page of its chain, and an offset in that page. */
export interface Position {
  readonly page: number
  readonly offset: number
}

/** What an abort of the mini-transaction that changed a log puts back. */
export interface UndoLogState {
  readonly tail: Position
  readonly count: number
}

const LENGTH = 4

export class UndoLog {
  readonly first: number
  /** Where each record starts, in order. */
  readonly records: Position[] = []
  #tail: Position

  private constructor(first: number, tail: Position) {
    this.first = first
    this.#tail = tail
  }

  /** A new, empty log on a page of its own. Inside a mini-transaction. */
  static create(pages: OverflowPages): UndoLog {
    const first = pages.allocate()
    pages.journal.write(first, (p) => initPage(p, first, PAGE_TYPE.OVERFLOW), true)
    return new UndoLog(first, { page: first, offset: DATA })
  }

  /**
   * A log as storage has it: its pages walked, its records found. A chain
   * longer than the file, a page that is not a log page, or a record that runs
   * past the log's end is `ENGINE_CORRUPT_UNDO`.
   */
  static open(pool: BufferPool, first: number, maxPages: number): UndoLog {
    const chain: { page: number; used: number }[] = []
    for (let page = first; page !== 0; ) {
      if (chain.length > maxPages) throw corruptUndo(`the undo log at ${first} loops`)
      const at = page
      page = pool.read(at, (p) => {
        if (pageType(p) !== PAGE_TYPE.OVERFLOW) throw corruptUndo(`page ${at} is not an undo page`)
        const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
        const used = v.getUint32(USED)
        if (used > capacity(pool.pageSize)) throw corruptUndo(`page ${at} claims ${used} bytes`)
        chain.push({ page: at, used })
        return v.getUint32(NEXT)
      })
    }
    const last = chain[chain.length - 1] as { page: number; used: number }
    const log = new UndoLog(first, { page: last.page, offset: DATA + last.used })
    // Walk the records by their lengths, page by page.
    let i = 0
    let offset = DATA
    const total = chain.reduce((n, c) => n + c.used, 0)
    let consumed = 0
    while (consumed < total) {
      while (offset - DATA >= (chain[i] as { used: number }).used) {
        i++
        offset = DATA
      }
      const start = { page: (chain[i] as { page: number }).page, offset }
      const length = new DataView(readBytes(pool, start, LENGTH).buffer).getUint32(0)
      if (consumed + LENGTH + length > total) throw corruptUndo(`a record at ${start.page}:${start.offset} runs past the log`)
      log.records.push(start)
      consumed += LENGTH + length
      // Advance by LENGTH + length bytes along the chain.
      let skip = LENGTH + length
      while (skip > 0) {
        const room = (chain[i] as { used: number }).used - (offset - DATA)
        if (skip < room) {
          offset += skip
          skip = 0
        } else {
          skip -= room
          i++
          offset = DATA
          if (i >= chain.length) break
        }
      }
    }
    return log
  }

  get state(): UndoLogState {
    return { tail: this.#tail, count: this.records.length }
  }

  /** Put back the state an aborted mini-transaction found. Its pages are the journal's to restore. */
  restore(s: UndoLogState): void {
    this.#tail = s.tail
    this.records.length = s.count
  }

  /** Append a record and return where it starts. Inside a mini-transaction. */
  append(pages: OverflowPages, record: UndoRecord): Position {
    const body = encodeUndo(record)
    const bytes = new Uint8Array(LENGTH + body.length)
    new DataView(bytes.buffer).setUint32(0, body.length)
    bytes.set(body, LENGTH)
    const cap = capacity(pages.pool.pageSize)
    let start: Position | undefined
    for (let done = 0; done < bytes.length; ) {
      if (this.#tail.offset - DATA === cap) {
        const next = pages.allocate()
        pages.journal.write(next, (p) => initPage(p, next, PAGE_TYPE.OVERFLOW), true)
        pages.journal.write(this.#tail.page, (p) => new DataView(p.buffer, p.byteOffset, p.byteLength).setUint32(NEXT, next))
        this.#tail = { page: next, offset: DATA }
      }
      start ??= this.#tail
      const n = Math.min(cap - (this.#tail.offset - DATA), bytes.length - done)
      const at = this.#tail
      pages.journal.write(at.page, (p) => {
        p.set(bytes.subarray(done, done + n), at.offset)
        new DataView(p.buffer, p.byteOffset, p.byteLength).setUint32(USED, at.offset - DATA + n)
      })
      this.#tail = { page: at.page, offset: at.offset + n }
      done += n
    }
    this.records.push(start as Position)
    return start as Position
  }

  read(pool: BufferPool, at: Position): UndoRecord {
    return readUndo(pool, at)
  }

  /** Keep the first `count` records and free every page wholly after them. Inside a mini-transaction. */
  truncate(pages: OverflowPages, count: number): void {
    const cut = this.records[count]
    if (cut === undefined) return
    const after = pages.journal.write(cut.page, (p) => {
      const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
      v.setUint32(USED, cut.offset - DATA)
      const next = v.getUint32(NEXT)
      v.setUint32(NEXT, 0)
      return next
    })
    for (let page = after; page !== 0; ) {
      const next = pages.pool.read(page, (p) => new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(NEXT))
      pages.free(page)
      page = next
    }
    this.#tail = cut
    this.records.length = count
  }

  /** Free every page. Inside a mini-transaction. */
  free(pages: OverflowPages): void {
    this.truncate(pages, 0)
    pages.free(this.first)
  }
}

/**
 * The record that starts at `at`, in any transaction's log — a reader
 * following a version chain does not know whose it is. Any position may be
 * passed: a bad one is `ENGINE_CORRUPT_UNDO`.
 */
export function readUndo(pool: BufferPool, at: Position): UndoRecord {
  const length = new DataView(readBytes(pool, at, LENGTH).buffer).getUint32(0)
  return decodeUndo(readBytes(pool, at, LENGTH + length).subarray(LENGTH))
}

/** The entry change a roll pointer names. A pointer at a tree record is corruption: nothing points at one. */
export function readEntryUndo(pool: BufferPool, at: Position): EntryUndo {
  const r = readUndo(pool, at)
  if (isTreeUndo(r)) throw corruptUndo(`a roll pointer to ${at.page}:${at.offset} names a tree record`)
  return r
}

/** `n` bytes from `at`, following the chain. */
function readBytes(pool: BufferPool, at: Position, n: number): Uint8Array {
  // Collected page by page, so a corrupt length allocates no more than the
  // chain actually holds before it runs off the log.
  const parts: Uint8Array[] = []
  let page = at.page
  let offset = at.offset
  for (let done = 0, hops = 0; done < n; hops++) {
    if (page === 0 || hops > n) throw corruptUndo(`a read of ${n} bytes at ${at.page}:${at.offset} runs off the log`)
    const step = pool.read(page, (p) => {
      if (pageType(p) !== PAGE_TYPE.OVERFLOW) throw corruptUndo(`page ${page} is not an undo page`)
      const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
      const end = DATA + v.getUint32(USED)
      if (offset < DATA || offset > end || end > p.length) throw corruptUndo(`offset ${offset} is outside page ${page}'s ${end - DATA} bytes`)
      const k = Math.min(end - offset, n - done)
      parts.push(p.slice(offset, offset + k))
      return { k, next: v.getUint32(NEXT) }
    })
    done += step.k
    if (done < n) {
      page = step.next
      offset = DATA
    }
  }
  if (parts.length === 1) return parts[0] as Uint8Array
  const out = new Uint8Array(n)
  let done = 0
  for (const part of parts) {
    out.set(part, done)
    done += part.length
  }
  return out
}
