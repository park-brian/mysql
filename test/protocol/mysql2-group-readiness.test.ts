import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { setImmediate as turn } from 'node:timers/promises'
import { createStream } from '../../packages/core/src/host/node.ts'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
// @ts-expect-error — the reference capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'
import reference from './fixtures/aggregates/avg-distinct-readiness.json' with { type: 'json' }
import distinctReference from './fixtures/aggregates/distinct-avg-fields.json' with { type: 'json' }

for (const profile of [
  { reference, database: 'avg157phase', count: 288, title: 'retained DISTINCT finishes computed AVG fields after headers and before returning rows' },
  { reference: distinctReference, database: 'avg162', count: 462, title: 'retained DISTINCT copies completed DISTINCT AVG fields before projection' },
]) test(profile.title, async () => {
  const reference = profile.reference
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  await conn.connect()
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, profile.count)
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + profile.database)
    await conn.query('USE ' + profile.database)
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,g INT,n INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    const fixedRows: Readonly<Record<number, string>> = {
      7: '(1,0,0),(2,1,1),(3,0,0),(4,1,0),(5,0,0),(6,1,0),(7,0,NULL)',
      8: '(1,0,0),(2,0,1),(3,0,1),(4,0,3),(5,1,0),(6,1,2),(7,1,3),(8,1,3)',
    }
    let size = 0
    for (const entry of reference.observations) {
      if (entry.size !== size) {
        await conn.query('TRUNCATE TABLE a')
        if (entry.size > 0) await conn.query('INSERT INTO a VALUES' + (fixedRows[entry.size] ?? Array.from({ length: entry.size }, (_, i) => '(' + (i + 1) + ',' + i + ',' + i + ')').join(',')))
        size = entry.size
        await conn.query('ANALYZE TABLE a')
      }
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, entry)
      const expected = reference.outcomes[entry.outcome]!
      if (entry.api === 'prepare' && observed.outcome.error === null) assert.equal(observed.prepareWarnings, expected.warningCount & 0xffff, entry.sql + ': PREPARE warning count')
      const plan = entry.api === 'prepare' ? null : planSkeleton((await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + entry.sql))[0][0]?.EXPLAIN)
      assert.deepEqual(canonical({ ...observed.outcome, plan }), {
        ...expected,
        prior: expected.prior.map((i) => reference.warnings[i]),
        fields: expected.fields?.map((i) => reference.fields[i]) ?? null,
        warnings: expected.warnings.map((i) => reference.warnings[i]),
      }, `${entry.api}: size=${size}: ${entry.sql}`)
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, entry.sql + ': read view released')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + profile.database)
    await conn.end()
    await db?.end()
  }
})


for (const average of ['AVG(n)', 'AVG(DISTINCT n)']) test('grouped final-field fill releases its reader before buffered delivery and cancellation: ' + average, { timeout: 15000 }, async () => {
  const db = await MySQL.open(':memory:')
  let raw: mysql.Connection | undefined
  try {
    await db.query('CREATE DATABASE avg161_lifetime')
    await db.query('CREATE TABLE avg161_lifetime.a(id INT PRIMARY KEY,g INT,n INT)')
    await db.query('INSERT INTO avg161_lifetime.a VALUES' + Array.from({ length: 1024 }, (_, i) => '(' + i + ',' + (i % 64) + ',' + i + ')').join(','))
    const store = db.catalog!.store
    const views = store.transactions.stats().openViews
    const open = db.catalog!.table.bind(db.catalog)
    let read = 0
    let closed = 0
    db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'avg161_lifetime' && name === 'a') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          try {
            for (const row of scan(range, transaction, mode)) {
              if (transaction !== undefined) read++
              yield row
            }
          } finally { if (transaction !== undefined) closed++ }
        }
      }
      return table
    }
    const protocol = db.createConnection()
    raw = mysql.createConnection({ stream: createStream(protocol), user: 'root' })
    await raw.promise().connect()
    let notifications = 0
    protocol.onOutput(() => { notifications++ })
    const columns = 2000
    const command = raw.query('SELECT DISTINCT ' + Array.from({ length: columns }, (_, i) => 'ROUND(' + average + ',0) AS c' + i).join(',') + ' FROM avg161_lifetime.a GROUP BY g')
    command.on('error', () => {})
    // Stop draining after authentication: metadata alone fills the output queue.
    for (let i = 0; i < 2000 && notifications < columns + 2; i++) await turn()
    assert.ok(notifications >= columns + 2, 'the metadata head is queued')
    assert.equal(read, 1024, 'the grouped writer finishes its input before delivery')
    assert.equal(closed, 1, 'the physical iterator closes once')
    assert.equal(store.transactions.stats().openViews, views)
    protocol.close()
    raw.destroy()
    await turn()
    assert.equal(read, 1024, 'cancellation reads no further input')
    assert.equal(closed, 1)
    assert.equal(store.transactions.stats().openViews, views)
    db.catalog!.table = open
    await db.query('INSERT INTO avg161_lifetime.a VALUES(1024,0,1024)')
  } finally {
    raw?.destroy()
    await db.end()
  }
})
