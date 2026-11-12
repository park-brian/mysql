// M5.47: a prefix key does not cover the complete residual string column.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('quantified subquery coverage distinguishes complete and prefix index parts', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  try {
    await conn.query('CREATE DATABASE quantified_covering92')
    await conn.query('USE quantified_covering92')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,g INT)')
    await conn.query('INSERT INTO pa VALUES(1,2),(2,2),(3,NULL),(4,9)')
    for (const prefix of [false, true]) {
      await conn.query('DROP TABLE IF EXISTS ch')
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g INT,s VARCHAR(12),KEY gs(g,s${prefix ? '(2)' : ''}))`)
      await conn.query("INSERT INTO ch VALUES(1,2,'same'),(2,2,'sameness'),(3,9,'absent'),(4,NULL,'same')")
      await conn.query('ANALYZE TABLE pa,ch')
      await conn.query("SET optimizer_switch='default,semijoin=off,materialization=off'")
      for (const form of ['in', 'any', 'all']) {
        // Complete-key IN has a separate pre-existing residual-filter gap.
        if (!prefix && form === 'in') continue
        const predicate = form === 'in' ? 'g IN' : form === 'any' ? 'g<>ANY' : 'g=ALL'
        const sql = `SELECT g FROM pa WHERE ${predicate}(SELECT g FROM ch WHERE s='same')`
        const expected = form === 'in' ? [[2], [2]] : form === 'any' ? [[9]] : []
        const child = form === 'in' ? 'Filter\n                Index lookup on ch using gs'
          : `Filter\n                Filter\n                    ${prefix ? 'Table scan on ch' : 'Covering index scan on ch using gs'}`
        const plan = `Filter\n    Table scan on pa\n    Select #2\n        Limit\n            ${child}`
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, expected, `${prefix}/${form}/${method}`)
          assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
            [['g', 3, 11, 0, 0, 63, 'quantified_covering92', 'pa', 'pa', 'g']])
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
          const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
          conn.unprepare(options)
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS quantified_covering92')
    await conn.end()
    await db?.end()
  }
})

test('nullable integer NOT IN describes forced and costed membership builds across retained executions', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'quantified_not_in354'
  const sql = 'SELECT id,label FROM p WHERE k NOT IN (SELECT k FROM c)'
  const outer = 'Filter\n    Table scan on p\n    Select #2'
  const materialized = `${outer}\n        Filter\n            Limit\n                Index lookup on <materialized_subquery> using <auto_distinct_key>\n                    Materialize with deduplication\n                        Covering index scan on c using by_k`
  const dependent = `${outer}\n        Limit\n            Filter\n                Alternative plans for IN subquery\n                    Covering index lookup on c using by_k\n                    Table scan on c`
  const all = [[1, 'p0'], [2, 'p1'], [3, 'p2'], [4, 'p3'], [5, 'p4']]
  async function read(expected: unknown[][], plan: string) {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
        ['id', 3, 11, 20483, 0, 63, schema, 'p', 'p', 'id'], ['label', 253, 64, 4097, 0, 224, schema, 'p', 'p', 'label'],
      ])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const explainSql = `EXPLAIN FORMAT=TREE ${sql}`
      const [explain] = method === 'query' ? await conn.query<mysql.RowDataPacket[]>(explainSql) : await conn.execute<mysql.RowDataPacket[]>(explainSql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
    }
  }
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,k INT,label VARCHAR(16) NOT NULL) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,k INT NOT NULL,KEY by_k(k)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,0,'p0'),(2,NULL,'p1'),(3,2,'p2'),(4,3,'p3'),(5,4,'p4')")
    await conn.query('INSERT INTO c VALUES (1,0)')
    await conn.query('ANALYZE TABLE p,c')
    await read(all.slice(2), dependent)
    await conn.query("SET optimizer_switch='subquery_materialization_cost_based=off'")
    await read(all.slice(2), materialized)
    await conn.query("SET optimizer_switch='materialization=off'")
    await read(all.slice(2), dependent)
    await conn.query("SET optimizer_switch='materialization=on,semijoin=off'")
    await conn.query('INSERT INTO c VALUES (2,2)')
    await read(all.slice(3), materialized)
    await conn.query('DELETE FROM c')
    await read(all, materialized)
    await conn.query("SET optimizer_switch='default'")
    await conn.query('INSERT INTO c VALUES (1,0)')
    await read(all.slice(2), dependent)
    await conn.query("INSERT INTO p VALUES (6,5,'p5'),(7,6,'p6')")
    const grown = [...all, [6, 'p5'], [7, 'p6']]
    await read(grown.slice(2), materialized)
    await conn.query('INSERT INTO c VALUES (2,2),(3,3)')
    await read(grown.slice(4), dependent)
    await conn.query('DELETE FROM c')
    await read(grown, materialized)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
