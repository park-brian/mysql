# 43 — Testing and compatibility

A MySQL-compatible engine is a *claim*, and the only thing that makes a claim
credible is a test suite that could falsify it. This document is the plan for
doing that, in rough order of value per unit of effort.

## 1. MySQL's own test suite

The MySQL tree ships **1,543 `.test` files** in `mysql-test/t/` alone, plus
dozens of suites under `mysql-test/suite/`. Each is a script of SQL and
directives; each has a matching `.result` file that is the expected output,
verbatim.

```
mysql-test/t/alias.test        →  mysql-test/r/alias.result
```

The format mixes SQL with runner directives:

```
--disable_warnings
DROP TABLE IF EXISTS t1;
--enable_warnings
SET sql_mode = 'NO_ENGINE_SUBSTITUTION';
CREATE TABLE t1 ( ... );
SELECT ... ;
```

and the `.result` file is the echoed statements plus their formatted output.

**This is the single highest-value testing asset available to us.** It is
Oracle's own definition of correct behaviour, it covers the type system,
`sql_mode`, collations, edge cases, and error messages, and it is already
written.

M5.15 uses the official `mysqltest` client shipped in `mysql-community-test`
8.4.11; a separate interpreter was unnecessary. `tools/mysqltest-run.mjs --ours`
runs all 1,459 packaged files with recorded results, using a fresh database per
file over TCP. The reference denominator is the 1,146 files MySQL 8.4.11 passes
under its own `mysql-test-run.pl`. The `mysqltest-run` CI job repeats our side
and checks that the roadmap's exact scoreboard matches the measured run.

The recorded outcomes contain file names, pass/fail/skip classifications and
failure classes, never SQL or result text. Inspect failures before updating a
measurement: a formerly passing file may have relied on a false-success no-op.
Keep reference outcomes unchanged unless the reference itself is rerun. The
separate parse-only census uses 120 files from the pinned source tree, whose
1,543-file listing differs from the packaged runtime suite.

Note the licensing point: the suite is GPLv2, like the rest of MySQL. Running it
against our implementation during development is fine; **vendoring it into an
MIT-licensed repository is not**. Fetch it in CI from the upstream tree rather
than committing it — the same reason `reference/` is gitignored.

## 2. Differential testing against a real server

Run a real MySQL 8.4 in Docker alongside our engine, execute the same statements
against both, and compare.

```js
const cases = generateStatements()          // from a grammar, or a corpus
for (const sql of cases) {
  const [ours, theirs] = await Promise.all([myjs.query(sql), real.query(sql)])
  assertDeepEqual(normalise(ours), normalise(theirs))
}
```

What to compare, in decreasing order of importance:

- resultset **rows and their order** — collation bugs surface here first;
- resultset **column metadata** (type byte, charset id, flags, length);
- `affectedRows`, `insertId`, warning counts;
- error number and SQL state (not the message text, which we may reasonably
  word differently);
- the bytes of `SHOW CREATE TABLE`.

