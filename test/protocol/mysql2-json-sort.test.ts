// M5.44: ORDER BY over JSON as 8.4.11's filesort orders it. An array's or an
// object's sort key is only its type and its length, so two of one length
// tie, and the tie is broken by a 64-bit hash of the value appended to the
// sort record, compared low byte first and ascending under DESC too. Found
// when EXPLAIN made the JSON corpus compare these rows in order: the plan
// agreed, and the ties did not. Every expected order is 8.4.11's, asked first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.44: JSON values that tie on their sort key come out in the hash order, the same under ASC and DESC', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE jo (id INT PRIMARY KEY, j JSON, k INT)')
    await conn.query(`INSERT INTO jo VALUES (1, '[3]', 1), (2, '[1]', 1), (3, '["a"]', 1), (4, '[2]', 1), (5, '[true]', 1), (6, '[1.5]', 1), (7, '{"q": 1}', 1), (8, '{"b": "x"}', 1), (9, '{"a": "y"}', 1)`)
    const ids = async (sql: string): Promise<number[]> => ((await conn.query({ sql, rowsAsArray: true }))[0] as number[][]).map((r) => r[0] as number)
    assert.deepEqual(await ids('SELECT id FROM jo ORDER BY j'), [9, 8, 7, 5, 4, 3, 1, 2, 6])
    assert.deepEqual(await ids('SELECT id FROM jo ORDER BY j DESC'), [5, 4, 3, 1, 2, 6, 9, 8, 7])
    assert.deepEqual(await ids('SELECT id FROM jo ORDER BY k, j'), [9, 8, 7, 5, 4, 3, 1, 2, 6])
    await conn.query('DELETE FROM jo')
    await conn.query(`INSERT INTO jo VALUES (1, '{"b": 2}', 0), (2, '{"a": 1}', 0), (3, '{"z": [1]}', 0), (4, '[3]', 0), (5, '[1, 2]', 0), (6, '{"a": 0}', 0), (7, '[]', 0), (8, '{}', 0)`)
    assert.deepEqual(await ids('SELECT id FROM jo ORDER BY j'), [8, 6, 2, 1, 3, 7, 4, 5])
    assert.deepEqual(await ids('SELECT id FROM jo ORDER BY j DESC'), [5, 4, 7, 6, 2, 1, 3, 8])
  } finally {
    await conn.end()
    await db.end()
  }
})
