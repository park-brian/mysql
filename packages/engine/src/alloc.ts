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
// A mini-transaction saves it and an abort puts it back (`save`/`restore`), with
// no I/O: the map pages' own snapshots are the journal's.
import { corrupt, misuse } from './errors.ts'
import type { Journal } from './journal.ts'
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

export interface AllocatorState {
  readonly pageCount: number
  readonly free: readonly number[]
  readonly room: readonly (readonly [number, readonly number[]])[]
}

export class Allocator {
  readonly #pool: BufferPool
  readonly #journal: Journal
  readonly #perMap: number
  readonly #free: number[] = []
  readonly #room = new Map<number, Set<number>>()
  #pageCount: number

  private constructor(pool: BufferPool, journal: Journal, pageCount: number) {
    this.#pool = pool
    this.#journal = journal
    this.#perMap = extentsPerMap(pool.pageSize)
    this.#pageCount = pageCount
  }

  /** A new file's allocator: one group, its system pages taken. */
  static format(pool: BufferPool, journal: Journal): Allocator {
    const a = new Allocator(pool, journal, 0)
    a.#grow()
    return a
  }

  /** Rebuild the in-memory view from the map pages of a file of `pageCount` pages. */
  static open(pool: BufferPool, journal: Journal, pageCount: number): Allocator {
    if (pageCount % EXTENT !== 0 || pageCount === 0) throw corrupt(0, `page count ${pageCount} is not a whole number of extents`)
    const a = new Allocator(pool, journal, pageCount)
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

  /** The in-memory view, for an abort to put back. */
  save(): AllocatorState {
    return { pageCount: this.#pageCount, free: [...this.#free], room: [...this.#room].map(([owner, set]) => [owner, [...set]]) }
  }

  restore(s: AllocatorState): void {
    this.#pageCount = s.pageCount
    this.#free.splice(0, this.#free.length, ...s.free)
    this.#room.clear()
    for (const [owner, extents] of s.room) this.#room.set(owner, new Set(extents))
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
    const bit = this.#update(extent, (o, used) => {
      const bit = used.lowestClear()
      used.set(bit)
      if (used.full()) this.#roomFor(owner).delete(extent)
      return { owner: o, out: bit }
    })
    return { page: extent * EXTENT + bit, fragment: owner === SHARED }
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
      this.#update(extent, () => ({ owner, out: undefined }))
      room.add(extent)
      return extent
    }
  }

  /** Return a page. `fragment` says whether it came from a shared extent, for the caller's count. */
  free(page: number): { fragment: boolean } {
    const extent = Math.floor(page / EXTENT)
    const bit = page % EXTENT
    return this.#update(extent, (owner, used) => {
      if (owner === FREE || !used.has(bit)) throw misuse(`page ${page} freed but not in use`)
      if (this.#isSystem(page)) throw misuse(`page ${page} is a system page`)
      const out = { fragment: owner === SHARED }
      used.clear(bit)
      this.#journal.freed(page)
      const room = this.#roomFor(owner)
      if (used.empty()) {
        room.delete(extent)
        insertSorted(this.#free, extent)
        return { owner: FREE, out }
      }
      room.add(extent)
      return { owner, out }
    })
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
    const extent = Math.floor(page / EXTENT)
    const owner = this.#pool.read(this.#mapPage(extent), (p) => descriptorView(p).getUint32(this.#descriptor(extent)))
    return owner === FREE ? 'free' : owner === SHARED ? 'shared' : owner
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
    this.#journal.write(mapNo, (page) => initPage(page, mapNo, PAGE_TYPE.ALLOC_MAP), true)
    this.#update(extent, (_, used) => {
      for (let bit = 0; bit < SYSTEM_PAGES; bit++) used.set(bit)
      return { owner: SHARED, out: undefined }
    })
    this.#roomFor(SHARED).add(extent)
    return undefined
  }

  #roomFor(owner: number): Set<number> {
    let room = this.#room.get(owner)
    if (room === undefined) this.#room.set(owner, (room = new Set()))
    return room
  }

  /** Where an extent's descriptor sits on its map page. */
  #descriptor(extent: number): number {
    return FRAME_HEADER + (extent % this.#perMap) * DESCRIPTOR
  }

  /** Change one descriptor: `change` may edit the bitmap in place, and returns the new owner and a result. */
  #update<T>(extent: number, change: (owner: number, used: Used) => { owner: number; out: T }): T {
    return this.#journal.write(this.#mapPage(extent), (page) => {
      const v = descriptorView(page)
      const at = this.#descriptor(extent)
      const used = new Used(v.getUint32(at + 4), v.getUint32(at + 8))
      const { owner, out } = change(v.getUint32(at), used)
      v.setUint32(at, owner)
      v.setUint32(at + 4, used.hi)
      v.setUint32(at + 8, used.lo)
      return out
    })
  }

  #forEachDescriptor(use: (extent: number, owner: number, used: Used) => void): void {
    const extents = this.#pageCount / EXTENT
    for (let start = 0; start < extents; start += this.#perMap) {
      this.#pool.read(this.#mapPage(start), (page) => {
        if (pageType(page) !== PAGE_TYPE.ALLOC_MAP) throw corrupt(this.#mapPage(start), 'not an allocation map page')
        const v = descriptorView(page)
        for (let e = start; e < Math.min(extents, start + this.#perMap); e++) {
          const at = this.#descriptor(e)
          use(e, v.getUint32(at), new Used(v.getUint32(at + 4), v.getUint32(at + 8)))
        }
      })
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

const descriptorView = (page: Uint8Array): DataView => new DataView(page.buffer, page.byteOffset, page.byteLength)

function first(set: Set<number>): number | undefined {
  for (const v of set) return v
  return undefined
}

function insertSorted(list: number[], value: number): void {
  let i = list.length
  while (i > 0 && (list[i - 1] as number) > value) i--
  list.splice(i, 0, value)
}
