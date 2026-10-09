#!/usr/bin/env node
// M5.21's instrument — capture JSON execution vectors from a real MySQL.
//
// Built before any JSON code, as M5.18 was before relational SELECT. Each case
// is a script over a table with JSON columns beside the scalar types JSON meets
// (`jd`), and a parent/child pair (`jp`, `jc`) for the shape Drizzle's
// relational API sends: `LEFT JOIN LATERAL (SELECT COALESCE(JSON_ARRAYAGG(
// JSON_ARRAY(…)), JSON_ARRAY()) …) ON TRUE`. What it draws:
//
//   - **Documents as text into a JSON column**, valid and not: key order
//     (stored length-then-bytes, and so rendered), duplicate keys (the last
//     wins), every scalar (an integer past INT64, a decimal with trailing
//     zeros, `1e2`, `-0`), strings with escapes and non-ASCII, nesting, and
//     the texts 8.4.11 refuses with 3140.
//   - **The constructors and aggregates**, over every column type and over
//     literals: `JSON_ARRAY`, `JSON_OBJECT`, `JSON_ARRAYAGG`, `JSON_OBJECTAGG`,
//     with GROUP BY and over no rows, and inside COALESCE and IFNULL.
//   - **JSON where SQL meets it**: `CAST(… AS JSON)`, comparison with JSON,
//     numbers and strings, JSON into a VARCHAR column, UNION with a string.
//
// Every SELECT runs through both protocols, as M5.18's do. The driver is told
// `jsonStrings` and the text protocol is read without type casting, so what is
// recorded is the text the server sent — mysql2's own `JSON.parse` would turn
// 18446744073709551615 into 18446744073709552000.
//
// Usage:
//   node tools/capture-json.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { CONNECTION as RELATIONAL, SCHEMA, SQL_MODE, runCase } from './capture-relational.mjs'
import { isMain } from './lib/is-main.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const HOST = arg('host', '127.0.0.1')
const PORT = Number(arg('port', '3306'))
const USER = arg('user', 'root')
const PASSWORD = arg('password', 'root')
const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)
const CASES = Number(arg('cases', '250'))
const SEED = Number(arg('seed', '20261012'))
/** M5.18's driver options, and JSON as the text the server sent. */
export const CONNECTION = { ...RELATIONAL, jsonStrings: true }
export { SCHEMA, SQL_MODE }

/** xorshift32, as every corpus tool here. */
let state = SEED || 1
function rnd() {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) / 0x100000000
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
const chance = (p) => rnd() < p
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

// --- documents --------------------------------------------------------------

/** Keys that sort differently by length-then-bytes than alphabetically. */
const KEYS = ['a', 'b', 'aa', 'B', 'id', 'name', 'zz', 'é', 'k1', 'k10', 'k2', '']
const STRINGS = ['x', 'Ann', '', 'zoë', 'a"b', 'tab\\there', 'line\\nbreak', '\\u00e9', 'back\\\\slash', '1', 'true', 'null']
const NUMBERS = ['0', '1', '-1', '42', '-0', '2.50', '1.0', '0.1e1', '1e2', '-1.5E-3', '3.14159', '9223372036854775807', '9223372036854775808', '18446744073709551615', '-9223372036854775808', '-9223372036854775809', '1e300', '123456789012345678901234567890']

/** A JSON document as text, with the whitespace a person might type. */
function doc(depth = 0) {
  const r = rnd()
  if (depth >= 3 || r < 0.35) {
    return pick([() => pick(NUMBERS), () => `"${pick(STRINGS)}"`, () => pick(['true', 'false', 'null'])])()
  }
  const sp = chance(0.5) ? ' ' : ''
  if (r < 0.65) {
    const items = Array.from({ length: int(0, 4) }, () => doc(depth + 1))
    return `[${items.join(`,${sp}`)}]`
  }
  const members = Array.from({ length: int(0, 4) }, () => `"${pick(KEYS)}":${sp}${doc(depth + 1)}`)
  return `{${members.join(`,${sp}`)}}`
}

/** Texts 8.4.11 refuses as JSON (3140). */
const INVALID = ['', '{bad', '[1,]', "{'a': 1}", 'tru', '01', '1e400', '[1 2]', '{"a" 1}', 'undefined', '"unterminated', '{"a":1}x']

// --- the tables -------------------------------------------------------------

const SETUP = [
  'CREATE TABLE jd (id INT NOT NULL PRIMARY KEY, doc JSON, nn JSON NOT NULL, s VARCHAR(20), n INT, d DECIMAL(6,2), f DOUBLE, dt DATETIME, b VARBINARY(8), v VARCHAR(60))',
  'CREATE TABLE jp (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(12) NOT NULL, meta JSON)',
  'CREATE TABLE jc (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, jp_id INT, label VARCHAR(10), qty INT NOT NULL, KEY (jp_id))',
]

const NAMES = ['ann', 'Bob', 'cy', 'ÄNNA', 'dee', 'zoë']
const LABELS = ['red', 'Blue', 'green', 'x']

