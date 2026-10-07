// M4.3 — the buffer pool (doc 41 §The buffer pool).
//
// One `ArrayBuffer`, carved into page-sized frames that are handed out as
// `Uint8Array` views, so nothing is allocated after startup. Three behaviours
// are the point of it:
//
//   - **Young and old.** A page read from storage enters the *old* list, and is
//     promoted to the *young* list only by an access that comes more than
//     `promoteAfter` fetches after its first — `innodb_old_blocks_time`,
//     measured on a logical clock rather than a wall clock. A scan touches each
//     page several times in quick succession and then never again, so it churns
//     through the old list and cannot evict the working set.
//   - **Dirty pages in the order they were first dirtied.** A checkpoint must
//     flush oldest-first to advance monotonically, and the order that matters
//     is the LSN of the *first* change since the page was last written — not
//     the page's current LSN, which moves forward every time it is touched
//     again. Because LSNs only rise, first-dirtied order is insertion order,
//     and a `Map` keeps it for free.
//   - **Pins.** A page in use cannot be evicted; asking for a frame when every
//     one is pinned is a typed error rather than a silent overwrite.
//
// `beforeWrite` is where Tier 4's WAL-before-data rule will attach: a page may
// not reach storage before the log record describing its last change is
// durable. Commit backpressure needs commits, which arrive with Tier 4 too.
import type { VfsFile } from '@myjs/vfs'
import { misuse, poolExhausted } from './errors.ts'
import { pageLsn, sealPage, setPageLsn, verifyPage } from './page.ts'
import type { LsnClock } from './lsn.ts'

export interface PoolOptions {
  readonly frames: number
  /** Fetches after its first access within which a re-access does not promote. Default: a quarter of the frames. */
  readonly promoteAfter?: number
  /** Called with a page's LSN before it is written out. */
  readonly beforeWrite?: (lsn: number) => void
  /**
   * A structural check for a page just read from storage, after its frame has
   * verified. A checksum proves the page is what was written, not that what
   * was written is sound, and every reader above trusts what the pool hands it.
   */
  readonly validate?: (page: Uint8Array, pageNo: number) => void
}

export interface PoolStats {
  fetches: number
  hits: number
  reads: number
  writes: number
}

const NONE = -1
const YOUNG = 1
const OLD = 2

export class BufferPool {
  readonly file: VfsFile
  readonly pageSize: number
  readonly frames: number
  readonly stats: PoolStats = { fetches: 0, hits: 0, reads: 0, writes: 0 }

  readonly #memory: Uint8Array
  readonly #pageOf: Int32Array
  readonly #pins: Uint16Array
  readonly #list: Int8Array
  readonly #prev: Int32Array
  readonly #next: Int32Array
  readonly #firstAccess: Float64Array
  readonly #frameOf = new Map<number, number>()
  /** Dirty frames → the LSN of their first change, in first-dirtied order. */
  readonly #dirty = new Map<number, number>()
  readonly #free: number[] = []
  readonly #head = [NONE, NONE, NONE]
  readonly #tail = [NONE, NONE, NONE]
  readonly #size = [0, 0, 0]
  readonly #oldTarget: number
  readonly #promoteAfter: number
  readonly #beforeWrite: ((lsn: number) => void) | undefined
  readonly #validate: ((page: Uint8Array, pageNo: number) => void) | undefined
  #clock = 0

  constructor(file: VfsFile, options: PoolOptions) {
    if (options.frames < 4) throw misuse('a buffer pool needs at least 4 frames')
    this.file = file
    this.pageSize = file.pageSize
    this.frames = options.frames
    this.#memory = new Uint8Array(options.frames * file.pageSize)
    this.#pageOf = new Int32Array(options.frames).fill(NONE)
    this.#pins = new Uint16Array(options.frames)
    this.#list = new Int8Array(options.frames)
    this.#prev = new Int32Array(options.frames).fill(NONE)
    this.#next = new Int32Array(options.frames).fill(NONE)
    this.#firstAccess = new Float64Array(options.frames)
    for (let f = options.frames - 1; f >= 0; f--) this.#free.push(f)
    // InnoDB's default: the old sublist is 3/8 of the pool.
    this.#oldTarget = Math.max(1, Math.floor((options.frames * 3) / 8))
    this.#promoteAfter = options.promoteAfter ?? Math.max(1, options.frames >> 2)
    this.#beforeWrite = options.beforeWrite
    this.#validate = options.validate
  }

  /** A page, read and verified if it is not resident, and pinned. */
  fetch(pageNo: number): Uint8Array {
    this.stats.fetches++
    this.#clock++
    const resident = this.#frameOf.get(pageNo)
    if (resident !== undefined) {
      this.stats.hits++
      this.#touch(resident)
      this.#pins[resident] = (this.#pins[resident] as number) + 1
      return this.#view(resident)
    }
    const frame = this.#claim(pageNo)
    const page = this.#view(frame)
    try {
      this.file.readPage(pageNo, page)
      this.stats.reads++
      verifyPage(page, pageNo, this.pageSize)
      this.#validate?.(page, pageNo)
    } catch (e) {
      this.#forget(frame)
      throw e
    }
    this.#pins[frame] = (this.#pins[frame] as number) + 1
    return page
  }

  /** A frame for a page that is new: zeroed, not read, pinned. The caller initialises it. */
  create(pageNo: number): Uint8Array {
    this.#clock++
    const resident = this.#frameOf.get(pageNo)
    const frame = resident ?? this.#claim(pageNo)
    const page = this.#view(frame)
    page.fill(0)
    this.#pins[frame] = (this.#pins[frame] as number) + 1
    return page
  }

