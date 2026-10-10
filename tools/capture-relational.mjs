#!/usr/bin/env node
// M5.18 — capture relational execution vectors from a real MySQL.
//
// `capture-execution.mjs` (M5.17) puts one table at a time in front of the
// server. This puts the rest of SELECT there: joins, GROUP BY and aggregates,
// subqueries, derived tables, CTEs and set operations, and the writes that read
// a query (`INSERT … SELECT`, a subquery in UPDATE and DELETE).
//
// Planning this corpus put its assumptions to 8.4.11 first, and they decided
// its shape (M5.18 in the roadmap):
//
//   - **Order is the plan's.** A hash join builds on the earlier table and
//     probes with the later one, newest build row first; a temporary table
//     returns groups in first-appearance order; a grouped index scan in index
//     order. So every SELECT also records `EXPLAIN FORMAT=TREE`, reduced to its
//     skeleton (`planSkeleton`), and the replay compares rows *in order*
//     wherever the query fixes the order or the two plans agree, and as a
//     multiset elsewhere.
//   - **The plan is a cost decision on statistics InnoDB recomputes in the
//     background.** Every table is created with `STATS_AUTO_RECALC=0` and
//     analysed once it is seeded, so a re-capture chooses the same plans. The
//     `ANALYZE` is recorded `serverOnly`: run on both sides, since our planner
//     reads the statistics it keeps too (M5.45), and compared on neither.
//   - **Half the joins are `STRAIGHT_JOIN`**, so the order of execution is
//     the statement's rather than the optimizer's.
//   - **Prepared statements are a second protocol, not a detail.** Prisma
//     never sends text. Every SELECT runs twice, through `query` and through
//     `execute`, and both answers are recorded.
//   - **Warnings depend on the plan** (2, 1 or 10 for one predicate). A
//     resultset's warning count is recorded; the generator draws literals that
//     convert cleanly, so it is 0 almost everywhere, and the replay does not
//     yet compare it.
//
// An ordered SELECT ends in `ORDER BY 1, 2, …, n` over every output column,
// which is total over what a client can see: two rows that tie on all of them
// are indistinguishable. The text values are distinct under the default
// collation (no `'b'` beside `'B'`), so a tie is a real tie.
//
// Usage:
//   node tools/capture-relational.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { isMain } from './lib/is-main.mjs'
import { arg, xorshift } from './lib/cli.mjs'


const HOST = arg('host', '127.0.0.1')
const PORT = Number(arg('port', '3306'))
const USER = arg('user', 'root')
const PASSWORD = arg('password', 'root')
const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)
const CASES = Number(arg('cases', '300'))
const SEED = Number(arg('seed', '20261009'))
export const SCHEMA = 'myjs_rel'
/** The session both sides run in. ONLY_FULL_GROUP_BY is in it, as it is in 8.4's default. */
export const SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'
/** The driver's options, on both sides: dates and big numbers as strings, so a binary row compares as text does. */
export const CONNECTION = { charset: 'utf8mb4_0900_ai_ci', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true }

/** xorshift32, seeded (`tools/lib/cli.mjs`), so a seed reproduces the corpus. */
const { rnd, pick, chance, int } = xorshift(SEED)
const some = (xs, lo, hi) => {
  const pool = [...xs]
  const out = []
  for (let n = Math.min(int(lo, hi), pool.length); n > 0; n--) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
  return out
}

// --- the tables -----------------------------------------------------------------

/** Distinct under `utf8mb4_0900_ai_ci`, so ORDER BY over them is total. */
const NAMES = ['ann', 'Bob', 'cy', 'ÄNNA', 'dee', 'b', 'zoë', 'al', 'éva', 'x y', 'Mo']
const LABELS = ['red', 'Blue', 'green', 'ann', 'cy', 'zoë', 'x']

/**
 * A parent, a child whose reference dangles or is NULL, a keyless table with
 * duplicates, and a latin1 table whose `t` is `utf8mb4_bin` — so a join on it
 * against the default collation is 1267, and one on `s` converts.
 */
