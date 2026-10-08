// Collations meeting, as 8.4.11 resolved or refused each of these statements.
//
// What it pins: COLLATE must name one of its operand's charset's collations
// (1253), a number taking the collation's charset and NULL and bytes being
// binary's; `utf8_bin` is utf8mb3's; COLLATE may follow COLLATE, and BINARY
// is not a collation (1064). Then aggregation as `DTCollation::aggregate`
// does it: two EXPLICIT collations are refused in any charsets, two
// IMPLICIT ones of one charset leave NONE, which a comparison refuses and
// CONCAT and IF carry (COERCIBILITY 1, the charset's `_bin`); a `_bin`
// collation wins its charset, Unicode wins over latin1, and a stronger text
// wins over bytes. The errors name every argument for two or three, a
// number as latin1_swedish_ci NUMERIC and NULL as binary IGNORABLE, and the
// operation as the server spells it: '<>', 'like', ' IN ', 'between',
// 'strcmp', 'concat', 'concat_ws', 'greatest', 'if', 'ifnull', 'coalesce',
// 'nullif', 'case', 'UNION', 'regexp_like' (found by review).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE ct (a VARCHAR(5) COLLATE utf8mb4_bin, b VARCHAR(5) COLLATE utf8mb4_0900_ai_ci, c VARCHAR(5) CHARACTER SET latin1, d VARCHAR(5) COLLATE utf8mb4_general_ci)", [0,0,"",0]],
  ["INSERT INTO ct VALUES ('a','A','a','A')", [1,0,"",0]],
  ["SELECT a = b FROM ct", [["0"]]],
  ["SELECT a = c FROM ct", [["1"]]],
  ["SELECT b = d FROM ct", [1267,"Illegal mix of collations (utf8mb4_0900_ai_ci,IMPLICIT) and (utf8mb4_general_ci,IMPLICIT) for operation '='"]],
  ["SELECT CONCAT(a, b) FROM ct", [["aA"]]],
  ["SELECT COLLATION(CONCAT(a, b)), COERCIBILITY(CONCAT(a, b)) FROM ct", [["utf8mb4_bin","2"]]],
  ["SELECT CONCAT(a, b) = 'a' FROM ct", [["0"]]],
  ["SELECT a = b COLLATE utf8mb4_bin FROM ct", [["0"]]],
  ["SELECT a COLLATE utf8mb4_0900_ai_ci = b COLLATE utf8mb4_bin FROM ct", [1267,"Illegal mix of collations (utf8mb4_0900_ai_ci,EXPLICIT) and (utf8mb4_bin,EXPLICIT) for operation '='"]],
  ["SELECT a LIKE b FROM ct", [["0"]]],
  ["SELECT a IN (b) FROM ct", [["0"]]],
  ["SELECT a IN (b, 'x') FROM ct", [["0"]]],
  ["SELECT a REGEXP b FROM ct", [["0"]]],
  ["SELECT a BETWEEN b AND d FROM ct", [["0"]]],
  ["SELECT GREATEST(a, b) FROM ct", [["a"]]],
  ["SELECT IF(1, a, b) FROM ct", [["a"]]],
  ["SELECT COALESCE(a, b) FROM ct", [["a"]]],
  ["SELECT CASE WHEN 1 THEN a ELSE b END FROM ct", [["a"]]],
  ["SELECT a = 'x' COLLATE utf8mb4_0900_ai_ci FROM ct", [["0"]]],
  ["SELECT c = 'x' FROM ct", [["0"]]],
  ["SELECT c = _utf8mb4 'x' COLLATE utf8mb4_bin FROM ct", [["0"]]],
  ["SELECT c COLLATE latin1_bin = 'x' COLLATE utf8mb4_bin FROM ct", [1267,"Illegal mix of collations (latin1_bin,EXPLICIT) and (utf8mb4_bin,EXPLICIT) for operation '='"]],
  ["SELECT 'x' COLLATE latin1_bin", [1253,"COLLATION 'latin1_bin' is not valid for CHARACTER SET 'utf8mb4'"]],
  ["SELECT _latin1 'x' COLLATE latin1_bin", [["x"]]],
  ["SELECT _latin1 'x' COLLATE utf8mb4_bin", [1253,"COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'latin1'"]],
  ["SELECT a COLLATE latin1_bin FROM ct", [1253,"COLLATION 'latin1_bin' is not valid for CHARACTER SET 'utf8mb4'"]],
  ["SELECT c COLLATE utf8mb4_bin FROM ct", [1253,"COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'latin1'"]],
  ["SELECT 'x' COLLATE bogus_ci", [1273,"Unknown collation: 'bogus_ci'"]],
  ["SELECT 1 COLLATE utf8mb4_bin", [["1"]]],
  ["SELECT CONCAT('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin = 'b' COLLATE utf8mb4_bin", [["0"]]],
  ["SELECT REPLACE(a, b, 'x') FROM ct", [["a"]]],
  ["SELECT LOCATE(a, b) FROM ct", [["1"]]],
  ["SELECT INSTR(a, b) FROM ct", [["0"]]],
  ["SELECT a FROM ct ORDER BY CONCAT(a, b)", [["a"]]],
  ["SELECT a FROM ct UNION SELECT b FROM ct", [["a"],["A"]]],
  ["SELECT MAX(CONCAT(a,b)) FROM ct", [["aA"]]],
  ["SELECT CONCAT_WS(',', a, b) FROM ct", [["a,A"]]],
  ["SELECT LEFT(CONCAT(a,b),1) = 'a' FROM ct", [["1"]]],
  ["SELECT NULLIF(a, b) FROM ct", [["a"]]],
  ["SELECT STRCMP(a, b) FROM ct", [["1"]]],
  ["SELECT a < b FROM ct", [["0"]]],
  ["SELECT a <=> b FROM ct", [["0"]]],
  ["SET @x = 'a' COLLATE utf8mb4_bin", [0,0,"",0]],
  ["SELECT 'a' COLLATE utf8mb4_bin != 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation '<>'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin <> 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation '<>'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin < 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation '<'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin <=> 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation '<=>'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin LIKE 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'like'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin NOT LIKE 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'like'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin IN ('b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation '='"]],
  ["SELECT 'a' COLLATE utf8mb4_bin IN ('b' COLLATE utf8mb4_0900_ai_ci, 'c')", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (utf8mb4_0900_ai_ci,EXPLICIT), (utf8mb4_unicode_ci,COERCIBLE) for operation ' IN '"]],
  ["SELECT 'a' COLLATE utf8mb4_bin IN ('b' COLLATE utf8mb4_0900_ai_ci, 'c' COLLATE utf8mb4_general_ci)", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (utf8mb4_0900_ai_ci,EXPLICIT), (utf8mb4_general_ci,EXPLICIT) for operation ' IN '"]],
  ["SELECT 'a' COLLATE utf8mb4_bin BETWEEN 'b' COLLATE utf8mb4_0900_ai_ci AND 'c'", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (utf8mb4_0900_ai_ci,EXPLICIT), (utf8mb4_unicode_ci,COERCIBLE) for operation 'between'"]],
  ["SELECT STRCMP('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'strcmp'"]],
  ["SELECT REPLACE('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci, 'c')", [["a"]]],
  ["SELECT LOCATE('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [["0"]]],
  ["SELECT INSTR('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [["0"]]],
  ["SELECT CONCAT_WS('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat_ws'"]],
  ["SELECT CONCAT('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci, 'c')", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (utf8mb4_0900_ai_ci,EXPLICIT), (utf8mb4_unicode_ci,COERCIBLE) for operation 'concat'"]],
  ["SELECT CONCAT('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci, 'c' COLLATE utf8mb4_general_ci, 'd')", [1271,"Illegal mix of collations for operation 'concat'"]],
  ["SELECT GREATEST('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'greatest'"]],
  ["SELECT LEAST('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'least'"]],
  ["SELECT IF(1, 'a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'if'"]],
  ["SELECT IFNULL('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'ifnull'"]],
  ["SELECT COALESCE('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'coalesce'"]],
  ["SELECT NULLIF('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'nullif'"]],
  ["SELECT CASE WHEN 1 THEN 'a' COLLATE utf8mb4_bin ELSE 'b' COLLATE utf8mb4_0900_ai_ci END", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'case'"]],
  ["SELECT CASE 'a' COLLATE utf8mb4_bin WHEN 'b' COLLATE utf8mb4_0900_ai_ci THEN 1 END", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'case'"]],
  ["SELECT TRIM('a' COLLATE utf8mb4_bin FROM 'b' COLLATE utf8mb4_0900_ai_ci)", [["b"]]],
  ["SELECT LPAD('a' COLLATE utf8mb4_bin, 3, 'b' COLLATE utf8mb4_0900_ai_ci)", [["bba"]]],
  ["SELECT 'a' COLLATE utf8mb4_bin UNION SELECT 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'UNION'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin REGEXP 'b' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'regexp_like'"]],
  ["SELECT REGEXP_REPLACE('a', 'b', 'c' COLLATE utf8mb4_0900_ai_ci)", [["a"]]],
  ["SELECT REGEXP_REPLACE('a' COLLATE utf8mb4_bin, 'b', 'c' COLLATE utf8mb4_0900_ai_ci)", [["a"]]],
  ["SELECT @x = 'b' COLLATE utf8mb4_0900_ai_ci", [["0"]]],
  ["SELECT COLLATION(CONCAT(_utf8mb4'a' COLLATE utf8mb4_0900_ai_ci, 'b')), COERCIBILITY(CONCAT('a' COLLATE utf8mb4_0900_ai_ci, 'b'))", [["utf8mb4_0900_ai_ci","0"]]],
  ["SELECT JSON_OBJECT('a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [["[object Object]"]]],
  ["SELECT 'a' COLLATE utf8mb4_bin = 1", [["0"]]],
  ["SELECT x'61' = 'a' COLLATE utf8mb4_bin", [["1"]]],
  ["SELECT CONCAT(x'61', 'a' COLLATE utf8mb4_bin, 'b' COLLATE utf8mb4_0900_ai_ci)", [1270,"Illegal mix of collations (binary,COERCIBLE), (utf8mb4_bin,EXPLICIT), (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat'"]],
  ["SELECT x'41' COLLATE utf8mb4_bin", [1253,"COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'binary'"]],
  ["SELECT CAST('a' AS BINARY) COLLATE utf8mb4_bin", [1253,"COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'binary'"]],
  ["SELECT 1 COLLATE latin1_bin", [["1"]]],
  ["SELECT COLLATION(1 COLLATE utf8mb4_bin), COLLATION(1 COLLATE utf8mb4_0900_ai_ci)", [["utf8mb4_bin","utf8mb4_0900_ai_ci"]]],
  ["SELECT NULL COLLATE latin1_bin", [1253,"COLLATION 'latin1_bin' is not valid for CHARACTER SET 'binary'"]],
  ["SELECT 'a' COLLATE binary", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'binary' at line 1"]],
  ["SELECT x'41' COLLATE binary", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'binary' at line 1"]],
  ["SELECT COLLATION(CONVERT('a' USING latin1) COLLATE latin1_bin)", [["latin1_bin"]]],
  ["SELECT JSON_OBJECT() COLLATE utf8mb4_bin", [["{}"]]],
  ["SELECT JSON_OBJECT() COLLATE latin1_bin", [1253,"COLLATION 'latin1_bin' is not valid for CHARACTER SET 'utf8mb4'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin COLLATE utf8mb4_0900_ai_ci", [["a"]]],
  ["SELECT COLLATION('a' COLLATE utf8mb4_bin COLLATE utf8mb4_0900_ai_ci)", [["utf8mb4_0900_ai_ci"]]],
  ["SELECT _binary 'a' COLLATE utf8mb4_bin", [1253,"COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'binary'"]],
  ["SELECT _utf8mb3 'a' COLLATE utf8mb4_bin", [1253,"COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'utf8mb3'"]],
  ["SELECT _utf8mb3 'a' COLLATE utf8mb3_bin", [["a"]]],
  ["SELECT _utf8mb3 'a' COLLATE utf8_bin", [["a"]]],
  ["SELECT 'a' COLLATE utf8_bin", [1253,"COLLATION 'utf8_bin' is not valid for CHARACTER SET 'utf8mb4'"]],
  ["SELECT 'a' COLLATE UTF8MB4_BIN", [["a"]]],
  ["SELECT 'a' COLLATE 'utf8mb4_bin'", [["a"]]],
  ["SELECT 'a' COLLATE `utf8mb4_bin`", [["a"]]],
  ["SELECT COERCIBILITY(CONCAT(b,d)), COLLATION(CONCAT(b,d)) FROM ct", [["1","utf8mb4_bin"]]],
  ["SELECT CONCAT(b,d) = 'A' FROM ct", [1267,"Illegal mix of collations (utf8mb4_bin,NONE) and (utf8mb4_unicode_ci,COERCIBLE) for operation '='"]],
  ["SELECT CONCAT(b,d) = a FROM ct", [1267,"Illegal mix of collations (utf8mb4_bin,NONE) and (utf8mb4_bin,IMPLICIT) for operation '='"]],
  ["SELECT CONCAT(b,d) = d FROM ct", [1267,"Illegal mix of collations (utf8mb4_bin,NONE) and (utf8mb4_general_ci,IMPLICIT) for operation '='"]],
  ["SELECT CONCAT(b,d) = 'A' COLLATE utf8mb4_bin FROM ct", [["0"]]],
  ["SELECT COERCIBILITY(NULL), COERCIBILITY(1), COERCIBILITY(USER()), COERCIBILITY(@x), COERCIBILITY(CONCAT(1,2)), COLLATION(CONCAT(1,2))", [["6","5","3","2","4","utf8mb4_unicode_ci"]]],
  ["SELECT CONCAT(b, 1) = d FROM ct", [1267,"Illegal mix of collations (utf8mb4_0900_ai_ci,IMPLICIT) and (utf8mb4_general_ci,IMPLICIT) for operation '='"]],
  ["SELECT IF(1, b, d) FROM ct", [["A"]]],
  ["SELECT COERCIBILITY(IF(1, b, d)), COLLATION(IF(1,b,d)) FROM ct", [["1","utf8mb4_bin"]]],
  ["SELECT IF(1, b, d) = 'x' FROM ct", [1267,"Illegal mix of collations (utf8mb4_bin,NONE) and (utf8mb4_unicode_ci,COERCIBLE) for operation '='"]],
  ["SELECT CONCAT('a' COLLATE utf8mb4_bin, NULL, 'b' COLLATE utf8mb4_0900_ai_ci)", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (binary,IGNORABLE), (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat'"]],
  ["SELECT CONCAT('a' COLLATE utf8mb4_bin, 1, 'b' COLLATE utf8mb4_0900_ai_ci)", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (latin1_swedish_ci,NUMERIC), (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat'"]],
  ["SELECT CONCAT('a' COLLATE utf8mb4_bin, NOW(), 'b' COLLATE utf8mb4_0900_ai_ci)", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (latin1_swedish_ci,NUMERIC), (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat'"]],
  ["SELECT 'a' COLLATE utf8mb4_bin IN ('b' COLLATE utf8mb4_0900_ai_ci, 1)", [1270,"Illegal mix of collations (utf8mb4_bin,EXPLICIT), (utf8mb4_0900_ai_ci,EXPLICIT), (latin1_swedish_ci,NUMERIC) for operation ' IN '"]],
  ["SELECT CONCAT(a, _latin1'x' COLLATE latin1_bin) FROM ct", [1267,"Illegal mix of collations (utf8mb4_bin,IMPLICIT) and (latin1_bin,EXPLICIT) for operation 'concat'"]],
  ["SELECT CONCAT(a, c) FROM ct", [["aa"]]],
  ["SELECT COLLATION(CONCAT(a, c)) FROM ct", [["utf8mb4_bin"]]],
  ["SELECT COLLATION(CONCAT(c, 'x')) FROM ct", [["latin1_swedish_ci"]]],
  ["SELECT COLLATION(CONCAT(a, x'61')), COERCIBILITY(CONCAT(a, x'61')) FROM ct", [["utf8mb4_bin","2"]]],
  ["SELECT COLLATION(CONCAT('a' COLLATE utf8mb4_bin, x'61')), COERCIBILITY(CONCAT('a' COLLATE utf8mb4_bin, x'61'))", [["utf8mb4_bin","0"]]],
  ["SELECT COLLATION(CONCAT('a', x'61')), COERCIBILITY(CONCAT('a', x'61'))", [["binary","4"]]],
  ["SELECT COLLATION(IF(1, a, x'61')), COLLATION(COALESCE(a, x'61')) FROM ct", [["utf8mb4_bin","utf8mb4_bin"]]],
  ["SELECT COLLATION(CONCAT(a, CAST('x' AS BINARY))) FROM ct", [["binary"]]],
  ["SELECT COERCIBILITY(CAST('x' AS BINARY)), COERCIBILITY(x'61'), COERCIBILITY(BINARY 'x')", [["2","4","2"]]],
  ["SELECT 'b' COLLATE latin1_bin", [1253,"COLLATION 'latin1_bin' is not valid for CHARACTER SET 'utf8mb4'"]],
  ["SELECT 'b' COLLATE utf8mb4_bin = 'B' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation '='"]],
  ["SELECT CONCAT('b' COLLATE utf8mb4_bin, 'B' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'concat'"]],
  ["SELECT 'abc' COLLATE utf8mb4_bin REGEXP 'B' COLLATE utf8mb4_0900_ai_ci", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'regexp_like'"]],
  ["SELECT REGEXP_LIKE('abc' COLLATE utf8mb4_bin, 'B' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'regexp_like'"]],
  ["SELECT REGEXP_REPLACE('abc' COLLATE utf8mb4_bin, 'B', 'x' COLLATE utf8mb4_0900_ai_ci)", [["abc"]]],
  ["SELECT REGEXP_REPLACE('abc' COLLATE utf8mb4_bin, 'b', 'x' COLLATE utf8mb4_0900_ai_ci)", [["axc"]]],
  ["SELECT REGEXP_SUBSTR('abc' COLLATE utf8mb4_bin, 'B' COLLATE utf8mb4_0900_ai_ci)", [1267,"Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'regexp_substr'"]],
]

test('M5.10: collations are checked and aggregated as 8.4.11 does', async () => {
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
        actual = [err.errno, err.message]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
