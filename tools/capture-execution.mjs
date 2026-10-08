#!/usr/bin/env node
// M5.17 — capture execution vectors from a real MySQL.
//
// M3.2 and M3.16 put the parser's grouping in front of a server. This puts the
// executor there: what a statement *returns*, which is where an executor is
// wrong while looking right. Doc 43 §2 names what to compare, in order —
// the rows and their order, the column metadata, the counters, the error
// number — and every one of those is recorded here, from the server, through
// the same driver the replay uses (`mysql2`), so the two sides differ only in
// what is behind the connection.
//
// Each case is a script run in a fresh database: a table, seeded rows, a few
// generated statements, and a final ordered SELECT of the whole table, so a
// write that did the wrong thing is caught by the state it leaves even when
// its own result looks right.
//
// Order is a fact only where a query fixes it. A SELECT here always has a
// total ORDER BY (the primary key last) unless it reads by primary key alone,
// where the order is the key's on any plan; LIMIT and DISTINCT only appear with
// one. Which index MySQL picks for an unordered range is a cost decision this
// corpus does not test (M5.7's).
//
// Usage:
//   node tools/capture-execution.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const HOST = arg('host', '127.0.0.1')
const PORT = Number(arg('port', '3306'))
const USER = arg('user', 'root')
const PASSWORD = arg('password', 'root')
const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)
const CASES = Number(arg("cases", "240"))
const SEED = Number(arg('seed', '20261008'))
export const SCHEMA = 'myjs_exec'
/** The session the replay runs in too: the mode is pinned, not inherited from a server's defaults. */
export const SQL_MODE = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'

/** xorshift32 — the generator every corpus tool here uses, so a seed reproduces. */
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

// --- the tables -----------------------------------------------------------------

const NAMES = ['ann', 'Bob', 'cy', 'ÄNNA', 'dee', 'b', 'B2', 'zoë', 'al', 'éva', 'x y']

/**
 * Four shapes, each there for a reason: an AUTO_INCREMENT key with a UNIQUE
 * text column and nullable numbers; a *text* primary key under the default
 * accent- and case-insensitive collation; a table with no key at all, ordered
 * by its hidden row id; and a latin1 table, ordered by a legacy 8-bit
 * collation's weights.
 */
const TABLES = [
  {
    name: 'p',
    pk: 'id',
    ddl: 'CREATE TABLE p (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(12) NOT NULL, age INT, score DECIMAL(6,2), flag TINYINT UNSIGNED, born DATE, seen DATETIME, UNIQUE KEY (name), KEY (age))',
    columns: { id: 'int', name: 'text', age: 'int', score: 'dec', flag: 'uint', born: 'date', seen: 'datetime' },
    row: (i) => ({
      name: `'${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}'`,
      age: chance(0.2) ? 'NULL' : String(int(0, 90)),
      score: chance(0.2) ? 'NULL' : `${int(-99, 999)}.${String(int(0, 99)).padStart(2, '0')}`,
      flag: String(int(0, 255)),
      born: chance(0.3) ? 'NULL' : `'${int(1950, 2024)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}'`,
      seen: chance(0.3) ? 'NULL' : `'2024-0${int(1, 9)}-1${int(0, 9)} ${String(int(0, 23)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00'`,
    }),
  },
  {
    name: 'k',
    pk: 'code',
    ddl: 'CREATE TABLE k (code VARCHAR(8) NOT NULL PRIMARY KEY, qty BIGINT, ratio DOUBLE, tag CHAR(4), raw VARBINARY(6))',
    columns: { code: 'text', qty: 'int', ratio: 'double', tag: 'text', raw: 'bytes' },
    row: (i) => ({
      code: `'${['a', 'B', 'c', 'Ä', 'e', 'f'][i % 6]}${Math.floor(i / 6)}'`,
      qty: chance(0.2) ? 'NULL' : String(int(-100000, 100000)),
      ratio: chance(0.2) ? 'NULL' : `${int(-50, 50)}.${int(0, 9)}e${int(-2, 2)}`,
      tag: chance(0.2) ? 'NULL' : `'${pick(['x', 'xy ', 'Xy', 'z', ''])}'`,
      raw: chance(0.3) ? 'NULL' : `0x${int(0, 0xffffff).toString(16).padStart(6, '0')}`,
    }),
  },
  {
    name: 'h',
    pk: null,
    ddl: 'CREATE TABLE h (a INT, b VARCHAR(10))',
    columns: { a: 'int', b: 'text' },
    row: () => ({ a: chance(0.2) ? 'NULL' : String(int(-5, 5)), b: chance(0.2) ? 'NULL' : `'${pick(NAMES)}'` }),
  },
  {
    name: 'l',
    pk: 'n',
    ddl: 'CREATE TABLE l (n INT NOT NULL PRIMARY KEY, s VARCHAR(10) CHARACTER SET latin1, t VARCHAR(10) COLLATE utf8mb4_bin)',
    columns: { n: 'int', s: 'text', t: 'text' },
    row: (i) => ({ n: String(i * 3 + 1), s: chance(0.2) ? 'NULL' : `'${pick(NAMES)}'`, t: chance(0.2) ? 'NULL' : `'${pick(NAMES)}'` }),
  },
]

