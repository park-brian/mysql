// M5.18 — the executor against a real MySQL, many tables at a time.
//
// `tools/capture-relational.mjs` ran generated multi-table scripts on 8.4.11
// through `mysql2` and recorded each statement's rows, metadata, counters and
// error, and for each SELECT its binary-protocol answer and its plan skeleton.
// This runs the same scripts against our executor through the same driver.
//
// Rows are compared in order where the statement fixes the order (a total
// `ORDER BY`) or where our plan's skeleton is the server's, since order is a
// function of the plan (M5.18). Elsewhere they are compared as a multiset, and
// the case counts as one whose order went unchecked.
//
// A statement the executor refuses with ER_NOT_SUPPORTED_YET, where the server
// did not, is counted rather than failed: the corpus was captured before the
// operators it checks, and `REFUSED_AT_MOST` ratchets down as each lands. A
// refused write ends its case, since the state after it is no longer the
// server's; a refused query does not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — a tool, in plain JavaScript; its runner is shared so the replay cannot drift from the capture.
import { CONNECTION, SQL_MODE, runCase } from '../../tools/capture-relational.mjs'

const FIXTURE = new URL('./fixtures/relational.json', import.meta.url).pathname

/** The most statements the executor may still refuse. Lowered by every stage of M5.18, never raised. */
const REFUSED_AT_MOST = 1424

const NOT_SUPPORTED = 1235

interface Answer {
  readonly columns?: unknown
  readonly rows?: readonly unknown[] | undefined
  readonly error?: [number, string] | undefined
}

interface Outcome extends Answer {
  readonly sql: string
  readonly select?: boolean
  readonly ordered?: boolean
  readonly serverOnly?: boolean
  readonly ok?: unknown
  readonly binary?: Answer | 'same'
  readonly plan?: string | null
  readonly warnings?: number
}

interface Fixture {
  readonly capturedAgainst: string
  readonly sqlMode: string
  readonly cases: readonly (readonly Outcome[])[]
}

export interface Tally {
  statements: number
  agreed: number
  refused: number
  /** Queries whose row order was compared because the statement fixes it. */
  orderedByStatement: number
  /** Queries whose row order was compared because our plan is the server's. */
  orderedByPlan: number
  /** Queries compared as a multiset, and of those, how many came back in the server's order anyway. */
  unordered: number
  unorderedInOrder: number
  mismatches: string[]
}

const textOf = (o: Answer): Answer => (o.error !== undefined ? { error: o.error } : { columns: o.columns, rows: o.rows })
const sorted = (rows: readonly unknown[] | undefined): string[] | undefined => rows?.map((r) => JSON.stringify(r)).sort()

/** Two answers to one query: equal, equal but in another order, or different. */
function compare(want: Answer, got: Answer): 'equal' | 'reordered' | 'different' {
  if (JSON.stringify(textOf(want)) === JSON.stringify(textOf(got))) return 'equal'
  if (JSON.stringify(want.error) !== JSON.stringify(got.error) || JSON.stringify(want.columns) !== JSON.stringify(got.columns)) return 'different'
  return JSON.stringify(sorted(want.rows)) === JSON.stringify(sorted(got.rows)) ? 'reordered' : 'different'
}

export async function replay(fixture: Fixture): Promise<Tally> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', ...CONNECTION })
  await conn.query(`SET sql_mode = '${fixture.sqlMode}'`)
  const tally: Tally = { statements: 0, agreed: 0, refused: 0, orderedByStatement: 0, orderedByPlan: 0, unordered: 0, unorderedInOrder: 0, mismatches: [] }
  try {
    for (const expected of fixture.cases) {
      const actual = (await runCase(conn, expected.map(({ sql, select, ordered, serverOnly }) => ({ sql, select, ordered, serverOnly })))) as Outcome[]
      for (let i = 0; i < expected.length; i++) {
        const e = expected[i] as Outcome
        const a = actual[i] as Outcome
        if (e.serverOnly === true) continue
        tally.statements++
        if (a.error?.[0] === NOT_SUPPORTED && e.error?.[0] !== NOT_SUPPORTED) {
          tally.refused++
          if (e.select === true) continue
          tally.statements += expected.slice(i + 1).filter((s) => s.serverOnly !== true).length
          tally.refused += expected.slice(i + 1).filter((s) => s.serverOnly !== true).length
          break
        }
        let agrees: boolean
        if (e.select !== true) {
          agrees = JSON.stringify({ ok: e.ok, error: e.error }) === JSON.stringify({ ok: a.ok, error: a.error })
        } else {
          const strict = e.ordered === true || (e.plan !== undefined && e.plan !== null && a.plan === e.plan)
          if (e.ordered === true) tally.orderedByStatement++
          else if (strict) tally.orderedByPlan++
          const text = compare(e, a)
          const wantBinary = e.binary === 'same' || e.binary === undefined ? textOf(e) : e.binary
          const gotBinary = a.binary === 'same' || a.binary === undefined ? textOf(a) : a.binary
          const binary = compare(wantBinary, gotBinary)
          agrees = text !== 'different' && binary !== 'different' && (!strict || (text === 'equal' && binary === 'equal'))
          if (agrees && !strict) {
            tally.unordered++
            if (text === 'equal') tally.unorderedInOrder++
          }
        }
        if (!agrees) {
          const { sql: _e, ...want } = e
          const { sql: _a, ...got } = a
          tally.mismatches.push(`${e.sql}\n    server ${JSON.stringify(want)}\n    ours   ${JSON.stringify(got)}`)
          // A diverged state makes every later statement of the case noise.
          break
        }
        tally.agreed++
      }
    }
  } finally {
    await conn.end()
    await db.end()
  }
  return tally
}

test('M5.18: every relational statement the executor runs returns what the server returned', async () => {
  if (!existsSync(FIXTURE)) return
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const t = await replay(fixture)
  console.log(
    `  [relational] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; order checked ${t.orderedByStatement} by ORDER BY, ` +
      `${t.orderedByPlan} by plan; ${t.unordered} compared as multisets (${t.unorderedInOrder} in the server's order anyway)`,
  )
  assert.ok(t.statements > 4000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.deepEqual(t.mismatches.slice(0, 5), [], `${t.mismatches.length} statements disagree`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
})
