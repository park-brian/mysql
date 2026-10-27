import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/functions/numeric-cast-print.json' with { type: 'json' }
import inventory from './fixtures/functions/view-aggregate-inventory.json' with { type: 'json' }

function rowsFromCapture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rowsFromCapture)
  if (value !== null && typeof value === 'object' && 'type' in value && value.type === 'Buffer' && 'data' in value && Array.isArray(value.data)) return Buffer.from(value.data)
  return value
}

for (const profile of [
  { reference, count: 531, title: 'numeric CAST printing shares native diagnostics and table/view formatting' },
  { reference: inventory, count: 126, title: 'view writability uses every aggregate family without pruning nested expressions' },
]) test(profile.title, async () => {
  const fixture = profile.reference
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  let created = false
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], fixture.mysqlVersion)
    await conn.query('CREATE DATABASE ' + fixture.schema)
    created = true
    await conn.query('USE ' + fixture.schema)
    if (fixture.schema === inventory.schema) {
      await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
      await conn.query('CREATE TABLE t(a INT,b INT)')
      await conn.query('INSERT INTO t VALUES(1,2),(3,4)')
    }
    const strict = new Set(fixture.strict)
    assert.equal(strict.size, profile.count)
    let view: string | undefined
    let compared = 0
    for (const [i, entry] of fixture.observations.entries()) {
      if ('definition' in entry && entry.view !== view) {
        assert.equal(entry.createError, null)
        await conn.query('CREATE VIEW ' + entry.view + ' AS ' + entry.definition)
        view = entry.view
      }
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      // Keep the full script, including DDL needed by later observations.
      // Every open native outcome remains recorded; reference replays check all of them.
      if (db === undefined || strict.has(i)) {
        compared++
        const expected = fixture.outcomes[entry.outcome]!
        assert.deepEqual(observed.outcome, {
          ...expected,
          rows: 'group' in entry && entry.group.startsWith('unhex:') ? rowsFromCapture(expected.rows) : expected.rows,
          fields: expected.fields?.map(j => fixture.fields[j]) ?? null,
          prior: expected.prior.map(j => fixture.warnings[j]),
          warnings: expected.warnings.map(j => fixture.warnings[j]),
        }, entry.api + ': ' + entry.sql)
        if (entry.api === 'prepare') assert.equal(observed.prepareWarnings, entry.prepareWarnings, entry.sql)
      }
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': read view released')
    }
    assert.equal(compared, db === undefined ? fixture.observations.length : profile.count)
  } finally {
    if (created) await conn.query('DROP DATABASE ' + fixture.schema)
    await conn.end()
    await db?.end()
  }
})