const TABLES = {
  pa: {
    ddl: 'CREATE TABLE pa (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(12) NOT NULL, grp INT, amt DECIMAL(6,2), UNIQUE KEY (name), KEY (grp)) STATS_AUTO_RECALC=0',
    columns: { id: 'int', name: 'text', grp: 'int', amt: 'dec' },
    order: 'id',
  },
  ch: {
    ddl: 'CREATE TABLE ch (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, pa_id INT, label VARCHAR(10), qty INT NOT NULL, KEY (pa_id)) STATS_AUTO_RECALC=0',
    columns: { id: 'int', pa_id: 'int', label: 'text', qty: 'int' },
    order: 'id',
  },
  kl: {
    ddl: 'CREATE TABLE kl (g INT, s VARCHAR(10), d DATE) STATS_AUTO_RECALC=0',
    columns: { g: 'int', s: 'text', d: 'date' },
    order: 'g, s, d',
  },
  lt: {
    ddl: 'CREATE TABLE lt (n INT NOT NULL PRIMARY KEY, s VARCHAR(10) CHARACTER SET latin1, t VARCHAR(10) COLLATE utf8mb4_bin) STATS_AUTO_RECALC=0',
    columns: { n: 'int', s: 'text', t: 'text' },
    order: 'n',
  },
}
const TABLE_NAMES = Object.keys(TABLES)

/** Equalities worth joining on, and one that cannot be compared (1267). */
const LINKS = [
  ['pa', 'id', 'ch', 'pa_id'],
  ['pa', 'id', 'ch', 'pa_id'],
  ['pa', 'grp', 'kl', 'g'],
  ['ch', 'qty', 'kl', 'g'],
  ['pa', 'name', 'kl', 's'],
  ['ch', 'label', 'kl', 's'],
  ['pa', 'name', 'lt', 's'],
  ['pa', 'id', 'lt', 'n'],
  ['ch', 'label', 'lt', 't'],
  ['kl', 'g', 'lt', 'n'],
]

function seeds() {
  const statements = []
  const pa = int(2, 6)
  const names = some(NAMES, pa, pa)
  for (const name of names) statements.push(`INSERT INTO pa (name, grp, amt) VALUES ('${name}', ${chance(0.2) ? 'NULL' : int(1, 4)}, ${chance(0.2) ? 'NULL' : `${int(-20, 300)}.${String(int(0, 99)).padStart(2, '0')}`})`)
  const ch = int(0, 8)
  if (ch > 0) {
    const rows = Array.from({ length: ch }, () => `(${chance(0.15) ? 'NULL' : int(1, pa + 2)}, ${chance(0.15) ? 'NULL' : `'${pick(LABELS)}'`}, ${int(0, 6)})`)
    statements.push(`INSERT INTO ch (pa_id, label, qty) VALUES ${rows.join(', ')}`)
  }
  const kl = int(0, 7)
  if (kl > 0) {
    const rows = Array.from({ length: kl }, () => `(${chance(0.2) ? 'NULL' : int(0, 5)}, ${chance(0.2) ? 'NULL' : `'${pick([...NAMES, ...LABELS])}'`}, ${chance(0.3) ? 'NULL' : `'20${int(10, 24)}-0${int(1, 9)}-1${int(0, 9)}'`})`)
    statements.push(`INSERT INTO kl (g, s, d) VALUES ${rows.join(', ')}`)
  }
  const lt = int(1, 5)
  statements.push(`INSERT INTO lt (n, s, t) VALUES ${Array.from({ length: lt }, (_, i) => `(${i * 2 + 1}, ${chance(0.2) ? 'NULL' : `'${pick(NAMES)}'`}, ${chance(0.2) ? 'NULL' : `'${pick(LABELS)}'`})`).join(', ')}`)
  return statements
}

// --- expressions ------------------------------------------------------------------

/** A literal of a column's kind that converts cleanly, so no comparison warns. */
function literal(kind) {
  switch (kind) {
    case 'int':
      return pick([String(int(0, 6)), String(int(0, 6)), `${int(0, 5)}.5`, 'NULL'])
    case 'dec':
      return pick([String(int(-20, 300)), `${int(0, 200)}.25`])
    case 'date':
      return pick([`'20${int(10, 24)}-06-15'`, `'2018-01-01'`])
    default:
      return `'${pick([...NAMES, ...LABELS, 'a', 'z'])}'`
  }
}

