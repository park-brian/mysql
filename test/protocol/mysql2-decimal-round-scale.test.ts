import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import type { FieldPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import capture from './fixtures/functions/decimal-round-scale.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown }
const reference = capture as { mysqlVersion: string; executions: number; outcomes: Outcome[]; index: number[] }
const sources = ['IF(1,n/3,0.000000000)', 'IF(1,n/7,0.000000000)', 'd', 'n', 'f']
const places = [-2, -1, 0, 4, 8, 9, 13]
const values = ['0', '1', '2', '3', '7', '-1', '-2', '10001', '-10001', '9007199254740993', '-9007199254740993', null]
const decimals = ['0', '1.2345', '1.2350', '-1.2350', '2.5000', '-2.5000', '9.9995', '-9.9995', '999.9500', '9007199254740993.5000', '-9007199254740993.5000', null]
const controls = ['ROUND', 'TRUNCATE'].flatMap((name) => [
  'SELECT ' + name + '(CAST(RAND(7) AS DECIMAL(20,9)),9) AS v FROM a ORDER BY id',
  'SELECT ' + name + '(NULL,9) AS v',
])
const cached = [
  'SELECT ROUND(IF(1,n/3,0.000000000),9)*3 AS v FROM a WHERE id>=? ORDER BY id',
  'SELECT TRUNCATE(IF(1,n/7,0.000000000),8) AS v FROM a WHERE id>=? ORDER BY id',
]
function queries(name: string, source: string, at: number | string): string[] {
  const rounded = name + '(' + source + ',' + at + ')'
  // Row-dependent places can retain fewer physical words for a later division.
  // Keep that separate arithmetic gap in the full native audit.
  const readers = at === 'p' ? ['$', '$*3', '$+0'] : ['$', '$*3', '$+0', '$/7']
  return readers.map((reader) => 'SELECT ' + source + ' AS raw,' + reader.replaceAll('$', rounded) + ' AS v FROM a ORDER BY id')
}

test('DECIMAL ROUND and TRUNCATE own their declared scale, preserving raw readers, ties, NULLs and cached executions', async () => {
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
    assert.equal(reference.executions, 640)
    await conn.query('CREATE DATABASE decimal_round_scale')
    await conn.query('USE decimal_round_scale')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,n BIGINT,d DECIMAL(24,4),f DOUBLE,p INT)')
    await conn.query('INSERT INTO a VALUES ' + values.map((n, i) => '(' + (i + 1) + ',' + (n ?? 'NULL') + ',' + (decimals[i] ?? 'NULL') + ',' + (decimals[i] ?? 'NULL') + ',' + (i === 7 ? 'NULL' : places[i % places.length]) + ')').join(','))
    for (const name of ['ROUND', 'TRUNCATE']) for (const source of sources) for (const at of [...places, 'p']) for (const sql of queries(name, source, at)) await run(sql)
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
    await conn.query('DROP DATABASE IF EXISTS decimal_round_scale')
    await conn.end(); await db?.end()
  }
})
