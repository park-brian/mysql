// Doc 43 §3's replay harness, in the shape the doc gives it:
//
//   const server = new MySQLProtocolServer(fixedNonce, fixedUser)
//   for (const { direction, bytes } of trace) {
//     if (direction === 'c2s') server.feed(bytes)
//     else assertBytesEqual(server.take(), bytes)
//   }
//
// The client bytes are from a real `mysql` CLI and a real `mysql2`, recorded
// by `tools/freeze-traces.mjs`. The server bytes are ours, frozen with a fixed
// nonce and connection id — so this is a byte-exact regression gate on
// everything a functional test would let slide: a sequence id that drifts, a
// capability that stops being honoured, a packet that grows a field.
//
// Doc 44 makes this the acceptance mechanism for M1.1–M1.23: "an item is not
// done until its trace replays byte-identically."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MySQL } from '@myjs/core'
import { MapAccountStore, fixedRandom } from '@myjs/protocol'

const TRACES = new URL('./self-traces/', import.meta.url).pathname

interface SelfTrace {
  readonly name: string
  readonly nonce: number[]
  readonly connectionId: number
  readonly serverVersion: string
  readonly drivenBy: string
  readonly events: ReadonlyArray<{ direction: 'c2s' | 's2c'; bytes: number[] }>
}

const names = readdirSync(TRACES).filter((f) => f.endsWith('.json')).sort()

function loadTrace(file: string): SelfTrace {
  return JSON.parse(readFileSync(join(TRACES, file), 'utf8')) as SelfTrace
}

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join(' ')

/** Where two byte strings first differ — the only useful thing to print. */
function firstDifference(actual: Uint8Array, expected: Uint8Array): string {
  const n = Math.min(actual.length, expected.length)
  for (let i = 0; i < n; i++) {
    if (actual[i] !== expected[i]) {
      const from = Math.max(0, i - 8)
      return (
        `first difference at byte ${i}\n` +
        `  expected: ${hex(expected.subarray(from, i + 8))}\n` +
        `  actual:   ${hex(actual.subarray(from, i + 8))}`
      )
    }
  }
  return `identical for ${n} bytes, then lengths differ: expected ${expected.length}, got ${actual.length}`
}

test('there is a corpus to replay', () => {
  assert.ok(names.length >= 8, `expected frozen traces, found ${names.length}`)
})

for (const file of names) {
  const trace = loadTrace(file)
  test(`replays byte-identically: ${trace.name} (${trace.drivenBy})`, async () => {
    const accounts = new MapAccountStore()
    await accounts.add('root', '')
    await accounts.add('alice', 'correct horse battery staple')
    const db = await MySQL.open(':memory:', { accounts, serverVersion: trace.serverVersion })

    const connection = db.createConnection({
      accounts,
      connectionId: trace.connectionId,
      // Determinism comes from injecting the nonce, which is why M1.7 made the
      // random source a parameter rather than a module global.
      random: fixedRandom(Uint8Array.from(trace.nonce)),
      secureChannel: true,
    })

    const produced: number[] = []
    const expected: number[] = []

    connection.start()
    produced.push(...connection.take())

    for (const event of trace.events) {
      if (event.direction === 'c2s') {
        await connection.feed(Uint8Array.from(event.bytes))
        produced.push(...connection.take())
      } else {
        expected.push(...event.bytes)
      }
    }

    const actualBytes = Uint8Array.from(produced)
    const expectedBytes = Uint8Array.from(expected)
    assert.deepEqual(
      [...actualBytes],
      [...expectedBytes],
      // Compare the whole server-to-client stream rather than chunk by chunk:
      // how the bytes were split across TCP segments when recorded is not part
      // of the protocol, and nothing above the framer may depend on it.
      `${trace.name}: ${firstDifference(actualBytes, expectedBytes)}`,
    )
    await db.end()
  })
}

test('every frozen trace pins the inputs its bytes depend on', () => {
  for (const file of names) {
    const trace = loadTrace(file)
    assert.equal(trace.nonce.length, 20, `${file}: the scramble must be fixed`)
    assert.equal(typeof trace.connectionId, 'number', file)
    assert.match(trace.serverVersion, /^8\.4\.\d+-myjs/, file)
    assert.ok(
      trace.events.some((e) => e.direction === 'c2s'),
      `${file}: a trace with no client bytes proves nothing`,
    )
  }
})

test('a changed response is caught — the gate has teeth', async () => {
  // If replay passed against a server answering differently, it would be a
  // record of the past rather than a check on the present.
  const trace = loadTrace(names[0] as string)
  const accounts = new MapAccountStore()
  await accounts.add('root', '')
  await accounts.add('alice', 'correct horse battery staple')
  const db = await MySQL.open(':memory:', {
    accounts,
    // One character different in the version string moves every later byte.
    serverVersion: '8.4.0-myjs-9.9.9',
  })
  const connection = db.createConnection({
    accounts,
    connectionId: trace.connectionId,
    random: fixedRandom(Uint8Array.from(trace.nonce)),
    secureChannel: true,
  })
  const produced: number[] = []
  connection.start()
  produced.push(...connection.take())
  const expected = trace.events.filter((e) => e.direction === 's2c').flatMap((e) => e.bytes)
  assert.notDeepEqual([...produced], expected.slice(0, produced.length))
  await db.end()
})
