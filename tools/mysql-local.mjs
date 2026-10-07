#!/usr/bin/env node
// A real MySQL 8.4 on this machine, for the checks that can only come from one.
//
// Every compatibility fact this project has that a document could not supply
// came from a server: `utf8mb4_bin`'s sort key, `<=>` being null-*safe*, an
// unsigned BIGINT negation saturating, `%` and `DIV` not promoting. Until now
// the only server was a container in GitHub Actions, which made the loop
// "push a branch, wait, download an artifact, commit it" — so the corpora
// stayed small and the two jobs that own them are `continue-on-error`.
//
// This is that server, locally, in one command. It is deliberately a *tool*
// rather than a README paragraph for the same reason the generators are tools:
// a procedure that is written down but not executed drifts, and the flags here
// are load-bearing.
//
//   node tools/mysql-local.mjs install     # MySQL 8.4 from repo.mysql.com
//   node tools/mysql-local.mjs start       # initialise if needed, then listen
//   node tools/mysql-local.mjs provision   # the accounts capture-traces needs
//   node tools/mysql-local.mjs status
//   node tools/mysql-local.mjs stop
//
// Version. 8.4 LTS, because D-10 targets 8.4 and because `precedence.json` and
// `storage-encodings.json` were captured against 8.4.11 — so this reproduces
// the committed corpora rather than merely resembling them.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DATADIR = join(ROOT, '.tmp/mysql')
const LOGDIR = join(ROOT, '.tmp/log')
const SOCKET = join(DATADIR, 'mysql.sock')
const PIDFILE = join(DATADIR, 'mysqld.pid')
const PORT = Number(process.env.MYJS_MYSQL_PORT ?? 3306)
const PASSWORD = 'root'

const APT_LIST = '/etc/apt/sources.list.d/mysql.list'
const KEYRING = '/usr/share/keyrings/mysql.gpg'
// The 2023 key was re-signed with a 2027 expiry and published as -2025; the
// original -2023 file still carries the expired signature and apt refuses the
// repository outright with EXPKEYSIG. Same fingerprint, longer life.
const KEY_URL = 'https://repo.mysql.com/RPM-GPG-KEY-mysql-2025'
const COMPONENT = 'mysql-8.4-lts'

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const quiet = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts })
  } catch {
    return null
  }
}
const has = (binary) => quiet('sh', ['-c', `command -v ${binary}`]) !== null

/**
 * The client arguments every caller here uses.
 *
 * `--default-character-set=utf8mb4` is not decoration. The `mysql` CLI takes
 * its default charset from the OS locale, so on a machine with no `LANG` it
 * negotiates latin1 — and a UTF-8 literal then round-trips double-encoded.
 * The capture tools pin it for the same reason.
 */
const client = (extra = []) => [
  '-h', '127.0.0.1', '-P', String(PORT), '--protocol=TCP',
  '--default-character-set=utf8mb4', '-uroot', `-p${PASSWORD}`, ...extra,
]

function install() {
  if (process.getuid?.() !== 0) {
    console.error('install needs root (it adds an apt source); re-run with sudo')
    process.exit(1)
  }
  // Debian's postinst wants to start a service, and a container has no init.
  sh('sh', ['-c', "printf '#!/bin/sh\\nexit 101\\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d"])
  sh('sh', ['-c', `curl -fsSL ${KEY_URL} | gpg --dearmor --yes -o ${KEYRING}`])
  sh('sh', ['-c', `echo 'deb [signed-by=${KEYRING}] http://repo.mysql.com/apt/ubuntu noble ${COMPONENT}' > ${APT_LIST}`])
  const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
  sh('apt-get', ['update', '-qq'], { env })
  // `mysql-community-test` carries the real `mysqltest` binary and MySQL's own
  // `.result` files. It is not needed to capture anything, and it is what makes
  // M5.15 answerable — the interpreter doc 43 §1 describes may not need writing
  // if the real one can drive our server over the protocol we already speak.
  sh('apt-get', ['install', '-y', '-qq', 'mysql-community-server', 'mysql-community-client', 'mysql-community-test'], { env })
  status()
}

function initialise() {
  if (existsSync(join(DATADIR, 'mysql'))) return
  console.log(`initialising ${DATADIR}`)
  rmSync(DATADIR, { recursive: true, force: true })
  mkdirSync(DATADIR, { recursive: true })
  sh('mysqld', ['--initialize-insecure', '--user=root', `--datadir=${DATADIR}`])
}

/**
 * Running means *answering*, not "a pid file exists".
 *
 * The first version trusted the pid file, and `stop` then `start` reported
 * "already running" against a server that had shut down — `mysqladmin
 * shutdown` returns before the file is gone, and a reused pid makes
 * `kill(pid, 0)` agree. The same mistake as probing the socket instead of the
 * port: ask the question the caller actually has.
 */
function running() {
  return quiet('mysqladmin', [...client(), 'ping', '--silent']) !== null
}

