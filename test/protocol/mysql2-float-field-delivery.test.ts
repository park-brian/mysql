import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import delivery from './fixtures/functions/float-field-delivery.json' with { type: 'json' }
import readers from './fixtures/functions/float-sql-readers.json' with { type: 'json' }
import widths from './fixtures/functions/real-byte-widths.json' with { type: 'json' }
import copies from './fixtures/functions/real-string-copies.json' with { type: 'json' }
import blobs from './fixtures/functions/real-blob-copies.json' with { type: 'json' }
import parentheses from './fixtures/functions/set-parentheses-expanded.json' with { type: 'json' }
import nonnull from './fixtures/functions/set-parentheses-notnull.json' with { type: 'json' }

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
  readonly checks: readonly { readonly rows: readonly number[]; readonly fields: readonly number[]; readonly warnings: readonly number[]; readonly rowCount?: false; readonly missingRows?: readonly number[]; readonly unorderedRows?: true; readonly warningCount?: false }[]
  readonly observations: readonly (readonly number[])[]
  readonly strict: readonly number[]
  readonly deferred?: readonly number[]
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

function checkCells(actual: readonly (readonly unknown[])[], expected: readonly (readonly unknown[])[], masks: readonly number[], label: string, count = true, missing: readonly number[] = []): void {
  if (count) assert.equal(actual.length, expected.length, label + ': count')
  for (const [i, row] of expected.entries()) {
    // Only a recorded missing row can be absent; masked values still retain their row width.
    if (!count && missing.includes(i) && actual[i] === undefined) {
      assert.equal(masks[i], 0, label + ': missing row has a matching cell ' + i)
      continue
    }
    assert.equal(actual[i]?.length, row.length, label + ': width ' + i)
    for (let j = 0; j < row.length; j++) if (masks[i]! & (1 << j)) assert.deepEqual(actual[i]![j], row[j], label + ': ' + i + '/' + j)
  }
}

test('partial REAL comparisons retain present rows even when every value is masked', () => {
  const expected = [[1], [2]]
  checkCells([[3]], expected, [0, 0], 'recorded missing', false, [1])
  checkCells([[3], [2]], expected, [0, 0], 'missing row repaired', false, [1])
  assert.throws(() => checkCells([], expected, [0, 0], 'present row lost', false, [1]), /width 0/)
  assert.throws(() => checkCells([[3]], expected, [0, 0], 'unrecorded missing', false), /width 1/)
  assert.throws(() => checkCells([[3]], expected, [0, 1], 'matching cell lost', false, [1]), /matching cell/)
})

for (const [capture, total, matched] of [[delivery, 952, 776], [readers.cases[0], 506, 506], [readers.cases[1], 230, 218], [readers.cases[2], 72, 72], [readers.cases[3], 36, 36], [readers.cases[4], 960, 960], [widths, 2340, 2293], [copies, 3664, 3568], [blobs, 1368, 1224], [parentheses, 10368, 10224], [nonnull, 27648, 27360]] as const) test('REAL readers and field delivery preserve native boundaries: ' + capture!.schema, async () => {
  const reference = capture as FloatReference
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const strict = new Set(reference.strict)
  const deferred = new Set(reference.deferred)
  let created = false
  let complete = 0
  let repaired = 0
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    if (db === undefined) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() v'))[0][0]!.v, reference.mysqlVersion)
    assert.equal(reference.observations.length, total)
    assert.equal(strict.size, matched)
    assert.equal(deferred.size, reference.schema === 'blob240' ? 24 : 0)
    await conn.query('CREATE DATABASE ' + reference.schema)
    created = true
    await conn.query('USE ' + reference.schema)
    for (const sql of reference.setup) await conn.query(sql)
    for (const [i, [sqlIndex, apiIndex, outcomeIndex, checksIndex]] of reference.observations.entries()) {
      const sql = reference.sql[sqlIndex!]!
      const api = reference.apis[apiIndex!]!
      const options = { sql, rowsAsArray: true }
      const observed = await (api === 'query' ? conn.query(options) : conn.execute(options)).catch((error: unknown) => {
        // Correlated source-free DEFAULT is recorded natively; its binding remains unsupported.
        if (db === undefined || !deferred.has(i)) throw error
        assert.ok(error !== null && typeof error === 'object' && 'code' in error)
        assert.equal(error.code, 'ER_NOT_SUPPORTED_YET', api + ': ' + sql)
        return undefined
      })
      if (observed === undefined) { conn.unprepare(options); continue }
      const [rows, fields] = observed
      const actual = {
        rows: canonical(rows) as unknown[][],
        fields: fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        warnings: (await conn.query<mysql.RowDataPacket[]>('SHOW WARNINGS'))[0].map(w => [w.Level, w.Code, w.Message] as unknown[]),
      }
      const expected = reference.outcomes[outcomeIndex!]!
      const warnings = expected.warnings.map(w => [w.Level, w.Code, w.Message])
      const label = api + ': ' + sql
      if (db === undefined || strict.has(i) || deferred.has(i)) {
        assert.deepEqual(actual, { ...expected, warnings }, label)
        complete++
        if (db !== undefined && deferred.has(i)) repaired++
      } else {
        // The full native outcomes remain captured; assert every currently matching cell.
        const checks = reference.checks[checksIndex!]!
        checkCells(actual.rows, expected.rows, checks.rows, label + ': rows', checks.rowCount !== false, checks.missingRows)
        // Preserve correct values in the recorded grouped-order gaps without changing native order.
        if (checks.unorderedRows === true) assert.deepEqual(actual.rows.map(row => JSON.stringify(row)).sort(), expected.rows.map(row => JSON.stringify(row)).sort(), label + ': row bag')
        checkCells(actual.fields, expected.fields, checks.fields, label + ': fields')
        if (checks.warningCount === false) {
          // New unary-BINARY captures retain a native warning that execution does not yet publish.
          // No matching warning cell may be omitted; every older count assertion remains active.
          assert.ok(checks.warnings.every(mask => mask === 0), label + ': unmatched warning count')
        } else checkCells(actual.warnings, warnings, checks.warnings, label + ': warnings')
      }
      conn.unprepare(options)
    }
    assert.equal(complete, db === undefined ? total : matched + repaired)
  } finally {
    try { if (created) await conn.query('DROP DATABASE ' + reference.schema) }
    finally { await conn.end(); await db?.end() }
  }
})