/** The columns of the tables in scope, each `alias.col` with its kind. */
function columnsOf(scope) {
  return scope.flatMap(({ table, alias }) => Object.entries(TABLES[table].columns).map(([c, kind]) => ({ ref: `${alias}.${c}`, kind, alias, column: c })))
}

function predicate(scope, depth = 0) {
  const c = pick(columnsOf(scope))
  let p
  switch (int(0, 5)) {
    case 0:
      p = `${c.ref} IS ${pick(['', 'NOT '])}NULL`
      break
    case 1:
      p = `${c.ref} ${pick(['', 'NOT '])}IN (${[literal(c.kind), literal(c.kind)].join(', ')})`
      break
    case 2:
      p = c.kind === 'text' ? `${c.ref} LIKE '${pick(['a%', '%e%', '_', 'B%'])}'` : `${c.ref} BETWEEN ${literal(c.kind)} AND ${literal(c.kind)}`
      break
    default:
      p = `${c.ref} ${pick(['=', '<', '<=', '>', '>=', '<>', '<=>'])} ${literal(c.kind)}`
  }
  if (depth < 1 && chance(0.3)) p = `${p} ${pick(['AND', 'OR'])} ${predicate(scope, depth + 1)}`
  return p
}

function scalar(scope) {
  const cols = columnsOf(scope)
  const num = cols.filter((c) => c.kind === 'int' || c.kind === 'dec')
  const text = cols.filter((c) => c.kind === 'text')
  const n = () => (num.length > 0 ? pick(num).ref : '1')
  const s = () => (text.length > 0 ? pick(text).ref : "'q'")
  return pick([
    () => pick(cols).ref,
    () => pick(cols).ref,
    () => `${n()} + ${int(1, 9)}`,
    () => `${n()} * 2`,
    () => `COALESCE(${n()}, 0)`,
    () => `CONCAT(${s()}, '-')`,
    () => `IFNULL(${s()}, 'none')`,
    () => `${pick(cols).ref} IS NULL`,
  ])()
}

function aggregate(scope) {
  const cols = columnsOf(scope)
  const num = cols.filter((c) => c.kind === 'int' || c.kind === 'dec')
  const text = cols.filter((c) => c.kind === 'text')
  const any = () => pick(cols).ref
  const n = () => (num.length > 0 ? pick(num).ref : '1')
  return pick([
    () => 'COUNT(*)',
    () => 'COUNT(*)',
    () => `COUNT(${any()})`,
    () => `COUNT(DISTINCT ${any()})`,
    () => `SUM(${n()})`,
    () => `SUM(DISTINCT ${n()})`,
    () => `AVG(${n()})`,
    () => `MIN(${any()})`,
    () => `MAX(${any()})`,
    () => `MAX(${n()}) - MIN(${n()})`,
    () => `BIT_OR(${n()})`,
    () => `BIT_AND(${n()})`,
    () => `COUNT(*) + ${int(1, 5)}`,
    () => {
      const c = text.length > 0 ? pick(text).ref : any()
      return `GROUP_CONCAT(${chance(0.3) ? 'DISTINCT ' : ''}${c} ORDER BY ${c}${chance(0.5) ? ' DESC' : ''}${chance(0.3) ? " SEPARATOR ';'" : ''})`
    },
  ])()
}

// --- FROM clauses -----------------------------------------------------------------

