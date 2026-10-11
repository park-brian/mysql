// Native MySQL 8.4.11 snapshots: complete values, fields and ordered diagnostics.
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

test('nonbinary INTEGER casts retain native empty whitespace control and numeric diagnostics', async () => {
  const { db, conn } = await connect()
  // Whole diagnostic cap/utf8mb3 formatting groups remain a separate reader boundary.
  const inputs: [number, string][] = [
    [0,""],
    [1,"20"],
    [2,"090a0d"],
    [3,"0b0c"],
    [4,"616263"],
    [5,"313233"],
    [6,"3132332e34"],
    [7,"c3a9"],
    [8,"00c3a9"],
    [9,"275c"],
    [10,"4100"],
    [11,"4101"],
    [12,"4102"],
    [13,"4103"],
    [14,"4104"],
    [15,"4105"],
    [16,"4106"],
    [17,"4107"],
    [18,"4108"],
    [19,"4109"],
    [20,"410a"],
    [21,"410b"],
    [22,"410c"],
    [23,"410d"],
    [24,"410e"],
    [25,"410f"],
    [26,"4110"],
    [27,"4111"],
    [28,"4112"],
    [29,"4113"],
    [30,"4114"],
    [31,"4115"],
    [32,"4116"],
    [33,"4117"],
    [34,"4118"],
    [35,"4119"],
    [36,"411a"],
    [37,"411b"],
    [38,"411c"],
    [39,"411d"],
    [40,"411e"],
    [41,"411f"],
  ]
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(_utf8mb4 X'' AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
    ["SELECT CAST(_utf8mb4 X'20' AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
    ["SELECT CAST(_utf8mb4 X'090a0d' AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
    ["SELECT CAST(_utf8mb4 X'0b0c' AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"}]],
    ["SELECT CAST(_utf8mb4 X'616263' AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=5",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=5",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=5",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'313233' AS SIGNED) AS x FROM t WHERE id=5",[[123]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.4'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.4'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.4'"}]],
    ["SELECT CAST(_utf8mb4 X'3132332e34' AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.4'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
    ["SELECT CAST(_utf8mb4 X'c3a9' AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(_utf8mb4 X'00c3a9' AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''\\'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''\\'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''\\'"}]],
    ["SELECT CAST(_utf8mb4 X'275c' AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''\\'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A'"}]],
    ["SELECT CAST(_utf8mb4 X'4100' AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0001'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0001'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0001'"}]],
    ["SELECT CAST(_utf8mb4 X'4101' AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0001'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0002'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0002'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0002'"}]],
    ["SELECT CAST(_utf8mb4 X'4102' AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0002'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0003'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0003'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0003'"}]],
    ["SELECT CAST(_utf8mb4 X'4103' AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0003'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0004'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0004'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0004'"}]],
    ["SELECT CAST(_utf8mb4 X'4104' AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0004'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0005'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0005'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0005'"}]],
    ["SELECT CAST(_utf8mb4 X'4105' AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0005'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=16",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0006'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=16",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0006'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=16",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0006'"}]],
    ["SELECT CAST(_utf8mb4 X'4106' AS SIGNED) AS x FROM t WHERE id=16",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0006'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=17",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0007'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=17",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0007'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=17",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0007'"}]],
    ["SELECT CAST(_utf8mb4 X'4107' AS SIGNED) AS x FROM t WHERE id=17",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0007'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=18",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\b'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=18",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\b'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=18",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\b'"}]],
    ["SELECT CAST(_utf8mb4 X'4108' AS SIGNED) AS x FROM t WHERE id=18",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\b'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=19",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\t'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=19",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\t'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=19",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\t'"}]],
    ["SELECT CAST(_utf8mb4 X'4109' AS SIGNED) AS x FROM t WHERE id=19",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\t'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=20",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\n'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=20",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\n'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=20",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\n'"}]],
    ["SELECT CAST(_utf8mb4 X'410a' AS SIGNED) AS x FROM t WHERE id=20",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\n'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=21",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000b'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=21",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000b'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=21",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000b'"}]],
    ["SELECT CAST(_utf8mb4 X'410b' AS SIGNED) AS x FROM t WHERE id=21",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000b'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=22",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\f'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=22",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\f'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=22",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\f'"}]],
    ["SELECT CAST(_utf8mb4 X'410c' AS SIGNED) AS x FROM t WHERE id=22",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\f'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=23",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\r'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=23",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\r'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=23",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\r'"}]],
    ["SELECT CAST(_utf8mb4 X'410d' AS SIGNED) AS x FROM t WHERE id=23",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\r'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=24",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000e'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=24",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000e'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=24",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000e'"}]],
    ["SELECT CAST(_utf8mb4 X'410e' AS SIGNED) AS x FROM t WHERE id=24",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000e'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=25",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000f'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=25",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000f'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=25",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000f'"}]],
    ["SELECT CAST(_utf8mb4 X'410f' AS SIGNED) AS x FROM t WHERE id=25",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u000f'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=26",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0010'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=26",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0010'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=26",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0010'"}]],
    ["SELECT CAST(_utf8mb4 X'4110' AS SIGNED) AS x FROM t WHERE id=26",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0010'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=27",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0011'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=27",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0011'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=27",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0011'"}]],
    ["SELECT CAST(_utf8mb4 X'4111' AS SIGNED) AS x FROM t WHERE id=27",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0011'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0012'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0012'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0012'"}]],
    ["SELECT CAST(_utf8mb4 X'4112' AS SIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0012'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=29",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0013'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=29",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0013'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=29",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0013'"}]],
    ["SELECT CAST(_utf8mb4 X'4113' AS SIGNED) AS x FROM t WHERE id=29",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0013'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=30",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0014'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=30",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0014'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=30",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0014'"}]],
    ["SELECT CAST(_utf8mb4 X'4114' AS SIGNED) AS x FROM t WHERE id=30",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0014'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=31",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0015'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=31",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0015'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=31",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0015'"}]],
    ["SELECT CAST(_utf8mb4 X'4115' AS SIGNED) AS x FROM t WHERE id=31",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0015'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=32",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0016'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=32",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0016'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=32",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0016'"}]],
    ["SELECT CAST(_utf8mb4 X'4116' AS SIGNED) AS x FROM t WHERE id=32",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0016'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=33",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0017'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=33",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0017'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=33",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0017'"}]],
    ["SELECT CAST(_utf8mb4 X'4117' AS SIGNED) AS x FROM t WHERE id=33",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0017'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=34",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0018'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=34",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0018'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=34",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0018'"}]],
    ["SELECT CAST(_utf8mb4 X'4118' AS SIGNED) AS x FROM t WHERE id=34",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0018'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=35",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0019'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=35",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0019'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=35",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0019'"}]],
    ["SELECT CAST(_utf8mb4 X'4119' AS SIGNED) AS x FROM t WHERE id=35",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u0019'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=36",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001a'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=36",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001a'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=36",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001a'"}]],
    ["SELECT CAST(_utf8mb4 X'411a' AS SIGNED) AS x FROM t WHERE id=36",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001a'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=37",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001b'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=37",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001b'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=37",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001b'"}]],
    ["SELECT CAST(_utf8mb4 X'411b' AS SIGNED) AS x FROM t WHERE id=37",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001b'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=38",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001c'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=38",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001c'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=38",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001c'"}]],
    ["SELECT CAST(_utf8mb4 X'411c' AS SIGNED) AS x FROM t WHERE id=38",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001c'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=39",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001d'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=39",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001d'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=39",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001d'"}]],
    ["SELECT CAST(_utf8mb4 X'411d' AS SIGNED) AS x FROM t WHERE id=39",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001d'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=40",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001e'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=40",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001e'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=40",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001e'"}]],
    ["SELECT CAST(_utf8mb4 X'411e' AS SIGNED) AS x FROM t WHERE id=40",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001e'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=41",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001f'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=41",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001f'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=41",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001f'"}]],
    ["SELECT CAST(_utf8mb4 X'411f' AS SIGNED) AS x FROM t WHERE id=41",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'A\u001f'"}]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_text_controls')
    await conn.query('USE integer_text_controls')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,s VARCHAR(1024))')
    for (const [id, hex] of inputs) await conn.query('INSERT INTO t VALUES(?,?)', [id, Buffer.from(hex, 'hex')])
    for (const [sql, expectedRows, expectedFields, warnings] of fixtures) {
      const options = { sql, rowsAsArray: true }
      for (const method of ['query', 'execute'] as const) {
        const [actual, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(actual, expectedRows, method + ': rows: ' + sql)
        assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE integer_text_controls')
    await conn.end()
    await db?.end()
  }
})

test('INTEGER casts read every text class through fresh cached execution after writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[][], unknown[], [string | null, unknown[][], unknown[], unknown[]][]][] = [
    ["VARCHAR(10)", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(10)", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(10)", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(10)", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(1024)", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(1024)", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(1024)", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(1024)", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["CHAR(8)", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["CHAR(8)", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["CHAR(8)", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["CHAR(8)", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TINYTEXT", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TINYTEXT", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TINYTEXT", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TINYTEXT", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TEXT", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TEXT", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TEXT", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["TEXT", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMTEXT", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMTEXT", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMTEXT", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMTEXT", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGTEXT", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGTEXT", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGTEXT", "SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGTEXT", "SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
      ["0B0C",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
      ["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
      ["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_text_fresh')
    await conn.query('USE integer_text_fresh')
    for (const [type, sql, expectedFields, prepareWarnings, writes] of fixtures) {
      await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b ' + type + ')')
      await conn.query("INSERT INTO t VALUES(1,X'31'),(2,X'31'),(3,NULL)")
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const prepared = statement as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual(fields(prepared.statement.columns), expectedFields, 'prepare: ' + type + ': ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], prepareWarnings, 'prepare warnings: ' + sql)
        for (const [hex, expectedRows, expectedObjects, warnings] of writes) {
          await conn.query('UPDATE t SET b=? WHERE id=2', [hex === null ? null : Buffer.from(hex, 'hex')])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [actual, columns] = method === 'statement' ? await statement.execute([1,1]) : method === 'query' ? await conn.query(options, [1,1]) : await conn.execute(options, [1,1])
            assert.deepEqual(actual, method === 'statement' ? expectedObjects : expectedRows, method + ': rows: ' + type + ': ' + sql)
            assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
          }
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE integer_text_fresh')
    await conn.end()
    await db?.end()
  }
})

test('INTEGER text cast warning policy preserves short query string and Buffer parameters', async () => {
  const { db, conn } = await connect()
  // Expected execute parameter metadata and long diagnostic caps remain separate.
  const values = [""," ","\t\n\r","\u000b\f","abc","123","123.4","é","\u0000é"]
  const fixtures: [string, number, boolean, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=0",0,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=0",0,true,[[0]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=0",0,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=0",0,true,[[0]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=1",1,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=1",1,true,[[32]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=1",1,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=1",1,true,[[32]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=2",2,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=2",2,true,[[592397]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=2",2,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\t\n\r'"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=2",2,true,[[592397]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=3",3,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=3",3,true,[[2828]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=3",3,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b\f'"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=3",3,true,[[2828]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=4",4,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=4",4,true,[[6382179]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=4",4,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc'"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=4",4,true,[[6382179]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=5",5,false,[[123]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=5",5,true,[[3224115]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=5",5,false,[[123]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=5",5,true,[[3224115]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=6",6,false,[[123]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.4'"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=6",6,true,[[211295612468]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=6",6,false,[[123]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123.4'"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=6",6,true,[[211295612468]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=7",7,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=7",7,true,[[50089]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=7",7,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'é'"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=7",7,true,[[50089]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=8",8,false,[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(? AS SIGNED) AS x FROM t WHERE id=8",8,true,[[50089]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=8",8,false,[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(? AS UNSIGNED) AS x FROM t WHERE id=8",8,true,[[50089]],[["x",8,21,161,0,63,"","","",""]],[]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_text_parameters')
    await conn.query('USE integer_text_parameters')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY)')
    for (let id = 0; id < values.length; id++) await conn.query('INSERT INTO t VALUES(?)', [id])
    for (const [sql, id, binary, expectedRows, expectedFields, warnings] of fixtures) {
      const value = values[id] as string
      const [actual, columns] = await conn.query({ sql, rowsAsArray: true }, [binary ? Buffer.from(value) : value])
      assert.deepEqual(actual, expectedRows, 'rows: ' + sql)
      assert.deepEqual(fields(columns), expectedFields, 'fields: ' + sql)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, 'warnings: ' + sql)
    }
  } finally {
    await conn.query('DROP DATABASE integer_text_parameters')
    await conn.end()
    await db?.end()
  }
})