Generate cases from a SQL grammar (SQLancer's approach) plus a corpus of real
queries from ORM test suites. SQLancer's *ternary logic partitioning* and
*non-optimising reference engine* techniques are directly applicable and find
genuine optimiser bugs.

## 3. Protocol conformance

Two directions:

**Against real clients.** Point `mysql2`, `mariadb`, the `mysql` CLI, Prisma and
Drizzle at our TCP server and run their own integration suites. `mysql2`'s test
suite in particular exercises the protocol thoroughly, and it is the client most
of our users will bring.

**Against captured traces.** Record real client/server byte exchanges with
`tcpdump` against a real server, then replay them: feed the client bytes to our
server and assert our response bytes match, packet for packet. This catches
sequence-id and capability-negotiation errors that functional tests miss
entirely, because functional tests only notice when something is *very* wrong.

```js
test('caching_sha2_password fast path', async () => {
  const trace = loadTrace('fixtures/caching-sha2-fast.pcap.json')
  const server = new MySQLProtocolServer(fixedNonce, fixedUser)
  for (const { direction, bytes } of trace) {
    if (direction === 'c2s') server.feed(bytes)
    else assertBytesEqual(server.take(), bytes)
  }
})
```

## 4. Format tests

The storage codecs are where a bug is silent and permanent, so they get the most
mechanical testing.

**Golden vectors** taken from MySQL's own source comments and specification
examples — the `DECIMAL(14,4)` worked example from `decimal.cc`, the
`DATETIME`/`TIME` binary-protocol examples from `protocol_classic.cc`, the OK and
ERR packet hex dumps. Every one of these is a free, authoritative test case
already written out.

**Property tests** (`fast-check`):

```js
// round-trip
fc.assert(fc.property(arbitraryValue(type), v =>
  deepEqual(decode(type, encode(type, v)), v)))

// memcmp ordering — the single most valuable property test we have
fc.assert(fc.property(arbitraryValue(type), arbitraryValue(type), (a, b) =>
  sign(compare(a, b)) === sign(memcmp(encodeKey(type, a), encodeKey(type, b)))))
```

The ordering property catches every sign-flip and endianness mistake in doc 24,
which is exactly the class of bug that would otherwise be found by a user with a
corrupt index two years later.

**Real-file tests.** Generate `.ibd` files in CI with a real server:

```sql
CREATE TABLE t (id INT PRIMARY KEY, d DATETIME(6), n DECIMAL(20,6), j JSON);
INSERT INTO t VALUES (...);
FLUSH TABLES t FOR EXPORT;
```

then parse the resulting `.ibd` with `@myjs/innodb` and assert the values match.
Cross-check with `ibd2sdi` for the dictionary half.

## 5. Crash and durability testing

The tests that separate a database from a data structure.

**Fault injection at the VFS.** Wrap the VFS in a layer that can fail any write
after N operations, tear a write at a random offset, or reorder writes across a
flush boundary:

```js
const vfs = new FaultInjectingVfs(memoryVfs, {
  failAfterWrites: n,
  tearWrites: true,
  reorderAcrossFlush: true,
})
```

For each selected crash point `n`: run, crash, reopen, and
assert (a) the database is consistent, and (b) every transaction that was
acknowledged as committed is present. Fully deterministic, fast, and it is the
only way to actually verify the claims in [41](./41-durability-and-concurrency.md).

**Real browser crashes (planned, M6.10).** In Playwright, kill the page mid-transaction and
reopen. Slower and less exhaustive, but it validates that OPFS behaves as the
model assumes — which is the assumption most likely to be wrong.

## 6. Fuzzing

Every parser is an attack surface reachable from a peer:

The current fuzz commands cover the byte reader, SQL parser, native engine
formats and SQL executor. InnoDB page fuzzing waits for M7's reader.

| Target | Input |
|---|---|
| protocol packets | arbitrary bytes as a client message |
| SQL text | arbitrary strings to the parser |
| `.ibd` pages | mutated real pages |
| binary JSON | mutated real documents |
| WAL blocks | mutated real logs |

The invariant is the same everywhere: **a typed error, never a crash, never a
hang, never an out-of-bounds read.** Run with a JS fuzzer in CI and keep a
corpus of crashers as regression tests.

## 7. Performance regression

Track, per commit, against fixed workloads:

- point `SELECT` by primary key;
- range scan;
- `INSERT` throughput, sequential and random keys;
- transaction commit rate at each `flush_log_at_trx_commit` setting;
- cold-start time (the number that decides whether the browser story works);
- bundle size, gzipped.

Bundle size and cold start belong in the *same* dashboard as query performance,
because in a browser they are performance.

## 8. What "compatible" will mean concretely

The claim should be a number, published and reproducible. This illustrates
the dashboard format; these are not measured results. The current measurements
and remaining targets are in [the roadmap's scoreboard](./44-roadmap.md#scoreboard):

```
MySQL test suite:      812 / 1,543 files passing   (52.6%)
mysql2 test suite:     241 / 253 passing
Drizzle mysql suite:   pass
Prisma mysql suite:    pass
Protocol traces:       48 / 48
InnoDB round-trip:     17 / 17 types
Crash tests:           10,000 injection points, 0 inconsistencies
```

Publish it in the README and update it in CI. A compatibility claim without a
number is marketing; with a number it is an engineering artefact.

## Test infrastructure

```
test/
  unit/          per-module, memory VFS, fast
  protocol/      trace replay + real client integration
  format/        captured reference observations, codecs, corpus replay
  crash/         fault injection
  lib/           shared replay helpers
```

`npm test` runs unit, protocol, format and crash tests (300 injection points).
It needs no live MySQL or browser. MySQL's own `mysqltest` client is run by
`tools/mysqltest-run.mjs`; browser integration is M6.10. Benchmarks live in
`tools/bench.mjs`.

`npm run verify:docker` installs with `npm ci` in a disposable Linux copy,
using Node 22.18.0, then runs typecheck, lint, tests, size and package smoke
checks. The checkout is mounted read-only. `-- --full` adds seeded fuzzing
and 10,000 crash points; `-- --reference` starts MySQL 8.4.11 at a pinned image
digest, runs the real C client's authentication and query checks against
this executor, and reproduces seven committed SQL corpora on the reference:
coercion, execution, functions, JSON, more-functions, relational and
temporal-functions. It compares values, metadata, errors and DML headers,
including both protocols where recorded and all 1,737 recorded coercion warning
counts. Plan text and legacy SELECT warning counts remain separate executor
replay gates; those older captures used a different warning-count timing. The runner
waits for readiness and removes its containers and network on success or failure.

CI runs `npm run verify:docker -- --reference` as the blocking `pinned MySQL
8.4.11 reference` job on pushes, pull requests and manual runs. The advisory
recapture jobs against `mysql:8.4` remain separate: a newer server's observations
do not replace the pinned compatibility gate or its committed fixtures.

For a fresh ORM comparison, use `tools/orm-suites.mjs --ours` or `--server`
with `--out /tmp/orm-census.json` to keep committed fixtures intact. Server
mode accepts `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER` and `MYSQL_PASSWORD`;
use a disposable reference server because it creates/drops test databases
and truncates `mysql.general_log`. The runner restores logging settings and
refuses missing or empty reports, including stale reports from an earlier run.
`--prisma-workers N` bounds Jest's worker count and records it in the report;
use the same count for the reference and this executor when comparing runs.
This leaves every test and its timeout intact. Unbounded parallel runs can
lose interactive-transaction tests to scheduling delays on a busy host.
