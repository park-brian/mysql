// M5.47/M5.53: source visibility and column publication migrate together.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql, { type FieldPacket, type QueryError } from 'mysql2'
import { MySQL } from '@myjs/core'
import { SqlError } from '@myjs/protocol'
import fixture from './fixtures/antijoin/read-initialization.json' with { type: 'json' }
// @ts-expect-error — use the reference's plan normalization without its runner.
import { planSkeleton } from '../../tools/capture-relational.mjs'

const host = process.env.MYSQL_REFERENCE_HOST
const facts = (fields: readonly FieldPacket[]) => fields.map((f) =>
  [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
type Outcome = Record<string, unknown>
type QueryFailure = QueryError & { readonly sqlMessage?: string }
const normalized = (given: Outcome): Outcome => {
  const result = JSON.parse(JSON.stringify(given)) as Outcome
  if (typeof result.physicalPlan === 'string') result.physicalPlan = planSkeleton(result.physicalPlan)
  return result
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const schemas: Record<string, string> = {
  plain: 'dependent223_ddl', sorted: 'dependent223_sorted',
  sort4: 'dependent223_sorted4', constructors: 'dependent223_ctor',
  ordinal: 'readinit223_ordinal',
}

test('proved correlated sources validate retained views without losing headers or earlier facts', async () => {
  assert.equal(fixture.mysqlVersion, '8.4.11')
  assert.equal(fixture.cases.length, 240)
  assert.equal(fixture.outcomes, 240)
  let errorMatches = 0, headerMatches = 0, warningMatches = 0, completeMatches = 0
  for (const sample of fixture.cases) {
    const db = host === undefined ? await MySQL.open(':memory:') : undefined
    const options = () => ({
      ...(db === undefined ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : { stream: db.createStream() }),
      user: 'root',
    })
    const raw = mysql.createConnection(options())
    const a = raw.promise(), b = mysql.createConnection(options()).promise()
    let statement: Awaited<ReturnType<typeof a.prepare>> | undefined
    const schema = schemas[sample.group]!
    const constructor = sample.group === 'constructors'
    const four = constructor || sample.group === 'sort4' || sample.group === 'ordinal'
    const sql = 'SELECT ' + sample.projection + ' FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g)'
      + (constructor || sample.group === 'ordinal' ? sample.order : sample.group === 'plain' ? '' : ' ORDER BY name LIMIT 1')
    const createParent = () => b.query('CREATE TABLE pa(id ' + (constructor ? 'BIGINT UNSIGNED' : 'INT') + ' PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name))')
    const createInner = () => b.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g))')
    const parentValues = constructor
      ? Array.from({ length: 4 }, (_, i) => `(${18446744073709551612n + BigInt(i)},'n00${4 - i}',9)`).join(',')
      : four ? `(1,'n004',${sample.key ?? 'NULL'}),(2,'n003',1),(3,'n002',2),(4,'n001',9)`
        : `(1,'one',${sample.key ?? 'NULL'})`
    const fillParent = () => b.query('INSERT INTO pa VALUES' + parentValues)
    const fillInner = () => b.query('INSERT INTO ch VALUES(1,1),(2,1)')
    try {
      if (host !== undefined) assert.equal((await a.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]?.v.split('-')[0], fixture.mysqlVersion)
      await b.query('CREATE DATABASE ' + schema)
      await a.query('USE ' + schema); await b.query('USE ' + schema)
      await b.query('CREATE TABLE anchor(id INT PRIMARY KEY)'); await b.query('INSERT INTO anchor VALUES(1)')
      await createParent(); await fillParent(); await createInner(); await fillInner()
      await a.query('SET optimizer_switch=' + mysql.escape(sample.switches))
      await b.query('SET SESSION lock_wait_timeout=2')
      if (sample.method === 'execute') statement = await a.prepare(sql)
      await a.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      await a.query('SELECT * FROM anchor')
      const refill = sample.target === 'pa' ? fillParent : fillInner
      if (sample.mutation === 'truncate') {
        await b.query('TRUNCATE ' + sample.target); await refill()
      } else if (sample.mutation === 'drop-create') {
        await b.query('DROP TABLE ' + sample.target)
        await (sample.target === 'pa' ? createParent() : createInner()); await refill()
      } else if (sample.mutation === 'alter-copy') {
        await b.query('ALTER TABLE ' + sample.target + ' ADD COLUMN extra INT DEFAULT 0, ALGORITHM=COPY')
      } else if (sample.mutation === 'drop') await b.query('DROP TABLE ' + sample.target)
      const actual: Outcome = {}
      if (sample.group === 'sort4' || sample.group === 'ordinal') {
        try { actual.physicalPlan = (await a.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql))[0][0]?.EXPLAIN }
        catch (e) { actual.physicalPlan = { error: (e as QueryError).errno } }
      }
      const fieldEvents: unknown[] = []
      Object.assign(actual, await new Promise<Outcome>((resolve) => {
        const callback = (error: QueryFailure | null, rows?: unknown, fields?: FieldPacket[]) => resolve(error
          ? { error: { code: error.code, errno: error.errno, state: error.sqlState, message: error.sqlMessage ?? error.message }, fieldEvents }
          : { rows, fields: facts(fields ?? []), fieldEvents })
        const command = sample.method === 'execute' ? raw.execute(sql, [], callback) : raw.query({ sql, rowsAsArray: true }, callback)
        command.on('fields', (fields: FieldPacket[]) => fieldEvents.push(facts(fields)))
      }))
      actual.warnings = (await a.query('SHOW WARNINGS'))[0]
      const observed = normalized(actual)
      const expected = normalized(fixture.native[sample.native]! as Outcome)
      const previous = normalized(fixture.baseline[sample.baseline]! as Outcome)
      const label = [sample.group, sample.switches, sample.target, sample.mutation, sample.key, sample.method, sample.projection, sample.order].join(':')
      if (host !== undefined) assert.deepEqual(observed, expected, label)
      else {
        // Retain every whole native fact the predecessor already reproduced.
        for (const [key, value] of Object.entries(expected)) {
          if (Object.hasOwn(previous, key) && same(previous[key], value)) assert.deepEqual(observed[key], value, label + ':' + key)
        }
        const admitted = !constructor || (sample.projection === 'name' && sample.order !== ' ORDER BY id+1 LIMIT 1')
        if (admitted) {
          assert.deepEqual(observed, expected, label)
        } else {
          const { warnings, ...answer } = observed
          const { warnings: previousWarnings, ...priorAnswer } = previous
          assert.deepEqual(answer, priorAnswer, label + ': excluded phase profile')
          // Excluded constructors retain their primary/phase debt. A canonical
          // retained-view failure still publishes its native companion warning.
          const retained = (previous.error as { errno?: number } | undefined)?.errno === 1412
          const prefix = { Level: 'Warning', Code: 159, Message: `InnoDB: insufficient history for index ${sample.target === 'pa' ? 0 : 1}` }
          assert.deepEqual(warnings, retained ? [prefix, ...(previousWarnings as unknown[])] : previousWarnings, label)
        }
        errorMatches += Number(same(observed.error, expected.error))
        headerMatches += Number(same(observed.fieldEvents, expected.fieldEvents))
        warningMatches += Number(same(observed.warnings, expected.warnings))
        completeMatches += Number(Object.entries(expected).every(([key, value]) => same(observed[key], value)))
      }
    } finally {
      await a.rollback(); await statement?.close(); await a.end()
      await b.query('DROP DATABASE IF EXISTS ' + schema); await b.end(); await db?.end()
    }
  }
  if (host === undefined) {
    assert.equal(errorMatches, 228)
    assert.equal(headerMatches, 216)
    assert.equal(warningMatches, 228)
    assert.equal(completeMatches, 206)
  }
})

