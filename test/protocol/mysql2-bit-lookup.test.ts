// MySQL 8.4.11: a planner's unknown constant must not become SQL NULL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('BIT literal comparisons preserve rows with and without integer indexes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS bit_lookup')
    await conn.query('USE bit_lookup')
    for (const [name, key] of [['pk', 'PRIMARY KEY'], ['secondary', 'UNIQUE KEY'], ['scan', '']] as const) {
      await conn.query(`DROP TABLE IF EXISTS ${name}`)
      await conn.query(`CREATE TABLE ${name} (id INT NOT NULL ${key})`)
      await conn.query(`INSERT INTO ${name} VALUES (-1),(0),(1),(128),(255)`)
    }
    const cases: readonly (readonly [string, number[]])[] = [
      ["id = b''", [0]], ["id = b'0'", [0]], ["id = b'1'", [1]],
      ["b'1' = id", [1]], ["id <=> b'1'", [1]], ["id = b'10000000'", [128]],
      ["id = b'11111111'", [255]], ["id = b'10'", []], ["id = -b'1'", [-1]],
      ["id IN (b'0', b'1')", [0, 1]], ["id BETWEEN b'0' AND b'1'", [0, 1]],
      ["id <> b'1'", [-1, 0, 128, 255]], ["id = b'1' AND id = 0", []],
      ["id = _binary'1'", [1]], ["id = NULL", []],
    ]
    for (const method of ['query', 'execute'] as const) {
      for (const [where, ids] of cases) {
        for (const table of ['pk', 'secondary', 'scan']) {
          const sql = `SELECT id FROM ${table} WHERE ${where} ORDER BY id`
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, ids.map((id) => [id]), `${method}: ${sql}`)
          assert.equal(fields[0]?.columnType, 3, `${method}: ${sql}`)
          const [warnings] = await conn.query('SHOW WARNINGS')
          assert.deepEqual(warnings, [], `${method}: ${sql}`)
        }
      }
      for (const table of ['pk', 'secondary', 'scan']) {
        const sql = `SELECT id FROM ${table} WHERE id = ? ORDER BY id`
        const options = { sql, rowsAsArray: true }
        const [rows] = method === 'query' ? await conn.query(options, [1]) : await conn.execute(options, [1])
        assert.deepEqual(rows, [[1]], `${method}: ${sql}`)
      }
    }
  } finally {
    await conn.query('DROP DATABASE bit_lookup')
    await conn.end()
    await db?.end()
  }
})
