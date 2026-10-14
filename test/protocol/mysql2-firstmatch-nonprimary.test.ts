// M5.47: FirstMatch preserves outer row identity without a unique outer key.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { joinOrder, type Candidate } from '../../packages/core/src/sql/cost.ts'
// @ts-expect-error — the capture owns plan normalization.
import { CONNECTION, SQL_MODE, planSkeleton } from '../../tools/capture-relational.mjs'

function firstMatch(outer: string, inner: string, index: string, nullable = true, first = true) {
  return `${first ? 'Nested loop semijoin' : 'Nested loop inner join'}\n    Sort\n${nullable ? '        Filter\n            ' : '        '}Table scan on ${outer}\n${first ? '    ' : '    Limit\n        '}Covering index lookup on ${inner} using ${index}`
}

async function connect(schema: string, utf8 = false) {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({ ...(utf8 ? CONNECTION : {}), supportBigNumbers: true, bigNumberStrings: true,
    ...(db === undefined ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream(), user: 'root', password: '' }) })
  await conn.query(`CREATE DATABASE IF NOT EXISTS ${schema}`)
  await conn.query(`USE ${schema}`)
  return { conn, db }
}

function fieldsOf(fields: mysql.FieldPacket[]) {
  return fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

test('non-primary FirstMatch matches native captures 36/88 across nullable and duplicate outer keys', async () => {
  const { conn, db } = await connect('nonprimary77', true)
  const fixture = JSON.parse(readFileSync(new URL('../format/fixtures/relational.json', import.meta.url), 'utf8')) as { cases: { sql: string }[][] }
  try {
    await conn.query(`SET sql_mode=${mysql.escape(SQL_MODE)}`)
    for (const capture of [36, 88]) for (const state of ['captured', 'matches', 'duplicates', 'nulls', 'emptyOuter', 'emptyInner']) {
      await conn.query('DROP TABLE IF EXISTS pa,kl')
      for (const o of fixture.cases[capture]!) if (/^(CREATE TABLE (pa|kl) |INSERT INTO (pa|kl) )/.test(o.sql)) await conn.query(o.sql)
      if (state !== 'captured') {
        await conn.query('DELETE FROM kl')
        if (state !== 'emptyOuter') await conn.query('INSERT INTO kl(g,s) VALUES ' + (state === 'matches' ? "(1,'a'),(2,'b')" : state === 'duplicates' ? "(2,'same'),(2,'same')" : "(NULL,'null'),(2,'match')"))
        if (state === 'nulls') await conn.query('UPDATE pa SET grp=NULL WHERE id=1')
        if (state === 'emptyInner') await conn.query('DELETE FROM pa')
      }
      await conn.query('ANALYZE TABLE pa,kl')
      for (const switches of ['default', 'loosescan=off', 'firstmatch=off', 'semijoin=off']) {
        await conn.query(`SET optimizer_switch=${mysql.escape(switches)}`)
        for (const variant of ['ordered', 'unordered', 'limit']) {
          const sql = 'SELECT g,s FROM kl WHERE g IN(SELECT grp FROM pa)' + (variant === 'ordered' ? ' ORDER BY 1,2' : variant === 'limit' ? ' ORDER BY 1,2 LIMIT 1' : '')
          let rows: unknown[][] = state === 'duplicates' ? [[2, 'same'], [2, 'same']] : state === 'nulls' ? [[2, 'match']]
            : state === 'matches' ? (capture === 36 ? [[1, 'a'], [2, 'b']] : [[2, 'b']]) : []
          if (variant === 'limit') rows = rows.slice(0, 1)
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [actual, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(actual, rows, `${capture}/${state}/${switches}/${variant}/${method}`)
            assert.deepEqual(fieldsOf(fields), [['g', 3, 11, 0, 0, 63, 'nonprimary77', 'kl', 'kl', 'g'], ['s', 253, 40, 0, 0, 255, 'nonprimary77', 'kl', 'kl', 's']])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            // Empty-inner hash LooseScan and FirstMatch use native topology assertions.
            const emptyFirstMatch = state === 'emptyInner' && switches === 'loosescan=off' && variant === 'unordered'
            const emptyHash = state === 'emptyInner' && switches === 'default' && variant !== 'limit'
            if ((state !== 'emptyInner' && switches !== 'semijoin=off') || emptyFirstMatch || emptyHash) {
              let plan = firstMatch('kl', 'pa', 'grp', true, switches !== 'firstmatch=off')
              if (variant === 'unordered') plan = plan.replace('    Sort\n        Filter\n            ', '    Filter\n        ')
              if (emptyHash) {
                const hash = 'Inner hash join\n    Table scan on kl\n    Hash\n        Remove duplicates from input sorted on grp\n            Covering index scan on pa using grp'
                plan = variant === 'ordered' ? `Sort\n    Stream results\n${hash.split('\n').map((line) => `        ${line}`).join('\n')}` : hash
              }
              if (variant === 'limit') plan = `Limit\n${plan.split('\n').map((line) => `    ${line}`).join('\n')}`
              const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
              assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
            }
            conn.unprepare(options)
          }
        }
      }
      await conn.query("SET optimizer_switch='default'")
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS nonprimary77')
    await conn.end()
    await db?.end()
  }
})

test('non-primary integer keys preserve duplicates, exact BIGINTs and cached plans after writes', async () => {
  const { conn, db } = await connect('nonprimary_fresh77')
  try {
    for (const [type, key, code, width, flags] of [['INT', '', 3, 11, 0], ['INT UNSIGNED', ',KEY(g)', 3, 10, 16424], ['SMALLINT', ',PRIMARY KEY(id,g)', 2, 6, 20483], ['BIGINT', ',PRIMARY KEY(id)', 8, 20, 0]] as const) {
      const matched = type === 'BIGINT' ? '9007199254740993' : 2
      const absent = type === 'BIGINT' ? '9007199254740994' : 9
      const nullable = type !== 'SMALLINT'
      await conn.query('DROP TABLE IF EXISTS pa,ch')
      await conn.query(`CREATE TABLE pa(id INT NOT NULL,g ${type},s VARCHAR(12)${key}) STATS_AUTO_RECALC=0`)
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
      await conn.query(`INSERT INTO pa VALUES(1,${matched},'same'),(2,${matched},'same'),(3,${nullable ? 'NULL' : absent},'null'),(4,${absent},'absent')`)
      await conn.query('INSERT INTO ch VALUES ' + [[1, matched], [2, matched], [3, matched], [4, null], ...Array.from({ length: 200 }, (_, i) => [i + 10, i + 10])].map(([i, g]) => `(${i},${g === null ? 'NULL' : g})`).join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      const expectedFields = [['g', code, width, flags, 0, 63, 'nonprimary_fresh77', 'p', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'nonprimary_fresh77', 'p', 'pa', 's']]
      for (const variant of ['in', 'exists', 'limit']) {
        const sql = variant === 'exists' ? 'SELECT p.g,p.s FROM pa p WHERE EXISTS(SELECT 1 FROM ch c WHERE p.g=c.g) ORDER BY 1,2'
          : 'SELECT p.g,p.s FROM pa p WHERE p.g IN(SELECT c.g FROM ch c) ORDER BY 1,2' + (variant === 'limit' ? ' LIMIT 1' : '')
        const statement = await conn.prepare({ sql, rowsAsArray: true })
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fieldsOf(columns), expectedFields, `${type}: prepare fields`)
        try {
          for (const [state, write] of [['initial', ''], ['removed', `UPDATE ch SET g=${absent} WHERE id IN(1,2,3)`], ['restored', `UPDATE ch SET g=${matched} WHERE id IN(1,2,3)`], ['firstoff', "SET optimizer_switch='firstmatch=off'"], ['firston', "SET optimizer_switch='firstmatch=on'"]]) {
            if (write !== '') await conn.query(write!)
            let expected: unknown[][] = state === 'removed' ? (nullable ? [[absent, 'absent']] : [[absent, 'absent'], [absent, 'null']]) : [[matched, 'same'], [matched, 'same']]
            if (variant === 'limit') expected = expected.slice(0, 1)
            for (const method of ['query', 'execute', 'prepared']) {
              const options = { sql, rowsAsArray: true }
              const [rows, fields] = method === 'prepared' ? await statement.execute([]) : method === 'query' ? await conn.query(options) : await conn.execute(options)
              assert.deepEqual(rows, method === 'prepared' ? expected.map(([g, s]) => ({ g, s })) : expected, `${type}/${variant}/${state}/${method}`)
              assert.deepEqual(fieldsOf(fields), expectedFields)
              assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
              let plan = firstMatch('p', 'c', 'g', nullable, state !== 'firstoff')
              if (variant === 'limit') plan = `Limit\n${plan.split('\n').map((line) => `    ${line}`).join('\n')}`
              const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
              assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
            }
          }
        } finally {
          await statement.close()
          conn.unprepare({ sql, rowsAsArray: true })
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS nonprimary_fresh77')
    await conn.end()
    await db?.end()
  }
})

test('FirstMatch admission retains native copied fields as a prepared inner changes cardinality', async () => {
  const { conn, db } = await connect('firstmatch_fresh86')
  try {
    await conn.query('CREATE TABLE pa(id INT NOT NULL,g INT UNSIGNED,s VARCHAR(12),KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT UNSIGNED,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(1,2,'same'),(2,2,'same'),(3,NULL,'null'),(4,9,'absent')")
    const initial = 'INSERT INTO ch VALUES ' + [[1, 2], [2, 2], [3, 2], [4, null], ...Array.from({ length: 200 }, (_, i) => [i + 10, i + 10])].map(([id, g]) => `(${id},${g === null ? 'NULL' : g})`).join(',')
    await conn.query(initial)
    await conn.query("SET optimizer_switch='default,loosescan=off'")
    await conn.query('ANALYZE TABLE pa,ch')
    const sql = 'SELECT p.g,p.s FROM pa p WHERE p.g IN(SELECT c.g FROM ch c) ORDER BY 1,2'
    const expectedFields = (flags: number) => [['g', 3, 10, flags, 0, 63, 'firstmatch_fresh86', 'p', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'firstmatch_fresh86', 'p', 'pa', 's']]
    const statement = await conn.prepare({ sql, rowsAsArray: true })
    const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
    assert.deepEqual(fieldsOf(columns), expectedFields(16424))
    try {
      for (const [state, writes] of [
        ['initial', []], ['empty', ['DELETE FROM ch']],
        ['duplicates', ['INSERT INTO ch VALUES(1,2),(2,2),(3,2),(4,NULL)']],
        ['nulls', ['UPDATE ch SET g=NULL']], ['restored', ['DELETE FROM ch', initial]],
        ['firstoff', ["SET optimizer_switch='firstmatch=off'"]], ['firston', ["SET optimizer_switch='firstmatch=on'"]],
      ] as const) {
        for (const write of writes) await conn.query(write)
        await conn.query('ANALYZE TABLE pa,ch')
        const expected: unknown[][] = state === 'empty' || state === 'nulls' ? [] : [[2, 'same'], [2, 'same']]
        const flags = state === 'empty' || state === 'duplicates' || state === 'nulls' ? 32 : 16424
        for (const method of ['query', 'execute', 'prepared'] as const) {
          await conn.query('DO 0')
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'prepared' ? await statement.execute([]) : method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, method === 'prepared' ? expected.map(([g, s]) => ({ g, s })) : expected, `${state}/${method}`)
          assert.deepEqual(fieldsOf(fields), expectedFields(flags), `${state}/${method}`)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        }
      }
    } finally {
      await statement.close()
      conn.unprepare({ sql, rowsAsArray: true })
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS firstmatch_fresh86')
    await conn.end()
    await db?.end()
  }
})

test('non-primary FirstMatch probes each outer occurrence once and closes scans on early return', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE pa(g INT,s VARCHAR(12)) STATS_AUTO_RECALC=0')
    await db.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await db.query("INSERT INTO pa VALUES(2,'same'),(2,'same'),(NULL,'null'),(9,'absent')")
    await db.query('INSERT INTO ch VALUES ' + [[1, 2], [2, 2], [3, 2], ...Array.from({ length: 200 }, (_, i) => [i + 10, i + 10])].map(([i, g]) => `(${i},${g})`).join(','))
    await db.query('ANALYZE TABLE pa,ch')
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let probes = 0
    let examined = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          const probe = index === 'g' && range?.from !== undefined && range.to !== undefined
          if (probe) probes++
          try {
            for (const row of scan(index, range, transaction, mode)) {
              if (probe) examined++
              yield row
            }
          } finally {
            if (probe) closed++
          }
        }
      }
      return table
    }
    const sql = 'SELECT g,s FROM d.pa WHERE g IN(SELECT g FROM d.ch) ORDER BY 1,2'
    try {
      assert.deepEqual((await db.query(sql))[0], [{ g: 2, s: 'same' }, { g: 2, s: 'same' }])
      assert.equal(probes, 3, 'two duplicate outer occurrences and one absent key')
      assert.equal(examined, 2, 'one match for each occurrence, despite three inner duplicates')
      assert.equal(closed, probes)
    } finally {
      catalog.table = open
    }
    for await (const row of db.stream(`${sql} FOR UPDATE`)) {
      assert.deepEqual(row, { g: 2, s: 'same' })
      break
    }
    assert.equal(db.openConnections, 1)
    const writer = await db.connect()
    try {
      await writer.query('SET innodb_lock_wait_timeout=1')
      await writer.query('UPDATE d.ch SET g=9 WHERE g=2')
    } finally {
      await writer.end()
    }
    assert.deepEqual((await db.query(sql))[0], [{ g: 9, s: 'absent' }])
  } finally {
    await db.end()
  }
})


test('hash LooseScan preserves duplicate outer rows and filters before key deduplication', async () => {
  const { conn, db } = await connect('hash_loose87')
  const hash = 'Inner hash join\n    Table scan on pa\n    Hash\n        Remove duplicates from input sorted on g\n'
  try {
    await conn.query('CREATE TABLE pa(id INT NOT NULL,g INT,s VARCHAR(12)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    // The first g=2 row fails the residual, but the next one qualifies. g=1
    // has only a failing row; NULL must never enter the equality hash.
    await conn.query('INSERT INTO ch VALUES(0,1),(1,2),(2,2),(3,2),(4,NULL),(5,3),(6,3)')
    for (const count of [20, 200]) {
      await conn.query('DELETE FROM pa')
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: count }, (_, i) => `(${i + 1},${i % 4 === 0 ? 'NULL' : i % 4},'same')`).join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      for (const switches of ['default', 'default,firstmatch=off']) {
        await conn.query(`SET optimizer_switch=${mysql.escape(switches)}`)
        for (const variant of ['in', 'filter', 'exists']) {
          const predicate = variant === 'in' ? 'g IN(SELECT g FROM ch)' : variant === 'filter'
            ? 'g IN(SELECT g FROM ch WHERE id>1)' : 'EXISTS(SELECT 1 FROM ch WHERE pa.g=ch.g AND ch.id>1)'
          const sql = `SELECT g,s FROM pa WHERE ${predicate} ORDER BY 1,2`
          const expected = (variant === 'in' ? [1, 2, 3] : [2, 3]).flatMap((g) => Array.from({ length: count / 4 }, () => [g, 'same']))
          const input = variant === 'in' ? '            Covering index scan on ch using g' : '            Filter\n                Covering index scan on ch using g'
          const plan = `Sort\n    Stream results\n${(hash + input).split('\n').map((line) => `        ${line}`).join('\n')}`
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, expected, `${count}/${switches}/${variant}/${method}`)
            assert.deepEqual(fieldsOf(fields), [['g', 3, 11, 0, 0, 63, 'hash_loose87', 'pa', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'hash_loose87', 'pa', 'pa', 's']])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
            assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
            conn.unprepare(options)
          }
        }
      }
    }
    if (db !== undefined) {
      await conn.query("SET optimizer_switch='default'")
      const catalog = db.catalog!
      const open = catalog.table.bind(catalog)
      let scans = 0
      let examined = 0
      let closed = 0
      catalog.table = (schema, name, trx) => {
        const table = open(schema, name, trx)
        if (schema === 'hash_loose87' && name === 'ch') {
          const scan = table.indexScan.bind(table)
          table.indexScan = function*(index, range, transaction, mode) {
            if (mode !== 'current') { yield* scan(index, range, transaction, mode); return }
            assert.equal(index, 'g')
            assert.equal(range?.from, undefined, 'build the inner key input once, without per-outer probes')
            scans++
            try {
              for (const row of scan(index, range, transaction, mode)) { examined++; yield row }
            } finally { closed++ }
          }
        }
        return table
      }
      try {
        const sql = 'SELECT g,s FROM hash_loose87.pa WHERE g IN(SELECT g FROM hash_loose87.ch WHERE id>1) ORDER BY 1,2 FOR UPDATE'
        for await (const row of db.stream(sql)) { assert.deepEqual(row, { g: 2, s: 'same' }); break }
        assert.equal(scans, 1)
        assert.equal(examined, 7, 'filter and deduplicate one complete index scan')
        assert.equal(closed, 1)
      } finally { catalog.table = open }
      const writer = await db.connect()
      try {
        await writer.query('SET innodb_lock_wait_timeout=1')
        await writer.query('UPDATE hash_loose87.ch SET g=9 WHERE g=2')
      } finally { await writer.end() }
      assert.deepEqual((await conn.query({ sql: 'SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch WHERE id>1) ORDER BY 1,2', rowsAsArray: true }))[0], Array.from({ length: 50 }, () => [3, 'same']))
    }
    await conn.query("SET optimizer_switch='default,block_nested_loop=off'")
    const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch WHERE id>1) ORDER BY 1,2')
    assert.doesNotMatch(planSkeleton(explain[0]?.EXPLAIN), /Inner hash join/)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS hash_loose87')
    await conn.end()
    await db?.end()
  }
})


