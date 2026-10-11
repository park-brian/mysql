#!/usr/bin/env node
// M5.22 — the exit criterion's suites, run, counted and censused.
//
// M5's exit criterion is "Drizzle's and Prisma's MySQL test suites pass end to
// end", and M5.10 is "prioritised by measured usage frequency across the ORM
// test suites". Nothing measured either. This tool does both, for Drizzle's
// MySQL suites and for Prisma's MySQL functional tests:
//
//   **The census.** It runs the suites against a real 8.4.11 with
//   `general_log` on, parses every statement they sent with `@myjs/parser`,
//   and counts features: statement kinds, clauses, functions, operators and
//   column types. That is a build order read off what the ORM actually sends.
//
//   **The score.** It runs the same suites against this executor, served over
//   TCP by `@myjs/server`, and counts the tests that pass beside the count
//   that pass against 8.4.11. That is the exit criterion as a number.
//
// The suites are fetched at a pinned tag into `reference/` and never vendored,
// and the fixture holds counts and feature names only — never a statement —
// as M3.11's census does (ground rule 7's discipline, though Drizzle is
// Apache-2.0: a fixture of names stays reviewable and small).
//
// Usage (8.4.11 from `tools/mysql-local.mjs` up for --server):
//   node tools/orm-suites.mjs --server [--suite drizzle|prisma]   # census + 8.4.11's pass count
//   node tools/orm-suites.mjs --ours [--suite drizzle|prisma]     # this executor's pass count
//   Add --out <file> to preserve fixtures, --prisma-workers <N> to bound Jest workers.
// Each writes its half of its suite in test/format/fixtures/orm-census.json.
// With no --suite, both run.
//
// Prisma's suite is its monorepo's functional tests (`packages/client/tests/
// functional`), built from source with pnpm 8 as its own CI builds it, run
// with `--provider mysql`. Its engines are Rust and speak the binary protocol
// through `mysql_async`; jest-junit's XML is the per-test record.
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { parseStatement } from '@myjs/parser'
import { npmCommand } from './lib/npm-command.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const outFlag = process.argv.indexOf('--out')
const FIXTURE = outFlag < 0 ? join(ROOT, 'test/format/fixtures/orm-census.json') : process.argv[outFlag + 1]
const runSync = (command, args, options) => execFileSync(...npmCommand(command, args), options)

const DRIZZLE = {
  name: 'drizzle-orm',
  repo: 'https://github.com/drizzle-team/drizzle-orm',
  tag: '0.36.4',
  commit: '03f6239c53c7132cf8ef08ff4f0cf70a1009de3f',
  dir: join(ROOT, 'reference/orm/drizzle-orm'),
  // The suites that take a MYSQL_CONNECTION_STRING; PlanetScale and TiDB are hosted services.
  files: ['tests/mysql/mysql.test.ts', 'tests/mysql/mysql-prefixed.test.ts', 'tests/mysql/mysql-custom.test.ts', 'tests/mysql/mysql-proxy.test.ts', 'tests/relational/mysql.test.ts'],
  // What those files import, pinned; the integration package's own list pulls every driver Drizzle supports.
  dependencies: {
    'drizzle-orm': '0.36.4',
    mysql2: '3.11.0',
    vitest: '2.1.2',
    'vite-tsconfig-paths': '4.3.2',
    'async-retry': '1.3.3',
    dockerode: '3.3.5',
    dotenv: '16.4.5',
    'get-port': '7.1.0',
    uuid: '9.0.1',
  },
}

const PRISMA = {
  name: 'prisma',
  repo: 'https://github.com/prisma/prisma',
  tag: '5.22.0',
  commit: '718358aa37975c18e5ea62f5b659fb47630b7609',
  dir: join(ROOT, 'reference/orm/prisma'),
  pnpm: 'pnpm@8.15.9',
}

const arg = (name) => process.argv.includes(`--${name}`)
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? undefined : process.argv[at + 1]
}

