import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2/promise'
import type { QueryError, RowDataPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import rows from './fixtures/diagnostics/current-area-rows.json' with { type: 'json' }
import correlated from './fixtures/diagnostics/current-area-correlated.json' with { type: 'json' }

interface Observation {
  readonly limit: number
  readonly seed: string
  readonly sql: string
  readonly api: string
  readonly rows?: unknown
  readonly fields?: unknown
  readonly error?: unknown
  readonly warnings: unknown
  readonly warningCount: string
  readonly errorCount: string
}
interface Fixture {
  readonly mysqlVersion: string
  readonly schema: string
  readonly setup: readonly string[]
  readonly seeds: Readonly<Record<string, string>>
  readonly observations: readonly Observation[]
}
async function connection() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const c = await mysql.createConnection({
    stream: db ? db.createStream() : connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }),
    user: 'root', ...(db ? {} : { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }), rowsAsArray: true,
  })
  if (!db) assert.equal(String((await c.query<RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], '8.4.11')
  return { c, db }
}

for (const fixture of [rows, correlated] as readonly Fixture[]) test('M5.10: current diagnostic area and item cache match native: ' + fixture.schema, async () => {
  const { c, db } = await connection()
  let created = false
  try {
    assert.equal(fixture.mysqlVersion, '8.4.11')
    await c.query('CREATE DATABASE ' + fixture.schema)
    created = true
    await c.query('USE ' + fixture.schema)
    for (const sql of fixture.setup) await c.query(sql)
    for (const expected of fixture.observations) {
      const { sql, api, seed, limit } = expected
      const label = `${sql} [${api}, ${seed}, limit ${limit}]`
      c.unprepare(sql)
      await c.query('SET max_error_count=?', [limit])
      await c.query(fixture.seeds[seed]!)
      let actual: unknown
      try {
        const [values, fields] = api === 'query' ? await c.query(sql) : await c.execute(sql)
        actual = { rows: values, fields: fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]) }
      } catch (e) {
        const error = e as QueryError & { sqlMessage?: string }
        actual = { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage } }
      }
      assert.deepEqual(actual, expected.error === undefined ? { rows: expected.rows, fields: expected.fields } : { error: expected.error }, label)
      assert.deepEqual((await c.query('SHOW WARNINGS'))[0], expected.warnings, label)
      assert.equal(String((await c.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]![0]), expected.warningCount, label)
      assert.equal(String((await c.query<RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]![0]), expected.errorCount, label)
      c.unprepare(sql)
    }
  } finally {
    if (created) await c.query('DROP DATABASE ' + fixture.schema)
    await c.end()
    await db?.end()
  }
})

test('M5.10: diagnostic area selection, completion and prepared reuse keep their lifetimes', async () => {
  const { c, db } = await connection()
  const carrier = "WITH c AS(SELECT CAST('x' AS CHAR CHARSET utf8)) "
  try {
    await c.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    for (const limit of [0, 8]) {
      await c.query('SET max_error_count=?', [limit])
      await c.query("SELECT 1/0,CAST('x' AS DECIMAL)")
      assert.deepEqual((await c.query('SELECT @@warning_count,@@error_count'))[0], [[2, 0]], 'ordinary reads use the prior snapshot')
      assert.deepEqual((await c.query('SHOW WARNINGS'))[0], [], 'ordinary reads clear diagnostics')
      await c.query("SELECT 1/0,CAST('x' AS DECIMAL)")
      const sql = carrier + 'SELECT @@warning_count,@@error_count'
      c.unprepare(sql)
      const prepared = await c.prepare(sql)
      try {
        assert.equal(Number((await c.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]![0]), Math.min(limit, 1), 'prepare construction prefix')
        for (let i = 0; i < 2; i++) {
          assert.deepEqual((await prepared.execute([]))[0], [[0, 0]], 'each execute has a fresh current area and item cache')
          assert.deepEqual((await c.query('SHOW WARNINGS'))[0], [])
        }
      } finally { await prepared.close(); c.unprepare(sql) }
      await assert.rejects(c.query(carrier + 'SELECT LENGTH()'), { errno: 1582 })
      assert.deepEqual((await c.query('SELECT @@warning_count,@@error_count'))[0], limit === 0 ? [[0, 0]] : [[2, 1]], 'failure retires the live view to the bounded snapshot')
      assert.deepEqual((await c.query('SHOW WARNINGS'))[0], [])
    }
  } finally { await c.end(); await db?.end() }
})
