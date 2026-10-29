// M5.47: deferred membership is a physical alternative to correlated probes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { SqlError } from '@myjs/protocol'
import costs from './fixtures/antijoin/materialized.json' with { type: 'json' }
import integers from './fixtures/antijoin/materialized-integers.json' with { type: 'json' }
import firstHit from './fixtures/antijoin/first-hit.json' with { type: 'json' }
import firstMatchOff from './fixtures/antijoin/firstmatch-off.json' with { type: 'json' }
import weedoutHit from './fixtures/antijoin/weedout-hit.json' with { type: 'json' }
// @ts-expect-error — share the capture's normalization without its runner.
import { planSkeleton } from '../../tools/capture-relational.mjs'

const host = process.env.MYSQL_REFERENCE_HOST
async function connect() {
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined ? { host: host ?? 'reference', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) } : { stream: db.createStream() }),
    user: 'root', supportBigNumbers: true, bigNumberStrings: true,
  })
  return { db, conn }
}
const fieldFacts = (fields: readonly mysql.FieldPacket[]) => fields.map((f) =>
  [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

async function check(conn: mysql.Connection, sql: string, rows: unknown, fields: unknown, warnings: unknown) {
  for (const method of ['query', 'execute'] as const) {
    const options = { sql, rowsAsArray: true }
    await conn.query('DO 0')
    const [actual, metadata] = method === 'query' ? await conn.query(options) : await conn.execute(options)
    assert.deepEqual(actual, rows, method + ': ' + sql)
    assert.deepEqual(fieldFacts(metadata), fields, method + ': fields: ' + sql)
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
    conn.unprepare(options)
  }
}

async function populateCostTables(conn: mysql.Connection, outer: number, inner: number) {
  await conn.query('DELETE FROM pa'); await conn.query('DELETE FROM ch')
  if (outer > 0) await conn.query('INSERT INTO pa VALUES' + Array.from({ length: outer }, (_, i) =>
    `(${i + 1},'n${String(outer - i).padStart(3, '0')}',${i % 4 === 0 ? 'NULL' : i % 4})`).join(','))
  if (inner > 0) await conn.query('INSERT INTO ch VALUES' + Array.from({ length: inner }, (_, i) =>
    `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4},'same',${i % 5 + 1})`).join(','))
  await conn.query('ANALYZE TABLE pa,ch')
}

test('pure integer antijoins choose materialization by cost and preserve outer ordering', async () => {
  const { db, conn } = await connect()
  type Case = [string, number, number, string, string, number, number, number, number, boolean]
  try {
    assert.equal(costs.mysqlVersion, '8.4.11')
    assert.equal(costs.cases.length, 700)
    assert.equal(costs.baselineComplete, 474)
    assert.equal(costs.predecessorComplete, 1024)
    assert.equal(costs.complete, 1120)
    assert.equal(costs.outcomes, 1400)
    await conn.query('CREATE DATABASE anti213')
    await conn.query('USE anti213')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,pa_id INT,label VARCHAR(10),qty INT NOT NULL,KEY(pa_id)) STATS_AUTO_RECALC=0')
    let population = ''
    let guarded = 0
    for (const raw of costs.cases) {
      const [key, outer, inner, switches, suffix, rows, fields, warnings, plan, guard] = raw as Case
      if (population !== outer + ':' + inner) {
        await populateCostTables(conn, outer, inner)
        population = outer + ':' + inner
      }
      await conn.query('SET optimizer_switch=' + mysql.escape(switches))
      const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.pa_id=pa.' + key + ')' + suffix
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      const nativePlan = costs.plans[plan]!
      // The supported cohorts come from switches and the native strategy,
      // independently of current output. FirstMatch-off now admits both
      // proved native choices here; semijoin-off remains separate.
      assert.equal(guard, !switches.includes('semijoin=off'), 'captured plan guard: ' + sql)
      // Every native answer is retained. The remaining strategy gaps stay open;
      // all predecessor matching plans and the newly repaired plans are guarded.
      if (host !== undefined || guard) assert.equal(planSkeleton(explain[0]?.EXPLAIN), nativePlan, sql)
      if (guard) guarded++
      await check(conn, sql, costs.rows[rows], costs.fields[fields], costs.warnings[warnings])
    }
    assert.equal(guarded * 2, 1120)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS anti213'); await conn.end(); await db?.end()
  }
})

