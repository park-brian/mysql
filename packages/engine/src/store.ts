// D-41 — a database file: its superblock, its pages, and the directory that
// says where each index's root lives (doc 21 §Our file).
//
// Persistent, and not yet crash-safe: `flush` writes every dirty page and then
// the superblock, so a clean close reopens exactly, while a crash part-way can
// leave the file inconsistent. Tier 4's WAL is what makes it safe; until then
// the page LSNs, the dirty list's order and the reserved second superblock are
// already in the shape it needs.
import type { VfsFile } from '@myjs/vfs'
import { Allocator } from './alloc.ts'
import { BTree, type TreeOptions } from './btree.ts'
import { misuse } from './errors.ts'
import { LsnClock } from './lsn.ts'
import { BufferPool, type PoolOptions } from './pool.ts'
import { validateIndexPage } from './index-page.ts'
import { PAGE_TYPE, pageType } from './page.ts'
import { readSuperblock, writeSuperblock } from './superblock.ts'

export interface StoreOptions {
  /** Buffer pool frames. Default 256 — 4 MiB at 16 KiB pages. */
  readonly frames?: number
  readonly promoteAfter?: number
}

const DIRECTORY = 0

const be32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}
const readBe32 = (b: Uint8Array): number => new DataView(b.buffer, b.byteOffset, 4).getUint32(0)

export class Store {
  readonly file: VfsFile
  readonly pool: BufferPool
  readonly lsn: LsnClock
  readonly alloc: Allocator
  /** Index 0: big-endian index id → big-endian root page. */
  readonly directory: BTree
  #nextIndexId: number

  private constructor(file: VfsFile, pool: BufferPool, lsn: LsnClock, alloc: Allocator, directoryRoot: number | undefined, nextIndexId: number) {
    this.file = file
    this.pool = pool
    this.lsn = lsn
    this.alloc = alloc
    this.directory = directoryRoot === undefined ? BTree.create(this, DIRECTORY) : new BTree(this, DIRECTORY, directoryRoot)
    this.#nextIndexId = nextIndexId
  }

  /** Format a new, empty file. */
  static create(file: VfsFile, options: StoreOptions = {}): Store {
    if (file.size() !== 0) throw misuse('Store.create on a file that is not empty')
    const pool = new BufferPool(file, poolOptions(options))
    const lsn = new LsnClock(0)
    const store = new Store(file, pool, lsn, Allocator.format(pool, lsn), undefined, DIRECTORY + 1)
    store.flush()
    return store
  }

  /** Open a file `create` formatted. Its superblock is verified and refused if it is not one this build reads. */
  static open(file: VfsFile, options: StoreOptions = {}): Store {
    const pool = new BufferPool(file, poolOptions(options))
    const page = pool.fetch(0)
    let s
    try {
      s = readSuperblock(page, file.pageSize)
    } finally {
      pool.release(page)
    }
    const lsn = new LsnClock(s.lsn)
    return new Store(file, pool, lsn, Allocator.open(pool, lsn, s.pageCount), s.directoryRoot, s.nextIndexId)
  }

  /** A new, empty index, with its root recorded in the directory. */
  createTree(options: TreeOptions = {}): BTree {
    const tree = BTree.create(this, this.#nextIndexId++, options)
    this.directory.put(be32(tree.indexId), be32(tree.root))
    return tree
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

  /** Write every dirty page, then the superblock, then ask the file to make it durable. */
  flush(): void {
    const page = this.pool.create(0)
    try {
      const lsn = this.lsn.next()
      writeSuperblock(page, {
        pageSize: this.file.pageSize,
        lsn,
        pageCount: this.alloc.pageCount,
        nextIndexId: this.#nextIndexId,
        directoryRoot: this.directory.root,
      })
      this.pool.markDirty(page, lsn)
    } finally {
      this.pool.release(page)
    }
    this.pool.flush()
    this.file.flush()
  }

  close(): void {
    this.flush()
    this.file.close()
  }
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
