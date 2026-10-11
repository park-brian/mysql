// M4.26 — the Node VFS: doc 40's `openSync`/`readSync`/`writeSync`/`fsyncSync`.
//
// Exported from `@myjs/vfs/node`, never from the package root, so no browser
// bundle can reach `node:fs` by importing the interface (the reason
// `@myjs/vfs/fault` is a subpath too). Bun and Deno implement `node:fs`, so
// the same backend serves them.
//
// Paths are the VFS's own — `/db/data` — resolved under a root directory, so
// a database is a directory and nothing above it is reachable: `..` is
// refused rather than normalised away.
//
// Two kinds of exclusion, because there are two kinds of contender. Within the
// process, `lock` queues callers exactly as the memory backend does. Across
// processes it holds an advisory lock file created with `wx`, which holds the
// owner's pid for diagnosis. Existing files are never taken over: recovery
// after a crash requires removing the lock after every owner has stopped.
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_PAGE_SIZE, VfsError, badPage, fileClosed, fileNotFound, type Lock, type Vfs, type VfsFile } from './vfs.ts'

function checkOffset(what: string, n: number): void {
  if (n < 0 || !Number.isInteger(n)) throw new VfsError(what === 'page' ? 'VFS_BAD_PAGE_NO' : what === 'length' ? 'VFS_BAD_LENGTH' : 'VFS_BAD_OFFSET', `${what} must be a non-negative integer, got ${n}`)
}

class NodeFile implements VfsFile {
  readonly pageSize: number
  readonly #path: string
  #fd: number | null

  constructor(path: string, fd: number, pageSize: number) {
    this.#path = path
    this.#fd = fd
    this.pageSize = pageSize
  }

  #alive(): number {
    if (this.#fd === null) throw fileClosed(this.#path)
    return this.#fd
  }

