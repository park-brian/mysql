# 40 — The VFS: one storage interface, three platforms

> Sources: MDN `FileSystemFileHandle.createSyncAccessHandle()`; PowerSync's
> *The Current State Of SQLite Persistence On The Web* (May 2026); PGlite's
> `packages/pglite/src/fs/` (`opfs-ahp.ts`, `nodefs.ts`, `memoryfs.ts`,
> `idbfs.ts`); SQLite's `sqlite3_vfs` design.

This is the only platform-dependent module in the system. Everything above it is
portable JavaScript. Keeping it small and honest is what makes "isomorphic"
true rather than aspirational.

## The interface

```js
/**
 * A block device. Files are page-addressed; the engine never seeks by byte.
 * All methods are SYNCHRONOUS once the file is open — this is deliberate.
 */
export interface VfsFile {
  readonly pageSize: number
  readPage(pageNo: number, into: Uint8Array): void
  writePage(pageNo: number, from: Uint8Array): void
  readBytes(offset: number, into: Uint8Array): number   // WAL, headers
  writeBytes(offset: number, from: Uint8Array): void
  size(): number
  truncate(bytes: number): void
  flush(): void          // durability barrier
  close(): void
}

export interface Vfs {
  readonly name: 'opfs' | 'node' | 'memory'
  readonly durability: 'strong' | 'best-effort'
  open(path: string, opts: { create?: boolean }): Promise<VfsFile>
  delete(path: string): Promise<void>
  list(dir: string): Promise<string[]>
  lock(path: string): Promise<Lock>        // cross-context exclusion
}
```

Two design decisions worth defending:

**Synchronous once open.** Both platforms offer synchronous I/O — OPFS
`FileSystemSyncAccessHandle` and Node's `readSync`/`writeSync` — and a
synchronous storage layer makes the B+tree dramatically simpler: no await inside
a page split, no re-entrancy, no partially-applied mini-transaction because a
promise resolved in the wrong order. The async part is confined to *opening*,
which happens once.

**Page-addressed, not byte-addressed.** The engine reads and writes whole pages.
Byte access exists only for the WAL and headers. This keeps the interface small
and makes a caching or compressing VFS trivial to slot in.

## Browser: OPFS

The Origin Private File System, reached via
`navigator.storage.getDirectory()`. The fast path is
`FileSystemFileHandle.createSyncAccessHandle()`, which returns a handle with
genuinely synchronous `read`, `write`, `truncate`, `getSize` and `flush`.

### The constraints, precisely

1. **Sync access handles work only in a dedicated Worker.** Not the main thread,
   not a SharedWorker. This is a spec-level restriction, not a browser gap:
   synchronous I/O on the main thread would block rendering. Consequence: **the
   database must live in a dedicated Worker**, and every other context talks to
   it over a `MessagePort`. This is not a workaround, it is the architecture
   (doc 03).
2. **Acquiring a handle is async and exclusive.** By default only one handle per
   file may exist at a time, across the whole origin. Chrome 121+ adds
   `createSyncAccessHandle({ mode: 'readwrite-unsafe' })` allowing several, but
   **Safari and Firefox do not support it**, so it cannot be depended upon.
3. **`flush()` is best-effort.** The spec says it ensures modifications are
   written to disk; in practice browsers buffer, and there is no `fsync`
   guarantee comparable to a POSIX filesystem. Design accordingly.
4. **Tab suspension closes handles.** Chrome and Edge may close access handles
   when a tab is suspended, and operations then fail. The VFS must detect this
   and re-acquire.
5. **Quotas and incognito.** Chrome's incognito mode caps OPFS around 100 MB
   and reports confusing errors at the limit; **Safari private browsing does not
   support OPFS at all**. `navigator.storage.persist()` should be requested, and
   a fallback path is mandatory.

### The access-handle pool

Because acquiring handles is slow and exclusive, the established technique — used
by PGlite's `opfs-ahp.ts` and by wa-sqlite's `AccessHandlePoolVFS` — is to
**pre-open a pool of handles on files with opaque names and map logical files
onto them**:

```
OPFS directory:
  .pool/0000  .pool/0001  .pool/0002  ...      ← pre-opened sync handles
  .pool/manifest                                ← logical name → pool slot

open("main.db")   → slot 0003 (already open, synchronous from here)
open("wal.log")   → slot 0007
```

