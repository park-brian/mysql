// M4.20–M4.22 — transactions, read views and purge (doc 25 §Our undo).
//
// **One writer at a time** (D-08). A transaction is read-only until it first
// changes something; then it takes the writer slot and a trx id, and holds both
// until it ends. A second transaction that tries to write, or to make a locking
// read, is refused with `ENGINE_WRITER_BUSY` at once — a synchronous core
// cannot wait, so the async edge queues the statement and reports
// `ER_LOCK_WAIT_TIMEOUT` when `innodb_lock_wait_timeout` passes. With one
// writer there is no lock cycle and so no deadlock (Q-02): this engine raises
// 1213 only for a snapshot too old to keep (Q-09, below).
//
// **Readers never block.** A read view is doc 25's, field for field, and so is
// `isVisible`; with one writer its active set has at most one id, but the
// general test is what is checked. REPEATABLE READ takes its view at its first
// consistent read and keeps it; READ COMMITTED takes one per statement.
//
// **Every change by a transaction leaves an undo record**, appended to its log
// in the same mini-transaction as the change. Rolling back applies them newest
// first, one mini-transaction per record that also truncates the log past it,
// so a rollback a crash interrupts resumes where it stopped — and recovery
// rolls back whatever was open with exactly that path (M4.18).
//
// **Purge** takes committed transactions oldest first, once every open view can
// see them: it removes the entries they delete-marked, if the mark is still
// theirs, frees the chains only their old versions used, and frees their logs.
// The committed entries waiting for it are the history; `maxHistory` bounds
// them, in commits, by expiring the views that pin the oldest — the next read
// under one is `ER_LOCK_DEADLOCK`, which ORMs already retry (D-09).
//
// The transaction directory is a B+tree from a 48-bit trx id to the state and
// first page of that transaction's undo log. Its overflow segment holds the
// logs, so the tree's own allocation accounting covers them.
import type { BTree } from './btree.ts'
import { misuse, snapshotTooOld, writerBusy } from './errors.ts'
import type { Journal } from './journal.ts'
import { freeChain, type OverflowPages } from './overflow.ts'
import type { BufferPool } from './pool.ts'
import { UndoLog, isTreeUndo, readRollPtr, writeRollPtr, type DroppedTree, type RollPtr, type UndoRecord } from './undo.ts'

// --- the version header -------------------------------------------------------

/** A clustered value's prefix: flags, `DB_TRX_ID` (6 bytes), `DB_ROLL_PTR` (7) — doc 25's hidden columns. */
export const CLUSTERED_HEADER = 14
/** A secondary entry's value: flags and the trx id that last changed it. */
export const SECONDARY_HEADER = 7
const MARKED = 1

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

function writeU48(out: Uint8Array, at: number, n: number): void {
  view(out).setUint16(at, Math.floor(n / 2 ** 32))
  view(out).setUint32(at + 2, n >>> 0)
}

function readU48(b: Uint8Array, at: number): number {
  return view(b).getUint16(at) * 2 ** 32 + view(b).getUint32(at + 2)
}

/** A value's header — the same first seven bytes on a clustered value and a secondary entry. */
export interface Version {
  readonly marked: boolean
  readonly trxId: number
}

export function versionOf(value: Uint8Array): Version {
  if (value.length < SECONDARY_HEADER) throw misuse('a value with no version header')
  return { marked: ((value[0] as number) & MARKED) !== 0, trxId: readU48(value, 1) }
}

export function rollPtrOf(value: Uint8Array): RollPtr | null {
  return readRollPtr(value, SECONDARY_HEADER)
}

/** A clustered value: header, then the record. */
export function clusteredValue(marked: boolean, trxId: number, rollPtr: RollPtr | null, record: Uint8Array): Uint8Array {
  const out = new Uint8Array(CLUSTERED_HEADER + record.length)
  out[0] = marked ? MARKED : 0
  writeU48(out, 1, trxId)
  writeRollPtr(out, SECONDARY_HEADER, rollPtr)
  out.set(record, CLUSTERED_HEADER)
  return out
}

export function secondaryValue(marked: boolean, trxId: number): Uint8Array {
  const out = new Uint8Array(SECONDARY_HEADER)
  out[0] = marked ? MARKED : 0
  writeU48(out, 1, trxId)
  return out
}

const be48 = (n: number): Uint8Array => {
  const out = new Uint8Array(6)
  writeU48(out, 0, n)
  return out
}

// --- read views ---------------------------------------------------------------

export type Isolation = 'REPEATABLE READ' | 'READ COMMITTED'

