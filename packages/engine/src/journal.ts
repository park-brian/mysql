// M4.15 — the mini-transaction: a group of page changes that happens entirely
// or not at all, in memory and on disk (doc 26 §Our log, D-47).
//
// Every page change in the engine goes through `write`, and every `write` sits
// inside `atomically`. The B+tree, the allocator and the overflow chains say
// *where* a change begins and ends and nothing more: the journal snapshots
// each page the first time a mini-transaction touches it, and at commit logs
// what differs (`redo.ts`). Nothing above the pool writes a log record.
//
//   - **Held pages.** A page the mini-transaction found in use stays pinned
//     until it ends, so the pool cannot write a change whose log record does
//     not exist yet. Its snapshot is its undo.
//   - **Fresh pages.** A page allocated here that was free before is not held:
//     if the mini-transaction is lost it is free again, so writing it early
//     harms nothing — which is what lets a 1 MB value be one mini-transaction
//     in a small pool. Two kinds of new page are held after all, because they
//     were *not* free before: one still resident (perhaps dirty from a
//     committed change), and one this mini-transaction freed. A fresh page is
//     stamped with the LSN this mini-transaction starts at, so the WAL rule
//     makes every earlier one durable before it is written — one of them may
//     have freed it.
//   - **A page's first change since it was written is logged as an image**,
//     so a page torn on its way to disk can be rebuilt from the log (D-46).
//   - **An error anywhere aborts the whole mini-transaction**: every held page
//     gets its snapshot back, fresh frames are dropped, and the state outside
//     pages — the allocator's view, the next index id — is restored by the
//     host. Nested calls join the outer one, and an error caught inside does
//     not un-abort it: a later write is refused rather than half-applied.
import type { FieldBytes } from './record.ts'
import { misuse } from './errors.ts'
import type { BufferPool } from './pool.ts'
import { diffPage, encodeGroup, samePage, type Meta, type Redo } from './redo.ts'
import type { Log } from './wal.ts'

/** What the store keeps outside pages, saved when a mini-transaction begins. */
export interface JournalHost {
  meta(): Meta
  save(): unknown
  restore(saved: unknown): void
  /** Called before a top-level mini-transaction begins: the moment a checkpoint may run. */
  beforeMtr(): void
}

interface Touch {
  /** The pinned frame of a held page; `null` for a fresh one. */
  readonly page: Uint8Array | null
  readonly before: Uint8Array | null
  readonly wasDirty: boolean
}

/** Before-images kept for reuse: more than a mini-transaction usually touches. */
const SPARE_IMAGES = 16

export class Journal {
  readonly pool: BufferPool
  log: Log | undefined
  readonly #host: JournalHost
  #depth = 0
  #aborted = false
  #start = 0
  #saved: unknown
  readonly #touched = new Map<number, Touch>()
  readonly #freed = new Set<number>()
  #rows: Redo[] = []
  /**
   * Before-images a finished mini-transaction no longer needs, for the next to
   * copy into: one row's change touches two or three pages, and a fresh copy
   * of each was most of an INSERT's garbage.
   */
  readonly #spare: Uint8Array[] = []

  constructor(pool: BufferPool, host: JournalHost) {
    this.pool = pool
    this.#host = host
  }

  /**
   * Mini-transactions committed so far. A scan that paused between two leaves
   * (D-77) compares it with what it saw, to know whether a page may have
   * changed under it.
   */
  get commits(): number {
    return this.#commits
  }

  #commits = 0

  /** Pages the open mini-transaction has changed, and holds until it ends. */
  get touched(): number {
    return this.#touched.size
  }

  /** Whether a mini-transaction is open. */
  get open(): boolean {
    return this.#depth > 0
  }

