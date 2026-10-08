// ENUM and SET columns and hex literals as values, as 8.4.11 answered (found
// by review). An ENUM or SET column is its member index or bitmap in a
// numeric context, and sorts by it, while MIN, MAX and comparisons with
// strings use its text. A number stored into one is an index or a bitmap,
// whatever its type (`e + 1` is a DOUBLE), and so is a string of digits no
// member is named; 0 is not an index, while '0' is the error value ''.
// The index stays with the column: a scalar subquery, a user variable, MIN
// and MAX hand on plain text. A hex literal is a number in arithmetic, a
// scalar subquery keeps that, and a derived table, a UNION, COALESCE, MIN
// and MAX make it plain VARBINARY, which reads as 0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT, e ENUM('b','a','10','2'), s SET('x','y','z'))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1,'b','x'),(2,'a','y,z'),(3,'10','x,y,z'),(4,'2',''),(5,NULL,NULL)", [5,0,"Records: 5  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, e+0, s+0, e*1, s-1, -e, e/2, e DIV 2, e % 3 FROM t ORDER BY id", [["1","1","1","1","0","-1","0.5","0","1"],["2","2","6","2","5","-2","1","1","2"],["3","3","7","3","6","-3","1.5","1","0"],["4","4","0","4","-1","-4","2","2","1"],["5",null,null,null,null,null,null,null,null]]],
  ["SELECT id FROM t WHERE e = 2 ORDER BY id", [["2"]]],
  ["SELECT id FROM t WHERE e = '2' ORDER BY id", [["4"]]],
  ["SELECT id FROM t WHERE e = 2.0 ORDER BY id", [["2"]]],
  ["SELECT id FROM t WHERE e > 2 ORDER BY id", [["3"],["4"]]],
  ["SELECT id FROM t WHERE e IN (1, 4) ORDER BY id", [["1"],["4"]]],
  ["SELECT id FROM t WHERE e IN ('a', 4) ORDER BY id", [["2"],["4"]]],
  ["SELECT id FROM t WHERE e BETWEEN 2 AND 3 ORDER BY id", [["2"],["3"]]],
  ["SELECT id FROM t WHERE s = 6 ORDER BY id", [["2"]]],
  ["SELECT id FROM t WHERE s & 2 ORDER BY id", [["2"],["3"]]],
  ["SELECT id FROM t WHERE e = 0", []],
  ["SELECT id FROM t WHERE e = s ORDER BY id", []],
  ["SELECT id FROM t WHERE e <=> 2", [["2"]]],
  ["SELECT SUM(e), AVG(e), MIN(e), MAX(e), SUM(s), MIN(s), MAX(s), BIT_OR(s), COUNT(DISTINCT e) FROM t", [["10","2.5","10","b","14","","y,z","7","4"]]],
  ["SELECT GROUP_CONCAT(e ORDER BY e), GROUP_CONCAT(s ORDER BY s) FROM t", [["b,a,10,2",",x,y,z,x,y,z"]]],
  ["SELECT id, e FROM t ORDER BY e, id", [["5",null],["1","b"],["2","a"],["3","10"],["4","2"]]],
  ["SELECT id, s FROM t ORDER BY s, id", [["5",null],["4",""],["1","x"],["2","y,z"],["3","x,y,z"]]],
  ["SELECT e, COUNT(*) FROM t GROUP BY e ORDER BY e", [[null,"1"],["b","1"],["a","1"],["10","1"],["2","1"]]],
  ["SELECT CAST(e AS UNSIGNED), CAST(e AS CHAR), CAST(s AS SIGNED), CAST(e AS DECIMAL(5,1)), CAST(e AS DOUBLE) FROM t ORDER BY id", [["1","b","1","1.0","1"],["2","a","6","2.0","2"],["3","10","7","3.0","3"],["4","2","0","4.0","4"],[null,null,null,null,null]]],
  ["SELECT JSON_ARRAY(e, s), JSON_OBJECT('e', e) FROM t ORDER BY id", [["b,x","[object Object]"],["a,y,z","[object Object]"],["10,x,y,z","[object Object]"],["2,","[object Object]"],[",","[object Object]"]]],
  ["SELECT IF(1, e, 0) + 0, COALESCE(e) + 0, IFNULL(e, 0) + 0, CASE WHEN 1 THEN e END + 0, NULLIF(e, 'zz') + 0 FROM t ORDER BY id", [["1","0","0","1","1"],["2","0","0","2","2"],["3","10","10","3","3"],["4","2","2","4","4"],[null,null,"0",null,null]]],
  ["SELECT x + 0 FROM (SELECT e x FROM t) d ORDER BY id", [1054,"Unknown column 'id' in 'order clause'"]],
  ["SELECT x + 0 FROM (SELECT e x, id FROM t) d ORDER BY id", [["1"],["2"],["3"],["4"],[null]]],
  ["SELECT (SELECT e FROM t WHERE id = 3) + 0", [["10"]]],
  ["SELECT MAX(e) + 0, MIN(s) + 0 FROM t", [["0","0"]]],
  ["SELECT e, e + 0 FROM t WHERE id = 2 UNION ALL SELECT 'q', 1", [["a","2"],["q","1"]]],
  ["SELECT e LIKE '1%', e REGEXP '^1', LENGTH(e), CHAR_LENGTH(s), HEX(e), HEX(s) FROM t ORDER BY id", [["0","0","1","1","62","78"],["0","0","1","3","61","792C7A"],["1","1","2","5","3130","782C792C7A"],["0","0","1","0","32",""],[null,null,null,null,null,null]]],
  ["SELECT id, e = 'A', e = 'a ' FROM t ORDER BY id", [["1","0","0"],["2","1","0"],["3","0","0"],["4","0","0"],["5",null,null]]],
  ["SELECT id FROM t WHERE e = 10", []],
  ["SELECT id FROM t WHERE e = '10'", [["3"]]],
  ["SELECT id, e + 0.5, e + 1e0, e > 1.5 FROM t ORDER BY id", [["1","1.5","2","0"],["2","2.5","3","1"],["3","3.5","4","1"],["4","4.5","5","1"],["5",null,null,null]]],
  ["SET @v = (SELECT e FROM t WHERE id = 3)", [0,0,"",0]],
  ["SELECT @v, @v + 0", [["10","10"]]],
  ["SELECT DATE_ADD('2020-01-01', INTERVAL e DAY) FROM t WHERE id = 2", [["2020-01-03"]]],
  ["SELECT id, e, s FROM t ORDER BY e DESC, id", [["4","2",""],["3","10","x,y,z"],["2","a","y,z"],["1","b","x"],["5",null,null]]],
  ["SELECT id FROM t ORDER BY e + 0 DESC, id", [["4"],["3"],["2"],["1"],["5"]]],
  ["UPDATE t SET e = e + 1 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["UPDATE t SET s = s | 4 WHERE id = 2", [1,0,"Rows matched: 1  Changed: 0  Warnings: 0",0]],
  ["SELECT id, e, s FROM t ORDER BY id", [["1","a","x"],["2","a","y,z"],["3","10","x,y,z"],["4","2",""],["5",null,null]]],
  ["CREATE TABLE u (i INT, d DECIMAL(5,2), v VARCHAR(10), e2 ENUM('b','a','10','2'))", [0,0,"",0]],
  ["INSERT INTO u SELECT e, e, e, e FROM t", [5,0,"Records: 5  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM u", [["2","2.00","a","a"],["2","2.00","a","a"],["3","3.00","10","10"],["4","4.00","2","2"],[null,null,null,null]]],
  ["SELECT e IS TRUE, NOT e, e AND 1, e XOR 1 FROM t ORDER BY id", [["1","0","1","0"],["1","0","1","0"],["1","0","1","0"],["1","0","1","0"],["0",null,null,null]]],
  ["SELECT CONCAT(e) + 0, UPPER(e) + 0, LOWER(e) = 2, SUBSTRING(e,1) + 0, REPLACE(e,'q','r') + 0 FROM t ORDER BY id", [["0","0","0","0","0"],["0","0","0","0","0"],["10","10","0","10","10"],["2","2","1","2","2"],[null,null,null,null,null]]],
  ["SELECT ABS(e), FLOOR(e), SIGN(e), e = TRUE, CEIL(s) FROM t ORDER BY id", [["2","2","1","0","1"],["2","2","1","0","6"],["3","3","1","0","7"],["4","4","1","0","0"],[null,null,null,null,null]]],
  ["SELECT e << 1, e | 0, ~e & 15 FROM t ORDER BY id", [["4","2","13"],["4","2","13"],["6","3","12"],["8","4","11"],[null,null,null]]],
  ["SELECT LEFT('abcdef', e) FROM t WHERE id = 2", [["ab"]]],
  ["SELECT e2 + 0 FROM u ORDER BY 1", [[null],["2"],["2"],["3"],["4"]]],
  ["SELECT DISTINCT e + 0 FROM t ORDER BY 1", [[null],["2"],["3"],["4"]]],
  ["SELECT e FROM t GROUP BY e HAVING e > 1 ORDER BY e", [["a"],["10"],["2"]]],
  ["SELECT e FROM t GROUP BY e HAVING e + 0 > 1 ORDER BY 1", [["a"],["10"],["2"]]],
  ["SELECT id FROM t WHERE e IN (SELECT 2) ORDER BY id", [["1"],["2"]]],
  ["SELECT id FROM t WHERE (e, id) = (2, 2)", [["2"]]],
  ["SELECT e + 0 FROM t WHERE id = 2 UNION SELECT 1", [["2"],["1"]]],
  ["SELECT x FROM (SELECT e x FROM t UNION SELECT 'zz') d ORDER BY x", [[null],["10"],["2"],["a"],["zz"]]],
  ["SELECT JSON_EXTRACT(JSON_ARRAY(e), '$[0]') FROM t ORDER BY id", [["a"],["a"],["10"],["2"],[null]]],
  ["SELECT CAST(e AS JSON) FROM t ORDER BY id", [["a"],["a"],["10"],["2"],[null]]],
  ["DROP TABLE t, u", [0,0,"",0]],
  ["CREATE TABLE t (id INT, e ENUM('b','a','10','2'), s SET('x','y','z','1'))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1, 2, 1)", [1,0,"",0]],
  ["INSERT INTO t VALUES (2, '2', '1')", [1,0,"",0]],
  ["INSERT INTO t VALUES (3, 4, 8)", [1,0,"",0]],
  ["INSERT INTO t VALUES (4, 2.0, 3)", [1,0,"",0]],
  ["INSERT INTO t VALUES (5, '4', '3')", [1,0,"",0]],
  ["INSERT INTO t VALUES (6, 1+1, 0)", [1,0,"",0]],
  ["SELECT id, e, e+0, s, s+0 FROM t ORDER BY id", [["1","a","2","x","1"],["2","2","4","1","8"],["3","2","4","1","8"],["4","a","2","x,y","3"],["5","2","4","x,y","3"],["6","a","2","","0"]]],
  ["UPDATE t SET e = e + 1 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["UPDATE t SET e = 1 WHERE id = 2", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["UPDATE t SET s = s | 8 WHERE id = 3", [1,0,"Rows matched: 1  Changed: 0  Warnings: 0",0]],
  ["SELECT id, e, e+0, s, s+0 FROM t ORDER BY id", [["1","10","3","x","1"],["2","b","1","1","8"],["3","2","4","1","8"],["4","a","2","x,y","3"],["5","2","4","x,y","3"],["6","a","2","","0"]]],
  ["SELECT MAX(e), MIN(e), MAX(s), MIN(s) FROM t", [["b","10","x,y",""]]],
  ["SELECT CAST(e AS JSON), CAST(s AS JSON) FROM t ORDER BY id", [["10","x"],["b","1"],["2","1"],["a","x,y"],["2","x,y"],["a",""]]],
  ["SELECT id FROM t ORDER BY e, id", [["2"],["4"],["6"],["1"],["3"],["5"]]],
  ["SELECT id FROM t ORDER BY s, id", [["6"],["1"],["4"],["5"],["2"],["3"]]],
  ["SELECT DATE_ADD('2020-01-01', INTERVAL e DAY) FROM t ORDER BY id", [["2020-01-04"],["2020-01-02"],["2020-01-05"],["2020-01-03"],["2020-01-05"],["2020-01-03"]]],
  ["SELECT (SELECT e FROM t WHERE id = 3) + 0", [["2"]]],
  ["DROP TABLE t", [0,0,"",0]],
  ["CREATE TABLE t (id INT, e ENUM('b','a','10','2'), s SET('x','y','z','1'))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1,'b','x'),(2,'a','y'),(3,'10','x,y'),(4,'2','1')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT e+0, e+1, e*1.0, e+0e0 FROM t WHERE id=1", [["1","2","1","1"]]],
  ["UPDATE t SET e = e + 1 WHERE id = 2", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT e FROM t WHERE id=2", [["10"]]],
  ["UPDATE t SET e = 3.0 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["INSERT INTO t VALUES (5, 3.0, 2.0)", [1,0,"",0]],
  ["INSERT INTO t VALUES (6, 3e0, 2e0)", [1,0,"",0]],
  ["INSERT INTO t VALUES (7, '3', '2')", [1,0,"",0]],
  ["INSERT INTO t VALUES (8, ' 3', '2 ')", [1265,"Data truncated for column 's' at row 1"]],
  ["INSERT INTO t VALUES (9, '3x', '')", [1265,"Data truncated for column 'e' at row 1"]],
  ["INSERT INTO t VALUES (10, 5, 16)", [1265,"Data truncated for column 'e' at row 1"]],
  ["INSERT INTO t VALUES (11, '5', '16')", [1265,"Data truncated for column 'e' at row 1"]],
  ["INSERT INTO t VALUES (12, 0, 0)", [1265,"Data truncated for column 'e' at row 1"]],
  ["INSERT INTO t VALUES (13, '0', '0')", [1,0,"",0]],
  ["SELECT id, e, s FROM t ORDER BY id", [["1","10","x"],["2","10","y"],["3","10","x,y"],["4","2","1"],["5","10","y"],["6","10","y"],["7","10","y"],["13","",""]]],
  ["SELECT DATE_ADD('2020-01-01', INTERVAL e DAY), DATE_ADD('2020-01-01', INTERVAL s DAY) FROM t WHERE id=1", [["2020-01-04","2020-01-02"]]],
  ["SELECT id FROM t ORDER BY e, id", [["13"],["1"],["2"],["3"],["5"],["6"],["7"],["4"]]],
  ["SELECT id FROM t ORDER BY s, id", [["13"],["1"],["2"],["5"],["6"],["7"],["3"],["4"]]],
  ["SELECT MAX(e), MIN(e), MAX(s), MIN(s) FROM t WHERE id < 5", [["2","10","y","1"]]],
  ["DROP TABLE t", [0,0,"",0]],
  ["CREATE TABLE t (id INT, e ENUM('b','a','10','2'), s SET('x','y','z','1'))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1,'b','z'),(2,'a','y'),(3,'10','x,y'),(4,'2','1')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM t ORDER BY e, id", [["1"],["2"],["3"],["4"]]],
  ["SELECT id FROM t ORDER BY s, id", [["2"],["3"],["1"],["4"]]],
  ["SELECT MAX(e), MIN(e), MAX(s), MIN(s) FROM t", [["b","10","z","1"]]],
  ["SELECT e FROM t GROUP BY e", [["b"],["a"],["10"],["2"]]],
  ["SELECT GROUP_CONCAT(e ORDER BY e) FROM t", [["b,a,10,2"]]],
  ["SELECT id FROM t ORDER BY e DESC LIMIT 1", [["4"]]],
  ["SELECT e, ROW_NUMBER() OVER (ORDER BY e) FROM t", [["b","1"],["a","2"],["10","3"],["2","4"]]],
  ["SELECT DISTINCT e FROM t ORDER BY e", [["b"],["a"],["10"],["2"]]],
  ["SELECT id FROM t WHERE e > 'a' ORDER BY id", [["1"]]],
  ["SELECT id FROM t WHERE e < 3 ORDER BY id", [["1"],["2"]]],
  ["SELECT id FROM t WHERE e > '2' ORDER BY id", [["1"],["2"]]],
  ["SELECT * FROM t a JOIN t b ON a.e = b.id ORDER BY a.id", [["1","b","z","1","b","z"],["2","a","y","2","a","y"],["3","10","x,y","3","10","x,y"],["4","2","1","4","2","1"]]],
  ["SELECT id FROM t WHERE e = (SELECT 2)", [["2"]]],
  ["SELECT id FROM t WHERE e IN (SELECT id FROM t WHERE id = 2)", [["2"]]],
  ["DROP TABLE t", [0,0,"",0]],
  ["CREATE TABLE t (id INT, e ENUM('b','a','10','2'), s SET('x','y','z'))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1,'b','x'),(2,'a','y,z'),(3,'10','x,y,z'),(4,'2','')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT CONCAT(e) + 0, UPPER(e) + 0, LOWER(e) = 2, REPLACE(e,'q','r') + 0, REGEXP_REPLACE(e,'q','r') + 0, REGEXP_SUBSTR(e, '.*') + 0 FROM t ORDER BY id", [["0","0","0","0","0","0"],["0","0","0","0","0","0"],["10","10","0","10","10","10"],["2","2","1","2","2","2"]]],
  ["SELECT IF(1, e, 0) + 0, COALESCE(e) + 0, IFNULL(e, 0) + 0, CASE WHEN 1 THEN e END + 0, NULLIF(e, 'zz') + 0 FROM t ORDER BY id", [["1","0","0","1","1"],["2","0","0","2","2"],["3","10","10","3","3"],["4","2","2","4","4"]]],
  ["SELECT x + 0 FROM (SELECT e x, id FROM t) d ORDER BY id", [["1"],["2"],["3"],["4"]]],
  ["WITH c AS (SELECT e x, id FROM t) SELECT x + 0 FROM c ORDER BY id", [["1"],["2"],["3"],["4"]]],
  ["SELECT x + 0 FROM (SELECT e x, id FROM t UNION ALL SELECT 'zz', 9) d ORDER BY id", [["0"],["0"],["10"],["2"],["0"]]],
  ["SELECT ABS(e), SIGN(e), e = TRUE, CEIL(s) FROM t ORDER BY id", [["1","1","1","1"],["2","1","0","6"],["3","1","0","7"],["4","1","0","0"]]],
  ["SELECT e << 1, e | 0, ~e & 15 FROM t ORDER BY id", [["2","1","14"],["4","2","13"],["6","3","12"],["8","4","11"]]],
  ["SELECT CAST(e AS JSON) FROM t ORDER BY id", [["b"],["a"],["10"],["2"]]],
  ["SELECT JSON_ARRAY(e, s) FROM t ORDER BY id", [["b,x"],["a,y,z"],["10,x,y,z"],["2,"]]],
  ["SELECT e IS TRUE, NOT e, e AND 1, e XOR 1, e || 0 FROM t ORDER BY id", [["1","0","1","0","1"],["1","0","1","0","1"],["1","0","1","0","1"],["1","0","1","0","1"]]],
  ["SELECT id FROM t WHERE e", [["1"],["2"],["3"],["4"]]],
  ["SELECT id FROM t WHERE s ORDER BY id", [["1"],["2"],["3"]]],
  ["SELECT LENGTH(e), HEX(e), HEX(s), e LIKE '1%' FROM t ORDER BY id", [["1","62","78","0"],["1","61","792C7A","0"],["2","3130","782C792C7A","1"],["1","32","","0"]]],
  ["SELECT DATE_ADD('2020-01-01', INTERVAL s DAY) FROM t ORDER BY id", [["2020-01-02"],["2020-01-07"],["2020-01-08"],["2020-01-01"]]],
  ["SELECT e + INTERVAL 0 DAY FROM t WHERE id = 1", [[null]]],
  ["DROP TABLE t", [0,0,"",0]],
  ["SELECT a + 0, a = 65 FROM (SELECT x'41' a) d", [["0","0"]]],
  ["SELECT IF(1, x'41', 0) + 0, COALESCE(x'41') + 0, IFNULL(x'41', 0) + 0, CASE WHEN 1 THEN x'41' END + 0", [["65","0","0","65"]]],
  ["SELECT (SELECT x'41') + 0", [["65"]]],
  ["SELECT a + 0 FROM (SELECT x'41' a UNION SELECT x'42') d ORDER BY 1", [["0"],["0"]]],
  ["WITH c AS (SELECT x'41' a) SELECT a + 0 FROM c", [["0"]]],
  ["SELECT NULLIF(x'41', 0) + 0", [["65"]]],
  ["SELECT x'41' + 0 FROM (SELECT 1) d WHERE x'41' = 65", [["65"]]],
  ["CREATE TABLE t (v VARBINARY(10), i INT)", [0,0,"",0]],
  ["INSERT INTO t VALUES (x'41', 1)", [1,0,"",0]],
  ["INSERT INTO t SELECT x'42', x'42'", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SELECT v + 0, i FROM t ORDER BY i", [["0","1"],["0","66"]]],
  ["SET @h := x'41'", [0,0,"",0]],
  ["SELECT @h + 0", [["0"]]],
  ["SELECT MAX(x'41') + 0, MIN(b'101') + 0", [["0","0"]]],
  ["SELECT x'41' IN (65), x'41' IN ('A'), x'41' IN (65, 'A')", [["1","1","1"]]],
  ["SELECT b'101' IN ('5', 5), b'101' = 5.0, x'41' = 65.0, x'41' = 6.5e1", [["1","1","1","1"]]],
  ["SELECT x'41' <=> 65, x'41' BETWEEN 'A' AND 'B'", [["1","1"]]],
  ["DROP TABLE t", [0,0,"",0]],
]

test('ENUM, SET and hex literal values answer as 8.4.11 did', async () => {
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
