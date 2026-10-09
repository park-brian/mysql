// Text into temporal columns, replayed through the executor: the instrument
// for `temporal-scan.ts`.
//
// `tools/capture-temporal-text.mjs` stored generated strings into DATE,
// DATETIME(3), TIME(2) and TIMESTAMP columns on a real 8.4.11 — strictly and
// under IGNORE, in the default sql_mode and in none — following each INSERT
// with SHOW WARNINGS and each case with its rows. This replays every case and
// compares every statement: errors and their messages, counts, each
// warning's level, code and text, and the values as stored.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — a tool, in plain JavaScript; the replay runs each case exactly as the capture did.
import { runCase } from '../../tools/capture-temporal-text.mjs'

const FIXTURE = new URL('./fixtures/temporal-text.json', import.meta.url).pathname

interface Outcome {
  readonly sql: string
  readonly rows?: unknown
  readonly ok?: unknown
  readonly error?: unknown
}

test('every temporal text stored answers, warns and stores as 8.4.11 did', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { capturedAgainst: string; cases: Outcome[][] }
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  let statements = 0
  const mismatches: string[] = []
  try {
    for (const expected of fixture.cases) {
      const actual = (await runCase(conn, expected.map((s) => s.sql))) as Outcome[]
      expected.forEach((e, i) => {
        statements++
        const a = actual[i] as Outcome
        if (JSON.stringify(e) !== JSON.stringify(a)) mismatches.push(`${e.sql}\n    server ${JSON.stringify(e)}\n    ours   ${JSON.stringify(a)}`)
      })
    }
  } finally {
    await conn.end()
    await db.end()
  }
  console.log(`  [temporal-text] ${statements - mismatches.length} of ${statements} agree`)
  assert.ok(statements > 2000, `the corpus is too small to say anything: ${statements} statements`)
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} statements disagree`)
})