/** A scalar value for one of jd's columns, NULL a fifth of the time. */
function scalar(column) {
  if (chance(0.2)) return 'NULL'
  switch (column) {
    case 's':
      return quote(pick(['ann', 'Bob', '', 'zoë', '[1]', '{"a":1}', '12']))
    case 'n':
      return String(int(-5, 2000))
    case 'd':
      return pick(['1.50', '-2.25', '0.00', '100.10', '7'])
    case 'f':
      return pick(['1.5e0', '-0.25e0', '1e10', '3.0e0', '0.1e0'])
    case 'dt':
      return quote(pick(['2020-01-02 03:04:05', '1999-12-31 23:59:59', '2024-02-29 00:00:00']))
    case 'b':
      return pick(["X'00FF'", "X'616263'", "''"])
    default:
      throw new Error(column)
  }
}

function seeds() {
  const out = []
  const rows = int(3, 6)
  for (let id = 1; id <= rows; id++) {
    const docText = chance(0.15) ? 'NULL' : quote(doc())
    out.push(`INSERT INTO jd (id, doc, nn, s, n, d, f, dt, b) VALUES (${id}, ${docText}, ${quote(doc())}, ${scalar('s')}, ${scalar('n')}, ${scalar('d')}, ${scalar('f')}, ${scalar('dt')}, ${scalar('b')})`)
  }
  const parents = int(2, 4)
  for (let i = 0; i < parents; i++) out.push(`INSERT INTO jp (name, meta) VALUES (${quote(NAMES[i])}, ${chance(0.3) ? 'NULL' : quote(doc(1))})`)
  const children = Array.from({ length: int(0, 6) }, () => `(${chance(0.15) ? 'NULL' : int(1, parents + 1)}, ${chance(0.15) ? 'NULL' : quote(pick(LABELS))}, ${int(0, 9)})`)
  if (children.length > 0) out.push(`INSERT INTO jc (jp_id, label, qty) VALUES ${children.join(', ')}`)
  return out
}

// --- statements ---------------------------------------------------------------

/** An expression of any type, for a constructor's argument. */
function operand() {
  return pick([
    () => pick(['doc', 'nn', 's', 'n', 'd', 'f', 'dt', 'b', 'id']),
    () => pick(["'x'", "''", '1', '-7', '2.50', '1e0', 'NULL', 'TRUE', 'FALSE', "'[1, 2]'", "DATE '2020-01-02'", "TIME '10:11:12'", "X'61'"]),
    () => `CAST(${quote(doc(1))} AS JSON)`,
    () => `n + 1`,
    () => `JSON_ARRAY(${pick(['n', 's', '1, 2', ''])})`,
  ])()
}

function constructor() {
  if (chance(0.5)) return `JSON_ARRAY(${Array.from({ length: int(0, 4) }, operand).join(', ')})`
  const pairs = Array.from({ length: int(0, 3) }, () => `${pick(["'a'", "'b'", "'aa'", "'id'", 's', "'é'", "'a'"])}, ${operand()}`)
  return `JSON_OBJECT(${pairs.join(', ')})`
}

