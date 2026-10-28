import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'

for (const multipleStatements of [false, true]) test('BINARY declaration warnings belong to each supported command, not cached compilation: ' + multipleStatements, async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:', { multipleStatements }) : undefined
  const connections = []
  try {
    for (let i = 0; i < 2; i++) {
      const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
      const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), multipleStatements })
      const conn = raw.promise()
      await conn.connect()
      await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
      connections.push({ transport, raw, conn })
    }
    if (host !== undefined) assert.equal(String((await connections[0]!.conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    for (const limit of [0, 1, 2]) for (const api of ['query', 'execute', 'prepare']) for (let repeat = 0; repeat < 2; repeat++) for (const { transport, raw, conn } of connections) {
      await conn.query('SET max_error_count=?', [limit])
      for (const [sql, declarations, fails] of [
        ["SELECT CAST('x' AS CHAR BINARY) AS v GROUP BY 1 HAVING v='x'", 1, false],
        ["SELECT CAST('x' AS CHAR BINARY),CAST('y' AS CHAR BINARY)", 2, false],
        ["SELECT CAST('x' AS CHAR BINARY),CAST('y' AS CHAR BINARY),RANDOM_BYTES(0)", 2, true],
      ] as const) {
        const views = db?.catalog!.store.transactions.stats().openViews
        const { outcome } = await observeCommand(raw, conn, transport, { sql, api, retain: api === 'execute' })
        const grammar = api === 'execute' ? 0 : Math.min(limit, declarations)
        const error = fails && api !== 'prepare'
        assert.equal(outcome.warningCount, grammar + Number(error), sql + ': ' + api)
        assert.equal(outcome.errorCount, Number(error), 'runtime error counts remain complete beyond the retained prefix')
        assert.equal(outcome.error === null, !error)
        if (error) assert.equal((outcome.error as unknown[])[1], 1690)
        assert.deepEqual((outcome.warnings as mysql.RowDataPacket[]).map(c => [c.Level, c.Code]), [
          ...Array.from({ length: grammar }, () => ['Warning', 1287]),
          ...(error ? [['Error', 1690]] : []),
        ].slice(0, limit))
        if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views)
      }
    }
  } finally {
    for (const { conn } of connections) await conn.end()
    await db?.end()
  }
})