/** One table, two or three joined. Returns the FROM text and the aliases in scope. */
function from(maxTables = 3) {
  const count = pick([1, 2, 2, 2, 3].filter((k) => k <= maxTables))
  const tables = some(TABLE_NAMES, count, count)
  const scope = tables.map((table, i) => ({ table, alias: chance(0.3) ? `${table[0]}${i}` : table }))
  let sql = refOf(scope[0])
  for (let i = 1; i < scope.length; i++) {
    const right = scope[i]
    const left = pick(scope.slice(0, i))
    const link = LINKS.filter((l) => (l[0] === left.table && l[2] === right.table) || (l[2] === left.table && l[0] === right.table))
    const kind = pick(['JOIN', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'CROSS JOIN', ',', 'STRAIGHT_JOIN'])
    if (kind === ',' || kind === 'CROSS JOIN') {
      sql += `${kind === ',' ? ',' : ' CROSS JOIN'} ${refOf(right)}`
      continue
    }
    let on
    if (link.length > 0 && chance(0.85)) {
      const l = pick(link)
      const [a, b] = l[0] === left.table ? [`${left.alias}.${l[1]}`, `${right.alias}.${l[3]}`] : [`${left.alias}.${l[3]}`, `${right.alias}.${l[1]}`]
      on = `${a} ${chance(0.85) ? '=' : pick(['<', '<>', '<='])} ${b}`
    } else {
      const lc = pick(columnsOf([left]).filter((c) => c.kind === 'int'))
      const rc = pick(columnsOf([right]).filter((c) => c.kind === 'int'))
      on = `${lc.ref} ${pick(['=', '<', '>='])} ${rc.ref}`
    }
    if (chance(0.25)) on = `${on} AND ${predicate([right])}`
    sql += ` ${kind} ${refOf(right)} ON ${on}`
  }
  return { sql, scope }
}

function refOf({ table, alias }) {
  return alias === table ? table : `${table} AS ${alias}`
}

/** A total ORDER BY over n output columns. */
const orderAll = (n) => ` ORDER BY ${Array.from({ length: n }, (_, i) => i + 1).join(', ')}`

// --- statements -------------------------------------------------------------------

/** Each returns `{ sql, ordered }`: whether the statement itself fixes its row order. */
function joinSelect() {
  const f = from()
  const straight = f.scope.length > 1 && chance(0.5) && !/LEFT|RIGHT/.test(f.sql)
  let items
  if (chance(0.2)) items = ['*']
  else if (chance(0.1)) items = [`${pick(f.scope).alias}.*`]
  else items = Array.from({ length: int(1, 4) }, () => scalar(f.scope))
  const where = chance(0.5) ? ` WHERE ${predicate(f.scope)}` : ''
  const ordered = chance(0.6)
  const width = items[0] === '*' ? f.scope.reduce((n, s) => n + Object.keys(TABLES[s.table].columns).length, 0) : items[0].endsWith('.*') ? Object.keys(TABLES[f.scope.find((s) => items[0] === `${s.alias}.*`).table].columns).length : items.length
  const order = ordered ? orderAll(width) : ''
  const limit = ordered && chance(0.25) ? ` LIMIT ${int(0, 4)}` : ''
  return { sql: `SELECT ${straight ? 'STRAIGHT_JOIN ' : ''}${items.join(', ')} FROM ${f.sql}${where}${order}${limit}`, ordered }
}

function naturalSelect() {
  const pairs = [['pa', 'lt'], ['ch', 'pa'], ['kl', 'lt'], ['pa', 'kl']]
  const [a, b] = pick(pairs)
  const shared = Object.keys(TABLES[a].columns).filter((c) => c in TABLES[b].columns)
  const kind = pick(['JOIN', 'LEFT JOIN', 'RIGHT JOIN'])
  const using = shared.length > 0 && chance(0.6) ? ` USING (${some(shared, 1, shared.length).join(', ')})` : ''
  const sql = using === '' ? `SELECT * FROM ${a} NATURAL ${kind} ${b}` : `SELECT ${pick(['*', `${a}.*`, `${b}.*, ${a}.*`])} FROM ${a} ${kind} ${b}${using}`
  return { sql, ordered: false }
}

