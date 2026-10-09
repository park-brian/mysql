// M5.12 — what running Prisma's and Drizzle's introspection against this
// executor found (`tools/introspection-diff.mjs`), with 8.4.11's answers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('INFORMATION_SCHEMA is named in any case in a qualified column; its tables are not (drizzle-kit pull)', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    // drizzle-kit's own query: the schema in upper case, the table as written in FROM.
    const [rows] = await conn.query({ sql: "SELECT INFORMATION_SCHEMA.STATISTICS.TABLE_SCHEMA FROM INFORMATION_SCHEMA.STATISTICS WHERE INFORMATION_SCHEMA.STATISTICS.TABLE_SCHEMA = 'mysql'", rowsAsArray: true })
    assert.ok(Array.isArray(rows))
    // A table name is matched as written (8.4.11: 1054).
    await assert.rejects(conn.query('SELECT information_schema.statistics.TABLE_SCHEMA FROM INFORMATION_SCHEMA.STATISTICS'), { errno: 1054 })
  } finally {
    await conn.end()
    await db.end()
  }
})
