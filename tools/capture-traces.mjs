#!/usr/bin/env node
// Doc 43 §3 — capture real client/server byte exchanges, to replay against us.
//
// Doc 43 names `tcpdump`. This is a recording TCP proxy instead: it needs no
// privileges, it cannot lose a packet to a capture buffer, and it writes
// directly in the `{ direction, bytes }` shape `loadTrace()` consumes — so
// there is no pcap parsing between the wire and the fixture.
//
// Usage:
//   node tools/capture-traces.mjs --to 127.0.0.1:3306 --out test/protocol/fixtures
// then point a client at the printed port. Or let it drive the clients itself:
//   node tools/capture-traces.mjs --all
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const [UPSTREAM_HOST, UPSTREAM_PORT] = (arg('to', '127.0.0.1:3306')).split(':')
const OUT_DIR = arg('out', new URL('../test/protocol/fixtures/', import.meta.url).pathname)

/**
 * Capture one scenario by proxying a real client to a real server.
 *
 * Every chunk is recorded as it crosses, in order, with its direction. The
 * proxy never reframes: a fixture is the byte stream exactly as it appeared,
 * including how it happened to be split across TCP segments, because the
 * framer's whole job is to be indifferent to that.
 */
async function capture(name, driver) {
  const events = []
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(UPSTREAM_PORT), UPSTREAM_HOST)
    client.on('data', (b) => {
      events.push({ direction: 'c2s', bytes: [...b] })
      upstream.write(b)
    })
    upstream.on('data', (b) => {
      events.push({ direction: 's2c', bytes: [...b] })
      client.write(b)
    })
    const close = () => {
      client.destroy()
      upstream.destroy()
    }
    client.on('end', close)
    client.on('close', close)
    client.on('error', close)
    upstream.on('end', close)
    upstream.on('error', close)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    await driver(port)
  } finally {
    await new Promise((r) => setTimeout(r, 150))
    await new Promise((r) => server.close(r))
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${name}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      {
        name,
        capturedAgainst: `mysql-server ${await serverVersion()}`,
        capturedWith: (await run('mysql', ['--version'], { encoding: 'utf8' })).stdout.trim(),
        note: 'Recorded by tools/capture-traces.mjs. Bytes are as they crossed the wire.',
        events,
      },
      null,
      2,
    ) + '\n',
  )
  const c2s = events.filter((e) => e.direction === 'c2s').length
  const s2c = events.filter((e) => e.direction === 's2c').length
  console.log(`${name.padEnd(30)} ${String(c2s).padStart(3)} c2s / ${String(s2c).padStart(3)} s2c -> ${file}`)
  return events
}

let cachedVersion = null
async function serverVersion() {
  cachedVersion ??= (
    await run('mysql', ['--protocol=socket', '-u', 'root', '-N', '-B', '-e', 'SELECT VERSION()'], {
      encoding: 'utf8',
    })
  ).stdout.trim()
  return cachedVersion
}

/**
 * Drive `mysql2` through the proxy.
 *
 * The CLI's `-e` uses the text protocol throughout, so a binary resultset can
 * only be captured with a client that prepares — which is also the client most
 * of our users will bring (doc 43 §3).
 */
const driver = (port, user, password, run2) => async () => {
  const mysql = (await import('mysql2/promise')).default
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port,
    user,
    password,
    // Force the RSA branch off for these: we want the resultset bytes, not
    // another copy of the auth exchange.
    insecureAuth: false,
  })
  try {
    await run2(conn)
  } finally {
    await conn.end()
  }
}

/**
 * Drive the `mysql` CLI through the proxy.
 *
 * `--ssl-mode=DISABLED` matters: the client defaults to PREFERRED and a real
 * server advertises `CLIENT_SSL`, so an unconfigured capture upgrades to TLS
 * after the 32-byte SSLRequest and every later byte is ciphertext. We never
 * advertise `CLIENT_SSL` in-process (D-12), so this also matches the
 * negotiation our own server offers.
 */
const cli = (port, extra, sql) =>
  run(
    'mysql',
    ['-h', '127.0.0.1', '-P', String(port), '--protocol=TCP', '--ssl-mode=DISABLED', ...extra, '-e', sql],
    { encoding: 'utf8' },
  ).catch((e) => ({ stdout: String(e.stderr ?? e.message) }))

/**
 * Empty the server's `caching_sha2_password` cache.
 *
 * Without this the "full path" capture records the *fast* path, because an
 * earlier connection in the same server run already cached the account — the
 * exact thing that makes M1.14 hard to test by accident.
 */
async function flushAuthCache() {
  await run('mysql', ['--protocol=socket', '-u', 'root', '-e', 'FLUSH PRIVILEGES'], {
    encoding: 'utf8',
  })
}

if (process.argv.includes('--all')) {
  // Each scenario isolates one thing an M1 item claims to get right.
  await capture('handshake-empty-password', (p) => cli(p, ['-u', 'nopw'], 'SELECT 1'))
  await flushAuthCache()
  await capture('caching-sha2-full-rsa', (p) =>
    cli(p, ['-u', 'trace', '-ptracepw', '--get-server-public-key'], 'SELECT 1'),
  )
  await capture('caching-sha2-fast', (p) => cli(p, ['-u', 'trace', '-ptracepw'], 'SELECT 2'))
  await capture('access-denied', (p) =>
    cli(p, ['-u', 'trace', '-pwrong', '--get-server-public-key'], 'SELECT 1'),
  )
  await capture('com-ping', (p) => cli(p, ['-u', 'nopw'], 'DO 1'))
  await capture('text-resultset-literals', (p) =>
    cli(p, ['-u', 'nopw'], "SELECT 1, 'two', NULL, 3.5"),
  )
  await capture('text-resultset-decimal', (p) =>
    cli(p, ['-u', 'nopw'], 'SELECT CAST(1234567890.1234 AS DECIMAL(14,4))'),
  )
  await capture('version-comment', (p) => cli(p, ['-u', 'nopw'], 'SELECT @@version_comment LIMIT 1'))
  // A table the user *may* see and that does not exist, so the answer is
  // ER_NO_SUCH_TABLE rather than a privilege error.
  await capture('error-unknown-table', (p) =>
    cli(p, ['-u', 'trace', '-ptracepw'], 'SELECT * FROM tracedb.no_such_table'),
  )
  await capture('binary-temporals', (p) =>
    cli(
      p,
      ['-u', 'nopw'],
      "SELECT CAST('2010-10-17' AS DATE), CAST('2010-10-17 19:27:30.000001' AS DATETIME(6)), CAST('-120:19:27.000001' AS TIME(6)), CAST('00:00:00' AS TIME)",
    ),
  )
  // Binary protocol, via a client that prepares.
  await capture('binary-temporals-prepared', (p) =>
    driver(p, 'nopw', '', async (conn) => {
      await conn.execute(
        "SELECT CAST('2010-10-17' AS DATE) a, " +
          "CAST('2010-10-17 19:27:30.000001' AS DATETIME(6)) b, " +
          "CAST('-120:19:27.000001' AS TIME(6)) c, " +
          "CAST('00:00:00' AS TIME) d",
      )
    })(),
  )
  await capture('binary-scalars-prepared', (p) =>
    driver(p, 'nopw', '', async (conn) => {
      await conn.execute('SELECT ? + 0 AS n, ? AS s', [41, 'foo'])
    })(),
  )
  await capture('mysql2-handshake', (p) =>
    driver(p, 'trace', 'tracepw', async (conn) => {
      await conn.query('SELECT 1')
    })(),
  )

  console.log('\ncaptured against', await serverVersion())
}
