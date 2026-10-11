// M5.47: an outer-first indexed semijoin stops at the first qualifying row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

const parents = "INSERT INTO pa VALUES(1,'z'),(2,'a'),(3,'empty')"
const children = 'INSERT INTO ch VALUES(1,1),(2,1),(3,1),(4,2),(5,NULL),' + Array.from({ length: 200 }, (_, i) => `(${i + 10},${i + 10})`).join(',')
const base = 'SELECT name FROM pa WHERE id IN (SELECT pa_id FROM ch)'
const filtered = 'SELECT name FROM pa WHERE id IN (SELECT pa_id FROM ch WHERE id>1) ORDER BY 1'
const semi = 'Nested loop semijoin\n    Covering index scan on pa using name\n    Covering index lookup on ch using pa_id'
const withFilter = semi.replace('    Covering index lookup', '    Filter\n        Covering index lookup')

async function populate(query: (sql: string) => Promise<unknown>) {
  await query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,UNIQUE KEY(name)) STATS_AUTO_RECALC=0')
  await query('CREATE TABLE ch(id INT PRIMARY KEY,pa_id INT,KEY(pa_id)) STATS_AUTO_RECALC=0')
  await query(parents)
  await query(children)
  await query('ANALYZE TABLE pa,ch')
}

test('integer FirstMatch uses qualifying duplicates and preserves source metadata through both protocols', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const run = async (sql: string, expected: unknown[][], plan?: string, flags = 20485, alias = 'pa') => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        [['name', 253, 48, flags, 0, 224, 'first_match', alias, 'pa', 'name']], `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      if (plan !== undefined) {
        const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
      }
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS first_match')
    await conn.query('USE first_match')
    await conn.query('DROP TABLE IF EXISTS pa,ch')
    await populate((sql) => conn.query(sql))
    await run(base, [['a'], ['z']], semi)
    await run(`${base} ORDER BY 1`, [['a'], ['z']], semi)
    await run(filtered, [['a'], ['z']], withFilter)
    await run('SELECT p.name FROM pa p WHERE EXISTS (SELECT 1 FROM ch c WHERE p.id=c.pa_id AND c.id>1) ORDER BY 1',
      [['a'], ['z']], withFilter.replaceAll('on pa ', 'on p ').replaceAll('on ch ', 'on c '), 20485, 'p')
    await run(filtered.replace('id>1', 'id>3').replace('ORDER BY 1', 'ORDER BY id'), [['a']])
    await run(`${filtered} LIMIT 1`, [['a']], `Limit\n${withFilter.split('\n').map((s) => `    ${s}`).join('\n')}`)
    // An empty standalone inner range competes through materialization, outside this slice.
    await run(filtered.replace('id>1', 'id>1000'), [], undefined, 4097)
    await conn.query('UPDATE ch SET pa_id=2 WHERE id IN (2,3)')
    await run(filtered, [['a']], withFilter)
    await conn.query("SET optimizer_switch='firstmatch=off'")
    conn.unprepare({ sql: filtered, rowsAsArray: true })
    await run(filtered, [['a']], 'Nested loop inner join\n    Covering index scan on pa using name\n    Limit\n        Filter\n            Covering index lookup on ch using pa_id')
    const [disabled] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${filtered}`)
    assert.doesNotMatch(disabled[0]?.EXPLAIN, /Nested loop semijoin/)
    await conn.query("SET optimizer_switch='firstmatch=on'")
    conn.unprepare({ sql: filtered, rowsAsArray: true })
    await run(filtered, [['a']], withFilter)
    await conn.query('DELETE FROM pa')
    await run(base, [])
    await run(`${base} ORDER BY 1`, [])
    await conn.query('DELETE FROM ch')
    await run(base, [])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS first_match')
    await conn.end()
    await db?.end()
  }
})

test('FirstMatch examines only through the first qualifying inner row and closes locking scans on return', async () => {
  const db = await MySQL.open(':memory:')
  const sql = filtered.replace('FROM pa', 'FROM d.pa').replace('FROM ch', 'FROM d.ch')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await populate((sql) => db.query(sql))
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let examined = 0
    let probes = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          const probe = index === 'pa_id' && range?.from !== undefined && range.to !== undefined
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
    try {
      assert.deepEqual((await db.query(sql))[0], [{ name: 'a' }, { name: 'z' }])
      assert.equal(probes, 3, 'one indexed probe per outer row, including its absent match')
      assert.equal(examined, 3, 'one match for a, and the rejected then qualifying rows for z')
      assert.equal(closed, probes)
    } finally {
      catalog.table = open
    }
    assert.match(JSON.stringify((await db.query(`EXPLAIN FORMAT=TREE ${sql} FOR UPDATE`))[0]), /Nested loop semijoin/)
    for await (const row of db.stream(`${sql} FOR UPDATE`)) {
      assert.deepEqual(row, { name: 'a' })
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
    assert.deepEqual((await db.query(sql))[0], [{ name: 'a' }])
    await db.query("SET optimizer_switch='firstmatch=off'")
    assert.doesNotMatch(JSON.stringify((await db.query(`EXPLAIN FORMAT=TREE ${sql}`))[0]), /Nested loop semijoin/)
    assert.deepEqual((await db.query(sql))[0], [{ name: 'a' }])
  } finally {
    await db.end()
  }
})
