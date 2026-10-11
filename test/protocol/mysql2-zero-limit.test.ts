// M5.49: a zero count does not prove the child needs no initialization.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('zero LIMIT preserves native OFFSET plans, fields and initialization effects', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  // Literal observations from pinned MySQL 8.4.11, including all ten field attributes.
  const fixtures: [string, unknown[][], unknown[], unknown[][], string][] = [
    ["SELECT id,g FROM t LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Table scan on t"],
    ["SELECT id,g FROM t ORDER BY g LIMIT 0 OFFSET 0",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT id,g FROM t ORDER BY g LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT id,g FROM t ORDER BY id LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Index scan on t using PRIMARY"],
    ["SELECT DISTINCT g FROM t ORDER BY g LIMIT 0 OFFSET 1",[["g",3,11,32768,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t"],
    ["SELECT id,g,LAST_INSERT_ID(id) AS calls FROM t ORDER BY g LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"],["calls",8,21,161,0,63,"","","",""]],[],[[0]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id) LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[4]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT id,g FROM t ORDER BY CAST(CONCAT(g,'x') AS SIGNED) LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '2x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}],[[0]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT id,g FROM t ORDER BY g LIMIT 0 OFFSET 8",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT id,g FROM t ORDER BY g LIMIT 0 OFFSET 1 FOR UPDATE",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT DISTINCT g FROM t LIMIT 0 OFFSET 0",[["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT DISTINCT g FROM t ORDER BY g LIMIT 0 OFFSET 0",[["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id) LIMIT 0 OFFSET 0",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT id,g FROM t ORDER BY CAST(CONCAT(g,'x') AS SIGNED) LIMIT 0 OFFSET 0",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT id,g FROM t WHERE FALSE ORDER BY g LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT DISTINCT g FROM t WHERE FALSE ORDER BY g LIMIT 0 OFFSET 1",[["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT id,g FROM t WHERE id=99 ORDER BY g LIMIT 0 OFFSET 1",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT DISTINCT g FROM t WHERE id=99 ORDER BY g LIMIT 0 OFFSET 1",[["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Zero rows"],
    ["SELECT LAST_INSERT_ID(5) AS calls LIMIT 0 OFFSET 1",[["calls",8,21,161,0,63,"","","",""]],[],[[0]],"Limit/Offset\n    Rows fetched before execution"],
    ["SELECT id,g FROM t ORDER BY g LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"zero_offset","t","t","id"],["g",3,11,0,0,63,"zero_offset","t","t","g"]],[],[[0]],"Limit/Offset\n    Sort\n        Table scan on t"],
    ["SELECT DISTINCT LAST_INSERT_ID(id) AS calls FROM t ORDER BY calls LIMIT 0 OFFSET 1",[["calls",8,21,33,0,63,"","","","calls"]],[],[[4]],"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Covering index scan on t using PRIMARY"],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY n LIMIT 0 OFFSET 1",[["n",8,21,32768,0,63,"","","","n"]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '2x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}],[[0]],"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t"],
  ]
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS zero_offset')
    await conn.query('USE zero_offset')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT)')
    await conn.query('INSERT INTO t VALUES(1,3),(2,1),(3,2),(4,0)')
    await conn.query('ANALYZE TABLE t')
    for (const [sql, fields, warnings, calls, plan] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        await conn.query('SELECT LAST_INSERT_ID(0)')
        const options = { sql, rowsAsArray: true }
        const params = sql.includes('?') ? [0, 1] : []
        const [rows, columns] = method === 'query' ? await conn.query(options, params) : await conn.execute(options, params)
        assert.deepEqual(rows, [], method + ': ' + sql)
        assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), fields, method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
        assert.deepEqual((await conn.query({ sql: 'SELECT LAST_INSERT_ID()', rowsAsArray: true }))[0], calls, method + ': effects: ' + sql)
        const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql, params)
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, method + ': plan: ' + sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS zero_offset')
    await conn.end()
    await db?.end()
  }
})

test('zero LIMIT initializes only required sorts and closes their physical source', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE t(id INT PRIMARY KEY,g INT)')
    await db.query('INSERT INTO t VALUES(1,3),(2,1),(3,1),(4,NULL)')
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
        const indexScan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          try {
            for (const row of indexScan(index, range, transaction, mode)) {
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
      for (const method of ['query', 'execute', 'stream'] as const) {
        for (const offset of [0, 1, 8]) {
          for (const [select, order, scanned] of [['id,g', '', false], ['id,g', ' ORDER BY id', false], ['id,g', ' ORDER BY g', true], ['DISTINCT g', ' ORDER BY g', true]] as const) {
            read = closed = 0
            const sql = `SELECT ${select} FROM d.t${order} LIMIT 0 OFFSET ${offset} FOR UPDATE`
            if (method === 'stream') {
              const rows = []
              for await (const row of db.stream(sql)) rows.push(row)
              assert.deepEqual(rows, [])
            } else assert.deepEqual((await db[method](sql))[0], [])
            const active = offset > 0 && scanned
            assert.equal(read, active ? 4 : 0, `${method}: reads: ${sql}`)
            assert.equal(closed, active ? 1 : 0, `${method}: closes: ${sql}`)
            assert.equal(db.openConnections, 1)
          }
        }
        for (const count of [0, 1, 2]) {
          for (const offset of [0, 1, 2, 3, 8]) {
            read = closed = 0
            const sql = `SELECT DISTINCT g FROM d.t LIMIT ${count} OFFSET ${offset} FOR UPDATE`
            const expected = [3, 1, null].slice(offset, offset + count).map((g) => ({ g }))
            if (method === 'stream') {
              const rows = []
              for await (const row of db.stream(sql)) rows.push(row)
              assert.deepEqual(rows, expected)
            } else assert.deepEqual((await db[method](sql))[0], expected)
            // Input has a duplicate before its third unique row: 3, 1, 1, NULL.
            const needed = count + offset
            assert.equal(read, needed === 0 ? 0 : needed === 1 ? 1 : needed === 2 ? 2 : 4, `${method}: reads: ${sql}`)
            assert.equal(closed, needed === 0 ? 0 : 1, `${method}: closes: ${sql}`)
            assert.equal(db.openConnections, 1)
          }
        }
      }
      for await (const row of db.stream('SELECT DISTINCT g FROM d.t LIMIT 2 FOR UPDATE')) {
        assert.deepEqual(row, { g: 3 })
        break
      }
      assert.equal(db.openConnections, 1)
      const other = await db.connect()
      try {
        await other.query('SET innodb_lock_wait_timeout=1')
        await other.query('UPDATE d.t SET g=g WHERE id=1')
      } finally {
        await other.end()
      }
    } finally {
      catalog.table = open
    }
  } finally {
    await db.end()
  }
})
