#!/usr/bin/env node
// M5.10's instrument — the string and numeric function library, captured from
// a real MySQL before the functions are written, as M5.18 and M5.21 were.
//
// Each case is a small table, `fn`, of the types these functions meet — a
// utf8mb4 and a latin1 VARCHAR, a TEXT, a VARBINARY, an INT, a DECIMAL, a
// DOUBLE, a DATETIME, each with NULLs among the rows — and SELECTs of calls
// over its columns and over literals: multi-byte text and an emoji, the empty
// string, negative and fractional numbers, numeric strings, NULL. Every
// SELECT runs through both protocols, its metadata and warning count kept.
//
// The functions are M5.10's string slice and numeric slice: SUBSTRING (and
// its FROM form), SUBSTR, MID, LEFT, RIGHT, LPAD, RPAD, REPEAT, REVERSE,
// LOCATE, INSTR, POSITION, TRIM in all its forms, LTRIM, RTRIM, REPLACE,
// CONCAT_WS, SPACE, ASCII; ROUND, FLOOR, CEIL, CEILING, TRUNCATE, SIGN,
// GREATEST, LEAST.
//
// Usage:
//   node tools/capture-functions.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { CONNECTION, SCHEMA, SQL_MODE, runCase } from './capture-relational.mjs'
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
const CASES = Number(arg('cases', '200'))
const SEED = Number(arg('seed', '20261008'))
export { CONNECTION, SQL_MODE }

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

const SETUP = 'CREATE TABLE fn (id INT NOT NULL PRIMARY KEY, s VARCHAR(20), l VARCHAR(12) CHARACTER SET latin1, t TEXT, b VARBINARY(10), n INT, d DECIMAL(7,3), f DOUBLE, dt DATETIME, nn VARCHAR(8) NOT NULL)'

const TEXTS = ['abc', 'Hello World', '', 'zoë', 'ÄÖÜ äöü', 'a😀b', '  pad  ', 'x,y,,z', 'aXbXc', '12abc', '3.5', '-7', 'abcabcabc', 'ß']
const LATIN = ['abc', 'café', '', 'Zoë', ' x ']
const NUMS = ['0', '1', '-1', '2', '3', '7', '-3', '10', '1.5', '-2.5', '2.4999', '1234.5678', '-0.5', '1e2', '2.5e0', '-1.25e1', '18446744073709551615', '-9223372036854775808', '99999999999999999999.5']

function value(column) {
  if (column !== 'nn' && chance(0.15)) return 'NULL'
  switch (column) {
    case 's':
    case 'nn':
      return quote(pick(TEXTS).slice(0, column === 'nn' ? 8 : 20))
    case 'l':
      return quote(pick(LATIN))
    case 't':
      return quote(pick(TEXTS) + pick(['', ' tail', 'abc']))
    case 'b':
      return pick(["X'00FF'", "X'616263'", "''", "X'C3A9'", "'ab'"])
    case 'n':
      return String(int(-20, 20))
    case 'd':
      return pick(['1.500', '-2.250', '0.000', '123.456', '-0.501', '7'])
    case 'f':
      return pick(['1.5e0', '-0.25e0', '2.5e0', '1e10', '-3.5e0', '0.1e0'])
    case 'dt':
      return quote(pick(['2020-01-02 03:04:05', '1999-12-31 23:59:59']))
    default:
      throw new Error(column)
  }
}

function seeds() {
  return Array.from({ length: int(2, 5) }, (_, k) => `INSERT INTO fn VALUES (${k + 1}, ${['s', 'l', 't', 'b', 'n', 'd', 'f', 'dt', 'nn'].map(value).join(', ')})`)
}

// --- operands -------------------------------------------------------------------

const textOperand = () =>
  pick([
    () => pick(['s', 'l', 't', 'nn', 'b']),
    () => quote(pick(TEXTS)),
    () => pick(['NULL', '123', '-4.5', "X'616263'", "_latin1'café'", "_binary'ab'", 'dt']),
  ])()