// --- expressions ------------------------------------------------------------------

const literalFor = (kind) => {
  switch (kind) {
    case 'int':
    case 'uint':
      return pick([String(int(-5, 95)), String(int(0, 9)), `'${int(0, 50)}'`, `${int(0, 9)}.5`])
    case 'dec':
      return pick([String(int(-50, 500)), `${int(-50, 500)}.25`, `'${int(0, 99)}'`])
    case 'double':
      return pick([String(int(-50, 50)), `${int(-5, 5)}e0`, `${int(0, 9)}.5`])
    case 'date':
      return pick([`'${int(1950, 2024)}-0${int(1, 9)}-15'`, `'${int(1990, 2010)}-06-01'`])
    case 'datetime':
      return pick([`'2024-0${int(1, 9)}-15 12:00:00'`, `'2024-05-01'`])
    case 'bytes':
      return pick([`0x${int(0, 0xffffff).toString(16).padStart(6, '0')}`, `'a'`])
    default:
      return pick([`'${pick(NAMES)}'`, `'${pick(['a', 'B', 'z', 'é'])}'`, `'${pick(['x', 'xy', 'XY '])}'`])
  }
}

/** A predicate over one table: comparisons, IS NULL, IN, BETWEEN, LIKE, combined with AND / OR / NOT. */
function predicate(t, depth = 0) {
  const cols = Object.keys(t.columns)
  const c = pick(cols)
  const kind = t.columns[c]
  const lit = () => literalFor(kind)
  let p
  switch (int(0, 6)) {
    case 0:
      p = `${c} IS ${pick(['', 'NOT '])}NULL`
      break
    case 1:
      p = `${c} ${pick(['', 'NOT '])}IN (${[lit(), lit(), lit()].join(', ')})`
      break
    case 2:
      p = kind === 'text' ? `${c} ${pick(['', 'NOT '])}LIKE '${pick(['a%', '%b%', '_', 'B%', '%', 'x_'])}'` : `${c} BETWEEN ${lit()} AND ${lit()}`
      break
    default:
      p = `${c} ${pick(['=', '<', '<=', '>', '>=', '<>', '<=>'])} ${lit()}`
  }
  if (depth < 2 && chance(0.35)) p = `${p} ${pick(['AND', 'OR'])} ${predicate(t, depth + 1)}`
  if (chance(0.1)) p = `NOT (${p})`
  return p
}

