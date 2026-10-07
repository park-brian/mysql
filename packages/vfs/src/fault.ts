// M4.25 — doc 43 §5's fault-injecting VFS: storage that crashes on cue.
//
// Each file has two images. The *durable* one is what survived the last
// `flush()`; the *current* one is what the process reads, and the difference
// is the list of writes made since. The VFS counts every write, truncate and
// flush across all its files, and on the one numbered `crashAt` the process
// dies: that write may be torn — only some of its 512-byte sectors land — and
// every later call throws `VFS_CRASHED`, so nothing the engine does after the
// crash can reach storage.
//
// `afterCrash` is the machine coming back up, in one of two ways:
//
//   - `'process'`: the program died and the operating system did not. Every
//     write it made is still there, the torn one as far as it got — but none
//     of them is durable yet, so a power cut after this one can still lose
//     them.
//   - `'power'`: the machine lost power. Of the writes since each file's last
//     flush, a seeded random choice survives — each whole, dropped, or torn —
//     which is also a reordering, since a later write can survive an earlier
//     one. This is what doc 41's "best-effort flush" has to be safe against.
//
// Deterministic for a given seed, so a failing crash point replays exactly.
//
// It is reached as `@myjs/vfs/fault`, not from the package root: a test
// instrument should not cost an application's bundle a byte.
import { MemoryVfs } from './memory.ts'
import { VfsError, fileNotFound, type Lock, type Vfs, type VfsFile } from './vfs.ts'

export interface FaultOptions {
  readonly pageSize?: number
  /** Crash on this operation (1-based), counting writes, truncates and flushes. Unset: never. */
  readonly crashAt?: number
  /** Whether the crashing write is torn at a sector boundary. Default `true`. */
  readonly tearWrites?: boolean
  readonly seed?: number
}

type Pending = { readonly offset: number; readonly bytes: Uint8Array } | { readonly truncate: number }

interface FileState {
  durable: Uint8Array
  current: Uint8Array
  pending: Pending[]
}

const SECTOR = 512

export function crashed(): VfsError {
  return new VfsError('VFS_CRASHED', 'the process crashed: no further I/O reaches storage')
}

export class FaultInjectingVfs implements Vfs {
  readonly name = 'memory' as const
  readonly durability = 'best-effort' as const
  readonly pageSize: number
  readonly #files = new Map<string, FileState>()
  readonly #locks = new MemoryVfs()
  readonly #crashAt: number
  readonly #tear: boolean
  #rng: number
  #ops = 0
  #dead = false

  constructor(options: FaultOptions = {}) {
    this.pageSize = options.pageSize ?? 16 * 1024
    this.#crashAt = options.crashAt ?? Infinity
    this.#tear = options.tearWrites ?? true
    // Xorshift's first outputs from a small seed are a multiple of it, so seeds
    // 1, 2, 3… would all make the same choices: mix the seed first.
    this.#rng = Math.imul(((options.seed ?? 1) ^ 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0 || 1
    for (let i = 0; i < 4; i++) this.#random()
  }

  /** Operations counted so far: run a workload uncrashed to learn how many crash points it has. */
  get operations(): number {
    return this.#ops
  }

  get crashed(): boolean {
    return this.#dead
  }

  async open(path: string, opts: { create?: boolean }): Promise<VfsFile> {
    this.#alive()
    let state = this.#files.get(path)
    if (state === undefined) {
      if (opts.create !== true) throw fileNotFound(path)
      state = { durable: new Uint8Array(0), current: new Uint8Array(0), pending: [] }
      this.#files.set(path, state)
    }
    return new FaultFile(this, path, state)
  }

