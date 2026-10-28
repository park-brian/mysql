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
import modifierDeprecation from './fixtures/diagnostics/modifier-deprecation-admission.json' with { type: 'json' }
import keywordIdentity from './fixtures/diagnostics/keyword-identity.json' with { type: 'json' }
import keywordSelectors from './fixtures/diagnostics/keyword-selectors.json' with { type: 'json' }
import generatedPrepare from './fixtures/diagnostics/generated-prepare-admission.json' with { type: 'json' }
import functionQuoting from './fixtures/diagnostics/function-name-quoting.json' with { type: 'json' }
import generatedAdmission from './fixtures/diagnostics/generated-column-admission.json' with { type: 'json' }
import functionIdentity from './fixtures/diagnostics/function-identity.json' with { type: 'json' }
import schemaPresence from './fixtures/diagnostics/schema-presence.json' with { type: 'json' }
import shorthandWarnings from './fixtures/diagnostics/shorthand-warning-admission.json' with { type: 'json' }
import expressionDefaults from './fixtures/diagnostics/expression-default-admission.json' with { type: 'json' }
import columnBoundaries from './fixtures/diagnostics/column-expression-boundaries.json' with { type: 'json' }
import columnOrder from './fixtures/diagnostics/column-expression-order.json' with { type: 'json' }
import columnUsage from './fixtures/diagnostics/column-expression-usage.json' with { type: 'json' }
import functionDiagnostics from './fixtures/diagnostics/function-diagnostic-names.json' with { type: 'json' }
import checkPrerequisites from './fixtures/diagnostics/check-permission-prerequisites.json' with { type: 'json' }
import clockPrecision from './fixtures/diagnostics/clock-precision-admission.json' with { type: 'json' }
import columnClockGrammar from './fixtures/diagnostics/column-clock-grammar.json' with { type: 'json' }
import columnClockRoles from './fixtures/diagnostics/column-clock-roles.json' with { type: 'json' }
import columnClockBounds from './fixtures/diagnostics/column-clock-boundaries.json' with { type: 'json' }
import fractionalClockGrammar from './fixtures/diagnostics/fractional-clock-grammar.json' with { type: 'json' }
import fractionalClockLiteralBoundaries from './fixtures/diagnostics/fractional-clock-literal-boundaries.json' with { type: 'json' }

/** Restore dates, binary rows and numeric facts that JSON cannot represent directly. */
function capturedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(capturedValue)
  if (value !== null && typeof value === 'object') {
    if ('type' in value && value.type === 'Buffer' && 'data' in value && Array.isArray(value.data)) return Buffer.from(value.data)
    if ('dateValue' in value && typeof value.dateValue === 'string') return new Date(value.dateValue)
    if ('negativeZero' in value) return -0
    if ('nonfinite' in value) return Number(value.nonfinite)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, capturedValue(item)]))
  }
  return value
}

