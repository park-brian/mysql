import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import precision from './fixtures/unions/float-precision.json' with { type: 'json' }

test('default FLOAT set holders round before comparison and retain final nested types', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE float120')
    await conn.query('USE float120')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b BIGINT,f FLOAT,d DOUBLE)')
    await conn.query('INSERT INTO a VALUES(1,16777217,16777216,16777217),(2,16777216,16777217,16777216),(3,-16777217,-16777216,-16777217),(4,0,0,0)')
    assert.equal(precision.mysqlVersion, '8.4.11')
    // FLOAT first selects a FLOAT holder; BIGINT first selects DOUBLE. Around
    // 2^24 their comparison keys differ. A wider outer holder must win before
    // an inner DISTINCT runs, while scalar CASE/IF/COALESCE remain expressions.
    for (const sample of precision.cases) for (const method of ['query', 'execute'] as const) {
      const options = { sql: sample.sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, sample[method], `${method}: ${sample.sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), sample.fields, `${method}: ${sample.sql}`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sample.sql}`)
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS float120')
    await conn.end(); await db?.end()
  }
})
