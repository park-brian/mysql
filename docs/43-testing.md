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

The format is simple enough to reimplement:

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

Plan:

1. Write a `mysqltest` interpreter in JavaScript supporting the directives that
   matter — `--disable_warnings`, `--error`, `--replace_result`, `--sorted_result`,
   `--let`, `if`/`while`, `--echo`, `--source`. Perhaps 1,500 lines; the long
   tail of directives can throw "unsupported" and skip the file.
2. Curate an allowlist, growing over time: start with `type_*`, `func_*`,
   `select`, `join*`, `order_by`, `group_by`, `insert*`, `update`, `delete`,
   `null`, `varbinary`, `ctype_*`.
3. Track the pass rate as a headline number in CI. "We pass 812 of MySQL's own
   test files" is a far more meaningful claim than any prose.

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

For every `n` from 1 to the length of the workload: run, crash, reopen, and
assert (a) the database is consistent, and (b) every transaction that was
acknowledged as committed is present. Fully deterministic, fast, and it is the
only way to actually verify the claims in [41](./41-durability-and-concurrency.md).

**Real browser crashes.** In Playwright, kill the page mid-transaction and
reopen. Slower and less exhaustive, but it validates that OPFS behaves as the
model assumes — which is the assumption most likely to be wrong.

## 6. Fuzzing

Every parser is an attack surface reachable from a peer:

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

The claim should be a number, published and reproducible:

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
  format/        golden vectors, property tests, real .ibd files
  mysqltest/     the .test interpreter and the curated allowlist
  differential/  against a real mysqld in Docker
  crash/         fault injection
  browser/       Playwright, real OPFS
  bench/         performance regression
```

`npm test` runs unit, protocol, format and mysqltest — everything that needs no
Docker and no browser — and should stay under a minute. The rest runs in CI.
