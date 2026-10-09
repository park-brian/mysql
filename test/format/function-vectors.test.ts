// M5.10 — the string and numeric function corpus, replayed through the executor.
//
// `tools/capture-functions.mjs` ran generated calls of M5.10's string and
// numeric slices on a real 8.4.11 through `mysql2`, each SELECT through both
// protocols with its metadata and warning count, before any of the functions
// were written. This replays them through M5.18's machinery. A statement the
// executor refuses by name with ER_NOT_SUPPORTED_YET is counted, not failed,
// and `REFUSED_AT_MOST` ratchets down as the slices land.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
// @ts-expect-error — a tool, in plain JavaScript; its options are the capture's, so the replay cannot drift from it.
import { CONNECTION, SQL_MODE } from '../../tools/capture-functions.mjs'
import { replay, type Fixture } from '../lib/replay.ts'

const FIXTURE = new URL('./fixtures/functions.json', import.meta.url).pathname

/** The most statements the executor may still refuse. Lowered by M5.10's slices, never raised. */
const REFUSED_AT_MOST = 6

test('M5.10: every function call the executor runs returns what the server returned', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const t = await replay(fixture, CONNECTION as Record<string, unknown>)
  console.log(`  [functions] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; ${t.unordered} compared as multisets; warning counts differ on ${t.warningMismatches.length} of ${t.warningsCompared}`)
  if (process.env.WARNINGS === '1') console.log(t.warningMismatches.join('\n'))
  assert.ok(t.statements > 1000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.deepEqual(t.mismatches.slice(0, 5), [], `${t.mismatches.length} statements disagree`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
  // M5.28: a query's warning count, as `@@warning_count` reads it straight after.
  assert.deepEqual(t.warningMismatches.slice(0, 5), [], `${t.warningMismatches.length} queries' warning counts disagree`)
})
