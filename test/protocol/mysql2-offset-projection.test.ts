// M5.49: discard ordered OFFSET rows before evaluating the SELECT list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

test('ordered OFFSET reads bound the scan, skip SELECT effects and release locking streams', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await db.query('CREATE TABLE t(id INT PRIMARY KEY,g INT,KEY kg(g DESC))')
    await db.query('INSERT INTO t VALUES(1,3),(2,1),(3,1),(4,NULL)')
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let read = 0
    let closed = 0
    const indexes: string[] = []
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 't') {
        const primary = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          indexes.push('PRIMARY')
          try {
            for (const row of primary(range, transaction, mode)) {
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
    const g = [3, 1, 1, null]
    const orders: [string, number[], string][] = [
      ['id,id DESC', [1, 2, 3, 4], 'PRIMARY'],
      ['id DESC,id', [4, 3, 2, 1], 'PRIMARY'],
      ['g,g DESC', [4, 3, 2, 1], 'kg'],
      ['g DESC,g', [1, 2, 3, 4], 'kg'],
    ]
    try {
      for (const [order, ids, index] of orders) {
        for (const method of ['query', 'execute'] as const) {
          for (const offset of [0, 1, 2, 8]) {
            await db.query('SELECT LAST_INSERT_ID(0)')
            read = closed = 0
            indexes.length = 0
            const id = ids[offset]
            const x = id === undefined ? undefined : g[id - 1]
            const [rows] = await db[method]("SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY " + order + ' LIMIT 1 OFFSET ' + offset)
            assert.deepEqual(rows, id === undefined ? [] : [{ id, x, calls: 1 }])
            assert.equal(read, Math.min(offset + 1, 4), 'scan stops at count plus offset')
            assert.equal(closed, 1)
            assert.deepEqual(indexes, [index])
            assert.deepEqual((await db.query('SHOW WARNINGS'))[0], x == null ? [] : [{ Level: 'Warning', Code: 1292, Message: "Truncated incorrect INTEGER value: '" + x + "x'" }])
            assert.deepEqual((await db.query('SELECT LAST_INSERT_ID() AS calls'))[0], [{ calls: id === undefined ? 0 : 1 }])
          }
          for (const offset of [0, 1]) {
            read = closed = 0
            indexes.length = 0
            assert.deepEqual((await db[method]('SELECT id FROM t ORDER BY ' + order + ' LIMIT 0 OFFSET ' + offset))[0], [])
            assert.equal(read, 0, 'zero-count projection retains the uninitialized iterator')
            assert.equal(closed, 0)
            assert.deepEqual(indexes, [])
          }
        }
        await db.query('SELECT LAST_INSERT_ID(0)')
        read = closed = 0
        indexes.length = 0
        for await (const row of db.stream('SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM d.t ORDER BY ' + order + ' LIMIT 2 OFFSET 1 FOR UPDATE')) {
          assert.deepEqual(row, { id: ids[1], calls: 1 })
          break
        }
        assert.equal(closed, 1, 'return closes the physical source through the moved LIMIT')
        assert.deepEqual(indexes, [index])
        const other = await db.connect()
        try {
          await other.query('SET innodb_lock_wait_timeout=1')
          await other.query('UPDATE d.t SET g=g WHERE id=' + ids[1])
        } finally {
          await other.end()
        }
        assert.equal(db.openConnections, 1)
      }
    } finally {
      catalog.table = open
    }
  } finally {
    await db.end()
  }
})

