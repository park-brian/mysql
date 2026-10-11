// M5.49: a compatible PRIMARY scan supplies order before LIMIT.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('ordinary whole scans choose PRIMARY order and retain covering scans when preference is off', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const name = ['name', 253, 48, 20485, 0, 224, 'primary_order', 't', 't', 'name']
  const id = ['id', 3, 11, 20483, 0, 63, 'primary_order', 't', 't', 'id']
  const primary = 'Index scan on t using PRIMARY'
  const cover = 'Covering index scan on t using name'
  const limit = (plan: string, offset = false) => `${offset ? 'Limit/Offset' : 'Limit'}\n${plan.split('\n').map((s) => `    ${s}`).join('\n')}`
  const run = async (sql: string, expected: unknown[][], plan: string, expectedFields = [name]) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), expectedFields, `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
      conn.unprepare(options)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS primary_order')
    await conn.query('USE primary_order')
    for (const descending of [false, true]) {
      await conn.query('DROP TABLE IF EXISTS t')
      await conn.query(`CREATE TABLE t(id INT,name VARCHAR(12) NOT NULL,PRIMARY KEY(id${descending ? ' DESC' : ''}),UNIQUE KEY(name)) STATS_AUTO_RECALC=0`)
      await conn.query("INSERT INTO t VALUES(1,'z'),(2,'a'),(3,'empty')")
      await conn.query('ANALYZE TABLE t')
      await run('SELECT name FROM t', [['a'], ['empty'], ['z']], cover)
      for (const desc of [false, true]) {
        const order = desc ? ' DESC' : ''
        const rows = desc ? [['empty'], ['a'], ['z']] : [['z'], ['a'], ['empty']]
        const sql = `SELECT name FROM t ORDER BY id${order}`
        await run(sql, rows, primary)
        await run(`${sql} LIMIT 1`, rows.slice(0, 1), limit(primary))
        await run(`${sql} LIMIT 1 OFFSET 1`, rows.slice(1, 2), limit(primary, true))
        await run(`SELECT p.name FROM t p ORDER BY p.id${order}`, rows, primary.replace('on t ', 'on p '), [name.map((v, i) => i === 7 ? 'p' : v)])
      }
      await run('SELECT id AS k,name FROM t ORDER BY k', [[1, 'z'], [2, 'a'], [3, 'empty']], primary, [id.map((v, i) => i === 0 ? 'k' : v), name])
      await run('SELECT id,name FROM t ORDER BY 1 DESC', [[3, 'empty'], [2, 'a'], [1, 'z']], primary, [id, name])
      await run('SELECT DISTINCT id,name FROM t ORDER BY 1,2', [[1, 'z'], [2, 'a'], [3, 'empty']], `Sort\n    ${cover}`, [id, name])
      await run('SELECT name FROM t ORDER BY name DESC', [['z'], ['empty'], ['a']], cover)
      await run('SELECT name FROM t ORDER BY id + 0', [['z'], ['a'], ['empty']], `Sort\n    ${cover}`)
      await run('SELECT name FROM t ORDER BY id DESC,name', [['empty'], ['a'], ['z']], `Sort\n    ${cover}`)
      await conn.query("SET optimizer_switch='prefer_ordering_index=off'")
      await run('SELECT name FROM t ORDER BY id', [['z'], ['a'], ['empty']], `Sort\n    ${cover}`)
      await run('SELECT name FROM t ORDER BY id DESC LIMIT 1', [['empty']], limit(`Sort\n    ${cover}`))
      await run('SELECT name FROM t ORDER BY name LIMIT 1', [['a']], limit(cover))
      await conn.query("SET optimizer_switch='prefer_ordering_index=on'")
      await conn.query("UPDATE t SET name='new' WHERE id=1")
      await run('SELECT name FROM t ORDER BY id LIMIT 1', [['new']], limit(primary))
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS primary_order')
    await conn.end()
    await db?.end()
  }
})

test('ordered PRIMARY LIMIT stops its physical scan and cancellation releases the writer', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE t(id INT,name VARCHAR(12) NOT NULL,PRIMARY KEY(id DESC),UNIQUE KEY(name))')
    await db.query("INSERT INTO t VALUES(1,'z'),(2,'a'),(3,'empty')")
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let read = 0
    let closed = 0
    const indexes: string[] = []
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 't') {
        const primaryScan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          indexes.push('PRIMARY')
          try {
            for (const row of primaryScan(range, transaction, mode)) {
              read++
              yield row
            }
          } finally {
            closed++
          }
        }
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          indexes.push(index)
          try {
            for (const row of scan(index, range, transaction, mode)) {
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
      for (const [order, first] of [['id', 'z'], ['id DESC', 'empty']]) {
        for (const offset of [0, 1]) {
          read = closed = 0
          indexes.length = 0
          assert.deepEqual((await db.query(`SELECT name FROM d.t ORDER BY ${order} LIMIT 1 OFFSET ${offset}`))[0], [{ name: offset === 0 ? first : 'a' }])
          assert.equal(read, offset + 1, 'LIMIT stops the ordered scan without sorting every row')
          assert.equal(closed, 1)
          assert.deepEqual(indexes, ['PRIMARY'])
        }
      }
      await db.query("SET optimizer_switch='prefer_ordering_index=off'")
      read = closed = 0
      indexes.length = 0
      await db.query('SELECT name FROM d.t ORDER BY id LIMIT 1')
      assert.equal(read, 3)
      assert.equal(closed, 1)
      assert.deepEqual(indexes, ['name'])
    } finally {
      catalog.table = open
    }
    await db.query("SET optimizer_switch='prefer_ordering_index=on'")
    for (const [order, first] of [['id', 'z'], ['id DESC', 'empty']]) {
      for await (const row of db.stream(`SELECT name FROM d.t ORDER BY ${order} FOR UPDATE`)) {
        assert.deepEqual(row, { name: first })
        break
      }
      const other = await db.connect()
      try {
        await other.query('SET innodb_lock_wait_timeout=1')
        await other.query('UPDATE d.t SET name=name WHERE id=2')
      } finally {
        await other.end()
      }
      assert.equal(db.openConnections, 1)
    }
  } finally {
    await db.end()
  }
})
