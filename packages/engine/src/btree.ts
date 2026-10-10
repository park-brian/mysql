// M4.8, M4.9, M4.10 — the B+tree, and M4.4's page-level schema version.
//
// An ordered, unique map from `Uint8Array` to `Uint8Array`, compared with
// `memcmp` and nothing else (D-42): what a key or a value means is the index
// layer's business. The shape follows InnoDB where InnoDB is right and doc 22
// where it is not:
//
//   - **The root never moves.** When it splits, its cells go into two new
//     children and it becomes their parent; when it is left with one child,
//     that child's cells come back up. So the directory that maps an index to
//     its root is written when the index is created and never again.
//   - **Every internal page starts with the empty key**, which sorts before
//     every other key, so finding a child is "the last key ≤ the search key"
//     with no special case for the leftmost (doc 22, D-43).
//   - **Leaves are linked both ways**, for range scans in either direction.
//   - **A split usually halves by bytes, but an ascending run splits at the
//     insert point** — 100/0, the new cell alone on the right — so a table
//     filled in key order packs its leaves full instead of half full (M4.10).
//   - **A delete that leaves a page under a third full merges it with a
//     sibling, or failing that rebalances the two.** A rebalance that would
//     make the parent's separator too long for the parent is skipped: an
//     underfull page is legal, and a delete that could split its parent would
//     be a second, rarer code path for no real gain.
//
// A read pins a page only while it reads it, never across a recursive call or
// a `yield`. A change goes through the journal, which holds every page it
// changes until the mini-transaction ends (M4.15) — so a put or a delete pins
// a few pages per level, and a pool needs a few dozen frames for a deep tree.
// Every public change is one mini-transaction, or joins the caller's.
import { corrupt, misuse, keyTooLong, rowTooBig } from './errors.ts'
import { PAGE_TYPE, pageType } from './page.ts'
import type { Allocator } from './alloc.ts'
import type { Journal } from './journal.ts'
import type { TrxSys } from './trx.ts'
import type { BufferPool } from './pool.ts'
import * as ip from './index-page.ts'
import type { OverflowPages } from './overflow.ts'

/** The pages, the allocator and the journal every change to them goes through. */
export interface PageSpace {
  readonly pool: BufferPool
  readonly alloc: Allocator
  readonly journal: Journal
  /** The transactions the index layer's changes belong to (M4.20). A bare tree never asks. */
  readonly transactions: TrxSys
}

export interface TreeOptions {
  /**
   * M4.4: the schema version a clustered leaf's records are written in. A leaf
   * holding an older version is re-encoded through `upgrade` before anything
   * writes to it. 0, the default, is an unversioned tree.
   */
  readonly schemaVersion?: number
  readonly upgrade?: (value: Uint8Array, fromVersion: number) => Uint8Array
}

export interface Range {
  /** Inclusive lower bound. */
  readonly from?: Uint8Array
  /** Exclusive upper bound. */
  readonly to?: Uint8Array
  readonly reverse?: boolean
}

/** A tree's segments, by the slot of its fragment count on the root (doc 21). */
export const SEGMENT = { LEAF: 0, INTERNAL: 1, OVERFLOW: 2 } as const

/** A tree's segment ids: three per index. */
export const segmentId = (indexId: number, segment: number): number => 3 * indexId + 1 + segment

interface Cell {
  readonly key: Uint8Array
  readonly value: Uint8Array
}

/** A child that split: the separator and the new right sibling its parent must add. */
interface Split {
  readonly key: Uint8Array
  readonly page: number
}

const EMPTY = new Uint8Array(0)

export class BTree {
  readonly space: PageSpace
  readonly indexId: number
  readonly root: number
  readonly #version: number
  readonly #upgrade: (value: Uint8Array, from: number) => Uint8Array

