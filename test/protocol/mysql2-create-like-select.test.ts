// CREATE TABLE … LIKE and CREATE TABLE … SELECT (M5.30), as 8.4.11 answered
// each of these statements, and what making them found wrong in CREATE
// TABLE itself.
//
// LIKE copies the columns, keys, FULLTEXT keys, CHECK constraints (renamed
// `<table>_chk_<n>`) and comment, not the foreign keys or the counter.
// … SELECT makes a column of each the query returns: a table's column again,
// its AUTO_INCREMENT made a default of 0; anything else typed by its result,
// an integer an INT or a BIGINT by its width (a literal's from 10, a
// function's past 11), NOT NULL with a default of 0 or '' when it is never
// NULL. Declared columns the query does not name come first. The rows are an
// INSERT … SELECT, IGNORE and REPLACE included, and a 1062 leaves no table;
// a table everyone sees is filled though a temporary one shares its name.
// On the way: a column's charset or collation, named, is always written
// back, and one derived is written only where it differs (`is_explicit_
// collation`); NCHAR, BINARY, utf8 and utf8mb3 warn; a nullable TEXT, BLOB
// or JSON column may say DEFAULT NULL; and AUTO_INCREMENT = n starts there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE src (id INT AUTO_INCREMENT PRIMARY KEY, a VARCHAR(10) NOT NULL DEFAULT 'x' COMMENT 'col', b DECIMAL(6,2), c DATETIME(3), d ENUM('p','q'), e JSON, f TEXT, g DOUBLE, u INT UNSIGNED, UNIQUE KEY ua (a), KEY kb (b) COMMENT 'kb', CONSTRAINT ck CHECK (g > 0), FULLTEXT (f)) COMMENT 'tbl' AUTO_INCREMENT=50", [0,0,"",0]],
  ["CREATE TABLE child (id INT, FOREIGN KEY (id) REFERENCES src(id))", [0,0,"",0]],
  ["INSERT INTO src (a, b, c, d, e, f, g, u) VALUES ('one', 1.5, '2020-01-01 10:00:00.123', 'p', '{\"k\":1}', 'text here', 2.5, 7), ('two', NULL, NULL, NULL, NULL, NULL, NULL, NULL)", [2,50,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE l1 LIKE src", [0,0,"",0]],
  ["SHOW CREATE TABLE l1", [["l1","CREATE TABLE `l1` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `a` varchar(10) NOT NULL DEFAULT 'x' COMMENT 'col',\n  `b` decimal(6,2) DEFAULT NULL,\n  `c` datetime(3) DEFAULT NULL,\n  `d` enum('p','q') DEFAULT NULL,\n  `e` json DEFAULT NULL,\n  `f` text,\n  `g` double DEFAULT NULL,\n  `u` int unsigned DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `ua` (`a`),\n  KEY `kb` (`b`) COMMENT 'kb',\n  FULLTEXT KEY `f` (`f`),\n  CONSTRAINT `l1_chk_1` CHECK ((`g` > 0))\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='tbl'"]]],
  ["CREATE TABLE l2 LIKE child", [0,0,"",0]],
  ["SHOW CREATE TABLE l2", [["l2","CREATE TABLE `l2` (\n  `id` int DEFAULT NULL,\n  KEY `id` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE l1 LIKE src", [1050,"Table 'l1' already exists"]],
  ["CREATE TABLE IF NOT EXISTS l1 LIKE src", [0,0,"",1]],
  ["CREATE TABLE l3 LIKE nope", [1146,"Table 'app.nope' doesn't exist"]],
  ["CREATE TEMPORARY TABLE l4 LIKE src", [1796,"Cannot create FULLTEXT index on temporary InnoDB table"]],
  ["SHOW CREATE TABLE l4", [1146,"Table 'app.l4' doesn't exist"]],
  ["CREATE TABLE c1 AS SELECT * FROM src", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c1", [["c1","CREATE TABLE `c1` (\n  `id` int NOT NULL DEFAULT '0',\n  `a` varchar(10) NOT NULL DEFAULT 'x' COMMENT 'col',\n  `b` decimal(6,2) DEFAULT NULL,\n  `c` datetime(3) DEFAULT NULL,\n  `d` enum('p','q') DEFAULT NULL,\n  `e` json DEFAULT NULL,\n  `f` text,\n  `g` double DEFAULT NULL,\n  `u` int unsigned DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT * FROM c1", [["50","one","1.50","2020-01-01 10:00:00.123","p","{\"k\":1}","text here","2.5","7"],["51","two",null,null,null,null,null,null,null]]],
  ["CREATE TABLE c2 AS SELECT id, a, b + 1 AS b1, CONCAT(a, 'z') AS ca, 1 AS one, 1.5 AS dec1, 'lit' AS s, NULL AS nul, NOW() AS t, d, g * 2 AS g2, u - 1 AS um FROM src", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c2", [["c2","CREATE TABLE `c2` (\n  `id` int NOT NULL DEFAULT '0',\n  `a` varchar(10) NOT NULL DEFAULT 'x' COMMENT 'col',\n  `b1` decimal(7,2) DEFAULT NULL,\n  `ca` varchar(11) DEFAULT NULL,\n  `one` int NOT NULL DEFAULT '0',\n  `dec1` decimal(2,1) NOT NULL DEFAULT '0.0',\n  `s` varchar(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',\n  `nul` varbinary(0) DEFAULT NULL,\n  `t` datetime NOT NULL,\n  `d` enum('p','q') DEFAULT NULL,\n  `g2` double DEFAULT NULL,\n  `um` int unsigned DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE c3 (id INT PRIMARY KEY, extra INT DEFAULT 5) SELECT id, a FROM src", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c3", [["c3","CREATE TABLE `c3` (\n  `extra` int DEFAULT '5',\n  `id` int NOT NULL,\n  `a` varchar(10) NOT NULL DEFAULT 'x' COMMENT 'col',\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT * FROM c3", [["5","50","one"],["5","51","two"]]],
  ["CREATE TABLE c4 (PRIMARY KEY (a)) SELECT a, b FROM src", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c4", [["c4","CREATE TABLE `c4` (\n  `a` varchar(10) NOT NULL DEFAULT 'x' COMMENT 'col',\n  `b` decimal(6,2) DEFAULT NULL,\n  PRIMARY KEY (`a`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE c5 (UNIQUE KEY (x)) SELECT 1 AS x UNION ALL SELECT 1", [1062,"Duplicate entry '1' for key 'c5.x'"]],
  ["CREATE TABLE c6 (UNIQUE KEY (x)) IGNORE SELECT 1 AS x UNION ALL SELECT 1", [1,0,"Records: 2  Duplicates: 1  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1062","Duplicate entry '1' for key 'c6.x'"]]],
  ["SELECT * FROM c6", [["1"]]],
  ["CREATE TABLE c7 (UNIQUE KEY (x), y INT) REPLACE SELECT 1 AS x, 1 AS y UNION ALL SELECT 1, 2", [3,0,"Records: 2  Duplicates: 1  Warnings: 0",0]],
  ["SELECT * FROM c7", [["1","2"]]],
  ["CREATE TABLE c8 SELECT * FROM src WHERE 1 = 0", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c8", [["c8","CREATE TABLE `c8` (\n  `id` int NOT NULL DEFAULT '0',\n  `a` varchar(10) NOT NULL DEFAULT 'x' COMMENT 'col',\n  `b` decimal(6,2) DEFAULT NULL,\n  `c` datetime(3) DEFAULT NULL,\n  `d` enum('p','q') DEFAULT NULL,\n  `e` json DEFAULT NULL,\n  `f` text,\n  `g` double DEFAULT NULL,\n  `u` int unsigned DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE c9 AS SELECT a FROM src, src AS s2", [1052,"Column 'a' in field list is ambiguous"]],
  ["CREATE TABLE c10 AS SELECT 'é' AS e1, _latin1'x' AS e2, CAST(1 AS CHAR) AS e3, 18446744073709551615 AS big, -1 AS neg, 1e3 AS dbl, CURDATE() AS dt, TIME('10:00') AS tm, b'101' AS bits, x'4142' AS hx", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c10", [["c10","CREATE TABLE `c10` (\n  `e1` varchar(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',\n  `e2` varchar(1) CHARACTER SET latin1 NOT NULL DEFAULT '',\n  `e3` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,\n  `big` bigint unsigned NOT NULL DEFAULT '0',\n  `neg` int NOT NULL DEFAULT '0',\n  `dbl` double NOT NULL DEFAULT '0',\n  `dt` date NOT NULL,\n  `tm` time DEFAULT NULL,\n  `bits` varbinary(1) NOT NULL DEFAULT '',\n  `hx` varbinary(2) NOT NULL DEFAULT ''\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE c11 SELECT MAX(id) AS m, SUM(b) AS s, AVG(g) AS av, GROUP_CONCAT(a) AS gc, COUNT(*) AS cnt FROM src", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE c11", [["c11","CREATE TABLE `c11` (\n  `m` int DEFAULT NULL,\n  `s` decimal(28,2) DEFAULT NULL,\n  `av` double DEFAULT NULL,\n  `gc` text,\n  `cnt` bigint NOT NULL DEFAULT '0'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE s1 (i INT, u INT UNSIGNED, t TINYINT, b BIGINT, m MEDIUMINT UNSIGNED)", [0,0,"",0]],
  ["CREATE TABLE x1 AS SELECT i + 0 AS a, u + 0 AS b, t + 0 AS c, -2147483648 AS d, 2147483647 AS e, 4294967295 AS f, 999999999 AS g, 9999999999 AS h, t * 1 AS k, m + 1 AS l, b + 0 AS n, i AS o, -i AS p, ABS(i) AS q, CAST(i AS UNSIGNED) AS r FROM s1", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE x1", [["x1","CREATE TABLE `x1` (\n  `a` bigint DEFAULT NULL,\n  `b` int unsigned DEFAULT NULL,\n  `c` int DEFAULT NULL,\n  `d` int NOT NULL DEFAULT '0',\n  `e` bigint NOT NULL DEFAULT '0',\n  `f` bigint NOT NULL DEFAULT '0',\n  `g` bigint NOT NULL DEFAULT '0',\n  `h` bigint NOT NULL DEFAULT '0',\n  `k` int DEFAULT NULL,\n  `l` int unsigned DEFAULT NULL,\n  `n` bigint DEFAULT NULL,\n  `o` int DEFAULT NULL,\n  `p` int DEFAULT NULL,\n  `q` int DEFAULT NULL,\n  `r` bigint unsigned DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE cc2 (a VARCHAR(2) CHARACTER SET utf8mb4, b VARCHAR(2) COLLATE utf8mb4_0900_ai_ci, c VARCHAR(2) BINARY, d NCHAR(2), e VARCHAR(2), f TEXT CHARACTER SET utf8mb4, g ENUM('x') CHARACTER SET utf8mb4, h CHAR(1) CHARSET latin1)", [0,0,"",2]],
  ["SHOW CREATE TABLE cc2", [["cc2","CREATE TABLE `cc2` (\n  `a` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `b` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `c` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,\n  `d` char(2) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,\n  `e` varchar(2) DEFAULT NULL,\n  `f` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,\n  `g` enum('x') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `h` char(1) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE cc3 SELECT * FROM cc2", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE cc3", [["cc3","CREATE TABLE `cc3` (\n  `a` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `b` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `c` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,\n  `d` char(2) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,\n  `e` varchar(2) DEFAULT NULL,\n  `f` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,\n  `g` enum('x') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `h` char(1) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE cc2 MODIFY e VARCHAR(3)", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE cc2", [["cc2","CREATE TABLE `cc2` (\n  `a` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `b` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `c` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,\n  `d` char(2) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,\n  `e` varchar(3) DEFAULT NULL,\n  `f` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,\n  `g` enum('x') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `h` char(1) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE w1 (c VARCHAR(2) BINARY, d NCHAR(2), x VARCHAR(2) CHARACTER SET utf8mb3, y NATIONAL VARCHAR(3), z CHAR(1) CHARACTER SET utf8)", [0,0,"",5]],
  ["SHOW WARNINGS", [["Warning","1287","'BINARY as attribute of a type' is deprecated and will be removed in a future release. Please use a CHARACTER SET clause with _bin collation instead"],["Warning","3720","NATIONAL/NCHAR/NVARCHAR implies the character set UTF8MB3, which will be replaced by UTF8MB4 in a future release. Please consider using CHAR(x) CHARACTER SET UTF8MB4 in order to be unambiguous."],["Warning","1287","'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead"],["Warning","3720","NATIONAL/NCHAR/NVARCHAR implies the character set UTF8MB3, which will be replaced by UTF8MB4 in a future release. Please consider using CHAR(x) CHARACTER SET UTF8MB4 in order to be unambiguous."],["Warning","3719","'utf8' is currently an alias for the character set UTF8MB3, but will be an alias for UTF8MB4 in a future release. Please consider using UTF8MB4 in order to be unambiguous."]]],
  ["CREATE TABLE cc1 (a VARCHAR(2) CHARACTER SET latin1, b VARCHAR(2) CHARACTER SET latin1 COLLATE latin1_bin, c VARCHAR(2) CHARACTER SET utf8mb4, d VARCHAR(2) COLLATE utf8mb4_bin, e VARCHAR(2) CHARACTER SET ascii, f VARCHAR(2) CHARACTER SET utf8mb3) DEFAULT CHARSET=latin1", [0,0,"",1]],
  ["SHOW CREATE TABLE cc1", [["cc1","CREATE TABLE `cc1` (\n  `a` varchar(2) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,\n  `b` varchar(2) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,\n  `c` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  `d` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,\n  `e` varchar(2) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,\n  `f` varchar(2) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=latin1"]]],
  ["CREATE TABLE x2 (e JSON DEFAULT NULL, t TEXT DEFAULT NULL, bl BLOB DEFAULT NULL, n TEXT NOT NULL DEFAULT NULL)", [1067,"Invalid default value for 'n'"]],
  ["CREATE TABLE x2 (e JSON DEFAULT NULL, t TEXT DEFAULT NULL, bl BLOB DEFAULT NULL)", [0,0,"",0]],
  ["SHOW CREATE TABLE x2", [["x2","CREATE TABLE `x2` (\n  `e` json DEFAULT NULL,\n  `t` text,\n  `bl` blob\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE x3 (id INT AUTO_INCREMENT PRIMARY KEY) AUTO_INCREMENT=50", [0,0,"",0]],
  ["INSERT INTO x3 VALUES ()", [1,50,"",0]],
  ["SELECT * FROM x3", [["50"]]],
  ["SHOW CREATE TABLE x3", [["x3","CREATE TABLE `x3` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE c12 (UNIQUE KEY (x)) SELECT 1 AS x UNION ALL SELECT 1", [1062,"Duplicate entry '1' for key 'c12.x'"]],
  ["SHOW TABLES LIKE 'c12'", []],
  ["CREATE TEMPORARY TABLE tm2 ENGINE=MEMORY AS SELECT 1 AS one", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE tm2", [["tm2","CREATE TEMPORARY TABLE `tm2` (\n  `one` int NOT NULL DEFAULT '0'\n) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT * FROM tm2", [["1"]]],
  ["CREATE TABLE IF NOT EXISTS tm2 SELECT 2 AS one", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TEMPORARY TABLE IF NOT EXISTS tm2 SELECT 2 AS one", [0,0,"",1]],
  ["SELECT * FROM tm2", [["1"]]],
  ["DROP TEMPORARY TABLE tm2", [0,0,"",0]],
  ["SELECT * FROM tm2", [["2"]]],
  ["DROP TABLE tm2", [0,0,"",0]],
]

test('CREATE TABLE … LIKE and … SELECT make the tables 8.4.11 made', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
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
