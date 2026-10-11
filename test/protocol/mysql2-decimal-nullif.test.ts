// Complete pinned MySQL 8.4.11 outcomes. Remaining field encoding, long-input and overflow gaps stay open.
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
const o6 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o7 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o8 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o9 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o10 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]
const o11 = [[["1230"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]
const o12 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o13 = [[["-1"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]
const o14 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o15 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o16 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o17 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o18 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o19 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc'"}]]
const o20 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o21 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123.45x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]
const o22 = [[["1230"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123e1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]
const o23 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '.5x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o24 = [[["-1"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-0.5x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]
const o25 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc1'"}]]
const o26 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o27 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"}]]
const o28 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o29 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'abc1'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o30 = {"error":[1267,"HY000","Illegal mix of collations (utf8mb4_bin,NONE) and (binary,COERCIBLE) for operation 'nullif'"]}
const o31 = [[["1231"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o32 = [[["1232"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o33 = [[["1233"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o34 = [[["1234"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o35 = [[["1235"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o36 = [[["1236"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o37 = [[["1237"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o38 = [[["1238"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o39 = [[["1239"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o40 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o41 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]
const o42 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o43 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]]
const o44 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]]
const o45 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o46 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o47 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]]
const o48 = [[["x",246,66,128,0,63,"","","",""]],[]]
const o49 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '0x'"}]]
const o50 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '0x'"}]]
const o51 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o52 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '.5x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o53 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o54 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o55 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o56 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o57 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o58 = [[[null]],[["x",6,0,128,0,63,"","","",""]],[]]
const o59 = [[[null]],[["x",246,67,128,2,63,"","","",""]],[]]
const o60 = [[[null]],[["x",5,23,128,31,63,"","","",""]],[]]
const o61 = [[[18446744073709552000]],[["x",8,20,160,0,63,"","","",""]],[]]
const o62 = [[["18446744073709551615.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o63 = [[[18446744073709552000]],[["x",8,20,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o64 = [[["18446744073709551615.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o65 = [[[null]],[["x",8,20,160,0,63,"","","",""]],[]]
const o66 = [[[18446744073709552000]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o67 = [[[18446744073709552000]],[["x",5,23,128,31,63,"","","",""]],[]]
const o68 = [[[-9223372036854776000]],[["x",8,20,128,0,63,"","","",""]],[]]
const o69 = [[["-9223372036854775808.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o70 = [[[-9223372036854776000]],[["x",8,20,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o71 = [[["-9223372036854775808.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o72 = [[[null]],[["x",8,20,128,0,63,"","","",""]],[]]
const o73 = [[[-9223372036854776000]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o74 = [[[-9223372036854776000]],[["x",5,23,128,31,63,"","","",""]],[]]
const o75 = [[["123.45"]],[["x",246,7,128,2,63,"","","",""]],[]]
const o76 = [[["123.45"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o77 = [[["123.45"]],[["x",246,7,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o78 = [[["123.45"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o79 = [[[null]],[["x",246,7,128,2,63,"","","",""]],[]]
const o80 = [[[123.45]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o81 = [[[123.45]],[["x",5,23,128,31,63,"","","",""]],[]]
const o82 = [[[123]],[["x",5,5,128,31,63,"","","",""]],[]]
const o83 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o84 = [[[123]],[["x",5,5,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o85 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o86 = [[[null]],[["x",5,5,128,31,63,"","","",""]],[]]
const o87 = [[[123]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'zz'"}]]
const o88 = [[[123]],[["x",5,23,128,31,63,"","","",""]],[]]
const o89 = [[[{"type":"Buffer","data":[53]}]],[["x",253,1,128,0,63,"","","",""]],[]]
const o90 = [[["53.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o91 = [[[null]],[["x",253,1,128,0,63,"","","",""]],[]]
const o92 = [[[{"type":"Buffer","data":[53]}]],[["x",253,3,128,31,63,"","","",""]],[]]
const o93 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,4,160,0,63,"","","",""]],[]]
const o94 = [[["825373560.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o95 = [[[null]],[["x",253,4,160,0,63,"","","",""]],[]]
const o96 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,4,128,31,63,"","","",""]],[]]
const o97 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,4,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"}]]
const o98 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o99 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o100 = [[[null]],[["x",253,4,128,31,63,"","","",""]],[]]
const o101 = [[["123x"]],[["x",253,16,0,31,224,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"}]]
const o102 = [[["123x"]],[["x",253,16,0,31,224,"","","",""]],[]]
const o103 = [[[null]],[["x",253,16,0,31,224,"","","",""]],[]]
const o104 = [[["123x"]],[["x",253,88,0,31,224,"","","",""]],[]]
const o105 = [[["123x"]],[["x",253,88,0,31,224,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"}]]
const o106 = [[["2026-10-11 12:34:56.123456"]],[["x",253,104,0,31,224,"","","",""]],[]]
const o107 = [[["20261011123456.12"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o108 = {"error":[1525,"HY000","Incorrect DATETIME value: 'zz'"]}
const o109 = [[[null]],[["x",253,104,0,31,224,"","","",""]],[]]
const o110 = [[["12:34:56.123456"]],[["x",253,68,0,31,224,"","","",""]],[]]
const o111 = [[["123456.12"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o112 = [[[null]],[["x",253,68,0,31,224,"","","",""]],[]]
const o113 = [[["12:34:56.123456"]],[["x",253,88,0,31,224,"","","",""]],[]]
const o114 = [[["2026-10-11"]],[["x",253,40,0,31,224,"","","",""]],[]]
const o115 = [[["20261011.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o116 = {"error":[1525,"HY000","Incorrect DATE value: 'zz'"]}
const o117 = [[[null]],[["x",253,40,0,31,224,"","","",""]],[]]
const o118 = [[["2026-10-11"]],[["x",253,88,0,31,224,"","","",""]],[]]
const o119 = [[[123]],[["x",245,4294967292,128,31,224,"","","",""]],[]]
const o120 = [[[null]],[["x",245,4294967292,128,31,224,"","","",""]],[]]
const o121 = [[["123"]],[["x",251,4294967295,128,31,224,"","","",""]],[]]
const o122 = [[[true]],[["x",245,4294967292,128,31,224,"","","",""]],[]]
const o123 = [[["1.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o124 = [[["true"]],[["x",251,4294967295,128,31,224,"","","",""]],[]]
const o125 = [[[null],[123],[123]],[["x",8,22,128,0,63,"","","",""]],[]]
const o126 = [[[null],["123.00"],["123.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o127 = [[[null],["2026-10-11"],["2026-10-11"]],[["x",253,40,0,31,224,"","","",""]],[]]
const o128 = [[[null],["2026.00"],["2026.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '2026-10-11'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '2026-10-11'"}]]
const o129 = [[[null],["2026-10-11 00:00:00"],["2026-10-11 00:00:00"]],[["x",253,76,0,31,224,"","","",""]],[]]
const o130 = [[[null],["2026.00"],["2026.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '2026-10-11 00:00:00'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '2026-10-11 00:00:00'"}]]
const o131 = [[[null],["2026"],["2026"]],[["x",253,88,32,31,224,"","","",""]],[]]
const o132 = [[[null],["2026.00"],["2026.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o133 = [[[18446744073709552000],[18446744073709552000],[18446744073709552000]],[["x",8,20,160,0,63,"","","",""]],[]]
const o134 = [[["18446744073709551615.00"],["18446744073709551615.00"],["18446744073709551615.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o135 = [[[null],["2026-10-12"],[null]],[["x",253,40,0,31,224,"","","",""]],[]]
const o136 = [[[null],["20261012.00"],[null]],[["x",246,67,128,2,63,"","","",""]],[]]
const o137 = [[[null],["2027"],[null]],[["x",253,16,32,31,224,"","","",""]],[]]
const o138 = [[[null],["2027.00"],[null]],[["x",246,67,128,2,63,"","","",""]],[]]
const v0 = [o0,o0,o0,o1,o1,o2,o3,o4,o5,o0]
const v1 = [o6,o7,o8,o9,o10,o11,o12,o13,o5,o14]
const v2 = [o15,o16,o17,o9,o10,o11,o12,o13,o5,o18]
const v3 = [o5,o5,o5,o5,o5,o5,o5,o5,o5,o5]
const v4 = [o5,o5,o5,o1,o1,o2,o3,o4,o5,o5]
const v5 = [o5,o5,o19,o20,o21,o22,o23,o24,o5,o5]
const v6 = [o5,o5,o19,o20,o21,o22,o23,o24,o5,o25]
const v7 = [o0,o0,o0,o5,o1,o2,o3,o4,o5,o0]
const v8 = [o6,o7,o26,o27,o21,o22,o23,o24,o5,o14]
const v9 = [o15,o16,o28,o27,o21,o22,o23,o24,o5,o29]
const v10 = [o30,o30,o30,o30,o30,o30,o30,o30,o5,o30]
const v11 = [o1,o5,o1,o1,o1,o1,o1]
const v12 = [o2,o5,o2,o2,o2,o2,o2]
const v13 = [o31,o5,o31,o31,o31,o31,o31]
const v14 = [o32,o5,o32,o32,o32,o32,o32]
const v15 = [o33,o5,o33,o33,o33,o33,o33]
const v16 = [o34,o5,o34,o34,o34,o34,o34]
const v17 = [o35,o5,o35,o35,o35,o35,o35]
const v18 = [o36,o5,o36,o36,o36,o36,o36]
const v19 = [o37,o5,o37,o37,o37,o37,o37]
const v20 = [o38,o5,o38,o38,o38,o38,o38]
const v21 = [o39,o5,o39,o39,o39,o39,o39]
const f0: [string | null, unknown[], unknown[]][] = [
      ["",o6,o40],
      [" ",o7,o41],
      ["abc1",o14,o42],
      ["0x",o43,o44],
      ["123x",o9,o45],
      [".5x",o12,o46],
      [null,o5,o47],
]
const f1: [string | null, unknown[], unknown[]][] = [
      ["",o5,o47],
      [" ",o5,o47],
      ["abc1",o5,o47],
      ["0x",o5,o47],
      ["123x",o5,o47],
      [".5x",o5,o47],
      [null,o5,o47],
]
const f2: [string | null, unknown[], unknown[]][] = [
      ["",o5,o47],
      [" ",o5,o47],
      ["abc1",o5,o47],
      ["0x",o49,o50],
      ["123x",o20,o51],
      [".5x",o23,o52],
      [null,o5,o47],
]
const f3: [string | null, unknown[], unknown[]][] = [
      ["",o0,o53],
      [" ",o0,o53],
      ["abc1",o0,o53],
      ["0x",o54,o55],
      ["123x",o1,o56],
      [".5x",o3,o57],
      [null,o5,o47],
]
const f4: [string | null, unknown[], unknown[]][] = [
      ["",o5,o47],
      [" ",o5,o47],
      ["abc1",o5,o47],
      ["0x",o5,o47],
      ["123x",o1,o56],
      [".5x",o3,o57],
      [null,o5,o47],
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
  try {
    const [rows, columns] = await (method === 'query' ? conn.query(options) : conn.execute(options))
    const warnings = (await conn.query('SHOW WARNINGS'))[0]
    return [JSON.parse(JSON.stringify(rows)), fields(columns as mysql.FieldPacket[]), warnings]
  } catch (caught) {
    const error = caught as { errno: number; sqlState: string; message: string }
    return { error: [error.errno, error.sqlState, error.message] }
  }
}

test('NULLIF delegates original string DECIMAL readers across sources and nested selection boundaries', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x",".5x","-0.5x",null,"abc1"]
  const fixtures: [string, string[], number[], unknown[]][] = [
    ["NULLIF(b,_binary'zz')",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["NULLIF(b,_binary'zz')",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["NULLIF(b,_binary'zz')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["NULLIF(b,b)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v3],
    ["NULLIF(b,NULL)",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["NULLIF(b,NULL)",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["NULLIF(b,NULL)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["NULLIF(b,0)",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v4],
    ["NULLIF(b,0)",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v5],
    ["NULLIF(b,0)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v6],
    ["NULLIF(b,123)",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v7],
    ["NULLIF(b,123)",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v8],
    ["NULLIF(b,123)",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v9],
    ["NULLIF(REPLACE(b,'z',''),_binary'zz')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["NULLIF(IF(g=1,b,'123x'),_binary'zz')",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["NULLIF(IF(g=1,b,'123x'),_binary'zz')",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["NULLIF(IF(g=1,b,'123x'),_binary'zz')",["literal"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["NULLIF(IF(g=1,b,'123x'),_binary'zz')",["textliteral"],[0,1,2,3,4,5,6,7,8,9],v10],
    ["NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz')",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz')",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz')",["literal"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz')",["textliteral"],[0,1,2,3,4,5,6,7,8,9],v10],
    ["IF(g=1,NULLIF(b,_binary'zz'),'123x')",["blob","text"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["IF(g=1,NULLIF(b,_binary'zz'),'123x')",["varbinary","varchar"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["IF(g=1,NULLIF(b,_binary'zz'),'123x')",["literal","textliteral"],[0,1,2,3,4,5,6,7,8,9],v2],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nullif66')
    await conn.query('USE decimal_nullif66')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_nullif66')
    await conn.end()
    await db?.end()
  }
})

test('NULLIF DECIMAL readers retain every trailing byte through nested choices', async () => {
  const { db, conn } = await connect()
  const sources = ["NULLIF(b,_binary'zz')","NULLIF(b,b)","NULLIF(b,NULL)","NULLIF(CONCAT(b),_binary'zz')","NULLIF(IF(TRUE,b,'123x'),_binary'zz')","NULLIF(CASE WHEN TRUE THEN b ELSE '123x' END,_binary'zz')","IF(TRUE,NULLIF(b,_binary'zz'),'123x')"]
  const expected = [
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v12,v13,v14,v15,v16,v17,v18,v19,v20,v21,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
    v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,v11,
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nullifbytes66')
    await conn.query('USE decimal_nullifbytes66')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (let byte=0;byte<256;byte++) await conn.query('INSERT INTO t VALUES(?,?,?)',[byte,Buffer.from([0x31,0x32,0x33,byte]),Buffer.from([0x31,0x32,0x33,byte])])
    for (let byte=0;byte<256;byte++) for (const [i,source] of sources.entries()) {
      const sql = 'SELECT CAST(' + source + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + byte
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[byte]?.[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_nullifbytes66')
    await conn.end()
    await db?.end()
  }
})

test('NULLIF DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(NULLIF(b,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f0],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f1],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(b,NULL) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f0],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f2],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(CONCAT(b),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(IF(g=1,b,'123x'),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f0],
    ["VARBINARY(60000)","SELECT CAST(NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f0],
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,NULLIF(b,_binary'zz'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f0],
    ["BLOB","SELECT CAST(NULLIF(b,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["BLOB","SELECT CAST(NULLIF(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f1],
    ["BLOB","SELECT CAST(NULLIF(b,NULL) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["BLOB","SELECT CAST(NULLIF(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f4],
    ["BLOB","SELECT CAST(NULLIF(CONCAT(b),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["BLOB","SELECT CAST(NULLIF(IF(g=1,b,'123x'),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["BLOB","SELECT CAST(NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["BLOB","SELECT CAST(IF(g=1,NULLIF(b,_binary'zz'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(b,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f1],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(b,NULL) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f4],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(CONCAT(b),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(IF(g=1,b,'123x'),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["MEDIUMBLOB","SELECT CAST(NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,NULLIF(b,_binary'zz'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["LONGBLOB","SELECT CAST(NULLIF(b,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["LONGBLOB","SELECT CAST(NULLIF(b,b) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f1],
    ["LONGBLOB","SELECT CAST(NULLIF(b,NULL) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["LONGBLOB","SELECT CAST(NULLIF(b,0) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f4],
    ["LONGBLOB","SELECT CAST(NULLIF(CONCAT(b),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["LONGBLOB","SELECT CAST(NULLIF(IF(g=1,b,'123x'),_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["LONGBLOB","SELECT CAST(NULLIF(CASE g WHEN 1 THEN b ELSE '123x' END,_binary'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
    ["LONGBLOB","SELECT CAST(IF(g=1,NULLIF(b,_binary'zz'),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o48,f3],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nulliffresh66')
    await conn.query('USE decimal_nulliffresh66')
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
    await conn.query('DROP DATABASE IF EXISTS decimal_nulliffresh66')
    await conn.end()
    await db?.end()
  }
})

test('NULLIF retains original numeric, binary, temporal and JSON readers', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown][] = [
    ["SELECT NULLIF(NULL,0) AS x",o58],
    ["SELECT CAST(NULLIF(NULL,0) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(NULL,'zz') AS x",o58],
    ["SELECT CAST(NULLIF(NULL,'zz') AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(NULL,NULL) AS x",o58],
    ["SELECT CAST(NULLIF(NULL,NULL) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(NULL,NULL) AS x",o58],
    ["SELECT CAST(NULLIF(NULL,NULL) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT IF(TRUE,NULLIF(NULL,'zz'),0e0) AS x",o60],
    ["SELECT CAST(IF(TRUE,NULLIF(NULL,'zz'),0e0) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(IF(TRUE,NULL,0e0),0) AS x",o60],
    ["SELECT CAST(NULLIF(IF(TRUE,NULL,0e0),0) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(CASE WHEN TRUE THEN NULL ELSE 0e0 END,0) AS x",o60],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN NULL ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(18446744073709551615,0) AS x",o61],
    ["SELECT CAST(NULLIF(18446744073709551615,0) AS DECIMAL(65,2)) AS x",o62],
    ["SELECT NULLIF(18446744073709551615,'zz') AS x",o63],
    ["SELECT CAST(NULLIF(18446744073709551615,'zz') AS DECIMAL(65,2)) AS x",o64],
    ["SELECT NULLIF(18446744073709551615,18446744073709551615) AS x",o65],
    ["SELECT CAST(NULLIF(18446744073709551615,18446744073709551615) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(18446744073709551615,NULL) AS x",o61],
    ["SELECT CAST(NULLIF(18446744073709551615,NULL) AS DECIMAL(65,2)) AS x",o62],
    ["SELECT IF(TRUE,NULLIF(18446744073709551615,'zz'),0e0) AS x",o66],
    ["SELECT CAST(IF(TRUE,NULLIF(18446744073709551615,'zz'),0e0) AS DECIMAL(65,2)) AS x",o64],
    ["SELECT NULLIF(IF(TRUE,18446744073709551615,0e0),0) AS x",o67],
    ["SELECT CAST(NULLIF(IF(TRUE,18446744073709551615,0e0),0) AS DECIMAL(65,2)) AS x",o62],
    ["SELECT NULLIF(CASE WHEN TRUE THEN 18446744073709551615 ELSE 0e0 END,0) AS x",o67],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN 18446744073709551615 ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o62],
    ["SELECT NULLIF(-9223372036854775808,0) AS x",o68],
    ["SELECT CAST(NULLIF(-9223372036854775808,0) AS DECIMAL(65,2)) AS x",o69],
    ["SELECT NULLIF(-9223372036854775808,'zz') AS x",o70],
    ["SELECT CAST(NULLIF(-9223372036854775808,'zz') AS DECIMAL(65,2)) AS x",o71],
    ["SELECT NULLIF(-9223372036854775808,-9223372036854775808) AS x",o72],
    ["SELECT CAST(NULLIF(-9223372036854775808,-9223372036854775808) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(-9223372036854775808,NULL) AS x",o68],
    ["SELECT CAST(NULLIF(-9223372036854775808,NULL) AS DECIMAL(65,2)) AS x",o69],
    ["SELECT IF(TRUE,NULLIF(-9223372036854775808,'zz'),0e0) AS x",o73],
    ["SELECT CAST(IF(TRUE,NULLIF(-9223372036854775808,'zz'),0e0) AS DECIMAL(65,2)) AS x",o71],
    ["SELECT NULLIF(IF(TRUE,-9223372036854775808,0e0),0) AS x",o74],
    ["SELECT CAST(NULLIF(IF(TRUE,-9223372036854775808,0e0),0) AS DECIMAL(65,2)) AS x",o69],
    ["SELECT NULLIF(CASE WHEN TRUE THEN -9223372036854775808 ELSE 0e0 END,0) AS x",o74],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN -9223372036854775808 ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o69],
    ["SELECT NULLIF(123.45,0) AS x",o75],
    ["SELECT CAST(NULLIF(123.45,0) AS DECIMAL(65,2)) AS x",o76],
    ["SELECT NULLIF(123.45,'zz') AS x",o77],
    ["SELECT CAST(NULLIF(123.45,'zz') AS DECIMAL(65,2)) AS x",o78],
    ["SELECT NULLIF(123.45,123.45) AS x",o79],
    ["SELECT CAST(NULLIF(123.45,123.45) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(123.45,NULL) AS x",o75],
    ["SELECT CAST(NULLIF(123.45,NULL) AS DECIMAL(65,2)) AS x",o76],
    ["SELECT IF(TRUE,NULLIF(123.45,'zz'),0e0) AS x",o80],
    ["SELECT CAST(IF(TRUE,NULLIF(123.45,'zz'),0e0) AS DECIMAL(65,2)) AS x",o78],
    ["SELECT NULLIF(IF(TRUE,123.45,0e0),0) AS x",o81],
    ["SELECT CAST(NULLIF(IF(TRUE,123.45,0e0),0) AS DECIMAL(65,2)) AS x",o76],
    ["SELECT NULLIF(CASE WHEN TRUE THEN 123.45 ELSE 0e0 END,0) AS x",o81],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN 123.45 ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o76],
    ["SELECT NULLIF(123e0,0) AS x",o82],
    ["SELECT CAST(NULLIF(123e0,0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(123e0,'zz') AS x",o84],
    ["SELECT CAST(NULLIF(123e0,'zz') AS DECIMAL(65,2)) AS x",o85],
    ["SELECT NULLIF(123e0,123e0) AS x",o86],
    ["SELECT CAST(NULLIF(123e0,123e0) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(123e0,NULL) AS x",o82],
    ["SELECT CAST(NULLIF(123e0,NULL) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT IF(TRUE,NULLIF(123e0,'zz'),0e0) AS x",o87],
    ["SELECT CAST(IF(TRUE,NULLIF(123e0,'zz'),0e0) AS DECIMAL(65,2)) AS x",o85],
    ["SELECT NULLIF(IF(TRUE,123e0,0e0),0) AS x",o88],
    ["SELECT CAST(NULLIF(IF(TRUE,123e0,0e0),0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(CASE WHEN TRUE THEN 123e0 ELSE 0e0 END,0) AS x",o88],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN 123e0 ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(b'00110101',0) AS x",o89],
    ["SELECT CAST(NULLIF(b'00110101',0) AS DECIMAL(65,2)) AS x",o90],
    ["SELECT NULLIF(b'00110101','zz') AS x",o89],
    ["SELECT CAST(NULLIF(b'00110101','zz') AS DECIMAL(65,2)) AS x",o90],
    ["SELECT NULLIF(b'00110101',b'00110101') AS x",o91],
    ["SELECT CAST(NULLIF(b'00110101',b'00110101') AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(b'00110101',NULL) AS x",o89],
    ["SELECT CAST(NULLIF(b'00110101',NULL) AS DECIMAL(65,2)) AS x",o90],
    ["SELECT IF(TRUE,NULLIF(b'00110101','zz'),0e0) AS x",o92],
    ["SELECT CAST(IF(TRUE,NULLIF(b'00110101','zz'),0e0) AS DECIMAL(65,2)) AS x",o90],
    ["SELECT NULLIF(IF(TRUE,b'00110101',0e0),0) AS x",o92],
    ["SELECT CAST(NULLIF(IF(TRUE,b'00110101',0e0),0) AS DECIMAL(65,2)) AS x",o90],
    ["SELECT NULLIF(CASE WHEN TRUE THEN b'00110101' ELSE 0e0 END,0) AS x",o92],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN b'00110101' ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o90],
    ["SELECT NULLIF(X'31323378',0) AS x",o93],
    ["SELECT CAST(NULLIF(X'31323378',0) AS DECIMAL(65,2)) AS x",o94],
    ["SELECT NULLIF(X'31323378','zz') AS x",o93],
    ["SELECT CAST(NULLIF(X'31323378','zz') AS DECIMAL(65,2)) AS x",o94],
    ["SELECT NULLIF(X'31323378',X'31323378') AS x",o95],
    ["SELECT CAST(NULLIF(X'31323378',X'31323378') AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(X'31323378',NULL) AS x",o93],
    ["SELECT CAST(NULLIF(X'31323378',NULL) AS DECIMAL(65,2)) AS x",o94],
    ["SELECT IF(TRUE,NULLIF(X'31323378','zz'),0e0) AS x",o96],
    ["SELECT CAST(IF(TRUE,NULLIF(X'31323378','zz'),0e0) AS DECIMAL(65,2)) AS x",o94],
    ["SELECT NULLIF(IF(TRUE,X'31323378',0e0),0) AS x",o96],
    ["SELECT CAST(NULLIF(IF(TRUE,X'31323378',0e0),0) AS DECIMAL(65,2)) AS x",o94],
    ["SELECT NULLIF(CASE WHEN TRUE THEN X'31323378' ELSE 0e0 END,0) AS x",o96],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN X'31323378' ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o94],
    ["SELECT NULLIF(_binary'123x',0) AS x",o97],
    ["SELECT CAST(NULLIF(_binary'123x',0) AS DECIMAL(65,2)) AS x",o98],
    ["SELECT NULLIF(_binary'123x','zz') AS x",o96],
    ["SELECT CAST(NULLIF(_binary'123x','zz') AS DECIMAL(65,2)) AS x",o99],
    ["SELECT NULLIF(_binary'123x',_binary'123x') AS x",o100],
    ["SELECT CAST(NULLIF(_binary'123x',_binary'123x') AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(_binary'123x',NULL) AS x",o96],
    ["SELECT CAST(NULLIF(_binary'123x',NULL) AS DECIMAL(65,2)) AS x",o99],
    ["SELECT IF(TRUE,NULLIF(_binary'123x','zz'),0e0) AS x",o96],
    ["SELECT CAST(IF(TRUE,NULLIF(_binary'123x','zz'),0e0) AS DECIMAL(65,2)) AS x",o99],
    ["SELECT NULLIF(IF(TRUE,_binary'123x',0e0),0) AS x",o97],
    ["SELECT CAST(NULLIF(IF(TRUE,_binary'123x',0e0),0) AS DECIMAL(65,2)) AS x",o98],
    ["SELECT NULLIF(CASE WHEN TRUE THEN _binary'123x' ELSE 0e0 END,0) AS x",o97],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN _binary'123x' ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o98],
    ["SELECT NULLIF('123x',0) AS x",o101],
    ["SELECT CAST(NULLIF('123x',0) AS DECIMAL(65,2)) AS x",o98],
    ["SELECT NULLIF('123x','zz') AS x",o102],
    ["SELECT CAST(NULLIF('123x','zz') AS DECIMAL(65,2)) AS x",o99],
    ["SELECT NULLIF('123x','123x') AS x",o103],
    ["SELECT CAST(NULLIF('123x','123x') AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF('123x',NULL) AS x",o102],
    ["SELECT CAST(NULLIF('123x',NULL) AS DECIMAL(65,2)) AS x",o99],
    ["SELECT IF(TRUE,NULLIF('123x','zz'),0e0) AS x",o104],
    ["SELECT CAST(IF(TRUE,NULLIF('123x','zz'),0e0) AS DECIMAL(65,2)) AS x",o99],
    ["SELECT NULLIF(IF(TRUE,'123x',0e0),0) AS x",o105],
    ["SELECT CAST(NULLIF(IF(TRUE,'123x',0e0),0) AS DECIMAL(65,2)) AS x",o98],
    ["SELECT NULLIF(CASE WHEN TRUE THEN '123x' ELSE 0e0 END,0) AS x",o105],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN '123x' ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o98],
    ["SELECT NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),0) AS x",o106],
    ["SELECT CAST(NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),0) AS DECIMAL(65,2)) AS x",o107],
    ["SELECT NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),'zz') AS x",o108],
    ["SELECT CAST(NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),'zz') AS DECIMAL(65,2)) AS x",o108],
    ["SELECT NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))) AS x",o109],
    ["SELECT CAST(NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),CAST('2026-10-11 12:34:56.123456' AS DATETIME(6))) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),NULL) AS x",o106],
    ["SELECT CAST(NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),NULL) AS DECIMAL(65,2)) AS x",o107],
    ["SELECT IF(TRUE,NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),'zz'),0e0) AS x",o108],
    ["SELECT CAST(IF(TRUE,NULLIF(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),'zz'),0e0) AS DECIMAL(65,2)) AS x",o108],
    ["SELECT NULLIF(IF(TRUE,CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),0e0),0) AS x",o106],
    ["SELECT CAST(NULLIF(IF(TRUE,CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)),0e0),0) AS DECIMAL(65,2)) AS x",o107],
    ["SELECT NULLIF(CASE WHEN TRUE THEN CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) ELSE 0e0 END,0) AS x",o106],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o107],
    ["SELECT NULLIF(CAST('12:34:56.123456' AS TIME(6)),0) AS x",o110],
    ["SELECT CAST(NULLIF(CAST('12:34:56.123456' AS TIME(6)),0) AS DECIMAL(65,2)) AS x",o111],
    ["SELECT NULLIF(CAST('12:34:56.123456' AS TIME(6)),'zz') AS x",o110],
    ["SELECT CAST(NULLIF(CAST('12:34:56.123456' AS TIME(6)),'zz') AS DECIMAL(65,2)) AS x",o111],
    ["SELECT NULLIF(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))) AS x",o112],
    ["SELECT CAST(NULLIF(CAST('12:34:56.123456' AS TIME(6)),CAST('12:34:56.123456' AS TIME(6))) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(CAST('12:34:56.123456' AS TIME(6)),NULL) AS x",o110],
    ["SELECT CAST(NULLIF(CAST('12:34:56.123456' AS TIME(6)),NULL) AS DECIMAL(65,2)) AS x",o111],
    ["SELECT IF(TRUE,NULLIF(CAST('12:34:56.123456' AS TIME(6)),'zz'),0e0) AS x",o113],
    ["SELECT CAST(IF(TRUE,NULLIF(CAST('12:34:56.123456' AS TIME(6)),'zz'),0e0) AS DECIMAL(65,2)) AS x",o111],
    ["SELECT NULLIF(IF(TRUE,CAST('12:34:56.123456' AS TIME(6)),0e0),0) AS x",o113],
    ["SELECT CAST(NULLIF(IF(TRUE,CAST('12:34:56.123456' AS TIME(6)),0e0),0) AS DECIMAL(65,2)) AS x",o111],
    ["SELECT NULLIF(CASE WHEN TRUE THEN CAST('12:34:56.123456' AS TIME(6)) ELSE 0e0 END,0) AS x",o113],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN CAST('12:34:56.123456' AS TIME(6)) ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o111],
    ["SELECT NULLIF(CAST('2026-10-11' AS DATE),0) AS x",o114],
    ["SELECT CAST(NULLIF(CAST('2026-10-11' AS DATE),0) AS DECIMAL(65,2)) AS x",o115],
    ["SELECT NULLIF(CAST('2026-10-11' AS DATE),'zz') AS x",o116],
    ["SELECT CAST(NULLIF(CAST('2026-10-11' AS DATE),'zz') AS DECIMAL(65,2)) AS x",o116],
    ["SELECT NULLIF(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)) AS x",o117],
    ["SELECT CAST(NULLIF(CAST('2026-10-11' AS DATE),CAST('2026-10-11' AS DATE)) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(CAST('2026-10-11' AS DATE),NULL) AS x",o114],
    ["SELECT CAST(NULLIF(CAST('2026-10-11' AS DATE),NULL) AS DECIMAL(65,2)) AS x",o115],
    ["SELECT IF(TRUE,NULLIF(CAST('2026-10-11' AS DATE),'zz'),0e0) AS x",o116],
    ["SELECT CAST(IF(TRUE,NULLIF(CAST('2026-10-11' AS DATE),'zz'),0e0) AS DECIMAL(65,2)) AS x",o116],
    ["SELECT NULLIF(IF(TRUE,CAST('2026-10-11' AS DATE),0e0),0) AS x",o118],
    ["SELECT CAST(NULLIF(IF(TRUE,CAST('2026-10-11' AS DATE),0e0),0) AS DECIMAL(65,2)) AS x",o115],
    ["SELECT NULLIF(CASE WHEN TRUE THEN CAST('2026-10-11' AS DATE) ELSE 0e0 END,0) AS x",o118],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN CAST('2026-10-11' AS DATE) ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o115],
    ["SELECT NULLIF(CAST('123' AS JSON),0) AS x",o119],
    ["SELECT CAST(NULLIF(CAST('123' AS JSON),0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(CAST('123' AS JSON),'zz') AS x",o119],
    ["SELECT CAST(NULLIF(CAST('123' AS JSON),'zz') AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(CAST('123' AS JSON),CAST('123' AS JSON)) AS x",o120],
    ["SELECT CAST(NULLIF(CAST('123' AS JSON),CAST('123' AS JSON)) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(CAST('123' AS JSON),NULL) AS x",o119],
    ["SELECT CAST(NULLIF(CAST('123' AS JSON),NULL) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT IF(TRUE,NULLIF(CAST('123' AS JSON),'zz'),0e0) AS x",o121],
    ["SELECT CAST(IF(TRUE,NULLIF(CAST('123' AS JSON),'zz'),0e0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(IF(TRUE,CAST('123' AS JSON),0e0),0) AS x",o121],
    ["SELECT CAST(NULLIF(IF(TRUE,CAST('123' AS JSON),0e0),0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(CASE WHEN TRUE THEN CAST('123' AS JSON) ELSE 0e0 END,0) AS x",o121],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN CAST('123' AS JSON) ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o83],
    ["SELECT NULLIF(CAST('true' AS JSON),0) AS x",o122],
    ["SELECT CAST(NULLIF(CAST('true' AS JSON),0) AS DECIMAL(65,2)) AS x",o123],
    ["SELECT NULLIF(CAST('true' AS JSON),'zz') AS x",o122],
    ["SELECT CAST(NULLIF(CAST('true' AS JSON),'zz') AS DECIMAL(65,2)) AS x",o123],
    ["SELECT NULLIF(CAST('true' AS JSON),CAST('true' AS JSON)) AS x",o120],
    ["SELECT CAST(NULLIF(CAST('true' AS JSON),CAST('true' AS JSON)) AS DECIMAL(65,2)) AS x",o59],
    ["SELECT NULLIF(CAST('true' AS JSON),NULL) AS x",o122],
    ["SELECT CAST(NULLIF(CAST('true' AS JSON),NULL) AS DECIMAL(65,2)) AS x",o123],
    ["SELECT IF(TRUE,NULLIF(CAST('true' AS JSON),'zz'),0e0) AS x",o124],
    ["SELECT CAST(IF(TRUE,NULLIF(CAST('true' AS JSON),'zz'),0e0) AS DECIMAL(65,2)) AS x",o123],
    ["SELECT NULLIF(IF(TRUE,CAST('true' AS JSON),0e0),0) AS x",o124],
    ["SELECT CAST(NULLIF(IF(TRUE,CAST('true' AS JSON),0e0),0) AS DECIMAL(65,2)) AS x",o123],
    ["SELECT NULLIF(CASE WHEN TRUE THEN CAST('true' AS JSON) ELSE 0e0 END,0) AS x",o124],
    ["SELECT CAST(NULLIF(CASE WHEN TRUE THEN CAST('true' AS JSON) ELSE 0e0 END,0) AS DECIMAL(65,2)) AS x",o123],
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

test('NULLIF preserves constant replacement and temporal result conversion', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown][] = [
    ["SELECT NULLIF('00123',n) AS x FROM t ORDER BY id",o125],
    ["SELECT CAST(NULLIF('00123',n) AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o126],
    ["SELECT NULLIF('2026-10-11',d) AS x FROM t ORDER BY id",o127],
    ["SELECT CAST(NULLIF('2026-10-11',d) AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o128],
    ["SELECT NULLIF('2026-10-11 00:00:00',d) AS x FROM t ORDER BY id",o129],
    ["SELECT CAST(NULLIF('2026-10-11 00:00:00',d) AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o130],
    ["SELECT NULLIF('2026',y) AS x FROM t ORDER BY id",o131],
    ["SELECT CAST(NULLIF('2026',y) AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o132],
    ["SELECT NULLIF(18446744073709551615,n) AS x FROM t ORDER BY id",o133],
    ["SELECT CAST(NULLIF(18446744073709551615,n) AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o134],
    ["SELECT NULLIF(d,'2026-10-11') AS x FROM t ORDER BY id",o135],
    ["SELECT CAST(NULLIF(d,'2026-10-11') AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o136],
    ["SELECT NULLIF(y,2026) AS x FROM t ORDER BY id",o137],
    ["SELECT CAST(NULLIF(y,2026) AS DECIMAL(65,2)) AS x FROM t ORDER BY id",o138],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_nullifconstant66')
    await conn.query('USE decimal_nullifconstant66')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,n BIGINT,d DATE,y YEAR)')
    await conn.query("INSERT INTO t VALUES(1,123,'2026-10-11',2026),(2,124,'2026-10-12',2027),(3,NULL,NULL,NULL)")
    for (const [sql,result] of fixtures) {
      for (const method of ['query','execute'] as const) {
        await conn.query('DO 0')
        assert.deepEqual(await outcome(conn,sql,method),result,method + ': ' + sql)
      }
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_nullifconstant66')
    await conn.end()
    await db?.end()
  }
})