test('FirstMatch-off follows native materialization and weedout cost choices', async () => {
  const { db, conn } = await connect()
  type Case = [string, number, number, string, string, number, number, number, number, number, boolean]
  try {
    assert.equal(firstMatchOff.mysqlVersion, '8.4.11')
    assert.equal(firstMatchOff.cases.length, 1540)
    assert.equal(firstMatchOff.outcomes, 3080)
    assert.equal(firstMatchOff.baselineComplete, 0)
    assert.equal(firstMatchOff.predecessorComplete, 1952)
    assert.equal(firstMatchOff.complete, 2240)
    await conn.query('CREATE DATABASE anti213'); await conn.query('USE anti213')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,pa_id INT,label VARCHAR(10),qty INT NOT NULL,KEY(pa_id)) STATS_AUTO_RECALC=0')
    let population = ''
    let guarded = 0, equalReported = 0, forced = 0, disabledCheaper = 0
    for (const raw of firstMatchOff.cases) {
      const [key, outer, inner, switches, suffix, rows, fields, warnings, plan, cost, guard] = raw as Case
      if (population !== outer + ':' + inner) {
        await populateCostTables(conn, outer, inner)
        population = outer + ':' + inner
      }
      const nativePlan = firstMatchOff.plans[plan]!
      const supported = !switches.includes('semijoin=off') && !switches.includes('materialization=off')
      const limited = !switches.includes('semijoin=off') && switches.includes('materialization=off') && !switches.includes('duplicateweedout=off')
      assert.equal(guard, limited || supported)
      if (supported) {
        const decision = firstMatchOff.costs[cost]!
        assert.equal(typeof decision.materialized, 'number')
        assert.equal(typeof decision.weedout, 'number')
        const materialized = nativePlan.includes('Materialize with deduplication')
        assert.equal(decision.chosen, materialized ? 'MaterializeLookup' : 'DuplicateWeedout')
        // These trace prices are rounded observations, not comparator inputs.
        if (switches.includes('duplicateweedout=off')) {
          assert.equal(guard, true)
          forced++
          if (decision.materialized! > decision.weedout!) disabledCheaper++
        } else {
          if (materialized) assert.ok(decision.materialized! <= decision.weedout!)
          if (decision.materialized === decision.weedout) { equalReported++; assert.equal(materialized, false) }
        }
      }
      await conn.query('SET optimizer_switch=' + mysql.escape(switches))
      const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.pa_id=pa.' + key + ')' + suffix
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      if (host !== undefined || guard) assert.equal(planSkeleton(explain[0]?.EXPLAIN), nativePlan, sql)
      if (guard) guarded++
      await check(conn, sql, firstMatchOff.rows[rows], firstMatchOff.fields[fields], firstMatchOff.warnings[warnings])
    }
    assert.equal(guarded * 2, 2240)
    assert.equal(equalReported, 48)
    assert.equal(forced, 560)
    assert.equal(disabledCheaper, 128)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS anti213'); await conn.end(); await db?.end()
  }
})