const numOperand = () =>
  pick([
    () => pick(['n', 'd', 'f', 'id']),
    () => pick(NUMS),
    () => pick(['NULL', "'2'", "'3x'", "'abc'", '-0', 'n % 4', "''"]),
  ])()

/** A small count or position, the shapes these take most. */
const smallOperand = () => pick([() => String(int(-3, 6)), () => pick(['n', 'id', 'NULL', "'2'", '1.5', '2.5', '-1', '0', '18446744073709551615'])])()

const CALLS = [
  () => `SUBSTRING(${textOperand()}, ${smallOperand()})`,
  () => `SUBSTRING(${textOperand()}, ${smallOperand()}, ${smallOperand()})`,
  () => `SUBSTRING(${textOperand()} FROM ${smallOperand()} FOR ${smallOperand()})`,
  () => `SUBSTR(${textOperand()}, ${smallOperand()})`,
  () => `MID(${textOperand()}, ${smallOperand()}, ${smallOperand()})`,
  () => `LEFT(${textOperand()}, ${smallOperand()})`,
  () => `RIGHT(${textOperand()}, ${smallOperand()})`,
  () => `LPAD(${textOperand()}, ${smallOperand()}, ${textOperand()})`,
  () => `RPAD(${textOperand()}, ${smallOperand()}, ${textOperand()})`,
  () => `REPEAT(${textOperand()}, ${smallOperand()})`,
  () => `REVERSE(${textOperand()})`,
  () => `LOCATE(${textOperand()}, ${textOperand()})`,
  () => `LOCATE(${textOperand()}, ${textOperand()}, ${smallOperand()})`,
  () => `INSTR(${textOperand()}, ${textOperand()})`,
  () => `POSITION(${textOperand()} IN ${textOperand()})`,
  () => `TRIM(${textOperand()})`,
  () => `TRIM(${textOperand()} FROM ${textOperand()})`,
  () => `TRIM(${pick(['LEADING', 'TRAILING', 'BOTH'])} ${textOperand()} FROM ${textOperand()})`,
  () => `TRIM(${pick(['LEADING', 'TRAILING', 'BOTH'])} FROM ${textOperand()})`,
  () => `LTRIM(${textOperand()})`,
  () => `RTRIM(${textOperand()})`,
  () => `REPLACE(${textOperand()}, ${textOperand()}, ${textOperand()})`,
  () => `CONCAT_WS(${textOperand()}, ${Array.from({ length: int(1, 3) }, textOperand).join(', ')})`,
  () => `SPACE(${smallOperand()})`,
  () => `ASCII(${textOperand()})`,
  () => `ROUND(${numOperand()})`,
  () => `ROUND(${numOperand()}, ${smallOperand()})`,
  () => `FLOOR(${numOperand()})`,
  () => `CEIL(${numOperand()})`,
  () => `CEILING(${numOperand()})`,
  () => `TRUNCATE(${numOperand()}, ${smallOperand()})`,
  () => `SIGN(${numOperand()})`,
  () => `GREATEST(${Array.from({ length: int(2, 3) }, () => (chance(0.5) ? numOperand() : textOperand())).join(', ')})`,
  () => `LEAST(${Array.from({ length: int(2, 3) }, () => (chance(0.5) ? numOperand() : textOperand())).join(', ')})`,
]

export function generateCase() {
  const out = [{ sql: SETUP }, ...seeds().map((sql) => ({ sql }))]
  for (let i = int(4, 8); i > 0; i--) {
    const calls = Array.from({ length: int(1, 3) }, () => pick(CALLS)())
    out.push({ sql: `SELECT ${calls.join(', ')} FROM fn ORDER BY id`, select: true, ordered: true })
  }
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
  const warned = results.filter((r) => (r.warnings ?? 0) > 0).length
  console.log(`${cases.length} cases, ${results.length} statements (${warned} with warnings): errors ${JSON.stringify(errors)}`)

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, 'functions.json')
  const head = {
    name: 'functions',
    note:
      "M5.10: generated calls of the string and numeric functions over a table of every type they meet and over literals, run on a real MySQL " +
      'through mysql2, each SELECT through both protocols with its metadata and warning count.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`functions -> ${file}`)
}
