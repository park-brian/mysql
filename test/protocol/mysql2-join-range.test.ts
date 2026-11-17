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

test('a three-row primary range beats a covering scan and supplies its own order', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range_cost398'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,n INT,KEY by_n(n)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO t VALUES (1,4),(2,3),(3,2),(4,1)')
    await conn.query('ANALYZE TABLE t')
    for (const [order, expectedPlan, values] of [
      ['', 'Filter\n    Index range scan on t using PRIMARY over', [3,2,1]],
      ['ORDER BY id DESC', 'Filter\n    Index range scan on t using PRIMARY over', [1,2,3]],
      ['ORDER BY n', 'Sort\n    Filter\n        Index range scan on t using PRIMARY over', [1,2,3]],
    ] as const) {
      const sql = `SELECT n FROM t WHERE id > 1 ${order}`
      for (const method of ['query','execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, values.map((n) => [n]))
        const explain = 'EXPLAIN FORMAT=TREE ' + sql
        const [tree] = method === 'query' ? await conn.query<mysql.RowDataPacket[]>(explain) : await conn.execute<mysql.RowDataPacket[]>(explain)
        assert.equal(planSkeleton(tree[0]?.EXPLAIN), expectedPlan)
      }
    }
    const expression = "SELECT CAST(CONCAT(n,'x') AS SIGNED) AS value FROM t WHERE id > 1 ORDER BY id DESC LIMIT 1 OFFSET 1"
    for (const method of ['query','execute'] as const) {
      const [rows] = method === 'query' ? await conn.query(expression) : await conn.execute(expression)
      assert.deepEqual(rows, [{ value: 2 }])
      const [warnings] = await conn.query<mysql.RowDataPacket[]>('SHOW WARNINGS')
      assert.deepEqual(warnings.map((w) => w.Code), [1292])
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('prepared NULL BETWEEN bounds use the negative lower endpoint only when it fits the key', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'join_range_null399'
  try {
    await conn.query(`CREATE DATABASE ${schema} DEFAULT COLLATE utf8mb4_0900_ai_ci`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp DECIMAL(5,2),amt INT,UNIQUE KEY by_name(name),KEY by_grp(grp)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO p VALUES (1,'Bob',2,101),(2,'al',4,102),(3,'b',3,103),(4,'éva',NULL,104),(5,'ann',3,105)")
    await conn.query('ANALYZE TABLE p')
    const sql = "SELECT id,amt FROM p WHERE name IN ('ann','ann') OR grp BETWEEN ? AND ? ORDER BY id"
    const explain = 'EXPLAIN FORMAT=TREE ' + sql
    const statement = await conn.prepare(sql)
    const description = await conn.prepare(explain)
    const { NEWDECIMAL, NULL } = mysql.TypedParameter
    const namedPoint = /Index range scan on p using by_name over \(name = 'ann'\)/
    try {
      for (const [bounds, point] of [
        [[NEWDECIMAL('-999.995'), NULL()], false],
        [[NEWDECIMAL('-999.99'), NULL()], true],
        [[NULL(), NEWDECIMAL('-999.995')], true],
        [[NULL(), NULL()], true],
      ] as const) {
        assert.deepEqual((await statement.execute([...bounds]))[0], [{ id: 5, amt: 105 }])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [tree] = await description.execute([...bounds])
        assert.equal(namedPoint.test(String((tree as mysql.RowDataPacket[])[0]?.EXPLAIN)), point)
      }
      await conn.query('UPDATE p SET amt=205 WHERE id=5')
      assert.deepEqual((await statement.execute([NEWDECIMAL('5.5'), NULL()]))[0], [{ id: 5, amt: 205 }])
      const mixed = sql.replace('? AND ?', '-999.99 AND ?')
      const [tree] = await conn.execute<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + mixed, [NULL()])
      assert.match(String(tree[0]?.EXPLAIN), namedPoint)
    } finally {
      conn.unprepare(sql)
      conn.unprepare(explain)
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('a single-table Sort Union reads secondary row IDs before its separate primary range', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'index_merge402'
  const primary = '        Clustered primary key\n            Index range scan on t using PRIMARY over'
  const secondary = '        Index range scan on t using by_g over'
  const merge = (primaryFirst: boolean) => `Filter\n    Sort-deduplicate by row ID\n${primaryFirst ? primary + '\n' + secondary : secondary + '\n' + primary}`
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT,amt DECIMAL(6,2),KEY by_g(g)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO t VALUES (-8,3,14),(-2,NULL,7),(-1,NULL,8),(0,NULL,5),(1,NULL,1),(2,8,3),(3,NULL,2),(4,NULL,6),(5,NULL,10),(6,1,4),(7,NULL,0),(8,NULL,9)')
    await conn.query('ANALYZE TABLE t')

    const sql = 'SELECT id,g,amt FROM t WHERE g IS NOT NULL OR id < 0'
    const read = async (query: string, ids: readonly number[], expected: string) => {
      for (const method of ['query', 'execute'] as const) {
        const run = (sql: string) => method === 'query' ? conn.query<mysql.RowDataPacket[]>(sql) : conn.execute<mysql.RowDataPacket[]>(sql)
        const [rows, fields] = await run(query)
        assert.deepEqual(rows.map((row) => row.id), ids)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.decimals, f.characterSet]), [
          ['id', 3, 0, 63], ['g', 3, 0, 63], ['amt', 246, 2, 63],
        ])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [tree] = await run('EXPLAIN FORMAT=TREE ' + query)
        assert.equal(planSkeleton(tree[0]?.EXPLAIN), expected)
      }
    }
    await read(sql, [2, 6, -8, -2, -1], merge(false))
    const reversed = sql.replace('g IS NOT NULL OR id < 0', 'id < 0 OR g IS NOT NULL')
    await read(reversed, [2, 6, -8, -2, -1], merge(true))
    await read(reversed + ' ORDER BY amt,id LIMIT 2', [2, 6], 'Limit\n    Sort\n' + merge(true).split('\n').map((line) => '        ' + line).join('\n'))

    const scan = 'Filter\n    Table scan on t'
    for (const setting of ['index_merge', 'index_merge_sort_union']) {
      await conn.query('SET optimizer_switch = ?', ['default,' + setting + '=off'])
      await read(sql, [-8, -2, -1, 2, 6], scan)
    }
    await conn.query("SET optimizer_switch = 'default'")
    await read(sql.replace('FROM t', 'FROM t IGNORE INDEX (by_g)'), [-8, -2, -1, 2, 6], scan)

    const prepared = sql.replace('id < 0', 'id < ?')
    const statement = await conn.prepare(prepared)
    try {
      const { LONG } = mysql.TypedParameter
      const [before] = await statement.execute([LONG(1)])
      assert.deepEqual((before as mysql.RowDataPacket[]).map((row) => row.id), [2, 6, -8, -2, -1, 0])
      await conn.query('UPDATE t SET g=NULL WHERE id=6')
      await conn.query('UPDATE t SET g=1,amt=1.50 WHERE id=3')
      const [after] = await statement.execute([LONG(0)])
      assert.deepEqual((after as mysql.RowDataPacket[]).map((row) => row.id), [2, 3, -8, -2, -1])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      await read(sql, [2, 3, -8, -2, -1], merge(false))
    } finally {
      conn.unprepare(prepared)
    }

    if (db) {
      // Change both branches after the secondary reader closes. Their row fetches
      // must still use the snapshot that collected the secondary IDs.
      const catalog = db.catalog!
      const open = catalog.table.bind(catalog)
      const writer = open(schema, 't')
      const [first, , , , replacement, second] = [...writer.scan()]
      assert.ok(first && replacement && second)
      let changed = false
      catalog.table = (s, name, trx) => {
        const table = open(s, name, trx)
        if (s !== schema || name !== 't') return table
        const get = table.get.bind(table)
        table.get = (id, transaction, mode) => {
          if (!changed) {
            assert.ok(transaction)
            changed = true
            for (const [key, fields] of [first, second]) writer.update(key, [fields[0]!, fields[1]!, replacement[1][2]!])
          }
          return get(id, transaction, mode)
        }
        return table
      }
      try {
        const [rows] = await conn.query<mysql.RowDataPacket[]>(sql)
        assert.equal(changed, true)
        assert.deepEqual(rows.map((row) => [row.id, row.amt]), [[2, '3.00'], [3, '1.50'], [-8, '14.00'], [-2, '7.00'], [-1, '8.00']])
      } finally {
        catalog.table = open
      }
      const [fresh] = await conn.query<mysql.RowDataPacket[]>('SELECT amt FROM t WHERE id IN (-8,2) ORDER BY id')
      assert.deepEqual(fresh.map((row) => row.amt), ['1.00', '1.00'])
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('Sort Union compares signed primary endpoints and floors fractional secondary cutoffs', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'index_merge_bounds404'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT,amt INT,KEY by_g(g)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO t VALUES (-6,8,1),(-5,-3,2),(-4,-2,3),(-3,-4,4),(-2,NULL,5),(-1,-4,6),(0,8,7),(1,NULL,8),(2,-3,9),(3,-2,10),(4,NULL,11),(5,8,12)')
    await conn.query('ANALYZE TABLE t')

    const sql = 'SELECT id,g,amt FROM t WHERE '
    for (const [predicate, ids, clustered, secondary] of [
      ['id > 0 OR g > 5.5', [-6, 0, 1, 2, 3, 4, 5], '(0 < id)', '(5 < g)'],
      ['id >= 0 OR g >= 5.5', [-6, 0, 1, 2, 3, 4, 5], '(0 <= id)', '(5 < g)'],
      ['g > 5.5 OR id < 0', [0, 5, -6, -5, -4, -3, -2, -1], '(id < 0)', '(5 < g)'],
      ['g > 5.5 OR id <= 0', [5, -6, -5, -4, -3, -2, -1, 0], '(id <= 0)', '(5 < g)'],
      ['id > 2 OR g >= -2.5', [-6, -4, 0, 3, 4, 5], '(2 < id)', '(-3 < g)'],
      ['0 < id OR 5.5 < g', [-6, 0, 1, 2, 3, 4, 5], '(0 < id)', '(5 < g)'],
      ['5.5 < g OR 0 >= id', [5, -6, -5, -4, -3, -2, -1, 0], '(id <= 0)', '(5 < g)'],
      ['-2.5 <= g OR 2 < id', [-6, -4, 0, 3, 4, 5], '(2 < id)', '(-3 < g)'],
    ] as const) for (const method of ['query', 'execute'] as const) {
      const read = (text: string) => method === 'query' ? conn.query<mysql.RowDataPacket[]>(text) : conn.execute<mysql.RowDataPacket[]>(text)
      const [rows] = await read(sql + predicate)
      assert.deepEqual(rows.map((row) => row.id), ids)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const [tree] = await read('EXPLAIN FORMAT=TREE ' + sql + predicate)
      const description = String(tree[0]?.EXPLAIN)
      assert.ok(description.includes('Sort-deduplicate by row ID'))
      assert.ok(description.includes('using PRIMARY over ' + clustered))
      assert.ok(description.includes('using by_g over ' + secondary))
    }

    for (const predicate of ['id > 2 OR g > ?', '2 < id OR ? < g']) {
      await conn.query('UPDATE t SET g=-3 WHERE id=-5')
      const prepared = sql + predicate
      const statement = await conn.prepare(prepared)
      try {
        const { NEWDECIMAL } = mysql.TypedParameter
        const rowsFor = async (value: string) => {
          const [rows] = await statement.execute([NEWDECIMAL(value)])
          return (rows as mysql.RowDataPacket[]).map((row) => row.id)
        }
        assert.deepEqual(await rowsFor('5.5'), [-6, 0, 3, 4, 5])
        await conn.query('UPDATE t SET g=-2 WHERE id=-5')
        assert.deepEqual(await rowsFor('-2.5'), [-6, -5, -4, 0, 3, 4, 5])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      } finally {
        conn.unprepare(prepared)
      }
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('the probe of an inner hash join uses its Sort Union and retains the written ON', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'index_merge_join406'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE p(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp INT,UNIQUE KEY by_name(name),KEY by_g(grp)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE c(id INT PRIMARY KEY,pa_id INT,KEY by_p(pa_id)) STATS_AUTO_RECALC=0')
    const parents = Array.from({ length: 30 }, (_, i) => [i + 1, 'name' + String(i + 1).padStart(2, '0'), [0, 5, 29].includes(i) ? 8 : i % 3 ? i % 5 : null])
    await conn.query('INSERT INTO p VALUES ?', [parents])
    await conn.query('INSERT INTO c VALUES (1,29)')
    await conn.query('ANALYZE TABLE p,c')

    const select = 'SELECT DISTINCT p.name,c.pa_id FROM c JOIN p ON '
    const predicate = 'c.pa_id=p.id AND p.id>27 OR p.grp>5.5'
    const primary = '                    Clustered primary key\n                        Index range scan on p using PRIMARY over'
    const secondary = '                    Index range scan on p using by_g over'
    const plan = (children: string) => `Table scan on <temporary>
    Temporary table with deduplication
        Filter
            Inner hash join
${children}
                Hash
                    Covering index scan on c using by_p`
    const merge = (first: string, second: string) => plan('                Sort-deduplicate by row ID\n' + first + '\n' + second)
    for (const [on, names, expected, disabled] of [
      [predicate, ['name01', 'name06', 'name29', 'name30'], merge(primary, secondary), false],
      ['p.grp>5.5 OR p.id>27 AND p.id=c.pa_id', ['name01', 'name06', 'name29', 'name30'], merge(secondary, primary), false],
      ['5.5<p.grp OR 27<p.id AND p.id=c.pa_id', ['name01', 'name06', 'name29', 'name30'], merge(secondary, primary), false],
      ['p.grp>5.5 OR p.id>27 AND p.grp=c.pa_id', ['name01', 'name06', 'name30'], merge(secondary, primary), false],
      [predicate, ['name01', 'name06', 'name29', 'name30'], plan('                Table scan on p'), true],
    ] as const) {
      if (disabled) await conn.query("SET optimizer_switch='default,index_merge=off'")
      for (const method of ['query', 'execute'] as const) {
        const read = (sql: string) => method === 'query' ? conn.query({ sql, rowsAsArray: true }) : conn.execute({ sql, rowsAsArray: true })
        const [rows, fields] = await read(select + on)
        assert.deepEqual(rows, names.map((name) => [name, 29]))
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
          ['name', 253, 48, 4097, 0, 224, schema, 'p', 'p', 'name'],
          ['pa_id', 3, 11, 0, 0, 63, schema, 'c', 'c', 'pa_id'],
        ])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [rowsOfPlan] = await read('EXPLAIN FORMAT=TREE ' + select + on)
        const description = String((rowsOfPlan as unknown[][])[0]?.[0])
        assert.equal(planSkeleton(description), expected)
        if (!disabled) {
          assert.match(description, /using PRIMARY over \(27 < id\)/)
          assert.match(description, /using by_g over \(5 < grp\)/)
        }
      }
    }

    await conn.query("SET optimizer_switch='default'")
    const prepared = select + 'c.pa_id=p.id AND p.id>27 OR p.grp>?'
    const statement = await conn.prepare(prepared)
    const { NEWDECIMAL } = mysql.TypedParameter
    try {
      assert.deepEqual((await statement.execute([NEWDECIMAL('5.5')]))[0], [
        { name: 'name01', pa_id: 29 }, { name: 'name06', pa_id: 29 }, { name: 'name29', pa_id: 29 }, { name: 'name30', pa_id: 29 },
      ])
      await conn.query('UPDATE c SET pa_id=NULL')
      await conn.query('UPDATE p SET grp=8 WHERE id=2')
      assert.deepEqual((await statement.execute([NEWDECIMAL('5.5')]))[0], [
        { name: 'name01', pa_id: null }, { name: 'name02', pa_id: null }, { name: 'name06', pa_id: null }, { name: 'name30', pa_id: null },
      ])
      assert.deepEqual((await statement.execute([NEWDECIMAL('8')]))[0], [])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    } finally {
      conn.unprepare(prepared)
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('a nullable signed or unsigned INT minimum can supply a whole non-NULL merge range', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'index_merge_domain409'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const [type, minimum] of [['INT', -2147483648], ['INT UNSIGNED', 0]] as const) {
      await conn.query(`CREATE TABLE p(id INT PRIMARY KEY,g ${type},name VARCHAR(12),KEY by_g(g)) STATS_AUTO_RECALC=0`)
      await conn.query('INSERT INTO p VALUES ?', [Array.from({ length: 30 }, (_, i) => [
        i + 1, i === 1 ? 8 : i === 25 ? minimum : i === 26 ? minimum + 1 : i === 28 ? 8 : null, 'name' + i,
      ])])
      await conn.query('ANALYZE TABLE p')
      const select = 'SELECT id,g,name FROM p WHERE '
      for (const [secondary, acceptsMinimum] of [
        [`g >= ${minimum}`, true],
        [`g > ${minimum - 1}.5`, true],
        [`g > ${minimum}`, false],
      ] as const) for (const method of ['query', 'execute'] as const) {
        const read = (sql: string) => method === 'query' ? conn.query<mysql.RowDataPacket[]>(sql) : conn.execute<mysql.RowDataPacket[]>(sql)
        const sql = select + secondary + ' OR id < 4'
        const [rows] = await read(sql)
        assert.deepEqual(rows.map((r) => r.id), acceptsMinimum ? [26, 27, 29, 1, 2, 3] : [27, 29, 1, 2, 3])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [explain] = await read('EXPLAIN FORMAT=TREE ' + sql)
        const tree = String(explain[0]?.EXPLAIN)
        assert.match(tree, /Sort-deduplicate by row ID/)
        assert.ok(tree.includes('using by_g over ' + (acceptsMinimum ? '(NULL < g)' : `(${minimum} < g)`)))
      }

      const prepared = select + 'id < 4 OR g > ?'
      const statement = await conn.prepare(prepared)
      const ids = async (bound: string) => {
        const [rows] = await statement.execute([mysql.TypedParameter.NEWDECIMAL(bound)])
        return (rows as mysql.RowDataPacket[]).map((r) => r.id)
      }
      try {
        // The exact DECIMAL below the domain includes the former and the new minimum row.
        const below = String(minimum - 1) + '.5'
        assert.deepEqual(await ids(below), [26, 27, 29, 1, 2, 3])
        await conn.query('UPDATE p SET g=NULL WHERE id=26')
        await conn.query('UPDATE p SET g=? WHERE id=28', [minimum])
        assert.deepEqual(await ids(below), [27, 28, 29, 1, 2, 3])
        assert.deepEqual(await ids(String(minimum)), [27, 29, 1, 2, 3])
      } finally {
        conn.unprepare(prepared)
      }
      await conn.query('DROP TABLE p')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('Sort Union uses the non-NULL upper range of a nullable INT index', async () => {
  const { db, conn } = await rangeConnection()
  const schema = 'index_merge_upper412'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const [type, low, edge, decimal, maximum] of [
      ['INT', -6, -5, '-5.5', 2147483647],
      ['INT UNSIGNED', 1, 2, '1.5', 4294967295],
    ] as const) {
      await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,g ${type},n INT,KEY by_g(g)) STATS_AUTO_RECALC=0`)
      await conn.query('INSERT INTO t VALUES ?', [Array.from({ length: 30 }, (_, i) => [
        i + 1, i === 0 || i === 29 ? low : i === 1 ? maximum : i === 2 ? edge : null, i,
      ])])
      await conn.query('ANALYZE TABLE t')
      const select = 'SELECT id,g,n FROM t WHERE '
      for (const [predicate, ids, limit] of [
        [`${decimal} > g OR id>27`, [1, 28, 29, 30], `(NULL < g < ${edge})`],
        [`id>27 OR g<${maximum}`, [1, 3, 28, 29, 30], `(NULL < g < ${maximum})`],
        [`g<=${maximum} OR id>27`, [1, 2, 3, 28, 29, 30], '(NULL < g)'],
      ] as const) for (const method of ['query', 'execute'] as const) {
        const read = (sql: string) => method === 'query' ? conn.query<mysql.RowDataPacket[]>(sql) : conn.execute<mysql.RowDataPacket[]>(sql)
        const sql = select + predicate
        const [rows] = await read(sql)
        assert.deepEqual(rows.map((r) => r.id), ids)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [explain] = await read('EXPLAIN FORMAT=TREE ' + sql)
        const tree = String(explain[0]?.EXPLAIN)
        assert.match(tree, /Sort-deduplicate by row ID/)
        assert.ok(tree.includes('using by_g over ' + limit))
      }

      const prepared = select + 'id>27 OR g < ?'
      const statement = await conn.prepare(prepared)
      const ids = async (bound: string) => {
        const [rows] = await statement.execute([mysql.TypedParameter.NEWDECIMAL(bound)])
        return (rows as mysql.RowDataPacket[]).map((r) => r.id)
      }
      try {
        assert.deepEqual(await ids(decimal), [1, 28, 29, 30])
        await conn.query('UPDATE t SET g=? WHERE id=1', [edge])
        await conn.query('UPDATE t SET g=? WHERE id=5', [low])
        assert.deepEqual(await ids(decimal), [5, 28, 29, 30])
        assert.deepEqual(await ids(String(maximum + 1)), [1, 2, 3, 5, 28, 29, 30])
      } finally {
        conn.unprepare(prepared)
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})
