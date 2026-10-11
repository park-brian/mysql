// M5.10: JSON numeric diagnostics retain the shared reader's numeric kind.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', timezone: 'Z' }
    : { stream: db.createStream(), user: 'root', timezone: 'Z' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

type Fixture = [string, 'query' | 'execute', unknown[][], number, number]
const layouts: unknown[][][] = [[["id",3,11,20483,0,63,"json_numeric","t","t","id"],["x",8,21,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_numeric","t","t","id"],["x",8,21,160,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_numeric","t","t","id"],["x",5,23,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"json_numeric","t","t","id"],["x",8,1,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_integer","t","t","id"],["x",253,12,0,31,224,"","","",""]],[["id",3,11,20483,0,63,"json_integer","t","t","id"],["x",253,4,0,31,224,"","","",""]],[["id",3,11,20483,0,63,"json_integer","t","t","id"],["x",253,4,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"json_integer","t","t","id"],["x",10,10,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_integer","t","t","id"],["x",8,21,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_integer","t","t","id"],["x",8,21,160,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["CAST(j AS DECIMAL(10,2))",246,12,128,2,63,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["CAST(j AS SIGNED)+CAST(v AS SIGNED)",8,22,128,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["CAST(j AS UNSIGNED)",8,21,160,0,63,"","","",""],["CAST(v AS UNSIGNED)",8,21,160,0,63,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["CAST(j AS DOUBLE)+CAST(v AS DOUBLE)",5,23,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2))",246,13,128,2,63,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["LEFT('abc',j)",253,12,0,31,224,"","","",""]],[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["CAST(v AS SIGNED)",8,21,128,0,63,"","","",""],["CAST(v AS UNSIGNED)",8,21,160,0,63,"","","",""],["CAST(v AS DOUBLE)",5,23,128,31,63,"","","",""],["CAST(v AS DECIMAL(10,2))",246,12,128,2,63,"","","",""]]]
const diagnostics: unknown[][] = [[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 7"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 8"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 9"}],[],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 2"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 7"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 8"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 9"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 2"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 3"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 2"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 2"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '3x'"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 2"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '3x'"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 2"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1x'"}],[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1x'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1x'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1x'"}]]

async function verify(conn: mysql.Connection, fixtures: Fixture[]) {
  for (const [sql, method, expected, layout, diagnostic] of fixtures) {
    const options = { sql, rowsAsArray: true }
    const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
    // Preserve complete native Buffer bytes and UTC dates in JSON-literal fixtures.
    const values = (rows as unknown[][]).map(row => row.map(value => Buffer.isBuffer(value) ? value.toJSON() : value instanceof Date ? value.toISOString() : value))
    assert.deepEqual(values, expected, method + ': rows: ' + sql)
    assert.deepEqual(fields(columns), layouts[layout], method + ': fields: ' + sql)
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], diagnostics[diagnostic], method + ': diagnostics: ' + sql)
    conn.unprepare(options)
  }
}

test('JSON signed/unsigned casts retain native INTEGER diagnostics through LIMIT/OFFSET', async () => {
  const { db, conn } = await connect()
  // Whole ABS, DIV and large DECIMAL groups remain separate value/metadata/error gaps.
  const fixtures: Fixture[] = [
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,-1],[12,2]],0,0],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,-1],[12,2]],0,0],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],0,1],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],0,1],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],0,2],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],0,2],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],0,3],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],0,3],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],0,1],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],0,1],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,18446744073709552000],[11,18446744073709552000],[12,2]],1,0],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,18446744073709552000],[11,18446744073709552000],[12,2]],1,0],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],1,1],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],1,1],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],1,2],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],1,2],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],1,3],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],1,3],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],1,1],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],1,1],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,CAST(j AS DOUBLE) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,j+0 AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,j+0 AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,j+0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,0+j AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,0+j AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,0+j AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,j*1 AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,j*1 AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1.5]],2,4],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,j*1 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,0],[6,0],[7,1],[8,0],[9,0],[10,-0],[11,0],[12,1.5]],2,4],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,0],[6,0],[7,1],[8,0],[9,0],[10,-0],[11,0],[12,1.5]],2,4],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,j MOD 2 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,2]],2,4],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,2]],2,4],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,CEIL(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1]],2,4],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,10],[6,10],[7,1],[8,0],[9,0],[10,-2],[11,18446744073709552000],[12,1]],2,4],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],2,1],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],2,1],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],2,5],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],2,5],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],2,6],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],2,6],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],2,1],
    ["SELECT id,FLOOR(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],2,1],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,1],[4,0],[5,1],[6,1],[7,1],[8,0],[9,0],[10,-1],[11,1],[12,1]],0,4],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,1],[4,0],[5,1],[6,1],[7,1],[8,0],[9,0],[10,-1],[11,1],[12,1]],0,4],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],0,1],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],0,1],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,1]],0,5],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,1]],0,5],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],0,6],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],0,6],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],0,1],
    ["SELECT id,SIGN(j) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],0,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0]],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0]],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,0]],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,0]],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],3,1],
    ["SELECT id,j=0 AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id","query",[[1,null],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0]],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id","execute",[[1,null],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0]],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","query",[[7,0]],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 1 OFFSET 6","execute",[[7,0]],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","query",[[8,0],[9,0]],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 7","execute",[[8,0],[9,0]],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","query",[],3,1],
    ["SELECT id,j IN(0) AS x FROM t ORDER BY id LIMIT 2 OFFSET 20","execute",[],3,1],
  ]
  try {
    await conn.query('CREATE DATABASE json_numeric')
    await conn.query('USE json_numeric')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,j JSON)')
    const values = [null, 'null', 'true', 'false', '10', '"10"', '"1x"', '[]', '{}', '-2', '18446744073709551615', '1.5']
    for (const [i, value] of values.entries()) await conn.query('INSERT INTO t VALUES(?,?)', [i + 1, value])
    await verify(conn, fixtures)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS json_numeric')
    await conn.end()
    await db?.end()
  }
})

