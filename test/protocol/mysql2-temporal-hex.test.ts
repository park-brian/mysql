// M5.10 begun — INTERVAL arithmetic (`± INTERVAL`, DATE_ADD, DATE_SUB, ADDDATE,
// SUBDATE), HEX and UNHEX, and what the probes behind them found in the
// literals and casts around them: each expression's value and metadata as a
// real 8.4.11 returned them through `mysql2` (asked first, and written down
// here). `[value, [type, length, decimals, flags, charset]]`, or an errno.
//
// What they pin: the result type follows the argument and the unit — a DATE
// stays a DATE under a unit of days or more, a string argument gives a
// 29-character string — months clamp the day, overflow is NULL, a simple
// unit takes an integer (a number rounded, a string cut at its first
// non-digit) but SECOND keeps a fraction, and a compound unit reads its
// fields from the right. HEX is a string's bytes or a number's 64-bit two's
// complement; UNHEX is half its argument's width. BINARY and CAST AS BINARY
// are as wide as their argument's bytes and nullable; an introducer re-reads
// a literal's bytes in its charset, refusing what a multi-byte one cannot read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly [string | null, readonly number[]]

const EXPRESSIONS: readonly (readonly [string, Outcome])[] = [
  ['dt + INTERVAL 1 DAY', ['2024-02-01 10:20:30.125', [12, 23, 3, 128, 63]]],
  ['da + INTERVAL 1 DAY', ['2024-02-01', [10, 10, 0, 128, 63]]],
  ['da + INTERVAL 1 HOUR', ['2024-01-31 01:00:00', [12, 19, 0, 128, 63]]],
  ['da - INTERVAL 1 MONTH', ['2023-12-31', [10, 10, 0, 128, 63]]],
  ['da + INTERVAL 1 MONTH', ['2024-02-29', [10, 10, 0, 128, 63]]],
  ['ts + INTERVAL 1 SECOND', ['2024-01-31 10:20:31', [12, 19, 0, 128, 63]]],
  ['tm + INTERVAL 1 HOUR', ['11:20:30.50', [11, 13, 2, 128, 63]]],
  ['tm - INTERVAL 11 HOUR', ['-00:39:29.50', [11, 13, 2, 128, 63]]],
  ['s + INTERVAL 1 DAY', ['2024-02-01', [254, 116, 31, 0, 224]]],
  ['s + INTERVAL 1 HOUR', ['2024-01-31 01:00:00', [254, 116, 31, 0, 224]]],
  ['n + INTERVAL 1 DAY', ['2024-02-01', [254, 116, 31, 0, 224]]],
  ["'2024-02-29' + INTERVAL 1 YEAR", ['2025-02-28', [254, 116, 31, 0, 224]]],
  ['INTERVAL 1 DAY + da', ['2024-02-01', [10, 10, 0, 128, 63]]],
  ['DATE_ADD(da, INTERVAL 1 DAY)', ['2024-02-01', [10, 10, 0, 128, 63]]],
  ["DATE_SUB(dt, INTERVAL '1:30' HOUR_MINUTE)", ['2024-01-31 08:50:30.125', [12, 23, 3, 128, 63]]],
  ['ADDDATE(da, 5)', ['2024-02-05', [10, 10, 0, 128, 63]]],
  ['SUBDATE(da, INTERVAL 2 WEEK)', ['2024-01-17', [10, 10, 0, 128, 63]]],
  ['da + INTERVAL 1.5 DAY', ['2024-02-02', [10, 10, 0, 128, 63]]],
  ["da + INTERVAL '1.5' DAY", ['2024-02-01', [10, 10, 0, 128, 63]]],
  ['dt + INTERVAL 1.5 SECOND', ['2024-01-31 10:20:31.625', [12, 23, 3, 128, 63]]],
  ['dt + INTERVAL 1.5e0 SECOND', ['2024-01-31 10:20:31.625000', [12, 26, 6, 128, 63]]],
  ["dt + INTERVAL '1 2:3:4.5' DAY_MICROSECOND", ['2024-02-01 12:23:34.625000', [12, 26, 6, 128, 63]]],
  ["dt + INTERVAL '1-2' YEAR_MONTH", ['2025-03-31 10:20:30.125', [12, 23, 3, 128, 63]]],
  ['dt + INTERVAL -1 QUARTER', ['2023-10-31 10:20:30.125', [12, 23, 3, 128, 63]]],
  ["da + INTERVAL '-1 2' DAY_HOUR", ['2024-01-29 22:00:00', [12, 19, 0, 128, 63]]],
  ["da + INTERVAL '1:2:3' DAY_SECOND", ['2024-01-31 01:02:03', [12, 19, 0, 128, 63]]],
  ["da + INTERVAL '1:2:3' HOUR_MINUTE", [null, [12, 19, 0, 128, 63]]],
  ['dt + INTERVAL 1 MICROSECOND', ['2024-01-31 10:20:30.125001', [12, 26, 6, 128, 63]]],
  ['da + INTERVAL 1 MICROSECOND', ['2024-01-31 00:00:00.000001', [12, 26, 6, 128, 63]]],
  ['da + INTERVAL 10000 YEAR', [null, [10, 10, 0, 128, 63]]],
  ['da - INTERVAL 2025 YEAR', [null, [10, 10, 0, 128, 63]]],
  ["'0001-01-01' - INTERVAL 1 DAY", ['0000-00-00', [254, 116, 31, 0, 224]]],
  ["'0000-00-00' + INTERVAL 1 DAY", [null, [254, 116, 31, 0, 224]]],
  ["'junk' + INTERVAL 1 DAY", [null, [254, 116, 31, 0, 224]]],
  ['NULL + INTERVAL 1 DAY', [null, [254, 116, 31, 0, 224]]],
  ['da + INTERVAL NULL DAY', [null, [10, 10, 0, 128, 63]]],
  ["'2024-01-31 10:00' + INTERVAL 1 DAY", ['2024-02-01 10:00:00', [254, 116, 31, 0, 224]]],
  ["'2024-01-31 10:00:00.5' + INTERVAL 1 DAY", ['2024-02-01 10:00:00.500000', [254, 116, 31, 0, 224]]],
  ['dt + INTERVAL 2147483648 SECOND', ['2092-02-18 13:34:38.125', [12, 23, 3, 128, 63]]],
  ['dt - INTERVAL 1 DAY > da', ['0', [8, 1, 0, 128, 63]]],
  ["UNHEX('89fa11ad')", ['0x89fa11ad', [253, 16, 31, 128, 63]]],
  ["UNHEX('abc')", ['0x0abc', [253, 6, 31, 128, 63]]],
  ["UNHEX('zz')", [null, [253, 4, 31, 128, 63]]],
  ['UNHEX(NULL)', [null, [253, 0, 31, 128, 63]]],
  ['UNHEX(n)', ['0x20240131', [253, 6, 31, 128, 63]]],
  ['UNHEX(1234)', ['0x1234', [253, 3, 31, 128, 63]]],
  ["UNHEX('')", ['0x', [253, 0, 31, 128, 63]]],
  ["UNHEX(HEX('héllo'))", ['0x68c3a96c6c6f', [253, 80, 31, 128, 63]]],
  ["HEX('abc')", ['616263', [253, 96, 31, 0, 224]]],
  ['HEX(255)', ['FF', [253, 64, 31, 0, 224]]],
  ['HEX(-1)', ['FFFFFFFFFFFFFFFF', [253, 64, 31, 0, 224]]],
  ['HEX(s)', ['323032342D30312D3331', [253, 960, 31, 0, 224]]],
  ['HEX(n)', ['134D703', [253, 64, 31, 0, 224]]],
  ['HEX(1.5)', ['2', [253, 64, 31, 0, 224]]],
  ['HEX(-1.5)', ['FFFFFFFFFFFFFFFE', [253, 64, 31, 0, 224]]],
  ['HEX(2.6e0)', ['3', [253, 64, 31, 0, 224]]],
  ['HEX(dt)', ['323032342D30312D33312031303A32303A33302E313235', [253, 184, 31, 0, 224]]],
  ['HEX(NULL)', [null, [253, 0, 31, 0, 224]]],
  ["HEX('é')", ['C3A9', [253, 32, 31, 0, 224]]],
  ['HEX(18446744073709551615)', ['FFFFFFFFFFFFFFFF', [253, 64, 31, 0, 224]]],
  ["CAST('ab' AS BINARY)", ['0x6162', [253, 8, 31, 128, 63]]],
  ["CAST('ab' AS BINARY(5))", ['0x6162000000', [253, 5, 31, 128, 63]]],
  ['BINARY s', ['0x323032342d30312d3331', [253, 120, 31, 128, 63]]],
  ["_latin1'é'", ['Ã©', [253, 8, 31, 1, 224]]],
  ["HEX(_latin1'é')", ['C3A9', [253, 16, 31, 0, 224]]],
  ["_latin1 x'E9'", ['é', [253, 4, 31, 1, 224]]],
  ["_utf8mb4 x'C3A9'", ['é', [253, 4, 31, 1, 224]]],
  ["_utf8mb4 x'FF'", 1300],
  ["_ascii x'80'", ['?', [253, 4, 31, 1, 224]]],
  ["'abc' COLLATE utf8mb4_bin", ['abc', [253, 12, 31, 128, 224]]],
]

