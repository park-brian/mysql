// A BIT column and a hex or bit literal, as 8.4.11 answered (found by review).
// A BIT is sent as its bytes, big-endian, as many as its width takes, in
// either protocol: BIT(16) holding 258 is 0x0102, not the text "258". A hex
// or bit literal with no introducer is a number in a numeric context,
// `x'41' + 0` is 65, where `_binary x'41'` is a string and 0. Bytes are
// shown as hex so the wire form is compared exactly.
//
// A named divergence stays out: a BIT in a string context (CONCAT, LENGTH,
// CAST AS CHAR) is its bytes on the server and its number here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE bt (id INT PRIMARY KEY, b3 BIT(3), b16 BIT(16), b64 BIT(64))", [0,0,"",0]],
  ["INSERT INTO bt VALUES (1, b'101', 258, 18446744073709551615), (2, 0, b'0', NULL)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, HEX(b3), HEX(b16), HEX(b64), b3 + 0, b16 + 0, b64 + 0 FROM bt ORDER BY id", [["1","5","102","FFFFFFFFFFFFFFFF","5","258","18446744073709551615"],["2","0","0",null,"0","0",null]]],
  ["SELECT id, b3, b16, b64 FROM bt ORDER BY id", [["1","0x05","0x0102","0xffffffffffffffff"],["2","0x00","0x0000",null]]],
  ["SELECT id, HEX(CONCAT('', id)), b3 = 5, b3 = b'101', b16 > 257, b16 | 1 FROM bt ORDER BY id", [["1","31","1","1","1","259"],["2","32","0","0","0","1"]]],
  ["SELECT CAST(b'101' AS UNSIGNED), b'101' + 0, CAST(x'41' AS UNSIGNED), x'41' + 0, HEX(b'101'), b'101' = 5, x'0102' * 2, CAST(_binary x'41' AS UNSIGNED)", [["5","5","65","65","05","1","516","0"]]],
  ["SELECT id FROM bt WHERE b3 = 5 OR b16 = 0 ORDER BY id", [["1"],["2"]]],
  ["DROP TABLE bt", [0,0,"",0]],
]

test('BIT columns and hex literals answer as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : v instanceof Uint8Array ? `0x${Buffer.from(v).toString('hex')}` : String(v))))
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
