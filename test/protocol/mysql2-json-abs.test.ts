// M5.10: ABS reads JSON as DOUBLE and floating ABS removes negative zero.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

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

type Fixture = [string, unknown[][], number, number]
const layouts: unknown[][][] = [[["id",3,11,20483,0,63,"json_abs","t","t","id"],["x",5,23,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"json_abs","n","n","id"],["x",5,23,129,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",8,20,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",8,20,160,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",246,14,128,4,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",5,23,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",5,21,128,4,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",8,8,160,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",8,2,129,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",246,6,129,3,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",5,23,129,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_control","t","t","id"],["x",5,17,161,0,63,"","","",""]]]
const diagnostics: unknown[][] = [[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 7"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 8"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 9"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 15"}],[],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 7"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 8"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 9"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 14"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 6"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 7"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 8"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 14"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-1x'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-1x'"}]]

async function verify(conn: mysql.Connection, fixtures: Fixture[]) {
  for (const [sql, expected, layout, diagnostic] of fixtures) {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, method + ': rows: ' + sql)
      assert.deepEqual(fields(columns), layouts[layout], method + ': fields: ' + sql)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], diagnostics[diagnostic], method + ': diagnostics: ' + sql)
      conn.unprepare(options)
    }
  }
}

test('ABS JSON source reads match native DOUBLE values, fields and warnings in both directions', async () => {
  const { db, conn } = await connect()
  // Full native groups. DISTINCT/grouping, expression warning names and parameter metadata remain separate gaps.
  const fixtures: Fixture[] = [
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],0,0],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6",[[7,1]],0,2],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7",[[8,0],[9,0]],0,3],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0],[1,null]],0,4],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],0,2],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],0,3],
    ["SELECT id,ABS(j) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],0,0],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6",[[7,1]],0,2],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7",[[8,0],[9,0]],0,3],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0],[1,null]],0,4],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],0,2],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],0,3],
    ["SELECT id,ABS(-j) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],0,0],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6",[[7,1]],0,2],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7",[[8,0],[9,0]],0,3],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0],[1,null]],0,4],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],0,2],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],0,3],
    ["SELECT id,ABS(j+0) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],0,0],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6",[[7,1]],0,2],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7",[[8,0],[9,0]],0,3],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0],[1,null]],0,4],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id DESC LIMIT 0 OFFSET 1",[],0,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],0,2],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],0,3],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM t ORDER BY id DESC LIMIT 2 OFFSET 20",[],0,1],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id",[[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],1,5],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id LIMIT 1 OFFSET 6",[[8,0]],1,2],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id LIMIT 2 OFFSET 7",[[9,0],[10,2]],1,2],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0]],1,4],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id DESC LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],1,2],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],1,3],
    ["SELECT id,ABS(j) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id",[[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],1,5],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id LIMIT 1 OFFSET 6",[[8,0]],1,2],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id LIMIT 2 OFFSET 7",[[9,0],[10,2]],1,2],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0]],1,4],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id DESC LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],1,2],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],1,3],
    ["SELECT id,ABS(-j) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id",[[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],1,5],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id LIMIT 1 OFFSET 6",[[8,0]],1,2],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id LIMIT 2 OFFSET 7",[[9,0],[10,2]],1,2],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0]],1,4],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id DESC LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],1,2],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],1,3],
    ["SELECT id,ABS(j+0) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id",[[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,2],[11,18446744073709552000],[12,1.5],[13,0],[14,2.5],[15,1]],1,5],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id LIMIT 1 OFFSET 6",[[8,0]],1,2],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id LIMIT 2 OFFSET 7",[[9,0],[10,2]],1,2],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id LIMIT 2 OFFSET 20",[],1,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id DESC",[[15,1],[14,2.5],[13,0],[12,1.5],[11,18446744073709552000],[10,2],[9,0],[8,0],[7,1],[6,10],[5,10],[4,0],[3,1],[2,0]],1,4],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id DESC LIMIT 0 OFFSET 1",[],1,1],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id DESC LIMIT 1 OFFSET 6",[[9,0]],1,2],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 7",[[8,0],[7,1]],1,3],
    ["SELECT id,ABS(CAST(j AS DOUBLE)) AS x FROM n ORDER BY id DESC LIMIT 2 OFFSET 20",[],1,1],
  ]
  try {
    await conn.query('CREATE DATABASE json_abs')
    await conn.query('USE json_abs')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,j JSON)')
    await conn.query('CREATE TABLE n(id INT PRIMARY KEY,j JSON NOT NULL)')
    const values = [null, 'null', 'true', 'false', '10', '"10"', '"1x"', '[]', '{}', '-2', '18446744073709551615', '1.5', '-0.0', '-2.5', '"-1x"']
    for (const [i, value] of values.entries()) {
      await conn.query('INSERT INTO t VALUES(?,?)', [i + 1, value])
      if (value !== null) await conn.query('INSERT INTO n VALUES(?,?)', [i + 1, value])
    }
    await verify(conn, fixtures)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS json_abs')
    await conn.end()
    await db?.end()
  }
})

