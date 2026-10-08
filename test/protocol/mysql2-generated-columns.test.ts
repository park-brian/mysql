// Generated columns, VIRTUAL and STORED (M5.31), as 8.4.11 answered each of
// these statements.
//
// A generated column is filled from the row as it is stored, in column
// order, by INSERT (VALUES, SET and SELECT), REPLACE, an upsert, UPDATE and
// ALTER TABLE's copy, and a value for one other than DEFAULT is 3105. Under
// a strict mode what its expression warns of is an error, and no row; out of
// one, a warning. It may not have a DEFAULT (1221), name a column the table
// lacks (1054), a generated column at or after its place (3107) or an
// AUTO_INCREMENT one (3109), or hold a subquery (3102), a variable (3772) or
// a function whose value is not the row's (3763). It is keyed like any
// column, a virtual one takes no foreign key (3733), and a column it names
// may not be dropped (3108). SHOW CREATE TABLE and COLUMNS print its
// expression as the server prints it; LIKE copies it, and CREATE TABLE …
// SELECT makes a plain column of it.
//
// Named divergence: a VIRTUAL column's value is computed as the row is
// written and kept, where 8.4.11 computes it each time a statement reads it,
// so the warnings its expression raises there are raised on every read of it
// (and are errors to a strict UPDATE or DELETE that reads the row).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE g1 (a INT, b INT AS (a * 2), c VARCHAR(20) GENERATED ALWAYS AS (CONCAT('x', a)) STORED, d INT AS (b + 1) VIRTUAL NOT NULL, KEY kc (c), UNIQUE KEY ub (b))", [0,0,"",0]],
  ["SHOW CREATE TABLE g1", [["g1","CREATE TABLE `g1` (\n  `a` int DEFAULT NULL,\n  `b` int GENERATED ALWAYS AS ((`a` * 2)) VIRTUAL,\n  `c` varchar(20) GENERATED ALWAYS AS (concat(_utf8mb4'x',`a`)) STORED,\n  `d` int GENERATED ALWAYS AS ((`b` + 1)) VIRTUAL NOT NULL,\n  UNIQUE KEY `ub` (`b`),\n  KEY `kc` (`c`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["INSERT INTO g1 (a) VALUES (1), (2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM g1", [["1","2","x1","3"],["2","4","x2","5"]]],
  ["INSERT INTO g1 VALUES (3, DEFAULT, DEFAULT, DEFAULT)", [1,0,"",0]],
  ["INSERT INTO g1 VALUES (4, 8, DEFAULT, DEFAULT)", [3105,"The value specified for generated column 'b' in table 'g1' is not allowed."]],
  ["INSERT INTO g1 (a, b) VALUES (5, 10)", [3105,"The value specified for generated column 'b' in table 'g1' is not allowed."]],
  ["INSERT INTO g1 (a) VALUES (1)", [1062,"Duplicate entry '2' for key 'g1.ub'"]],
  ["INSERT INTO g1 (a) VALUES (NULL)", [1048,"Column 'd' cannot be null"]],
  ["UPDATE g1 SET a = a + 10 WHERE a = 2", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM g1 ORDER BY a", [["1","2","x1","3"],["3","6","x3","7"],["12","24","x12","25"]]],
  ["UPDATE g1 SET b = 5", [3105,"The value specified for generated column 'b' in table 'g1' is not allowed."]],
  ["UPDATE g1 SET b = DEFAULT WHERE a = 3", [1,0,"Rows matched: 1  Changed: 0  Warnings: 0",0]],
  ["SELECT a, b, c, d FROM g1 WHERE b = 24", [["12","24","x12","25"]]],
  ["SELECT COLUMN_NAME, EXTRA, GENERATION_EXPRESSION, COLUMN_DEFAULT, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g1' ORDER BY ORDINAL_POSITION", [["a","","",null,"YES"],["b","VIRTUAL GENERATED","(`a` * 2)",null,"YES"],["c","STORED GENERATED","concat(_utf8mb4\\'x\\',`a`)",null,"YES"],["d","VIRTUAL GENERATED","(`b` + 1)",null,"NO"]]],
  ["CREATE TABLE g2 (a INT, b INT AS (c), c INT AS (a))", [3107,"Generated column can refer only to generated columns defined prior to it."]],
  ["CREATE TABLE g3 (a INT, b INT AS (b + 1))", [3107,"Generated column can refer only to generated columns defined prior to it."]],
  ["CREATE TABLE g4 (a INT, b INT AS (RAND()))", [3763,"Expression of generated column 'b' contains a disallowed function: rand."]],
  ["CREATE TABLE g5 (a INT, b DATETIME AS (NOW()))", [3763,"Expression of generated column 'b' contains a disallowed function: now."]],
  ["CREATE TABLE g6 (a INT AUTO_INCREMENT PRIMARY KEY, b INT AS (a + 1))", [3109,"Generated column 'b' cannot refer to auto-increment column."]],
  ["CREATE TABLE g7 (a INT, b INT AS (a) DEFAULT 5)", [1221,"Incorrect usage of DEFAULT and generated column"]],
  ["CREATE TABLE g8 (a INT, b INT AS ((SELECT 1)))", [3102,"Expression of generated column 'b' contains a disallowed function."]],
  ["CREATE TABLE g9 (a INT, b INT AS (@x))", [3772,"Default value expression of column 'b' cannot refer user or system variables."]],
  ["CREATE TABLE g10 (a INT, b INT AS (nope + 1))", [1054,"Unknown column 'nope' in 'generated column function'"]],
  ["CREATE TABLE g11 (a INT, b INT GENERATED ALWAYS AS (a + 1) STORED PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE g12 (a VARCHAR(5), b INT AS (a + 0))", [0,0,"",0]],
  ["INSERT INTO g12 (a) VALUES ('7x')", [1292,"Truncated incorrect DOUBLE value: '7x'"]],
  ["SHOW WARNINGS", [["Error","1292","Truncated incorrect DOUBLE value: '7x'"]]],
  ["SELECT * FROM g12", []],
  ["CREATE TABLE g13 (a INT, b TINYINT AS (a * 100))", [0,0,"",0]],
  ["INSERT INTO g13 (a) VALUES (5)", [1264,"Out of range value for column 'b' at row 1"]],
  ["SELECT * FROM g13", []],
  ["CREATE TABLE g14 (a JSON, n INT AS (a->>'$.n'), s VARCHAR(10) AS (JSON_UNQUOTE(a->'$.s')) STORED, KEY (n))", [0,0,"",0]],
  ["INSERT INTO g14 (a) VALUES ('{\"n\": 3, \"s\": \"hi\"}')", [1,0,"",0]],
  ["SELECT * FROM g14", [["{\"n\":3,\"s\":\"hi\"}","3","hi"]]],
  ["SHOW CREATE TABLE g14", [["g14","CREATE TABLE `g14` (\n  `a` json DEFAULT NULL,\n  `n` int GENERATED ALWAYS AS (json_unquote(json_extract(`a`,_utf8mb4'$.n'))) VIRTUAL,\n  `s` varchar(10) GENERATED ALWAYS AS (json_unquote(json_extract(`a`,_utf8mb4'$.s'))) STORED,\n  KEY `n` (`n`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE g1 ADD COLUMN e INT AS (a + d) STORED", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM g1 ORDER BY a", [["1","2","x1","3","4"],["3","6","x3","7","10"],["12","24","x12","25","37"]]],
  ["ALTER TABLE g1 ADD COLUMN f INT AS (a - 1) VIRTUAL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT f FROM g1 ORDER BY a", [["0"],["2"],["11"]]],
  ["ALTER TABLE g1 DROP COLUMN a", [3108,"Column 'a' has a generated column dependency."]],
  ["CREATE TABLE g15 (a INT, b INT AS (a) VIRTUAL, c INT AS (a) STORED, FOREIGN KEY (b) REFERENCES g1(b))", [3733,"Foreign key 'g15_ibfk_1' uses virtual column 'b' which is not supported."]],
  ["REPLACE INTO g1 (a) VALUES (1)", [1,0,"",0]],
  ["INSERT INTO g1 (a) VALUES (1) ON DUPLICATE KEY UPDATE a = 7", [2,0,"",0]],
  ["SELECT a, b FROM g1 ORDER BY a", [["3","6"],["7","14"],["12","24"]]],
  ["INSERT IGNORE INTO g12 (a) VALUES ('7x')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: '7x'"]]],
  ["SELECT * FROM g12", [["7x","7"]]],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["INSERT INTO g12 (a) VALUES ('8y')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: '8y'"]]],
  ["INSERT INTO g13 (a) VALUES (5)", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1264","Out of range value for column 'b' at row 1"]]],
  ["SELECT * FROM g13", [["5","127"]]],
  ["SET sql_mode = DEFAULT", [0,0,"",0]],
  ["CREATE TABLE g16 LIKE g1", [0,0,"",0]],
  ["SHOW CREATE TABLE g16", [["g16","CREATE TABLE `g16` (\n  `a` int DEFAULT NULL,\n  `b` int GENERATED ALWAYS AS ((`a` * 2)) VIRTUAL,\n  `c` varchar(20) GENERATED ALWAYS AS (concat(_utf8mb4'x',`a`)) STORED,\n  `d` int GENERATED ALWAYS AS ((`b` + 1)) VIRTUAL NOT NULL,\n  `e` int GENERATED ALWAYS AS ((`a` + `d`)) STORED,\n  `f` int GENERATED ALWAYS AS ((`a` - 1)) VIRTUAL,\n  UNIQUE KEY `ub` (`b`),\n  KEY `kc` (`c`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["INSERT INTO g16 (a) VALUES (100)", [1,0,"",0]],
  ["SELECT * FROM g16", [["100","200","x100","201","301","99"]]],
  ["CREATE TABLE g17 AS SELECT * FROM g1", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE g17", [["g17","CREATE TABLE `g17` (\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  `c` varchar(20) DEFAULT NULL,\n  `d` int NOT NULL,\n  `e` int DEFAULT NULL,\n  `f` int DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE g18 (a INT, b INT AS (a + 1) STORED)", [0,0,"",0]],
  ["INSERT INTO g18 (a) VALUES (1)", [1,0,"",0]],
  ["ALTER TABLE g18 MODIFY a VARCHAR(10)", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM g18", [["1","2"]]],
  ["ALTER TABLE g18 ADD COLUMN c VARCHAR(20) AS (CONCAT(a, '!')) VIRTUAL FIRST", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE g18 ADD COLUMN c VARCHAR(20) AS (CONCAT(a, '!')) VIRTUAL", [1060,"Duplicate column name 'c'"]],
  ["SELECT * FROM g18", [["1!","1","2"]]],
  ["SHOW CREATE TABLE g18", [["g18","CREATE TABLE `g18` (\n  `c` varchar(20) GENERATED ALWAYS AS (concat(`a`,_utf8mb4'!')) VIRTUAL,\n  `a` varchar(10) DEFAULT NULL,\n  `b` int GENERATED ALWAYS AS ((`a` + 1)) STORED\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE g18 DROP COLUMN b", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE g18 DROP COLUMN c, DROP COLUMN a", [1090,"You can't delete all columns with ALTER TABLE; use DROP TABLE instead"]],
  ["ALTER TABLE g18 ADD COLUMN d INT AS (RAND())", [3763,"Expression of generated column 'd' contains a disallowed function: rand."]],
  ["CREATE TEMPORARY TABLE g19 (a INT, b INT AS (a * 3))", [0,0,"",0]],
  ["INSERT INTO g19 (a) VALUES (2)", [1,0,"",0]],
  ["SELECT * FROM g19", [["2","6"]]],
  ["SHOW CREATE TABLE g19", [["g19","CREATE TEMPORARY TABLE `g19` (\n  `a` int DEFAULT NULL,\n  `b` int GENERATED ALWAYS AS ((`a` * 3)) VIRTUAL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g1' ORDER BY 1, 2", [["kc","c"],["ub","b"]]],
  ["CREATE TABLE g20 (a INT, b INT AS (a + 1), c INT AS (b * 2) STORED, KEY (c))", [0,0,"",0]],
  ["INSERT INTO g20 (a) VALUES (1), (2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM g20 WHERE c = 6", [["2","3","6"]]],
  ["INSERT INTO g20 SET a = 5", [1,0,"",0]],
  ["INSERT INTO g20 SET a = 6, b = DEFAULT", [1,0,"",0]],
  ["INSERT INTO g20 SET a = 6, b = 1", [3105,"The value specified for generated column 'b' in table 'g20' is not allowed."]],
  ["INSERT INTO g20 (a) SELECT 9", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO g20 (a, b) SELECT 9, 10", [3105,"The value specified for generated column 'b' in table 'g20' is not allowed."]],
  ["SELECT * FROM g20 ORDER BY a", [["1","2","4"],["2","3","6"],["5","6","12"],["6","7","14"],["9","10","20"]]],
]

test('generated columns are defined, refused, filled and shown as 8.4.11 does', async () => {
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
