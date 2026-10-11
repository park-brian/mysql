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


test("binary-column INTEGER casts bypass field suppression while ordinary reads retain native outcomes", async () => {
  const { db, conn } = await connect()
  // Whole unsupported binary-shift and other field-warning groups stay separate.
  const inputs: [number, string | [number, number] | null][] = [[0,""],[1,"20"],[2,"090A0D"],[3,"80"],[4,"0041"],[5,"C3A9"],[6,"317879"],[7,"3178"],[8,"31616263"],[9,"312E322E332E34"],[10,"313233"],[11,"2D3132"],[12,null]]
  const fixtures: [string, [string, unknown[][], unknown[][], unknown[]][]][] = [
    ["VARBINARY(10)", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=7",[["01"]],[["x",253,32,0,31,224,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=10",[["7B"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=11",[["FFFFFFF4"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=7",[["y,n"]],[["x",253,508,0,31,224,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=10",[["y,y"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=11",[["n,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=7",[[1]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}]],
      ["SELECT b+0 AS x FROM t WHERE id=10",[[123]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=11",[[-12]],[["x",5,23,128,31,63,"","","",""]],[]],
    ]],
    ["VARBINARY(1024)", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=7",[["01"]],[["x",253,32,0,31,224,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=10",[["7B"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=11",[["FFFFFFF4"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=7",[["y,n"]],[["x",253,508,0,31,224,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=10",[["y,y"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=11",[["n,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=7",[[1]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '1x'"}]],
      ["SELECT b+0 AS x FROM t WHERE id=10",[[123]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=11",[[-12]],[["x",5,23,128,31,63,"","","",""]],[]],
    ]],
    ["BINARY(8)", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' \\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-12\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' \\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x\\x00\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '123\\x00\\x00\\x00\\x00\\x00'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '-12\\x00\\x00\\x00\\x00\\x00'"},{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ]],
    ["TINYBLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=7",[["01"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=10",[["7B"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=11",[["FFFFFFF4"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=7",[["y,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=10",[["y,y"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=11",[["n,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=7",[[1]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=10",[[123]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=11",[[-12]],[["x",5,23,128,31,63,"","","",""]],[]],
    ]],
    ["BLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=7",[["01"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=10",[["7B"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=11",[["FFFFFFF4"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=7",[["y,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=10",[["y,y"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=11",[["n,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=7",[[1]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=10",[[123]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=11",[[-12]],[["x",5,23,128,31,63,"","","",""]],[]],
    ]],
    ["MEDIUMBLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=7",[["01"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=10",[["7B"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=11",[["FFFFFFF4"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=7",[["y,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=10",[["y,y"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=11",[["n,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=7",[[1]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=10",[[123]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=11",[[-12]],[["x",5,23,128,31,63,"","","",""]],[]],
    ]],
    ["LONGBLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=11",[[-12]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=8",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1abc'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=9",[[1]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1.2.3.4'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=10",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=11",[[18446744073709552000]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1105,"Message":"Cast to unsigned converted negative integer to its positive complement"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=12",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=7",[["01"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=10",[["7B"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT HEX(CHAR(b)) AS x FROM t WHERE id=11",[["FFFFFFF4"]],[["x",253,32,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=7",[["y,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=10",[["y,y"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT EXPORT_SET(b,'y','n',',',2) AS x FROM t WHERE id=11",[["n,n"]],[["x",253,508,0,31,224,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=7",[[1]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=10",[[123]],[["x",5,23,128,31,63,"","","",""]],[]],
      ["SELECT b+0 AS x FROM t WHERE id=11",[[-12]],[["x",5,23,128,31,63,"","","",""]],[]],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_field_cast')
    await conn.query('USE integer_field_cast')
    for (const [type, queries] of fixtures) {
      await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b ' + type + ')')
      for (const [id, input] of inputs) await conn.query('INSERT INTO t VALUES(?,?)', [id, input === null ? null : typeof input === 'string' ? Buffer.from(input, 'hex') : Buffer.alloc(input[0], input[1])])
      for (const [sql, expected, expectedFields, warnings] of queries) {
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [actual, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(actual, expected, method + ': rows: ' + type + ': ' + sql)
          assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
          conn.unprepare(options)
        }
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE integer_field_cast')
    await conn.end()
    await db?.end()
  }
})

test("large binary-column INTEGER casts retain exact formatted caps through every wide blob class", async () => {
  const { db, conn } = await connect()
  // Whole unsupported binary-shift and other field-warning groups stay separate.
  const inputs: [number, string | [number, number] | null][] = [[0,""],[1,[200,97]],[2,[200,128]],[3,"c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9"],[4,"6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161008041"],[5,[60000,128]],[6,"313233"],[7,null]]
  const fixtures: [string, [string, unknown[][], unknown[][], unknown[]][]][] = [
    ["VARBINARY(60000)", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ]],
    ["BLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ]],
    ["MEDIUMBLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ]],
    ["LONGBLOB", [
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS SIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,128,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=0",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=1",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=2",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=3",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=4",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x0'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=5",[[0]],[["x",8,21,160,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80\\x80'"}]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=6",[[123]],[["x",8,21,160,0,63,"","","",""]],[]],
      ["SELECT CAST(b AS UNSIGNED) AS x FROM t WHERE id=7",[[null]],[["x",8,21,160,0,63,"","","",""]],[]],
    ]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_blob_caps')
    await conn.query('USE integer_blob_caps')
    for (const [type, queries] of fixtures) {
      await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b ' + type + ')')
      for (const [id, input] of inputs) await conn.query('INSERT INTO t VALUES(?,?)', [id, input === null ? null : typeof input === 'string' ? Buffer.from(input, 'hex') : Buffer.alloc(input[0], input[1])])
      for (const [sql, expected, expectedFields, warnings] of queries) {
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [actual, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(actual, expected, method + ': rows: ' + type + ': ' + sql)
          assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
          conn.unprepare(options)
        }
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE integer_blob_caps')
    await conn.end()
    await db?.end()
  }
})

test('cached INTEGER casts retain fresh diagnostics for small VARBINARY and every blob class', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[][], unknown[], [string | null, unknown[][], unknown[], unknown[]][]][] = [
    ["VARBINARY(10)","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["VARBINARY(10)","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["VARBINARY(1024)","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["VARBINARY(1024)","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["BINARY(8)","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' \\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D\\x00\\x00\\x00\\x00\\x00'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy\\x00\\x00\\x00\\x00\\x00'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA\\x00\\x00'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["BINARY(8)","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' \\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D\\x00\\x00\\x00\\x00\\x00'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy\\x00\\x00\\x00\\x00\\x00'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x\\x00\\x00\\x00\\x00\\x00\\x00'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA\\x00\\x00'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["TINYBLOB","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["TINYBLOB","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["BLOB","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["BLOB","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["MEDIUMBLOB","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["MEDIUMBLOB","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["LONGBLOB","SELECT CAST(b AS SIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,128,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
    ["LONGBLOB","SELECT CAST(b AS UNSIGNED) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["x",8,21,160,0,63,"","","",""]],[],[["",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ''"}]],["20",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: ' '"}]],["090A0D",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x09\\x0A\\x0D'"}]],["80",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x80'"}]],["0041",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\x00A'"}]],["C3A9",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '\\xC3\\xA9'"}]],["317879",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1xy'"}]],["3178",[[1]],[{"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]],["414141414141",[[0]],[{"x":0}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: 'AAAAAA'"}]],[null,[[null]],[{"x":null}],[]]]],
  ]
  try {
    await conn.query('CREATE DATABASE integer_binary_fresh')
    await conn.query('USE integer_binary_fresh')
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
    await conn.query('DROP DATABASE integer_binary_fresh')
    await conn.end()
    await db?.end()
  }
})
