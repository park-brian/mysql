// M5.43: an ORDER BY … DESC over the index a table is read by reads that
// index backwards and sorts nothing, as 8.4.11 does ("Index scan … (reverse)").
// Ties in a non-unique key then come out in descending primary-key order: a
// stable sort of an ascending scan would put them the other way round. Every
// answer is 8.4.11's, asked first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.43: ORDER BY DESC reads the index backwards, its ties in reverse key order', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE rv (id INT PRIMARY KEY, g INT, KEY (g))')
    await conn.query('INSERT INTO rv VALUES (1, 5), (2, 3), (3, 5), (4, 1)')
    const rows = async (sql: string): Promise<unknown[][]> => (await conn.query({ sql, rowsAsArray: true }))[0] as unknown[][]
    const plan = async (sql: string): Promise<unknown> => (await rows(`EXPLAIN FORMAT=TREE ${sql}`))[0]?.[0]
    assert.deepEqual(await rows('SELECT * FROM rv ORDER BY id DESC'), [[4, 1], [3, 5], [2, 3], [1, 5]])
    assert.equal(await plan('SELECT * FROM rv ORDER BY id DESC'), '-> Index scan on rv using PRIMARY (reverse)\n')
    assert.deepEqual(await rows('SELECT g, id FROM rv ORDER BY g DESC'), [[5, 3], [5, 1], [3, 2], [1, 4]])
    assert.equal(await plan('SELECT g, id FROM rv ORDER BY g DESC'), '-> Covering index scan on rv using g (reverse)\n')
  } finally {
    await conn.end()
    await db.end()
  }
})
