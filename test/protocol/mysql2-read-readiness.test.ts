import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { setImmediate as turn } from 'node:timers/promises'
import { createStream } from '../../packages/core/src/host/node.ts'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import reference from './fixtures/diagnostics/read-readiness.json' with { type: 'json' }

test('ordinary base reader construction permits headers before first-read and projection failures', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  await conn.connect()
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, 524)
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE readiness153')
    await conn.query('USE readiness153')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY)')
    await conn.query('CREATE TABLE b(n INT)')
    await conn.query('INSERT INTO b VALUES(1),(2)')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    await conn.query('CREATE VIEW base AS SELECT id FROM a')
    let fulltext = false
    let size = 0
    for (const entry of reference.observations) {
      const { sql, api } = entry
      if ('fulltext' in entry && !fulltext) {
        await conn.query('ALTER TABLE a ADD COLUMN t TEXT, ADD FULLTEXT INDEX ft(t)')
        await conn.query('CREATE TABLE needles(t TEXT)')
        await conn.query("INSERT INTO needles VALUES('+'),('-')")
        await conn.query("SET @needle='+'")
        fulltext = true
      }
      if (entry.size !== size) {
        await conn.query('TRUNCATE TABLE a')
        if (entry.size > 0) await conn.query('INSERT INTO a(id) VALUES' + Array.from({ length: entry.size }, (_, i) => '(' + (i + 1) + ')').join(','))
        if (fulltext) await conn.query("UPDATE a SET t='apple banana'")
        size = entry.size
      }
      const observed = await observeCommand(raw, conn, transport, entry)
      const expected = reference.outcomes[entry.outcome]!
      if (api === 'prepare' && observed.outcome.error === null) assert.equal(observed.prepareWarnings, expected.warningCount & 0xffff, sql + ': PREPARE warning count')
      assert.deepEqual(canonical(observed.outcome), {
        ...expected,
        prior: expected.prior.map((i) => reference.warnings[i]),
        fields: expected.fields?.map((i) => reference.fields[i]) ?? null,
        warnings: expected.warnings.map((i) => reference.warnings[i]),
      }, `${api}: size=${size}: ${sql}`)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS readiness153')
    await conn.end()
    await db?.end()
  }
})

test('metadata-only readiness preserves backpressure and cancellation before row delivery', { timeout: 10000 }, async () => {
  const db = await MySQL.open(':memory:')
  let raw: mysql.Connection | undefined
  try {
    await db.query('CREATE DATABASE readiness153_slow')
    await db.query('CREATE TABLE readiness153_slow.a(id INT PRIMARY KEY)')
    await db.query('INSERT INTO readiness153_slow.a VALUES' + Array.from({ length: 1024 }, (_, i) => '(' + i + ')').join(','))
    const store = db.catalog!.store
    const views = store.transactions.stats().openViews
    const open = db.catalog!.table.bind(db.catalog)
    let read = 0
    let closed = 0
    db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'readiness153_slow' && name === 'a') {
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
    // Stop draining after authentication. The large metadata head alone exceeds
    // the connection's high-water mark, before its empty readiness batch drains.
    let notifications = 0
    protocol.onOutput(() => { notifications++ })
    const count = 2000
    const sql = 'SELECT ' + Array.from({ length: count }, (_, i) => 'id AS c' + i).join(',') + ' FROM readiness153_slow.a'
    const command = raw.query(sql)
    command.on('error', () => {})
    for (let i = 0; i < 2000 && notifications < count + 2; i++) await turn()
    assert.ok(notifications >= count + 2, 'the complete metadata head is queued')
    await turn()
    assert.equal(read, 256, 'only the first row batch was evaluated')
    assert.equal(closed, 0, 'the suspended reader is still open')
    assert.equal(store.transactions.stats().openViews, views + 1)
    protocol.close()
    raw.destroy()
    for (let i = 0; i < 200 && closed === 0; i++) await turn()
    assert.equal(closed, 1, 'cancellation closes the physical iterator once')
    assert.equal(read, 256, 'cancellation reads no additional batch')
    assert.equal(store.transactions.stats().openViews, views, 'cancellation releases the read view')
    db.catalog!.table = open
    await db.query('INSERT INTO readiness153_slow.a VALUES(1024)')
  } finally {
    raw?.destroy()
    await db.end()
  }
})
