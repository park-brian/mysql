// M5.47: a prefix key does not cover the complete residual string column.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

async function readDependentNotIn(conn: mysql.Connection, schema: string, field: string, sql: string, expected: string[][], checkPlan: (plan: string, api: string) => void) {
  const options = { sql, rowsAsArray: true }
  const explain = `EXPLAIN FORMAT=TREE ${sql}`
  for (const api of ['query', 'execute'] as const) {
    const [rows, fields] = api === 'query' ? await conn.query(options) : await conn.execute(options)
    assert.deepEqual(rows, expected, api)
    assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
      [[field, 253, 48, 20485, 0, 255, schema, 'p', 'p', field]], api)
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], api)
    const [[result]] = api === 'query' ? await conn.query<mysql.RowDataPacket[]>(explain) : await conn.execute<mysql.RowDataPacket[]>(explain)
    checkPlan(planSkeleton(result?.EXPLAIN), api)
  }
}

test('unindexed integer equality ANY and SOME choose buffered FirstMatch and weedout', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'quantified_hash_membership'
  const hash = `Sort\n    Stream results\n        Hash semijoin\n            Table scan on ch\n            Hash\n                Table scan on kl`
  const weedout = `Sort\n    Stream results\n        Remove duplicate ch rows using temporary table\n            Inner hash join\n                Table scan on ch\n                Hash\n                    Table scan on kl`
  async function read(expected: [string, number][], plan?: string) {
    for (const quantifier of ['ANY', 'SOME']) {
      const sql = `SELECT label,qty FROM ch WHERE qty = ${quantifier} (SELECT g FROM kl) ORDER BY 1,2`
      const options = { sql, rowsAsArray: true }
      const explain = `EXPLAIN FORMAT=TREE ${sql}`
      if (plan === undefined) {
        // The final phase binds fresh statements with semijoins disabled.
        conn.unprepare(options)
        conn.unprepare(explain)
      }
      for (const api of ['query', 'execute'] as const) {
        const label = `${quantifier}/${api}`
        const [rows, fields] = api === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, label)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
          ['label', 253, 40, 0, 0, 255, schema, 'ch', 'ch', 'label'],
          ['qty', 3, 11, 0, 0, 63, schema, 'ch', 'ch', 'qty'],
        ], label)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], label)
        const [[result]] = api === 'query' ? await conn.query<mysql.RowDataPacket[]>(explain) : await conn.execute<mysql.RowDataPacket[]>(explain)
        const observed = planSkeleton(result?.EXPLAIN)
        if (plan === undefined) assert.match(observed, /Select #2/, label)
        else assert.equal(observed, plan, label)
      }
    }
  }
  try {
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci')
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,label VARCHAR(10),qty INT) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE kl(id INT PRIMARY KEY,g INT) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO ch VALUES(1,'dup',0)")
    await conn.query('ANALYZE TABLE ch,kl')
    await read([], hash)

    await conn.query("INSERT INTO ch VALUES(2,'dup',0),(3,'skip',NULL)")
    await conn.query('INSERT INTO kl VALUES(1,0),(2,0),(3,4),(4,NULL)')
    await conn.query('ANALYZE TABLE ch,kl')
    await read([['dup', 0], ['dup', 0]], hash)

    await conn.query("INSERT INTO ch VALUES(4,'hit',4),(5,'skip',3)")
    await conn.query('DELETE FROM kl WHERE id IN (2,4)')
    await conn.query('ANALYZE TABLE ch,kl')
    await read([['dup', 0], ['dup', 0], ['hit', 4]], weedout)
    await conn.query('UPDATE kl SET g=NULL WHERE id=1')
    await read([['hit', 4]], weedout)
    await conn.query("SET optimizer_switch='semijoin=off'")
    await read([['hit', 4]])
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('ordered ANY and SOME reuse their bound aggregate across writes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'quantified_extrema'
  const outer = 'Filter\n    Index scan on outer_t using PRIMARY\n    Select #2\n        Aggregate'
  async function read(max: number[][], min: number[][]) {
    for (const [predicate, expected, child] of [
      ['qty < SOME (SELECT n FROM inner_t)', max, '\n            Table scan on inner_t'],
      ['n > ANY (SELECT n FROM inner_t WHERE n IS NOT NULL)', min, '\n            Filter\n                Table scan on inner_t'],
    ] as const) {
      const sql = `SELECT id FROM outer_t WHERE ${predicate} ORDER BY id`
      const options = { sql, rowsAsArray: true }
      const explain = `EXPLAIN FORMAT=TREE ${sql}`
      for (const api of ['query', 'execute'] as const) {
        const [rows, fields] = api === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, `${predicate}/${api}`)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
          [['id', 3, 11, 20483, 0, 63, schema, 'outer_t', 'outer_t', 'id']], api)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], api)
        const [[result]] = api === 'query' ? await conn.query<mysql.RowDataPacket[]>(explain) : await conn.execute<mysql.RowDataPacket[]>(explain)
        assert.equal(planSkeleton(result?.EXPLAIN), outer + child, `${predicate}/${api}`)
      }
    }
  }
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE outer_t(id INT PRIMARY KEY, n INT, qty INT NOT NULL)')
    await conn.query('CREATE TABLE inner_t(id INT PRIMARY KEY, n INT)')
    await conn.query('INSERT INTO outer_t VALUES (1,NULL,-1),(2,0,0),(3,4,4),(4,9,10)')
    await read([], [])
    await conn.query('INSERT INTO inner_t VALUES (1,NULL),(2,NULL)')
    await read([], [])
    await conn.query('INSERT INTO inner_t VALUES (3,2),(4,8),(5,3),(6,8)')
    await read([[1], [2], [3]], [[3], [4]])
    await conn.query('UPDATE inner_t SET n=IF(n=2,-2,12) WHERE n IN (2,8)')
    await conn.query("SET optimizer_switch='semijoin=off,materialization=off'")
    await read([[1], [2], [3], [4]], [[2], [3], [4]])
    await conn.query('DELETE FROM inner_t')
    await read([], [])
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('quantified subquery coverage distinguishes complete and prefix index parts', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  try {
    await conn.query('CREATE DATABASE quantified_covering92')
    await conn.query('USE quantified_covering92')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,g INT)')
    await conn.query('INSERT INTO pa VALUES(1,2),(2,2),(3,NULL),(4,9)')
    for (const prefix of [false, true]) {
      await conn.query('DROP TABLE IF EXISTS ch')
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g INT,s VARCHAR(12),KEY gs(g,s${prefix ? '(2)' : ''}))`)
      await conn.query("INSERT INTO ch VALUES(1,2,'same'),(2,2,'sameness'),(3,9,'absent'),(4,NULL,'same')")
      await conn.query('ANALYZE TABLE pa,ch')
      await conn.query("SET optimizer_switch='default,semijoin=off,materialization=off'")
      for (const form of ['in', 'any', 'all']) {
        // Complete-key IN has a separate pre-existing residual-filter gap.
        if (!prefix && form === 'in') continue
        const predicate = form === 'in' ? 'g IN' : form === 'any' ? 'g<>ANY' : 'g=ALL'
        const sql = `SELECT g FROM pa WHERE ${predicate}(SELECT g FROM ch WHERE s='same')`
        const expected = form === 'in' ? [[2], [2]] : form === 'any' ? [[9]] : []
        const child = form === 'in' ? 'Filter\n                Index lookup on ch using gs'
          : `Filter\n                Filter\n                    ${prefix ? 'Table scan on ch' : 'Covering index scan on ch using gs'}`
        const plan = `Filter\n    Table scan on pa\n    Select #2\n        Limit\n            ${child}`
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, expected, `${prefix}/${form}/${method}`)
          assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
            [['g', 3, 11, 0, 0, 63, 'quantified_covering92', 'pa', 'pa', 'g']])
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
          const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
          conn.unprepare(options)
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS quantified_covering92')
    await conn.end()
    await db?.end()
  }
})

