// M0.10 — the memory backend.
//
// Ground rule 6: "The memory VFS is the reference implementation. Every unit
// test runs against it. If a bug reproduces only on OPFS, the VFS is at fault,
// not the engine." So this backend is written to be *correct and complete*
// rather than minimal — where doc 40 leaves a behaviour open, this file is the
// definition of it.
//
// Doc 40 §Memory: "A `Map<number, Uint8Array>` of pages. `flush()` is a no-op;
// `durability` reports `'best-effort'`."

import {
  DEFAULT_PAGE_SIZE,
  VfsError,
  badPage,
  fileClosed,
  fileNotFound,
  type Lock,
  type Vfs,
  type VfsFile,
} from './vfs.ts'

interface FileData {
  readonly pages: Map<number, Uint8Array>
  size: number
}

class MemoryFile implements VfsFile {
  readonly pageSize: number
  readonly #path: string
  readonly #data: FileData
  #closed = false

  constructor(path: string, data: FileData, pageSize: number) {
    this.#path = path
    this.#data = data
    this.pageSize = pageSize
  }

  #alive(): FileData {
    if (this.#closed) throw fileClosed(this.#path)
    return this.#data
  }

  /** The stored page, or a zero page for a hole. Never handed out directly. */
  #page(pageNo: number): Uint8Array {
    const existing = this.#data.pages.get(pageNo)
    if (existing !== undefined) return existing
    const fresh = new Uint8Array(this.pageSize)
    this.#data.pages.set(pageNo, fresh)
    return fresh
  }

  readPage(pageNo: number, into: Uint8Array): void {
    const data = this.#alive()
    if (into.length !== this.pageSize) throw badPage(pageNo, this.pageSize, into.length)
    if (pageNo < 0 || !Number.isInteger(pageNo)) {
      throw new VfsError('VFS_BAD_PAGE_NO', `page number must be a non-negative integer, got ${pageNo}`)
    }
    const stored = data.pages.get(pageNo)
    if (stored === undefined) into.fill(0)
    else into.set(stored)
  }

  writePage(pageNo: number, from: Uint8Array): void {
    const data = this.#alive()
    if (from.length !== this.pageSize) throw badPage(pageNo, this.pageSize, from.length)
    if (pageNo < 0 || !Number.isInteger(pageNo)) {
      throw new VfsError('VFS_BAD_PAGE_NO', `page number must be a non-negative integer, got ${pageNo}`)
    }
    // Copy: the caller owns its buffer and may reuse it for the next page.
    data.pages.set(pageNo, from.slice())
    const end = (pageNo + 1) * this.pageSize
    if (end > data.size) data.size = end
  }

  /**
   * Byte access exists only for the WAL and headers, but it must stay coherent
   * with the page view — the same bytes, whichever way they are reached.
   * Returns the number of bytes actually read, which is short at end of file.
   */
  readBytes(offset: number, into: Uint8Array): number {
    const data = this.#alive()
    if (offset < 0 || !Number.isInteger(offset)) {
      throw new VfsError('VFS_BAD_OFFSET', `offset must be a non-negative integer, got ${offset}`)
    }
    const available = Math.max(0, data.size - offset)
    const n = Math.min(into.length, available)
    for (let done = 0; done < n; ) {
      const pos = offset + done
      const pageNo = Math.floor(pos / this.pageSize)
      const within = pos % this.pageSize
      const chunk = Math.min(this.pageSize - within, n - done)
      const stored = data.pages.get(pageNo)
      if (stored === undefined) into.fill(0, done, done + chunk)
      else into.set(stored.subarray(within, within + chunk), done)
      done += chunk
    }
    if (n < into.length) into.fill(0, n)
    return n
  }

  writeBytes(offset: number, from: Uint8Array): void {
    const data = this.#alive()
    if (offset < 0 || !Number.isInteger(offset)) {
      throw new VfsError('VFS_BAD_OFFSET', `offset must be a non-negative integer, got ${offset}`)
    }
    for (let done = 0; done < from.length; ) {
      const pos = offset + done
      const pageNo = Math.floor(pos / this.pageSize)
      const within = pos % this.pageSize
      const chunk = Math.min(this.pageSize - within, from.length - done)
      this.#page(pageNo).set(from.subarray(done, done + chunk), within)
      done += chunk
    }
    const end = offset + from.length
    if (end > data.size) data.size = end
  }

  size(): number {
    return this.#alive().size
  }

  truncate(bytes: number): void {
    const data = this.#alive()
    if (bytes < 0 || !Number.isInteger(bytes)) {
      throw new VfsError('VFS_BAD_LENGTH', `truncate length must be a non-negative integer, got ${bytes}`)
    }
    if (bytes < data.size) {
      // Drop whole pages past the new end, and zero the tail of a partial one,
      // so a later grow reads zeros rather than stale bytes.
      const lastPage = Math.floor(bytes / this.pageSize)
      const within = bytes % this.pageSize
      for (const pageNo of [...data.pages.keys()]) {
        if (pageNo > lastPage) data.pages.delete(pageNo)
      }
      if (within !== 0) data.pages.get(lastPage)?.fill(0, within)
      else data.pages.delete(lastPage)
    }
    // Growing is legal and produces a hole that reads as zeros.
    data.size = bytes
  }

  /** A no-op: memory has nothing to flush and nothing to promise. */
  flush(): void {
    this.#alive()
  }

  close(): void {
    this.#closed = true
  }
}

