// MySQL 8.4.11 compares mixed TIME/text extrema lexically.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('TIME/text and TIME/binary extrema agree on values, metadata and warnings', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    // JSON extrema still need their prepare-time warning and NULL metadata rules.
    if (db !== undefined) {
      for (const method of ['query', 'execute'] as const) {
        for (const name of ['GREATEST', 'LEAST']) {
          const sql = `SELECT ${name}(TIME'10:11:12',CAST('2' AS JSON))`
          await assert.rejects(method === 'query' ? conn.query(sql) : conn.execute(sql),
            (error: unknown) => (error as { errno: number }).errno === 1235)
        }
      }
    }
    for (const [time, text, expected, length] of [
      ['10:11:12', '2', ['2', '10:11:12'], 40],
      ['-01:00:00', 'abc', ['abc', '-01:00:00'], 68],
      ['10:11:12.123', '2', ['2', '10:11:12.123'], 56],
      ['00:00:00', '', ['00:00:00', ''], 68],
      ['10:11:12', '1.5', ['10:11:12', '1.5'], 48],
    ] as const) {
      for (const args of [`TIME'${time}','${text}'`, `'${text}',TIME'${time}'`]) {
        const sql = `SELECT GREATEST(${args}), LEAST(${args})`
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, [expected], `${method}: ${sql}`)
          assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
            [[253, length, 1, 31, 224], [253, length, 1, 31, 224]], `${method}: ${sql}`)
          const [warnings] = await conn.query('SHOW WARNINGS')
          assert.deepEqual(warnings, [], `${method}: ${sql}`)
        }
      }
    }
    for (const [hex, expected, length] of [
      ['32', ['2', '10:11:12'], 10],
      ['616263', ['abc', '10:11:12'], 10],
      ['312E35', ['10:11:12', '1.5'], 12],
    ] as const) {
      for (const args of [`TIME'10:11:12',X'${hex}'`, `X'${hex}',TIME'10:11:12'`]) {
        const sql = `SELECT GREATEST(${args}), LEAST(${args})`
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, [expected.map((value) => Buffer.from(value))], `${method}: ${sql}`)
          assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
            [[253, length, 129, 31, 63], [253, length, 129, 31, 63]], `${method}: ${sql}`)
          const [warnings] = await conn.query('SHOW WARNINGS')
          assert.deepEqual(warnings, [], `${method}: ${sql}`)
        }
      }
    }
    await conn.query('CREATE DATABASE IF NOT EXISTS time_extrema')
    await conn.query('USE time_extrema')
    await conn.query('DROP TABLE IF EXISTS t')
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, tm TIME(3), v VARCHAR(24), b VARBINARY(24))')
    await conn.query("INSERT INTO t VALUES (1,'10:11:12.123','2',X'32'),(2,'-01:00:00','abc',X'616263'),(3,'00:00:00','',X''),(4,NULL,'2',X'32'),(5,'10:11:12',NULL,NULL)")
    for (const args of ['tm,v', 'v,tm', 'tm,LEFT(v,1)', 'LEFT(v,1),tm']) {
      const narrow = args.includes('LEFT')
      const width = narrow ? 68 : 96
      for (const binary of ['tm,b', 'b,tm']) {
        const sql = `SELECT GREATEST(${args}), LEAST(${args}), HEX(GREATEST(${binary})), HEX(LEAST(${binary})) FROM t ORDER BY id`
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, [
            ['2', '10:11:12.123', '32', '31303A31313A31322E313233'],
            [narrow ? 'a' : 'abc', '-01:00:00.000', '616263', '2D30313A30303A30302E303030'],
            ['00:00:00.000', '', '30303A30303A30302E303030', ''],
            [null, null, null, null], [null, null, null, null],
          ], `${method}: ${sql}`)
          assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
            [[253, width, 0, 31, 224], [253, width, 0, 31, 224], [253, 192, 0, 31, 224], [253, 192, 0, 31, 224]], `${method}: ${sql}`)
          const [warnings] = await conn.query('SHOW WARNINGS')
          assert.deepEqual(warnings, [], `${method}: ${sql}`)
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS time_extrema')
    await conn.end()
    await db?.end()
  }
})
