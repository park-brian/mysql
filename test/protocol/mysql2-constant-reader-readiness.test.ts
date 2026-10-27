import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import literals from './fixtures/diagnostics/constant-reader-readiness.json' with { type: 'json' }
import controls from './fixtures/diagnostics/constant-reader-controls.json' with { type: 'json' }

for (const reference of [literals, controls]) test(reference.schema + ': constant source readiness follows materialization', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  const control = reference === controls
  const table = control ? 'r' : 't'
  assert.equal(reference.observations.length, control ? 318 : 246)
  assert.equal(strict.size, control ? 157 : 146)
  let created = false
  let compared = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE ' + table + '(v INT)')
    if (control) await conn.query('CREATE VIEW v AS SELECT 1 AS n')
    for (const [i, entry] of reference.observations.entries()) {
      await conn.query('SET sql_mode=?', [entry.mode])
      await conn.query('TRUNCATE TABLE ' + table)
      await conn.query('INSERT INTO ' + table + ' VALUES(1),(2)')
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      const expected = reference.outcomes[entry.outcome]!
      const outcome = {
        ...expected,
        fields: expected.fields?.map(j => reference.fields[j]) ?? null,
        prior: expected.prior.map(j => reference.warnings[j]),
        warnings: expected.warnings.map(j => reference.warnings[j]),
      }
      // Open mismatches still retain every component that already agreed with native.
      for (const key of reference.preserved[entry.preserved]! as (keyof typeof outcome)[]) {
        assert.deepEqual(observed.outcome[key], outcome[key], entry.sql + ': preserved ' + key)
      }
      if (db === undefined || strict.has(i)) {
        compared++
        assert.deepEqual(observed.outcome, outcome, entry.sql + ' [' + entry.api + ']')
        assert.equal(observed.prepareWarnings, entry.prepareWarnings, entry.sql + ': PREPARE warning count')
      }
      const after = (await conn.query({ sql: 'SELECT * FROM ' + table, rowsAsArray: true }))[0]
      assert.deepEqual(after, entry.after, entry.sql + ': completed effects')
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': readers released')
    }
    assert.equal(compared, db === undefined ? reference.observations.length : strict.size)
  } finally {
    if (created) await conn.query('DROP DATABASE ' + reference.schema)
    await conn.end()
    await db?.end()
  }
})
