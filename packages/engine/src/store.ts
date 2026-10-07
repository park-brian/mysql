// D-41 — a database: a data file and a log file (doc 21 §Our file, doc 26
// §Our log).
//
// Every change is a mini-transaction (`journal.ts`), logged before any page it
// touched can reach the data file. `commit()` is the durability point and
// honours `flushLogAtTrxCommit` exactly as InnoDB's knob does (M4.19); `sync()`
// is the once-a-second flush that knob's settings 0 and 2 promise, called by
// the host, because a synchronous core owns no timer (ground rule 3).
//
// Transactions (M4.20–M4.22) are `trx.ts`'s: `begin()` hands one out, and the
// store gives it what it needs — the journal, the transaction directory, and
// any index by id for rollback and purge, which act on entries without knowing
// their schema. Opening a store rolls back the transaction a crash left open.
//
// A checkpoint writes the pages a recovery would otherwise replay, then the
// other superblock slot, and only then lets the log reuse the space before it
// (M4.17). One runs before a mini-transaction whenever the log is half full or
// three quarters of the pool is dirty — in a synchronous engine, blocking a
// commit on a backlog is simply doing the work first (M4.3). `open` recovers,
// then checkpoints everything and starts the log afresh under a new salt.
import type { VfsFile } from '@myjs/vfs'
import { Allocator, type AllocatorState } from './alloc.ts'
import { BTree, type TreeOptions } from './btree.ts'
import { EngineError, corrupt, misuse } from './errors.ts'
import { Journal } from './journal.ts'
import { BufferPool, type PoolOptions } from './pool.ts'
import { validateIndexPage } from './index-page.ts'
import { PAGE_TYPE, pageType } from './page.ts'
import { chainPages, decodeRef } from './overflow.ts'
import { externalRefs, type RecordLayout } from './record.ts'
import { recover } from './recovery.ts'
import type { Group } from './redo.ts'
import { readSuperblocks, writeSuperblock } from './superblock.ts'
import { CLUSTERED_HEADER, TrxSys, versionOf, type Isolation, type Trx, type TrxStats } from './trx.ts'
import { LOG_BLOCKS_MAX, Log, scanLog } from './wal.ts'

export interface StoreOptions {
  /** Buffer pool frames. Default 256 — 4 MiB at 16 KiB pages. */
  readonly frames?: number
  readonly promoteAfter?: number
  /**
   * The log's length in 4 KiB blocks. Default 4,096 — 16 MiB. A database
   * takes the size it is opened with, since an open starts the log afresh. A
   * mini-transaction must fit in half of it, and a large value is logged
   * whole, so this bounds the largest row.
   */
  readonly logBlocks?: number
  /**
   * `innodb_flush_log_at_trx_commit`. `1`, the default: every `commit()`
   * makes the log durable. `2`: it writes the log, and `sync()` flushes it.
   * `0`: `sync()` writes and flushes it.
   */
  readonly flushLogAtTrxCommit?: 0 | 1 | 2
  /**
   * The most committed transactions purge may be held behind (Q-09). Past it,
   * the read views pinning the oldest expire, and their next read is
   * `ER_LOCK_DEADLOCK`. Measured in commits, because commits are what grow the
   * store; a wall-clock limit belongs to the host. Default 10,000.
   */
  readonly maxHistory?: number
}

const DIRECTORY = 0
/** The transaction directory's index id: reserved, and never handed out by `createTree`. */
export const TRX_INDEX = 0xffffff
/**
 * Index ids below this are reserved for trees whose id is known before the
 * store is read — the counters here, and the catalog's system tables
 * (`catalog.ts`): the bootstrap descriptor is those ids, fixed in code and
 * pinned by `FORMAT_VERSION` (M4.23). `createTree` hands out ids from here up.
 */
export const FIRST_USER_INDEX = 16
/** The counters: a raw tree from index id and slot to a big-endian `u64`. */
export const COUNTERS_INDEX = 1
const DEFAULT_LOG_BLOCKS = 4096

