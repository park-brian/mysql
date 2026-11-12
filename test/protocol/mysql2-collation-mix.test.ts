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
// 'nullif', 'case', 'UNION', 'regexp_like' (found by review). A literal
// whose characters the winning charset cannot hold is refused as a mix
// (`c = 'ж'` with c latin1), a convertible one is converted.
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
  ["CREATE TABLE cl (c VARCHAR(5) CHARACTER SET latin1, u VARCHAR(5))", [0,0,"",0]],
  ["INSERT INTO cl VALUES ('é', 'ж')", [1,0,"",0]],
  ["SELECT c = 'ж' FROM cl", [1267,"Illegal mix of collations (latin1_swedish_ci,IMPLICIT) and (utf8mb4_unicode_ci,COERCIBLE) for operation '='"]],
  ["SELECT c = 'é', c = 'e' FROM cl", [["1","1"]]],
  ["SELECT c IN ('a', 'ж') FROM cl", [1270,"Illegal mix of collations (latin1_swedish_ci,IMPLICIT), (utf8mb4_unicode_ci,COERCIBLE), (utf8mb4_unicode_ci,COERCIBLE) for operation ' IN '"]],
  ["SELECT u = 'é', u = _latin1'x' FROM cl", [["0","0"]]],
  ["SELECT CONCAT(c, 'ж') FROM cl", [1267,"Illegal mix of collations (latin1_swedish_ci,IMPLICIT) and (utf8mb4_unicode_ci,COERCIBLE) for operation 'concat'"]],
  ["SELECT c LIKE 'ж%' FROM cl", [1267,"Illegal mix of collations (latin1_swedish_ci,IMPLICIT) and (utf8mb4_unicode_ci,COERCIBLE) for operation 'like'"]],
  ["SELECT c = _utf8mb4'ж' COLLATE utf8mb4_bin FROM cl", [["0"]]],
]

