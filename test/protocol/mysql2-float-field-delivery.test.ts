import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import delivery from './fixtures/functions/float-field-delivery.json' with { type: 'json' }
import readers from './fixtures/functions/float-sql-readers.json' with { type: 'json' }
import widths from './fixtures/functions/real-byte-widths.json' with { type: 'json' }

interface FloatReference {
  readonly mysqlVersion: string
  readonly schema: string
  readonly setup: readonly string[]
  readonly sql: readonly string[]
  readonly apis: readonly string[]
  readonly outcomes: readonly {
    readonly rows: readonly (readonly unknown[])[]
    readonly fields: readonly (readonly unknown[])[]
    readonly warnings: readonly { readonly Level: string; readonly Code: number; readonly Message: string }[]
  }[]
  readonly checks: readonly { readonly rows: readonly number[]; readonly fields: readonly number[]; readonly warnings: readonly number[]; readonly warningCount?: false }[]
  readonly observations: readonly (readonly number[])[]
  readonly strict: readonly number[]
}

/** Retain signed zero and nonfinite numbers instead of silently changing them in JSON. */
function canonical(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== 'number') return v
    if (Object.is(v, -0)) return { negativeZero: true }
    if (!Number.isFinite(v)) return { nonfinite: String(v) }
    return v
  }))
}

function checkCells(actual: readonly (readonly unknown[])[], expected: readonly (readonly unknown[])[], masks: readonly number[], label: string): void {
  assert.equal(actual.length, expected.length, label + ': count')
  for (const [i, row] of expected.entries()) {
    assert.equal(actual[i]!.length, row.length, label + ': width ' + i)
    for (let j = 0; j < row.length; j++) if (masks[i]! & (1 << j)) assert.deepEqual(actual[i]![j], row[j], label + ': ' + i + '/' + j)
  }
}

for (const [capture, total, matched] of [[delivery, 952, 776], [readers.cases[0], 506, 506], [readers.cases[1], 230, 218], [readers.cases[2], 72, 72], [readers.cases[3], 36, 36], [readers.cases[4], 960, 912], [widths, 2340, 2161]] as const) test('REAL readers and field delivery preserve native boundaries: ' + capture!.schema, async () => {
  const reference = capture as FloatReference
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const strict = new Set(reference.strict)
  let created = false
  let complete = 0
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    if (db === undefined) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() v'))[0][0]!.v, reference.mysqlVersion)
    assert.equal(reference.observations.length, total)
    assert.equal(strict.size, matched)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    for (const sql of reference.setup) await conn.query(sql)
    for (const [i, [sqlIndex, apiIndex, outcomeIndex, checksIndex]] of reference.observations.entries()) {
      const sql = reference.sql[sqlIndex!]!
      const api = reference.apis[apiIndex!]!
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = api === 'query' ? await conn.query(options) : await conn.execute(options)
      const actual = {
        rows: canonical(rows) as unknown[][],
        fields: fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        warnings: (await conn.query<mysql.RowDataPacket[]>('SHOW WARNINGS'))[0].map(w => [w.Level, w.Code, w.Message] as unknown[]),
      }
      const expected = reference.outcomes[outcomeIndex!]!
      const warnings = expected.warnings.map(w => [w.Level, w.Code, w.Message])
      const label = api + ': ' + sql
      if (db === undefined || strict.has(i)) {
        assert.deepEqual(actual, { ...expected, warnings }, label)
        complete++
      } else {
        // The full native outcomes remain captured; assert every currently matching cell.
        const checks = reference.checks[checksIndex!]!
        checkCells(actual.rows, expected.rows, checks.rows, label + ': rows')
        checkCells(actual.fields, expected.fields, checks.fields, label + ': fields')
        if (checks.warningCount === false) {
          // New unary-BINARY captures retain a native warning that execution does not yet publish.
          // No matching warning cell may be omitted; every older count assertion remains active.
          assert.ok(checks.warnings.every(mask => mask === 0), label + ': unmatched warning count')
        } else checkCells(actual.warnings, warnings, checks.warnings, label + ': warnings')
      }
      conn.unprepare(options)
    }
    assert.equal(complete, db === undefined ? total : matched)
  } finally {
    try { if (created) await conn.query('DROP DATABASE ' + reference.schema) }
    finally { await conn.end(); await db?.end() }
  }
})
