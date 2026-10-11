// Complete pinned MySQL 8.4.11 outcomes; long-value reading and overflow stay open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const o0 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o1 = [[["123"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o2 = [[["18446744073709552000"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o3 = [[["1230"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o4 = [[["1235"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o5 = [[["1"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o6 = [[["-1"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o7 = [[["1231"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o8 = [[["1232"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o9 = [[["1233"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o10 = [[["1234"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o11 = [[["1236"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o12 = [[["1237"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o13 = [[["1238"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o14 = [[["1239"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o15 = [[["x",246,66,129,0,63,"","","",""]],[]]
const o16 = [[{"x":"0"}],[["x",246,66,129,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o17 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o18 = [[{"x":"0"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o19 = [[{"x":"123"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o20 = [[{"x":"1"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o21 = [[{"x":"18446744073709552000"}],[["x",246,66,129,0,63,"","","",""]],[]]

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

async function outcome(conn: mysql.Connection, sql: string, method: 'query' | 'execute') {
  const options = { sql, rowsAsArray: true }
  const [rows, columns] = await (method === 'query' ? conn.query(options) : conn.execute(options))
  const warnings = (await conn.query('SHOW WARNINGS'))[0]
  return [rows, fields(columns as mysql.FieldPacket[]), warnings]
}

test('IFNULL and COALESCE DECIMAL results retain function prefix diagnostics and numeric merging', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x","123.45e1x",".5x","-0.5x","123\u0000x","123x","123x","00000000000000000000000000000000000000000000000000000000000000000000000000000000123x","000000000000000000000000000000000000000000000000000000000000000000000000000000000123x","0000000000000000000000000000000000000000000000000000000000000000000000000000000000123x","0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x","00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",null,"abc1","+x1",".x1","--1","NaN1"]
  const sources = ["IFNULL(b,'123x')","IFNULL('123x',b)","IFNULL(CONCAT(b),'123x')","IFNULL(v,'123x')","COALESCE(b,'123x')","COALESCE(NULL,b,'123x')","COALESCE(CONCAT(b),'123x')","COALESCE(v,b,'123x')","IFNULL(IF(g=1,b,'123x'),'123x')","COALESCE(CASE g WHEN 1 THEN b END,'123x')","IFNULL(18446744073709551615,0e0)","COALESCE(NULL,18446744073709551615,0e0)"]
  const expected: unknown[][][] = [
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o3,o1,o3,o3,o3,o3,o3,o3,o3,o3,o2,o2],
    [o4,o1,o4,o4,o4,o4,o4,o4,o4,o4,o2,o2],
    [o5,o1,o5,o5,o5,o5,o5,o5,o5,o5,o2,o2],
    [o6,o1,o6,o6,o6,o6,o6,o6,o6,o6,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
    [o0,o1,o0,o0,o0,o0,o0,o0,o0,o0,o2,o2],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nullchoices63')
    await conn.query('USE decimal_nullchoices63')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(12000),g INT DEFAULT 1)')
    for (const [id, value] of values.entries()) await conn.query('INSERT INTO t(id,b,v) VALUES(?,?,?)', [id,value === null ? null : Buffer.from(value),value === null ? null : Buffer.from(value)])
    for (const [id, row] of expected.entries()) for (const [i, result] of row.entries()) {
      const sql = `SELECT CAST(${sources[i]} AS DECIMAL(65,0)) AS x FROM t WHERE id=${id}`
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),result,method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_nullchoices63')
    await conn.end()
    await db?.end()
  }
})

test('null-choice DECIMAL prefixes preserve all 256 trailing bytes through columns and nested choices', async () => {
  const { db, conn } = await connect()
  const sources = ["IFNULL(b,'123x')","IFNULL(v,'123x')","IFNULL(CONCAT(b),'123x')","COALESCE(b,'123x')","COALESCE(NULL,b,'123x')","COALESCE(v,b,'123x')","IFNULL(IF(TRUE,b,'123x'),'123x')","COALESCE(CASE WHEN TRUE THEN b END,'123x')"]
  const expected = [
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o3,o7,o8,o9,o10,o4,o11,o12,o13,o14,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nullbytes63')
    await conn.query('USE decimal_nullbytes63')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (let byte=0;byte<256;byte++) await conn.query('INSERT INTO t VALUES(?,?,?)',[byte,Buffer.from([0x31,0x32,0x33,byte]),Buffer.from([0x31,0x32,0x33,byte])])
    for (let byte=0;byte<256;byte++) for (const source of sources) {
      const sql = `SELECT CAST(${source} AS DECIMAL(65,0)) AS x FROM t WHERE id=${byte}`
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[byte],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_nullbytes63')
    await conn.end()
    await db?.end()
  }
})

test('null-choice DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(IFNULL(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(IFNULL('123x',b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o1,o19],
      [" ",o1,o19],
      ["abc1",o1,o19],
      ["0x",o1,o19],
      ["123x",o1,o19],
      [".5x",o1,o19],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(IFNULL(CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(COALESCE(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(COALESCE(NULL,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(IFNULL(IF(g=1,b,'123x'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(COALESCE(CASE g WHEN 1 THEN b END,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["VARBINARY(60000)","SELECT CAST(COALESCE(NULL,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o2,o21],
      [" ",o2,o21],
      ["abc1",o2,o21],
      ["0x",o2,o21],
      ["123x",o2,o21],
      [".5x",o2,o21],
      [null,o2,o21],
    ]],
    ["BLOB","SELECT CAST(IFNULL(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(IFNULL('123x',b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o1,o19],
      [" ",o1,o19],
      ["abc1",o1,o19],
      ["0x",o1,o19],
      ["123x",o1,o19],
      [".5x",o1,o19],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(IFNULL(CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(COALESCE(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(COALESCE(NULL,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(IFNULL(IF(g=1,b,'123x'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(COALESCE(CASE g WHEN 1 THEN b END,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["BLOB","SELECT CAST(COALESCE(NULL,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o2,o21],
      [" ",o2,o21],
      ["abc1",o2,o21],
      ["0x",o2,o21],
      ["123x",o2,o21],
      [".5x",o2,o21],
      [null,o2,o21],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IFNULL(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IFNULL('123x',b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o1,o19],
      [" ",o1,o19],
      ["abc1",o1,o19],
      ["0x",o1,o19],
      ["123x",o1,o19],
      [".5x",o1,o19],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IFNULL(CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(COALESCE(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(COALESCE(NULL,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IFNULL(IF(g=1,b,'123x'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(COALESCE(CASE g WHEN 1 THEN b END,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["MEDIUMBLOB","SELECT CAST(COALESCE(NULL,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o2,o21],
      [" ",o2,o21],
      ["abc1",o2,o21],
      ["0x",o2,o21],
      ["123x",o2,o21],
      [".5x",o2,o21],
      [null,o2,o21],
    ]],
    ["LONGBLOB","SELECT CAST(IFNULL(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(IFNULL('123x',b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o1,o19],
      [" ",o1,o19],
      ["abc1",o1,o19],
      ["0x",o1,o19],
      ["123x",o1,o19],
      [".5x",o1,o19],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(IFNULL(CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(COALESCE(b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(COALESCE(NULL,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(IFNULL(IF(g=1,b,'123x'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(COALESCE(CASE g WHEN 1 THEN b END,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o0,o16],
      [" ",o0,o16],
      ["abc1",o0,o16],
      ["0x",o17,o18],
      ["123x",o1,o19],
      [".5x",o5,o20],
      [null,o1,o19],
    ]],
    ["LONGBLOB","SELECT CAST(COALESCE(NULL,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o15,[
      ["",o2,o21],
      [" ",o2,o21],
      ["abc1",o2,o21],
      ["0x",o2,o21],
      ["123x",o2,o21],
      [".5x",o2,o21],
      [null,o2,o21],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nullfresh63')
    await conn.query('USE decimal_nullfresh63')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_nullfresh63')
    await conn.end()
    await db?.end()
  }
})
