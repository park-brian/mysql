// Literal byte widths and metadata observed on pinned MySQL 8.4.11.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('empty and leading-zero BIT literals retain bytes, metadata and numeric values', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    const cases: readonly (readonly [string, unknown[][], number[][]])[] = [
      ["SELECT b'', b'0', b'000000000', b'000000001', b'00000000000000001'",
        [[Buffer.from([]), Buffer.from([0]), Buffer.from([0, 0]), Buffer.from([0, 1]), Buffer.from([0, 0, 1])]],
        [0, 1, 2, 2, 3].map((length) => [253, length, 129, 0, 63])],
      ["SELECT HEX(b''), LENGTH(b''), HEX(b'000000000'), LENGTH(b'000000000'), HEX(b'000000001'), LENGTH(b'000000001')",
        [['', 0, '0000', 2, '0001', 2]],
        [[253, 0, 0, 31, 224], [8, 10, 129, 0, 63], [253, 16, 0, 31, 224], [8, 10, 129, 0, 63], [253, 16, 0, 31, 224], [8, 10, 129, 0, 63]]],
      ["SELECT b''+0, b'000000000'+0, b'000000001'+0, HEX(_binary b''), HEX(_latin1 b'000000001')",
        [[0, 0, 1, '', '0001']],
        [[8, 3, 129, 0, 63], [8, 7, 129, 0, 63], [8, 7, 129, 0, 63], [253, 0, 0, 31, 224], [253, 16, 0, 31, 224]]],
      ["SELECT X''+0, X''*0, b''*0, b''-0, b'0'+0, b'00000000'+0",
        [[0, 0, 0, 0, 0, 0]],
        [[8, 2, 161, 0, 63], [8, 2, 161, 0, 63], [8, 3, 129, 0, 63], [8, 3, 129, 0, 63], [8, 5, 129, 0, 63], [8, 5, 129, 0, 63]]],
    ]
    for (const [sql, expected, metadata] of cases) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, `${method}: ${sql}`)
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), metadata, `${method}: ${sql}`)
        const [warnings] = await conn.query('SHOW WARNINGS')
        assert.deepEqual(warnings, [], `${method}: ${sql}`)
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
