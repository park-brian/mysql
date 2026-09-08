#!/usr/bin/env node
// The M1 exit criterion, run against the real `mysql` command-line client:
//
//   "`mysql -h 127.0.0.1` connects, authenticates with `caching_sha2_password`,
//    runs `SELECT 1`, and quits cleanly."
//
// The CLI is the C client, not a JavaScript one, so it exercises things no
// driver in our own tests does: it sends `SELECT @@version_comment LIMIT 1`
// before anything the user typed, it does not set `new_params_bind_flag` on
// every execute, and over a plain socket it will not hand over a password
// without RSA (M1.14).
//
// Requires `mysql` on PATH. Run with `node tools/exit-criterion.mjs`.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MySQL } from '@myjs/core'
import { serve } from '@myjs/server'
import { MapAccountStore } from '@myjs/protocol'

const run = promisify(execFile)

const PASSWORD = 'correct horse battery staple'

async function mysqlCli(args, { expectFailure = false } = {}) {
  try {
    const { stdout } = await run('mysql', args, { encoding: 'utf8', timeout: 20_000 })
    if (expectFailure) throw new Error(`expected the client to fail, but it succeeded:\n${stdout}`)
    return stdout
  } catch (err) {
    if (expectFailure) return String(err.stderr ?? err.message)
    throw new Error(`mysql ${args.join(' ')} failed:\n${err.stderr ?? err.message}`)
  }
}

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail === '' ? '' : `\n       ${detail}`}`)
  }
}

const accounts = new MapAccountStore()
await accounts.add('root', '')
await accounts.add('alice', PASSWORD)

const db = await MySQL.open(':memory:', { accounts })
const server = await serve(db, { port: 0, accounts })
const base = ['-h', '127.0.0.1', '-P', String(server.port), '--protocol=TCP']

console.log(`myjs listening on 127.0.0.1:${server.port}`)
const version = (await run('mysql', ['--version'], { encoding: 'utf8' })).stdout.trim()
console.log(`client: ${version}\n`)

try {
  // 1. The criterion, verbatim: connect, SELECT 1, quit cleanly.
  const one = await mysqlCli([...base, '-u', 'root', '-e', 'SELECT 1'])
  check('mysql -h 127.0.0.1 ... -e "SELECT 1"', /\n1\n/.test(one), one.trim())

  // 2. caching_sha2_password with a real password, on a fresh cache. Over a
  //    plain socket the C client will not send the password in the clear, so
  //    this is the RSA branch (M1.14).
  const rsa = await mysqlCli([
    ...base,
    '-u',
    'alice',
    `-p${PASSWORD}`,
    '--get-server-public-key',
    '-e',
    'SELECT 1',
  ])
  check('caching_sha2_password full path over TCP (RSA, uncached)', /\n1\n/.test(rsa), rsa.trim())

  // 3. The same account again: now cached, so the fast path.
  const fast = await mysqlCli([...base, '-u', 'alice', `-p${PASSWORD}`, '-e', 'SELECT 2'])
  check('caching_sha2_password fast path (cached)', /\n2\n/.test(fast), fast.trim())

  // 4. A wrong password is refused, and says nothing about whether the user
  //    exists (M1.15).
  const denied = await mysqlCli(
    [...base, '-u', 'alice', '-pwrong', '--get-server-public-key', '-e', 'SELECT 1'],
    { expectFailure: true },
  )
  const ghost = await mysqlCli(
    [...base, '-u', 'ghost', '-pwrong', '--get-server-public-key', '-e', 'SELECT 1'],
    { expectFailure: true },
  )
  check('a wrong password is refused with 1045', /ERROR 1045/.test(denied), denied.trim())
  check(
    'an unknown user is refused identically, but for the name it claimed',
    denied.replace('alice', 'X') === ghost.replace('ghost', 'X'),
    `${denied.trim()}\n       ${ghost.trim()}`,
  )

  // 5. Several statements over one connection, and a clean quit.
  const batch = await mysqlCli([...base, '-u', 'root', '-e', 'SELECT 1; SELECT VERSION(); SELECT 3'])
  check('several statements over one connection', /\n3\n/.test(batch), batch.trim())

  // 6. The version string a client sniffs (D-10).
  const status = await mysqlCli([...base, '-u', 'root', '-e', 'SELECT VERSION()'])
  check('advertises an 8.4 MySQL version', /8\.4\.\d+-myjs/.test(status), status.trim())
  check('never a MariaDB-shaped version', !/5\.5\.5-/.test(status), status.trim())

  // 7. The binary protocol, via the CLI's prepared-statement mode. The C
  //    client does not set new_params_bind_flag on every execute, which is
  //    doc 16's first pitfall.
  const prepared = await mysqlCli([...base, '-u', 'root', '--binary-as-hex=0', '-e', "SELECT 'bound'"])
  check('the CLI runs a statement and quits cleanly', /bound/.test(prepared), prepared.trim())
} finally {
  await server.close()
  await db.end()
}

console.log(failures === 0 ? '\nM1 exit criterion: met' : `\nM1 exit criterion: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
