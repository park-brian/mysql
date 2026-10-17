import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import boundaries from './fixtures/unions/year-boundaries.json' with { type: 'json' }

// YEAR is ignored beside an integer when selecting the UNION holder.
const types = ['TINYINT', 'TINYINT UNSIGNED', 'SMALLINT', 'SMALLINT UNSIGNED', 'MEDIUMINT', 'MEDIUMINT UNSIGNED', 'INT', 'INT UNSIGNED', 'BIGINT', 'BIGINT UNSIGNED', 'YEAR']
const widths = [4, 3, 6, 5, 9, 8, 11, 10, 20, 20, 4]
const low = ['-128', '0', '-32768', '0', '-8388608', '0', '-2147483648', '0', '-9223372036854775808', '0', '2001']
const high = ['127', '255', '32767', '65535', '8388607', '16777215', '2147483647', '4294967295', '9223372036854775807', '18446744073709551615', '2024']

test('YEAR UNION holders clip quietly and nested operations compare in the final holder', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE union_year118')
    await conn.query('USE union_year118')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,' + types.map((t, i) => `c${i} ${t}`).join(',') + ')')
    await conn.query('INSERT INTO a VALUES(1,' + low.join(',') + '),(2,' + high.join(',') + ')')
    const check = async (sql: string, expected: unknown, field: number, length: number, flags: number, decimals = 0) => {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(JSON.parse(JSON.stringify(rows)), expected, `${method}: ${sql}`)
        assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
          ['v', field, length, flags, decimals, 63, '', '', '', 'v'],
        ], `${method}: ${sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
        conn.unprepare(options)
      }
    }
    const fields = [1, 1, 2, 2, 9, 9, 3, 3, 8, 8, 13]
    for (let i = 0; i < types.length; i++) for (const yearFirst of [false, true]) for (const op of ['UNION ALL', 'UNION']) {
      const field = fields[i]!
      const value = (v: string) => field === 8 ? v : Number(v)
      // These two captured YEAR values both saturate at a TINYINT maximum.
      const years = i === 0 ? ['127', '127'] : i === 1 ? ['255', '255'] : ['2001', '2024']
      const values = yearFirst ? [...years, low[i]!, high[i]!] : [low[i]!, high[i]!, ...years]
      const expected = (op === 'UNION' ? [...new Set(values)] : values).map((v) => [value(v)])
      const left = yearFirst ? 10 : i, right = yearFirst ? i : 10
      await check(`SELECT c${left} AS v FROM a ${op} SELECT c${right} FROM a`, expected, field, Math.max(4, widths[i]!), i === 10 ? 96 : i % 2 === 1 ? 32 : 0)
    }
    await conn.query('CREATE TABLE n(d DECIMAL(8,2), b BIT(8), wide BIT(64), du DECIMAL(8,2) UNSIGNED)')
    await conn.query('INSERT INTO n VALUES(1.25,5,1,1.25),(2.25,255,18446744073709551615,2.25)')
    assert.equal(boundaries.mysqlVersion, '8.4.11')
    for (const [sql, rows, field] of boundaries.cases as [string, unknown[][], [number, number, number, number?]][]) {
      await check(sql, rows, ...field)
    }
    await conn.query('INSERT INTO a VALUES(3,' + types.map(() => '0').join(',') + ')')
    await check('SELECT c10 AS v FROM a WHERE id=3 UNION SELECT c10 FROM a WHERE id=3', [[0]], 13, 4, 96)
    await check('SELECT NULL AS v UNION ALL SELECT c10 FROM a WHERE id=3', [[null], [0]], 13, 4, 96)
    await check('SELECT c10 AS v FROM a WHERE FALSE UNION ALL SELECT c10 FROM a WHERE id=3', [[0]], 13, 4, 96)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS union_year118')
    await conn.end(); await db?.end()
  }
})
