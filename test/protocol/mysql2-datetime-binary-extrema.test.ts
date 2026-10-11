// Values, binary metadata and diagnostics measured on pinned MySQL 8.4.11.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const warning = (value: string, column: string, row = 1) => ({
  Level: 'Warning', Code: 1292,
  Message: `Incorrect datetime value: '${value}' for column '${column}' at row ${row}`,
})

test('DATETIME/binary extrema preserve precision, zero fallback and warning identity', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    for (const date of ["TIMESTAMP'2024-01-01 01:02:03'", "timestamp /* literal name */ '2024-01-01 01:02:03'"]) {
      for (const [binary, expected, width, invalid] of [
        ["X'323032332D30312D30312030313A30323A3033'", ['2024-01-01 01:02:03', '2023-01-01 01:02:03'], 19, undefined],
        ["_binary'2025-01-01 01:02:03.12'", ['2025-01-01 01:02:03.12', '2024-01-01 01:02:03.00'], 22, undefined],
        ["_binary'abc'", ['2024-01-01 01:02:03.000000', '2024-01-01 01:02:03'], 26, 'abc'],
        ["X''", ['2024-01-01 01:02:03', ''], 19, ''],
        ["_binary'0000-00-00'", ['2024-01-01 01:02:03', '0000-00-00'], 19, '0000-00-00'],
        ["_binary'2024-01-01 01:02:03.12345'", ['2024-01-01 01:02:03.12345', '2024-01-01 01:02:03.00000'], 25, undefined],
      ] as const) {
        for (const args of [`${date},${binary}`, `${binary},${date}`]) {
          const sql = `SELECT GREATEST(${args}), LEAST(${args})`
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, [expected.map((v) => Buffer.from(v))], `${method}: ${sql}`)
            assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
              [[253, width, 129, 31, 63], [253, width, 129, 31, 63]], `${method}: ${sql}`)
            const [warnings] = await conn.query('SHOW WARNINGS')
            assert.deepEqual(warnings, invalid === undefined ? [] : [warning(invalid, date), warning(invalid, date)], `${method}: ${sql}`)
          }
        }
      }
    }
    await conn.query('CREATE DATABASE IF NOT EXISTS datetime_binary_extrema')
    await conn.query('USE datetime_binary_extrema')
    await conn.query('DROP TABLE IF EXISTS t')
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, d DATETIME(3), b VARBINARY(32))')
    await conn.query("INSERT INTO t VALUES (1,'2024-01-01 01:02:03.123',_binary'2023-01-01'),(2,'2024-01-01 01:02:03.123',_binary'2025-01-01 01:02:03.12'),(3,'2024-01-01 01:02:03.123',_binary'abc'),(4,NULL,_binary'abc'),(5,'2024-01-01',NULL)")
    for (const binary of ['b', 'LEFT(b,1)']) {
      const narrow = binary !== 'b'
      const expected = narrow ? [
        ['2024-01-01 01:02:03.123000', '2'], ['2024-01-01 01:02:03.123000', '2'],
        ['2024-01-01 01:02:03.123000', '2024-01-01 01:02:03.123'], [null, null], [null, null],
      ] : [
        ['2024-01-01 01:02:03.123000', '2023-01-01 00:00:00.000000'],
        ['2025-01-01 01:02:03.120000', '2024-01-01 01:02:03.123000'],
        ['2024-01-01 01:02:03.123000', '2024-01-01 01:02:03.123'], [null, null], [null, null],
      ]
      const expectedWarnings = narrow
        ? [warning('2', 'd', 1), warning('2', 'd', 1), warning('2', 'd', 2), warning('2', 'd', 2), warning('a', 'd', 3), warning('a', 'd', 3)]
        : [warning('abc', 'd', 3), warning('abc', 'd', 3)]
      for (const args of [`d,${binary}`, `${binary},d`]) {
        const warningsForOrder = args.startsWith('d,') ? expectedWarnings
          : [...expectedWarnings, warning(narrow ? 'a' : 'abc', 'd', 4), warning(narrow ? 'a' : 'abc', 'd', 4)]
        const sql = `SELECT GREATEST(${args}), LEAST(${args}) FROM t ORDER BY id`
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, expected.map((r) => r.map((v) => v === null ? null : Buffer.from(v))), `${method}: ${sql}`)
          const width = narrow ? 26 : 32
          assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
            [[253, width, 128, 31, 63], [253, width, 128, 31, 63]], `${method}: ${sql}`)
          const [warnings] = await conn.query('SHOW WARNINGS')
          assert.deepEqual(warnings, warningsForOrder, `${method}: ${sql}`)
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS datetime_binary_extrema')
    await conn.end()
    await db?.end()
  }
})