test('FirstMatch-off materialization builds on the first NULL row and skips LIMIT 0', async () => {
  const { db, conn } = await connect()
  const open = db?.catalog!.table.bind(db.catalog)
  let opened = 0, visited = 0, closed = 0
  let fail = false
  const reset = () => { opened = visited = closed = 0 }
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g)'
  try {
    await conn.query('CREATE DATABASE firstoff218'); await conn.query('USE firstoff218')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    const names = Array.from({ length: 20 }, (_, i) => 'n' + String(20 - i).padStart(3, '0'))
    await conn.query('INSERT INTO pa VALUES' + names.map((name, i) => `(${i + 1},'${name}',NULL)`).join(','))
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4})`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
    if (db !== undefined && open !== undefined) db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'firstoff218' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          opened++
          try {
            for (const row of scan(index, range, transaction, mode)) {
              visited++
              if (fail) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected FirstMatch-off build failure')
              yield row
            }
          } finally { closed++ }
        }
      }
      return table
    }
    const fields = [['name', 253, 48, 20485, 0, 224, 'firstoff218', 'pa', 'pa', 'name']]
    for (const switches of [
      'default,firstmatch=off', 'default,firstmatch=off,block_nested_loop=off', 'default,firstmatch=off,loosescan=off',
      'default,firstmatch=off,duplicateweedout=off',
      'default,firstmatch=off,duplicateweedout=off,block_nested_loop=off',
      'default,firstmatch=off,duplicateweedout=off,loosescan=off',
      'default,firstmatch=off,duplicateweedout=off,block_nested_loop=off,loosescan=off',
    ]) {
      await conn.query('SET optimizer_switch=' + mysql.escape(switches))
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal((String(explain[0]?.EXPLAIN).match(/Materialize with deduplication/g) ?? []).length, 1)
      if (host !== undefined) {
        const [analyze] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN ANALYZE ' + sql)
        const build = String(analyze[0]?.EXPLAIN).split('\n').find((line) => line.includes('Materialize with deduplication'))
        assert.match(build ?? '', /\(actual time=[^)]* rows=3 loops=1\)/)
      }
      reset()
      await check(conn, sql, names.map((name) => [name]), fields, [])
      if (db !== undefined) assert.deepEqual([opened, visited, closed], [2, 16, 2])
      reset(); fail = true
      if (db !== undefined) {
        await assert.rejects(conn.query(sql + ' LIMIT 1'), /injected FirstMatch-off build failure/)
        assert.deepEqual([opened, visited, closed], [1, 1, 1])
      }
      reset()
      await check(conn, sql + ' LIMIT 0', [], fields, [])
      if (db !== undefined) assert.deepEqual([opened, visited, closed], [0, 0, 0])
      fail = false
    }
  } finally {
    if (db !== undefined && open !== undefined) db.catalog!.table = open
    await conn.query('DROP DATABASE IF EXISTS firstoff218'); await conn.end(); await db?.end()
  }
})

test('materialized antijoins keep exact integer keys, NULL and built-empty inputs', async () => {
  const { db, conn } = await connect()
  type Case = [string, string, string, string, string, string, number, number, number, number, boolean]
  try {
    assert.equal(integers.mysqlVersion, '8.4.11')
    assert.equal(integers.cases.length, 270)
    assert.equal(integers.baselineComplete, 300)
    assert.equal(integers.complete, 540)
    assert.equal(integers.outcomes, 540)
    await conn.query('CREATE DATABASE anti213_life'); await conn.query('USE anti213_life')
    let declaration = ''
    let population = ''
    for (const raw of integers.cases) {
      const [type, low, high, outer, inner, suffix, rows, fields, warnings, plan, guard] = raw as Case
      assert.equal(guard, true)
      if (type !== declaration) {
        await conn.query('DROP TABLE IF EXISTS pa,ch')
        await conn.query(`CREATE TABLE pa(id INT PRIMARY KEY,g ${type}) STATS_AUTO_RECALC=0`)
        await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
        declaration = type; population = ''
      }
      if (population !== outer + ':' + inner) {
        await conn.query('DELETE FROM pa'); await conn.query('DELETE FROM ch')
        if (outer !== 'empty') await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 20 }, (_, i) =>
          `(${i + 1},${outer === 'null' || i % 4 === 0 ? 'NULL' : i % 4 === 1 ? low : high})`).join(','))
        if (inner !== 'empty') await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 8 }, (_, i) =>
          `(${i + 1},${inner === 'null' || i % 4 === 0 ? 'NULL' : low})`).join(','))
        await conn.query('ANALYZE TABLE pa,ch')
        population = outer + ':' + inner
      }
      const sql = 'SELECT id,g FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g)' + suffix
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), integers.plans[plan], sql)
      await check(conn, sql, integers.rows[rows], integers.fields[fields], integers.warnings[warnings])
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS anti213_life'); await conn.end(); await db?.end()
  }
})

test('cached materialized antijoins rebuild under each execution transaction and LIMIT binding', async () => {
  const { db, conn } = await connect()
  const options = { sql: 'SELECT id,g FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g) LIMIT ?', rowsAsArray: true }
  const outer = Array.from({ length: 20 }, (_, i) => [i + 1, i % 4 === 0 ? null : i % 4])
  const run = async (limit: number, keys: readonly number[]) => {
    const [rows, fields] = await conn.execute(options, [limit])
    assert.deepEqual(rows, outer.filter((r) => r[1] === null || !keys.includes(r[1]!)).slice(0, limit))
    assert.deepEqual(fieldFacts(fields), [
      ['id', 3, 11, 20483, 0, 63, 'anti213_cache', 'pa', 'pa', 'id'],
      ['g', 3, 11, 0, 0, 63, 'anti213_cache', 'pa', 'pa', 'g'],
    ])
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
  }
  try {
    await conn.query('CREATE DATABASE anti213_cache'); await conn.query('USE anti213_cache')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,g INT) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO pa VALUES' + outer.map((r) => '(' + r[0] + ',' + (r[1] ?? 'NULL') + ')').join(','))
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : 1})`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
    const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + options.sql.replace('?', '1'))
    assert.equal((String(explain[0]?.EXPLAIN).match(/Materialize with deduplication/g) ?? []).length, 1)
    assert.doesNotMatch(String(explain[0]?.EXPLAIN), /Select #/)
    for (const limit of [0, 1, 8, 2]) await run(limit, [1])
    await conn.query('UPDATE ch SET g=2 WHERE g=1'); await run(8, [2])
    await conn.query('INSERT INTO ch VALUES(9,3)'); await run(20, [2, 3])
    await conn.beginTransaction()
    await conn.query('UPDATE ch SET g=1 WHERE g=3'); await run(20, [1, 2])
    await conn.rollback(); await run(20, [2, 3])
    await conn.query('DELETE FROM ch'); await run(4, [])
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i + 1},NULL)`).join(','))
    await run(4, [])
  } finally {
    conn.unprepare(options)
    await conn.query('DROP DATABASE IF EXISTS anti213_cache'); await conn.end(); await db?.end()
  }
})

test('materialized membership builds on the first NULL probe and closes failed or cancelled reads', async () => {
  const db = await MySQL.open(':memory:')
  const sql = 'SELECT id,g FROM anti213_owner.pa WHERE NOT EXISTS(SELECT 1 FROM anti213_owner.ch WHERE ch.g=pa.g)'
  const open = db.catalog!.table.bind(db.catalog)
  let opened = 0, visited = 0, closed = 0
  let outerOpened = 0, outerVisited = 0, outerClosed = 0
  let fail = false
  const reset = () => { opened = visited = closed = outerOpened = outerVisited = outerClosed = 0 }
  try {
    await db.query('CREATE DATABASE anti213_owner')
    await db.query('CREATE TABLE anti213_owner.pa(id INT PRIMARY KEY,g INT,payload TEXT) STATS_AUTO_RECALC=0')
    await db.query('CREATE TABLE anti213_owner.ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await db.query('INSERT INTO anti213_owner.pa VALUES' + Array.from({ length: 20 }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4},'x')`).join(','))
    await db.query('INSERT INTO anti213_owner.ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4})`).join(','))
    await db.query('ANALYZE TABLE anti213_owner.pa,anti213_owner.ch')
    db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'anti213_owner' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          assert.equal(index, 'g')
          opened++
          try {
            for (const row of scan(index, range, transaction, mode)) {
              visited++
              if (fail && visited === 2) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected membership build failure')
              yield row
            }
          } finally { closed++ }
        }
      }
      if (schema === 'anti213_owner' && name === 'pa') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          outerOpened++
          try { for (const row of scan(range, transaction, mode)) { outerVisited++; yield row } }
          finally { outerClosed++ }
        }
      }
      return table
    }
    assert.deepEqual((await db.query(sql + ' LIMIT 1'))[0], [{ id: 1, g: null }])
    assert.deepEqual([opened, visited, closed], [1, 8, 1])
    reset(); fail = true
    await assert.rejects(db.query(sql + ' LIMIT 1'), /injected membership build failure/)
    assert.deepEqual([opened, visited, closed], [1, 2, 1])
    assert.deepEqual([outerOpened, outerVisited, outerClosed], [1, 1, 1])
    reset(); fail = false
    assert.deepEqual((await db.query(sql + ' LIMIT 1'))[0], [{ id: 1, g: null }])
    assert.deepEqual([opened, visited, closed], [1, 8, 1])
    reset(); fail = true
    assert.deepEqual((await db.query(sql + ' LIMIT 0'))[0], [])
    assert.deepEqual([opened, visited, closed], [0, 0, 0])
    fail = false
    await db.query('UPDATE anti213_owner.pa SET g=NULL')
    reset()
    assert.equal((await db.query<unknown[]>(sql))[0].length, 20)
    assert.deepEqual([opened, visited, closed], [1, 8, 1])
    await db.query('DELETE FROM anti213_owner.ch')
    reset()
    assert.equal((await db.query<unknown[]>(sql))[0].length, 20)
    assert.deepEqual([opened, visited, closed], [1, 0, 1])
    await db.query('INSERT INTO anti213_owner.ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i + 1},NULL)`).join(','))
    reset()
    assert.equal((await db.query<unknown[]>(sql))[0].length, 20)
    assert.deepEqual([opened, visited, closed], [1, 8, 1])
    await db.query('DELETE FROM anti213_owner.pa')
    reset(); fail = true
    assert.deepEqual((await db.query(sql))[0], [])
    assert.deepEqual([opened, visited, closed], [0, 0, 0])
    fail = false
    // Exceed the protocol's 256-row pacing batches, including rows in flight.
    await db.query('INSERT INTO anti213_owner.pa VALUES' + Array.from({ length: 2048 }, (_, i) => `(${i + 1},NULL,REPEAT('x',4096))`).join(','))
    await db.query('ANALYZE TABLE anti213_owner.pa,anti213_owner.ch')
    reset()
    const streaming = sql.replace('SELECT id,g', 'SELECT id,payload')
    const [explain] = await db.query('EXPLAIN FORMAT=TREE ' + streaming)
    assert.match(JSON.stringify(explain), /Materialize with deduplication/)
    reset()
    for await (const row of db.stream<{ id: number; payload: string }>(streaming)) {
      assert.deepEqual(row, { id: 1, payload: 'x'.repeat(4096) })
      break
    }
    assert.deepEqual([opened, visited, closed], [1, 8, 1])
    assert.ok(outerVisited > 0 && outerVisited < 2048, 'cancellation stops the outer scan: ' + outerVisited)
    assert.equal(outerOpened, outerClosed, 'cancellation closes the outer scan')
    assert.equal(db.openConnections, 1)
    await db.query('UPDATE anti213_owner.pa SET g=2 WHERE id=1')
  } finally {
    db.catalog!.table = open
    await db.end()
  }
})

