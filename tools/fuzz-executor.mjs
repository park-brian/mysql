#!/usr/bin/env node
// M5.17 — the executor fuzz target: ground rule 5, one layer up.
//
// The parser fuzzer proves that no text crashes the parser. Text that parses
// still reaches the executor, which converts values, plans ranges, encodes
// keys and writes pages — every one of them a place a hostile or merely odd
// statement could find an untyped exception or a hang. So: statements from
// the execution corpus's own generator, run against a seeded table, with up
// to three tokens swapped for values chosen to sit on a boundary — the
// extremes of BIGINT, NULL, empty strings, a lone byte, a placeholder with no
// parameter. Any answer is fine except two: ER_INTERNAL_ERROR, which is what
// the executor turns an untyped exception into, and taking too long.
//
//   FUZZ_RUNS=20000 FUZZ_SEED=1 node tools/fuzz-executor.mjs
import { Session, capabilities, CHARSET_UTF8MB4_0900_AI_CI } from '@myjs/protocol'
import { Catalog, Store } from '@myjs/engine'
import { MemoryVfs } from '@myjs/vfs'
import { SqlExecutor, charsetTranscoder } from '@myjs/core'
import { SCHEMA, SQL_MODE, generateCase } from './capture-execution.mjs'
import { xorshift } from './lib/cli.mjs'

const RUNS = Number(process.env.FUZZ_RUNS ?? 20_000)
const SEED = Number(process.env.FUZZ_SEED ?? (Date.now() & 0x7fffffff))
const BUDGET_MS = Number(process.env.FUZZ_INPUT_BUDGET_MS ?? 2_000)

/** xorshift32, seeded (`tools/lib/cli.mjs`), so a seed reproduces the corpus. */
const { rnd, pick } = xorshift(SEED)

/** Values on a boundary of something: a type's range, a charset, the parser, the planner. */
const BOUNDARIES = [
  'NULL', "''", "' '", '0', '-0', '0.0', '-1', '1e308', '-1e308', '1e-320', '9223372036854775807', '-9223372036854775808',
  '18446744073709551615', '18446744073709551616', '99999999999999999999999999999999999.99', "'Ä'", "'ß'", "'\\0'",
  '0x00', '0xff', "x''", "b''", "'2024-02-30'", "'0000-00-00'", "'9999-12-31 23:59:59.999999'", "'-838:59:59'",
  '?', '@a', '@@sql_mode', 'DEFAULT', '(1)', '(NULL)', "_binary'x'", "'x' COLLATE utf8mb4_bin", 'TRUE', '~0', '1 DIV 0',
]

function tokens(sql) {
  return sql.match(/'(?:[^'\\]|\\.)*'|0x[0-9a-f]+|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\S/gi) ?? []
}

function mutate(sql) {
  const t = tokens(sql)
  const n = 1 + Math.floor(rnd() * 3)
  for (let i = 0; i < n && t.length > 0; i++) {
    const at = Math.floor(rnd() * t.length)
    // Literals and numbers are swapped for boundary values; anything else, rarely.
    if (/^['0-9x]/i.test(t[at]) || rnd() < 0.1) t[at] = pick(BOUNDARIES)
  }
  return t.join(' ')
}

const store = Store.create(...(await Promise.all([new MemoryVfs().open('d', { create: true }), new MemoryVfs().open('l', { create: true })])))
const catalog = Catalog.open(store)
const executor = new SqlExecutor({ catalog })
const session = new Session({ connectionId: 1, capabilities: capabilities(0xffffffff), transcoder: charsetTranscoder, characterSet: CHARSET_UTF8MB4_0900_AI_CI })

async function run(sql) {
  const started = Date.now()
  try {
    await executor.query(session, sql)
  } catch (e) {
    if (e?.errno === undefined || e.errno === 1815) return { crash: e }
  }
  if (Date.now() - started > BUDGET_MS) return { crash: new Error(`took ${Date.now() - started} ms`) }
  return {}
}

await run(`CREATE DATABASE ${SCHEMA}`)
await run(`USE ${SCHEMA}`)
await run(`SET sql_mode = '${SQL_MODE}'`)

console.log(`executor fuzz: ${RUNS} statements, seed ${SEED}`)
let statements = 0

const crashes = []
while (statements < RUNS && crashes.length < 5) {
  // A fresh case: drop whatever is there, make its table, seed it.
  const script = generateCase()
  for (const name of ['p', 'k', 'h', 'l']) await run(`DROP TABLE IF EXISTS ${name}`)
  for (const sql of script) {
    const text = statements % 3 === 0 ? sql : mutate(sql)
    statements++
    const r = await run(text)
    if (r.crash !== undefined) crashes.push({ sql: text, error: String(r.crash?.stack ?? r.crash) })

    if (statements >= RUNS) break
  }
  // Mid-transaction states too: a rolled-back savepoint, a statement that fails inside one.
  if (rnd() < 0.2) {
    await run('BEGIN')
    await run(mutate(pick(script)))
    await run(pick(['ROLLBACK', 'COMMIT']))
  }
}
await executor.end?.(session)
store.close()

if (crashes.length > 0) {
  for (const c of crashes) console.error(`CRASH on: ${c.sql}\n  ${c.error.split('\n').slice(0, 4).join('\n  ')}`)
  console.error(`seed ${SEED}`)
  process.exit(1)
}
console.log(`executor fuzz: ${statements} statements, no crash, no hang (seed ${SEED})`)

