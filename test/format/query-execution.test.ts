// M5.18 — the query-grouping corpus, run by the executor rather than evaluated.
//
// `queries.json` (M3.16) records what 8.4.11 returned for 700 joins and 500
// set operations over three small tables. `query-vectors.test.ts` checks the
// parser against it with an evaluator of its own; this runs the same SQL
// through `mysql2` against the executor, so the rows are the executor's. The
// corpus records rows and errors, not metadata, and its queries carry no
// ORDER BY, so rows are compared as multisets and agreement on order is only
// counted. Refusals by name are counted against a ratchet, as in
// `relational-vectors.test.ts`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const FIXTURE = new URL('./fixtures/queries.json', import.meta.url).pathname

/** The most vectors the executor may still refuse. Lowered as M5.18's stages land, never raised. */
const REFUSED_AT_MOST = 0

interface Vector {
  readonly sql: string
  readonly rows?: readonly (readonly (number | null)[])[]
  readonly errno?: number
}

interface Fixture {
  readonly tables: Readonly<Record<string, readonly (readonly (number | null)[])[]>>
  readonly vectors: readonly Vector[]
}

test('M5.18: the executor answers the query-grouping corpus as 8.4.11 did', async () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  let refused = 0
  let agreed = 0
  let inOrder = 0
  const mismatches: string[] = []
  try {
    await conn.query('CREATE DATABASE q')
    await conn.query('USE q')
    for (const [name, rows] of Object.entries(fixture.tables)) {
      await conn.query(`CREATE TABLE ${name} (a INT, b INT)`)
      await conn.query(`INSERT INTO ${name} VALUES ${rows.map((r) => `(${r.map((v) => (v === null ? 'NULL' : v)).join(', ')})`).join(', ')}`)
    }
    for (const v of fixture.vectors) {
      let got: { rows?: unknown[]; errno?: number }
      try {
        const [rows] = await conn.query({ sql: v.sql, rowsAsArray: true })
        got = { rows: rows as unknown[] }
      } catch (e) {
        got = { errno: (e as { errno: number }).errno }
      }
      if (got.errno === 1235 && v.errno !== 1235) {
        refused++
        continue
      }
      const same = JSON.stringify(got.errno) === JSON.stringify(v.errno) && JSON.stringify(got.rows?.map((r) => JSON.stringify(r)).sort()) === JSON.stringify(v.rows?.map((r) => JSON.stringify(r)).sort())
      if (!same) {
        mismatches.push(`${v.sql}\n    server ${JSON.stringify({ rows: v.rows, errno: v.errno })}\n    ours   ${JSON.stringify(got)}`)
        continue
      }
      agreed++
      if (JSON.stringify(got.rows) === JSON.stringify(v.rows)) inOrder++
    }
  } finally {
    await conn.end()
    await db.end()
  }
  console.log(`  [query-execution] ${agreed} of ${fixture.vectors.length} agree (${inOrder} in the server's order), ${refused} refused`)
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} vectors disagree`)
  assert.ok(refused <= REFUSED_AT_MOST, `${refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
})
