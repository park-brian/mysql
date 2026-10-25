import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import reference from './fixtures/diagnostics/variable-admission.json' with { type: 'json' }

test('system-variable identity and admission retain native error precedence and command diagnostics', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:', { multipleStatements: true }) : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', multipleStatements: true }
    : { stream: db.createStream(), user: 'root', multipleStatements: true })
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, 381)
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE variable_admission')
    await conn.query('USE variable_admission')
    await conn.query('CREATE TABLE a(id INT)')
    for (const entry of reference.observations) {
      const { sql, api, mode, seed } = entry
      await conn.query('SET sql_mode=?', [mode])
      if ('charset' in entry) await conn.query('SET NAMES ' + entry.charset)
      try { await conn.query(seed) } catch { /* Seeded errors are deliberate. */ }
      const prior = (await conn.query('SHOW WARNINGS'))[0]
      let rows: unknown = null
      let fields: unknown = null
      let error: unknown = null
      const options = { sql, rowsAsArray: true }
      const descriptors = (list: readonly mysql.FieldPacket[]) => list.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
      try {
        if (api === 'prepare') {
          const statement = await conn.prepare(options)
          fields = descriptors((statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns)
          await statement.close()
        } else {
          const [result, columns] = api === 'execute' ? await conn.execute(options) : await conn.query(options)
          const ok = result as mysql.ResultSetHeader
          rows = Array.isArray(result) ? result : { affectedRows: ok.affectedRows, insertId: ok.insertId, warningStatus: ok.warningStatus, info: ok.info, serverStatus: ok.serverStatus, fieldCount: ok.fieldCount }
          fields = columns === undefined ? null : descriptors(columns)
        }
      } catch (e) {
        const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
        error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
      } finally {
        if (api !== 'query') conn.unprepare(options)
      }
      const warnings = (await conn.query('SHOW WARNINGS'))[0]
      const warningCount = Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0]
      const errorCount = Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0]
      assert.deepEqual(canonical({ prior, rows, fields, error, warnings, warningCount, errorCount }), reference.outcomes[entry.outcome], `${api}: ${mode}: ${sql}`)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS variable_admission')
    await conn.end()
    await db?.end()
  }
})
