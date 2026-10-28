import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { webCryptoRandom } from '@myjs/protocol'

test('RANDOM_BYTES reads fresh secure bytes per row and execution, after validating length', async (t) => {
  const db = await MySQL.open(':memory:')
  const conn = mysql.createConnection({ stream: db.createStream(), user: 'root' }).promise()
  try {
    await conn.connect()
    await conn.query('CREATE DATABASE random_bytes_unit')
    await conn.query('CREATE TABLE random_bytes_unit.t(id INT PRIMARY KEY)')
    await conn.query('INSERT INTO random_bytes_unit.t VALUES(1),(2)')
    let calls = 0
    t.mock.method(webCryptoRandom, 'getRandomValues', (into: Uint8Array) => {
      into.fill(++calls)
      return into
    })
    for (const api of ['query', 'execute'] as const) {
      const run = (sql: string, params: mysql.ExecuteValues[] = []) => api === 'query'
        ? conn.query<mysql.RowDataPacket[]>(sql, params)
        : conn.execute<mysql.RowDataPacket[]>(sql, params)
      for (let repeat = 0; repeat < 2; repeat++) {
        const before = calls
        const [rows] = await run('SELECT RANDOM_BYTES(2) AS v FROM random_bytes_unit.t ORDER BY id')
        assert.deepEqual(rows.map(row => Array.from(row.v as Uint8Array)), [[before + 1, before + 1], [before + 2, before + 2]])
        assert.equal(calls, before + 2, 'PREPARE and metadata do not consume randomness')
      }
      const before = calls
      assert.equal((await run('SELECT RANDOM_BYTES(NULL) AS v'))[0][0]!.v, null)
      for (const length of [0, 1025]) await assert.rejects(run('SELECT RANDOM_BYTES(' + length + ')'), (error: unknown) => error instanceof Error && 'errno' in error && error.errno === 1690)
      assert.equal(calls, before, 'NULL and refused lengths never call the random source')
      const [bound] = await run('SELECT RANDOM_BYTES(?) AS v', [3])
      assert.deepEqual(Array.from(bound[0]!.v as Uint8Array), [before + 1, before + 1, before + 1])
      assert.equal(calls, before + 1)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
