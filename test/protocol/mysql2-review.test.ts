// M5.17's review: each finding of the code review of the first executor
// commit, as a test that failed before its fix. The expected answers are a
// real 8.4.11's, asked first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { serve } from '@myjs/server'

async function open(options: Parameters<typeof MySQL.open>[1] = {}) {
  const db = await MySQL.open(':memory:', options)
  const connect = (extra: Record<string, unknown> = {}) =>
    mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', ...extra })
  const conn = await connect()
  await conn.query('CREATE DATABASE app')
  await conn.query('USE app')
  return { db, conn, connect }
}

test('review: CREATE DATABASE inside a transaction commits it first, rather than waiting on itself', async () => {
  const { db, conn } = await open()
  try {
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY)')
    await conn.query('SET innodb_lock_wait_timeout = 1')
    await conn.query('BEGIN')
    await conn.query('INSERT INTO t VALUES (1)')
    await conn.query('CREATE DATABASE d2')
    await conn.query('ROLLBACK')
    const [rows] = await conn.query('SELECT id FROM t')
    assert.deepEqual(rows, [{ id: 1 }], 'the implicit commit kept the insert')
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review: an IN list on an index never returns a row twice, whatever the literals compare as', async () => {
  const { db, conn } = await open()
  try {
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, s VARCHAR(10), dt DATETIME, KEY (s), KEY (dt))')
    await conn.query("INSERT INTO t VALUES (1, 'a', '2020-01-01 00:00:00'), (2, 'b', '2021-01-01 00:00:00')")
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_bin')
    const [s] = await conn.query("SELECT id FROM t WHERE s IN ('a', 'A')")
    assert.deepEqual(s, [{ id: 1 }])
    const [dt] = await conn.query("SELECT id FROM t WHERE dt IN ('2020-01-01', '2020-1-1')")
    assert.deepEqual(dt, [{ id: 1 }])
    const [u] = (await conn.query("UPDATE t SET id = id + 10 WHERE s IN ('a', 'A')")) as [mysql.ResultSetHeader, unknown]
    assert.equal(u.info, 'Rows matched: 1  Changed: 1  Warnings: 0')
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review: a datetime bound with more precision than the column does not narrow the range', async () => {
  const { db, conn } = await open()
  try {
    await conn.query('CREATE TABLE t (dt DATETIME PRIMARY KEY)')
    await conn.query("INSERT INTO t VALUES ('2020-01-01 12:00:00')")
    const [rows] = await conn.execute('SELECT dt FROM t WHERE dt < ?', [new Date('2020-01-01T12:00:00.500Z')])
    assert.equal((rows as unknown[]).length, 1)
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review: an UPDATE assignment sees the converted value of the ones before it', async () => {
  const { db, conn } = await open()
  try {
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, d DECIMAL(5,1), x DECIMAL(6,3), a TINYINT, j INT, ts TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP)')
    await conn.query('INSERT INTO t (id, d, x, a, j) VALUES (1, 0, 0, 0, 0)')
    await conn.query('UPDATE t SET d = 1.234, x = d')
    await conn.query("SET sql_mode = ''")
    const [u] = (await conn.query('UPDATE t SET a = 1000, j = a')) as [mysql.ResultSetHeader, unknown]
    // One adjusted value, counted once, though the ON UPDATE column re-encodes the row.
    assert.equal(u.info, 'Rows matched: 1  Changed: 1  Warnings: 1')
    const [rows] = await conn.query('SELECT d, x, a, j FROM t')
    assert.deepEqual(rows, [{ d: '1.2', x: '1.200', a: 127, j: 127 }])
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review: fractional seconds round, with the carry, as 8.4.11 rounds them', async () => {
  const { db, conn } = await open()
  try {
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, dt DATETIME, t TIME, ts TIMESTAMP NULL)')
    await conn.query("INSERT INTO t VALUES (1, '2020-01-01 10:00:00.6', '10:00:59.5', '2020-12-31 23:59:59.7')")
    const [rows] = await conn.query({ sql: 'SELECT dt, t, ts FROM t', dateStrings: true } as never)
    assert.deepEqual(rows, [{ dt: '2020-01-01 10:00:01', t: '10:01:00', ts: '2021-01-01 00:00:00' }])
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review: transaction_isolation is one setting, however it is set and read', async () => {
  const { db, conn, connect } = await open()
  try {
    await conn.query("SET SESSION transaction_isolation = 'READ-COMMITTED'")
    const [a] = await conn.query('SELECT @@transaction_isolation AS i')
    assert.deepEqual(a, [{ i: 'READ-COMMITTED' }])
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    const [b] = await conn.query('SELECT @@transaction_isolation AS i')
    assert.deepEqual(b, [{ i: 'SERIALIZABLE' }])
    await conn.query('SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED')
    const other = await connect()
    const [c] = await other.query('SELECT @@transaction_isolation AS i')
    assert.deepEqual(c, [{ i: 'READ-COMMITTED' }], 'a new session starts at the global level')
    await other.end()

    // And it is what reads see: under READ COMMITTED a second read sees a commit made between them.
    await conn.query("SET SESSION transaction_isolation = 'READ-COMMITTED'")
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY)')
    const writer = await connect({ database: 'app' })
    await conn.query('BEGIN')
    await conn.query('SELECT * FROM t')
    await writer.query('INSERT INTO t VALUES (1)')
    const [seen] = await conn.query('SELECT id FROM t')
    assert.deepEqual(seen, [{ id: 1 }])
    await conn.query('COMMIT')
    await writer.end()
  } finally {
    await conn.end()
    await db.end()
  }
})

