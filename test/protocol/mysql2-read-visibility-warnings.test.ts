// M5.47/M5.53: native read failures retain their physical key and condition totals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql, { type Connection, type FieldPacket, type QueryError } from 'mysql2'
import { MySQL } from '@myjs/core'
import fixture from './fixtures/antijoin/read-visibility-warnings.json' with { type: 'json' }
// @ts-expect-error — use the reference's normalization without its runner.
import { planSkeleton } from '../../tools/capture-relational.mjs'

const host = process.env.MYSQL_REFERENCE_HOST
const facts = (fields: readonly FieldPacket[]) => fields.map((f) =>
  [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
type Outcome = Record<string, unknown>

async function connections(schema: string) {
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const options = () => ({
    ...(db === undefined ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : { stream: db.createStream() }),
    user: 'root',
  })
  const raw = mysql.createConnection(options()), a = raw.promise(), b = mysql.createConnection(options()).promise()
  if (host !== undefined) assert.equal((await a.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]?.v.split('-')[0], fixture.mysqlVersion)
  await b.query('CREATE DATABASE ' + schema); await b.query('USE ' + schema); await a.query('USE ' + schema)
  await b.query('CREATE TABLE anchor(id INT PRIMARY KEY)'); await b.query('INSERT INTO anchor VALUES(1)')
  return {
    raw, a, b,
    async close() {
      await a.rollback(); await a.end()
      await b.query('DROP DATABASE IF EXISTS ' + schema); await b.end(); await db?.end()
    },
  }
}

async function command(raw: Connection, method: string, sql: string): Promise<Outcome> {
  const fieldEvents: unknown[] = []
  const answer = await new Promise<Outcome>((resolve) => {
    const callback = (error: (QueryError & { sqlMessage?: string }) | null, rows?: unknown, fields?: FieldPacket[]) => resolve(error
      ? { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage ?? error.message }, fieldEvents }
      : { rows, fields: facts(fields ?? []), fieldEvents })
    const query = method === 'execute' ? raw.execute(sql, [], callback) : raw.query({ sql, rowsAsArray: true }, callback)
    query.on('fields', (fields: FieldPacket[]) => fieldEvents.push(facts(fields)))
  })
  const a = raw.promise()
  answer.warnings = (await a.query('SHOW WARNINGS'))[0]
  answer.warningCount = Object.values((await a.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0]
  answer.errorCount = Object.values((await a.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0]
  return answer
}

test('retained-view warnings identify the actual clustered or secondary read', async () => {
  assert.equal(fixture.mysqlVersion, '8.4.11')
  assert.equal(fixture.indexes.length, 50)
  for (const sample of fixture.indexes) {
    const { raw, a, b, close } = await connections('warning224_index')
    let prepared: Awaited<ReturnType<typeof a.prepare>> | undefined
    try {
      await b.query('CREATE TABLE t(' + sample.definition + ')'); await b.query('INSERT INTO t VALUES(1,1,2),(2,1,3)')
      if (host !== undefined) {
        const [indexes] = await b.query<mysql.RowDataPacket[]>('SHOW INDEX FROM t')
        assert.deepEqual(indexes.map((r) => [r.Key_name, r.Seq_in_index, r.Column_name, r.Non_unique]), sample.indexes)
      }
      const sql = 'SELECT * FROM t' + (sample.access === 'g' ? ' FORCE INDEX(g) WHERE g=1' : '')
      if (sample.method === 'execute') prepared = await a.prepare(sql)
      await a.query('START TRANSACTION WITH CONSISTENT SNAPSHOT'); await a.query('SELECT * FROM anchor')
      await b.query('TRUNCATE t'); await b.query('INSERT INTO t VALUES(1,1,2),(2,1,3)')
      const [plan] = await a.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(plan[0]?.EXPLAIN), planSkeleton(sample.plan), sample.name + ':' + sample.access)
      const actual = await command(raw, sample.method, sql)
      assert.deepEqual(actual.error, sample.error, sample.name)
      assert.deepEqual(actual.warnings, sample.warnings, sample.name + ':' + sample.access)
      assert.equal(actual.warningCount, 2); assert.equal(actual.errorCount, 1)
    } finally {
      await a.rollback(); await prepared?.close(); await close()
    }
  }
})

test('read warnings retain prefix caps, full totals and once-only streamed publication', async () => {
  assert.equal(fixture.conditions.length, 18)
  assert.equal(fixture.baselineConditions.length, 18)
  for (let i = 0; i < fixture.conditions.length; i++) {
    const sample = fixture.conditions[i]!, baseline = fixture.baselineConditions[i]!
    const { raw, a, b, close } = await connections('warning224_conditions')
    let prepared: Awaited<ReturnType<typeof a.prepare>> | undefined
    try {
      await b.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name))')
      await b.query("INSERT INTO pa VALUES(1,'one',NULL)")
      await b.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g))'); await b.query('INSERT INTO ch VALUES(1,1),(2,1)')
      await a.query('SET optimizer_switch=' + mysql.escape(sample.shape === 'dependent-null' ? 'default,semijoin=off' : 'default,materialization=off'))
      await a.query('SET max_error_count=' + sample.limit)
      if (sample.method === 'execute') prepared = await a.prepare(sample.sql)
      await a.query('START TRANSACTION WITH CONSISTENT SNAPSHOT'); await a.query('SELECT * FROM anchor')
      await b.query('TRUNCATE ch'); await b.query('INSERT INTO ch VALUES(1,1),(2,1)')
      for (let round = 0; round < sample.rounds.length; round++) {
        const actual = await command(raw, sample.method, sample.sql)
        const expected = sample.rounds[round]!, prior = baseline.rounds[round]!
        assert.deepEqual(actual.error, expected.error)
        assert.deepEqual(actual.warnings, expected.warnings)
        assert.equal(actual.warningCount, expected.warningCount); assert.equal(actual.errorCount, expected.errorCount)
        assert.deepEqual(actual.fieldEvents, host !== undefined || sample.shape === 'dependent-null' ? expected.fieldEvents : prior.fieldEvents)
      }
      if ('current' in sample && 'current' in baseline) {
        // Native locking reads after TRUNCATE expose a separate visibility gap;
        // retain its full native capture and the predecessor's whole response.
        const actual = await command(raw, sample.method, sample.sql + ' FOR UPDATE')
        assert.deepEqual(actual, host !== undefined ? sample.current : baseline.current)
      }
    } finally {
      await a.rollback(); await prepared?.close(); await close()
    }
  }
})