/** A select-list expression over one table. */
function expression(t) {
  const cols = Object.keys(t.columns)
  const of = (kind) => cols.filter((c) => t.columns[c] === kind)
  const numeric = [...of('int'), ...of('uint'), ...of('dec'), ...of('double')]
  const text = of('text')
  const n = () => pick(numeric.length > 0 ? numeric : ['1'])
  const s = () => pick(text.length > 0 ? text : ["'q'"])
  return pick([
    () => pick(cols),
    () => `${n()} + ${int(-3, 9)}`,
    () => `${n()} - ${n()}`,
    () => `${n()} * ${pick(['2', '1.5', '-1', n()])}`,
    () => `${n()} / ${pick(['3', '2.0', '0', n()])}`,
    () => `${n()} DIV ${pick(['2', '-3', '0'])}`,
    () => `${n()} % ${pick(['3', '-2', '0'])}`,
    () => `-${n()}`,
    () => `${n()} ${pick(['=', '<', '>', '<=>'])} ${pick(['1', "'1'", n()])}`,
    () => `${pick(cols)} IS NULL`,
    () => `COALESCE(${n()}, ${pick(['0', "'none'", '1.5'])})`,
    () => `IFNULL(${s()}, '-')`,
    () => `IF(${n()} > ${int(0, 50)}, ${pick(["'big'", '1', '2.5'])}, ${pick(["'small'", '0', 'NULL'])})`,
    () => `CASE WHEN ${n()} < 10 THEN 'low' WHEN ${n()} < 50 THEN 'mid' ELSE 'high' END`,
    () => `CONCAT(${s()}, '-', ${pick(cols)})`,
    () => `UPPER(${s()})`,
    () => `LOWER(${s()})`,
    () => `LENGTH(${s()})`,
    () => `CHAR_LENGTH(${s()})`,
    () => `${s()} LIKE '${pick(['a%', '%B', '_%'])}'`,
    () => `${n()} BETWEEN 1 AND 50`,
    () => `CAST(${n()} AS CHAR)`,
    () => `CAST(${pick(cols)} AS SIGNED)`,
    () => `NULLIF(${n()}, ${int(0, 5)})`,
    () => `ABS(${n()})`,
    () => `${int(1, 9)}`,
    () => `'lit'`,
    () => `${int(1, 9)}.${int(0, 99)}`,
  ])()
}

function selectStatement(t) {
  const cols = Object.keys(t.columns)
  const items = chance(0.25) ? ['*'] : Array.from({ length: int(1, 4) }, () => expression(t)).map((e, i) => (chance(0.2) ? `${e} AS e${i}` : e))
  const where = chance(0.75) ? ` WHERE ${predicate(t)}` : ''
  const tiebreak = t.pk ?? cols.join(', ')
  if (t.pk !== null && chance(0.15)) {
    // By primary key alone, every column: the order is the key's on any plan.
    // (With fewer columns it is not — `SELECT age, id … WHERE id < 55` is
    // answered from the covering index on `age`, in its order, as the first
    // capture found.)
    return `SELECT * FROM ${t.name} WHERE ${t.pk} ${pick(['=', '>', '<', '>='])} ${literalFor(t.columns[t.pk])}`
  }
  const orderCol = pick(cols)
  const order = ` ORDER BY ${pick([orderCol, `${orderCol} DESC`, `${tiebreak} DESC`])}, ${tiebreak}`
  const limit = chance(0.3) ? ` LIMIT ${int(0, 4)}${chance(0.3) ? ` OFFSET ${int(0, 3)}` : ''}` : ''
  const distinct = chance(0.1) && !items.includes('*') ? 'DISTINCT ' : ''
  if (distinct !== '') return `SELECT DISTINCT ${pick(cols)} FROM ${t.name}${where} ORDER BY 1${limit}`
  return `SELECT ${items.join(', ')} FROM ${t.name}${where}${order}${limit}`
}

function insertStatement(t, next) {
  const cols = Object.keys(t.columns).filter((c) => !(t.name === 'p' && c === 'id' && chance(0.7)))
  const rows = Array.from({ length: int(1, 3) }, () => {
    const r = t.row(next())
    return cols.map((c) => {
      if (chance(0.08)) return pick(['NULL', "'oops-too-long-for-it'", '99999999999', "'abc'", 'DEFAULT'])
      if (c === 'id') return pick(['NULL', '0', String(int(1, 40))])
      if (c === 'n') return String(int(1, 60))
      return r[c] ?? 'NULL'
    })
  })
  return `INSERT INTO ${t.name} (${cols.join(', ')}) VALUES ${rows.map((r) => `(${r.join(', ')})`).join(', ')}`
}

