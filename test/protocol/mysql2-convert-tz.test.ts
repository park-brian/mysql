import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('CONVERT_TZ parses numeric offsets as MySQL does', async () => {
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
    const sql = "SELECT CONVERT_TZ(TIMESTAMP'2026-11-18 02:00:00',?,'+00:00'), CONVERT_TZ(TIMESTAMP'2026-11-18 02:00:00','+00:00',?)"
    const cases = [
      ['+1:2', '2026-11-18 00:58:00', '2026-11-18 03:02:00'],
      ['+:02', '2026-11-18 01:58:00', '2026-11-18 02:02:00'],
      ['+0005:0003', '2026-11-17 20:57:00', '2026-11-18 07:03:00'],
      ['+14:0', '2026-11-17 12:00:00', '2026-11-18 16:00:00'],
      ['-13:59', '2026-11-18 15:59:00', '2026-11-17 12:01:00'],
      ...['+:1', '-14:00', '+00:60', '+00:00 ', '+00:00\n', null].map((offset) => [offset, null, null]),
    ]
    for (const [offset, utc, local] of cases) {
      const params = [offset ?? null, offset ?? null]
      for (const method of ['query', 'execute'] as const) {
        const [rows, fields] = method === 'query' ? await conn.query(sql, params) : await conn.execute(sql, params)
        assert.deepEqual(rows, [[utc, local]], `${method} ${JSON.stringify(offset)}`)
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags]), [[12, 19, 128], [12, 19, 128]])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
