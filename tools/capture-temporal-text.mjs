#!/usr/bin/env node
// Text into temporal columns, captured from a real MySQL: the instrument for
// `temporal-scan.ts`, MySQL's `str_to_datetime` and `str_to_time` read anew.
//
// Each case is one table with a DATE, a DATETIME(3), a TIME(2) and a TIMESTAMP
// column, and generated strings stored into one of them each — digit groups
// of every width, every delimiter and too many, spaces, 'T', fractions of up
// to eight digits, time zone displacements, junk — strictly or under IGNORE,
// in the default sql_mode or none. Every INSERT is followed by SHOW WARNINGS,
// so a value's every warning, note and deprecation is compared by text, and
// the case ends with the rows as stored.
//
// Usage:
//   node tools/capture-temporal-text.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
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
const CASES = Number(arg('cases', '8'))
const PER_CASE = Number(arg('values', '150'))
const SEED = Number(arg('seed', '20261008'))
export const SCHEMA = 'temporal_text'

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
const digits = (n) => Array.from({ length: n }, () => String(int(0, 9))).join('')

function part() {
  if (chance(0.6)) return digits(pick([1, 2, 2, 2, 4]))
  if (chance(0.5)) return pick(['00', '0', '01', '12', '13', '29', '30', '31', '59', '60', '69', '70', '99', '2020', '1999', '0000'])
  return digits(pick([3, 5, 6, 8]))
}

function text() {
  const r = rnd()
  if (r < 0.2) {
    let s = pick([digits(6), digits(8), digits(12), digits(14), digits(int(1, 16)), '20200102', '200102', '20200102103000', '20200102T103000'])
    if (chance(0.3)) s += `.${digits(int(1, 8))}`
    return s
  }
  if (r < 0.35) {
    let s = Array.from({ length: int(1, 3) }, () => digits(pick([1, 2, 2, 3]))).join(':')
    if (chance(0.3)) s = `${digits(1)} ${s}`
    if (chance(0.3)) s = `-${s}`
    if (chance(0.3)) s += `.${digits(int(1, 7))}`
    return s
  }
  let s = part()
  for (let i = int(1, 7) - 1; i > 0; i--) s += pick(['-', '-', '-', ':', '/', '.', ' ', 'T', '  ', '--', '\t', ',', '_']) + part()
  if (chance(0.2)) s += `.${digits(int(0, 8))}`
  if (chance(0.1)) s += pick(['+01:00', '-05:30', '+14:01', 'x', ' ', '  ', 'Z', ' 1'])
  if (chance(0.1)) s = pick([' ', '  ', '\t']) + s
  return s
}

/** The boundaries a random draw rarely lands on, stored into every column in every case. */
const EDGES = ['69-01-01', '70-01-01', '69-12-31 23:59:59', '0000-00-00', '0000-00-00 00:00:00', '2020-00-01', '2020-01-00', '2020-02-29', '2019-02-29', '2020-04-31', '1970-01-01 00:00:01', '2038-01-19 03:14:08', '9999-12-31 23:59:59.9999995', '2020-01-02T10:20:30', '20200102T102030', '2020-01-02 10:20:30+01:00', '2020-01-02 10:20:30.1234567', '838:59:59', '-838:59:59', '839:00:00', '838:59:59.5', '1 10:00', '10:00:00.5', '235959', '10.5', '', ' ', '00-00-00', '1-1-1', '99-12-31', '2020--01-02', '2020-01-02  10:00:00', '2020/01/02', '2020-01-02 10.20.30', '2020-01-02 10:20:30 ']

export function generateCase(n) {
  const out = []
  if (n % 2 === 1) out.push("SET sql_mode = ''")
  out.push('CREATE TABLE g (id INT PRIMARY KEY, d DATE, dt DATETIME(3), tm TIME(2), ts TIMESTAMP NULL)')
  const insert = (i, value, column, ignore) => {
    const quoted = value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\t/g, '\\t')
    out.push(`INSERT ${ignore ? 'IGNORE ' : ''}INTO g (id, ${column}) VALUES (${i}, '${quoted}')`)
    out.push('SHOW WARNINGS')
  }
  for (let i = 0; i < PER_CASE; i++) insert(i, text(), pick(['d', 'dt', 'tm', 'ts']), chance(0.5))
  if (n < 4) EDGES.forEach((value, k) => insert(PER_CASE + k, value, ['d', 'dt', 'tm', 'ts'][n], n % 2 === 0))
  out.push('SELECT id, d, dt, tm, ts FROM g ORDER BY id')
  return out
}

/** One statement's outcome: its rows as text, or its counts, or its error. */
export async function outcome(conn, sql) {
  try {
    const [r] = await conn.query({ sql, rowsAsArray: true, dateStrings: true })
    if (Array.isArray(r)) return { rows: r.map((row) => row.map((v) => (v === null ? null : String(v)))) }
    return { ok: [r.affectedRows, r.warningStatus] }
  } catch (e) {
    if (e.errno === undefined) throw e
    return { error: [e.errno, e.message] }
  }
}

export async function runCase(conn, statements) {
  await conn.query(`DROP DATABASE IF EXISTS ${SCHEMA}`)
  await conn.query(`CREATE DATABASE ${SCHEMA}`)
  await conn.query(`USE ${SCHEMA}`)
  await conn.query('SET sql_mode = DEFAULT')
  const out = []
  for (const sql of statements) out.push({ sql, ...(await outcome(conn, sql)) })
  return out
}

if (isMain(import.meta.url)) {
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD })
  const [[{ v: version }]] = await conn.query('SELECT VERSION() AS v')
  const cases = []
  for (let n = 0; n < CASES; n++) cases.push(await runCase(conn, generateCase(n)))
  await conn.query(`DROP DATABASE IF EXISTS ${SCHEMA}`)
  await conn.end()
  const statements = cases.flat()
  const errors = statements.filter((s) => s.error !== undefined).length
  console.log(`${cases.length} cases, ${statements.length} statements, ${errors} errors`)
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, 'temporal-text.json')
  const head = {
    name: 'temporal-text',
    note: 'Generated text stored into DATE, DATETIME(3), TIME(2) and TIMESTAMP columns, strictly and under IGNORE, in the default sql_mode and in none, each INSERT followed by SHOW WARNINGS and each case by its rows, run on a real MySQL through mysql2.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`temporal-text -> ${file}`)
}
