// M5.10 — the date and time function corpus, replayed through the executor.
//
// `tools/capture-temporal-functions.mjs` ran generated calls of the date and
// time functions on a real 8.4.11 in UTC through `mysql2`, each SELECT
// through both protocols with its metadata and warning count, before any of
// the functions were written. This replays them through M5.18's machinery. A
// statement the executor refuses by name with ER_NOT_SUPPORTED_YET is
// counted, not failed, and `REFUSED_AT_MOST` ratchets down.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
// @ts-expect-error — a tool, in plain JavaScript; its options are the capture's, so the replay cannot drift from it.
import { CONNECTION, SQL_MODE } from '../../tools/capture-temporal-functions.mjs'
import { replay, type Fixture } from '../lib/replay.ts'

const FIXTURE = new URL('./fixtures/temporal-functions.json', import.meta.url).pathname

/** The most statements the executor may still refuse. Lowered as the functions land, never raised. */
const REFUSED_AT_MOST = 0

test('M5.10: every date and time function call returns what the server returned', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const t = await replay(fixture, CONNECTION as Record<string, unknown>)
  console.log(`  [temporal-functions] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; warning counts differ on ${t.warningMismatches.length} of ${t.warningsCompared}`)
  if (process.env.MISMATCHES === '1') console.log(t.mismatches.join('\n'))
  if (process.env.WARNINGS === '1') console.log(t.warningMismatches.join('\n'))
  assert.ok(t.statements > 3000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.deepEqual(t.mismatches.slice(0, 5), [], `${t.mismatches.length} statements disagree`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
  assert.deepEqual(t.warningMismatches.slice(0, 5), [], `${t.warningMismatches.length} queries' warning counts disagree`)
})
