import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import type { FieldPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import capture from './fixtures/casts/decimal-scale.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown }
const reference = capture as { mysqlVersion: string; executions: number; outcomes: Outcome[]; index: number[] }
const sources = ['n/3', 'n/7', 'n/20000', 'IF(1,n/3,0.000000000)', 'n', 'd']
const scales = [0, 4, 5, 8, 9, 13, 18, 27, 30]
const values = ['0', '1', '2', '3', '7', '10001', '-10001', '9007199254740993', '-9007199254740993', null]
const controls = [
  "SELECT CAST('1.2345tail' AS DECIMAL(10,2))",
  "SELECT CAST('-2.505rest' AS DECIMAL(10,2))",
  "SELECT CAST('12' AS DECIMAL(10,2))",
  'SELECT CAST(1000 AS DECIMAL(3,1))',
  'SELECT CAST(-1000 AS DECIMAL(3,1))',
  'SELECT CAST(NULL AS DECIMAL(30,9))',
  'SELECT CAST(1e0/3 AS DECIMAL(30,9))',
  'SELECT CAST(RAND(7) AS DECIMAL(20,8)) FROM a ORDER BY id',
  'SELECT CAST(n/3 AS DECIMAL(65,9)) FROM a ORDER BY id',
  'SELECT CAST(d AS DECIMAL(65,30)) FROM a ORDER BY id',
]
const cached = [
  'SELECT CAST(n/3 AS DECIMAL(55,9)) AS v FROM a WHERE id>=? ORDER BY id',
  'SELECT CAST(IF(1,n/20000,0.000000000) AS DECIMAL(55,9))*3 AS v FROM a WHERE id>=? ORDER BY id',
]
function queries(source: string, scale: number): string[] {
  // Leave room for arithmetic precision growth; direct controls cover precision 65.
  const cast = 'CAST(' + source + ' AS DECIMAL(55,' + scale + '))'
  // Larger-scale division has a separate held-word precision gap; its CAST is still tested.
  const readers = scale <= 18 ? ['$', '$*3', '$+0', '$/7'] : ['$', '$*3', '$+0']
  return readers.map((reader) => 'SELECT ' + source + ' AS raw,' + reader.replaceAll('$', cast) + ' AS v FROM a ORDER BY id')
}

test('explicit DECIMAL CAST owns its declared scale, preserving raw readers, narrowing, warnings and cached executions', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const canonical = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
  let execution = 0
  const check = async ([rows, fields]: readonly [unknown, readonly FieldPacket[]], label: string): Promise<void> => {
    const expected = reference.outcomes[reference.index[execution++]!]!
    assert.deepEqual(canonical(rows), expected.rows, label)
    assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), expected.fields, label)
    assert.deepEqual(canonical((await conn.query('SHOW WARNINGS'))[0]), expected.warnings, label)
  }
  const run = async (sql: string): Promise<void> => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      await check(method === 'query' ? await conn.query(options) : await conn.execute(options), method + ': ' + sql)
      conn.unprepare(options)
    }
  }
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.executions, 440)
    await conn.query('CREATE DATABASE decimal_cast_scale')
    await conn.query('USE decimal_cast_scale')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,n BIGINT,d DECIMAL(24,4))')
    await conn.query('INSERT INTO a VALUES ' + values.map((n, i) => '(' + (i + 1) + ',' + (n ?? 'NULL') + ',' + (n ?? 'NULL') + ')').join(','))
    for (const source of sources) for (const scale of scales) for (const sql of queries(source, scale)) await run(sql)
    for (const sql of controls) await run(sql)
    const statements: { sql: string; statement: Awaited<ReturnType<typeof conn.prepare>> }[] = []
    try {
      for (const sql of cached) statements.push({ sql, statement: await conn.prepare({ sql, rowsAsArray: true }) })
      for (const changed of [false, true]) {
        if (changed) await conn.query('UPDATE a SET n=n+2 WHERE id=2')
        for (const { sql, statement } of statements) for (const id of [1, 4, null]) {
          await check(await statement.execute([id]), 'cached: ' + sql + ': ' + id)
        }
      }
    } finally {
      for (const { statement } of statements) statement.close()
    }
    assert.equal(execution, reference.executions)
    assert.equal(reference.index.length, execution)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_cast_scale')
    await conn.end(); await db?.end()
  }
})
