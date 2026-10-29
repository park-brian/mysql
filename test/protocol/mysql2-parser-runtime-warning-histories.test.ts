import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import reference from './fixtures/diagnostics/parser-runtime-warning-histories.json' with { type: 'json' }

test('runtime-owned parser warnings precede construction failures without executing assignments', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  let created = false
  try {
    await conn.connect()
    if (db === undefined) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() v'))[0][0]!.v, reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE t(v INT)')
    await conn.query('INSERT INTO t VALUES(1)')
    await conn.query('CREATE TABLE empty_t LIKE t')
    assert.equal(reference.observations.length, 558)
    for (const [sqlIndex, apiIndex, limitIndex, outcomeIndex] of reference.observations) {
      const sql = reference.sql[sqlIndex!]!
      const api = reference.apis[apiIndex!]!
      const limit = reference.limits[limitIndex!]!
      const params = sql.includes('?') ? [1] : []
      const expected = reference.outcomes[outcomeIndex!]!
      const label = sql + ' [' + api + ', cap ' + limit + ']'
      await conn.query('SET max_error_count=' + limit)
      await conn.query('SET @x=9,@y=9')
      const views = db?.catalog!.store.transactions.stats().openViews
      const fieldEvents: unknown[] = []
      let result: Record<string, unknown>
      try {
        if (api === 'prepare') {
          const statement = await conn.prepare(sql)
          await statement.close()
        } else {
          await new Promise<void>((resolve, reject) => {
            const callback = (error: mysql.QueryError | null): void => { if (error) reject(error); else resolve() }
            const command = api === 'execute' ? raw.execute(sql, params, callback) : raw.query({ sql, rowsAsArray: true }, params, callback)
            command.on('fields', fields => fieldEvents.push(fields))
          })
        }
        assert.fail('expected parser construction failure: ' + label)
      } catch (error) {
        const e = error as mysql.QueryError & { sqlMessage?: string }
        result = { error: { code: e.code, errno: e.errno, state: e.sqlState, message: e.sqlMessage }, ...(api === 'prepare' ? {} : { fieldEvents }) }
      }
      assert.equal(db?.catalog!.store.transactions.stats().openViews, views, 'failed construction opens no view: ' + label)
      const warnings = (await conn.query('SHOW WARNINGS'))[0]
      const warningCount = Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0]
      const errorCount = Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0]
      const state = (await conn.query('SELECT @x AS v,@y AS y'))[0]
      assert.deepEqual({ params, ...result, warnings, warningCount, errorCount, state }, expected, label)
    }
    assert.deepEqual((await conn.query('SELECT v FROM t'))[0], [{ v: 1 }], 'failed DML leaves the source unchanged')
  } finally {
    try { if (created) await conn.query('DROP DATABASE ' + reference.schema) }
    finally { await conn.end(); await db?.end() }
  }
})
