import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import type { FieldPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import capture from './fixtures/aggregates/avg-distinct-copy.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown }
const reference = capture as { mysqlVersion: string; executions: number; outcomes: Outcome[]; index: number[] }
const args = ['n/3', 'n/20000', 'IF(1,n,0.0000000001)', 'IF(1,n,0.5)', 'n', 'd', 'IF(1,n/20000,0.000000000)', 'IF(1,n/3,0.000000000)']
const readers = ['$', '$*3', '$*7', 'CAST($ AS DECIMAL(35,10))']
const groups: readonly (readonly (string | null)[])[] = [
  ['10001', '10002', '0'], ['-10001', '-10002', '0'], ['1', '2', '0'], ['0', '1', '3'], [null, '1', '3'], ['2', '0', '0'],
  ['9007199254740993', '-9007199254740992', '0'], ['-9007199254740993', '9007199254740992', '0'],
]
const cached = ['SELECT AVG(DISTINCT n/20000) AS v FROM a WHERE g=?', 'SELECT AVG(DISTINCT IF(1,n,0.0000000001)) AS v FROM a WHERE g=?']
function queries(name: string, arg: string, reader: string, where: string): string[] {
  const call = name + '(' + (name === 'AVG' || name === 'SUM' ? 'DISTINCT ' : '') + arg + ')'
  const expr = reader.replaceAll('$', call)
  const source = ' FROM a' + where
  const grouped = 'SELECT ' + call + ' AS v,g' + source + ' GROUP BY g'
  const field = reader.replaceAll('$', 'q.v')
  return [
    'SELECT ' + expr + ' AS v' + source,
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g ORDER BY g',
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g+0 ORDER BY g+0',
    'SELECT ' + expr + ' AS v' + source + ' GROUP BY g WITH ROLLUP',
    'SELECT ' + field + ' AS v FROM (' + grouped + ') q ORDER BY g',
    'WITH q AS (' + grouped + ') SELECT ' + field + ' AS v FROM q ORDER BY g',
  ]
}

test('DISTINCT AVG keys and accumulates the same copied DECIMAL argument, including cached execution after writes', async () => {
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
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.executions, 1482)
    await conn.query('CREATE DATABASE avg_distinct_copy')
    await conn.query('USE avg_distinct_copy')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,g INT,n BIGINT,d DECIMAL(24,4),KEY(g))')
    await conn.query('INSERT INTO a VALUES ' + groups.flatMap((values, g) => values.map((n, i) => '(' + (g * 3 + i + 1) + ',' + g + ',' + (n ?? 'NULL') + ',' + (n ?? 'NULL') + ')')).join(','))
    for (const where of ['', ' WHERE id<0', ' WHERE n IS NULL']) for (const name of ['AVG', 'SUM']) {
      for (const arg of name === 'AVG' ? args : ['n', 'd']) for (const reader of readers) {
        for (const sql of queries(name, arg, reader, where)) for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          await check(method === 'query' ? await conn.query(options) : await conn.execute(options), method + ': ' + sql)
          conn.unprepare(options)
        }
      }
    }
    const statements: { sql: string; statement: Awaited<ReturnType<typeof conn.prepare>> }[] = []
    try {
      for (const sql of cached) statements.push({ sql, statement: await conn.prepare({ sql, rowsAsArray: true }) })
      for (const changed of [false, true]) {
        if (changed) await conn.query('UPDATE a SET n=n+2 WHERE g=0 AND id=1')
        for (const { sql, statement } of statements) for (const g of [0, 1, 3, null]) {
          await check(await statement.execute([g]), 'cached: ' + sql + ': ' + g)
        }
      }
    } finally {
      for (const { statement } of statements) statement.close()
    }
    // Typed scalar caches and copied fields agree even when held and target scales match.
    for (const arg of ['IF(1,n/20000,0.000000000)', 'IF(1,n/3,0.000000000)']) {
      for (const name of ['COALESCE', 'IFNULL']) for (const reader of ['$', '$*3', '$/7']) {
        const sql = 'SELECT ' + arg + ' AS raw,' + reader.replaceAll('$', name + '(' + arg + ',0)') + ' AS v FROM a ORDER BY id'
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          await check(method === 'query' ? await conn.query(options) : await conn.execute(options), method + ': ' + sql)
          conn.unprepare(options)
        }
      }
    }
    // The seeded sequence also pins one argument evaluation per input row.
    for (const method of ['query', 'execute'] as const) {
      const options = { sql: 'SELECT AVG(DISTINCT CAST(RAND(7) AS DECIMAL(20,8))) AS v FROM a', rowsAsArray: true }
      await check(method === 'query' ? await conn.query(options) : await conn.execute(options), 'seeded argument: ' + method)
      conn.unprepare(options)
    }
    assert.equal(execution, reference.executions)
    assert.equal(reference.index.length, execution)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS avg_distinct_copy')
    await conn.end(); await db?.end()
  }
})
