#!/usr/bin/env node
// M5.10's instrument for the date and time functions, captured from a real
// MySQL before the functions are written, as the string and numeric slices
// were (`capture-functions.mjs`).
//
// Each case is a small table, `tf`, of what these functions meet — a DATE, a
// DATETIME(3), a TIMESTAMP(2), a TIME(1), a YEAR, a VARCHAR of dates and
// times and junk, a BIGINT and a DECIMAL of numbers that read as dates —
// with NULLs and zero dates among the rows, and SELECTs of calls over its
// columns and over literals. Every SELECT runs through both protocols, its
// metadata and warning count kept. The session's time zone is UTC, so
// UNIX_TIMESTAMP and FROM_UNIXTIME do not depend on the capturing machine.
//
// The functions: DATE, TIME, TIMESTAMP, YEAR, MONTH, DAY, DAYOFMONTH, HOUR,
// MINUTE, SECOND, MICROSECOND, DAYOFWEEK, DAYOFYEAR, WEEK, WEEKDAY,
// YEARWEEK, QUARTER, DAYNAME, MONTHNAME, LAST_DAY, DATE_FORMAT, TIME_FORMAT,
// STR_TO_DATE, UNIX_TIMESTAMP, FROM_UNIXTIME, DATEDIFF, TIMEDIFF,
// TIMESTAMPDIFF, TIMESTAMPADD, ADDTIME, SUBTIME, MAKEDATE, MAKETIME,
// SEC_TO_TIME, TIME_TO_SEC, TO_DAYS, FROM_DAYS, TO_SECONDS, PERIOD_ADD,
// PERIOD_DIFF, EXTRACT, GET_FORMAT and CONVERT_TZ between offsets.
//
// Usage:
//   node tools/capture-temporal-functions.mjs --host 127.0.0.1 --port 3306 --user root --password root
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
const SEED = Number(arg('seed', '20261009'))
export { CONNECTION, SQL_MODE }

/** xorshift32, seeded (`tools/lib/cli.mjs`), so a seed reproduces the corpus. */
const { rnd, pick, chance, int } = xorshift(SEED)
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

const SETUP = 'CREATE TABLE tf (id INT NOT NULL PRIMARY KEY, d DATE, dt DATETIME(3), ts TIMESTAMP(2) NULL, tm TIME(1), y YEAR, s VARCHAR(40), n BIGINT, x DECIMAL(20,6))'

const DATES = ['2020-02-29', '1999-12-31', '2021-01-03', '1970-01-01', '9999-12-31', '0001-01-01', '0000-00-00', '2020-00-15', '2024-12-30', '2008-01-01']
const DATETIMES = ['2020-02-29 13:14:15.123', '1999-12-31 23:59:59.999', '2021-01-03 00:00:00', '0000-00-00 00:00:00', '1970-01-01 00:00:01', '2038-01-19 03:14:07.500', '2024-12-30 12:00:00.001', '0001-01-01 00:00:00']
const STAMPS = ['2020-02-29 13:14:15.12', '1970-01-01 00:00:01', '2038-01-19 03:14:07.99', '2000-06-15 08:30:00']
const TIMES = ['13:14:15.1', '-01:02:03.5', '838:59:59', '00:00:00', '25:00:00', '-838:59:59', '00:00:00.9', '12:00:00']
const YEARS = ['2020', '1999', '0', '2155', '1901', '70']
const TEXTS = ['2020-02-29', '2020-02-29 13:14:15', '13:14:15', 'abc', '', '20200229', '2020-13-01', '99-1-1', '2020-02-29 13:14:15.123456', '0000-00-00', '12:34', '1 2:03:04', '2020-02-29T13:14:15', '1582934400', '-1', '+05:30', 'Sunday', '%Y-%m-%d']
const NUMBERS = ['20200229', '20200229131415', '131415', '0', '-1', '99991231', '1', '202002', '365', '86400', '1582934400', '738000', '3', '53', '200012', '-200', '2147483648']
const DECIMALS = ['20200229131415.5', '131415.25', '1582934400.123456', '-1.5', '0.000001', '738000.75']

