import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'

test('stored TIME readings survive branch selection, defaults, generated fields and DML checks', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = mysql.createConnection({
    stream: db?.createStream() ?? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }),
    user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}),
  }).promise()
  let created = false
  try {
    await conn.connect()
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query('CREATE DATABASE time_field_forwarding')
    created = true
    await conn.query('USE time_field_forwarding')
    await conn.query("CREATE TABLE times(id INT PRIMARY KEY,t TIME(6) DEFAULT '00:00:59.500000',g TIME(6) AS (IF(1,t,NULL)) VIRTUAL,s TIME(6) AS (IF(1,t,NULL)) STORED,marker VARBINARY(4),CONSTRAINT field_reading CHECK (t IS NULL OR HEX(CHAR(IF(1,t,NULL)))='64'))")
    const sql = 'SELECT HEX(CHAR(IF(1,t,NULL))),HEX(CHAR(CASE WHEN TRUE THEN t END)),HEX(CHAR(IF(1,DEFAULT(t),NULL))),HEX(CHAR(IF(1,g,NULL))),HEX(CHAR(IF(1,s,NULL))),HEX(CHAR(COALESCE(t,NULL))),HEX(CHAR((SELECT t))),HEX(marker) FROM times WHERE id=?'
    for (const truncate of [false, true, false]) {
      await conn.query('SET sql_mode=?', [truncate ? 'TIME_TRUNCATE_FRACTIONAL' : ''])
      await conn.query('DELETE FROM times')
      await conn.query('INSERT INTO times(id) VALUES(1),(2)')
      await conn.query('UPDATE times SET marker=CHAR(IF(1,t,NULL))')
      await assert.rejects(conn.execute('INSERT INTO times(id,t) VALUES(?,?)', [3, '00:00:59.499999']), (e: unknown) => (e as { errno: number }).errno === 3819)
      for (const api of ['query', 'execute'] as const) for (const id of [1, 2, 1]) {
        const views = db?.catalog!.store.transactions.stats().openViews
        const options = { sql, rowsAsArray: true }
        const [rows] = api === 'query' ? await conn.query(options, [id]) : await conn.execute(options, [id])
        assert.deepEqual(rows, [['64', '64', '64', '64', '64', truncate ? '3B' : '64', '64', '64']])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views)
      }
    }
    conn.unprepare({ sql, rowsAsArray: true })
    conn.unprepare('INSERT INTO times(id,t) VALUES(?,?)')
  } finally {
    if (created) await conn.query('DROP DATABASE time_field_forwarding')
    await conn.end()
    await db?.end()
  }
})
