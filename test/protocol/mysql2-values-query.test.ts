import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.52: VALUES retains direct items and evaluates the selected rows', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    charset: 'utf8mb4_0900_ai_ci',
    rowsAsArray: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    for (const method of ['query', 'execute'] as const) {
      const read = (sql: string, parameters: (string | number | null)[] = []) => method === 'query'
        ? conn.query<RowDataPacket[]>(sql, parameters)
        : conn.execute<RowDataPacket[]>(sql, parameters)
      const expect = async (sql: string, rows: readonly unknown[][], fields: readonly unknown[][], parameters?: (string | number | null)[]) => {
        const [actual, metadata] = await read(sql, parameters)
        assert.deepEqual(actual, rows, `${method}: ${sql}`)
        assert.deepEqual(metadata.map(f => [f.name, f.orgName, f.columnType, f.columnLength, f.flags, f.characterSet, f.decimals, f.table]), fields, `${method}: ${sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
      }
      const decimals = 'VALUES ROW(1.0), ROW(2), ROW(0.001)'
      await expect(decimals, [['1.0'], ['2'], ['0.001']], [['column_0', '', 246, 6, 129, 63, 3, '']])
      await expect(`SELECT * FROM (${decimals}) q(amount)`, [['1.000'], ['2.000'], ['0.001']], [['amount', 'amount', 246, 6, 1, 63, 3, 'q']])
      await expect('VALUES ROW(1), ROW(2) UNION SELECT 1.123', [['1.000'], ['2.000'], ['1.123']], [['column_0', 'column_0', 246, 6, 1, 63, 3, '']])
      const signed = '9223372036854775807'
      const unsigned = '9223372036854775808'
      const integers = [[signed], [unsigned]]
      await expect(`VALUES ROW(${signed}), ROW(${unsigned})`, integers, [['column_0', '', 246, 20, 129, 63, 0, '']])
      await expect(`SELECT ${signed} UNION ALL SELECT ${unsigned}`, integers, [[signed, signed, 246, 20, 1, 63, 0, '']])

      await expect('(VALUES ROW(3), ROW(1), ROW(2)) ORDER BY 1', [['3'], ['1'], ['2']], [['column_0', '', 8, 2, 129, 63, 0, '']])
      await expect('VALUES ROW(3), ROW(1), ROW(2) ORDER BY 1 LIMIT ? OFFSET ?', [['1']], [['column_0', '', 8, 2, 129, 63, 0, '']], [1, 1])
      await expect('VALUES ROW(?), ROW(1)', [['abc'], ['1']], [['column_0', '', 253, method === 'query' ? 12 : 65532, method === 'query' ? 1 : 0, 255, 31, '']], ['abc'])

      const warned = "VALUES ROW(1), ROW(CAST('bad' AS SIGNED))"
      const field = [['column_0', '', 8, 21, 129, 63, 0, '']]
      await expect(`${warned} LIMIT 0`, [], field)
      await expect(`${warned} LIMIT 1`, [['1']], field)
      assert.deepEqual((await read(`${warned} LIMIT 1,1`))[0], [['0']])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Warning', 1292, "Truncated incorrect INTEGER value: 'bad'"]])
      for (const [sql, errno, sqlState, sqlMessage] of [
        ['VALUES ROW(1), ROW(DEFAULT,2)', 1136, '21S01', "Column count doesn't match value count at row 2"],
        ['VALUES ROW(DEFAULT)', 3943, 'HY000', 'A VALUES clause cannot use DEFAULT values, unless used as a source in an INSERT statement.'],
        ['VALUES ROW(1) ORDER BY 0', 1054, '42S22', "Unknown column '0' in 'order clause'"],
      ] as const) {
        await assert.rejects(read(sql), { errno, sqlState, sqlMessage })
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', errno, sqlMessage]])
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
