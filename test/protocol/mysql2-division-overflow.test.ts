import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/functions/division-overflow.json' with { type: 'json' }

test('DIV quotient conversion preserves warnings, strict error history and full counters', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  assert.equal(reference.observations.length, 1917)
  assert.equal(strict.size, 1805)
  let compared = 0
  let created = false
  let mode: string | undefined
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE t(v VARCHAR(512))')
    await conn.query('CREATE TABLE r(id INT PRIMARY KEY,v BIGINT)')
    await conn.query('INSERT INTO r VALUES' + Array.from({ length: 4096 }, (_, i) => '(' + (i + 1) + ',' + (i === 4095 ? '9223372036854775807' : '1') + ')').join(','))
    for (const [i, entry] of reference.observations.entries()) {
      if (mode !== entry.mode) {
        await conn.query('SET sql_mode=?', [entry.mode])
        mode = entry.mode
      }
      if ('reset' in entry && entry.reset) {
        await conn.query('TRUNCATE TABLE t')
        await conn.query("INSERT INTO t VALUES('0')")
      }
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      // Retain every open spelling/control outcome; native replay checks the full script.
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
    if (created) await conn.query('DROP DATABASE ' + reference.schema)
    await conn.end()
    await db?.end()
  }
})
