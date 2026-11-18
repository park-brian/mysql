import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.10: REPLACE copies long text and binary replacements through both protocols', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    rowsAsArray: true,
  })
  try {
    if (db === undefined) assert.deepEqual((await conn.query('SELECT VERSION()'))[0], [['8.4.11']])
    const cases = [
      ["REPLACE(REPEAT('a', 2), 'a', REPEAT('x', 150000))", 300000, '7878787878787878'],
      ["REPLACE(REPEAT(X'610061', 2), X'61', UNHEX(REPEAT('80ff', 75000)))", 600002, '80FF80FF80FF80FF'],
    ] as const
    for (const [value, length, end] of cases) {
      const sql = `SELECT LENGTH(${value}) AS n, HEX(RIGHT(${value}, 8)) AS tail`
      for (const method of ['query', 'execute'] as const) {
        const [rows] = method === 'query' ? await conn.query(sql) : await conn.execute(sql)
        assert.deepEqual(rows, [[length, end]])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
