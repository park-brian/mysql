// A connection runs one command at a time, however its bytes arrive.
//
// A client may send a command the server never answers (COM_STMT_CLOSE,
// COM_STMT_SEND_LONG_DATA) and the next one at once, so a transport can feed
// a connection again before the last feed settled. The TCP listener, a
// MessagePort and `execProtocol` all do. Before feeds were serialised, the
// second feed started a second pump over the same framer, and the two
// commands ran side by side.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COM } from '@myjs/protocol'
import { MySQL, SqlExecutor } from '@myjs/core'
import type { Executor } from '@myjs/protocol'

/** An executor that holds each query for a few turns and records how many overlap. */
function overlapping(): { executor: Executor; peak: () => number; order: string[] } {
  const inner = new SqlExecutor()
  let running = 0
  let peak = 0
  const order: string[] = []
  const executor: Executor = {
    prepare: (s, sql) => inner.prepare(s, sql),
    execute: (s, sql, p) => inner.execute(s, sql, p),
    async query(session, sql, attributes) {
      running++
      peak = Math.max(peak, running)
      order.push(sql)
      await new Promise((resolve) => setTimeout(resolve, 5))
      try {
        return await inner.query(session, sql, attributes)
      } finally {
        running--
      }
    },
  }
  return { executor, peak: () => peak, order }
}

/** A COM_QUERY packet, with the empty attribute set CLIENT_QUERY_ATTRIBUTES asks for. */
function command(sql: string): Uint8Array {
  const body = new Uint8Array([0, 1, ...new TextEncoder().encode(sql)])
  const out = new Uint8Array(5 + body.length)
  const length = body.length + 1
  out[0] = length & 0xff
  out[1] = (length >> 8) & 0xff
  out[2] = length >> 16
  out[3] = 0 // each command's sequence starts at zero
  out[4] = COM.QUERY
  out.set(body, 5)
  return out
}

test('two feeds made without waiting run their commands one after the other', async () => {
  const { executor, peak, order } = overlapping()
  const db = await MySQL.open(':memory:', { executor })
  const connection = db.createConnection()
  // The handshake, through the query API's own wire client.
  const { WireClient } = await import('../../packages/core/src/client/wire.ts')
  await WireClient.connect(connection, { user: 'root', password: '' })

  const first = connection.feed(command('SELECT 1'))
  const second = connection.feed(command('SELECT 2'))
  await Promise.all([first, second])

  assert.equal(peak(), 1, 'the second command started while the first was running')
  assert.deepEqual(order, ['SELECT 1', 'SELECT 2'])
  // Both answers, in order: two result sets, each ending in an EOF or OK.
  const out = connection.take()
  const text = new TextDecoder('latin1').decode(out)
  assert.ok(text.indexOf('1') < text.lastIndexOf('2'))
  await db.end()
})

test('concurrent execProtocol calls each get their own response', async () => {
  const { executor } = overlapping()
  const db = await MySQL.open(':memory:', { executor })
  const connection = db.createConnection()
  const { WireClient } = await import('../../packages/core/src/client/wire.ts')
  await WireClient.connect(connection, { user: 'root', password: '' })

  const [a, b] = await Promise.all([connection.execProtocol(command("SELECT 'aaa'")), connection.execProtocol(command("SELECT 'bbb'"))])
  const latin1 = new TextDecoder('latin1')
  assert.ok(latin1.decode(a).includes('aaa') && !latin1.decode(a).includes('bbb'))
  assert.ok(latin1.decode(b).includes('bbb') && !latin1.decode(b).includes('aaa'))
  await db.end()
})
