// M5.10 — the remaining string, numeric, hashing and network functions, replayed through the executor.
//
// `tools/capture-more-functions.mjs` ran generated calls of the remaining
// string, numeric, hashing and network functions on a real 8.4.11 through
// `mysql2`, each SELECT
// through both protocols with its metadata and warning count, before any of
// the functions were written. This replays them through M5.18's machinery. A
// statement the executor refuses by name with ER_NOT_SUPPORTED_YET is
// counted, not failed, and `REFUSED_AT_MOST` ratchets down.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
// @ts-expect-error — a tool, in plain JavaScript; its options are the capture's, so the replay cannot drift from it.
import { CONNECTION, SQL_MODE } from '../../tools/capture-more-functions.mjs'
import { replay, type Fixture } from '../lib/replay.ts'

const FIXTURE = new URL('./fixtures/more-functions.json', import.meta.url).pathname

/** The most statements the executor may still refuse. Lowered as the functions land, never raised. */
const REFUSED_AT_MOST = 0

test('M5.10: every string, numeric, hashing and network function call returns what the server returned', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  // LN, LOG, ATAN2 and POW may be an ulp or two from the server's: its libm's last bit, not MySQL's rule.
  const t = await replay(fixture, CONNECTION as Record<string, unknown>, 4)
  console.log(`  [more-functions] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; warning counts differ on ${t.warningMismatches.length} of ${t.warningsCompared}`)
  if (process.env.MISMATCHES === '1') console.log(t.mismatches.join('\n'))
  if (process.env.WARNINGS === '1') console.log(t.warningMismatches.join('\n'))
  assert.ok(t.statements > 2000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.deepEqual(t.mismatches.slice(0, 5), [], `${t.mismatches.length} statements disagree`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
  assert.deepEqual(t.warningMismatches.slice(0, 5), [], `${t.warningMismatches.length} queries' warning counts disagree`)
})
