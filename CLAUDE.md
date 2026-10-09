# CLAUDE.md

Orientation for working in this repository. **[docs/44-roadmap.md](./docs/44-roadmap.md)
is the living plan** — what is done, what is decided, what is still unknown. This
file is the shorter thing you read first. **[ARCHITECTURE.md](./ARCHITECTURE.md)**
is the narrative overview of the target architecture, for humans; it carries
no status beyond one dated section, and the roadmap wins where they differ (D-72).

## What this is

An isomorphic, in-process MySQL for JavaScript: no server process, no native
addon, MySQL's wire protocol and MySQL's semantics. M0–M4 are complete: the
protocol, charsets and collations, the type system, the parser down to the
administration statements, and storage (pages, B+tree, WAL, crash recovery,
MVCC transactions, the catalog, the Node VFS). M5, the executor, is most of
the way: DDL, DML and transactions, upserts, relational SELECT (joins,
grouping, subqueries, CTEs, set operations), window functions, JSON, views,
foreign keys, CHECK constraints, generated columns, FULLTEXT search,
INFORMATION_SCHEMA, temporary tables and ALTER TABLE all run through
unmodified `mysql2` and agree with 8.4.11 on the committed corpora. M5's exit
criterion is met: Drizzle's MySQL suites and Prisma's functional tests pass
as they pass on 8.4.11, file for file. Doc 42's query API
(`db.query()`, `db.execute()`, `db.transaction()`) is a client of the same
protocol, its values `mysql2`'s (M5.36, D-76). The roadmap's **Next** section
says what comes next: 0.3 is staged (`npm run pack`, D-79/D-80) and waits only
on being published; then the cost-based planner (M5.7) and the browser (M6).
The package an application installs is `myjs`, a facade over `@myjs/core`.

## Running things

Node **≥ 22.18** is required and there is **no build step** — Node strips the
types and runs the `.ts` directly (D-01). `tsc` is only a checker, except
in `npm run pack`, which emits what npm would install (D-79).

```bash
npm ci
npm test          # unit + format + protocol + 300 crash points; no Docker, no browser; about 1.5 min on 4 cores
CRASH_POINTS=10000 npm run test:crash   # the M4 exit criterion's 10,000, as CI runs it
npm run typecheck
npm run lint      # the isomorphic gate and the package graph
npm run size      # the ratcheting bundle budget
npm run fuzz      # 10^6 inputs per parser, and 2 x 10^4 statements into the executor
npm run pack -- --smoke   # every package as a tarball, installed into an empty project and run
```

Because there is no build step, only **erasable** TypeScript is legal: no
`enum`, no `namespace`, no parameter properties, no decorators. `tsc` enforces
it with `erasableSyntaxOnly`, so the constraint fails at commit time.

## Checking against a real MySQL

Most of what this project knows about MySQL that no document states came from
asking a server. Get one:

```bash
sudo node tools/mysql-local.mjs install    # MySQL 8.4.11 from repo.mysql.com
node tools/mysql-local.mjs start           # binlog on, FULL row images
node tools/mysql-local.mjs provision       # the accounts capture:traces needs
npm run fetch:reference                    # the pinned MySQL source tree
```

8.4.11 is not arbitrary: it is the exact build the committed corpora were
captured against, so they are reproduced rather than resembled. With it up:

```bash
npm run capture:types        # storage encodings + sort keys, from binlog row images
npm run capture:precedence   # 1,200 generated expressions, evaluated by the server
npm run capture:traces       # 13 client/server byte traces, via a recording proxy
npm run capture:keywords     # MySQL's reserved words, into @myjs/parser (D-39)
npm run capture:fulltext     # InnoDB's stopwords and token bounds, into @myjs/core (M5.26)
npm run capture:queries      # 1,200 generated joins and set operations, run by the server
npm run capture:execution    # 400 generated scripts, run by the server through mysql2
npm run capture:relational   # 300 multi-table scripts, both protocols, plans captured
npm run capture:json         # 250 scripts over JSON columns, the constructors and aggregates
npm run capture:temporal     # 2,700 generated strings into DATE/DATETIME/TIME/TIMESTAMP, with SHOW WARNINGS
npm run capture:functions    # 200 scripts of string and numeric function calls, both protocols
npm run capture:temporal-functions   # 300 scripts of date and time function calls, in UTC
npm run capture:more-functions       # 300 scripts of string, math, hashing and network function calls
npm run capture:information-schema   # 120 DDL scripts, then Prisma's introspection queries
npm run census:orm           # Drizzle's and Prisma's MySQL suites: a feature census, and our pass count
npm run exit-criterion       # the real C client against our server
npm run census:mysqltest -- --refresh   # MySQL's own test corpus, lexed and parsed
```