/** Doc 25's read view (`read0types.h`). */
export class ReadView {
  /** The next trx id to be assigned when the view was made: anything at or above it is invisible. */
  readonly lowLimitId: number
  /** The smallest id active then: anything below it is visible. */
  readonly upLimitId: number
  readonly activeIds: readonly number[]
  readonly #creator: () => number
  /** Set by purge when this view pins more history than the store keeps. */
  expired = false

  constructor(lowLimitId: number, activeIds: readonly number[], creator: () => number) {
    this.lowLimitId = lowLimitId
    this.activeIds = [...activeIds].sort((a, b) => a - b)
    this.upLimitId = this.activeIds[0] ?? lowLimitId
    this.#creator = creator
  }

  /** Our own transaction's id — read through it, so a transaction that starts writing after its view sees its own changes. */
  get creatorTrxId(): number {
    return this.#creator()
  }

  isVisible(trxId: number): boolean {
    if (trxId !== 0 && trxId === this.creatorTrxId) return true
    if (trxId < this.upLimitId) return true
    if (trxId >= this.lowLimitId) return false
    return !this.activeIds.includes(trxId)
  }
}

// --- the transaction system ---------------------------------------------------

/** What the transaction system needs from the store. */
export interface TrxHost {
  readonly pool: BufferPool
  readonly journal: Journal
  /** The transaction directory. */
  readonly trxTree: BTree
  /** An index by id: rollback and purge act on entries without knowing their schema. */
  tree(indexId: number): BTree
  /** Free a tree and everything it owns, inside the caller's mini-transaction (a DDL undo record's). */
  drop(tree: DroppedTree): void
  /** The durability point: what `flushLogAtTrxCommit` says a commit costs. */
  durable(): void
  readonly pageCount: number
}

const ACTIVE = 1
const COMMITTED = 2
/** Committed transactions purge looks at after each commit. */
const PURGE_BATCH = 4

export interface TrxStats {
  /** Committed transactions whose undo purge has not yet freed. */
  readonly historyLength: number
  readonly openViews: number
  readonly expiredViews: number
  /** The writer's trx id, or 0. */
  readonly writer: number
  readonly nextTrxId: number
}

export class TrxSys {
  readonly host: TrxHost
  nextTrxId: number
  maxHistory: number
  writer: Trx | undefined
  readonly #views = new Set<ReadView>()
  /** Committed transactions, oldest first, with their logs once opened. */
  readonly #history: { id: number; first: number; log?: UndoLog }[] = []

  constructor(host: TrxHost, nextTrxId: number, maxHistory: number) {
    this.host = host
    this.nextTrxId = nextTrxId
    this.maxHistory = maxHistory
  }

  begin(isolation: Isolation = 'REPEATABLE READ'): Trx {
    return new Trx(this, isolation)
  }

  /** A view as of now, for `trx` (or for a single read when `undefined`). */
  openView(trx: Trx | undefined): ReadView {
    const writer = this.writer !== undefined && this.writer !== trx && this.writer.id !== 0 ? [this.writer.id] : []
    const v = new ReadView(this.nextTrxId, writer, () => trx?.id ?? 0)
    this.#views.add(v)
    return v
  }

  closeView(v: ReadView): void {
    this.#views.delete(v)
  }

  /** One change as its own transaction: begun, made, committed — or rolled back. */
  autocommit<T>(change: (trx: Trx) => T): T {
    if (this.host.journal.open) throw misuse('an autocommit change inside a mini-transaction; pass a transaction')
    const trx = this.begin('READ COMMITTED')
    let out: T
    try {
      out = change(trx)
    } catch (e) {
      trx.rollback()
      throw e
    }
    trx.commit()
    return out
  }

  /** The undo pages' allocator: the transaction directory's overflow segment. */
  get undoPages(): OverflowPages {
    return this.host.trxTree.overflowPages()
  }