function groupSelect() {
  const f = from(2)
  const cols = columnsOf(f.scope)
  const keys = some(cols, 0, 2)
  const aggs = Array.from({ length: int(1, 3) }, () => aggregate(f.scope))
  // One in ten names a column it does not group by: ONLY_FULL_GROUP_BY's 1055,
  // unless the key determines it.
  const stray = chance(0.1) ? [pick(cols).ref] : []
  const items = [...keys.map((k) => k.ref), ...stray, ...aggs]
  const where = chance(0.4) ? ` WHERE ${predicate(f.scope)}` : ''
  const group = keys.length > 0 ? ` GROUP BY ${keys.map((k) => k.ref).join(', ')}${chance(0.12) ? ' WITH ROLLUP' : ''}` : ''
  const having = chance(0.25) ? ` HAVING ${pick([`COUNT(*) > ${int(0, 2)}`, `${aggs[0]} IS NOT NULL`, `MIN(${pick(cols).ref}) IS NULL`])}` : ''
  const distinct = keys.length === 0 && aggs.length === 1 && chance(0.1) ? 'DISTINCT ' : ''
  const ordered = keys.length <= 1 || chance(0.7)
  const order = ordered && keys.length > 0 ? orderAll(items.length) : ''
  return { sql: `SELECT ${distinct}${items.join(', ')} FROM ${f.sql}${where}${group}${having}${order}`, ordered }
}

function distinctSelect() {
  const f = from(2)
  const items = some(columnsOf(f.scope), 1, 2).map((c) => c.ref)
  const ordered = chance(0.6)
  return { sql: `SELECT DISTINCT ${items.join(', ')} FROM ${f.sql}${chance(0.4) ? ` WHERE ${predicate(f.scope)}` : ''}${ordered ? orderAll(items.length) : ''}`, ordered }
}

function subquerySelect() {
  const ordered = chance(0.7)
  const o = (n) => (ordered ? orderAll(n) : '')
  const x = pick([
    () => ({ sql: `SELECT pa.name, (SELECT COUNT(*) FROM ch WHERE ch.pa_id = pa.id) AS n FROM pa${o(2)}` }),
    () => ({ sql: `SELECT pa.name, (SELECT MAX(qty) FROM ch WHERE ch.pa_id = pa.id) FROM pa${o(2)}` }),
    () => ({ sql: `SELECT pa.id, (SELECT label FROM ch WHERE ch.pa_id = pa.id ORDER BY ch.id LIMIT 1) AS first FROM pa${o(2)}` }),
    () => ({ sql: `SELECT kl.s, (SELECT ${pick(['MIN(g)', 'g', 'COUNT(*)'])} FROM kl AS k2${chance(0.5) ? ' WHERE k2.g > 2' : ''}) AS v FROM kl${o(2)}` }),
    () => ({ sql: `SELECT name FROM pa WHERE id ${pick(['', 'NOT '])}IN (SELECT pa_id FROM ch${chance(0.5) ? ` WHERE ${predicate([{ table: 'ch', alias: 'ch' }])}` : ''})${o(1)}` }),
    () => ({ sql: `SELECT g, s FROM kl WHERE g ${pick(['', 'NOT '])}IN (SELECT grp FROM pa)${o(2)}` }),
    () => ({ sql: `SELECT name FROM pa WHERE ${pick(['', 'NOT '])}EXISTS (SELECT 1 FROM ch WHERE ch.pa_id = pa.id${chance(0.4) ? ` AND ch.qty > ${int(0, 4)}` : ''})${o(1)}` }),
    () => ({ sql: `SELECT label, qty FROM ch WHERE qty ${pick(['>', '<', '=', '<>'])} ${pick(['ANY', 'ALL', 'SOME'])} (SELECT g FROM kl${chance(0.5) ? ' WHERE g IS NOT NULL' : ''})${o(2)}` }),
    () => ({ sql: `SELECT name, amt FROM pa WHERE amt > (SELECT AVG(amt) FROM pa)${o(2)}` }),
    () => ({ sql: `SELECT d.k, d.c FROM (SELECT pa_id AS k, COUNT(*) AS c FROM ch GROUP BY pa_id) AS d${chance(0.5) ? ' WHERE d.c > 1' : ''}${o(2)}` }),
    () => ({ sql: `SELECT pa.name, d.c FROM pa ${pick(['JOIN', 'LEFT JOIN'])} (SELECT pa_id, SUM(qty) AS c FROM ch GROUP BY pa_id) AS d ON d.pa_id = pa.id${o(2)}` }),
    () => ({ sql: `SELECT x.a, x.b FROM (SELECT g, s FROM kl) AS x (a, b)${chance(0.5) ? ' WHERE x.a > 1' : ''}${o(2)}` }),
    () => ({ sql: `SELECT pa.name, x.c FROM pa, LATERAL (SELECT COUNT(*) AS c FROM ch WHERE ch.pa_id = pa.id) AS x${o(2)}` }),
    () => ({ sql: `SELECT pa.name, x.label FROM pa LEFT JOIN LATERAL (SELECT label FROM ch WHERE ch.pa_id = pa.id ORDER BY label LIMIT 1) AS x ON TRUE${o(2)}` }),
    () => ({ sql: `SELECT * FROM (SELECT name FROM pa) AS d` }),
    () => ({ sql: `SELECT * FROM (SELECT 1 AS a) d1, (SELECT 2 AS a) AS d2` }),
    () => ({ sql: `WITH c AS (SELECT pa_id, COUNT(*) AS n FROM ch GROUP BY pa_id) SELECT pa.name, c.n FROM pa JOIN c ON c.pa_id = pa.id${o(2)}` }),
    () => ({ sql: `WITH a AS (SELECT g FROM kl), b AS (SELECT g FROM a WHERE g > 1) SELECT g FROM b${o(1)}` }),
    () => ({ sql: `WITH RECURSIVE r (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < ${int(1, 6)}) SELECT n FROM r${o(1)}` }),
    () => ({ sql: `WITH RECURSIVE r (n, s) AS (SELECT 1, CAST('a' AS CHAR(20)) UNION ALL SELECT n + 1, CONCAT(s, 'b') FROM r WHERE n < 4) SELECT * FROM r${o(2)}` }),
    () => ({ sql: `WITH RECURSIVE r (n) AS (SELECT 1 UNION DISTINCT SELECT n % 3 + 1 FROM r) SELECT n FROM r${o(1)}` }),
    () => ({ sql: `SELECT name FROM pa WHERE id = (SELECT pa_id FROM ch${chance(0.5) ? ' ORDER BY id LIMIT 1' : ''})` }),
  ])()
  return { sql: x.sql, ordered: ordered && /ORDER BY 1(,|$)/.test(x.sql) }
}

