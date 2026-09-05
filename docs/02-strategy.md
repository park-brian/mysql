# 02 — Strategy: port MySQL, or reimplement it?

This is the decision everything else hangs off. It deserves an honest analysis
rather than a slogan.

## The two options

**Option A — Port.** Compile MySQL (or MariaDB) to WebAssembly with Emscripten,
run it single-user in the host process, and wrap it in a TypeScript client.
This is exactly what PGlite did to Postgres.

**Option B — Reimplement.** Write a MySQL-compatible engine in JavaScript:
parser, planner, executor, storage. Use the MySQL wire protocol as the
compatibility contract and an InnoDB codec as the interchange format.

## Why the port worked for Postgres

PGlite exists because Postgres has four properties that make it portable:

1. **A process-per-connection architecture with a genuine single-user mode.**
   `postgres --single` runs the whole backend in one process, no postmaster, no
   background workers required. There is a supported code path where Postgres is
   a single-threaded program that reads a query and writes a result.
2. **Very little threading.** The parallelism model is processes, not threads,
   and it is optional.
3. **A permissive licence.** The PostgreSQL Licence is BSD-like. PGlite can ship
   as an Apache-2.0 npm package.
4. **A modest, C-based dependency set** that Emscripten already handles.

## Why the port does not work for MySQL

Each of those four properties fails, and the fourth failure is decisive.

### 1. There is no single-user mode

MySQL has no `--single`. The closest thing, `--initialize` / bootstrap mode, is
about *creating* a datadir, not serving queries, and it still starts InnoDB —
which means it still starts InnoDB's background threads.

### 2. InnoDB is fundamentally multi-threaded

Reading `storage/innobase/srv/srv0start.cc` in the current tree, startup spawns
dedicated threads for at minimum:

> `log_writer`, `log_flusher`, `log_checkpointer`, `log_write_notifier`,
> `log_flush_notifier`, `log_files_governor`, `page_cleaner` (plus coordinator),
> `master`, `purge_coordinator`, `purge_workers` (N of them), `dict_stats`,
> `buf_dump`, `buf_resize`, `error_monitor`, `monitor`, `lock_wait_timeout`,
> `fts_optimize`, `recv_writer`, `trx_recovery_rollback`, `ts_alter_encrypt`.

These are not optional decorations. The redo log's write/flush pipeline, the
buffer pool's flush list, and purge are *correctness*-relevant: durability and
MVCC garbage collection depend on them making progress. You cannot simply stub
them out and expect a functioning database; you would have to restructure InnoDB
into a cooperatively-scheduled single-threaded engine — which is a rewrite of
the hardest part of the codebase, not a port.

Emscripten *does* support pthreads, via Web Workers plus `SharedArrayBuffer`.
But `SharedArrayBuffer` requires cross-origin isolation (`COOP`/`COEP` response
headers) in browsers. Requiring every consumer to reconfigure their web server's
headers — and thereby break their third-party embeds, ads and iframes — is a
very large tax on a library whose entire selling point is "just import it".

### 3. Scale and build complexity

`sql/` alone is ~970 kLOC; `storage/innobase/` is ~470 kLOC. The build needs
Bison, a host-tools bootstrap (`comp_err`, `gen_lex_hash`, `protoc`), and links
against OpenSSL, ICU, zlib, zstd, LZ4, protobuf, RapidJSON, Boost, libedit,
libfido2, curl and more (`CMakeLists.txt`, `MYSQL_CHECK_*`). ICU in particular
is a multi-megabyte data blob that MySQL 8 requires for regular expressions.
A resulting bundle in the tens of megabytes is a realistic expectation, against
PGlite's 3 MB gzipped.

### 4. The licence — the decisive point

MySQL is **GPLv2** (with the FOSS Exception). MariaDB Server is **GPLv2**.
Postgres is BSD-like; SQLite is public domain; DuckDB is MIT.

A WASM artefact of MySQL is a derivative work of MySQL. An npm package that
ships it, and the applications that link it into their bundle, inherit GPLv2
obligations. For a library meant to be dropped into arbitrary web and Node
applications, that is not a footnote — it changes who can use it at all. The
"embed the real engine" strategy that is available for Postgres and SQLite is
simply not available for MySQL on the same terms.

### 5. The empirical evidence

