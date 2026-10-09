// Row constructors compared, as 8.4.11 answered each statement.
//
// `Arg_comparator::compare_row`: for = and <> an explicit difference in any
// element decides, and otherwise a NULL makes the answer NULL; for <, <=, >
// and >= the first difference decides, and a NULL met before it makes the
// answer NULL; <=> is null-safe element by element. IN over rows is = with
// each row. A row where one value belongs, or rows of two widths, is 1241.
// Prisma's cursor pagination is `(t1.id, t1.title) = (?, ?)`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE p (id INT PRIMARY KEY, t VARCHAR(10), n INT)", [0,0,"",0]],
  ["INSERT INTO p VALUES (1,'a',NULL),(2,'b',2),(3,'c',3)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM p WHERE (id, t) = (1, 'a')", [["1"]]],
  ["SELECT id FROM p WHERE (id, t) = (1, 'A')", [["1"]]],
  ["SELECT (1, 2) = (1, 2), (1, 2) = (1, 3), (1, NULL) = (1, 2), (1, NULL) = (2, 2), (1, NULL) = (1, NULL)", [["1","0",null,"0",null]]],
  ["SELECT (1, 2) <> (1, 2), (1, 2) <> (1, 3), (1, NULL) <> (1, 2), (1, NULL) <> (2, 2)", [["0","1",null,"1"]]],
  ["SELECT (1, 2) < (1, 3), (1, 2) < (2, 0), (1, 2) < (1, 2), (NULL, 2) < (1, 3), (1, NULL) < (2, 3), (1, NULL) < (1, 3), (2, NULL) < (1, 3)", [["1","1","0",null,"1",null,"0"]]],
  ["SELECT (1, 2) <= (1, 2), (1, 2) >= (1, 3), (2, 1) > (1, 9), (1, 2, 3) > (1, 2, 2)", [["1","0","1","1"]]],
  ["SELECT (1, 2) <=> (1, 2), (1, NULL) <=> (1, NULL), (1, NULL) <=> (1, 2)", [["1","1","0"]]],
  ["SELECT id, (id, n) IN ((1, NULL), (2, 2), (5, 5)) FROM p ORDER BY id", [["1",null],["2","1"],["3","0"]]],
  ["SELECT id, (id, n) NOT IN ((1, NULL), (2, 2), (5, 5)) FROM p ORDER BY id", [["1",null],["2","0"],["3","1"]]],
  ["SELECT id FROM p WHERE (id, t) IN ((1, 'a'), (3, 'C'), (9, 'z')) ORDER BY id", [["1"],["3"]]],
  ["SELECT * FROM p t0 WHERE t0.id >= (SELECT t1.id FROM p t1 WHERE (t1.id, t1.t) = (2, 'b')) ORDER BY id", [["2","b","2"],["3","c","3"]]],
  ["SELECT (1, 2) = 1", [1241,"Operand should contain 2 column(s)"]],
  ["SELECT 1 = (1, 2)", [1241,"Operand should contain 1 column(s)"]],
  ["SELECT (1, 2) = (1, 2, 3)", [1241,"Operand should contain 2 column(s)"]],
  ["SELECT (1, 2) IN ((1, 2), 3)", [1241,"Operand should contain 2 column(s)"]],
  ["SELECT (1, 2) IN ((1, 2), (3, 4, 5))", [1241,"Operand should contain 2 column(s)"]],
  ["SELECT ((1, 2), 3) = ((1, 2), 3)", [["1"]]],
  ["SELECT (1, 2) + 1", [1241,"Operand should contain 1 column(s)"]],
]

test('row constructors compare as 8.4.11 compares them', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
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
        actual = [err.errno, err.message]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
