// M0.10 — "the size gate fails a commit that exceeds the committed number".
// A budget that never fails is a dashboard, not a gate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOOL = new URL('../../tools/size-budget.mjs', import.meta.url).pathname
const COMMITTED = new URL('../../size-budget.json', import.meta.url).pathname

function runGate(budget: unknown): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'myjs-size-'))
  const file = join(dir, 'budget.json')
  writeFileSync(file, JSON.stringify(budget))
  try {
    const out = execFileSync(process.execPath, [TOOL, '--budget-file', file], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string }
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a real budget is committed to the repository', () => {
  assert.ok(existsSync(COMMITTED), 'size-budget.json must be checked in')
  const budgets = JSON.parse(readFileSync(COMMITTED, 'utf8')) as Record<string, { gzip: number }>
  assert.ok(Object.keys(budgets).length > 0, 'at least one package must be gated')
  for (const [pkg, b] of Object.entries(budgets)) {
    assert.equal(typeof b.gzip, 'number', `${pkg} needs a gzipped number`)
    assert.ok(b.gzip > 0, `${pkg} budget must be a real number`)
  }
})

test('the gate fails when a package exceeds its committed number', () => {
  const { code, out } = runGate({ bytes: { raw: 1, gzip: 1 } })
  assert.equal(code, 1, 'exceeding the budget must fail the build')
  assert.match(out, /size budget exceeded/)
  assert.match(out, /bytes/)
})

test('the gate passes when every package is within its number', () => {
  const budgets = JSON.parse(readFileSync(COMMITTED, 'utf8'))
  const { code } = runGate(budgets)
  assert.equal(code, 0)
})

test('the gate refuses to pass with no committed budget at all', () => {
  const { code, out } = runGate({})
  assert.equal(code, 1, 'an empty budget file is not a gate')
  assert.match(out, /no committed size budget/)
})