  /** Run `fn` as one mini-transaction, or as part of the one already open. */
  atomically<T>(fn: () => T): T {
    if (this.#depth === 0) this.#begin()
    else this.#check()
    this.#depth++
    try {
      const out = fn()
      if (this.#depth === 1) {
        this.#check()
        this.#commit()
      }
      return out
    } catch (e) {
      if (!this.#aborted) {
        this.#aborted = true
        this.#abort()
      }
      throw e
    } finally {
      if (--this.#depth === 0) this.#aborted = false
    }
  }

  /**
   * Change a page. `fresh` says the page was just allocated and the caller
   * initialises all of it: the frame is zeroed, not read.
   */
  write<T>(pageNo: number, change: (page: Uint8Array) => T, fresh = false): T {
    this.#check()
    let t = this.#touched.get(pageNo)
    if (t === undefined) {
      if (!fresh || this.pool.isResident(pageNo) || this.#freed.has(pageNo)) {
        const page = this.pool.fetch(pageNo)
        const spare = this.#spare.pop()
        const before = spare !== undefined && spare.length === page.length ? spare : new Uint8Array(page.length)
        before.set(page)
        t = { page, before, wasDirty: this.pool.isDirty(page) }
      } else {
        t = { page: null, before: null, wasDirty: false }
      }
      this.#touched.set(pageNo, t)
    }
    if (t.page !== null) {
      if (fresh) t.page.fill(0)
      return change(t.page)
    }
    const page = fresh ? this.pool.create(pageNo) : this.pool.fetch(pageNo)
    try {
      const out = change(page)
      this.pool.markDirty(page, this.#start, this.#start)
      return out
    } finally {
      this.pool.release(page)
    }
  }

  /** Note a freed page: if this mini-transaction allocates it again, it is held, not fresh. */
  freed(pageNo: number): void {
    if (this.#depth > 0) this.#freed.add(pageNo)
  }

  /** A row's logical images (D-25), and the transaction that changed it: redo ignores them, a change stream reads them. */
  row(indexId: number, trxId: number, before: readonly FieldBytes[] | null, after: readonly FieldBytes[] | null): void {
    this.#check()
    this.#rows.push({ type: 'row', indexId, trxId, before, after })
  }

  /** A transaction's commit, logged in the mini-transaction that makes it. */
  commitRecord(trxId: number): void {
    this.#check()
    this.#rows.push({ type: 'commit', trxId })
  }

  #check(): void {
    if (this.#depth === 0) throw misuse('a page changed outside a mini-transaction')
    if (this.#aborted) throw misuse('this mini-transaction has already failed and been rolled back')
  }

  #begin(): void {
    if (this.log === undefined) throw misuse('the journal has no log')
    this.#host.beforeMtr()
    this.#start = this.log.end
    this.#saved = this.#host.save()
  }

  #commit(): void {
    this.#commits++
    const records: Redo[] = []
    const logged: number[] = []
    for (const [pageNo, t] of this.#touched) {
      if (t.page === null) {
        records.push({ type: 'page', pageNo, image: true, runs: this.pool.read(pageNo, (p) => diffPage(null, p)) })
      } else {
        // A page clean before this change is logged whole: its image, not a diff.
        if (!t.wasDirty) {
          if (t.before !== null && samePage(t.before, t.page)) continue
          records.push({ type: 'page', pageNo, image: true, runs: diffPage(null, t.page) })
        } else {
          const runs = diffPage(t.before, t.page)
          if (runs.length === 0) continue
          records.push({ type: 'page', pageNo, image: false, runs })
        }
      }
      logged.push(pageNo)
    }
    if (records.length > 0 || this.#rows.length > 0) {
      records.push({ type: 'meta', ...this.#host.meta() }, ...this.#rows)
      const { start, end } = (this.log as Log).append(encodeGroup(records))
      for (const pageNo of logged) {
        const held = (this.#touched.get(pageNo) as Touch).page
        const page = held ?? this.pool.fetch(pageNo)
        this.pool.markDirty(page, end, start)
        if (held === null) this.pool.release(page)
      }
    }
    this.#finish()
  }

  #abort(): void {
    for (const [pageNo, t] of this.#touched) {
      if (t.page === null) {
        this.pool.discard(pageNo)
      } else {
        t.page.set(t.before as Uint8Array)
        if (!t.wasDirty) this.pool.markClean(t.page)
      }
    }
    this.#finish()
    this.#host.restore(this.#saved)
  }

  #finish(): void {
    for (const t of this.#touched.values()) {
      if (t.page !== null) this.pool.release(t.page)
      if (t.before !== null && this.#spare.length < SPARE_IMAGES) this.#spare.push(t.before)
    }
    this.#touched.clear()
    this.#freed.clear()
    this.#rows = []
  }
}
