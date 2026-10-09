// A key's COMMENT and visibility, and what a FULLTEXT key's grammar allows,
// as 8.4.11 answered each of these statements.
//
// COMMENT and INVISIBLE are kept, shown by SHOW CREATE TABLE (INVISIBLE in a
// versioned comment) and STATISTICS (INDEX_COMMENT, IS_VISIBLE), and flipped
// by ALTER INDEX (1176 for a key that is not there). An invisible index is
// enforced and never chosen, so its table is scanned in table order; the
// index InnoDB clusters on, a primary key or the UNIQUE NOT NULL key promoted
// to one, may not be invisible (3522). A FULLTEXT key takes no index type
// (1064 at USING) and no ASC or DESC (1221).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE iv1 (a INT, PRIMARY KEY (a) INVISIBLE)", [3522,"A primary key index cannot be invisible"]],
  ["CREATE TABLE iv2 (a INT NOT NULL, UNIQUE KEY u (a) INVISIBLE)", [3522,"A primary key index cannot be invisible"]],
  ["CREATE TABLE iv3 (a INT, b INT, KEY k (b) INVISIBLE, KEY j (a) COMMENT 'note' VISIBLE)", [0,0,"",0]],
  ["INSERT INTO iv3 VALUES (3, 1), (1, 3), (2, 2)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE iv3", [["iv3","CREATE TABLE `iv3` (\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  KEY `k` (`b`) /*!80000 INVISIBLE */,\n  KEY `j` (`a`) COMMENT 'note'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT a, b FROM iv3 WHERE b > 0", [["3","1"],["1","3"],["2","2"]]],
  ["ALTER TABLE iv3 ALTER INDEX k VISIBLE, ALTER INDEX j INVISIBLE", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE iv3", [["iv3","CREATE TABLE `iv3` (\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  KEY `k` (`b`),\n  KEY `j` (`a`) COMMENT 'note' /*!80000 INVISIBLE */\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE iv3 ALTER INDEX nope VISIBLE", [1176,"Key 'nope' doesn't exist in table 'iv3'"]],
  ["SELECT INDEX_NAME, INDEX_COMMENT, IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_NAME = 'iv3' ORDER BY 1", [["j","note","NO"],["k","","YES"]]],
  ["CREATE INDEX m ON iv3 (a, b) COMMENT 'two' INVISIBLE", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE iv3", [["iv3","CREATE TABLE `iv3` (\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  KEY `k` (`b`),\n  KEY `j` (`a`) COMMENT 'note' /*!80000 INVISIBLE */,\n  KEY `m` (`a`,`b`) COMMENT 'two' /*!80000 INVISIBLE */\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE iv4 (id INT PRIMARY KEY, b INT, c INT, KEY k (b) INVISIBLE, UNIQUE KEY u (c) INVISIBLE)", [0,0,"",0]],
  ["INSERT INTO iv4 VALUES (1, 3, 30), (2, 1, 10), (3, 2, 20), (4, 2, 25)", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, b FROM iv4 WHERE b > 0", [["1","3"],["2","1"],["3","2"],["4","2"]]],
  ["SELECT b, COUNT(*) FROM iv4 GROUP BY b", [["3","1"],["1","1"],["2","2"]]],
  ["SELECT b FROM iv4", [["3"],["1"],["2"],["2"]]],
  ["SELECT DISTINCT b FROM iv4", [["3"],["1"],["2"]]],
  ["INSERT INTO iv4 VALUES (5, 9, 10)", [1062,"Duplicate entry '10' for key 'iv4.u'"]],
  ["ALTER TABLE iv4 ALTER INDEX k VISIBLE", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, b FROM iv4 WHERE b > 0", [["2","1"],["3","2"],["4","2"],["1","3"]]],
  ["SELECT b, COUNT(*) FROM iv4 GROUP BY b", [["1","1"],["2","2"],["3","1"]]],
  ["SELECT b FROM iv4", [["1"],["2"],["2"],["3"]]],
  ["CREATE TABLE fd1 (t VARCHAR(20), FULLTEXT INDEX USING BTREE (t))", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'USING BTREE (t))' at line 1"]],
  ["CREATE TABLE fd2 (t VARCHAR(20), FULLTEXT (t) USING BTREE)", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'USING BTREE)' at line 1"]],
  ["CREATE TABLE fd3 (t VARCHAR(20), FULLTEXT (t) USING HASH)", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'USING HASH)' at line 1"]],
  ["CREATE TABLE fd5 (t VARCHAR(20), FULLTEXT (t DESC))", [1221,"Incorrect usage of spatial/fulltext/hash index and explicit index order"]],
  ["CREATE TABLE fd6 (t VARCHAR(20), FULLTEXT (t(10)))", [0,0,"",0]],
  ["CREATE TABLE fd7 (t VARCHAR(20), u VARCHAR(20) CHARACTER SET latin1, FULLTEXT (t, u))", [1283,"Column 'u' cannot be part of FULLTEXT index"]],
  ["CREATE TABLE fd8 (t VARCHAR(20), FULLTEXT (t) COMMENT 'hello' INVISIBLE)", [0,0,"",0]],
  ["SHOW CREATE TABLE fd8", [["fd8","CREATE TABLE `fd8` (\n  `t` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`) COMMENT 'hello' /*!80000 INVISIBLE */\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE fd9 (t VARCHAR(20), FULLTEXT (t) KEY_BLOCK_SIZE = 8)", [0,0,"",0]],
  ["SHOW CREATE TABLE fd9", [["fd9","CREATE TABLE `fd9` (\n  `t` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE fd10 (t JSON, FULLTEXT (t))", [3152,"JSON column 't' supports indexing only via generated columns on a specified JSON path."]],
  ["CREATE TABLE fd11 (t VARCHAR(20), FULLTEXT (t ASC))", [1221,"Incorrect usage of spatial/fulltext/hash index and explicit index order"]],
  ["CREATE FULLTEXT INDEX i USING BTREE ON fd9 (t)", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'USING BTREE ON fd9 (t)' at line 1"]],
  ["CREATE FULLTEXT INDEX i2 ON fd9 (t) USING BTREE", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'USING BTREE' at line 1"]],
  ["CREATE FULLTEXT INDEX i3 ON fd9 (t) COMMENT 'c'", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["SHOW CREATE TABLE fd9", [["fd9","CREATE TABLE `fd9` (\n  `t` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`),\n  FULLTEXT KEY `i3` (`t`) COMMENT 'c'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE ic (a INT, b INT, KEY ka (a) COMMENT 'hi', UNIQUE KEY kb (b) INVISIBLE)", [0,0,"",0]],
  ["SHOW CREATE TABLE ic", [["ic","CREATE TABLE `ic` (\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  UNIQUE KEY `kb` (`b`) /*!80000 INVISIBLE */,\n  KEY `ka` (`a`) COMMENT 'hi'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT INDEX_NAME, INDEX_COMMENT, IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_NAME='ic' ORDER BY 1", [["ka","hi","YES"],["kb","","NO"]]],
  ["CREATE TABLE iv5 (id INT PRIMARY KEY, b INT, KEY k (b) INVISIBLE)", [0,0,"",0]],
  ["INSERT INTO iv5 VALUES (1, 3), (2, 1), (3, 2), (4, 2), (5, 1)", [5,0,"Records: 5  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, b FROM iv5 WHERE b IN (2, 1)", [["2","1"],["3","2"],["4","2"],["5","1"]]],
  ["SELECT id, b FROM iv5 WHERE b BETWEEN 1 AND 2", [["2","1"],["3","2"],["4","2"],["5","1"]]],
  ["SELECT id, b FROM iv5 WHERE b < 3", [["2","1"],["3","2"],["4","2"],["5","1"]]],
  ["ALTER TABLE iv5 ALTER INDEX k VISIBLE", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, b FROM iv5 WHERE b IN (2, 1)", [["2","1"],["5","1"],["3","2"],["4","2"]]],
  ["SELECT id, b FROM iv5 WHERE b BETWEEN 1 AND 2", [["2","1"],["5","1"],["3","2"],["4","2"]]],
  ["SELECT id, b FROM iv5 WHERE b < 3", [["2","1"],["5","1"],["3","2"],["4","2"]]],
  // A named divergence: 8.4.11 accepts the ngram parser, which splits text into n-grams rather than words; it is refused here rather than ignored.
  ["CREATE TABLE fd12 (t VARCHAR(20), FULLTEXT ft (t) WITH PARSER ngram)", [1235,"WITH PARSER is not supported by this server yet"]],
]

test('index comments, invisible indexes and FULLTEXT key syntax answer as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : String(v))))
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