test('ordered OFFSET projection matches native warnings, seeded RAND, effects, fields and plans', async () => {
  const { db, conn } = await connect()
  // Complete native outcomes. DISTINCT materialization and empty WHERE are controls.
  // HAVING/windows/sorting, correlated metadata and prepared CAST nullability remain separate gaps.
  const layouts: unknown[][][] = [[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["x",8,21,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["x",8,21,128,0,63,"","","",""],["y",8,21,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["calls",8,21,161,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["n",5,23,129,31,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["n",8,21,160,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["x",8,21,129,0,63,"","","",""]],[["x",8,21,129,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["x",253,48,0,31,224,"","","",""]],[["x",8,21,32768,0,63,"","","","x"]],[["x",8,21,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","s","s","id"],["x",8,21,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","s","s","id"],["calls",8,21,161,0,63,"","","",""]],[["id",3,11,20483,0,63,"offset_projection","t","t","id"],["x",8,2,129,0,63,"","","",""]]]
  const diagnostics: unknown[][] = [[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],[],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3X'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1X'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1X'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3X'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1X'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"}]]
  const plans: string[] = ["Index scan on t using PRIMARY","Zero rows","Limit/Offset\n    Index scan on t using PRIMARY","Limit\n    Index scan on t using PRIMARY","Covering index scan on t using PRIMARY","Limit/Offset\n    Covering index scan on t using PRIMARY","Limit\n    Covering index scan on t using PRIMARY","Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","Limit\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","Covering index scan on s using kg","Limit/Offset\n    Covering index scan on s using kg","Limit\n    Covering index scan on s using kg"]
  const fixtures: [string, unknown[][], number, number, unknown[][], number][] = [
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id",[[1,3],[2,1],[3,1],[4,null]],0,0,[[0]],0],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id LIMIT 1",[[1,3]],0,2,[[0]],3],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],0,3,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1]],0,3,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0,1,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id",[[1,3,3],[2,1,1],[3,1,1],[4,null,null]],1,4,[[0]],0],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id LIMIT 0 OFFSET 0",[],1,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,1,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id LIMIT 1",[[1,3,3]],1,5,[[0]],3],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1,1]],1,6,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1,1]],1,6,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,CAST(CONCAT(g,'X') AS SIGNED) AS y FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,1,[[0]],2],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id",[[1,1],[2,2],[3,3],[4,4]],2,1,[[4]],4],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id LIMIT 0 OFFSET 0",[],2,1,[[0]],1],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,1,[[0]],5],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id LIMIT 1",[[1,1]],2,1,[[1]],6],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2]],2,1,[[2]],5],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,3]],2,1,[[3]],5],
    ["SELECT id,LAST_INSERT_ID(id) AS calls FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,1,[[0]],5],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id",[[1,1],[2,2],[3,3],[4,4]],2,1,[[4]],4],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id LIMIT 0 OFFSET 0",[],2,1,[[0]],1],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,1,[[0]],5],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id LIMIT 1",[[1,1]],2,1,[[1]],6],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],2,1,[[1]],5],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1]],2,1,[[1]],5],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,1,[[0]],5],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id",[[1,0.9065021936842261],[2,0.37600881361962185],[3,0.16053751777907602],[4,0.6746611787701595]],3,1,[[0]],4],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id LIMIT 0 OFFSET 0",[],3,1,[[0]],1],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,1,[[0]],5],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id LIMIT 1",[[1,0.9065021936842261]],3,1,[[0]],6],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0.9065021936842261]],3,1,[[0]],5],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,0.9065021936842261]],3,1,[[0]],5],
    ["SELECT id,RAND(7) AS n FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,1,[[0]],5],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id",[[1,3],[2,1],[3,1],[4,77]],4,1,[[77]],0],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id LIMIT 0 OFFSET 0",[],4,1,[[0]],1],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4,1,[[0]],2],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id LIMIT 1",[[1,3]],4,1,[[3]],3],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],4,1,[[1]],2],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1]],4,1,[[1]],2],
    ["SELECT id,IF(g IS NULL,LAST_INSERT_ID(77),LAST_INSERT_ID(g)) AS n FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4,1,[[0]],2],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1],[4,1]],5,7,[[0]],4],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],5,1,[[0]],1],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],5,1,[[0]],5],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 1",[[1,1]],5,3,[[0]],6],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],5,3,[[0]],5],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1]],5,3,[[0]],5],
    ["SELECT id,CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],5,1,[[0]],5],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id",[[1],[1],[1],[1]],6,7,[[0]],4],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],6,1,[[0]],1],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],6,1,[[0]],5],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 1",[[1]],6,3,[[0]],6],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[1]],6,3,[[0]],5],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[1]],6,3,[[0]],5],
    ["SELECT CAST('1x' AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],6,1,[[0]],5],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id",[[1,4],[2,2],[3,2],[4,null]],0,1,[[0]],0],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],0,1,[[0]],1],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1,[[0]],2],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id LIMIT 1",[[1,4]],0,1,[[0]],3],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2]],0,1,[[0]],2],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,2]],0,1,[[0]],2],
    ["SELECT id,CAST(ABS(g)+1 AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0,1,[[0]],2],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id",[[1,"3x"],[2,"1x"],[3,"1x"],[4,null]],7,1,[[0]],0],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],7,1,[[0]],1],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],7,1,[[0]],2],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id LIMIT 1",[[1,"3x"]],7,1,[[0]],3],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"1x"]],7,1,[[0]],2],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,"1x"]],7,1,[[0]],2],
    ["SELECT id,CONCAT(g,'x') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],7,1,[[0]],2],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id",[[1,3],[2,1],[3,1],[4,null]],0,0,[[0]],0],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],0,1,[[0]],1],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1,[[0]],2],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id LIMIT 1",[[1,3]],0,2,[[0]],3],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],0,3,[[0]],2],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1]],0,3,[[0]],2],
    ["SELECT id,ABS(CAST(CONCAT(g,'x') AS SIGNED)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0,1,[[0]],2],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x",[[null],[1],[3]],8,0,[[0]],7],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x LIMIT 0 OFFSET 0",[],9,1,[[0]],1],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x LIMIT 0 OFFSET 1",[],8,0,[[0]],8],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x LIMIT 1",[[null]],8,0,[[0]],9],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x LIMIT 1 OFFSET 1",[[1]],8,0,[[0]],8],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x LIMIT 1 OFFSET 2",[[3]],8,0,[[0]],8],
    ["SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY x LIMIT 2 OFFSET 8",[],8,0,[[0]],8],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id LIMIT 0 OFFSET 0",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id LIMIT 0 OFFSET 1",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id LIMIT 1",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id LIMIT 1 OFFSET 1",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id LIMIT 1 OFFSET 2",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t WHERE FALSE ORDER BY id LIMIT 2 OFFSET 8",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC",[[4,null],[3,1],[2,1],[1,3]],0,8,[[0]],0],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 0",[],0,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1",[],0,1,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC LIMIT 1",[[4,null]],0,1,[[0]],3],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 1",[[3,1]],0,3,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 2",[[2,1]],0,3,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 8",[],0,1,[[0]],2],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g",[[4,null],[3,1],[2,1],[1,3]],10,8,[[0]],10],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g LIMIT 0 OFFSET 0",[],10,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g LIMIT 0 OFFSET 1",[],10,1,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g LIMIT 1",[[4,null]],10,1,[[0]],12],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g LIMIT 1 OFFSET 1",[[3,1]],10,3,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g LIMIT 1 OFFSET 2",[[2,1]],10,3,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g LIMIT 2 OFFSET 8",[],10,1,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g",[[1,3],[2,1],[3,1],[4,null]],10,0,[[0]],10],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g LIMIT 0 OFFSET 0",[],10,1,[[0]],1],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g LIMIT 0 OFFSET 1",[],10,1,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g LIMIT 1",[[1,3]],10,2,[[0]],12],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g LIMIT 1 OFFSET 1",[[2,1]],10,3,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g LIMIT 1 OFFSET 2",[[3,1]],10,3,[[0]],11],
    ["SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s ORDER BY g DESC,g LIMIT 2 OFFSET 8",[],10,1,[[0]],11],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g",[[4,1],[3,2],[2,3],[1,4]],11,1,[[4]],10],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g LIMIT 0 OFFSET 0",[],11,1,[[0]],1],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g LIMIT 0 OFFSET 1",[],11,1,[[0]],11],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g LIMIT 1",[[4,1]],11,1,[[1]],12],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g LIMIT 1 OFFSET 1",[[3,1]],11,1,[[1]],11],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g LIMIT 1 OFFSET 2",[[2,1]],11,1,[[1]],11],
    ["SELECT id,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g LIMIT 2 OFFSET 8",[],11,1,[[0]],11],
    ["SELECT id,1 AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1],[4,1]],12,1,[[0]],4],
    ["SELECT id,1 AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],12,1,[[0]],1],
    ["SELECT id,1 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],12,1,[[0]],5],
    ["SELECT id,1 AS x FROM t ORDER BY id LIMIT 1",[[1,1]],12,1,[[0]],6],
    ["SELECT id,1 AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],12,1,[[0]],5],
    ["SELECT id,1 AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,1]],12,1,[[0]],5],
    ["SELECT id,1 AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],12,1,[[0]],5],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id",[[1,null],[2,null],[3,null],[4,null]],0,1,[[0]],4],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 0",[],0,1,[[0]],1],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1,[[0]],5],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id LIMIT 1",[[1,null]],0,1,[[0]],6],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,null]],0,1,[[0]],5],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 2",[[3,null]],0,1,[[0]],5],
    ["SELECT id,CAST(NULL AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0,1,[[0]],5],
  ]
  try {
    await conn.query('CREATE DATABASE offset_projection')
    await conn.query('USE offset_projection')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT)')
    await conn.query('INSERT INTO t VALUES(1,3),(2,1),(3,1),(4,NULL)')
    await conn.query('CREATE TABLE s(id INT PRIMARY KEY,g INT,KEY kg(g DESC))')
    await conn.query('INSERT INTO s SELECT * FROM t')
    for (const table of ['t', 's']) await conn.query('ANALYZE TABLE ' + table)
    for (const [sql, expected, layout, diagnostic, calls, plan] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        await conn.query('SELECT LAST_INSERT_ID(0)')
        const options = { sql, rowsAsArray: true }
        const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, method + ': rows: ' + sql)
        assert.deepEqual(fields(columns), layouts[layout], method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], diagnostics[diagnostic], method + ': warnings: ' + sql)
        assert.deepEqual((await conn.query({ sql: 'SELECT LAST_INSERT_ID()', rowsAsArray: true }))[0], calls, method + ': effects: ' + sql)
        const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), plans[plan], method + ': plan: ' + sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS offset_projection')
    await conn.end()
    await db?.end()
  }
})

