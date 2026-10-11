// Literal payloads survive optimizer/HAVING rewrites, as on MySQL 8.4.11.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('literal payloads survive optimizer and HAVING condition rewrites', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS literal_rewrite')
    await conn.query('USE literal_rewrite')
    await conn.query('DROP TABLE IF EXISTS t')
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, flag INT)')
    await conn.query('INSERT INTO t VALUES (0,10),(1,20),(-1,30)')
    const cases: readonly (readonly [string, unknown[][]])[] = [
      ["SELECT DISTINCT flag FROM t WHERE id = X'' ORDER BY 1", [[10]]],
      ["SELECT DISTINCT flag FROM t WHERE id = X'00' ORDER BY 1", [[10]]],
      ["SELECT DISTINCT flag FROM t WHERE id = X'01' ORDER BY 1", [[20]]],
      ["SELECT DISTINCT flag FROM t WHERE id = X'00FF' ORDER BY 1", []],
      ["SELECT DISTINCT flag FROM t WHERE id <> X'' ORDER BY 1", [[20], [30]]],
      ["SELECT id AS n FROM t HAVING n = X'' ORDER BY n", [[0]]],
      ["SELECT HEX(X'80009F') AS h HAVING h = HEX(X'80009F')", [['80009F']]],
      ["SELECT HEX(b'10000000') AS h HAVING h = HEX(b'10000000')", [['80']]],
    ]
    for (const [sql, expected] of cases) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, `${method}: ${sql}`)
        const [warnings] = await conn.query('SHOW WARNINGS')
        assert.deepEqual(warnings, [], `${method}: ${sql}`)
      }
    }
  } finally {
    await conn.query('DROP DATABASE literal_rewrite')
    await conn.end()
    await db?.end()
  }
})