function pidAlive() {
  if (!existsSync(PIDFILE)) return false
  try {
    process.kill(Number(readFileSync(PIDFILE, 'utf8').trim()), 0)
    return true
  } catch {
    return false
  }
}

async function start() {
  if (running()) {
    console.log('already running')
    return status()
  }
  initialise()
  mkdirSync(LOGDIR, { recursive: true })
  // `--binlog-row-image=FULL` is the one flag that is not negotiable: D-34
  // takes the doc-24 storage bytes out of binlog row images, and without FULL
  // an INSERT logs only the columns that changed, so every captured vector
  // would be silently partial. `capture-types.mjs` asserts it and exits.
  const args = [
    '--user=root', `--datadir=${DATADIR}`, `--port=${PORT}`, `--socket=${SOCKET}`,
    `--pid-file=${PIDFILE}`, '--mysqlx=0', '--skip-name-resolve',
    `--log-bin=${join(DATADIR, 'binlog')}`, '--binlog-row-image=FULL',
    '--binlog-format=ROW', '--server-id=1',
  ]
  const log = openSync(join(LOGDIR, 'mysqld.log'), 'a')
  const child = spawn('mysqld', args, { detached: true, stdio: ['ignore', log, log] })
  child.unref()
  // Probed over TCP rather than the socket, and for the reason `ci.yml` already
  // records: the two are not the same question, and a socket that answers first
  // is how a capture dies with "Lost connection reading initial communication
  // packet". Wait on the path the tools actually use.
  for (let i = 0; i < 90; i++) {
    if (existsSync(SOCKET) && quiet('mysqladmin', [`--socket=${SOCKET}`, '-uroot', 'ping', '--silent']) !== null) break
    if (running()) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  grantTcp()
  status()
}

/**
 * `--initialize-insecure` creates `root@localhost` only, and `--skip-name-resolve`
 * means 127.0.0.1 is not localhost — so without this every tool here fails with
 * ER_HOST_NOT_PRIVILEGED. The password matches the capture tools' default.
 */
function grantTcp() {
  const sql = `
    ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '${PASSWORD}';
    CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED WITH caching_sha2_password BY '${PASSWORD}';
    GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
    FLUSH PRIVILEGES;`
  quiet('mysql', [`--socket=${SOCKET}`, '-uroot'], { input: sql })
}

/**
 * The two accounts `capture-traces.mjs` requires and refuses to invent.
 *
 * That refusal is right — "a tool that invented them would be re-baselining the
 * corpus rather than checking it" — but nothing else created them either, so the
 * `trace-capture` CI job has been aborting on every run since it was written,
 * invisibly, because `continue-on-error: true` makes an abort look like a pass.
 * Provisioning is a separate, explicit step, which is what that argument asks for.
 */
function provision() {
  const sql = `
    CREATE DATABASE IF NOT EXISTS tracedb;
    CREATE USER IF NOT EXISTS 'nopw'@'%' IDENTIFIED WITH caching_sha2_password BY '';
    ALTER USER 'nopw'@'%' IDENTIFIED WITH caching_sha2_password BY '';
    GRANT ALL PRIVILEGES ON tracedb.* TO 'nopw'@'%';
    CREATE USER IF NOT EXISTS 'trace'@'%' IDENTIFIED WITH caching_sha2_password BY 'tracepw';
    ALTER USER 'trace'@'%' IDENTIFIED WITH caching_sha2_password BY 'tracepw';
    GRANT ALL PRIVILEGES ON tracedb.* TO 'trace'@'%';
    FLUSH PRIVILEGES;`
  sh('mysql', client(), { input: sql, stdio: ['pipe', 'inherit', 'inherit'] })
  console.log('provisioned: tracedb, nopw (empty password), trace/tracepw')
}

async function stop() {
  if (!running() && !pidAlive()) return console.log('not running')
  quiet('mysqladmin', [...client(), 'shutdown'])
  // Waited on rather than assumed, so `stop && start` cannot race.
  for (let i = 0; i < 60 && pidAlive(); i++) await new Promise((r) => setTimeout(r, 500))
  console.log(pidAlive() ? 'shutdown requested, still exiting' : 'stopped')
}

function status() {
  const bins = ['mysqld', 'mysql', 'mysqltest', 'mysqlbinlog'].map((b) => `${b}:${has(b) ? 'yes' : 'NO'}`)
  console.log(`  binaries   ${bins.join('  ')}`)
  if (!running()) return console.log('  server     not running')
  const row = quiet('mysql', [...client(['-N', '-B']), '-e',
    'SELECT VERSION(), @@binlog_row_image, @@binlog_format, @@character_set_client'])
  console.log(`  server     ${row === null ? 'up, but not answering' : row.trim().replace(/\t/g, '  ')}`)
  console.log(`  datadir    ${DATADIR}`)
}

const command = process.argv[2] ?? 'status'
const commands = { install, start, provision, stop, status }
if (!Object.hasOwn(commands, command)) {
  console.error(`unknown command ${command}; expected one of ${Object.keys(commands).join(', ')}`)
  process.exit(1)
}
await commands[command]()
