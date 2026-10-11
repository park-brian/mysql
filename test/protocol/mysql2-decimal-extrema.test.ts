// Complete pinned MySQL 8.4.11 outcomes. Remaining selected UTF8 literal nullability, numeric/temporal/JSON readers, long inputs and overflow gaps stay open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const o0 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o1 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o2 = [[["1230"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o3 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o4 = [[["-1"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o5 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[]]
const o6 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o7 = [[["123"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o8 = [[["1230"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o9 = [[["1"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o10 = [[["-1"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o11 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o12 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o13 = [[["1231"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o14 = [[["1232"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o15 = [[["1233"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o16 = [[["1234"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o17 = [[["1235"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o18 = [[["1236"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o19 = [[["1237"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o20 = [[["1238"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o21 = [[["1239"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o22 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o23 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o24 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o25 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o26 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]]
const o27 = [[["x",246,66,128,0,63,"","","",""]],[]]
const o28 = [[[null]],[["x",6,0,128,0,63,"","","",""]],[]]
const o29 = [[[null]],[["x",246,67,128,2,63,"","","",""]],[]]
const o30 = [[[null]],[["x",8,2,128,0,63,"","","",""]],[]]
const o31 = [[[null]],[["x",253,16,0,31,224,"","","",""]],[]]
const o32 = [[[null]],[["x",5,23,128,31,63,"","","",""]],[]]
const o33 = [[[18446744073709552000]],[["x",8,20,161,0,63,"","","",""]],[]]
const o34 = [[["18446744073709551615.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o35 = [[["18446744073709551615"]],[["x",246,21,129,0,63,"","","",""]],[]]
const o36 = [[["0"]],[["x",246,21,129,0,63,"","","",""]],[]]
const o37 = [[["0.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o38 = [[["18446744073709551615"]],[["x",253,80,1,31,224,"","","",""]],[]]
const o39 = [[[18446744073709552000]],[["x",5,23,129,31,63,"","","",""]],[]]
const o40 = [[[-9223372036854776000]],[["x",8,20,129,0,63,"","","",""]],[]]
const o41 = [[["-9223372036854775808.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o42 = [[[0]],[["x",8,20,129,0,63,"","","",""]],[]]
const o43 = [[["123x"]],[["x",253,80,1,31,224,"","","",""]],[]]
const o44 = [[["123.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o45 = [[[-9223372036854776000]],[["x",5,23,129,31,63,"","","",""]],[]]
const o46 = [[["123.45"]],[["x",246,7,129,2,63,"","","",""]],[]]
const o47 = [[["123.45"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o48 = [[["0.00"]],[["x",246,7,129,2,63,"","","",""]],[]]
const o49 = [[["123x"]],[["x",253,28,1,31,224,"","","",""]],[]]
const o50 = [[[123.45]],[["x",5,23,129,31,63,"","","",""]],[]]
const o51 = [[[123]],[["x",5,23,129,31,63,"","","",""]],[]]
const o52 = [[[0]],[["x",5,23,129,31,63,"","","",""]],[]]
const o53 = [[["123x"]],[["x",253,88,1,31,224,"","","",""]],[]]
const o54 = [[[1e+90]],[["x",5,23,129,31,63,"","","",""]],[]]
const o55 = [[["1e90"]],[["x",253,88,1,31,224,"","","",""]],[]]
const o56 = [[[{"type":"Buffer","data":[53]}]],[["x",253,1,129,31,63,"","","",""]],[]]
const o57 = [[[{"type":"Buffer","data":[53]}]],[["x",253,2,129,31,63,"","","",""]],[]]
const o58 = [[[{"type":"Buffer","data":[48]}]],[["x",253,2,129,31,63,"","","",""]],[]]
const o59 = [[[{"type":"Buffer","data":[53]}]],[["x",253,16,129,31,63,"","","",""]],[]]
const o60 = [[[{"type":"Buffer","data":[53]}]],[["x",253,3,129,31,63,"","","",""]],[]]
const o61 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,4,129,31,63,"","","",""]],[]]
const o62 = [[[{"type":"Buffer","data":[48]}]],[["x",253,4,129,31,63,"","","",""]],[]]
const o63 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,16,129,31,63,"","","",""]],[]]
const o64 = [[["123x"]],[["x",253,16,1,31,224,"","","",""]],[]]
const o65 = [[["0"]],[["x",253,16,1,31,224,"","","",""]],[]]
const o66 = [[["2026-10-11T12:34:56.123Z"]],[["x",12,104,0,6,224,"","","",""]],[]]
const o67 = [[["20261011123456.12"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o68 = [[["2026-10-11 12:34:56.123456"]],[["x",253,104,0,31,224,"","","",""]],[]]
const o69 = [[["12:34:56.123456"]],[["x",11,68,0,6,224,"","","",""]],[]]
const o70 = [[["123456.12"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o71 = [[["12:34:56.123456"]],[["x",253,88,0,31,224,"","","",""]],[]]
const o72 = [[["2026-10-11T00:00:00.000Z"]],[["x",10,40,0,0,224,"","","",""]],[]]
const o73 = [[["20261011.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o74 = [[["2026-10-11"]],[["x",253,88,0,31,224,"","","",""]],[]]
const v0 = [o0,o0,o0,o1,o1,o2,o3,o4,o5,o0]
const v1 = [o6,o6,o6,o7,o7,o8,o9,o10,o5,o6]
const v2 = [o11,o11,o0,o1,o1,o2,o11,o11,o5,o0]
const v3 = [o12,o12,o6,o7,o7,o8,o12,o12,o5,o6]
const v4 = [o0,o0,o11,o11,o11,o11,o3,o4,o5,o11]
const v5 = [o6,o6,o12,o12,o12,o12,o9,o10,o5,o12]
const v6 = [o1,o1,o1,o1,o11,o1,o1,o1]
const v7 = [o2,o2,o2,o2,o11,o2,o2,o2]
const v8 = [o13,o13,o13,o13,o11,o13,o13,o13]
const v9 = [o14,o14,o14,o14,o11,o14,o14,o14]
const v10 = [o15,o15,o15,o15,o11,o15,o15,o15]
const v11 = [o16,o16,o16,o16,o11,o16,o16,o16]
const v12 = [o17,o17,o17,o17,o11,o17,o17,o17]
const v13 = [o18,o18,o18,o18,o11,o18,o18,o18]
const v14 = [o19,o19,o19,o19,o11,o19,o19,o19]
const v15 = [o20,o20,o20,o20,o11,o20,o20,o20]
const v16 = [o21,o21,o21,o21,o11,o21,o21,o21]
const f0: [string | null, unknown[], unknown[]][] = [
      ["",o0,o22],
      [" ",o0,o22],
      ["abc1",o0,o22],
      ["0x",o11,o23],
      ["123x",o1,o24],
      [".5x",o3,o25],
      [null,o5,o26],
]
const f1: [string | null, unknown[], unknown[]][] = [
      ["",o11,o23],
      [" ",o11,o23],
      ["abc1",o0,o22],
      ["0x",o11,o23],
      ["123x",o1,o24],
      [".5x",o11,o23],
      [null,o5,o26],
]
const f2: [string | null, unknown[], unknown[]][] = [
      ["",o0,o22],
      [" ",o0,o22],
      ["abc1",o11,o23],
      ["0x",o11,o23],
      ["123x",o11,o23],
      [".5x",o3,o25],
      [null,o5,o26],
]

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', timezone: 'Z', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', timezone: 'Z' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

async function outcome(conn: mysql.Connection, sql: string, method: 'query' | 'execute') {
  const options = { sql, rowsAsArray: true }
  try {
    const [rows, columns] = await (method === 'query' ? conn.query(options) : conn.execute(options))
    const warnings = (await conn.query('SHOW WARNINGS'))[0]
    return [JSON.parse(JSON.stringify(rows)), fields(columns as mysql.FieldPacket[]), warnings]
  } catch (caught) {
    const error = caught as { errno: number; sqlState: string; message: string }
    return { error: [error.errno, error.sqlState, error.message] }
  }
}

test('GREATEST/LEAST string results own string DECIMAL prefix diagnostics across sources and nested selection boundaries', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x",".5x","-0.5x",null,"abc1"]
  const fixtures: [string, string[], number[], unknown[]][] = [
    ["GREATEST(b,_binary'')",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["GREATEST(b,_binary'')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["LEAST(b,b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["LEAST(b,b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["GREATEST(b,0)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["GREATEST(b,0)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
    ["LEAST(b,0)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v4],
    ["LEAST(b,0)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v5],
    ["GREATEST(CONCAT(b),_binary'')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["GREATEST(IF(g=1,b,'123x'),_binary'')",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["GREATEST(IF(g=1,b,'123x'),_binary'')",["literal"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["LEAST(CASE g WHEN 1 THEN b ELSE '123x' END,b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["LEAST(CASE g WHEN 1 THEN b ELSE '123x' END,b)",["literal"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["IF(g=1,GREATEST(b,_binary''),'123x')",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["IF(g=1,GREATEST(b,_binary''),'123x')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["NULLIF(GREATEST(b,_binary''),_binary'zz')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_extrema68')
    await conn.query('USE decimal_extrema68')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,s MEDIUMTEXT,v VARBINARY(12000),c VARCHAR(12000),g INT DEFAULT 1)')
    for (const [id,value] of values.entries()) await conn.query('INSERT INTO t(id,b,s,v,c) VALUES(?,?,?,?,?)',[id,value === null ? null : Buffer.from(value),value,value === null ? null : Buffer.from(value),value])
    for (const [source,kinds,ids,results] of fixtures) for (const kind of kinds) for (const [i,id] of ids.entries()) {
      const value = values[id]
      const input = kind === 'blob' ? 'b' : kind === 'text' ? 's' : kind === 'varbinary' ? 'v' : kind === 'varchar' ? 'c' : value === null ? 'NULL' : '_' + (kind === 'literal' ? 'binary' : 'utf8mb4') + " X'" + Buffer.from(value as string).toString('hex') + "'"
      const sql = 'SELECT CAST(' + source.replace(/\bb\b/g,input) + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + id
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),results[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_extrema68')
    await conn.end()
    await db?.end()
  }
})

test('GREATEST/LEAST string DECIMAL readers retain every trailing byte through nested choices', async () => {
  const { db, conn } = await connect()
  const sources = ["GREATEST(b,_binary'')","LEAST(b,b)","GREATEST(v,_binary'')","GREATEST(b,0)","LEAST(b,0)","GREATEST(CONCAT(b),_binary'')","GREATEST(IF(TRUE,b,'123x'),_binary'')","IF(TRUE,GREATEST(b,_binary''),'123x')"]
  const expected = [
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
    v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,v6,
  ]
  try {
    await conn.query('CREATE DATABASE decimal_extremabytes68')
    await conn.query('USE decimal_extremabytes68')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (let byte=0;byte<256;byte++) await conn.query('INSERT INTO t VALUES(?,?,?)',[byte,Buffer.from([0x31,0x32,0x33,byte]),Buffer.from([0x31,0x32,0x33,byte])])
    for (let byte=0;byte<256;byte++) for (const [i,source] of sources.entries()) {
      const sql = 'SELECT CAST(' + source + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + byte
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[byte]?.[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_extremabytes68')
    await conn.end()
    await db?.end()
  }
})

test('GREATEST/LEAST string DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(GREATEST(b,_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["VARBINARY(60000)","SELECT CAST(LEAST(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["VARBINARY(60000)","SELECT CAST(GREATEST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f1],
    ["VARBINARY(60000)","SELECT CAST(LEAST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f2],
    ["VARBINARY(60000)","SELECT CAST(GREATEST(CONCAT(b),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["VARBINARY(60000)","SELECT CAST(GREATEST(IF(g=1,b,'123x'),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,GREATEST(b,_binary''),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(GREATEST(b,_binary''),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["BLOB","SELECT CAST(GREATEST(b,_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["BLOB","SELECT CAST(LEAST(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["BLOB","SELECT CAST(GREATEST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f1],
    ["BLOB","SELECT CAST(LEAST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f2],
    ["BLOB","SELECT CAST(GREATEST(CONCAT(b),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["BLOB","SELECT CAST(GREATEST(IF(g=1,b,'123x'),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["BLOB","SELECT CAST(IF(g=1,GREATEST(b,_binary''),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["BLOB","SELECT CAST(NULLIF(GREATEST(b,_binary''),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["MEDIUMBLOB","SELECT CAST(GREATEST(b,_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["MEDIUMBLOB","SELECT CAST(LEAST(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["MEDIUMBLOB","SELECT CAST(GREATEST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f1],
    ["MEDIUMBLOB","SELECT CAST(LEAST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f2],
    ["MEDIUMBLOB","SELECT CAST(GREATEST(CONCAT(b),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["MEDIUMBLOB","SELECT CAST(GREATEST(IF(g=1,b,'123x'),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,GREATEST(b,_binary''),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(GREATEST(b,_binary''),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["LONGBLOB","SELECT CAST(GREATEST(b,_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["LONGBLOB","SELECT CAST(LEAST(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["LONGBLOB","SELECT CAST(GREATEST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f1],
    ["LONGBLOB","SELECT CAST(LEAST(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f2],
    ["LONGBLOB","SELECT CAST(GREATEST(CONCAT(b),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["LONGBLOB","SELECT CAST(GREATEST(IF(g=1,b,'123x'),_binary'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["LONGBLOB","SELECT CAST(IF(g=1,GREATEST(b,_binary''),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
    ["LONGBLOB","SELECT CAST(NULLIF(GREATEST(b,_binary''),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o27,f0],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_extremafresh68')
    await conn.query('USE decimal_extremafresh68')
    for (const [storage, sql, prepare, writes] of fixtures) {
      await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,b ${storage},g INT DEFAULT 1)`)
      await conn.query("INSERT INTO t VALUES(1,'1',1),(2,'1',1),(3,NULL,1)")
      const options = { sql, rowsAsArray: true }
      await conn.query('DO 0')
      const stmt = await conn.prepare(options)
      try {
        const prepared = stmt as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual([fields(prepared.statement.columns), (await conn.query('SHOW WARNINGS'))[0]], prepare)
        for (const [value, expected, objects] of writes) {
          await conn.query('UPDATE t SET b=? WHERE id=2', [value === null ? null : Buffer.from(value)])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [rows, columns] = method === 'statement' ? await stmt.execute([1,1]) : method === 'query' ? await conn.query(options,[1,1]) : await conn.execute(options,[1,1])
            assert.deepEqual([rows, fields(columns), (await conn.query('SHOW WARNINGS'))[0]], method === 'statement' ? objects : expected, storage + ': ' + method + ': ' + sql)
          }
        }
      } finally {
        await stmt.close()
        conn.unprepare(options)
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_extremafresh68')
    await conn.end()
    await db?.end()
  }
})

test('GREATEST/LEAST retain numeric, BIT, HEX and temporal reader controls', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown][] = [
    ["SELECT GREATEST(NULL,NULL) AS x",o28],
    ["SELECT CAST(GREATEST(NULL,NULL) AS DECIMAL(65,2)) AS x",o29],
    ["SELECT LEAST(NULL,NULL) AS x",o28],
    ["SELECT CAST(LEAST(NULL,NULL) AS DECIMAL(65,2)) AS x",o29],
    ["SELECT GREATEST(NULL,0) AS x",o30],
    ["SELECT CAST(GREATEST(NULL,0) AS DECIMAL(65,2)) AS x",o29],
    ["SELECT LEAST(NULL,0) AS x",o30],
    ["SELECT CAST(LEAST(NULL,0) AS DECIMAL(65,2)) AS x",o29],
    ["SELECT GREATEST(NULL,'123x') AS x",o31],
    ["SELECT CAST(GREATEST(NULL,'123x') AS DECIMAL(65,2)) AS x",o29],
    ["SELECT IF(TRUE,GREATEST(NULL,NULL),0e0) AS x",o32],
    ["SELECT CAST(IF(TRUE,GREATEST(NULL,NULL),0e0) AS DECIMAL(65,2)) AS x",o29],
    ["SELECT GREATEST(18446744073709551615,18446744073709551615) AS x",o33],
    ["SELECT CAST(GREATEST(18446744073709551615,18446744073709551615) AS DECIMAL(65,2)) AS x",o34],
    ["SELECT LEAST(18446744073709551615,18446744073709551615) AS x",o33],
    ["SELECT CAST(LEAST(18446744073709551615,18446744073709551615) AS DECIMAL(65,2)) AS x",o34],
    ["SELECT GREATEST(18446744073709551615,0) AS x",o35],
    ["SELECT CAST(GREATEST(18446744073709551615,0) AS DECIMAL(65,2)) AS x",o34],
    ["SELECT LEAST(18446744073709551615,0) AS x",o36],
    ["SELECT CAST(LEAST(18446744073709551615,0) AS DECIMAL(65,2)) AS x",o37],
    ["SELECT GREATEST(18446744073709551615,'123x') AS x",o38],
    ["SELECT CAST(GREATEST(18446744073709551615,'123x') AS DECIMAL(65,2)) AS x",o34],
    ["SELECT IF(TRUE,GREATEST(18446744073709551615,18446744073709551615),0e0) AS x",o39],
    ["SELECT CAST(IF(TRUE,GREATEST(18446744073709551615,18446744073709551615),0e0) AS DECIMAL(65,2)) AS x",o34],
    ["SELECT GREATEST(-9223372036854775808,-9223372036854775808) AS x",o40],
    ["SELECT CAST(GREATEST(-9223372036854775808,-9223372036854775808) AS DECIMAL(65,2)) AS x",o41],
    ["SELECT LEAST(-9223372036854775808,-9223372036854775808) AS x",o40],
    ["SELECT CAST(LEAST(-9223372036854775808,-9223372036854775808) AS DECIMAL(65,2)) AS x",o41],
    ["SELECT GREATEST(-9223372036854775808,0) AS x",o42],
    ["SELECT CAST(GREATEST(-9223372036854775808,0) AS DECIMAL(65,2)) AS x",o37],
    ["SELECT LEAST(-9223372036854775808,0) AS x",o40],
    ["SELECT CAST(LEAST(-9223372036854775808,0) AS DECIMAL(65,2)) AS x",o41],
    ["SELECT GREATEST(-9223372036854775808,'123x') AS x",o43],
    ["SELECT CAST(GREATEST(-9223372036854775808,'123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT IF(TRUE,GREATEST(-9223372036854775808,-9223372036854775808),0e0) AS x",o45],
    ["SELECT CAST(IF(TRUE,GREATEST(-9223372036854775808,-9223372036854775808),0e0) AS DECIMAL(65,2)) AS x",o41],
    ["SELECT GREATEST(123.45,123.45) AS x",o46],
    ["SELECT CAST(GREATEST(123.45,123.45) AS DECIMAL(65,2)) AS x",o47],
    ["SELECT LEAST(123.45,123.45) AS x",o46],
    ["SELECT CAST(LEAST(123.45,123.45) AS DECIMAL(65,2)) AS x",o47],
    ["SELECT GREATEST(123.45,0) AS x",o46],
    ["SELECT CAST(GREATEST(123.45,0) AS DECIMAL(65,2)) AS x",o47],
    ["SELECT LEAST(123.45,0) AS x",o48],
    ["SELECT CAST(LEAST(123.45,0) AS DECIMAL(65,2)) AS x",o37],
    ["SELECT GREATEST(123.45,'123x') AS x",o49],
    ["SELECT CAST(GREATEST(123.45,'123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT IF(TRUE,GREATEST(123.45,123.45),0e0) AS x",o50],
    ["SELECT CAST(IF(TRUE,GREATEST(123.45,123.45),0e0) AS DECIMAL(65,2)) AS x",o47],
    ["SELECT GREATEST(123e0,123e0) AS x",o51],
    ["SELECT CAST(GREATEST(123e0,123e0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT LEAST(123e0,123e0) AS x",o51],
    ["SELECT CAST(LEAST(123e0,123e0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT GREATEST(123e0,0) AS x",o51],
    ["SELECT CAST(GREATEST(123e0,0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT LEAST(123e0,0) AS x",o52],
    ["SELECT CAST(LEAST(123e0,0) AS DECIMAL(65,2)) AS x",o37],
    ["SELECT GREATEST(123e0,'123x') AS x",o53],
    ["SELECT CAST(GREATEST(123e0,'123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT IF(TRUE,GREATEST(123e0,123e0),0e0) AS x",o51],
    ["SELECT CAST(IF(TRUE,GREATEST(123e0,123e0),0e0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT GREATEST(1e90,1e90) AS x",o54],
    ["SELECT LEAST(1e90,1e90) AS x",o54],
    ["SELECT GREATEST(1e90,0) AS x",o54],
    ["SELECT LEAST(1e90,0) AS x",o52],
    ["SELECT GREATEST(1e90,'123x') AS x",o55],
    ["SELECT IF(TRUE,GREATEST(1e90,1e90),0e0) AS x",o54],
    ["SELECT GREATEST(b'00110101',b'00110101') AS x",o56],
    ["SELECT LEAST(b'00110101',b'00110101') AS x",o56],
    ["SELECT GREATEST(b'00110101',0) AS x",o57],
    ["SELECT LEAST(b'00110101',0) AS x",o58],
    ["SELECT GREATEST(b'00110101','123x') AS x",o59],
    ["SELECT IF(TRUE,GREATEST(b'00110101',b'00110101'),0e0) AS x",o60],
    ["SELECT GREATEST(X'31323378',X'31323378') AS x",o61],
    ["SELECT LEAST(X'31323378',X'31323378') AS x",o61],
    ["SELECT GREATEST(X'31323378',0) AS x",o61],
    ["SELECT LEAST(X'31323378',0) AS x",o62],
    ["SELECT GREATEST(X'31323378','123x') AS x",o63],
    ["SELECT IF(TRUE,GREATEST(X'31323378',X'31323378'),0e0) AS x",o61],
    ["SELECT GREATEST(_binary'123x',_binary'123x') AS x",o61],
    ["SELECT CAST(GREATEST(_binary'123x',_binary'123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT LEAST(_binary'123x',_binary'123x') AS x",o61],
    ["SELECT CAST(LEAST(_binary'123x',_binary'123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT GREATEST(_binary'123x',0) AS x",o61],
    ["SELECT CAST(GREATEST(_binary'123x',0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT LEAST(_binary'123x',0) AS x",o62],
    ["SELECT CAST(LEAST(_binary'123x',0) AS DECIMAL(65,2)) AS x",o37],
    ["SELECT GREATEST(_binary'123x','123x') AS x",o63],
    ["SELECT CAST(GREATEST(_binary'123x','123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT IF(TRUE,GREATEST(_binary'123x',_binary'123x'),0e0) AS x",o61],
    ["SELECT CAST(IF(TRUE,GREATEST(_binary'123x',_binary'123x'),0e0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT GREATEST('123x','123x') AS x",o64],
    ["SELECT CAST(GREATEST('123x','123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT LEAST('123x','123x') AS x",o64],
    ["SELECT CAST(LEAST('123x','123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT GREATEST('123x',0) AS x",o64],
    ["SELECT CAST(GREATEST('123x',0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT LEAST('123x',0) AS x",o65],
    ["SELECT CAST(LEAST('123x',0) AS DECIMAL(65,2)) AS x",o37],
    ["SELECT GREATEST('123x','123x') AS x",o64],
    ["SELECT CAST(GREATEST('123x','123x') AS DECIMAL(65,2)) AS x",o44],
    ["SELECT IF(TRUE,GREATEST('123x','123x'),0e0) AS x",o53],
    ["SELECT CAST(IF(TRUE,GREATEST('123x','123x'),0e0) AS DECIMAL(65,2)) AS x",o44],
    ["SELECT GREATEST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))) AS x",o66],
    ["SELECT CAST(GREATEST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))) AS DECIMAL(65,2)) AS x",o67],
    ["SELECT LEAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))) AS x",o66],
    ["SELECT CAST(LEAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))) AS DECIMAL(65,2)) AS x",o67],
    ["SELECT IF(TRUE,GREATEST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))),0e0) AS x",o68],
    ["SELECT CAST(IF(TRUE,GREATEST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))),0e0) AS DECIMAL(65,2)) AS x",o67],
    ["SELECT GREATEST(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))) AS x",o69],
    ["SELECT CAST(GREATEST(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))) AS DECIMAL(65,2)) AS x",o70],
    ["SELECT LEAST(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))) AS x",o69],
    ["SELECT CAST(LEAST(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))) AS DECIMAL(65,2)) AS x",o70],
    ["SELECT IF(TRUE,GREATEST(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))),0e0) AS x",o71],
    ["SELECT CAST(IF(TRUE,GREATEST(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))),0e0) AS DECIMAL(65,2)) AS x",o70],
    ["SELECT GREATEST(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)) AS x",o72],
    ["SELECT CAST(GREATEST(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)) AS DECIMAL(65,2)) AS x",o73],
    ["SELECT LEAST(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)) AS x",o72],
    ["SELECT CAST(LEAST(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)) AS DECIMAL(65,2)) AS x",o73],
    ["SELECT IF(TRUE,GREATEST(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)),0e0) AS x",o74],
    ["SELECT CAST(IF(TRUE,GREATEST(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)),0e0) AS DECIMAL(65,2)) AS x",o73],
  ]
  try {
    for (const [sql,result] of fixtures) {
      for (const method of ['query','execute'] as const) {
        await conn.query('DO 0')
        assert.deepEqual(await outcome(conn,sql,method),result,method + ': ' + sql)
      }
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
