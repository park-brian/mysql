// M5.13 — INFORMATION_SCHEMA.ENGINES, SHOW ENGINES and SHOW TABLE STATUS, as
// the queries over INFORMATION_SCHEMA 8.4.11 makes of them. Expected answers
// are the server's, but for what this server supports, which is its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connected<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE d')
    await conn.query('USE d')
    return await fn(conn)
  } finally {
    await conn.end()
    await db.end()
  }
}

const meta = (fields: mysql.FieldPacket[]): unknown[][] => fields.map((f) => [f.name, f.orgName, f.table, f.columnType, f.columnLength, f.flags])

test("ENGINES lists 8.4.11's engines in its order, as supported here, and SHOW ENGINES is that table renamed", async () => {
  await connected(async (conn) => {
    const [rows] = await conn.query({ sql: 'SELECT ENGINE, SUPPORT, TRANSACTIONS, XA, SAVEPOINTS FROM information_schema.ENGINES', rowsAsArray: true })
    assert.deepEqual((rows as unknown[][]).slice(0, 5), [
      ['ndbcluster', 'NO', null, null, null],
      ['MEMORY', 'YES', 'NO', 'NO', 'NO'],
      ['InnoDB', 'DEFAULT', 'YES', 'NO', 'YES'],
      ['PERFORMANCE_SCHEMA', 'NO', null, null, null],
      ['MyISAM', 'YES', 'NO', 'NO', 'NO'],
    ])
    assert.equal((rows as unknown[]).length, 11)
    const [shown, fields] = await conn.query({ sql: 'SHOW ENGINES', rowsAsArray: true })
    assert.equal((shown as unknown[]).length, 11)
    // 8.4.11's metadata, through mysql2.
    assert.deepEqual(meta(fields as mysql.FieldPacket[]), [
      ['Engine', 'ENGINE', 'ENGINES', 253, 256, 1],
      ['Support', 'SUPPORT', 'ENGINES', 253, 32, 1],
      ['Comment', 'COMMENT', 'ENGINES', 253, 320, 1],
      ['Transactions', 'TRANSACTIONS', 'ENGINES', 253, 12, 0],
      ['XA', 'XA', 'ENGINES', 253, 12, 0],
      ['Savepoints', 'SAVEPOINTS', 'ENGINES', 253, 12, 0],
    ])
  })
})

test("SHOW TABLE STATUS: the database's tables and views by name, LIKE and WHERE, with 8.4.11's columns", async () => {
  await connected(async (conn) => {
    await conn.query("CREATE TABLE t (a INT PRIMARY KEY AUTO_INCREMENT, b VARCHAR(10)) COMMENT 'hi'")
    await conn.query('CREATE VIEW v AS SELECT 1 AS x')
    await conn.query('CREATE TABLE m (a INT) ENGINE=MEMORY')
    const [rows, fields] = await conn.query({ sql: 'SHOW TABLE STATUS', rowsAsArray: true })
    const shape = (rows as unknown[][]).map((r) => [r[0], r[1], r[2], r[3], r[14], r[17]])
    assert.deepEqual(shape, [
      ['m', 'MEMORY', 10, 'Fixed', 'utf8mb4_0900_ai_ci', ''],
      ['t', 'InnoDB', 10, 'Dynamic', 'utf8mb4_0900_ai_ci', 'hi'],
      ['v', null, null, null, null, 'VIEW'],
    ])
    // Sorted over the view, so read from a temporary table: 8.4.11's types, lengths and flags.
    assert.deepEqual(
      meta(fields as mysql.FieldPacket[]).map((m) => [m[0], m[1], m[3], m[4], m[5]]).slice(0, 5),
      [['Name', 'Name', 253, 256, 4225], ['Engine', 'Engine', 253, 256, 0], ['Version', 'Version', 3, 3, 0], ['Row_format', 'Row_format', 254, 40, 384], ['Rows', 'Rows', 8, 21, 32]],
    )
    assert.deepEqual(((await conn.query({ sql: "SHOW TABLE STATUS LIKE 'v'", rowsAsArray: true }))[0] as unknown[][]).map((r) => r[0]), ['v'])
    assert.deepEqual(((await conn.query({ sql: "SHOW TABLE STATUS WHERE Engine = 'InnoDB'", rowsAsArray: true }))[0] as unknown[][]).map((r) => r[0]), ['t'])
    await assert.rejects(conn.query('SHOW TABLE STATUS FROM nope'), { errno: 1049 })
  })
})
