#!/usr/bin/env node
// M3.16 — capture query-grouping vectors from a real MySQL.
//
// M3.2 checked operator precedence against a server because precedence is the
// part of a parser that cannot be checked against itself. Queries have the same
// part, one level up: which tables a `JOIN`'s `ON` may see, and which branches
// an `INTERSECT` or a trailing `LIMIT` applies to. A parser that groups those
// wrongly still parses, round-trips through its own deparser and produces a
// plausible tree — the census is green and the query means something else.
//
// So: three tiny integer tables, a generator that mixes commas, every inner and
// outer join spelling, `ON` conditions written where the grouping decides
// whether they are legal, and set operations with parenthesised branches and
// trailing clauses. A real 8.4 runs each one; the fixture records the rows or
// the error. The replay (`query-vectors.test.ts`) parses each query and
// evaluates the *tree* with an evaluator that knows nothing about grouping, so
// a misgrouped tree comes out as different rows or a different error.
//
// Select lists are always explicit qualified columns, and each table appears
// once: the corpus is about grouping, not about name resolution's other rules
// (`NATURAL` coalescing, ambiguity), which are M5.1's.
//
// Usage:
//   node tools/capture-queries.mjs --host 127.0.0.1 --port 3306 --user root --password root
import { mkdirSync, writeFileSync } from 'node:fs'
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
const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)
const JOINS = Number(arg('joins', '700'))
const SETS = Number(arg('sets', '500'))
const SEED = Number(arg('seed', '20261007'))
const SCHEMA = 'myjs_queries'

// The same connection the other capture tools use; see capture-precedence.mjs
// for why the charset is pinned.
const CONNECT = ['-h', HOST, '-P', String(PORT), '--protocol=TCP', '--default-character-set=utf8mb4', '-u', USER, `-p${PASSWORD}`]

