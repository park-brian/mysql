// Pinned MySQL 8.4.11 outcomes; source-specific overflow, long caps and prepare diagnostics remain open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const o0 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o1 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o2 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o3 = [[["1.00"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o4 = [[[null]],[["x",246,12,128,2,63,"","","",""]],[]]
const o5 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o6 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o7 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o8 = [[["123.45"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o9 = [[["123.45"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]
const o10 = [[["1230.00"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o11 = [[["1230.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]
const o12 = [[["1234.50"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o13 = [[["1234.50"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45e1x'"}]]
const o14 = [[["0.50"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o15 = [[["0.50"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o16 = [[["-0.50"]],[["x",246,12,128,2,63,"","","",""]],[]]
const o17 = [[["-0.50"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]
const o18 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123'"}]]
const o19 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o20 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '00000000000000000000000000000000000000000000000000000000000000000000000000000000123x'"}]]
const o21 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '000000000000000000000000000000000000000000000000000000000000000000000000000000000123x'"}]]
const o22 = [[["123.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0000000000000000000000000000000000000000000000000000000000000000000000000000000000123x'"}]]
const o23 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o24 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]]
const o25 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]]
const o26 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '--1'"}]]
const o27 = [[["0.00"]],[["x",246,12,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'NaN1'"}]]
const o28 = [[["18446744073709551615"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o29 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o30 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[],[{"n":0}]]
const o31 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}],[{"n":0}]]
const o32 = [[["0.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}],[{"n":0}]]
const o33 = [[[null]],[["x",246,67,128,2,63,"","","",""]],[],[{"n":0}]]
const o34 = [[[Buffer.from([49,50,51,120])]],[["x",253,20,128,31,63,"","","",""]],[],[{"n":0}]]
const o35 = [[[Buffer.from([97,98,99,49])]],[["x",253,20,128,31,63,"","","",""]],[],[{"n":0}]]
const o36 = [[[null]],[["x",253,20,128,31,63,"","","",""]],[],[{"n":0}]]
const o37 = [[["18446744073709551615.00"]],[["x",246,67,128,2,63,"","","",""]],[],[{"n":0}]]
const o38 = [[["5.00"]],[["x",246,67,128,2,63,"","","",""]],[],[{"n":0}]]
const o39 = [[["0.00"]],[["x",246,67,128,2,63,"","","",""]],[],[{"n":0}]]
const o40 = [[["\u0005"]],[["x",246,9,128,0,63,"","","",""]],[],[{"n":0}]]
const o41 = [[["0"]],[["x",246,9,128,0,63,"","","",""]],[],[{"n":0}]]
const o42 = [[["123x"]],[["x",253,16,0,31,224,"","","",""]],[],[{"n":0}]]
const o43 = [[["abc1"]],[["x",253,16,0,31,224,"","","",""]],[],[{"n":0}]]
const o44 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o45 = [[["0.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}],[{"n":0}]]
const o46 = [[[null]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o47 = [[["0.50"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o48 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}],[{"n":0}]]
const o49 = [[["0.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}],[{"n":0}]]
const o50 = [[["0.50"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}],[{"n":0}]]
const o51 = [[[Buffer.from([49,50,51,120])]],[["x",253,20,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o52 = [[[Buffer.from([97,98,99,49])]],[["x",253,20,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o53 = [[[null]],[["x",253,20,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o54 = [[[Buffer.from([46,53,120])]],[["x",253,20,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}],[{"n":0}]]
const o55 = [[["x",246,66,128,0,63,"","","",""]],[]]
const o56 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o57 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o58 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o59 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o60 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o61 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o62 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]]
const o63 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]]
const o64 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o65 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o66 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o67 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o68 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[]]
const o69 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]]
const o70 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o71 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o72 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o73 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o74 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o75 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o76 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o77 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o78 = [[["x",246,66,129,0,63,"","","",""]],[]]
const o79 = [[{"x":"18446744073709551615"}],[["x",246,66,129,0,63,"","","",""]],[]]

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

test('IF and CASE DECIMAL readers retain selected source diagnostics and exact unsigned integers', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x","123.45e1x",".5x","-0.5x","123\u0000x","123x","123x","00000000000000000000000000000000000000000000000000000000000000000000000000000000123x","000000000000000000000000000000000000000000000000000000000000000000000000000000000123x","0000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",null,"abc1","+x1",".x1","--1","NaN1"]
  const sources = ["IF(g=1,b,'123x')","IF(g=2,b,'123x')","IF(g=1,'123x',b)","IF(g=2,'123x',b)","IF(g=1,CONCAT(b),_binary'123x')","IF(g=2,CONCAT(b),_binary'123x')","IF(g=1,v,_binary'123x')","IF(g=2,v,_binary'123x')","IF(g=1,1,b)","IF(g=2,1,b)","IF(g=1,NULL,b)","IF(g=2,NULL,b)","CASE WHEN g=1 THEN b ELSE '123x' END","CASE WHEN g=2 THEN b ELSE '123x' END","CASE g WHEN 1 THEN b ELSE '123x' END","CASE g WHEN 2 THEN b ELSE '123x' END","CASE WHEN g=1 THEN CONCAT(b) ELSE _binary'123x' END","CASE WHEN g=2 THEN CONCAT(b) ELSE _binary'123x' END","CASE g WHEN 1 THEN v ELSE '123x' END","CASE g WHEN 2 THEN v ELSE '123x' END","CASE WHEN g=1 THEN b END","CASE WHEN g=2 THEN b END","CASE WHEN g=1 THEN 1 ELSE b END","CASE WHEN g=2 THEN 1 ELSE b END","IF(g=1,CONCAT('abc1'),'123x')","IF(g=2,CONCAT('abc1'),'123x')","CASE WHEN g=1 THEN CONCAT('abc1') ELSE '123x' END","CASE WHEN g=2 THEN CONCAT('abc1') ELSE '123x' END"]
  const expected: unknown[][][] = [
    [o0,o1,o1,o0,o0,o1,o2,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o2,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o5,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o5,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o6,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o6,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o1,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o1,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o8,o1,o1,o8,o8,o1,o9,o1,o3,o8,o4,o8,o8,o1,o8,o1,o8,o1,o9,o1,o8,o4,o3,o8,o0,o1,o0,o1],
    [o10,o1,o1,o10,o10,o1,o11,o1,o3,o10,o4,o10,o10,o1,o10,o1,o10,o1,o11,o1,o10,o4,o3,o10,o0,o1,o0,o1],
    [o12,o1,o1,o12,o12,o1,o13,o1,o3,o12,o4,o12,o12,o1,o12,o1,o12,o1,o13,o1,o12,o4,o3,o12,o0,o1,o0,o1],
    [o14,o1,o1,o14,o14,o1,o15,o1,o3,o14,o4,o14,o14,o1,o14,o1,o14,o1,o15,o1,o14,o4,o3,o14,o0,o1,o0,o1],
    [o16,o1,o1,o16,o16,o1,o17,o1,o3,o16,o4,o16,o16,o1,o16,o1,o16,o1,o17,o1,o16,o4,o3,o16,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o18,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o18,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o19,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o19,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o1,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o1,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o20,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o20,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o21,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o21,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o7,o1,o1,o7,o7,o1,o22,o1,o3,o7,o4,o7,o7,o1,o7,o1,o7,o1,o22,o1,o7,o4,o3,o7,o0,o1,o0,o1],
    [o4,o1,o1,o4,o4,o1,o4,o1,o3,o4,o4,o4,o4,o1,o4,o1,o4,o1,o4,o1,o4,o4,o3,o4,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o23,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o23,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o24,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o24,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o25,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o25,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o26,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o26,o1,o0,o4,o3,o0,o0,o1,o0,o1],
    [o0,o1,o1,o0,o0,o1,o27,o1,o3,o0,o4,o0,o0,o1,o0,o1,o0,o1,o27,o1,o0,o4,o3,o0,o0,o1,o0,o1],
  ]
  const wide: [string, unknown[]][] = [
    ["SELECT CAST(IF(g=1,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t WHERE id=0",o28],
    ["SELECT CAST(IF(g=2,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t WHERE id=0",o29],
    ["SELECT CAST(CASE WHEN g=1 THEN 18446744073709551615 ELSE 0e0 END AS DECIMAL(65,0)) AS x FROM t WHERE id=0",o28],
    ["SELECT CAST(CASE g WHEN 1 THEN 18446744073709551615 ELSE 0e0 END AS DECIMAL(65,0)) AS x FROM t WHERE id=0",o28],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_branches62')
    await conn.query('USE decimal_branches62')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,s MEDIUMTEXT,v VARBINARY(12000),c VARCHAR(12000),f BINARY(16),h CHAR(16),g INT NOT NULL DEFAULT 1)')
    for (const [id, value] of values.entries()) await conn.query('INSERT INTO t(id,b,s,v,c,f,h) VALUES(?,?,?,?,?,?,?)', [id, value === null ? null : Buffer.from(value), value, value === null ? null : Buffer.from(value), value, value === null ? null : Buffer.from(value.slice(0,16)), value?.slice(0,16) ?? null])
    const fixtures: [string, unknown[]][] = expected.flatMap((row, id) => row.map<[string, unknown[]]>((result, i) => [`SELECT CAST(${sources[i]} AS DECIMAL(10,2)) AS x FROM t WHERE id=${id}`, result]))
    for (const [sql, result] of [...fixtures, ...wide]) {
      for (const method of ['query', 'execute'] as const) assert.deepEqual(await outcome(conn, sql, method), result, method + ': ' + sql)
      conn.unprepare({ sql, rowsAsArray: true })
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_branches62')
    await conn.end()
    await db?.end()
  }
})

test('nested DECIMAL choices preserve NULL, BIT, selector warnings and unselected invalid branches', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[]][] = [
    ["SELECT CAST(IF(g=1,CASE g WHEN 1 THEN b ELSE CONCAT('abc1') END,CONCAT('123x')) AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o30],
    ["SELECT CAST(IF(g=1,CASE g WHEN 1 THEN b ELSE CONCAT('abc1') END,CONCAT('123x')) AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o30],
    ["SELECT CAST(IF(g=1,CASE g WHEN 1 THEN b ELSE CONCAT('abc1') END,CONCAT('123x')) AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o30],
    ["SELECT CAST(IF(g=1,CASE g WHEN 1 THEN b ELSE CONCAT('abc1') END,CONCAT('123x')) AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o30],
    ["SELECT CAST(CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o31],
    ["SELECT CAST(CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o32],
    ["SELECT CAST(CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o33],
    ["SELECT CAST(CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o33],
    ["SELECT CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=1",o34],
    ["SELECT CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=2",o35],
    ["SELECT CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=3",o36],
    ["SELECT CASE WHEN g=1 THEN IF(g=1,v,CONCAT('abc1')) WHEN g=2 THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=4",o36],
    ["SELECT CAST(CASE IF(g=1,1,2) WHEN 1 THEN IF(g=1,18446744073709551615,0e0) ELSE IF(g=2,b,'123x') END AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o37],
    ["SELECT CAST(CASE IF(g=1,1,2) WHEN 1 THEN IF(g=1,18446744073709551615,0e0) ELSE IF(g=2,b,'123x') END AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o32],
    ["SELECT CAST(CASE IF(g=1,1,2) WHEN 1 THEN IF(g=1,18446744073709551615,0e0) ELSE IF(g=2,b,'123x') END AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o31],
    ["SELECT CAST(CASE IF(g=1,1,2) WHEN 1 THEN IF(g=1,18446744073709551615,0e0) ELSE IF(g=2,b,'123x') END AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o31],
    ["SELECT CAST(IF(g=1,q,0) AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o38],
    ["SELECT CAST(IF(g=1,q,0) AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o39],
    ["SELECT CAST(IF(g=1,q,0) AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o39],
    ["SELECT CAST(IF(g=1,q,0) AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o39],
    ["SELECT IF(g=1,q,0) AS x FROM t WHERE id=1",o40],
    ["SELECT IF(g=1,q,0) AS x FROM t WHERE id=2",o41],
    ["SELECT IF(g=1,q,0) AS x FROM t WHERE id=3",o41],
    ["SELECT IF(g=1,q,0) AS x FROM t WHERE id=4",o41],
    ["SELECT CAST(CASE g WHEN 1 THEN q ELSE 0 END AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o38],
    ["SELECT CAST(CASE g WHEN 1 THEN q ELSE 0 END AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o39],
    ["SELECT CAST(CASE g WHEN 1 THEN q ELSE 0 END AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o39],
    ["SELECT CAST(CASE g WHEN 1 THEN q ELSE 0 END AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o39],
    ["SELECT CASE g WHEN 1 THEN q ELSE 0 END AS x FROM t WHERE id=1",o40],
    ["SELECT CASE g WHEN 1 THEN q ELSE 0 END AS x FROM t WHERE id=2",o41],
    ["SELECT CASE g WHEN 1 THEN q ELSE 0 END AS x FROM t WHERE id=3",o41],
    ["SELECT CASE g WHEN 1 THEN q ELSE 0 END AS x FROM t WHERE id=4",o41],
    ["SELECT CAST(IF(g=1,'123x',CONCAT('abc1')) AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o31],
    ["SELECT CAST(IF(g=1,'123x',CONCAT('abc1')) AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o32],
    ["SELECT CAST(IF(g=1,'123x',CONCAT('abc1')) AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o32],
    ["SELECT CAST(IF(g=1,'123x',CONCAT('abc1')) AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o32],
    ["SELECT IF(g=1,'123x',CONCAT('abc1')) AS x FROM t WHERE id=1",o42],
    ["SELECT IF(g=1,'123x',CONCAT('abc1')) AS x FROM t WHERE id=2",o43],
    ["SELECT IF(g=1,'123x',CONCAT('abc1')) AS x FROM t WHERE id=3",o43],
    ["SELECT IF(g=1,'123x',CONCAT('abc1')) AS x FROM t WHERE id=4",o43],
    ["SELECT CAST(CASE WHEN '1x' THEN b ELSE CONCAT('abc1') END AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o44],
    ["SELECT CAST(CASE WHEN '1x' THEN b ELSE CONCAT('abc1') END AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o45],
    ["SELECT CAST(CASE WHEN '1x' THEN b ELSE CONCAT('abc1') END AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o46],
    ["SELECT CAST(CASE WHEN '1x' THEN b ELSE CONCAT('abc1') END AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o47],
    ["SELECT CAST(CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=1",o48],
    ["SELECT CAST(CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=2",o49],
    ["SELECT CAST(CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=3",o46],
    ["SELECT CAST(CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS DECIMAL(65,2)) AS x FROM t WHERE id=4",o50],
    ["SELECT CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=1",o51],
    ["SELECT CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=2",o52],
    ["SELECT CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=3",o53],
    ["SELECT CASE '1x' WHEN 1 THEN v WHEN '2x' THEN CONCAT('abc1') ELSE NULL END AS x FROM t WHERE id=4",o54],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nested62')
    await conn.query('USE decimal_nested62')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b BLOB,v VARBINARY(20),g INT,q BIT(8))')
    for (const [id, value, flag] of [[1,'123x',1],[2,'abc1',2],[3,null,0],[4,'.5x',null]] as const) await conn.query('INSERT INTO t VALUES(?,?,?,?,?)', [id,value,value,flag,5])
    for (const [sql, expected] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        await conn.query('SET @n=0')
        const actual = await outcome(conn, sql, method)
        actual.push((await conn.query('SELECT @n AS n'))[0])
        assert.deepEqual(actual, expected, method + ': ' + sql)
      }
      conn.unprepare({ sql, rowsAsArray: true })
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_nested62')
    await conn.end()
    await db?.end()
  }
})

test('selected DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o56,o57],
      [" ",o58,o59],
      ["abc1",o60,o61],
      ["0x",o62,o63],
      ["123x",o64,o65],
      [".5x",o66,o67],
      [null,o68,o69],
    ]],
    ["VARBINARY(60000)","SELECT CAST(IF(g=2,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["VARBINARY(60000)","SELECT CAST(CASE WHEN g=1 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o56,o57],
      [" ",o58,o59],
      ["abc1",o60,o61],
      ["0x",o62,o63],
      ["123x",o64,o65],
      [".5x",o66,o67],
      [null,o68,o69],
    ]],
    ["VARBINARY(60000)","SELECT CAST(CASE WHEN g=2 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["VARBINARY(60000)","SELECT CAST(CASE g WHEN 1 THEN CONCAT(b) ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["VARBINARY(60000)","SELECT CAST(CASE g WHEN 1 THEN 18446744073709551615 ELSE 0e0 END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["BLOB","SELECT CAST(IF(g=1,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["BLOB","SELECT CAST(IF(g=2,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["BLOB","SELECT CAST(IF(g=1,CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["BLOB","SELECT CAST(CASE WHEN g=1 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["BLOB","SELECT CAST(CASE WHEN g=2 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["BLOB","SELECT CAST(CASE g WHEN 1 THEN CONCAT(b) ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["BLOB","SELECT CAST(IF(g=1,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["BLOB","SELECT CAST(CASE g WHEN 1 THEN 18446744073709551615 ELSE 0e0 END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IF(g=2,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["MEDIUMBLOB","SELECT CAST(CASE WHEN g=1 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["MEDIUMBLOB","SELECT CAST(CASE WHEN g=2 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["MEDIUMBLOB","SELECT CAST(CASE g WHEN 1 THEN CONCAT(b) ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["MEDIUMBLOB","SELECT CAST(CASE g WHEN 1 THEN 18446744073709551615 ELSE 0e0 END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["LONGBLOB","SELECT CAST(IF(g=1,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["LONGBLOB","SELECT CAST(IF(g=2,b,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["LONGBLOB","SELECT CAST(IF(g=1,CONCAT(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["LONGBLOB","SELECT CAST(CASE WHEN g=1 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["LONGBLOB","SELECT CAST(CASE WHEN g=2 THEN b ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o64,o65],
      [" ",o64,o65],
      ["abc1",o64,o65],
      ["0x",o64,o65],
      ["123x",o64,o65],
      [".5x",o64,o65],
      [null,o64,o65],
    ]],
    ["LONGBLOB","SELECT CAST(CASE g WHEN 1 THEN CONCAT(b) ELSE '123x' END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o55,[
      ["",o70,o71],
      [" ",o70,o71],
      ["abc1",o70,o71],
      ["0x",o72,o73],
      ["123x",o74,o75],
      [".5x",o76,o77],
      [null,o68,o69],
    ]],
    ["LONGBLOB","SELECT CAST(IF(g=1,18446744073709551615,0e0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
    ["LONGBLOB","SELECT CAST(CASE g WHEN 1 THEN 18446744073709551615 ELSE 0e0 END AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o78,[
      ["",o28,o79],
      [" ",o28,o79],
      ["abc1",o28,o79],
      ["0x",o28,o79],
      ["123x",o28,o79],
      [".5x",o28,o79],
      [null,o28,o79],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_branch_freshclean62')
    await conn.query('USE decimal_branch_freshclean62')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_branch_freshclean62')
    await conn.end()
    await db?.end()
  }
})