test('ABS retains integer, unsigned, decimal, fixed-scale, text, binary and BIT-column behavior', async () => {
  const { db, conn } = await connect()
  // The whole BIT-literal group has a pre-existing metadata mismatch and remains open.
  const fixtures: Fixture[] = [
    ["SELECT id,ABS(i) AS x FROM t ORDER BY id",[[1,2],[2,2],[3,null],[4,0]],2,1],
    ["SELECT id,ABS(i) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,1],
    ["SELECT id,ABS(i) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2]],2,1],
    ["SELECT id,ABS(i) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,2],[3,null]],2,1],
    ["SELECT id,ABS(i) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,1],
    ["SELECT id,ABS(u) AS x FROM t ORDER BY id",[[1,3],[2,18446744073709552000],[3,null],[4,0]],3,1],
    ["SELECT id,ABS(u) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,1],
    ["SELECT id,ABS(u) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,18446744073709552000]],3,1],
    ["SELECT id,ABS(u) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,18446744073709552000],[3,null]],3,1],
    ["SELECT id,ABS(u) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,1],
    ["SELECT id,ABS(m) AS x FROM t ORDER BY id",[[1,"2.1250"],[2,"2.1250"],[3,null],[4,"0.0000"]],4,1],
    ["SELECT id,ABS(m) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4,1],
    ["SELECT id,ABS(m) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"2.1250"]],4,1],
    ["SELECT id,ABS(m) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,"2.1250"],[3,null]],4,1],
    ["SELECT id,ABS(m) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4,1],
    ["SELECT id,ABS(d) AS x FROM t ORDER BY id",[[1,2.125],[2,0],[3,null],[4,0]],5,1],
    ["SELECT id,ABS(d) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],5,1],
    ["SELECT id,ABS(d) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],5,1],
    ["SELECT id,ABS(d) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,0],[3,null]],5,1],
    ["SELECT id,ABS(d) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],5,1],
    ["SELECT id,ABS(f) AS x FROM t ORDER BY id",[[1,2.125],[2,0],[3,null],[4,0]],6,1],
    ["SELECT id,ABS(f) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],6,1],
    ["SELECT id,ABS(f) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],6,1],
    ["SELECT id,ABS(f) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,0],[3,null]],6,1],
    ["SELECT id,ABS(f) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],6,1],
    ["SELECT id,ABS(v) AS x FROM t ORDER BY id",[[1,2],[2,1],[3,null],[4,0]],5,6],
    ["SELECT id,ABS(v) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],5,1],
    ["SELECT id,ABS(v) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],5,7],
    ["SELECT id,ABS(v) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,1],[3,null]],5,7],
    ["SELECT id,ABS(v) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],5,1],
    ["SELECT id,ABS(b) AS x FROM t ORDER BY id",[[1,2],[2,1],[3,null],[4,0]],5,6],
    ["SELECT id,ABS(b) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],5,1],
    ["SELECT id,ABS(b) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],5,7],
    ["SELECT id,ABS(b) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,1],[3,null]],5,7],
    ["SELECT id,ABS(b) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],5,1],
    ["SELECT id,ABS(bt) AS x FROM t ORDER BY id",[[1,128],[2,1],[3,null],[4,0]],7,1],
    ["SELECT id,ABS(bt) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],7,1],
    ["SELECT id,ABS(bt) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],7,1],
    ["SELECT id,ABS(bt) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,1],[3,null]],7,1],
    ["SELECT id,ABS(bt) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],7,1],
    ["SELECT id,ABS(-2) AS x FROM t ORDER BY id",[[1,2],[2,2],[3,2],[4,2]],8,1],
    ["SELECT id,ABS(-2) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],8,1],
    ["SELECT id,ABS(-2) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2]],8,1],
    ["SELECT id,ABS(-2) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,2],[3,2]],8,1],
    ["SELECT id,ABS(-2) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],8,1],
    ["SELECT id,ABS(2) AS x FROM t ORDER BY id",[[1,2],[2,2],[3,2],[4,2]],8,1],
    ["SELECT id,ABS(2) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],8,1],
    ["SELECT id,ABS(2) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2]],8,1],
    ["SELECT id,ABS(2) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,2],[3,2]],8,1],
    ["SELECT id,ABS(2) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],8,1],
    ["SELECT id,ABS(-2.125) AS x FROM t ORDER BY id",[[1,"2.125"],[2,"2.125"],[3,"2.125"],[4,"2.125"]],9,1],
    ["SELECT id,ABS(-2.125) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],9,1],
    ["SELECT id,ABS(-2.125) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"2.125"]],9,1],
    ["SELECT id,ABS(-2.125) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,"2.125"],[3,"2.125"]],9,1],
    ["SELECT id,ABS(-2.125) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],9,1],
    ["SELECT id,ABS(-0e0) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0],[4,0]],10,1],
    ["SELECT id,ABS(-0e0) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],10,1],
    ["SELECT id,ABS(-0e0) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],10,1],
    ["SELECT id,ABS(-0e0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,0],[3,0]],10,1],
    ["SELECT id,ABS(-0e0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],10,1],
    ["SELECT id,ABS(0e0) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0],[4,0]],10,1],
    ["SELECT id,ABS(0e0) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],10,1],
    ["SELECT id,ABS(0e0) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],10,1],
    ["SELECT id,ABS(0e0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,0],[3,0]],10,1],
    ["SELECT id,ABS(0e0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],10,1],
    ["SELECT id,ABS(X'FF') AS x FROM t ORDER BY id",[[1,255],[2,255],[3,255],[4,255]],11,1],
    ["SELECT id,ABS(X'FF') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],11,1],
    ["SELECT id,ABS(X'FF') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,255]],11,1],
    ["SELECT id,ABS(X'FF') AS x FROM t ORDER BY id LIMIT 2 OFFSET 1",[[2,255],[3,255]],11,1],
    ["SELECT id,ABS(X'FF') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],11,1],
  ]
  try {
    await conn.query('CREATE DATABASE abs_control')
    await conn.query('USE abs_control')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,i BIGINT,u BIGINT UNSIGNED,m DECIMAL(12,4),d DOUBLE,f FLOAT(12,4),v VARCHAR(8),b VARBINARY(8),bt BIT(8))')
    await conn.query("INSERT INTO t VALUES(1,2,3,2.1250,2.125,2.125,'2x',X'3278',b'10000000'),(2,-2,18446744073709551615,-2.1250,CAST('-0.0' AS DOUBLE),CAST('-0.0' AS DOUBLE),'-1x',X'2D3178',b'00000001'),(3,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(4,0,0,0,0,0,'0',X'30',b'00000000')")
    await verify(conn, fixtures)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS abs_control')
    await conn.end()
    await db?.end()
  }
})

test('prepared ABS JSON source reads retain DOUBLE metadata and fresh values after writes', async () => {
  const { db, conn } = await connect()
  const fixtures: { j: string | null; method: 'query' | 'execute' | 'statement'; rows: unknown; fields: unknown[][]; warnings: unknown[] }[] = [{"j":"[]","method":"query","rows":[[2,0]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"j":"[]","method":"execute","rows":[[2,0]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"j":"[]","method":"statement","rows":[{"id":2,"x":0}],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"j":"\"-1x\"","method":"query","rows":[[2,1]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"j":"\"-1x\"","method":"execute","rows":[[2,1]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"j":"\"-1x\"","method":"statement","rows":[{"id":2,"x":1}],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}]},{"j":"-0.0","method":"query","rows":[[2,0]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"-0.0","method":"execute","rows":[[2,0]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"-0.0","method":"statement","rows":[{"id":2,"x":0}],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"-2.5","method":"query","rows":[[2,2.5]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"-2.5","method":"execute","rows":[[2,2.5]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"-2.5","method":"statement","rows":[{"id":2,"x":2.5}],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"18446744073709551615","method":"query","rows":[[2,18446744073709552000]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"18446744073709551615","method":"execute","rows":[[2,18446744073709552000]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":"18446744073709551615","method":"statement","rows":[{"id":2,"x":18446744073709552000}],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":null,"method":"query","rows":[[2,null]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":null,"method":"execute","rows":[[2,null]],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]},{"j":null,"method":"statement","rows":[{"id":2,"x":null}],"fields":[["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],"warnings":[]}]
  try {
    await conn.query('CREATE DATABASE abs_fresh')
    await conn.query('USE abs_fresh')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,j JSON)')
    await conn.query("INSERT INTO t VALUES(1,'[]'),(2,'[]'),(3,'true')")
    const options = { sql: 'SELECT id,ABS(j) AS x FROM t ORDER BY id LIMIT ? OFFSET ?', rowsAsArray: true }
    const statement = await conn.prepare(options)
    try {
      const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
      assert.deepEqual(fields(columns), [["id",3,11,20483,0,63,"abs_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]], 'PREPARE metadata')
      for (const fixture of fixtures) {
        await conn.query('UPDATE t SET j=? WHERE id=2', [fixture.j])
        const [rows, columns] = fixture.method === 'statement' ? await statement.execute([1, 1])
          : fixture.method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
        assert.deepEqual(rows, fixture.rows, fixture.method + ': fresh ABS values')
        assert.deepEqual(fields(columns), fixture.fields, fixture.method + ': fresh fields')
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings, fixture.method + ': fresh diagnostics')
      }
    } finally {
      await statement.close()
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS abs_fresh')
    await conn.end()
    await db?.end()
  }
})
