import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import reference from './fixtures/unions/blob-widths.json' with { type: 'json' }

test('BLOB set holders size each branch once, in the selected charset and within field capacity', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE blob_width125')
    await conn.query('USE blob_width125')
    assert.equal(reference.mysqlVersion, '8.4.11')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,tx TEXT CHARACTER SET utf8mb4,tl TEXT CHARACTER SET latin1,bl BLOB,tt TINYTEXT CHARACTER SET utf8mb4,tb TINYBLOB,mt MEDIUMTEXT CHARACTER SET utf8mb4,lt LONGTEXT CHARACTER SET utf8mb4)')
    await conn.query("INSERT INTO a VALUES(1,'€','é',X'610062','€',X'610062','€','€'),(2,NULL,NULL,NULL,NULL,NULL,NULL,NULL)")
    // The matrix indexes captured outcomes by left expression, right
    // expression and operator; query() and execute() agreed natively.
    for (let i = 0; i < reference.expressions.length; i++) for (let j = 0; j < reference.expressions.length; j++) for (let op = 0; op < reference.operators.length; op++) {
      const sql = 'SELECT ' + reference.expressions[i] + ' AS v FROM a ' + reference.operators[op] + ' SELECT ' + reference.expressions[j] + ' AS v FROM a'
      const expected = reference.outcomes[reference.matrix[i]![j]![op]!]!
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        let result: { rows?: unknown; fields?: unknown; error?: number }
        try {
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          result = { rows, fields: fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]) }
        } catch (error) {
          result = { error: (error as { errno: number }).errno }
        }
        const [warnings] = await conn.query('SHOW WARNINGS')
        // Preserve native byte vectors alongside ordinary string values.
        assert.deepEqual(JSON.parse(JSON.stringify({ ...result, warnings })), expected, method + ': ' + sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS blob_width125')
    await conn.end(); await db?.end()
  }
})
