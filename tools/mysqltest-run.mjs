#!/usr/bin/env node
// M5.15 — MySQL's own test suite, run by MySQL's own `mysqltest`, against
// 8.4.11 and against this executor, file for file.
//
// Doc 43 §1 imagined an interpreter written here. None is needed: the
// `mysql-community-test` package `tools/mysql-local.mjs install` puts on the
// machine carries the real `mysqltest` binary and the suite's `.result`
// files, and `mysqltest` is a client like any other. It speaks the protocol
// to whatever listens, so it drives `@myjs/server` exactly as it drives a
// server, and diffs what it gets against the recorded result itself.
//
// What a file needs beyond a server, `mysql-test-run.pl` provides: a
// bootstrapped `test` database, an `mtr` schema, server options from each
// file's `-master.opt`, a fresh server after a file that changes globals.
// This harness provides only the first, for both servers alike, so some files
// fail on 8.4.11 too. Hence the denominator: a file counts when 8.4.11 passes
// it here, and the score is how many of those pass on this executor, as the
// ORM census counts tests (M5.22).
//
// Ground rule 7: the suite is read where the package installed it and never
// copied. The fixture records file names, outcomes and failure reasons — an
// error number, or the class of a difference — never a statement or a line of
// a result.
//
//   node tools/mysqltest-run.mjs --server          # 8.4.11 on 127.0.0.1:3306 (mysql-local.mjs start)
//   node tools/mysqltest-run.mjs --ours [--jobs 4]
//   node tools/mysqltest-run.mjs --ours --only 'count_distinct|alias' --print
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg } from './lib/cli.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(ROOT, 'test/format/fixtures/mysqltest-run.json')
const SUITE = arg('dir', '/usr/lib/mysql-test')
const TMP = join(ROOT, '.tmp/mysqltest')
/** A file that has not finished in this long has hung, whichever server it ran against. */
const TIMEOUT_MS = Number(arg('timeout', '120')) * 1000
const JOBS = Number(arg('jobs', '4'))
const only = arg('only') === undefined ? undefined : new RegExp(arg('only'))
const flag = (name) => process.argv.includes(`--${name}`)

if (!existsSync(join(SUITE, 't'))) {
  console.error(`no suite at ${SUITE}: sudo node tools/mysql-local.mjs install puts mysql-community-test there`)
  process.exit(1)
}
const version = execFileSync('mysqltest', ['--version'], { encoding: 'utf8' }).trim().replace(/^mysqltest\s+Ver\s+(\S+).*$/, '$1')
const files = readdirSync(join(SUITE, 't'))
  .filter((f) => f.endsWith('.test') && existsSync(join(SUITE, 'r', f.replace(/\.test$/, '.result'))))
  .map((f) => f.replace(/\.test$/, ''))
  .sort()
  .filter((f) => only === undefined || only.test(f))

/** `mysqltest`'s exit status for a file that skipped itself (`--skip`, an unmet `--require`). */
const SKIPPED = 62

/**
 * Why a file failed, in words that cannot carry its SQL: the error number a
 * statement met, the one it expected, or that the result differed.
 */
