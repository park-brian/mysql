#!/usr/bin/env node
// M2.21 / D-34 — capture storage-encoding golden vectors from a real MySQL.
//
// Doc 43 §4 asks for real `.ibd` files. `@myjs/innodb` does not exist until
// M7, so D-34 takes the same bytes years earlier from two places that are
// available now:
//
//   `mysqlbinlog --hexdump` under `binlog_row_image=FULL` yields doc 24's
//   column encodings. Doc 24 says the `decimal2bin` form is "used identically
//   in `.ibd` files and binlog row images", and doc 28 says the same of binary
//   JSON — so a row image is the storage encoding, with two documented
//   divergences that the fixture records rather than hides: binlog integers
//   are little-endian and *unflipped*, and a binlog `VARCHAR` keeps its length
//   prefix. Recording which framing a vector is in is what makes doc 24's
//   "both steps matter" sentence executable.
//
//   `SELECT HEX(WEIGHT_STRING(s COLLATE c))` yields exactly what
//   `Collation.sortKey()` must produce. (D-34 writes `LEVELS 1`; the keyword
//   is `LEVEL`, and the clause is unnecessary for a level-1 collation.) That is the first *external* check on
//   the UCA tables M2.20 generated — a real 8.4 saying whether our sort keys
//   are its sort keys, which is M2.7's outstanding acceptance clause.
//
// Committed fixtures replay offline and gate (`npm test`); re-capturing here
// is informational, exactly as `trace-capture` is.
//
// Usage:
//   node tools/capture-types.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { check } from './lib/gen-common.mjs'
import { parseRowImages } from './lib/binlog-hexdump.mjs'

const run = promisify(execFile)

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const HOST = arg('host', '127.0.0.1')
const PORT = arg('port', '3306')
const USER = arg('user', 'root')
const PASSWORD = arg('password', 'root')
const DB = arg('db', 'typevectors')
const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)

/**
 * How every query in this tool connects.
 *
 * TCP, because a service container's Unix socket is inside the container. And
 * *without* `--ssl-mode=DISABLED`: `caching_sha2_password` refuses its full
 * handshake over plaintext (`ERROR 2061 (HY000): Authentication requires
 * secure connection`) unless the account is already cached or the client asks
 * for the RSA key. This used to disable TLS and worked only because the CI
 * job's readiness probe connects over TLS first and warms the server's cache —
 * a dependency on the order of two unrelated commands, which is not a thing to
 * rely on. Nothing here is a recorded byte stream, so TLS costs nothing.
 */
// Pinned, not inherited. The `mysql` CLI picks its default character set from
// the OS locale, so on a machine with no `LANG` it negotiates **latin1** — and
// the UTF-8 bytes of a literal like 'café' are then read as latin1 and stored
// double-encoded, as `63 61 66 C3 83 C2 A9` instead of `63 61 66 C3 A9`. The
// corpus that comes out looks entirely plausible and is wrong, which is the
// failure mode this file already guards against twice (the completeness
// assertion, and the `--ssl-mode` removal). A capture must not depend on the
// locale of the machine that ran it.
const CONNECT = ['-h', HOST, '-P', String(PORT), '--protocol=TCP', '--default-character-set=utf8mb4', '-u', USER, `-p${PASSWORD}`]

