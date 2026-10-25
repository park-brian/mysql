import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import capture from './fixtures/unions/decimal-field-copy.json' with { type: 'json' }

interface Reference {
  readonly mysqlVersion: string
  readonly executions: number
  readonly outcomes: readonly { rows: unknown; fields: unknown; warnings: unknown }[]
  readonly boundary: readonly [number, boolean, number, number, boolean, number][]
  readonly extra: readonly [number, boolean, number, number | null, boolean, number][]
  readonly provenance: readonly [string, boolean, number][]
  readonly precision: readonly [boolean, number][]
}
const reference = capture as unknown as Reference
const ops = ['UNION ALL', 'UNION', 'INTERSECT', 'INTERSECT ALL', 'EXCEPT', 'EXCEPT ALL']
const columns = ['b8', 'b16', 'b64']
const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const combine = (body: string, op: number, reverse: boolean): string => reverse ? 'SELECT bl AS v FROM a ' + ops[op] + ' (' + body + ')' : '(' + body + ') ' + ops[op] + ' SELECT bl AS v FROM a'
function sources(column: number, decimal: boolean): { basic: string[]; extra: string[] } {
  const name = columns[column]!
  const expr = 'IF(1,' + name + ',' + (decimal ? '0.5' : '0') + ')'
  return {
    basic: [
      'SELECT DISTINCT ' + expr + ' AS v FROM a',
      'SELECT ' + expr + ' AS v FROM a GROUP BY id',
      'SELECT ' + expr + ' AS v FROM a ORDER BY id DESC LIMIT 4',
      'SELECT ' + expr + ' AS v FROM a ORDER BY ' + expr + ' DESC LIMIT 3',
      'SELECT ' + expr + ' AS v FROM a JOIN (SELECT 1 AS n) z ON 1 ORDER BY id DESC LIMIT 4',
      'WITH q AS (SELECT ' + expr + ' AS v FROM a LIMIT 100) SELECT v FROM q',
    ],
    extra: [
      'SELECT DISTINCT MAX(' + expr + ') AS v FROM a GROUP BY id%2',
      'SELECT MAX(' + expr + ') AS v FROM a GROUP BY id%2',
      'SELECT MAX(' + expr + ') AS v FROM a GROUP BY id',
      'SELECT MAX(' + expr + ') AS v FROM a GROUP BY id ORDER BY id DESC LIMIT 4',
      'SELECT MAX(' + expr + ') AS v FROM a',
      'SELECT DISTINCT IF(ROW_NUMBER() OVER (ORDER BY id)>0,' + name + ',' + (decimal ? '0.5' : '0') + ') AS v FROM a',
      'SELECT DISTINCT IF(1,1,' + (decimal ? '0.5' : '0') + ') AS v FROM a',
      'SELECT q.v FROM (SELECT ' + expr + ' AS v FROM a) q',
      'SELECT q.v FROM (SELECT ' + expr + ' AS v FROM a JOIN (SELECT 1 AS n) z ON 1 ORDER BY id) q',
      'SELECT q.v FROM (SELECT IF(1,1,' + (decimal ? '0.5' : '0') + ') AS v) q',
      'SELECT q.v FROM a o JOIN LATERAL (SELECT IF(1,o.' + name + ',' + (decimal ? '0.5' : '0') + ') AS v LIMIT 1) q ON 1',
      'SELECT q.v FROM a o JOIN LATERAL (SELECT IF(1,i.' + name + ',' + (decimal ? '0.5' : '0') + ') AS v FROM a i WHERE i.id=o.id) q ON 1',
    ],
  }
}

test('DECIMAL field copying follows actual materialization, preserving merged, streamed and nonnumeric readers', async () => {
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
    assert.equal(reference.executions, 2700)
    await conn.query('CREATE DATABASE decimal_field_copy')
    await conn.query('USE decimal_field_copy')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,b8 BIT(8),b16 BIT(16),b64 BIT(64),bl BLOB,tb TINYBLOB,vt VARBINARY(255),vb VARBINARY(513),vc VARCHAR(20),tx TEXT)')
    const b8 = [0n, 1n, 2n, 10n, 128n, 255n, null]
    const b16 = [0n, 1n, 2n, 256n, 65280n, 65535n, null]
    const b64 = [0n, 1n, 2n, 9007199254740993n, 9223372036854775808n, 18446744073709551615n, null]
    const blobs = ['00', '01', '30', '31', '80', 'FF', null]
    await conn.query('INSERT INTO a VALUES' + b8.map((v, i) => {
      const blob = blobs[i] === null ? 'NULL' : "X'" + blobs[i] + "'"
      return '(' + (i + 1) + ',' + v + ',' + b16[i] + ',' + b64[i] + ',' + [blob, blob, blob, blob, "'é'", "'€'"].join(',') + ')'
    }).join(','))
    for (const [column, decimal, boundary, op, reverse, result] of reference.boundary) {
      await check(combine(sources(column, decimal).basic[boundary]!, op, reverse), result)
    }
    await conn.query("ALTER TABLE a ADD en ENUM('a','b')")
    await conn.query("UPDATE a SET en=IF(id%2=0,'b','a')")
    for (const [column, decimal, boundary, op, reverse, result] of reference.extra) {
      const body = sources(column, decimal).extra[boundary]!
      await check(op === null ? body : combine(body, op, reverse), result)
    }
    for (const [field, materialized, result] of reference.provenance) {
      await check('SELECT q.v,q.v+0,HEX(q.v) FROM (SELECT ' + field + ' AS v FROM a' + (materialized ? ' LIMIT 100' : '') + ') q', result)
    }
    for (const [decimal, result] of reference.precision) {
      const expr = decimal ? 'CASE WHEN id=2 THEN 1.0 ELSE 0.0 END' : 'CASE WHEN id=2 THEN 1 ELSE 0 END'
      await check('SELECT q.v*3 AS v FROM (SELECT AVG(' + expr + ') AS v FROM a GROUP BY id%2) q', result)
    }
    assert.equal(executions, reference.executions)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_field_copy')
    await conn.end(); await db?.end()
  }
})