  stats(): TrxStats {
    let expired = 0
    for (const v of this.#views) if (v.expired) expired++
    return { historyLength: this.#history.length, openViews: this.#views.size, expiredViews: expired, writer: this.writer?.id ?? 0, nextTrxId: this.nextTrxId }
  }

  /**
   * Recovery's half: every transaction the directory says was open is rolled
   * back, through the same per-record path a live rollback takes, and the
   * committed ones become the history. The next trx id is past every id the
   * directory holds, whatever the last META said. Returns how many it rolled
   * back.
   */
  recover(): number {
    const active: { id: number; first: number }[] = []
    for (const [key, value] of this.host.trxTree.entries()) {
      const id = readU48(key, 0)
      const first = view(value).getUint32(1)
      if (value[0] === ACTIVE) active.push({ id, first })
      else this.#history.push({ id, first })
      this.nextTrxId = Math.max(this.nextTrxId, id + 1)
    }
    for (const a of active) {
      const trx = new Trx(this, 'READ COMMITTED')
      trx.adopt(a.id, UndoLog.open(this.host.pool, a.first, this.host.pageCount))
      trx.rollback()
    }
    return active.length
  }

  committed(id: number, log: UndoLog): void {
    this.#history.push({ id, first: log.first, log })
  }

  /**
   * Purge up to `limit` committed transactions, oldest first, while every
   * open view that has not expired can see them. Before that, if the history
   * is longer than `maxHistory`, the views pinning its oldest entries expire.
   * Returns how many were purged.
   */
  purge(limit = Infinity): number {
    if (this.host.journal.open) throw misuse('purge inside a mini-transaction')
    for (let i = 0; this.#history.length - i > this.maxHistory; i++) {
      const id = (this.#history[i] as { id: number }).id
      for (const v of this.#views) if (!v.isVisible(id)) v.expired = true
    }
    let done = 0
    while (done < limit) {
      const oldest = this.#history[0]
      if (oldest === undefined) break
      if ([...this.#views].some((v) => !v.expired && !v.isVisible(oldest.id))) break
      this.#purgeOne(oldest)
      this.#history.shift()
      done++
    }
    return done
  }

  #purgeOne(t: { id: number; first: number; log?: UndoLog }): void {
    const { pool, journal } = this.host
    const log = t.log ?? UndoLog.open(pool, t.first, this.host.pageCount)
    const pages = this.undoPages
    while (log.records.length > 0) {
      const i = log.records.length - 1
      this.#step(log, () => {
        const r = log.read(pool, log.records[i] as { page: number; offset: number })
        if (isTreeUndo(r)) {
          for (const dropped of r.trees.onPurge) this.host.drop(dropped)
          log.truncate(pages, i)
          return
        }
        const tree = this.host.tree(r.indexId)
        if (r.purgeRemoves) {
          const current = tree.get(r.key)
          // Removed only if the mark is still this transaction's: a later one
          // may have re-inserted the entry, or marked it again itself.
          if (current !== undefined) {
            const v = versionOf(current)
            if (v.marked && v.trxId === t.id) tree.delete(r.key)
          }
        }
        // Only an undo record's own list frees a chain — never the refs found in
        // the entry removed above — so each chain is freed exactly once.
        for (const ref of r.freeOnPurge) freeChain(tree.overflowPages(), ref)
        log.truncate(pages, i)
      })
    }
    journal.atomically(() => {
      this.host.trxTree.delete(be48(t.id))
      log.free(pages)
    })
  }

  /** One mini-transaction over a log, with the log's in-memory state put back if it aborts. */
  #step(log: UndoLog, change: () => void): void {
    const before = log.state
    try {
      this.host.journal.atomically(change)
    } catch (e) {
      log.restore(before)
      throw e
    }
  }

  /** Apply one undo record backwards: put the old value back, or remove what was inserted. */
  rollBack(log: UndoLog, i: number): void {
    this.#step(log, () => {
      const r: UndoRecord = log.read(this.host.pool, log.records[i] as { page: number; offset: number })
      if (isTreeUndo(r)) {
        for (const dropped of r.trees.onRollback) this.host.drop(dropped)
        log.truncate(this.undoPages, i)
        return
      }
      const tree = this.host.tree(r.indexId)
      if (r.old === null || this.#markedByPurged(r.old)) tree.delete(r.key)
      else tree.put(r.key, r.old)
      for (const ref of r.freeOnRollback) freeChain(tree.overflowPages(), ref)
      log.truncate(this.undoPages, i)
    })
  }

  /**
   * A delete-marked value whose transaction purge has already finished: its
   * chains are freed and nothing will purge the mark again. Rolling back a
   * re-insert over it removes the entry rather than restoring a mark that
   * would never go — no view can see the row, since purge waited for every
   * view to see its delete.
   */
  #markedByPurged(old: Uint8Array): boolean {
    const v = versionOf(old)
    return v.marked && v.trxId !== this.writer?.id && !this.#history.some((h) => h.id === v.trxId)
  }

  /** The end of a transaction that wrote nothing it keeps: its directory entry and log go. */
  forget(id: number, log: UndoLog): void {
    this.host.journal.atomically(() => {
      this.host.trxTree.delete(be48(id))
      log.free(this.undoPages)
    })
  }
}

// --- transactions -------------------------------------------------------------

export type TrxState = 'active' | 'committed' | 'rolled back'

