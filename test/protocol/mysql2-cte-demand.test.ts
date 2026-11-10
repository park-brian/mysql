import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2/promise'
import type { Connection as RawConnection, QueryError, QueryResult, RowDataPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import nonrecursive from './fixtures/diagnostics/cte-demand.json' with { type: 'json' }
import recursive from './fixtures/diagnostics/recursive-demand.json' with { type: 'json' }
import order from './fixtures/diagnostics/recursive-order.json' with { type: 'json' }
import names from './fixtures/diagnostics/recursive-names.json' with { type: 'json' }
import spelling from './fixtures/diagnostics/duplicate-spelling.json' with { type: 'json' }
import noDatabase from './fixtures/diagnostics/view-target-no-db.json' with { type: 'json' }
import controls from './fixtures/diagnostics/view-target-controls.json' with { type: 'json' }
import merge from './fixtures/diagnostics/view-merge.json' with { type: 'json' }
import mergeReuse from './fixtures/diagnostics/view-merge-reuse.json' with { type: 'json' }
import check from './fixtures/diagnostics/view-check.json' with { type: 'json' }
import checkReuse from './fixtures/diagnostics/view-check-reuse.json' with { type: 'json' }
import checkEffects from './fixtures/diagnostics/view-check-effects.json' with { type: 'json' }
import projections from './fixtures/diagnostics/view-check-projections.json' with { type: 'json' }
import projectionReuse from './fixtures/diagnostics/view-check-projection-reuse.json' with { type: 'json' }
import projectionEffects from './fixtures/diagnostics/view-check-projection-effects.json' with { type: 'json' }
import fieldAdmission from './fixtures/diagnostics/view-check-fields-admission.json' with { type: 'json' }
import updatability from './fixtures/diagnostics/view-updatability.json' with { type: 'json' }
import updatabilityTypes from './fixtures/diagnostics/view-updatability-types.json' with { type: 'json' }
import plusPrint from './fixtures/diagnostics/unary-plus-print.json' with { type: 'json' }
import plusDiagnostics from './fixtures/diagnostics/unary-plus-diagnostics.json' with { type: 'json' }
import plusReuse from './fixtures/diagnostics/unary-plus-diagnostic-reuse.json' with { type: 'json' }
import updatabilityOwners from './fixtures/diagnostics/view-updatability-owners.json' with { type: 'json' }
import updatabilityOrder from './fixtures/diagnostics/view-updatability-order.json' with { type: 'json' }
import binaryNotValues from './fixtures/diagnostics/binary-not-values.json' with { type: 'json' }
import binaryNotParameters from './fixtures/diagnostics/binary-not-parameters.json' with { type: 'json' }
import binaryNotCasts from './fixtures/diagnostics/binary-not-casts.json' with { type: 'json' }
import binaryNotBytes from './fixtures/diagnostics/binary-not-bytes.json' with { type: 'json' }
import binaryNotStrictTrans from './fixtures/diagnostics/binary-not-strict-trans.json' with { type: 'json' }
import binaryNotStrictAll from './fixtures/diagnostics/binary-not-strict-all.json' with { type: 'json' }
import binaryNotModes from './fixtures/diagnostics/binary-not-modes.json' with { type: 'json' }
import bitwiseControls from './fixtures/diagnostics/binary-bitwise-controls.json' with { type: 'json' }
import bitwiseValues from './fixtures/diagnostics/binary-bitwise-values.json' with { type: 'json' }
import bitwiseOrder from './fixtures/diagnostics/binary-bitwise-order.json' with { type: 'json' }
import bitwiseColumns from './fixtures/diagnostics/binary-bitwise-columns.json' with { type: 'json' }
import bitwiseParameters from './fixtures/diagnostics/binary-bitwise-parameters.json' with { type: 'json' }
import bitwiseProvenance from './fixtures/diagnostics/binary-bitwise-provenance.json' with { type: 'json' }
import realDirect from './fixtures/diagnostics/owned-real-direct.json' with { type: 'json' }
import realValues from './fixtures/diagnostics/owned-real-values.json' with { type: 'json' }
import realWrappers from './fixtures/diagnostics/owned-real-wrappers.json' with { type: 'json' }
import realScalars from './fixtures/diagnostics/owned-real-scalars.json' with { type: 'json' }
import realReadiness from './fixtures/diagnostics/owned-real-readiness.json' with { type: 'json' }
import realFields from './fixtures/diagnostics/owned-real-fields.json' with { type: 'json' }
import realEffects from './fixtures/diagnostics/owned-real-effects.json' with { type: 'json' }
import realMixed from './fixtures/diagnostics/owned-real-mixed.json' with { type: 'json' }
import realJson from './fixtures/diagnostics/owned-real-json.json' with { type: 'json' }
import realStrict from './fixtures/diagnostics/owned-real-strict.json' with { type: 'json' }
import shiftShifts from './fixtures/diagnostics/binary-shift-shifts.json' with { type: 'json' }
import shiftCounts from './fixtures/diagnostics/binary-shift-counts.json' with { type: 'json' }
import shiftFields from './fixtures/diagnostics/binary-shift-fields.json' with { type: 'json' }
import shiftParameters from './fixtures/diagnostics/binary-shift-parameters.json' with { type: 'json' }
import shiftRounding from './fixtures/diagnostics/binary-shift-rounding.json' with { type: 'json' }
import integerDirect from './fixtures/diagnostics/owned-integer-direct.json' with { type: 'json' }
import integerFields from './fixtures/diagnostics/owned-integer-fields.json' with { type: 'json' }
import integerScalars from './fixtures/diagnostics/owned-integer-scalars.json' with { type: 'json' }
import integerParameters from './fixtures/diagnostics/owned-integer-parameters.json' with { type: 'json' }
import integerWrappers from './fixtures/diagnostics/owned-integer-wrappers.json' with { type: 'json' }
import integerCasts from './fixtures/diagnostics/owned-integer-casts.json' with { type: 'json' }
import integerActivity from './fixtures/diagnostics/owned-integer-activity.json' with { type: 'json' }
import literalIntegerDirect from './fixtures/diagnostics/literal-integer-direct.json' with { type: 'json' }
import literalIntegerEdges from './fixtures/diagnostics/literal-integer-edges.json' with { type: 'json' }
import literalIntegerHolders from './fixtures/diagnostics/literal-integer-holders.json' with { type: 'json' }
import fieldIntegerFields from './fixtures/diagnostics/field-integer-fields.json' with { type: 'json' }
import fieldIntegerContexts from './fixtures/diagnostics/field-integer-contexts.json' with { type: 'json' }
import fieldIntegerStrictTrans from './fixtures/diagnostics/field-integer-strict-trans.json' with { type: 'json' }
import fieldIntegerStrictAll from './fixtures/diagnostics/field-integer-strict-all.json' with { type: 'json' }
import fieldIntegerActivity from './fixtures/diagnostics/field-integer-activity.json' with { type: 'json' }
import fieldIntegerGrouping from './fixtures/diagnostics/field-integer-grouping.json' with { type: 'json' }
import fieldIntegerBounds from './fixtures/diagnostics/field-integer-bounds.json' with { type: 'json' }
import fieldIntegerNulls from './fixtures/diagnostics/field-integer-nulls.json' with { type: 'json' }
import fieldIntegerFixed from './fixtures/diagnostics/field-integer-fixed.json' with { type: 'json' }
import aggregateIntegerDirect from './fixtures/diagnostics/aggregate-integer-direct.json' with { type: 'json' }
import aggregateIntegerFrames from './fixtures/diagnostics/aggregate-integer-frames.json' with { type: 'json' }
import aggregateIntegerActivity from './fixtures/diagnostics/aggregate-integer-activity.json' with { type: 'json' }
import aggregateIntegerStatistics from './fixtures/diagnostics/aggregate-integer-statistics.json' with { type: 'json' }
import aggregateIntegerDistinct from './fixtures/diagnostics/aggregate-integer-distinct.json' with { type: 'json' }
import aggregateIntegerBounds from './fixtures/diagnostics/aggregate-integer-bounds.json' with { type: 'json' }
import aggregateIntegerStrict from './fixtures/diagnostics/aggregate-integer-strict.json' with { type: 'json' }
import windowPhaseOwners from './fixtures/diagnostics/window-phase-owners.json' with { type: 'json' }
import windowPhaseMetadata from './fixtures/diagnostics/window-phase-metadata.json' with { type: 'json' }
import windowPhaseActivity from './fixtures/diagnostics/window-phase-activity.json' with { type: 'json' }
import windowPlanningPlanning from './fixtures/diagnostics/window-planning-planning.json' with { type: 'json' }
import windowPlanningOutput from './fixtures/diagnostics/window-planning-output.json' with { type: 'json' }
import windowPlanningEdges from './fixtures/diagnostics/window-planning-edges.json' with { type: 'json' }
import windowPlanningMixed from './fixtures/diagnostics/window-planning-mixed.json' with { type: 'json' }
import windowPlanningCollation from './fixtures/diagnostics/window-planning-collation.json' with { type: 'json' }
import windowPlanningRetainedOutput from './fixtures/diagnostics/window-planning-retained-output.json' with { type: 'json' }
import windowPlanningPlans from './fixtures/diagnostics/window-planning-plans.json' with { type: 'json' }
import materializationMaterialized from './fixtures/diagnostics/window-materialization-materialized.json' with { type: 'json' }
import materializationLimits from './fixtures/diagnostics/window-materialization-limits.json' with { type: 'json' }
import materializationContexts from './fixtures/diagnostics/window-materialization-contexts.json' with { type: 'json' }
import materializationEffects from './fixtures/diagnostics/window-materialization-effects.json' with { type: 'json' }
import materializationRetained from './fixtures/diagnostics/window-materialization-retained.json' with { type: 'json' }
import materializationFailures from './fixtures/diagnostics/window-materialization-failures.json' with { type: 'json' }
import materializationGroupEffects from './fixtures/diagnostics/window-materialization-group-effects.json' with { type: 'json' }
import materializationParameters from './fixtures/diagnostics/window-materialization-parameters.json' with { type: 'json' }
import materializationPlans from './fixtures/diagnostics/window-materialization-plans.json' with { type: 'json' }
import implicitImplicit from './fixtures/diagnostics/window-implicit-implicit.json' with { type: 'json' }
import implicitActivity from './fixtures/diagnostics/window-implicit-activity.json' with { type: 'json' }
import implicitStates from './fixtures/diagnostics/window-implicit-states.json' with { type: 'json' }
import implicitRetained from './fixtures/diagnostics/window-implicit-retained.json' with { type: 'json' }
import implicitPlans from './fixtures/diagnostics/window-implicit-plans.json' with { type: 'json' }
import extremeOrigin from './fixtures/diagnostics/extreme-origin.json' with { type: 'json' }
import extremeStates from './fixtures/diagnostics/extreme-states.json' with { type: 'json' }
import extremeRetained from './fixtures/diagnostics/extreme-retained.json' with { type: 'json' }
import wrapperOwners from './fixtures/diagnostics/window-wrapper-owners.json' with { type: 'json' }
import wrapperActivity from './fixtures/diagnostics/window-wrapper-activity.json' with { type: 'json' }
import wrapperRetained from './fixtures/diagnostics/window-wrapper-retained.json' with { type: 'json' }
import wrapperPlans from './fixtures/diagnostics/window-wrapper-plans.json' with { type: 'json' }
import wrapperEdges from './fixtures/diagnostics/window-wrapper-edges.json' with { type: 'json' }
import limitTransferEffects from './fixtures/diagnostics/limit-transfer-effects.json' with { type: 'json' }
import limitTransferReuse from './fixtures/diagnostics/limit-transfer-reuse.json' with { type: 'json' }
import limitTransferAdmission from './fixtures/diagnostics/limit-transfer-admission.json' with { type: 'json' }
import scalarHavingValues from './fixtures/diagnostics/scalar-having-values.json' with { type: 'json' }
import scalarHavingRetained from './fixtures/diagnostics/scalar-having-retained.json' with { type: 'json' }
import scalarHavingControls from './fixtures/diagnostics/scalar-having-controls.json' with { type: 'json' }
import scalarHavingCount from './fixtures/diagnostics/scalar-having-count-controls.json' with { type: 'json' }
import scalarWhereWhere from './fixtures/diagnostics/scalar-where-where.json' with { type: 'json' }
import scalarWhereParameters from './fixtures/diagnostics/scalar-where-parameters.json' with { type: 'json' }
import scalarWhereEdges from './fixtures/diagnostics/scalar-where-edges.json' with { type: 'json' }
import scalarWhereRetained from './fixtures/diagnostics/scalar-where-retained.json' with { type: 'json' }
import scalarGroupedWhereValues from './fixtures/diagnostics/scalar-grouped-where-values.json' with { type: 'json' }
import scalarGroupedWhereRetained from './fixtures/diagnostics/scalar-grouped-where-retained.json' with { type: 'json' }
import conditionDemand from './fixtures/diagnostics/condition-demand-demand.json' with { type: 'json' }
import conditionDemandRetained from './fixtures/diagnostics/condition-demand-retained.json' with { type: 'json' }
import conditionDemandComputed from './fixtures/diagnostics/condition-demand-computed.json' with { type: 'json' }
import conditionDemandLiterals from './fixtures/diagnostics/condition-demand-literals.json' with { type: 'json' }
import conditionDemandUnaryPlus from './fixtures/diagnostics/condition-demand-unary-plus.json' with { type: 'json' }
import conditionDemandUnaryPlusRetained from './fixtures/diagnostics/condition-demand-unary-plus-retained.json' with { type: 'json' }
import conditionDemandDivisionRetained from './fixtures/diagnostics/condition-demand-division-retained.json' with { type: 'json' }
import conditionDemandDivision from './fixtures/diagnostics/condition-demand-division.json' with { type: 'json' }
import conditionDemandArithmeticRetained from './fixtures/diagnostics/condition-demand-arithmetic-retained.json' with { type: 'json' }
import conditionDemandArithmetic from './fixtures/diagnostics/condition-demand-arithmetic.json' with { type: 'json' }
import conditionBooleanReaders from './fixtures/diagnostics/condition-boolean-readers.json' with { type: 'json' }
import conditionDemandComparisonsRetained from './fixtures/diagnostics/condition-demand-comparisons-retained.json' with { type: 'json' }
import conditionDemandComparisons from './fixtures/diagnostics/condition-demand-comparisons.json' with { type: 'json' }
import effects from './fixtures/diagnostics/view-target-effects.json' with { type: 'json' }

const fieldsOf = (fields: readonly mysql.FieldPacket[]) => fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

async function driver(db: MySQL | undefined) {
  const host = process.env.MYSQL_REFERENCE_HOST
  return mysql.createConnection({
    stream: db ? db.createStream() : connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }),
    user: 'root', ...(db ? {} : { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }), rowsAsArray: true,
  })
}

