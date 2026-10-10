// M5.46: IN and NOT IN over an uncorrelated subquery's one column, answered
// from a set of its values built once a statement, keyed only where an equal
// comparison always means an equal key. What it must keep is the loop's NULL
// logic: an equal value decides, else a NULL on either side makes the answer
// NULL, and an empty subquery is false for IN and true for NOT IN even
// against NULL. Every answer is 8.4.11's, asked first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.46: a hashed IN subquery answers as comparing every row would, NULLs and collations included', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE io (id INT PRIMARY KEY, k INT, d DECIMAL(4,1), s VARCHAR(5))')
    await conn.query('CREATE TABLE ii (v INT, w DECIMAL(4,2), t VARCHAR(5))')
    await conn.query('CREATE TABLE iz (v INT)')
    await conn.query("INSERT INTO io VALUES (1, 1, 1.0, 'a'), (2, 2, 2.5, 'B'), (3, NULL, NULL, NULL), (4, 4, 4.0, 'z')")
    await conn.query("INSERT INTO ii VALUES (1, 1.00, 'A'), (2, 2.50, 'b'), (NULL, NULL, NULL)")
    const rows = async (sql: string): Promise<unknown[][]> => (await conn.query({ sql, rowsAsArray: true }))[0] as unknown[][]
    assert.deepEqual(await rows('SELECT id, k IN (SELECT v FROM ii), k NOT IN (SELECT v FROM ii) FROM io ORDER BY id'), [[1, 1, 0], [2, 1, 0], [3, null, null], [4, null, null]])
    assert.deepEqual(await rows('SELECT id, d IN (SELECT w FROM ii), k IN (SELECT w FROM ii) FROM io ORDER BY id'), [[1, 1, 1], [2, 1, null], [3, null, null], [4, null, null]])
    assert.deepEqual(await rows('SELECT id, s IN (SELECT t FROM ii), s NOT IN (SELECT t FROM ii WHERE t IS NOT NULL) FROM io ORDER BY id'), [[1, 1, 0], [2, 1, 0], [3, null, null], [4, null, 1]])
    assert.deepEqual(await rows('SELECT id, k IN (SELECT v FROM iz), k NOT IN (SELECT v FROM iz) FROM io ORDER BY id'), [[1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 0, 1]])
  } finally {
    await conn.end()
    await db.end()
  }
})
