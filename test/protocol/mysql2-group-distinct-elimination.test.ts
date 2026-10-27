import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import type { FieldPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'
import capture from './fixtures/aggregates/group-distinct-elimination.json' with { type: 'json' }
import positive from './fixtures/aggregates/group-positive-elimination.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown; readonly plan: unknown }
type Reference = { mysqlVersion: string; observations: number; outcomes: Outcome[]; index: number[] }
const layouts = [
  ['G AS k', 'G'], ['G AS k', 'k,k'], ['G AS k', '1,1'],
  ['G AS k,G AS again', 'g,G'], ['G+0 AS k', 'G+0,G+0'],
  ['G AS k,n AS h', 'G,n'], ['n AS h,G AS k', 'G,n'],
  ['G AS k,n AS h', 'g,n,N'], ['id AS k', 'id,id'],
] as const
const readers = ['$', '$*3', '$/7', 'ROUND($,4)', 'CAST($ AS DECIMAL(35,14))']
const values = '(1,2,1,1.2345),(2,0,0,NULL),(3,1,2,2.5000),(4,2,-1,-2.5050),(5,0,3,3.0000),(6,1,NULL,4.1250),(7,NULL,-2,0.0000),(8,2,6,-1.2300),(9,0,0,NULL)'

for (const { reference, selections, count, title } of [
  { reference: capture as Reference, selections: layouts, count: 1137, title: 'retained grouping keys' },
  { reference: positive as Reference, selections: [['+G AS k', 'G'], ['++G AS k', 'G,G'], ['+(G+0) AS k', 'G+0,G+0']], count: 417, title: 'unary-plus grouping keys' },
]) test(`${title} eliminate outer DISTINCT without copying aggregate readers`, async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const canonical = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
  let observation = 0
  const fieldsOf = (fields: readonly FieldPacket[]): unknown => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
  const check = async ([rows, fields]: readonly [unknown, readonly FieldPacket[]], label: string, sql?: string, values: unknown[] = [], explain = true): Promise<void> => {
    const expected = reference.outcomes[reference.index[observation++]!]!
    const warnings = canonical((await conn.query('SHOW WARNINGS'))[0])
    const plan = sql === undefined || !explain ? null : planSkeleton((await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql, values))[0][0]?.EXPLAIN)
    assert.deepEqual(canonical(rows), expected.rows, label)
    assert.deepEqual(fieldsOf(fields), expected.fields, label)
    assert.deepEqual(warnings, expected.warnings, label)
    assert.deepEqual(plan, expected.plan, label)
  }
  const run = async (sql: string, explain = true): Promise<void> => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      await check(method === 'query' ? await conn.query(options) : await conn.execute(options), method + ': ' + sql, sql, [], explain)
      conn.unprepare(options)
    }
  }
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations, count)
    await conn.query('CREATE DATABASE grouping_distinct_elimination')
    await conn.query('USE grouping_distinct_elimination')
    for (const index of ['', ',KEY kG(G)', ',KEY kGN(G,n)']) {
      await conn.query('CREATE TABLE a(id INT PRIMARY KEY,G INT,n INT,d DECIMAL(20,4)' + index + ') STATS_AUTO_RECALC=0')
      await conn.query('INSERT INTO a VALUES ' + values)
      for (const [selected, group] of selections) for (const distinct of [false, true]) for (const reader of readers) {
        const average = reader.replaceAll('$', 'AVG(' + (distinct ? 'DISTINCT ' : '') + 'n/3)')
        for (const outer of ['', 'DISTINCT ']) await run('SELECT ' + outer + selected + ',' + average + ' AS v,COUNT(d) AS c FROM a GROUP BY ' + group)
      }
      for (const tail of [' HAVING COUNT(*)>0']) {
        await run('SELECT DISTINCT G AS k,AVG(n/3) AS v,COUNT(d) AS c FROM a GROUP BY G' + tail)
      }
      // These retain DISTINCT: the remaining writer's EXPLAIN is explicitly open.
      for (const sql of [
        'SELECT DISTINCT NULL AS v FROM a GROUP BY G WITH ROLLUP',
        'SELECT DISTINCT NULL AS v FROM a GROUP BY G,n',
        'SELECT DISTINCT NULL AS v FROM a GROUP BY G',
      ]) await run(sql, false)
      const sql = 'SELECT DISTINCT G AS k,ROUND(AVG(n/3),?) AS v,COUNT(d) AS c FROM a GROUP BY G,G'
      await conn.query('DO 0')
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const prepared = statement as unknown as { statement: { columns: FieldPacket[] } }
        await check([null, prepared.statement.columns], 'prepare: ' + index)
        for (const changed of [false, true]) {
          if (changed) await conn.query('UPDATE a SET G=3-G,n=n+1 WHERE id=2')
          for (const places of [4, 9, null]) await check(await statement.execute([places]), 'retained: ' + index + ': ' + places, sql, [places])
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
      await conn.query('DELETE FROM a')
      await run('SELECT DISTINCT G AS k,AVG(n/3) AS v,COUNT(d) AS c FROM a GROUP BY G')
      await run('SELECT DISTINCT AVG(n/3) AS v,COUNT(d) AS c FROM a')
      await conn.query('DROP TABLE a')
    }
    assert.equal(observation, reference.observations)
    assert.equal(reference.index.length, observation)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS grouping_distinct_elimination')
    await conn.end(); await db?.end()
  }
})
