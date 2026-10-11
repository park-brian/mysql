// M5.49: bounded filesort keeps native physical slots, rather than stable top-N ties.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('integer priority-queue filesort matches native LIMIT ties, NULLs, directions and offsets', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const layouts: [string, number, number][] = [['TINYINT', 1, 4], ['SMALLINT', 2, 6], ['MEDIUMINT', 9, 9], ['INT', 3, 11], ['BIGINT', 8, 20]]
  const limits = [[1, 0], [2, 0], [1, 1], [2, 1], [1, 4]] as const
  // Authored inputs and literal winners observed on pinned 8.4.11.
  const fixtures: [string, (number | null)[], number[][], number[][]][] = [
    ['equal', Array(16).fill(1), [[1], [1, 2], [2], [2, 3], [5]], [[1], [1, 2], [2], [2, 3], [5]]],
    ['groups', [3, 0, 2, 0, 0, 1, 2, 0, 0, 3, 1, 0, 1, 2, 0, 3], [[2], [4, 2], [2], [2, 4], [5]], [[1], [1, 10], [10], [16, 10], [3]]],
    ['nulls', [3, null, 2, null, 0, 1, 2, null, 0, 3, 1, null, 1, 2, 0, 3], [[2], [4, 2], [2], [8, 4], [9]], [[1], [1, 10], [10], [10, 16], [7]]],
  ]
  const run = async (sql: string, expected: unknown[][], fields: unknown[][], offset: number, fixture = 'unique') => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${fixture}: ${method}: ${sql}`)
      assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), fields, `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), `${offset > 0 ? 'Limit/Offset' : 'Limit'}\n    Sort\n        Table scan on t`, `${method}: plan`)
      conn.unprepare(options)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS queue_order')
    await conn.query('USE queue_order')
    for (const [type, field, length] of layouts) {
      const fields = [['id', 3, 11, 20483, 0, 63, 'queue_order', 't', 't', 'id'], ['g', field, length, 0, 0, 63, 'queue_order', 't', 't', 'g']]
      for (const [fixture, values, ascending, descending] of fixtures) {
        await conn.query('DROP TABLE IF EXISTS t')
        await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,g ${type}) STATS_AUTO_RECALC=0`)
        await conn.query(`INSERT INTO t VALUES${values.map((g, i) => `(${i + 1},${g === null ? 'NULL' : g})`).join(',')}`)
        await conn.query('ANALYZE TABLE t')
        for (const memory of [32768, 262144]) {
          await conn.query(`SET sort_buffer_size=${memory}`)
          for (const desc of [false, true]) {
            for (const [i, [count, offset]] of limits.entries()) {
              const ids = (desc ? descending : ascending)[i]!
              await run(`SELECT id,g FROM t ORDER BY g${desc ? ' DESC' : ''} LIMIT ${count} OFFSET ${offset}`, ids.map((id) => [id, values[id - 1]]), fields, offset, fixture)
            }
            // A second key fully orders ties and uses the same queue owner.
            const full = values.map((g, i) => [i + 1, g] as const).sort((a, b) => {
              const order = a[1] === b[1] ? 0 : a[1] === null ? -1 : b[1] === null ? 1 : a[1] - b[1]
              return (desc ? -order : order) || b[0] - a[0]
            })
            await run(`SELECT id,g FROM t ORDER BY g${desc ? ' DESC' : ''},id DESC LIMIT 5`, full.slice(0, 5).map((r) => [...r]), fields, 0, fixture)
          }
        }
      }
    }
    // With a unique sort key, rejected queue cases preserve correct results.
    await conn.query('DROP TABLE t')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO t VALUES(1,6),(2,2),(3,10),(4,3),(5,15),(6,1),(7,9),(8,8),(9,4),(10,16),(11,12),(12,5),(13,11),(14,7),(15,14),(16,13)')
    await conn.query('ANALYZE TABLE t')
    const ids = [6, 2, 4, 9, 12, 1, 14, 8, 7, 3, 13, 11, 16, 15, 5, 10]
    const fields = [['id', 3, 11, 20483, 0, 63, 'queue_order', 't', 't', 'id'], ['g', 3, 11, 0, 0, 63, 'queue_order', 't', 't', 'g']]
    for (const count of [6, 8, 12, 16]) await run(`SELECT id,g FROM t ORDER BY g LIMIT ${count}`, ids.slice(0, count).map((id, i) => [id, i + 1]), fields, 0)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS queue_order')
    await conn.end()
    await db?.end()
  }
})

test('a bounded queue reads and closes the source once, and early stream return closes its connection', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE t(id INT PRIMARY KEY,g INT) STATS_AUTO_RECALC=0')
    await db.query('INSERT INTO t VALUES(1,3),(2,0),(3,2),(4,0),(5,0),(6,1),(7,2),(8,0),(9,0),(10,3),(11,1),(12,0),(13,1),(14,2),(15,0),(16,3)')
    await db.query('ANALYZE TABLE t')
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let read = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 't') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          try { for (const row of scan(range, transaction, mode)) { read++; yield row } }
          finally { closed++ }
        }
      }
      return table
    }
    try {
      for (const method of ['query', 'execute'] as const) {
        read = closed = 0
        assert.deepEqual((await db[method]('SELECT id,g FROM t ORDER BY g LIMIT 2'))[0], [{ id: 4, g: 0 }, { id: 2, g: 0 }])
        assert.equal(read, 16)
        assert.equal(closed, 1)
      }
      read = closed = 0
      for await (const row of db.stream('SELECT id,g FROM d.t ORDER BY g LIMIT 2')) {
        assert.deepEqual(row, { id: 4, g: 0 })
        break
      }
      assert.equal(read, 16)
      assert.equal(closed, 1)
      assert.equal(db.openConnections, 1)
      await db.query('UPDATE t SET g=g WHERE id=1')
    } finally {
      catalog.table = open
    }
  } finally {
    await db.end()
  }
})

test('integer queue retains native slots at the 16-record boundary with a source larger than sort memory', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS large_queue')
    await conn.query('USE large_queue')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT) STATS_AUTO_RECALC=0')
    const values = Array.from({ length: 2000 }, (_, i) => i % 7 === 0 ? null : i % 4)
    await conn.query(`INSERT INTO t VALUES${values.map((g, i) => `(${i + 1},${g === null ? 'NULL' : g})`).join(',')}`)
    await conn.query('ANALYZE TABLE t')
    const ascending = [1, 92, 71, 64, 43, 29, 8, 57, 85, 22, 36, 99, 78, 15, 50]
    const descending = [60, 2000, 68, 4, 24, 32, 72, 44, 52, 28, 56, 12, 48, 40, 20]
    const fields = [['id', 3, 11, 20483, 0, 63, 'large_queue', 't', 't', 'id'], ['g', 3, 11, 0, 0, 63, 'large_queue', 't', 't', 'g']]
    for (const memory of [32768, 262144]) {
      await conn.query(`SET sort_buffer_size=${memory}`)
      for (const [desc, ids] of [[false, ascending], [true, descending]] as const) {
        for (const [count, offset] of [[15, 0], [1, 14]] as const) {
          const sql = `SELECT id,g FROM t ORDER BY g${desc ? ' DESC' : ''} LIMIT ${count} OFFSET ${offset}`
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, ids.slice(offset, offset + count).map((id) => [id, values[id - 1]]), `${method}: ${sql}`)
            assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), fields)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
            assert.equal(planSkeleton(explain[0]?.EXPLAIN), `${offset > 0 ? 'Limit/Offset' : 'Limit'}\n    Sort\n        Table scan on t`)
            conn.unprepare(options)
          }
        }
      }
    }
    // The NULL bitmap spans 32 bytes. At 32 KiB, 16 wide records do not
    // fit; LIMIT 6 uses a queue although six exceeds one third of the source.
    await conn.query('DROP TABLE t')
    await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,g INT,${Array.from({ length: 255 }, (_, i) => `v${i} BIGINT`).join(',')}) STATS_AUTO_RECALC=0`)
    const groups = [3, 0, 2, 0, 0, 1, 2, 0, 0, 3, 1, 0, 1, 2, 0, 3]
    await conn.query(`INSERT INTO t(id,g) VALUES${groups.map((g, i) => `(${i + 1},${g})`).join(',')}`)
    await conn.query('ANALYZE TABLE t')
    await conn.query('SET sort_buffer_size=32768')
    const wideFields = [...fields, ...Array.from({ length: 255 }, (_, i) => [`v${i}`, 8, 20, 0, 0, 63, 'large_queue', 't', 't', `v${i}`])]
    for (const [desc, ids] of [[false, [8, 2, 12, 4, 5, 9]], [true, [1, 16, 10, 14, 3, 7]]] as const) {
      const sql = `SELECT * FROM t ORDER BY g${desc ? ' DESC' : ''} LIMIT 6`
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, ids.map((id) => [id, groups[id - 1], ...Array(255).fill(null)]), `${method}: ${sql}`)
        assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), wideFields)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
        const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), 'Limit\n    Sort\n        Table scan on t')
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS large_queue')
    await conn.end()
    await db?.end()
  }
})
