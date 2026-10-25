import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import capture from './fixtures/unions/bit-numeric-copy.json' with { type: 'json' }

interface Reference {
  readonly mysqlVersion: string
  readonly executions: number
  readonly outcomes: readonly { rows: unknown; fields: unknown; warnings: unknown }[]
  readonly direct: readonly [number, number, number, boolean, number][]
  readonly nested: readonly [number, boolean, number, number, boolean, number][]
  readonly derived: readonly [number, boolean, boolean, number, boolean, number][]
  readonly control: readonly [number, number, number, boolean, number][]
}
const reference = capture as unknown as Reference
const ops = ['UNION ALL', 'UNION', 'INTERSECT', 'INTERSECT ALL', 'EXCEPT', 'EXCEPT ALL']
const columns = ['b8', 'b16', 'b64']
const targets = ['bl', 'bl COLLATE `binary`', 'tb', 'tb COLLATE `binary`', 'vt', 'vb', 'vc', 'tx', 'tx COLLATE utf8mb4_bin']
const expressions = columns.flatMap((c) => ['IF(1,' + c + ',0)', 'IF(1,' + c + ',0.5)', 'CASE WHEN id%2 THEN ' + c + ' ELSE 0 END', 'CASE WHEN id%2 THEN ' + c + ' ELSE 0.5 END'])
expressions.push('id', 'b8', 'b64', 'IF(1,b8,b8)', 'IF(1,b64,b64)', 'CAST(b64 AS UNSIGNED)', '+b8', 'IF(1,b8,0e0)', 'NULL')
const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const combine = (left: string, op: number, right: string, reverse: boolean): string => reverse ? right + ' ' + ops[op] + ' ' + left : left + ' ' + ops[op] + ' ' + right

test('numeric BIT copies distinguish computed readings from materialized fields and packed raw fields', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  let executions = 0
  const check = async (sql: string, index: number): Promise<void> => {
    const expected = reference.outcomes[index]!
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(canonical(rows), expected.rows, method + ': ' + sql)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), expected.fields, method + ': ' + sql)
      assert.deepEqual(canonical((await conn.query('SHOW WARNINGS'))[0]), expected.warnings, method + ': ' + sql)
      conn.unprepare(options)
      executions++
    }
  }
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.executions, 4080)
    await conn.query('CREATE DATABASE bit_numeric_copy')
    await conn.query('USE bit_numeric_copy')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b8 BIT(8),b16 BIT(16),b64 BIT(64),bl BLOB,tb TINYBLOB,vt VARBINARY(255),vb VARBINARY(513),vc VARCHAR(20),tx TEXT)')
    const b8 = [0n, 1n, 2n, 10n, 128n, 255n, null]
    const b16 = [0n, 1n, 2n, 256n, 65280n, 65535n, null]
    const b64 = [0n, 1n, 2n, 9007199254740993n, 9223372036854775808n, 18446744073709551615n, null]
    const blobs = ['00', '01', '30', '31', '80', 'FF', null]
    await conn.query('INSERT INTO a VALUES' + b8.map((v, i) => {
      const blob = blobs[i] === null ? 'NULL' : "X'" + blobs[i] + "'"
      return '(' + (i + 1) + ',' + v + ',' + b16[i] + ',' + b64[i] + ',' + [blob, blob, blob, blob, "'é'", "'€'"].join(',') + ')'
    }).join(','))
    for (const [expression, target, op, reverse, result] of reference.direct) {
      await check(combine('SELECT ' + expressions[expression] + ' AS v FROM a', op, 'SELECT ' + targets[target] + ' AS v FROM a', reverse), result)
    }
    for (const [column, decimal, inner, outer, reverse, result] of reference.nested) {
      const name = columns[column]!
      const expression = 'IF(1,' + name + ',' + (decimal ? '0.5' : '0') + ')'
      const nested = '(SELECT ' + name + ' AS v FROM a ' + ops[inner] + ' SELECT ' + expression + ' AS v FROM a ORDER BY 1 DESC LIMIT 3)'
      await check(combine(nested, outer, 'SELECT bl AS v FROM a', reverse), result)
    }
    for (const [column, decimal, materialized, op, reverse, result] of reference.derived) {
      const expression = 'IF(1,' + columns[column] + ',' + (decimal ? '0.5' : '0') + ')'
      const derived = 'SELECT q.v FROM (SELECT ' + expression + ' AS v FROM a' + (materialized ? ' LIMIT 100' : '') + ') q'
      await check(combine(derived, op, 'SELECT bl AS v FROM a', reverse), result)
    }
    for (const [expression, inner, outer, reverse, result] of reference.control) {
      const part = 'SELECT ' + expressions[expression] + ' AS v FROM a'
      await check(combine('(' + part + ' ' + ops[inner] + ' ' + part + ' ORDER BY 1 DESC LIMIT 3)', outer, 'SELECT bl AS v FROM a', reverse), result)
    }
    assert.equal(executions, reference.executions)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS bit_numeric_copy')
    await conn.end(); await db?.end()
  }
})