export class Trx {
  readonly isolation: Isolation
  /** 0 until the first write. */
  id = 0
  readonly #sys: TrxSys
  #state: TrxState = 'active'
  #view: ReadView | undefined
  #log: UndoLog | undefined
  /** Holds the writer slot: it has written, or made a locking read. */
  #locked = false

  constructor(sys: TrxSys, isolation: Isolation) {
    this.#sys = sys
    this.isolation = isolation
  }

  get state(): TrxState {
    return this.#state
  }

  /** The view a consistent read uses: REPEATABLE READ's from its first read on, READ COMMITTED's for this statement. */
  get view(): ReadView {
    this.#active()
    this.#view ??= this.#sys.openView(this)
    if (this.#view.expired) throw snapshotTooOld()
    return this.#view
  }

  /** A statement boundary: under READ COMMITTED the next read takes a new view. */
  statement(): void {
    if (this.isolation === 'READ COMMITTED') this.#dropView()
  }

  /** Take the writer slot without writing — a locking read (`FOR UPDATE`), held to the end. */
  lock(): void {
    this.#active()
    const w = this.#sys.writer
    if (w !== undefined && w !== this) throw writerBusy()
    this.#sys.writer = this
    this.#locked = true
  }

  /**
   * Make a change as this transaction: the writer slot is taken, the first
   * write assigns an id and opens the undo log, and `change` runs inside one
   * mini-transaction with them. An error leaves everything as it was.
   */
  write<T>(change: () => T): T {
    this.lock()
    const sys = this.#sys
    const first = this.id === 0
    const before = this.#log?.state
    try {
      return sys.host.journal.atomically(() => {
        if (this.id === 0) {
          this.id = sys.nextTrxId++
          this.#log = UndoLog.create(sys.undoPages)
          sys.host.trxTree.put(be48(this.id), entry(ACTIVE, this.#log.first))
        }
        return change()
      })
    } catch (e) {
      if (first) {
        this.id = 0
        this.#log = undefined
      } else if (before !== undefined) this.#log?.restore(before)
      throw e
    }
  }

  /** Append an undo record for a change being made inside `write`, and return its roll pointer. */
  undo(record: UndoRecord): RollPtr {
    if (this.#log === undefined || !this.#sys.host.journal.open) throw misuse('an undo record outside a write')
    const at = this.#log.append(this.#sys.undoPages, record)
    return { isInsert: !isTreeUndo(record) && record.isInsert, page: at.page, offset: at.offset }
  }

  /** A point `rollbackTo` can return to. */
  savepoint(): number {
    this.#active()
    return this.#log?.records.length ?? 0
  }

  rollbackTo(savepoint: number): void {
    this.#active()
    const log = this.#log
    if (log === undefined) return
    if (savepoint > log.records.length) throw misuse('a savepoint this transaction has already rolled back past')
    for (let i = log.records.length - 1; i >= savepoint; i--) this.#sys.rollBack(log, i)
  }

  commit(): void {
    this.#active()
    const sys = this.#sys
    if (this.id !== 0) {
      if (sys.host.journal.open) throw misuse('commit inside a mini-transaction')
      const log = this.#log as UndoLog
      sys.host.journal.atomically(() => {
        sys.host.trxTree.put(be48(this.id), entry(COMMITTED, log.first))
        sys.host.journal.commitRecord(this.id)
      })
      sys.committed(this.id, log)
    }
    this.#end('committed')
    if (this.id !== 0) {
      sys.host.durable()
      sys.purge(PURGE_BATCH)
    }
  }

  rollback(): void {
    if (this.#state !== 'active') return
    const sys = this.#sys
    if (this.id !== 0) {
      if (sys.host.journal.open) throw misuse('rollback inside a mini-transaction')
      this.rollbackTo(0)
      sys.forget(this.id, this.#log as UndoLog)
    }
    this.#end('rolled back')
  }

  /** Recovery: become the transaction a crash left open, so `rollback` can finish it. */
  adopt(id: number, log: UndoLog): void {
    this.id = id
    this.#log = log
    this.#sys.writer = this
    this.#locked = true
  }

  #end(state: TrxState): void {
    this.#dropView()
    if (this.#locked && this.#sys.writer === this) this.#sys.writer = undefined
    this.#locked = false
    this.#state = state
  }

  #dropView(): void {
    if (this.#view !== undefined) this.#sys.closeView(this.#view)
    this.#view = undefined
  }

  #active(): void {
    if (this.#state !== 'active') throw misuse(`the transaction is ${this.#state}`)
  }
}

function entry(state: number, first: number): Uint8Array {
  const out = new Uint8Array(5)
  out[0] = state
  view(out).setUint32(1, first)
  return out
}
