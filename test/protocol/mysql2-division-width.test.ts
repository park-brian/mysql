import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/functions/division-width.json' with { type: 'json' }

test('integer DIV fields retain a minimum width across NULL, hex and typed operands', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  const fieldsOnly = new Set(reference.fieldsOnly)
  assert.equal(reference.observations.length, 1578)
  assert.equal(strict.size, 1232)
  assert.equal(fieldsOnly.size, 4)
  let compared = 0
  let comparedFields = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    for (const [i, entry] of reference.observations.entries()) {
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      const expected = reference.outcomes[entry.outcome]!
      if (fieldsOnly.has(i)) {
        comparedFields++
        assert.deepEqual(observed.outcome.fields, expected.fields?.map(j => reference.fields[j]) ?? null, entry.api + ': ' + entry.sql)
      }
      // Retain open diagnostics, copied-field and parameter outcomes; native checks every capture.
      if (db === undefined || strict.has(i)) {
        compared++
        assert.deepEqual(observed.outcome, {
          ...expected,
          fields: expected.fields?.map(j => reference.fields[j]) ?? null,
          prior: expected.prior.map(j => reference.warnings[j]),
          warnings: expected.warnings.map(j => reference.warnings[j]),
        }, entry.api + ': ' + entry.sql)
        if (entry.api === 'prepare') assert.equal(observed.prepareWarnings, entry.prepareWarnings, entry.sql)
      }
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': read view released')
    }
    assert.equal(compared, db === undefined ? reference.observations.length : strict.size)
    assert.equal(comparedFields, fieldsOnly.size)
  } finally {
    await conn.end()
    await db?.end()
  }
})