  /** `readSync` until `into` is full or the file ends; the rest is zeros. */
  #read(fd: number, into: Uint8Array, position: number): number {
    let done = 0
    while (done < into.length) {
      const n = readSync(fd, into, done, into.length - done, position + done)
      if (n === 0) break
      done += n
    }
    if (done < into.length) into.fill(0, done)
    return done
  }

  #write(fd: number, from: Uint8Array, position: number): void {
    let done = 0
    while (done < from.length) done += writeSync(fd, from, done, from.length - done, position + done)
  }

  readPage(pageNo: number, into: Uint8Array): void {
    const fd = this.#alive()
    if (into.length !== this.pageSize) throw badPage(pageNo, this.pageSize, into.length)
    checkOffset('page', pageNo)
    this.#read(fd, into, pageNo * this.pageSize)
  }

  writePage(pageNo: number, from: Uint8Array): void {
    const fd = this.#alive()
    if (from.length !== this.pageSize) throw badPage(pageNo, this.pageSize, from.length)
    checkOffset('page', pageNo)
    this.#write(fd, from, pageNo * this.pageSize)
  }

  readBytes(offset: number, into: Uint8Array): number {
    const fd = this.#alive()
    checkOffset('offset', offset)
    return this.#read(fd, into, offset)
  }

  writeBytes(offset: number, from: Uint8Array): void {
    const fd = this.#alive()
    checkOffset('offset', offset)
    this.#write(fd, from, offset)
  }

  size(): number {
    return fstatSync(this.#alive()).size
  }

  truncate(bytes: number): void {
    const fd = this.#alive()
    checkOffset('length', bytes)
    ftruncateSync(fd, bytes)
  }

  /** `fsyncSync`: a real barrier, modulo drive caches (doc 40 §Durability). */
  flush(): void {
    fsyncSync(this.#alive())
  }

  close(): void {
    if (this.#fd === null) return
    closeSync(this.#fd)
    this.#fd = null
  }
}

/** Waiters on one path within this process. */
class LockQueue {
  #held = false
  #waiting: (() => void)[] = []

  /** Take it if it is free; `false` otherwise. */
  take(): boolean {
    if (this.#held) return false
    this.#held = true
    return true
  }

  async acquire(): Promise<void> {
    if (!this.#held) {
      this.#held = true
      return
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve))
  }

  release(): void {
    const next = this.#waiting.shift()
    if (next !== undefined) next()
    else this.#held = false
  }
}

export interface NodeVfsOptions {
  readonly pageSize?: number
  /** How long to wait between attempts on a lock file another process holds. */
  readonly lockPollMs?: number
}

export class NodeVfs implements Vfs {
  readonly name = 'node' as const
  readonly durability = 'strong' as const
  /** The directory every VFS path lives under. */
  readonly root: string
  readonly #pageSize: number
  readonly #poll: number
  readonly #locks = new Map<string, LockQueue>()

  constructor(root: string, options: NodeVfsOptions = {}) {
    const directory = resolve(root)
    mkdirSync(directory, { recursive: true })
    this.root = realpathSync(directory)
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    this.#poll = options.lockPollMs ?? 50
  }

  /** A VFS path as a real one under the root; `..` is refused. */
  #real(path: string): string {
    const parts = path.split('/').filter((p) => p !== '' && p !== '.')
    if (parts.includes('..') || /[\\:\0]/.test(path)) throw new VfsError('VFS_BAD_PATH', `a path may not leave the database: ${path}`)
    let current = this.root
    for (const part of parts) {
      current = join(current, part)
      try {
        if (lstatSync(current).isSymbolicLink()) throw new VfsError('VFS_BAD_PATH', `symlinks are not VFS paths: ${path}`)
      } catch (e) {
        if ((e as { code?: string }).code !== 'ENOENT') throw e
      }
    }
    return join(this.root, ...parts)
  }

  async open(path: string, opts: { create?: boolean }): Promise<VfsFile> {
    const real = this.#real(path)
    if (!existsSync(real)) {
      if (opts.create !== true) throw fileNotFound(path)
      mkdirSync(dirname(real), { recursive: true })
      // 'a+' would refuse positional writes on Linux; create, then reopen r+.
      closeSync(openSync(real, 'a'))
    } else if (statSync(real).isDirectory()) throw fileNotFound(path)
    return new NodeFile(path, openSync(real, 'r+'), this.#pageSize)
  }

  async delete(path: string): Promise<void> {
    const real = this.#real(path)
    if (!existsSync(real) || statSync(real).isDirectory()) throw fileNotFound(path)
    unlinkSync(real)
  }

  async list(dir: string): Promise<string[]> {
    const real = this.#real(dir)
    if (!existsSync(real) || !statSync(real).isDirectory()) return []
    return readdirSync(real)
      .filter((n) => !n.startsWith('.myjs-lock'))
      .sort()
  }

  async lock(path: string): Promise<Lock> {
    let queue = this.#locks.get(path)
    if (queue === undefined) {
      queue = new LockQueue()
      this.#locks.set(path, queue)
    }
    await queue.acquire()
    const file = join(this.root, `.myjs-lock-${encodeURIComponent(path)}`)
    try {
      await this.#acquireFile(file)
    } catch (e) {
      queue.release()
      throw e
    }
    return this.#heldLock(path, file, queue)
  }

  /**
   * Take the lock now or not at all: `undefined` when this process or another
   * holds it. What opening a database uses, since a database already open
   * should be an error at once rather than a wait with no end (doc 41: one
   * owner).
   */
  tryLock(path: string): Lock | undefined {
    let queue = this.#locks.get(path)
    if (queue === undefined) {
      queue = new LockQueue()
      this.#locks.set(path, queue)
    }
    if (!queue.take()) return undefined
    const file = join(this.root, `.myjs-lock-${encodeURIComponent(path)}`)
    try {
      if (this.#tryFile(file)) return this.#heldLock(path, file, queue)
    } catch (e) {
      queue.release()
      throw e
    }
    queue.release()
    return undefined
  }

  /** Release exactly the file and queue acquired by this lock. */
  #heldLock(path: string, file: string, queue: LockQueue): Lock {
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      try { rmSync(file, { force: true }) } finally { queue.release() }
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

  /** Exclusive creation is the ownership gate; an existing file always wins. */
  #tryFile(file: string): boolean {
    let fd: number
    try {
      fd = openSync(file, 'wx')
    } catch (e) {
      if ((e as { code?: string }).code === 'EEXIST') return false
      throw e
    }
    try {
      writeFileSync(fd, String(process.pid))
    } catch (e) {
      const errors = [e]
      for (const clean of [() => closeSync(fd), () => rmSync(file, { force: true })]) {
        try { clean() } catch (failure) { errors.push(failure) }
      }
      if (errors.length > 1) throw new AggregateError(errors, 'lock initialization failed')
      throw e
    }
    closeSync(fd)
    return true
  }

  /** Wait for an owner to release; crash recovery is an explicit operation. */
  async #acquireFile(file: string): Promise<void> {
    for (;;) {
      if (this.#tryFile(file)) return
      await new Promise((r) => setTimeout(r, this.#poll))
    }
  }
}

