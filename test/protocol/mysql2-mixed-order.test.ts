// M5.49: every key part agrees on one forward or reverse physical scan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('mixed secondary and appended PRIMARY directions supply native order, ties and LIMIT winners', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const fields = [
    ['a', 3, 11, 20483, 0, 63, 'mixed_order', 't', 't', 'a'],
    ['b', 3, 11, 20483, 0, 63, 'mixed_order', 't', 't', 'b'],
    ['name', 253, 48, 20489, 0, 224, 'mixed_order', 't', 't', 'name'],
  ]
  // Literal tie orders observed on 8.4.11; the third part's inverse sorts the other way.
  const cases: [string, unknown[][], unknown[][]][] = [
    ['a,b', [[1, 2, 'a'], [1, 3, 'a'], [2, 1, 'a']], [[1, 3, 'a'], [1, 2, 'a'], [2, 1, 'a']]],
    ['a DESC,b DESC', [[2, 1, 'a'], [1, 3, 'a'], [1, 2, 'a']], [[2, 1, 'a'], [1, 2, 'a'], [1, 3, 'a']]],
    ['a DESC,b', [[2, 1, 'a'], [1, 2, 'a'], [1, 3, 'a']], [[2, 1, 'a'], [1, 3, 'a'], [1, 2, 'a']]],
    ['a,b DESC', [[1, 3, 'a'], [1, 2, 'a'], [2, 1, 'a']], [[1, 2, 'a'], [1, 3, 'a'], [2, 1, 'a']]],
  ]
  const inverse = (part: string) => part.endsWith(' DESC') ? part.slice(0, -5) : `${part} DESC`
  const cover = 'Covering index scan on t using name'
  const limited = (plan: string, offset = false) => `${offset ? 'Limit/Offset' : 'Limit'}\n${plan.split('\n').map((s) => `    ${s}`).join('\n')}`
  const run = async (sql: string, expected: unknown[][], plan: string) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), fields, `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
      conn.unprepare(options)
    }
  }
  const variants = async (order: string, rows: unknown[][], plan: string) => {
    const sql = `SELECT a,b,name FROM t ORDER BY ${order}`
    await run(sql, rows, plan)
    await run(`${sql} LIMIT 1`, rows.slice(0, 1), limited(plan))
    await run(`${sql} LIMIT 1 OFFSET 1`, rows.slice(1, 2), limited(plan, true))
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS mixed_order')
    await conn.query('USE mixed_order')
    for (const [primary, ties, other] of cases) {
      for (const secondary of ['name', 'name DESC']) {
        await conn.query('DROP TABLE IF EXISTS t')
        await conn.query(`CREATE TABLE t(a INT,b INT,name VARCHAR(12) NOT NULL,PRIMARY KEY(${primary}),KEY(${secondary})) STATS_AUTO_RECALC=0`)
        await conn.query("INSERT INTO t VALUES(1,1,'x'),(1,2,'a'),(1,3,'a'),(2,1,'a'),(2,2,'empty')")
        await conn.query('ANALYZE TABLE t')
        const parts = [secondary, ...primary.split(',')]
        const rows = secondary === 'name' ? [...ties, [2, 2, 'empty'], [1, 1, 'x']] : [[1, 1, 'x'], [2, 2, 'empty'], ...ties]
        const incompatible = [...parts.slice(0, 2), inverse(parts[2]!)]
        const sorted = secondary === 'name' ? [...other, [2, 2, 'empty'], [1, 1, 'x']] : [[1, 1, 'x'], [2, 2, 'empty'], ...other]
        for (const preference of ['on', 'off']) {
          await conn.query(`SET optimizer_switch='prefer_ordering_index=${preference}'`)
          for (const backward of [false, true]) {
            const order = backward ? parts.map(inverse) : parts
            const expected = backward ? [...rows].reverse() : rows
            for (const count of [1, 2, 3]) {
              const prefix = order.slice(0, count)
              await variants(prefix.join(','), expected, cover)
              await variants(prefix.flatMap((part) => [part, inverse(part)]).join(','), expected, cover)
            }
            await variants((backward ? incompatible.map(inverse) : incompatible).join(','), backward ? [...sorted].reverse() : sorted, `Sort\n    ${cover}`)
          }
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS mixed_order')
    await conn.end()
    await db?.end()
  }
})

test('mixed secondary scans stop at LIMIT plus OFFSET and close locking streams in both directions', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE t(a INT,b INT,name VARCHAR(12) NOT NULL,PRIMARY KEY(a DESC,b),KEY(name))')
    await db.query("INSERT INTO t VALUES(1,1,'x'),(1,2,'a'),(1,3,'a'),(2,1,'a'),(2,2,'empty')")
    const forward = [{ a: 2, b: 1, name: 'a' }, { a: 1, b: 2, name: 'a' }, { a: 1, b: 3, name: 'a' }, { a: 2, b: 2, name: 'empty' }, { a: 1, b: 1, name: 'x' }]
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let read = 0
    let closed = 0
    const indexes: string[] = []
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 't') {
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
      for (const preference of ['on', 'off']) {
        await db.query(`SET optimizer_switch='prefer_ordering_index=${preference}'`)
        for (const [order, rows] of [['name,a DESC,b', forward], ['name DESC,a,b DESC', [...forward].reverse()], ['name,a DESC', forward], ['name DESC,a', [...forward].reverse()], ['name,name DESC,a DESC,a,b,b DESC', forward], ['name DESC,name,a,a DESC,b DESC,b', [...forward].reverse()], ['name,a DESC,name DESC', forward], ['name DESC,a,a DESC', [...forward].reverse()]] as const) {
          for (const method of ['query', 'execute'] as const) {
            for (const offset of [0, 1, 2]) {
              read = closed = 0
              indexes.length = 0
              assert.deepEqual((await db[method](`SELECT a,b,name FROM d.t ORDER BY ${order} LIMIT 1 OFFSET ${offset}`))[0], [rows[offset]])
              assert.equal(read, offset + 1)
              assert.equal(closed, 1)
              assert.deepEqual(indexes, ['name'])
            }
          }
          read = closed = 0
          indexes.length = 0
          for await (const row of db.stream(`SELECT a,b,name FROM d.t ORDER BY ${order} FOR UPDATE`)) {
            assert.deepEqual(row, rows[0])
            break
          }
          assert.equal(closed, 1, 'return closes the ordered physical source')
          assert.deepEqual(indexes, ['name'])
          const other = await db.connect()
          try {
            await other.query('SET innodb_lock_wait_timeout=1')
            await other.query('UPDATE d.t SET name=name WHERE a=1 AND b=2')
          } finally {
            await other.end()
          }
          assert.equal(db.openConnections, 1)
        }
        for (const method of ['query', 'execute'] as const) {
          read = closed = 0
          indexes.length = 0
          assert.deepEqual((await db[method]('SELECT a,b,name FROM d.t ORDER BY name,a,b LIMIT 1'))[0], [{ a: 1, b: 2, name: 'a' }])
          assert.equal(read, 5, 'an incompatible order consumes every row before LIMIT')
          assert.equal(closed, 1)
          assert.deepEqual(indexes, ['name'])
        }
      }
    } finally {
      catalog.table = open
    }
  } finally {
    await db.end()
  }
})
