// Typed TIME literals reject overflow instead of using string conversion's clamp.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('TIME literal bounds and fractional rounding match MySQL 8.4.11', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    for (const [literal, queryValue, executeValue, precision] of [
      ['838:59:59', '838:59:59', '838:59:59', 0],
      ['-838:59:59', '-838:59:59', '-838:59:59', 0],
      ['838:59:59.0', '838:59:59.0', '838:59:59', 1],
      ['838:59:58.999999', '838:59:58.999999', '838:59:58.999999', 6],
      ['838:59:59.0000001', '838:59:59.000000', '838:59:59', 6],
      ['838:59:58.9999995', '838:59:59.000000', '838:59:59', 6],
      ['-838:59:58.9999995', '-838:59:59.000000', '-838:59:59', 6],
      ['10:11:12.1234567', '10:11:12.123457', '10:11:12.123457', 6],
      ['24:00:00', '24:00:00', '24:00:00', 0],
    ] as const) {
      const sql = `SELECT TIME'${literal}'`
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, [[method === 'query' ? queryValue : executeValue]], `${method}: ${sql}`)
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
          [[11, precision === 0 ? 10 : 11 + precision, 129, precision, 63]], `${method}: ${sql}`)
        const [warnings] = await conn.query('SHOW WARNINGS')
        assert.deepEqual(warnings, [], `${method}: ${sql}`)
      }
    }
    for (const literal of [
      '838:59:59.000001', '-838:59:59.000001', '839:00:00', '-839:00:00',
      '838:59:59.0000005', '-838:59:59.0000005', '10:11:12abc',
    ]) {
      const sql = `SELECT TIME'${literal}'`
      for (const method of ['query', 'execute'] as const) {
        await assert.rejects(method === 'query' ? conn.query(sql) : conn.execute(sql), (error: unknown) => {
          const e = error as { errno: number; sqlState: string; sqlMessage: string }
          assert.equal(e.errno, 1525, `${method}: ${sql}`)
          assert.equal(e.sqlState, 'HY000', `${method}: ${sql}`)
          assert.equal(e.sqlMessage, `Incorrect TIME value: '${literal}'`, `${method}: ${sql}`)
          return true
        })
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
