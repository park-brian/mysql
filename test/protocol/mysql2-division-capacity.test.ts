import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/functions/division-capacity.json' with { type: 'json' }

test('exact division respects nine-word capacity, leading-word ties and zero underflow', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  assert.equal(reference.observations.length, 2043)
  assert.equal(strict.size, 2029)
  let compared = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    for (const [i, entry] of reference.observations.entries()) {
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      // Retain the open integer-DIV outcomes too; native replays check every capture.
      if (db === undefined || strict.has(i)) {
        compared++
        const expected = reference.outcomes[entry.outcome]!
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
  } finally {
    await conn.end()
    await db?.end()
  }
})
