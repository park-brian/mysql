import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import boundaries from './fixtures/diagnostics/div-reader-boundaries.json' with { type: 'json' }
import nullable from './fixtures/diagnostics/div-nullable-readers.json' with { type: 'json' }
import evaluation from './fixtures/diagnostics/div-evaluation-counts.json' with { type: 'json' }

for (const reference of [boundaries, nullable, evaluation]) test('DIV ' + (reference === evaluation ? 'operand evaluation counts' : reference.nullable ? 'nullable reader evaluation' : 'integer and decimal boundaries'), async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  const counts = reference === evaluation
  assert.equal(reference.observations.length, counts ? 72 : reference.nullable ? 1182 : 1354)
  assert.equal(strict.size, counts ? 60 : reference.nullable ? 889 : 1068)
  let created = false
  let compared = 0
  let states = 0
  let headers = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE t(v BIGINT)')
    if (reference.nullable) {
      await conn.query('CREATE TABLE r(n BIGINT,u BIGINT UNSIGNED,b BIT(8),y YEAR,d DECIMAL(10,0),f DOUBLE)')
      await conn.query('INSERT INTO r VALUES(NULL,NULL,NULL,NULL,NULL,NULL)')
    }
    for (const [i, entry] of reference.observations.entries()) {
      await conn.query('SET sql_mode=?', [entry.mode ?? 'ERROR_FOR_DIVISION_BY_ZERO'])
      if (entry.reset) {
        await conn.query('TRUNCATE TABLE t')
        await conn.query('INSERT INTO t VALUES(0)')
      }
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      const expected = reference.outcomes[entry.outcome]!
      const outcome = {
        ...expected,
        fields: expected.fields?.map(j => reference.fields[j]) ?? null,
        prior: expected.prior.map(j => reference.warnings[j]),
        warnings: expected.warnings.map(j => reference.warnings[j]),
      }
      // Keep header availability even when individual column properties remain open.
      if (db === undefined || entry.header) {
        headers++
        assert.equal(observed.outcome.fields !== null, outcome.fields !== null, entry.sql + ': preserved header presence')
      }
      for (const key of reference.preserved[entry.preserved]! as (keyof typeof outcome)[]) {
        assert.deepEqual(observed.outcome[key], outcome[key], entry.sql + ': preserved ' + key)
      }
      if (db === undefined || strict.has(i)) {
        compared++
        assert.deepEqual(observed.outcome, outcome, entry.sql + ' [' + entry.api + ']')
        assert.equal(observed.prepareWarnings, entry.prepareWarnings, entry.sql + ': PREPARE warning count')
      }
      const after = (await conn.query({ sql: 'SELECT * FROM t', rowsAsArray: true }))[0]
      if (db === undefined || strict.has(i) || entry.state) {
        states++
        assert.deepEqual(after, entry.after, entry.sql + ': completed effects')
      }
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': readers released')
    }
    assert.equal(compared, db === undefined ? reference.observations.length : strict.size)
    assert.equal(states, db === undefined ? reference.observations.length : counts ? 72 : reference.nullable ? 1174 : 1346)
    assert.equal(headers, db === undefined ? reference.observations.length : counts ? 72 : reference.nullable ? 1122 : 1290)
  } finally {
    if (created) await conn.query('DROP DATABASE ' + reference.schema)
    await conn.end()
    await db?.end()
  }
})
