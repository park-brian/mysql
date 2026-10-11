// M5.47: ordered inner keys are deduplicated before the outer primary lookup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('integer LooseScan semijoins share execution, metadata and the costed plan', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const base = 'SELECT name FROM pa WHERE id IN (SELECT pa_id FROM ch)'
  const exists = 'SELECT name FROM pa WHERE EXISTS (SELECT 1 FROM ch WHERE ch.pa_id=pa.id)'
  const loose = 'Nested loop inner join\n    Remove duplicates from input sorted on pa_id\n        Filter\n            Covering index scan on ch using pa_id\n    Single-row index lookup on pa using PRIMARY'
  const sorted = `Sort\n    Stream results\n${loose.split('\n').map((s) => `        ${s}`).join('\n')}`
  const run = async (sql: string, expected: unknown[][], plan?: string, flags = 20485, alias = 'pa') => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        [['name', 253, 48, flags, 0, 224, 'loose_scan', alias, 'pa', 'name']], `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      const actual = planSkeleton(explain[0]?.EXPLAIN)
      if (plan !== undefined) assert.equal(actual, plan, `${method}: ${sql}`)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS loose_scan')
    await conn.query('USE loose_scan')
    await conn.query('DROP TABLE IF EXISTS pa,ch')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp INT,amt DECIMAL(6,2),UNIQUE KEY(name),KEY(grp)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,pa_id INT,label VARCHAR(10),qty INT NOT NULL,KEY(pa_id)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(1,'Bob',4,NULL),(2,'ÄNNA',4,7.51),(3,'b',1,215.91),(4,'éva',4,274.03),(5,'zoë',NULL,289.77)")
    await conn.query("INSERT INTO ch VALUES(1,6,'x',1),(2,6,'ann',5),(3,3,'x',6)")
    await conn.query('ANALYZE TABLE pa,ch')
    await run(base, [['b']], loose)
    await run(exists, [['b']], loose)
    await run(`${base} ORDER BY 1`, [['b']], sorted, 4097)
    await run(`${exists} ORDER BY 1`, [['b']], sorted, 4097)
    await run(base.replace('FROM ch)', 'FROM ch WHERE ch.id>=2.5)') + ' ORDER BY 1', [['b']], sorted, 4097)
    // Keep the costed inner-first choice while adding matching duplicates and NULL keys.
    await conn.query('INSERT INTO pa(id,name,grp) VALUES' + Array.from({ length: 20 }, (_, i) => `(${i + 10},'x${i}',NULL)`).join(','))
    await conn.query('INSERT INTO ch(id,pa_id,qty) VALUES(4,1,3),(5,1,4),(6,NULL,3),(7,5,3)')
    await conn.query('ANALYZE TABLE pa,ch')
    const inKeyOrder = [['Bob'], ['b'], ['zoë']]
    const inNameOrder = [['b'], ['Bob'], ['zoë']]
    await run(base, inKeyOrder, loose)
    await run(exists, inKeyOrder, loose)
    await run(`${base} ORDER BY id`, inKeyOrder, sorted, 4097)
    await run(`${base} ORDER BY name`, inNameOrder, sorted, 4097)
    await run(`${exists} ORDER BY 1 LIMIT 2`, inNameOrder.slice(0, 2), `Limit\n${sorted.split('\n').map((s) => `    ${s}`).join('\n')}`, 4097)
    await run('SELECT x.name FROM pa x WHERE EXISTS (SELECT 1 FROM ch y WHERE x.id=y.pa_id AND y.id>4) ORDER BY 1', [['Bob'], ['zoë']],
      sorted.replaceAll('on ch ', 'on y ').replaceAll('on pa ', 'on x '), 4097, 'x')
    // Execution keeps no membership cache across statements, including prepared executions.
    await conn.query('UPDATE ch SET pa_id=2 WHERE pa_id=1')
    await run(`${base} ORDER BY 1`, [['ÄNNA'], ['b'], ['zoë']], sorted, 4097)
    for (const switchName of ['loosescan', 'semijoin']) {
      await conn.query(`SET optimizer_switch='${switchName}=off'`)
      // Test each switch on a fresh prepare, rather than MySQL's cached plan.
      conn.unprepare({ sql: `${base} ORDER BY 1`, rowsAsArray: true })
      await run(`${base} ORDER BY 1`, [['ÄNNA'], ['b'], ['zoë']], undefined, switchName === 'semijoin' ? 20485 : 4097)
      const [disabled] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${base}`)
      assert.doesNotMatch(disabled[0]?.EXPLAIN, /Remove duplicates from input sorted/)
      await conn.query(`SET optimizer_switch='${switchName}=on'`)
      conn.unprepare({ sql: `${base} ORDER BY 1`, rowsAsArray: true })
    }
    await conn.query('DELETE FROM ch')
    await run(`${base} ORDER BY 1`, [], undefined, 4097)
    await conn.query('DELETE FROM pa')
    await run(base, [])
    // A small outer table and many distinct inner keys retain the outer-first choice.
    await conn.query("INSERT INTO pa(id,name) VALUES(1,'z'),(2,'a')")
    await conn.query('INSERT INTO ch(id,pa_id,qty) VALUES' + Array.from({ length: 200 }, (_, i) => `(${i + 1},${i + 1},1)`).join(','))
    await conn.query('ANALYZE TABLE pa,ch')
    await run(`${exists} ORDER BY 1`, [['a'], ['z']])
    const [other] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${exists}`)
    assert.doesNotMatch(other[0]?.EXPLAIN, /Remove duplicates from input sorted/)
    // The nullable non-primary key remains an ordinary IN predicate.
    await run(base.replace('WHERE id IN', 'WHERE grp IN'), [])
    await conn.query('DROP TABLE ch')
    await conn.query('CREATE TEMPORARY TABLE ch(id INT PRIMARY KEY,pa_id INT,KEY(pa_id))')
    await conn.query('INSERT INTO ch VALUES(1,1),(2,1),(3,NULL)')
    await run(base, [['z']])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS loose_scan')
    await conn.end()
    await db?.end()
  }
})

test('returning from an integer LooseScan locking stream releases both scans and its writer', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('CREATE TABLE d.pa(id INT PRIMARY KEY) STATS_AUTO_RECALC=0')
    await db.query('CREATE TABLE d.ch(id INT PRIMARY KEY,pa_id INT,KEY(pa_id)) STATS_AUTO_RECALC=0')
    await db.query('INSERT INTO d.pa VALUES(1),(2),(3),(4),(5)')
    await db.query('INSERT INTO d.ch VALUES(1,1),(2,1),(3,3)')
    await db.query('ANALYZE TABLE d.pa,d.ch')
    const sql = 'SELECT id FROM d.pa WHERE id IN (SELECT pa_id FROM d.ch)'
    assert.match(JSON.stringify((await db.query(`EXPLAIN FORMAT=TREE ${sql} FOR UPDATE`))[0]), /Remove duplicates from input sorted/)
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let probes = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 'pa') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          if (range?.from !== undefined && range.to !== undefined) probes++
          yield* scan(range, transaction, mode)
        }
      }
      return table
    }
    try {
      assert.deepEqual((await db.query(sql))[0], [{ id: 1 }, { id: 3 }])
      assert.equal(probes, 2, 'one primary lookup per distinct non-NULL inner key')
    } finally {
      catalog.table = open
    }
    for await (const row of db.stream(`${sql} FOR UPDATE`)) {
      assert.deepEqual(row, { id: 1 })
      break
    }
    assert.equal(db.openConnections, 1)
    const other = await db.connect()
    try {
      await other.query('SET innodb_lock_wait_timeout=1')
      await other.query('UPDATE d.ch SET pa_id=2 WHERE pa_id=1')
    } finally {
      await other.end()
    }
    assert.deepEqual((await db.query(`${sql} ORDER BY id`))[0], [{ id: 2 }, { id: 3 }])
  } finally {
    await db.end()
  }
})
