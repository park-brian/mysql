import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2/promise'
import type { QueryError, RowDataPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import fixture from './fixtures/diagnostics/cte-demand.json' with { type: 'json' }

const fieldsOf = (fields: readonly mysql.FieldPacket[]) => fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

test('M5.10: CTE admission follows demand, lexical scope and source order', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const c = await mysql.createConnection({
    stream: db ? db.createStream() : connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }),
    user: 'root', ...(db ? {} : { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }), rowsAsArray: true,
  })
  try {
    assert.equal(fixture.mysqlVersion, '8.4.11')
    if (!db) assert.equal(String((await c.query<RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], fixture.mysqlVersion)
    await c.query('SET sql_mode=?', [fixture.sqlMode])
    for (const expected of fixture.observations) {
      const { sql, api } = expected
      c.unprepare(sql)
      await c.query(fixture.seed)
      let result: object
      try {
        if (api === 'prepare') {
          const prepared = await c.prepare(sql)
          try {
            const { statement } = prepared as mysql.PreparedStatementInfo & { statement: { parameters: mysql.FieldPacket[]; columns: mysql.FieldPacket[] } }
            result = { parameters: fieldsOf(statement.parameters), fields: fieldsOf(statement.columns) }
          }
          finally { await prepared.close(); c.unprepare(sql) }
        } else {
          const [rows, fields] = api === 'query' ? await c.query(sql) : await c.execute(sql)
          result = { rows, fields: fieldsOf(fields) }
        }
      } catch (e) {
        const error = e as QueryError & { sqlMessage?: string }
        result = { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage } }
      }
      const [warnings] = await c.query('SHOW WARNINGS')
      const warningCount = String((await c.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]![0])
      const errorCount = String((await c.query<RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]![0])
      assert.deepEqual({ sql, api, ...result, warnings, warningCount, errorCount }, expected, `${sql} [${api}]`)
      c.unprepare(sql)
    }
  } finally { await c.end(); await db?.end() }
})