function value(column) {
  if (chance(0.12)) return 'NULL'
  switch (column) {
    case 'd':
      return quote(pick(DATES))
    case 'dt':
      return quote(pick(DATETIMES))
    case 'ts':
      return quote(pick(STAMPS))
    case 'tm':
      return quote(pick(TIMES))
    case 'y':
      return pick(YEARS)
    case 's':
      return quote(pick(TEXTS))
    case 'n':
      return pick(NUMBERS)
    case 'x':
      return pick(DECIMALS)
    default:
      throw new Error(column)
  }
}

function seeds() {
  return Array.from({ length: int(2, 5) }, (_, k) => `INSERT INTO tf VALUES (${k + 1}, ${['d', 'dt', 'ts', 'tm', 'y', 's', 'n', 'x'].map(value).join(', ')})`)
}

// --- operands -------------------------------------------------------------------

/**
 * Anything a date function may be handed but a TIME, which MySQL puts on
 * today's date there: the corpus would then answer differently each day.
 */
const temporal = () =>
  pick([
    () => pick(['d', 'dt', 'ts', 'dt', 'd', 'ts']),
    () => pick(['s', 'n', 'x', 'y']),
    () => quote(pick([...DATES, ...DATETIMES, ...TEXTS])),
    () => pick([`DATE'2020-02-29'`, `TIMESTAMP'2020-02-29 13:14:15.5'`, 'NULL', '20200229', '20200229131415.25', '0', '-5', "'2020-02-29'"]),
  ])()

/** What a time function may be handed: a TIME too, and times as text and numbers. */
const timeish = () => (chance(0.4) ? pick(['tm', `TIME'10:11:12'`, `TIME'-838:59:59'`, "'10:11:12.5'", "'-1 02:03:04'", '101112', '101112.5', "'99:00:00'", "'1:2:3'"]) : temporal())

/** A count, an offset or a day number. */
const number = () => pick([() => String(int(-3, 60)), () => pick(['n', 'x', 'y', 'NULL', "'7'", "'abc'", '1.5', '-1', '0', '366', '738000', '1582934400', '18446744073709551615', '200012', '202002'])])()

const UNITS = ['MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']
const EXTRACT_UNITS = [...UNITS, 'YEAR_MONTH', 'DAY_HOUR', 'DAY_MINUTE', 'DAY_SECOND', 'DAY_MICROSECOND', 'HOUR_MINUTE', 'HOUR_SECOND', 'HOUR_MICROSECOND', 'MINUTE_SECOND', 'MINUTE_MICROSECOND', 'SECOND_MICROSECOND']
const FORMATS = ['%Y-%m-%d', '%a %b %e %D %j', '%H:%i:%s.%f', '%h %I %l %p %r %T', '%U %u %V %v %X %x %W %w', '%c %M %y', '%k %S %%', '%Q %z x', '', '%d/%m/%Y', '%Y%m%d%H%i%s', '%e.%c.%Y']
const PARSES = [
  ["'2020-02-29'", "'%Y-%m-%d'"],
  ["'29/02/2020 13:14'", "'%d/%m/%Y %H:%i'"],
  ["'Feb 29 2020'", "'%b %d %Y'"],
  ["'13:14:15'", "'%H:%i:%s'"],
  ["'2020'", "'%Y'"],
  ["'abc'", "'%Y'"],
  ["'2020-02-30'", "'%Y-%m-%d'"],
  ["'1:02 PM'", "'%l:%i %p'"],
  ["'200229'", "'%y%m%d'"],
  ["'2020-02-29 13:14:15.5'", "'%Y-%m-%d %H:%i:%s.%f'"],
  ["'February 29, 2020'", "'%M %e, %Y'"],
  ["'2020 60'", "'%Y %j'"],
  ["'9'", "'%m'"],
  ["s", "'%Y-%m-%d'"],
  ["s", "'%H:%i:%s'"],
  ["'2020-02-29 junk'", "'%Y-%m-%d'"],
  ["'13'", "'%H'"],
]