function reasonOf(out, code, timedOut) {
  if (timedOut) return 'timed out'
  let m = /failed with wrong errno (\d+)[^]*?instead of (\d+)/.exec(out)
  if (m !== null) return `wrong error ${m[1]}, expected ${m[2]}`
  m = /succeeded - should have failed with (?:error|errno) \S*?\(?(\d+)\)?/.exec(out)
  if (m !== null) return `succeeded, expected error ${m[1]}`
  m = /Query '[^]*?' failed\.\s*ERROR (\d+) \(\w+\): ([^\n]*)/.exec(out)
  if (m !== null) {
    // ER_NOT_SUPPORTED_YET's text is this executor's own, naming what it lacks: the work queue.
    const lacking = m[1] === '1235' ? /^(.{1,70}?) (?:is|are) not supported/.exec(m[2])?.[1] : undefined
    return lacking === undefined ? `error ${m[1]}` : `error 1235: ${lacking.replace(/'[^']*'/g, "'…'").replace(/`[^`]*`/g, '`…`')}`
  }
  m = /Could not open connection '[^']*': (\d+)/.exec(out)
  if (m !== null) return `connect: error ${m[1]}`
  if (/^[-+]{3} /m.test(out) || /Result length mismatch|Result content mismatch/.test(out)) return 'result differs'
  m = /mysqltest: (?:At line \d+: )?([A-Za-z][A-Za-z ]{3,40})/.exec(out)
  return m !== null ? m[1].trim() : `exit ${code}`
}

/** One file against a server at `port`; its scratch directory is its own. */
function runFile(name, port, password, scratch) {
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  const client = `mysql --no-defaults -h127.0.0.1 -P${port} -uroot${password === '' ? '' : ` -p${password}`}`
  const args = [
    '--no-defaults', '-h', '127.0.0.1', '-P', String(port), '-u', 'root', ...(password === '' ? [] : [`-p${password}`]), '-D', 'test',
    `--basedir=${SUITE}/`, `--test-file=${join(SUITE, 't', `${name}.test`)}`, `--result-file=${join(SUITE, 'r', `${name}.result`)}`,
    `--logdir=${scratch}`, `--tmpdir=${scratch}`, '--tail-lines=5',
  ]
  const env = { ...process.env, MYSQL_TEST_DIR: SUITE, MYSQLTEST_VARDIR: scratch, MYSQL_TMP_DIR: scratch, MASTER_MYPORT: String(port), MYSQL: client }
  return new Promise((resolve) => {
    const child = spawn('mysqltest', args, { cwd: SUITE, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ status: 'p' })
      else if (code === SKIPPED && !timedOut) resolve({ status: 's', reason: 'skipped' })
      else resolve({ status: 'f', reason: reasonOf(out, code, timedOut), out })
    })
  })
}

function tally(results) {
  const counts = { passed: 0, failed: 0, skipped: 0 }
  const reasons = new Map()
  const outcome = {}
  for (const [name, r] of results) {
    outcome[name] = r.status
    if (r.status === 'p') counts.passed++
    else if (r.status === 's') counts.skipped++
    else {
      counts.failed++
      reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)
    }
  }
  return { ...counts, reasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))), files: outcome }
}

function report(label, run) {
  console.log(`${label}: ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`)
  for (const [reason, n] of Object.entries(run.reasons).slice(0, 25)) console.log(String(n).padStart(6), reason)
}

/** 8.4.11, one file at a time: the server is shared, so each starts from a `test` database of its own. */
async function onServer() {
  const mysql = (await import('mysql2/promise')).default
  const admin = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' })
  const [[{ v }]] = await admin.query('SELECT VERSION() AS v')
  const system = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])
  const results = new Map()
  for (const name of files) {
    const [dbs] = await admin.query('SHOW DATABASES')
    for (const { Database: d } of dbs) if (!system.has(d)) await admin.query(`DROP DATABASE \`${d}\``)
    await admin.query('CREATE DATABASE test')
    const r = await runFile(name, 3306, 'root', join(TMP, 'server'))
    results.set(name, r)
    if (flag('print') && r.status === 'f') console.log(`--- ${name}: ${r.reason}\n${r.out}`)
  }
  await admin.end()
  return { version: v, ...tally(results) }
}

/** This executor: a database of its own per file, served over TCP, `--jobs` files at a time. */
async function onOurs() {
  const { MySQL } = await import('@myjs/core')
  const { serve } = await import('@myjs/server')
  const { MapAccountStore } = await import('@myjs/protocol')
  const results = new Map()
  let next = 0
  const worker = async (job) => {
    while (next < files.length) {
      const name = files[next++]
      const accounts = new MapAccountStore()
      await accounts.add('root', '')
      // A real server lets any client that asks run several statements at once (D-13's switch, on).
      const db = await MySQL.open(':memory:', { accounts, multipleStatements: true })
      await db.query('CREATE DATABASE test')
      const server = await serve(db, { port: 0, accounts })
      const r = await runFile(name, server.port, '', join(TMP, `ours-${job}`))
      await server.close()
      await db.end()
      results.set(name, r)
      if (flag('print') && r.status === 'f') console.log(`--- ${name}: ${r.reason}\n${r.out}`)
    }
  }
  await Promise.all(Array.from({ length: JOBS }, (_, i) => worker(i)))
  return tally([...results].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
}

const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {}
if (flag('server')) {
  fixture.server = await onServer()
  report(`8.4.11 (${fixture.server.version})`, fixture.server)
}
if (flag('ours')) {
  fixture.ours = await onOurs()
  report('ours', fixture.ours)
  if (fixture.server !== undefined) {
    const theirs = Object.entries(fixture.server.files).filter(([, s]) => s === 'p').map(([n]) => n)
    const both = theirs.filter((n) => fixture.ours.files[n] === 'p').length
    console.log(`ours passes ${both} of the ${theirs.length} files 8.4.11 passes here`)
  }
}
if (only === undefined && (flag('server') || flag('ours'))) {
  fixture.note =
    "M5.15: MySQL's own suite (mysql-community-test's t/ and r/), run by its own mysqltest against 8.4.11 and against this executor over TCP, by tools/mysqltest-run.mjs. " +
    'Per file: p passed, f failed, s skipped. Reasons are error numbers or the class of a difference, never a statement. Regenerate, never edit.'
  fixture.mysqltest = version
  fixture.total = files.length
  writeFileSync(FIXTURE, `${JSON.stringify({ note: fixture.note, mysqltest: fixture.mysqltest, total: fixture.total, server: fixture.server, ours: fixture.ours }, null, 1)}\n`)
}