test('integer-consuming functions and CAST synonyms report INTEGER for JSON conversions', async () => {
  const { db, conn } = await connect()
  // BETWEEN has a separate PREPARE/EXECUTE warning-lifetime mismatch; its whole group is excluded.
  const fixtures: Fixture[] = [
    ["SELECT id,LEFT('abc',j) AS x FROM t ORDER BY id","query",[[1,""],[2,"a"],[3,""]],4,7],
    ["SELECT id,LEFT('abc',j) AS x FROM t ORDER BY id","execute",[[1,""],[2,"a"],[3,""]],4,7],
    ["SELECT id,RIGHT('abc',j) AS x FROM t ORDER BY id","query",[[1,""],[2,"c"],[3,""]],4,7],
    ["SELECT id,RIGHT('abc',j) AS x FROM t ORDER BY id","execute",[[1,""],[2,"c"],[3,""]],4,7],
    ["SELECT id,SUBSTRING('abc',j) AS x FROM t ORDER BY id","query",[[1,""],[2,"abc"],[3,""]],4,7],
    ["SELECT id,SUBSTRING('abc',j) AS x FROM t ORDER BY id","execute",[[1,""],[2,"abc"],[3,""]],4,7],
    ["SELECT id,ELT(j,'a','b') AS x FROM t ORDER BY id","query",[[1,null],[2,"a"],[3,null]],5,7],
    ["SELECT id,ELT(j,'a','b') AS x FROM t ORDER BY id","execute",[[1,null],[2,"a"],[3,null]],5,7],
    ["SELECT id,CHAR(j) AS x FROM t ORDER BY id","query",[[1,{"type":"Buffer","data":[0]}],[2,{"type":"Buffer","data":[1]}],[3,{"type":"Buffer","data":[0]}]],6,7],
    ["SELECT id,CHAR(j) AS x FROM t ORDER BY id","execute",[[1,{"type":"Buffer","data":[0]}],[2,{"type":"Buffer","data":[1]}],[3,{"type":"Buffer","data":[0]}]],6,7],
    ["SELECT id,MAKEDATE(2020,j) AS x FROM t ORDER BY id","query",[[1,null],[2,"2020-01-01T00:00:00.000Z"],[3,null]],7,7],
    ["SELECT id,MAKEDATE(2020,j) AS x FROM t ORDER BY id","execute",[[1,null],[2,"2020-01-01T00:00:00.000Z"],[3,null]],7,7],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id","query",[[1,0],[2,1],[3,0]],8,7],
    ["SELECT id,CAST(j AS SIGNED) AS x FROM t ORDER BY id","execute",[[1,0],[2,1],[3,0]],8,7],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id","query",[[1,0],[2,1],[3,0]],9,7],
    ["SELECT id,CAST(j AS UNSIGNED) AS x FROM t ORDER BY id","execute",[[1,0],[2,1],[3,0]],9,7],
    ["SELECT id,CAST(j AS SIGNED INTEGER) AS x FROM t ORDER BY id","query",[[1,0],[2,1],[3,0]],8,7],
    ["SELECT id,CAST(j AS SIGNED INTEGER) AS x FROM t ORDER BY id","execute",[[1,0],[2,1],[3,0]],8,7],
    ["SELECT id,CAST(j AS UNSIGNED INTEGER) AS x FROM t ORDER BY id","query",[[1,0],[2,1],[3,0]],9,7],
    ["SELECT id,CAST(j AS UNSIGNED INTEGER) AS x FROM t ORDER BY id","execute",[[1,0],[2,1],[3,0]],9,7],
  ]
  try {
    await conn.query('CREATE DATABASE json_integer')
    await conn.query('USE json_integer')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,j JSON)')
    await conn.query("INSERT INTO t VALUES(1,'[]'),(2,'\"1x\"'),(3,'null')")
    await verify(conn, fixtures)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS json_integer')
    await conn.end()
    await db?.end()
  }
})

