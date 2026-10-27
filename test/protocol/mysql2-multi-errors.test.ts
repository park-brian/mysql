import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import runtimeErrors from './fixtures/diagnostics/multi-errors.json' with { type: 'json' }
import parsingErrors from './fixtures/diagnostics/multi-parsing.json' with { type: 'json' }

const matrices = [
  { reference: runtimeErrors, total: 392, strictCount: 160, defaultCount: 70, commonCount: 90, states: 178, excluded: ['declaration'] },
  { reference: parsingErrors, total: 236, strictCount: 142, defaultCount: 66, commonCount: 76, states: 94, excluded: ['lexical', 'declaration'] },
]
for (const { reference, total, strictCount, defaultCount, commonCount, states: expectedStates, excluded } of matrices)
for (const profile of ['default', 'common']) test('completed statements precede a multi-statement failure: ' + reference.schema + ' ' + profile, async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:', { multipleStatements: true }) : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true, multipleStatements: true, ...(profile === 'common' ? { flags: ['-SESSION_TRACK'] } : {}) })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  assert.equal(reference.observations.length, total)
  assert.equal(strict.size, strictCount)
  let created = false
  let compared = 0
  let states = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE t(v INT)')
    for (const [i, entry] of reference.observations.entries()) {
      if (entry.profile !== profile) continue
      await conn.query('ROLLBACK')
      await conn.query('SET autocommit=1')
      await conn.query('SET sql_mode=?', [entry.mode])
      await conn.query('TRUNCATE TABLE t')
      await conn.query('INSERT INTO t VALUES(1),(2)')
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry, true)
      const after = (await conn.query({ sql: 'SELECT * FROM t', rowsAsArray: true }))[0]
      // Preserve all open negotiation, failed-fragment and parser outcomes.
      // The pinned native server replays every complete outcome and wire payload.
      if (db === undefined || strict.has(i)) {
        compared++
        const expected = reference.outcomes[entry.outcome]!
        assert.deepEqual(observed.outcome, {
          ...expected,
          fields: expected.fields?.map(j => reference.fields[j]) ?? null,
          prior: expected.prior.map(j => reference.warnings[j]),
          warnings: expected.warnings.map(j => reference.warnings[j]),
        }, entry.sql)
        assert.deepEqual(observed.wire, entry.wire.map(j => reference.wirePackets[j]), entry.sql + ': complete wire payloads')
        assert.deepEqual(after, entry.after, entry.sql + ': completed effects')
      }
      if (!excluded.includes(entry.group)) {
        states++
        assert.deepEqual(after, entry.after, entry.sql + ': earlier writes survive and later writes stop')
      }
      await conn.query('ROLLBACK')
      await conn.query('SET autocommit=1')
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': readers released')
    }
    assert.equal(compared, db === undefined ? total / 2 : profile === 'default' ? defaultCount : commonCount)
    assert.equal(states, expectedStates)
  } finally {
    await conn.query('ROLLBACK')
    await conn.query('SET autocommit=1')
    if (created) await conn.query('DROP DATABASE ' + reference.schema)
    await conn.end()
    await db?.end()
  }
})