  constructor(space: PageSpace, indexId: number, root: number, options: TreeOptions = {}) {
    this.space = space
    this.indexId = indexId
    this.root = root
    this.#version = options.schemaVersion ?? 0
    if (this.#version > 0 && options.upgrade === undefined) throw misuse('a versioned tree needs an upgrade function')
    this.#upgrade = options.upgrade ?? ((value) => value)
  }

  /** A new, empty tree: one leaf, which is its root for life. */
  static create(space: PageSpace, indexId: number, options: TreeOptions = {}): BTree {
    return space.journal.atomically(() => {
      const { page: root } = space.alloc.allocate(segmentId(indexId, SEGMENT.LEAF), 0)
      space.journal.write(
        root,
        (page) => {
          ip.initIndexPage(page, root, 0, indexId, options.schemaVersion ?? 0)
          ip.setFragments(page, SEGMENT.LEAF, 1)
        },
        true,
      )
      return new BTree(space, indexId, root, options)
    })
  }

  /** The largest key a page of this size can hold: an internal cell is the key and a child. */
  static maxKey(pageSize: number): number {
    return ip.maxCellSize(pageSize) - 3 - 1 - 4
  }

  /** ER_TOO_LONG_KEY if a key of `length` bytes is more than a page of this size can hold. */
  static checkKeyLength(length: number, pageSize: number): void {
    if (length > BTree.maxKey(pageSize)) throw keyTooLong(BTree.maxKey(pageSize))
  }

  /** The tree's overflow segment, for the record codec's off-page columns (M4.6). */
  overflowPages(): OverflowPages {
    return {
      pool: this.space.pool,
      journal: this.space.journal,
      allocate: () => this.#allocate(SEGMENT.OVERFLOW),
      free: (page) => this.#free(page, SEGMENT.OVERFLOW),
    }
  }

  /** Levels from the root to a leaf, inclusive. */
  height(): number {
    return this.#read(this.root, (p) => ip.level(p)) + 1
  }

  /** One descent, root to leaf: as many page fetches as the tree is high. */
  get(key: Uint8Array): Uint8Array | undefined {
    return this.#atLeaf(key, (p) => {
      const { index, found } = ip.search(p, key)
      if (!found) return undefined
      return this.#upgraded(ip.cell(p, index).value.slice(), ip.schemaVersion(p))
    })
  }

  /** Insert or replace. One mini-transaction, or part of the caller's. */
  put(key: Uint8Array, value: Uint8Array): void {
    const max = ip.maxCellSize(this.space.pool.pageSize)
    BTree.checkKeyLength(key.length, this.space.pool.pageSize)
    if (ip.cellSize(key, value) > max) throw rowTooBig(max)
    this.space.journal.atomically(() => {
      // Nothing is behind version 0: no descent to find out.
      if (this.#version > 0) this.#upgradeLeaf(this.#leafFor(key))
      const split = this.#insert(this.root, key, value)
      if (split !== null) throw misuse('the root split without being raised')
    })
  }

  /** Remove a key. `false` when it was not there. One mini-transaction, or part of the caller's. */
  delete(key: Uint8Array): boolean {
    return this.space.journal.atomically(() => {
      if (this.#version > 0) this.#upgradeLeaf(this.#leafFor(key))
      const { removed } = this.#remove(this.root, key)
      this.#collapseRoot()
      return removed
    })
  }

  /**
   * Entries in key order, or reverse key order, within a range. The tree may
   * change between two entries: the scan then finds its place again by key,
   * and hands out each key once (M5.38).
   */
  *entries(range: Range = {}): Generator<[Uint8Array, Uint8Array]> {
    const reverse = range.reverse === true
    const journal = this.space.journal
    // Where the next leaf's search starts: the range's bound, and after a
    // re-seek the last key handed out, which is not handed out again.
    let seek = reverse ? range.to : range.from
    let past: Uint8Array | undefined
    let leaf = this.#edgeLeaf(seek, reverse)
    let searched = false
    let seen = journal.commits
    // A sibling chain longer than the file is a cycle: corruption, not a scan.
    for (let visited = 0; leaf !== 0; visited++) {
      if (visited > this.space.alloc.pageCount) throw corrupt(leaf, 'the leaf chain loops')
      // A consumer may pause between two entries (D-77), and a mini-transaction
      // committed meanwhile may have split, merged or freed the leaf the
      // sibling link names. Then the place is found again from the root, by
      // the last key handed out.
      if (journal.commits !== seen && past !== undefined) {
        seek = past
        leaf = this.#edgeLeaf(seek, reverse)
        searched = false
      }
      const batch: [Uint8Array, Uint8Array][] = []
      let done = false
      leaf = this.#read(leaf, (p) => {
        const n = ip.cellCount(p)
        const from = ip.schemaVersion(p)
        // On the leaf the bound led to, the cells short of it are searched
        // past rather than walked: a point lookup is one leaf, and the walk
        // was most of it.
        let k = 0
        if (!searched && seek !== undefined) {
          const at = ip.search(p, seek).index
          k = reverse ? n - at : at
        }
        searched = true
        for (; k < n && !done; k++) {
          const { key, value } = ip.cell(p, reverse ? n - 1 - k : k)
          // A key short of the range is skipped; one past it ends the scan.
          const low = range.from !== undefined && ip.compareBytes(key, range.from) < 0
          const high = range.to !== undefined && ip.compareBytes(key, range.to) >= 0
          if (reverse ? low : high) done = true
          else if (past !== undefined && (reverse ? ip.compareBytes(key, past) >= 0 : ip.compareBytes(key, past) <= 0)) continue
          else if (!low && !high) batch.push([key.slice(), this.#upgraded(value.slice(), from)])
        }
        return reverse ? ip.leftSibling(p) : ip.rightSibling(p)
      }, 0)
      seen = journal.commits
      for (const entry of batch) {
        past = entry[0]
        yield entry
      }
      if (done) return
    }
  }

  /**
   * Every page the tree's nodes occupy, after `leafValue` has seen each value
   * on its leaves — what dropping the tree frees, with the overflow chains
   * those values name. More pages than the file holds is a cycle: corruption.
   */
  nodePages(leafValue?: (value: Uint8Array) => void): number[] {
    const out: number[] = []
    const pending = [this.root]
    for (let pageNo = pending.pop(); pageNo !== undefined; pageNo = pending.pop()) {
      if (out.length > this.space.alloc.pageCount) throw corrupt(this.root, 'the tree reaches more pages than the file has')
      out.push(pageNo)
      this.#read(pageNo, (p) => {
        const n = ip.cellCount(p)
        if (ip.level(p) > 0) for (let i = 0; i < n; i++) pending.push(ip.childAt(p, i))
        else if (leafValue !== undefined) for (let i = 0; i < n; i++) leafValue(ip.cell(p, i).value)
      })
    }
    return out
  }

  // --- reading ----------------------------------------------------------------

  /**
   * A page of this tree, pinned. A child pointer or a sibling link that leads
   * anywhere else — another index, a map page, the wrong level — is corruption,
   * reported as such rather than read as a node.
   */
  #fetch(pageNo: number, level?: number): Uint8Array {
    const page = this.space.pool.fetch(pageNo)
    try {
      this.#check(page, pageNo, level)
    } catch (e) {
      this.space.pool.release(page)
      throw e
    }
    return page
  }

  #check(page: Uint8Array, pageNo: number, level?: number): void {
    if (pageType(page) !== PAGE_TYPE.INDEX || ip.indexIdOf(page) !== this.indexId || (level !== undefined && ip.level(page) !== level)) {
      throw corrupt(pageNo, `not a level-${level ?? '?'} page of index ${this.indexId}`)
    }
    // A leaf written at a newer version than this tree was opened with would be
    // read as the wrong layout and, on its next write, stamped with the older
    // version: its records upgraded twice later. Refused instead.
    if (ip.level(page) === 0 && ip.schemaVersion(page) > this.#version) {
      throw misuse(`leaf ${pageNo} is at schema version ${ip.schemaVersion(page)}; the tree was opened at ${this.#version}`)
    }
  }

  #read<T>(pageNo: number, use: (page: Uint8Array) => T, level?: number): T {
    const page = this.#fetch(pageNo, level)
    try {
      return use(page)
    } finally {
      this.space.pool.release(page)
    }
  }

  /** Change a page of this tree, checked before it is touched. */
  #write<T>(pageNo: number, use: (page: Uint8Array) => T): T {
    return this.space.journal.write(pageNo, (page) => {
      this.#check(page, pageNo)
      return use(page)
    })
  }

  /** The child an internal page routes `key` to: the last cell whose key is ≤ it. */
  static #childIndex(p: Uint8Array, key: Uint8Array): number {
    const { index, found } = ip.search(p, key)
    return found ? index : index - 1
  }

  /** Descend to the leaf that holds or would hold `key`, and use it while it is pinned. */
  #atLeaf<T>(key: Uint8Array, use: (leaf: Uint8Array, pageNo: number) => T): T {
    let pageNo = this.root
    let level: number | undefined
    for (;;) {
      // Each step down must land exactly one level lower, so a corrupt child
      // pointer cannot send a descent round in a cycle.
      const page = this.#fetch(pageNo, level)
      let next: number
      try {
        if (ip.level(page) === 0) return use(page, pageNo)
        level = ip.level(page) - 1
        next = ip.childAt(page, BTree.#childIndex(page, key))
      } finally {
        this.space.pool.release(page)
      }
      pageNo = next
    }
  }

  #upgraded(value: Uint8Array, from: number): Uint8Array {
    return from < this.#version ? this.#upgrade(value, from) : value
  }

  #leafFor(key: Uint8Array): number {
    return this.#atLeaf(key, (_, pageNo) => pageNo)
  }

  /** The leaf a scan starts on: the one holding `bound`, or the first or last leaf. */
  #edgeLeaf(bound: Uint8Array | undefined, last: boolean): number {
    if (bound !== undefined) return this.#leafFor(bound)
    let pageNo = this.root
    let level: number | undefined
    for (;;) {
      const step = this.#read(pageNo, (p) => (ip.level(p) === 0 ? null : { level: ip.level(p) - 1, next: ip.childAt(p, last ? ip.cellCount(p) - 1 : 0) }), level)
      if (step === null) return pageNo
      level = step.level
      pageNo = step.next
    }
  }

  // --- pages ------------------------------------------------------------------

  #allocate(segment: number): number {
    return this.#write(this.root, (root) => {
      const { page, fragment } = this.space.alloc.allocate(segmentId(this.indexId, segment), ip.fragments(root, segment))
      if (fragment) ip.setFragments(root, segment, ip.fragments(root, segment) + 1)
      return page
    })
  }

  #free(pageNo: number, segment: number): void {
    this.#write(this.root, (root) => {
      if (this.space.alloc.free(pageNo).fragment) ip.setFragments(root, segment, ip.fragments(root, segment) - 1)
    })
  }

  static #segment(level: number): number {
    return level === 0 ? SEGMENT.LEAF : SEGMENT.INTERNAL
  }

  /** The bytes `cells` take on a page, slots included. */
  static #bytes(cells: readonly Cell[]): number {
    return cells.reduce((sum, c) => sum + ip.cellSize(c.key, c.value) + ip.SLOT, 0)
  }

  /** Every cell of a page, copied out. */
  static #cells(p: Uint8Array): Cell[] {
    const out: Cell[] = []
    for (let i = 0; i < ip.cellCount(p); i++) {
      const { key, value } = ip.cell(p, i)
      out.push({ key: key.slice(), value: value.slice() })
    }
    return out
  }

  /**
   * Rewrite a page with exactly `cells`, at `level`, keeping what belongs to
   * the page rather than its contents: its siblings, unless new ones are
   * given, and the root's fragment counts.
   */
  #fill(p: Uint8Array, pageNo: number, level: number, cells: readonly Cell[], left = ip.leftSibling(p), right = ip.rightSibling(p)): void {
    const counts = [0, 1, 2].map((i) => ip.fragments(p, i))
    ip.initIndexPage(p, pageNo, level, this.indexId, level === 0 ? this.#version : 0)
    ip.setLeftSibling(p, left)
    ip.setRightSibling(p, right)
    if (pageNo === this.root) counts.forEach((n, i) => ip.setFragments(p, i, n))
    for (let i = 0; i < cells.length; i++) ip.insertCell(p, i, (cells[i] as Cell).key, (cells[i] as Cell).value)
  }

  // --- insert -----------------------------------------------------------------

  #insert(pageNo: number, key: Uint8Array, value: Uint8Array, expect?: number): Split | null {
    // One read of the page for its level and, above the leaves, the child the key is under.
    let level = 0
    const child = this.#read(
      pageNo,
      (p) => {
        level = ip.level(p)
        return level === 0 ? -1 : ip.childAt(p, BTree.#childIndex(p, key))
      },
      expect,
    )
    if (level === 0) {
      return this.#write(pageNo, (p) => {
        const { index, found } = ip.search(p, key)
        if (found && ip.replaceValue(p, index, value)) return null
        if (found) ip.removeCell(p, index)
        if (ip.fits(p, key, value)) {
          ip.insertCell(p, index, key, value)
          ip.noteInsert(p, index)
          return null
        }
        const cells = BTree.#cells(p)
        cells.splice(index, 0, { key, value })
        const at = this.#leafSplitPoint(p, index, cells)
        return this.#split(p, pageNo, 0, cells.slice(0, at), cells.slice(at), cells[at]?.key as Uint8Array)
      })
    }
    const below = this.#insert(child, key, value, level - 1)
    if (below === null) return null
    return this.#write(pageNo, (p) => {
      const entry = ip.childValue(below.page)
      const { index } = ip.search(p, below.key)
      if (ip.fits(p, below.key, entry)) {
        ip.insertCell(p, index, below.key, entry)
        return null
      }
      const cells = BTree.#cells(p)
      cells.splice(index, 0, { key: below.key, value: entry })
      const at = BTree.#balancedPoint(cells, 1)
      // The middle key moves up; the right page's first cell takes the empty key.
      const right = [{ key: EMPTY, value: (cells[at] as Cell).value }, ...cells.slice(at + 1)]
      return this.#split(p, pageNo, ip.level(p), cells.slice(0, at), right, (cells[at] as Cell).key)
    })
  }

  /**
   * M4.10. An insert past the end of a page that has seen a run of ascending
   * inserts splits there, leaving the old page full and the new one with the
   * new cell alone; a descending run mirrors it. Anything else halves by
   * bytes, which is what random inserts want.
   */
  #leafSplitPoint(p: Uint8Array, index: number, cells: readonly Cell[]): number {
    const run = ip.directionCount(p) >= 1
    if (run && ip.direction(p) === ip.DIRECTION_ASC && index === cells.length - 1) return cells.length - 1
    if (run && ip.direction(p) === ip.DIRECTION_DESC && index === 0) return 1
    return BTree.#balancedPoint(cells, 1)
  }

  /** The split point that most nearly halves the bytes, leaving at least `min` cells each side. */
  static #balancedPoint(cells: readonly Cell[], min: number): number {
    const sizes = cells.map((c) => ip.cellSize(c.key, c.value) + ip.SLOT)
    const total = sizes.reduce((a, b) => a + b, 0)
    let left = 0
    let best = min
    let bestGap = Infinity
    for (let at = min; at <= cells.length - min; at++) {
      left += sizes[at - 1] as number
      const gap = Math.abs(total - 2 * left)
      if (gap < bestGap) {
        bestGap = gap
        best = at
      }
    }
    return best
  }

  /**
   * Divide a page's cells between it and a new right sibling, or — for the
   * root, which never moves — between two new children it then points at.
   */
  #split(p: Uint8Array, pageNo: number, level: number, left: Cell[], right: Cell[], separator: Uint8Array): Split | null {
    const segment = BTree.#segment(level)
    if (pageNo === this.root) {
      const l = this.#allocate(segment)
      const r = this.#allocate(segment)
      this.#create(l, level, left, 0, level === 0 ? r : 0)
      this.#create(r, level, right, level === 0 ? l : 0, 0)
      this.#fill(p, pageNo, level + 1, [
        { key: EMPTY, value: ip.childValue(l) },
        { key: separator.slice(), value: ip.childValue(r) },
      ])
      return null
    }
    const r = this.#allocate(segment)
    const next = ip.rightSibling(p)
    this.#fill(p, pageNo, level, left)
    if (level === 0) {
      ip.setRightSibling(p, r)
      if (next !== 0) this.#write(next, (n) => ip.setLeftSibling(n, r))
    }
    this.#create(r, level, right, level === 0 ? pageNo : 0, level === 0 ? next : 0)
    return { key: separator.slice(), page: r }
  }

  #create(pageNo: number, level: number, cells: readonly Cell[], left: number, right: number): void {
    this.space.journal.write(pageNo, (page) => this.#fill(page, pageNo, level, cells, left, right), true)
  }

  // --- delete -----------------------------------------------------------------

  #underfull(p: Uint8Array): boolean {
    return ip.usedSpace(p) < ip.usableSpace(this.space.pool.pageSize) / 3
  }

  #remove(pageNo: number, key: Uint8Array, expect?: number): { removed: boolean; underflow: boolean } {
    // One read for the level and, above the leaves, which child the key is under.
    let level = 0
    const step = this.#read(
      pageNo,
      (p) => {
        level = ip.level(p)
        if (level === 0) return undefined
        const at = BTree.#childIndex(p, key)
        return { at, child: ip.childAt(p, at) }
      },
      expect,
    )
    if (step === undefined) {
      return this.#write(pageNo, (p) => {
        const { index, found } = ip.search(p, key)
        if (!found) return { removed: false, underflow: false }
        ip.removeCell(p, index)
        return { removed: true, underflow: this.#underfull(p) }
      })
    }
    const { at, child } = step
    const result = this.#remove(child, key, level - 1)
    if (result.underflow) this.#rebalance(pageNo, at)
    return { removed: result.removed, underflow: pageNo !== this.root && this.#read(pageNo, (p) => this.#underfull(p)) }
  }

  /**
   * Child `i` of `parentNo` is under a third full: merge it with a sibling if
   * the two fit in one page, otherwise share their cells out evenly.
   */
  #rebalance(parentNo: number, i: number): void {
    const pair = this.#read(parentNo, (p) => {
      const n = ip.cellCount(p)
      // A parent with one child has no sibling to offer.
      if (n < 2) return null
      const j = i + 1 < n ? i : i - 1
      return { sepIndex: j + 1, a: ip.childAt(p, j), b: ip.childAt(p, j + 1), separator: ip.keyAt(p, j + 1).slice(), level: ip.level(p) - 1 }
    })
    if (pair === null) return
    const { sepIndex, a, b, separator, level } = pair
    const cellsA = this.#read(a, (p) => this.#current(p), level)
    const cellsB = this.#read(b, (p) => this.#current(p), level)
    // An internal page's first cell has the empty key; between two pages it
    // takes back the separator it stood for.
    const combined = level === 0 ? [...cellsA, ...cellsB] : [...cellsA, { key: separator, value: (cellsB[0] as Cell).value }, ...cellsB.slice(1)]
    const bytes = BTree.#bytes(combined)

    if (bytes <= ip.usableSpace(this.space.pool.pageSize)) {
      const after = this.#read(b, (p) => ip.rightSibling(p))
      this.#write(a, (p) => {
        this.#fill(p, a, level, combined)
        if (level === 0) ip.setRightSibling(p, after)
      })
      if (level === 0 && after !== 0) this.#write(after, (p) => ip.setLeftSibling(p, a))
      this.#free(b, BTree.#segment(level))
      this.#write(parentNo, (p) => ip.removeCell(p, sepIndex))
      return
    }

    const at = BTree.#balancedPoint(combined, level === 0 ? 1 : 2)
    const key = (combined[at] as Cell).key
    const fitsParent = this.#read(parentNo, (p) => ip.freeSpace(p) + ip.garbage(p) + ip.cellSize(separator, ip.childValue(b)) >= ip.cellSize(key, ip.childValue(b)))
    if (!fitsParent) return
    const left = combined.slice(0, at)
    const right = level === 0 ? combined.slice(at) : [{ key: EMPTY, value: (combined[at] as Cell).value }, ...combined.slice(at + 1)]
    // Upgraded records can make two pages' worth of cells more than two pages
    // hold; then there is no even split, and the rebalance is skipped too.
    if (BTree.#bytes(left) > ip.usableSpace(this.space.pool.pageSize) || BTree.#bytes(right) > ip.usableSpace(this.space.pool.pageSize)) return
    this.#write(a, (p) => this.#fill(p, a, level, left))
    this.#write(b, (p) => this.#fill(p, b, level, right))
    this.#write(parentNo, (p) => {
      ip.removeCell(p, sepIndex)
      ip.insertCell(p, sepIndex, key.slice(), ip.childValue(b))
    })
  }

  /** A page's cells, upgraded to the current schema version if it is a leaf behind it. */
  #current(p: Uint8Array): Cell[] {
    const cells = BTree.#cells(p)
    const from = ip.schemaVersion(p)
    if (ip.level(p) !== 0 || from >= this.#version) return cells
    return cells.map((c) => ({ key: c.key, value: this.#upgrade(c.value, from) }))
  }

  /** A root with a single child takes that child's place, while it has one. */
  #collapseRoot(): void {
    for (;;) {
      const only = this.#read(this.root, (p) => (ip.level(p) > 0 && ip.cellCount(p) === 1 ? { child: ip.childAt(p, 0), level: ip.level(p) - 1 } : null))
      if (only === null) return
      const { level } = only
      const cells = this.#read(only.child, (p) => BTree.#cells(p), level)
      this.#write(this.root, (p) => this.#fill(p, this.root, level, cells))
      this.#free(only.child, BTree.#segment(level))
    }
  }

  // --- M4.4 -------------------------------------------------------------------

  /**
   * Bring a leaf to the current schema version before it is written. When the
   * upgraded records still fit, the page is rewritten in place; when they have
   * grown, it is emptied and they go back in through `put`, splitting it as an
   * insert would.
   */
  #upgradeLeaf(leafNo: number): void {
    const behind = this.#read(leafNo, (p) => ip.schemaVersion(p) < this.#version)
    if (!behind) return
    const cells = this.#read(leafNo, (p) => this.#current(p))
    // Checked before the leaf is touched: a record the upgrade has made too big
    // for any page is refused with every row still in place.
    const max = ip.maxCellSize(this.space.pool.pageSize)
    if (cells.some((c) => ip.cellSize(c.key, c.value) > max)) throw rowTooBig(max)
    const bytes = BTree.#bytes(cells)
    if (bytes <= ip.usableSpace(this.space.pool.pageSize)) {
      this.#write(leafNo, (p) => this.#fill(p, leafNo, 0, cells))
      return
    }
    this.#write(leafNo, (p) => this.#fill(p, leafNo, 0, []))
    for (const c of cells) this.put(c.key, c.value)
  }
}
