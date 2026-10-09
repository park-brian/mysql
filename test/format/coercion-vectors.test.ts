// M5.2 — implicit coercion, replayed through the executor.
//
// `tools/capture-coercion.mjs` set columns of nearly every type and literals
// written every way MySQL reads one against each other — comparisons,
// arithmetic, BETWEEN, IN, and CASE, IF, IFNULL, COALESCE and NULLIF — on a
// real 8.4.11 through `mysql2`, each SELECT through both protocols with its
// metadata and warning count. This replays them through M5.18's machinery.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
// @ts-expect-error — a tool, in plain JavaScript; its options are the capture's, so the replay cannot drift from it.
import { CONNECTION, SQL_MODE } from '../../tools/capture-coercion.mjs'
import { replay, type Fixture } from '../lib/replay.ts'

const FIXTURE = new URL('./fixtures/coercion.json', import.meta.url).pathname

/** The most statements the executor may still refuse. */
const REFUSED_AT_MOST = 0
/**
 * The fewest statements that must agree, and queries whose warning counts
 * must: floors rather than ceilings, since a case is compared only up to its
 * first disagreement, so each fix brings statements into comparison that were
 * not before. M5.2 is done when nothing disagrees. Raised as rules land, never lowered.
 */
const AGREE_AT_LEAST = 3004
const WARNINGS_AGREE_AT_LEAST = 1423

test('M5.2: implicit coercions give what the server gave, value, type and warnings, ratcheted to all', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const t = await replay(fixture, CONNECTION as Record<string, unknown>)
  console.log(`  [coercion] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; warning counts differ on ${t.warningMismatches.length} of ${t.warningsCompared}`)
  if (process.env.MISMATCHES === '1') console.log(t.mismatches.join('\n'))
  if (process.env.WARNINGS === '1') console.log(t.warningMismatches.join('\n'))
  assert.ok(t.statements > 2000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.ok(t.agreed >= AGREE_AT_LEAST, `${t.agreed} statements agree, fewer than the ${AGREE_AT_LEAST} this stage holds:\n${t.mismatches.slice(0, 3).join('\n')}`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
  const warningsAgree = t.warningsCompared - t.warningMismatches.length
  assert.ok(warningsAgree >= WARNINGS_AGREE_AT_LEAST, `${warningsAgree} queries' warning counts agree, fewer than ${WARNINGS_AGREE_AT_LEAST}:\n${t.warningMismatches.slice(0, 3).join('\n')}`)
})
