#!/usr/bin/env node
// M5.10's instrument for the rest of the string, numeric, hashing and network
// functions, captured from a real MySQL before the functions are written, as
// the other slices were (`capture-functions.mjs`, `capture-temporal-functions.mjs`).
//
// Each case is a small table, `fm`, of what these functions meet — a utf8mb4
// and a latin1 VARCHAR, a VARBINARY, a signed and an unsigned BIGINT, a
// DECIMAL, a DOUBLE and a VARCHAR of addresses and UUIDs — wide enough to
// take two length bytes, which changes how it reads as a number — with NULLs
// among the rows, and SELECTs of calls over its columns and over literals. Every
// SELECT runs through both protocols, its metadata and warning count kept.
//
// The functions: CHAR (and its USING), FIELD, ELT, MAKE_SET, EXPORT_SET,
// FIND_IN_SET, INSERT, SUBSTRING_INDEX, QUOTE, SOUNDEX, FORMAT, BIT_LENGTH,
// CONV, TO_BASE64, FROM_BASE64, ORD, MD5, SHA1, SHA, SHA2, CRC32; PI, POW,
// POWER, SQRT, EXP, LN, LOG, LOG2, LOG10, SIN, COS, TAN, ASIN, ACOS, ATAN,
// ATAN2, COT, DEGREES, RADIANS, BIT_COUNT; ISNULL, INTERVAL, INET_ATON,
// INET_NTOA, INET6_ATON, INET6_NTOA, IS_IPV4, IS_IPV6, IS_IPV4_COMPAT,
// IS_IPV4_MAPPED, IS_UUID, UUID_TO_BIN and BIN_TO_UUID.
//
// Usage:
//   node tools/capture-more-functions.mjs --host 127.0.0.1 --port 3306 --user root --password root
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
const SEED = Number(arg('seed', '20261010'))
export { CONNECTION, SQL_MODE }

/** xorshift32, seeded (`tools/lib/cli.mjs`), so a seed reproduces the corpus. */
const { rnd, pick, chance, int } = xorshift(SEED)
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

const SETUP = 'CREATE TABLE fm (id INT NOT NULL PRIMARY KEY, s VARCHAR(30), l VARCHAR(20) CHARACTER SET latin1, b VARBINARY(20), n BIGINT, u BIGINT UNSIGNED, d DECIMAL(12,4), f DOUBLE, a VARCHAR(70))'

const TEXTS = ['abc', 'a,b,c', '', 'Hello World', 'zoë', 'a😀b', "it's", 'x\\y', 'b', 'c', 'Robert', 'Tymczak', 'Ashcraft', '12', '-3.5', 'QUJD', 'YWJj', 'not base64!', 'www.mysql.com', 'a.b.c.d']
const LATIN = ['abc', 'café', '', 'b,a', 'Zoë']
const NUMS = ['0', '1', '-1', '2', '3', '5', '7', '10', '16', '36', '255', '-255', '65', '1.5', '-2.5', '0.5', '1e2', '3.14159', '18446744073709551615', '-9223372036854775808', '9223372036854775807', '100000', '1234567.891']
const ADDRESSES = ['127.0.0.1', '10.0.5.9', '255.255.255.255', '1.2.3', '256.1.1.1', '::1', '::', 'fdfe::5a55:caff:fefa:9089', '::ffff:10.0.5.9', '::10.0.5.9', 'abc', '', '6ccd780c-baba-1026-9564-5b8c656024db', '6CCD780CBABA102695645B8C656024DB', '{6ccd780c-baba-1026-9564-5b8c656024db}', '6ccd780c-baba-1026-9564-5b8c656024dZ']

function value(column) {
  if (chance(0.12)) return 'NULL'
  switch (column) {
    case 's':
      return quote(pick(TEXTS))
    case 'l':
      return quote(pick(LATIN))
    case 'b':
      return pick(["X'00FF'", "X'616263'", "''", "X'C3A9'", "'ab'", "X'0A000509'", "X'00000000000000000000FFFF0A000509'"])
    case 'n':
      return pick(['0', '1', '-1', '5', '7', '16', '255', '-65', '167773449', '9223372036854775807'])
    case 'u':
      return pick(['0', '1', '3', '5', '255', '65535', '18446744073709551615'])
    case 'd':
      return pick(['1.5000', '-2.2500', '0.0000', '123.4560', '-0.5010', '7'])
    case 'f':
      return pick(['1.5e0', '-0.25e0', '2.5e0', '1e10', '-3.5e0', '0.1e0', '0e0'])
    case 'a':
      return quote(pick(ADDRESSES))
    default:
      throw new Error(column)
  }
}

function seeds() {
  return Array.from({ length: int(2, 5) }, (_, k) => `INSERT INTO fm VALUES (${k + 1}, ${['s', 'l', 'b', 'n', 'u', 'd', 'f', 'a'].map(value).join(', ')})`)
}

