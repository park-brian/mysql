// M4.12 — the extent allocator (doc 21 §Allocation, D-19).
//
// A page belongs to an extent of 64. An allocation map page describes a group
// of extents, each with a `u32` owner and a 64-bit bitmap of used pages, and
// that is the whole on-disk structure: one page to validate per group, rather
// than InnoDB's graph of list nodes.
//
// Two policies make it more than a bitmap:
//
//   - **Segments own extents**, so a tree's leaves sit together and a range
//     scan reads sequentially. A segment's first `FRAGMENT_LIMIT` pages come
//     from shared fragment extents instead, so a small table costs a few pages
//     rather than three whole extents. The caller says how many fragment pages
//     its segment holds — the count lives on the tree's root page, as InnoDB's
//     `FSEG` header does — and the allocator says whether it gave out another.
//   - **Growth is extent-granular, and freed extents come back first.** When an
//     extent's last page is freed it returns to the free pool, and the file
//     grows by an extent only when the pool is empty.
//
// The in-memory view — free extents, and each owner's extents that still have
// room — is rebuilt from the map pages on open, so the maps are the only truth.
import { corrupt, misuse } from './errors.ts'
import type { LsnClock } from './lsn.ts'
import { FRAME_HEADER, PAGE_TYPE, initPage, pageType } from './page.ts'
import type { BufferPool } from './pool.ts'

export const EXTENT = 64
/** Pages a segment takes from shared extents before it claims extents of its own. */
export const FRAGMENT_LIMIT = 32

const FREE = 0
const SHARED = 0xffffffff
const DESCRIPTOR = 12
/** Pages 0–2 of every group: the superblocks (group 0 only) and the map page. */
const SYSTEM_PAGES = 3

/** Extents one map page describes. */
export const extentsPerMap = (pageSize: number): number => Math.floor((pageSize - FRAME_HEADER - 8) / DESCRIPTOR)

export class Allocator {
  readonly #pool: BufferPool
  readonly #lsn: LsnClock
  readonly #perMap: number
  readonly #free: number[] = []
  readonly #room = new Map<number, Set<number>>()
  #pageCount: number

  private constructor(pool: BufferPool, lsn: LsnClock, pageCount: number) {
    this.#pool = pool
    this.#lsn = lsn
    this.#perMap = extentsPerMap(pool.pageSize)
    this.#pageCount = pageCount
  }

  /** A new file's allocator: one group, its system pages taken. */
  static format(pool: BufferPool, lsn: LsnClock): Allocator {
    const a = new Allocator(pool, lsn, 0)
    a.#grow()
    return a
  }

  /** Rebuild the in-memory view from the map pages of a file of `pageCount` pages. */
  static open(pool: BufferPool, lsn: LsnClock, pageCount: number): Allocator {
    if (pageCount % EXTENT !== 0 || pageCount === 0) throw corrupt(0, `page count ${pageCount} is not a whole number of extents`)
    const a = new Allocator(pool, lsn, pageCount)
    a.#forEachDescriptor((extent, owner, used) => {
      // A group's system pages are taken for good. A map that says otherwise
      // would hand out the superblock or a map page as a tree node.
      if (extent % a.#perMap === 0 && (owner !== SHARED || !used.has(0) || !used.has(1) || !used.has(2))) {
        throw corrupt(a.#mapPage(extent), `the system extent of group ${extent / a.#perMap} is not reserved`)
      }
      if (owner === FREE) {
        if (!used.empty()) throw corrupt(a.#mapPage(extent), `free extent ${extent} has pages in use`)
        a.#free.push(extent)
      } else if (!used.full()) {
        a.#roomFor(owner).add(extent)
      }
    })
    return a
  }

  /** The file's length in pages, which the superblock records. */
  get pageCount(): number {
    return this.#pageCount
  }

