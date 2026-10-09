// SET sql_mode to an expression, as 8.4.11 answered each of these statements.
//
// What it pins: an expression is evaluated, where it had been accepted and
// ignored. An integer is the modes' bits, in `sql_mode_names[]`'s order, the
// reserved bits refused with 3899 naming only them and anything past bit 32
// or below zero with 1231; text from any source (CONCAT, a user variable, a
// subquery, a hex literal) is the modes' names; a DECIMAL or a DOUBLE is 1232;
// NULL is 1231. PAD_CHAR_TO_FULL_LENGTH draws 3090 on every assignment that
// includes it, after 3135. And NO_BACKSLASH_ESCAPES, set any of these ways,
// changes how the next statement reads a backslash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["SET sql_mode = 1048576", [0,0,"",0]],
  ["SELECT @@sql_mode", [["NO_BACKSLASH_ESCAPES"]]],
  ["SET sql_mode = 2 | 4", [0,0,"",0]],
  ["SELECT @@sql_mode", [["PIPES_AS_CONCAT,ANSI_QUOTES"]]],
  ["SET sql_mode = 0", [0,0,"",0]],
  ["SELECT @@sql_mode", [[""]]],
  ["SET sql_mode = CONCAT('ANSI', '_QUOTES')", [0,0,"",0]],
  ["SELECT @@sql_mode", [["ANSI_QUOTES"]]],
  ["SET sql_mode = NULL", [1231,"Variable 'sql_mode' can't be set to the value of 'NULL'"]],
  ["SET sql_mode = 1.5", [1232,"Incorrect argument type to variable 'sql_mode'"]],
  ["SELECT @@sql_mode", [["ANSI_QUOTES"]]],
  ["SET sql_mode = 17179869184", [1231,"Variable 'sql_mode' can't be set to the value of '17179869184'"]],
  ["SET sql_mode = -1", [1231,"Variable 'sql_mode' can't be set to the value of '-1'"]],
  ["SET sql_mode = 16", [0,0,"",0]],
  ["SELECT @@sql_mode", [["NOT_USED"]]],
  ["SET sql_mode = 256", [3899,"sql_mode=0x00000100 is not supported."]],
  ["SET @m = 'NO_ZERO_DATE'", [0,0,"",0]],
  ["SET sql_mode = @m", [0,0,"",1]],
  ["SELECT @@sql_mode", [["NO_ZERO_DATE"]]],
  ["SET sql_mode = CONCAT('BOGUS', '')", [1231,"Variable 'sql_mode' can't be set to the value of 'BOGUS'"]],
  ["SET sql_mode = (SELECT 'ANSI_QUOTES')", [0,0,"",0]],
  ["SELECT @@sql_mode", [["ANSI_QUOTES"]]],
  ["SET sql_mode = UPPER('real_as_float')", [0,0,"",0]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT"]]],
  ["SET sql_mode = 8589934592", [1231,"Variable 'sql_mode' can't be set to the value of '8589934592'"]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT"]]],
  ["SET sql_mode = 4294967296", [0,0,"",0]],
  ["SELECT @@sql_mode", [["TIME_TRUNCATE_FRACTIONAL"]]],
  ["SET sql_mode = 2147483648", [0,0,"",1]],
  ["SELECT @@sql_mode", [["PAD_CHAR_TO_FULL_LENGTH"]]],
  ["SET sql_mode = 257", [3899,"sql_mode=0x00000100 is not supported."]],
  ["SET sql_mode = 268435456", [3899,"sql_mode=0x10000000 is not supported."]],
  ["SET sql_mode = 268435457 | 512", [3899,"sql_mode=0x10000200 is not supported."]],
  ["SET sql_mode = 262144", [0,0,"",0]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI"]]],
  ["SET sql_mode = '3'", [1231,"Variable 'sql_mode' can't be set to the value of '3'"]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI"]]],
  ["SET sql_mode = 1e0", [1232,"Incorrect argument type to variable 'sql_mode'"]],
  ["SET sql_mode = TRUE", [0,0,"",0]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT"]]],
  ["SET sql_mode = 17179869183", [1231,"Variable 'sql_mode' can't be set to the value of '17179869183'"]],
  ["SET sql_mode = X'41'", [1231,"Variable 'sql_mode' can't be set to the value of 'A'"]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT"]]],
  ["SET sql_mode = CAST(5 AS UNSIGNED)", [0,0,"",0]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT,ANSI_QUOTES"]]],
  ["SET sql_mode = 'PAD_CHAR_TO_FULL_LENGTH'", [0,0,"",1]],
  ["SET sql_mode = 'PAD_CHAR_TO_FULL_LENGTH,ANSI_QUOTES'", [0,0,"",1]],
  ["SHOW WARNINGS", [["Warning","3090","Changing sql mode 'PAD_CHAR_TO_FULL_LENGTH' is deprecated. It will be removed in a future release."]]],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["SHOW WARNINGS", []],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["SHOW WARNINGS", []],
  ["SHOW WARNINGS", []],
  ["SET sql_mode = 'NO_ZERO_DATE,PAD_CHAR_TO_FULL_LENGTH'", [0,0,"",2]],
  ["SHOW WARNINGS", [["Warning","3135","'NO_ZERO_DATE', 'NO_ZERO_IN_DATE' and 'ERROR_FOR_DIVISION_BY_ZERO' sql modes should be used with strict mode. They will be merged with strict mode in a future release."],["Warning","3090","Changing sql mode 'PAD_CHAR_TO_FULL_LENGTH' is deprecated. It will be removed in a future release."]]],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["SET SESSION sql_mode = CONCAT(@@sql_mode, ',NO_BACKSLASH_ESCAPES')", [0,0,"",0]],
  ["SELECT @@sql_mode", [["NO_BACKSLASH_ESCAPES"]]],
  ["SELECT 'a\\\\b'", [["a\\\\b"]]],
  ["SET sql_mode = 'ansi,no_backslash_escapes'", [0,0,"",0]],
  ["SELECT @@sql_mode", [["REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI,NO_BACKSLASH_ESCAPES"]]],
  ["SET sql_mode = 'NO_BACKSLASH_ESCAPES'", [0,0,"",0]],
  ["SELECT 'a\\\\b' AS s", [["a\\\\b"]]],
  ["SET sql_mode = DEFAULT", [0,0,"",0]],
  ["SELECT @@sql_mode", [["ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"]]],
]

test('SET sql_mode evaluates its expression as 8.4.11 does', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
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
