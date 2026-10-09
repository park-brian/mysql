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
// @ts-expect-error — a tool, in plain JavaScript; its runner is shared so the replay cannot drift from the capture.
import { SQL_MODE } from '../../tools/capture-relational.mjs'
import { replay, type Fixture } from '../lib/replay.ts'

const FIXTURE = new URL('./fixtures/relational.json', import.meta.url).pathname

/** The most statements the executor may still refuse. Lowered by every stage of M5.18, never raised. */
const REFUSED_AT_MOST = 0

/** The fewest plans that must agree with the server's, skeleton for skeleton (M5.44). Raised by the planner's work, never lowered. */
const PLANS_AGREE_AT_LEAST = 2082

test('M5.18: every relational statement the executor runs returns what the server returned', async () => {
  assert.ok(existsSync(FIXTURE), 'the corpus must be committed')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const t = await replay(fixture)
  console.log(
    `  [relational] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; order checked ${t.orderedByStatement} by ORDER BY, ` +
      `${t.orderedByPlan} by plan; plans agree on ${t.plansAgreed} of ${t.plansExplained}; ${t.unordered} compared as multisets (${t.unorderedInOrder} in the server's order anyway); ` +
      `${t.unmodelled} under a plan strategy not yet modelled, metadata uncompared; ` +
      `warning counts differ on ${t.warningMismatches.length} of ${t.warningsCompared}`,
  )
  if (process.env.WARNINGS === '1') console.log(t.warningMismatches.join('\n'))
  assert.ok(t.statements > 4000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.deepEqual(t.mismatches.slice(0, 5), [], `${t.mismatches.length} statements disagree`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
  assert.ok(t.plansAgreed >= PLANS_AGREE_AT_LEAST, `${t.plansAgreed} plans agree, fewer than the ${PLANS_AGREE_AT_LEAST} already reached`)
  // M5.28: a query's warning count, as `@@warning_count` reads it straight after.
  assert.deepEqual(t.warningMismatches.slice(0, 5), [], `${t.warningMismatches.length} queries' warning counts disagree`)
})