/**
 * INSERT IGNORE, REPLACE and `ON DUPLICATE KEY UPDATE` (M5.8). Rows are drawn
 * from the seeds' own keys more often than not, so they collide — on the
 * primary key, on `p`'s UNIQUE name, and on `k`'s text key under the
 * accent- and case-insensitive default — and a share carry a bad value, which
 * IGNORE turns into a warning. An upsert's assignments read the old row, the
 * tried row through `VALUES()` and through a row alias, and the table's
 * AUTO_INCREMENT through `LAST_INSERT_ID(id)`.
 */
function upsertStatement(t, next, seeded) {
  const kind = pick(['ignore', 'replace', 'upsert', 'upsert'])
  const cols = Object.keys(t.columns).filter((c) => !(t.name === 'p' && c === 'id' && chance(0.6)))
  const rows = Array.from({ length: int(1, 3) }, () => {
    const r = t.row(chance(0.65) ? int(0, Math.max(seeded - 1, 0)) : next())
    return cols.map((c) => {
      if (chance(0.06)) return pick(['NULL', "'oops-too-long-for-it'", '99999999999', "'abc'"])
      if (c === 'id') return pick(['NULL', String(int(1, seeded + 2))])
      if (c === 'n') return String(pick([int(0, seeded) * 3 + 1, int(1, 60)]))
      if (c === 'code' && chance(0.3)) return (r[c] ?? 'NULL').toUpperCase()
      return r[c] ?? 'NULL'
    })
  })
  const head = kind === 'replace' ? 'REPLACE' : `INSERT${kind === 'ignore' || chance(0.1) ? ' IGNORE' : ''}`
  let sql = `${head} INTO ${t.name} (${cols.join(', ')}) VALUES ${rows.map((r) => `(${r.join(', ')})`).join(', ')}`
  if (kind !== 'upsert') return sql
  const alias = chance(0.4)
  if (alias) sql += ' AS new'
  const targets = Object.keys(t.columns).filter((c) => c !== t.pk || chance(0.1))
  const sets = Array.from({ length: int(1, 2) }, () => {
    const c = pick(targets)
    const k = t.columns[c]
    const numeric = k === 'int' || k === 'uint' || k === 'dec' || k === 'double'
    const tried = cols.includes(c) ? [alias ? `new.${c}` : `VALUES(${c})`] : []
    const value = pick([
      ...tried,
      ...tried,
      literalFor(k),
      'DEFAULT',
      numeric ? `${c} + ${int(1, 5)}` : k === 'text' ? `CONCAT(${c}, '${pick(['x', 'y'])}')` : 'NULL',
      numeric && tried.length > 0 ? `${t.name}.${c} + ${tried[0]}` : literalFor(k),
    ])
    return `${c} = ${value}`
  })
  if (t.name === 'p' && chance(0.15)) sets.push('id = LAST_INSERT_ID(id)')
  return `${sql} ON DUPLICATE KEY UPDATE ${sets.join(', ')}`
}

function updateStatement(t) {
  const cols = Object.keys(t.columns).filter((c) => c !== t.pk || chance(0.1))
  const sets = Array.from({ length: int(1, 2) }, () => {
    const c = pick(cols)
    const kind = t.columns[c]
    const value = kind === 'int' || kind === 'uint' || kind === 'dec' ? pick([`${c} + 1`, literalFor(kind), 'NULL', `${c} * 2`]) : pick([literalFor(kind), 'NULL', kind === 'text' ? `CONCAT(${c}, 'x')` : literalFor(kind)])
    return `${c} = ${value}`
  })
  const where = chance(0.8) ? ` WHERE ${predicate(t)}` : ''
  const limit = t.pk !== null && chance(0.2) ? ` ORDER BY ${t.pk} LIMIT ${int(1, 3)}` : ''
  return `UPDATE ${t.name} SET ${sets.join(', ')}${where}${limit}`
}

