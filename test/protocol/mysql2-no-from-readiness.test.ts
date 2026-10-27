import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/functions/no-from-readiness.json' with { type: 'json' }
import open from './fixtures/functions/no-from-readiness-open.json' with { type: 'json' }

test('an ordinary no-FROM source publishes metadata before projection failures', async () => {
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
    assert.equal(reference.observations.length, 735)
    for (const entry of reference.observations) {
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      const expected = reference.outcomes[entry.outcome]!
      assert.deepEqual(observed.outcome, {
        ...expected,
        fields: expected.fields?.map(i => reference.fields[i]) ?? null,
        prior: expected.prior.map(i => reference.warnings[i]),
        warnings: expected.warnings.map(i => reference.warnings[i]),
      }, entry.api + ': ' + entry.sql)
      if (entry.api === 'prepare') assert.equal(observed.prepareWarnings, entry.prepareWarnings, entry.sql)
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': read view released')
    }
    // Unused WINDOW validation remains open. Its missing declaration error must
    // not let a later projection failure borrow the unit source's readiness.
    const early = new Set(['signed', 'unsigned', 'cast_float', 'json_cast', 'json_path', 'regex', 'scalar'])
    const declarations = open.observations.filter(entry => entry.api !== 'prepare' && early.has(entry.group.split(':')[0]!) && /:(bad_window|unused_window)$/.test(entry.group))
    assert.equal(declarations.length, 28)
    for (const entry of declarations) {
      const observed = await observeCommand(raw, conn, transport, entry)
      assert.equal(entry.outcome.fields, null, entry.sql + ': native declaration failure precedes metadata')
      assert.equal(observed.outcome.fields, entry.outcome.fields, entry.sql + ': no premature metadata')
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
