import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2/promise'
import type { QueryError, RowDataPacket } from 'mysql2'
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

async function observe(c: mysql.Connection, sql: string, api: string) {
  let result: object
  try {
    if (api === 'prepare') {
      const prepared = await c.prepare(sql)
      try {
        const { statement } = prepared as mysql.PreparedStatementInfo & { statement: { parameters: mysql.FieldPacket[]; columns: mysql.FieldPacket[] } }
        result = { parameters: fieldsOf(statement.parameters), fields: fieldsOf(statement.columns) }
      } finally { await prepared.close(); c.unprepare(sql) }
    } else {
      const [rows, fields] = api === 'query' ? await c.query(sql) : await c.execute(sql)
      result = fields === undefined ? { header: { ...rows } } : { rows: rowsOf(rows), fields: fieldsOf(fields) }
    }
  } catch (e) {
    const error = e as QueryError & { sqlMessage?: string }
    result = { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage } }
  }
  const [warnings] = await c.query('SHOW WARNINGS')
  const warningCount = String((await c.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]![0])
  const errorCount = String((await c.query<RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]![0])
  return { sql, api, ...result, warnings, warningCount, errorCount }
}

for (const [name, fixture] of [['nonrecursive', nonrecursive], ['recursive', recursive], ['order', order], ['names', names], ['spelling', spelling], ['view-target-no-db', noDatabase], ['view-target-controls', controls], ['view-merge', merge], ['view-merge-reuse', mergeReuse], ['view-check', check], ['view-check-reuse', checkReuse], ['view-check-projections', projections], ['view-check-projection-reuse', projectionReuse], ['view-check-fields-admission', fieldAdmission], ['view-updatability', updatability], ['view-updatability-types', updatabilityTypes], ['unary-plus-print', plusPrint], ['unary-plus-diagnostics', plusDiagnostics], ['unary-plus-diagnostic-reuse', plusReuse]] as const) test('M5.10: SQL admission matches native: ' + name, async () => {
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
      if ('table' in fixture && 'type' in expected) {
        await c.query('DROP TABLE ' + fixture.table)
        await c.query('CREATE TABLE ' + fixture.table + '(a ' + expected.type + ')')
      }
      if ('existing' in expected && expected.existing) await c.query('CREATE VIEW ' + ('view' in fixture ? fixture.view : '') + ' AS SELECT 1')
      const limit = 'limit' in expected ? expected.limit : 64
      await c.query('SET max_error_count=?', [limit])
      await c.query(fixture.seed)
      const actual = await observe(c, sql, api)
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
      assert.deepEqual({ ...actual, ...('limit' in expected ? { limit } : {}), ...('existing' in expected ? { existing: expected.existing } : {}), ...('view' in fixture || 'inspect' in fixture || 'definitions' in fixture ? { data } : {}), ...('type' in expected ? { type: expected.type } : {}), ...('kind' in expected ? { kind: expected.kind } : {}) }, expected, `${sql} [${api}]`)
      if (!('reuse' in fixture) || !fixture.reuse) c.unprepare(sql)
    }
  } finally {
    if (created) await c.query('DROP DATABASE ' + schema)
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