test('M5.10: collations are checked and aggregated as 8.4.11 does', async () => {
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

async function collationConnection() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

async function readCollationRows(conn: mysql.Connection, sql: string, rows: unknown[][], fields: unknown[][]) {
  for (const method of ['query', 'execute'] as const) {
    const options = { sql, rowsAsArray: true }
    const [actual, metadata] = method === 'query' ? await conn.query(options) : await conn.execute(options)
    assert.deepEqual(actual, rows, `${method}: ${sql}`)
    assert.deepEqual(metadata.map((field) => [field.name, field.columnType, field.columnLength, field.flags, field.decimals, field.characterSet]), fields, `${method}: ${sql}`)
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
  }
}

async function rejectCollation(conn: mysql.Connection, sql: string, message: string, errno = 1267) {
  for (const method of ['query', 'execute'] as const) {
    await assert.rejects(() => method === 'query' ? conn.query(sql) : conn.execute(sql),
      { errno, sqlState: 'HY000', sqlMessage: message }, `${method}: ${sql}`)
    assert.deepEqual((await conn.query({ sql: 'SHOW WARNINGS', rowsAsArray: true }))[0], [['Error', errno, message]])
  }
}

test('M5.10: text choices use their resolved collation for grouping and bytes', async () => {
  const { db, conn } = await collationConnection()
  const schema = 'choice_collation'
  const read = readCollationRows.bind(undefined, conn)
  const choices = [
    { sql: (column: string, fallback: string) => `COALESCE(${column},${fallback})`, required: true },
    { sql: (column: string, fallback: string) => `IFNULL(${column},${fallback})`, required: true },
    { sql: (column: string, fallback: string) => `IF(${column} IS NULL,${fallback},${column})`, required: false },
    { sql: (column: string, fallback: string) => `CASE WHEN ${column} IS NULL THEN ${fallback} ELSE ${column} END`, required: false },
  ]
  const groups = [['x', 6], ['x ', 1], ['y', 1]]
  const count = ['COUNT(*)', 8, 21, 129, 0, 63]
  const bucket = (flags: number, decimals: number) => ['bucket', 253, 48, flags, decimals, 45]
  const hex = ['E9', 'C9', 'E9', 'E920', '65', 'E9', 'E9', '79']
  const hexFields = [['id', 3, 11, 20483, 0, 63], ['bytes', 253, 96, 0, 31, 45], ['cast_bytes', 253, 96, 0, 31, 45]]
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_general_ci')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g VARCHAR(12) COLLATE utf8mb4_0900_ai_ci,l VARCHAR(12) CHARACTER SET latin1)')
    await conn.query("INSERT INTO t VALUES (1,NULL,NULL),(2,'X','É'),(3,'x','é'),(4,'x ','é '),(5,'ẋ','e'),(6,'x','é'),(7,NULL,NULL),(8,'y','y')")
    for (const choice of choices) {
      const expr = choice.sql('g', "'x'")
      const copied = bucket(choice.required ? 1 : 32768, 0)
      await read(`SELECT ${expr} AS bucket,COUNT(*) FROM t GROUP BY 1`, groups, [copied, ['COUNT(*)', 8, 21, 1, 0, 63]])
      await read(`SELECT ${expr} AS bucket,COUNT(DISTINCT id) FROM t GROUP BY 1`, groups,
        [bucket(Number(choice.required), 31), ['COUNT(DISTINCT id)', 8, 21, 129, 0, 63]])
      await read(`SELECT ${expr} AS bucket,COUNT(*) FROM t GROUP BY 1 WITH ROLLUP`, [...groups, [null, 8]], [bucket(0, 31), count])
      await read(`SELECT DISTINCT ${expr} AS bucket FROM t`, [['x'], ['x '], ['y']], [copied])
      await read(`SELECT COUNT(DISTINCT ${expr}) AS n FROM t`, [[3]], [['n', 8, 21, 129, 0, 63]])

      const latin = choice.sql('l', "'é'")
      await read(`SELECT id,HEX(${latin}) AS bytes,HEX(CAST(${latin} AS BINARY)) AS cast_bytes FROM t ORDER BY id`,
        hex.map((bytes, i) => [i + 1, bytes, bytes]), hexFields)
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('M5.10: literal CONCAT text is checked during collation resolution', async () => {
  const { db, conn } = await collationConnection()
  const schema = 'concat_collation'
  const read = readCollationRows.bind(undefined, conn)
  const fields = [['id', 3, 11, 20483, 0, 63], ['result', 253, 48, 0, 31, 45]]
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_general_ci')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g VARCHAR(12) CHARACTER SET latin1)')
    await conn.query("INSERT INTO t VALUES (1,NULL),(2,'éx'),(3,NULL),(4,'ab')")
    for (const [expr, operation, collation] of [
      ["IF(1,g,CONCAT('😀','x'))", 'if', 'utf8mb4_general_ci'],
      ["COALESCE(g,CONCAT('a',CONCAT('😀','b')))", 'coalesce', 'utf8mb4_general_ci'],
      ["g=CONCAT(_utf8mb4'😀',_latin1'ñ')", '=', 'utf8mb4_0900_ai_ci'],
      ["g LIKE CONCAT('😀','x')", 'like', 'utf8mb4_general_ci'],
    ] as const) {
      const sql = `SELECT id,${expr} AS result FROM t ORDER BY id`
      const message = `Illegal mix of collations (latin1_swedish_ci,IMPLICIT) and (${collation},COERCIBLE) for operation '${operation}'`
      await rejectCollation(conn, sql, message)
    }
    await read("SELECT id,COALESCE(g,CONCAT('é','x')) AS result FROM t ORDER BY id",
      [[1, 'éx'], [2, 'éx'], [3, 'éx'], [4, 'ab']], fields)
    await read("SELECT id,IFNULL(g,CONCAT(NULLIF('😀','😀'),'x')) AS result FROM t ORDER BY id",
      [[1, null], [2, 'éx'], [3, null], [4, 'ab']], fields)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('M5.10: NULL-producing expressions do not supply text to collation resolution', async () => {
  const { db, conn } = await collationConnection()
  const schema = 'nullable_collation'
  const result = (expr: string) => `SELECT COALESCE(_latin1'q' COLLATE latin1_swedish_ci,${expr}) AS result`
  const text = "CONCAT('😀','x')"
  try {
    await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_general_ci')
    for (const expr of [
      `NULLIF(${text},${text})`,
      `NULLIF(${text},CONCAT('😀','X'))`,
      `NULLIF(${text},CONCAT('😀','x '))`,
      `NULLIF(${text},CONCAT('😀','X') COLLATE utf8mb4_general_ci)`,
      `NULLIF(${text},X'F09F988078')`,
      `NULLIF(NULLIF(${text},'y'),'😀X')`,
      `NULLIF(${text},NULLIF(${text},'y'))`,
      `ANY_VALUE(NULLIF(${text},${text}))`,
      `(SELECT ${text} WHERE 0)`,
      `(SELECT ${text} WHERE 1=0)`,
      `(SELECT ${text} WHERE 0 OR 0)`,
      `(SELECT ${text} HAVING FALSE)`,
      `(SELECT ${text} WHERE 0 LIMIT 0)`,
    ]) {
      await readCollationRows(conn, result(expr), [['q']], [['result', 253, 8, 0, 31, 45]])
    }
    const error = "Illegal mix of collations (latin1_swedish_ci,EXPLICIT) and (utf8mb4_general_ci,COERCIBLE) for operation 'coalesce'"
    for (const expr of [
      `NULLIF(${text},'y')`,
      `NULLIF(${text},NULL)`,
      `NULLIF(NULLIF(${text},'y'),'z')`,
      `NULLIF(${text},NULLIF(${text},'😀X'))`,
      `(SELECT ${text})`,
      `(SELECT ${text} LIMIT 0)`,
      `(SELECT ${text} WHERE 0 HAVING COUNT(*)=0)`,
    ]) {
      await rejectCollation(conn, result(expr), error)
    }

    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g VARCHAR(12) CHARACTER SET latin1,u VARCHAR(12) COLLATE utf8mb4_general_ci)')
    await conn.query("INSERT INTO t VALUES (1,NULL,'😀x'),(2,'éx','y'),(3,NULL,'😀X')")
    await conn.query("SET @u='😀x'")
    const fields = [['id', 3, 11, 20483, 0, 63], ['result', 8, 1, 128, 0, 63]]
    const select = (expr: string, where = '') => `SELECT id,${expr} AS result FROM t${where} ORDER BY id`
    const comparisonError = "Illegal mix of collations (latin1_swedish_ci,IMPLICIT) and (utf8mb4_general_ci,COERCIBLE) for operation '='"
    for (const expr of [
      `NULLIF(${text},@u)`,
      `(SELECT ${text} FROM t t2 WHERE 0)`,
      `(SELECT ${text} WHERE @u='0')`,
      `(SELECT ${text} WHERE 0 HAVING COUNT(*)>0)`,
    ]) {
      await readCollationRows(conn, select(`g=${expr}`), [[1, null], [2, null], [3, null]], fields)
    }
    const live = `(SELECT ${text} FROM t t2 WHERE t2.id=1)`
    const conversion = "Cannot convert string '\\xF0\\x9F\\x98\\x80x' from utf8mb4 to latin1"
    for (const expr of [`g=${live}`, `g LIKE ${live}`, `g IN (NULLIF(${text},u))`]) {
      await readCollationRows(conn, select(expr, ' WHERE id=1'), [[1, null]], fields)
      await rejectCollation(conn, select(expr), conversion, 3854)
    }
    await readCollationRows(conn, select(`g<=>${live}`, ' WHERE id=1'), [[1, 0]],
      [fields[0]!, ['result', 8, 1, 129, 0, 63]])
    await rejectCollation(conn, select(`${live}=g`, ' WHERE id=1'), conversion, 3854)
    await rejectCollation(conn, select(`g IN ((SELECT ${text} FROM t t2 WHERE 0))`), comparisonError)
    await rejectCollation(conn, select(`g=NULLIF(NULLIF(${text},'y'),'z')`), comparisonError)
    await rejectCollation(conn, select(`g=NULLIF(${text},NULLIF(${text},'😀X'))`), comparisonError)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
