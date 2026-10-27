import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import casts from './fixtures/diagnostics/cast-source-readiness.json' with { type: 'json' }
import dual from './fixtures/diagnostics/dual-source-readiness.json' with { type: 'json' }

for (const reference of [casts, dual]) test(reference.schema + ': source construction preserves readiness and table identity', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  const quotedTable = reference === dual
  const marker = quotedTable ? 'marker' : 't'
  assert.equal(reference.observations.length, quotedTable ? 600 : 5076)
  assert.equal(strict.size, quotedTable ? 552 : 3542)
  let created = false
  let phase: string | undefined
  let compared = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE ' + marker + '(v INT)')
    await conn.query('INSERT INTO ' + marker + ' VALUES(1),(2)')
    for (const [i, entry] of reference.observations.entries()) {
      const next = reference.phases[entry.phase]!
      if (phase !== next) {
        if (next === 'many') {
          await conn.query('CREATE TABLE `dual`(v INT)')
          await conn.query('INSERT INTO `dual` VALUES(1),(2),(NULL)')
        }
        if (next === 'empty') await conn.query('TRUNCATE TABLE `dual`')
        if (next === 'null') await conn.query('INSERT INTO `dual` VALUES(NULL)')
        phase = next
      }
      await conn.query('SET sql_mode=?', [reference.modes[entry.mode]!])
      const sql = reference.commands[entry.sql]!
      const api = reference.apis[entry.api]!
      const label = sql + ' [' + api + ', ' + phase + ']'
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, { sql, api })
      const expected = reference.outcomes[entry.outcome]!
      const outcome = {
        ...expected,
        fields: expected.fields?.map(j => reference.fields[j]) ?? null,
        prior: expected.prior.map(j => reference.warnings[j]),
        warnings: expected.warnings.map(j => reference.warnings[j]),
      }
      if (db === undefined || entry.header) assert.equal(observed.outcome.fields !== null, outcome.fields !== null, label + ': preserved header presence')
      for (const key of reference.preserved[entry.preserved]! as (keyof typeof outcome)[]) {
        assert.deepEqual(observed.outcome[key], outcome[key], label + ': preserved ' + key)
      }
      // Keep each verified column attribute even when another attribute is still open.
      for (const [column, mask] of entry.fieldChecks.entries()) {
        if (mask === 0) continue
        const fields = observed.outcome.fields
        assert.ok(Array.isArray(fields) && Array.isArray(fields[column]), label + ': column header')
        for (let attribute = 0; attribute < 10; attribute++) {
          if (mask & (1 << attribute)) assert.deepEqual(fields[column][attribute], outcome.fields![column]![attribute], label + ': column ' + column + ' attribute ' + attribute)
        }
      }
      if (db === undefined || strict.has(i)) {
        compared++
        assert.deepEqual(observed.outcome, outcome, label)
        assert.equal(observed.prepareWarnings, entry.prepareWarnings, label + ': PREPARE warning count')
      }
      const after = (await conn.query({ sql: 'SELECT * FROM ' + marker, rowsAsArray: true }))[0]
      assert.deepEqual(after, reference.after, label + ': completed effects')
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, label + ': readers released')
    }
    assert.equal(compared, db === undefined ? reference.observations.length : strict.size)
  } finally {
    if (created) await conn.query('DROP DATABASE ' + reference.schema)
    await conn.end()
    await db?.end()
  }
})
