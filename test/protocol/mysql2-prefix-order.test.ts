// M5.49: a truncated key part supplies neither a full column nor its order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('prefix key coverage and ordering agree with MySQL through both protocols', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const name = ['name', 253, 48, 20483, 0, 224, 'prefix_order', 't', 't', 'name']
  const id = ['id', 3, 11, 16392, 0, 63, 'prefix_order', 't', 't', 'id']
  const run = async (sql: string, expected: unknown[][], plan: string, field: unknown[]) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [field], `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
      conn.unprepare(options)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS prefix_order')
    await conn.query('USE prefix_order')
    for (const descending of [false, true]) {
      await conn.query('DROP TABLE IF EXISTS t')
      await conn.query(`CREATE TABLE t(name VARCHAR(12) NOT NULL,id INT,PRIMARY KEY(name(1)${descending ? ' DESC' : ''}),KEY(id)) STATS_AUTO_RECALC=0`)
      await conn.query("INSERT INTO t VALUES('zebra',1),('apple',2),('empty',3)")
      await conn.query('ANALYZE TABLE t')
      const rows = [['apple'], ['empty'], ['zebra']]
      await run('SELECT name FROM t', descending ? [...rows].reverse() : rows, 'Table scan on t', name)
      await run('SELECT id FROM t', [[1], [2], [3]], 'Covering index scan on t using id', id)
      await run('SELECT name FROM t WHERE id=2', [['apple']], 'Index lookup on t using id', name)
      await run('SELECT name FROM t WHERE id>=2 ORDER BY name DESC', [['empty'], ['apple']], 'Sort\n    Index range scan on t using id over', name)
      for (const desc of [false, true]) {
        const sql = `SELECT name FROM t ORDER BY name${desc ? ' DESC' : ''}`
        const sorted = desc ? [...rows].reverse() : rows
        await run(sql, sorted, 'Sort\n    Table scan on t', name)
        await run(`${sql} LIMIT 1`, sorted.slice(0, 1), 'Limit\n    Sort\n        Table scan on t', name)
        await run(`${sql} LIMIT 1 OFFSET 1`, sorted.slice(1, 2), 'Limit/Offset\n    Sort\n        Table scan on t', name)
      }
    }
    // Full values in other key parts still cover a read, even with a prefix part.
    const cases: [string, string, string, unknown[][], string, unknown[]][] = [
      ['carried', 'id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,KEY pfx(name(1))', 'id', [[2], [3], [1]], 'pfx', ['id', 3, 11, 20483, 0, 63, 'prefix_order', 'carried', 'carried', 'id']],
      ['own', 'name VARCHAR(12) NOT NULL,id INT,PRIMARY KEY(name(1)),KEY pfx(name(1),id)', 'id', [[2], [3], [1]], 'pfx', ['id', 3, 11, 16384, 0, 63, 'prefix_order', 'own', 'own', 'id']],
      ['overlap', 'name VARCHAR(12) NOT NULL,id INT,PRIMARY KEY(name),KEY pfx(name(1))', 'name', [['apple'], ['empty'], ['zebra']], 'PRIMARY', ['name', 253, 48, 20491, 0, 224, 'prefix_order', 'overlap', 'overlap', 'name']],
    ]
    for (const [table, def, column, rows, index, field] of cases) {
      await conn.query(`DROP TABLE IF EXISTS ${table}`)
      await conn.query(`CREATE TABLE ${table}(${def}) STATS_AUTO_RECALC=0`)
      await conn.query(`INSERT INTO ${table}(id,name) VALUES(1,'zebra'),(2,'apple'),(3,'empty')`)
      await conn.query(`ANALYZE TABLE ${table}`)
      await run(`SELECT ${column} FROM ${table}`, rows, `Covering index scan on ${table} using ${index}`, field)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS prefix_order')
    await conn.end()
    await db?.end()
  }
})

test('prefix PRIMARY ordering sorts the full scan before LIMIT and releases locking streams', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE t(name VARCHAR(12) NOT NULL,id INT,PRIMARY KEY(name(1)))')
    await db.query("INSERT INTO t VALUES('zebra',1),('apple',2),('empty',3)")
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let read = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 't') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          try {
            for (const row of scan(range, transaction, mode)) {
              read++
              yield row
            }
          } finally {
            closed++
          }
        }
      }
      return table
    }
    try {
      for (const [order, first] of [['name', 'apple'], ['name DESC', 'zebra']]) {
        for (const offset of [0, 1]) {
          read = closed = 0
          assert.deepEqual((await db.query(`SELECT name FROM d.t ORDER BY ${order} LIMIT 1 OFFSET ${offset}`))[0], [{ name: offset === 0 ? first : 'empty' }])
          assert.equal(read, 3, 'prefix PRIMARY does not omit the sort; LIMIT follows a full-table sort')
          assert.equal(closed, 1)
        }
      }
    } finally {
      catalog.table = open
    }
    for (const [order, first] of [['name', 'apple'], ['name DESC', 'zebra']]) {
      for await (const row of db.stream(`SELECT name FROM d.t ORDER BY ${order} FOR UPDATE`)) {
        assert.deepEqual(row, { name: first })
        break
      }
      const other = await db.connect()
      try {
        await other.query('SET innodb_lock_wait_timeout=1')
        await other.query("UPDATE d.t SET id=id WHERE name='apple'")
      } finally {
        await other.end()
      }
      assert.equal(db.openConnections, 1)
    }
  } finally {
    await db.end()
  }
})
