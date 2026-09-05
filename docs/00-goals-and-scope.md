# 00 — Goals and scope

## The product

A JavaScript library that provides a **complete MySQL database inside the host
process**, with no server, no daemon, no network, and no native addon:

```js
import { MySQL } from 'myjs'

const db = await MySQL.open('opfs://app-db')      // browser
const db = await MySQL.open('./data')             // node
const db = await MySQL.open(':memory:')           // either

await db.query('CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(64))')
const [rows] = await db.query('SELECT * FROM t WHERE name = ?', ['alice'])
```

It runs unchanged in Node, Deno, Bun, browsers, and edge runtimes with a
filesystem shim. In the browser it uses OPFS synchronous access handles for
storage; on Node it uses `fs`. It is ESM-only.

## The three compatibility contracts

"MySQL compatible" is meaningless unless you say *at which layer*. We commit to
three, in descending order of priority.

### 1. Wire-protocol compatibility (primary)

The engine speaks the MySQL client/server protocol. Any existing MySQL client —
`mysql2`, `mariadb`, Prisma, Drizzle, Sequelize, TypeORM, Knex, the `mysql` CLI
over a Node bridge — connects to it and works, without a shim per driver.

This is the contract that buys the most ecosystem for the least code, because it
is a *narrow, stable, fully documented interface* (docs 10–17) rather than an
open-ended surface. It is also self-testing: real drivers become conformance
tests.

Concretely: `db.createStream()` returns a duplex stream carrying MySQL packets,
so `mysql2.createConnection({ stream })` just works; and in Node, `db.listen()`
starts a real TCP server that `mysql -h 127.0.0.1` connects to.

### 2. SQL-semantics compatibility

The dialect, the type system, and the *quirks*. A query that returns `X` on
MySQL 8.4 returns `X` here: the same collation ordering, the same implicit
coercions, the same `sql_mode` behaviour, the same `AUTO_INCREMENT` and
`TIMESTAMP` semantics, the same integer division and zero-date handling. This is
where most of the actual engineering lives and where most "MySQL-compatible"
projects quietly fail. See docs 24 and 29 — collation is not a detail, it
determines index order and therefore results.

### 3. File-format compatibility (first-class, but separable)

We can **read and write real InnoDB `.ibd` files**, with SDI, in COMPACT and
DYNAMIC row formats — enough to import a tablespace exported by
`FLUSH TABLES ... FOR EXPORT` and to produce one importable by
`ALTER TABLE ... IMPORT TABLESPACE`.

This is deliberately scoped as **interchange**, not as the native storage
format. The reasoning is in [02-strategy.md](./02-strategy.md); the short
version is that byte-compatibility with a whole *datadir* also means
byte-compatibility with a version-specific internal data dictionary and redo
log, which is a compatibility surface MySQL itself does not promise across
versions. Transportable tablespaces are the boundary MySQL *does* document.

## What "isomorphic" means here concretely

| Concern | Browser | Node / Bun / Deno |
|---|---|---|
| Storage | OPFS `FileSystemSyncAccessHandle` | `fs` (`openSync`/`readSync`/`writeSync`/`fsyncSync`) |
| Fallbacks | IndexedDB-backed pages, in-memory | in-memory |
| Execution context | dedicated Worker (owns the DB) | main thread or `worker_threads` |
| Cross-context access | `MessagePort`, framed with the MySQL protocol | `MessagePort` or TCP |
| Multi-tab / multi-process | Web Locks leader election | advisory file lock |
| Crypto (auth, checksums) | `crypto.subtle` + WebCrypto | `node:crypto` via the same shim |

There is exactly one platform-dependent module — the VFS (doc 40) — plus a small
crypto shim. Everything above it is portable.

## In scope

- DDL: `CREATE`/`ALTER`/`DROP` for tables, indexes, views; the common column
  types; `AUTO_INCREMENT`; generated columns; foreign keys.
- DML: `SELECT` (joins, subqueries, CTEs, window functions, `GROUP BY`),
  `INSERT` (incl. `ON DUPLICATE KEY UPDATE`), `UPDATE`, `DELETE`, `REPLACE`.
- Transactions: `BEGIN`/`COMMIT`/`ROLLBACK`, savepoints, `REPEATABLE READ` and
  `READ COMMITTED` via MVCC.
- Prepared statements, both the text and binary protocols.
- The MySQL function library — the parts real applications use: string, math,
  date/time, JSON, aggregate, window.
- `INFORMATION_SCHEMA` and enough of `mysql.*` and `performance_schema` that
  introspection-driven tools (migration tools especially) work.
- Import/export: `.ibd` tablespaces, `mysqldump` SQL, and a compact native dump.

## Out of scope (at least initially)

Stated plainly so the roadmap stays honest:

- **Replication as a server**: acting as a replication source or replica.
  (*Reading* binlog-shaped change streams for sync is in scope — doc 18.)
- **Stored procedures, functions and triggers** in the first milestones. The
  parser will accept and store them; execution comes later.
- **Spatial types and full-text search** beyond storage round-tripping.
- **Partitioning**, `COMPRESSED` row format, tablespace encryption, and the
  change buffer.
- **Multi-writer concurrency**. The design is single-writer with concurrent
  readers (doc 41). This matches the deployment model — one app, one database —
  and removes an enormous class of bugs.
- **The X Protocol** (port 33060, protobuf-based). The classic protocol is what
  the JavaScript ecosystem speaks.

## Non-goals

- Being a drop-in replacement for a production MySQL cluster. This is an
  embedded database that happens to be MySQL-shaped.
- Bug-for-bug compatibility with MySQL 5.x. We target **8.0 / 8.4 LTS**
  behaviour, with `utf8mb4_0900_ai_ci` as the default collation.
- Supporting every storage engine. InnoDB semantics are the model; MyISAM and
  CSV appear only as import formats (doc 30).

## Success criteria

1. A stock `mysql2` client completes a full session — handshake through
   `caching_sha2_password` auth, prepared statements, multi-resultsets, `QUIT` —
   against the in-process engine with no driver patches.
2. Prisma and Drizzle migrations run against it unmodified.
3. A curated subset of MySQL's own `mysql-test` `.test`/`.result` pairs passes
   (doc 43).
4. A table created here, exported as `.ibd` + `.cfg`, imports cleanly into a
   real MySQL 8.4 server — and the reverse.
5. Browser bundle under ~500 KB gzipped for the core engine, with collation
   tables and optional features loaded on demand.
