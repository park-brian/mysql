#!/usr/bin/env node
// M5.2's instrument — implicit coercion, captured from a real MySQL: what a
// comparison compares as, what an arithmetic operator computes in, and what
// type CASE, IF, IFNULL, COALESCE and NULLIF give when their arguments differ.
//
// The function corpora meet coercion only where a function's arguments do.
// This one aims at it: a table, `co`, of one column of nearly every type —
// text in two charsets and a CHAR, binary, signed and unsigned integers, a
// BIGINT, DECIMAL, DOUBLE, FLOAT, BIT, the four temporals, YEAR, ENUM, SET and
// JSON — and SELECTs that set them against each other and against literals
// written every way MySQL reads one: quoted numbers, numbers with trailing
// text, hex and bit literals, typed temporal literals, exponent forms. Every
// SELECT runs through both protocols, its metadata and warning count kept, so
// the result type of a mixed CASE is checked as closely as its value.
//
// Usage:
//   node tools/capture-coercion.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { CONNECTION, SCHEMA, SQL_MODE, runCase } from './capture-relational.mjs'
import { isMain } from './lib/is-main.mjs'
import { arg, xorshift } from './lib/cli.mjs'

const HOST = arg('host', '127.0.0.1')
const PORT = Number(arg('port', '3306'))
const USER = arg('user', 'root')
const PASSWORD = arg('password', 'root')
const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)
const CASES = Number(arg('cases', '300'))
const SEED = Number(arg('seed', '20261011'))
export { CONNECTION, SQL_MODE }

/** xorshift32, seeded (`tools/lib/cli.mjs`), so a seed reproduces the corpus. */
const { pick, chance, int } = xorshift(SEED)
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

const SETUP =
  "CREATE TABLE co (id INT NOT NULL PRIMARY KEY, vc VARCHAR(20), ch CHAR(6), lt VARCHAR(10) CHARACTER SET latin1, bn VARBINARY(10), i INT, u INT UNSIGNED, bi BIGINT, de DECIMAL(10,3), db DOUBLE, fl FLOAT, bt BIT(8), d DATE, dt DATETIME(3), tm TIME, yr YEAR, en ENUM('b','a','10'), st SET('x','y','z'), js JSON)"

const COLUMNS = ['vc', 'ch', 'lt', 'bn', 'i', 'u', 'bi', 'de', 'db', 'fl', 'bt', 'd', 'dt', 'tm', 'yr', 'en', 'st', 'js']

const TEXTS = ['10', '9', '1e1', ' 1', '1x', 'abc', '', '0', '-0', '2.50', '2020-01-02', '2020-01-02 03:04:05', '10:11:12', 'a', 'b', 'x,y', '18446744073709551616', '0x10']

function value(column) {
  if (chance(0.12)) return 'NULL'
  switch (column) {
    case 'vc':
    case 'ch':
      return quote(pick(TEXTS).slice(0, column === 'ch' ? 6 : 20))
    case 'lt':
      return quote(pick(['10', 'café', 'abc', '9', '']))
    case 'bn':
      return pick(["X'3130'", "X'00'", "'abc'", "''", "X'FF'"])
    case 'i':
      return String(int(-12, 12))
    case 'u':
      return pick(['0', '1', '9', '10', '4294967295'])
    case 'bi':
      return pick(['-9223372036854775808', '9223372036854775807', '0', '10', '-1'])
    case 'de':
      return pick(['1.500', '-2.250', '0.000', '10.000', '9.999'])
    case 'db':
      return pick(['1.5e0', '-0.25e0', '1e1', '9.0', '1e300'])
    case 'fl':
      return pick(['1.5', '0.1', '10', '-3.25'])
    case 'bt':
      return pick(["b'1010'", "b'0'", "b'11111111'", '49'])
    case 'd':
      return quote(pick(['2020-01-02', '1999-12-31', '2020-02-29']))
    case 'dt':
      return quote(pick(['2020-01-02 03:04:05.678', '1999-12-31 23:59:59.000', '2020-01-02 00:00:00']))
    case 'tm':
      return quote(pick(['10:11:12', '-01:00:00', '838:59:59', '00:00:00']))
    case 'yr':
      return pick(['2020', '1999', '0', '70'])
    case 'en':
      return quote(pick(['b', 'a', '10']))
    case 'st':
      return quote(pick(['x', 'y,z', '', 'x,y,z']))
    case 'js':
      return quote(pick(['10', '"10"', '[1,2]', '{"a":1}', 'null', 'true', '1.5']))
    default:
      throw new Error(column)
  }
}

