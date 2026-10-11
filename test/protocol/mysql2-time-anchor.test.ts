// Mixed temporal comparisons anchor TIME at the statement date, including borrows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('TIME comparison anchoring preserves negative sub-millisecond fractions', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('SET timestamp=1791547200') // 2026-10-09, statement clock.
    for (const [time, datetime, beforeMidnight] of [
      ['-00:00:00.000001', '2026-10-08 23:59:59.999999', 1],
      ['-00:00:00.000999', '2026-10-08 23:59:59.999001', 1],
      ['-00:00:01.000001', '2026-10-08 23:59:58.999999', 1],
      ['-01:00:00.000001', '2026-10-08 22:59:59.999999', 1],
      ['-25:00:00.000001', '2026-10-07 22:59:59.999999', 1],
      ['00:00:00.000001', '2026-10-09 00:00:00.000001', 0],
      ['25:00:00.000001', '2026-10-10 01:00:00.000001', 0],
    ] as const) {
      const t = `TIME'${time}'`, d = `TIMESTAMP'${datetime}'`
      const sql = `SELECT ${t}=${d},${d}=${t},${t}<TIMESTAMP'2026-10-09 00:00:00',${t} IN(${d}),${t} BETWEEN ${d} AND ${d},CASE WHEN ${t}=${d} THEN 1 ELSE 0 END,NULLIF(${t},${d}),${t}=NULL,${t} IN(NULL)`
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, [[1, 1, beforeMidnight, 1, 1, 1, null, null, null]], `${method}: ${sql}`)
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [
          ...Array.from({ length: 5 }, () => [8, 1, 129, 0, 63]),
          [8, 2, 129, 0, 63], [253, 68, 0, 31, 224], [8, 1, 128, 0, 63], [8, 1, 128, 0, 63],
        ], `${method}: ${sql}`)
        const [warnings] = await conn.query('SHOW WARNINGS')
        assert.deepEqual(warnings, [], `${method}: ${sql}`)
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