/**
 * An in-process exclusive lock queue.
 *
 * Doc 40's locking table says memory needs no cross-context mechanism, but the
 * *semantics* still have to be defined somewhere for the conformance suite to
 * assert against — so the reference backend implements real exclusion within
 * the process rather than handing back a handle that excludes nothing.
 */
class LockQueue {
  #held = false
  #waiting: Array<() => void> = []

  async acquire(path: string): Promise<Lock> {
    if (this.#held) await new Promise<void>((resolve) => this.#waiting.push(resolve))
    this.#held = true
    let released = false
    const release = (): void => {
      if (released) return // a second release is a no-op, not an error
      released = true
      this.#held = false
      const next = this.#waiting.shift()
      if (next !== undefined) next()
    }
    return {
      path,
      get held() {
        return !released
      },
      release,
      [Symbol.dispose]: release,
    }
  }
}

export interface MemoryVfsOptions {
  readonly pageSize?: number
}

export class MemoryVfs implements Vfs {
  readonly name = 'memory' as const
  // E-03: the real guarantee is none, but the union has no such member and
  // doc 40 §Memory says to report this.
  readonly durability = 'best-effort' as const

  readonly #files = new Map<string, FileData>()
  readonly #locks = new Map<string, LockQueue>()
  readonly #pageSize: number

  constructor(options: MemoryVfsOptions = {}) {
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  }

  async open(path: string, opts: { create?: boolean }): Promise<VfsFile> {
    let data = this.#files.get(path)
    if (data === undefined) {
      if (opts.create !== true) throw fileNotFound(path)
      data = { pages: new Map(), size: 0 }
      this.#files.set(path, data)
    }
    return new MemoryFile(path, data, this.#pageSize)
  }

  async delete(path: string): Promise<void> {
    if (!this.#files.delete(path)) throw fileNotFound(path)
  }

  /** Immediate children of `dir`, as names rather than paths. */
  async list(dir: string): Promise<string[]> {
    const prefix = dir === '' || dir.endsWith('/') ? dir : dir + '/'
    const names = new Set<string>()
    for (const path of this.#files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest === '') continue
      const slash = rest.indexOf('/')
      names.add(slash === -1 ? rest : rest.slice(0, slash))
    }
    return [...names].sort()
  }

  async lock(path: string): Promise<Lock> {
    let queue = this.#locks.get(path)
    if (queue === undefined) {
      queue = new LockQueue()
      this.#locks.set(path, queue)
    }
    return queue.acquire(path)
  }
}
