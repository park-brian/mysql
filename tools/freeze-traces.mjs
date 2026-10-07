#!/usr/bin/env node
// Doc 43 §3, second direction — freeze our own answers and replay them.
//
// The conformance fixtures prove our *readers* understand a real server. This
// proves our *writers* do not drift: a real client drives our server with a
// fixed nonce, and every byte we send is frozen. Doc 43's reason for wanting
// this is precise — "This catches sequence-id and capability-negotiation
// errors that functional tests miss entirely, because functional tests only
// notice when something is *very* wrong."
//
// Run after a deliberate protocol change:  node tools/freeze-traces.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MySQL } from '@myjs/core'
import { MapAccountStore, fixedRandom } from '@myjs/protocol'

const run = promisify(execFile)
const OUT_DIR = new URL('../test/protocol/self-traces/', import.meta.url).pathname

// Everything a response depends on is pinned, so the bytes are reproducible.
export const FIXED_NONCE = Uint8Array.from(
  Array.from({ length: 20 }, (_, i) => (i * 7 + 11) & 0xff),
)
export const FIXED_CONNECTION_ID = 42
export const FIXED_SERVER_VERSION = '8.4.0-myjs-0.1.0'

export async function fixedAccounts() {
  const accounts = new MapAccountStore()
  await accounts.add('root', '')
  await accounts.add('alice', 'correct horse battery staple')
  return accounts
}

/** Serve one connection from our engine, recording both directions. */
async function record(name, driver) {
  const accounts = await fixedAccounts()
  const db = await MySQL.open(':memory:', { accounts, serverVersion: FIXED_SERVER_VERSION })
  const events = []

  const server = net.createServer(async (socket) => {
    const connection = db.createConnection({
      accounts,
      connectionId: FIXED_CONNECTION_ID,
      random: fixedRandom(FIXED_NONCE),
      // In-process semantics over a socket, so no RSA key enters the trace and
      // the bytes stay reproducible run to run.
      secureChannel: true,
    })
    const flush = () => {
      const out = connection.take()
      if (out.length > 0) {
        events.push({ direction: 's2c', bytes: [...out] })
        socket.write(Buffer.from(out))
      }
      if (connection.closed) socket.end()
    }
    connection.start()
    flush()
    socket.on('data', (chunk) => {
      events.push({ direction: 'c2s', bytes: [...chunk] })
      connection
        .feed(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        .then(flush)
        .catch(() => socket.destroy())
    })
    socket.on('error', () => socket.destroy())
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await driver(server.address().port)
  } finally {
    await new Promise((r) => setTimeout(r, 150))
    await new Promise((r) => server.close(r))
    await db.end()
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${name}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      {
        name,
        note:
          'Our own responses, frozen. The client bytes are from a real client; ' +
          'the server bytes are ours, with a fixed nonce and connection id.',
        nonce: [...FIXED_NONCE],
        connectionId: FIXED_CONNECTION_ID,
        serverVersion: FIXED_SERVER_VERSION,
        drivenBy: name.startsWith('cli-') ? 'mysql CLI' : 'mysql2',
        events,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`${name.padEnd(28)} ${String(events.length).padStart(3)} events -> ${file}`)
}

const cli = (port, extra, sql) =>
  run(
    'mysql',
    ['-h', '127.0.0.1', '-P', String(port), '--protocol=TCP', '--ssl-mode=DISABLED', ...extra, '-e', sql],
    { encoding: 'utf8' },
  ).catch((e) => ({ stdout: String(e.stderr ?? e.message) }))

const withMysql2 = (port, user, password, body) => async () => {
  const mysql = (await import('mysql2/promise')).default
  const conn = await mysql.createConnection({ host: '127.0.0.1', port, user, password })
  try {
    await body(conn)
  } finally {
    await conn.end()
  }
}

/**
 * `--reanswer`: keep every trace's *client* bytes and record our server's
 * answers to them afresh. For a deliberate change to what the server says —
 * M5's executor answering `SELECT 1` with the metadata a real 8.4.11 sends,
 * where the stub sent its own — without re-recording the clients, so the
 * frozen diff is exactly the change in our bytes and nothing else.
 */
if (process.argv.includes('--reanswer')) {
  const { readdirSync, readFileSync } = await import('node:fs')
  for (const file of readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const path = OUT_DIR + file
    const trace = JSON.parse(readFileSync(path, 'utf8'))
    const accounts = await fixedAccounts()
    const db = await MySQL.open(':memory:', { accounts, serverVersion: trace.serverVersion })
    const connection = db.createConnection({
      accounts,
      connectionId: trace.connectionId,
      random: fixedRandom(Uint8Array.from(trace.nonce)),
      secureChannel: true,
    })
    const events = []
    connection.start()
    const first = connection.take()
    if (first.length > 0) events.push({ direction: 's2c', bytes: [...first] })
    for (const e of trace.events) {
      if (e.direction !== 'c2s') continue
      events.push(e)
      await connection.feed(Uint8Array.from(e.bytes))
      const out = connection.take()
      if (out.length > 0) events.push({ direction: 's2c', bytes: [...out] })
    }
    writeFileSync(path, JSON.stringify({ ...trace, events }, null, 2) + '\n')
    console.log(`${file.padEnd(36)} re-answered`)
    await db.end()
  }
  process.exit(0)
}

await record('cli-empty-password-select-1', (p) => cli(p, ['-u', 'root'], 'SELECT 1'))
await record('cli-password-select-1', (p) =>
  cli(p, ['-u', 'alice', '-pcorrect horse battery staple'], 'SELECT 1'),
)
await record('cli-access-denied', (p) => cli(p, ['-u', 'alice', '-pwrong'], 'SELECT 1'))
await record('cli-version-comment', (p) => cli(p, ['-u', 'root'], 'SELECT @@version_comment LIMIT 1'))
await record('cli-literals', (p) => cli(p, ['-u', 'root'], "SELECT 1, 'two', NULL"))
await record('cli-error-not-supported', (p) => cli(p, ['-u', 'root'], 'DELETE FROM nothing'))
await record('mysql2-select-1', (p) =>
  withMysql2(p, 'root', '', async (c) => {
    await c.query('SELECT 1')
  })(),
)
await record('mysql2-prepared', (p) =>
  withMysql2(p, 'root', '', async (c) => {
    await c.execute('SELECT ?', ['bound'])
  })(),
)
await record('mysql2-ping', (p) =>
  withMysql2(p, 'root', '', async (c) => {
    await c.ping()
    await c.ping()
  })(),
)
console.log('\nfrozen. `npm test` now replays these byte for byte.')
