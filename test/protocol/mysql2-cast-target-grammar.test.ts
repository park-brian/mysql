import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/diagnostics/cast-target-argument-grammar.json' with { type: 'json' }

test('CAST target arguments follow native grammar before resolution, metadata and effects', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  const deferred = new Set(reference.deferred.map(entry => entry.sqlIndex))
  let complete = 0
  try {
    await conn.connect()
    assert.equal(reference.mysqlVersion, '8.4.11')
    if (db === undefined) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() v'))[0][0]!.v, reference.mysqlVersion)
    assert.equal(reference.observations.length, 702)
    assert.equal(deferred.size, 25)
    for (const [sqlIndex, apiIndex, limitIndex, outcomeIndex] of reference.observations) {
      const sql = reference.sql[sqlIndex!]!
      const api = reference.apis[apiIndex!]!
      const expected = reference.outcomes[outcomeIndex!]!
      const label = api + ': ' + sql + ' [cap ' + reference.limits[limitIndex!] + ']'
      await conn.query('SET max_error_count=' + reference.limits[limitIndex!])
      await conn.query('SET @x=9')
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, { sql, api })
      const state = (await conn.query({ sql: 'SELECT @x AS v', rowsAsArray: true }))[0]
      const actual = JSON.parse(JSON.stringify({ ...observed, state })) as typeof expected
      assert.deepEqual(actual.state, expected.state, label + ': assignment effects')
      assert.equal(db?.catalog!.store.transactions.stats().openViews, views, label + ': reader lifetime')
      if (db === undefined || !deferred.has(sqlIndex!)) {
        assert.deepEqual(actual, expected, label)
        complete++
      } else {
        // Native fractional widths and precision diagnostics remain explicit deferred observations.
        for (const key of ['prior', 'insertId'] as const) {
          assert.deepEqual(actual.outcome[key], expected.outcome[key], label + ': ' + key)
        }
        if (expected.outcome.error !== null) {
          assert.ok(actual.outcome.error !== null, label + ': precision is refused')
          for (const key of ['rows', 'fields', 'packets'] as const) assert.deepEqual(actual.outcome[key], expected.outcome[key], label + ': ' + key)
        }
      }
    }
    assert.equal(complete, db === undefined ? 702 : 477)
  } finally {
    await conn.end(); await db?.end()
  }
})
