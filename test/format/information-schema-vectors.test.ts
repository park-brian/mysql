// M5.12 — the INFORMATION_SCHEMA corpus, replayed through the executor.
//
// `tools/capture-information-schema.mjs` ran generated DDL scripts on a real
// 8.4.11, each followed by Prisma's introspection queries and every table
// filtered to the script's schema, and recorded what the server answered —
// columns and rows, statistics and clocks left out. This runs the same
// scripts here, through the tool's own runner so the two cannot drift, and
// holds the executor to every statement it accepts. One it refuses by name
// with ER_NOT_SUPPORTED_YET is counted, not failed, with the rest of its
// script, and `REFUSED_AT_MOST` ratchets down as M5.12 and M5.25 land —
// captured before any of their code, so it starts at nearly everything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — a tool, in plain JavaScript.
import { CONNECTION, SCHEMA, runScript } from '../../tools/capture-information-schema.mjs'

const FIXTURE = new URL('./fixtures/information-schema.json', import.meta.url).pathname
const NOT_SUPPORTED = 1235

/** The most statements the executor may still refuse. Lowered by M5.12's and M5.25's stages, never raised. */
const REFUSED_AT_MOST = 0

interface Outcome {
  readonly sql: string
  readonly ok?: boolean
  readonly select?: boolean
  readonly error?: number
  readonly columns?: unknown
  readonly rows?: readonly unknown[]
}

test('M5.12: every INFORMATION_SCHEMA statement the executor runs returns what the server returned', async () => {
  if (!existsSync(FIXTURE)) return
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    capturedAgainst: string
    columns: Record<string, string[]>
    cases: Outcome[][]
  }
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  const { host: _h, port: _p, user: _u, password: _w, ...options } = CONNECTION as Record<string, unknown>
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream() as never,
    user: 'root',
    password: '',
    ...options,
  })
  let statements = 0
  let agreed = 0
  let refused = 0
  const mismatches: string[] = []
  try {
    for (const expected of fixture.cases) {
      const actual = (await runScript(
        conn,
        SCHEMA,
        expected.filter((s) => s.select !== true).map((s) => s.sql),
        fixture.columns,
      )) as Outcome[]
      for (let i = 0; i < expected.length; i++) {
        const e = expected[i] as Outcome
        const a = actual[i] as Outcome
        statements++
        if (a.error === NOT_SUPPORTED && e.error !== NOT_SUPPORTED) {
          // A diverged state makes the rest of the script noise.
          refused += expected.length - i
          statements += expected.length - i - 1
          break
        }
        // Without an ORDER BY the server's order is its own; compare those as a multiset.
        const ordered = !/order by/i.test(e.sql)
        const rows = (r: readonly unknown[] | undefined) => (ordered ? r : r?.map((x) => JSON.stringify(x)).sort())
        const same =
          JSON.stringify({
            ok: e.ok,
            error: e.error,
            columns: e.columns,
            rows: rows(e.rows),
          }) ===
          JSON.stringify({
            ok: a.ok,
            error: a.error,
            columns: a.columns,
            rows: rows(a.rows),
          })
        if (!same) {
          const { sql: _e, ...want } = e
          const { sql: _a, ...got } = a
          statements += expected.length - i - 1
          mismatches.push(`${e.sql.replace(/\s+/g, ' ').slice(0, 300)}\n    server ${JSON.stringify(want).slice(0, 1500)}\n    ours   ${JSON.stringify(got).slice(0, 1500)}`)
          break
        }
        agreed++
      }
    }
  } finally {
    await conn.end()
    await db.end()
  }
  console.log(`  [information_schema] ${agreed} of ${statements} agree, ${refused} refused`)
  assert.ok(statements > 2000, `the corpus is too small to say anything: ${statements} statements`)
  if (process.env.SHOW_MISMATCHES !== undefined) for (const m of mismatches) console.log(m)
  assert.deepEqual(mismatches.slice(0, 3), [], `${mismatches.length} statements disagree`)
  assert.ok(refused <= REFUSED_AT_MOST, `${refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
})