test('FirstMatch sort costing counts outer rows instead of duplicate inner fanout', async () => {
  // At this fanout the old sort cost incorrectly prefers inner-first deduplication.
  const candidates: Candidate[] = ['p', 'c'].map((alias) => ({
    alias, rows: 4, dependent: new Set<string>(), keyDependent: new Set([alias === 'p' ? 'c' : 'p']),
    place: (prefix) => ({ alias, fetched: prefix.length === 0 ? 4 : 2, filter: 1, keyFrom: new Set<string>(), lookup: prefix.length > 0, read: prefix.length === 0 ? 0.25 : 1.0011 }),
  }))
  assert.deepEqual(joinOrder(candidates, { alias: 'p', limit: Infinity }, undefined, 'c').map((p) => p.alias), ['p', 'c'])
  const { conn, db } = await connect('firstmatch_sort90')
  try {
    await conn.query('CREATE TABLE pa(id INT NOT NULL,g INT,s VARCHAR(12)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(1,2,'same'),(2,2,'same'),(3,NULL,'null'),(4,9,'absent')")
    await conn.query('INSERT INTO ch VALUES(1,2),(2,2),(3,2),(4,NULL)')
    await conn.query('ANALYZE TABLE pa,ch')
    await conn.query("SET optimizer_switch='default,loosescan=off'")
    for (const limited of [false, true]) {
      const sql = 'SELECT p.g,p.s FROM pa p WHERE p.g IN(SELECT c.g FROM ch c) ORDER BY 1,2' + (limited ? ' LIMIT 1' : '')
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, limited ? [[2, 'same']] : [[2, 'same'], [2, 'same']])
        assert.deepEqual(fieldsOf(fields), [['g', 3, 11, 0, 0, 63, 'firstmatch_sort90', 'p', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'firstmatch_sort90', 'p', 'pa', 's']])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        conn.unprepare(options)
      }
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      const plan = firstMatch('p', 'c', 'g')
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), limited ? 'Limit\n' + plan.split('\n').map((line) => '    ' + line).join('\n') : plan)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS firstmatch_sort90')
    await conn.end(); await db?.end()
  }
})