  async delete(path: string): Promise<void> {
    this.#alive()
    if (!this.#files.delete(path)) throw fileNotFound(path)
  }

  async list(dir: string): Promise<string[]> {
    const prefix = dir === '' || dir.endsWith('/') ? dir : dir + '/'
    const names = new Set<string>()
    for (const path of this.#files.keys()) {
      if (!path.startsWith(prefix) || path === prefix) continue
      const rest = path.slice(prefix.length)
      names.add(rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest)
    }
    return [...names].sort()
  }

  lock(path: string): Promise<Lock> {
    return this.#locks.lock(path)
  }

  /** The machine after the crash, as a new VFS with no crash armed. */
  afterCrash(how: { kind: 'process' | 'power'; seed?: number; crashAt?: number }): FaultInjectingVfs {
    const next = new FaultInjectingVfs({ pageSize: this.pageSize, seed: how.seed ?? this.#rng, ...(how.crashAt === undefined ? {} : { crashAt: how.crashAt }) })
    for (const [path, s] of this.#files) {
      if (how.kind === 'process') {
        next.#files.set(path, { durable: s.durable.slice(), current: s.current.slice(), pending: [...s.pending] })
        continue
      }
      let image: Uint8Array = s.durable.slice()
      for (const p of s.pending) {
        const roll = next.#random() % 3
        if (roll === 0) continue
        if ('truncate' in p) image = resize(image, p.truncate)
        else image = roll === 1 ? apply(image, p.offset, p.bytes) : next.#tornInto(image, p.offset, p.bytes)
      }
      next.#files.set(path, { durable: image, current: image.slice(), pending: [] })
    }
    return next
  }

  // --- for FaultFile ------------------------------------------------------------

  /** Count an operation; `true` if this is the one that crashes. */
  tick(): boolean {
    this.#alive()
    if (++this.#ops !== this.#crashAt) return false
    this.#dead = true
    return true
  }

  write(state: FileState, offset: number, bytes: Uint8Array): void {
    if (this.tick()) {
      if (this.#tear) {
        for (const piece of this.#sectors(offset, bytes)) {
          state.current = apply(state.current, piece.offset, piece.bytes)
          state.pending.push(piece)
        }
      }
      throw crashed()
    }
    state.current = apply(state.current, offset, bytes)
    state.pending.push({ offset, bytes: bytes.slice() })
  }

  #alive(): void {
    if (this.#dead) throw crashed()
  }

  /** A write of which only some sectors landed. */
  #tornInto(image: Uint8Array, offset: number, bytes: Uint8Array): Uint8Array {
    let out = image
    for (const piece of this.#sectors(offset, bytes)) out = apply(out, piece.offset, piece.bytes)
    return out
  }

  /** A random subset of a write's sectors. */
  #sectors(offset: number, bytes: Uint8Array): { offset: number; bytes: Uint8Array }[] {
    const out: { offset: number; bytes: Uint8Array }[] = []
    for (let s = 0; s < bytes.length; s += SECTOR) if (this.#random() % 2 === 0) out.push({ offset: offset + s, bytes: bytes.slice(s, s + SECTOR) })
    return out
  }

  #random(): number {
    let x = this.#rng
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.#rng = x >>> 0
    return this.#rng
  }
}

class FaultFile implements VfsFile {
  readonly pageSize: number
  readonly #vfs: FaultInjectingVfs
  readonly #path: string
  readonly #state: FileState
  #closed = false

  constructor(vfs: FaultInjectingVfs, path: string, state: FileState) {
    this.#vfs = vfs
    this.#path = path
    this.#state = state
    this.pageSize = vfs.pageSize
  }

  #alive(): FileState {
    if (this.#vfs.crashed) throw crashed()
    if (this.#closed) throw new VfsError('VFS_CLOSED', `file is closed: ${this.#path}`)
    return this.#state
  }

  readPage(pageNo: number, into: Uint8Array): void {
    if (into.length !== this.pageSize) throw new VfsError('VFS_BAD_PAGE_BUFFER', `page buffer must be ${this.pageSize} bytes`)
    if (pageNo < 0 || !Number.isInteger(pageNo)) throw new VfsError('VFS_BAD_PAGE_NO', `bad page number ${pageNo}`)
    this.readBytes(pageNo * this.pageSize, into)
  }

  writePage(pageNo: number, from: Uint8Array): void {
    if (from.length !== this.pageSize) throw new VfsError('VFS_BAD_PAGE_BUFFER', `page buffer must be ${this.pageSize} bytes`)
    if (pageNo < 0 || !Number.isInteger(pageNo)) throw new VfsError('VFS_BAD_PAGE_NO', `bad page number ${pageNo}`)
    this.writeBytes(pageNo * this.pageSize, from)
  }

  readBytes(offset: number, into: Uint8Array): number {
    const s = this.#alive()
    if (offset < 0 || !Number.isInteger(offset)) throw new VfsError('VFS_BAD_OFFSET', `bad offset ${offset}`)
    const n = Math.max(0, Math.min(into.length, s.current.length - offset))
    into.set(s.current.subarray(offset, offset + n))
    into.fill(0, n)
    return n
  }

  writeBytes(offset: number, from: Uint8Array): void {
    const s = this.#alive()
    if (offset < 0 || !Number.isInteger(offset)) throw new VfsError('VFS_BAD_OFFSET', `bad offset ${offset}`)
    this.#vfs.write(s, offset, from)
  }

  size(): number {
    return this.#alive().current.length
  }

  truncate(bytes: number): void {
    const s = this.#alive()
    if (bytes < 0 || !Number.isInteger(bytes)) throw new VfsError('VFS_BAD_LENGTH', `bad length ${bytes}`)
    if (this.#vfs.tick()) throw crashed()
    s.current = resize(s.current, bytes)
    s.pending.push({ truncate: bytes })
  }

  flush(): void {
    const s = this.#alive()
    if (this.#vfs.tick()) throw crashed()
    s.durable = s.current.slice()
    s.pending = []
  }

  close(): void {
    this.#closed = true
  }
}

function apply(image: Uint8Array, offset: number, bytes: Uint8Array): Uint8Array {
  const out = offset + bytes.length > image.length ? resize(image, offset + bytes.length) : image
  out.set(bytes, offset)
  return out
}

function resize(image: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length)
  out.set(image.subarray(0, Math.min(length, image.length)))
  return out
}