With `reference/mysql` present the generators and the census read it instead of
the network, so `npm run gen:*` is hermetic and needs no GitHub token.
`reference/` is gitignored and **nothing from it is ever copied into this
repository** — MySQL is GPLv2 and this project is MIT (ground rule 7). That
applies to tests too: the census commits names, hashes and counts, never a line
of corpus SQL.

## The packages, and the edges that are not allowed

```
package    depends on
bytes      —
vfs        —
charsets   bytes
types      bytes, charsets
parser     bytes, charsets
protocol   bytes                         never charsets or types (D-33)
engine     bytes, charsets, types, vfs
core       all of the above
server     core, protocol
myjs       core, server                  the facade an application installs (D-79)
```

The table in `tools/lint-isomorphic.mjs` is the authority: `npm run lint`
fails an import, or a declared dependency, that it does not allow.

`@myjs/bytes` is the cycle-breaker and the reason is the release plan, not
taste: `@myjs/protocol` ships at 0.1 and `@myjs/charsets`/`@myjs/types` at 0.2,
so an edge between them would make the 0.1 artefact unpublishable. When two
packages above need to *name* the same thing, it moves **down** into `bytes` —
that is D-30 (`MyjsError`), D-32 (`SqlValue`), D-37 (`FIELD_TYPE`). The test for
what belongs there: a *fact about the format*, not *behaviour*.

`@myjs/protocol` never depends on `@myjs/charsets` (D-33). Behaviour that needs
a session is injected — a `Transcoder`, a `Capabilities`, an `Executor`.

## Three seams carry the design

- **`execProtocol(bytes) → bytes`** (doc 03). Every other entry point is a
  caller of it, which is why `mysql2.createConnection({ stream })` works with no
  knowledge that there is no socket.
- **The `Vfs` interface** (doc 40) — the only platform-dependent code, and
  synchronous, so there is no `await` inside a page split.
- **`journal.atomically(fn)`** (doc 26 §Our log) — every page change in the
  engine sits inside one, and the journal, not the tree, writes the log. Code
  above the pool declares where an atomic change begins and ends and nothing
  more.

The engine seam is `Executor` in `packages/protocol/src/session.ts`, answered by
`SqlExecutor` in `packages/core/src/sql/` (D-62–D-68): parse once, compile each
expression to a closure, plan a key range only where it is exact, run in the
session's transaction. MySQL's value rules — comparison, arithmetic, a value
into a column — are `@myjs/types`', not the executor's. Below the executor, the
storage seam is `Catalog` and `Table` in `@myjs/engine` (doc 30 §Our engines):
rows as storage-encoded field bytes, DDL as transactions.

## Ground rules

From the roadmap, which states them once so no work item repeats them:

1. `Uint8Array` and `DataView` only above the VFS — no `Buffer`, no `node:*`.
   Enforced by `npm run lint`, not by good intentions. `tools/` is outside the
   gate and may use `node:` freely; what it *emits* into `packages/` may not.
2. Bytes in, bytes out at every layer boundary.
3. Async at the edges, sync in the core.
4. Every format constant cites the MySQL header it came from.
5. Typed errors, always — a malformed input produces a typed error, never a
   crash, never a hang, never an out-of-bounds read. This is the fuzzing
   invariant.
6. The memory VFS is the reference implementation.
7. Nothing from `reference/` is copied into this repository.

## How work is recorded

- **The roadmap is edited in the same commit as the work it describes** (D-03),
  and so are the scoreboard and an entry in [doc 45](./docs/45-changelog.md).
  `test/format/roadmap.test.ts` recounts the status glyphs, so the summary
  cannot drift from the tables. A compatibility number updated by hand, later, is
  marketing; one CI writes is an engineering artefact.
- **Work items are append-only.** `M4.7` means `M4.7` forever. An item that
  turns out wrong is marked `⊘` with a reason and a new one is added.
- **Decisions are superseded, never edited**, and so are errata — `E-14`
  corrects `E-13` rather than rewriting it. The reasoning that was wrong is as
  useful as the reasoning that was right.
- A work item's "done when" is one falsifiable assertion, and the prose beside
  it records what the work *taught*. That density is deliberate.

## The habit worth keeping

Almost every entry in the [change log](./docs/45-changelog.md) has the same shape: a claim was checked
against something real, and the check found a bug — frequently **in the test
rather than in the code**. `utf8mb4_bin`'s sort key, `<=>` being null-safe, an
unsigned BIGINT negation saturating, a charset missing from a generated
registry, a corpus listing truncated at 1,000 entries. Prefer the check that
could falsify the claim, and when it fires, ask first whether the instrument is
the thing that is broken.