test('M5.10: INTERVAL arithmetic, HEX and UNHEX return what 8.4.11 returned, value and metadata', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream() as never,
    user: 'root',
    password: '',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE d (dt DATETIME(3), da DATE, ts TIMESTAMP NULL, tm TIME(2), s VARCHAR(30), n INT)')
    await conn.query("INSERT INTO d VALUES ('2024-01-31 10:20:30.125', '2024-01-31', '2024-01-31 10:20:30', '10:20:30.5', '2024-01-31', 20240131)")
    for (const [e, expected] of EXPRESSIONS) {
      let actual: Outcome
      try {
        const [rows, fields] = await conn.query({
          sql: `SELECT ${e} FROM d`,
          rowsAsArray: true,
        })
        const v = (rows as unknown[][])[0]?.[0]
        const c = (fields as mysql.FieldPacket[])[0] as mysql.FieldPacket & {
          columnLength: number
          characterSet: number
        }
        const value = v instanceof Uint8Array ? `0x${Buffer.from(v).toString('hex')}` : v === null || v === undefined ? null : String(v)
        actual = [value, [c.columnType as number, c.columnLength, c.decimals, c.flags as number, c.characterSet]]
      } catch (err) {
        actual = (err as { errno: number }).errno
      }
      assert.deepEqual(actual, expected, e)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
