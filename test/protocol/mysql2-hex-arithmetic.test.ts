// Hex and bit literals in a numeric context, as 8.4.11 answered them.
//
// A hex literal is bytes, until arithmetic reads it: then it is a BIGINT
// UNSIGNED, as wide as its largest value has digits (3 for one byte, 20 for
// eight), so `X'41' - 100` is 1690 and `X'FF' + 1` is 4 wide. A bit literal
// is the same integer, signed. Negated, or under ABS, a hex literal is a
// double 17 wide with no decimals, as its string self would be. SUM and AVG
// of one are DECIMAL, as of an integer. CAST AS UNSIGNED is 21 wide, as
// CAST AS SIGNED is, whatever the argument. Bare, a hex literal is reported
// UNSIGNED with no decimals; a derived table's or a view's column of one is
// plain bytes again, in arithmetic too, but keeps the 0 decimals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]
type Outcome = Rows | readonly [Rows, string] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["SELECT X'FF' + 1, 0x10 * 2, -X'01', X'FFFFFFFFFFFFFFFF' + 0, b'101' + 1, X'01' + b'1', X'0102' + 1, 1 + X'01', X'01' - 1, X'05' DIV 2, X'05' % 3, X'01' / 2, X'41' + 0.5", [[["256","32","-1","18446744073709551615","6","2","259","2","0","2","2","0.5000","65.5"]],"8/4/161/0 8/4/161/0 5/17/129/0 8/21/161/0 8/5/129/0 8/4/161/0 8/6/161/0 8/4/161/0 8/4/161/0 8/3/160/0 8/4/160/0 246/9/128/4 246/7/129/1"]],
  ["SELECT X'01' + 0, X'0102' + 0, X'010203' + 0, X'01020304' + 0, X'0102030405' + 0, X'010203040506' + 0, X'01020304050607' + 0, X'0102030405060708' + 0, b'1' + 0, b'11111111' + 0, b'111111111' + 0, X'01' * 1", [[["1","258","66051","16909060","4328719365","1108152157446","283686952306183","72623859790382856","1","255","511","1"]],"8/4/161/0 8/6/161/0 8/9/161/0 8/11/161/0 8/14/161/0 8/16/161/0 8/18/161/0 8/21/161/0 8/5/129/0 8/5/129/0 8/7/129/0 8/4/161/0"]],
  ["SELECT X'41' - 100", [1690,"BIGINT UNSIGNED value is out of range in '(0x41 - 100)'"]],
  ["SELECT 0xFFFFFFFFFFFFFFFF + 1", [1690,"BIGINT UNSIGNED value is out of range in '(0xffffffffffffffff + 1)'"]],
  ["SELECT X'7FFFFFFFFFFFFFFF' * 2", [[["18446744073709551614"]],"8/21/161/0"]],
  ["SELECT X'FF' = 255, X'41' = 'A', X'0A' > 9, X'10' | 1", [[["1","1","1","17"]],"8/1/129/0 8/1/129/0 8/1/129/0 8/21/161/0"]],
  ["CREATE TABLE h (id INT)", [0,0,"",0]],
  ["INSERT INTO h VALUES (1), (2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT SUM(X'10'), AVG(X'10'), SUM(id + X'01') FROM h", [[["32","16.0000","5"]],"246/26/128/0 246/9/128/4 246/34/128/0"]],
  ["SELECT CAST(X'41' AS UNSIGNED), CAST(1 AS UNSIGNED), CAST(1.5 AS UNSIGNED), CAST(X'41' AS SIGNED), X'41' + 0.5, X'41' + 1e0, ABS(X'41'), ROUND(X'41'), FLOOR(X'41')", [[["65","1","2","65","65.5","66","65","65","65"]],"8/21/161/0 8/21/161/0 8/21/161/0 8/21/129/0 246/7/129/1 5/23/129/31 5/17/161/0 5/23/129/31 5/23/129/31"]],
  ["SELECT X'41', HEX(X'41' + 0), CONCAT(X'41'), X'41' + 0 = 65", [[["A","41","A","1"]],"253/1/161/0 253/64/0/31 253/1/128/31 8/1/129/0"]],
  ["SELECT X'41', b'101', _binary X'41', 0x41, X'', MAX(X'10'), IFNULL(X'41', 1), (SELECT X'41'), COALESCE(X'41')", [[["A","\u0005","A","A","","\u0010","A","A","A"]],"253/1/161/0 253/1/129/0 253/1/129/31 253/1/161/0 253/0/161/0 253/1/160/0 253/2/129/31 253/1/161/0 253/1/129/31"]],
  ["CREATE VIEW vh AS SELECT X'41' AS a, X'41' + 1 AS b", [0,0,"",0]],
  ["SELECT * FROM vh", [[["A","66"]],"253/1/129/0 3/4/33/0"]],
  ["SELECT * FROM (SELECT X'41' AS a) d", [[["A"]],"253/1/129/0"]],
  ["WITH c AS (SELECT X'41' AS a) SELECT * FROM c", [[["A"]],"253/1/129/0"]],
  ["SELECT X'41' UNION SELECT X'42'", [[["A"],["B"]],"253/1/129/0"]],
  ["SELECT d.a + 1 FROM (SELECT X'41' AS a) d", [[["1"]],"5/23/129/31"]],
  ["DROP VIEW vh", [0,0,"",0]],
  ["DROP TABLE h", [0,0,"",0]],
]

test('Hex and bit literals in arithmetic answer every statement of the script as 8.4.11 did, metadata included', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r, fields] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) {
          const rows = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
          actual = sql.startsWith('SHOW') ? rows : [rows, (fields as mysql.FieldPacket[]).map((f) => `${f.columnType}/${f.columnLength}/${f.flags}/${f.decimals}`).join(' ')]
        }
        else {
          const h = r as mysql.ResultSetHeader
          actual = [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
        }
      } catch (e) {
        const err = e as { errno: number; message: string }
        actual = [err.errno, err.message.replace(/#sql-[0-9a-f]+_[0-9a-f]+/g, '#sql-…')]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
