# 44 — Roadmap

Ordered by dependency, not by excitement. Each milestone ends with something
demonstrable, because a database project that cannot be demonstrated for six
months is a database project that gets abandoned.

**This file is the living plan.** Docs 00–43 say what the formats are and why we
chose this shape; this one says what we are doing about it, what we have
decided, what we have finished, and what we still do not know. It is edited in
the same commit as the work it describes. If you want to know the state of the
project, read this file and nothing else.

---

## How to use this document

**Status glyphs.** `☐` not started · `◐` in progress · `☑` done · `⊘` deferred
or out of scope.

**Work items are append-only.** `M4.7` means `M4.7` forever. If an item turns
out to be wrong, mark it `⊘` with a reason and add a new one; never renumber,
because commit messages and issue titles reference these ids.

**Decisions are superseded, never edited.** A `D-NN` row is a historical record.
Changing your mind means adding `D-NN+1` and filling in the `Supersedes` column.
The reasoning that was wrong is as useful as the reasoning that was right.

**The scoreboard moves in the same commit as the code.** A compatibility claim
that is updated by hand, occasionally, is marketing. One that CI writes is an
engineering artefact (doc 43 §8).

**Open questions are pinned to the milestone that must resolve them.** A `Q-NN`
with no milestone is a note; with a milestone it is a blocker with a deadline.

---

## Status at a glance