const statements = [
  // Constructors over each row.
  () => ({ sql: `SELECT id, ${constructor()}, ${constructor()} FROM jd ORDER BY id`, ordered: true }),
  // Aggregates, grouped and not, and over nothing.
  () => ({ sql: `SELECT JSON_ARRAYAGG(${pick(['id', 'doc', 'nn', 's', 'n', 'd', 'f', 'dt', 'b', "JSON_ARRAY(id, s)", "JSON_OBJECT('i', id, 'v', nn)"])}) FROM jd${chance(0.3) ? ' WHERE id > 100' : ''}`, ordered: true }),
  () => ({ sql: `SELECT n IS NULL, JSON_OBJECTAGG(${pick(['id', 's', "CONCAT('k', id)"])}, ${pick(['doc', 'nn', 'n', 'd', 'dt', 'id'])}) FROM jd GROUP BY n IS NULL ORDER BY 1`, ordered: true }),
  () => ({ sql: `SELECT COALESCE(JSON_ARRAYAGG(JSON_ARRAY(id, ${pick(['s', 'n', 'doc', 'd'])})), JSON_ARRAY()) FROM jd WHERE id > ${int(0, 7)}`, ordered: true }),
  // Drizzle's relational shape, as `mysql-core/dialect.js` emits it.
  () => ({
    sql:
      'SELECT `jp`.`id`, `jp`.`name`, `jp`.`meta`, `jp_children`.`data` AS `children` FROM `jp` LEFT JOIN LATERAL (SELECT COALESCE(JSON_ARRAYAGG(JSON_ARRAY(`jc`.`id`, `jc`.`label`, `jc`.`qty`)), JSON_ARRAY()) AS `data` ' +
      `FROM \`jc\` WHERE \`jc\`.\`jp_id\` = \`jp\`.\`id\`${chance(0.3) ? ' AND `jc`.`qty` > 3' : ''}) AS \`jp_children\` ON TRUE ORDER BY \`jp\`.\`id\``,
    ordered: true,
  }),
  () => ({
    sql:
      'SELECT `jc`.`id`, `jc`.`label`, `jc_parent`.`data` AS `parent` FROM `jc` LEFT JOIN LATERAL (SELECT JSON_ARRAY(`jp`.`id`, `jp`.`name`, `jp`.`meta`) AS `data` FROM (SELECT * FROM `jp` `jp` WHERE `jp`.`id` = `jc`.`jp_id` LIMIT 1) `jp`) AS `jc_parent` ON TRUE ORDER BY `jc`.`id`',
    ordered: true,
  }),
  // The column itself, and what SQL makes of it.
  () => ({ sql: 'SELECT id, doc, nn FROM jd ORDER BY id', ordered: true }),
  () => ({ sql: `SELECT id, doc ${pick(['=', '<>', '<', '>=', '<=>'])} ${pick(["CAST('1' AS JSON)", "CAST('[1, 2]' AS JSON)", "CAST('\"x\"' AS JSON)", '1', "'x'", 'nn', 'JSON_ARRAY()', 'n', 'NULL'])} FROM jd ORDER BY id`, ordered: true }),
  () => ({ sql: `SELECT id, doc IS NULL, COALESCE(doc, nn), IFNULL(doc, JSON_OBJECT()) FROM jd ORDER BY id`, ordered: true }),
  () => ({ sql: `SELECT CAST(${pick(["'[1, 2]'", "' {\"b\":1, \"a\":2} '", "'x'", '1', '2.50', 'NULL', "'null'", "'1e2'", "'18446744073709551616'"])} AS JSON)`, ordered: true }),
  () => ({ sql: `SELECT id, CAST(${pick(['s', 'n', 'd', 'f', 'dt', 'b'])} AS JSON) FROM jd ORDER BY id`, ordered: true }),
  () => ({ sql: `SELECT id, s FROM jd UNION ALL SELECT id, doc FROM jd ORDER BY 1, 2`, ordered: true }),
  // Not ordered: a sort keys a JSON array or object on its length alone, and
  // 8.4.11 breaks the ties the same way ascending and descending, so not by
  // anything in the key — its sort's own order over equal keys.
  () => ({ sql: `SELECT DISTINCT nn FROM jd ORDER BY nn`, ordered: false }),
  // Writes.
  () => `INSERT INTO jd (id, doc, nn) VALUES (${int(20, 40)}, ${quote(chance(0.4) ? pick(INVALID) : doc())}, ${quote(doc())})`,
  () => `INSERT INTO jd (id, doc, nn) VALUES (${int(41, 60)}, ${pick(['1', "'1'", 'NULL', 'TRUE', "JSON_ARRAY(1)", "CAST(1 AS JSON)"])}, ${pick(["'[]'", 'NULL', "JSON_OBJECT()"])})`,
  () => `UPDATE jd SET doc = ${constructor()} WHERE id = ${int(1, 6)}`,
  () => `UPDATE jd SET v = doc WHERE id <= ${int(1, 6)}`,
  () => `INSERT INTO jp (name, meta) SELECT CONCAT(name, '2'), ${pick(['meta', "JSON_ARRAY(id, name)", 'NULL'])} FROM jp WHERE id <= 2`,
]

export function generateCase() {
  const out = [...SETUP.map((sql) => ({ sql })), ...seeds().map((sql) => ({ sql }))]
  for (let i = int(3, 7); i > 0; i--) {
    const s = pick(statements)()
    out.push(typeof s === 'string' ? { sql: s } : { sql: s.sql, select: true, ordered: s.ordered })
  }
  out.push({ sql: 'SELECT * FROM jd ORDER BY id', select: true, ordered: true }, { sql: 'SELECT * FROM jp ORDER BY id', select: true, ordered: true })
  return out
}

if (isMain(import.meta.url)) {
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD, ...CONNECTION })
  await conn.query(`SET sql_mode = '${SQL_MODE}'`)
  const [[{ v: version }]] = await conn.query('SELECT VERSION() AS v')
  const cases = []
  const seen = new Set()
  while (cases.length < CASES) {
    const statements = generateCase()
    const key = statements.map((s) => s.sql).join('\n')
    if (seen.has(key)) continue
    seen.add(key)
    cases.push(await runCase(conn, statements, { server: true }))
  }
  await conn.query(`DROP DATABASE IF EXISTS ${SCHEMA}`)
  await conn.end()

  const results = cases.flat()
  const errors = {}
  for (const r of results) if (r.error !== undefined) errors[r.error[0]] = (errors[r.error[0]] ?? 0) + 1
  console.log(`${cases.length} cases, ${results.length} statements: errors ${JSON.stringify(errors)}`)

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, 'json.json')
  const head = {
    name: 'json',
    note:
      'M5.21: generated scripts over JSON columns — documents in and out, the constructors and aggregates, Drizzle\'s LATERAL JSON_ARRAYAGG shape, CAST and ' +
      'comparison — run on a real MySQL through mysql2, each SELECT through both protocols, JSON as the text the server sent.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`json -> ${file}`)
}