for (const switches of ['default,materialization=off', 'default,semijoin=off']) test('NULL validation uses the bound invocation and closes the parent on failure: ' + switches, { skip: host !== undefined }, async () => {
  const db = await MySQL.open(':memory:')
  const conn = mysql.createConnection({ stream: db.createStream(), user: 'root' }).promise()
  const open = db.catalog!.table.bind(db.catalog)
  let checks = 0, searches = 0, parentOpens = 0, parentCloses = 0
  let capable = true, fail = false
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g)'
  try {
    await conn.query('CREATE DATABASE readinit223_control'); await conn.query('USE readinit223_control')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name))')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g))')
    await conn.query("INSERT INTO pa VALUES(1,'one',NULL)"); await conn.query('INSERT INTO ch VALUES(1,1)')
    await conn.query('SET optimizer_switch=' + mysql.escape(switches))
    db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema !== 'readinit223_control') return table
      if (name === 'ch') {
        const validate = table.checkRead!.bind(table)
        if (capable) table.checkRead = (transaction, mode, index) => {
          checks++
          assert.ok(transaction, 'the execution transaction reaches the actual table')
          assert.equal(mode, 'consistent')
          assert.equal(index, 'g', 'the actual selected access reaches the bound table')
          validate(transaction, mode, index)
          if (fail) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected read validation failure')
        }
        else Object.defineProperty(table, 'checkRead', { value: undefined })
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(...args) { searches++; yield* scan(...args) }
      } else if (name === 'pa') {
        const scan = table.scan.bind(table)
        table.scan = function*(...args) {
          parentOpens++
          try { yield* scan(...args) } finally { parentCloses++ }
        }
      }
      return table
    }
    const prepared = await conn.prepare(sql)
    assert.equal(checks, 0, 'PREPARE binds without validating a read')
    const settled = (validations: number, reads: number) => {
      assert.deepEqual([checks, searches], [validations, reads])
      assert.ok(parentOpens > 0)
      assert.equal(parentCloses, parentOpens, 'every opened parent reader closed')
    }
    await prepared.execute([])
    settled(1, 0)
    fail = true
    await assert.rejects(prepared.execute([]), /injected read validation failure/)
    settled(2, 0)
    fail = false
    await conn.beginTransaction()
    await prepared.execute([])
    await conn.rollback()
    settled(3, 0)
    await prepared.close()
    capable = false
    await conn.query(sql)
    settled(3, 1) // An absent capability delegates to the original qualified reader.
  } finally {
    db.catalog!.table = open
    await conn.end(); await db.end()
  }
})