function materializedLookup(ordered: boolean) {
  const plan = `Nested loop inner join\n${ordered ? '    Sort\n        Filter\n            ' : '    Filter\n        '}Table scan on pa\n    Single-row index lookup on <subquery2> using <auto_distinct_key>\n        Materialize with deduplication\n            Filter\n                Covering index scan on ch using g`
  return ordered ? 'Limit\n' + plan.split('\n').map((line) => '    ' + line).join('\n') : plan
}

test('materialized lookup respects weedout ties, disabled alternatives and last-resort fallback', async () => {
  const { conn, db } = await connect('semijoin_tie98')
  try {
    for (const type of ['INT', 'BIGINT', 'BIGINT UNSIGNED']) {
      await conn.query('DROP TABLE IF EXISTS pa,ch')
      await conn.query(`CREATE TABLE pa(id INT NOT NULL,g ${type},s VARCHAR(12)) STATS_AUTO_RECALC=0`)
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
      const value = type === 'INT' ? 2 : '9007199254740994'
      await conn.query(`INSERT INTO pa VALUES(1,${value},'same')`)
      for (const [switches, materialized] of [
        ['default,firstmatch=off', false],
        ['default,firstmatch=off,duplicateweedout=off', true],
        ['default,firstmatch=off,loosescan=off,materialization=off,duplicateweedout=off', false],
      ] as const) {
        await conn.query('DELETE FROM ch')
        await conn.query('ANALYZE TABLE pa,ch')
        await conn.query('SET optimizer_switch=' + mysql.escape(switches))
        for (const ordered of [false, true]) {
          const sql = 'SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch)' + (ordered ? ' ORDER BY g,s LIMIT 1' : '')
          const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
          const loop = ordered ? firstMatch('pa', 'ch', 'g', true, false) : 'Nested loop inner join\n    Filter\n        Table scan on pa\n    Limit\n        Covering index lookup on ch using g'
          const plan = ordered ? 'Limit\n' + loop.split('\n').map((line) => '    ' + line).join('\n') : loop
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), materialized ? materializedLookup(ordered) : plan, `${type}/${switches}/${ordered}`)
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, [])
            assert.deepEqual(fieldsOf(fields), [['g', type === 'INT' ? 3 : 8, type === 'INT' ? 11 : 20, type.endsWith('UNSIGNED') ? 32 : 0, 0, 63, 'semijoin_tie98', 'pa', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'semijoin_tie98', 'pa', 'pa', 's']])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            conn.unprepare(options)
          }
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS semijoin_tie98')
    await conn.end(); await db?.end()
  }
})

