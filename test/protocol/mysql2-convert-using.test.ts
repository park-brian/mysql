// CONVERT(x USING charset) and COERCIBILITY(), as 8.4.11 answered them.
//
// CONVERT was refused by name. Its result is text in the charset's default
// collation with a column's coercibility, 2. Bytes are read as that
// charset, NULL with 1300 when they are no text in it; text is carried
// over, '?' standing for what the charset cannot hold (an emoji in latin1
// or utf8mb3); USING binary is the bytes, as wide as the text could be.
// COERCIBILITY is 0 for COLLATE, 2 for a column or a conversion, 3 for a
// system constant, 4 for a literal, 5 for a number or a temporal, 6 for NULL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]
type Outcome = Rows | readonly [Rows, string] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["SELECT CONVERT('abc' USING latin1), CONVERT('é€' USING latin1), CONVERT(X'E9' USING latin1), CONVERT(X'C3A9' USING utf8mb4), CONVERT(X'E9' USING utf8mb4), CONVERT(NULL USING utf8mb4), CONVERT('a' USING binary), COLLATION(CONVERT('a' USING latin1)), COERCIBILITY(CONVERT('a' USING latin1))", [[["abc","é€","é","é",null,null,"a","latin1_swedish_ci","2"]],"253/12/0/31 253/8/0/31 253/4/0/31 253/8/0/31 253/4/0/31 253/0/0/31 253/4/128/31 253/256/0/31 8/10/129/0"]],
  ["SHOW WARNINGS", [["Warning","1300","Invalid utf8mb4 character string: 'E9'"]]],
  ["SELECT CONVERT('😀x' USING latin1), CONVERT('a' USING utf8mb3), CONVERT('😀' USING utf8mb3)", [[["?x","a","?"]],"253/8/0/31 253/4/0/31 253/4/0/31"]],
  ["SHOW WARNINGS", [["Warning","1287","'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead"],["Warning","1287","'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead"]]],
  ["SELECT CONVERT('a' USING nope)", [1115,"Unknown character set: 'nope'"]],
  ["CREATE TABLE cv (id INT, s VARCHAR(10), b VARBINARY(10))", [0,0,"",0]],
  ["INSERT INTO cv VALUES (1, 'zebra', X'C3A9'), (2, 'Äpfel', X'41'), (3, 'apple', X'FF')", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM cv ORDER BY CONVERT(s USING latin1), id", [[["3"],["1"],["2"]],"3/11/0/0"]],
  ["SELECT id, CONVERT(b USING utf8mb4) FROM cv ORDER BY id", [[["1","é"],["2","A"],["3",null]],"3/11/0/0 253/40/0/31"]],
  ["SHOW WARNINGS", [["Warning","1300","Invalid utf8mb4 character string: 'FF'"]]],
  ["SELECT CONVERT(s USING utf8mb4) = 'ZEBRA' FROM cv ORDER BY id", [[["1"],["0"],["0"]],"8/1/128/0"]],
  ["SELECT COERCIBILITY('a'), COERCIBILITY(1), COERCIBILITY(NULL), COERCIBILITY(USER()), COERCIBILITY('a' COLLATE utf8mb4_bin), COERCIBILITY(NOW()), COERCIBILITY(CONCAT('a', 1)), COERCIBILITY(X'41'), COERCIBILITY(CAST(1 AS CHAR)), COERCIBILITY(DATABASE())", [[["4","5","6","3","0","5","4","4","2","3"]],"8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0 8/10/129/0"]],
  ["DROP TABLE cv", [0,0,"",0]],
]

test('CONVERT USING and COERCIBILITY answer every statement of the script as 8.4.11 did, metadata included', async () => {
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