async function connection() {
  const db = process.env.MYSQL_REFERENCE_HOST === undefined ? await MySQL.open(':memory:') : undefined
  return { c: await driver(db), db }
}

async function storedView(c: mysql.Connection, name: string): Promise<{ algorithm: string | undefined; definition: string } | null> {
  try {
    const [rows] = await c.query<RowDataPacket[]>('SHOW CREATE VIEW ' + name)
    const definition = String(rows[0]![1])
    return { algorithm: /ALGORITHM=(\w+)/.exec(definition)?.[1], definition }
  } catch (error) {
    if ((error as QueryError).errno !== 1146) throw error
    return null
  }
}

function rowsOf(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value.toJSON()
  return Array.isArray(value) ? value.map(rowsOf) : value
}

function parametersOf(values: readonly unknown[]): (string | number | null | Buffer)[] {
  return values.map((value) => {
    if (value === null || typeof value === 'string' || typeof value === 'number') return value
    if (typeof value === 'object' && 'type' in value && value.type === 'Buffer' && 'data' in value && Array.isArray(value.data)) return Buffer.from(value.data)
    throw new Error('Unsupported fixture parameter')
  })
}

async function observe(c: mysql.Connection, sql: string, api: string, parameters: (string | number | null | Buffer)[] = [], measureHeaders = false) {
  let result: object
  let headers = 0
  try {
    if (api === 'prepare') {
      const prepared = await c.prepare(sql)
      try {
        const { statement } = prepared as mysql.PreparedStatementInfo & { statement: { parameters: mysql.FieldPacket[]; columns: mysql.FieldPacket[] } }
        result = { parameters: fieldsOf(statement.parameters), fields: fieldsOf(statement.columns) }
      } finally { await prepared.close(); c.unprepare(sql) }
    } else {
      const [rows, fields] = measureHeaders ? await new Promise<[QueryResult, mysql.FieldPacket[] | undefined]>((resolve, reject) => {
        const done = (error: QueryError | null, rows: QueryResult, fields?: mysql.FieldPacket[]) => error ? reject(error) : resolve([rows, fields])
        const raw = (c as mysql.Connection & { connection: RawConnection }).connection
        const command = api === 'query' ? raw.query(sql, parameters, done) : raw.execute(sql, parameters, done)
        command.on('fields', () => headers++)
      }) : api === 'query' ? await c.query(sql, parameters) : await c.execute(sql, parameters)
      result = fields === undefined ? { header: { ...rows } } : { rows: rowsOf(rows), fields: fieldsOf(fields) }
    }
  } catch (e) {
    const error = e as QueryError & { sqlMessage?: string }
    result = { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage } }
  }
  return { sql, api, ...result, ...(measureHeaders ? { headers } : {}), ...await conditionsOf(c) }
}

