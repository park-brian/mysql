# CLAUDE.md

Orientation for working in this repository. **[docs/44-roadmap.md](./docs/44-roadmap.md)
is the living plan** — what is done, what is decided, what is still unknown. This
file is the shorter thing you read first.

## What this is

An isomorphic, in-process MySQL for JavaScript: no server process, no native
addon, MySQL's wire protocol and MySQL's semantics. M0–M2 are complete (the
protocol, charsets and collations, the type system); M3 (parse SQL) is in
progress; M4 (storage) and M5 (execute) have not started.

## Running things

Node **≥ 22.18** is required and there is **no build step** — Node strips the
types and runs the `.ts` directly (D-01). `tsc` is only a checker.

```bash
npm ci
npm test          # unit + format + protocol; no Docker, no browser, under a minute
npm run typecheck
npm run lint      # the isomorphic gate
npm run size      # the ratcheting bundle budget
npm run fuzz      # 10^6 inputs per parser
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
bytes ── protocol ── core ── server
  └──── charsets ── types
  └──── parser              vfs
```

`@myjs/bytes` is the cycle-breaker and the reason is the release plan, not
taste: `@myjs/protocol` ships at 0.1 and `@myjs/charsets`/`@myjs/types` at 0.2,
so an edge between them would make the 0.1 artefact unpublishable. When two
packages above need to *name* the same thing, it moves **down** into `bytes` —
that is D-30 (`MyjsError`), D-32 (`SqlValue`), D-37 (`FIELD_TYPE`). The test for
what belongs there: a *fact about the format*, not *behaviour*.

`@myjs/protocol` never depends on `@myjs/charsets` (D-33). Behaviour that needs
a session is injected — a `Transcoder`, a `Capabilities`, an `Executor`.

## Two seams carry the design

- **`execProtocol(bytes) → bytes`** (doc 03). Every other entry point is a
  caller of it, which is why `mysql2.createConnection({ stream })` works with no
  knowledge that there is no socket.
- **The `Vfs` interface** (doc 40) — the only platform-dependent code, and
  synchronous, so there is no `await` inside a page split.

The engine seam is `Executor` in `packages/protocol/src/session.ts`. Today it is
answered by a regex stub in `packages/core/src/stub.ts`; M5 replaces it.

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
  and so is the scoreboard. A compatibility number updated by hand, later, is
  marketing; one CI writes is an engineering artefact.
- **Work items are append-only.** `M4.7` means `M4.7` forever. An item that
  turns out wrong is marked `⊘` with a reason and a new one is added.
- **Decisions are superseded, never edited**, and so are errata — `E-14`
  corrects `E-13` rather than rewriting it. The reasoning that was wrong is as
  useful as the reasoning that was right.
- A work item's "done when" is one falsifiable assertion, and the prose beside
  it records what the work *taught*. That density is deliberate.

## The habit worth keeping

Almost every entry in the changelog has the same shape: a claim was checked
against something real, and the check found a bug — frequently **in the test
rather than in the code**. `utf8mb4_bin`'s sort key, `<=>` being null-safe, an
unsigned BIGINT negation saturating, a charset missing from a generated
registry, a corpus listing truncated at 1,000 entries. Prefer the check that
could falsify the claim, and when it fires, ask first whether the instrument is
the thing that is broken.
