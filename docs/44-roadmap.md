# 44 — Roadmap

Ordered by dependency, not by excitement. Each milestone ends with something
demonstrable, because a database project that cannot be demonstrated for six
months is a database project that gets abandoned.

## M0 — Foundations

*Nothing works yet, but everything after this is easy.*

- `@myjs/bytes` — reader/writer, all integer widths, length-encoded values,
  bounds checking. Fuzzed from day one.
- `@myjs/vfs` — the interface plus the **memory** backend.
- Repository shape: ESM, `type: module`, no `Buffer`, no `node:*` above the VFS.
- CI: unit tests, lint, bundle-size budget.

**Done when**: property tests round-trip every protocol primitive, and the
bundle-size gate is enforcing a real number.

## M1 — Speak the protocol

*The most valuable milestone per unit of effort. Do it first.*

- Packet framing: the 4-byte header, sequence ids, >16 MiB splitting.
- Connection phase: `HandshakeV10`, `HandshakeResponse41`, capability
  negotiation.
- Auth: `mysql_native_password` and `caching_sha2_password` (fast path plus the
  "already secure" full path).
- Command phase: `COM_QUERY`, `COM_PING`, `COM_QUIT`, `COM_INIT_DB`,
  `COM_STMT_*`, `COM_RESET_CONNECTION`.
- OK / ERR / EOF, text and binary resultsets, column definitions.
- `execProtocol()`, `createStream()`, and a Node TCP `serve()`.
- Behind it: a stub executor that answers a fixed set of queries.

**Done when**: `mysql -h 127.0.0.1` connects, authenticates with
`caching_sha2_password`, runs `SELECT 1`, and quits cleanly; and `mysql2`'s
connection tests pass against the stub.

This milestone alone is a genuinely useful artefact — a MySQL protocol server
toolkit for JavaScript, which does not currently exist as a standalone package.

## M2 — Types and collations

- `@myjs/types`: the value model, all storage encodings from doc 24, key
  encoding, coercion and comparison rules.
- `@myjs/charsets`: `binary`, `utf8mb4_bin`, `utf8mb4_general_ci`,
  `latin1_swedish_ci`; the generator script for the rest.
- `DECIMAL`, the temporal family, `ENUM`/`SET`, `BIT`, binary `JSON` (doc 28).

**Done when**: the `memcmp`-ordering property test passes for every type, and
the golden vectors from MySQL's own source comments all decode correctly.

## M3 — Parse SQL

- Lexer (charset-aware, `sql_mode`-aware for `ANSI_QUOTES` and
  `NO_BACKSLASH_ESCAPES`) and parser → AST.
- Coverage: `SELECT` with joins, subqueries, `GROUP BY`, `ORDER BY`, `LIMIT`;
  `INSERT`/`UPDATE`/`DELETE`/`REPLACE`; `CREATE`/`ALTER`/`DROP TABLE`, indexes,
  views; `SET`, `USE`, `SHOW`, `EXPLAIN`; transaction control.
- Accept and store — but do not yet execute — routines, triggers, events.

**Done when**: every `CREATE TABLE` in MySQL's own test suite parses.

## M4 — The storage engine

*The big one.*

- Page format, buffer pool with the young/old LRU split.
- B+tree: search, insert, delete, split, merge; clustered and secondary indexes.
- Record encoding (doc 23's design, our variant).
- WAL: block format, CRC32C, LSNs, mini-transaction grouping, full-page images.
- Recovery: forward scan, idempotent apply, undo-based rollback.
- MVCC: `DB_TRX_ID`/`DB_ROLL_PTR`, undo records, read views, purge.
- The catalog as system tables plus a bootstrap descriptor (doc 27).

**Done when**: the fault-injection suite runs 10,000 crash points with zero
inconsistencies and zero lost acknowledged commits.

## M5 — Execute

- Volcano-style operators: scan, index scan, filter, project, nested-loop join,
  hash join, sort, aggregate, limit.
- A cost-based-enough planner: index selection, join ordering for small joins,
  predicate pushdown.
- The function library, prioritised by what real applications use: string, math,
  date/time, aggregate, `JSON_*`, `CASE`/`IF`/`COALESCE`.
- `INFORMATION_SCHEMA`, `SHOW`, `EXPLAIN`.

**Done when**: Drizzle's and Prisma's MySQL test suites pass end to end.

## M6 — The browser

- The OPFS VFS with the access-handle pool (doc 40).
- The dedicated-Worker host, Web Locks leader election, `BroadcastChannel`
  discovery, `MessagePort` transport.
- IndexedDB and in-memory fallbacks (Safari private browsing needs this).
- `dump()`/`load()` for seeding from a build artefact.
- Bundle splitting: collations and optional features loaded on demand.

**Done when**: a Playwright test runs the full suite in Chrome, Firefox and
Safari, including a mid-transaction page kill and recovery.

## M7 — InnoDB interchange

- `@myjs/innodb`: page and record decoding, SDI reading, all the column
  encodings.
- Import: `.ibd` + `.cfg` → a native table.
- Export: a native table → `.ibd` + `.cfg` that a real MySQL 8.4 imports.
- A `mysqldump` reader and writer.

**Done when**: a table round-trips through a real MySQL 8.4 server in CI, in
both directions, with byte-identical values.

## M8 — Beyond

Roughly in the order the demand is likely to arrive:

- Change streams and live queries (doc 18), then a sync protocol.
- Stored procedures, functions, triggers.
- Full-text search.
- Foreign key enforcement (accepted and stored earlier; enforced here).
- Generated columns, `CHECK` constraints.
- Spatial types, beyond storage round-tripping.
- Partitioning.

## Sequencing notes

**Why M1 before the engine.** It is the smallest amount of work that produces
something people can use, it is fully specified so it can be built without
design risk, and it forces the `execProtocol` boundary to exist before anything
can grow around it. It also makes every later milestone demonstrable through
real tools.

**Why M2 before M3.** The parser needs the type system to fold literals and
resolve collations. Building it the other way round means rewriting the parser.

**Why M4 before M5.** An executor without storage is a toy, and the shape of the
storage layer determines which operators are cheap.

**Why M6 late.** OPFS is a VFS backend. If the VFS interface is right, the
browser is a fortnight; if it is wrong, no amount of browser work saves it. Build
against memory and Node until the interface is proven.

**Why M7 last.** It is the most self-contained work in the project and has no
dependents. It is also the piece most likely to be someone else's favourite part,
so it is a natural first external contribution.

## Risks, and what we do about them

| Risk | Mitigation |
|---|---|
| SQL semantics are a bottomless pit | Fix scope by *test pass rate*, not by feature list. Publish the number (doc 43). |
| Collation tables bloat the bundle | Generate them; load them on demand; ship only `binary` + `utf8mb4_bin` in the core. |
| OPFS durability is weaker than assumed | Self-verifying WAL, full-page images, fault injection. Assume nothing (docs 40, 41). |
| Performance disappoints against native | Be honest about the target: an embedded database for one application, not a server. Benchmark cold start and bundle size as first-class metrics. |
| The engine drifts from MySQL over time | Differential testing against a real server in CI, on every commit. |
| Scope creep into a general SQL engine | The three compatibility contracts in doc 00 are the scope. Anything that serves none of them is out. |
