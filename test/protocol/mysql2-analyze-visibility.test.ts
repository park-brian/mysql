// Statistics updates retain the catalog's physical table identity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql, { type FieldPacket, type QueryError } from 'mysql2'
import { MySQL } from '@myjs/core'
import reference from './fixtures/catalog/analyze-visibility.json' with { type: 'json' }

const host = process.env.MYSQL_REFERENCE_HOST
const facts = (fields: readonly FieldPacket[]) => fields.map((f) =>
  [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

test('ANALYZE keeps retained data visible, while physical replacement keeps native errors and field publication', async () => {
  assert.equal(reference.mysqlVersion, '8.4.11')
  assert.equal(reference.cases.length, 40)
  for (const sample of reference.cases) {
    const db = host === undefined ? await MySQL.open(':memory:') : undefined
    const options = () => ({
      ...(db === undefined ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : { stream: db.createStream() }),
      user: 'root',
    })
    const raw = mysql.createConnection(options()), a = raw.promise(), b = mysql.createConnection(options()).promise()
    try {
      if (host !== undefined) assert.equal((await a.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]?.v.split('-')[0], reference.mysqlVersion)
      await b.query('CREATE DATABASE analyze_visibility')
      await a.query('USE analyze_visibility'); await b.query('USE analyze_visibility')
      await b.query('CREATE TABLE anchor(id INT PRIMARY KEY)'); await b.query('INSERT INTO anchor VALUES(1)')
      const create = () => b.query('CREATE TABLE t(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
      await create(); await b.query('INSERT INTO t VALUES(1,1)'); await b.query('ANALYZE TABLE t')
      await a.query('SET SESSION TRANSACTION ISOLATION LEVEL ' + sample.isolation)
      await a.query('BEGIN')
      if (sample.view === 'active') await a.query('SELECT * FROM anchor')
      await b.query('UPDATE t SET g=2'); await b.query('INSERT INTO t VALUES(2,2)')
      await b.query('ANALYZE TABLE t'); await b.query('ANALYZE TABLE t')
      if (sample.mutation === 'truncate') { await b.query('TRUNCATE t'); await b.query('INSERT INTO t VALUES(3,3)') }
      else if (sample.mutation === 'rebuild') await b.query('ALTER TABLE t ADD COLUMN extra INT DEFAULT 0, ALGORITHM=COPY')
      else if (sample.mutation === 'drop-create') { await b.query('DROP TABLE t'); await create(); await b.query('INSERT INTO t VALUES(3,3)') }
      else if (sample.mutation === 'drop') await b.query('DROP TABLE t')
      if (sample.mutation !== 'drop') await b.query('ANALYZE TABLE t')
      const fieldEvents: unknown[] = []
      const actual: Record<string, unknown> = await new Promise((resolve) => {
        const callback = (error: (QueryError & { sqlMessage?: string }) | null, rows?: unknown, fields?: FieldPacket[]) => resolve(error
          ? { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage ?? error.message }, fieldEvents }
          : { rows, fields: facts(fields ?? []), fieldEvents })
        const sql = 'SELECT id,g FROM t ORDER BY id'
        const command = sample.method === 'execute' ? raw.execute(sql, [], callback) : raw.query({ sql, rowsAsArray: true }, callback)
        command.on('fields', (fields: FieldPacket[]) => fieldEvents.push(facts(fields)))
      })
      actual.warnings = (await a.query('SHOW WARNINGS'))[0]
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), sample.expected, JSON.stringify(sample))
    } finally {
      await a.rollback().catch(() => {})
      await a.end()
      await b.query('DROP DATABASE IF EXISTS analyze_visibility'); await b.end()
      await db?.end()
    }
  }
})
