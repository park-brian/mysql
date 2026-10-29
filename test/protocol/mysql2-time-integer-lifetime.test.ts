import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'

test('TIME integer readers retain field rounding through cached execution and mode changes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  let created = false
  try {
    await conn.connect()
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query('CREATE DATABASE time_integer_lifetime')
    created = true
    await conn.query('USE time_integer_lifetime')
    await conn.query('CREATE TABLE times(id INT PRIMARY KEY,t TIME(6))')
    await conn.query("INSERT INTO times VALUES(1,'00:00:59.500000')")
    const sql = "SELECT LENGTH(RANDOM_BYTES(TIME '00:00:59.500000')),LENGTH(RANDOM_BYTES(t)),LENGTH(RANDOM_BYTES(CAST(t AS TIME(6)))) FROM times WHERE id=1"
    for (const truncate of [false, true, false]) {
      await conn.query('SET sql_mode=?', [truncate ? 'TIME_TRUNCATE_FRACTIONAL' : ''])
      for (const api of ['query', 'execute'] as const) for (let repeat = 0; repeat < 2; repeat++) {
        const views = db?.catalog!.store.transactions.stats().openViews
        const options = { sql, rowsAsArray: true }
        const [rows] = api === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual((rows as unknown as string[][]).map(row => row.map(Number)), [[truncate ? 59 : 100, 100, truncate ? 59 : 100]], api + ': mode ' + truncate)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views)
      }
    }
    conn.unprepare({ sql, rowsAsArray: true })
  } finally {
    if (created) await conn.query('DROP DATABASE time_integer_lifetime')
    await conn.end()
    await db?.end()
  }
})
