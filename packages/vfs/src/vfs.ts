// M0.9 — the `Vfs` / `VfsFile` interfaces from docs/40-vfs.md, with erratum
// E-02 applied.
//
// Two design decisions doc 40 defends and this interface encodes:
//
//   Synchronous once open. Both platforms offer synchronous I/O — OPFS
//   `FileSystemSyncAccessHandle` and Node's `readSync`/`writeSync` — and a
//   synchronous storage layer makes the B+tree dramatically simpler: no await
//   inside a page split, no re-entrancy, no partially-applied mini-transaction
//   because a promise resolved in the wrong order. The async part is confined
//   to opening, which happens once.
//
//   Page-addressed, not byte-addressed. The engine reads and writes whole
//   pages. Byte access exists only for the WAL and headers.
//
// E-02: `durability` is a property of the *backend*, not of one open file, so
// it lives on `Vfs`. Doc 40's interface block already had it there; its prose
// said `VfsFile.durability`, and that sentence is corrected in the same commit
// as this file.

/**
 * A cross-context exclusion handle.
 *
 * Doc 40's `Vfs.lock()` returns one of these and the docs never declare the
 * type (erratum E-04). It is deliberately minimal: acquiring is the async
 * part, and releasing must be possible from a `finally` or a `using`
 * declaration. In the browser this wraps a Web Lock, whose "the tab holding
 * the lock was closed" case the platform handles for us; in Node it wraps an
 * advisory lock file with staleness detection; memory needs none.
 */
export interface Lock {
  /** The path this lock excludes on. */
  readonly path: string
  /** False once released; a second `release()` is a no-op, not an error. */
  readonly held: boolean
  release(): void
  [Symbol.dispose](): void
}

/**
 * A block device. Files are page-addressed; the engine never seeks by byte.
 * All methods are SYNCHRONOUS once the file is open — this is deliberate.
 */
export interface VfsFile {
  readonly pageSize: number
  readPage(pageNo: number, into: Uint8Array): void
  writePage(pageNo: number, from: Uint8Array): void
  readBytes(offset: number, into: Uint8Array): number // WAL, headers
  writeBytes(offset: number, from: Uint8Array): void
  size(): number
  truncate(bytes: number): void
  flush(): void // durability barrier
  close(): void
}

export interface Vfs {
  readonly name: 'opfs' | 'node' | 'memory'
  /**
   * What `flush()` actually buys. Exposed to the application so it can decide:
   * a strict application can refuse to run on a best-effort VFS, or reduce its
   * commit batching.
   *
   * Memory reports `'best-effort'` (doc 40 §Memory). Its real guarantee is
   * none at all, but the union has no third member and adding one would make
   * every consumer branch on a case that only a test backend can produce
   * (erratum E-03).
   */
  readonly durability: 'strong' | 'best-effort'
  open(path: string, opts: { create?: boolean }): Promise<VfsFile>
  delete(path: string): Promise<void>
  list(dir: string): Promise<string[]>
  lock(path: string): Promise<Lock> // cross-context exclusion
}

/** Default page size. D-16 keeps InnoDB's 16 KiB for a one-to-one import mapping. */
export const DEFAULT_PAGE_SIZE = 16 * 1024

/** Errors a backend raises. Ground rule 5: typed, never a bare `Error`. */
export class VfsError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

export function fileNotFound(path: string): VfsError {
  return new VfsError('VFS_NOT_FOUND', `no such file: ${path}`)
}

export function fileClosed(path: string): VfsError {
  return new VfsError('VFS_CLOSED', `file is closed: ${path}`)
}

export function badPage(pageNo: number, expected: number, got: number): VfsError {
  return new VfsError(
    'VFS_BAD_PAGE_BUFFER',
    `page ${pageNo}: buffer must be exactly ${expected} bytes, got ${got}`,
  )
}
