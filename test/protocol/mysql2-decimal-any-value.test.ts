// Complete pinned MySQL 8.4.11 outcomes. Argument-reader, long-input and overflow gaps remain explicit.
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
const o11 = [[["18446744073709552000"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o12 = [[["1231"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o13 = [[["1231"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o14 = [[["1232"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o15 = [[["1232"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o16 = [[["1233"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o17 = [[["1233"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o18 = [[["1234"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o19 = [[["1234"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o20 = [[["1235"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o21 = [[["1235"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o22 = [[["1236"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o23 = [[["1236"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o24 = [[["1237"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o25 = [[["1237"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o26 = [[["1238"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o27 = [[["1238"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o28 = [[["1239"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o29 = [[["1239"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o30 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o31 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o32 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o33 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o34 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o35 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]]
const o36 = [[["x",246,66,128,0,63,"","","",""]],[]]
const o37 = [[{"x":"0"}],[["x",246,66,129,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o38 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o39 = [[{"x":"0"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o40 = [[{"x":"123"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o41 = [[{"x":"1"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o42 = [[["x",246,66,129,0,63,"","","",""]],[]]
const o43 = [[{"x":"18446744073709552000"}],[["x",246,66,129,0,63,"","","",""]],[]]
const o44 = [[[null]],[["x",6,0,128,0,63,"","","",""]],[]]
const o45 = [[[null]],[["x",246,67,128,2,63,"","","",""]],[]]
const o46 = [[[null]],[["x",5,23,128,31,63,"","","",""]],[]]
const o47 = [[[0]],[["x",5,23,129,31,63,"","","",""]],[]]
const o48 = [[["0.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o49 = [[[18446744073709552000]],[["x",8,20,161,0,63,"","","",""]],[]]
const o50 = [[["18446744073709551615.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o51 = [[[18446744073709552000]],[["x",5,23,129,31,63,"","","",""]],[]]
const o52 = [[["18446744073709552000.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o53 = [[[-9223372036854776000]],[["x",8,20,129,0,63,"","","",""]],[]]
const o54 = [[["-9223372036854775808.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o55 = [[[-9223372036854776000]],[["x",5,23,129,31,63,"","","",""]],[]]
const o56 = [[["-9223372036854776000.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o57 = [[["123.45"]],[["x",246,7,129,2,63,"","","",""]],[]]
const o58 = [[["123.45"]],[["x",246,67,129,2,63,"","","",""]],[]]
const o59 = [[[123.45]],[["x",5,23,129,31,63,"","","",""]],[]]
const o60 = [[[123]],[["x",245,4294967292,128,31,224,"","","",""]],[]]
const o61 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o62 = [[["123"]],[["x",251,4294967295,128,31,224,"","","",""]],[]]
const o63 = [[["123"]],[["x",251,4294967295,129,31,224,"","","",""]],[]]
const o64 = [[["123.00"]],[["x",246,67,129,2,63,"","","",""]],[]]
const v0 = [o0,o0,o0,o1,o1,o2,o3,o4,o5,o0]
const v1 = [o6,o6,o6,o7,o7,o8,o9,o10,o5,o6]
const v2 = [o6,o6,o6,o7,o7,o8,o9,o10,o7,o6]
const v3 = [o11,o11,o11,o11,o11,o11,o11,o11,o11,o11]
const v4 = [o1,o1,o1,o1,o1,o1,o7,o1]
const v5 = [o2,o2,o2,o2,o2,o2,o8,o2]
const v6 = [o12,o12,o12,o12,o12,o12,o13,o12]
const v7 = [o14,o14,o14,o14,o14,o14,o15,o14]
const v8 = [o16,o16,o16,o16,o16,o16,o17,o16]
const v9 = [o18,o18,o18,o18,o18,o18,o19,o18]
const v10 = [o20,o20,o20,o20,o20,o20,o21,o20]
const v11 = [o22,o22,o22,o22,o22,o22,o23,o22]
const v12 = [o24,o24,o24,o24,o24,o24,o25,o24]
const v13 = [o26,o26,o26,o26,o26,o26,o27,o26]
const v14 = [o28,o28,o28,o28,o28,o28,o29,o28]
const f0: [string | null, unknown[], unknown[]][] = [
      ["",o0,o30],
      [" ",o0,o30],
      ["abc1",o0,o30],
      ["0x",o31,o32],
      ["123x",o1,o33],
      [".5x",o3,o34],
      [null,o5,o35],
]
const f1: [string | null, unknown[], unknown[]][] = [
      ["",o6,o37],
      [" ",o6,o37],
      ["abc1",o6,o37],
      ["0x",o38,o39],
      ["123x",o7,o40],
      [".5x",o9,o41],
      [null,o7,o40],
]
const f2: [string | null, unknown[], unknown[]][] = [
      ["",o11,o43],
      [" ",o11,o43],
      ["abc1",o11,o43],
      ["0x",o11,o43],
      ["123x",o11,o43],
      [".5x",o11,o43],
      [null,o11,o43],
]

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

test('ANY_VALUE owns string DECIMAL prefixes across sources and nested selection boundaries', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x",".5x","-0.5x",null,"abc1"]
  const fixtures: [string, string[], number[], unknown[][]][] = [
    ["ANY_VALUE(b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["ANY_VALUE(b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["ANY_VALUE(CONCAT(b))",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["ANY_VALUE(IF(g=1,b,'123x'))",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["ANY_VALUE(IF(g=1,b,'123x'))",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["ANY_VALUE(CASE g WHEN 1 THEN b ELSE '123x' END)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["ANY_VALUE(CASE g WHEN 1 THEN b ELSE '123x' END)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["IF(g=1,ANY_VALUE(b),'123x')",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["IF(g=1,ANY_VALUE(b),'123x')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["COALESCE(ANY_VALUE(b),'123x')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["ANY_VALUE(NULLIF(b,_binary'zz'))",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["ANY_VALUE(IF(g=1,18446744073709551615,0e0))",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
    ["ANY_VALUE(CASE g WHEN 1 THEN 18446744073709551615 ELSE 0e0 END)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_any65')
    await conn.query('USE decimal_any65')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_any65')
    await conn.end()
    await db?.end()
  }
})

test('ANY_VALUE DECIMAL readers retain every trailing byte through nested choices', async () => {
  const { db, conn } = await connect()
  const sources = ["ANY_VALUE(b)","ANY_VALUE(v)","ANY_VALUE(CONCAT(b))","ANY_VALUE(IF(TRUE,b,'123x'))","ANY_VALUE(CASE WHEN TRUE THEN b ELSE '123x' END)","IF(TRUE,ANY_VALUE(b),'123x')","COALESCE(ANY_VALUE(b),'123x')","ANY_VALUE(NULLIF(b,_binary'zz'))"]
  const expected = [
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
    v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,v4,
  ]
  try {
    await conn.query('CREATE DATABASE decimal_anybytes65')
    await conn.query('USE decimal_anybytes65')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (let byte=0;byte<256;byte++) await conn.query('INSERT INTO t VALUES(?,?,?)',[byte,Buffer.from([0x31,0x32,0x33,byte]),Buffer.from([0x31,0x32,0x33,byte])])
    for (let byte=0;byte<256;byte++) for (const [i,source] of sources.entries()) {
      const sql = 'SELECT CAST(' + source + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + byte
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[byte]?.[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_anybytes65')
    await conn.end()
    await db?.end()
  }
})

test('scalar DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(ANY_VALUE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["VARBINARY(60000)","SELECT CAST(ANY_VALUE(CONCAT(b)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["VARBINARY(60000)","SELECT CAST(ANY_VALUE(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["VARBINARY(60000)","SELECT CAST(ANY_VALUE(CASE g WHEN 1 THEN b ELSE '123x' END) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["VARBINARY(60000)","SELECT CAST(COALESCE(ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f1],
    ["VARBINARY(60000)","SELECT CAST(ANY_VALUE(NULLIF(b,_binary'zz')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["VARBINARY(60000)","SELECT CAST(ANY_VALUE(IF(g=1,18446744073709551615,0e0)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f2],
    ["BLOB","SELECT CAST(ANY_VALUE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["BLOB","SELECT CAST(ANY_VALUE(CONCAT(b)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["BLOB","SELECT CAST(ANY_VALUE(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["BLOB","SELECT CAST(ANY_VALUE(CASE g WHEN 1 THEN b ELSE '123x' END) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["BLOB","SELECT CAST(IF(g=1,ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["BLOB","SELECT CAST(COALESCE(ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f1],
    ["BLOB","SELECT CAST(ANY_VALUE(NULLIF(b,_binary'zz')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["BLOB","SELECT CAST(ANY_VALUE(IF(g=1,18446744073709551615,0e0)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f2],
    ["MEDIUMBLOB","SELECT CAST(ANY_VALUE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["MEDIUMBLOB","SELECT CAST(ANY_VALUE(CONCAT(b)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["MEDIUMBLOB","SELECT CAST(ANY_VALUE(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["MEDIUMBLOB","SELECT CAST(ANY_VALUE(CASE g WHEN 1 THEN b ELSE '123x' END) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["MEDIUMBLOB","SELECT CAST(COALESCE(ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f1],
    ["MEDIUMBLOB","SELECT CAST(ANY_VALUE(NULLIF(b,_binary'zz')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["MEDIUMBLOB","SELECT CAST(ANY_VALUE(IF(g=1,18446744073709551615,0e0)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f2],
    ["LONGBLOB","SELECT CAST(ANY_VALUE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["LONGBLOB","SELECT CAST(ANY_VALUE(CONCAT(b)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["LONGBLOB","SELECT CAST(ANY_VALUE(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["LONGBLOB","SELECT CAST(ANY_VALUE(CASE g WHEN 1 THEN b ELSE '123x' END) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["LONGBLOB","SELECT CAST(IF(g=1,ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["LONGBLOB","SELECT CAST(COALESCE(ANY_VALUE(b),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f1],
    ["LONGBLOB","SELECT CAST(ANY_VALUE(NULLIF(b,_binary'zz')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o36,f0],
    ["LONGBLOB","SELECT CAST(ANY_VALUE(IF(g=1,18446744073709551615,0e0)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o42,f2],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_anyfresh65')
    await conn.query('USE decimal_anyfresh65')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_anyfresh65')
    await conn.end()
    await db?.end()
  }
})

test('ANY_VALUE retains native NULL, exact numeric and numeric JSON controls', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[]][] = [
    ["SELECT ANY_VALUE(NULL) AS x",o44],
    ["SELECT CAST(ANY_VALUE(NULL) AS DECIMAL(65,2)) AS x",o45],
    ["SELECT ANY_VALUE(IF(TRUE,NULL,0e0)) AS x",o46],
    ["SELECT CAST(ANY_VALUE(IF(TRUE,NULL,0e0)) AS DECIMAL(65,2)) AS x",o45],
    ["SELECT ANY_VALUE(CASE WHEN TRUE THEN NULL ELSE 0e0 END) AS x",o46],
    ["SELECT CAST(ANY_VALUE(CASE WHEN TRUE THEN NULL ELSE 0e0 END) AS DECIMAL(65,2)) AS x",o45],
    ["SELECT IF(TRUE,ANY_VALUE(NULL),0e0) AS x",o46],
    ["SELECT CAST(IF(TRUE,ANY_VALUE(NULL),0e0) AS DECIMAL(65,2)) AS x",o45],
    ["SELECT COALESCE(ANY_VALUE(NULL),0e0) AS x",o47],
    ["SELECT CAST(COALESCE(ANY_VALUE(NULL),0e0) AS DECIMAL(65,2)) AS x",o48],
    ["SELECT ANY_VALUE(COALESCE(NULL,0e0)) AS x",o47],
    ["SELECT CAST(ANY_VALUE(COALESCE(NULL,0e0)) AS DECIMAL(65,2)) AS x",o48],
    ["SELECT ANY_VALUE(18446744073709551615) AS x",o49],
    ["SELECT CAST(ANY_VALUE(18446744073709551615) AS DECIMAL(65,2)) AS x",o50],
    ["SELECT ANY_VALUE(IF(TRUE,18446744073709551615,0e0)) AS x",o51],
    ["SELECT CAST(ANY_VALUE(IF(TRUE,18446744073709551615,0e0)) AS DECIMAL(65,2)) AS x",o52],
    ["SELECT ANY_VALUE(CASE WHEN TRUE THEN 18446744073709551615 ELSE 0e0 END) AS x",o51],
    ["SELECT CAST(ANY_VALUE(CASE WHEN TRUE THEN 18446744073709551615 ELSE 0e0 END) AS DECIMAL(65,2)) AS x",o52],
    ["SELECT IF(TRUE,ANY_VALUE(18446744073709551615),0e0) AS x",o51],
    ["SELECT CAST(IF(TRUE,ANY_VALUE(18446744073709551615),0e0) AS DECIMAL(65,2)) AS x",o50],
    ["SELECT COALESCE(ANY_VALUE(18446744073709551615),0e0) AS x",o51],
    ["SELECT CAST(COALESCE(ANY_VALUE(18446744073709551615),0e0) AS DECIMAL(65,2)) AS x",o52],
    ["SELECT ANY_VALUE(COALESCE(18446744073709551615,0e0)) AS x",o51],
    ["SELECT CAST(ANY_VALUE(COALESCE(18446744073709551615,0e0)) AS DECIMAL(65,2)) AS x",o52],
    ["SELECT ANY_VALUE(-9223372036854775808) AS x",o53],
    ["SELECT CAST(ANY_VALUE(-9223372036854775808) AS DECIMAL(65,2)) AS x",o54],
    ["SELECT ANY_VALUE(IF(TRUE,-9223372036854775808,0e0)) AS x",o55],
    ["SELECT CAST(ANY_VALUE(IF(TRUE,-9223372036854775808,0e0)) AS DECIMAL(65,2)) AS x",o56],
    ["SELECT ANY_VALUE(CASE WHEN TRUE THEN -9223372036854775808 ELSE 0e0 END) AS x",o55],
    ["SELECT CAST(ANY_VALUE(CASE WHEN TRUE THEN -9223372036854775808 ELSE 0e0 END) AS DECIMAL(65,2)) AS x",o56],
    ["SELECT IF(TRUE,ANY_VALUE(-9223372036854775808),0e0) AS x",o55],
    ["SELECT CAST(IF(TRUE,ANY_VALUE(-9223372036854775808),0e0) AS DECIMAL(65,2)) AS x",o54],
    ["SELECT COALESCE(ANY_VALUE(-9223372036854775808),0e0) AS x",o55],
    ["SELECT CAST(COALESCE(ANY_VALUE(-9223372036854775808),0e0) AS DECIMAL(65,2)) AS x",o56],
    ["SELECT ANY_VALUE(COALESCE(-9223372036854775808,0e0)) AS x",o55],
    ["SELECT CAST(ANY_VALUE(COALESCE(-9223372036854775808,0e0)) AS DECIMAL(65,2)) AS x",o56],
    ["SELECT ANY_VALUE(123.45) AS x",o57],
    ["SELECT CAST(ANY_VALUE(123.45) AS DECIMAL(65,2)) AS x",o58],
    ["SELECT ANY_VALUE(IF(TRUE,123.45,0e0)) AS x",o59],
    ["SELECT CAST(ANY_VALUE(IF(TRUE,123.45,0e0)) AS DECIMAL(65,2)) AS x",o58],
    ["SELECT ANY_VALUE(CASE WHEN TRUE THEN 123.45 ELSE 0e0 END) AS x",o59],
    ["SELECT CAST(ANY_VALUE(CASE WHEN TRUE THEN 123.45 ELSE 0e0 END) AS DECIMAL(65,2)) AS x",o58],
    ["SELECT IF(TRUE,ANY_VALUE(123.45),0e0) AS x",o59],
    ["SELECT CAST(IF(TRUE,ANY_VALUE(123.45),0e0) AS DECIMAL(65,2)) AS x",o58],
    ["SELECT COALESCE(ANY_VALUE(123.45),0e0) AS x",o59],
    ["SELECT CAST(COALESCE(ANY_VALUE(123.45),0e0) AS DECIMAL(65,2)) AS x",o58],
    ["SELECT ANY_VALUE(COALESCE(123.45,0e0)) AS x",o59],
    ["SELECT CAST(ANY_VALUE(COALESCE(123.45,0e0)) AS DECIMAL(65,2)) AS x",o58],
    ["SELECT ANY_VALUE(CAST('123' AS JSON)) AS x",o60],
    ["SELECT CAST(ANY_VALUE(CAST('123' AS JSON)) AS DECIMAL(65,2)) AS x",o61],
    ["SELECT ANY_VALUE(IF(TRUE,CAST('123' AS JSON),0e0)) AS x",o62],
    ["SELECT CAST(ANY_VALUE(IF(TRUE,CAST('123' AS JSON),0e0)) AS DECIMAL(65,2)) AS x",o61],
    ["SELECT ANY_VALUE(CASE WHEN TRUE THEN CAST('123' AS JSON) ELSE 0e0 END) AS x",o62],
    ["SELECT CAST(ANY_VALUE(CASE WHEN TRUE THEN CAST('123' AS JSON) ELSE 0e0 END) AS DECIMAL(65,2)) AS x",o61],
    ["SELECT IF(TRUE,ANY_VALUE(CAST('123' AS JSON)),0e0) AS x",o62],
    ["SELECT CAST(IF(TRUE,ANY_VALUE(CAST('123' AS JSON)),0e0) AS DECIMAL(65,2)) AS x",o61],
    ["SELECT COALESCE(ANY_VALUE(CAST('123' AS JSON)),0e0) AS x",o63],
    ["SELECT CAST(COALESCE(ANY_VALUE(CAST('123' AS JSON)),0e0) AS DECIMAL(65,2)) AS x",o64],
    ["SELECT ANY_VALUE(COALESCE(CAST('123' AS JSON),0e0)) AS x",o63],
    ["SELECT CAST(ANY_VALUE(COALESCE(CAST('123' AS JSON),0e0)) AS DECIMAL(65,2)) AS x",o64],
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
