// M5.47: distinct-key fanout and final outer cardinality change the winning strategy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('semijoin costs select LooseScan for captures 149/248 and FirstMatch under a small ordered LIMIT', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const fixture = JSON.parse(readFileSync(new URL('../format/fixtures/relational.json', import.meta.url), 'utf8')) as { cases: { sql: string; plan?: string }[][] }
  const loop = 'Nested loop semijoin\n    Covering index scan on pa using name\n    Covering index lookup on ch using pa_id'
  const loose = 'Nested loop inner join\n    Remove duplicates from input sorted on pa_id\n        Filter\n            Covering index scan on ch using pa_id\n    Single-row index lookup on pa using PRIMARY'
  const sorted = `Sort\n    Stream results\n${loose.split('\n').map((s) => `        ${s}`).join('\n')}`
  const limit = `Limit\n${loop.split('\n').map((s) => `    ${s}`).join('\n')}`
  const run = async (sql: string, expected: unknown[][], plan: string, flags: number) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        [['name', 253, 48, flags, 0, 224, 'semi_cost', 'pa', 'pa', 'name']], `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS semi_cost')
    await conn.query('USE semi_cost')
    for (const i of [149, 248]) {
      await conn.query('DROP TABLE IF EXISTS pa,ch')
      const observations = fixture.cases[i]!
      for (const o of observations) if (/^(CREATE TABLE (pa|ch) |INSERT INTO (pa|ch) )/.test(o.sql)) await conn.query(o.sql)
      await conn.query('ANALYZE TABLE pa,ch')
      const sql = observations.find((o) => o.plan?.includes('Remove duplicates from input sorted'))!.sql
      const ordered = sql.includes('ORDER BY')
      await run(sql, i === 149 ? [['ÄNNA'], ['Bob'], ['zoë'], ['x y']] : [['b'], ['cy'], ['zoë']], ordered ? sorted : loose, ordered ? 4097 : 20485)
      if (i === 149) await run(sql.replace('SELECT pa_id', 'SELECT PA_ID'), [['ÄNNA'], ['Bob'], ['zoë'], ['x y']], loose, 20485)
      await run(sql + (ordered ? ' LIMIT 1' : ' ORDER BY 1 LIMIT 1'), i === 149 ? [['ÄNNA']] : [['b']], limit, 20485)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS semi_cost')
    await conn.end()
    await db?.end()
  }
})
