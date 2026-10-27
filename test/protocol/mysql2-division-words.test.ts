import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/functions/division-words.json' with { type: 'json' }

test('exact division retains both operands fractional words across numeric readers', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    assert.equal(reference.observations.length, 1064)
    for (const entry of reference.observations) {
      const expected = reference.outcomes[entry.outcome]!
      const observed = await observeCommand(raw, conn, transport, entry)
      assert.deepEqual(observed.outcome, {
        ...expected,
        fields: expected.fields?.map(i => reference.fields[i]) ?? null,
        prior: expected.prior.map(i => reference.warnings[i]),
        warnings: expected.warnings.map(i => reference.warnings[i]),
      }, entry.api + ': ' + entry.sql)
      if (entry.api === 'prepare') assert.equal(observed.prepareWarnings, entry.prepareWarnings, entry.sql)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
