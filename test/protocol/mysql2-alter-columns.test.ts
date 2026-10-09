// ALTER TABLE's column, key and table actions, as 8.4.11 answered each of
// these statements: DROP COLUMN, MODIFY and CHANGE COLUMN, RENAME COLUMN,
// ALTER COLUMN SET and DROP DEFAULT, RENAME INDEX, RENAME TO, and the COMMENT,
// AUTO_INCREMENT and ENGINE options.
//
// What the probes taught. A dropped column leaves every key it was in,
// which goes when it has no column left, and takes with it a CHECK that
// named it alone; one naming it with another is 3959, and so is a CHECK on a
// renamed column. A foreign key's column cannot go (1828, 1829 from the
// parent's side), is renamed on both sides, and may not be retyped apart
// from its partner (3780). A new type converts the rows as a strict INSERT
// would (1264, 1265 at the row, 1138 for NULL into NOT NULL), and "Records"
// counts them unless InnoDB changes it in place: a VARCHAR made longer, NULL
// made NOT NULL, a rename, a default. DROP DEFAULT leaves none at all, so an
// INSERT that omits the column is 1364. RENAME alone answers without counts.
// A FULLTEXT key follows its columns and keeps them text (1283).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT PRIMARY KEY AUTO_INCREMENT, a INT, b VARCHAR(10), c INT NOT NULL DEFAULT 5, KEY ab (a, b), KEY bk (b), CONSTRAINT ck CHECK (c > 0))", [0,0,"",0]],
  ["INSERT INTO t (a, b, c) VALUES (1, 'x', 1), (2, 'yy', 2), (300, 'zzz', 3)", [3,1,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE t DROP COLUMN b", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE t", [["t","CREATE TABLE `t` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `a` int DEFAULT NULL,\n  `c` int NOT NULL DEFAULT '5',\n  PRIMARY KEY (`id`),\n  KEY `ab` (`a`),\n  CONSTRAINT `ck` CHECK ((`c` > 0))\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT * FROM t ORDER BY id", [["1","1","1"],["2","2","2"],["3","300","3"]]],
  ["ALTER TABLE t DROP COLUMN c", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE t DROP COLUMN nope", [1091,"Can't DROP 'nope'; check that column/key exists"]],
  ["ALTER TABLE t ADD COLUMN d VARCHAR(5) AFTER id, DROP COLUMN a", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE t", [["t","CREATE TABLE `t` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `d` varchar(5) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE t MODIFY c BIGINT NOT NULL DEFAULT 7", [1054,"Unknown column 'c' in 't'"]],
  ["ALTER TABLE t CHANGE c cc INT NOT NULL", [1054,"Unknown column 'c' in 't'"]],
  ["SHOW CREATE TABLE t", [["t","CREATE TABLE `t` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `d` varchar(5) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE t MODIFY d VARCHAR(5) NOT NULL", [1138,"Invalid use of NULL value"]],
  ["ALTER TABLE t MODIFY cc TINYINT NOT NULL", [1054,"Unknown column 'cc' in 't'"]],
  ["INSERT INTO t (d, cc) VALUES ('q', 200)", [1054,"Unknown column 'cc' in 'field list'"]],
  ["ALTER TABLE t MODIFY cc TINYINT NOT NULL", [1054,"Unknown column 'cc' in 't'"]],
  ["SELECT * FROM t ORDER BY id", [["1",null],["2",null],["3",null]]],
  ["ALTER TABLE t RENAME COLUMN d TO dd", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE t RENAME COLUMN dd TO cc", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE t ALTER COLUMN dd SET DEFAULT 'z'", [1054,"Unknown column 'dd' in 't'"]],
  ["ALTER TABLE t ALTER COLUMN cc DROP DEFAULT", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE t", [["t","CREATE TABLE `t` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `cc` varchar(5),\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE t RENAME INDEX nope TO x", [1176,"Key 'nope' doesn't exist in table 't'"]],
  ["ALTER TABLE t ADD KEY k1 (dd), RENAME INDEX k1 TO k2", [1176,"Key 'k1' doesn't exist in table 't'"]],
  ["ALTER TABLE t ADD KEY k1 (dd)", [1072,"Key column 'dd' doesn't exist in table"]],
  ["ALTER TABLE t RENAME INDEX k1 TO k2", [1176,"Key 'k1' doesn't exist in table 't'"]],
  ["ALTER TABLE t RENAME INDEX k2 TO PRIMARY", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'PRIMARY' at line 1"]],
  ["ALTER TABLE t COMMENT = 'hello', AUTO_INCREMENT = 100", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE t RENAME TO t2", [0,0,"",0]],
  ["SHOW CREATE TABLE t2", [["t2","CREATE TABLE `t2` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `cc` varchar(5),\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='hello'"]]],
  ["INSERT INTO t2 (dd, cc) VALUES ('w', 1)", [1054,"Unknown column 'dd' in 'field list'"]],
  ["SELECT id, dd FROM t2 ORDER BY id", [1054,"Unknown column 'dd' in 'field list'"]],
  ["ALTER TABLE t2 DROP COLUMN id", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE t2", [["t2","CREATE TABLE `t2` (\n  `cc` varchar(5)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='hello'"]]],
  ["ALTER TABLE t2 DROP COLUMN dd, DROP COLUMN cc", [1090,"You can't delete all columns with ALTER TABLE; use DROP TABLE instead"]],
  ["CREATE TABLE p (id INT PRIMARY KEY, u INT UNIQUE)", [0,0,"",0]],
  ["CREATE TABLE ch (id INT PRIMARY KEY, pu INT, CONSTRAINT f FOREIGN KEY (pu) REFERENCES p(u))", [0,0,"",0]],
  ["ALTER TABLE ch DROP COLUMN pu", [1828,"Cannot drop column 'pu': needed in a foreign key constraint 'f'"]],
  ["ALTER TABLE p DROP COLUMN u", [1829,"Cannot drop column 'u': needed in a foreign key constraint 'f' of table 'ch'"]],
  ["ALTER TABLE ch RENAME COLUMN pu TO pv", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE ch", [["ch","CREATE TABLE `ch` (\n  `id` int NOT NULL,\n  `pv` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `f` (`pv`),\n  CONSTRAINT `f` FOREIGN KEY (`pv`) REFERENCES `p` (`u`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE p RENAME COLUMN u TO w", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE ch", [["ch","CREATE TABLE `ch` (\n  `id` int NOT NULL,\n  `pv` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `f` (`pv`),\n  CONSTRAINT `f` FOREIGN KEY (`pv`) REFERENCES `p` (`w`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE ch MODIFY pv BIGINT", [3780,"Referencing column 'pv' and referenced column 'w' in foreign key constraint 'f' are incompatible."]],
  ["DROP TABLE ch, p, t2", [0,0,"",0]],
  ["CREATE TABLE k (id INT PRIMARY KEY, a INT, b INT, CONSTRAINT one CHECK (a > 0), CONSTRAINT two CHECK (a < b))", [0,0,"",0]],
  ["ALTER TABLE k RENAME COLUMN a TO aa", [3959,"Check constraint 'one' uses column 'a', hence column cannot be dropped or renamed."]],
  ["SHOW CREATE TABLE k", [["k","CREATE TABLE `k` (\n  `id` int NOT NULL,\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  CONSTRAINT `one` CHECK ((`a` > 0)),\n  CONSTRAINT `two` CHECK ((`a` < `b`))\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE k DROP COLUMN b", [3959,"Check constraint 'two' uses column 'b', hence column cannot be dropped or renamed."]],
  ["ALTER TABLE k DROP COLUMN aa", [1091,"Can't DROP 'aa'; check that column/key exists"]],
  ["ALTER TABLE k DROP CHECK two", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE k DROP COLUMN aa", [1091,"Can't DROP 'aa'; check that column/key exists"]],
  ["SHOW CREATE TABLE k", [["k","CREATE TABLE `k` (\n  `id` int NOT NULL,\n  `a` int DEFAULT NULL,\n  `b` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  CONSTRAINT `one` CHECK ((`a` > 0))\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE m (id INT PRIMARY KEY, a INT, b VARCHAR(10), UNIQUE KEY ab (a, b))", [0,0,"",0]],
  ["INSERT INTO m VALUES (1, 1, 'x'), (2, NULL, 'yy'), (3, 300, 'zzzz')", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE m MODIFY a TINYINT", [1264,"Out of range value for column 'a' at row 3"]],
  ["ALTER TABLE m MODIFY b VARCHAR(2)", [1265,"Data truncated for column 'b' at row 3"]],
  ["ALTER TABLE m MODIFY b VARCHAR(20) NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE m MODIFY a INT NOT NULL", [1138,"Invalid use of NULL value"]],
  ["ALTER TABLE m MODIFY a BIGINT", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE m CHANGE a a2 INT FIRST", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE m MODIFY b VARCHAR(30) AFTER id", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE m", [["m","CREATE TABLE `m` (\n  `a2` int DEFAULT NULL,\n  `id` int NOT NULL,\n  `b` varchar(30) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `ab` (`a2`,`b`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT * FROM m ORDER BY id", [["1","1","x"],[null,"2","yy"],["300","3","zzzz"]]],
  ["ALTER TABLE m CHANGE a2 b INT", [1060,"Duplicate column name 'b'"]],
  ["ALTER TABLE m MODIFY id BIGINT", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE m ALTER COLUMN a2 SET DEFAULT 9", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO m (id, b) VALUES (4, 'w')", [1,0,"",0]],
  ["ALTER TABLE m ALTER COLUMN a2 DROP DEFAULT", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO m (id, b) VALUES (5, 'v')", [1364,"Field 'a2' doesn't have a default value"]],
  ["ALTER TABLE m ALTER COLUMN b DROP DEFAULT", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO m (id) VALUES (6)", [1364,"Field 'a2' doesn't have a default value"]],
  ["SELECT * FROM m ORDER BY id", [["1","1","x"],[null,"2","yy"],["300","3","zzzz"],["9","4","w"]]],
  ["SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'm' ORDER BY ordinal_position", [["a2",null,"YES"],["id",null,"NO"],["b",null,"YES"]]],
  ["ALTER TABLE m RENAME INDEX ab TO ab2", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE m RENAME KEY ab2 TO PRIMARY2", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE m", [["m","CREATE TABLE `m` (\n  `a2` int,\n  `id` bigint NOT NULL,\n  `b` varchar(30),\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `PRIMARY2` (`a2`,`b`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE m RENAME TO k", [1050,"Table 'k' already exists"]],
  ["ALTER TABLE m RENAME AS mm", [0,0,"",0]],
  ["ALTER TABLE mm ENGINE = InnoDB, COMMENT 'c'", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE mm", [["mm","CREATE TABLE `mm` (\n  `a2` int,\n  `id` bigint NOT NULL,\n  `b` varchar(30),\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `PRIMARY2` (`a2`,`b`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='c'"]]],
  ["DROP TABLE k, mm", [0,0,"",0]],
  ["CREATE TABLE n (id INT, t VARCHAR(20), u VARCHAR(20), FULLTEXT (t, u), FULLTEXT(u))", [0,0,"",0]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `t` varchar(20) DEFAULT NULL,\n  `u` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`,`u`),\n  FULLTEXT KEY `u` (`u`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE n ADD FULLTEXT (u)", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `t` varchar(20) DEFAULT NULL,\n  `u` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`,`u`),\n  FULLTEXT KEY `u` (`u`),\n  FULLTEXT KEY `u_2` (`u`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE n ADD FULLTEXT INDEX (u, t)", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE n DROP INDEX u", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `t` varchar(20) DEFAULT NULL,\n  `u` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`,`u`),\n  FULLTEXT KEY `u_2` (`u`),\n  FULLTEXT KEY `u_3` (`u`,`t`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE n DROP INDEX t", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT MATCH(t,u) AGAINST('x') FROM n", []],
  ["ALTER TABLE n RENAME INDEX u_2 TO uu", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `t` varchar(20) DEFAULT NULL,\n  `u` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `uu` (`u`),\n  FULLTEXT KEY `u_3` (`u`,`t`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE n DROP COLUMN u", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `t` varchar(20) DEFAULT NULL,\n  FULLTEXT KEY `u_3` (`t`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE n MODIFY t INT", [1283,"Column 't' cannot be part of FULLTEXT index"]],
  ["ALTER TABLE n MODIFY t TEXT", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `t` text,\n  FULLTEXT KEY `u_3` (`t`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["ALTER TABLE n RENAME COLUMN t TO tt", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `tt` text,\n  FULLTEXT KEY `u_3` (`tt`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT MATCH(tt) AGAINST('x') FROM n", []],
  ["CREATE FULLTEXT INDEX fx ON n (tt)", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["SHOW CREATE TABLE n", [["n","CREATE TABLE `n` (\n  `id` int DEFAULT NULL,\n  `tt` text,\n  FULLTEXT KEY `u_3` (`tt`),\n  FULLTEXT KEY `fx` (`tt`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["DROP INDEX fx ON n", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE n ADD FULLTEXT (nope)", [1072,"Key column 'nope' doesn't exist in table"]],
  ["DROP TABLE n", [0,0,"",0]],
]

test('ALTER TABLE on columns, keys and the table answers every statement of the script as 8.4.11 did', async () => {
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