const CALLS = [
  ...['DATE', 'YEAR', 'MONTH', 'DAY', 'DAYOFMONTH', 'DAYOFWEEK', 'DAYOFYEAR', 'WEEKDAY', 'QUARTER', 'DAYNAME', 'MONTHNAME', 'LAST_DAY', 'TO_DAYS', 'TO_SECONDS', 'TIMESTAMP', 'UNIX_TIMESTAMP'].map((f) => () => `${f}(${temporal()})`),
  ...['TIME', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'TIME_TO_SEC'].map((f) => () => `${f}(${timeish()})`),
  () => `WEEK(${temporal()})`,
  () => `WEEK(${temporal()}, ${pick(['0', '1', '2', '3', '4', '5', '6', '7', '8', '-1', 'NULL', 'n'])})`,
  () => `YEARWEEK(${temporal()})`,
  () => `YEARWEEK(${temporal()}, ${pick(['0', '1', '2', '3', '4', '5', '6', '7'])})`,
  () => `DATE_FORMAT(${temporal()}, ${chance(0.9) ? quote(pick(FORMATS)) : pick(['s', 'NULL'])})`,
  () => `TIME_FORMAT(${timeish()}, ${quote(pick(FORMATS))})`,
  () => {
    const [s, f] = pick(PARSES)
    return `STR_TO_DATE(${s}, ${f})`
  },
  () => `FROM_UNIXTIME(${number()})`,
  () => `FROM_UNIXTIME(${number()}, ${quote(pick(FORMATS))})`,
  () => `DATEDIFF(${temporal()}, ${temporal()})`,
  () => `TIMEDIFF(${timeish()}, ${timeish()})`,
  () => `TIMESTAMPDIFF(${pick(UNITS)}, ${temporal()}, ${temporal()})`,
  () => `TIMESTAMPADD(${pick(UNITS)}, ${number()}, ${temporal()})`,
  () => `ADDTIME(${timeish()}, ${timeish()})`,
  () => `SUBTIME(${timeish()}, ${timeish()})`,
  () => `TIMESTAMP(${temporal()}, ${temporal()})`,
  () => `MAKEDATE(${number()}, ${number()})`,
  () => `MAKETIME(${number()}, ${number()}, ${pick(['0', '30', '59', '60', '1.5', 'x', 'NULL', '-1'])})`,
  () => `SEC_TO_TIME(${number()})`,
  () => `FROM_DAYS(${number()})`,
  () => `PERIOD_ADD(${number()}, ${number()})`,
  () => `PERIOD_DIFF(${number()}, ${number()})`,
  () => `EXTRACT(${pick(EXTRACT_UNITS)} FROM ${temporal()})`,
  () => `EXTRACT(${pick(['HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'HOUR_MINUTE', 'HOUR_SECOND', 'HOUR_MICROSECOND', 'MINUTE_SECOND', 'MINUTE_MICROSECOND', 'SECOND_MICROSECOND'])} FROM ${timeish()})`,
  () => `GET_FORMAT(${pick(['DATE', 'TIME', 'DATETIME', 'TIMESTAMP'])}, ${quote(pick(['ISO', 'EUR', 'USA', 'JIS', 'INTERNAL', 'xyz']))})`,
  () => `CONVERT_TZ(${temporal()}, ${quote(pick(['+00:00', '+05:30', '-08:00', '+14:00', '+13:59', '+14:01']))}, ${quote(pick(['+00:00', '+01:00', '-12:59', '+10:00']))})`,
]

export function generateCase() {
  const out = [{ sql: "SET time_zone = '+00:00'" }, { sql: SETUP }, ...seeds().map((sql) => ({ sql }))]
  for (let i = int(4, 8); i > 0; i--) {
    const calls = Array.from({ length: int(1, 3) }, () => pick(CALLS)())
    out.push({ sql: `SELECT ${calls.join(', ')} FROM tf ORDER BY id`, select: true, ordered: true })
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
  const file = join(OUT_DIR, 'temporal-functions.json')
  const head = {
    name: 'temporal-functions',
    note:
      'M5.10: generated calls of the date and time functions over a table of every temporal type, text and numbers that read as dates, ' +
      'and over literals, run on a real MySQL in UTC through mysql2, each SELECT through both protocols with its metadata and warning count.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`temporal-functions -> ${file}`)
}
