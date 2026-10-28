import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'

for (const multipleStatements of [false, true]) test('M5.10: constructor diagnostics retain cached grammar provenance across sessions: ' + multipleStatements, async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:', { multipleStatements }) : undefined
  const connections = []
  let created = false
  try {
    for (let i = 0; i < 2; i++) {
      const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
      const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), multipleStatements })
      const conn = raw.promise()
      await conn.connect()
      connections.push({ transport, raw, conn })
    }
    const first = connections[0]!.conn
    if (host !== undefined) assert.equal(String((await first.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    const schema = 'constructor_lifetime207_' + Number(multipleStatements)
    await first.query('CREATE DATABASE ' + schema)
    created = true
    await first.query('CREATE TABLE ' + schema + '.r(v INT)')
    for (const { conn } of connections) {
      await conn.query('USE ' + schema)
      await conn.query("SET sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO'")
      await conn.query('SET max_error_count=1024')
    }
    const name = schema + '.' + 'x'.repeat(65)
    const expressions = ["CAST('x' AS NCHAR)", name + '()', "CAST('y' AS CHAR BINARY)"]
    for (const api of ['query', 'execute', 'prepare']) {
      for (let repeat = 0; repeat < 2; repeat++) for (const { transport, raw, conn } of connections) {
        for (const sql of ['SELECT ' + expressions.join(','), "INSERT INTO r SELECT CAST('x' AS NCHAR)+" + name + '()']) {
          const views = db?.catalog?.store.transactions.stats().openViews
          const { outcome } = await observeCommand(raw, conn, transport, { sql, api })
          assert.equal((outcome.error as unknown[])[1], 1059, sql + ': ' + api)
          const codes = (outcome.warnings as mysql.RowDataPacket[]).map(c => c.Code)
          assert.deepEqual(codes, sql.startsWith('SELECT') ? [3720, 1287, 1059] : [3720, 1059])
          assert.equal(outcome.warningCount, codes.length)
          assert.equal(outcome.errorCount, 1)
          assert.equal(outcome.fields, null)
          assert.deepEqual(outcome.packets, [0xff])
          if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views)
        }
      }
    }
    const many = 'SELECT ' + Array.from({ length: 1030 }, () => "CAST('x' AS NCHAR)").join(',') + ',' + name + '()'
    for (const api of ['query', 'execute', 'prepare']) for (const { transport, raw, conn } of connections) {
      const { outcome } = await observeCommand(raw, conn, transport, { sql: many, api })
      assert.equal((outcome.error as unknown[])[1], 1059)
      assert.equal(outcome.warningCount, 1024, 'grammar transfer copies only the kept prefix')
      assert.equal(outcome.errorCount, 0, 'the primary ERR is outside the transferred condition prefix')
      assert.equal((outcome.warnings as unknown[]).length, 1024)
      assert.ok((outcome.warnings as mysql.RowDataPacket[]).every(c => c.Level === 'Warning' && c.Code === 3720))
    }
    for (const { conn } of connections) {
      assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM r'))[0][0]!.n, 0)
      await conn.query("SELECT CAST('x' AS NCHAR)")
      assert.deepEqual((await conn.query<mysql.RowDataPacket[]>('SHOW WARNINGS'))[0].map(c => c.Code), [3720], 'successful compilation publishes its warning only once')
    }
  } finally {
    if (created) await connections[0]!.conn.query('DROP DATABASE constructor_lifetime207_' + Number(multipleStatements))
    for (const { conn } of connections) await conn.end()
    await db?.end()
  }
})

test('M5.10: constructor and grammar failures transfer the same bounded diagnostic prefix', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  try {
    await conn.connect()
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    for (const limit of [0, 1, 2, 3, 1024]) {
      await conn.query('SET max_error_count=?', [limit])
      for (const count of [0, 2, 1030]) for (const [tail, code] of [['missing_db.' + 'x'.repeat(65) + '()', 1059], ['1e400', 1367]] as const) for (const api of ['query', 'execute', 'prepare']) {
        const sql = 'SELECT ' + [...Array.from({ length: count }, () => "CAST('x' AS NCHAR)"), tail].join(',')
        const { outcome } = await observeCommand(raw, conn, transport, { sql, api })
        const kept = Math.min(limit, count + 1)
        assert.equal((outcome.error as unknown[])[1], code)
        assert.equal(outcome.warningCount, kept)
        assert.equal(outcome.errorCount, count < limit ? 1 : 0)
        assert.deepEqual((outcome.warnings as mysql.RowDataPacket[]).map(c => [c.Level, c.Code]), Array.from({ length: kept }, (_, i) => i < count ? ['Warning', 3720] : ['Error', code]))
        assert.equal(outcome.fields, null)
        assert.deepEqual(outcome.packets, [0xff])
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})

test('diagnostic retention uses the limit at statement entry across SET assignments', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  try {
    await conn.connect()
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    for (const limit of [0, 1, 2, 1024]) for (const [sql, total, after] of [
      ['SET max_error_count=-1', 1, 0],
      ['SET max_error_count=65536', 1, 65535],
      ['SET max_error_count=0,max_error_count=65536', 1, 65535],
      ['SET max_error_count=1,max_error_count=-1,max_error_count=65536', 2, 65535],
    ] as const) {
      await conn.query('SET max_error_count=?', [limit])
      const { outcome } = await observeCommand(raw, conn, transport, { sql, api: 'query' })
      assert.equal(outcome.error, null)
      assert.equal(outcome.warningCount, total)
      assert.equal(outcome.errorCount, 0)
      assert.deepEqual((outcome.warnings as mysql.RowDataPacket[]).map(c => [c.Level, c.Code]), Array.from({ length: Math.min(limit, total) }, () => ['Warning', 1292]))
      assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT @@max_error_count AS v'))[0][0]!.v, after)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
