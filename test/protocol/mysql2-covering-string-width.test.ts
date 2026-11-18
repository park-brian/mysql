import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('covering string lookups retain equality for different declared widths', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    rowsAsArray: true,
  })
  const schema = 'covering_string_width'
  try {
    await conn.query(`CREATE DATABASE ${schema} COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    for (const type of ['CHAR', 'VARCHAR', 'VARBINARY']) {
      for (const width of [8, 12, 14]) {
        await conn.query('DROP TABLE IF EXISTS outer_key, inner_key')
        await conn.query(`CREATE TABLE outer_key(id INT PRIMARY KEY, k ${type}(${width})) STATS_AUTO_RECALC=0`)
        await conn.query(`CREATE TABLE inner_key(id INT PRIMARY KEY, k ${type}(12) NOT NULL, v INT, UNIQUE KEY by_k(k)) STATS_AUTO_RECALC=0`)
        await conn.query("INSERT INTO outer_key VALUES (1,'A'),(2,'ä'),(3,'ki '),(4,NULL),(5,'missing')")
        await conn.query("INSERT INTO inner_key VALUES (7,'a',70),(8,'ki',80),(9,'Z',90)")
        await conn.query('ANALYZE TABLE outer_key,inner_key')
        const sql = 'SELECT o.id,i.id FROM outer_key o LEFT JOIN inner_key i ON o.k=i.k ORDER BY o.id'
        const explain = 'EXPLAIN FORMAT=TREE ' + sql
        const match = type === 'VARBINARY' ? null : 7
        const expected = [[1, match], [2, match], [3, type === 'CHAR' ? 8 : null], [4, null], [5, null]]
        for (const method of ['query', 'execute'] as const) {
          const [planRows] = method === 'query' ? await conn.query(explain) : await conn.execute(explain)
          const plan = String((planRows as string[][])[0]?.[0])
          assert.match(plan, /Single-row covering index lookup on i using by_k/)
          assert.equal(/Filter[^\n]*\n\s+-> Single-row covering index lookup/.test(plan), width !== 12, `${type}(${width}) ${method}`)
          const [rows] = method === 'query' ? await conn.query(sql) : await conn.execute(sql)
          assert.deepEqual(rows, expected, `${type}(${width}) ${method}`)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        }
      }
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