async function conditionsOf(c: mysql.Connection) {
  const [warnings] = await c.query('SHOW WARNINGS')
  const warningCount = String((await c.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]![0])
  const errorCount = String((await c.query<RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]![0])
  return { warnings, warningCount, errorCount }
}

test('M5.10: prepared string metadata retains its SQL mode while text queries use the current mode', async () => {
  const { c, db } = await connection()
  let statement: mysql.PreparedStatementInfo | undefined
  let activeSql = ''
  try {
    assert.equal(binaryNotModes.mysqlVersion, '8.4.11')
    if (!db) assert.equal(String((await c.query<RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], binaryNotModes.mysqlVersion)
    for (const expected of binaryNotModes.observations) {
      const { sql, initial, api } = expected
      let actual: object
      if (api === 'prepare') {
        await statement?.close()
        c.unprepare(activeSql)
        await c.query('SET sql_mode=?', [initial])
        await c.query(binaryNotModes.seed)
        activeSql = sql
        statement = await c.prepare(sql)
        const prepared = statement as mysql.PreparedStatementInfo & { statement: { parameters: mysql.FieldPacket[]; columns: mysql.FieldPacket[] } }
        actual = { parameters: fieldsOf(prepared.statement.parameters), fields: fieldsOf(prepared.statement.columns) }
      } else {
        assert.ok(statement)
        assert.ok('mode' in expected)
        await c.query('SET sql_mode=?', [expected.mode])
        await c.query(binaryNotModes.seed)
        const [rows, fields] = api === 'execute' ? await statement.execute([]) : await c.query(sql)
        actual = { rows: rowsOf(rows), fields: fieldsOf(fields ?? []) }
      }
      assert.deepEqual({ sql, initial, ...('mode' in expected ? { mode: expected.mode } : {}), api, ...actual, ...await conditionsOf(c) }, expected, `${initial}: ${sql} [${api}]`)
    }
  } finally {
    await statement?.close()
    c.unprepare(activeSql)
    await c.end()
    await db?.end()
  }
})

for (const [name, fixture] of [['nonrecursive', nonrecursive], ['recursive', recursive], ['order', order], ['names', names], ['spelling', spelling], ['view-target-no-db', noDatabase], ['view-target-controls', controls], ['view-merge', merge], ['view-merge-reuse', mergeReuse], ['view-check', check], ['view-check-reuse', checkReuse], ['view-check-projections', projections], ['view-check-projection-reuse', projectionReuse], ['view-check-fields-admission', fieldAdmission], ['view-updatability', updatability], ['view-updatability-types', updatabilityTypes], ['unary-plus-print', plusPrint], ['unary-plus-diagnostics', plusDiagnostics], ['unary-plus-diagnostic-reuse', plusReuse], ['view-updatability-owners', updatabilityOwners], ['view-updatability-order', updatabilityOrder], ['binary-not-values', binaryNotValues], ['binary-not-parameters', binaryNotParameters], ['binary-not-casts', binaryNotCasts], ['binary-not-bytes', binaryNotBytes], ['binary-not-strict-trans', binaryNotStrictTrans], ['binary-not-strict-all', binaryNotStrictAll], ['binary-bitwise-controls', bitwiseControls], ['binary-bitwise-values', bitwiseValues], ['binary-bitwise-order', bitwiseOrder], ['binary-bitwise-columns', bitwiseColumns], ['binary-bitwise-parameters', bitwiseParameters], ['binary-bitwise-provenance', bitwiseProvenance], ['owned-real-direct', realDirect], ['owned-real-values', realValues], ['owned-real-wrappers', realWrappers], ['owned-real-scalars', realScalars], ['owned-real-readiness', realReadiness], ['owned-real-fields', realFields], ['owned-real-effects', realEffects], ['owned-real-mixed', realMixed], ['owned-real-json', realJson], ['owned-real-strict', realStrict], ['binary-shift-shifts', shiftShifts], ['binary-shift-counts', shiftCounts], ['binary-shift-fields', shiftFields], ['binary-shift-parameters', shiftParameters], ['binary-shift-rounding', shiftRounding], ['owned-integer-direct', integerDirect], ['owned-integer-fields', integerFields], ['owned-integer-scalars', integerScalars], ['owned-integer-parameters', integerParameters], ['owned-integer-wrappers', integerWrappers], ['owned-integer-casts', integerCasts], ['owned-integer-activity', integerActivity], ['literal-integer-direct', literalIntegerDirect], ['literal-integer-edges', literalIntegerEdges], ['literal-integer-holders', literalIntegerHolders], ['field-integer-fields', fieldIntegerFields], ['field-integer-contexts', fieldIntegerContexts], ['field-integer-strict-trans', fieldIntegerStrictTrans], ['field-integer-strict-all', fieldIntegerStrictAll], ['field-integer-activity', fieldIntegerActivity], ['field-integer-grouping', fieldIntegerGrouping], ['field-integer-bounds', fieldIntegerBounds], ['field-integer-nulls', fieldIntegerNulls], ['field-integer-fixed', fieldIntegerFixed], ['aggregate-integer-direct', aggregateIntegerDirect], ['aggregate-integer-frames', aggregateIntegerFrames], ['aggregate-integer-activity', aggregateIntegerActivity], ['aggregate-integer-statistics', aggregateIntegerStatistics], ['aggregate-integer-distinct', aggregateIntegerDistinct], ['aggregate-integer-bounds', aggregateIntegerBounds], ['aggregate-integer-strict', aggregateIntegerStrict], ['window-phase-owners', windowPhaseOwners], ['window-phase-metadata', windowPhaseMetadata], ['window-phase-activity', windowPhaseActivity], ['window-planning-planning', windowPlanningPlanning], ['window-planning-output', windowPlanningOutput], ['window-planning-edges', windowPlanningEdges], ['window-planning-mixed', windowPlanningMixed], ['window-planning-collation', windowPlanningCollation], ['window-planning-retained-output', windowPlanningRetainedOutput], ['window-materialization-materialized', materializationMaterialized], ['window-materialization-limits', materializationLimits], ['window-materialization-contexts', materializationContexts], ['window-materialization-effects', materializationEffects], ['window-materialization-retained', materializationRetained], ['window-materialization-failures', materializationFailures], ['window-materialization-group-effects', materializationGroupEffects], ['window-materialization-parameters', materializationParameters], ['window-implicit-implicit', implicitImplicit], ['window-implicit-activity', implicitActivity], ['window-implicit-states', implicitStates], ['window-implicit-retained', implicitRetained], ['extreme-origin', extremeOrigin], ['extreme-states', extremeStates], ['extreme-retained', extremeRetained], ['window-wrapper-owners', wrapperOwners], ['window-wrapper-activity', wrapperActivity], ['window-wrapper-retained', wrapperRetained], ['window-wrapper-edges', wrapperEdges], ['limit-transfer-effects', limitTransferEffects], ['limit-transfer-reuse', limitTransferReuse], ['limit-transfer-admission', limitTransferAdmission], ['scalar-having-values', scalarHavingValues], ['scalar-having-retained', scalarHavingRetained], ['scalar-having-controls', scalarHavingControls], ['scalar-having-count', scalarHavingCount], ['scalar-where-where', scalarWhereWhere], ['scalar-where-parameters', scalarWhereParameters], ['scalar-where-edges', scalarWhereEdges], ['scalar-where-retained', scalarWhereRetained], ['scalar-grouped-where-values', scalarGroupedWhereValues], ['scalar-grouped-where-retained', scalarGroupedWhereRetained], ['condition-demand-demand', conditionDemand], ['condition-demand-retained', conditionDemandRetained], ['condition-demand-computed', conditionDemandComputed], ['condition-demand-literals', conditionDemandLiterals], ['condition-demand-unary-plus', conditionDemandUnaryPlus], ['condition-demand-unary-plus-retained', conditionDemandUnaryPlusRetained], ['condition-demand-division-retained', conditionDemandDivisionRetained], ['condition-demand-division', conditionDemandDivision], ['condition-demand-arithmetic-retained', conditionDemandArithmeticRetained], ['condition-demand-arithmetic', conditionDemandArithmetic], ['condition-boolean-readers', conditionBooleanReaders], ['condition-demand-comparisons-retained', conditionDemandComparisonsRetained], ['condition-demand-comparisons', conditionDemandComparisons]] as const) test('M5.10: SQL admission matches native: ' + name, async () => {
  const { c, db } = await connection()
  const schema = 'schema' in fixture ? fixture.schema : undefined
  let created = false
  try {
    assert.equal(fixture.mysqlVersion, '8.4.11')
    if (!db) assert.equal(String((await c.query<RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], fixture.mysqlVersion)
    if (schema !== undefined) {
      await c.query('CREATE DATABASE ' + schema)
      created = true
      if (!('useSchema' in fixture) || fixture.useSchema) await c.query('USE ' + schema)
    }
    await c.query('SET sql_mode=?', [fixture.sqlMode])
    if ('setup' in fixture) for (const sql of fixture.setup) await c.query(sql)
    for (const expected of fixture.observations) {
      const { sql, api } = expected
      if (!('reuse' in fixture) || !fixture.reuse) c.unprepare(sql)
      if ('beforeEach' in fixture) for (const setup of fixture.beforeEach) await c.query(setup)
      if ('before' in expected) for (const setup of expected.before) await c.query(setup)
      if ('table' in fixture && 'type' in expected) {
        await c.query('DROP TABLE ' + fixture.table)
        await c.query('CREATE TABLE ' + fixture.table + '(a ' + expected.type + ')')
      }
      if ('existing' in expected && expected.existing) await c.query('CREATE VIEW ' + ('view' in fixture ? fixture.view : '') + ' AS SELECT 1')
      const limit = 'limit' in expected ? expected.limit : 64
      await c.query('SET max_error_count=?', [limit])
      await c.query(fixture.seed)
      const parameters = 'params' in expected ? parametersOf(expected.params) : []
      const actual = await observe(c, sql, api, parameters, 'headers' in expected)
      let data: unknown = null
      if ('definitions' in fixture && 'kind' in expected) {
        const name = expected.kind === 'VIEW' ? fixture.definitions.view : fixture.definitions.table
        try {
          const [rows] = await c.query<RowDataPacket[]>('SHOW CREATE ' + expected.kind + ' ' + name)
          data = rows[0]![1]
        } catch (error) {
          if ((error as QueryError).errno !== 1146) throw error
        }
      } else if ('inspect' in fixture) {
        const [rows, fields] = await c.query(fixture.inspect)
        data = { rows: rowsOf(rows), fields: fieldsOf(fields ?? []) }
      } else if ('view' in fixture) data = await storedView(c, fixture.view)
      assert.deepEqual({ ...actual, ...('before' in expected ? { before: expected.before } : {}), ...('limit' in expected ? { limit } : {}), ...('existing' in expected ? { existing: expected.existing } : {}), ...('view' in fixture || 'inspect' in fixture || 'definitions' in fixture ? { data } : {}), ...('type' in expected ? { type: expected.type } : {}), ...('kind' in expected ? { kind: expected.kind } : {}), ...('params' in expected ? { params: expected.params } : {}) }, expected, `${sql} [${api}]`)
      if (!('reuse' in fixture) || !fixture.reuse) c.unprepare(sql)
    }
  } finally {
    if (created) await c.query('DROP DATABASE ' + schema)
    await c.end()
    await db?.end()
  }
})

test('M5.10: EXPLAIN of an unproved OFFSET wrapper does not evaluate its skipped projection', async () => {
  const { c, db } = await connection()
  const sql = 'EXPLAIN FORMAT=TREE SELECT q.id,SUM(q.d) OVER (PARTITION BY q.id) AS v FROM ((SELECT 0 AS id,CAST(LAST_INSERT_ID(LAST_INSERT_ID()+1) AS DOUBLE) AS d) LIMIT 1 OFFSET 1) q ORDER BY q.id'
  try {
    for (const api of ['query', 'execute']) {
      await c.query('SELECT LAST_INSERT_ID(0)')
      const result = await observe(c, sql, api) as { error?: { errno: number }; rows?: unknown }
      // The existing local plan refusal remains open; it must not gain effects.
      if (result.error) assert.equal(result.error.errno, 1235)
      else assert.match(String(result.rows), /^-> Zero rows/)
      const [rows] = await c.query<RowDataPacket[]>('SELECT LAST_INSERT_ID()')
      assert.equal(Number(rows[0]![0]), 0, api)
      c.unprepare(sql)
    }
  } finally {
    await c.end()
    await db?.end()
  }
})

for (const fixture of [windowPlanningPlans, materializationPlans, implicitPlans, wrapperPlans]) test('M5.10: constant-input plan structure and fields match native: ' + fixture.schema, async () => {
  const { c, db } = await connection()
  const withoutCosts = (rows: unknown) => Array.isArray(rows) ? rows.map((row: unknown) => Array.isArray(row) ? row.map((cell: unknown) => typeof cell === 'string' ? cell.replace(/ {2}\(cost=[^)]*\)/g, '') : cell) : row) : rows
  let created = false
  try {
    await c.query('CREATE DATABASE ' + fixture.schema)
    created = true
    await c.query('USE ' + fixture.schema)
    await c.query('SET sql_mode=?', [fixture.sqlMode])
    for (const sql of fixture.setup) await c.query(sql)
    for (const expected of fixture.observations) {
      const params = 'params' in expected ? expected.params : []
      await c.query(fixture.seed)
      const actual = await observe(c, expected.sql, expected.api, params)
      assert.deepEqual({ rows: withoutCosts('rows' in actual ? actual.rows : undefined), fields: 'fields' in actual ? actual.fields : undefined }, { rows: withoutCosts(expected.rows), fields: expected.fields }, expected.sql)
    }
  } finally {
    if (created) await c.query('DROP DATABASE ' + fixture.schema)
    await c.end()
    await db?.end()
  }
})

for (const [name, fixture] of [['view target presence', effects], ['view CHECK OPTION', checkEffects], ['view projection CHECK OPTION', projectionEffects]] as const) test('M5.10: ' + name + ' preserves transactions and PREPARE has no effects', async () => {
  const { c, db } = await connection()
  const { schema } = fixture
  const target = 'view' in fixture ? fixture.view : 'v255'
  let created = false
  try {
    assert.equal(fixture.mysqlVersion, '8.4.11')
    if (!db) assert.equal(String((await c.query<RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], fixture.mysqlVersion)
    await c.query('CREATE DATABASE ' + schema)
    created = true
    await c.query('CREATE TABLE ' + schema + '.t(id INT PRIMARY KEY)')
    if ('useSchema' in fixture && fixture.useSchema) await c.query('USE ' + schema)
    await c.query('SET sql_mode=?', [fixture.sqlMode])
    let id = 0
    for (const expected of fixture.observations) {
      const { sql, api } = expected
      c.unprepare(sql)
      await c.query('DELETE FROM ' + schema + '.t')
      await c.query('DROP VIEW IF EXISTS ' + schema + '.' + target)
      if ('existing' in expected && expected.existing) await c.query('CREATE VIEW ' + schema + '.' + target + ' AS SELECT 7')
      await c.query('BEGIN')
      const inserted = 'id' in expected ? expected.id : ++id
      await c.query('INSERT INTO ' + schema + '.t VALUES (' + inserted + ')')
      await c.query(fixture.seed)
      const actual = await observe(c, sql, api)
      c.unprepare(sql)
      await c.query('ROLLBACK')
      const [data] = await c.query('SELECT id FROM ' + schema + '.t ORDER BY id')
      const [views] = await c.query("SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA='" + schema + "' AND TABLE_NAME='" + target + "'")
      const definition = 'definition' in expected ? (await storedView(c, target))?.definition ?? null : undefined
      assert.deepEqual({ ...actual, data, views, ...('existing' in expected ? { existing: expected.existing, definition, id: inserted } : {}) }, expected, `${sql} [${api}]`)
    }
  } finally {
    if (created) await c.query('DROP DATABASE ' + schema)
    await c.end()
    await db?.end()
  }
})

test('M5.10: view fallback follows prepared instance lifetime across connections', async () => {
  const { c, db } = await connection()
  const peer = await driver(db)
  const { schema } = mergeReuse
  const [first, second] = mergeReuse.observations
  let created = false
  try {
    await c.query('CREATE DATABASE ' + schema)
    created = true
    for (const client of [c, peer]) {
      await client.query('USE ' + schema)
      await client.query('SET max_error_count=0')
      await client.query('SET sql_mode=?', [mergeReuse.sqlMode])
    }
    for (const [client, expected, reprepare] of [[c, first!, false], [peer, first!, false], [c, second!, false], [peer, second!, false], [c, first!, true]] as const) {
      if (reprepare) c.unprepare(expected.sql)
      await client.query(mergeReuse.seed)
      const actual = await observe(client, expected.sql, expected.api)
      const data = await storedView(client, mergeReuse.view)
      assert.deepEqual({ ...actual, limit: 0, existing: false, data }, expected)
    }
  } finally {
    await peer.end()
    if (created) await c.query('DROP DATABASE ' + schema)
    await c.end()
    await db?.end()
  }
})

test('M5.10: writer retry retains the first prepared view fallback warning', async () => {
  const { c, db } = await connection()
  const peer = await driver(db)
  const { schema } = mergeReuse
  let created = false
  try {
    await c.query('CREATE DATABASE ' + schema)
    created = true
    for (const client of [c, peer]) {
      await client.query('USE ' + schema)
      await client.query('SET max_error_count=0')
    }
    await c.query('CREATE TABLE busy256(a INT)')
    await c.query('BEGIN')
    await c.query('INSERT INTO busy256 VALUES(1)')
    const release = new Promise<void>((resolve, reject) => {
      setTimeout(() => { void c.query('COMMIT').then(() => resolve(), reject) }, 50)
    })
    const expected = mergeReuse.observations[0]!
    const [actual] = await Promise.all([observe(peer, expected.sql, expected.api), release])
    const data = await storedView(peer, mergeReuse.view)
    assert.deepEqual({ ...actual, limit: 0, existing: false, data }, expected)
    const second = mergeReuse.observations[1]!
    assert.deepEqual({ ...await observe(peer, second.sql, second.api), limit: 0, existing: false, data: await storedView(peer, mergeReuse.view) }, second)
  } finally {
    await peer.end()
    await c.query('ROLLBACK')
    if (created) await c.query('DROP DATABASE ' + schema)
    await c.end()
    await db?.end()
  }
})