test('an inner table that shadows the parent name retains its independent reader', async () => {
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = mysql.createConnection({
    ...(db === undefined ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : { stream: db.createStream() }),
    user: 'root',
  }).promise()
  const open = db?.catalog!.table.bind(db.catalog)
  let checks = 0, visited = 0
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM pa WHERE pa.g=pa.g)'
  try {
    await conn.query('CREATE DATABASE dependent229_shadow')
    await conn.query('USE dependent229_shadow')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,KEY(g))')
    await conn.query("INSERT INTO pa VALUES(1,'null',NULL),(2,'one',1),(3,'two',1)")
    await conn.query('ANALYZE TABLE pa')
    await conn.query("SET optimizer_switch='default,semijoin=off'")
    if (db !== undefined && open !== undefined) db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema !== 'dependent229_shadow') return table
      const validate = table.checkRead!.bind(table)
      table.checkRead = (...args) => { checks++; validate(...args) }
      const scan = table.indexScan.bind(table)
      table.indexScan = function*(...args) { for (const row of scan(...args)) { visited++; yield row } }
      return table
    }
    for (const method of ['query', 'execute'] as const) {
      checks = visited = 0
      const options = { sql, rowsAsArray: true }
      const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, [])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      if (db !== undefined) {
        assert.equal(checks, 0, 'no dependent NULL validation role is granted to an independent source')
        assert.ok(visited > 1, 'the unproved independent source retains its qualified reader')
      }
      conn.unprepare(options)
    }
  } finally {
    if (db !== undefined && open !== undefined) db.catalog!.table = open
    await conn.query('DROP DATABASE IF EXISTS dependent229_shadow')
    await conn.end(); await db?.end()
  }
})
