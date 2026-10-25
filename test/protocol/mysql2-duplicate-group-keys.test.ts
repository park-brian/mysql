import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import type { FieldPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'
import capture from './fixtures/aggregates/duplicate-group-keys.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown; readonly plan: unknown }
const reference = capture as { mysqlVersion: string; observations: number; outcomes: Outcome[]; index: number[] }
const layouts = [
  { table: 'a', index: 'KEY kG(G)', groups: ['G', 'G,G', 'G,G,G', 'g,G', 'k,k', '1,1', 'id,id', 'G,id', 'G,G,id,G', 'G,id,id'] },
  { table: 'b', index: 'KEY kGN(G,n)', groups: ['G', 'G,G', 'G,G,G', 'g,G', 'k,k', '1,1', 'id,id', 'G,n', 'G,G,n,G', 'g,n,N', 'G,n,id', 'G,n,id,n,G'] },
]
const groups = ['2', '0', '1', '2', '0', '1', 'NULL', '2', '0']
const numbers = ['1', '0', '2', '-1', '3', 'NULL', '-2', '6', '0']
const decimals = ['1.2345', 'NULL', '2.5000', '-2.5050', '3.0000', '4.1250', '0.0000', '-1.2300', 'NULL']
const readers = ['$', '$*3', '$/7', 'CAST($ AS DECIMAL(35,14))']
function grouped(table: string, keys: string, distinct: boolean, reader: string, rollup = false): string {
  const value = reader.replaceAll('$', 'AVG(' + (distinct ? 'DISTINCT ' : '') + 'n/3)')
  // COUNT(d) requires a row read, keeping covering-index costing outside this proof.
  return 'SELECT ' + (keys.startsWith('G+0') ? 'G+0' : 'G') + ' AS k,' + value + ' AS v,COUNT(d) AS c FROM ' + table + ' GROUP BY ' + keys + (rollup ? ' WITH ROLLUP' : '')
}

test('repeated grouping columns use one index part while ROLLUP retains its positions', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const canonical = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
  let observation = 0
  const fieldsOf = (fields: readonly FieldPacket[]): unknown => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
  const check = async ([rows, fields]: readonly [unknown, readonly FieldPacket[]], label: string, sql?: string, values: unknown[] = []): Promise<void> => {
    const expected = reference.outcomes[reference.index[observation++]!]!
    const warnings = canonical((await conn.query('SHOW WARNINGS'))[0])
    const plan = sql === undefined ? null : planSkeleton((await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql, values))[0][0]?.EXPLAIN)
    assert.deepEqual(canonical(rows), expected.rows, label)
    assert.deepEqual(fieldsOf(fields), expected.fields, label)
    assert.deepEqual(warnings, expected.warnings, label)
    assert.deepEqual(plan, expected.plan, label)
  }
  const run = async (sql: string): Promise<void> => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      await check(method === 'query' ? await conn.query(options) : await conn.execute(options), method + ': ' + sql, sql)
      conn.unprepare(options)
    }
  }
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations, 498)
    await conn.query('CREATE DATABASE grouping_duplicate_keys')
    await conn.query('USE grouping_duplicate_keys')
    for (const { table, index, groups: keys } of layouts) {
      await conn.query('CREATE TABLE ' + table + '(id INT PRIMARY KEY,G INT,n INT,d DECIMAL(20,4),y YEAR,dt DATE,ts DATETIME(3),tm TIME(6),' + index + ') STATS_AUTO_RECALC=0')
      await conn.query('INSERT INTO ' + table + ' VALUES ' + numbers.map((n, i) => '(' + (i + 1) + ',' + groups[i] + ',' + n + ',' + decimals[i] + ',' + (i === 5 ? 'NULL' : i === 6 ? '0' : '2024') + ", '2024-02-29','2024-02-29 23:59:59.125','" + (i % 2 === 0 ? '12:34:56.000001' : '-01:02:03.500000') + "')").join(','))
      for (const key of keys) for (const distinct of [false, true]) for (const reader of readers) await run(grouped(table, key, distinct, reader))
      for (const key of ['G+0', 'G+0,G+0']) for (const distinct of [false, true]) for (const reader of readers) await run(grouped(table, key, distinct, reader))
      for (const key of ['G', 'G,G']) for (const distinct of [false, true]) for (const reader of ['$', '$/7']) await run(grouped(table, key, distinct, reader, true))
      for (const name of ['SUM', 'AVG']) for (const column of ['y', 'dt', 'ts', 'tm']) await run('SELECT ' + name + '(' + column + ') AS v FROM ' + table)
      const sql = 'SELECT G AS k,ROUND(AVG(n/3),?) AS v,COUNT(d) AS c FROM ' + table + ' GROUP BY G,G'
      await conn.query('DO 0')
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const prepared = statement as unknown as { statement: { columns: FieldPacket[] } }
        await check([null, prepared.statement.columns], 'prepare: ' + sql)
        for (const changed of [false, true]) {
          if (changed) await conn.query('UPDATE ' + table + ' SET G=3-G,n=n+1 WHERE id=2')
          for (const places of [4, 9, null]) await check(await statement.execute([places]), 'retained: ' + table + ': ' + places, sql, [places])
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
      await conn.query('DELETE FROM ' + table)
      await run(grouped(table, 'G,G', false, '$'))
    }
    assert.equal(observation, reference.observations)
    assert.equal(reference.index.length, observation)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS grouping_duplicate_keys')
    await conn.end(); await db?.end()
  }
})
