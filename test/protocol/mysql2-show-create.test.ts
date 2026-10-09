// M5.9 — SHOW CREATE TABLE, byte for byte as 8.4.11 wrote it for each table.
//
// The tables cover every column type and attribute the executor stores:
// widths that survive (TINYINT(1), ZEROFILL), unsigned, defaults literal,
// BIT, CURRENT_TIMESTAMP and expressions, a nullable TIMESTAMP, TEXT and BLOB
// without DEFAULT NULL, a column's own character set, comments; keys in
// `sort_keys` order, prefixes and DESC; foreign keys and CHECK constraints,
// one not enforced; ENGINE, AUTO_INCREMENT past 1, CHARSET and COLLATE, a
// table comment; and a name with a backtick in it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t1 (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, a TINYINT(1) DEFAULT 0, b SMALLINT UNSIGNED NOT NULL, c BIGINT ZEROFILL, d DECIMAL(10,2) DEFAULT 1.5, e FLOAT, f DOUBLE NOT NULL DEFAULT 0, g BIT(3) DEFAULT b'101', h YEAR)", [0,0,"",2]],
  ["SHOW CREATE TABLE t1", [["t1","CREATE TABLE `t1` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `a` tinyint(1) DEFAULT '0',\n  `b` smallint unsigned NOT NULL,\n  `c` bigint(20) unsigned zerofill DEFAULT NULL,\n  `d` decimal(10,2) DEFAULT '1.50',\n  `e` float DEFAULT NULL,\n  `f` double NOT NULL DEFAULT '0',\n  `g` bit(3) DEFAULT b'101',\n  `h` year DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t2 (s VARCHAR(20) NOT NULL DEFAULT '', c CHAR(3) CHARACTER SET latin1, t TEXT, m MEDIUMTEXT COLLATE utf8mb4_bin, b BLOB, vb VARBINARY(8), bn BINARY(4), e ENUM('a','b''c') DEFAULT 'a', st SET('x','y'), j JSON, s2 VARCHAR(5) COMMENT 'it''s here') COMMENT='table note'", [0,0,"",0]],
  ["SHOW CREATE TABLE t2", [["t2","CREATE TABLE `t2` (\n  `s` varchar(20) NOT NULL DEFAULT '',\n  `c` char(3) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,\n  `t` text,\n  `m` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,\n  `b` blob,\n  `vb` varbinary(8) DEFAULT NULL,\n  `bn` binary(4) DEFAULT NULL,\n  `e` enum('a','b''c') DEFAULT 'a',\n  `st` set('x','y') DEFAULT NULL,\n  `j` json DEFAULT NULL,\n  `s2` varchar(5) DEFAULT NULL COMMENT 'it''s here'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='table note'"]]],
  ["CREATE TABLE t3 (d DATE, dt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), ts TIMESTAMP NULL DEFAULT NULL, tm TIME(2) NOT NULL, x INT DEFAULT (1 + 2), y VARCHAR(10) DEFAULT (UPPER('a')))", [0,0,"",0]],
  ["SHOW CREATE TABLE t3", [["t3","CREATE TABLE `t3` (\n  `d` date DEFAULT NULL,\n  `dt` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),\n  `ts` timestamp NULL DEFAULT NULL,\n  `tm` time(2) NOT NULL,\n  `x` int DEFAULT ((1 + 2)),\n  `y` varchar(10) DEFAULT (upper(_utf8mb4'a'))\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t4 (a INT, b INT, c VARCHAR(30), PRIMARY KEY (a, b), UNIQUE KEY uc (c(10)), KEY kb (b DESC), KEY kab (a, b)) ENGINE=InnoDB DEFAULT CHARSET=latin1", [0,0,"",0]],
  ["SHOW CREATE TABLE t4", [["t4","CREATE TABLE `t4` (\n  `a` int NOT NULL,\n  `b` int NOT NULL,\n  `c` varchar(30) DEFAULT NULL,\n  PRIMARY KEY (`a`,`b`),\n  UNIQUE KEY `uc` (`c`(10)),\n  KEY `kb` (`b` DESC),\n  KEY `kab` (`a`,`b`)\n) ENGINE=InnoDB DEFAULT CHARSET=latin1"]]],
  ["CREATE TABLE t5 (id INT PRIMARY KEY, p INT, q INT CHECK (q > 0), FOREIGN KEY (p) REFERENCES t4 (a) ON DELETE CASCADE, CONSTRAINT ck CHECK (p <> q) NOT ENFORCED) ENGINE=MEMORY", [0,0,"",0]],
  ["SHOW CREATE TABLE t5", [["t5","CREATE TABLE `t5` (\n  `id` int NOT NULL,\n  `p` int DEFAULT NULL,\n  `q` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `p` (`p`),\n  CONSTRAINT `ck` CHECK ((`p` <> `q`)) /*!80016 NOT ENFORCED */,\n  CONSTRAINT `t5_chk_1` CHECK ((`q` > 0))\n) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t6 (id INT PRIMARY KEY, p INT, CONSTRAINT f6 FOREIGN KEY (p) REFERENCES t1 (id) ON UPDATE SET NULL)", [0,0,"",0]],
  ["SHOW CREATE TABLE t6", [["t6","CREATE TABLE `t6` (\n  `id` int NOT NULL,\n  `p` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `f6` (`p`),\n  CONSTRAINT `f6` FOREIGN KEY (`p`) REFERENCES `t1` (`id`) ON UPDATE SET NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t7 (n INT) AUTO_INCREMENT=5", [0,0,"",0]],
  ["SHOW CREATE TABLE t7", [["t7","CREATE TABLE `t7` (\n  `n` int DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t8 (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, PRIMARY KEY (id))", [0,0,"",0]],
  ["INSERT INTO t8 VALUES (NULL), (NULL)", [2,1,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE t8", [["t8","CREATE TABLE `t8` (\n  `id` bigint unsigned NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE `odd name` (`we``ird` INT)", [0,0,"",0]],
  ["SHOW CREATE TABLE `odd name`", [["odd name","CREATE TABLE `odd name` (\n  `we``ird` int DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SHOW CREATE TABLE nope", [1146,"Table 'app.nope' doesn't exist"]],
  ["CREATE TABLE ks (a INT NOT NULL, b INT NOT NULL, c VARCHAR(9), d INT, UNIQUE KEY zz (a), UNIQUE KEY aa (b), KEY k2 (d), KEY k1 (a), UNIQUE KEY mm (c(3)), UNIQUE KEY bb (d), UNIQUE KEY cc (c))", [0,0,"",0]],
  ["SHOW CREATE TABLE ks", [["ks","CREATE TABLE `ks` (\n  `a` int NOT NULL,\n  `b` int NOT NULL,\n  `c` varchar(9) DEFAULT NULL,\n  `d` int DEFAULT NULL,\n  UNIQUE KEY `zz` (`a`),\n  UNIQUE KEY `aa` (`b`),\n  UNIQUE KEY `bb` (`d`),\n  UNIQUE KEY `cc` (`c`),\n  UNIQUE KEY `mm` (`c`(3)),\n  KEY `k2` (`d`),\n  KEY `k1` (`a`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE t9 (a VARCHAR(5)) COMMENT 'it''s'", [0,0,"",0]],
  ["SHOW CREATE TABLE t9", [["t9","CREATE TABLE `t9` (\n  `a` varchar(5) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='it''s'"]]],
  ["CREATE TABLE t10 (a INT, b VARCHAR(5) CHARACTER SET latin1 COLLATE latin1_bin) CHARACTER SET latin1", [0,0,"",0]],
  ["SHOW CREATE TABLE t10", [["t10","CREATE TABLE `t10` (\n  `a` int DEFAULT NULL,\n  `b` varchar(5) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=latin1"]]],
]

test('M5.9: SHOW CREATE TABLE writes what 8.4.11 wrote, byte for byte', async () => {
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
