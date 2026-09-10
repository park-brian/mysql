#!/usr/bin/env node
// M3.2 — capture operator-precedence vectors from a real MySQL.
//
// The acceptance clause is "precedence matches a real server across a generated
// expression corpus", and it is worded that way because precedence is the one
// part of a parser that cannot be checked against itself. A parser with `*` and
// `+` the wrong way round still parses, still builds a tree, still evaluates —
// and quietly answers `1+2*3 = 9`. Hand-written cases only catch the mistakes
// you already thought of.
//
// So: generate expressions, have a real 8.4 evaluate each one, and commit the
// answers. The replay parses the expression and evaluates the *tree*, which is
// what makes this a differential test rather than a tautology — the test-side
// evaluator knows nothing about precedence, so it cannot share the parser's
// mistake. A misgrouped tree comes out as a wrong number.
//
// Deliberately integers only. `/` returns DECIMAL and the float family is
// inexact, so including them would test formatting rather than grouping; the
// arithmetic here is exact in `BigInt` on both sides.
//
// Usage:
//   node tools/capture-precedence.mjs --host 127.0.0.1 --port 3306 --user root --password root
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
const COUNT = Number(arg('count', '1200'))
const SEED = Number(arg('seed', '20260910'))

// No `--ssl-mode=DISABLED`: `caching_sha2_password` refuses its full handshake
// over plaintext unless the account is already cached. Nothing here is a
// recorded byte stream, so TLS costs nothing. (The same fix as `capture-types`.)
const CONNECT = ['-h', HOST, '-P', String(PORT), '--protocol=TCP', '-u', USER, `-p${PASSWORD}`]

async function sql(statements) {
  const { stdout } = await run('mysql', [...CONNECT, '-N', '-B', '-e', statements], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

async function serverVersion() {
  return (await sql('SELECT VERSION()')).trim()
}

async function clientVersion() {
  return (await run('mysql', ['--version'], { encoding: 'utf8' })).stdout.trim()
}

// --- the corpus -------------------------------------------------------------

/**
 * Binary operators, **grouped by precedence level**.
 *
 * The grouping is what makes the corpus worth capturing. A generator picking
 * uniformly from a flat list of seventeen operators rarely puts two *adjacent*
 * operators from *different* levels next to each other — and that is the only
 * shape that can detect a precedence bug at all. The first version of this was
 * flat, and swapping `*` with `+` in the parser's table disagreed on just 2 of
 * 328 vectors: caught, but by a margin thin enough to be luck. Picking from two
 * different groups on purpose is the fix.
 *
 * `^` is in its own group because it is a frequent misreading: in MySQL it is
 * bitwise XOR, not exponentiation, and it binds *tighter* than `*`.
 */
const LEVELS = [
  ['OR'],
  ['XOR'],
  ['AND'],
  ['=', '<', '>', '<=>'],
  ['|'],
  ['&'],
  ['<<', '>>'],
  ['+', '-'],
  ['*', 'DIV', '%'],
  ['^'],
]
const BINARY = LEVELS.flat()

/** Two operators from different levels, which is the case worth generating. */
function twoLevels() {
  const a = Math.floor(rnd() * LEVELS.length)
  let b = Math.floor(rnd() * LEVELS.length)
  if (b === a) b = (b + 1) % LEVELS.length
  return [pick(LEVELS[a]), pick(LEVELS[b])]
}

/** Prefix operators. `NOT` is the one whose precedence `sql_mode` can move. */
const UNARY = ['-', '~', '!', 'NOT']

/** xorshift32 — the same reproducible generator `fuzz-reader.mjs` uses. */
let state = SEED || 1
function rnd() {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) / 0x100000000
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]

/**
 * One expression.
 *
 * Operands stay in 0..7 and the depth is capped, because a BIGINT overflow is
 * an error rather than a value and a corpus of errors checks nothing. `~`
 * produces numbers near 2^64, so it is only ever applied to a leaf.
 */
function expression(depth) {
  if (depth <= 0 || rnd() < 0.25) return leaf()
  const roll = rnd()
  if (roll < 0.12) return `${pick(UNARY)} ${expression(depth - 1)}`
  if (roll < 0.2) return `(${expression(depth - 1)})`
  // The majority case: a flat three-operand chain whose two operators come
  // from *different* precedence levels, so the grouping is observable. Without
  // this most vectors have one operator, or two from the same level, and
  // neither can tell a correct table from a scrambled one.
  if (roll < 0.75) {
    const [a, b] = twoLevels()
    return `${leaf()} ${a} ${leaf()} ${b} ${leaf()}`
  }
  return `${expression(depth - 1)} ${pick(BINARY)} ${expression(depth - 1)}`
}

function leaf() {
  const n = Math.floor(rnd() * 8)
  return rnd() < 0.2 ? `${pick(UNARY)} ${n}` : String(n)
}

/**
 * Ask the server for one expression's value.
 *
 * An expression that errors is recorded as an error rather than dropped: an
 * overflow or a type clash is still a fact about the server, and recording it
 * keeps the corpus honest about what it does and does not cover.
 */
async function evaluate(expr) {
  try {
    const out = await sql(`SELECT (${expr})`)
    return { expr, value: out.trim() }
  } catch (e) {
    const stderr = String(e.stderr ?? e.message).trim()
    const first = stderr.split('\n').find((l) => l.startsWith('ERROR')) ?? stderr.split('\n')[0]
    return { expr, error: first }
  }
}

function writeFixture(name, note, payload) {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${name}.json`)
  writeFileSync(file, JSON.stringify({ name, note, ...payload }, null, 2) + '\n')
  return file
}

// --- main -------------------------------------------------------------------

const version = await serverVersion()

// Generated first and de-duplicated, so the same expression is not paid for
// twice and the committed corpus is a set rather than a bag.
const seen = new Set()
const expressions = []
while (expressions.length < COUNT && seen.size < COUNT * 4) {
  const expr = expression(3)
  if (seen.has(expr)) continue
  seen.add(expr)
  expressions.push(expr)
}

const vectors = []
for (const expr of expressions) vectors.push(await evaluate(expr))

const valued = vectors.filter((v) => v.value !== undefined).length
console.log(`${vectors.length} expression(s): ${valued} evaluated, ${vectors.length - valued} refused by the server`)

// A corpus that is mostly errors would pass a replay while checking almost
// nothing — M2.22's lesson, applied to a third gate. Fail rather than commit
// one, and say the number.
if (valued < vectors.length * 0.6) {
  console.error(`only ${valued}/${vectors.length} expressions evaluated; the generator is producing junk`)
  process.exit(1)
}

const file = writeFixture(
  'precedence',
  'Generated expressions evaluated by a real MySQL. The replay parses each one and evaluates the tree, so a precedence bug shows up as a wrong number.',
  {
    capturedAgainst: `mysql-server ${version}`,
    capturedWith: await clientVersion(),
    seed: SEED,
    vectors,
  },
)
console.log(`precedence -> ${file}`)