test('fresh prepared JSON numeric reads preserve kinds, column names and non-JSON diagnostics', async () => {
  const { db, conn } = await connect()
  const fresh: { j: string | null; method: 'query' | 'execute' | 'statement'; rows: unknown; fields: unknown[][]; warnings: unknown[] }[] = [{"j":"[]","method":"query","rows":[[2,0,0,0,"0.00"]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}]},{"j":"[]","method":"execute","rows":[[2,0,0,0,"0.00"]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}]},{"j":"[]","method":"statement","rows":[{"id":2,"s":0,"u":0,"d":0,"m":"0.00"}],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}]},{"j":"\"1x\"","method":"query","rows":[[2,1,1,1,"1.00"]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}]},{"j":"\"1x\"","method":"execute","rows":[[2,1,1,1,"1.00"]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}]},{"j":"\"1x\"","method":"statement","rows":[{"id":2,"s":1,"u":1,"d":1,"m":"1.00"}],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to INTEGER from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DOUBLE from column j at row 1"},{"Level":"Warning","Code":3156,"Message":"Invalid JSON value for CAST to DECIMAL from column j at row 1"}]},{"j":"7","method":"query","rows":[[2,7,7,7,"7.00"]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[]},{"j":"7","method":"execute","rows":[[2,7,7,7,"7.00"]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[]},{"j":"7","method":"statement","rows":[{"id":2,"s":7,"u":7,"d":7,"m":"7.00"}],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[]},{"j":null,"method":"query","rows":[[2,null,null,null,null]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[]},{"j":null,"method":"execute","rows":[[2,null,null,null,null]],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[]},{"j":null,"method":"statement","rows":[{"id":2,"s":null,"u":null,"d":null,"m":null}],"fields":[["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]],"warnings":[]}]
  const controls: Fixture[] = [
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id","query",[[1,"0.00"],[2,"0.00"],[3,"1.00"]],10,8],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id","execute",[[1,"0.00"],[2,"0.00"],[3,"1.00"]],10,8],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],10,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],10,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,"0.00"]],10,9],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,"0.00"]],10,9],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,"0.00"],[3,"1.00"]],10,9],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,"0.00"],[3,"1.00"]],10,9],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],10,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],10,1],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id","query",[[1,3],[2,1],[3,null]],11,10],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id","execute",[[1,3],[2,1],[3,null]],11,10],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],11,1],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],11,1],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,1]],11,11],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,1]],11,11],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,1],[3,null]],11,11],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,1],[3,null]],11,11],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],11,1],
    ["SELECT id,CAST(j AS SIGNED)+CAST(v AS SIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],11,1],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id","query",[[1,0,3],[2,0,1],[3,1,null]],12,10],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id","execute",[[1,0,3],[2,0,1],[3,1,null]],12,10],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],12,1],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],12,1],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,0,1]],12,11],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,0,1]],12,11],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,0,1],[3,1,null]],12,11],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,0,1],[3,1,null]],12,11],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],12,1],
    ["SELECT id,CAST(j AS UNSIGNED),CAST(v AS UNSIGNED) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],12,1],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id","query",[[1,3],[2,1],[3,null]],13,12],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id","execute",[[1,3],[2,1],[3,null]],13,12],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],13,1],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],13,1],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,1]],13,13],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,1]],13,13],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,1],[3,null]],13,13],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,1],[3,null]],13,13],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],13,1],
    ["SELECT id,CAST(j AS DOUBLE)+CAST(v AS DOUBLE) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],13,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id","query",[[1,"3.00"],[2,"1.00"],[3,null]],14,14],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id","execute",[[1,"3.00"],[2,"1.00"],[3,null]],14,14],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],14,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],14,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,"1.00"]],14,15],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,"1.00"]],14,15],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,"1.00"],[3,null]],14,15],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,"1.00"],[3,null]],14,15],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],14,1],
    ["SELECT id,CAST(j AS DECIMAL(10,2))+CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],14,1],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id","query",[[1,""],[2,""],[3,"a"]],15,3],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id","execute",[[1,""],[2,""],[3,"a"]],15,3],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],15,1],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],15,1],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,""]],15,2],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,""]],15,2],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,""],[3,"a"]],15,2],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,""],[3,"a"]],15,2],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],15,1],
    ["SELECT id,LEFT('abc',j) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],15,1],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id","query",[[1,3,3,3,"3.00"],[2,1,1,1,"1.00"],[3,null,null,null,null]],16,16],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id","execute",[[1,3,3,3,"3.00"],[2,1,1,1,"1.00"],[3,null,null,null,null]],16,16],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 0 OFFSET 1","query",[],16,1],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 0 OFFSET 1","execute",[],16,1],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 1 OFFSET 1","query",[[2,1,1,1,"1.00"]],16,17],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 1 OFFSET 1","execute",[[2,1,1,1,"1.00"]],16,17],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 1","query",[[2,1,1,1,"1.00"],[3,null,null,null,null]],16,17],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 1","execute",[[2,1,1,1,"1.00"],[3,null,null,null,null]],16,17],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 8","query",[],16,1],
    ["SELECT id,CAST(v AS SIGNED),CAST(v AS UNSIGNED),CAST(v AS DOUBLE),CAST(v AS DECIMAL(10,2)) FROM t ORDER BY id LIMIT 2 OFFSET 8","execute",[],16,1],
  ]
  try {
    await conn.query('CREATE DATABASE json_diagnostic')
    await conn.query('USE json_diagnostic')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,j JSON,v VARCHAR(8))')
    await conn.query("INSERT INTO t VALUES(1,'[]','3x'),(2,'[]','1x'),(3,'true',NULL)")
    const options = { sql: 'SELECT id,CAST(j AS SIGNED) AS s,CAST(j AS UNSIGNED) AS u,CAST(j AS DOUBLE) AS d,CAST(j AS DECIMAL(10,2)) AS m FROM t ORDER BY id LIMIT ? OFFSET ?', rowsAsArray: true }
    const statement = await conn.prepare(options)
    try {
      const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
      assert.deepEqual(fields(columns), [["id",3,11,20483,0,63,"json_diagnostic","t","t","id"],["s",8,21,128,0,63,"","","",""],["u",8,21,160,0,63,"","","",""],["d",5,23,128,31,63,"","","",""],["m",246,12,128,2,63,"","","",""]], 'PREPARE metadata')
      for (const fixture of fresh) {
        await conn.query('UPDATE t SET j=? WHERE id=2', [fixture.j])
        const [rows, columns] = fixture.method === 'statement' ? await statement.execute([1, 1])
          : fixture.method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
        assert.deepEqual(rows, fixture.rows, fixture.method + ': fresh JSON values')
        assert.deepEqual(fields(columns), fixture.fields, fixture.method + ': fresh fields')
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings, fixture.method + ': fresh warnings')
      }
    } finally {
      await statement.close()
      conn.unprepare(options)
    }
    await conn.query("UPDATE t SET j='[]' WHERE id=2")
    await verify(conn, controls)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS json_diagnostic')
    await conn.end()
    await db?.end()
  }
})