const text = () => pick([() => pick(['s', 'l', 'b', 'a']), () => quote(pick(TEXTS)), () => pick(['NULL', '123', '-4.5', "X'616263'", "_latin1'café'"])])()
const num = () => pick([() => pick(['n', 'u', 'd', 'f', 'id', 's', 'a', 'b']), () => pick(NUMS), () => pick(['NULL', "'2'", "'3x'", "'abc'", "''"])])()
const small = () => pick([() => String(int(-3, 6)), () => pick(['n', 'id', 'NULL', "'2'", '1.5', '2.5', '0', '64', '18446744073709551615'])])()
const list = (f, lo, hi) => Array.from({ length: int(lo, hi) }, f).join(', ')
const addr = () => (chance(0.5) ? 'a' : quote(pick(ADDRESSES)))

const CALLS = [
  () => `HEX(CHAR(${list(num, 1, 3)}))`,
  () => `CHAR(${list(() => pick(['65', '66', '0xC3', '0xA9', '195', '169', 'n', '256', '-1']), 1, 3)} USING ${pick(['utf8mb4', 'latin1', 'binary', 'ascii'])})`,
  () => `CHAR(${list(num, 1, 2)})`,
  () => `FIELD(${list(() => (chance(0.5) ? text() : num()), 2, 4)})`,
  () => `ELT(${small()}, ${list(text, 1, 3)})`,
  () => `MAKE_SET(${num()}, ${list(text, 1, 4)})`,
  () => `EXPORT_SET(${num()}, ${text()}, ${text()}${chance(0.5) ? `, ${text()}` : ''}${chance(0.4) ? `, ${small()}` : ''})`,
  () => `FIND_IN_SET(${text()}, ${pick(["'a,b,c'", "'b'", "''", 's', "'x,,y'", "'abc,b'"])})`,
  () => `INSERT(${text()}, ${small()}, ${small()}, ${text()})`,
  () => `SUBSTRING_INDEX(${text()}, ${pick(["','", "'.'", "'b'", "''", "'ab'", 'l'])}, ${small()})`,
  () => `QUOTE(${text()})`,
  () => `SOUNDEX(${text()})`,
  () => `FORMAT(${num()}, ${small()})`,
  () => `FORMAT(${num()}, ${small()}, ${pick(["'de_DE'", "'en_US'", "'xx'", "'fr_FR'", 'NULL'])})`,
  () => `BIT_LENGTH(${text()})`,
  () => `CONV(${pick([num, text])()}, ${pick(['10', '16', '2', '36', '-10', '1', '37', 'n'])}, ${pick(['2', '16', '-16', '10', '36', '-2', '0'])})`,
  () => `TO_BASE64(${text()})`,
  () => `FROM_BASE64(${text()})`,
  () => `ORD(${text()})`,
  () => `${pick(['MD5', 'SHA1', 'SHA', 'CRC32'])}(${text()})`,
  () => `SHA2(${text()}, ${pick(['0', '224', '256', '384', '512', '1', 'NULL'])})`,
  () => `PI()`,
  () => `${pick(['POW', 'POWER', 'ATAN2'])}(${num()}, ${num()})`,
  () => `${pick(['SQRT', 'EXP', 'LN', 'LOG', 'LOG2', 'LOG10', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'COT', 'DEGREES', 'RADIANS', 'BIT_COUNT'])}(${num()})`,
  () => `${pick(['LOG', 'ATAN'])}(${num()}, ${num()})`,
  () => `ISNULL(${pick([num, text])()})`,
  () => `INTERVAL(${list(num, 2, 5)})`,
  () => `INET_ATON(${addr()})`,
  () => `INET_NTOA(${num()})`,
  () => `HEX(INET6_ATON(${addr()}))`,
  () => `INET6_NTOA(${pick(['b', 'INET6_ATON(a)', "UNHEX('0A000509')", "UNHEX('FDFE0000000000005A55CAFFFEFA9089')", "'abc'", 'NULL'])})`,
  () => `${pick(['IS_IPV4', 'IS_IPV6', 'IS_UUID'])}(${addr()})`,
  () => `${pick(['IS_IPV4_COMPAT', 'IS_IPV4_MAPPED'])}(${pick(['INET6_ATON(a)', 'b', "INET6_ATON('::10.0.5.9')", "INET6_ATON('::ffff:10.0.5.9')", 'NULL'])})`,
  () => `HEX(UUID_TO_BIN(${addr()}${chance(0.4) ? `, ${pick(['0', '1'])}` : ''}))`,
  () => `BIN_TO_UUID(${pick(["UNHEX('6CCD780CBABA102695645B8C656024DB')", 'UUID_TO_BIN(a)', "UNHEX('00')", 'NULL'])}${chance(0.4) ? `, ${pick(['0', '1'])}` : ''})`,
]

export function generateCase() {
  const out = [{ sql: SETUP }, ...seeds().map((sql) => ({ sql }))]
  for (let i = int(4, 8); i > 0; i--) {
    const calls = Array.from({ length: int(1, 3) }, () => pick(CALLS)())
    out.push({ sql: `SELECT ${calls.join(', ')} FROM fm ORDER BY id`, select: true, ordered: true })
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
  const file = join(OUT_DIR, 'more-functions.json')
  const head = {
    name: 'more-functions',
    note:
      'M5.10: generated calls of the remaining string, numeric, hashing and network functions over a table of the types they meet and over literals, ' +
      'run on a real MySQL through mysql2, each SELECT through both protocols with its metadata and warning count.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`more-functions -> ${file}`)
}