function seeds() {
  return Array.from({ length: int(2, 5) }, (_, k) => `INSERT INTO co VALUES (${k + 1}, ${COLUMNS.map(value).join(', ')})`)
}

/** A literal written one of the ways MySQL reads one. */
const literal = () =>
  pick([
    () => quote(pick(TEXTS)),
    () => pick(['10', '9', '0', '-1', '1.5', '10.0', '1e1', '-0.0', '2.5e0', '18446744073709551615', '-9223372036854775808', '1e300']),
    () => pick(["X'3130'", '0x61', "b'1010'", '0b1', "_latin1'10'", "_binary'10'", 'TRUE', 'FALSE', 'NULL']),
    () => pick(["DATE'2020-01-02'", "TIMESTAMP'2020-01-02 03:04:05'", "TIME'10:11:12'", '20200102', '20200102030405', '101112']),
  ])()

const operand = () => (chance(0.6) ? pick(COLUMNS) : literal())

const COMPARE = ['=', '<>', '<', '<=', '>', '>=', '<=>']
const ARITH = ['+', '-', '*', '/', 'DIV', '%']

const EXPRESSIONS = [
  () => `${operand()} ${pick(COMPARE)} ${operand()}`,
  () => `${operand()} ${pick(COMPARE)} ${operand()}`,
  () => `${operand()} ${pick(ARITH)} ${operand()}`,
  () => `-${operand()}`,
  () => `${operand()} ${chance(0.3) ? 'NOT ' : ''}BETWEEN ${operand()} AND ${operand()}`,
  () => `${operand()} ${chance(0.3) ? 'NOT ' : ''}IN (${Array.from({ length: int(1, 3) }, operand).join(', ')})`,
  () => `CASE WHEN id ${pick(['= 1', '> 1', '< 3'])} THEN ${operand()} ELSE ${operand()} END`,
  () => `CASE ${operand()} WHEN ${operand()} THEN ${operand()} ${chance(0.5) ? `ELSE ${operand()} ` : ''}END`,
  () => `IF(${operand()}, ${operand()}, ${operand()})`,
  () => `IFNULL(${operand()}, ${operand()})`,
  () => `COALESCE(${Array.from({ length: int(2, 3) }, operand).join(', ')})`,
  () => `NULLIF(${operand()}, ${operand()})`,
  () => `${operand()} ${pick(['AND', 'OR', 'XOR'])} ${operand()}`,
  () => `NOT ${operand()}`,
]

export function generateCase() {
  const out = [{ sql: SETUP }, ...seeds().map((sql) => ({ sql }))]
  for (let i = int(4, 8); i > 0; i--) {
    const items = Array.from({ length: int(1, 3) }, () => pick(EXPRESSIONS)())
    // A comparison in the WHERE as well as in the select list: the rows it keeps are its value too.
    const where = chance(0.25) ? ` WHERE ${operand()} ${pick(COMPARE)} ${operand()}` : ''
    out.push({ sql: `SELECT ${items.join(', ')} FROM co${where} ORDER BY id`, select: true, ordered: true })
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
  const file = join(OUT_DIR, 'coercion.json')
  const head = {
    name: 'coercion',
    note:
      'M5.2: generated comparisons, arithmetic, BETWEEN, IN and the CASE/IF/IFNULL/COALESCE/NULLIF family over a column of nearly every type and over ' +
      'literals written every way MySQL reads one, run on a real MySQL through mysql2, each SELECT through both protocols with its metadata and warning count.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`coercion -> ${file}`)
}
