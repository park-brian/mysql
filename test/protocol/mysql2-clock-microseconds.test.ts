import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('statement clocks retain pinned microseconds across a fixed offset', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    rowsAsArray: true,
    dateStrings: true,
  })
  try {
    await conn.query("SET time_zone='-07:00', timestamp=1709208138.123456")
    const sql = 'SELECT NOW(6), NOW(3), CURRENT_TIME(6), UTC_TIMESTAMP(6), UTC_TIME(6), UNIX_TIMESTAMP()'
    const expected = [[
      '2024-02-29 05:02:18.123456', '2024-02-29 05:02:18.123', '05:02:18.123456',
      '2024-02-29 12:02:18.123456', '12:02:18.123456', 1709208138,
    ]]
    for (const method of ['query', 'execute'] as const) {
      const [rows, fields] = method === 'query' ? await conn.query(sql) : await conn.execute(sql)
      assert.deepEqual(rows, expected)
      assert.deepEqual(fields.map((f) => f.decimals), [6, 3, 6, 6, 6, 0])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
