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
//   `SELECT HEX(WEIGHT_STRING(s LEVELS 1))` yields exactly what
//   `Collation.sortKey()` must produce. That is the first *external* check on
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

const CONNECT = [
  '-h',
  HOST,
  '-P',
  String(PORT),
  '--protocol=TCP',
  '--ssl-mode=DISABLED',
  '-u',
  USER,
  `-p${PASSWORD}`,
]

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
  const start = (await sql("SHOW MASTER STATUS")).trim().split('\t')
  const [file, position] = [start[0], start[1]]
  for (const v of column.values) {
    await sql(`USE ${DB}; INSERT INTO ${table} VALUES (${v});`)
  }
  const dump = await hexdump(file, position)
  return { column: column.name, ddl: column.ddl, values: column.values, rows: parseRowImages(dump) }
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

/**
 * Pull the row-image bytes out of `--hexdump` output.
 *
 * The hexdump annotates each event with a `# Position Timestamp ...` header
 * followed by lines of `# nnnnnn  xx xx xx  |ascii|`. Only the hex column is
 * taken, and only from Write_rows events — everything else in the log is
 * framing we do not want in a fixture.
 */
function parseRowImages(dump) {
  const rows = []
  let current = null
  for (const line of dump.split('\n')) {
    if (/Write_rows/.test(line)) {
      current = []
      rows.push(current)
      continue
    }
    if (current === null) continue
    if (/^# +\d+ /.test(line)) {
      const hex = line.replace(/^# +\d+ +/, '').replace(/\|.*$/, '').trim()
      for (const byte of hex.split(/\s+/)) {
        if (/^[0-9A-Fa-f]{2}$/.test(byte)) current.push(parseInt(byte, 16))
      }
      continue
    }
    if (line.trim() === '' || line.startsWith('###')) current = null
  }
  return rows.filter((r) => r.length > 0)
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
  { collation: 'utf8mb4_0900_ai_ci', strings: ['a', 'A', 'ä', 'ß', 'ss', 'æ', 'ae', 'é', 'e', 'a ', '一', '가'] },
  { collation: 'utf8mb4_general_ci', strings: ['a', 'A', 'ä', 'ß', 'ss', 'z'] },
  { collation: 'latin1_swedish_ci', strings: ['a', 'A', 'z'] },
  { collation: 'utf8mb4_bin', strings: ['a', 'A', 'ä'] },
]

async function captureWeights() {
  const out = []
  for (const { collation, strings } of WEIGHT_CASES) {
    for (const s of strings) {
      const literal = `_utf8mb4'${s.replace(/'/g, "''")}' COLLATE ${collation}`
      const hex = (await sql(`SELECT HEX(WEIGHT_STRING(${literal} LEVELS 1))`)).trim()
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

const columns = []
for (const column of COLUMNS) {
  columns.push(await captureColumn(column))
  console.log(`  ${column.name.padEnd(10)} ${column.values.length} value(s)`)
}

const encodings = writeFixture('storage-encodings', 'Binlog row images under binlog_row_image=FULL (D-34). Binlog integers are little-endian and unflipped, and a binlog VARCHAR keeps its length prefix — both documented divergences from the .ibd form.', {
  ...provenance,
  framing: 'binlog-row-image',
  columns,
})
console.log(`storage encodings -> ${encodings}`)

const weights = writeFixture('weight-strings', 'SELECT HEX(WEIGHT_STRING(s LEVELS 1)) — exactly what Collation.sortKey() must produce.', {
  ...provenance,
  vectors: await captureWeights(),
})
console.log(`weight strings    -> ${weights}`)

if (existsSync(OUT_DIR)) {
  console.log(`\n${readdirSync(OUT_DIR).length} fixture(s) in ${OUT_DIR}`)
}