async function sql(statements, database) {
  const { stdout } = await run('mysql', [...CONNECT, ...(database ? [database] : []), '-N', '-B', '-e', statements], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/**
 * The data. Duplicates and NULLs on purpose: without duplicates `UNION ALL`
 * and `UNION` agree, and without NULLs an outer join is an inner one.
 */
const TABLES = {
  t1: [[1, 1], [2, 2], [2, null], [3, 1]],
  t2: [[1, 2], [2, 2], [4, null]],
  t3: [[2, 1], [3, 3], [null, 2]],
}
const NAMES = Object.keys(TABLES)

/** xorshift32 — the generator every corpus tool here uses, so a seed reproduces. */
let state = SEED || 1
function rnd() {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) / 0x100000000
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
const shuffle = (xs) => {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// --- joins ------------------------------------------------------------------

const JOIN_OPS = [',', 'JOIN', 'INNER JOIN', 'CROSS JOIN', 'STRAIGHT_JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'LEFT OUTER JOIN']

/** `x.c = y.c` over any two tables — in scope or not is the question. */
function condition() {
  const [x, y] = [pick(NAMES), pick(NAMES)]
  const c = `${x}.${pick(['a', 'b'])} ${pick(['=', '<', '='])} ${y}.${pick(['a', 'b'])}`
  return rnd() < 0.15 ? `${c} OR ${pick(NAMES)}.a IS NULL` : c
}

/**
 * A FROM clause over two or three tables, each once, in a random order, with
 * a random operator between each pair and zero, one or two `ON`s after each
 * table — so `a JOIN b JOIN c ON x ON y` and `a, b JOIN c ON …` both appear,
 * and so do shapes the server refuses. Sometimes one adjacent pair is
 * parenthesised.
 */
function fromClause() {
  const tables = shuffle(NAMES).slice(0, rnd() < 0.3 ? 2 : 3)
  const parts = [tables[0]]
  let secondOp = 0
  for (let i = 1; i < tables.length; i++) {
    const op = pick(JOIN_OPS)
    if (i === 2) secondOp = parts.length
    parts.push(op, tables[i])
    // An `ON` after a comma is always refused, so it is generated only rarely —
    // enough to check the refusal, not so often that refusals swamp the corpus.
    const ons = op === ',' ? (rnd() < 0.9 ? 0 : 1) : rnd() < 0.2 ? 0 : rnd() < 0.75 ? 1 : 2
    for (let k = 0; k < ons; k++) parts.push(`ON ${condition()}`)
  }
  // Sometimes parenthesise the first table, its operator, the second and its
  // conditions — everything before the second operator.
  if (tables.length === 3 && rnd() < 0.25) {
    parts.splice(0, secondOp, `(${parts.slice(0, secondOp).join(' ')})`)
  }
  return { tables, text: parts.join(' ').replaceAll(' , ', ', ') }
}

function joinQuery() {
  const { text } = fromClause()
  const columns = NAMES.filter((t) => text.includes(t)).flatMap((t) => [`${t}.a`, `${t}.b`])
  const where = rnd() < 0.25 ? ` WHERE ${pick(NAMES.filter((t) => text.includes(t)))}.a > 1` : ''
  return `SELECT ${columns.join(', ')} FROM ${text}${where}`
}

// --- set operations ---------------------------------------------------------

const SET_OPS = ['UNION', 'UNION ALL', 'UNION DISTINCT', 'INTERSECT', 'INTERSECT ALL', 'EXCEPT', 'EXCEPT ALL']

function branch() {
  const t = pick(NAMES)
  const c = pick(['a', 'b'])
  const where = rnd() < 0.3 ? ` WHERE ${t}.${c} > ${Math.floor(rnd() * 3)}` : ''
  const select = `SELECT ${t}.${c} FROM ${t}${where}`
  // A branch with its own ORDER BY and LIMIT must be parenthesised, and its
  // clause is its own — which is the grouping under test.
  if (rnd() < 0.25) return `(${select} ORDER BY 1${rnd() < 0.5 ? ' DESC' : ''} LIMIT ${1 + Math.floor(rnd() * 3)})`
  return select
}

function setQuery() {
  const n = 2 + Math.floor(rnd() * 3)
  const items = [branch()]
  for (let i = 1; i < n; i++) items.push(pick(SET_OPS), branch())
  let text = items.join(' ')
  // Parenthesise one adjacent pair of branches, sometimes.
  if (n >= 3 && rnd() < 0.3) {
    const at = 2 * Math.floor(rnd() * (n - 1))
    const pair = `(${items.slice(at, at + 3).join(' ')})`
    text = [...items.slice(0, at), pair, ...items.slice(at + 3)].join(' ')
  }
  // A `LIMIT` only with an `ORDER BY`: without one, *which* rows survive is
  // the server's choice, and a vector recording that choice is not a fact.
  if (rnd() < 0.5) {
    text += ` ORDER BY 1${rnd() < 0.5 ? ' DESC' : ''}`
    if (rnd() < 0.6) text += ` LIMIT ${1 + Math.floor(rnd() * 4)}`
  }
  return text
}

// --- running ----------------------------------------------------------------

const toValue = (s) => (s === 'NULL' ? null : Number(s))

async function evaluate(query) {
  try {
    const out = await sql(query, SCHEMA)
    const rows = out === '' ? [] : out.replace(/\n$/, '').split('\n').map((line) => line.split('\t').map(toValue))
    return { sql: query, rows }
  } catch (e) {
    const stderr = String(e.stderr ?? e.message)
    const m = /ERROR (\d+)/.exec(stderr)
    return { sql: query, errno: m === null ? -1 : Number(m[1]) }
  }
}

const version = (await sql('SELECT VERSION()')).trim()
const setup = [
  `DROP DATABASE IF EXISTS ${SCHEMA}`,
  `CREATE DATABASE ${SCHEMA}`,
  ...NAMES.flatMap((t) => [
    `CREATE TABLE ${SCHEMA}.${t} (a INT, b INT)`,
    `INSERT INTO ${SCHEMA}.${t} VALUES ${TABLES[t].map((r) => `(${r.map((v) => (v === null ? 'NULL' : v)).join(', ')})`).join(', ')}`,
  ]),
].join(';\n')
await sql(setup)

const generate = (count, make) => {
  const seen = new Set()
  const out = []
  while (out.length < count && seen.size < count * 10) {
    const q = make()
    if (seen.has(q)) continue
    seen.add(q)
    out.push(q)
  }
  return out
}

const vectors = []
for (const q of [...generate(JOINS, joinQuery), ...generate(SETS, setQuery)]) vectors.push(await evaluate(q))
await sql(`DROP DATABASE ${SCHEMA}`)

// A corpus of errors checks nothing; one of no errors checks only half. The
// refusals matter — `t1, t2 JOIN t3 ON t1.a = t3.a` is ER_BAD_FIELD_ERROR, and
// that error *is* the grouping — but they must not be most of it.
const errnos = {}
for (const v of vectors) if (v.errno !== undefined) errnos[v.errno] = (errnos[v.errno] ?? 0) + 1
const answered = vectors.filter((v) => v.rows !== undefined).length
console.log(`${vectors.length} queries: ${answered} answered, refused ${JSON.stringify(errnos)}`)
if (answered < vectors.length * 0.5 || Object.keys(errnos).some((n) => !['1054', '1064'].includes(n))) {
  console.error('the generator is producing junk, or an error this corpus does not model')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const file = join(OUT_DIR, 'queries.json')
// One vector per line: a re-capture's diff then reads as the queries that
// changed, rather than as thousands of lines of re-indented row values.
const head = {
  name: 'queries',
  note:
    'Generated joins and set operations over three small tables, run by a real MySQL. The replay parses each ' +
    'query and evaluates the tree, so a grouping bug shows up as different rows or a different error.',
  capturedAgainst: `mysql-server ${version}`,
  seed: SEED,
  tables: TABLES,
}
const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
writeFileSync(file, `{\n${lines.join('\n')}\n  "vectors": [\n${vectors.map((v) => `    ${JSON.stringify(v)}`).join(',\n')}\n  ]\n}\n`)
console.log(`queries -> ${file}`)
