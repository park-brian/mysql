// M5.17 — the executor against a real MySQL: every captured script, replayed.
//
// `tools/capture-execution.mjs` ran generated scripts on 8.4.11 through
// `mysql2` and recorded, per statement, the rows, the column metadata, the
// counters and the error. This runs the same scripts against our executor
// through the same driver, so the two sides differ in nothing but the server,
// and requires the same answer everywhere — doc 43 §2's list, in its order.
//
// The fixture is committed facts only: statements this project generated and
// the results a server gave for them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — a tool, in plain JavaScript; its runner is shared so the replay cannot drift from the capture.
import { SQL_MODE, runCase } from '../../tools/capture-execution.mjs'

const FIXTURE = new URL('./fixtures/execution.json', import.meta.url).pathname

interface Outcome {
  readonly sql: string
  readonly ok?: unknown
  readonly columns?: unknown
  readonly rows?: unknown
  readonly error?: [number, string]
}

interface Fixture {
  readonly capturedAgainst: string
  readonly sqlMode: string
  readonly cases: readonly (readonly Outcome[])[]
}

/** Replay every case; the mismatches, described. */
export async function replay(fixture: Fixture): Promise<{ statements: number; mismatches: string[] }> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', charset: 'utf8mb4_0900_ai_ci' })
  await conn.query(`SET sql_mode = '${fixture.sqlMode}'`)
  const mismatches: string[] = []
  let statements = 0
  try {
    for (const expected of fixture.cases) {
      const actual = (await runCase(conn, expected.map((o) => o.sql))) as Outcome[]
      for (let i = 0; i < expected.length; i++) {
        statements++
        const e = expected[i] as Outcome
        const a = actual[i] as Outcome
        const { sql: _e, ...want } = e
        const { sql: _a, ...got } = a
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          mismatches.push(`${e.sql}\n    server ${JSON.stringify(want)}\n    ours   ${JSON.stringify(got)}`)
          // A diverged state makes every later statement of the case noise.
          break
        }
      }
    }
  } finally {
    await conn.end()
    await db.end()
  }
  return { statements, mismatches }
}

test('M5.17: every captured script returns what the server returned', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const { statements, mismatches } = await replay(fixture)
  assert.ok(statements > 1000, `the corpus is too small to say anything: ${statements} statements`)
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} of ${fixture.cases.length} cases disagree`)
})
