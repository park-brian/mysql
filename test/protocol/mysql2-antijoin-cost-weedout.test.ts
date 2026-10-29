// M5.47: an enabled materialized alternative can lose to the bounded lookup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { SqlError } from '@myjs/protocol'
import fixture from './fixtures/antijoin/cost-weedout.json' with { type: 'json' }
// @ts-expect-error — share the reference's normalization without its runner.
import { planSkeleton } from '../../tools/capture-relational.mjs'

const host = process.env.MYSQL_REFERENCE_HOST
const facts = (fields: readonly mysql.FieldPacket[]) => fields.map((f) =>
  [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

test('cost-selected weedout bounds its source while materialized winners retain their build', async () => {
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined ? { host: host ?? 'reference', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) } : { stream: db.createStream() }),
    user: 'root',
  })
  const open = db?.catalog!.table.bind(db.catalog)
  let opened = 0, visited = 0, closed = 0, outerRead = 0
  let failAfter: number | undefined
  let failOuter = false
  const events: string[] = []
  const reset = () => { opened = visited = closed = outerRead = 0; events.length = 0 }
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g)'
  const handlers = async () => Object.fromEntries((await conn.query<mysql.RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Handler_read%'"))[0]
    .map((r) => [String(r.Variable_name), Number(r.Value)]))
  const populate = async (inner: string, outer: number | null) => {
    await conn.query('DELETE FROM pa'); await conn.query('DELETE FROM ch')
    await conn.query(`INSERT INTO pa VALUES(1,'one',${outer ?? 'NULL'})`)
    if (inner !== 'empty') await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 100 }, (_, i) =>
      `(${i + 1},${inner === 'all-null' || inner === 'mixed-null' && i % 2 === 0 ? 'NULL' : 1})`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
  }
  try {
    assert.equal(fixture.mysqlVersion, '8.4.11')
    assert.equal(fixture.cases.length, 36)
    assert.equal(fixture.outcomes, 72)
    if (host !== undefined) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]?.v.split('-')[0], fixture.mysqlVersion)
    await conn.query('CREATE DATABASE costweed221'); await conn.query('USE costweed221')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    if (db !== undefined && open !== undefined) db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema !== 'costweed221') return table
      if (name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          opened++; events.push('ch:open')
          try {
            for (const row of scan(index, range, transaction, mode)) {
              visited++
              if (visited === failAfter) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected cost-selected inner failure')
              yield row
            }
          } finally { closed++; events.push('ch:close') }
        }
      } else if (name === 'pa') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          events.push('pa:open')
          try {
            for (const row of scan(range, transaction, mode)) {
              outerRead++; events.push('pa:row')
              if (failOuter && outerRead === 2) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected cost-selected outer failure')
              yield row
            }
          } finally { events.push('pa:close') }
        }
      }
      return table
    }
    for (const sample of fixture.cases) {
      await conn.query('SET optimizer_switch=' + mysql.escape(sample.switches))
      await populate(sample.inner, sample.outer)
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), planSkeleton(sample.nativeActivity))
      if (host !== undefined) {
        const [analyze] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN ANALYZE ' + sql)
        const inner = String(analyze[0]?.EXPLAIN).split('\n').find((line) => line.includes(sample.materialized ? 'Covering index scan on ch' : 'Covering index lookup on ch'))
        assert.match(inner ?? '', new RegExp('\\(actual time=[^)]* rows=' + sample.innerRows + ' loops=1\\)'))
      }
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        await conn.query('DO 0')
        const before = host === undefined ? undefined : await handlers()
        reset()
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, fixture.rows[sample.rows])
        assert.deepEqual(facts(fields), fixture.fields[sample.fields])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings[sample.warnings])
        if (before !== undefined) {
          const after = await handlers()
          assert.deepEqual(Object.fromEntries(Object.keys(before).map((k) => [k, after[k]! - before[k]!])), sample.nativeHandlers[method])
        }
        if (db !== undefined) assert.deepEqual([opened, visited, closed], sample.materialized ? [1, 100, 1] : sample.outer === null ? [0, 0, 0] : [1, sample.innerRows, 1])
        conn.unprepare(options)
      }
    }
    await conn.query("SET optimizer_switch='default,firstmatch=off'")
    await conn.query('DELETE FROM pa'); await conn.query('DELETE FROM ch')
    await conn.query("INSERT INTO pa VALUES(1,'n002',1),(2,'n001',9)")
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 80 }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4})`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
    const sorted = sql + ' ORDER BY name LIMIT 1'
    const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sorted)
    assert.equal(planSkeleton(explain[0]?.EXPLAIN), planSkeleton(fixture.nativeSortActivity))
    for (const method of ['query', 'execute'] as const) {
      reset()
      const options = { sql: sorted, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, [['n001']]); assert.deepEqual(facts(fields), fixture.fields[0])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      if (db !== undefined) assert.deepEqual(events, ['pa:open', 'pa:row', 'pa:row', 'pa:close', 'ch:open', 'ch:close'])
      conn.unprepare(options)
    }
    if (db !== undefined) {
      reset(); failOuter = true
      await assert.rejects(conn.query(sorted), /injected cost-selected outer failure/)
      assert.deepEqual(events, ['pa:open', 'pa:row', 'pa:row', 'pa:close'])
      failOuter = false
    }
    await populate('mixed-null', 1)
    const options = { sql: sql + ' LIMIT ?', rowsAsArray: true }
    const run = async (limit: number, rows: unknown, reads: number, opens = 1) => {
      reset()
      const [actual, fields] = await conn.execute(options, [limit])
      assert.deepEqual(actual, rows); assert.deepEqual(facts(fields), fixture.fields[0])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      if (db !== undefined) assert.deepEqual([opened, visited, closed], limit === 0 ? [0, 0, 0] : [opens, reads, opens])
    }
    failAfter = 2
    for (const limit of [0, 1, 5]) await run(limit, [], limit === 0 ? 0 : 1)
    await conn.query('UPDATE pa SET g=9'); await run(1, [['one']], 0)
    await conn.query('UPDATE ch SET g=9 WHERE g IS NOT NULL'); await run(1, [], 1)
    await conn.beginTransaction()
    await conn.query('UPDATE ch SET g=1 WHERE g IS NOT NULL'); await run(1, [['one']], 0)
    await conn.rollback(); await run(1, [], 1)
    await conn.query('UPDATE pa SET g=NULL')
    failAfter = 1
    await run(1, [['one']], 0, 0)
    await conn.beginTransaction(); await conn.query('UPDATE pa SET g=9')
    if (db !== undefined) await assert.rejects(conn.execute(options, [1]), /injected cost-selected inner failure/)
    else await run(1, [], 1)
    await conn.rollback(); await run(1, [['one']], 0, 0)
    // A new distribution selects materialization, including for a NULL first key.
    failAfter = undefined
    await conn.query('UPDATE ch SET g=1'); await conn.query('ANALYZE TABLE pa,ch')
    const [materialized] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
    assert.match(String(materialized[0]?.EXPLAIN), /Materialize with deduplication/)
    if (db !== undefined) {
      reset(); failAfter = 1
      await assert.rejects(conn.execute(options, [1]), /injected cost-selected inner failure/)
      assert.deepEqual([opened, visited, closed], [1, 1, 1])
    }
    failAfter = undefined
    await run(1, [['one']], 100)
    await conn.query('UPDATE ch SET g=NULL WHERE MOD(id,2)=1'); await conn.query('ANALYZE TABLE pa,ch')
    const [limited] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
    assert.doesNotMatch(String(limited[0]?.EXPLAIN), /Materialize with deduplication/)
    failAfter = 1
    await run(1, [['one']], 0, 0)
    conn.unprepare(options)
  } finally {
    if (db !== undefined && open !== undefined) db.catalog!.table = open
    await conn.query('DROP DATABASE IF EXISTS costweed221'); await conn.end(); await db?.end()
  }
})
