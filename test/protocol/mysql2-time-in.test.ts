// A TIME column against text that is no time, in `=` and IN, as 8.4.11 ran
// each of these statements.
//
// What it pins: the server converts each constant into the column's type,
// and text that is no time ('x', '', '25:61:00') converts to nothing a row
// can equal, with 1292 once a statement. In `=` that is false. In IN it is
// worse: one such item and the column is in none of the list, a valid time
// beside it included, or NULL if the list holds a NULL. Short lists and long
// ones alike. DATE and DATETIME columns are unaffected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE ti (id INT PRIMARY KEY, t TIME, d DATE, dt DATETIME)", [0,0,"",0]],
  ["INSERT INTO ti VALUES (1, '10:00:00', '2020-01-01', '2020-01-01 10:00:00'), (2, '00:00:00', '2020-01-02', NULL)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, t IN ('10:00:00', '11:00:00') FROM ti ORDER BY id", [["1","1"],["2","0"]]],
  ["SELECT id, t IN ('10:00:00', 'x') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('x', '10:00:00') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('10:00:00', '') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('10:00:00', '25:61:00') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('10:00:00', 'x', '00:00:00') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t = 'x' FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('x') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('x', 'y') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, d IN ('2020-01-01', 'x') FROM ti ORDER BY id", [["1","1"],["2","0"]]],
  ["SELECT id, dt IN ('2020-01-01 10:00:00', 'x') FROM ti ORDER BY id", [["1","1"],["2",null]]],
  ["SELECT id, t IN ('10:00:00', '10') FROM ti ORDER BY id", [["1","1"],["2","0"]]],
  ["SELECT id, t NOT IN ('10:00:00', 'x') FROM ti ORDER BY id", [["1","1"],["2","1"]]],
  ["SELECT id, t IN ('10:00:00', NULL, 'x') FROM ti ORDER BY id", [["1",null],["2",null]]],
  ["SELECT id FROM ti WHERE t IN ('10:00:00', 'x')", []],
  ["SELECT id, t IN ('10:00:00', 'x') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SHOW WARNINGS", [["Warning","1292","Incorrect time value: 'x' for column 't' at row 1"]]],
  ["SELECT id, t IN ('x', 'y', '10:00:00') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SHOW WARNINGS", [["Warning","1292","Incorrect time value: 'x' for column 't' at row 1"],["Warning","1292","Incorrect time value: 'y' for column 't' at row 1"]]],
  ["SELECT id, 'garbage' = t, t = 'abc' FROM ti ORDER BY id", [["1","0","0"],["2","0","0"]]],
  ["SHOW WARNINGS", [["Warning","1292","Incorrect time value: 'garbage' for column 't' at row 1"],["Warning","1292","Incorrect time value: 'abc' for column 't' at row 1"]]],
  ["SELECT id, t IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10:00:00', 'x') FROM ti ORDER BY id", [["1","0"],["2","0"]]],
  ["SELECT id, t IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10:00:00', '11') FROM ti ORDER BY id", [["1","1"],["2","0"]]],
  ["SELECT id FROM ti WHERE t NOT IN ('10:00:00', 'x') ORDER BY id", [["1"],["2"]]],
  ["SHOW WARNINGS", [["Warning","1292","Incorrect time value: 'x' for column 't' at row 1"]]],
]

test('a TIME column meets text that is no time in = and IN as 8.4.11 does', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : typeof v === 'object' ? JSON.stringify(v) : String(v))))
        else {
          const h = r as mysql.ResultSetHeader
          actual = [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
        }
      } catch (e) {
        const err = e as { errno: number; message: string }
        actual = [err.errno, err.message]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
