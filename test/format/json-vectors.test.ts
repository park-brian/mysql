// M5.21 — the JSON corpus, replayed through the executor.
//
// `tools/capture-json.mjs` ran generated scripts over JSON columns on a real
// 8.4.11 through `mysql2`, each SELECT through both protocols, with JSON as
// the text the server sent. This replays them through M5.18's machinery and
// holds the executor to every statement it accepts. One it refuses by name
// with ER_NOT_SUPPORTED_YET is counted, not failed, and `REFUSED_AT_MOST`
// ratchets down as M5.21 lands — captured before any JSON code, so it starts
// at nearly everything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
// @ts-expect-error — a tool, in plain JavaScript; its options are the capture's, so the replay cannot drift from it.
import { CONNECTION, SQL_MODE } from '../../tools/capture-json.mjs'
import { replay, type Fixture } from './relational-vectors.test.ts'

const FIXTURE = new URL('./fixtures/json.json', import.meta.url).pathname

/** The most statements the executor may still refuse. Lowered by M5.21's stages, never raised. */
const REFUSED_AT_MOST = 0

test('M5.21: every JSON statement the executor runs returns what the server returned', async () => {
  if (!existsSync(FIXTURE)) return
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')
  assert.equal(fixture.sqlMode, SQL_MODE)
  const t = await replay(fixture, CONNECTION as Record<string, unknown>)
  console.log(`  [json] ${t.agreed} of ${t.statements} agree, ${t.refused} refused; ${t.unordered} compared as multisets`)
  assert.ok(t.statements > 4000, `the corpus is too small to say anything: ${t.statements} statements`)
  assert.deepEqual(t.mismatches.slice(0, 5), [], `${t.mismatches.length} statements disagree`)
  assert.ok(t.refused <= REFUSED_AT_MOST, `${t.refused} refusals, more than the ${REFUSED_AT_MOST} this stage allows`)
})
