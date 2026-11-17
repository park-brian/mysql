import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.10: large variadic calls preserve rows, metadata and warnings', async () => {
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
    // 8.4.11 accepts these literal lists over both protocols. The final operand
    // widens the metadata or is selected, so a shortened list cannot pass.
    const integers = '1,'.repeat(129_999)
    const decimals = '1.50,'.repeat(129_999)
    const strings = "'a',".repeat(129_999)
    const cases = [
      ['GREATEST', `GREATEST(${integers}2)`, '2', [8, 2, 129, 0, 63]],
      ['COALESCE integer', `COALESCE(${integers}20)`, '1', [8, 3, 129, 0, 63]],
      ['COALESCE decimal', `COALESCE(${decimals}3.125)`, '1.500', [246, 6, 129, 3, 63]],
      ['COALESCE string', `COALESCE(${strings}'ab')`, 'a', [253, 8, 1, 31, 255]],
      ['ELT', `ELT(130000,${strings}'ab')`, 'ab', [253, 8, 0, 31, 255]],
      ['MAKE_SET', `LENGTH(MAKE_SET(1,${strings}'ab'))`, '1', [8, 10, 129, 0, 63]],
    ] as const
    for (const [name, expression, value, metadata] of cases) for (const method of ['query', 'execute'] as const) {
      const sql = 'SELECT ' + expression + ' AS v'
      const label = name + ' via ' + method
      const [rows, fields] = method === 'query' ? await conn.query(sql) : await conn.execute(sql)
      assert.deepEqual(rows, [[value]], label)
      assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [metadata], label)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], label)
      if (method === 'execute') conn.unprepare(sql)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
