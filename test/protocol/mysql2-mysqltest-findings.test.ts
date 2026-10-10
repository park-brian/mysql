// M5.15 — what running MySQL's own suite through its own `mysqltest` found,
// each finding pinned here with 8.4.11's answer, asked of the server first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function withConnection(fn: (conn: mysql.Connection) => Promise<void>): Promise<void> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await fn(conn)
  } finally {
    await conn.end()
    await db.end()
  }
}

const rows = async (conn: mysql.Connection, sql: string): Promise<unknown[][]> => (await conn.query({ sql, rowsAsArray: true }))[0] as unknown[][]

test('SCHEMATA lists information_schema, and every schema in the order it was made (1st.test)', async () => {
  await withConnection(async (conn) => {
    await conn.query('CREATE DATABASE zz')
    await conn.query('CREATE DATABASE aa')
    assert.deepEqual(await rows(conn, 'SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA'), [
      ['mysql', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
      ['information_schema', 'utf8mb3', 'utf8mb3_general_ci'],
      ['performance_schema', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
      ['sys', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
      ['zz', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
      ['aa', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
    ])
  })
})