This turns every subsequent operation into a synchronous call, at the cost of
managing a manifest and growing the pool when it runs out. It is the single most
important browser-storage technique in this space and it should be in the design
from the start, not retrofitted.

### Fallbacks, in order

1. **OPFS with sync access handles** — the fast path. Chrome 108+, Safari 16.4+,
   Firefox 111+.
2. **OPFS async API** — `createWritable()`. Works outside dedicated workers but
   is far slower and has different atomicity behaviour (a writable stream writes
   to a temporary file and swaps on close).
3. **IndexedDB block store** — pages as records in an object store, `absurd-sql`
   style. Necessary for Safari private browsing.
4. **In-memory** — always available; the base case for tests.

## Node / Bun / Deno

Straightforward:

```js
const fd = fs.openSync(path, 'r+')
fs.readSync(fd, buf, 0, pageSize, pageNo * pageSize)
fs.writeSync(fd, buf, 0, pageSize, pageNo * pageSize)
fs.fsyncSync(fd)
```

`fsyncSync` is a real durability barrier (subject to the usual caveats about
drive write caches and macOS's `F_FULLFSYNC`, which `fsync` does *not* imply —
if strict durability matters on macOS, use `fcntl(F_FULLFSYNC)`).

Cross-process exclusion uses an advisory lock file containing the pid, with
staleness detection. Deno and Bun both implement `node:fs`, so the same backend
serves all three.

## Memory

A `Map<number, Uint8Array>` of pages. `flush()` is a no-op; `durability` reports
`'best-effort'`. This is the backend every unit test uses, and it should be the
*reference* implementation — if a bug reproduces only on OPFS, the VFS is at
fault, not the engine.

## Durability, honestly

| Platform | `flush()` means | Real guarantee |
|---|---|---|
| Node | `fsyncSync` | strong, modulo drive caches (and `F_FULLFSYNC` on macOS) |
| OPFS sync handle | `handle.flush()` | best-effort; the browser may still buffer |
| OPFS async | stream close | atomic *replace* of the whole file, not of a range |
| IndexedDB | transaction commit | strong within IDB's own model |
| Memory | nothing | none |

Because OPFS gives us **best-effort** rather than strong durability, the WAL must
be self-verifying rather than trusting the platform:

- **CRC32C every block.** A block that does not verify did not happen.
- **A monotonic LSN in every block**, so a partially written tail is detectable
  as a gap, not silently accepted.
- **Full-page images after each checkpoint** (doc 26), so a torn data page can
  always be reconstructed from the log.
- **Two alternating superblocks**, so the commit record itself is never a
  single point of failure.

With those four properties, "best-effort flush" degrades to "we may lose the
last few committed transactions after a crash" — which is an acceptable and
*documentable* guarantee — rather than "the database may be corrupt", which is
not.

`Vfs.durability` is exposed to the application so it can decide: a strict
application can refuse to run on a best-effort VFS, or reduce its commit
batching.

## Cross-context locking

| Platform | Mechanism |
|---|---|
| Browser | **Web Locks API** — `navigator.locks.request(name, { mode: 'exclusive' })`. Leader election across tabs falls straight out of it, and locks are released automatically if the holder's context dies. |
| Node | an advisory lock file containing the pid, with staleness detection |
| Memory | none needed |

The Web Locks API is genuinely well suited to this: the "the tab holding the
lock was closed" case — the one that makes lock files miserable — is handled by
the browser.

## What we deliberately do not do

- **No SharedArrayBuffer in the default path.** It requires cross-origin
  isolation (`COOP`/`COEP`), which breaks third-party embeds and is a
  significant tax on the consumer. A SAB-based shared buffer pool can be an
  opt-in optimisation later; it must not be a requirement. (This is also one of
  the arguments against the WASM-port strategy — see
  [02-strategy.md](./02-strategy.md).)
- **No Emscripten FS emulation.** PGlite needs it because Postgres calls POSIX
  functions. We are writing the storage layer, so we can define an interface
  that fits the platforms instead of emulating one that does not.
- **No byte-level random access as the primary interface.** Pages only, with a
  small byte escape hatch for the WAL.
