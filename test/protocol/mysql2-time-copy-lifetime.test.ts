import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'

test('TIME copies and caches replace integer readings through repeated queries, rebinding and mode changes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const conn = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true }).promise()
  const statements = [
    'SELECT LENGTH(RANDOM_BYTES(t)),LENGTH(RANDOM_BYTES(IF(1,t,NULL))),LENGTH(RANDOM_BYTES(COALESCE(t,NULL))),LENGTH(RANDOM_BYTES(CAST(t AS TIME(6)))),LENGTH(RANDOM_BYTES((SELECT t))) FROM (SELECT CAST(t AS TIME(6)) AS t FROM times WHERE id=? LIMIT 1) AS copied',
    'SELECT LENGTH(RANDOM_BYTES(MIN(t))) FROM (SELECT CAST(t AS TIME(6)) AS t FROM times WHERE id=? LIMIT 1) AS copied',
    'SELECT LENGTH(RANDOM_BYTES((SELECT t))) FROM (SELECT (SELECT t FROM times WHERE id=?) AS t LIMIT 1) AS copied',
    'SELECT LENGTH(RANDOM_BYTES((SELECT t HAVING TRUE))) FROM (SELECT CAST(t AS TIME(6)) AS t FROM times WHERE id=? LIMIT 1) AS copied',
  ]
  let created = false
  try {
    await conn.connect()
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query('CREATE DATABASE time_copy_lifetime')
    created = true
    await conn.query('USE time_copy_lifetime')
    await conn.query('CREATE TABLE times(id INT PRIMARY KEY,t TIME(6))')
    await conn.query("INSERT INTO times VALUES(1,'00:00:59.500000'),(2,'00:00:59.499999')")
    for (const truncate of [false, true, false]) {
      await conn.query('SET sql_mode=?', [truncate ? 'TIME_TRUNCATE_FRACTIONAL' : ''])
      for (const api of ['query', 'execute'] as const) for (let repeat = 0; repeat < 2; repeat++) for (const id of [1, 2]) for (const [i, sql] of statements.entries()) {
        const views = db?.catalog!.store.transactions.stats().openViews
        const options = { sql, rowsAsArray: true }
        const [rows] = api === 'query' ? await conn.query(options, [id]) : await conn.execute(options, [id])
        const field = id === 1 ? 100 : 59
        const expression = truncate ? 59 : field
        const cache = id === 1 ? 60 : 59
        const expected = [[field, field, expression, expression, field], [cache], [field], [cache]][i]!
        assert.deepEqual((rows as unknown as string[][]).map(row => row.map(Number)), [expected], api + ': mode ' + truncate + ', id ' + id + ', source ' + i)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views)
      }
    }
    for (const sql of statements) conn.unprepare({ sql, rowsAsArray: true })
  } finally {
    if (created) await conn.query('DROP DATABASE time_copy_lifetime')
    await conn.end()
    await db?.end()
  }
})
