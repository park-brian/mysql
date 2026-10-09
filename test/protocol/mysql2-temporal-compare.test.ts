// A TIME column compared with a constant that is a datetime, or a string or a
// number written as one, as 8.4.11 answered: the constant is converted once
// to its time of day, in `=`, `<=>`, `<`, IN and BETWEEN alike, and
// whether it is a literal, a CAST, CONCAT or DATE_ADD. A string is a
// datetime when it is a date, a space and a time, seconds optional, or 14
// digits. A two-digit year is 2000-2069 below 70 and 1970-1999 from it, and
// CAST of a datetime string AS TIME keeps its time. Found by review.
//
// Two named divergences stay out of the script: an IN list one of whose
// strings is not a time at all (`'x'`) is 0 on the server even when another
// item matches, and `'2020-01-01'` as a TIME is the number prefix 00:20:20.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE tt (id INT PRIMARY KEY, tm TIME, dt DATETIME, d DATE)", [0,0,"",0]],
  ["INSERT INTO tt VALUES (1, '14:37:36', '2020-01-01 14:37:36', '2020-01-01'), (2, '09:00:00', '1970-01-01 09:00:00', '70-01-01')", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, tm = CAST('1970-01-01 14:37:36' AS DATETIME), tm = '20200101143736', tm = 20200101143736, tm = '143736', tm = 143736, tm = '2020-01-01 14:37:36.000' FROM tt ORDER BY id", [["1","1","1","1","1","1","1"],["2","0","0","0","0","0","0"]]],
  ["SELECT id, tm IN ('1970-01-01 14:37:36', '1970-01-01 09:00:00'), tm IN (CAST('2000-01-01 14:37:36' AS DATETIME)), tm BETWEEN '1970-01-01 14:00:00' AND '1970-01-01 15:00:00', tm BETWEEN '14:00' AND '15:00', tm NOT BETWEEN '1970-01-01 14:00:00' AND '1970-01-01 15:00:00' FROM tt ORDER BY id", [["1","1","1","1","1","0"],["2","1","0","0","0","1"]]],
  ["SELECT id, tm = CONCAT('1970-01-01 ', '14:37:36'), tm = DATE_ADD('1970-01-01 14:37:35', INTERVAL 1 SECOND), '1970-01-01 14:37:36' = tm, CAST('1970-01-01 14:37:36' AS DATETIME) = tm, tm <=> '1970-01-01 14:37:36', tm > '1970-01-01 14:00:00' FROM tt ORDER BY id", [["1","1","1","1","1","1","1"],["2","0","0","0","0","0","0"]]],
  ["SELECT id FROM tt WHERE tm IN ('1970-01-01 14:37:36')", [["1"]]],
  ["SELECT id FROM tt WHERE tm BETWEEN '1970-01-01 14:00:00' AND '1970-01-01 15:00:00'", [["1"]]],
  ["SELECT id, tm = '70-01-01 14:37:36', tm = '1970-1-1 14:37:36', tm = '1970-01-01 14:37', tm > '1970-01-01 14:37', tm = '1970/01/01 14:37:36' FROM tt ORDER BY id", [["1","1","1","0","1","1"],["2","0","0","0","0","0"]]],
  ["SELECT id, d, d = '70-01-01', d = '20200101', d BETWEEN '2019-12-31' AND '2020-01-02' FROM tt ORDER BY id", [["1","2020-01-01","0","1","1"],["2","1970-01-01","1","0","0"]]],
  ["SELECT CAST('70-01-01' AS DATE), CAST('69-12-31' AS DATE), CAST('05-1-1 1:2:3' AS DATETIME), CAST('70-01-01 14:37:36' AS TIME), CAST('2020-01-01 14:37:36.5' AS TIME(1)), CAST('20200101143736' AS TIME), CAST('2020-01-01 14:37' AS TIME)", [["1970-01-01","2069-12-31","2005-01-01 01:02:03","14:37:36","14:37:36.5","14:37:36","14:37:00"]]],
  ["DROP TABLE tt", [0,0,"",0]],
]

test('A TIME compared with a datetime constant answers as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
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
