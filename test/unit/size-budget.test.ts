// M0.10 — "the size gate fails a commit that exceeds the committed number".
// A budget that never fails is a dashboard, not a gate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
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

// M2.20: the number has to be the *entry chunk*, not the whole build.
//
// Without code splitting esbuild inlines an `await import()` target into the
// single output file, so deferring a module would not move the number by a
// byte — and "the bundle contains no UCA weights, proven by the size gate"
// would be proven by nothing at all. This fixture is the proof that the
// mechanism works, in a throwaway workspace so the repository's own packages
// do not have to carry a lazy import to keep the test honest.
function measureFixture(): { entry: { raw: number; gzip: number }; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'myjs-size-lazy-'))
  const src = join(dir, 'packages', 'lazyfix', 'src')
  mkdirSync(src, { recursive: true })
  // Incompressible, so "the heavy module was excluded" cannot be confused with
  // "the heavy module compressed away".
  let heavy = ''
  let x = 123456789
  for (let i = 0; i < 40000; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    heavy += String.fromCharCode(33 + (x % 90))
  }
  writeFileSync(join(src, 'heavy.ts'), `export const heavy = ${JSON.stringify(heavy)}\n`)
  writeFileSync(
    join(src, 'index.ts'),
    'export const eager = 1\n' + "export async function load() { return (await import('./heavy.ts')).heavy }\n",
  )
  const budget = join(dir, 'budget.json')
  try {
    execFileSync(process.execPath, [TOOL, '--root', dir, '--budget-file', budget, '--update'], {
      encoding: 'utf8',
    })
    const written = JSON.parse(readFileSync(budget, 'utf8')) as Record<string, { raw: number; gzip: number }>
    const out = execFileSync(process.execPath, [TOOL, '--root', dir, '--budget-file', budget], {
      encoding: 'utf8',
    })
    return { entry: written['lazyfix']!, out }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a lazily imported module is not counted in the entry chunk', () => {
  const { entry, out } = measureFixture()
  // The heavy module is ~40 KB of incompressible text. If it were inlined —
  // which is exactly what happens without `splitting` — the entry chunk could
  // not possibly come in under a kilobyte.
  assert.ok(
    entry.raw < 1024,
    `the entry chunk should not carry the deferred module, got ${entry.raw} B raw`,
  )
  assert.match(out, /lazyfix/)
  assert.match(out, /lazy chunk\(s\)/, 'the deferred chunk must be reported, not silently dropped')
  const deferred = /(\d+) B raw, not counted/.exec(out)
  assert.ok(deferred, 'the gate must say how much it deferred')
  assert.ok(
    Number(deferred[1]) > 30000,
    `the deferred chunk should hold the heavy module, got ${deferred[1]} B`,
  )
})