  /**
   * A page for `segment`, whose tree holds `fragments` fragment pages already.
   * `fragment` says whether this one is another, for the caller's count.
   */
  allocate(segment: number, fragments: number): { page: number; fragment: boolean } {
    if (segment === FREE || segment === SHARED) throw misuse(`segment id ${segment} is reserved`)
    const owner = fragments < FRAGMENT_LIMIT ? SHARED : segment
    const extent = this.#claim(owner)
    let page = -1
    this.#update(extent, (o, used) => {
      const bit = used.lowestClear()
      page = extent * EXTENT + bit
      used.set(bit)
      if (used.full()) this.#roomFor(owner).delete(extent)
      return o
    })
    return { page, fragment: owner === SHARED }
  }

  /** An extent of `owner`'s with a free page: one it has, a free one, or a new one. */
  #claim(owner: number): number {
    for (;;) {
      const room = this.#roomFor(owner)
      const ready = first(room)
      if (ready !== undefined) return ready
      const extent = this.#free.shift() ?? this.#grow()
      // Growing into a new group adds its first extent as shared room, and
      // that is all it adds: go round again.
      if (extent === undefined) continue
      this.#update(extent, () => owner)
      room.add(extent)
      return extent
    }
  }

  /** Return a page. `fragment` says whether it came from a shared extent, for the caller's count. */
  free(page: number): { fragment: boolean } {
    const extent = Math.floor(page / EXTENT)
    const bit = page % EXTENT
    let fragment = false
    this.#update(extent, (owner, used) => {
      if (owner === FREE || !used.has(bit)) throw misuse(`page ${page} freed but not in use`)
      if (this.#isSystem(page)) throw misuse(`page ${page} is a system page`)
      fragment = owner === SHARED
      used.clear(bit)
      const room = this.#roomFor(owner)
      if (used.empty()) {
        room.delete(extent)
        insertSorted(this.#free, extent)
        return FREE
      }
      room.add(extent)
      return owner
    })
    return { fragment }
  }

  /** Every page the maps say is in use — what `verify` compares with what is reachable. */
  usedPages(): Set<number> {
    const out = new Set<number>()
    this.#forEachDescriptor((extent, _, used) => {
      for (let bit = 0; bit < EXTENT; bit++) if (used.has(bit)) out.add(extent * EXTENT + bit)
    })
    return out
  }

  /** The owner of a page's extent: a segment id, or `'shared'`, or `'free'`. */
  ownerOf(page: number): number | 'shared' | 'free' {
    let out: number | 'shared' | 'free' = 'free'
    this.#read(Math.floor(page / EXTENT), (owner) => {
      out = owner === FREE ? 'free' : owner === SHARED ? 'shared' : owner
    })
    return out
  }

  // --- the maps ---------------------------------------------------------------

  #groupPages(): number {
    return this.#perMap * EXTENT
  }

  #mapPage(extent: number): number {
    return Math.floor(extent / this.#perMap) * this.#groupPages() + 2
  }

  #isSystem(page: number): boolean {
    return page % this.#groupPages() < SYSTEM_PAGES
  }

  /**
   * One more extent at the end of the file, or `undefined` when it is a
   * group's first: that one carries the map page, and becomes a fragment
   * extent whose system pages are taken for good, so the rest of it is used
   * rather than wasted.
   */
  #grow(): number | undefined {
    const extent = this.#pageCount / EXTENT
    this.#pageCount += EXTENT
    if (extent % this.#perMap !== 0) return extent
    const mapNo = this.#mapPage(extent)
    const page = this.#pool.create(mapNo)
    initPage(page, mapNo, PAGE_TYPE.ALLOC_MAP)
    this.#pool.markDirty(page, this.#lsn.next())
    this.#pool.release(page)
    this.#update(extent, (_, used) => {
      for (let bit = 0; bit < SYSTEM_PAGES; bit++) used.set(bit)
      return SHARED
    })
    this.#roomFor(SHARED).add(extent)
    return undefined
  }

  #roomFor(owner: number): Set<number> {
    let room = this.#room.get(owner)
    if (room === undefined) this.#room.set(owner, (room = new Set()))
    return room
  }

  #read(extent: number, use: (owner: number, used: Used) => void): void {
    const page = this.#pool.fetch(this.#mapPage(extent))
    try {
      const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
      const at = FRAME_HEADER + (extent % this.#perMap) * DESCRIPTOR
      use(v.getUint32(at), new Used(v.getUint32(at + 4), v.getUint32(at + 8)))
    } finally {
      this.#pool.release(page)
    }
  }

  /** Change one descriptor: `change` may edit the bitmap in place, and returns the owner. */
  #update(extent: number, change: (owner: number, used: Used) => number): void {
    const page = this.#pool.fetch(this.#mapPage(extent))
    try {
      const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
      const at = FRAME_HEADER + (extent % this.#perMap) * DESCRIPTOR
      const used = new Used(v.getUint32(at + 4), v.getUint32(at + 8))
      v.setUint32(at, change(v.getUint32(at), used))
      v.setUint32(at + 4, used.hi)
      v.setUint32(at + 8, used.lo)
      this.#pool.markDirty(page, this.#lsn.next())
    } finally {
      this.#pool.release(page)
    }
  }

  #forEachDescriptor(use: (extent: number, owner: number, used: Used) => void): void {
    const extents = this.#pageCount / EXTENT
    for (let start = 0; start < extents; start += this.#perMap) {
      const page = this.#pool.fetch(this.#mapPage(start))
      try {
        if (pageType(page) !== PAGE_TYPE.ALLOC_MAP) throw corrupt(this.#mapPage(start), 'not an allocation map page')
        const v = new DataView(page.buffer, page.byteOffset, page.byteLength)
        for (let e = start; e < Math.min(extents, start + this.#perMap); e++) {
          const at = FRAME_HEADER + (e - start) * DESCRIPTOR
          use(e, v.getUint32(at), new Used(v.getUint32(at + 4), v.getUint32(at + 8)))
        }
      } finally {
        this.#pool.release(page)
      }
    }
  }
}

/** An extent's 64-bit page bitmap as two `u32` words: bit `i` is page `i`. */
class Used {
  hi: number
  lo: number

  constructor(hi: number, lo: number) {
    this.hi = hi
    this.lo = lo
  }

  has(bit: number): boolean {
    return bit < 32 ? ((this.lo >>> bit) & 1) === 1 : ((this.hi >>> (bit - 32)) & 1) === 1
  }

  set(bit: number): void {
    if (bit < 32) this.lo = (this.lo | (1 << bit)) >>> 0
    else this.hi = (this.hi | (1 << (bit - 32))) >>> 0
  }

  clear(bit: number): void {
    if (bit < 32) this.lo = (this.lo & ~(1 << bit)) >>> 0
    else this.hi = (this.hi & ~(1 << (bit - 32))) >>> 0
  }

  empty(): boolean {
    return this.hi === 0 && this.lo === 0
  }

  full(): boolean {
    return this.hi === 0xffffffff && this.lo === 0xffffffff
  }

  /** The lowest clear bit. Only asked of an extent that is not full. */
  lowestClear(): number {
    const word = this.lo !== 0xffffffff ? this.lo : this.hi
    const free = ~word >>> 0
    const bit = 31 - Math.clz32(free & -free)
    return this.lo !== 0xffffffff ? bit : bit + 32
  }
}

function first(set: Set<number>): number | undefined {
  for (const v of set) return v
  return undefined
}

function insertSorted(list: number[], value: number): void {
  let i = list.length
  while (i > 0 && (list[i - 1] as number) > value) i--
  list.splice(i, 0, value)
}
