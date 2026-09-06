#!/usr/bin/env node
// M0.10 / doc 43 §7 — the bundle-size gate.
//
// "Bundle size and cold start belong in the *same* dashboard as query
// performance, because in a browser they are performance." Doc 00's 1.0 target
// is <500 KB gzipped for the core; this gate is the *ratchet* that gets us
// there: a committed number per package, and any commit that exceeds it fails.
//
// Run with --update to re-commit the numbers after a deliberate growth.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
// `--budget-file <path>` lets the gate's own test point at a throwaway budget,
// so proving the gate fails does not mean editing the committed numbers.
const budgetFlag = process.argv.indexOf('--budget-file')
const BUDGET_FILE = budgetFlag === -1 ? ROOT + 'size-budget.json' : process.argv[budgetFlag + 1]

// Only the packages we intend to publish for the browser. @myjs/server is a
// Node host and @myjs/core is not shippable until 0.3, so they are measured
// but not yet gated (budget `null`).
const PACKAGES = ['bytes', 'vfs', 'protocol', 'core']

// Headroom so that a one-byte comment change does not fail CI; a real
// regression is far larger than this.
const TOLERANCE = 0.02

const update = process.argv.includes('--update')

async function measure(pkg) {
  const entry = `${ROOT}packages/${pkg}/src/index.ts`
  if (!existsSync(entry)) return null
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    minify: true,
    write: false,
    // Workspace siblings are bundled in, so each number is the real cost of
    // installing that package alone.
    logLevel: 'silent',
  })
  const out = result.outputFiles[0].contents
  return { raw: out.length, gzip: gzipSync(out, { level: 9 }).length }
}

const budgets = existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) : {}
const measured = {}
const failures = []

for (const pkg of PACKAGES) {
  const size = await measure(pkg)
  if (size === null) continue
  measured[pkg] = size
  const budget = budgets[pkg]?.gzip
  const limit = typeof budget === 'number' ? Math.ceil(budget * (1 + TOLERANCE)) : null
  const status =
    limit === null ? 'new' : size.gzip <= limit ? 'ok' : 'OVER'
  console.log(
    `${pkg.padEnd(10)} ${String(size.gzip).padStart(7)} B gzipped ` +
      `(${String(size.raw).padStart(7)} B raw)  ` +
      (limit === null ? '[no budget yet]' : `budget ${budget} (+${Math.round(TOLERANCE * 100)}% = ${limit})  ${status}`),
  )
  if (status === 'OVER') {
    failures.push(`${pkg}: ${size.gzip} B gzipped exceeds the committed ${budget} B`)
  }
}

if (update) {
  writeFileSync(BUDGET_FILE, JSON.stringify(measured, null, 2) + '\n')
  console.log(`\nwrote ${BUDGET_FILE}`)
  process.exit(0)
}

if (failures.length > 0) {
  console.error('\nsize budget exceeded:')
  for (const f of failures) console.error('  ' + f)
  console.error('\nIf the growth is intended, re-run with --update and commit size-budget.json.')
  process.exit(1)
}

// The gate is only real if a number is actually committed.
const gated = PACKAGES.filter((p) => measured[p] && typeof budgets[p]?.gzip === 'number')
if (gated.length === 0) {
  console.error('\nno committed size budget: run `npm run size -- --update` and commit size-budget.json')
  process.exit(1)
}
console.log(`\nsize budget: ${gated.length} package(s) gated`)
