// M5.15 — MySQL's own suite, run by MySQL's own `mysqltest`, as recorded.
//
// `tools/mysqltest-run.mjs` runs every file of `mysql-community-test` against
// 8.4.11 and against this executor over TCP. It needs the package and a
// server, so it does not run here; this checks what it recorded, and that the
// scoreboard says the same. What it may record is narrow on purpose: file
// names, outcomes, and failure reasons that are an error number or the class
// of a difference. Never a statement, never a line of a result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FIXTURE = new URL('./fixtures/mysqltest-run.json', import.meta.url).pathname
const ROADMAP = new URL('../../docs/44-roadmap.md', import.meta.url).pathname

interface Run {
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly reasons: Readonly<Record<string, number>>
  readonly files: Readonly<Record<string, 'p' | 'f' | 's'>>
}
interface Recorded {
  readonly mysqltest: string
  readonly total: number
  readonly server: Run & { readonly version: string }
  readonly ours: Run
}

const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recorded

test('M5.15: both runs count every file once, and their tallies add up', () => {
  for (const run of [recorded.server, recorded.ours]) {
    const statuses = Object.values(run.files)
    assert.equal(statuses.length, recorded.total)
    assert.equal(statuses.filter((s) => s === 'p').length, run.passed)
    assert.equal(statuses.filter((s) => s === 'f').length, run.failed)
    assert.equal(statuses.filter((s) => s === 's').length, run.skipped)
    assert.equal(Object.values(run.reasons).reduce((n, v) => n + v, 0), run.failed)
  }
  assert.deepEqual(Object.keys(recorded.ours.files), Object.keys(recorded.server.files))
  assert.match(recorded.server.version, /^8\.4\.11/)
})

test('M5.15: a reason is a number or a class, never a statement', () => {
  for (const reason of [...Object.keys(recorded.server.reasons), ...Object.keys(recorded.ours.reasons)]) {
    assert.match(reason, /^[\w ,.:=@'…`()/$-]{1,90}$/, reason)
    // This executor's own 1235 names a feature (`SELECT … INTO`), quotes elided, and is no statement.
    if (!reason.startsWith('error 1235: ')) assert.doesNotMatch(reason, /\b(SELECT|INSERT|CREATE|UPDATE|DELETE)\b.*\b(FROM|INTO|TABLE|SET)\b/i, reason)
  }
})

test("M5.15: the scoreboard's mysql-test row is the recorded run", () => {
  const theirs = Object.entries(recorded.server.files).filter(([, s]) => s === 'p')
  const both = theirs.filter(([name]) => recorded.ours.files[name] === 'p').length
  const row = readFileSync(ROADMAP, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('| MySQL `mysql-test` files passing |'))
  assert.ok(row !== undefined, 'the scoreboard has the row')
  const n = (x: number): string => x.toLocaleString('en-US')
  assert.ok(row.includes(`${n(both)} / ${n(theirs.length)}`), `the row should say ${n(both)} / ${n(theirs.length)}: ${row.slice(0, 120)}`)
})
