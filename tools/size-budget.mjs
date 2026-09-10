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
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'
import { check } from './lib/gen-common.mjs'

// `--root <dir>` mirrors `lint-isomorphic.mjs`: proving that the gate excludes
// a lazily imported chunk needs a workspace containing one, and that fixture
// belongs in a temp tree rather than permanently in `packages/`.
const rootFlag = process.argv.indexOf('--root')
const ROOT =
  rootFlag === -1
    ? new URL('..', import.meta.url).pathname
    : process.argv[rootFlag + 1].replace(/\/?$/, '/')
// `--budget-file <path>` lets the gate's own test point at a throwaway budget,
// so proving the gate fails does not mean editing the committed numbers.
const budgetFlag = process.argv.indexOf('--budget-file')
const BUDGET_FILE = budgetFlag === -1 ? ROOT + 'size-budget.json' : process.argv[budgetFlag + 1]

// M2.22: discovered, not listed. A hardcoded array means a new package lands
// with no committed number and no gate, and nothing says so — which is exactly
// what would have happened to `@myjs/charsets` and `@myjs/types` in M2. Every
// package with a browser entry point is measured, and every measured package
// must carry a committed number (see the check at the bottom).
//
// `@myjs/server` is the exception, and for the same reason D-27 exempts it
// from the isomorphic lint: it opens TCP sockets, so there is no browser
// bundle of it to measure. Listing it here is a deliberate opt-out, not a
// package someone forgot.
const HOST_ONLY = ['server']
const PACKAGES = readdirSync(ROOT + 'packages')
  .filter((name) => !HOST_ONLY.includes(name))
  .filter((name) => existsSync(`${ROOT}packages/${name}/src/index.ts`))
  .sort()

// Headroom so that a one-byte comment change does not fail CI; a real
// regression is far larger than this.
const TOLERANCE = 0.02

const update = process.argv.includes('--update')

// M2.20: the number is the ENTRY CHUNK, not the whole build.
//
// Without `splitting`, esbuild inlines an `await import()` target into the one
// output file — so deferring the UCA weight tables behind a dynamic import
// would not move this number by a single byte, and "an esbuild bundle of
// `packages/charsets/src/index.ts` contains no UCA weights, proven by the size
// gate" would be proven by nothing. Splitting gives each dynamically imported
// module its own chunk; we measure only what a consumer pays to *load* the
// package, and report the deferred remainder so it is visible rather than
// merely absent.
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
    // `outdir` is required by `splitting` and names the chunks; with
    // `write: false` nothing reaches the disk.
    write: false,
    splitting: true,
    outdir: `${ROOT}packages/${pkg}/.size-out`,
    metafile: true,
    // Workspace siblings are bundled in, so each number is the real cost of
    // installing that package alone.
    logLevel: 'silent',
  })

  // The entry chunk is the output esbuild attributes to *our* entry point.
  // Matching on "has an entryPoint at all" is not enough: under `splitting`
  // esbuild gives every dynamically imported module its own entry too, which
  // is precisely the set we want to exclude.
  const wanted = relative(process.cwd(), entry)
  const outputs = result.metafile.outputs
  let entryPath = null
  for (const [path, info] of Object.entries(outputs)) {
    if (info.entryPoint === wanted) {
      check(entryPath === null, `size-budget: ${pkg} produced two entry chunks`)
      entryPath = path
    }
  }
  check(entryPath !== null, `size-budget: ${pkg} has no output for ${wanted}`)

  let entryContents = null
  let deferredRaw = 0
  for (const file of result.outputFiles) {
    // esbuild reports metafile keys relative to cwd and outputFiles paths
    // absolutely, so compare on the basename-bearing tail rather than on
    // either form directly.
    if (file.path.endsWith(entryPath.slice(entryPath.lastIndexOf('/')))) entryContents = file.contents
    else deferredRaw += file.contents.length
  }
  check(entryContents !== null, `size-budget: ${pkg} entry chunk has no contents`)

  return {
    raw: entryContents.length,
    gzip: gzipSync(entryContents, { level: 9 }).length,
    deferredRaw,
    deferredChunks: result.outputFiles.length - 1,
  }
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
  const deferred =
    size.deferredChunks > 0
      ? `  [+${size.deferredChunks} lazy chunk(s), ${size.deferredRaw} B raw, not counted]`
      : ''
  console.log(
    `${pkg.padEnd(10)} ${String(size.gzip).padStart(7)} B gzipped ` +
      `(${String(size.raw).padStart(7)} B raw)  ` +
      (limit === null ? '[no budget yet]' : `budget ${budget} (+${Math.round(TOLERANCE * 100)}% = ${limit})  ${status}`) +
      deferred,
  )
  if (status === 'OVER') {
    failures.push(`${pkg}: ${size.gzip} B gzipped exceeds the committed ${budget} B`)
  }
}

if (update) {
  // The committed schema stays `{raw, gzip}` per package. The deferred figures
  // describe a build, not a budget: they move whenever a lazy module is added,
  // which is the thing we want to be free rather than ratcheted.
  const committed = {}
  for (const [pkg, size] of Object.entries(measured)) committed[pkg] = { raw: size.raw, gzip: size.gzip }
  writeFileSync(BUDGET_FILE, JSON.stringify(committed, null, 2) + '\n')
  console.log(`\nwrote ${BUDGET_FILE}`)
  process.exit(0)
}

if (failures.length > 0) {
  console.error('\nsize budget exceeded:')
  for (const f of failures) console.error('  ' + f)
  console.error('\nIf the growth is intended, re-run with --update and commit size-budget.json.')
  process.exit(1)
}

// The gate is only real if a number is actually committed — for every package,
// not merely for one. A measured package with no number used to print
// `[no budget yet]` and pass, which is a gate that silently stops gating as
// soon as the workspace grows (M2.22).
const measuredNames = PACKAGES.filter((p) => measured[p])
const ungated = measuredNames.filter((p) => typeof budgets[p]?.gzip !== 'number')
if (measuredNames.length === 0) {
  console.error('\nno package has a browser entry point: nothing to measure')
  process.exit(1)
}
if (ungated.length > 0) {
  console.error(
    `\nno committed size budget for: ${ungated.join(', ')}\n` +
      'run `npm run size -- --update` and commit size-budget.json',
  )
  process.exit(1)
}
const gated = measuredNames
console.log(`\nsize budget: ${gated.length} package(s) gated`)
