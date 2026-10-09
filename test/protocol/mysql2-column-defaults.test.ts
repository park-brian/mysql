// Column defaults, as 8.4.11 answered each of these statements: the second
// review's findings about them.
//
// A literal default must store as a strict INSERT would, or it is 1067: an
// out-of-range number, a string too long, a number for an ENUM or a SET, NOT
// NULL with DEFAULT NULL, and the zero date where NO_ZERO_DATE is on. A BLOB,
// TEXT or JSON column takes no literal default (1101). An expression default,
// `DEFAULT (…)`, is kept as written, printed in parentheses with its strings
// introduced, and checked for the columns it names (1054, 3767, 3768), a
// subquery (3769) and a variable (3772). An explicit DEFAULT for a column whose
// default reads the row reads it as it stands at that point in the column
// list. DEFAULT(c) is the column's literal default, 3773 for an expression
// and 1364 for none. An explicit NULL into a NOT NULL ENUM under IGNORE is
// the error value '', not the first member. SHOW CREATE TABLE escapes NUL,
// newline, CR and backslash in a default or a comment, as append_unescaped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE a1 (c TINYINT DEFAULT 300)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a2 (c TINYINT UNSIGNED DEFAULT -1)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a3 (c VARCHAR(3) DEFAULT 'abcd')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a4 (c CHAR(3) DEFAULT 'abc  ')", [0,0,"",0]],
  ["CREATE TABLE a5 (c VARCHAR(3) DEFAULT 'abc  ')", [0,0,"",1]],
  ["CREATE TABLE a6 (c DECIMAL(4,2) DEFAULT 123.45)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a7 (c DECIMAL(4,2) DEFAULT 1.234)", [0,0,"",1]],
  ["SHOW CREATE TABLE a7", [["a7","CREATE TABLE `a7` (\n  `c` decimal(4,2) DEFAULT '1.23'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a8 (c INT DEFAULT 1.5)", [0,0,"",0]],
  ["SHOW CREATE TABLE a8", [["a8","CREATE TABLE `a8` (\n  `c` int DEFAULT '2'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a9 (c INT DEFAULT '1x')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a10 (c INT DEFAULT '')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a11 (c DATE DEFAULT '2020-13-01')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a12 (c DATE DEFAULT '2020-01-01 10:00:00')", [0,0,"",1]],
  ["SHOW CREATE TABLE a12", [["a12","CREATE TABLE `a12` (\n  `c` date DEFAULT '2020-01-01'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SET sql_mode = 'NO_ZERO_DATE,STRICT_TRANS_TABLES'", [0,0,"",1]],
  ["CREATE TABLE a13 (c DATE DEFAULT '0000-00-00')", [1067,"Invalid default value for 'c'"]],
  ["SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'", [0,0,"",1]],
  ["CREATE TABLE a13b (c DATE DEFAULT '0000-00-00')", [0,0,"",0]],
  ["CREATE TABLE a14 (c DATETIME DEFAULT '2020-02-30')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a15 (c ENUM('a','b') DEFAULT 'c')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a16 (c ENUM('a','b') DEFAULT 2)", [1067,"Invalid default value for 'c'"]],
  ["SHOW CREATE TABLE a16", [1146,"Table 'app.a16' doesn't exist"]],
  ["CREATE TABLE a17 (c SET('a','b') DEFAULT 'a,c')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a18 (c SET('a','b') DEFAULT 3)", [1067,"Invalid default value for 'c'"]],
  ["SHOW CREATE TABLE a18", [1146,"Table 'app.a18' doesn't exist"]],
  ["CREATE TABLE a19 (c BIT(2) DEFAULT 5)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a20 (c BIT(2) DEFAULT b'11')", [0,0,"",0]],
  ["SHOW CREATE TABLE a20", [["a20","CREATE TABLE `a20` (\n  `c` bit(2) DEFAULT b'11'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a21 (c TIME DEFAULT '839:00:00')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a22 (c YEAR DEFAULT 1900)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a23 (c YEAR DEFAULT 99)", [0,0,"",0]],
  ["SHOW CREATE TABLE a23", [["a23","CREATE TABLE `a23` (\n  `c` year DEFAULT '1999'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a24 (c FLOAT(3,1) DEFAULT 100.0)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a25 (c DOUBLE DEFAULT 'abc')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a26 (c INT NOT NULL DEFAULT NULL)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a27 (c TEXT DEFAULT 'x')", [1101,"BLOB, TEXT, GEOMETRY or JSON column 'c' can't have a default value"]],
  ["CREATE TABLE a28 (c BLOB DEFAULT ('x'))", [0,0,"",0]],
  ["CREATE TABLE a29 (c JSON DEFAULT ('[]'))", [0,0,"",0]],
  ["CREATE TABLE a30 (c VARCHAR(3) DEFAULT ('abcd'))", [0,0,"",0]],
  ["INSERT INTO a30 VALUES ()", [1406,"Data too long for column 'c' at row 1"]],
  ["CREATE TABLE a31 (c BINARY(3) DEFAULT 'abcd')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a32 (c BINARY(3) DEFAULT 'ab')", [0,0,"",0]],
  ["SHOW CREATE TABLE a32", [["a32","CREATE TABLE `a32` (\n  `c` binary(3) DEFAULT 'ab\\0'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a33 (c TIMESTAMP DEFAULT '1960-01-01 00:00:00')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a34 (c INT DEFAULT x'41')", [0,0,"",0]],
  ["SHOW CREATE TABLE a34", [["a34","CREATE TABLE `a34` (\n  `c` int DEFAULT '65'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a35 (c VARCHAR(3) DEFAULT x'41424344')", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a36 (c INT DEFAULT TRUE)", [0,0,"",0]],
  ["SHOW CREATE TABLE a36", [["a36","CREATE TABLE `a36` (\n  `c` int DEFAULT '1'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a37 (c BIGINT UNSIGNED DEFAULT 18446744073709551616)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE a38 (c VARCHAR(3) CHARACTER SET latin1 DEFAULT 'é€')", [0,0,"",0]],
  ["CREATE TABLE a39 (c INT DEFAULT -0)", [0,0,"",0]],
  ["SHOW CREATE TABLE a39", [["a39","CREATE TABLE `a39` (\n  `c` int DEFAULT '0'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a40 (c TINYINT DEFAULT '127.4')", [0,0,"",0]],
  ["SHOW CREATE TABLE a40", [["a40","CREATE TABLE `a40` (\n  `c` tinyint DEFAULT '127'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a41 (c TINYINT DEFAULT ' 12 ')", [0,0,"",0]],
  ["SHOW CREATE TABLE a41", [["a41","CREATE TABLE `a41` (\n  `c` tinyint DEFAULT '12'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a42 (c DATETIME(0) DEFAULT '2020-01-01 10:00:00.6')", [0,0,"",0]],
  ["SHOW CREATE TABLE a42", [["a42","CREATE TABLE `a42` (\n  `c` datetime DEFAULT '2020-01-01 10:00:01'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE a43 (c TIME DEFAULT '10:00:00.5')", [0,0,"",0]],
  ["SHOW CREATE TABLE a43", [["a43","CREATE TABLE `a43` (\n  `c` time DEFAULT '10:00:01'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t (id INT PRIMARY KEY, x INT, y INT DEFAULT (x + 1), z VARCHAR(10) DEFAULT (CONCAT('v', x)))", [0,0,"",0]],
  ["INSERT INTO t (id, x) VALUES (1, 10)", [1,0,"",0]],
  ["INSERT INTO t (id) VALUES (2)", [1,0,"",0]],
  ["INSERT INTO t (id, x, y) VALUES (3, 5, DEFAULT)", [1,0,"",0]],
  ["INSERT INTO t VALUES (4, 7, DEFAULT, DEFAULT)", [1,0,"",0]],
  ["INSERT INTO t (id, y, x) VALUES (5, DEFAULT, 8)", [1,0,"",0]],
  ["INSERT INTO t SET id = 6, x = 9", [1,0,"",0]],
  ["INSERT INTO t (id, x) VALUES (7, 1), (8, 2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM t ORDER BY id", [["1","10","11","v10"],["2",null,null,null],["3","5","6","v5"],["4","7","8","v7"],["5","8",null,"v8"],["6","9","10","v9"],["7","1","2","v1"],["8","2","3","v2"]]],
  ["UPDATE t SET x = 100, y = DEFAULT WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["UPDATE t SET y = DEFAULT, x = 200 WHERE id = 3", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["UPDATE t SET z = DEFAULT WHERE id = 4", [1,0,"Rows matched: 1  Changed: 0  Warnings: 0",0]],
  ["SELECT * FROM t ORDER BY id", [["1","100","101","v10"],["2",null,null,null],["3","200","6","v5"],["4","7","8","v7"],["5","8",null,"v8"],["6","9","10","v9"],["7","1","2","v1"],["8","2","3","v2"]]],
  ["INSERT INTO t (id, x) VALUES (1, 50) ON DUPLICATE KEY UPDATE y = DEFAULT", [1,0,"",0]],
  ["SELECT * FROM t ORDER BY id", [["1","100","101","v10"],["2",null,null,null],["3","200","6","v5"],["4","7","8","v7"],["5","8",null,"v8"],["6","9","10","v9"],["7","1","2","v1"],["8","2","3","v2"]]],
  ["REPLACE INTO t (id, x) VALUES (2, 60)", [2,0,"",0]],
  ["SELECT * FROM t ORDER BY id", [["1","100","101","v10"],["2","60","61","v60"],["3","200","6","v5"],["4","7","8","v7"],["5","8",null,"v8"],["6","9","10","v9"],["7","1","2","v1"],["8","2","3","v2"]]],
  ["ALTER TABLE t ADD COLUMN w INT DEFAULT (x * 2)", [8,0,"Records: 8  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM t ORDER BY id", [["1","100","101","v10","200"],["2","60","61","v60","120"],["3","200","6","v5","400"],["4","7","8","v7","14"],["5","8",null,"v8","16"],["6","9","10","v9","18"],["7","1","2","v1","2"],["8","2","3","v2","4"]]],
  ["ALTER TABLE t ADD COLUMN v INT DEFAULT (id + y)", [8,0,"Records: 8  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM t ORDER BY id", [["1","100","101","v10","200","102"],["2","60","61","v60","120","63"],["3","200","6","v5","400","9"],["4","7","8","v7","14","12"],["5","8",null,"v8","16",null],["6","9","10","v9","18","16"],["7","1","2","v1","2","9"],["8","2","3","v2","4","11"]]],
  ["SELECT DEFAULT(y) FROM t", [3773,"DEFAULT function cannot be used with default value expressions"]],
  ["SELECT DEFAULT(x) FROM t ORDER BY id", [[null],[null],[null],[null],[null],[null],[null],[null]]],
  ["CREATE TABLE u (a INT DEFAULT (b + 1), b INT)", [0,0,"",0]],
  ["INSERT INTO u (b) VALUES (5)", [1,0,"",0]],
  ["SELECT * FROM u", [["6","5"]]],
  ["CREATE TABLE u2 (a INT DEFAULT (a + 1))", [3767,"Default value expression of column 'a' cannot refer to a column defined after it if that column is a generated column or has an expression as default value."]],
  ["CREATE TABLE u3 (a INT DEFAULT (b + 1), b INT DEFAULT (a + 1))", [3767,"Default value expression of column 'a' cannot refer to a column defined after it if that column is a generated column or has an expression as default value."]],
  ["CREATE TABLE u4 (a INT AUTO_INCREMENT PRIMARY KEY, b INT DEFAULT (a + 1))", [3768,"Default value expression of column 'b' cannot refer to an auto-increment column."]],
  ["CREATE TABLE u7 (a INT DEFAULT (nope + 1))", [1054,"Unknown column 'nope' in 'default value expression'"]],
  ["CREATE TABLE u8 (a INT DEFAULT ((SELECT 1)))", [3769,"Default value expression of column 'a' contains a disallowed function."]],
  ["CREATE TABLE u9 (a INT DEFAULT (@v))", [3772,"Default value expression of column 'a' cannot refer user or system variables."]],
  ["CREATE TABLE u10 (a INT DEFAULT (?))", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '?))' at line 1"]],
  ["CREATE TABLE e1 (id INT, e ENUM('a','b') NOT NULL, s SET('a','b') NOT NULL, j JSON NOT NULL, b BLOB NOT NULL, t TEXT NOT NULL, i INT NOT NULL, d DATE NOT NULL, dt DATETIME NOT NULL, ts TIMESTAMP NOT NULL, tm TIME NOT NULL, y YEAR NOT NULL, bt BIT(3) NOT NULL, c CHAR(2) NOT NULL)", [0,0,"",0]],
  ["INSERT IGNORE INTO e1 (id) VALUES (1)", [1,0,"",12]],
  ["SELECT * FROM e1", [["1","a","",null,"","","0","0000-00-00","0000-00-00 00:00:00","0000-00-00 00:00:00","00:00:00","0","\u0000",""]]],
  ["INSERT INTO e1 (id) VALUES (2)", [1364,"Field 's' doesn't have a default value"]],
  ["INSERT INTO e1 (id, e, s, j, b, t, i, d, dt, ts, tm, y, bt, c) VALUES (3, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT)", [1364,"Field 's' doesn't have a default value"]],
  ["INSERT IGNORE INTO e1 (id, e, s, j, b, t, i, d, dt, ts, tm, y, bt, c) VALUES (4, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT)", [1,0,"",12]],
  ["SELECT * FROM e1 WHERE id = 4", [["4","a","",null,"","","0","0000-00-00","0000-00-00 00:00:00","0000-00-00 00:00:00","00:00:00","0","\u0000",""]]],
  ["INSERT IGNORE INTO e1 (id, e, j) VALUES (5, NULL, NULL)", [1,0,"",13]],
  ["SELECT * FROM e1 WHERE id = 5", [["5","","",null,"","","0","0000-00-00","0000-00-00 00:00:00","0000-00-00 00:00:00","00:00:00","0","\u0000",""]]],
  ["SELECT DEFAULT(e), DEFAULT(j), DEFAULT(i) FROM e1", [1364,"Field 'e' doesn't have a default value"]],
  ["CREATE TABLE e2 (e ENUM('x','y') NOT NULL, i INT)", [0,0,"",0]],
  ["INSERT INTO e2 (i) VALUES (1)", [1,0,"",0]],
  ["SELECT * FROM e2", [["x","1"]]],
  ["SHOW CREATE TABLE e2", [["e2","CREATE TABLE `e2` (\n  `e` enum('x','y') NOT NULL,\n  `i` int DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE e3 (e ENUM('x','y'), i INT)", [0,0,"",0]],
  ["INSERT INTO e3 (i) VALUES (1)", [1,0,"",0]],
  ["SELECT * FROM e3", [[null,"1"]]],
  ["ALTER TABLE e2 ADD COLUMN j JSON NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE e2 ADD COLUMN b BLOB NOT NULL, ADD COLUMN e5 ENUM('p','q') NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM e2", [["x","1",null,"","p"]]],
  ["UPDATE e2 SET e = DEFAULT", [1,0,"Rows matched: 1  Changed: 0  Warnings: 0",0]],
  ["UPDATE e2 SET j = DEFAULT", [1364,"Field 'j' doesn't have a default value"]],
  ["SELECT * FROM e2", [["x","1",null,"","p"]]],
  ["CREATE TABLE cm (c VARCHAR(5) DEFAULT 'a\\nb\\\\' COMMENT 'it''s\\r')", [0,0,"",0]],
  ["SHOW CREATE TABLE cm", [["cm","CREATE TABLE `cm` (\n  `c` varchar(5) DEFAULT 'a\\nb\\\\' COMMENT 'it''s\\r'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE ex (a INT, b VARCHAR(9) DEFAULT ('abcd'), c INT DEFAULT (1))", [0,0,"",0]],
  ["SHOW CREATE TABLE ex", [["ex","CREATE TABLE `ex` (\n  `a` int DEFAULT NULL,\n  `b` varchar(9) DEFAULT (_utf8mb4'abcd'),\n  `c` int DEFAULT (1)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE ex ALTER COLUMN a SET DEFAULT (b)", [3767,"Default value expression of column 'a' cannot refer to a column defined after it if that column is a generated column or has an expression as default value."]],
  ["ALTER TABLE ex ALTER COLUMN c SET DEFAULT (nope)", [1054,"Unknown column 'nope' in 'default value expression'"]],
  ["ALTER TABLE ex ALTER COLUMN a SET DEFAULT (c + 1)", [3767,"Default value expression of column 'a' cannot refer to a column defined after it if that column is a generated column or has an expression as default value."]],
  ["SHOW CREATE TABLE ex", [["ex","CREATE TABLE `ex` (\n  `a` int DEFAULT NULL,\n  `b` varchar(9) DEFAULT (_utf8mb4'abcd'),\n  `c` int DEFAULT (1)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT DEFAULT(b) FROM ex", [3773,"DEFAULT function cannot be used with default value expressions"]],
  ["INSERT INTO ex (c) VALUES (4)", [1,0,"",0]],
  ["SELECT * FROM ex", [[null,"abcd","4"]]],
]

test('Column defaults, literal and expression, answer every statement of the script as 8.4.11 did', async () => {
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
