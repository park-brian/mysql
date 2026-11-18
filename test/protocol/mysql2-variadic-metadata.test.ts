import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function metadataConnection() {
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
  return { conn, db, host }
}

test('M5.10: large variadic calls preserve rows, metadata and warnings', async () => {
  const { conn, db, host } = await metadataConnection()
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

test('M5.10: SHA2 markers retain their width and NULL skips the length read', async () => {
  const { conn, db, host } = await metadataConnection()
  const sql = 'SELECT SHA2(?, CAST(? AS SIGNED)) AS v'
  const invalid = ['Warning', 1583, "Incorrect parameters in the call to native function 'sha2'"]
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    for (const method of ['query', 'execute'] as const) {
      for (const width of [224, 512, 384, 0, 224, 255]) {
        const values = ['abc', width]
        const [rows, fields] = method === 'query' ? await conn.query(sql, values) : await conn.execute(sql, values)
        const valid = width !== 255
        const bits = width || 256
        assert.deepEqual(rows, [[valid ? createHash('sha' + bits).update('abc').digest('hex') : null]])
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
          [[253, method === 'execute' ? 512 : valid ? bits : 256, 0, 31, 255]])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], valid ? [] : [invalid])
      }
      await conn.query('SELECT LAST_INSERT_ID(0)')
      const effect = 'SELECT SHA2(NULL, LAST_INSERT_ID(?)) AS v'
      const [rows] = method === 'query' ? await conn.query(effect, [7]) : await conn.execute(effect, [7])
      assert.deepEqual(rows, [[null]])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      assert.deepEqual((await conn.query('SELECT LAST_INSERT_ID()'))[0], [['0']])
    }
    assert.deepEqual((await conn.execute(sql, [null, 255]))[0], [[null]])
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
  } finally {
    await conn.end()
    await db?.end()
  }
})
