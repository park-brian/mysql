// M5.47: distinct-key fanout and final outer cardinality change the winning strategy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('semijoin costs select LooseScan for captures 149/248 and FirstMatch under a small ordered LIMIT', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const fixture = JSON.parse(readFileSync(new URL('../format/fixtures/relational.json', import.meta.url), 'utf8')) as { cases: { sql: string; plan?: string }[][] }
  const loop = 'Nested loop semijoin\n    Covering index scan on pa using name\n    Covering index lookup on ch using pa_id'
  const loose = 'Nested loop inner join\n    Remove duplicates from input sorted on pa_id\n        Filter\n            Covering index scan on ch using pa_id\n    Single-row index lookup on pa using PRIMARY'
  const sorted = `Sort\n    Stream results\n${loose.split('\n').map((s) => `        ${s}`).join('\n')}`
  const limit = `Limit\n${loop.split('\n').map((s) => `    ${s}`).join('\n')}`
  const run = async (sql: string, expected: unknown[][], plan: string, flags: number) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        [['name', 253, 48, flags, 0, 224, 'semi_cost', 'pa', 'pa', 'name']], `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS semi_cost')
    await conn.query('USE semi_cost')
    for (const i of [149, 248]) {
      await conn.query('DROP TABLE IF EXISTS pa,ch')
      const observations = fixture.cases[i]!
      for (const o of observations) if (/^(CREATE TABLE (pa|ch) |INSERT INTO (pa|ch) )/.test(o.sql)) await conn.query(o.sql)
      await conn.query('ANALYZE TABLE pa,ch')
      const sql = observations.find((o) => o.plan?.includes('Remove duplicates from input sorted'))!.sql
      const ordered = sql.includes('ORDER BY')
      await run(sql, i === 149 ? [['ÄNNA'], ['Bob'], ['zoë'], ['x y']] : [['b'], ['cy'], ['zoë']], ordered ? sorted : loose, ordered ? 4097 : 20485)
      if (i === 149) await run(sql.replace('SELECT pa_id', 'SELECT PA_ID'), [['ÄNNA'], ['Bob'], ['zoë'], ['x y']], loose, 20485)
      await run(sql + (ordered ? ' LIMIT 1' : ' ORDER BY 1 LIMIT 1'), i === 149 ? [['ÄNNA']] : [['b']], limit, 20485)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS semi_cost')
    await conn.end()
    await db?.end()
  }
})

test('plain integer membership picks a narrow covering key in declaration order', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'semi_competing_covering'
  try {
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,label VARCHAR(16) NOT NULL) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,'b'),(2,'a'),(3,'c'),(4,'d'),(5,'e')")
    const descendingFirst = 'KEY b(pid DESC), KEY a(pid)'
    const layouts = [
      ['KEY a(pid), KEY b(pid DESC)', 'a'],
      [descendingFirst, 'b'],
      ['KEY a(pid,qty), KEY b(pid DESC)', 'b'],
      ['KEY a(pid DESC,qty), KEY b(pid DESC,extra)', 'b'],
    ] as const
    const sql = 'SELECT id,label FROM p WHERE id IN (SELECT pid FROM c)'
    for (const [keys, index] of layouts) {
      await conn.query('CREATE TABLE c(id INT PRIMARY KEY,pid INT,qty INT,extra TINYINT,' + keys + ') STATS_AUTO_RECALC=0')
      await conn.query('INSERT INTO c VALUES (1,1,5,2),(2,1,1,4),(3,3,6,6),(4,NULL,2,8),(5,8,1,0)')
      await conn.query('ANALYZE TABLE p,c')
      const modes = ['default', 'firstmatch=off', 'loosescan=off', 'loosescan=off,firstmatch=off']
      if (keys === descendingFirst) modes.push('loosescan=off,materialization=off')
      for (const mode of modes) {
        await conn.query("SET optimizer_switch='default'")
        if (mode !== 'default') await conn.query('SET optimizer_switch=?', [mode])
        for (const method of ['query', 'execute'] as const) {
          const read = (sql: string) => method === 'query'
            ? conn.query<mysql.RowDataPacket[]>({ sql, rowsAsArray: true })
            : conn.execute<mysql.RowDataPacket[]>({ sql, rowsAsArray: true })
          const [rows] = await read(sql)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
          const [planRows] = await read('EXPLAIN FORMAT=TREE ' + sql)
          const plan = planSkeleton(planRows[0]?.[0])
          if (mode === 'loosescan=off,firstmatch=off') {
            assert.equal(plan, [
              'Nested loop inner join',
              '    Table scan on p',
              '    Single-row index lookup on <subquery2> using <auto_distinct_key>',
              '        Materialize with deduplication',
              '            Filter',
              '                Covering index scan on c using ' + index,
            ].join('\n'))
            assert.deepEqual(rows, [[1, 'b'], [3, 'c']])
          } else if (keys === descendingFirst && mode.startsWith('loosescan=off')) {
            assert.equal(plan, 'Nested loop semijoin\n    Table scan on p\n    Covering index lookup on c using b')
            assert.deepEqual(rows, [[1, 'b'], [3, 'c']])
          } else if (mode === 'loosescan=off') {
            assert.equal(plan.includes('Remove duplicates from input sorted'), false)
            assert.deepEqual(rows.map((row) => row[0]).sort((a, b) => a - b), [1, 3])
          } else {
            assert.ok(plan.includes('Remove duplicates from input sorted on ' + index), plan)
            assert.ok(plan.includes('Covering index scan on c using ' + index), plan)
            assert.deepEqual(rows, index === 'a' ? [[1, 'b'], [3, 'c']] : [[3, 'c'], [1, 'b']])
          }
          if (method === 'execute') {
            conn.unprepare(sql)
            conn.unprepare('EXPLAIN FORMAT=TREE ' + sql)
          }
        }
      }
      await conn.query('DROP TABLE c')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})

test('empty integer membership picks the covering scan and rechecks after writes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'semi_empty_covering'
  try {
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,label VARCHAR(16) NOT NULL) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,pid INT,qty INT,extra TINYINT,KEY a(pid DESC,qty),KEY b(pid DESC,extra)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO p VALUES ?', [Array.from({ length: 12 }, (_, i) => [i + 1, `p${i + 1}`])])
    await conn.query('ANALYZE TABLE p,c')
    await conn.query("SET optimizer_switch='loosescan=off,materialization=off'")
    const sql = 'SELECT id,label FROM p WHERE id IN (SELECT pid FROM c)'
    const read = (method: 'query' | 'execute', statement: string) => method === 'query'
      ? conn.query<mysql.RowDataPacket[]>({ sql: statement, rowsAsArray: true })
      : conn.execute<mysql.RowDataPacket[]>({ sql: statement, rowsAsArray: true })
    for (const method of ['query', 'execute'] as const) {
      assert.deepEqual((await read(method, sql))[0], [])
      const [plan] = await read(method, 'EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(plan[0]?.[0]), [
        'Remove duplicate p rows using temporary table',
        '    Nested loop inner join',
        '        Filter',
        '            Covering index scan on c using b',
        '        Single-row index lookup on p using PRIMARY',
      ].join('\n'))
    }
    await conn.query('INSERT INTO c VALUES ?', [Array.from({ length: 17 }, (_, i) => [i + 1, i % 7 === 0 ? null : 1 + i * 3 % 18, i % 11, i % 5])])
    for (const method of ['query', 'execute'] as const) {
      assert.deepEqual((await read(method, sql))[0], [[1, 'p1'], [4, 'p4'], [7, 'p7'], [10, 'p10']])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})

test('empty dependent IN chooses materialization at its native cost boundary', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'semi_empty_dependent_cost'
  try {
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,n INT) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,pid INT,qty INT,extra TINYINT,KEY a(pid DESC,qty),KEY b(pid DESC,extra)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO p VALUES (1,1),(2,2),(3,NULL),(4,4),(5,5)')
    await conn.query('ANALYZE TABLE p,c')
    await conn.query("SET optimizer_switch='default,semijoin=off'")
    const sql = 'SELECT id,n FROM p WHERE n IN (SELECT pid FROM c)'
    const read = (method: 'query' | 'execute', statement: string) => method === 'query'
      ? conn.query<mysql.RowDataPacket[]>({ sql: statement, rowsAsArray: true })
      : conn.execute<mysql.RowDataPacket[]>({ sql: statement, rowsAsArray: true })
    const materialized = [
      'Filter',
      '    Table scan on p',
      '    Select #2',
      '        Filter',
      '            Limit',
      '                Index lookup on <materialized_subquery> using <auto_distinct_key>',
      '                    Materialize with deduplication',
      '                        Covering index scan on c using b',
    ].join('\n')
    const verify = async (usesMaterialization: boolean, expected: readonly (readonly number[])[]) => {
      for (const method of ['query', 'execute'] as const) {
        assert.deepEqual((await read(method, sql))[0], expected)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [plan] = await read(method, 'EXPLAIN FORMAT=TREE ' + sql)
        const tree = planSkeleton(plan[0]?.[0])
        if (usesMaterialization) assert.equal(tree, materialized)
        else assert.match(tree, /Covering index lookup on c using [ab]$/)
      }
    }
    await verify(false, [])
    await conn.query('INSERT INTO p VALUES (6,6)')
    await verify(true, [])
    await conn.query("SET optimizer_switch='materialization=off'")
    await verify(false, [])
    await conn.query("SET optimizer_switch='materialization=on'")
    await conn.query('INSERT INTO c VALUES ?', [Array.from({ length: 25 }, (_, i) => [i + 1, i % 2 === 0 ? 1 : 5, i, i])])
    await verify(false, [[1, 1], [5, 5]])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})