test('LooseScan pruning retains the raw driver when materialization is disabled', async () => {
  const { conn, db } = await connect('semijoin_prune97')
  try {
    await conn.query('CREATE TABLE pa(id INT NOT NULL,g INT,s VARCHAR(12)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 20 }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : i%4},'same')`).join(','))
    await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 80 }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : i%4})`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
    await conn.query("SET optimizer_switch='default,firstmatch=off,materialization=off'")
    for (const ordered of [false, true]) {
      const sql = 'SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch)' + (ordered ? ' ORDER BY g,s LIMIT 1' : '')
      const expected = ordered ? [[1, 'same']] : Array.from({ length: 20 }, (_, i) => i%4===0 ? [] : [[i%4, 'same']]).flat()
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected)
        assert.deepEqual(fieldsOf(fields), [['g', 3, 11, 0, 0, 63, 'semijoin_prune97', 'pa', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'semijoin_prune97', 'pa', 'pa', 's']])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        conn.unprepare(options)
      }
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      const plan = ordered ? firstMatch('pa', 'ch', 'g', true, false) : 'Nested loop inner join\n    Filter\n        Table scan on pa\n    Limit\n        Covering index lookup on ch using g'
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), ordered ? 'Limit\n' + plan.split('\n').map((line) => '    ' + line).join('\n') : plan)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS semijoin_prune97')
    await conn.end(); await db?.end()
  }
})

test('ordered empty-inner materialization costs weedout with FirstMatch and LooseScan disabled', async () => {
  const { conn, db } = await connect('material_empty96')
  try {
    await conn.query('CREATE TABLE pa(id INT NOT NULL,g INT,s VARCHAR(12)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await conn.query("SET optimizer_switch='default,firstmatch=off,loosescan=off'")
    const sql = 'SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch) ORDER BY g,s LIMIT 1'
    for (const outer of [20, 200]) {
      await conn.query('DELETE FROM pa')
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: outer }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : i%4},'same')`).join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), materializedLookup(true))
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, [])
        assert.deepEqual(fieldsOf(fields), [['g', 3, 11, 0, 0, 63, 'material_empty96', 'pa', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'material_empty96', 'pa', 'pa', 's']])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        conn.unprepare(options)
      }
      const statement = await conn.prepare({ sql, rowsAsArray: true })
      try {
        assert.deepEqual((await statement.execute([]))[0], [])
        await conn.query('INSERT INTO ch VALUES(1,NULL),(2,2),(3,2)')
        assert.deepEqual((await statement.execute([]))[0], [{ g: 2, s: 'same' }])
        await conn.query('DELETE FROM ch')
        assert.deepEqual((await statement.execute([]))[0], [])
      } finally { await statement.close(); conn.unprepare({ sql, rowsAsArray: true }) }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS material_empty96')
    await conn.end(); await db?.end()
  }
})