function setSelect() {
  const branch = () => {
    const t = pick(TABLE_NAMES)
    const cols = Object.entries(TABLES[t].columns)
    const [c1, k1] = pick(cols)
    const second = chance(0.3) ? `, ${pick(cols)[0]}` : ''
    const where = chance(0.4) ? ` WHERE ${predicate([{ table: t, alias: t }])}` : ''
    return { sql: `SELECT ${c1}${second} FROM ${t}${where}`, width: second === '' ? 1 : 2, kind: k1 }
  }
  const a = branch()
  let b = branch()
  while (b.width !== a.width && chance(0.9)) b = branch()
  const op = pick(['UNION', 'UNION', 'UNION ALL', 'UNION DISTINCT', 'INTERSECT', 'EXCEPT', 'INTERSECT ALL', 'EXCEPT ALL'])
  let sql = `${a.sql} ${op} ${b.sql}`
  if (chance(0.3)) {
    let c = branch()
    while (c.width !== a.width && chance(0.9)) c = branch()
    sql = chance(0.5) ? `(${sql}) ${pick(['UNION', 'UNION ALL', 'EXCEPT'])} ${c.sql}` : `${sql} ${pick(['UNION', 'UNION ALL', 'INTERSECT'])} (${c.sql})`
  }
  const ordered = chance(0.6)
  if (ordered) sql += orderAll(a.width) + (chance(0.25) ? ` LIMIT ${int(0, 4)}` : '')
  return { sql, ordered }
}