const be32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}
const readBe32 = (b: Uint8Array): number => new DataView(b.buffer, b.byteOffset, 4).getUint32(0)

const counterKey = (indexId: number, slot: number): Uint8Array => {
  const out = new Uint8Array(5)
  new DataView(out.buffer).setUint32(0, indexId)
  out[4] = slot
  return out
}

interface Saved {
  readonly alloc: AllocatorState | undefined
  readonly nextIndexId: number
  readonly nextTrxId: number
}

export class Store {
  readonly file: VfsFile
  readonly logFile: VfsFile
  readonly pool: BufferPool
  readonly journal: Journal
  readonly #policy: 0 | 1 | 2
  readonly #logBlocks: number
  readonly #scratch: Uint8Array
  #alloc: Allocator | undefined
  #directory: BTree | undefined
  #trxTree: BTree | undefined
  #trx: TrxSys | undefined
  #log: Log | undefined
  readonly #trees = new Map<number, BTree>()
  #drops = 0
  #nextIndexId: number
  #generation: number
  #nextTrxId: number
  readonly #maxHistory: number

  private constructor(file: VfsFile, logFile: VfsFile, pool: BufferPool, options: StoreOptions, logBlocks: number, nextIndexId: number, generation: number, nextTrxId: number) {
    if (!Number.isInteger(logBlocks) || logBlocks < 4 || logBlocks > LOG_BLOCKS_MAX) throw misuse(`a log of ${logBlocks} blocks; it takes 4 to ${LOG_BLOCKS_MAX}`)
    this.file = file
    this.logFile = logFile
    this.pool = pool
    this.#policy = options.flushLogAtTrxCommit ?? 1
    this.#logBlocks = logBlocks
    this.#scratch = new Uint8Array(file.pageSize)
    this.#nextIndexId = nextIndexId
    this.#generation = generation
    this.#nextTrxId = nextTrxId
    this.#maxHistory = options.maxHistory ?? 10_000
    this.journal = new Journal(pool, {
      meta: () => ({ pageCount: this.#alloc?.pageCount ?? 0, nextIndexId: this.#nextIndexId, nextTrxId: this.#nextTrxIdNow() }),
      save: (): Saved => ({ alloc: this.#alloc?.save(), nextIndexId: this.#nextIndexId, nextTrxId: this.#nextTrxIdNow() }),
      restore: (saved) => {
        const s = saved as Saved
        this.#nextIndexId = s.nextIndexId
        if (this.#trx !== undefined) this.#trx.nextTrxId = s.nextTrxId
        if (s.alloc !== undefined) this.#alloc?.restore(s.alloc)
      },
      beforeMtr: () => this.#relieve(),
    })
  }

  /** Format a new, empty database. */
  static create(file: VfsFile, logFile: VfsFile, options: StoreOptions = {}): Store {
    if (file.size() !== 0 || logFile.size() !== 0) throw misuse('Store.create on a file that is not empty')
    const store = new Store(file, logFile, new BufferPool(file, poolOptions(options)), options, options.logBlocks ?? DEFAULT_LOG_BLOCKS, FIRST_USER_INDEX, 0, 1)
    store.#attach(Log.restart(logFile, store.#logBlocks, 1, 0))
    store.journal.atomically(() => {
      store.#alloc = Allocator.format(store.pool, store.journal)
      store.#directory = BTree.create(store, DIRECTORY)
      store.#trxTree = BTree.create(store, TRX_INDEX)
      store.createTree({ indexId: COUNTERS_INDEX })
    })
    store.#startTrx(1)
    store.checkpoint()
    return store
  }

  /**
   * Open a database, recovering it if it was not closed. Its superblock is
   * verified and refused if it is not one this build reads.
   */
  static open(file: VfsFile, logFile: VfsFile, options: StoreOptions = {}): Store {
    const s = readSuperblocks(file)
    const pool = new BufferPool(file, poolOptions(options))
    const r = recover(pool, logFile, s)
    const store = new Store(file, logFile, pool, options, options.logBlocks ?? s.logBlocks, r.meta.nextIndexId, s.generation, r.meta.nextTrxId)
    const alloc = (store.#alloc = Allocator.open(pool, store.journal, r.meta.pageCount))
    if (r.unreadable.size > 0) {
      const used = alloc.usedPages()
      for (const pageNo of r.unreadable) if (used.has(pageNo)) throw corrupt(pageNo, 'torn on disk, and the log holds no image of it')
    }
    store.#directory = new BTree(store, DIRECTORY, s.directoryRoot)
    store.#trxTree = new BTree(store, TRX_INDEX, s.trxRoot)
    // Nothing reaches the new log until the checkpoint below is durable, so a
    // crash before then recovers from the old one again. Rolling back what was
    // open writes to the new log, so it comes after; a crash during it leaves
    // the transaction open, and the next open finishes the rollback.
    store.#attach(Log.restart(logFile, store.#logBlocks, (s.salt + 1) >>> 0, r.end))
    store.checkpoint()
    store.recovered = { groups: r.groups, rolledBack: store.#startTrx(r.meta.nextTrxId).recover() }
    return store
  }

  /** What opening it found: log groups replayed, and transactions rolled back. */
  recovered: { readonly groups: number; readonly rolledBack: number } = { groups: 0, rolledBack: 0 }

  get alloc(): Allocator {
    return this.#alloc ?? fail()
  }

  /** Index 0: big-endian index id → big-endian root page. */
  get directory(): BTree {
    return this.#directory ?? fail()
  }

  /** The end of the log: the LSN the next change will be stamped after. No page may be stamped later. */
  get lsn(): number {
    return this.#logOpen().end
  }

  /** The transaction directory (M4.20): trx id → state and undo log. */
  get trxTree(): BTree {
    return this.#trxTree ?? fail()
  }

  get transactions(): TrxSys {
    return this.#trx ?? fail()
  }

  /** A transaction. Read-only until its first write, which makes it the writer (D-08). */
  begin(isolation: Isolation = 'REPEATABLE READ'): Trx {
    return this.transactions.begin(isolation)
  }

  /** Purge every committed transaction no open view needs, or up to `limit` of them. */
  purge(limit = Infinity): number {
    return this.transactions.purge(limit)
  }

  stats(): TrxStats & { readonly pageCount: number; readonly dirtyPages: number } {
    return { ...this.transactions.stats(), pageCount: this.alloc.pageCount, dirtyPages: this.pool.dirtyCount }
  }

  /** Run `fn` as one mini-transaction: every change in it survives a crash, or none does. */
  atomically<T>(fn: () => T): T {
    return this.journal.atomically(fn)
  }

  /**
   * A new, empty index, with its root recorded in the directory. A reserved
   * id (below `FIRST_USER_INDEX`) may be asked for, once.
   */
  createTree(options: TreeOptions & { readonly indexId?: number } = {}): BTree {
    const reserved = options.indexId
    if (reserved !== undefined && (!Number.isInteger(reserved) || reserved <= DIRECTORY || reserved >= FIRST_USER_INDEX)) throw misuse(`index id ${reserved} is not a reserved one`)
    if (reserved !== undefined && this.hasTree(reserved)) throw misuse(`index ${reserved} exists`)
    if (this.#nextIndexId >= TRX_INDEX) throw misuse('index ids are exhausted')
    return this.journal.atomically(() => {
      const tree = BTree.create(this, reserved ?? this.#nextIndexId++, options)
      this.directory.put(be32(tree.indexId), be32(tree.root))
      return tree
    })
  }

  openTree(indexId: number, options: TreeOptions = {}): BTree {
    const root = this.directory.get(be32(indexId))
    if (root === undefined) throw misuse(`no index ${indexId}`)
    return new BTree(this, indexId, readBe32(root), options)
  }

  /**
   * How many trees have been dropped since the store opened: a handle that
   * holds trees re-checks they exist only when this has moved, so a check
   * costs nothing until there is something to find.
   */
  get drops(): number {
    return this.#drops
  }

  hasTree(indexId: number): boolean {
    return this.directory.get(be32(indexId)) !== undefined
  }

  /**
   * Free a tree: its pages, the overflow chains its live values own — found
   * through `layout`, for a clustered tree — its counters and its directory
   * entry. One mini-transaction, or part of the caller's: freeing a page
   * changes only the allocation map, so even a large tree's drop logs a few
   * page diffs. A delete-marked value's chains are not its own (D-50); by the
   * time a tree is dropped, the undo records that owned them have been purged
   * or rolled back (`undo.ts`, `TreeUndo`).
   */
  dropTree(indexId: number, layout: RecordLayout | null = null): void {
    if (indexId === DIRECTORY || indexId === TRX_INDEX || indexId === COUNTERS_INDEX) throw misuse(`index ${indexId} is the store's own`)
    this.#drops++
    this.journal.atomically(() => {
      const tree = this.openTree(indexId)
      const refs: Uint8Array[] = []
      const pages = tree.nodePages(
        layout === null
          ? undefined
          : (value) => {
              if (!versionOf(value).marked) refs.push(...externalRefs(layout, value.subarray(CLUSTERED_HEADER)))
            },
      )
      for (const ref of refs) pages.push(...chainPages(this.pool, decodeRef(ref)))
      for (const page of pages) this.alloc.free(page)
      this.directory.delete(be32(indexId))
      const counters = this.#counters()
      for (const [key] of [...counters.entries({ from: be32(indexId), to: be32(indexId + 1) })]) counters.delete(key)
      this.#trees.delete(indexId)
    })
  }

  /**
   * The next `count` values of a counter — an AUTO_INCREMENT column's, or a
   * hidden row id's — as the first of them. Its own mini-transaction, which
   * must not be inside another: a value handed out is gone, whether or not the
   * statement that took it commits, as InnoDB's are (M5.8). Redo order makes it
   * durable before any row that uses it. A counter starts at 1.
   */
  takeCounter(indexId: number, slot: number, count = 1): bigint {
    if (this.journal.open) throw misuse('a counter taken inside a mini-transaction would be given back by its abort')
    if (!Number.isInteger(count) || count < 1) throw misuse(`a count of ${count}`)
    return this.journal.atomically(() => {
      const first = this.counter(indexId, slot)
      this.#setCounter(indexId, slot, first + BigInt(count))
      return first
    })
  }

  /** The value `takeCounter` would hand out next. */
  counter(indexId: number, slot: number): bigint {
    const v = this.#counters().get(counterKey(indexId, slot))
    return v === undefined ? 1n : new DataView(v.buffer, v.byteOffset, 8).getBigUint64(0)
  }

  /** Move a counter past `value`, if it is not already: an explicit value larger than any handed out. Joins the caller's mini-transaction. */
  raiseCounter(indexId: number, slot: number, value: bigint): void {
    if (value + 1n > this.counter(indexId, slot)) this.journal.atomically(() => this.#setCounter(indexId, slot, value + 1n))
  }

  #setCounter(indexId: number, slot: number, next: bigint): void {
    if (next > 0xffffffffffffffffn) throw misuse('a counter past 2^64')
    const out = new Uint8Array(8)
    new DataView(out.buffer).setBigUint64(0, next)
    this.#counters().put(counterKey(indexId, slot), out)
  }

  #counters(): BTree {
    let tree = this.#trees.get(COUNTERS_INDEX)
    if (tree === undefined) this.#trees.set(COUNTERS_INDEX, (tree = this.openTree(COUNTERS_INDEX)))
    return tree
  }

  /** Every index's id and root, from the directory. */
  *trees(): Generator<{ indexId: number; root: number }> {
    for (const [id, root] of this.directory.entries()) yield { indexId: readBe32(id), root: readBe32(root) }
  }

  /** The durability point: what `flushLogAtTrxCommit` says a commit costs. */
  commit(): void {
    if (this.#policy === 1) this.#logOpen().flush()
    else if (this.#policy === 2) this.#logOpen().write()
  }

  /** Write and flush the log: the once-a-second tick settings 0 and 2 rely on. */
  sync(): void {
    this.#logOpen().flush()
  }

  /**
   * Write every page dirtied before `target`, then record a checkpoint at the
   * oldest change still only in the log. With no target, every dirty page is
   * written and the checkpoint is the end of the log.
   */
  checkpoint(target = Infinity): void {
    if (this.journal.open) throw misuse('a checkpoint inside a mini-transaction')
    const log = this.#logOpen()
    log.flush()
    this.pool.flushBefore(target)
    this.file.flush()
    const at = log.positionOf(Math.min(this.pool.oldestDirty() ?? Infinity, log.end))
    this.#generation++
    writeSuperblock(this.#scratch, {
      pageSize: this.file.pageSize,
      generation: this.#generation,
      salt: log.salt,
      logBlocks: log.blocks,
      checkpointLsn: at.lsn,
      checkpointBlock: at.seq % log.blocks,
      pageCount: this.alloc.pageCount,
      nextIndexId: this.#nextIndexId,
      directoryRoot: this.directory.root,
      trxRoot: this.trxTree.root,
      nextTrxId: this.#nextTrxIdNow(),
    })
    this.file.writePage(this.#generation % 2, this.#scratch)
    this.file.flush()
    log.advanceTail(at)
  }

  /** The log from the checkpoint on, as groups — what a change stream would read (D-25). Call `sync` first. */
  history(): Generator<Group> {
    const log = this.#logOpen()
    const { block, lsn } = log.tail
    return scanLog(this.logFile, { salt: log.salt, blocks: log.blocks, block, lsn })
  }

  close(): void {
    this.checkpoint()
    this.file.close()
    this.logFile.close()
  }

  #nextTrxIdNow(): number {
    return this.#trx?.nextTrxId ?? this.#nextTrxId
  }

  #startTrx(nextTrxId: number): TrxSys {
    const store = this
    this.#trx = new TrxSys(
      {
        pool: this.pool,
        journal: this.journal,
        trxTree: this.trxTree,
        tree: (indexId) => {
          let tree = this.#trees.get(indexId)
          if (tree === undefined) {
            // Rollback and purge reach a tree only before it is dropped; an
            // undo record for one that is gone is a broken log, not a call to obey.
            if (!this.hasTree(indexId)) throw new EngineError('ENGINE_CORRUPT_UNDO', `an undo record for index ${indexId}, which has no tree`)
            this.#trees.set(indexId, (tree = this.openTree(indexId)))
          }
          return tree
        },
        drop: (t) => {
          if (!this.hasTree(t.indexId)) throw new EngineError('ENGINE_CORRUPT_UNDO', `an undo record drops index ${t.indexId}, which has no tree`)
          this.dropTree(t.indexId, t.layout)
        },
        durable: () => this.commit(),
        get pageCount() {
          return store.alloc.pageCount
        },
      },
      nextTrxId,
      this.#maxHistory,
    )
    return this.#trx
  }

  #attach(log: Log): void {
    this.#log = log
    this.journal.log = log
    this.pool.beforeWrite = (lsn) => log.flushTo(lsn)
  }

  #logOpen(): Log {
    return this.#log ?? fail()
  }

  /** M4.3: a checkpoint before the log or the pool fills, rather than after. */
  #relieve(): void {
    if (this.#directory === undefined) return
    const log = this.#logOpen()
    if (log.pressure > 0.5) this.checkpoint(log.middle())
    else if (this.pool.dirtyCount > this.pool.frames * 0.75) this.checkpoint((this.pool.medianDirty() as number) + 1)
  }
}

function fail(): never {
  throw misuse('the store is not open')
}

function poolOptions(options: StoreOptions): PoolOptions {
  return {
    frames: options.frames ?? 256,
    ...(options.promoteAfter === undefined ? {} : { promoteAfter: options.promoteAfter }),
    // Every index page is checked structurally as it comes off storage, so the
    // tree above can read its cells without re-checking each bound.
    validate: (page, pageNo) => {
      if (pageType(page) === PAGE_TYPE.INDEX) validateIndexPage(page, pageNo)
    },
  }
}
