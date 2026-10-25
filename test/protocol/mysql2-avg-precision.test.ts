import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import capture from './fixtures/aggregates/avg-precision.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown }
const reference = capture as { mysqlVersion: string; executions: number; outcomes: Outcome[]; index: number[] }
const args = ['n', 'd', '-n', '-d', 'd9', 'f']
const readers = ['$', '$*3', '$*7', '$+0', 'CAST($ AS DECIMAL(25,10))']

function queries(arg: string, distinct: boolean, reader: string, where: string): string[] {
  const avg = 'AVG(' + (distinct ? 'DISTINCT ' : '') + arg + ')'
  const expr = reader.replaceAll('$', avg)
  const source = ' FROM a' + where
  const field = reader.replaceAll('$', 'q.v')
  const grouped = 'SELECT ' + avg + ' AS v,g' + source + ' GROUP BY g'
  return [
    'SELECT ' + expr + ' AS v' + source,
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g+0 ORDER BY g+0',
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g ORDER BY g',
    'SELECT ' + field + ' AS v FROM (' + grouped + ') q ORDER BY g',
    'WITH q AS (' + grouped + ') SELECT ' + field + ' AS v FROM q ORDER BY g',
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g WITH ROLLUP',
    ...(distinct ? [] : ['SELECT ' + reader.replaceAll('$', avg + ' OVER (PARTITION BY g ORDER BY id ROWS UNBOUNDED PRECEDING)') + ' AS v' + source + ' ORDER BY id']),
  ]
}

test('AVG keeps grouped arithmetic precision while actual derived and window fields round to their declared scale', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const canonical = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
  let execution = 0
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.executions, 2340)
    await conn.query('CREATE DATABASE avg_precision')
    await conn.query('USE avg_precision')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,g INT,n INT,d DECIMAL(10,1),d9 DECIMAL(20,9),f DOUBLE,KEY(g))')
    await conn.query('INSERT INTO a VALUES ' + Array.from({ length: 7 }, (_, i) => {
      const n = i === 1 ? '1' : i === 6 ? 'NULL' : '0'
      return '(' + (i + 1) + ',' + (i % 2) + ',' + [n, n, n, n].join(',') + ')'
    }).join(','))
    for (const where of ['', ' WHERE id<0', ' WHERE n IS NULL']) {
      for (const arg of args) for (const distinct of [false, true]) for (const reader of readers) {
        for (const sql of queries(arg, distinct, reader, where)) for (const method of ['query', 'execute'] as const) {
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
    await conn.query('DROP DATABASE IF EXISTS avg_precision')
    await conn.end(); await db?.end()
  }
})