function deleteStatement(t) {
  const limit = t.pk !== null && chance(0.2) ? ` ORDER BY ${t.pk} DESC LIMIT ${int(1, 2)}` : ''
  return `DELETE FROM ${t.name} WHERE ${predicate(t)}${limit}`
}

/** One case: a table, its rows, some statements, and the table's state at the end. */
export function generateCase() {
  const t = pick(TABLES)
  let counter = 0
  const next = () => counter++
  const seeds = Array.from({ length: int(3, 9) }, () => t.row(next()))
  const cols = Object.keys(seeds[0])
  const statements = [t.ddl]
  if (t.name === 'l') {
    // A multi-row INSERT: `n` is generated distinct, so it cannot collide.
    statements.push(`INSERT INTO l (n, s, t) VALUES ${seeds.map((r) => `(${r.n}, ${r.s}, ${r.t})`).join(', ')}`)
  } else {
    // One row at a time, so a duplicate in the generated data costs one row rather than the case.
    for (const r of seeds) statements.push(`INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${cols.map((c) => r[c]).join(', ')})`)
  }
  for (let i = int(1, 4); i > 0; i--) {
    statements.push(
      pick([selectStatement, selectStatement, selectStatement, (x) => insertStatement(x, next), (x) => upsertStatement(x, next, seeds.length), (x) => upsertStatement(x, next, seeds.length), updateStatement, deleteStatement])(t),
    )
  }
  statements.push(`SELECT * FROM ${t.name} ORDER BY ${t.pk ?? Object.keys(t.columns).join(', ')}`)
  return statements
}

// --- running ----------------------------------------------------------------------

/** A value as the text a client received, or hex for a binary column. */
function cell(v, field) {
  if (v === null) return null
  const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v))
  return field.characterSet === 63 ? `0x${b.toString('hex')}` : b.toString('utf8')
}

/** One statement's outcome, as the replay compares it. */
export async function outcome(conn, sql) {
  try {
    const [result, fields] = await conn.query({ sql, rowsAsArray: true, typeCast: false })
    if (fields === undefined) {
      const { affectedRows, insertId, info, warningStatus } = result
      return { ok: { affectedRows, insertId, info, warnings: warningStatus } }
    }
    return {
      columns: fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
      rows: result.map((row) => row.map((v, i) => cell(v, fields[i]))),
    }
  } catch (e) {
    if (e.errno === undefined) throw e
    return { error: [e.errno, e.sqlState] }
  }
}

export async function runCase(conn, statements) {
  await conn.query(`DROP DATABASE IF EXISTS ${SCHEMA}`)
  await conn.query(`CREATE DATABASE ${SCHEMA}`)
  await conn.query(`USE ${SCHEMA}`)
  const out = []
  for (const sql of statements) out.push({ sql, ...(await outcome(conn, sql)) })
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD, charset: 'utf8mb4_0900_ai_ci' })
  await conn.query(`SET sql_mode = '${SQL_MODE}'`)
  const [[{ v: version }]] = await conn.query('SELECT VERSION() AS v')
  const cases = []
  const seen = new Set()
  while (cases.length < CASES) {
    const statements = generateCase()
    const key = statements.join('\n')
    if (seen.has(key)) continue
    seen.add(key)
    cases.push(await runCase(conn, statements))
  }
  await conn.query(`DROP DATABASE IF EXISTS ${SCHEMA}`)
  await conn.end()

  const results = cases.flat()
  const errors = {}
  for (const r of results) if (r.error !== undefined) errors[r.error[0]] = (errors[r.error[0]] ?? 0) + 1
  const sets = results.filter((r) => r.rows !== undefined).length
  console.log(`${cases.length} cases, ${results.length} statements: ${sets} resultsets, errors ${JSON.stringify(errors)}`)

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, 'execution.json')
  const head = {
    name: 'execution',
    note:
      'Generated scripts — a table, rows, statements, the final state — run by a real MySQL through mysql2. The ' +
      'replay runs each script against our executor through the same driver and compares rows, column metadata, ' +
      'counters and errors.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  // One case per line, so a re-capture's diff reads as the cases that changed.
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`execution -> ${file}`)
}