test('materialized integer lookup retains duplicate outer identity, native fields and fresh prepared data', async () => {
  const { conn, db } = await connect('material_lookup90')
  try {
    for (const type of ['INT', 'BIGINT', 'BIGINT UNSIGNED']) {
      await conn.query('DROP TABLE IF EXISTS pa,ch')
      await conn.query(`CREATE TABLE pa(id INT NOT NULL,g ${type},s VARCHAR(12)) STATS_AUTO_RECALC=0`)
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
      const base = type === 'INT' ? 0n : 9007199254740992n
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 200 }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : base+BigInt(i%4)},'same')`).join(','))
      const insert = 'INSERT INTO ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : base+BigInt(i%4)})`).join(',')
      await conn.query(insert)
      await conn.query('ANALYZE TABLE pa,ch')
      const value = (n: number) => type === 'INT' ? n : String(base + BigInt(n))
      const expected = Array.from({ length: 200 }, (_, i) => i%4===0 ? [] : [[value(i%4), 'same']]).flat()
      for (const switches of ['default', 'default,firstmatch=off', 'default,loosescan=off', 'default,firstmatch=off,duplicateweedout=off']) {
        await conn.query('SET optimizer_switch=' + mysql.escape(switches))
        for (const ordered of [false, true]) {
          const sql = 'SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch)' + (ordered ? ' ORDER BY g,s LIMIT 1' : '')
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, ordered ? [[value(1), 'same']] : expected, `${type}/${switches}/${ordered}/${method}`)
            assert.deepEqual(fieldsOf(fields), [['g', type === 'INT' ? 3 : 8, type === 'INT' ? 11 : 20, type.endsWith('UNSIGNED') ? 32 : 0, 0, 63, 'material_lookup90', 'pa', 'pa', 'g'], ['s', 253, 48, 0, 0, 224, 'material_lookup90', 'pa', 'pa', 's']])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            conn.unprepare(options)
          }
          const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), materializedLookup(ordered))
        }
      }
      await conn.query("SET optimizer_switch='default'")
      const sql = 'SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch) ORDER BY g,s LIMIT 1'
      const statement = await conn.prepare({ sql, rowsAsArray: true })
      try {
        assert.deepEqual((await statement.execute([]))[0], [{ g: value(1), s: 'same' }])
        await conn.query(`UPDATE ch SET g=${base+2n} WHERE g IS NOT NULL`)
        assert.deepEqual((await statement.execute([]))[0], [{ g: value(2), s: 'same' }])
        await conn.query('UPDATE ch SET g=NULL')
        assert.deepEqual((await statement.execute([]))[0], [])
        await conn.query('DELETE FROM ch')
        assert.deepEqual((await statement.execute([]))[0], [])
        await conn.query(insert)
        assert.deepEqual((await statement.execute([]))[0], [{ g: value(1), s: 'same' }])
      } finally { await statement.close(); conn.unprepare({ sql, rowsAsArray: true }) }
    }
    await conn.query("SET optimizer_switch='default,firstmatch=off,materialization=off'")
    const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE SELECT g,s FROM pa WHERE g IN(SELECT g FROM ch)')
    assert.doesNotMatch(planSkeleton(explain[0]?.EXPLAIN), /Materialize with deduplication/)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS material_lookup90')
    await conn.end(); await db?.end()
  }
})

