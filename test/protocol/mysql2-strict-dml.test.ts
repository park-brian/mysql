// A strict mode in a statement that changes data, as 8.4.11 ran each of
// these statements.
//
// What it pins: `Strict_error_handler` — under STRICT_TRANS_TABLES or
// STRICT_ALL_TABLES, an INSERT, REPLACE, UPDATE, DELETE or CREATE TABLE that
// does not say IGNORE fails on a warning of the codes it lists (1292, 1365,
// 3020, …), wherever in the statement the expression is: the value stored,
// an UPDATE's or DELETE's WHERE, a subquery, an upsert's assignment (only
// when it runs). SELECT, SET and DO keep them as warnings. Division by zero
// warns only under ERROR_FOR_DIVISION_BY_ZERO, and is an error only with a
// strict mode too. The info line counts every condition. Text past the
// largest double is it, with 1292; CAST AS FLOAT rounds to a single and is
// 1690 past the largest one, the message printing the expression as
// `Item::print` does (`-(1e39)`, `((-(1.5) * 1e308) * 10)`). Zero dates are
// refused under NO_ZERO_DATE and NO_ZERO_IN_DATE, and `mysql2`'s
// CLIENT_IGNORE_SPACE puts IGNORE_SPACE first in the session's mode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT PRIMARY KEY, v INT, s VARCHAR(10))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1, 1, 'a')", [1,0,"",0]],
  ["SELECT 1/0, 1 DIV 0, 1 % 0, MOD(1, 0)", [[null,null,null,null]]],
  ["SHOW WARNINGS", [["Warning","1365","Division by 0"],["Warning","1365","Division by 0"],["Warning","1365","Division by 0"],["Warning","1365","Division by 0"]]],
  ["INSERT INTO t VALUES (2, 1/0, 'a')", [1365,"Division by 0"]],
  ["SHOW WARNINGS", [["Error","1365","Division by 0"]]],
  ["INSERT INTO t VALUES (2, MOD(1, 0), 'a')", [1365,"Division by 0"]],
  ["INSERT INTO t SELECT 3, 1/0, 'a'", [1365,"Division by 0"]],
  ["UPDATE t SET v = 1/0", [1365,"Division by 0"]],
  ["UPDATE t SET v = 2 WHERE v = 1/0", [1365,"Division by 0"]],
  ["DELETE FROM t WHERE v = 1/0", [1365,"Division by 0"]],
  ["INSERT IGNORE INTO t VALUES (2, 1/0, 'a')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1365","Division by 0"]]],
  ["INSERT INTO t VALUES (3, 'abc' + 1, 'a')", [1292,"Truncated incorrect DOUBLE value: 'abc'"]],
  ["UPDATE t SET v = 2 WHERE id = 'abc'", [1292,"Truncated incorrect DOUBLE value: 'abc'"]],
  ["UPDATE t SET v = 2 WHERE s = 1", [1292,"Truncated incorrect DOUBLE value: 'a'"]],
  ["DELETE FROM t WHERE id = '1x'", [1292,"Truncated incorrect DOUBLE value: '1x'"]],
  ["INSERT INTO t VALUES (3, LN(0), 'a')", [3020,"Invalid argument for logarithm"]],
  ["INSERT INTO t VALUES (3, CAST('12abc' AS SIGNED), 'a')", [1292,"Truncated incorrect INTEGER value: '12abc'"]],
  ["INSERT INTO t VALUES (3, CAST('1e400' AS DOUBLE), 'a')", [1292,"Truncated incorrect DOUBLE value: '1e400'"]],
  ["INSERT INTO t VALUES (5, 1, 'a') ON DUPLICATE KEY UPDATE v = 'x' + 1", [1,0,"",0]],
  ["INSERT INTO t VALUES (1, 1, 'a') ON DUPLICATE KEY UPDATE v = 'x' + 1", [1292,"Truncated incorrect DOUBLE value: 'x'"]],
  ["REPLACE INTO t VALUES (6, 'abc' + 1, 'a')", [1292,"Truncated incorrect DOUBLE value: 'abc'"]],
  ["INSERT INTO t VALUES (7, (SELECT 'abc' + 1), 'a')", [1292,"Truncated incorrect DOUBLE value: 'abc'"]],
  ["INSERT INTO t VALUES (8, 1, CONCAT(1/0))", [1365,"Division by 0"]],
  ["CREATE TABLE t2 AS SELECT 1/0 AS a", [1365,"Division by 0"]],
  ["CREATE TABLE t3 AS SELECT 'abc' + 1 AS a", [1292,"Truncated incorrect DOUBLE value: 'abc'"]],
  ["SET @a = 'abc' + 1", [0,0,"",1]],
  ["DO 1/0", [0,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1365","Division by 0"]]],
  ["SELECT * FROM t ORDER BY id", [["1","1","a"],["2",null,"a"],["5","1","a"]]],
  ["SET sql_mode = 'STRICT_TRANS_TABLES'", [0,0,"",1]],
  ["INSERT INTO t VALUES (4, 1/0, 'a')", [1,0,"",0]],
  ["SHOW WARNINGS", []],
  ["SELECT 1/0", [[null]]],
  ["SHOW WARNINGS", []],
  ["SET sql_mode = 'ERROR_FOR_DIVISION_BY_ZERO'", [0,0,"",1]],
  ["INSERT INTO t VALUES (9, 1/0, 'a')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1365","Division by 0"]]],
  ["UPDATE t SET v = 2 WHERE id = 'abc'", [0,0,"Rows matched: 0  Changed: 0  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: 'abc'"]]],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["INSERT INTO t VALUES (10, 1/0, 'a')", [1,0,"",0]],
  ["SELECT 1/0", [[null]]],
  ["SHOW WARNINGS", []],
  ["INSERT INTO t VALUES (11, 'abc' + 1, 'a'), (12, 'x', 'a')", [2,0,"Records: 2  Duplicates: 0  Warnings: 2",2]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: 'abc'"],["Warning","1366","Incorrect integer value: 'x' for column 'v' at row 2"]]],
  ["SELECT * FROM t ORDER BY id", [["1","1","a"],["2",null,"a"],["4",null,"a"],["5","1","a"],["9",null,"a"],["10",null,"a"],["11","1","a"],["12","0","a"]]],
  ["SET sql_mode = DEFAULT", [0,0,"",0]],
  ["SELECT CAST('1e400' AS DOUBLE), CAST('-1e400' AS DOUBLE), '1e400' + 0, CAST('2e308x' AS DOUBLE)", [["1.7976931348623157e+308","-1.7976931348623157e+308","1.7976931348623157e+308","1.7976931348623157e+308"]]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: '1e400'"],["Warning","1292","Truncated incorrect DOUBLE value: '-1e400'"],["Warning","1292","Truncated incorrect DOUBLE value: '1e400'"],["Warning","1292","Truncated incorrect DOUBLE value: '2e308x'"]]],
  ["SELECT CAST(1e300 AS FLOAT)", [1690,"DOUBLE value is out of range in 'cast(1e300 as float)'"]],
  ["SELECT CAST(3.4e38 AS FLOAT), CAST(-3.4e38 AS FLOAT), CAST(3.4028234e38 AS FLOAT)", [["3.4e+38","-3.4e+38","3.40282e+38"]]],
  ["SELECT CAST(3.40282350e38 AS FLOAT)", [1690,"DOUBLE value is out of range in 'cast(3.40282350e38 as float)'"]],
  ["SELECT CAST(-1e39 AS FLOAT)", [1690,"DOUBLE value is out of range in 'cast(-(1e39) as float)'"]],
  ["SELECT CAST('5e38' AS FLOAT)", [1690,"DOUBLE value is out of range in 'cast('5e38' as float)'"]],
  ["SELECT CAST(1e300 AS FLOAT(10)), CAST(1e300 AS FLOAT(25))", [1690,"DOUBLE value is out of range in 'cast(1e300 as float)'"]],
  ["SELECT CAST(1.23456789 AS FLOAT), CAST(123456789 AS FLOAT), CAST(0.1 AS FLOAT), CAST(1e-50 AS FLOAT), CAST(-0.000001234567 AS FLOAT)", [["1.23457","123457000","0.1","0","-0.00000123457"]]],
  ["SELECT CAST(16777217 AS FLOAT) = 16777217, CAST(0.1 AS FLOAT) = 0.1, CAST(0.1 AS FLOAT) * 10, CAST(16777217 AS FLOAT) + 0", [["0","0","1.0000000149011612","16777216"]]],
  ["SELECT 1.5e10 * 1e300", [1690,"DOUBLE value is out of range in '(1.5e10 * 1e300)'"]],
  ["SELECT 1.0e300 * 1e10", [1690,"DOUBLE value is out of range in '(1.0e300 * 1e10)'"]],
  ["SELECT -1.5 * 1e308 * 10", [1690,"DOUBLE value is out of range in '((-(1.5) * 1e308) * 10)'"]],
  ["SELECT -9223372036854775807 * 10", [1690,"BIGINT value is out of range in '(-(9223372036854775807) * 10)'"]],
  ["SELECT v * 1e308 * 1e10 FROM t WHERE id = 1", [1690,"DOUBLE value is out of range in '((`app`.`t`.`v` * 1e308) * 1e10)'"]],
  ["CREATE TABLE d (a DATE, b DATETIME, c TIME)", [0,0,"",0]],
  ["INSERT INTO d (a) VALUES ('0000-00-00')", [1292,"Incorrect date value: '0000-00-00' for column 'a' at row 1"]],
  ["INSERT INTO d (a) VALUES ('2020-00-10')", [1292,"Incorrect date value: '2020-00-10' for column 'a' at row 1"]],
  ["INSERT INTO d (b) VALUES ('0000-00-00 00:00:00')", [1292,"Incorrect datetime value: '0000-00-00 00:00:00' for column 'b' at row 1"]],
  ["INSERT IGNORE INTO d (a) VALUES ('0000-00-00')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1264","Out of range value for column 'a' at row 1"]]],
  ["INSERT INTO d (c) VALUES ('2020-01-01 10:00:00')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Note","1292","Incorrect time value: '2020-01-01 10:00:00' for column 'c' at row 1"]]],
  ["INSERT INTO d (c) VALUES ('2020-01-01 10:00:00x')", [1292,"Incorrect time value: '2020-01-01 10:00:00x' for column 'c' at row 1"]],
  ["SELECT @@sql_mode", [["ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"]]],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["INSERT INTO d (a) VALUES ('0000-00-00')", [1,0,"",0]],
  ["INSERT INTO d (c) VALUES ('2020-01-01 10:00:00')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Note","1265","Data truncated for column 'c' at row 1"]]],
  ["SELECT * FROM d", [["0000-00-00",null,null],[null,null,"10:00:00"],["0000-00-00",null,null],[null,null,"10:00:00"]]],
]

test('a strict mode fails a data-changing statement on the warnings 8.4.11 fails it on', async () => {
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
