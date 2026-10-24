import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import matrix from './fixtures/unions/fixed-fields.json' with { type: 'json' }
import precision from './fixtures/unions/fixed-precision.json' with { type: 'json' }

test('fixed FLOAT/DOUBLE set holders use ordered field merging and shared width/scale rules', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE fixed_float121')
    await conn.query('USE fixed_float121')
    assert.equal(matrix.mysqlVersion, '8.4.11')
    assert.equal(precision.mysqlVersion, '8.4.11')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,' + matrix.types.map((type, i) => `c${i} ${type}`).join(',') + ')')
    await conn.query('INSERT INTO a VALUES(1,' + matrix.first.join(',') + '),(2,' + matrix.last.join(',') + ')')
    // The native matrix brackets widths 11/12/13/14, scales 0/2/6/15,
    // unsigned sources, mixed integer/decimal fields and both operand orders.
    for (let i = 0; i < matrix.types.length; i++) for (let j = 0; j < matrix.types.length; j++) for (const op of ['UNION ALL', 'UNION']) for (const method of ['query', 'execute'] as const) {
      const sql = `SELECT c${i} AS v FROM a ${op} SELECT c${j} FROM a`
      const options = { sql, rowsAsArray: true }
      const [, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
        ['v', ...matrix.fields[i]![j]!, '', '', '', 'v'],
      ], `${method}: ${sql}`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
      conn.unprepare(options)
    }
    await conn.query('DROP TABLE a')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b BIGINT,f FLOAT(12,2),d DOUBLE(12,2))')
    await conn.query('INSERT INTO a VALUES(1,16777217,16777216,16777217),(2,16777216,16777217,16777216),(3,-16777217,-16777216,-16777217),(4,0,0,0)')
    for (const sample of precision.cases) for (const method of ['query', 'execute'] as const) {
      const options = { sql: sample.sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, sample[method], `${method}: ${sample.sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), sample.fields, `${method}: ${sample.sql}`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sample.sql}`)
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS fixed_float121')
    await conn.end(); await db?.end()
  }
})
