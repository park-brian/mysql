// REGEXP, RLIKE and REGEXP_LIKE, as 8.4.11 answered each of these statements.
//
// What it pins: case-insensitivity from a `_ci` collation and never accent-
// insensitivity; binary strings case-sensitive, and mixed with text 3995; a
// number matched as its text; REGEXP_LIKE's match types (`c`, `i`, `m`,
// `n`, the last of `c` and `i` winning, anything else 1210); ICU's POSIX
// classes and inline `(?i)`; and ICU's errors for patterns it refuses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT PRIMARY KEY, s VARCHAR(20), b VARBINARY(20))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1, 'Apple', 'Apple'), (2, 'banana', 'banana'), (3, NULL, NULL), (4, 'cherry pie', 'cherry pie')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM t WHERE s REGEXP '^a' ORDER BY id", [["1"]]],
  ["SELECT id FROM t WHERE b REGEXP '^a' ORDER BY id", [3995,"Character set 'binary' cannot be used in conjunction with 'utf8mb4_unicode_ci' in call to regexp_like."]],
  ["SELECT id, s REGEXP 'an' FROM t ORDER BY id", [["1","0"],["2","1"],["3",null],["4","0"]]],
  ["SELECT id FROM t WHERE s NOT REGEXP 'e' ORDER BY id", [["2"]]],
  ["SELECT 'Abc' REGEXP 'abc'", [["1"]]],
  ["SELECT 'abc' REGEXP '^a.c$'", [["1"]]],
  ["SELECT 'é' REGEXP 'e'", [["0"]]],
  ["SELECT 'É' REGEXP 'é'", [["1"]]],
  ["SELECT NULL REGEXP 'a'", [[null]]],
  ["SELECT 'a' REGEXP NULL", [[null]]],
  ["SELECT 123 REGEXP '^1'", [["1"]]],
  ["SELECT 'abc' NOT REGEXP 'b'", [["0"]]],
  ["SELECT 'abc' RLIKE 'B'", [["1"]]],
  ["SELECT 'abc' NOT RLIKE 'x'", [["1"]]],
  ["SELECT x'41' REGEXP x'61'", [["0"]]],
  ["SELECT x'61' REGEXP x'61'", [["1"]]],
  ["SELECT CAST('Abc' AS BINARY) REGEXP CAST('abc' AS BINARY)", [["0"]]],
  ["SELECT 'Abc' COLLATE utf8mb4_bin REGEXP 'abc'", [["0"]]],
  ["SELECT 'Abc' REGEXP 'abc' COLLATE utf8mb4_bin", [["0"]]],
  ["SELECT 'Abc' REGEXP BINARY 'abc'", [3995,"Character set 'utf8mb4_unicode_ci' cannot be used in conjunction with 'binary' in call to regexp_like."]],
  ["SELECT x'41' REGEXP 'a'", [3995,"Character set 'binary' cannot be used in conjunction with 'utf8mb4_unicode_ci' in call to regexp_like."]],
  ["SELECT 1.5 REGEXP '^1\\\\.5$'", [["1"]]],
  ["SELECT 'a.c' REGEXP 'a\\\\.c'", [["1"]]],
  ["SELECT 'abc' REGEXP ''", [3685,"Illegal argument to a regular expression."]],
  ["SELECT 'x' REGEXP '^$'", [["0"]]],
  ["SELECT '' REGEXP '^$'", [["1"]]],
  ["SELECT 'ab' REGEXP '(?i)AB'", [["1"]]],
  ["SELECT 'aB' REGEXP 'a\\\\p{Lu}'", [["1"]]],
  ["SELECT 'ÀB' REGEXP '^.B$'", [["1"]]],
  ["SELECT 'abab' REGEXP '(ab)\\\\1'", [["1"]]],
  ["SELECT REGEXP_LIKE('Abc', 'abc')", [["1"]]],
  ["SELECT REGEXP_LIKE('Abc', 'abc', 'c')", [["0"]]],
  ["SELECT REGEXP_LIKE('abc', 'ABC', 'i')", [["1"]]],
  ["SELECT REGEXP_LIKE('a\\nb', 'a.b')", [["0"]]],
  ["SELECT REGEXP_LIKE('a\\nb', 'a.b', 'n')", [["1"]]],
  ["SELECT REGEXP_LIKE('a\\nb', '^b', 'm')", [["1"]]],
  ["SELECT REGEXP_LIKE('a\\nb', '^b')", [["0"]]],
  ["SELECT REGEXP_LIKE('ABC', 'abc', 'ci')", [["1"]]],
  ["SELECT REGEXP_LIKE('ABC', 'abc', 'ic')", [["0"]]],
  ["SELECT REGEXP_LIKE('a', 'a', 'x')", [1210,"Incorrect arguments to regexp_like"]],
  ["SELECT REGEXP_LIKE('a', 'a', NULL)", [[null]]],
  ["SELECT REGEXP_LIKE('a')", [1582,"Incorrect parameter count in the call to native function 'REGEXP_LIKE'"]],
  ["SELECT 'a1' REGEXP '[[:digit:]]'", [["1"]]],
  ["SELECT 'ab' REGEXP '^[[:alpha:]]+$'", [["1"]]],
  ["SELECT 'a b' REGEXP '[[:space:]]'", [["1"]]],
  ["SELECT 'AB' REGEXP '^[[:upper:]]+$'", [["1"]]],
  ["SELECT 'x' REGEXP '[[:punct:]]'", [["0"]]],
  ["SELECT 'é' REGEXP '^[[:alpha:]]$'", [["1"]]],
  ["SELECT 'ab' REGEXP '\\\\w+'", [["1"]]],
  ["SELECT 'aaa' REGEXP '^a{3}$'", [["1"]]],
  ["SELECT 'ab' REGEXP 'a|z'", [["1"]]],
  ["SELECT 'a' REGEXP '('", [3691,"Mismatched parenthesis in regular expression."]],
  ["SELECT 'a' REGEXP '[a'", [3696,"The regular expression contains an unclosed bracket expression."]],
  ["SELECT 'a' REGEXP '*a'", [3688,"Syntax error in regular expression on line 1, character 1."]],
  ["SELECT 'a' REGEXP 'a**'", [3688,"Syntax error in regular expression on line 1, character 3."]],
  ["SELECT 'a' REGEXP '[[:<:]]a'", [3685,"Illegal argument to a regular expression."]],
  ["SELECT 'a' REGEXP 'a{2,1}'", [3693,"The maximum is less than the minumum in a {min,max} interval."]],
]

test('M5.10: REGEXP and REGEXP_LIKE answer every statement of the script as 8.4.11 did', async () => {
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
