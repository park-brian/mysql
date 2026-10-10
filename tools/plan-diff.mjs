// The relational corpus's plans, ours against 8.4.11's: how many skeletons
// agree, and the most common ways they do not (M5.44). A working instrument
// for the planner, not a test: `relational-vectors.test.ts` ratchets the count.
//
//   node tools/plan-diff.mjs [--fixture relational] [--show 20] [--match text]
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { arg } from './lib/cli.mjs'
import { CONNECTION, runCase } from './capture-relational.mjs'

const name = arg('fixture', 'relational')
const show = Number(arg('show', '15'))
const match = arg('match', '')
const exclude = arg('exclude', '')
const fixture = JSON.parse(readFileSync(new URL(`../test/format/fixtures/${name}.json`, import.meta.url), 'utf8'))
const db = await MySQL.open(':memory:')
const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', ...CONNECTION })
await conn.query(`SET sql_mode = '${fixture.sqlMode}'`)
let total = 0
let agree = 0
const shapes = new Map()
for (const expected of fixture.cases) {
  const actual = await runCase(conn, expected.map(({ sql, select, ordered, serverOnly }) => ({ sql, select, ordered, serverOnly })), { warnings: false })
  expected.forEach((e, i) => {
    if (e.select !== true || typeof e.plan !== 'string') return
    total++
    const ours = actual[i]?.plan ?? '(none)'
    if (ours === e.plan) return void agree++
    if (match !== '' && !e.plan.includes(match) && !ours.includes(match)) return
    if (exclude !== '' && new RegExp(exclude).test(`${e.plan}\n${ours}\n${e.sql}`)) return
    const key = `${e.plan}\n  ours:\n${ours}`
    const s = shapes.get(key) ?? { n: 0, sql: e.sql }
    s.n++
    shapes.set(key, s)
  })
}
await conn.end()
await db.end()
console.log(`${name}: ${agree} of ${total} plans agree`)
const by = new Map()
for (const [key, v] of shapes) {
  const [server, ours] = key.split('\n  ours:\n')
  const k = `${ours === '(none)' ? 'undescribed' : 'differs'}: ${server.split('\n')[0]}`
  by.set(k, (by.get(k) ?? 0) + v.n)
}
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${k}`)
for (const [key, s] of [...shapes].sort((a, b) => b[1].n - a[1].n).slice(0, show)) console.log(`\n${s.n}x  ${s.sql}\n${key}`)
