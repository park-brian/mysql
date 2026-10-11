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

test("INTEGER CAST complement warnings use original text ranges and preserve numeric HEX BIT quietness", async () => {
  const { db, conn } = await connect()
  // Entire negative-zero and numeric-overflow-literal groups remain open.
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=0",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=0",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=0",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=0",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=0",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=0",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(_binary X'2d39323233333732303336383534373735383039' AS SIGNED) AS x FROM t WHERE id=0",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(_binary X'2d39323233333732303336383534373735383039' AS UNSIGNED) AS x FROM t WHERE id=0",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(_utf8mb4 X'2d39323233333732303336383534373735383039' AS SIGNED) AS x FROM t WHERE id=0",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(_utf8mb4 X'2d39323233333732303336383534373735383039' AS UNSIGNED) AS x FROM t WHERE id=0",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=1",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=1",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=1",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=1",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=1",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=1",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'2d39323233333732303336383534373735383038' AS SIGNED) AS x FROM t WHERE id=1",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'2d39323233333732303336383534373735383038' AS UNSIGNED) AS x FROM t WHERE id=1",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'2d39323233333732303336383534373735383038' AS SIGNED) AS x FROM t WHERE id=1",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'2d39323233333732303336383534373735383038' AS UNSIGNED) AS x FROM t WHERE id=1",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=2",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=2",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=2",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=2",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=2",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=2",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'2d39323233333732303336383534373735383037' AS SIGNED) AS x FROM t WHERE id=2",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'2d39323233333732303336383534373735383037' AS UNSIGNED) AS x FROM t WHERE id=2",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'2d39323233333732303336383534373735383037' AS SIGNED) AS x FROM t WHERE id=2",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'2d39323233333732303336383534373735383037' AS UNSIGNED) AS x FROM t WHERE id=2",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[-1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=3",[[-1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=3",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=3",[[-1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=3",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=3",[[-1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=3",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'2d31' AS SIGNED) AS x FROM t WHERE id=3",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'2d31' AS UNSIGNED) AS x FROM t WHERE id=3",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'2d31' AS SIGNED) AS x FROM t WHERE id=3",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'2d31' AS UNSIGNED) AS x FROM t WHERE id=3",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'30' AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'30' AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'30' AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'30' AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'39323233333732303336383534373735383037' AS SIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'39323233333732303336383534373735383037' AS UNSIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'39323233333732303336383534373735383037' AS SIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'39323233333732303336383534373735383037' AS UNSIGNED) AS x FROM t WHERE id=5",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=6",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=6",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=6",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=6",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=6",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=6",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'39323233333732303336383534373735383038' AS SIGNED) AS x FROM t WHERE id=6",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'39323233333732303336383534373735383038' AS UNSIGNED) AS x FROM t WHERE id=6",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'39323233333732303336383534373735383038' AS SIGNED) AS x FROM t WHERE id=6",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'39323233333732303336383534373735383038' AS UNSIGNED) AS x FROM t WHERE id=6",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=7",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=7",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=7",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=7",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=7",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=7",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'3138343436373434303733373039353531363135' AS SIGNED) AS x FROM t WHERE id=7",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'3138343436373434303733373039353531363135' AS UNSIGNED) AS x FROM t WHERE id=7",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'3138343436373434303733373039353531363135' AS SIGNED) AS x FROM t WHERE id=7",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'3138343436373434303733373039353531363135' AS UNSIGNED) AS x FROM t WHERE id=7",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=8",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=8",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=8",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=8",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=8",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=8",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(_binary X'3138343436373434303733373039353531363136' AS SIGNED) AS x FROM t WHERE id=8",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(_binary X'3138343436373434303733373039353531363136' AS UNSIGNED) AS x FROM t WHERE id=8",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(_utf8mb4 X'3138343436373434303733373039353531363136' AS SIGNED) AS x FROM t WHERE id=8",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(_utf8mb4 X'3138343436373434303733373039353531363136' AS UNSIGNED) AS x FROM t WHERE id=8",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=9",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=9",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=9",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=9",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=9",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=9",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(_binary X'393939393939393939393939393939393939393939393939' AS SIGNED) AS x FROM t WHERE id=9",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(_binary X'393939393939393939393939393939393939393939393939' AS UNSIGNED) AS x FROM t WHERE id=9",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(_utf8mb4 X'393939393939393939393939393939393939393939393939' AS SIGNED) AS x FROM t WHERE id=9",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(_utf8mb4 X'393939393939393939393939393939393939393939393939' AS UNSIGNED) AS x FROM t WHERE id=9",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '999999999999999999999999'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=10",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=10",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=10",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=10",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=10",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=10",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
    ["SELECT CAST(_binary X'3932323333373230333638353437373538303878' AS SIGNED) AS x FROM t WHERE id=10",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'3932323333373230333638353437373538303878' AS UNSIGNED) AS x FROM t WHERE id=10",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
    ["SELECT CAST(_utf8mb4 X'3932323333373230333638353437373538303878' AS SIGNED) AS x FROM t WHERE id=10",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'3932323333373230333638353437373538303878' AS UNSIGNED) AS x FROM t WHERE id=10",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=11",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=11",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=11",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(_binary X'313834343637343430373337303935353136313678' AS SIGNED) AS x FROM t WHERE id=11",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(_binary X'313834343637343430373337303935353136313678' AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(_utf8mb4 X'313834343637343430373337303935353136313678' AS SIGNED) AS x FROM t WHERE id=11",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(_utf8mb4 X'313834343637343430373337303935353136313678' AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616x'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=12",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=12",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=12",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=12",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=12",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=12",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"}]],
    ["SELECT CAST(_binary X'393232333337323033363835343737353830382e30' AS SIGNED) AS x FROM t WHERE id=12",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'393232333337323033363835343737353830382e30' AS UNSIGNED) AS x FROM t WHERE id=12",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"}]],
    ["SELECT CAST(_utf8mb4 X'393232333337323033363835343737353830382e30' AS SIGNED) AS x FROM t WHERE id=12",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'393232333337323033363835343737353830382e30' AS UNSIGNED) AS x FROM t WHERE id=12",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.0'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=13",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=13",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=13",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=13",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=13",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=13",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=13",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=13",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(_binary X'31383434363734343037333730393535313631362e30' AS SIGNED) AS x FROM t WHERE id=13",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(_binary X'31383434363734343037333730393535313631362e30' AS UNSIGNED) AS x FROM t WHERE id=13",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(_utf8mb4 X'31383434363734343037333730393535313631362e30' AS SIGNED) AS x FROM t WHERE id=13",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(_utf8mb4 X'31383434363734343037333730393535313631362e30' AS UNSIGNED) AS x FROM t WHERE id=13",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616.0'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=14",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=14",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=14",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=14",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=14",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=14",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=14",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=14",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(_binary X'203138343436373434303733373039353531363136' AS SIGNED) AS x FROM t WHERE id=14",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(_binary X'203138343436373434303733373039353531363136' AS UNSIGNED) AS x FROM t WHERE id=14",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(_utf8mb4 X'203138343436373434303733373039353531363136' AS SIGNED) AS x FROM t WHERE id=14",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(_utf8mb4 X'203138343436373434303733373039353531363136' AS UNSIGNED) AS x FROM t WHERE id=14",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' 18446744073709551616'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=15",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=15",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=15",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=15",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=15",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=15",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=15",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=15",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(_binary X'2b3138343436373434303733373039353531363136' AS SIGNED) AS x FROM t WHERE id=15",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(_binary X'2b3138343436373434303733373039353531363136' AS UNSIGNED) AS x FROM t WHERE id=15",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(_utf8mb4 X'2b3138343436373434303733373039353531363136' AS SIGNED) AS x FROM t WHERE id=15",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(_utf8mb4 X'2b3138343436373434303733373039353531363136' AS UNSIGNED) AS x FROM t WHERE id=15",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(_binary X'3165343030' AS SIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(_binary X'3165343030' AS UNSIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(_utf8mb4 X'3165343030' AS SIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(_utf8mb4 X'3165343030' AS UNSIGNED) AS x FROM t WHERE id=17",[[1]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1e400'"}]],
    ["SELECT CAST(X'7FFFFFFFFFFFFFFF' AS SIGNED) AS x",[[9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(X'7FFFFFFFFFFFFFFF' AS UNSIGNED) AS x",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(X'8000000000000000' AS SIGNED) AS x",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(X'8000000000000000' AS UNSIGNED) AS x",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(X'FFFFFFFFFFFFFFFF' AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(X'FFFFFFFFFFFFFFFF' AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(B'1111111111111111111111111111111111111111111111111111111111111111' AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(B'1111111111111111111111111111111111111111111111111111111111111111' AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'FFFFFFFFFFFFFFFF' AS SIGNED) AS x",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF'"}]],
    ["SELECT CAST(_binary X'FFFFFFFFFFFFFFFF' AS UNSIGNED) AS x",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF'"}]],
    ["SELECT CAST(CAST(18446744073709551615 AS UNSIGNED) AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(CAST(18446744073709551615 AS UNSIGNED) AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(18446744073709551615 AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(18446744073709551615 AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
  ]
  try {
    await conn.query("CREATE DATABASE integer_bounds60")
    await conn.query("USE integer_bounds60")
    await conn.query("CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(1024),s VARCHAR(1024))")
    await conn.query("INSERT INTO t VALUES(0,X'2d39323233333732303336383534373735383039',_utf8mb4 X'2d39323233333732303336383534373735383039')")
    await conn.query("INSERT INTO t VALUES(1,X'2d39323233333732303336383534373735383038',_utf8mb4 X'2d39323233333732303336383534373735383038')")
    await conn.query("INSERT INTO t VALUES(2,X'2d39323233333732303336383534373735383037',_utf8mb4 X'2d39323233333732303336383534373735383037')")
    await conn.query("INSERT INTO t VALUES(3,X'2d31',_utf8mb4 X'2d31')")
    await conn.query("INSERT INTO t VALUES(4,X'30',_utf8mb4 X'30')")
    await conn.query("INSERT INTO t VALUES(5,X'39323233333732303336383534373735383037',_utf8mb4 X'39323233333732303336383534373735383037')")
    await conn.query("INSERT INTO t VALUES(6,X'39323233333732303336383534373735383038',_utf8mb4 X'39323233333732303336383534373735383038')")
    await conn.query("INSERT INTO t VALUES(7,X'3138343436373434303733373039353531363135',_utf8mb4 X'3138343436373434303733373039353531363135')")
    await conn.query("INSERT INTO t VALUES(8,X'3138343436373434303733373039353531363136',_utf8mb4 X'3138343436373434303733373039353531363136')")
    await conn.query("INSERT INTO t VALUES(9,X'393939393939393939393939393939393939393939393939',_utf8mb4 X'393939393939393939393939393939393939393939393939')")
    await conn.query("INSERT INTO t VALUES(10,X'3932323333373230333638353437373538303878',_utf8mb4 X'3932323333373230333638353437373538303878')")
    await conn.query("INSERT INTO t VALUES(11,X'313834343637343430373337303935353136313678',_utf8mb4 X'313834343637343430373337303935353136313678')")
    await conn.query("INSERT INTO t VALUES(12,X'393232333337323033363835343737353830382e30',_utf8mb4 X'393232333337323033363835343737353830382e30')")
    await conn.query("INSERT INTO t VALUES(13,X'31383434363734343037333730393535313631362e30',_utf8mb4 X'31383434363734343037333730393535313631362e30')")
    await conn.query("INSERT INTO t VALUES(14,X'203138343436373434303733373039353531363136',_utf8mb4 X'203138343436373434303733373039353531363136')")
    await conn.query("INSERT INTO t VALUES(15,X'2b3138343436373434303733373039353531363136',_utf8mb4 X'2b3138343436373434303733373039353531363136')")
    await conn.query("INSERT INTO t VALUES(17,X'3165343030',_utf8mb4 X'3165343030')")
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
    await conn.query("DROP DATABASE integer_bounds60")
    await conn.end()
    await db?.end()
  }
})

test("INTEGER CAST range warnings preserve tails fractions exponents signs and long digits", async () => {
  const { db, conn } = await connect()
  // Entire negative-zero and numeric-overflow-literal groups remain open.
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'2b30' AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'2b30' AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'2b30' AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'2b30' AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(_binary X'2d2e35' AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(_binary X'2d2e35' AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(_utf8mb4 X'2d2e35' AS SIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(_utf8mb4 X'2d2e35' AS UNSIGNED) AS x FROM t WHERE id=7",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-.5'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(_binary X'2e35' AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(_binary X'2e35' AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(_utf8mb4 X'2e35' AS SIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(_utf8mb4 X'2e35' AS UNSIGNED) AS x FROM t WHERE id=8",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.5'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(_binary X'2b' AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(_binary X'2b' AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(_utf8mb4 X'2b' AS SIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(_utf8mb4 X'2b' AS UNSIGNED) AS x FROM t WHERE id=9",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(_binary X'2d' AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(_binary X'2d' AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(_utf8mb4 X'2d' AS SIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(_utf8mb4 X'2d' AS UNSIGNED) AS x FROM t WHERE id=10",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(_binary X'2d2d31' AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(_binary X'2d2d31' AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(_utf8mb4 X'2d2d31' AS SIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(_utf8mb4 X'2d2d31' AS UNSIGNED) AS x FROM t WHERE id=11",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '--1'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(_binary X'2b2d31' AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(_binary X'2b2d31' AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(_utf8mb4 X'2b2d31' AS SIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(_utf8mb4 X'2b2d31' AS UNSIGNED) AS x FROM t WHERE id=12",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+-1'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0B-1'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0B-1'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b-1'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b-1'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0B-1'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0B-1'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b-1'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b-1'"}]],
    ["SELECT CAST(_binary X'0b2d31' AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0B-1'"}]],
    ["SELECT CAST(_binary X'0b2d31' AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0B-1'"}]],
    ["SELECT CAST(_utf8mb4 X'0b2d31' AS SIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b-1'"}]],
    ["SELECT CAST(_utf8mb4 X'0b2d31' AS UNSIGNED) AS x FROM t WHERE id=13",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\u000b-1'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0C-1'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0C-1'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\f-1'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\f-1'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0C-1'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0C-1'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\f-1'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\f-1'"}]],
    ["SELECT CAST(_binary X'0c2d31' AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0C-1'"}]],
    ["SELECT CAST(_binary X'0c2d31' AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x0C-1'"}]],
    ["SELECT CAST(_utf8mb4 X'0c2d31' AS SIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\f-1'"}]],
    ["SELECT CAST(_utf8mb4 X'0c2d31' AS UNSIGNED) AS x FROM t WHERE id=14",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\f-1'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC2\\xA0-1'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC2\\xA0-1'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC2\\xA0-1'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC2\\xA0-1'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1'"}]],
    ["SELECT CAST(_binary X'c2a02d31' AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC2\\xA0-1'"}]],
    ["SELECT CAST(_binary X'c2a02d31' AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC2\\xA0-1'"}]],
    ["SELECT CAST(_utf8mb4 X'c2a02d31' AS SIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1'"}]],
    ["SELECT CAST(_utf8mb4 X'c2a02d31' AS UNSIGNED) AS x FROM t WHERE id=15",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=16",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=16",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=16",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=16",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=16",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=16",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=16",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=16",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'202d3178' AS SIGNED) AS x FROM t WHERE id=16",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"}]],
    ["SELECT CAST(_binary X'202d3178' AS UNSIGNED) AS x FROM t WHERE id=16",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'202d3178' AS SIGNED) AS x FROM t WHERE id=16",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"}]],
    ["SELECT CAST(_utf8mb4 X'202d3178' AS UNSIGNED) AS x FROM t WHERE id=16",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' -1x'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=17",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=17",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=17",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=17",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=17",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=17",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=17",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=17",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'2d312e32' AS SIGNED) AS x FROM t WHERE id=17",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"}]],
    ["SELECT CAST(_binary X'2d312e32' AS UNSIGNED) AS x FROM t WHERE id=17",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'2d312e32' AS SIGNED) AS x FROM t WHERE id=17",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"}]],
    ["SELECT CAST(_utf8mb4 X'2d312e32' AS UNSIGNED) AS x FROM t WHERE id=17",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1.2'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=18",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=18",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=18",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=18",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=18",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=18",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=18",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=18",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'2d316534' AS SIGNED) AS x FROM t WHERE id=18",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
    ["SELECT CAST(_binary X'2d316534' AS UNSIGNED) AS x FROM t WHERE id=18",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'2d316534' AS SIGNED) AS x FROM t WHERE id=18",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
    ["SELECT CAST(_utf8mb4 X'2d316534' AS UNSIGNED) AS x FROM t WHERE id=18",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=19",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=19",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=19",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=19",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=19",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=19",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=19",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=19",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"}]],
    ["SELECT CAST(_binary X'2b3932323333373230333638353437373538303878' AS SIGNED) AS x FROM t WHERE id=19",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'2b3932323333373230333638353437373538303878' AS UNSIGNED) AS x FROM t WHERE id=19",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"}]],
    ["SELECT CAST(_utf8mb4 X'2b3932323333373230333638353437373538303878' AS SIGNED) AS x FROM t WHERE id=19",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'2b3932323333373230333638353437373538303878' AS UNSIGNED) AS x FROM t WHERE id=19",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+9223372036854775808x'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=20",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=20",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=20",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=20",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=20",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=20",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=20",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=20",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"}]],
    ["SELECT CAST(_binary X'393232333337323033363835343737353830382e39' AS SIGNED) AS x FROM t WHERE id=20",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'393232333337323033363835343737353830382e39' AS UNSIGNED) AS x FROM t WHERE id=20",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"}]],
    ["SELECT CAST(_utf8mb4 X'393232333337323033363835343737353830382e39' AS SIGNED) AS x FROM t WHERE id=20",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'393232333337323033363835343737353830382e39' AS UNSIGNED) AS x FROM t WHERE id=20",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808.9'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=21",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=21",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=21",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=21",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=21",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=21",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=21",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=21",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"}]],
    ["SELECT CAST(_binary X'31383434363734343037333730393535313631352e39' AS SIGNED) AS x FROM t WHERE id=21",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_binary X'31383434363734343037333730393535313631352e39' AS UNSIGNED) AS x FROM t WHERE id=21",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"}]],
    ["SELECT CAST(_utf8mb4 X'31383434363734343037333730393535313631352e39' AS SIGNED) AS x FROM t WHERE id=21",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
    ["SELECT CAST(_utf8mb4 X'31383434363734343037333730393535313631352e39' AS UNSIGNED) AS x FROM t WHERE id=21",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.9'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=22",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=22",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=22",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=22",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=22",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=22",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=22",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=22",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(_binary X'31383434363734343037333730393535313631366530' AS SIGNED) AS x FROM t WHERE id=22",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(_binary X'31383434363734343037333730393535313631366530' AS UNSIGNED) AS x FROM t WHERE id=22",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(_utf8mb4 X'31383434363734343037333730393535313631366530' AS SIGNED) AS x FROM t WHERE id=22",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(_utf8mb4 X'31383434363734343037333730393535313631366530' AS UNSIGNED) AS x FROM t WHERE id=22",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616e0'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=23",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=23",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=23",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=23",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=23",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=23",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=23",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=23",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_binary X'2d393232333337323033363835343737353830382e39' AS SIGNED) AS x FROM t WHERE id=23",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"}]],
    ["SELECT CAST(_binary X'2d393232333337323033363835343737353830382e39' AS UNSIGNED) AS x FROM t WHERE id=23",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(_utf8mb4 X'2d393232333337323033363835343737353830382e39' AS SIGNED) AS x FROM t WHERE id=23",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"}]],
    ["SELECT CAST(_utf8mb4 X'2d393232333337323033363835343737353830382e39' AS UNSIGNED) AS x FROM t WHERE id=23",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775808.9'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=24",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=24",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=24",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=24",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=24",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=24",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=24",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=24",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(_binary X'2d393232333337323033363835343737353830396530' AS SIGNED) AS x FROM t WHERE id=24",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(_binary X'2d393232333337323033363835343737353830396530' AS UNSIGNED) AS x FROM t WHERE id=24",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(_utf8mb4 X'2d393232333337323033363835343737353830396530' AS SIGNED) AS x FROM t WHERE id=24",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(_utf8mb4 X'2d393232333337323033363835343737353830396530' AS UNSIGNED) AS x FROM t WHERE id=24",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809e0'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=25",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=25",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=25",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=25",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=25",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=25",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=25",[[-1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=25",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_binary X'3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS SIGNED) AS x FROM t WHERE id=25",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_binary X'3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS UNSIGNED) AS x FROM t WHERE id=25",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_utf8mb4 X'3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS SIGNED) AS x FROM t WHERE id=25",[[-1]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_utf8mb4 X'3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS UNSIGNED) AS x FROM t WHERE id=25",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=26",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=26",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=26",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=26",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=26",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=26",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=26",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=26",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_binary X'2d3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS SIGNED) AS x FROM t WHERE id=26",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_binary X'2d3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS UNSIGNED) AS x FROM t WHERE id=26",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_utf8mb4 X'2d3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS SIGNED) AS x FROM t WHERE id=26",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(_utf8mb4 X'2d3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939' AS UNSIGNED) AS x FROM t WHERE id=26",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'"}]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303031' AS SIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303031' AS UNSIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303031' AS SIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(_utf8mb4 X'303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303031' AS UNSIGNED) AS x FROM t WHERE id=27",[[1]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS SIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(b) AS UNSIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS SIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(CONCAT(s) AS UNSIGNED) AS x FROM t WHERE id=28",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'' AS SIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(_binary X'' AS UNSIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(_utf8mb4 X'' AS SIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(_utf8mb4 X'' AS UNSIGNED) AS x FROM t WHERE id=28",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
    ["SELECT CAST(X'7FFFFFFFFFFFFFFF' AS SIGNED) AS x",[[9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(X'7FFFFFFFFFFFFFFF' AS UNSIGNED) AS x",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(X'8000000000000000' AS SIGNED) AS x",[[-9223372036854776000]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(X'8000000000000000' AS UNSIGNED) AS x",[[9223372036854776000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(X'FFFFFFFFFFFFFFFF' AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(X'FFFFFFFFFFFFFFFF' AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(B'1111111111111111111111111111111111111111111111111111111111111111' AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(B'1111111111111111111111111111111111111111111111111111111111111111' AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(_binary X'FFFFFFFFFFFFFFFF' AS SIGNED) AS x",[[0]],[["x",8,21,129,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF'"}]],
    ["SELECT CAST(_binary X'FFFFFFFFFFFFFFFF' AS UNSIGNED) AS x",[[0]],[["x",8,21,161,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF\\xFF'"}]],
    ["SELECT CAST(CAST(18446744073709551615 AS UNSIGNED) AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(CAST(18446744073709551615 AS UNSIGNED) AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
    ["SELECT CAST(18446744073709551615 AS SIGNED) AS x",[[-1]],[["x",8,21,129,0,63,"","","",""]],[]],
    ["SELECT CAST(18446744073709551615 AS UNSIGNED) AS x",[[18446744073709552000]],[["x",8,21,161,0,63,"","","",""]],[]],
  ]
  try {
    await conn.query("CREATE DATABASE integer_lexical60")
    await conn.query("USE integer_lexical60")
    await conn.query("CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(1024),s VARCHAR(1024))")
    await conn.query("INSERT INTO t VALUES(1,X'2b30',_utf8mb4 X'2b30')")
    await conn.query("INSERT INTO t VALUES(7,X'2d2e35',_utf8mb4 X'2d2e35')")
    await conn.query("INSERT INTO t VALUES(8,X'2e35',_utf8mb4 X'2e35')")
    await conn.query("INSERT INTO t VALUES(9,X'2b',_utf8mb4 X'2b')")
    await conn.query("INSERT INTO t VALUES(10,X'2d',_utf8mb4 X'2d')")
    await conn.query("INSERT INTO t VALUES(11,X'2d2d31',_utf8mb4 X'2d2d31')")
    await conn.query("INSERT INTO t VALUES(12,X'2b2d31',_utf8mb4 X'2b2d31')")
    await conn.query("INSERT INTO t VALUES(13,X'0b2d31',_utf8mb4 X'0b2d31')")
    await conn.query("INSERT INTO t VALUES(14,X'0c2d31',_utf8mb4 X'0c2d31')")
    await conn.query("INSERT INTO t VALUES(15,X'c2a02d31',_utf8mb4 X'c2a02d31')")
    await conn.query("INSERT INTO t VALUES(16,X'202d3178',_utf8mb4 X'202d3178')")
    await conn.query("INSERT INTO t VALUES(17,X'2d312e32',_utf8mb4 X'2d312e32')")
    await conn.query("INSERT INTO t VALUES(18,X'2d316534',_utf8mb4 X'2d316534')")
    await conn.query("INSERT INTO t VALUES(19,X'2b3932323333373230333638353437373538303878',_utf8mb4 X'2b3932323333373230333638353437373538303878')")
    await conn.query("INSERT INTO t VALUES(20,X'393232333337323033363835343737353830382e39',_utf8mb4 X'393232333337323033363835343737353830382e39')")
    await conn.query("INSERT INTO t VALUES(21,X'31383434363734343037333730393535313631352e39',_utf8mb4 X'31383434363734343037333730393535313631352e39')")
    await conn.query("INSERT INTO t VALUES(22,X'31383434363734343037333730393535313631366530',_utf8mb4 X'31383434363734343037333730393535313631366530')")
    await conn.query("INSERT INTO t VALUES(23,X'2d393232333337323033363835343737353830382e39',_utf8mb4 X'2d393232333337323033363835343737353830382e39')")
    await conn.query("INSERT INTO t VALUES(24,X'2d393232333337323033363835343737353830396530',_utf8mb4 X'2d393232333337323033363835343737353830396530')")
    await conn.query("INSERT INTO t VALUES(25,X'3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939',_utf8mb4 X'3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939')")
    await conn.query("INSERT INTO t VALUES(26,X'2d3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939',_utf8mb4 X'2d3939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939393939')")
    await conn.query("INSERT INTO t VALUES(27,X'303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303031',_utf8mb4 X'303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303031')")
    await conn.query("INSERT INTO t VALUES(28,NULL,NULL)")
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
    await conn.query("DROP DATABASE integer_lexical60")
    await conn.end()
    await db?.end()
  }
})

test("INTEGER CAST ENUM SET ordinals do not inherit displayed-text complement warnings", async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT CAST(e AS SIGNED) AS x FROM ord WHERE id=1",[[1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS UNSIGNED) AS x FROM ord WHERE id=1",[[1]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM ord WHERE id=1",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM ord WHERE id=1",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS SIGNED) AS x FROM ord WHERE id=2",[[2]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS UNSIGNED) AS x FROM ord WHERE id=2",[[2]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM ord WHERE id=2",[[-9223372036854776000]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM ord WHERE id=2",[[9223372036854776000]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS SIGNED) AS x FROM ord WHERE id=3",[[3]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS UNSIGNED) AS x FROM ord WHERE id=3",[[3]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM ord WHERE id=3",[[1]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM ord WHERE id=3",[[1]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS SIGNED) AS x FROM ord WHERE id=4",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(e AS UNSIGNED) AS x FROM ord WHERE id=4",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS SIGNED) AS x FROM ord WHERE id=4",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT CAST(s AS UNSIGNED) AS x FROM ord WHERE id=4",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
  ]
  try {
    await conn.query("CREATE DATABASE integer_ordinals")
    await conn.query("USE integer_ordinals")
    await conn.query("CREATE TABLE ord(id INT PRIMARY KEY,e ENUM('-0','-1','18446744073709551616'),s SET('v0','v1','v2','v3','v4','v5','v6','v7','v8','v9','v10','v11','v12','v13','v14','v15','v16','v17','v18','v19','v20','v21','v22','v23','v24','v25','v26','v27','v28','v29','v30','v31','v32','v33','v34','v35','v36','v37','v38','v39','v40','v41','v42','v43','v44','v45','v46','v47','v48','v49','v50','v51','v52','v53','v54','v55','v56','v57','v58','v59','v60','v61','v62','v63'))")
    await conn.query("INSERT INTO ord VALUES(1,'-0','v63'),(2,'-1','v0,v63'),(3,'18446744073709551616','v0'),(4,NULL,NULL)")
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
    await conn.query("DROP DATABASE integer_ordinals")
    await conn.end()
    await db?.end()
  }
})

test('INTEGER CAST complement ranges read fresh binary and text values in cached statements', async () => {
  const { db, conn } = await connect()
  // Negative-zero source/parameter contracts stay separate in the roadmap.
  const fixtures: [string, string, unknown[][], unknown[], [string | null, unknown[][], unknown[], unknown[]][]][] = [
    ["VARBINARY(1024)", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["-9223372036854775808",[[-9223372036854776000]],[{"x":-9223372036854776000}],[]],
      ["-9223372036854775809",[[-9223372036854776000]],[{"x":-9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
      ["9223372036854775808x",[[-9223372036854776000]],[{"x":-9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
      ["18446744073709551615.0",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
      ["18446744073709551616",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
      ["+18446744073709551616x",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616x'"}]],
      ["-1e4",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARBINARY(1024)", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["-9223372036854775808",[[9223372036854776000]],[{"x":9223372036854776000}],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["-9223372036854775809",[[9223372036854776000]],[{"x":9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
      ["9223372036854775808x",[[9223372036854776000]],[{"x":9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
      ["18446744073709551615.0",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.0'"}]],
      ["18446744073709551616",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
      ["+18446744073709551616x",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616x'"}]],
      ["-1e4",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(1024)", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,128,0,63,"","","",""]], [], [
      ["-9223372036854775808",[[-9223372036854776000]],[{"x":-9223372036854776000}],[]],
      ["-9223372036854775809",[[-9223372036854776000]],[{"x":-9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
      ["9223372036854775808x",[[-9223372036854776000]],[{"x":-9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
      ["18446744073709551615.0",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.0'"},{"Level":"Warning","Code":1105,"Message":"Cast to signed converted positive out-of-range integer to its negative complement"}]],
      ["18446744073709551616",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
      ["+18446744073709551616x",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616x'"}]],
      ["-1e4",[[-1]],[{"x":-1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARCHAR(1024)", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", [["x",8,21,160,0,63,"","","",""]], [], [
      ["-9223372036854775808",[[9223372036854776000]],[{"x":9223372036854776000}],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["-9223372036854775809",[[9223372036854776000]],[{"x":9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-9223372036854775809'"}]],
      ["9223372036854775808x",[[9223372036854776000]],[{"x":9223372036854776000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '9223372036854775808x'"}]],
      ["18446744073709551615.0",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551615.0'"}]],
      ["18446744073709551616",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '18446744073709551616'"}]],
      ["+18446744073709551616x",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+18446744073709551616x'"}]],
      ["-1e4",[[18446744073709552000]],[{"x":18446744073709552000}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-1e4'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_range_fresh')
    await conn.query('USE integer_range_fresh')
    for (const [type, sql, expectedFields, prepareWarnings, writes] of fixtures) {
      await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b ' + type + ')')
      await conn.query("INSERT INTO t VALUES(1,'1'),(2,'1'),(3,NULL)")
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const prepared = statement as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual(fields(prepared.statement.columns), expectedFields, 'prepare: ' + type + ': ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], prepareWarnings, 'prepare warnings: ' + sql)
        for (const [value, expectedRows, expectedObjects, warnings] of writes) {
          await conn.query('UPDATE t SET b=? WHERE id=2', [value])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [actual, columns] = method === 'statement' ? await statement.execute([1,1]) : method === 'query' ? await conn.query(options, [1,1]) : await conn.execute(options, [1,1])
            assert.deepEqual(actual, method === 'statement' ? expectedObjects : expectedRows, method + ': rows: ' + sql)
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
    await conn.query('DROP DATABASE integer_range_fresh')
    await conn.end()
    await db?.end()
  }
})