/** Prisma's monorepo at its pinned commit, installed and built as its CI does it. */
function preparePrisma(s) {
  const client = join(s.dir, 'packages/client')
  if (!existsSync(client)) {
    mkdirSync(join(ROOT, 'reference/orm'), { recursive: true })
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', s.tag, s.repo, s.dir], { stdio: 'inherit' })
  }
  const head = execFileSync('git', ['-C', s.dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  if (head !== s.commit) throw new Error(`${s.name} is at ${head}, not ${s.tag}'s ${s.commit}`)
  if (!existsSync(join(client, 'runtime/library.js'))) {
    runSync('npx', ['-y', s.pnpm, 'install', '--frozen-lockfile'], {
      cwd: s.dir,
      stdio: 'inherit',
    })
    runSync('npx', ['-y', s.pnpm, '-r', 'dev'], {
      cwd: s.dir,
      stdio: 'inherit',
    })
  }
  return client
}

/** The suite at its pinned commit, with its dependencies installed. */
function prepare(s) {
  const tests = join(s.dir, 'integration-tests')
  if (!existsSync(tests)) {
    mkdirSync(join(ROOT, 'reference/orm'), { recursive: true })
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', s.tag, '--filter=blob:none', '--sparse', s.repo, s.dir], { stdio: 'inherit' })
    execFileSync('git', ['-C', s.dir, 'sparse-checkout', 'set', 'integration-tests'], { stdio: 'inherit' })
  }
  const head = execFileSync('git', ['-C', s.dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  if (head !== s.commit) throw new Error(`${s.name} is at ${head}, not ${s.tag}'s ${s.commit}`)
  if (!existsSync(join(tests, 'node_modules/vitest'))) {
    writeFileSync(join(tests, 'package.json'), `${JSON.stringify({ name: 'orm-census', private: true, type: 'module', dependencies: s.dependencies }, null, 2)}\n`)
    runSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: tests, stdio: 'inherit' })
  }
  return tests
}

/** Feature counts over the statements: each feature once per statement it appears in. */
function census(statements) {
  const counts = {}
  const add = (k) => (counts[k] = (counts[k] ?? 0) + 1)
  let unparsed = 0
  for (const sql of statements) {
    let ast
    try {
      ast = parseStatement(sql)
    } catch {
      unparsed++
      continue
    }
    const seen = new Set([`statement ${ast.kind}`])
    if (ast.kind === 'alterTable') for (const a of ast.actions ?? []) seen.add(`clause ALTER ${a.type}`)
    const ddl = ast.kind === 'createTable' || ast.kind === 'alterTable'
    const walk = (x, inDefault) => {
      if (x === null || typeof x !== 'object') return
      if (Array.isArray(x)) return x.forEach((v) => walk(v, inDefault))
      if (x.kind === 'call') seen.add(`${inDefault ? 'default' : 'function'} ${x.name.toUpperCase()}${x.over !== undefined ? ' OVER' : ''}`)
      else if (x.kind === 'binary' || x.kind === 'unary') seen.add(`operator ${x.op}`)
      else if (x.kind === 'join') seen.add(`join ${x.type}`)
      else if (x.kind === 'derived') seen.add(x.lateral === true ? 'clause LATERAL' : 'clause derived table')
      else if (x.kind === 'subquery') seen.add('clause subquery')
      else if (x.kind === 'setOperation') seen.add(`clause ${x.op}`)
      else if (x.kind === 'interval') seen.add('clause INTERVAL')
      else if (x.kind === 'cast') seen.add('clause CAST')
      else if (x.kind === 'table' && x.table?.schema?.toLowerCase() === 'information_schema') seen.add(`clause INFORMATION_SCHEMA ${x.table.name.toUpperCase()}`)
      else if (x.type === 'foreign' && x.references !== undefined) {
        seen.add('clause FOREIGN KEY')
        for (const action of ['onDelete', 'onUpdate']) if (x.references[action] !== undefined) seen.add(`clause ${action === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'} ${x.references[action]}`)
      } else if (x.kind === 'select') {
        if (x.groupBy !== undefined) seen.add('clause GROUP BY')
        if (x.having !== undefined) seen.add('clause HAVING')
        if (x.distinct === true) seen.add('clause DISTINCT')
      } else if (x.kind === 'query') {
        if (x.with !== undefined) seen.add('clause WITH')
        if (x.orderBy !== undefined) seen.add('clause ORDER BY')
        if (x.limit !== undefined) seen.add('clause LIMIT')
        if (x.locking !== undefined) seen.add('clause locking read')
      } else if (x.kind === 'insert' && x.onDuplicate !== undefined) seen.add('clause ON DUPLICATE KEY UPDATE')
      if (ddl && x.type !== undefined && typeof x.type === 'object' && typeof x.type.name === 'string' && x.name !== undefined) seen.add(`column ${x.type.name}`)
      for (const [k, v] of Object.entries(x)) if (typeof v === 'object') walk(v, inDefault || k === 'default' || k === 'onUpdate')
    }
    walk(ast, false)
    for (const s of seen) add(s)
  }
  return {
    statements: statements.length,
    unparsed,
    features: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  }
}

function readFixture() {
  return existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { note: '', drizzle: {}, prisma: {} }
}

function writeFixture(f) {
  f.note =
    "M5.22: the exit criterion's ORM suites, fetched at a pinned tag and run by tools/orm-suites.mjs. `server` is a real MySQL's pass count and the census of " +
    'what the suites sent it (counts and feature names, never a statement); `ours` is this executor served over TCP. Regenerate, never edit.'
  writeFileSync(FIXTURE, `${JSON.stringify(f, null, 2)}\n`)
}

const fixture = readFixture()
const chosen = option('suite')
for (const which of chosen === undefined ? ['drizzle', 'prisma'] : [chosen]) {
  if (which !== 'drizzle' && which !== 'prisma') throw new Error(`--suite ${which}: drizzle or prisma`)
  const s = which === 'drizzle' ? DRIZZLE : PRISMA
  const cwd = which === 'drizzle' ? prepare(s) : preparePrisma(s)
  const run = (url) => (which === 'drizzle' ? runSuites(s, cwd, `${url}/drizzle`) : runPrisma(s, cwd, `${url}/PRISMA_DB_NAME`))
  fixture[which] = {
    ...fixture[which],
    tag: s.tag,
    commit: s.commit,
    ...(which === 'drizzle' ? { files: s.files } : {}),
  }

  if (arg('server')) {
    const host = process.env.MYSQL_HOST ?? '127.0.0.1'
    const port = Number(process.env.MYSQL_PORT ?? 3306)
    const user = process.env.MYSQL_USER ?? 'root'
    const password = process.env.MYSQL_PASSWORD ?? 'root'
    const admin = await mysql.createConnection({
      host, port, user, password,
    })
    let logging
    try {
      ;[[logging]] = await admin.query('SELECT @@GLOBAL.general_log AS enabled, @@GLOBAL.log_output AS output')
      const [[{ v: version }]] = await admin.query('SELECT VERSION() AS v')
      await admin.query('DROP DATABASE IF EXISTS drizzle')
      if (which === 'drizzle') await admin.query('CREATE DATABASE drizzle')
      await admin.query("SET GLOBAL log_output = 'TABLE'")
      await admin.query('TRUNCATE mysql.general_log')
      await admin.query('SET GLOBAL general_log = ON')
      const url = new URL('mysql://localhost')
      url.hostname = host
      url.port = String(port)
      url.username = user
      url.password = password
      const result = await run(url.href.replace(/\/$/, ''))
      await admin.query('SET GLOBAL general_log = OFF')
      const [rows] = await admin.query("SELECT CONVERT(argument USING utf8mb4) AS a FROM mysql.general_log WHERE command_type IN ('Query', 'Execute')")
      const { reasons, ...counted } = result
      // Prisma's suite has tests 8.4.11 itself fails, for reasons of this
      // environment; they are kept, by reason, so the denominator is honest.
      fixture[which].server = {
        version,
        ...counted,
        ...(which === 'prisma' ? { reasons } : {}),
        census: census(rows.map((r) => r.a)),
      }
      console.log(`${which} on 8.4.11: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped; ${rows.length} statements censused`)
    } finally {
      try {
        if (logging !== undefined) {
          await admin.query('SET GLOBAL general_log = OFF')
          await admin.query('SET GLOBAL log_output = ?', [logging.output])
          await admin.query('SET GLOBAL general_log = ?', [logging.enabled])
        }
      } finally { await admin.end() }
    }
  }

  if (arg('ours')) {
    const { MySQL } = await import('@myjs/core')
    const { serve } = await import('@myjs/server')
    const { MapAccountStore } = await import('@myjs/protocol')
    const accounts = new MapAccountStore()
    await accounts.add('root', '')
    const db = await MySQL.open(':memory:', { accounts })
    let server
    try {
      server = await serve(db, { port: 0, accounts })
      if (which === 'drizzle') {
        const c = await mysql.createConnection({
          host: '127.0.0.1',
          port: server.port,
          user: 'root',
          password: '',
        })
        await c.query('CREATE DATABASE drizzle')
        await c.end()
      }
      // The suites run in a child process; this one answers their connections meanwhile.
      fixture[which].ours = await run(`mysql://root@127.0.0.1:${server.port}`)
      const o = fixture[which].ours
      console.log(`${which}, ours: ${o.passed} passed, ${o.failed} failed, ${o.skipped} skipped`)
      for (const [reason, n] of Object.entries(o.reasons).slice(0, 15)) console.log(String(n).padStart(5), reason)
    } finally {
      try { await server?.close() } finally { await db.end() }
    }
  }
}

writeFixture(fixture)

/**
 * Run the suites against a server, in a child process so that this one can
 * serve it: per file, how many tests passed, failed and were skipped, and the
 * first line of each failure, its quoted text elided — a reason, never a statement.
 */
async function runSuites(s, cwd, connectionString) {
  const out = join(cwd, 'vitest-result.json')
  await runReport(out, 'npx', ['vitest', 'run', ...s.files, '--reporter=json', `--outputFile=${out}`], {
      cwd,
      env: { ...process.env, MYSQL_CONNECTION_STRING: connectionString },
  })
  const result = JSON.parse(readFileSync(out, 'utf8'))
  const files = {}
  const reasons = new Map()
  for (const f of result.testResults) {
    const name = s.files.find((x) => f.name.endsWith(x)) ?? f.name
    const by = (status) => f.assertionResults.filter((a) => a.status === status).length
    files[name] = {
      passed: by('passed'),
      failed: by('failed'),
      skipped: by('pending') + by('skipped'),
    }
    for (const a of f.assertionResults) {
      if (a.status !== 'failed') continue
      const reason = (a.failureMessages[0] ?? '')
        .split('\n')[0]
        .replace(/'[^']*'/g, "'…'")
        .replace(/`[^`]*`/g, '`…`')
        .slice(0, 120)
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
  }
  return tally(files, reasons)
}

/** A failure's first line, its quoted text elided: a reason, never a statement. */
function reasonOf(message) {
  let line = (message ?? '').split('\n').find((l) => l.trim() !== '') ?? ''
  // jest-junit writes a hook's failure as JSON: its message, or its stack's first line.
  if (line.trim().startsWith('{')) {
    try {
      const j = JSON.parse(message)
      line = (j.message || String(j.stack ?? '')).split('\n').find((l) => l.trim() !== '') ?? ''
    } catch {}
  }
  return line
    .trim()
    .replace(/'[^']*'/g, "'…'")
    .replace(/`[^`]*`/g, '`…`')
    .replace(/"[^"]*"/g, '"…"')
    .slice(0, 120)
}

function tally(files, reasons) {
  if (Object.keys(files).length === 0) throw new Error('suite report contains no tests')
  const total = (k) => Object.values(files).reduce((n, f) => n + f[k], 0)
  return {
    passed: total('passed'),
    failed: total('failed'),
    skipped: total('skipped'),
    files,
    reasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])),
  }
}

/**
 * Prisma's functional tests against a server: `connectionString` names the
 * database `PRISMA_DB_NAME`, which each suite replaces with its own. Per test
 * file, from jest-junit's XML; a file the run never reached counts nothing.
 */
async function runPrisma(s, cwd, connectionString) {
  const out = join(cwd, 'orm-census-junit.xml')
  const env = {
    ...process.env,
    TEST_FUNCTIONAL_MYSQL_URI: connectionString,
    JEST_JUNIT_OUTPUT_FILE: out,
    CI: '',
  }
  const workers = option('prisma-workers')
  if (workers !== undefined && (!/^\d+$/.test(workers) || Number(workers) < 1)) throw new Error('--prisma-workers must be a positive integer')
  const args = ['-y', s.pnpm, 'test:functional:code', '--provider', 'mysql', ...(workers === undefined ? [] : ['--maxWorkers', workers])]
  await runReport(out, 'npx', args, { cwd, env })
  const xml = readFileSync(out, 'utf8')
  const unescape = (t) =>
    t
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  const files = {}
  const reasons = new Map()
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const file = /\bfile="([^"]*)"/.exec(m[1])?.[1]?.replace(/^.*?tests\/functional\//, '') ?? '?'
    const body = m[3] ?? ''
    const f = (files[file] ??= { passed: 0, failed: 0, skipped: 0 })
    if (/<skipped\b/.test(body)) f.skipped++
    else if (/<(failure|error)\b/.test(body)) {
      f.failed++
      const text = /<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/.exec(body)?.[1] ?? /message="([^"]*)"/.exec(body)?.[1] ?? ''
      const reason = reasonOf(unescape(text))
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    } else f.passed++
  }
  return { ...tally(Object.fromEntries(Object.entries(files).sort()), reasons), workers: workers === undefined ? 'upstream default' : Number(workers) }
}

/** A failed test run may produce a report; a failed launch must never reuse one. */
async function runReport(out, command, args, options) {
  rmSync(out, { force: true })
  await new Promise((resolve, reject) => {
    const child = spawn(...npmCommand(command, args), { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const record = (chunk) => { log = (log + chunk.toString()).slice(-16_384) }
    child.stdout.on('data', record)
    child.stderr.on('data', record)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (signal !== null || (code !== 0 && code !== 1) || !existsSync(out)) reject(new Error(`${command} produced no complete report (exit ${code}, signal ${signal}):\n${log}`))
      else resolve()
    })
  })
}