test('proved FirstMatch sorts its outer source before correlated probes and preserves excluded switches', async () => {
  const { db, conn } = await connect()
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.pa_id=pa.g) ORDER BY name LIMIT 1'
  const open = db?.catalog!.table.bind(db.catalog)
  const events: string[] = []
  let fail = false
  try {
    await conn.query('CREATE DATABASE firstmatch215'); await conn.query('USE firstmatch215')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,pa_id INT,label VARCHAR(10),qty INT NOT NULL,KEY(pa_id)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(1,'n004',NULL),(2,'n003',1),(3,'n002',2),(4,'n001',9)")
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 80 }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4},'same',1)`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
    const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
    assert.equal(planSkeleton(explain[0]?.EXPLAIN), 'Limit\n    Nested loop antijoin\n        Sort\n            Table scan on pa\n        Covering index lookup on ch using pa_id')
    const fields = [['name', 253, 48, 20485, 0, 224, 'firstmatch215', 'pa', 'pa', 'name']]
    await check(conn, sql, [['n001']], fields, [])
    await conn.query("SET optimizer_switch='default,firstmatch=off,materialization=off'")
    const [limited] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
    assert.equal(planSkeleton(limited[0]?.EXPLAIN), planSkeleton(weedoutHit.nativeSortActivity))
    await check(conn, sql, [['n001']], fields, [])
    if (host !== undefined) {
      const [analyze] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN ANALYZE ' + sql)
      const scan = String(analyze[0]?.EXPLAIN).split('\n').find((line) => line.includes('Table scan on pa'))
      assert.match(scan ?? '', /\(actual time=[^)]* rows=4 loops=1\)/)
    }
    await conn.query("SET optimizer_switch='default'")
    if (db === undefined || open === undefined) return
    db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'firstmatch215' && name === 'pa') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          events.push('pa:open')
          let read = 0
          try {
            for (const row of scan(range, transaction, mode)) {
              events.push('pa:row')
              read++
              if (fail && read === 2) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected outer sort failure')
              yield row
            }
          } finally { events.push('pa:close') }
        }
      }
      if (schema === 'firstmatch215' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          events.push('ch:open')
          try { for (const row of scan(index, range, transaction, mode)) { events.push('ch:row'); yield row } }
          finally { events.push('ch:close') }
        }
      }
      return table
    }
    for (const switches of ['default', 'default,materialization=off', 'default,firstmatch=off,materialization=off']) {
      await conn.query('SET optimizer_switch=' + mysql.escape(switches))
      events.length = 0
      assert.deepEqual((await conn.query({ sql, rowsAsArray: true }))[0], [['n001']])
      assert.deepEqual(events, ['pa:open', 'pa:row', 'pa:row', 'pa:row', 'pa:row', 'pa:close', 'ch:open', 'ch:close'])
      events.length = 0; fail = true
      await assert.rejects(conn.query(sql), /injected outer sort failure/)
      assert.deepEqual(events, ['pa:open', 'pa:row', 'pa:row', 'pa:close'])
      fail = false
    }
    for (const switches of ['default,firstmatch=off,materialization=off,duplicateweedout=off', 'default,semijoin=off']) {
      await conn.query('SET optimizer_switch=' + mysql.escape(switches))
      events.length = 0
      assert.deepEqual((await conn.query({ sql, rowsAsArray: true }))[0], [['n001']])
      assert.ok(events.indexOf('ch:open') < events.lastIndexOf('pa:row'), switches + ': retain the original reader placement')
      assert.equal(events.filter((e) => e === 'ch:open').length, events.filter((e) => e === 'ch:close').length)
    }
  } finally {
    if (db !== undefined && open !== undefined) db.catalog!.table = open
    await conn.query('DROP DATABASE IF EXISTS firstmatch215'); await conn.end(); await db?.end()
  }
})

test('admitted correlated antijoins skip NULL searches and close after their first qualified hit',
  () => checkCorrelatedAntijoins('default,materialization=off', firstHit))

test('proved materialization-off weedout uses the correlated reader and its one-row limit',
  () => checkCorrelatedAntijoins('default,firstmatch=off,materialization=off', weedoutHit))

async function checkCorrelatedAntijoins(switches: string, capture: typeof firstHit) {
  const { db, conn } = await connect()
  const sql = 'SELECT name FROM pa WHERE NOT EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g)'
  const open = db?.catalog!.table.bind(db.catalog)
  let opened = 0, visited = 0, closed = 0
  let failAfter: number | undefined
  const reset = () => { opened = visited = closed = 0 }
  const handlers = async () => Object.fromEntries((await conn.query<mysql.RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Handler_read%'"))[0]
    .map((row) => [String(row.Variable_name), Number(row.Value)]))
  const activity = (text: string) => {
    const lookup = text.split('\n').find((line) => line.includes('Covering index lookup on ch using g'))
    const counts = /\(actual time=[^)]* rows=(\d+) loops=(\d+)\)/.exec(lookup ?? '')
    assert.ok(counts, 'captured inner activity: ' + text)
    return [Number(counts[1]), Number(counts[2])]
  }
  try {
    assert.equal(capture.mysqlVersion, '8.4.11')
    assert.equal(capture.outcomes, 24)
    assert.equal(capture.cases.length, 12)
    if (host !== undefined) assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]?.v.split('-')[0], capture.mysqlVersion)
    await conn.query('CREATE DATABASE firstmatch216'); await conn.query('USE firstmatch216')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,g INT,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query('SET optimizer_switch=' + mysql.escape(switches))
    if (db !== undefined && open !== undefined) db.catalog!.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'firstmatch216' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          opened++
          try {
            for (const row of scan(index, range, transaction, mode)) {
              visited++
              if (visited === failAfter) throw new SqlError('ER_QUERY_INTERRUPTED', 'injected later matching row failure')
              yield row
            }
          } finally { closed++ }
        }
      }
      return table
    }
    for (const sample of capture.cases) {
      await conn.query('DELETE FROM ch'); await conn.query('DELETE FROM pa')
      if (sample.inner !== 'empty') await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 100 }, (_, i) =>
        `(${i + 1},${sample.inner === 'all-null' || sample.inner === 'mixed-null' && i % 2 === 0 ? 'NULL' : 1})`).join(','))
      await conn.query(`INSERT INTO pa VALUES(1,'one',${sample.outer ?? 'NULL'})`)
      await conn.query('ANALYZE TABLE pa,ch')
      assert.deepEqual(activity(sample.nativeActivity), [sample.innerRows, 1])
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), planSkeleton(sample.nativeActivity))
      if (host !== undefined) {
        const [analyze] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN ANALYZE ' + sql)
        assert.deepEqual(activity(String(analyze[0]?.EXPLAIN)), [sample.innerRows, 1])
      }
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        await conn.query('DO 0')
        const before = host === undefined ? undefined : await handlers()
        reset()
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, capture.rows[sample.rows], method + ': rows')
        assert.deepEqual(fieldFacts(fields), capture.fields[sample.fields], method + ': fields')
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], capture.warnings[sample.warnings], method + ': warnings')
        if (before !== undefined) {
          const after = await handlers()
          const delta = Object.fromEntries(Object.keys(before).map((name) => [name, after[name]! - before[name]!]))
          assert.deepEqual(delta, sample.nativeHandlers[method], method + ': native handler activity')
        }
        if (db !== undefined) assert.deepEqual([opened, visited, closed], sample.outer === null ? [0, 0, 0] : [1, sample.innerRows, 1])
        conn.unprepare(options)
      }
    }
    await conn.query('UPDATE pa SET g=1')
    await conn.query('DELETE FROM ch')
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 100 }, (_, i) => `(${i + 1},1)`).join(','))
    const options = { sql: sql + ' LIMIT ?', rowsAsArray: true }
    const run = async (limit: number, rows: unknown, reads: number) => {
      reset()
      const [actual, fields] = await conn.execute(options, [limit])
      assert.deepEqual(actual, rows)
      assert.deepEqual(fieldFacts(fields), capture.fields[0])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      if (db !== undefined) assert.deepEqual([opened, visited, closed], limit === 0 ? [0, 0, 0] : [1, reads, 1])
    }
    // A second matching row would fail if the source were exhausted.
    failAfter = 2
    for (const limit of [0, 1, 5]) await run(limit, [], limit === 0 ? 0 : 1)
    await conn.query('UPDATE pa SET g=9'); await run(1, [['one']], 0)
    await conn.query('UPDATE ch SET g=9'); await run(1, [], 1)
    await conn.beginTransaction()
    await conn.query('UPDATE ch SET g=1'); await run(1, [['one']], 0)
    await conn.rollback(); await run(1, [], 1)
    // NULL skips even a failing first read, including on the cached statement.
    await conn.query('UPDATE pa SET g=NULL')
    failAfter = 1
    reset()
    const [nullRows, nullFields] = await conn.execute(options, [1])
    assert.deepEqual(nullRows, [['one']])
    assert.deepEqual(fieldFacts(nullFields), capture.fields[0])
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    if (db !== undefined) assert.deepEqual([opened, visited, closed], [0, 0, 0])
    await conn.beginTransaction()
    await conn.query('UPDATE pa SET g=9')
    if (db !== undefined) await assert.rejects(conn.execute(options, [1]), /injected later matching row failure/)
    else await run(1, [], 1)
    await conn.rollback()
    reset()
    assert.deepEqual((await conn.execute(options, [1]))[0], [['one']])
    if (db !== undefined) assert.deepEqual([opened, visited, closed], [0, 0, 0])
    conn.unprepare(options)
    failAfter = undefined
    if (db !== undefined) for (const switches of ['default,firstmatch=off,materialization=off,duplicateweedout=off', 'default,semijoin=off,materialization=off']) {
      await conn.query('SET optimizer_switch=' + mysql.escape(switches))
      reset()
      assert.deepEqual((await conn.query({ sql, rowsAsArray: true }))[0], [['one']])
      // These excluded profiles retain their existing source; broader inner
      // early termination remains open rather than being admitted implicitly.
      assert.deepEqual([opened, visited, closed], [1, 100, 1])
    }
    await conn.query('SET optimizer_switch=' + mysql.escape(switches))
    await conn.query('INSERT INTO ch VALUES(101,NULL)')
    await check(conn, sql.replace('ch.g=pa.g', 'ch.g<=>pa.g'), [], capture.fields[0], [])
    // Source binding still precedes execution suppression for a NULL key.
    await assert.rejects(conn.query(sql.replace('ch.g=pa.g', 'ch.missing=pa.g')), { code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22' })
    await conn.query('DROP TABLE ch')
    await assert.rejects(conn.query(sql), { code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlState: '42S02' })
  } finally {
    if (db !== undefined && open !== undefined) db.catalog!.table = open
    await conn.query('DROP DATABASE IF EXISTS firstmatch216'); await conn.end(); await db?.end()
  }
}