for (const [reference, total, matched] of [[literalAdmission, 1623, 1521], [conditionHistories, 198, 192], [castDatatype, 480, 398], [castModifiers, 16648, 16274], [warningAdmission, 325, 248], [modifierDeprecation, 1008, 764], [keywordIdentity, 150, 146], [keywordSelectors, 1850, 1670], [shorthandWarnings, 552, 396], [schemaPresence, 378, 189], [functionIdentity, 6084, 5430], [generatedAdmission, 3276, 1792], [functionQuoting, 3573, 2820], [generatedPrepare, 685, 256], [expressionDefaults, 738, 476], [columnBoundaries, 1017, 610], [columnOrder, 63, 42], [columnUsage, 18, 12], [functionDiagnostics, 702, 442], [checkPrerequisites, 702, 224], [clockPrecision, 1566, 490], [columnClockGrammar, 756, 396], [columnClockRoles, 504, 204], [columnClockBounds, 540, 120], [fractionalClockGrammar, 2376, 1584], [fractionalClockLiteralBoundaries, 243, 144]] as const) test('M5.10: admission preserves primary errors, condition histories, headers and effects: ' + reference.schema, async () => {
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
  const noDatabase = 'noDatabase' in reference && reference.noDatabase
  const prefix = noDatabase ? reference.schema + '.' : ''
  const victim = 'victim' in reference ? reference.victim : undefined
  let victimCreated = false
  let compared = 0
  try {
    await conn.connect()
    if (db === undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    if (!noDatabase) await conn.query('USE ' + reference.schema)
    await conn.query('CREATE TABLE ' + prefix + 't(v INT)')
    if (noDatabase) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS v'))[0][0]!.v, null)
    if (victim !== undefined) {
      await conn.query('CREATE DATABASE ' + victim)
      victimCreated = true
    }
    for (const [i, entry] of reference.observations.entries()) {
      await conn.query('SET sql_mode=?', [reference.modes[entry.mode]!])
      if ('resetResults' in reference && reference.resetResults) await conn.query('SET character_set_results=utf8mb4')
      const expectedEffects: Readonly<Record<string, unknown>> = reference.effects[entry.effects]!
      if (entry.stateful) {
        await conn.query('TRUNCATE TABLE ' + prefix + 't')
        await conn.query('INSERT INTO ' + prefix + 't VALUES(1),(2)')
        await conn.query('SET @x=3')
        await conn.query('DROP VIEW IF EXISTS ' + prefix + 'w')
        await conn.query('DROP TABLE IF EXISTS ' + prefix + 'u')
        if ('columns' in expectedEffects) {
          await conn.query('DROP TABLE IF EXISTS r')
          await conn.query('CREATE TABLE r(v INT)')
          if ('seedR' in reference && reference.seedR) await conn.query('INSERT INTO r VALUES(1),(2)')
        }
        if ('event' in expectedEffects) await conn.query('DROP EVENT IF EXISTS e')
      }
      if ('resetInsertId' in reference && reference.resetInsertId) await conn.query('SELECT LAST_INSERT_ID(0)')
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
        const after = (await conn.query({ sql: 'SELECT * FROM ' + prefix + 't', rowsAsArray: true }))[0]
        const variable = (await conn.query<mysql.RowDataPacket[]>('SELECT CAST(@x AS CHAR) AS v'))[0][0]!.v as string
        const effects: Record<string, unknown> = { after, variable }
        if ('columns' in expectedEffects) effects.columns = (await conn.query<mysql.RowDataPacket[]>('SHOW COLUMNS FROM r'))[0].map(row => row.Field as string)
        if ('rDefinition' in expectedEffects) effects.rDefinition = (await conn.query<mysql.RowDataPacket[]>('SHOW CREATE TABLE r'))[0][0]!['Create Table']
        if ('rRows' in expectedEffects) effects.rRows = (await conn.query({ sql: 'SELECT * FROM r', rowsAsArray: true }))[0]
        if ('view' in expectedEffects) effects.view = ((await conn.query("SHOW FULL TABLES LIKE 'w'"))[0] as unknown[]).length
        if ('schemas' in expectedEffects) {
          assert.ok(victim !== undefined, label + ': owned schema')
          effects.schemas = ((await conn.query('SHOW DATABASES LIKE ?', [victim]))[0] as unknown[]).length
        }
        if ('tables' in expectedEffects) effects.tables = (await conn.query('SHOW FULL TABLES' + (noDatabase ? ' FROM ' + reference.schema : '')))[0]
        if ('database' in expectedEffects) effects.database = (await conn.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS v'))[0][0]!.v
        if ('lastInsertId' in expectedEffects) effects.lastInsertId = (await conn.query<mysql.RowDataPacket[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS v'))[0][0]!.v
        if ('event' in expectedEffects) {
          try {
            await conn.query('DROP EVENT e')
            effects.event = true
          } catch (error) {
            assert.ok(error instanceof Error && 'errno' in error, label + ': event lookup')
            assert.equal(error.errno, 1539, label + ': missing event')
            effects.event = false
          }
        }
        assert.deepEqual(Object.keys(effects).sort(), Object.keys(expectedEffects).sort(), label + ': effect shape')
        const keys = complete ? Object.keys(effects) : reference.effectChecks[entry.effectChecks]!
        for (const key of keys) assert.deepEqual(effects[key], expectedEffects[key], label + ': effect ' + key)
      }
      if (db !== undefined) assert.equal(db.catalog!.store.transactions.stats().openViews, views, label + ': readers released')
    }
    assert.equal(compared, db === undefined ? reference.observations.length : strict.size)
  } finally {
    if (victimCreated) await conn.query('DROP DATABASE IF EXISTS ' + victim)
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