  /** Pin a page, use it, unpin it. */
  read<T>(pageNo: number, use: (page: Uint8Array) => T): T {
    const page = this.fetch(pageNo)
    try {
      return use(page)
    } finally {
      this.release(page)
    }
  }

  /** Pin a page — read, or for `fresh` a zeroed frame — change it, stamp the clock's next LSN, unpin it. */
  write<T>(pageNo: number, lsn: LsnClock, change: (page: Uint8Array) => T, fresh = false): T {
    const page = fresh ? this.create(pageNo) : this.fetch(pageNo)
    try {
      const out = change(page)
      this.markDirty(page, lsn.next())
      return out
    } finally {
      this.release(page)
    }
  }

  /** Unpin a page from `fetch` or `create`. */
  release(page: Uint8Array): void {
    const frame = this.#frameAt(page)
    if (this.#pins[frame] === 0) throw misuse(`page ${this.#pageOf[frame]} released more times than fetched`)
    this.#pins[frame] = (this.#pins[frame] as number) - 1
  }

  /** Record a change to a pinned page at `lsn`, stamping it into the page's frame. */
  markDirty(page: Uint8Array, lsn: number): void {
    const frame = this.#frameAt(page)
    setPageLsn(page, lsn)
    if (!this.#dirty.has(frame)) this.#dirty.set(frame, lsn)
  }

  /** Write every dirty page, oldest first change first. Not a durability barrier: see `VfsFile.flush`. */
  flush(): void {
    for (const frame of this.#dirty.keys()) this.#write(frame)
  }

  /** Dirty page numbers in the order a checkpoint would write them. */
  dirtyPages(): number[] {
    return [...this.#dirty.keys()].map((f) => this.#pageOf[f] as number)
  }

  /** Where a resident page sits in the LRU, for tests and stats. */
  residency(pageNo: number): 'young' | 'old' | undefined {
    const frame = this.#frameOf.get(pageNo)
    if (frame === undefined) return undefined
    return this.#list[frame] === YOUNG ? 'young' : 'old'
  }

  /** How many frames are pinned now — zero between operations, or a pin leaked. */
  pinned(): number {
    let n = 0
    for (const p of this.#pins) if (p > 0) n++
    return n
  }

  // --- frames -----------------------------------------------------------------

  #view(frame: number): Uint8Array {
    return this.#memory.subarray(frame * this.pageSize, (frame + 1) * this.pageSize)
  }

  #frameAt(page: Uint8Array): number {
    const frame = page.byteOffset / this.pageSize
    if (page.buffer !== this.#memory.buffer || !Number.isInteger(frame) || this.#pageOf[frame] === NONE) {
      throw misuse('a page that did not come from this buffer pool')
    }
    return frame
  }

  /** A frame for `pageNo`, placed at the head of the old list. */
  #claim(pageNo: number): number {
    const frame = this.#free.pop() ?? this.#evict()
    this.#pageOf[frame] = pageNo
    this.#frameOf.set(pageNo, frame)
    this.#firstAccess[frame] = this.#clock
    this.#push(frame, OLD)
    this.#balance()
    return frame
  }

  #evict(): number {
    for (const list of [OLD, YOUNG]) {
      for (let f = this.#tail[list] as number; f !== NONE; f = this.#prev[f] as number) {
        if (this.#pins[f] !== 0) continue
        if (this.#dirty.has(f)) this.#write(f)
        this.#forget(f)
        return this.#free.pop() as number
      }
    }
    throw poolExhausted(this.frames)
  }

  #forget(frame: number): void {
    this.#unlink(frame)
    this.#frameOf.delete(this.#pageOf[frame] as number)
    this.#pageOf[frame] = NONE
    this.#pins[frame] = 0
    this.#dirty.delete(frame)
    this.#free.push(frame)
  }

  #write(frame: number): void {
    const page = this.#view(frame)
    this.#beforeWrite?.(pageLsn(page))
    sealPage(page)
    this.file.writePage(this.#pageOf[frame] as number, page)
    this.stats.writes++
    this.#dirty.delete(frame)
  }

  // --- the two lists ----------------------------------------------------------

  #touch(frame: number): void {
    if (this.#list[frame] === YOUNG) {
      this.#unlink(frame)
      this.#push(frame, YOUNG)
    } else if (this.#clock - (this.#firstAccess[frame] as number) > this.#promoteAfter) {
      this.#unlink(frame)
      this.#push(frame, YOUNG)
      this.#balance()
    }
  }

  /** Keep the old list at its share: demote the young tail while the young list is over. */
  #balance(): void {
    while (this.#size[YOUNG] as number > this.frames - this.#oldTarget) {
      const f = this.#tail[YOUNG] as number
      this.#unlink(f)
      this.#push(f, OLD)
    }
  }

  #push(frame: number, list: number): void {
    const head = this.#head[list] as number
    this.#list[frame] = list
    this.#prev[frame] = NONE
    this.#next[frame] = head
    if (head !== NONE) this.#prev[head] = frame
    else this.#tail[list] = frame
    this.#head[list] = frame
    this.#size[list] = (this.#size[list] as number) + 1
  }

  #unlink(frame: number): void {
    const list = this.#list[frame] as number
    if (list === 0) return
    const p = this.#prev[frame] as number
    const n = this.#next[frame] as number
    if (p !== NONE) this.#next[p] = n
    else this.#head[list] = n
    if (n !== NONE) this.#prev[n] = p
    else this.#tail[list] = p
    this.#list[frame] = 0
    this.#size[list] = (this.#size[list] as number) - 1
  }
}
