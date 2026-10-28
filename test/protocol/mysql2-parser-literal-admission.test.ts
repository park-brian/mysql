import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import { observeCommand } from './packet-observation.ts'
import literalAdmission from './fixtures/diagnostics/parser-literal-admission.json' with { type: 'json' }
import conditionHistories from './fixtures/diagnostics/parser-condition-histories.json' with { type: 'json' }
import castDatatype from './fixtures/diagnostics/cast-datatype-grammar.json' with { type: 'json' }
import castModifiers from './fixtures/diagnostics/cast-modifier-grammar.json' with { type: 'json' }
import warningAdmission from './fixtures/diagnostics/parser-warning-admission.json' with { type: 'json' }

/** Restore binary rows and numeric facts that JSON cannot represent directly. */
function capturedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(capturedValue)
  if (value !== null && typeof value === 'object') {
    if ('type' in value && value.type === 'Buffer' && 'data' in value && Array.isArray(value.data)) return Buffer.from(value.data)
    if ('negativeZero' in value) return -0
    if ('nonfinite' in value) return Number(value.nonfinite)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, capturedValue(item)]))
  }
  return value
}

for (const [reference, total, matched] of [[literalAdmission, 1623, 1521], [conditionHistories, 198, 192], [castDatatype, 480, 398], [castModifiers, 16648, 15710], [warningAdmission, 325, 248]] as const) test('M5.10: admission preserves primary errors, condition histories, headers and effects: ' + reference.schema, async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:', { multipleStatements: true }) : undefined
  const transport = db === undefined
    ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true })
    : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), supportBigNumbers: true, bigNumberStrings: true, multipleStatements: true })
  const conn = raw.promise()
  const strict = new Set(reference.strict)
  assert.equal(reference.observations.length, total)
  assert.equal(strict.size, matched)
  let created = false
  let compared = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE t(v INT)')
    for (const [i, entry] of reference.observations.entries()) {
      await conn.query('SET sql_mode=?', [reference.modes[entry.mode]!])
      if (entry.stateful) {
        await conn.query('TRUNCATE TABLE t')
        await conn.query('INSERT INTO t VALUES(1),(2)')
        await conn.query('SET @x=3')
        await conn.query('DROP VIEW IF EXISTS w')
        await conn.query('DROP TABLE IF EXISTS u')
        await conn.query('DROP TABLE IF EXISTS r')
        await conn.query('CREATE TABLE r(v INT)')
      }
      const sql = reference.commands[entry.sql]!
      const api = reference.apis[entry.api]!
      const label = sql + ' [' + api + ', ' + reference.modes[entry.mode] + ']'
      const views = db?.catalog!.store.transactions.stats().openViews
      const observed = await observeCommand(raw, conn, transport, { sql, api })
      const expected = reference.outcomes[entry.outcome]!
      const outcome = {
        ...expected,
        rows: capturedValue(expected.rows),
        fields: expected.fields?.map(j => reference.fields[j]) ?? null,
        prior: expected.prior.map(j => reference.warnings[j]),
        warnings: expected.warnings.map(j => reference.warnings[j]),
      }
      if (db === undefined || entry.header) assert.equal(observed.outcome.fields !== null, outcome.fields !== null, label + ': header presence')
      for (const key of reference.preserved[entry.preserved]! as (keyof typeof outcome)[]) {
        assert.deepEqual(observed.outcome[key], outcome[key], label + ': preserved ' + key)
      }
      if (db === undefined || entry.errorPresence) assert.equal(observed.outcome.error === null, outcome.error === null, label + ': error presence')
      if (entry.errorChecks !== 0) {
        const received = observed.outcome.error, expectedError = outcome.error
        assert.ok(Array.isArray(received), label + ': primary error')
        assert.ok(Array.isArray(expectedError), label + ': captured primary error')
        for (let attribute = 0; attribute < 4; attribute++) {
          if (entry.errorChecks & (1 << attribute)) assert.equal(received[attribute], expectedError[attribute], label + ': error attribute ' + attribute)
        }
      }
      if (entry.conditionChecks.length !== 0) {
        const conditions = observed.outcome.warnings
        assert.ok(Array.isArray(conditions), label + ': diagnostics')
        for (const condition of entry.conditionChecks) assert.deepEqual(conditions[condition], outcome.warnings[condition], label + ': condition ' + condition)
      }
      for (const [column, mask] of entry.fieldChecks.entries()) {
        if (mask === 0) continue
        const fields = observed.outcome.fields
        assert.ok(Array.isArray(fields) && Array.isArray(fields[column]), label + ': column header')
        for (let attribute = 0; attribute < 10; attribute++) {
          if (mask & (1 << attribute)) assert.deepEqual(fields[column][attribute], outcome.fields![column]![attribute], label + ': column ' + column + ' attribute ' + attribute)
        }
      }
      if (db === undefined || entry.prepareCheck) assert.equal(observed.prepareWarnings ?? null, entry.prepareWarnings, label + ': PREPARE warning count')
      const complete = db === undefined || strict.has(i)
      if (complete) {
        compared++
        assert.deepEqual(observed.outcome, outcome, label)
      }
      if (entry.stateful) {
        const after = (await conn.query({ sql: 'SELECT * FROM t', rowsAsArray: true }))[0]
        const variable = (await conn.query<mysql.RowDataPacket[]>('SELECT CAST(@x AS CHAR) AS v'))[0][0]!.v as string
        const columns = (await conn.query<mysql.RowDataPacket[]>('SHOW COLUMNS FROM r'))[0].map(row => row.Field as string)
        const view = (await conn.query("SHOW FULL TABLES LIKE 'w'"))[0] as unknown[]
        const effects = { after, variable, columns, view: view.length }
        const expectedEffects = reference.effects[entry.effects]!
        const keys = complete ? Object.keys(effects) : reference.effectChecks[entry.effectChecks]!
        for (const key of keys as (keyof typeof effects)[]) assert.deepEqual(effects[key], expectedEffects[key], label + ': effect ' + key)
      }
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, label + ': readers released')
    }
    assert.equal(compared, db === undefined ? reference.observations.length : strict.size)
  } finally {
    if (created) await conn.query('DROP DATABASE ' + reference.schema)
    await conn.end()
    await db?.end()
  }
})

for (const multipleStatements of [false, true]) test('parser histories honor negotiated multiple statements: ' + multipleStatements, async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:', { multipleStatements }) : undefined
  const transport = db === undefined ? connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), noDelay: true }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}), multipleStatements })
  const conn = raw.promise()
  try {
    for (const [sql, code, warnings] of [['SELECT 1 COLLATE missing_c1; SELECT 2', 1273, []], ['SELECT 1e309; SELECT 2', 1367, []], ["SELECT CAST('x' AS NCHAR) COLLATE missing_c1; SELECT 2", 1273, [3720]]] as const) {
      const observed = await observeCommand(raw, conn, transport, { sql, api: 'query' })
      assert.equal((observed.outcome.error as unknown[])[1], code)
      const codes = (observed.outcome.warnings as mysql.RowDataPacket[]).map(c => c.Code)
      assert.deepEqual(codes, [...warnings, code, ...(multipleStatements ? [] : [1064])])
      assert.equal(observed.outcome.warningCount, codes.length)
      assert.equal(observed.outcome.errorCount, codes.length - warnings.length)
      assert.deepEqual(observed.outcome.rows, [])
      assert.equal(observed.outcome.fields, null)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
