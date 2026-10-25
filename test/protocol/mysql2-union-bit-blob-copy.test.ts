import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import capture from './fixtures/unions/bit-blob-copy.json' with { type: 'json' }

interface Reference {
  readonly mysqlVersion: string
  readonly outcomes: readonly { rows: unknown; fields: unknown; warnings: unknown }[]
  readonly direct: readonly [number, number, boolean, number, number][]
  readonly nested: readonly [number, number, number, boolean, number][]
  readonly derived: readonly [number, boolean, boolean, number, number][]
  readonly computed: readonly [number, number, number][]
}
const reference = capture as unknown as Reference
const ops = ['UNION ALL', 'UNION', 'INTERSECT', 'INTERSECT ALL', 'EXCEPT', 'EXCEPT ALL']
const subjects = ['b1', 'b8', 'b16', 'b64', 'COALESCE(b8)', 'IFNULL(b8,NULL)', 'IF(1,b8,b8)', 'b8+0']
const targets = ['tx', 'tx COLLATE utf8mb4_bin', 'tl', 'tl COLLATE latin1_bin', 'bl', 'bl COLLATE `binary`', 'tt', 'tt COLLATE utf8mb4_bin', 'tb', 'tb COLLATE `binary`']
const columns = ['b8', 'b16', 'b64']
const expressions = ['+b8', 'DEFAULT(b8)', 'ANY_VALUE(b8)', 'MAX(b8)', 'MIN(b8)', 'CASE WHEN 1 THEN b8 ELSE b8 END', 'CAST(b8 AS UNSIGNED)']
const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

test('BIT field copying uses the actual binary BLOB holder before set comparisons and nested LIMIT sorts', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const check = async (sql: string, index: number): Promise<void> => {
    const expected = reference.outcomes[index]!
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(canonical(rows), expected.rows, method + ': ' + sql)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), expected.fields, method + ': ' + sql)
      assert.deepEqual(canonical((await conn.query('SHOW WARNINGS'))[0]), expected.warnings, method + ': ' + sql)
      conn.unprepare(options)
    }
  }
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    await conn.query('CREATE DATABASE bit_field_copy')
    await conn.query('USE bit_field_copy')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b1 BIT(1),b8 BIT(8),b16 BIT(16),b64 BIT(64),tx TEXT CHARACTER SET utf8mb4,tl TEXT CHARACTER SET latin1,bl BLOB,tt TINYTEXT CHARACTER SET utf8mb4,tb TINYBLOB)')
    const b8 = [0n, 5n, 255n, 128n, 1n, 15n]
    const b16 = [0n, 5n, 65535n, 256n, 257n, 65280n]
    const b64 = [0n, 5n, 18446744073709551615n, 9007199254740993n, 1n, 9223372036854775808n]
    await conn.query('INSERT INTO a VALUES' + b8.map((v, i) => '(' + (i + 1) + ',' + (i % 2) + ',' + v + ',' + b16[i] + ',' + b64[i] + ",'€','é',X'610062','€',X'610062')").join(','))
    for (const [subject, target, reverse, op, result] of reference.direct) {
      const left = 'SELECT ' + subjects[subject] + ' AS v FROM a'
      const right = 'SELECT ' + targets[target] + ' AS v FROM a'
      await check((reverse ? right : left) + ' ' + ops[op] + ' ' + (reverse ? left : right), result)
    }
    await conn.query('DROP TABLE a')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b8 BIT(8) DEFAULT 5,b16 BIT(16),b64 BIT(64),bl BLOB)')
    const values = [0n, 1n, 2n, 10n, 128n, 255n, null]
    const blobs = ['00', '01', '30', '31', '80', 'FF', null]
    await conn.query('INSERT INTO a VALUES' + values.map((v, i) => '(' + (i + 1) + ',' + v + ',' + (v === null ? null : v + 256n) + ',' + (v === null ? null : v + 9007199254740992n) + ',' + (blobs[i] === null ? 'NULL' : "X'" + blobs[i] + "'") + ')').join(','))
    for (const [column, inner, outer, reverse, result] of reference.nested) {
      const name = columns[column]!
      const nested = '(SELECT ' + name + ' AS v FROM a ' + ops[inner] + ' SELECT IF(1,' + name + ',' + name + ') AS v FROM a ORDER BY 1 DESC LIMIT 3)'
      const other = 'SELECT bl AS v FROM a'
      await check(reverse ? other + ' ' + ops[outer] + ' ' + nested : nested + ' ' + ops[outer] + ' ' + other, result)
    }
    for (const [column, computed, materialized, op, result] of reference.derived) {
      const name = columns[column]!
      const expression = computed ? 'IF(1,' + name + ',' + name + ')' : name
      await check('SELECT q.v FROM (SELECT ' + expression + ' AS v FROM a' + (materialized ? ' LIMIT 100' : '') + ') q ' + ops[op] + ' SELECT bl AS v FROM a', result)
    }
    for (const [expression, op, result] of reference.computed) {
      await check('SELECT ' + expressions[expression] + ' AS v FROM a ' + ops[op] + ' SELECT bl AS v FROM a', result)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS bit_field_copy')
    await conn.end(); await db?.end()
  }
})
