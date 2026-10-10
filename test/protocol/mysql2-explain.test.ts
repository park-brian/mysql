// M5.44: EXPLAIN FORMAT=TREE, as 8.4.11 answers it through mysql2: one
// VAR_STRING column named EXPLAIN, 78 characters, NOT NULL, holding the plan
// as `-> ` lines four spaces deep per level. The corpus compares the plans
// themselves (`relational-vectors.test.ts`); this pins the answer's shape and
// what is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.44: EXPLAIN FORMAT=TREE answers the plan as one VAR_STRING row; other formats are refused by name', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE a (id INT PRIMARY KEY, x INT)')
    await conn.query('CREATE TABLE b (id INT PRIMARY KEY, a_id INT)')
    const [rows, fields] = (await conn.query({ sql: 'EXPLAIN FORMAT=TREE SELECT * FROM a JOIN b ON a.x = b.a_id WHERE b.id > 1 ORDER BY a.x', rowsAsArray: true })) as unknown as [string[][], { name: string; columnType: number; columnLength: number; flags: number }[]]
    assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags & 1]), [['EXPLAIN', 253, 312, 1]])
    assert.equal(rows[0]?.[0], ['-> Sort', '    -> Stream results', '        -> Inner hash join', '            -> Filter', '                -> Index range scan on b using PRIMARY over (1 < id)', '            -> Hash', '                -> Table scan on a', ''].join('\n'))
    const [one] = (await conn.query({ sql: 'EXPLAIN FORMAT=TREE SELECT 1', rowsAsArray: true })) as unknown as [string[][]]
    assert.equal(one[0]?.[0], '-> Rows fetched before execution\n')
    for (const sql of ['EXPLAIN SELECT 1', 'EXPLAIN FORMAT=JSON SELECT 1', 'EXPLAIN ANALYZE SELECT 1', 'EXPLAIN FORMAT=TREE INSERT INTO a VALUES (1, 1)']) {
      await assert.rejects(conn.query(sql), (e: { errno?: number }) => e.errno === 1235, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
