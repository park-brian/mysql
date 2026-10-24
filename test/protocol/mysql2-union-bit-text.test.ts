import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import reference from './fixtures/unions/bit-text.json' with { type: 'json' }

test('raw BIT set holders share binary collation selection, with explicit text and computed controls', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE bit_text124')
    await conn.query('USE bit_text124')
    assert.equal(reference.mysqlVersion, '8.4.11')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b1 BIT(1),b8 BIT(8),b16 BIT(16),b64 BIT(64),lt VARCHAR(32) CHARACTER SET latin1,ut VARCHAR(32) CHARACTER SET utf8mb4,bin VARBINARY(32))')
    await conn.query("INSERT INTO a VALUES(1,0,0,0,0,'é','€',X'610062'),(2,1,5,5,5,'é','€',X'610062'),(3,0,255,65535,18446744073709551615,'é','€',X'610062'),(4,1,128,256,9007199254740993,'é','€',X'610062'),(5,0,1,257,1,'é','€',X'610062'),(6,1,15,65280,9223372036854775808,'é','€',X'610062')")
    // Native rows/fields are shared by index, not regenerated from the type
    // policy being tested. Both protocols returned each recorded result.
    const rows = reference.rows.map((result) => result.map((row) => row.map((v) => v !== null && typeof v === 'object' ? Buffer.from(v.data) : v)))
    const check = async (sql: string, row: number, field: number): Promise<void> => {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [actual, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(actual, rows[row], method + ': ' + sql)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), reference.fields[field], method + ': ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], method + ': ' + sql)
        conn.unprepare(options)
      }
    }
    // Widths 1/8/16/64, six operators, both operand orders, raw and
    // computed sources, NULL, binary/latin1/UTF-8 text and explicit COLLATE.
    for (const [source, target, op, reverse, row, field] of reference.cases) {
      const left = 'SELECT ' + reference.subjects[source!] + ' AS v FROM a'
      const right = reference.targets[target!]!
      await check((reverse === 1 ? right : left) + ' ' + reference.operators[op!] + ' ' + (reverse === 1 ? left : right), row!, field!)
    }
    for (const sample of reference.nested) await check(sample.sql, sample.rows, sample.fields)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS bit_text124')
    await conn.end(); await db?.end()
  }
})