function writeStatement() {
  return pick([
    () => `INSERT INTO kl (g, s) SELECT grp, name FROM pa${chance(0.5) ? ` WHERE ${predicate([{ table: 'pa', alias: 'pa' }])}` : ''}`,
    () => `INSERT INTO ch (pa_id, label, qty) SELECT id, name, ${pick(['1', 'grp', 'COALESCE(grp, 0)'])} FROM pa${chance(0.5) ? ' ORDER BY id LIMIT 2' : ''}`,
    () => `INSERT IGNORE INTO ch (pa_id, label, qty) SELECT id, name, grp FROM pa`,
    () => `INSERT INTO pa (name, grp) SELECT CONCAT(s, '2'), g FROM kl WHERE s IS NOT NULL${chance(0.5) ? ' ON DUPLICATE KEY UPDATE grp = VALUES(grp)' : ''}`,
    () => `INSERT INTO lt (n, s) SELECT id + 100, name FROM pa`,
    () => `INSERT INTO kl (g, s) SELECT COUNT(*), MAX(label) FROM ch`,
    () => `UPDATE ch SET qty = qty + 1 WHERE pa_id IN (SELECT id FROM pa WHERE ${predicate([{ table: 'pa', alias: 'pa' }])})`,
    () => `UPDATE pa SET grp = (SELECT COUNT(*) FROM ch WHERE ch.pa_id = pa.id)`,
    () => `DELETE FROM kl WHERE g ${pick(['', 'NOT '])}IN (SELECT grp FROM pa${chance(0.5) ? ' WHERE grp IS NOT NULL' : ''})`,
    () => `DELETE FROM ch WHERE NOT EXISTS (SELECT 1 FROM pa WHERE pa.id = ch.pa_id)`,
    () => `DELETE FROM ch WHERE pa_id IN (SELECT pa_id FROM ch)`,
  ])()
}

/** One case: four tables, their rows, a few statements, and every table's state at the end. */
export function generateCase() {
  const setup = TABLE_NAMES.map((t) => TABLES[t].ddl)
  const rows = seeds()
  const statements = [...setup.map((sql) => ({ sql })), ...rows.map((sql) => ({ sql })), { sql: `ANALYZE TABLE ${TABLE_NAMES.join(', ')}`, serverOnly: true }]
  for (let i = int(2, 6); i > 0; i--) {
    const g = pick([joinSelect, joinSelect, joinSelect, naturalSelect, groupSelect, groupSelect, groupSelect, distinctSelect, subquerySelect, subquerySelect, subquerySelect, setSelect, setSelect, writeStatement])
    const s = g()
    statements.push(typeof s === 'string' ? { sql: s } : { sql: s.sql, select: true, ordered: s.ordered })
  }
  for (const t of TABLE_NAMES) statements.push({ sql: `SELECT * FROM ${t} ORDER BY ${TABLES[t].order}`, select: true, ordered: true })
  return statements
}

// --- running ----------------------------------------------------------------------

/** The field types whose `binary` values are bytes rather than numbers or dates rendered in ASCII. */
const BYTE_TYPES = new Set([15, 16, 249, 250, 251, 252, 253, 254])

/** A value as the text a client received, or hex for a byte string. */
function cell(v, field) {
  if (v === null) return null
  const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v))
  return field.characterSet === 63 && BYTE_TYPES.has(field.columnType) ? `0x${b.toString('hex')}` : b.toString('utf8')
}

// The four names too: a derived table's column reports its own derived name
// as its original name, which a corpus recording only the shape never saw.
const columnsOfFields = (fields) => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

/**
 * `EXPLAIN FORMAT=TREE`, reduced to what a plan *is*: each node's kind and the
 * table or index it names, indented as the tree is, without costs, row
 * estimates or the text of a condition (`Filter: (cast(a.x as double) = …)`
 * is `Filter`). `null` if the server will not explain it.
 */
export function planSkeleton(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const indent = l.length - l.trimStart().length
      const body = l.trim().replace(/^-> /, '')
      const cut = body.search(/:| \(/)
      return ' '.repeat(indent) + (cut < 0 ? body : body.slice(0, cut)).trim()
    })
    .join('\n')
}

/**
 * One statement's outcome on one connection. With `warnings`, a query's
 * warning count is read straight after it, as `@@warning_count`: before the
 * binary execute and the EXPLAIN, whose own counts the first captures
 * recorded instead (found when M5.28 first compared them).
 */
