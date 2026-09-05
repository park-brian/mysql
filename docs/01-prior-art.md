# 01 — Prior art

What already exists, what each one actually did, and what we should take from it.

## PGlite (ElectricSQL) — the model we are named after

PGlite is Postgres compiled to WebAssembly with Emscripten and wrapped in a
TypeScript client. From its own README: *"a WASM Postgres build packaged into a
TypeScript client library that enables you to run Postgres in the browser,
Node.js, Bun and Deno … only 3mb gzipped."*

The parts of its design worth stealing outright (verified by reading
`reference/pglite/packages/pglite/src`):

- **`execProtocol()`**: the public API is not just `query()`. PGlite exposes a
  method that takes raw Postgres wire-protocol bytes and returns raw bytes. Every
  higher-level convenience is built on top. This is why `pglite-socket` can put a
  real TCP server in front of it and let `psql` connect. **We should do exactly
  this with the MySQL protocol** — it is the cleanest possible boundary between
  "the database" and "how you talk to it", and it makes the whole driver
  ecosystem reachable for free.
- **A pluggable filesystem layer** (`src/fs/`: `nodefs.ts`, `memoryfs.ts`,
  `idbfs.ts`, `opfs-ahp.ts`). The OPFS backend is an *access-handle pool* —
  it opens a pool of sync access handles up front and multiplexes logical files
  onto them, because acquiring a handle is async and slow but using one is sync
  and fast. This is the single most important browser-storage technique and it
  is discussed in [40-vfs.md](./40-vfs.md).
- **A worker package** with leader election, so multiple tabs share one database
  instance rather than corrupting each other.
- **Extensions as separately-loaded WASM** (`pglite-pgvector`, `pglite-postgis`,
  …), keeping the core small.

Why the *port* strategy worked for them and is much harder for us: see
[02-strategy.md](./02-strategy.md). The short version is process model and
licence.

## SQLite — the ergonomics benchmark

SQLite is the target for *feel*: one file, no server, synchronous-feeling API,
zero configuration, and a storage format that is stable for decades and
[formally documented](https://sqlite.org/fileformat2.html).

Three things it does that we should copy:

1. **A published, versioned file format** with a header that declares its own
   version. MySQL has nothing equivalent; InnoDB's format is documented only by
   its source. If we define our own native format we should document it to
   SQLite's standard.
2. **A VFS abstraction as a first-class, public interface.** SQLite's `sqlite3_vfs`
   is why it runs everywhere, including in browsers over OPFS. Our VFS (doc 40)
   should be equally explicit and equally small.
3. **Testing at an obsessive ratio.** SQLite ships far more test code than
   library code, plus `sqllogictest` for differential testing against other
   engines. Doc 43 takes this seriously.

The official `sqlite3.wasm` build ships two browser persistence VFSes: one over
OPFS sync access handles (fast, requires a Worker) and one "pool" variant.
`wa-sqlite` and `absurd-sql` explored the same space earlier — `absurd-sql`
notably emulated a block device over IndexedDB, which is the fallback design we
inherit for browsers without OPFS.

## DuckDB-WASM

Analytics rather than OLTP, but instructive for two reasons: it demonstrates
that a large C++ codebase *can* be brought to WASM productively, and it shows
the cost — a multi-megabyte bundle and a build that needs constant maintenance
against Emscripten. It also pioneered HTTP range-request access to remote
files, which is a good pattern for read-only "open a `.ibd` over the network".

## libSQL / Turso

A fork of SQLite that added a server protocol, replication and a WASM build.
The relevant lesson is organisational: they found it necessary to *fork* rather
than wrap, because embedding decisions reach deep into the engine. If we choose
the reimplementation path we avoid this problem entirely; if we choose the port
path we should expect to end up maintaining a fork.

## MySQL in WebAssembly — the state of the art is "nobody has done it"

This is worth stating plainly, because it is the strongest single input to our
strategy.

- Oracle's own [WebAssembly feature in MySQL 9.x](https://dev.mysql.com/doc/refman/9.6/en/srjs-webassembly.html)
  is the *opposite* direction: it lets you load WASM modules and call them from
  JavaScript stored programs **inside** a running MySQL server. It is not a WASM
  build of MySQL.
- The [wasmlabs "LAMP stack in Wasm"](https://wasmlabs.dev/articles/wordpress-nginx-fcgi-mysql/)
  demo, despite the title, does **not** run MySQL in WASM. Only PHP is compiled
  to WASM; MySQL runs as an ordinary native service in its own container, reached
  over a socket (they had to extend WASI sockets to make even the *client* side
  work, and had no DNS resolution).
- Browser demos that genuinely run `mysqld` do it by running a whole Linux
  system under an x86 emulator such as `v86`. That is emulation of a machine,
  not a port of a database, and its performance and size are what you would
  expect.

There is no equivalent of PGlite for MySQL, and that is not an accident.

## Pure-JavaScript SQL engines

- **sql.js** — SQLite compiled to WASM/asm.js. Same category as above.
- **AlaSQL, sql.js-httpvfs, LokiJS, RxDB, Dexie** — either not SQL, or SQL over a
  document store with no real type system, transactions, or index semantics.
- **`node-mysql2`'s server mode** — `mysql2` contains a *server-side* protocol
  implementation (`lib/server.js`, and the `toPacket`/`fromPacket` halves of
  every packet class). This is a genuinely valuable reference: it proves the
  protocol is implementable in plain JavaScript and gives us a second opinion on
  every packet layout. We read it while writing docs 10–17.
- **MariaDB's Node connector** — a second independent implementation, useful for
  cross-checking the ambiguous corners (extended metadata, MariaDB's use of the
  reserved handshake bytes).

## What nobody has built

A MySQL-compatible engine that is:

- pure JavaScript (so it is small, isomorphic, and permissively licensed),
- wire-protocol compatible (so the driver ecosystem works),
- and able to read and write real InnoDB tablespaces (so data is portable).

That gap is the project.