test('materialized lookup builds once after a non-NULL outer probe and closes a locking stream', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE material_reads90')
    await db.query('USE material_reads90')
    await db.query('CREATE TABLE pa(id INT NOT NULL,g INT,s VARCHAR(12)) STATS_AUTO_RECALC=0')
    await db.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0')
    await db.query('INSERT INTO pa VALUES' + Array.from({ length: 200 }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : i%4},'same')`).join(','))
    await db.query('INSERT INTO ch VALUES(1,NULL),(2,1),(3,2),(4,3),(5,NULL),(6,1),(7,2),(8,3)')
    await db.query('ANALYZE TABLE pa,ch')
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let builds = 0, examined = 0, closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'material_reads90' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          if (mode !== 'current') { yield* scan(index, range, transaction, mode); return }
          assert.equal(index, 'g')
          assert.equal(range?.from, undefined, 'one full key build rather than per-outer base lookups')
          builds++
          try { for (const row of scan(index, range, transaction, mode)) { examined++; yield row } }
          finally { closed++ }
        }
      }
      return table
    }
    const sql = 'SELECT g,s FROM material_reads90.pa WHERE g IN(SELECT g FROM material_reads90.ch) FOR UPDATE'
    try {
      for await (const row of db.stream(sql)) { assert.deepEqual(row, { g: 1, s: 'same' }); break }
      assert.deepEqual([builds, examined, closed], [1, 8, 1])
      await db.query('UPDATE material_reads90.pa SET g=NULL')
      builds = examined = closed = 0
      assert.deepEqual((await db.query(sql))[0], [])
      assert.deepEqual([builds, examined, closed], [0, 0, 0], 'NULL-only outer input must not initialize its inner build')
      await db.query('DELETE FROM material_reads90.pa')
      assert.deepEqual((await db.query(sql))[0], [])
      assert.deepEqual([builds, examined, closed], [0, 0, 0], 'empty outer input must not initialize its inner build')
    } finally { catalog.table = open }
    const writer = await db.connect()
    try {
      await writer.query('SET innodb_lock_wait_timeout=1')
      await writer.query('UPDATE material_reads90.ch SET g=9 WHERE g=2')
    } finally { await writer.end() }
  } finally { await db.end() }
})
