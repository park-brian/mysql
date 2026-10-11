import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { MySQL, RowStream } from '@myjs/core'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { serve } from '@myjs/server'
import { Reader } from '@myjs/bytes'

test('database shutdown closes an idle MessagePort transport', { timeout: 2000 }, async () => {
  const db = await MySQL.open(':memory:')
  const port = db.createPort()
  // A reader drains the handshake; Node 22 queues remote-close behind it.
  port.addEventListener('message', () => undefined)
  port.start()
  const closed = new Promise<void>((resolve) => port.addEventListener('close', () => resolve(), { once: true }))
  try {
    await db.end()
    await closed
  } finally {
    port.close()
    await db.end()
  }
})

test('shutdown is shared even when an executor reenters end()', async () => {
  const failure = new Error('session cleanup failed')
  let reentered: Promise<void> | undefined
  const db = await MySQL.open(':memory:', { executor: {
    query: async () => ({ affectedRows: 0 }),
    prepare: async () => ({ paramCount: 0, columns: [] }),
    execute: async () => ({ affectedRows: 0 }),
    end: () => { reentered = db.end(); throw failure },
  } })
  const connection = await db.connect()
  const ending = db.end()
  assert.equal(db.closed, true)
  await assert.rejects(ending, (e) => e === failure)
  assert.equal(reentered, ending)
  await connection.end()
})

test('failed catalog initialization closes both files', async () => {
  const memory = new MemoryVfs()
  const files: { closed: boolean }[] = []
  let flushes = 0
  const open = memory.open.bind(memory)
  memory.open = async (path, options) => {
    const file = await open(path, options)
    const state = { closed: false }
    files.push(state)
    return new Proxy(file, {
      get(target, key: keyof VfsFile) {
        if (key === 'close') return () => { state.closed = true; target.close() }
        if (key === 'flush') return () => {
          if (++flushes === 5) throw new Error('catalog flush failed')
          target.flush()
        }
        const value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  await assert.rejects(MySQL.open(':memory:', { vfs: memory }), /catalog flush failed/)
  assert.equal(files.length, 2)
  assert.ok(files.every((file) => file.closed))
})

test('failed shutdown closes files, releases ownership, and shares its result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myjs-shutdown-'))
  try {
    const db = await MySQL.open(dir)
    const store = db.store!
    const failure = new Error('checkpoint failed')
    store.checkpoint = () => { throw failure }
    const ending = db.end()
    assert.equal(db.end(), ending)
    await assert.rejects(ending, (e) => e === failure)
    assert.throws(() => store.file.size(), { code: 'VFS_CLOSED' })
    assert.throws(() => store.logFile.size(), { code: 'VFS_CLOSED' })
    const reopened = await MySQL.open(dir)
    await reopened.end()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('closing a database ends idle transports and safely refuses late admissions', async () => {
  const db = await MySQL.open(':memory:')
  const server = await serve(db, { port: 0 })
  const socket = net.connect({ host: server.host, port: server.port })
  socket.on('error', () => {})
  socket.resume()
  await new Promise<void>((resolve) => socket.once('data', () => resolve()))
  const ended = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await db.end()
  await ended
  const late = net.connect({ host: server.host, port: server.port })
  late.on('error', () => {})
  late.resume()
  await new Promise<void>((resolve) => late.once('close', () => resolve()))
  await assert.rejects(serve(db, { port: 0 }), /closed database/)
  const closing = server.close()
  assert.equal(server.close(), closing)
  await closing
})

test('unsupported administration never reports a successful effect', async () => {
  const db = await MySQL.open(':memory:')
  try {
    for (const sql of ["SET PASSWORD = 'new-secret'", 'SET ROLE ALL', 'SET DEFAULT ROLE ALL TO root', 'SET RESOURCE GROUP imaginary', 'FLUSH TABLES WITH READ LOCK']) {
      await assert.rejects(db.query(sql), (e: unknown) => (e as { errno?: number }).errno === 1235)
    }
    const original = await db.connect({ password: '' })
    await original.end()
    await assert.rejects(db.connect({ password: 'new-secret' }), (e: unknown) => (e as { errno?: number }).errno === 1045)
  } finally { await db.end() }
})

test('overlapping iterator reads preserve every row and return closes once', async () => {
  let ended = 0
  const stream = new RowStream((async function* () {
    try { yield [1, 2]; yield [3, 4] } finally { ended++ }
  })())
  const rows = await Promise.all(Array.from({ length: 4 }, () => stream.next()))
  assert.deepEqual(rows.map((row) => row.value), [1, 2, 3, 4])
  await Promise.all([stream.return(), stream.return()])
  assert.equal(ended, 1)
  assert.equal((await stream.next()).done, true)
})

test('Reader rejects invalid ranges before any read', () => {
  for (const value of [NaN, Infinity, -Infinity, 0.5, -1]) {
    assert.throws(() => new Reader(Uint8Array.of(1), value), { code: 'PROTOCOL_BAD_RANGE' })
    assert.throws(() => new Reader(Uint8Array.of(1), 0, value), { code: 'PROTOCOL_BAD_RANGE' })
  }
})