| | Milestone | Theme | Done | Status |
|---|---|---|---|---|
| **M0** | [Foundations](#m0--foundations) | bytes, VFS interface, CI | 10 / 10 | ☑ |
| **M1** | [Speak the protocol](#m1--speak-the-protocol) | the whole client ecosystem, for a few thousand lines | 24 / 24 | ☑ |
| **M2** | [Types and collations](#m2--types-and-collations) | the part everyone else gets wrong | 17 / 23 | ◐ |
| **M3** | [Parse SQL](#m3--parse-sql) | lexer, parser, AST | 0 / 10 | ☐ |
| **M4** | [The storage engine](#m4--the-storage-engine) | pages, B+tree, WAL, MVCC | 0 / 26 | ☐ |
| **M5** | [Execute](#m5--execute) | operators, planner, functions | 0 / 16 | ☐ |
| **M6** | [The browser](#m6--the-browser) | OPFS, workers, leader election | 0 / 10 | ☐ |
| **M7** | [InnoDB interchange](#m7--innodb-interchange) | read and write real `.ibd` | 0 / 13 | ☐ |
| **M8** | [Beyond](#m8--beyond) | as demand arrives | 0 / 10 | ☐ |
| | | **Total** | **51 / 142** | |

---

## Decision log

Append-only. These are lifted out of the design docs so that "what did we decide
about page size" is one lookup rather than a re-read of eleven documents. The
`Docs` column is where the argument lives; this table records only the
conclusion.

| # | Date | Decision | Why | Docs | Supersedes |
|---|---|---|---|---|---|
| D-01 | 2026-09-05 | **Author TypeScript; run it with Node's type stripping.** No build step for tests. Only erasable syntax: no `enum`, no `namespace`, no parameter properties, no decorators — enforced by `erasableSyntaxOnly` + `verbatimModuleSyntax`. `tsc --emitDeclarationOnly` produces `.d.ts` for publishing; a bundler produces the browser artefact. `engines.node` becomes `>=22.18`. | Byte-level codecs and a type system are exactly the code that benefits most from types, and type stripping buys that without a build step between "edit" and `node --test`. | — | — |
| D-02 | 2026-09-05 | **npm workspaces monorepo from the first commit**, `packages/*` exactly as doc 03's table. | The boundaries in doc 03 are load-bearing. Enforcing them later means discovering they were violated. `@myjs/protocol` and `@myjs/innodb` are independently useful and should be independently publishable. | [03](./03-architecture.md) | — |
| D-03 | 2026-09-05 | **This file is the single roadmap.** No second planning document. | Two roadmaps drift; the stale one is always the one someone reads. | — | — |
| D-04 | 2026-09-05 | **Granularity is milestone → work item → acceptance assertion.** Every item names its docs, its dependencies, and one falsifiable "done when". | "Implement MVCC" is not a task. An item you can finish in a sitting and prove you finished is. | — | — |
| D-05 | — | **The wire protocol is the primary compatibility contract**, ahead of SQL semantics, ahead of file format. | It is small, fully specified, and it buys the entire driver and ORM ecosystem at once — and those drivers then become the conformance suite. | [00](./00-goals-and-scope.md), [02](./02-strategy.md) | — |
| D-06 | — | **Reimplement in JavaScript; do not port MySQL to WASM.** | No single-user mode; InnoDB starts ~20 mandatory threads; the build pulls in ICU/OpenSSL/protobuf/Boost; and MySQL is GPLv2, which would infect every consumer. | [02](./02-strategy.md) | — |
| D-07 | — | **Native storage is our own format. InnoDB is interchange, not our on-disk format.** We read and write single `.ibd` + `.cfg` tablespaces; we never attempt to write a whole datadir. | Transportable tablespaces are the boundary MySQL itself documents and supports. A whole datadir means a version-specific internal data dictionary and redo log — a compatibility surface MySQL does not promise even to itself. | [02](./02-strategy.md), [27](./27-data-dictionary.md) | — |
| D-08 | — | **Single writer, many concurrent readers.** No lock manager, no deadlock detection, no lock escalation, no two-phase locking. | OPFS sync access handles are exclusive and `readwrite-unsafe` is Chrome-only, so a multi-writer browser design is unshippable. It also matches the deployment — one app, one database — and removes the bug class where database engines actually go wrong. | [41](./41-durability-and-concurrency.md) | — |
| D-09 | — | **Still report `ER_LOCK_DEADLOCK` (1213/40001), `ER_LOCK_WAIT_TIMEOUT` (1205), `ER_DUP_ENTRY` (1062/23000)** even though there is no lock manager. | ORMs and application retry loops are keyed to these numbers. Reporting them means existing recovery logic works. | [41](./41-durability-and-concurrency.md), [25](./25-mvcc-and-undo.md) | — |
| D-10 | — | **Target MySQL 8.0/8.4 behaviour**, default collation `utf8mb4_0900_ai_ci`. Advertise `8.4.0-myjs`; never a MariaDB-shaped version string; set `CLIENT_LONG_PASSWORD` and zero the reserved bytes so MariaDB-aware clients do not read extended capabilities out of them. | Clients sniff the version string and branch on it. | [00](./00-goals-and-scope.md), [12](./12-connection-phase.md) | — |
| D-11 | — | **`caching_sha2_password` is the default plugin; `mysql_native_password` is supported.** In-process connections are treated as already secure, so the full path degenerates to compare-and-go — no RSA, no key management. The RSA branch exists only for the Node TCP listener. Never implement `mysql_old_password`. | Auth is not the security boundary for an embedded database; it exists so that drivers work. Treating in-process as secure removes a whole dependency without weakening anything real. | [13](./13-authentication.md) | — |
| D-12 | — | **Never advertise `CLIENT_COMPRESS` or `CLIENT_SSL` in-process.** zstd never in-process or in the browser; zlib optional on the Node TCP listener. In the browser, `wss://` provides transport security and the connection is simply reported as secure to the auth layer. | It costs CPU to compress a `memcpy`. | [17](./17-protocol-extras.md) | — |
| D-13 | — | **`CLIENT_MULTI_STATEMENTS` is honoured when negotiated but gated behind an engine-level switch defaulting off.** | It turns a SQL-injection point into arbitrary statement execution. | [14](./14-command-phase.md) | — |
| D-14 | — | **The error table is generated from `share/messages_to_clients.txt`**, not transcribed by hand. | ~1,200 codes with SQLSTATEs. Transcription is how you get 1451 and 1452 the wrong way round. | [14](./14-command-phase.md) | — |
| D-15 | — | **JS type mapping matches `mysql2` exactly**: DECIMAL and TIME as strings, BLOB/BINARY as `Uint8Array`, BIGINT as number-if-safe else `BigInt`, JSON parsed, zero dates as `null` unless `dateStrings`. | Swapping a real connection for ours must change nothing in the application. | [15](./15-wire-types.md) | — |
| D-16 | — | **Keep InnoDB's 16 KiB page size, but use 4 KiB WAL blocks** (not InnoDB's 512 B). | 16 KiB gives a one-to-one mapping for imported pages and three tree levels over a billion rows. 512-byte log blocks would be 8× the header overhead for no atomicity benefit on any storage we target. | [21](./21-innodb-file-layout.md), [26](./26-redo-and-recovery.md) | — |
| D-17 | — | **CRC32 for reading InnoDB pages (accepting the legacy variants); CRC32C for our own WAL blocks.** A block that does not verify did not happen. | InnoDB has used CRC32 since 5.6 and it is the only variant worth writing. Our WAL must be self-verifying because OPFS `flush()` is best-effort. | [21](./21-innodb-file-layout.md), [26](./26-redo-and-recovery.md), [40](./40-vfs.md) | — |
| D-18 | — | **Full-page images in the WAL after each checkpoint, instead of a doublewrite file.** Plus two alternating superblocks, a monotonic LSN per block, and LSN at head *and* tail of every data page. | Our WAL is already sequential and already being flushed; a second file buys nothing. These four properties together degrade "best-effort flush" from "the database may be corrupt" to "we may lose the last few commits", which is a guarantee we can state honestly. | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | — |
| D-19 | — | **Bitmap allocator, not InnoDB's on-disk linked lists. Dense page directory, not InnoDB's sparse 4-to-8-owned design. No change buffer.** | The linked lists and the sparse directory are 1990s optimisations for storage we do not target. A dense `Uint16Array` directory is a pure binary search with no linear tail. | [21](./21-innodb-file-layout.md), [22](./22-innodb-page-formats.md) | — |
| D-20 | — | **Implement COMPACT and DYNAMIC; REDUNDANT read-only for old imports; COMPRESSED never.** Our own records adopt DYNAMIC's atomic-BLOB semantics — a large value is a pointer, with no local prefix. | COMPACT and DYNAMIC cover every MySQL 5.7+ table. Whole-page compression at the VFS layer is the better answer to COMPRESSED (see Q-08). | [23](./23-innodb-row-formats.md) | — |
| D-21 | — | **Do not build instant DDL into the record format.** Use a page-level schema version instead, so a page stays independently decodable. | InnoDB's per-record version byte makes the null bitmap's *size* version-dependent, which couples every record decode to the dictionary. | [23](./23-innodb-row-formats.md) | — |
| D-22 | — | **Adopt MySQL's binary JSON and every doc-24 column encoding byte-for-byte, even inside our own format.** | They are shared with binlog row images and with `.ibd` files, so one codec serves the engine, the importer and the change stream. Binlog and `.ibd` compatibility come free. | [24](./24-column-encodings.md), [28](./28-json-binary.md) | — |
| D-23 | — | **Generate MySQL's own collation weight tables; reject `Intl.Collator` as the primary source** (fallback only, with a loud warning). | `Intl.Collator` does not implement MySQL's tailorings, gives no sort key, and its semantics move with the JS engine version — which would make stored index bytes engine-version-dependent. | [29](./29-charsets-and-collations.md) | — |
| D-24 | — | **Storage engines in scope: `native`, `memory`, `innodb-ro`, `csv`.** MyISAM read-only and later; ARCHIVE skipped; BLACKHOLE/FEDERATED/NDB/MERGE out. | An embedded database does not need an engine zoo; it needs enough import formats. | [30](./30-other-engines.md) | — |
| D-25 | — | **The WAL record format must carry logical before/after row images from its first version.** This is a blocking decision inside M4, not a note (M4.13). | Change streams and live queries (M8) are a projection of the WAL. Retrofitting logical information onto a purely physical log is painful, and doc 26 says to decide it *now*. | [18](./18-binlog.md), [26](./26-redo-and-recovery.md) | — |
| D-26 | — | **The catalog format is explicitly versioned, with a documented migration per change**, from its first commit (M4.23). | Same reason SQLite publishes a file format document. A store whose format is undocumented cannot be migrated, only abandoned. | [27](./27-data-dictionary.md) | — |
| D-27 | 2026-09-06 | **The isomorphic lint gate exempts `packages/vfs`, `packages/server` and `packages/core/src/host/*`** — everything else is `Uint8Array`/`DataView` only. | Ground rule 1 names only `packages/vfs`, but `@myjs/server` must open TCP sockets, and the `mysql2`-facing duplex must emit Node `Buffer`s: `mysql2`'s `PacketParser.executePayload` calls `chunk.copy()`, which `Uint8Array` does not have. Confining that to conditional-export host files keeps every other package provably portable. | [03](./03-architecture.md), [42](./42-public-api.md) | — |
| D-30 | 2026-09-06 | **Typed-error taxonomy**: `MyjsError` is the base carrying `code`, and optionally `errno`/`sqlState`; `ProtocolError` covers framing and parse faults; `SqlError` (M1) carries `mysql2`'s exact shape. `@myjs/bytes` never resolves error numbers — it has no dependencies, so `@myjs/protocol` supplies them from the generated table. | Ground rule 5 requires a typed error from every parser, and doc 42 requires `err.code`/`err.errno`/`err.sqlState`/`err.sqlMessage` to match `mysql2` so existing `catch` blocks keep working. Doc 11 names `ProtocolError` without giving it a shape. | [11](./11-protocol-primitives.md), [42](./42-public-api.md) | — |
| D-29 | 2026-09-06 | **The generated error table carries facts only — error number, symbol and SQLSTATE — never MySQL's English message text.** Messages for the codes we emit are authored in `packages/protocol/src/errors/messages.ts`. | D-14 says generate rather than transcribe, and ground rule 7 keeps GPLv2 material out of this MIT repository. Numbers and SQLSTATEs are facts; the message templates are expression. The source is fetched at generation time, hashed, and discarded. | [14](./14-command-phase.md) | — |
| D-31 | 2026-09-06 | **Numeric caps on unauthenticated input**: `max_allowed_packet` 64 MiB, enforced per chunk *during* reassembly rather than on the finished buffer; connection attributes ≤ 64 KiB and ≤ 128 pairs, rejected before authentication; accumulated `COM_STMT_SEND_LONG_DATA` capped at `max_allowed_packet`. | Docs 12, 16 and 17 all require caps and name no numbers. Every one of these bounds an allocation a peer can force before it has proved anything about itself. | [12](./12-connection-phase.md), [16](./16-prepared-statements.md), [17](./17-protocol-extras.md) | — |
| D-32 | 2026-09-08 | **The neutral value structs live in `@myjs/bytes`, not in `@myjs/types`.** `SqlValue`, `MysqlDateTime`, `MysqlTime` and their two guards move down; `@myjs/protocol` and `@myjs/types` both re-export them. `@myjs/types` owns the *rules* — it defines a separate engine-facing `StorageValue` and a named `toDriverValue()` for D-15, rather than widening `SqlValue`. | Two packages above need to *name* these structs and neither may depend on the other: the release plan ships `@myjs/protocol` at 0.1 and `@myjs/charsets`/`@myjs/types` at 0.2, so a protocol→types edge would make the 0.1 artefact unpublishable as specified. D-30 set the precedent when it put `MyjsError` in `bytes` for the same reason. The move is type-only apart from the two guards. | [11](./11-protocol-primitives.md), [15](./15-wire-types.md), [24](./24-column-encodings.md) | — |
| D-33 | 2026-09-08 | **`@myjs/protocol` never depends on `@myjs/charsets`.** Behaviour that needs a session is injected (a `Transcoder`, like `Capabilities` and `Executor` before it); the two facts the protocol must decide *without* one — the pre-authentication connection-charset check and `columnLengthForChars` — are generated into `packages/protocol/src/constants/charset-metrics.ts` by the same parse that builds the full registry, so there is no hand-maintained second copy. | The release plan ships `@myjs/protocol` at 0.1 and `@myjs/charsets` at 0.2, so a dependency edge would make the 0.1 artefact unpublishable as specified — and `@myjs/protocol` is the standalone MySQL protocol toolkit that does not otherwise exist. The widths cost ~400 bytes gzipped; the collation tables would cost tens of KB. | [12](./12-connection-phase.md), [15](./15-wire-types.md), [29](./29-charsets-and-collations.md) | — |
| D-35 | 2026-09-09 | **Every variable-length index key part declares its byte width, and is padded to it.** A PAD SPACE `'text'` part is padded with the collation's own pad weight; anything else is NUL-padded and carries a two-byte length suffix. `'text'` parts must always declare a width; a truncating `'bytes'` part must declare one unless it is last. | The memcmp-ordering property was not true for a PAD SPACE collation and no test noticed, because the one test that should have compared key order against `Collation.compare` compared it against `Collation.sortKey` instead. PAD SPACE does not merely ignore trailing spaces — it *inverts* order against raw bytes: `'a' > 'a\\x01'`, because the shorter value is extended with 0x20 and 0x20 > 0x01. Trimming cannot express that; only bringing both keys to a common width can, which is what MySQL's `strnxfrm` does with `nweights`. The length suffix exists because NUL padding alone cannot tell `'a'` from `'a\x00'`, which a unique index must. Separately, concatenating variable-length parts is ambiguous — `'ab' + 'c'` and `'a' + 'bc'` are the same bytes — and a declared width fixes that too. | [24](./24-column-encodings.md), [29](./29-charsets-and-collations.md), [43 §4](./43-testing.md) | — |
| D-34 | 2026-09-08 | **Until M7, storage-encoding golden vectors come from binlog row images and `WEIGHT_STRING()`, not from `.ibd` files.** `mysqlbinlog --hexdump` under `binlog_row_image=FULL` yields the doc-24 bytes; `SELECT HEX(WEIGHT_STRING(s LEVELS 1))` yields exactly what `Collation.sortKey()` must produce. Committed fixtures replay offline and gate; re-capture against a real server is informational, as `trace-capture` already is. | Doc 43 §4 asks for real `.ibd` files, but `@myjs/innodb` does not exist until M7 — so M2 would otherwise have no differential check at all. Doc 24 says the `decimal2bin` form is used identically in `.ibd` files and binlog row images, and doc 28 says the same of binary JSON, so the binlog gives the same bytes years earlier. The two documented divergences (binlog integers are little-endian and unflipped; binlog `VARCHAR` keeps its length prefix) are a feature: the fixture records which framing it is, which makes doc 24's "both steps matter" sentence executable. | [24](./24-column-encodings.md), [29](./29-charsets-and-collations.md), [43 §4](./43-testing.md) | — |

---

## Ground rules

These apply to every milestone. No item below repeats them.

1. **`Uint8Array` and `DataView` only above the VFS.** No `Buffer`, no `node:*`.
   This is what "isomorphic" actually costs, and it is cheap if enforced from
   the first commit — so it is enforced by a lint rule, not by good intentions.
2. **Bytes in, bytes out, at every layer boundary.** Wire packets, page images,
   index keys, undo records. No hidden object graphs crossing layers, so every
   layer can be fuzzed and snapshot-tested.
3. **Async at the edges, sync in the core.** OPFS sync access handles and Node's
   `readSync` are both synchronous. No `await` inside a page split.
4. **Every format constant cites its header.** A comment naming the MySQL header
   it came from, so it can be re-verified against a newer tree.
5. **Typed errors, always.** A malformed input produces a typed error — never a
   crash, never a hang, never an out-of-bounds read. This is the fuzzing
   invariant and it applies to every parser we write.
6. **The memory VFS is the reference implementation.** Every unit test runs
   against it. If a bug reproduces only on OPFS, the VFS is at fault, not the
   engine.
7. **Nothing from `reference/` is copied into this repository.** MySQL is
   GPLv2, this project is MIT. `mysql-test` is fetched in CI, never vendored.

---

## Repository layout

Per D-02. The `Since` column is the milestone that creates the package.

| Package | Responsibility | Depends on | Publishable alone | Since |
|---|---|---|---|---|
| `@myjs/bytes` | Cursor/writer over `Uint8Array`; LE/BE ints, varints, length-encoded values; the neutral value structs both packages above name (D-32) | — | yes | M0 |
| `@myjs/vfs` | The one storage interface + memory / Node / OPFS backends | — | yes | M0 |
| `@myjs/protocol` | Packet framing, every packet type both directions, auth plugins | `bytes`, crypto shim — load-bearing, per D-32 and D-33 | **yes — the M1 release** | M1 |
| `@myjs/charsets` | Charset ids, encoders/decoders, collation key transforms | `bytes` (for `MyjsError` only — ground rule 5) | yes | M2 |
| `@myjs/types` | Value model, coercion, comparison, index key encoding | `charsets` | yes | M2 |
| `@myjs/parser` | Lexer + parser → AST; `sql_mode`-aware | — | yes | M3 |
| `@myjs/engine` | Pages, B+tree, MVCC, WAL, recovery, catalog | `vfs`, `types` | no | M4 |
| `@myjs/core` | Wires it together; the `MySQL` class | all of the above | no (this is `myjs`) | M1 |
| `@myjs/server` | Node TCP server, WebSocket bridge, worker host | `core`, `protocol` | yes | M1 |
| `@myjs/innodb` | Real `.ibd` and SDI codec — import/export only | `bytes`, `types` | **yes** | M7 |

`@myjs/innodb` deliberately does not sit under `@myjs/engine`. It is a codec,
not a storage backend: someone should be able to install it purely to parse a
tablespace they found on a dead server.

Tests live in the tree doc 43 specifies:

```
test/
  unit/          per-module, memory VFS, fast
  protocol/      trace replay + real client integration
  format/        golden vectors, property tests, real .ibd files
  mysqltest/     the .test interpreter and the curated allowlist
  differential/  against a real mysqld in Docker
  crash/         fault injection
  browser/       Playwright, real OPFS
  bench/         performance regression
```

`npm test` runs unit, protocol, format and mysqltest — everything needing no
Docker and no browser — and stays under a minute. The rest runs in CI.

The generators in `tools/*.mjs` sit **outside** the isomorphic lint gate, which
walks `packages/` only. They may use `node:` freely; everything they *emit*
into `packages/` may not. Worth stating, because ground rule 1 reads as though
it covered the whole repository and M2 adds two more generators.

---

## M0 — Foundations

*Nothing works yet, but everything after this is easy.*

**Exit criterion.** Property tests round-trip every protocol primitive, and the
bundle-size gate is enforcing a real number.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M0.1 | Workspace scaffolding: npm workspaces, `packages/*`, root `tsconfig` with `erasableSyntaxOnly` + `verbatimModuleSyntax`, `engines.node >=22.18` | — | D-01, D-02 | — | ☑ | `node --test` runs a `.ts` test file with no build step |
| M0.2 | Lint gate: no `Buffer` or `node:*` outside `packages/vfs`; no non-erasable TS syntax | — | [03](./03-architecture.md) | M0.1 | ☑ | a deliberate `node:buffer` import in `packages/types` fails CI |
| M0.3 | `Reader` — the contract written out in doc 11: all widths, `u24`/`u48`, `u64 → BigInt`, lenenc int and bytes, NUL and EOF strings | bytes | [11](./11-protocol-primitives.md) | M0.1 | ☑ | every read bounds-checks against `remaining`; `0xFB` returns `null`, never `251` |
| M0.4 | `Writer` — geometric growth, reserves the 4-byte packet header, canonical shortest lenenc | bytes | [11](./11-protocol-primitives.md) | M0.3 | ☑ | `lenEnc(250)` is 1 byte, `lenEnc(251)` is 3 — required for byte-exact trace comparison |
| M0.5 | `ProtocolError` and the typed-error base | bytes | [11](./11-protocol-primitives.md) | — | ☑ | no path in `bytes` throws a bare `Error` |
| M0.6 | Bitmap helpers with the offset parameter | bytes | [11](./11-protocol-primitives.md) | M0.3 | ☑ | offset 2 and offset 0 both round-trip; the asymmetry is a test, not a comment |
| M0.7 | Property tests: round-trip every primitive | bytes | [43 §4](./43-testing.md) | M0.3, M0.4 | ☑ | `fast-check` covers all int widths, lenenc, and all four string forms |
| M0.8 | Fuzz target: arbitrary bytes into `Reader` | bytes | [43 §6](./43-testing.md) | M0.3 | ☑ | 10⁶ random inputs, zero crashes and hangs, only `ProtocolError` |
| M0.9 | `Vfs` / `VfsFile` interfaces from doc 40, with erratum E-02 applied | vfs | [40](./40-vfs.md) | M0.1 | ☑ | `durability` lives on `Vfs`; a conformance suite exists that any backend must pass |
| M0.10 | Memory VFS — the reference backend — plus CI: unit tests, lint, bundle-size budget | vfs | [40](./40-vfs.md), [43 §7](./43-testing.md) | M0.9 | ☑ | memory passes the conformance suite; the size gate fails a commit that exceeds the committed number |

---

## M1 — Speak the protocol

*The most valuable milestone per unit of effort. Do it first.*

This milestone alone is a genuinely useful artefact — a MySQL protocol server
toolkit for JavaScript, which does not currently exist as a standalone package.
It ships as `@myjs/protocol` 0.1 (see [Release plan](#release-plan)).

**Exit criterion.** `mysql -h 127.0.0.1` connects, authenticates with
`caching_sha2_password`, runs `SELECT 1`, and quits cleanly; and `mysql2`'s
connection tests pass against the stub.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M1.1 | Packet framer: 4-byte header, >16 MiB reassembly, `max_allowed_packet` enforced *during* reassembly | protocol | [10](./10-protocol-overview.md), [17](./17-protocol-extras.md) | M0.4 | ☑ | a 16777215-byte payload emits `ff ff ff n` **plus an empty packet**, and decodes back |
| M1.2 | Sequence ids owned by the framer: reset per command, continuous through the connection phase | protocol | [10](./10-protocol-overview.md) | M1.1 | ☑ | a mismatch raises `ER_NET_PACKETS_OUT_OF_ORDER`, and the counter is not visible to packet types |
| M1.3 | Capability constants; the negotiated set as one immutable value | protocol | [12](./12-connection-phase.md) | — | ☑ | every reader and writer takes it as a parameter; none reads mutable session state |
| M1.4 | Response discriminator resolved by **length**, not by byte value | protocol | [10](./10-protocol-overview.md) | M1.3 | ☑ | a `0xFE` payload of ≥9 bytes parses as a lenenc integer, not as EOF |
| M1.5 | OK / ERR / EOF writers, capability-conditional, including the OK-as-EOF form | protocol | [10](./10-protocol-overview.md) | M1.3 | ☑ | the minimal OK is byte-identical to `07 00 00 02 00 00 00 02 00 00 00` |
| M1.6 | Error table generated from `share/messages_to_clients.txt` (D-14) | protocol | [14](./14-command-phase.md) | — | ☑ | 1062 → `ER_DUP_ENTRY`/`23000`; the generator is re-runnable and its source hash is checked in |
| M1.7 | Crypto shim: `getRandomValues`, SHA-1, SHA-256, constant-time compare, RSA-OAEP-SHA1 | protocol | [13](./13-authentication.md) | — | ☑ | one module, identical API on Node and in the browser; nothing above it imports `node:crypto` |
| M1.8 | `HandshakeV10` writer; 20-byte scramble split 8 + 12 with a trailing NUL | protocol | [12](./12-connection-phase.md) | M1.5, M1.7 | ☑ | `mysql2` parses it; `CLIENT_LONG_PASSWORD` set and reserved bytes zeroed (D-10) |
| M1.9 | `SSLRequest` and `HandshakeResponse41` parsers; connection attributes with size and count caps | protocol | [12](./12-connection-phase.md) | M1.3 | ☑ | oversized attributes are rejected before authentication — this is unauthenticated input |
| M1.10 | Auth framing: `AuthSwitchRequest`, `AuthSwitchResponse`, `AuthMoreData`, `AuthNextFactor` | protocol | [13](./13-authentication.md) | M1.8 | ☑ | `AuthNextFactor` produces a clear error rather than a hang |
| M1.11 | `mysql_native_password` verification | protocol | [13](./13-authentication.md) | M1.10 | ☑ | the empty-password zero-length-response case is handled on both sides |
| M1.12 | `caching_sha2_password` fast path | protocol | [13](./13-authentication.md) | M1.10 | ☑ | `0x03` is sent as its **own packet before** the OK; a client expecting OK immediately would desync, and does not |
| M1.13 | `caching_sha2_password` full path, secure-channel branch (D-11) | protocol | [13](./13-authentication.md) | M1.12 | ☑ | in-process connections take this branch and never touch RSA |
| M1.14 | `caching_sha2_password` RSA branch, TCP listener only | protocol, server | [13](./13-authentication.md) | M1.13 | ☑ | the `mysql` CLI authenticates over TCP against a fresh, uncached account |
| M1.15 | Uniform access-denied (`1045`/`28000`) and failure rate-limiting on the TCP path | protocol | [13](./13-authentication.md) | M1.11 | ☑ | unknown user and wrong password are indistinguishable in timing and in bytes |
| M1.16 | `COM_*` dispatcher; `COM_PING` implemented first; unknown → `ER_UNKNOWN_COM_ERROR`/`08S01` | protocol | [14](./14-command-phase.md) | M1.5 | ☑ | a pool's ping loop runs 10 000 times without desynchronising |
| M1.17 | No-response commands: `COM_STMT_SEND_LONG_DATA`, `COM_STMT_CLOSE`, `COM_QUIT` | protocol | [14](./14-command-phase.md), [16](./16-prepared-statements.md) | M1.16 | ☑ | nothing is written, not even on error — a reply desynchronises every client |
| M1.18 | The command-phase quirks: `COM_FIELD_LIST` (no column-count prefix), `COM_SET_OPTION` (EOF-shaped), `COM_STATISTICS` (bare `string<EOF>`) | protocol | [14](./14-command-phase.md) | M1.16 | ☑ | each matches a captured trace from a real server |
| M1.19 | `ColumnDefinition41` writer | protocol | [15](./15-wire-types.md) | M1.3 | ☑ | `VARCHAR(255)` utf8mb4 reports `column_length` 1020; charset 63 distinguishes BLOB from TEXT |
| M1.20 | Text resultset writer and text value renderers | protocol | [14](./14-command-phase.md), [15](./15-wire-types.md) | M1.19 | ☑ | DECIMAL keeps trailing zeros to scale; multi-resultset sets `SERVER_MORE_RESULTS_EXISTS` on every terminator but the last |
| M1.21 | Binary resultset writer and binary value codecs; null bitmap at **offset 2** | protocol | [15](./15-wire-types.md) | M1.19 | ☑ | doc 15's temporal byte dumps encode and decode exactly, shortest form on write; `INT24` occupies 4 bytes |
| M1.22 | `COM_QUERY` and `COM_STMT_EXECUTE` parsers with query attributes; null bitmap at **offset 0** | protocol | [14](./14-command-phase.md), [16](./16-prepared-statements.md) | M1.21 | ☑ | doc 16's worked `COM_STMT_EXECUTE` example parses to the parameters it documents |
| M1.23 | `COM_STMT_*` and the `PreparedStatement` state class: sticky bound types, long-data merge, cursors with a timeout, `max_prepared_stmt_count` 16382 | protocol | [16](./16-prepared-statements.md) | M1.22 | ☑ | `new_params_bind_flag === 0` works against a client that never sets it; an abandoned cursor is reclaimed |
| M1.24 | `execProtocol()`, `createStream()`, `createPort()`, `serve()`, and a stub executor | core, server | [03](./03-architecture.md), [42](./42-public-api.md) | M1.20 | ☑ | `mysql2.createConnection({ stream: db.createStream() })` completes a full session unpatched; `serve()` refuses a non-loopback bind without a configured password |

Trace-replay fixtures (doc 43 §3) are built alongside M1.12 and are the
acceptance mechanism for M1.1–M1.23, not a separate item: an item is not done
until its trace replays byte-identically.

---

## M2 — Types and collations

*Where most "MySQL-compatible" projects quietly fail.* Collation is not a
display concern — it determines index order, `ORDER BY` results, `=` semantics
and unique-constraint violations.

**Exit criterion.** The `memcmp`-ordering property test passes for every type,
and the golden vectors from MySQL's own source comments all decode correctly.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M2.1 | Collation registry and the `Collation` interface (`sortKey`, `compare`, `padAttribute`) | charsets | [29](./29-charsets-and-collations.md) | M2.17 | ☑ | ids 8, 33, 45, 46, 63, 224, 246, 255, 278 resolve to a collation or a typed "unsupported" |
| M2.2 | `binary` (63) and `utf8mb4_bin` (46) — pure `memcmp` | charsets | [29](./29-charsets-and-collations.md) | M2.1 | ☑ | enough to build and test the entire B+tree; ordering equals `memcmp` on arbitrary bytes |
| M2.3 | Charset encode/decode over `TextEncoder`/`TextDecoder`; MySQL name → WHATWG label | charsets | [29](./29-charsets-and-collations.md) | M2.1 | ☑ | `latin1` maps to `windows-1252`, so `0x80` decodes to `€` |
| M2.4 | `mbminlen`/`mbmaxlen` table and the limits it drives | charsets, protocol | [29](./29-charsets-and-collations.md) | M2.17 | ☑ | `VARCHAR(16383)` is the utf8mb4 row-limit boundary; `KEY (col(255))` budgets 1020 bytes |
| M2.5 | Weight-table generator for the **simple** collations, re-runnable, source hash checked in. UCA is M2.20 | charsets | [29](./29-charsets-and-collations.md) | M2.17 | ☑ | re-running against the pinned MySQL tree reproduces the committed tables bit for bit |
| M2.6 | `utf8mb4_general_ci` and `latin1_swedish_ci` (PAD SPACE) | charsets | [29](./29-charsets-and-collations.md) | M2.5 | ☑ | `'ä' = 'a'` and `'ß' ≠ 'ss'`; `'a' = 'a '` is true |
| M2.7 | `utf8mb4_0900_ai_ci` (UCA 9.0.0, NO PAD), lazily loaded | charsets | [29](./29-charsets-and-collations.md) | M2.20 | ☐ | `'a' = 'a '` is false; a differential `ORDER BY` against a real 8.4 matches row for row (the M2.21 fixture) |
| M2.8 | Integer transform: big-endian, sign bit flipped unless unsigned | types | [24](./24-column-encodings.md) | M0.3, M2.16 | ☑ | doc 24's four worked `INT` lines reproduce byte for byte |
| M2.9 | FLOAT and DOUBLE: little-endian IEEE-754, compared **numerically** | types | [24](./24-column-encodings.md) | M2.8 | ☑ | the ordering property test knows these are the exception and does not assert `memcmp` |
| M2.10 | `decimal2bin` | types | [24](./24-column-encodings.md) | M2.8 | ☑ | `DECIMAL(14,4) 1234567890.1234 → 81 0D FB 38 D2 04 D2`, and its negative |
| M2.11 | Temporal family: DATETIME2, TIMESTAMP2, TIME2, DATE, YEAR, plus the legacy decoders | types | [24](./24-column-encodings.md) | M2.8 | ☑ | `DATETIMEF_INT_OFS` and `year*13 + month` are right; all fractional widths round-trip |
| M2.12 | ENUM and SET (forced unsigned, **no** sign flip), BIT, CHAR/VARCHAR/BINARY padding | types | [24](./24-column-encodings.md) | M2.8 | ☑ | ENUM indexes are 1-based; `CHAR` latin1 space-pads, `BINARY` zero-pads |
| M2.13 | Binary JSON codec | types | [28](./28-json-binary.md) | M2.11, M2.12 | ☐ | small/large switches per container; key order is length-then-bytes; `custom-data` reaches back into `decode` |
| M2.14 | Index key encoding: NULL flag byte, prefix keys, collation sort keys | types | [24](./24-column-encodings.md) | M2.12, M2.2 | ☑ | the memcmp-ordering property holds for every non-float type, and character columns compare on the *sort key* rather than the value — revised by D-35, which added the declared width a PAD SPACE part needs for that property to actually hold |
| M2.15 | Golden-vector and property suite | test | [43 §4](./43-testing.md) | all | ☐ | every byte dump quoted anywhere in docs 15, 24 and 28 is a test case |
| M2.16 | Relocate the value model to `@myjs/bytes` so `@myjs/types` can name it (D-32) | bytes, protocol | [15](./15-wire-types.md) | — | ☑ | the 9 frozen traces still replay byte-identically; no package's `dependencies` field changes |
| M2.17 | Collation registry generator: one parse of MySQL's `CHARSET_INFO` definitions emits both the `@myjs/charsets` registry and the byte widths `@myjs/protocol` needs (D-33) | charsets, protocol | [29](./29-charsets-and-collations.md) | M0.1 | ☑ | re-running reproduces both committed files byte for byte; the generated connection-charset rule agrees with the registry on every id |
| M2.18 | The `Transcoder` seam and `SET NAMES`: `session.characterSet` finally interpreted, `@myjs/core` supplying the real transcoder (D-33) | protocol, core | [11](./11-protocol-primitives.md), [29](./29-charsets-and-collations.md) | M2.3 | ☑ | a latin1 session round-trips `0x80` as `€`; `@myjs/protocol` still depends only on `@myjs/bytes` |
| M2.19 | The packing structure for the simple weight tables — two-level pages, identity-page elision, delta-plus-run within a page, supplementary plane a constant. **Owns Q-04** | charsets | [29](./29-charsets-and-collations.md) | M2.5 | ☑ | the packed `utf8mb4_general_ci` table is under 20 KB raw and 10 KB gzipped, asserted by a test — Q-04 answered with a number, not an adjective |
| M2.20 | UCA 9.0.0 packing and the lazy-module boundary: level 1 only, implicit weights computed rather than tabulated, reached solely by `await import()` | charsets | [29](./29-charsets-and-collations.md) | M2.19 | ☐ | an esbuild bundle of `packages/charsets/src/index.ts` contains no UCA weights, proven by the size gate |
| M2.21 | `tools/capture-types.mjs` and the informational `type-vectors` CI job (D-34) | test | [43 §4](./43-testing.md) | M2.11 | ☐ | committed fixtures replay offline and gate; re-capture against a real 8.4 is informational, as `trace-capture` is |
| M2.22 | Size-budget discovery: measure every package with a browser entry point, and fail on one with no committed number | — | [43 §7](./43-testing.md) | M0.10 | ☑ | adding a package without a budget line fails CI instead of printing `[no budget yet]` and passing |
| M2.23 | `Intl.Collator` fallback for a collation we have no tables for: supplies `compare`; `sortKey` throws | charsets | [29](./29-charsets-and-collations.md) | M2.7 | ☐ | index bytes are never runtime-dependent, because the path that would produce them refuses to run |

---

## M3 — Parse SQL

**Exit criterion.** Every `CREATE TABLE` in MySQL's own test suite parses.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M3.1 | Lexer: charset-aware, `ANSI_QUOTES`, `NO_BACKSLASH_ESCAPES` | parser | [29](./29-charsets-and-collations.md) | M2.3 | ☐ | a `gbk` or `sjis` lead byte cannot swallow a backslash to escape a quote |
| M3.2 | Expression parser: MySQL precedence, operators, literals, `?` placeholders | parser | — | M3.1 | ☐ | precedence matches a real server across a generated expression corpus |
| M3.3 | `SELECT`: joins, subqueries, CTEs, `GROUP BY`/`HAVING`, `ORDER BY`, `LIMIT`, window functions | parser | — | M3.2 | ☐ | round-trips through a deparser to semantically equivalent SQL |
| M3.4 | `INSERT` (incl. `ON DUPLICATE KEY UPDATE`), `UPDATE`, `DELETE`, `REPLACE` | parser | — | M3.2 | ☐ | multi-row and `SELECT`-sourced forms included |
| M3.5 | `CREATE`/`ALTER`/`DROP` for tables, indexes and views; column types with charset and collation | parser | [29](./29-charsets-and-collations.md) | M3.2 | ☐ | the milestone exit criterion |
| M3.6 | `SET`, `USE`, `SHOW`, `EXPLAIN`, transaction control | parser | [14](./14-command-phase.md) | M3.2 | ☐ | `SET NAMES` and `SET sql_mode` reach the session |
| M3.7 | `sql_mode` threaded through lexer and parser | parser | — | M3.1 | ☐ | the same text parses differently under `ANSI_QUOTES`, proven by test |
| M3.8 | Accept and store — do not execute — routines, triggers, events | parser | [00](./00-goals-and-scope.md) | M3.6 | ☐ | `CREATE PROCEDURE` stores; `CALL` errors with a clear "not yet supported" |
| M3.9 | Parse errors as `ER_PARSE_ERROR` (1064/42000) with position | parser | [14](./14-command-phase.md) | M3.2 | ☐ | message shape matches MySQL's "near '…' at line N" |
| M3.10 | Parser fuzz target | test | [43 §6](./43-testing.md) | M3.3 | ☐ | arbitrary strings never crash, hang, or read out of bounds |

---

## M4 — The storage engine

*The big one.* Ordered in six tiers rather than as one list, because the
dependency structure is real: records need pages, the tree needs records, the
WAL wraps the tree, and MVCC needs all three.

**Exit criterion.** The fault-injection suite runs 10,000 crash points with zero
inconsistencies and zero lost acknowledged commits.

### Tier 1 — page frame and buffer pool

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.1 | CRC32C, table-driven (see E-01) | engine | [26](./26-redo-and-recovery.md) | M0.1 | ☐ | matches the RFC 3720 test vectors |
| M4.2 | Page frame: 16 KiB, self-identifying header, LSN at head **and** tail | engine | [21](./21-innodb-file-layout.md), [41](./41-durability-and-concurrency.md) | M4.1 | ☐ | a torn page is detected without consulting the log |
| M4.3 | Buffer pool: young/old LRU split over one `ArrayBuffer`; dirty list in LSN order; commit backpressure | engine | [41](./41-durability-and-concurrency.md) | M4.2 | ☐ | scanning 10× the pool does not evict the working set; commits block before dirty pages grow unbounded |

### Tier 2 — records

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.4 | **Decision (not code):** design the page-level schema version that replaces instant DDL. Resolves Q-03; implements D-21 | engine | [22](./22-innodb-page-formats.md), [23](./23-innodb-row-formats.md) | M4.2 | ☐ | the page header reserves the field and the design is written back into doc 22 |
| M4.5 | Record encoding: null bitmap plus a variable-length array storing **lengths, not offsets**; DYNAMIC atomic-BLOB semantics | engine | [23](./23-innodb-row-formats.md) | M4.4, M2.14 | ☐ | round-trip property over arbitrary generated schemas |
| M4.6 | Overflow pages: a large value is a pointer, no local prefix | engine | [23](./23-innodb-row-formats.md) | M4.5 | ☐ | a 1 MB value round-trips and its pages are freed on delete |

### Tier 3 — B+tree

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.7 | Dense page directory and binary search | engine | [22](./22-innodb-page-formats.md) | M4.5 | ☐ | lookup is pure binary search with no linear tail (D-19) |
| M4.8 | B+tree search, insert, split; node pointers and the leftmost-record flag | engine | [22](./22-innodb-page-formats.md) | M4.7 | ☐ | descending the left spine of a four-level tree reaches the correct leaf |
| M4.9 | Delete, merge, page reorganise, free-list reuse | engine | [22](./22-innodb-page-formats.md) | M4.8 | ☐ | a randomised insert/delete workload leaves no unreachable page |
| M4.10 | The `PAGE_DIRECTION` split heuristic — 100/0 sequential, 50/50 random | engine | [22](./22-innodb-page-formats.md) | M4.8 | ☐ | sequential primary-key inserts fill pages ≥95%; random inserts do not |
| M4.11 | Clustered and secondary indexes; secondary leaves carry the primary key | engine | [20](./20-storage-overview.md), [23](./23-innodb-row-formats.md) | M4.8 | ☐ | a non-covering secondary lookup costs exactly one extra descent, and the test proves it |
| M4.12 | Extent-based bitmap allocator; separate leaf and internal segments | engine | [21](./21-innodb-file-layout.md) | M4.2 | ☐ | growth is extent-granular and freed extents are reused (D-19) |

### Tier 4 — WAL and recovery

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.13 | **Decision (not code):** the WAL record format, carrying logical before/after row images. Implements D-25; blocks M8.1 | engine | [18](./18-binlog.md), [26](./26-redo-and-recovery.md) | — | ☐ | the record specification is written down and reviewed **before** M4.14 begins |
| M4.14 | WAL block codec: 4 KiB, 20-byte header, CRC32C, monotonic LSN, first-record-group offset | engine | [26](./26-redo-and-recovery.md), [40](./40-vfs.md) | M4.13, M4.1 | ☐ | a mutated block fails verification and is treated as end-of-log; an LSN gap stops recovery there |
| M4.15 | Mini-transaction grouping | engine | [26](./26-redo-and-recovery.md) | M4.14 | ☐ | a page split is never half-applied after a crash at any point inside it |
| M4.16 | Full-page images after each checkpoint | engine | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | M4.15 | ☐ | a torn data page is reconstructed from the log alone, with no doublewrite file |
| M4.17 | Two alternating superblocks and the fuzzy checkpointer | engine | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | M4.16 | ☐ | a crash at any point during a checkpoint still leaves one valid superblock |
| M4.18 | Recovery: forward scan, idempotent LSN-guarded apply, undo-based rollback | engine | [26](./26-redo-and-recovery.md) | M4.17 | ☐ | injected faults at every write offset recover to a consistent state |
| M4.19 | `flushLogAtTrxCommit` 0 / 1 / 2 | engine | [41](./41-durability-and-concurrency.md) | M4.17 | ☐ | at `1`, the crash suite loses no acknowledged commit; the guarantee text in doc 41 is true as written |

### Tier 5 — MVCC

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.20 | `DB_TRX_ID` / `DB_ROLL_PTR`, differential undo records, version-chain walk | engine | [25](./25-mvcc-and-undo.md) | M4.5, M4.15 | ☐ | doc 25's roll-pointer bit layout round-trips; an older version rebuilds correctly |
| M4.21 | Read views and `isVisible`; READ COMMITTED, REPEATABLE READ, and RR's "current read" rule; the `PAGE_MAX_TRX_ID` fast path | engine | [25](./25-mvcc-and-undo.md), [41](./41-durability-and-concurrency.md) | M4.20 | ☐ | doc 25's `isVisible` truth table holds for every combination; `SELECT … FOR UPDATE` sees the latest committed version under RR |
| M4.22 | Purge, observable history length, maximum-transaction-age abort | engine | [25](./25-mvcc-and-undo.md), [41](./41-durability-and-concurrency.md) | M4.21 | ☐ | `db.stats()` reports history length; an over-age transaction is aborted rather than allowed to grow the store (resolves Q-09) |

### Tier 6 — catalog and interface

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.23 | Catalog: `_myjs_*` system tables, a fixed-page bootstrap descriptor, a per-table JSON definition page, and an **explicit format version** (D-26) | engine | [27](./27-data-dictionary.md) | M4.21 | ☐ | opening a database written by an older catalog version either migrates it or refuses with a clear message — never silently misreads it |
| M4.24 | The `StorageEngine` / `Table` interface from doc 30, plus the `native` and `memory` implementations | engine | [30](./30-other-engines.md) | M4.11 | ☐ | the executor cannot tell the two apart |
| M4.25 | `FaultInjectingVfs` and the 10,000-crash-point suite | test | [43 §5](./43-testing.md) | M4.18 | ☐ | the milestone exit criterion |
| M4.26 | Node VFS over `openSync`/`readSync`/`writeSync`/`fsyncSync`, and `MySQL.open()` finally resolving its `path` argument to a backend | vfs, core | [40](./40-vfs.md), [42](./42-public-api.md) | M0.10 | ☐ | it passes the same conformance suite as memory, and `MySQL.open('./data')` stops silently giving you a memory database |

---

## M5 — Execute

**Exit criterion.** Drizzle's and Prisma's MySQL test suites pass end to end.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M5.1 | Name resolution and type inference over the AST | core | [03](./03-architecture.md) | M3.3, M2.14 | ☐ | column references resolve through joins, subqueries and CTEs |
| M5.2 | Coercion and comparison rules — MySQL's quirks, not SQL's ideals | types | [24](./24-column-encodings.md), [29](./29-charsets-and-collations.md) | M5.1 | ☐ | a differential run over an implicit-coercion corpus matches a real 8.4 |
| M5.3 | Volcano operators: table scan, index scan, filter, project, limit | core | [03](./03-architecture.md) | M4.24 | ☐ | each operator is independently testable over a fixed row source |
| M5.4 | Nested-loop and hash joins | core | — | M5.3 | ☐ | a three-table join returns MySQL's row order for the same plan |
| M5.5 | Sort (spilling when large), aggregate, `GROUP BY`/`HAVING`, `DISTINCT` | core | [29](./29-charsets-and-collations.md) | M5.3 | ☐ | sorting respects collation, not code-point order |
| M5.6 | Window functions | core | — | M5.5 | ☐ | frame semantics match a real server on the ORM corpora |
| M5.7 | Planner: index selection, predicate pushdown, join ordering for small joins | core | — | M5.4 | ☐ | `EXPLAIN` names the index a MySQL DBA would expect on the test schemas |
| M5.8 | DML execution: `ON DUPLICATE KEY UPDATE`, `REPLACE`, `AUTO_INCREMENT` | core | [00](./00-goals-and-scope.md) | M5.3 | ☐ | `affectedRows` is 2 for an updated upsert, as MySQL reports it; `insertId` matches |
| M5.9 | DDL execution; `SHOW CREATE TABLE` | core | [27](./27-data-dictionary.md) | M4.23 | ☐ | `SHOW CREATE TABLE` output matches a real server's bytes |
| M5.10 | Function library: string, math, date/time, `CASE`/`IF`/`COALESCE` | core | — | M5.2 | ☐ | prioritised by measured usage frequency across the ORM test suites |
| M5.11 | Aggregate and `JSON_*` functions | core | [28](./28-json-binary.md) | M5.10 | ☐ | `JSON_KEYS()` returns keys in MySQL's length-then-bytes order |
| M5.12 | `INFORMATION_SCHEMA` (resolves Q-06) | core | [27](./27-data-dictionary.md) | M5.9 | ☐ | Prisma and Drizzle introspection reconstruct the schema exactly, multi-column indexes included |
| M5.13 | `SHOW`, `EXPLAIN`, and the `db.explain()` / `db.stats()` / introspection API | core | [42](./42-public-api.md) | M5.7 | ☐ | doc 42's introspection methods all return real data |
| M5.14 | Real transactions: `db.transaction()` with bounded 1213 retry, savepoints, `db.begin()` | core | [42](./42-public-api.md), [41](./41-durability-and-concurrency.md) | M4.21 | ☐ | commits on return, rolls back on throw, and the retry limit is configurable and documented |
| M5.15 | `mysqltest` interpreter, curated allowlist, pass-rate reporting | test | [43 §1](./43-testing.md) | M5.10 | ☐ | the scoreboard number is produced by CI, not by hand; the suite is fetched, never vendored |
| M5.16 | Differential harness against MySQL 8.4 in Docker | test | [43 §2](./43-testing.md) | M5.10 | ☐ | rows and their order, column metadata, `affectedRows`, errno and SQLSTATE all compared |

---

## M6 — The browser

**Exit criterion.** A Playwright test runs the full suite in Chrome, Firefox and
Safari, including a mid-transaction page kill and recovery.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M6.1 | OPFS VFS over `FileSystemSyncAccessHandle` | vfs | [40](./40-vfs.md) | M0.10 | ☐ | passes the same conformance suite as the memory backend |
| M6.2 | Access-handle pool: `.pool/NNNN` plus a manifest | vfs | [40](./40-vfs.md) | M6.1 | ☐ | opening a logical file after startup is synchronous; the pool grows when exhausted |
| M6.3 | Handle re-acquisition after tab suspension | vfs | [40](./40-vfs.md) | M6.2 | ☐ | a suspended-then-resumed tab continues without data loss or a thrown handle error |
| M6.4 | OPFS async fallback via `createWritable()` | vfs | [40](./40-vfs.md) | M6.1 | ☐ | works outside a dedicated worker, with its different atomicity documented |
| M6.5 | IndexedDB block store | vfs | [40](./40-vfs.md) | M6.1 | ☐ | the full suite passes in Safari private browsing, where OPFS does not exist |
| M6.6 | Dedicated-worker host; `MySQLWorker` with the same interface as `MySQL` | server | [42](./42-public-api.md), [03](./03-architecture.md) | M1.24 | ☐ | swapping `MySQL` for `MySQLWorker` changes no application code |
| M6.7 | Web Locks leader election, `BroadcastChannel` discovery, re-election | server | [41](./41-durability-and-concurrency.md) | M6.6 | ☐ | killing the leader tab promotes another and clients reconnect automatically |
| M6.8 | `dump()` and `MySQL.load()` | core | [42](./42-public-api.md) | M4.23 | ☐ | a database seeded from a build artefact opens without running recovery |
| M6.9 | Bundle splitting: collations and optional features loaded on demand | — | [29](./29-charsets-and-collations.md), [43 §7](./43-testing.md) | M2.7 | ☐ | the core stays inside the M0.10 budget shipping only `binary` and `utf8mb4_bin` |
| M6.10 | Playwright suite across Chrome, Firefox and Safari, with a mid-transaction page kill | test | [43 §5](./43-testing.md) | M6.5 | ☐ | the milestone exit criterion |

---

## M7 — InnoDB interchange

Note the ordering inversion that makes this milestone unlike M4: for **reading**
a real tablespace the dictionary comes *first*, not last. Doc 27's open sequence
is page 0 → SDI root → inflate the zlib JSON → build the descriptor → read each
index's root page out of `se_private_data` → descend the B+tree. You cannot
decode a record without the dictionary, because ENUM and SET member lists and
the legacy temporal types exist only there.

**Exit criterion.** A table round-trips through a real MySQL 8.4 server in CI,
in both directions, with byte-identical values.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M7.1 | FIL header and trailer; CRC32 primary with the legacy variants accepted on read | innodb | [21](./21-innodb-file-layout.md) | M0.3 | ☐ | `innochecksum` agrees with us on a corpus of real files |
| M7.2 | `FSP_SPACE_FLAGS`, the FSP header, page-type dispatch | innodb | [21](./21-innodb-file-layout.md) | M7.1 | ☐ | flags are decoded before anything else, as doc 21 insists |
| M7.3 | XDES array and segment INODE readers | innodb | [21](./21-innodb-file-layout.md) | M7.2 | ☐ | the free/used extent picture matches what the server reports |
| M7.4 | SDI reader: locate the tree, `(type, id)` keys, inflate the zlib JSON | innodb | [27](./27-data-dictionary.md) | M7.2 | ☐ | output matches `ibd2sdi` on the same file |
| M7.5 | SDI → table descriptor, including `se_private_data` index root pages | innodb | [27](./27-data-dictionary.md) | M7.4 | ☐ | index roots resolve — without this not a single row can be read |
| M7.6 | INDEX page parser: header, directory, record chain, infimum/supremum | innodb | [22](./22-innodb-page-formats.md) | M7.2 | ☐ | doc 22's `parseIndexPage` contract is satisfied on real pages |
| M7.7 | COMPACT and DYNAMIC record decoder, including both instant-DDL mechanisms | innodb | [23](./23-innodb-row-formats.md) | M7.6, M7.5 | ☐ | the variable-length array is unit-tested against real files — doc 23 calls this the single highest-value test here |
| M7.8 | REDUNDANT decoder, read-only | innodb | [23](./23-innodb-row-formats.md) | M7.7 | ☐ | a pre-5.7 tablespace reads |
| M7.9 | External field references and both LOB page families | innodb | [23](./23-innodb-row-formats.md) | M7.7 | ☐ | a 1 MB BLOB reassembles from a real file |
| M7.10 | Import: `.ibd` + `.cfg` → a native table | innodb, core | [27](./27-data-dictionary.md) | M7.9 | ☐ | a table exported from MySQL 8.4 in CI imports and every value matches |
| M7.11 | Export: native table → `.ibd` + `.cfg` | innodb, core | [27](./27-data-dictionary.md) | M7.10 | ☐ | `ALTER TABLE … IMPORT TABLESPACE` accepts it on a real 8.4 |
| M7.12 | `mysqldump` reader and writer | core | [42](./42-public-api.md) | M5.9 | ☐ | a real `mysqldump` file restores here, and ours restores into a real server |
| M7.13 | `innodb-ro` and `csv` engines behind the doc-30 interface | innodb | [30](./30-other-engines.md) | M4.24, M7.7 | ☐ | the executor queries an imported `.ibd` without copying it into native storage |

---

## M8 — Beyond

Roughly in the order the demand is likely to arrive. Deliberately unsequenced —
these are pulled forward by users, not pushed by the plan.

| # | Work item | Docs | Deps | St |
|---|---|---|---|---|
| M8.1 | Change streams and live queries — a projection of the WAL | [18](./18-binlog.md), [42](./42-public-api.md) | M4.13 | ☐ |
| M8.2 | `@myjs/binlog` — a standalone binlog reader, useful on its own for migration | [18](./18-binlog.md) | M2.15 | ☐ |
| M8.3 | `COM_BINLOG_DUMP` over the change stream | [18](./18-binlog.md) | M8.1, M8.2 | ☐ |
| M8.4 | A sync protocol built on the change stream | [18](./18-binlog.md) | M8.1 | ☐ |
| M8.5 | Stored procedures, functions and triggers — execution, not just storage | [00](./00-goals-and-scope.md) | M3.8, M5.10 | ☐ |
| M8.6 | Foreign key enforcement (accepted and stored from M3) | [00](./00-goals-and-scope.md) | M5.8 | ☐ |
| M8.7 | Generated columns and `CHECK` constraints | [00](./00-goals-and-scope.md) | M5.10 | ☐ |
| M8.8 | Full-text search | [00](./00-goals-and-scope.md) | M5.10 | ☐ |
| M8.9 | Spatial types beyond storage round-tripping; partitioning | [24](./24-column-encodings.md) | M5.10 | ☐ |
| M8.10 | MyISAM read-only import (`.MYD`, `.MYI`, `.frm`) | [30](./30-other-engines.md) | M7.13 | ☐ |

---

## Release plan

Milestones map to npm releases, so there is a shipping story long before M8.

| Version | Ships | Gate |
|---|---|---|
| **0.1** | `@myjs/protocol` + `@myjs/bytes` — a MySQL protocol server toolkit for JavaScript, which does not currently exist as a standalone package | M1 exit criterion |
| **0.2** | `@myjs/charsets`, `@myjs/types`, `@myjs/parser` | M2 and M3 exit criteria |
| **0.3** | `myjs` itself — `MySQL.open()`, real storage, real execution, Node only | M4 and M5 exit criteria |
| **0.4** | The browser: OPFS, workers, `myjs/worker` | M6 exit criterion |
| **0.5** | `@myjs/innodb` and import/export | M7 exit criterion |
| **1.0** | — | Every scoreboard target below met, and the API frozen |

Until 0.3 the packages are published but `myjs` is not: shipping a package named
`myjs` that cannot open a database would be a worse first impression than
shipping nothing.

---

## Scoreboard

The compatibility claim, as a number, updated by CI in the same commit as the
code that moves it (doc 43 §8). A claim without a number is marketing.

| Metric | Today | Target for 1.0 |
|---|---|---|
| MySQL `mysql-test` files passing | 0 / 1,543 | ≥ 800 |
| `mysql2` test suite | 0 / 253 — not yet run: it queries real tables, so it needs M5 | ≥ 245 |
| Drizzle MySQL suite | — | pass |
| Prisma MySQL suite | — | pass |
| Protocol traces replayed byte-identically | 9 / 9 | 100% |
| InnoDB round-trip, by type | 0 / 17 | 17 / 17 |
| Crash injection points, inconsistencies | 0 / 0 | 10,000 points, 0 |
| Core bundle, gzipped | 45.0 KB (`@myjs/protocol` 40.2 KB, `@myjs/charsets` 12.1 KB) | < 500 KB |
| Cold start, browser | — | published, tracked |

---

## Open questions

Each pinned to the milestone that must answer it. A question with no milestone
is a note; with one, it is a blocker with a deadline.

| # | Question | Resolve by | Notes |
|---|---|---|---|
| Q-01 | What is the undo spill threshold — at what size does an in-memory undo log move to a page file? | M4 | Doc 25 says "spilled … when it exceeds a threshold" and does not name one. |
| Q-02 | How is `ER_LOCK_DEADLOCK` actually detected under optimistic concurrency, with no lock manager? | M4 | Doc 41 says "an optimistic conflict detected at commit"; the detection mechanism is undesigned. D-09 requires we report it. |
| Q-03 | What does the page-level schema version look like, concretely? | M4 (owned by M4.4) | D-21 rejects InnoDB's per-record version byte, but doc 22's page-header proposal reserves no field for the replacement. |
| Q-04 | ~~How do the `general_ci` weight tables get from ~1.1 MB of source weights to "a few tens of KB"?~~ **Answered (M2.19).** They are already stored that way: `my_unicase_default` is 256 pages of which **11 are non-null**, an absent page means the weight *is* the code point, and everything above 0xFFFF is the constant 0xFFFD. That is 2,816 weights; delta-plus-run over them is **5,033 bytes raw and 1,726 gzipped**, against a 20 KB / 10 KB budget, asserted by a test. | M2 | The structure doc 29 declined to name is MySQL's own. |
| Q-05 | Do our index pages get prefix compression? | M4 (may defer) | Doc 30 notes MyISAM's saves 30–50% on string keys. Explicitly not decided. |
| Q-06 | How faithful must `INFORMATION_SCHEMA` be? | M5 (owned by M5.12) | Doc 15 raises it and does not settle it. Migration tools query it directly, and `MULTIPLE_KEY_FLAG` is set only on an index's first column, so clients cannot reconstruct indexes from flags alone. |
| Q-07 | How are legacy temporals disambiguated when their byte lengths overlap the modern forms? | M7 | Doc 24 says the dictionary's declared type decides, without naming the SDI field that carries it. |
| Q-08 | Is whole-page compression at the VFS layer the answer to COMPACT/COMPRESSED parity? | M6 or M8 | Proposed in doc 21 as the COMPRESSED replacement (D-20), with no design. |
| Q-09 | What is the history-length policy — what API exposes it, and what does the max-age abort actually do? | M4 (owned by M4.22) | Doc 25 says "report the history length, and let an application choose"; the knob is undefined. |
| Q-10 | Do we ever parse a real redo log? If so, the `OBSOLETE_*_8027` type-number mapping must be transcribed. | M7, only if needed | Currently we do not: we read tablespaces, not datadirs (D-07). Recorded so the gap is not rediscovered. |
| Q-11 | Does `execProtocol` need a streaming variant? | M5 | D-28 returns every response byte for one command, which materialises a whole resultset in memory. That is right for a stub and wrong for doc 42's `db.stream()`, which exists so a large resultset is never materialised. |
| Q-13 | Does the `@myjs/charsets` bundle need splitting before M6.9? The 42 legacy 8-bit weight tables cost 7.9 KB gzipped and almost nobody uses them, but a hand-curated allowlist would be the hand-maintained second source of truth D-14 and M2.17 exist to avoid. | M2 (owned by M2.20) | M2.20 has to build the lazy-import boundary for UCA anyway; the same boundary is the honest answer here, rather than shipping fewer collations. |
| Q-12 | How faithful can trace replay be against a *real* server, rather than against our own frozen output? | M5 | Our version string, capability set, connection id and resultset metadata differ from a real server's by design, so byte-identity there is not simply a matter of correctness. The differential harness (M5.16) is where this gets answered properly. |

### Errata in the design docs

Corrections to be made to docs 20–43. Recorded here rather than fixed silently,
so the correction has a reason attached.

| # | Doc | Error | Correction |
|---|---|---|---|
| E-01 | [26](./26-redo-and-recovery.md) | Suggests `crypto.subtle.digest` for CRC32C "where a hardware path exists". | WebCrypto offers no CRC32C — it has no CRC at all. The implementation is table-driven, full stop. Applied by M4.1. |
| E-02 | [40](./40-vfs.md) | Declares `durability` on the `Vfs` interface, but the prose exposes it on `VfsFile`. | Keep it on `Vfs`; a backend's durability is a property of the backend, not of one open file. Applied by M0.9. |
| E-03 | [40](./40-vfs.md) | The durability table says memory's real guarantee is "none", but the `Vfs.durability` union is `'strong' \| 'best-effort'` and §Memory says to report `'best-effort'`. | Report `'best-effort'`, as §Memory says. The table means "no platform guarantee"; a third union member would make every consumer branch on a case only a test backend can produce. Applied by M0.10. |
| E-04 | [40](./40-vfs.md) | `Vfs.lock()` returns `Promise<Lock>`, and `Lock` is never declared anywhere in the docs. | Declared in M0.9: `path`, `held`, `release()` and `[Symbol.dispose]()`, so a lock can be released from a `finally` or a `using`. A second `release()` is a no-op, not an error. |
| E-05 | [13](./13-authentication.md) | Suggests constant-time comparison "via `crypto.subtle.timingSafeEqual` where available and a manual constant-time loop otherwise". | WebCrypto has no `timingSafeEqual` on any platform — the method exists only on Node's `node:crypto`, which ground rule 1 forbids above the VFS. The manual loop is the implementation, full stop. Applied by M1.7. |
| E-06 | [15](./15-wire-types.md) | Describes a parameter's unsigned flag as "the high bit of the high byte (`0x80`)", while docs 14 and 16 say `0x8000`. | The same bit. State it once as `typeWord & 0x8000` over the whole `int<2>`; the `0x80` form reads as a mask over the word when quoted out of context. Applied by M1.3. |
| E-07 | [15](./15-wire-types.md) | The third binary `TIME` dump prints `01` for the all-zero value, contradicting the layout three lines above it, which allows a length byte of only 0, 8 or 12. | Encode the all-zero `TIME` as a bare `00`, as the layout requires; `01` is a transcription slip. Applied by M1.21 and **confirmed**: MySQL 8.0.46 encodes `CAST('00:00:00' AS TIME)` as a bare `00` in a binary row (`test/protocol/fixtures/binary-temporals-prepared.json`). |
| E-08 | [16](./16-prepared-statements.md) | The worked `COM_STMT_EXECUTE` example encodes the parameter's type word as `0f 00` while calling it `VAR_STRING`; doc 15's table gives `VAR_STRING` = `0xfd`, and `0x0f` is `VARCHAR`, which is internal-only. | Parse what is on the wire rather than "correcting" it — the example is transcribed from upstream. **Settled**: `mysql2` against MySQL 8.0.46 sends `fd 00` for a string parameter (`test/protocol/fixtures/binary-scalars-prepared.json`), so `0x0f` is an artefact of the transcription. Noted by M1.22. |
| E-09 | [13](./13-authentication.md) | "Empty password ⇒ empty response" (zero-length). The C client — and so the `mysql` CLI — sends a **single `0x00` byte** instead, seen on the wire as the length-encoded pair `01 00`. | Accept both. A real scramble is 20 bytes (native) or 32 (sha2), so neither empty form can collide with one. Applied by M1.11/M1.12. |
| E-10 | [13](./13-authentication.md) | Describes the empty-password short-circuit without saying that it must skip `fast_auth_success`. | Send the OK directly, with no `0x03`. Having sent an empty response the C client returns from its plugin at once and expects the final OK; an AuthMoreData there is read as a malformed packet (`ERROR 2027`). `mysql2` tolerates it, which is why only a real C client finds this. Applied by M1.12. |

---

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

### Parallel tracks

The milestone numbering is a dependency order, not a schedule. The dependency
graph has four independent roots — `bytes`, `charsets`, `parser`, `vfs` — and
the M0→M3 sequence serialises them more than the code requires. Work that can
proceed concurrently once M0.1–M0.5 exist:

```
M0.3–M0.8  bytes ────┬──▶ M1  protocol
                     │
M0.9–M0.10 vfs ──────┼────────────────────▶ M4  engine
                     │                      ▲
M2.1–M2.7  charsets ─┴──▶ M2.8–M2.15 types ─┘
                             │
M3.1–M3.10 parser ◀──────────┘
```

Two specific unblockings worth naming:

- **The parser needs the type system only for literal folding and collation
  resolution.** M3.1 and M3.2 can start as soon as M2.3 (charset decode) exists;
  they do not wait for the UCA collations.
- **The B+tree needs only `memcmp` collations.** Doc 29 is explicit that
  `binary` and `*_bin` are enough to build and test the entire tree, because
  ordering there is `memcmp`. So M4 waits on M2.14 (key encoding) and M2.2, not
  on M2.7.

---

## Risks, and what we do about them

| Risk | Mitigation |
|---|---|
| SQL semantics are a bottomless pit | Fix scope by *test pass rate*, not by feature list. Publish the number (the [scoreboard](#scoreboard), doc 43). |
| Collation tables bloat the bundle | Generate them; load them on demand; ship only `binary` + `utf8mb4_bin` in the core (M6.9). |
| OPFS durability is weaker than assumed | Self-verifying WAL, full-page images, fault injection. Assume nothing (docs 40, 41; D-17, D-18). |
| Performance disappoints against native | Be honest about the target: an embedded database for one application, not a server. Benchmark cold start and bundle size as first-class metrics. |
| The engine drifts from MySQL over time | Differential testing against a real server in CI, on every commit (M5.16). |
| Scope creep into a general SQL engine | The three compatibility contracts in doc 00 are the scope. Anything that serves none of them is out. |
| Type stripping constrains the code we can write | No `enum`, `namespace`, parameter properties or decorators. Enforced by `erasableSyntaxOnly` (M0.1) so the constraint fails at commit time, not at publish time. If it ever becomes genuinely limiting, adding a build step is a one-line change — the source is already TypeScript. |
| The GPL boundary is crossed by accident | `reference/` stays gitignored; `mysql-test` is fetched in CI and never vendored; no MySQL source is copied into this MIT repository. Ground rule 7, checked in review. |

---

## Change log

Newest first. One entry per milestone completion or significant decision; work
items record their own progress in the tables above.

| Date | Entry |
|---|---|
| 2026-09-09 | M2.5, M2.6, M2.19 — the weight tables, and the index-key bug they exposed. **Q-04 is answered with a number**: `utf8mb4_general_ci` packs to 5,033 bytes raw and 1,726 gzipped, against doc 29's "a few tens of KB", because MySQL already stores it the way M2.19 proposed to pack it — `my_unicase_default` is 256 pages of which 11 are non-null, an absent page means the weight *is* the code point, and everything above 0xFFFF is the constant 0xFFFD. The generator is the same parse as M2.17, not a second one: a collation's `CHARSET_INFO` body names the `sort_order_*` array it sorts by, so the id → table mapping is read out of MySQL's own struct rather than guessed from names, and all three emitted files carry one source hash. 80 collations now resolve where 5 did, the `*_bin` set having been widened from a hardcoded five to every single-byte binary collation. **The bug**: for a PAD SPACE collation the index key and the comparator disagreed, and not only about trailing spaces — `'a' > 'a\x01'` under the collation and `'a' < 'a\x01'` under `memcmp` of the raw values, an inversion that would have put rows in an order the tree's own comparator rejected. It survived because the test that should have compared key order against `Collation.compare` compared it against `Collation.sortKey`, which is a tautology. D-35 gives every variable-length key part a declared width, and the property is now stated against the comparator. Two smaller things: `@myjs/core` imported `@myjs/charsets` without declaring it, which npm workspaces hid and a registry install would not have; and M4 has no work item creating the Node VFS it needs, so M4.26 exists now. |
| 2026-09-08 | M2.18. The `Transcoder` seam: `@myjs/protocol` defines the interface and ships a UTF-8-only default that *refuses* any other charset, and `@myjs/core` injects one backed by `@myjs/charsets` — so `SET NAMES latin1` works while `packages/protocol/package.json` still lists only `@myjs/bytes` (D-33). Refusing rather than falling back matters here: latin1 bytes read as UTF-8 do not throw, they become replacement characters that reach the application as data. The `character_set_*` and `collation_*` variables are now derived from the session rather than hardcoded, which immediately made the server more honest — a default `mysql2` connection reports `utf8mb4_unicode_ci`, the collation it actually negotiates, where the hardcoded values claimed `utf8mb4_0900_ai_ci`. Verified end to end against unpatched `mysql2`, and the 9 frozen traces still replay byte-identically. **M2's first slices are complete**: 14 of 23 items, with the weight tables (M2.5–M2.7, M2.19, M2.20), binary JSON (M2.13) and the capture tool (M2.21) deferred — none of them blocks M3 or M4. |
| 2026-09-08 | M2.11, M2.12, M2.14 — the temporal family, ENUM/SET/BIT/padding, and index key encoding. **M4 is unblocked from here**: it needs only `memcmp` collations (M2.2) and key encoding, both of which now exist, so the UCA work is genuinely off its critical path. `DATE` is deliberately two functions rather than one, because doc 24 says both steps matter for an `.ibd` and only the first for a binlog row image — and a test asserts that the little-endian field form orders 1999-12-31 *after* 2000-01-01, which is exactly why InnoDB reverses it. `TIME2` packs its fraction into the same magnitude as the rest before taking the two's complement, so a negative `TIME` is not "negative hours with positive microseconds"; the ordering property across the sign boundary is what proves it. Key parts refuse a FLOAT column outright rather than encoding one into an index whose order would be nonsense for negatives. |
| 2026-09-08 | M2.8, M2.9, M2.10 — `@myjs/types` exists. Doc 24's four worked `INT` lines and `decimal.cc`'s `DECIMAL(14,4)` example both reproduce byte for byte in both signs, and the ordering property holds across every integer width and six DECIMAL shapes. Two things the property tests found rather than the golden vectors: `bin2decimal` was reading the sign bit *after* clearing it, so every decode came back negated; and `-0.00` encoded differently from `0.00`, which would have let a unique index hold both. MySQL normalises negative zero in DECIMAL and so do we now. FLOAT and DOUBLE are the documented `memcmp` exception, and the test asserts the exception rather than pretending it away. |
| 2026-09-08 | M2.2. The `memcmp` collations — `binary`, `utf8mb4_bin`, `latin1_bin`, `ascii_bin`, `utf8mb3_bin` — which doc 29 says are enough to build and test the entire B+tree. The subtlety is that every one of them except `binary` is **PAD SPACE**: `utf8mb4_bin` compares `'a'` equal to `'a '` even though the bytes differ, so the comparator pads and the sort key deliberately does not. An unimplemented collation now raises `ER_COLLATION_NOT_IMPLEMENTED` rather than falling back to byte order, because a silent fallback for `utf8mb4_0900_ai_ci` would build an index in the wrong order and surface much later as wrong query results. |
| 2026-09-08 | M2.1, M2.3, M2.4, M2.17, M2.22 — `@myjs/charsets` exists. The registry is generated from MySQL's own `CHARSET_INFO` definitions across 17 `strings/ctype-*.cc` files: 288 collations with their charset, `mbminlen`/`mbmaxlen` and pad attribute, fetched and hashed and discarded per ground rule 7. D-33 keeps `@myjs/protocol` free of a dependency on it — the same parse emits the byte widths the protocol needs before authentication, and a test asserts the two artefacts agree on every id. The generated rule immediately caught what D-14 predicted it would: id 159, `ucs2_general_mysql500_ci`, is a two-byte charset that the hand-written `PROHIBITED_CONNECTION_CHARSETS` ranges had missed, so it was being accepted as a connection charset. Also M2.22: the size gate discovered `@myjs/charsets` would have landed with no committed number and no gate at all, printing `[no budget yet]` and passing — it now measures every package with a browser entry point and fails on one without a number. Added D-33 and D-34. |
| 2026-09-08 | M2.16. The neutral value structs (`SqlValue`, `MysqlDateTime`, `MysqlTime`) move down into `@myjs/bytes` so that `@myjs/protocol` and `@myjs/types` can both name them without a dependency edge in either direction — D-32, and the same argument D-30 used for `MyjsError`. Two things the move surfaced: `renderTime` was exported and called by nothing, because `FIELD_TYPE.TIME` was missing from the text renderer's temporal list, so a TIME column printed its own microsecond count as an integer; and `toFixed(0)` returns exponential notation at 1e21, which is never valid SQL. Both fixed, and `renderTextValue` — previously covered only incidentally through the frozen traces — now has a direct test. |
| 2026-09-06 | Added Q-11 (does `execProtocol` need a streaming variant?) and Q-12 (what byte-identity against a real server can honestly mean), both pinned to M5. |
| 2026-09-06 | Trace capture and replay (doc 43 §3). `tools/capture-traces.mjs` proxies the real `mysql` CLI and `mysql2` to a real MySQL 8.0.46 and records both directions; 13 fixtures are committed and our readers parse every byte of them. `tools/freeze-traces.mjs` freezes our own answers to real clients with a fixed nonce, and 9 traces now replay **byte-identically**. Two errata settled by evidence rather than argument: E-07 (the all-zero binary `TIME` really is a bare `00`) and E-08 (a real client really does send `fd`, not `0f`). Scoreboard updated: protocol traces 9 / 9, core bundle 40.5 KB gzipped. |
| 2026-09-06 | **M1 complete (24 / 24).** M1.24: the `execProtocol` boundary (D-28), `ProtocolConnection` as doc 43 §3's `feed`/`take` pair, `createStream()`/`createPort()`, `serve()` with its non-loopback refusal, and the stub executor. M1.14 closed with the real `mysql` CLI over TCP. **The M1 exit criterion is met**: the CLI connects, authenticates with `caching_sha2_password` on all three branches, runs `SELECT 1` and quits cleanly (`node tools/exit-criterion.mjs`), and unpatched `mysql2` completes a full session in-process and over a socket. Two errata that only a real C client could surface: E-09 and E-10. |
| 2026-09-06 | M1.16–M1.23 done. The `COM_*` dispatcher with the no-response set and the three quirks centralised rather than left to each handler; `ColumnDefinition41`; text and binary resultsets; the binary value codecs against doc 15's byte dumps; `COM_QUERY`/`COM_STMT_EXECUTE` parsing including query attributes; and prepared-statement state covering all four of doc 16's pitfalls. Added the `Executor` interface — doc 03's `Statement + params ⇄ Resultset` edge made concrete — so `@myjs/protocol` is usable on its own with the engine supplied by the caller. Added E-07 and E-08. |
| 2026-09-06 | M1.8–M1.13 and M1.15 done; M1.14 in progress. The connection phase and both auth plugins: `HandshakeV10` with the 8 + 12 scramble split, `SSLRequest`/`HandshakeResponse41` with D-31's caps enforced before authentication, the auth-switch dance, `mysql_native_password`, and `caching_sha2_password` on all three branches — fast path, secure-channel full path, and RSA. Accounts store `SHA1(SHA1(pw))` and `SHA256(SHA256(pw))` and no cleartext; the salted digest doc 13 mentions proves unnecessary, since the cached digest verifies the full path too. M1.14 stays `◐` until the real `mysql` CLI authenticates over TCP, which its acceptance assertion names and the M1 exit criterion covers. |
| 2026-09-06 | M1.1–M1.7 done. `@myjs/protocol`: the streaming packet framer with the 16 MiB split and its mandatory trailing empty packet, framer-owned sequence ids, the negotiated capability value, the discriminate-by-length rule, OK/ERR/EOF writers byte-identical to doc 10's worked examples, the error table generated from `mysql-server@e174239c` (2,132 entries), and the WebCrypto shim with an injectable random source. Added D-29, D-31, E-05 and E-06. |
| 2026-09-06 | **M0 complete (10 / 10).** `@myjs/vfs`: doc 40's interfaces with E-02 applied, the `Lock` type E-04 was missing, the memory reference backend, and a conformance suite exported from the package so the Node, OPFS and fault-injecting backends run the identical body. CI runs lint, typecheck, tests, the 10⁶-input fuzz, and a ratcheting gzipped size gate whose committed numbers are in `size-budget.json`. Added E-03 and E-04. The scoreboard's bundle row stays `—` until `@myjs/core` exists in M1. |
| 2026-09-06 | M0.1–M0.8 done. Workspace, `tsconfig` (`erasableSyntaxOnly` + `verbatimModuleSyntax`), the isomorphic lint gate, and `@myjs/bytes` — `Reader`, `Writer`, `ProtocolError`, bitmap helpers — with property tests and the 10⁶-input fuzz target. Added D-27 and D-30. Two deviations from the item text: M0.2's negative fixture uses `packages/protocol` rather than `packages/types`, which does not exist until M2, and the linter takes `--root` so the fixture lives in a temp tree instead of permanently failing the repository; M0.8 uses a seeded generator rather than a third-party fuzzer, since doc 43 §6 names none. |
| 2026-09-05 | Roadmap rewritten as the project's living plan: work items with acceptance assertions, the decision log (D-01…D-26), ground rules, repository layout, release plan, scoreboard, open questions (Q-01…Q-10) and errata (E-01, E-02). No code yet; M0 is next. |
