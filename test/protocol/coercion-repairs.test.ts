// Values and metadata asked of an unmodified MySQL 8.4.11 first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('NULL division resolves numeric metadata through both protocols', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE ar (i INT, u INT UNSIGNED, de DECIMAL(10,3), fl FLOAT(5,2), d DATE, dt DATETIME(3), dt0 DATETIME, tm TIME(3), tm0 TIME)')
    const operands: readonly (readonly [string, number, number, number])[] = [
      ['1', 4, 6, 4], ['1.5', 5, 8, 5], ['10.50', 6, 10, 6], ['1e1', 23, 23, 31],
      ['i', 4, 15, 4], ['u', 4, 14, 4], ['de', 7, 16, 7], ['fl', 6, 9, 6],
      ['d', 4, 14, 4], ['dt', 7, 24, 7], ['dt0', 4, 21, 4], ['tm', 7, 18, 7], ['tm0', 4, 14, 4], ['NULL', 4, 4, 4], ["'abc'", 23, 23, 31],
    ]
    for (const [operand, leftWidth, rightWidth, scale] of operands) {
      const sql = `SELECT NULL / ${operand}, ${operand} / NULL FROM ar`
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, [], sql)
        assert.deepEqual((fields as mysql.FieldPacket[]).map((f) => [f.columnType, f.columnLength, f.decimals, f.flags]), [[5, leftWidth, scale, 128], [5, rightWidth, scale, 128]], sql)
      }
    }
  } finally {
    await conn.end()
    await db.end()
  }
})

test('an invalid numeric TIME constant cannot match the saturated TIME boundary', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE ar (tm TIME)')
    await conn.query("INSERT INTO ar VALUES ('838:59:59'),('00:00:00')")
    const sql = 'SELECT tm IN (20200102), tm = 20200102 FROM ar'
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, [[0, 0], [0, 0]])
    }
  } finally {
    await conn.end()
    await db.end()
  }
})

