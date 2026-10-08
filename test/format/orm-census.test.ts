// M5.22 — the committed census of the exit criterion's ORM suites.
//
// `tools/orm-suites.mjs` runs Drizzle's MySQL suites against 8.4.11 and against
// this executor, and records what it found. It needs the network and a server,
// so it does not run here; this checks what it recorded. What it may record is
// narrow on purpose: counts, feature names and failure reasons with their
// quoted text elided. Never a statement.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FIXTURE = new URL('./fixtures/orm-census.json', import.meta.url).pathname
const ROADMAP = new URL('../../docs/44-roadmap.md', import.meta.url).pathname

interface Run {
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly files: Readonly<Record<string, { readonly passed: number; readonly failed: number; readonly skipped: number }>>
}
interface Census {
  readonly drizzle: {
    readonly tag: string
    readonly commit: string
    readonly files: readonly string[]
    readonly server: Run & { readonly version: string; readonly census: { readonly statements: number; readonly unparsed: number; readonly features: Readonly<Record<string, number>> } }
    readonly ours: Run & { readonly reasons: Readonly<Record<string, number>> }
  }
}

const census = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Census
const d = census.drizzle

test('M5.22: the census holds feature names and counts, never a statement', () => {
  for (const [feature, n] of Object.entries(d.server.census.features)) {
    // A word or two, or an operator's symbol: nothing that could carry a statement.
    assert.match(feature, /^(statement|column|default|function|operator|join|clause) ([A-Za-z_ ]{1,40}|[-+*/%=<>!&|^~]{1,3})$/, feature)
    assert.ok(Number.isInteger(n) && n > 0 && n <= d.server.census.statements, feature)
  }
  for (const reason of Object.keys(d.ours.reasons)) assert.doesNotMatch(reason, /\b(SELECT|INSERT|CREATE|UPDATE|DELETE) .*\b(FROM|INTO|TABLE|SET)\b/i, reason)
  assert.equal(d.server.census.unparsed, 0, 'every statement the suites sent parses')
})

test('M5.22: each run counts every test once, per file and in total', () => {
  for (const run of [d.server, d.ours]) {
    assert.deepEqual(Object.keys(run.files).sort(), [...d.files].sort())
    for (const k of ['passed', 'failed', 'skipped'] as const) {
      assert.equal(Object.values(run.files).reduce((n, f) => n + f[k], 0), run[k], k)
    }
  }
  // The suites are a fixed set of tests, so the two runs see the same number.
  assert.equal(d.server.passed + d.server.failed + d.server.skipped, d.ours.passed + d.ours.failed + d.ours.skipped)
  assert.equal(d.server.failed, 0, '8.4.11 passes every test it runs: the denominator is real')
  assert.equal(Object.values(d.ours.reasons).reduce((n, v) => n + v, 0), d.ours.failed)
})

test('M5.22: the scoreboard quotes the census, not a number typed by hand', () => {
  const row = readFileSync(ROADMAP, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('| Drizzle MySQL suite |'))
  assert.ok(row !== undefined, 'the scoreboard has a Drizzle row')
  const fmt = (n: number): string => n.toLocaleString('en-US')
  assert.ok(row.includes(`${fmt(d.ours.passed)} / ${fmt(d.server.passed)}`), `the row says ${fmt(d.ours.passed)} / ${fmt(d.server.passed)}`)
})
