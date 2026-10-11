// Complete native MySQL 8.4.11 outcomes; overflow and other reader families stay open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const integerFields = [["x",8,21,128,0,63,"","","",""]]
const unsignedFields = [["x",8,21,160,0,63,"","","",""]]
const doubleFields = [["x",5,23,128,31,63,"","","",""]]
const decimalFields = [["x",246,12,128,2,63,"","","",""]]
const literalDecimalFields = [["x",246,12,129,2,63,"","","",""]]

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

test('DECIMAL readers preserve column, CONCAT and literal diagnostic ownership', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x","123.45e1x",".5x","-0.5x","abc1","+x1",".x1","--1","NaN1"]
  const fixtures: [string, unknown[]][] = [
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'' AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]],
    ["SELECT CAST(_utf8mb4 X'' AS DECIMAL(10,2)) AS x FROM t WHERE id=0",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'20' AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]],
    ["SELECT CAST(_utf8mb4 X'20' AS DECIMAL(10,2)) AS x FROM t WHERE id=1",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'616263' AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]],
    ["SELECT CAST(_utf8mb4 X'616263' AS DECIMAL(10,2)) AS x FROM t WHERE id=2",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'31323378' AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]],
    ["SELECT CAST(_utf8mb4 X'31323378' AS DECIMAL(10,2)) AS x FROM t WHERE id=3",[[["123.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'3132332e343578' AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]],
    ["SELECT CAST(_utf8mb4 X'3132332e343578' AS DECIMAL(10,2)) AS x FROM t WHERE id=4",[[["123.45"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'313233653178' AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]],
    ["SELECT CAST(_utf8mb4 X'313233653178' AS DECIMAL(10,2)) AS x FROM t WHERE id=5",[[["1230.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45e1x'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45e1x'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45e1x'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'3132332e3435653178' AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45e1x'"}]]],
    ["SELECT CAST(_utf8mb4 X'3132332e3435653178' AS DECIMAL(10,2)) AS x FROM t WHERE id=6",[[["1234.50"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45e1x'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'2e3578' AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]],
    ["SELECT CAST(_utf8mb4 X'2e3578' AS DECIMAL(10,2)) AS x FROM t WHERE id=7",[[["0.50"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'2d302e3578' AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]],
    ["SELECT CAST(_utf8mb4 X'2d302e3578' AS DECIMAL(10,2)) AS x FROM t WHERE id=8",[[["-0.50"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '-0.5x'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'61626331' AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]],
    ["SELECT CAST(_utf8mb4 X'61626331' AS DECIMAL(10,2)) AS x FROM t WHERE id=9",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'2b7831' AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]]],
    ["SELECT CAST(_utf8mb4 X'2b7831' AS DECIMAL(10,2)) AS x FROM t WHERE id=10",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'2e7831' AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]]],
    ["SELECT CAST(_utf8mb4 X'2e7831' AS DECIMAL(10,2)) AS x FROM t WHERE id=11",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '--1'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '--1'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '--1'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'2d2d31' AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '--1'"}]]],
    ["SELECT CAST(_utf8mb4 X'2d2d31' AS DECIMAL(10,2)) AS x FROM t WHERE id=12",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '--1'"}]]],
    ["SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(s AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(v AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'NaN1'"}]]],
    ["SELECT CAST(c AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'NaN1'"}]]],
    ["SELECT CAST(h AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'NaN1'"}]]],
    ["SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(s) AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(v) AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT(c) AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],decimalFields,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]],
    ["SELECT CAST(CONCAT('123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(CONCAT(_binary'123x') AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["123.00"]],decimalFields,[]]],
    ["SELECT CAST(_binary X'4e614e31' AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'NaN1'"}]]],
    ["SELECT CAST(_utf8mb4 X'4e614e31' AS DECIMAL(10,2)) AS x FROM t WHERE id=13",[[["0.00"]],literalDecimalFields,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'NaN1'"}]]],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_contract61')
    await conn.query('USE decimal_contract61')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,s MEDIUMTEXT,v VARBINARY(12000),c VARCHAR(12000),f BINARY(16),h CHAR(16))')
    for (const [id, value] of values.entries()) await conn.query('INSERT INTO t VALUES(?,?,?,?,?,?,?)', [id, Buffer.from(value), value, Buffer.from(value), value, Buffer.from(value.slice(0, 16)), value.slice(0, 16)])
    for (const [sql, expected] of fixtures) {
      for (const method of ['query', 'execute'] as const) assert.deepEqual(await outcome(conn, sql, method), expected, method + ': ' + sql)
      conn.unprepare({ sql, rowsAsArray: true })
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_contract61')
    await conn.end()
    await db?.end()
  }
})

test('DECIMAL byte prefixes accept every trailing byte through BLOB and CONCAT', async () => {
  const { db, conn } = await connect()
  const expected = ["123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","1230.00","1231.00","1232.00","1233.00","1234.00","1235.00","1236.00","1237.00","1238.00","1239.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00","123.00"]
  try {
    await conn.query('CREATE DATABASE binary_text_reader61')
    await conn.query('USE binary_text_reader61')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB)')
    for (let byte = 0; byte < 256; byte++) await conn.query('INSERT INTO t VALUES(?,?)', [byte, Buffer.from([0x31, 0x32, 0x33, byte])])
    for (let byte = 0; byte < 256; byte++) for (const source of ['b', 'CONCAT(b)']) {
      const sql = `SELECT CAST(${source} AS DECIMAL(10,2)) AS x FROM t WHERE id=${byte}`
      for (const method of ['query', 'execute'] as const) assert.deepEqual(await outcome(conn, sql, method), [[[expected[byte]]], decimalFields, []], method + ': ' + sql)
      conn.unprepare({ sql, rowsAsArray: true })
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS binary_text_reader61')
    await conn.end()
    await db?.end()
  }
})

test('DECIMAL reader facts survive fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[][], unknown[], [string | null, unknown, unknown, unknown[]][]][] = [
    ["VARBINARY(60000)", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", integerFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARBINARY(60000)", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", unsignedFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARBINARY(60000)", "SELECT CAST(b AS DOUBLE) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", doubleFields, [], [
      ["",[[0]],[{"x":0}],[]],
      [" ",[[0]],[{"x":0}],[]],
      ["abc1",[[0]],[{"x":0}],[]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARBINARY(60000)", "SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' '"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '+x1'"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.x1'"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["VARBINARY(60000)", "SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["BLOB", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", integerFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["BLOB", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", unsignedFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["BLOB", "SELECT CAST(b AS DOUBLE) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", doubleFields, [], [
      ["",[[0]],[{"x":0}],[]],
      [" ",[[0]],[{"x":0}],[]],
      ["abc1",[[0]],[{"x":0}],[]],
      ["+x1",[[0]],[{"x":0}],[]],
      [".x1",[[0]],[{"x":0}],[]],
      ["0x",[[0]],[{"x":0}],[]],
      ["123x",[[123]],[{"x":123}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["BLOB", "SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["BLOB", "SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMBLOB", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", integerFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMBLOB", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", unsignedFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMBLOB", "SELECT CAST(b AS DOUBLE) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", doubleFields, [], [
      ["",[[0]],[{"x":0}],[]],
      [" ",[[0]],[{"x":0}],[]],
      ["abc1",[[0]],[{"x":0}],[]],
      ["+x1",[[0]],[{"x":0}],[]],
      [".x1",[[0]],[{"x":0}],[]],
      ["0x",[[0]],[{"x":0}],[]],
      ["123x",[[123]],[{"x":123}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMBLOB", "SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["MEDIUMBLOB", "SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGBLOB", "SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", integerFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGBLOB", "SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", unsignedFields, [], [
      ["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      [" ",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["abc1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'abc1'"}]],
      ["+x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '+x1'"}]],
      [".x1",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '.x1'"}]],
      ["0x",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '0x'"}]],
      ["123x",[[123]],[{"x":123}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123x'"}]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGBLOB", "SELECT CAST(b AS DOUBLE) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", doubleFields, [], [
      ["",[[0]],[{"x":0}],[]],
      [" ",[[0]],[{"x":0}],[]],
      ["abc1",[[0]],[{"x":0}],[]],
      ["+x1",[[0]],[{"x":0}],[]],
      [".x1",[[0]],[{"x":0}],[]],
      ["0x",[[0]],[{"x":0}],[]],
      ["123x",[[123]],[{"x":123}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGBLOB", "SELECT CAST(b AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
    ["LONGBLOB", "SELECT CAST(CONCAT(b) AS DECIMAL(10,2)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?", decimalFields, [], [
      ["",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [" ",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["abc1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["+x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      [".x1",[["0.00"]],[{"x":"0.00"}],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
      ["0x",[["0.00"]],[{"x":"0.00"}],[]],
      ["123x",[["123.00"]],[{"x":"123.00"}],[]],
      [null,[[null]],[{"x":null}],[]],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE byte_text_fresh61')
    await conn.query('USE byte_text_fresh61')
    for (const [storage, sql, expectedFields, prepareWarnings, writes] of fixtures) {
      await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,b ${storage})`)
      await conn.query("INSERT INTO t VALUES(1,'1'),(2,'1'),(3,NULL)")
      const options = { sql, rowsAsArray: true }
      const stmt = await conn.prepare(options)
      try {
        const prepared = stmt as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual(fields(prepared.statement.columns), expectedFields, 'prepare: ' + storage + ': ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], prepareWarnings)
        for (const [value, expectedRows, expectedObjects, warnings] of writes) {
          await conn.query('UPDATE t SET b=? WHERE id=2', [value === null ? null : Buffer.from(value)])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [rows, columns] = method === 'statement' ? await stmt.execute([1, 1]) : method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
            assert.deepEqual([rows, fields(columns), (await conn.query('SHOW WARNINGS'))[0]], [method === 'statement' ? expectedObjects : expectedRows, expectedFields, warnings], storage + ': ' + method + ': ' + sql)
          }
        }
      } finally {
        await stmt.close()
        conn.unprepare(options)
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS byte_text_fresh61')
    await conn.end()
    await db?.end()
  }
})