test('comparison contexts and converted NULLIF constants match 8.4.11 through both protocols', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    await conn.query('SET timestamp = 1791547200')
    await conn.query('CREATE TABLE ar (tm TIME, dt DATETIME(3), yr YEAR, bi BIGINT, vc VARCHAR(20), bt BIT(8), bn VARBINARY(10), js JSON)')
    await conn.query(`INSERT INTO ar VALUES
      ('10:11:12','2020-01-02 03:04:05.678',2020,10,'10',b'1010',X'3130','10'),
      ('00:00:00','2020-01-02',1999,0,'',b'0',X'3130','"10"'),
      ('-01:00:00','1999-12-31 23:59:59',0,-1,'abc',b'1010',X'00','null')`)
    const cases = [
      {
        sql: "SELECT NULLIF(DATE'2020-01-02',bi), NULLIF(20200102,dt), NULLIF(DATE'2020-01-02',tm), NULLIF(TIME'10:11:12',yr), NULLIF(TIMESTAMP'2020-01-02 03:04:05',yr) FROM ar",
        rows: [['20200102', '1847957988896145408', '0', '2026', null], ['20200102', null, null, '2026', '2020'], ['20200102', '1847957988896145408', '0', '2026', '2020']],
        fields: [[8, 22, 128, 0], [253, 88, 32, 31], [253, 88, 0, 31], [253, 88, 32, 31], [253, 88, 32, 31]],
        warnings: 0,
      },
      {
        sql: "SELECT vc IN (TIMESTAMP'2020-01-02 03:04:05','10','10'), js BETWEEN bt AND bi, js < bt, CASE bn WHEN js THEN bi END, vc <= TIME'10:11:12' FROM ar",
        rows: [['1', '1', '1', '10', '1'], ['1', '0', '1', null, '1'], ['1', '0', '1', null, '0']],
        fields: [[8, 1, 128, 0], [8, 1, 128, 0], [8, 1, 128, 0], [8, 20, 128, 0], [8, 1, 128, 0]],
        warnings: 7,
      },
      {
        sql: "SELECT tm BETWEEN vc AND '2020-01-02', dt BETWEEN TIMESTAMP'2020-01-02 03:04:05' AND TIME'10:11:12' FROM ar",
        rows: [['1', '1'], ['1', '0'], ['0', '0']],
        fields: [[8, 1, 128, 0], [8, 1, 128, 0]],
        warnings: 1,
      },
    ]
    for (const method of ['query', 'execute'] as const) {
      for (const c of cases) {
        const options = { sql: c.sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, c.rows, c.sql)
        assert.deepEqual((fields as mysql.FieldPacket[]).map((f) => [f.columnType, f.columnLength, f.flags, f.decimals]), c.fields, c.sql)
        const [warnings] = await conn.query('SHOW WARNINGS')
        assert.equal((warnings as unknown[]).length, c.warnings, c.sql)
      }
      const sql = "SELECT CASE dt WHEN '10:11:12' THEN 1 ELSE 0 END FROM ar"
      if (method === 'query') await conn.query(sql)
      else await conn.execute(sql)
      const [warnings] = await conn.query('SHOW WARNINGS')
      assert.deepEqual(warnings, [1, 2, 3].map((row) => ({ Level: 'Warning', Code: 4095, Message: `Delimiter ':' in position 2 in datetime value '10:11:12' at row ${row} is deprecated. Prefer the standard '-'.` })))

      const constantDate = "SELECT dt > '10:11:12' FROM ar"
      if (method === 'query') await conn.query(constantDate)
      else await conn.execute(constantDate)
      const [cachedWarning] = await conn.query('SHOW WARNINGS')
      assert.deepEqual(cachedWarning, [{ Level: 'Warning', Code: 4095, Message: "Delimiter ':' in position 2 in datetime value '10:11:12' at row 1 is deprecated. Prefer the standard '-'." }])

      const bits = { sql: 'SELECT CAST(bt AS JSON) = bt, bt IN (CAST(bt AS JSON), NULL) FROM ar', rowsAsArray: true }
      const [opaque] = method === 'query' ? await conn.query(bits) : await conn.execute(bits)
      assert.deepEqual(opaque, [['1', '1'], ['1', '1'], ['1', '1']])

      const exact = { sql: 'SELECT 9223372036854775807 BETWEEN 9223372036854775806 AND 9223372036854775806, CASE 9223372036854775807 WHEN 9223372036854775806 THEN 1 ELSE 0 END, 9223372036854775807 BETWEEN 9223372036854775806.0 AND 9223372036854775806.0', rowsAsArray: true }
      const [adjacent] = method === 'query' ? await conn.query(exact) : await conn.execute(exact)
      assert.deepEqual(adjacent, [['0', '0', '0']])

      const years = { sql: "SELECT NULLIF('0',yr), NULLIF('2020-01-02',yr), NULLIF('abc',yr), NULLIF('10:11:12',yr) FROM ar", rowsAsArray: true }
      const [yearRows, yearFields] = method === 'query' ? await conn.query(years) : await conn.execute(years)
      assert.deepEqual(yearRows, [['2000', null, 'abc', '2010'], ['2000', '2020', 'abc', '2010'], ['2000', '2020', null, '2010']])
      assert.deepEqual((yearFields as mysql.FieldPacket[]).map((f) => [f.columnType, f.columnLength, f.flags, f.decimals]), [[253, 88, 32, 31], [253, 88, 32, 31], [253, 12, 0, 31], [253, 88, 32, 31]])

      const division = 'SELECT 1 DIV 1e80, 1 DIV 1e81, 1 DIV 2.5e300 FROM ar'
      if (method === 'query') await conn.query(division)
      else await conn.execute(division)
      const [overflow] = await conn.query('SHOW WARNINGS')
      assert.deepEqual(overflow, [1, 2, 3].flatMap(() => ['1', '2.5'].map((mantissa) => ({ Level: 'Warning', Code: 1292, Message: `Truncated incorrect DECIMAL value: '${mantissa}'` }))))

      const saturated = { sql: 'SELECT 1e300 DIV 2.5e300, 1e300 DIV 1e81, 1e300 DIV -1e300, 2.5e300 DIV 1e300, 1 DIV 1e-82', rowsAsArray: true }
      const [bounded] = method === 'query' ? await conn.query(saturated) : await conn.execute(saturated)
      assert.deepEqual(bounded, [['1', '1', '-1', '1', null]])
      const tiny = 'SELECT 1 DIV 1e-81'
      await assert.rejects(method === 'query' ? conn.query(tiny) : conn.execute(tiny), { errno: 1690 })

      const empty = 'SELECT js BETWEEN bt AND bi, NOT js FROM ar WHERE FALSE'
      if (method === 'query') await conn.query(empty)
      else await conn.execute(empty)
      const [resolved] = await conn.query('SHOW WARNINGS')
      assert.deepEqual((resolved as { Code: number }[]).map((w) => w.Code), [1235, 3986])
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
