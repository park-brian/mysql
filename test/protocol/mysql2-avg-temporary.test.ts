import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import capture from './fixtures/aggregates/avg-temporary.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown }
const reference = capture as { mysqlVersion: string; executions: number; outcomes: Outcome[]; index: number[] }
const args = ['n/3', 'n/20000', 'IF(1,n,0.0000000001)', 'IF(1,n,0.5)', 'n', 'd']
const readers = ['$', '$*3', '$*7', 'CAST($ AS DECIMAL(35,10))']
const groups: readonly (readonly (string | null)[])[] = [
  ['2', '0', '0'], ['0', '2', '0'], ['0', '0', '2'], ['-2', '0', '0'], ['0', '-2', '0'],
  ['20000', '-1', '0'], ['-1', '20000', '0'], [null, '2', '0'],
  ['9007199254740993', '-9007199254740992', '0'], ['-9007199254740993', '9007199254740992', '0'],
]
function queries(arg: string, reader: string, where: string, stored: boolean): string[] {
  const avg = 'AVG(' + arg + ')'
  const expr = reader.replaceAll('$', avg)
  const source = ' FROM a' + where
  if (!stored) return [
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g ORDER BY g',
    'SELECT ' + expr + ' AS v' + source,
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g WITH ROLLUP',
    'SELECT ' + reader.replaceAll('$', avg + ' OVER (PARTITION BY g ORDER BY id ROWS UNBOUNDED PRECEDING)') + ' AS v' + source + ' ORDER BY id',
  ]
  const grouped = 'SELECT ' + avg + ' AS v,g+0 AS k' + source + ' GROUP BY g+0'
  const field = reader.replaceAll('$', 'q.v')
  return [
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g+0 ORDER BY g+0',
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g*1 ORDER BY g*1',
    'SELECT ' + field + ' AS v FROM (' + grouped + ') q ORDER BY k',
    'WITH q AS (' + grouped + ') SELECT ' + field + ' AS v FROM q ORDER BY k',
  ]
}

test('ordinary temporary AVG stores its running sum at input scale without changing streamed or window accumulators', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const canonical = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
  let execution = 0
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.executions, 768)
    await conn.query('CREATE DATABASE avg_temp_copy')
    await conn.query('USE avg_temp_copy')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,g INT,n BIGINT,d DECIMAL(24,4),KEY(g))')
    await conn.query('INSERT INTO a VALUES ' + groups.flatMap((values, g) => values.map((n, i) => '(' + (g * 3 + i + 1) + ',' + g + ',' + (n ?? 'NULL') + ',' + (n ?? 'NULL') + ')')).join(','))
    for (const where of ['', ' WHERE id<0', ' WHERE n IS NULL']) for (const stored of [true, false]) {
      for (const arg of stored ? args : ['n', 'd']) for (const reader of readers) {
        for (const sql of queries(arg, reader, where, stored)) for (const method of ['query', 'execute'] as const) {
          const expected = reference.outcomes[reference.index[execution++]!]!
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(canonical(rows), expected.rows, method + ': ' + sql)
          assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), expected.fields, method + ': ' + sql)
          assert.deepEqual(canonical((await conn.query('SHOW WARNINGS'))[0]), expected.warnings, method + ': ' + sql)
          conn.unprepare(options)
        }
      }
    }
    assert.equal(execution, reference.executions)
    assert.equal(reference.index.length, execution)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS avg_temp_copy')
    await conn.end(); await db?.end()
  }
})
