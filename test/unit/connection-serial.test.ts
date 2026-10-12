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
import { COM, MapAccountStore, PacketFramer, Session, capabilities, sqlError } from '@myjs/protocol'
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
    async query(session, sql) {
      running++
      peak = Math.max(peak, running)
      order.push(sql)
      await new Promise((resolve) => setTimeout(resolve, 5))
      try {
        return await inner.query(session, sql)
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

test('closing while PREPARE metadata is delivered stops output and ends its session once', async () => {
  let ended = 0
  const db = await MySQL.open(':memory:', { executor: {
    query: async () => ({ affectedRows: 0 }),
    prepare: async () => ({ paramCount: 32_000, columns: [] }),
    execute: async () => ({ affectedRows: 0 }),
    end: () => { ended++ },
  } })
  const connection = db.createConnection()
  const { WireClient } = await import('../../packages/core/src/client/wire.ts')
  await WireClient.connect(connection, { user: 'root', password: '' })
  let packets = 0
  connection.onOutput(() => {
    if (connection.take().length === 0) return
    packets++
    if (packets === 1000) connection.close()
  })
  const framer = new PacketFramer()
  try {
    await connection.feed(framer.encode(new Uint8Array([COM.STMT_PREPARE, 0x3f])))
    assert.equal(packets, 1000, 'metadata continued after close')
    assert.equal(connection.closed, true)
    assert.equal(ended, 1)
    await connection.feed(command('SELECT 1'))
    assert.equal(packets, 1000)
  } finally {
    await db.end()
  }
  assert.equal(ended, 1)
})

test('a PREPARE paused after lexing cannot resume an ended session', async (t) => {
  const executor = new SqlExecutor()
  const session = new Session({ connectionId: 1, capabilities: capabilities(0) })
  let time = 0
  t.mock.method(performance, 'now', () => (time += 20))
  const pending = executor.prepare(session, 'SELECT ?')
  executor.end(session)
  await assert.rejects(pending, { code: 'ER_QUERY_INTERRUPTED' })
  await assert.rejects(executor.prepare(session, 'SELECT 1'), { code: 'ER_QUERY_INTERRUPTED' })
})

test('session initialization captures before greeting, waits for authentication and repeats after reset', async () => {
  let global = 1
  const events: string[] = []
  const db = await MySQL.open(':memory:', { executor: {
    query: async () => ({ affectedRows: 0 }),
    prepare: async () => ({ paramCount: 0, columns: [] }),
    execute: async () => ({ affectedRows: 0 }),
    openSession(reset) {
      const captured = global
      events.push(`capture:${captured}:${reset === true}`)
      return (session) => { assert.equal(session.user, 'root'); events.push(`apply:${captured}`) }
    },
    reset: () => { events.push('reset') },
    end: () => { events.push('end') },
  } })
  const connection = db.createConnection()
  try {
    connection.start()
    global = 2
    const { WireClient } = await import('../../packages/core/src/client/wire.ts')
    await WireClient.connect(connection, { user: 'root', password: '' })
    assert.deepEqual(events, ['capture:1:false', 'apply:1'])
    const framer = new PacketFramer()
    await connection.feed(framer.encode(new Uint8Array([COM.RESET_CONNECTION])))
    assert.deepEqual(events, ['capture:1:false', 'apply:1', 'reset', 'capture:2:true', 'apply:2'])
  } finally { await db.end() }
  assert.equal(events.filter((e) => e === 'end').length, 1)
})

test('failed authentication never applies the captured initializer', async () => {
  let captured = 0
  let initialized = 0
  let ended = 0
  const db = await MySQL.open(':memory:', { executor: {
    query: async () => ({ affectedRows: 0 }),
    prepare: async () => ({ paramCount: 0, columns: [] }),
    execute: async () => ({ affectedRows: 0 }),
    openSession: () => { captured++; return () => { initialized++ } },
    end: () => { ended++ },
  } })
  try {
    const connection = db.createConnection()
    const { WireClient } = await import('../../packages/core/src/client/wire.ts')
    await assert.rejects(WireClient.connect(connection, { user: 'root', password: 'wrong' }), { errno: 1045 })
    assert.equal(connection.closed, true)
    assert.equal(captured, 1)
    assert.equal(initialized, 0)
    assert.equal(ended, 1)
  } finally { await db.end() }
  assert.equal(ended, 1)
})

test('closing while the handshake database waits never initializes or emits a late OK or ERR', async () => {
  for (const fail of [false, true]) {
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    let initialized = 0
    let ended = 0
    const db = await MySQL.open(':memory:', { executor: {
      query: async () => ({ affectedRows: 0 }),
      prepare: async () => ({ paramCount: 0, columns: [] }),
      execute: async () => ({ affectedRows: 0 }),
      openSession: () => () => { initialized++ },
      async initDb() { enter(); await held; if (fail) throw sqlError('ER_BAD_DB_ERROR', 'missing') },
      end: () => { ended++ },
    } })
    try {
      const connection = db.createConnection()
      const { WireClient } = await import('../../packages/core/src/client/wire.ts')
      const pending = WireClient.connect(connection, { user: 'root', password: '', database: 'd' })
      await entered
      connection.close()
      let late = 0
      connection.onOutput(() => { late += connection.take().length })
      release()
      await assert.rejects(pending)
      assert.equal(connection.closed, true)
      assert.equal(initialized, 0)
      assert.equal(ended, 1)
      assert.equal(late, 0)
    } finally { release(); await db.end() }
    assert.equal(ended, 1)
  }
})

test('closing from greeting or authentication output never reopens the command phase', async () => {
  for (const stage of ['greeting', 'authenticating', 'authenticated']) {
    let queries = 0
    let initialized = 0
    let databases = 0
    const accounts = new MapAccountStore()
    const password = stage === 'authenticating' ? 'secret' : ''
    await accounts.add('root', password)
    const db = await MySQL.open(':memory:', { accounts, executor: {
      query: async () => { queries++; return { affectedRows: 0 } },
      initDb: async () => { databases++ },
      prepare: async () => ({ paramCount: 0, columns: [] }),
      execute: async () => ({ affectedRows: 0 }),
      openSession: () => () => { initialized++ },
    } })
    try {
      const connection = db.createConnection()
      connection.onOutput(() => { if (stage === 'greeting' || connection.session?.user === 'root') connection.close() })
      if (stage === 'greeting') connection.start()
      else {
        const { WireClient } = await import('../../packages/core/src/client/wire.ts')
        const pending = WireClient.connect(connection, { user: 'root', password, database: 'd' })
        if (stage === 'authenticating') await assert.rejects(pending)
        else await pending
      }
      assert.equal(connection.closed, true)
      assert.equal(initialized, stage === 'authenticated' ? 1 : 0)
      assert.equal(databases, stage === 'authenticated' ? 1 : 0)
      await connection.feed(command('SELECT 1'))
      assert.equal(queries, 0, 'a closed custom executor must receive no commands')
    } finally { await db.end() }
  }
})
