// M5.47: a residual predicate does not by itself choose a hash antijoin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — share the capture's normalization, without its runner.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('integer antijoins cost their strategy and rebuild keys for each execution', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS (SELECT 1 FROM ch WHERE ch.pa_id=pa.id AND ch.qty>2)'
  const hash = 'Hash antijoin\n    Covering index scan on pa using name\n    Hash\n        Filter\n            Table scan on ch'
  const run = async (query: string, expected: unknown[][], plan?: string, alias = 'pa', flags = 20485) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql: query, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${query}`)
      assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.name, f.orgName, f.table, f.orgTable]),
        [[253, 48, flags, 0, 224, 'name', 'name', alias, 'pa']], `${method}: metadata`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      if (plan !== undefined) {
        const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${query}`)
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: plan`)
      }
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS integer_antijoin')
    await conn.query('USE integer_antijoin')
    await conn.query('DROP TABLE IF EXISTS pa,ch')
    await conn.query('CREATE TABLE pa (id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch (id INT PRIMARY KEY,pa_id INT,qty INT NOT NULL,KEY(pa_id)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(1,'z',1),(2,'a',2),(3,'m',NULL),(4,'b',4)")
    await conn.query('INSERT INTO ch VALUES(1,1,3),(2,1,4),(3,2,1),(4,NULL,5)')
    await run(sql, [['a'], ['b'], ['m']], 'Nested loop antijoin\n    Covering index scan on pa using name\n    Filter\n        Index lookup on ch using pa_id')
    await conn.query('DELETE FROM pa')
    await conn.query('DELETE FROM ch')
    // The captured corpus's five outer / three inner rows choose a hash build after ANALYZE.
    await conn.query("INSERT INTO pa VALUES(1,'Bob',4),(2,'ÄNNA',4),(3,'b',1),(4,'éva',4),(5,'zoë',NULL)")
    await conn.query('INSERT INTO ch VALUES(1,6,1),(2,6,5),(3,3,6)')
    await conn.query('ANALYZE TABLE pa,ch')
    const kept = [['ÄNNA'], ['Bob'], ['éva'], ['zoë']]
    await run(sql, kept, hash)
    const straight = sql.replace('SELECT name', 'SELECT STRAIGHT_JOIN name')
    await run(straight, kept)
    // STRAIGHT_JOIN disables this transformation; retain the dependent subquery.
    const [dependent] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${straight}`)
    assert.match(dependent[0]?.EXPLAIN, /Select #2/)
    assert.doesNotMatch(dependent[0]?.EXPLAIN, /Hash antijoin/)
    await run(`${sql} ORDER BY 1`, kept, `Sort\n    Stream results\n${hash.split('\n').map((line: string) => `        ${line}`).join('\n')}`, 'pa', 4097)
    await run(sql.replace('ch.pa_id=pa.id', 'pa.id=ch.pa_id'), kept, hash)
    await run('SELECT x.name FROM pa x WHERE NOT EXISTS (SELECT 1 FROM ch y WHERE y.pa_id=x.id AND y.qty>2)', kept,
      hash.replace('on pa ', 'on x ').replace('on ch', 'on y'), 'x')
    await run(sql.replace('pa.id', 'pa.grp'), [['Bob'], ['ÄNNA'], ['b'], ['éva'], ['zoë']], hash.replace('Covering index scan on pa using name', 'Table scan on pa'))
    // Duplicate matching keys and NULL inner keys cannot discard an unmatched outer row.
    await conn.query('INSERT INTO ch VALUES(4,1,3),(5,1,9),(6,NULL,4)')
    await run(`${sql} ORDER BY 1`, [['ÄNNA'], ['éva'], ['zoë']])
    await conn.query('UPDATE ch SET qty=0 WHERE pa_id=1')
    await run(`${sql} ORDER BY 1`, kept)
    await conn.query('DELETE FROM ch')
    await run(`${sql} ORDER BY 1`, [['ÄNNA'], ['b'], ['Bob'], ['éva'], ['zoë']], undefined, 'pa', 4097)
    await conn.query('DELETE FROM pa')
    await run(`${sql} ORDER BY 1`, [], undefined, 'pa', 4097)
    // Temporary tables have one open per statement; costing cannot consume that open.
    await conn.query('DROP TABLE ch')
    await conn.query('CREATE TEMPORARY TABLE ch (id INT PRIMARY KEY,pa_id INT,qty INT NOT NULL,KEY(pa_id))')
    await conn.query("INSERT INTO pa VALUES(1,'a',NULL)")
    await run(sql, [['a']])
    await conn.query('INSERT INTO ch VALUES(1,1,3)')
    await run(sql, [])
    await conn.query('DROP TABLE pa,ch')
    await conn.query('CREATE TEMPORARY TABLE pa (id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,UNIQUE KEY(name))')
    await conn.query('CREATE TABLE ch (id INT PRIMARY KEY,pa_id INT,qty INT NOT NULL,KEY(pa_id))')
    await conn.query("INSERT INTO pa VALUES(1,'a')")
    await run(sql, [['a']])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS integer_antijoin')
    await conn.end()
    await db?.end()
  }
})

test('returning from a hash antijoin stream releases its writer and execution state', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('CREATE TABLE d.pa (id INT PRIMARY KEY) STATS_AUTO_RECALC=0')
    await db.query('CREATE TABLE d.ch (id INT PRIMARY KEY,pa_id INT,qty INT NOT NULL,KEY(pa_id)) STATS_AUTO_RECALC=0')
    await db.query('INSERT INTO d.pa VALUES(1),(2),(3),(4),(5)')
    await db.query('INSERT INTO d.ch VALUES(1,6,1),(2,6,5),(3,3,6)')
    await db.query('ANALYZE TABLE d.pa,d.ch')
    const sql = 'SELECT id FROM d.pa WHERE NOT EXISTS (SELECT 1 FROM d.ch WHERE ch.pa_id=pa.id AND ch.qty>2)'
    const [plan] = await db.query(`EXPLAIN FORMAT=TREE ${sql} FOR UPDATE`)
    assert.match(JSON.stringify(plan), /Hash antijoin/)
    for await (const row of db.stream(`${sql} FOR UPDATE`)) {
      assert.deepEqual(row, { id: 1 })
      break
    }
    assert.equal(db.openConnections, 1)
    const other = await db.connect()
    try {
      await other.query('SET innodb_lock_wait_timeout=1')
      await other.query('INSERT INTO d.ch VALUES(4,1,3)')
    } finally {
      await other.end()
    }
    assert.deepEqual((await db.query(`${sql} ORDER BY id`))[0], [{ id: 2 }, { id: 4 }, { id: 5 }])
  } finally {
    await db.end()
  }
})
