import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
// @ts-expect-error — the reference capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'
import reference from './fixtures/aggregates/group-slot-readers.json' with { type: 'json' }

test('repeated aggregate slots preserve independent fields, ordering and DISTINCT elimination', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  await conn.connect()
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, 240)
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE slots160')
    await conn.query('USE slots160')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,g INT,n INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    let size = 0
    for (const entry of reference.observations) {
      if (entry.size !== size) {
        await conn.query('TRUNCATE TABLE a')
        assert.equal(entry.size, 7)
        await conn.query('INSERT INTO a VALUES(1,0,0),(2,1,1),(3,0,0),(4,1,0),(5,0,0),(6,1,0),(7,0,NULL)')
        size = entry.size
        await conn.query('ANALYZE TABLE a')
      }
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
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS slots160')
    await conn.end()
    await db?.end()
  }
})
