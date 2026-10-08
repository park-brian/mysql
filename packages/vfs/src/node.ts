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
// owner's pid: a file whose pid is no longer running is stale, and taken over.
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
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

  get busy(): boolean {
    return this.#held
  }

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

/**
 * The lock files this process holds, whichever `NodeVfs` took them: two
 * instances over one directory are two owners, and a file naming this pid that
 * is not in here is a leftover from a lock never released.
 */
const HELD = new Set<string>()

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM'
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
    this.root = resolve(root)
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    this.#poll = options.lockPollMs ?? 50
    mkdirSync(this.root, { recursive: true })
  }

  /** A VFS path as a real one under the root; `..` is refused. */
  #real(path: string): string {
    const parts = path.split('/').filter((p) => p !== '' && p !== '.')
    if (parts.includes('..')) throw new VfsError('VFS_BAD_PATH', `a path may not leave the database: ${path}`)
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
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      HELD.delete(file)
      rmSync(file, { force: true })
      queue.release()
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
    if (!this.#tryFile(file)) {
      queue.release()
      return undefined
    }
    const q = queue
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      HELD.delete(file)
      rmSync(file, { force: true })
      q.release()
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

  /** Create the lock file exclusively, taking over one whose owner is gone. */
  #tryFile(file: string): boolean {
    if (HELD.has(file)) return false
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(file, String(process.pid), { flag: 'wx' })
        HELD.add(file)
        return true
      } catch (e) {
        if ((e as { code?: string }).code !== 'EEXIST') throw e
      }
      let owner = NaN
      try {
        owner = Number(readFileSync(file, 'utf8'))
      } catch {
        continue
      }
      if (Number.isInteger(owner) && owner !== process.pid && isRunning(owner)) return false
      // Take the stale file over by renaming it aside, which only one of two
      // racing processes can do, and check it was the stale one: a process
      // that read the dead pid a moment ago and then deleted the file could
      // otherwise remove a lock another had just created, and both would own
      // the database (found by review). Moving a fresh lock aside by mistake
      // puts it back and backs off.
      const tomb = `${file}.stale-${process.pid}-${Date.now()}`
      try {
        renameSync(file, tomb)
      } catch {
        continue
      }
      let moved = NaN
      try {
        moved = Number(readFileSync(tomb, 'utf8'))
      } catch {
        // Unreadable: it was the stale one or nothing.
      }
      if (moved !== owner && Number.isInteger(moved)) {
        try {
          renameSync(tomb, file)
        } catch {
          rmSync(tomb, { force: true })
        }
        return false
      }
      rmSync(tomb, { force: true })
    }
    return false
  }

  /** The cross-process half: create the lock file exclusively, taking over one whose owner has died. */
  async #acquireFile(file: string): Promise<void> {
    for (;;) {
      if (this.#tryFile(file)) return
      await new Promise((r) => setTimeout(r, this.#poll))
    }
  }
}

