// D-41 — a database: a data file and a log file (doc 21 §Our file, doc 26
// §Our log).
//
// Every change is a mini-transaction (`journal.ts`), logged before any page it
// touched can reach the data file. `commit()` is the durability point and
// honours `flushLogAtTrxCommit` exactly as InnoDB's knob does (M4.19); `sync()`
// is the once-a-second flush that knob's settings 0 and 2 promise, called by
// the host, because a synchronous core owns no timer (ground rule 3).
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
import { corrupt, misuse } from './errors.ts'
import { Journal } from './journal.ts'
import { BufferPool, type PoolOptions } from './pool.ts'
import { validateIndexPage } from './index-page.ts'
import { PAGE_TYPE, pageType } from './page.ts'
import { recover } from './recovery.ts'
import type { Group } from './redo.ts'
import { readSuperblocks, writeSuperblock } from './superblock.ts'
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
}

const DIRECTORY = 0
const DEFAULT_LOG_BLOCKS = 4096

const be32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}
const readBe32 = (b: Uint8Array): number => new DataView(b.buffer, b.byteOffset, 4).getUint32(0)

interface Saved {
  readonly alloc: AllocatorState | undefined
  readonly nextIndexId: number
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
  #log: Log | undefined
  #nextIndexId: number
  #generation: number

  private constructor(file: VfsFile, logFile: VfsFile, pool: BufferPool, options: StoreOptions, logBlocks: number, nextIndexId: number, generation: number) {
    if (!Number.isInteger(logBlocks) || logBlocks < 4 || logBlocks > LOG_BLOCKS_MAX) throw misuse(`a log of ${logBlocks} blocks; it takes 4 to ${LOG_BLOCKS_MAX}`)
    this.file = file
    this.logFile = logFile
    this.pool = pool
    this.#policy = options.flushLogAtTrxCommit ?? 1
    this.#logBlocks = logBlocks
    this.#scratch = new Uint8Array(file.pageSize)
    this.#nextIndexId = nextIndexId
    this.#generation = generation
    this.journal = new Journal(pool, {
      meta: () => ({ pageCount: this.#alloc?.pageCount ?? 0, nextIndexId: this.#nextIndexId }),
      save: (): Saved => ({ alloc: this.#alloc?.save(), nextIndexId: this.#nextIndexId }),
      restore: (saved) => {
        const s = saved as Saved
        this.#nextIndexId = s.nextIndexId
        if (s.alloc !== undefined) this.#alloc?.restore(s.alloc)
      },
      beforeMtr: () => this.#relieve(),
    })
  }

  /** Format a new, empty database. */
  static create(file: VfsFile, logFile: VfsFile, options: StoreOptions = {}): Store {
    if (file.size() !== 0 || logFile.size() !== 0) throw misuse('Store.create on a file that is not empty')
    const store = new Store(file, logFile, new BufferPool(file, poolOptions(options)), options, options.logBlocks ?? DEFAULT_LOG_BLOCKS, DIRECTORY + 1, 0)
    store.#attach(Log.restart(logFile, store.#logBlocks, 1, 0))
    store.journal.atomically(() => {
      store.#alloc = Allocator.format(store.pool, store.journal)
      store.#directory = BTree.create(store, DIRECTORY)
    })
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
    const store = new Store(file, logFile, pool, options, options.logBlocks ?? s.logBlocks, r.meta.nextIndexId, s.generation)
    const alloc = (store.#alloc = Allocator.open(pool, store.journal, r.meta.pageCount))
    if (r.unreadable.size > 0) {
      const used = alloc.usedPages()
      for (const pageNo of r.unreadable) if (used.has(pageNo)) throw corrupt(pageNo, 'torn on disk, and the log holds no image of it')
    }
    store.#directory = new BTree(store, DIRECTORY, s.directoryRoot)
    // Nothing reaches the new log until the checkpoint below is durable, so a
    // crash before then recovers from the old one again.
    store.#attach(Log.restart(logFile, store.#logBlocks, (s.salt + 1) >>> 0, r.end))
    store.checkpoint()
    return store
  }

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

  /** Run `fn` as one mini-transaction: every change in it survives a crash, or none does. */
  atomically<T>(fn: () => T): T {
    return this.journal.atomically(fn)
  }

  /** A new, empty index, with its root recorded in the directory. */
  createTree(options: TreeOptions = {}): BTree {
    return this.journal.atomically(() => {
      const tree = BTree.create(this, this.#nextIndexId++, options)
      this.directory.put(be32(tree.indexId), be32(tree.root))
      return tree
    })
  }

  openTree(indexId: number, options: TreeOptions = {}): BTree {
    const root = this.directory.get(be32(indexId))
    if (root === undefined) throw misuse(`no index ${indexId}`)
    return new BTree(this, indexId, readBe32(root), options)
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
