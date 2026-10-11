// Simple CASE and text-only IN lists keep a dated TIME reading's date.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('TIME comparison readers preserve dated CASE and IN operands', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('SET timestamp=1791547200')
    const run = async (sql: string, expected: unknown[][], metadata: number[][], warnings: unknown[] = []) => {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, `${method}: ${sql}`)
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), metadata, `${method}: ${sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, `${method}: ${sql}`)
      }
    }
    for (const [operand, when, expected, warning] of [
      ["TIME'10:11:12'", "TIMESTAMP'2026-10-09 10:11:12'", 0, undefined],
      ["TIMESTAMP'2026-10-09 10:11:12'", "TIME'10:11:12'", 1, undefined],
      ["TIME'10:11:12'", "'2026-10-09 10:11:12'", 0, undefined],
      ["TIME'10:11:12.123456'", "'2026-10-09 10:11:12.123456'", 0, undefined],
      ["TIME'10:11:12'", "_binary'2026-10-09 10:11:12'", 0, undefined],
      ["TIME'10:11:12'", "'10:11:12'", 1, undefined],
      ["TIME'10:11:12'", "'10:11:12.000000'", 1, undefined],
      ["TIME'10:11:12'", "TIME'10:11:12.000000'", 1, undefined],
      ["TIME'10:11:12'", "'101112'", 1, undefined],
      ["TIME'10:11:12'", "101112", 1, undefined],
      ["TIME'10:11:12'", "'0000-00-00 10:11:12'", 1, undefined],
      ["TIME'10:11:12'", "'10:11:12abc'", 1, '10:11:12abc'],
      ["TIME'10:11:12'", "'2026-10-09 10:11:12abc'", 0, '2026-10-09 10:11:12abc'],
      ["TIME'00:00:00'", "DATE'2026-10-09'", 0, '2026-10-09'],
      ["TIME'10:11:12'", 'NULL', 0, undefined],
      ['NULL', "TIMESTAMP'2026-10-09 10:11:12'", 0, undefined],
    ] as const) {
      await run(`SELECT CASE ${operand} WHEN ${when} THEN 1 ELSE 0 END`, [[expected]], [[8, 2, 129, 0, 63]],
        warning === undefined ? [] : [{ Level: 'Warning', Code: 1292, Message: `Truncated incorrect time value: '${warning}'` }])
    }
    for (const [list, expected, nullable] of [
      ["'2026-10-09 10:11:12','10:11:13'", 0, false],
      ["'2026-10-09 10:11:12','10:11:12'", 1, false],
      ["'2026-10-09 10:11:12',NULL", null, true],
    ] as const) {
      await run(`SELECT TIME'10:11:12' IN(${list})`, [[expected]], [[8, 1, nullable ? 128 : 129, 0, 63]])
    }
    await conn.query('CREATE DATABASE IF NOT EXISTS time_packed_comparison')
    await conn.query('USE time_packed_comparison')
    await conn.query('DROP TABLE IF EXISTS t')
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, tm TIME(6), dt DATETIME(6), txt VARCHAR(32))')
    await conn.query("INSERT INTO t VALUES(1,'10:11:12','2026-10-09 10:11:12','2026-10-09 10:11:12'),(2,'-00:00:00.000001','2026-10-08 23:59:59.999999','2026-10-08 23:59:59.999999'),(3,NULL,NULL,NULL)")
    await run("SELECT CASE tm WHEN dt THEN 1 ELSE 0 END,CASE dt WHEN tm THEN 1 ELSE 0 END,CASE tm WHEN txt THEN 1 ELSE 0 END,tm IN(txt,'10:11:13') FROM t ORDER BY id",
      [[0, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, null]], [[8, 2, 129, 0, 63], [8, 2, 129, 0, 63], [8, 2, 129, 0, 63], [8, 1, 128, 0, 63]])
    for (const text of ['2026-10-09 10:11:12', '10:11:12']) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql: 'SELECT CASE tm WHEN ? THEN 1 ELSE 0 END FROM t ORDER BY id', values: [text], rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        // A prepared WHEN parameter inherits TIME, unlike an interpolated literal.
        assert.deepEqual(rows, [[method === 'query' && text.includes('2026') ? 0 : 1], [0], [0]], `${method}: ${text}`)
        assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [[8, 2, 129, 0, 63]])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS time_packed_comparison')
    await conn.end()
    await db?.end()
  }
})