Nobody has done it. Oracle's own "WebAssembly in MySQL" feature runs WASM
*inside* the server, not the reverse. The well-known "LAMP in Wasm" demo runs
MySQL as an ordinary native container and only compiles PHP. Browser demos that
genuinely run `mysqld` do so under a whole-machine x86 emulator. See
[01-prior-art.md](./01-prior-art.md) for citations.

## The recommendation

**Option B — reimplement in JavaScript — with a deliberately layered
compatibility story.**

The insight that makes this tractable is that "MySQL compatibility" decomposes
into three contracts that can be satisfied independently, at very different
costs (see [00-goals-and-scope.md](./00-goals-and-scope.md)):

| Contract | Cost | Value | Verdict |
|---|---|---|---|
| Wire protocol | **Low** — a few thousand lines, fully specified in docs 10–17 | **Very high** — the entire driver and ORM ecosystem | Primary contract, do it first |
| SQL semantics | **High** — this is the real engineering | **Very high** — it is what "MySQL" means to a user | The long tail; grow it by demand |
| InnoDB byte format | **Medium** — well-understood, and we have decoded it in docs 21–24 | **High but narrow** — data portability, forensics, migration | Separable module; interchange, not native storage |

### Corollary: do not make InnoDB the native on-disk format

This is the subtle call, so here is the reasoning.

Writing a `.ibd` file that a real `mysqld` will *serve* is not the same as
writing valid InnoDB pages. A server-usable datadir also requires:

- the **data dictionary**, which since 8.0 lives in InnoDB tables inside
  `mysql.ibd` whose schema is internal, undocumented and version-specific
  (doc 27);
- a consistent **redo log** and a **doublewrite** file, whose formats changed in
  8.0.30 and which encode a specific server version;
- version-matched handling of **instant DDL row versions** (`REC_INFO_VERSION_FLAG`,
  doc 23), which changed in 8.0.29.

MySQL itself does not promise that a datadir can be moved between versions
without running an upgrade. Adopting the whole-datadir format as *our* native
format would chain our storage layer to a moving target we do not control, in
exchange for a guarantee MySQL does not itself make.

There is, however, a boundary MySQL *does* document and support:
**transportable tablespaces** — `FLUSH TABLES … FOR EXPORT` produces a `.ibd`
plus a `.cfg` metadata file, and `ALTER TABLE … IMPORT TABLESPACE` consumes
them. That is a per-table, version-tolerant, officially supported interchange
format. It is the right place to put our file-format compatibility.

So:

- **Native storage**: our own page-based, WAL-backed B+tree store, designed for
  OPFS and for exhaustive testability, documented to SQLite's standard.
  *Modelled closely on InnoDB* — 16 KiB pages, clustered primary index,
  secondary indexes carrying the PK, MVCC via undo records — so that the
  *semantics* a user observes are MySQL's, without the byte-level coupling.
- **Interchange**: a standalone `innodb` codec package that reads and writes
  real `.ibd` files and SDI. Independently testable against files produced by a
  real server, and useful on its own to anyone who needs to parse InnoDB from
  JavaScript.

This gives us MySQL semantics, MySQL's ecosystem, and MySQL's data — without
inheriting MySQL's process model, build system, or licence.

## What would change this decision

Intellectual honesty requires naming the conditions under which Option A wins:

- If the goal shifts from "a library anyone can embed" to "an internal tool",
  the GPL objection weakens considerably.
- If the requirement is *bug-for-bug* fidelity — running an existing application's
  full query workload untouched, including stored procedures and every optimiser
  quirk — no reimplementation will get there, and a port becomes the only
  option.
- If someone lands a genuinely single-threaded InnoDB (the work is conceivable:
  a cooperative scheduler over the existing `srv_threads` tasks), the technical
  objection largely dissolves and only the licence remains.

If any of those become true, the docs in 10–30 are still exactly what is needed
— they describe the formats, not the implementation.

## A note on the third path

There is a middle option worth recording: **port only InnoDB**, not the server.
`storage/innobase/` is ~470 kLOC and has a defined interface (`handler`), and
tools like `ibd2sdi` already link parts of it standalone. One could imagine a
WASM InnoDB providing storage under a JavaScript SQL layer.

We reject it for the same licence reason, and because the threading problem is
concentrated precisely *in* InnoDB rather than in the layers above it. It is
recorded here so that the option is not silently forgotten.
