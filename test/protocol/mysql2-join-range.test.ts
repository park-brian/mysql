import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

async function rangeConnection() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

test('join range quotes preserve native ref choices, fields, buffering, order and fresh parameters', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range110'
  const indent = (plan: string, spaces: number) => plan.split('\n').map((line) => ' '.repeat(spaces) + line).join('\n')
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const covering of [false, true]) {
      await conn.query('CREATE TABLE pa(id INT PRIMARY KEY) STATS_AUTO_RECALC=0')
      await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,pa_id INT,KEY lookup_key(pa_id),KEY range_key(g' + (covering ? ',pa_id' : '') + ')) STATS_AUTO_RECALC=0')
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 20 }, (_, i) => `(${i+1})`).join(','))
      await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 64 }, (_, i) => `(${i+1},${i<2 ? i+1 : 0},${i%2+1})`).join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      for (const buffered of [true, false]) {
        await conn.query("SET optimizer_switch='default" + (buffered ? '' : ',block_nested_loop=off') + "'")
        for (const bound of [0, -1, 999]) for (const suffix of ['', ' ORDER BY pa.id,ch.g', ' LIMIT 1']) {
          const sql = 'SELECT pa.id,ch.g,ch.pa_id FROM pa STRAIGHT_JOIN ch ON ch.pa_id=pa.id WHERE ch.g>' + bound + suffix
          const ordered = suffix.startsWith(' ORDER')
          const broad = [1, 2].flatMap((id) => Array.from({ length: 32 }, (_, i) => [id, i === 0 ? id : 0, id]))
          const all = bound === 999 ? [] : bound === 0 ? [[1, 1, 1], [2, 2, 2]] : broad
          const expected = ordered ? all.toSorted((a, b) => a[0]! - b[0]! || a[1]! - b[1]!) : suffix === ' LIMIT 1' ? all.slice(0, 1) : all
          let plan = bound === -1
            ? 'Nested loop inner join\n    Covering index scan on pa using PRIMARY\n    Filter\n        Index lookup on ch using lookup_key'
            : buffered
              ? 'Inner hash join\n' + (covering ? '    Filter\n        Covering index' : '    Index') + ' range scan on ch using range_key over\n    Hash\n        Covering index scan on pa using PRIMARY'
              : 'Nested loop inner join\n    Covering index scan on pa using PRIMARY\n    Filter\n        ' + (covering ? 'Covering index' : 'Index') + ' range scan on ch using range_key over'
          if (ordered) plan = 'Sort\n    Stream results\n' + indent(plan, 8)
          else if (suffix !== '') plan = 'Limit\n' + indent(plan, 4)
          const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${covering}/${buffered}/${bound}/${suffix}`)
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, expected)
            assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
              ['id', 3, 11, ordered ? 4097 : 20483, 0, 63, schema, 'pa', 'pa', 'id'],
              ['g', 3, 11, ordered ? 0 : 16392, 0, 63, schema, 'ch', 'ch', 'g'],
              ['pa_id', 3, 11, ordered ? 0 : 16392, 0, 63, schema, 'ch', 'ch', 'pa_id'],
            ])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            conn.unprepare(options)
          }
        }
        const sql = 'SELECT pa.id,ch.g,ch.pa_id FROM pa STRAIGHT_JOIN ch ON ch.pa_id=pa.id WHERE ch.g>? ORDER BY pa.id,ch.g'
        const statement = await conn.prepare(sql)
        try {
          assert.deepEqual((await statement.execute([0]))[0], [{ id: 1, g: 1, pa_id: 1 }, { id: 2, g: 2, pa_id: 2 }])
          assert.deepEqual((await statement.execute([1]))[0], [{ id: 2, g: 2, pa_id: 2 }])
          assert.deepEqual((await statement.execute([999]))[0], [])
          await conn.query('UPDATE ch SET g=0 WHERE id<=2')
          assert.deepEqual((await statement.execute([0]))[0], [])
          await conn.query('UPDATE ch SET g=id WHERE id<=2')
        } finally { conn.unprepare(sql) }
      }
      await conn.query('DROP TABLE pa,ch')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('a LEFT hash build reads the right primary ranges and retains the ON filter', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range393'
  try {
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,label VARCHAR(10)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE r(n INT PRIMARY KEY,s VARCHAR(10) CHARACTER SET latin1,t VARCHAR(10) COLLATE utf8mb4_bin) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,'x'),(2,'Blue'),(3,'red'),(4,NULL)")
    const read = async (expected: (number | null)[][], hint = '') => {
      const sql = `SELECT p.id,r.n FROM p LEFT JOIN r ${hint} ON p.label=r.t AND r.s='zoë' AND r.n NOT IN (2,5.5) ORDER BY p.id,r.n`
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      const tree = String(explain[0]?.EXPLAIN)
      assert.equal(planSkeleton(tree), `Sort
    Stream results
        Left hash join
            Table scan on p
            Hash
                Filter
                    ${hint ? 'Table scan on r' : 'Index range scan on r using PRIMARY over'}`)
      if (!hint) assert.match(tree, /Index range scan on r using PRIMARY over \(n < 2\) OR \(2 < n\)(?= +\(cost=|\n)/)
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
          ['id', 3, 11, 4097, 0, 63, schema, 'p', 'p', 'id'],
          ['n', 3, 11, 4096, 0, 63, schema, 'r', 'r', 'n'],
        ])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
    }
    await conn.query('ANALYZE TABLE p,r')
    await read([[1, null], [2, null], [3, null], [4, null]])
    await conn.query("INSERT INTO r VALUES (1,'Bob','x'),(2,'zoë','x'),(6,'zoë','Blue'),(7,'zoë',NULL)")
    await conn.query('ANALYZE TABLE r')
    await read([[1, null], [2, 6], [3, null], [4, null]])
    await conn.query('UPDATE r SET n=3 WHERE n=2')
    await read([[1, 3], [2, 6], [3, null], [4, null]])
    await read([[1, 3], [2, 6], [3, null], [4, null]], 'IGNORE INDEX FOR JOIN (PRIMARY)')
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('named VARCHAR ranges preserve set-operation reads and prepared parameters', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range395'
  try {
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci')
    await conn.query('CREATE TABLE pa(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp INT,amt DECIMAL(6,2),UNIQUE KEY(name),KEY(grp)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE lt(n INT PRIMARY KEY,s VARCHAR(10) CHARACTER SET latin1) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa(name,grp,amt) VALUES ('ann',3,165.14), ('ÄNNA',4,235.52)")
    await conn.query("INSERT INTO lt VALUES (1,'al'),(3,'x y'),(5,'cy'),(7,'zoë'),(9,'Mo')")
    await conn.query('ANALYZE TABLE pa,lt')
    const sql = `SELECT amt,amt FROM pa WHERE name NOT IN ('al','cy') EXCEPT SELECT n,s FROM lt
      UNION ALL (SELECT name,grp FROM pa WHERE name IN ('green','cy') AND amt BETWEEN 152.25 AND 147) ORDER BY 1,2`
    const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
    const tree = String(explain[0]?.EXPLAIN)
    assert.match(tree, /Index range scan on pa using name over \(name < 'al'\) OR \('al' < name < 'cy'\) OR \('cy' < name\)/)
    assert.match(tree, /Index range scan on pa using name over \(name = 'cy'\) OR \(name = 'green'\)/)
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, [['165.14', '165.14'], ['235.52', '235.52']])
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
        ['amt', 253, 56, 0, 0, 255, '', '', '', 'amt'],
        ['amt', 253, 44, 0, 0, 255, '', '', '', 'amt'],
      ])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }

    const filter = 'SELECT id,name FROM pa WHERE name NOT IN (?,?) ORDER BY id'
    const statement = await conn.prepare(filter)
    try {
      assert.deepEqual((await statement.execute(['ANN', 'cy']))[0], [{ id: 2, name: 'ÄNNA' }])
      await conn.query("UPDATE pa SET name='cy' WHERE id=2")
      assert.deepEqual((await statement.execute(['ANN', 'cy']))[0], [])
      assert.deepEqual((await statement.execute(['al', 'cy']))[0], [{ id: 1, name: 'ann' }])
      assert.deepEqual((await statement.execute([null, 'cy']))[0], [])
    } finally { conn.unprepare(filter) }

    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,n VARCHAR(8),p INT,KEY by_name(n)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO t VALUES ?', [[[1, 'AL', 1], [2, 'al ', 2], [3, 'al\u00a0', 3], [4, 'ax', 4], [5, 'CY', 5], [6, null, 6], [7, 'z', 7], [8, '', 8]]])
    await conn.query('ANALYZE TABLE t')
    for (const [condition, order, expectedPlan, ids] of [
      ["n NOT IN ('al ','CY')", 'id', 'Filter\n    Index scan on t using PRIMARY', [1, 4, 7, 8]],
      ["n < 'al '", 'id', 'Sort\n    Index range scan on t using by_name over', [1, 8]],
      ["n < 'al '", 'n,id', 'Index range scan on t using by_name over', [8, 1]],
      ["n < 'al '", 'n DESC,id DESC', 'Index range scan on t using by_name over', [1, 8]],
    ] as const) {
      const sql = `SELECT id,p FROM t WHERE ${condition} ORDER BY ${order}`
      const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), expectedPlan, order)
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, ids.map((id) => [id, id]))
      }
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('NO PAD CHAR bounds retain rows through padding and exclusion', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range_pad395'
  try {
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,n CHAR(8),KEY by_name(n))')
    await conn.query('INSERT INTO t VALUES ?', [[[1, 'al '], [2, 'al\u00a0'], [3, 'al\u3000'], [4, 'cy'], [5, null]]])
    for (const method of ['query', 'execute'] as const) {
      const notIn = { sql: "SELECT id FROM t WHERE n NOT IN ('al ','cy') ORDER BY id", rowsAsArray: true }
      const [excluded] = method === 'query' ? await conn.query(notIn) : await conn.execute(notIn)
      assert.deepEqual(excluded, [[1]])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])

      // The reference's index lookup loses the non-ASCII space matches.
      // Its table scan gives the SQL comparison result used as the oracle.
      const equal = { sql: `SELECT id FROM t ${db === undefined ? 'IGNORE INDEX (by_name)' : ''} WHERE n = 'al ' ORDER BY id`, rowsAsArray: true }
      const [matched] = method === 'query' ? await conn.query(equal) : await conn.execute(equal)
      assert.deepEqual(matched, [[2], [3]])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('buffered and repeated range joins close reads under LIMIT and stream cancellation', async () => {
  for (const covering of [false, true]) for (const buffered of [true, false]) {
    const db = await MySQL.open(':memory:')
    const schema = 'join_range_reads110'
    const payload = 'same'.repeat(50)
    const switches = "SET optimizer_switch='default" + (buffered ? '' : ',block_nested_loop=off') + "'"
    try {
      await db.query(`CREATE DATABASE ${schema}`)
      await db.query(`CREATE TABLE ${schema}.pa(id INT PRIMARY KEY) STATS_AUTO_RECALC=0`)
      await db.query(`CREATE TABLE ${schema}.ch(id INT PRIMARY KEY,g INT,pa_id INT,s VARCHAR(255),KEY lookup_key(pa_id),KEY range_key(g${covering ? ',pa_id,s' : ''})) STATS_AUTO_RECALC=0`)
      await db.query(`INSERT INTO ${schema}.pa VALUES` + Array.from({ length: 20 }, (_, i) => `(${i+1})`).join(','))
      await db.query(`INSERT INTO ${schema}.ch VALUES` + Array.from({ length: 16384 }, (_, i) => `(${i+1},${i<2048 ? 1 : 0},${i%2+1},'${payload}')`).join(','))
      await db.query(`ANALYZE TABLE ${schema}.pa,${schema}.ch`)
      await db.query(switches)
      const open = db.catalog!.table.bind(db.catalog)
      let opened = 0, visited = 0, closed = 0
      db.catalog!.table = (s, name, trx) => {
        const table = open(s, name, trx)
        if (s === schema && name === 'ch') {
          const scan = table.indexScan.bind(table)
          table.indexScan = function*(index, range, transaction, mode) {
            if (mode !== 'current') { yield* scan(index, range, transaction, mode); return }
            assert.equal(index, 'range_key')
            opened++
            try { for (const row of scan(index, range, transaction, mode)) { visited++; yield row } }
            finally { closed++ }
          }
        }
        return table
      }
      const sql = `SELECT pa.id,ch.g,ch.pa_id,ch.s FROM ${schema}.pa STRAIGHT_JOIN ${schema}.ch ON ch.pa_id=pa.id WHERE ch.g>0`
      try {
        const [rows] = await db.query<unknown[]>(sql + ' ORDER BY pa.id FOR UPDATE')
        assert.equal(rows.length, 2048)
        assert.deepEqual([opened, visited, closed], buffered ? [1, 2048, 1] : [20, 40960, 20])
        opened = visited = closed = 0
        assert.deepEqual((await db.query(sql + ' LIMIT 1 FOR UPDATE'))[0], [{ id: 1, g: 1, pa_id: 1, s: payload }])
        assert.deepEqual([opened, visited, closed], [1, 1, 1])
        opened = visited = closed = 0
        const streaming = await db.connect()
        try {
          await streaming.query(switches)
          // Exceed both protocol queues so cancellation interrupts an active range.
          const wide = sql.replace('ch.s FROM', 'REPEAT(ch.s,16) AS s FROM')
          for await (const row of streaming.stream<{ s: string }>(wide + ' FOR UPDATE')) { assert.equal(row.s, payload.repeat(16)); break }
        } finally { await streaming.end() }
        assert.equal(opened, closed)
        assert.ok(visited > 0 && visited < (buffered ? 2048 : 40960), JSON.stringify({ covering, buffered, opened, visited, closed }))
      } finally { db.catalog!.table = open }
      const writer = await db.connect()
      try {
        await writer.query('SET innodb_lock_wait_timeout=1')
        await writer.query(`UPDATE ${schema}.ch SET g=0 WHERE id=1`)
      } finally { await writer.end() }
    } finally { await db.end() }
  }
})

test('a reversed indexed BETWEEN arm leaves the named point range and its residual', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range_between396'
  try {
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp INT,amt DECIMAL(6,2),UNIQUE KEY by_name(name),KEY by_grp(grp)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE lt(n INT PRIMARY KEY,t VARCHAR(10) COLLATE utf8mb4_bin) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,'Bob',2,NULL),(2,'al',4,NULL),(3,'b',3,263.08),(4,'éva',NULL,58.31)")
    await conn.query("INSERT INTO lt VALUES (1,'x'),(3,NULL),(5,'green'),(7,'red'),(9,'cy')")
    await conn.query('ANALYZE TABLE p,lt')
    const prefix = 'SELECT p.amt AS amount,lt.t,COUNT(*) AS total,MAX(lt.n)-MIN(p.grp) AS spread FROM lt LEFT JOIN p'
    const membership = "p.name IN ('ann','ann')"
    const between = 'p.grp BETWEEN 5.5 AND 2'
    const sql = (filter: string, hint = '') => `${prefix} ${hint} ON lt.n >= p.id WHERE ${filter} GROUP BY p.amt,lt.t ORDER BY 1,2,3,4`
    const expression = `${membership} OR ${between}`
    const namedPoint = /Index range scan on p using by_name over \(name = 'ann'\)/
    for (const method of ['query', 'execute'] as const) {
      const explain = async (filter: string, hint = ''): Promise<string> => {
        const text = 'EXPLAIN FORMAT=TREE ' + sql(filter, hint)
        const [rows] = method === 'query' ? await conn.query<mysql.RowDataPacket[]>(text) : await conn.execute<mysql.RowDataPacket[]>(text)
        return String(rows[0]?.EXPLAIN)
      }
      for (const filter of [expression, `${between} OR ${membership}`]) {
        const plan = await explain(filter)
        assert.match(plan, namedPoint)
        assert.match(plan, /Filter[^\n]*\n\s*-> Index range scan on p using by_name/)
      }
      assert.doesNotMatch(await explain(expression, 'IGNORE INDEX (by_grp)'), namedPoint)
      const options = { sql: sql(expression), rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, [])
      assert.deepEqual(fields.map((f) => [f.name, f.columnType]), [['amount', 246], ['t', 253], ['total', 8], ['spread', 8]])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }

    const text = sql(`${membership} OR p.grp BETWEEN ? AND ?`)
    const statement = await conn.prepare(text)
    try {
      assert.deepEqual((await statement.execute([5.5, 2]))[0], [])
      await conn.query("INSERT INTO p VALUES (5,'ann',3,4.39)")
      const joined = [['cy', 6], ['green', 2], ['red', 4]] as const
      assert.deepEqual((await statement.execute([5.5, 2]))[0], joined.map(([t, spread]) => ({ amount: '4.39', t, total: 1, spread })))
      await conn.query('UPDATE p SET grp=NULL WHERE id=5')
      assert.deepEqual((await statement.execute([5.5, 2]))[0], joined.map(([t]) => ({ amount: '4.39', t, total: 1, spread: null })))
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const [ordered] = await statement.execute([2, 5.5])
      assert.ok(Array.isArray(ordered))
      assert.equal(ordered.length, 12)
    } finally { conn.unprepare(text) }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('two exact prepared BETWEEN bounds retain precision when pricing the named point range', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range_bounds397'
  try {
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp BIGINT,amt INT,UNIQUE KEY by_name(name),KEY by_grp(grp)) STATS_AUTO_RECALC=0')
    await conn.query(`INSERT INTO p VALUES (1,'Bob',2,101),(2,'al',4,102),(3,'b',3,103),(4,'éva',NULL,104),(5,'ann',3,105),
      (6,'rounded',9007199254740992,106),(7,'next',9007199254740993,107),(8,'other',9007199254740994,108)`)
    await conn.query('ANALYZE TABLE p')
    const sql = "SELECT id,amt FROM p WHERE name IN ('ann','ann') OR grp BETWEEN ? AND ? ORDER BY id"
    const explain = 'EXPLAIN FORMAT=TREE ' + sql
    const statement = await conn.prepare(sql)
    const description = await conn.prepare(explain)
    const { DOUBLE, LONGLONG, NEWDECIMAL, NULL } = mysql.TypedParameter
    try {
      const rows = [{ id: 5, amt: 105 }]
      for (const bounds of [
        [LONGLONG('9007199254740993'), LONGLONG('9007199254740992')],
        [NEWDECIMAL('5.5'), NEWDECIMAL('2.0')],
      ]) {
        assert.deepEqual((await statement.execute(bounds))[0], rows)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [tree] = await description.execute(bounds)
        assert.match(String((tree as mysql.RowDataPacket[])[0]?.EXPLAIN), /Index range scan on p using by_name over \(name = 'ann'\)/)
      }
      await conn.query('UPDATE p SET grp=NULL,amt=205 WHERE id=5')
      assert.deepEqual((await statement.execute([LONGLONG(2), LONGLONG(5)]))[0], [
        { id: 1, amt: 101 }, { id: 2, amt: 102 }, { id: 3, amt: 103 }, { id: 5, amt: 205 },
      ])
      assert.deepEqual((await statement.execute([LONGLONG(5), NULL()]))[0], [{ id: 5, amt: 205 }])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])

      // The native indexed plan can discard rows accepted by its comparison.
      const comparison = db === undefined ? sql.replace('FROM p', 'FROM p IGNORE INDEX(by_grp,by_name)') : sql
      assert.deepEqual((await conn.execute(comparison, [NEWDECIMAL('9007199254740993'), DOUBLE(9007199254740992)]))[0], [
        { id: 5, amt: 205 }, { id: 6, amt: 106 }, { id: 7, amt: 107 },
      ])
    } finally {
      conn.unprepare(sql)
      conn.unprepare(explain)
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})