test('dependent NOT IN retains a proved empty input across writes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const schema = 'quantified_empty_input'
  const all = [['a'], ['b'], ['c'], ['d']]
  const read = (key: 'id' | 'k', residual: 'IS NULL' | 'IS NOT NULL', rowsExpected: string[][], lookup = false) => {
    const sql = `SELECT label FROM p WHERE ${key} NOT IN (SELECT parent_id FROM c WHERE qty ${residual}) ORDER BY 1`
    const empty = key === 'id' ? 'Filter\n    Covering index scan on p using label\n    Select #2\n        Zero rows'
      : 'Sort\n    Filter\n        Table scan on p\n        Select #2\n            Zero rows'
    return readDependentNotIn(conn, schema, 'label', sql, rowsExpected, (plan, api) => {
      if (residual === 'IS NULL') assert.equal(plan, empty, api)
      else {
        assert.doesNotMatch(plan, /Zero rows/, api)
        if (lookup) assert.match(plan, /Index lookup on c using by_parent/, api)
      }
    })
  }
  try {
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci')
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,k INT,label VARCHAR(12) NOT NULL,UNIQUE KEY(label)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,parent_id INT,qty INT NOT NULL,KEY by_parent(parent_id)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,1,'c'),(2,8,'a'),(3,NULL,'b'),(4,8,'d')")
    await conn.query('INSERT INTO c VALUES ' + Array.from({ length: 12 }, (_, i) => `(${i + 1},${i % 3 === 1 ? 'NULL' : i + 1},${i + 1})`).join(','))
    await conn.query('ANALYZE TABLE p,c')
    await read('id', 'IS NULL', all)
    await read('k', 'IS NULL', all)
    await read('k', 'IS NOT NULL', [], true)
    // Retain the prepared readers while the inner keys and table cardinality change.
    await conn.query('UPDATE c SET parent_id=99 WHERE parent_id IS NULL')
    await read('k', 'IS NULL', all)
    await conn.query('DELETE FROM c')
    await conn.query("SET optimizer_switch='semijoin=off,materialization=off'")
    await read('id', 'IS NULL', all)
    await read('k', 'IS NULL', all)
    await read('k', 'IS NOT NULL', all)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('dependent NOT IN costs a text residual as scan, ref-or-null, or materialization', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const schema = 'quantified_text_cost'
  const outer = 'Filter\n    Covering index scan on p using name\n    Select #2'
  const dependent = `${outer}\n        Limit\n            Filter\n                Filter`
  const scan = `${dependent}\n                    Table scan on c`
  const lookup = `${dependent}\n                    Index lookup on c using by_parent`
  const materialized = `${outer}
        Filter
            Limit
                Index lookup on <materialized_subquery> using <auto_distinct_key>
                    Materialize with deduplication
                        Filter
                            Table scan on c`
  const all = [['a'], ['d'], ['z']]
  const read = async (plain: string[][], disjunction: string[][], expectedPlan: string) => {
    for (const [residual, expected] of [["c.label <= 'Mo'", plain], ["c.label >= 'ann' OR c.parent_id IS NOT NULL", disjunction]] as const) {
      const sql = `SELECT name FROM p WHERE id NOT IN (SELECT parent_id FROM c WHERE ${residual}) ORDER BY 1`
      await readDependentNotIn(conn, schema, 'name', sql, expected, (plan, api) => assert.equal(plan, expectedPlan, api))
    }
  }
  try {
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci')
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,parent_id INT,label VARCHAR(12),KEY by_parent(parent_id)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,'d'),(2,'a'),(3,'z')")
    await conn.query('ANALYZE TABLE p,c')
    await read(all, all, scan)
    await conn.query("INSERT INTO c VALUES(1,1,'ann'),(2,3,'x')")
    await conn.query('ANALYZE TABLE p,c')
    await read([['a'], ['z']], [['a']], scan)
    await conn.query("INSERT INTO c VALUES(3,2,'al'),(4,4,'éva'),(5,NULL,'red'),(6,6,'Mo')")
    await conn.query('ANALYZE TABLE p,c')
    await read([['z']], [], lookup)
    await conn.query("SET optimizer_switch='subquery_materialization_cost_based=off'")
    await read([['z']], [], materialized)
    await conn.query("UPDATE c SET label='Mo' WHERE parent_id IS NULL")
    await read([], [], materialized)
    await conn.query("SET optimizer_switch='materialization=off'")
    await conn.query('DELETE FROM c')
    await conn.query('ANALYZE TABLE p,c')
    await read(all, all, scan)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('nullable integer NOT IN describes forced and costed membership builds across retained executions', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'quantified_not_in354'
  const sql = 'SELECT id,label FROM p WHERE k NOT IN (SELECT k FROM c)'
  const outer = 'Filter\n    Table scan on p\n    Select #2'
  const materialized = `${outer}\n        Filter\n            Limit\n                Index lookup on <materialized_subquery> using <auto_distinct_key>\n                    Materialize with deduplication\n                        Covering index scan on c using by_k`
  const dependent = `${outer}\n        Limit\n            Filter\n                Alternative plans for IN subquery\n                    Covering index lookup on c using by_k\n                    Table scan on c`
  const all = [[1, 'p0'], [2, 'p1'], [3, 'p2'], [4, 'p3'], [5, 'p4']]
  async function read(expected: unknown[][], plan: string) {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
        ['id', 3, 11, 20483, 0, 63, schema, 'p', 'p', 'id'], ['label', 253, 64, 4097, 0, 224, schema, 'p', 'p', 'label'],
      ])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const explainSql = `EXPLAIN FORMAT=TREE ${sql}`
      const [explain] = method === 'query' ? await conn.query<mysql.RowDataPacket[]>(explainSql) : await conn.execute<mysql.RowDataPacket[]>(explainSql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
    }
  }
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,k INT,label VARCHAR(16) NOT NULL) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,k INT NOT NULL,KEY by_k(k)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,0,'p0'),(2,NULL,'p1'),(3,2,'p2'),(4,3,'p3'),(5,4,'p4')")
    await conn.query('INSERT INTO c VALUES (1,0)')
    await conn.query('ANALYZE TABLE p,c')
    await read(all.slice(2), dependent)
    await conn.query("SET optimizer_switch='subquery_materialization_cost_based=off'")
    await read(all.slice(2), materialized)
    await conn.query("SET optimizer_switch='materialization=off'")
    await read(all.slice(2), dependent)
    await conn.query("SET optimizer_switch='materialization=on,semijoin=off'")
    await conn.query('INSERT INTO c VALUES (2,2)')
    await read(all.slice(3), materialized)
    await conn.query('DELETE FROM c')
    await read(all, materialized)
    await conn.query("SET optimizer_switch='default'")
    await conn.query('INSERT INTO c VALUES (1,0)')
    await read(all.slice(2), dependent)
    await conn.query("INSERT INTO p VALUES (6,5,'p5'),(7,6,'p6')")
    const grown = [...all, [6, 'p5'], [7, 'p6']]
    await read(grown.slice(2), materialized)
    await conn.query('INSERT INTO c VALUES (2,2),(3,3)')
    await read(grown.slice(4), dependent)
    await conn.query('DELETE FROM c')
    await read(grown, materialized)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
