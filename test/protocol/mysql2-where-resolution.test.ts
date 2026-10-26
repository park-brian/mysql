import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import reference from './fixtures/diagnostics/where-resolution.json' with { type: 'json' }

test('WHERE resolution preserves native clause precedence, written short circuits and prepared binding', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  const descriptors = (list: readonly mysql.FieldPacket[]) => list.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, 751)
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE where_resolution')
    await conn.query('USE where_resolution')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,n INT DEFAULT 0)')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    let filled = false
    for (const entry of reference.observations) {
      const { sql, api } = entry
      if (entry.filled !== filled) {
        await conn.query('TRUNCATE TABLE a')
        if (entry.filled) await conn.query('INSERT INTO a(id) VALUES(1),(2)')
        filled = entry.filled
      }
      if ('before' in entry) await conn.query(entry.before)
      await conn.query('DO 1/0')
      const prior = (await conn.query('SHOW WARNINGS'))[0]
      let rows: unknown = null
      let fields: unknown = null
      let error: unknown = null
      const options = { sql, rowsAsArray: true }
      try {
        if (api === 'prepare') {
          const statement = await conn.prepare(options)
          fields = descriptors((statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns)
          await statement.close()
        } else {
          const [result, columns] = api === 'execute' ? await conn.execute(options, 'params' in entry ? entry.params : []) : await conn.query(options)
          rows = result
          fields = descriptors(columns)
        }
      } catch (e) {
        const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
        error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
      } finally {
        if (api !== 'query' && !('retain' in entry && entry.retain)) conn.unprepare(options)
      }
      const warnings = (await conn.query('SHOW WARNINGS'))[0]
      const warningCount = Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0]
      const errorCount = Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0]
      assert.deepEqual(canonical({ prior, rows, fields, error, warnings, warningCount, errorCount }), reference.outcomes[entry.outcome], `${api}: filled=${filled}: ${sql}`)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS where_resolution')
    await conn.end()
    await db?.end()
  }
})
