// M5.7: an index lookup by an enclosing query's column (`ref` access in a
// correlated subquery), and `<=>` read as a key: `= v` for a value, IS NULL
// for NULL. Each is a key read only where it returns exactly the rows the
// condition would (D-65), so what these pin is the NULL and type edges.
// Every answer is 8.4.11's, asked first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.7: a correlated lookup by an outer column, and <=> as a key read, find what the condition finds', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE kp (id INT PRIMARY KEY, g INT, d DECIMAL(5,2))')
    await conn.query('CREATE TABLE kc (id INT PRIMARY KEY, g INT, v VARCHAR(5), KEY (g))')
    await conn.query('INSERT INTO kp VALUES (1, 1, 1.00), (2, NULL, NULL), (3, 3, 2.50)')
    await conn.query("INSERT INTO kc VALUES (10, 1, 'a'), (11, NULL, 'b'), (12, 1, 'c'), (13, 3, 'd'), (14, NULL, 'e')")
    const rows = async (sql: string): Promise<unknown[][]> => (await conn.query({ sql, rowsAsArray: true }))[0] as unknown[][]
    // An outer NULL matches nothing under `=`, and the NULL rows under `<=>`.
    assert.deepEqual(await rows('SELECT id, (SELECT COUNT(*) FROM kc WHERE kc.g = kp.g) FROM kp ORDER BY id'), [[1, 2], [2, 0], [3, 1]])
    assert.deepEqual(await rows('SELECT id, (SELECT GROUP_CONCAT(v ORDER BY v) FROM kc WHERE kc.g <=> kp.g) FROM kp ORDER BY id'), [[1, 'a,c'], [2, 'b,e'], [3, 'd']])
    assert.deepEqual(await rows('SELECT id FROM kc WHERE g <=> NULL'), [[11], [14]])
    assert.deepEqual(await rows('SELECT id FROM kc WHERE g <=> 1'), [[10], [12]])
    // A DECIMAL outer value does not convert to the INT key exactly: a filtered scan, and 1 = 1.00 still holds.
    assert.deepEqual(await rows('SELECT id, (SELECT COUNT(*) FROM kc WHERE kc.g = kp.d) FROM kp ORDER BY id'), [[1, 2], [2, 0], [3, 0]])
    const [plan] = (await conn.query({ sql: 'EXPLAIN FORMAT=TREE SELECT id, (SELECT COUNT(*) FROM kc WHERE kc.g = kp.g) FROM kp', rowsAsArray: true })) as unknown as [string[][]]
    assert.match(plan[0]?.[0] ?? '', /-> Select #2\n {4}-> Aggregate\n {8}-> Covering index lookup on kc using g\n/)
  } finally {
    await conn.end()
    await db.end()
  }
})