export async function outcome(conn, statement, { warnings = false } = {}) {
  const { sql } = statement
  try {
    const [result, fields] = await conn.query({ sql, rowsAsArray: true, typeCast: false })
    if (fields === undefined) {
      const { affectedRows, insertId, info, warningStatus } = Array.isArray(result) ? result[0] : result
      return { ok: { affectedRows, insertId, info, warnings: warningStatus } }
    }
    const out = { columns: columnsOfFields(fields), rows: result.map((row) => row.map((v, i) => cell(v, fields[i]))) }
    const counted = warnings ? Number((await conn.query({ sql: 'SELECT @@warning_count', rowsAsArray: true }))[0][0][0]) : undefined
    if (statement.select === true) {
      const binary = await binaryOutcome(conn, sql)
      // Recorded only where it differs from the text answer, which is rare.
      out.binary = JSON.stringify(binary) === JSON.stringify(out) ? 'same' : binary
      out.plan = await plan(conn, sql)
    }
    if (counted !== undefined) out.warnings = counted
    return out
  } catch (e) {
    if (e.errno === undefined) throw e
    const out = { error: [e.errno, e.sqlState] }
    if (statement.select === true) {
      const binary = await binaryOutcome(conn, sql)
      out.binary = JSON.stringify(binary) === JSON.stringify(out) ? 'same' : binary
    }
    return out
  }
}

async function binaryOutcome(conn, sql) {
  try {
    const [result, fields] = await conn.execute({ sql, rowsAsArray: true })
    await conn.unprepare(sql)
    return { columns: columnsOfFields(fields), rows: result.map((row) => row.map((v, i) => cell(v, fields[i]))) }
  } catch (e) {
    if (e.errno === undefined) throw e
    return { error: [e.errno, e.sqlState] }
  }
}

async function plan(conn, sql) {
  try {
    const [rows] = await conn.query({ sql: `EXPLAIN FORMAT=TREE ${sql}`, rowsAsArray: true })
    return planSkeleton(String(rows[0][0]))
  } catch {
    return null
  }
}

/**
 * Run a case: each statement's outcome, `serverOnly` ones run and not
 * recorded. With `warnings`, a query's warning count is read after it,
 * as `@@warning_count`, which the executor answers since M5.28.
 */
export async function runCase(conn, statements, { server = false, warnings = server } = {}) {
  await conn.query(`DROP DATABASE IF EXISTS ${SCHEMA}`)
  await conn.query(`CREATE DATABASE ${SCHEMA}`)
  await conn.query(`USE ${SCHEMA}`)
  const out = []
  for (const s of statements) {
    // Run on both sides, compared on neither: ANALYZE, whose figures the planner reads (M5.45).
    if (s.serverOnly === true) {
      await conn.query(s.sql)
      out.push({ ...s })
      continue
    }
    out.push({ ...s, ...(await outcome(conn, s, { warnings })) })
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

  const results = cases.flat().filter((r) => r.serverOnly !== true)
  const errors = {}
  for (const r of results) if (r.error !== undefined) errors[r.error[0]] = (errors[r.error[0]] ?? 0) + 1
  const selects = results.filter((r) => r.select === true)
  const warned = selects.filter((r) => (r.warnings ?? 0) > 0).length
  console.log(`${cases.length} cases, ${results.length} statements, ${selects.length} queries (${warned} with warnings): errors ${JSON.stringify(errors)}`)

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, 'relational.json')
  const head = {
    name: 'relational',
    note:
      'Generated multi-table scripts (joins, grouping, subqueries, CTEs, set operations, writes that read a query) run by ' +
      'a real MySQL through mysql2, each SELECT through both protocols and with its plan skeleton. The replay compares rows ' +
      'in order where the statement or an agreeing plan fixes it, and as a multiset elsewhere.',
    capturedAgainst: `mysql-server ${version}`,
    seed: SEED,
    sqlMode: SQL_MODE,
  }
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  writeFileSync(file, `{\n${lines.join('\n')}\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`)
  console.log(`relational -> ${file}`)
}
