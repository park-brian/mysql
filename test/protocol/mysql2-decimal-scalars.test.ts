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
const o6 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o7 = [[["4"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o8 = [[["7"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o9 = [[["6"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o10 = [[["3"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o11 = [[["5"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o12 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o13 = [[["4"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o14 = [[["7"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o15 = [[["6"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o16 = [[["3"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o17 = [[["5"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o18 = [[["32"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o19 = [[["97"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o20 = [[["49"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o21 = [[["46"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o22 = [[["45"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o23 = [[["32"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o24 = [[["97"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o25 = [[["49"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o26 = [[["46"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o27 = [[["45"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o28 = [[["2"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o29 = [[["1"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o30 = [[["0"]],[["x",246,66,129,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o31 = [[["123"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o32 = [[["1230"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o33 = [[["-1"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o34 = [[["2"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o35 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o36 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o37 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123e1x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o38 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o39 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-0.5x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o40 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o41 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.45x'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o42 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc'"}]]
const o43 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"}]]
const o44 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123.45x'"}]]
const o45 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123e1x'"}]]
const o46 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '.5x'"}]]
const o47 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-0.5x'"}]]
const o48 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc1'"}]]
const o49 = [[["8"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o50 = [[["24"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o51 = [[["56"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o52 = [[["48"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o53 = [[["40"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o54 = [[["8"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o55 = [[["24"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o56 = [[["56"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o57 = [[["48"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o58 = [[["40"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o59 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o60 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o61 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o62 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o63 = [[["7215"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o64 = [[["900150983"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o65 = [[["818968"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o66 = [[["23734"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o67 = [[["80213"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o68 = [[["486481"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o69 = [[["9"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o70 = [[["3916222277"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o71 = [[["891568578"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o72 = [[["3834244376"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o73 = [[["2737552273"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o74 = [[["2432974453"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o75 = [[["830310720"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o76 = [[["3244602459"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o77 = [[["4135807082"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o78 = [[["3916222277"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o79 = [[["891568578"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o80 = [[["3834244376"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o81 = [[["2737552273"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o82 = [[["2432974453"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o83 = [[["830310720"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o84 = [[["3244602459"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o85 = [[["4135807082"]],[["x",246,66,129,0,63,"","","",""]],[]]
const o86 = [[["36"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o87 = [[["2405"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o88 = [[["3592"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o89 = [[["1231"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o90 = [[["1232"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o91 = [[["1233"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o92 = [[["1234"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o93 = [[["1235"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o94 = [[["1236"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o95 = [[["1237"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o96 = [[["1238"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o97 = [[["1239"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o98 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o99 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o100 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o101 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o102 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]]
const o103 = [[["x",246,66,128,0,63,"","","",""]],[]]
const v0 = [o0,o0,o0,o1,o1,o2,o3,o4,o5,o0]
const v1 = [o0,o0,o0,o0,o0,o0,o0,o0,o5,o3]
const v2 = [o6,o6,o6,o7,o8,o9,o10,o11,o5,o6]
const v3 = [o12,o12,o12,o13,o14,o15,o16,o17,o5,o12]
const v4 = [o0,o0,o0,o1,o1,o2,o3,o4,o0,o0]
const v5 = [o0,o0,o0,o0,o0,o0,o5,o0]
const v6 = [o6,o18,o19,o20,o20,o20,o21,o22,o5,o19]
const v7 = [o12,o23,o24,o25,o25,o25,o26,o27,o5,o24]
const v8 = [o12,o12,o28,o29,o12,o12,o12,o12,o12,o12]
const v9 = [o30,o30,o30,o31,o31,o32,o29,o33,o0,o30]
const v10 = [o6,o6,o34,o3,o6,o6,o6,o6,o5,o6]
const v11 = [o12,o12,o28,o29,o12,o12,o12,o12,o5,o12]
const v12 = [o0,o0,o0,o0,o0,o0,o0,o0,o0,o0]
const v13 = [o0,o0,o0,o0,o0,o0,o0,o0,o5,o0]
const v14 = [o0,o0,o0,o0,o0,o0,o0,o0]
const v15 = [o35,o36,o0,o37,o38,o39,o0,o40]
const v16 = [o35,o36,o41,o37,o38,o39,o0,o40]
const v17 = [o6,o6,o6,o1,o1,o3,o6,o6,o5,o6]
const v18 = [o6,o6,o42,o43,o44,o45,o46,o47,o5,o6]
const v19 = [o6,o6,o42,o43,o44,o45,o46,o47,o5,o48]
const v20 = [o6,o49,o50,o18,o51,o52,o50,o53,o5,o18]
const v21 = [o12,o54,o55,o23,o56,o57,o55,o58,o5,o23]
const v22 = [o5,o59,o60,o1,o1,o1,o61,o6,o5,o62]
const v23 = [o0,o0,o5,o0,o5,o5,o5,o5,o5,o0]
const v24 = [o0,o63,o64,o0,o0,o65,o9,o0,o5,o66]
const v25 = [o0,o0,o0,o11,o11,o0,o67,o68,o5,o69]
const v26 = [o6,o70,o71,o72,o73,o74,o75,o76,o5,o77]
const v27 = [o12,o78,o79,o80,o81,o82,o83,o84,o5,o85]
const v28 = [o0,o86,o0,o0,o87,o69,o88,o0,o5,o0]
const f0: [string | null, unknown[], unknown[]][] = [
      ["",o0,o98],
      [" ",o0,o98],
      ["abc1",o0,o98],
      ["0x",o6,o99],
      ["123x",o1,o100],
      [".5x",o3,o101],
      [null,o5,o102],
]
const f1: [string | null, unknown[], unknown[]][] = [
      ["",o0,o98],
      [" ",o0,o98],
      ["abc1",o0,o98],
      ["0x",o6,o99],
      ["123x",o1,o100],
      [".5x",o3,o101],
      [null,o1,o100],
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

test('scalar string constructors own DECIMAL prefixes across text, binary, field and literal sources', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x",".5x","-0.5x",null,"abc1"]
  const fixtures: [string, string[], number[], unknown[][]][] = [
    ["SUBSTRING(b,1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["SUBSTR(b,1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["MID(b,1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["LEFT(b,6000)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["RIGHT(b,6000)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["LPAD(b,CHAR_LENGTH(b),_binary'0')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["RPAD(b,CHAR_LENGTH(b),_binary'0')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["REPEAT(b,1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["REVERSE(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["LOCATE(_binary'x',b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["LOCATE(_binary'x',b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
    ["INSTR(b,_binary'x')",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["INSTR(b,_binary'x')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
    ["POSITION(_binary'x' IN b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["POSITION(_binary'x' IN b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
    ["TRIM(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["LTRIM(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["RTRIM(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["REPLACE(b,_binary'z',_binary'')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["CONCAT_WS(_binary'',b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v4],
    ["SPACE(b)",["blob","text"],[2,3,4,5,6,7,8,9],v5],
    ["ASCII(b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v6],
    ["ASCII(b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v7],
    ["FIELD(b,_binary'123x',_binary'abc')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v8],
    ["ELT(1,b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["MAKE_SET(1,b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v4],
    ["MAKE_SET(1,b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v9],
    ["EXPORT_SET(1,b,_binary'0',_binary'',1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["FIND_IN_SET(b,_binary'123x,abc')",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v10],
    ["FIND_IN_SET(b,_binary'123x,abc')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v11],
    ["INSERT(b,1,0,_binary'')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["SUBSTRING_INDEX(b,_binary'z',1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["QUOTE(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v12],
    ["SOUNDEX(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v13],
    ["CHAR(b)",["blob","text"],[2,3,4,5,6,7,8,9],v14],
    ["CHAR(b)",["varbinary","varchar"],[2,3,4,5,6,7,8,9],v15],
    ["CHAR(b)",["literal","textliteral"],[2,3,4,5,6,7,8,9],v16],
    ["FORMAT(b,0)",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v17],
    ["FORMAT(b,0)",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v18],
    ["FORMAT(b,0)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v19],
    ["BIT_LENGTH(b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v20],
    ["BIT_LENGTH(b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v21],
    ["CONV(b,10,10)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v22],
    ["TO_BASE64(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v13],
    ["FROM_BASE64(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v23],
    ["ORD(b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v6],
    ["ORD(b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v7],
    ["MD5(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v24],
    ["SHA1(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v25],
    ["SHA(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v25],
    ["CRC32(b)",["blob","varbinary","text","varchar"],[0,1,2,3,4,5,6,7,8,9],v26],
    ["CRC32(b)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v27],
    ["SHA2(b,256)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v28],
    ["LOWER(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["LCASE(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["UPPER(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["UCASE(b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_scalar_dispatch64')
    await conn.query('USE decimal_scalar_dispatch64')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,s MEDIUMTEXT,v VARBINARY(12000),c VARCHAR(12000))')
    for (const [id,value] of values.entries()) await conn.query('INSERT INTO t VALUES(?,?,?,?,?)',[id,value === null ? null : Buffer.from(value),value,value === null ? null : Buffer.from(value),value])
    for (const [source,kinds,ids,results] of fixtures) for (const kind of kinds) for (const [i,id] of ids.entries()) {
      const value = values[id]
      const input = kind === 'blob' ? 'b' : kind === 'text' ? 's' : kind === 'varbinary' ? 'v' : kind === 'varchar' ? 'c' : value === null ? 'NULL' : '_' + (kind === 'literal' ? 'binary' : 'utf8mb4') + " X'" + Buffer.from(value as string).toString('hex') + "'"
      const sql = 'SELECT CAST(' + source.replace(/\bb\b/g,input) + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + id
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),results[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_scalar_dispatch64')
    await conn.end()
    await db?.end()
  }
})

test('scalar DECIMAL readers retain every trailing byte through transforms, lists and base64 nesting', async () => {
  const { db, conn } = await connect()
  const sources = ["REPLACE(b,'z','')","SUBSTRING(v,1)","LCASE(b)","UCASE(v)","ELT(1,b)","EXPORT_SET(1,b,'0','',1)","INSERT(b,1,0,'')","FROM_BASE64(TO_BASE64(b))"]
  const expected = [
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,o1,
    o2,o89,o90,o91,o92,o93,o94,o95,o96,o97,o1,o1,o1,o1,o1,o1,
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
    await conn.query('CREATE DATABASE decimal_scalarbytes64')
    await conn.query('USE decimal_scalarbytes64')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (let byte=0;byte<256;byte++) await conn.query('INSERT INTO t VALUES(?,?,?)',[byte,Buffer.from([0x31,0x32,0x33,byte]),Buffer.from([0x31,0x32,0x33,byte])])
    for (let byte=0;byte<256;byte++) for (const source of sources) {
      const sql = 'SELECT CAST(' + source + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + byte
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[byte],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_scalarbytes64')
    await conn.end()
    await db?.end()
  }
})

test('scalar DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(REPLACE(b,'z','') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["VARBINARY(60000)","SELECT CAST(SUBSTRING(b,1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["VARBINARY(60000)","SELECT CAST(LCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["VARBINARY(60000)","SELECT CAST(UCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["VARBINARY(60000)","SELECT CAST(ELT(1,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["VARBINARY(60000)","SELECT CAST(EXPORT_SET(1,b,'0','',1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["VARBINARY(60000)","SELECT CAST(INSERT(IFNULL(b,'123x'),1,0,'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f1],
    ["VARBINARY(60000)","SELECT CAST(LOWER(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(REPLACE(b,'z','') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(SUBSTRING(b,1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(LCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(UCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(ELT(1,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(EXPORT_SET(1,b,'0','',1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["BLOB","SELECT CAST(INSERT(IFNULL(b,'123x'),1,0,'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f1],
    ["BLOB","SELECT CAST(LOWER(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(REPLACE(b,'z','') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(SUBSTRING(b,1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(LCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(UCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(ELT(1,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(EXPORT_SET(1,b,'0','',1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["MEDIUMBLOB","SELECT CAST(INSERT(IFNULL(b,'123x'),1,0,'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f1],
    ["MEDIUMBLOB","SELECT CAST(LOWER(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(REPLACE(b,'z','') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(SUBSTRING(b,1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(LCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(UCASE(b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(ELT(1,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(EXPORT_SET(1,b,'0','',1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
    ["LONGBLOB","SELECT CAST(INSERT(IFNULL(b,'123x'),1,0,'') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f1],
    ["LONGBLOB","SELECT CAST(LOWER(IF(g=1,b,'123x')) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o103,f0],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_scalarfresh64')
    await conn.query('USE decimal_scalarfresh64')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_scalarfresh64')
    await conn.end()
    await db?.end()
  }
})