test("review: SHOW TABLES LIKE honours LIKE's escapes", async () => {
  const { db, conn } = await open()
  try {
    await conn.query('CREATE TABLE user_roles (id INT PRIMARY KEY)')
    await conn.query('CREATE TABLE userXroles (id INT PRIMARY KEY)')
    const [rows] = await conn.query("SHOW TABLES LIKE 'user\\\\_roles'")
    assert.deepEqual(rows, [{ 'Tables_in_app (user\\_roles)': 'user_roles' }])
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review: a statement waiting for the writer does not outlive its connection', async () => {
  // Over TCP, where a socket's close is seen at once. (An in-process stream's
  // destroy used to wait for the pending write, so it could not show this.)
  const { db, conn } = await open()
  const server = await serve(db, { port: 0 })
  try {
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY)')
    const other = await mysql.createConnection({ host: '127.0.0.1', port: server.port, user: 'root', password: '', database: 'app' })
    await conn.query('BEGIN')
    await conn.query('INSERT INTO t VALUES (1)')
    // `other`, with autocommit off, blocks on the writer, then its connection
    // goes away. Run afterwards, its INSERT would open a transaction nothing
    // ends and hold the writer for good.
    await other.query('SET autocommit = 0')
    void other.query('INSERT INTO t VALUES (2)').catch(() => {})
    await new Promise((r) => setTimeout(r, 30))
    other.destroy()
    await new Promise((r) => setTimeout(r, 30))
    await conn.query('COMMIT')
    await new Promise((r) => setTimeout(r, 200))
    await conn.query('SET innodb_lock_wait_timeout = 1')
    await conn.query('INSERT INTO t VALUES (3)')
    const [rows] = await conn.query('SELECT id FROM t')
    assert.deepEqual(rows, [{ id: 1 }, { id: 3 }], 'the abandoned statement never ran')
  } finally {
    await conn.end()
    await server.close()
    await db.end()
  }
})

test('review gap: multiple statements run, when the switch and the client both allow them', async () => {
  const { db, conn, connect } = await open({ multipleStatements: true })
  try {
    const multi = await connect({ multipleStatements: true, database: 'app' })
    const [results] = (await multi.query('SELECT 1 AS a; SELECT 2 AS b')) as [unknown[], unknown]
    assert.deepEqual(results, [[{ a: 1 }], [{ b: 2 }]])
    await multi.query('CREATE TABLE t (id INT PRIMARY KEY)')
    // MySQL stops at the first error: the first insert stands, the third never runs.
    await assert.rejects(multi.query('INSERT INTO t VALUES (1); INSERT INTO t VALUES (1); INSERT INTO t VALUES (3)'), (e: unknown) => (e as { errno?: number }).errno === 1062)
    const [rows] = await multi.query('SELECT id FROM t')
    assert.deepEqual(rows, [{ id: 1 }])
    await multi.end()
  } finally {
    await conn.end()
    await db.end()
  }
})

test('review gap: end() rolls back what live connections hold, and a closed port frees the writer', async () => {
  const { db, conn, connect } = await open()
  await conn.query('CREATE TABLE t (id INT PRIMARY KEY)')
  await conn.end()
  const live = await connect({ database: 'app' })
  await live.query('BEGIN')
  await live.query('INSERT INTO t VALUES (1)')
  await db.end()
  live.destroy()
  assert.equal(db.store?.transactions.writer, undefined, 'end() rolled the open transaction back')

  // A port: its connection ends when the port is closed.
  const db2 = await MySQL.open(':memory:')
  const port = db2.createPort()
  assert.equal(db2.openConnections, 1)
  port.close()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(db2.openConnections, 0, "the port's connection ended when the port closed")
  await db2.end()
})