test('ordered OFFSET JSON diagnostics number delivered rows from one', async () => {
  const { db, conn } = await connect()
  const fixtures: { sql: string; method: 'query' | 'execute'; rows: unknown[][]; fields: unknown[][]; warnings: unknown[] }[] = [{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id","method":"query","rows":[[1,0],[2,0],[3,0],[4,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 3"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 4"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id","method":"execute","rows":[[1,0],[2,0],[3,0],[4,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 3"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 4"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","method":"query","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","method":"execute","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1","method":"query","rows":[[2,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1","method":"execute","rows":[[2,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1","method":"query","rows":[[2,0],[3,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1","method":"execute","rows":[[2,0],[3,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8","method":"query","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8","method":"execute","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC","method":"query","rows":[[4,0],[3,0],[2,0],[1,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 3"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 4"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC","method":"execute","rows":[[4,0],[3,0],[2,0],[1,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 3"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 4"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1","method":"query","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1","method":"execute","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 1","method":"query","rows":[[3,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 1","method":"execute","rows":[[3,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 1","method":"query","rows":[[3,0],[2,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 1","method":"execute","rows":[[3,0],[2,0]],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"}]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 8","method":"query","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"sql":"SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 8","method":"execute","rows":[],"fields":[["id",3,11,20483,0,63,"offset_rows","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]}]
  try {
    await conn.query('CREATE DATABASE offset_rows')
    await conn.query('USE offset_rows')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,j JSON,d VARCHAR(30))')
    await conn.query("INSERT INTO t VALUES(1,'[]','2020^01^01'),(2,'[]','2020^01^02'),(3,'[]','2020^01^03'),(4,'[]','2020^01^04')")
    for (const fixture of fixtures) {
      const options = { sql: fixture.sql, rowsAsArray: true }
      const [rows, columns] = fixture.method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, fixture.rows, fixture.method + ': rows: ' + fixture.sql)
      assert.deepEqual(fields(columns), fixture.fields, fixture.method + ': fields: ' + fixture.sql)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings, fixture.method + ': diagnostics: ' + fixture.sql)
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS offset_rows')
    await conn.end()
    await db?.end()
  }
})

test('cached ordered OFFSET reads use fresh writes and preserve WHERE evaluation', async () => {
  const { db, conn } = await connect()
  const fresh: { g: number; method: 'query' | 'execute' | 'statement'; rows: unknown; fields: unknown[][]; warnings: unknown[]; calls: unknown[][] }[] = [{"g":0,"method":"query","rows":[[1,0,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}],"calls":[[1]]},{"g":0,"method":"execute","rows":[[1,0,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}],"calls":[[1]]},{"g":0,"method":"statement","rows":[{"id":1,"x":0,"calls":1}],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}],"calls":[[1]]},{"g":9,"method":"query","rows":[[3,1,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],"calls":[[1]]},{"g":9,"method":"execute","rows":[[3,1,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],"calls":[[1]]},{"g":9,"method":"statement","rows":[{"id":3,"x":1,"calls":1}],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],"calls":[[1]]}]
  const filtered: { sql: string; method: 'query' | 'execute'; rows: unknown[][]; fields: unknown[][]; warnings: unknown[] }[] = [{"sql":"SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s WHERE CAST(CONCAT(g,'w') AS SIGNED)>=0 ORDER BY id LIMIT 1 OFFSET 1","method":"query","rows":[[2,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]},{"sql":"SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s WHERE CAST(CONCAT(g,'w') AS SIGNED)>=0 ORDER BY id LIMIT 1 OFFSET 1","method":"execute","rows":[[2,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]},{"sql":"SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s WHERE CAST(CONCAT(g,'w') AS SIGNED)>=0 ORDER BY id LIMIT 1 OFFSET 2","method":"query","rows":[[3,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]},{"sql":"SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s WHERE CAST(CONCAT(g,'w') AS SIGNED)>=0 ORDER BY id LIMIT 1 OFFSET 2","method":"execute","rows":[[3,1]],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]},{"sql":"SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s WHERE CAST(CONCAT(g,'w') AS SIGNED)>=0 ORDER BY id LIMIT 2 OFFSET 8","method":"query","rows":[],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"}]},{"sql":"SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x FROM s WHERE CAST(CONCAT(g,'w') AS SIGNED)>=0 ORDER BY id LIMIT 2 OFFSET 8","method":"execute","rows":[],"fields":[["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""]],"warnings":[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1w'"}]}]
  try {
    await conn.query('CREATE DATABASE offset_fresh')
    await conn.query('USE offset_fresh')
    await conn.query('CREATE TABLE s(id INT PRIMARY KEY,g INT,KEY kg(g DESC))')
    await conn.query('INSERT INTO s VALUES(1,3),(2,1),(3,1),(4,NULL)')
    const options = { sql: "SELECT id,CAST(CONCAT(g,'x') AS SIGNED) AS x,LAST_INSERT_ID(LAST_INSERT_ID()+1) AS calls FROM s ORDER BY g,g DESC LIMIT ? OFFSET ?", rowsAsArray: true }
    const statement = await conn.prepare(options)
    try {
      const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
      assert.deepEqual(fields(columns), [["id",3,11,20483,0,63,"offset_fresh","s","s","id"],["x",8,21,128,0,63,"","","",""],["calls",8,21,161,0,63,"","","",""]], 'PREPARE metadata')
      for (const fixture of fresh) {
        await conn.query('UPDATE s SET g=? WHERE id=1', [fixture.g])
        await conn.query('SELECT LAST_INSERT_ID(0)')
        const [rows, columns] = fixture.method === 'statement' ? await statement.execute([1, 1])
          : fixture.method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
        assert.deepEqual(rows, fixture.rows, fixture.method + ': fresh rows')
        assert.deepEqual(fields(columns), fixture.fields, fixture.method + ': fresh fields')
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings, fixture.method + ': fresh warnings')
        assert.deepEqual((await conn.query({ sql: 'SELECT LAST_INSERT_ID()', rowsAsArray: true }))[0], fixture.calls, fixture.method + ': fresh effects')
      }
    } finally {
      await statement.close()
      conn.unprepare(options)
    }
    await conn.query('UPDATE s SET g=3 WHERE id=1')
    // Positive counts pin WHERE warnings for skipped rows, followed by SELECT warnings for delivered rows.
    // LIMIT 0 with a positive OFFSET still has a separate native WHERE-initialization gap.
    for (const fixture of filtered) {
      const options = { sql: fixture.sql, rowsAsArray: true }
      const [rows, columns] = fixture.method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, fixture.rows, fixture.method + ': filtered rows')
      assert.deepEqual(fields(columns), fixture.fields, fixture.method + ': filtered fields')
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings, fixture.method + ': WHERE/SELECT warning order')
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS offset_fresh')
    await conn.end()
    await db?.end()
  }
})