/** Run SQL and return stdout, tab-separated and unquoted (`-N -B`). */
async function sql(statements) {
  const { stdout } = await run('mysql', [...CONNECT, '-N', '-B', '-e', statements], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

let cachedVersion = null
async function serverVersion() {
  cachedVersion ??= (await sql('SELECT VERSION()')).trim()
  return cachedVersion
}

async function clientVersion() {
  return (await run('mysql', ['--version'], { encoding: 'utf8' })).stdout.trim()
}

/**
 * Write one fixture, in the shape `capture-traces.mjs` established.
 *
 * Same provenance header, same 2-space JSON, same trailing newline — so the
 * `git diff --stat` in CI reports a real change rather than a reformat.
 */
function writeFixture(name, note, payload) {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${name}.json`)
  writeFileSync(file, JSON.stringify({ name, note, ...payload }, null, 2) + '\n')
  return file
}

// --- the column encodings, out of the binary log ---------------------------

/**
 * The columns to capture, and the values to put in them.
 *
 * Chosen to cover doc 24's worked examples and the cases the property tests
 * found rather than a broad sweep: the sign-flip boundary for integers, the
 * `DECIMAL(14,4)` example from `decimal.cc`, both signs, the temporal family
 * at every fractional width, and the ENUM/SET/BIT forms that are forced
 * unsigned.
 */
const COLUMNS = [
  { name: 'i8', ddl: 'TINYINT', values: ['-128', '0', '127'] },
  { name: 'u8', ddl: 'TINYINT UNSIGNED', values: ['0', '255'] },
  { name: 'i32', ddl: 'INT', values: ['-1', '0', '1', '-2147483648', '2147483647'] },
  { name: 'u32', ddl: 'INT UNSIGNED', values: ['0', '1', '4294967295'] },
  { name: 'i64', ddl: 'BIGINT', values: ['-9223372036854775808', '0', '9223372036854775807'] },
  { name: 'dec', ddl: 'DECIMAL(14,4)', values: ["'1234567890.1234'", "'-1234567890.1234'", "'0.0000'"] },
  { name: 'dec_max', ddl: 'DECIMAL(65,30)', values: ["'1.5'"] },
  { name: 'f32', ddl: 'FLOAT', values: ['1.5', '-1.5', '0'] },
  { name: 'f64', ddl: 'DOUBLE', values: ['1.5', '-1.5', '0'] },
  { name: 'd', ddl: 'DATE', values: ["'2010-10-17'", "'1999-12-31'", "'2000-01-01'"] },
  { name: 'dt0', ddl: 'DATETIME', values: ["'2010-10-17 19:27:30'"] },
  { name: 'dt6', ddl: 'DATETIME(6)', values: ["'2010-10-17 19:27:30.000001'"] },
  { name: 'ts6', ddl: 'TIMESTAMP(6) NULL', values: ["'2010-10-17 19:27:30.000001'"] },
  { name: 't0', ddl: 'TIME', values: ["'19:27:30'", "'-120:19:27'"] },
  { name: 't6', ddl: 'TIME(6)', values: ["'-120:19:27.000001'"] },
  { name: 'y', ddl: 'YEAR', values: ['2010'] },
  { name: 'e', ddl: "ENUM('small','medium','large')", values: ["'small'", "'large'"] },
  { name: 's', ddl: "SET('a','b','c')", values: ["'a,c'", "''"] },
  { name: 'b', ddl: 'BIT(9)', values: ["b'101010101'"] },
  { name: 'ch', ddl: 'CHAR(4)', values: ["'ab'"] },
  { name: 'vc', ddl: 'VARCHAR(16)', values: ["'ab'", "'café'"] },
  { name: 'bin', ddl: 'BINARY(4)', values: ["'ab'"] },
  { name: 'js', ddl: 'JSON', values: [`'{"b":1,"a":[1,2,null]}'`, `'[]'`, `'{"n":9007199254740993}'`] },
]

/**
 * Capture one column's storage bytes for each of its values.
 *
 * One table per column rather than one wide table, so a row image contains
 * exactly one value and no offset arithmetic is needed to find it.
 */
async function captureColumn(column) {
  const table = `t_${column.name}`
  await sql(`
    CREATE DATABASE IF NOT EXISTS ${DB};
    USE ${DB};
    DROP TABLE IF EXISTS ${table};
    CREATE TABLE ${table} (v ${column.ddl}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
  const [file, position] = await binlogPosition()
  for (const v of column.values) {
    await sql(`USE ${DB}; INSERT INTO ${table} VALUES (${v});`)
  }
  const dump = await hexdump(file, position)
  const rows = parseRowImages(dump, checksummed)
  // The capture asserts its own completeness. The corpus this replaced looked
  // plausible in the JSON — arrays of bytes, one per column — and was one
  // event out of step throughout, with three columns silently empty. A fixture
  // that is wrong is worse than one that is missing, because the test built on
  // it passes.
  check(
    rows.length === column.values.length,
    `capture-types: ${column.name} inserted ${column.values.length} value(s) but ${rows.length} row image(s) came back`,
  )
  return { column: column.name, ddl: column.ddl, values: column.values, rows }
}

/**
 * Where the binary log is right now.
 *
 * MySQL 8.4 *removed* `SHOW MASTER STATUS`; `SHOW BINARY LOG STATUS` is its
 * replacement. Both are tried rather than one being assumed, so the tool works
 * against the 8.0 servers the trace fixtures were captured from as well as the
 * 8.4 the CI job runs.
 */
async function binlogPosition() {
  for (const statement of ['SHOW BINARY LOG STATUS', 'SHOW MASTER STATUS']) {
    try {
      const row = (await sql(statement)).trim().split('\t')
      if (row.length >= 2) return [row[0], row[1]]
    } catch {
      // Not this server's spelling; try the other.
    }
  }
  console.error('neither SHOW BINARY LOG STATUS nor SHOW MASTER STATUS worked — is the binary log on?')
  process.exit(1)
}

/** `mysqlbinlog --hexdump` over the range the inserts landed in. */
async function hexdump(file, position) {
  const { stdout } = await run(
    'mysqlbinlog',
    [
      '--read-from-remote-server',
      '-h',
      HOST,
      '-P',
      String(PORT),
      '-u',
      USER,
      `-p${PASSWORD}`,
      '--hexdump',
      '--base64-output=DECODE-ROWS',
      '--start-position',
      String(position),
      file,
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  )
  return stdout
}

// --- the sort keys, out of WEIGHT_STRING -----------------------------------

/**
 * Collations and strings to weigh.
 *
 * The strings are the ones doc 29 names and the ones M2.7 asserted from the
 * generated tables, so a disagreement here is a disagreement about MySQL's
 * own weights rather than about our packing.
 */
const WEIGHT_CASES = [
  { collation: 'utf8mb4_0900_ai_ci', charset: 'utf8mb4', strings: ['a', 'A', 'ä', 'ß', 'ss', 'æ', 'ae', 'é', 'e', 'a ', '一', '가'] },
  { collation: 'utf8mb4_general_ci', charset: 'utf8mb4', strings: ['a', 'A', 'ä', 'ß', 'ss', 'z'] },
  // ASCII only, so the literal is representable in latin1 — and the
  // introducer must be `_latin1`, since `_utf8mb4'a' COLLATE latin1_swedish_ci`
  // is a charset/collation mismatch MySQL rejects outright.
  { collation: 'latin1_swedish_ci', charset: 'latin1', strings: ['a', 'A', 'z'] },
  { collation: 'utf8mb4_bin', charset: 'utf8mb4', strings: ['a', 'A', 'ä'] },
]

async function captureWeights() {
  const out = []
  for (const { collation, charset, strings } of WEIGHT_CASES) {
    for (const s of strings) {
      // The introducer has to name the collation's *own* charset: a literal
      // introduced as one charset and collated as another is an error, not a
      // conversion.
      const literal = `_${charset}'${s.replace(/'/g, "''")}' COLLATE ${collation}`
      // No `LEVEL` clause. D-34 writes `WEIGHT_STRING(s LEVELS 1)`, but the
      // keyword is `LEVEL` (singular) and 8.4 rejects `LEVELS` outright — and
      // the clause is unnecessary anyway: bare `WEIGHT_STRING` returns exactly
      // what that collation's `strnxfrm` produces, which is exactly what
      // `Collation.sortKey()` must produce. Naming a level would be redundant
      // for an `_ai_ci` collation and wrong for a multi-level one.
      const hex = (await sql(`SELECT HEX(WEIGHT_STRING(${literal}))`)).trim()
      out.push({ collation, string: s, weightString: hex })
    }
  }
  return out
}

// --- main -------------------------------------------------------------------

const version = await serverVersion()
const provenance = {
  capturedAgainst: `mysql-server ${version}`,
  capturedWith: await clientVersion(),
}

// D-34 needs FULL row images; without it an INSERT logs only the changed
// columns and the fixture would be silently partial.
const rowImage = (await sql("SELECT @@binlog_row_image")).trim()
if (rowImage !== 'FULL') {
  console.error(`binlog_row_image is ${rowImage}, not FULL — start the server with --binlog-row-image=FULL`)
  process.exit(1)
}

// Whether events carry a four-byte CRC32 trailer. Read rather than assumed:
// `CRC32` is the default in 8.0 and 8.4 but `NONE` is still settable, and the
// difference is four bytes on the end of every vector.
const checksum = (await sql('SELECT @@binlog_checksum')).trim()
const checksummed = checksum !== 'NONE'

const columns = []
for (const column of COLUMNS) {
  columns.push(await captureColumn(column))
  console.log(`  ${column.name.padEnd(10)} ${column.values.length} value(s)`)
}

// Written before the weight capture runs, not after. The two corpora are
// independent, and an earlier version lost a complete set of storage vectors
// because a single `WEIGHT_STRING` query had a syntax error — 23 columns of
// work discarded for a reason that had nothing to do with them.
const encodings = writeFixture('storage-encodings', 'Binlog row images under binlog_row_image=FULL (D-34). Binlog integers are little-endian and unflipped, and a binlog VARCHAR keeps its length prefix — both documented divergences from the .ibd form.', {
  ...provenance,
  framing: 'binlog-row-image',
  checksum,
  columns,
})
console.log(`storage encodings -> ${encodings}`)

const weights = writeFixture('weight-strings', 'SELECT HEX(WEIGHT_STRING(s COLLATE c)) — exactly what Collation.sortKey() must produce.', {
  ...provenance,
  vectors: await captureWeights(),
})
console.log(`weight strings    -> ${weights}`)

if (existsSync(OUT_DIR)) {
  console.log(`\n${readdirSync(OUT_DIR).length} fixture(s) in ${OUT_DIR}`)
}
