// The relational corpus's replay (M5.18), shared by every corpus captured with
// `tools/capture-relational.mjs`'s runner: relational, JSON and the three
// function corpora. It lives outside the test files because importing a test
// file registers its tests, and each importer re-ran the relational corpus.
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — a tool, in plain JavaScript; its runner is shared so the replay cannot drift from the capture.
import { CONNECTION, runCase } from '../../tools/capture-relational.mjs'

const NOT_SUPPORTED = 1235

/**
 * Plan strategies 8.4.11 chooses by cost that this executor does not have
 * yet (M5.7). Where the server's plan uses one, what it materializes — and
 * so the column flags a client sees — is a cost decision too, so those are
 * not compared; the rows (as a multiset) and the error still are, and the
 * case is counted.
 */
const UNMODELLED: readonly (string | RegExp)[] = [
  // LooseScan, a semijoin strategy (M5.47).
  'Remove duplicates from input sorted on',
]
const unmodelled = (plan: string | null | undefined): boolean => UNMODELLED.some((m) => (typeof m === 'string' ? plan?.includes(m) === true : plan !== null && plan !== undefined && m.test(plan)))

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

export interface Fixture {
  readonly capturedAgainst: string
  readonly sqlMode: string
  /** The clock the corpus was captured at (`SET TIMESTAMP`), where its answers depend on the date. */
  readonly timestamp?: number
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
  /** Queries whose `EXPLAIN FORMAT=TREE` skeleton is the server's (M5.44), of those the server explained. */
  plansAgreed: number
  plansExplained: number
  /** Queries compared as a multiset, and of those, how many came back in the server's order anyway. */
  unordered: number
  unorderedInOrder: number
  /** Queries whose server plan used a strategy listed in UNMODELLED. */
  unmodelled: number
  mismatches: string[]
  /** Queries that agree whose warning count was compared, and those whose count did not (M5.28). */
  warningsCompared: number
  warningMismatches: string[]
}

const textOf = (o: Answer): Answer => (o.error !== undefined ? { error: o.error } : { columns: o.columns, rows: o.rows })
const sorted = (rows: readonly unknown[] | undefined): string[] | undefined => rows?.map((r) => JSON.stringify(r)).sort()

/** Two answers to one query: equal, equal but in another order, or different. */
function compare(want: Answer, got: Answer): 'equal' | 'reordered' | 'different' {
  if (JSON.stringify(textOf(want)) === JSON.stringify(textOf(got))) return 'equal'
  if (JSON.stringify(want.error) !== JSON.stringify(got.error) || JSON.stringify(want.columns) !== JSON.stringify(got.columns)) return 'different'
  return JSON.stringify(sorted(want.rows)) === JSON.stringify(sorted(got.rows)) ? 'reordered' : 'different'
}

/**
 * `got`'s DOUBLE cells that are within `ulps` units in the last place of
 * `want`'s, made `want`'s. A transcendental function's last bit is the
 * platform's `libm`: the server's and the engine's round LN(3) one ulp
 * apart, and neither is wrong by more. Nothing else is loosened.
 */
function snapDoubles(want: Answer, got: Answer, ulps: number): Answer {
  const columns = want.columns as readonly (readonly unknown[])[] | undefined
  if (columns === undefined || want.rows === undefined || got.rows === undefined || want.rows.length !== got.rows.length) return got
  const doubles = columns.map((c) => c[1] === 5)
  if (!doubles.includes(true)) return got
  const near = (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    const x = Number(a)
    const y = Number(b)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    return Math.abs(x - y) <= ulps * Number.EPSILON * Math.max(Math.abs(x), Math.abs(y))
  }
  const rows = got.rows.map((row, i) => (row as unknown[]).map((cell, k) => (doubles[k] === true && cell !== (want.rows?.[i] as unknown[])[k] && near((want.rows?.[i] as unknown[])[k], cell) ? (want.rows?.[i] as unknown[])[k] : cell)))
  return { ...got, rows }
}

/** Replay a captured corpus through the executor. `connection` is the driver's options the corpus was captured with; `ulps` loosens DOUBLE cells by that many units in the last place. */
export async function replay(fixture: Fixture, connection: Record<string, unknown> = CONNECTION, ulps = 0): Promise<Tally> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', ...connection })
  await conn.query(`SET sql_mode = '${fixture.sqlMode}'`)
  if (fixture.timestamp !== undefined) await conn.query(`SET TIMESTAMP = ${fixture.timestamp}`)
  const tally: Tally = { statements: 0, agreed: 0, refused: 0, orderedByStatement: 0, orderedByPlan: 0, plansAgreed: 0, plansExplained: 0, unordered: 0, unorderedInOrder: 0, unmodelled: 0, mismatches: [], warningsCompared: 0, warningMismatches: [] }
  try {
    for (const expected of fixture.cases) {
      const actual = (await runCase(conn, expected.map(({ sql, select, ordered, serverOnly }) => ({ sql, select, ordered, serverOnly })), { warnings: true })) as Outcome[]
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
        if (e.select === true && typeof e.plan === 'string') {
          tally.plansExplained++
          if (a.plan === e.plan) tally.plansAgreed++
        }
        let agrees: boolean
        if (e.select !== true) {
          agrees = JSON.stringify({ ok: e.ok, error: e.error }) === JSON.stringify({ ok: a.ok, error: a.error })
        } else if (unmodelled(e.plan)) {
          tally.unmodelled++
          agrees = JSON.stringify(e.error) === JSON.stringify(a.error) && JSON.stringify(sorted(e.rows)) === JSON.stringify(sorted(a.rows))
        } else {
          const strict = e.ordered === true || (e.plan !== undefined && e.plan !== null && a.plan === e.plan)
          if (e.ordered === true) tally.orderedByStatement++
          else if (strict) tally.orderedByPlan++
          const text = compare(e, ulps > 0 ? { ...a, ...snapDoubles(e, a, ulps) } : a)
          const wantBinary = e.binary === 'same' || e.binary === undefined ? textOf(e) : e.binary
          const gotBinary0 = a.binary === 'same' || a.binary === undefined ? textOf(a) : a.binary
          const gotBinary = ulps > 0 ? snapDoubles(wantBinary, gotBinary0, ulps) : gotBinary0
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
        if (e.select === true && e.warnings !== undefined) {
          tally.warningsCompared++
          if (e.warnings !== a.warnings) tally.warningMismatches.push(`${e.sql}\n    server ${e.warnings} warnings, ours ${a.warnings}`)
        }
      }
    }
  } finally {
    await conn.end()
    await db.end()
  }
  return tally
}
