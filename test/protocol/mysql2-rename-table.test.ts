// RENAME TABLE, as 8.4.11 ran each of these statements.
//
// What it pins: pairs applied in order and as one change (a swap through a
// third name; a missing table among them leaves every name as it was); a
// table moving to another schema and back, a view refused that (1450); 1049
// before 1146 before 1050, the table's own name included; a session's
// temporary table unseen. The rows and the AUTO_INCREMENT counter stay with
// the table. MySQL's generated constraint names follow the table's
// (`t_ibfk_N`, `t_chk_N`, a name written in that shape too), and every key
// naming a renamed table, its own included, names it by its new name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE a (id INT PRIMARY KEY AUTO_INCREMENT, v INT)", [0,0,"",0]],
  ["CREATE TABLE b (id INT PRIMARY KEY)", [0,0,"",0]],
  ["INSERT INTO a (v) VALUES (1), (2)", [2,1,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["RENAME TABLE a TO b", [1050,"Table 'b' already exists"]],
  ["RENAME TABLE nope TO c", [1146,"Table 'app.nope' doesn't exist"]],
  ["RENAME TABLE a TO tmp, b TO a, tmp TO b", [0,0,"",0]],
  ["SHOW TABLES", [["a"],["b"]]],
  ["SELECT * FROM b ORDER BY id", [["1","1"],["2","2"]]],
  ["INSERT INTO b (v) VALUES (3)", [1,3,"",0]],
  ["SELECT * FROM b ORDER BY id", [["1","1"],["2","2"],["3","3"]]],
  ["RENAME TABLE b TO c, nope TO d", [1146,"Table 'app.nope' doesn't exist"]],
  ["SHOW TABLES", [["a"],["b"]]],
  ["CREATE DATABASE other", [1,0,"",0]],
  ["RENAME TABLE b TO other.b", [0,0,"",0]],
  ["SELECT * FROM other.b ORDER BY id", [["1","1"],["2","2"],["3","3"]]],
  ["SHOW TABLES", [["a"]]],
  ["RENAME TABLE other.b TO b", [0,0,"",0]],
  ["CREATE VIEW vw AS SELECT * FROM b", [0,0,"",0]],
  ["RENAME TABLE vw TO vw2", [0,0,"",0]],
  ["SELECT * FROM vw2 ORDER BY id", [["1","1"],["2","2"],["3","3"]]],
  ["RENAME TABLE vw2 TO other.vw2", [1450,"Changing schema from 'app' to 'other' is not allowed."]],
  ["CREATE TABLE p (id INT PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE ch (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES p (id))", [0,0,"",0]],
  ["RENAME TABLE p TO p2", [0,0,"",0]],
  ["SHOW CREATE TABLE ch", [["ch","CREATE TABLE `ch` (\n  `id` int NOT NULL,\n  `pid` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `pid` (`pid`),\n  CONSTRAINT `ch_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p2` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["INSERT INTO ch VALUES (1, 5)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`ch`, CONSTRAINT `ch_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p2` (`id`))"]],
  ["RENAME TABLE ch TO ch2", [0,0,"",0]],
  ["SHOW CREATE TABLE ch2", [["ch2","CREATE TABLE `ch2` (\n  `id` int NOT NULL,\n  `pid` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `pid` (`pid`),\n  CONSTRAINT `ch2_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p2` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'app'", [["ch2","ch2_ibfk_1","p2"]]],
  ["RENAME TABLE b TO b", [1050,"Table 'b' already exists"]],
  ["RENAME TABLE b TO B2", [0,0,"",0]],
  ["SHOW TABLES", [["B2"],["a"],["ch2"],["p2"],["vw2"]]],
  ["CREATE TEMPORARY TABLE tt (x INT)", [0,0,"",0]],
  ["RENAME TABLE tt TO tt2", [1146,"Table 'app.tt' doesn't exist"]],
  ["SELECT * FROM tt2", [1146,"Table 'app.tt2' doesn't exist"]],
  ["RENAME TABLE nodb.x TO y", [1049,"Unknown database 'nodb'"]],
  ["RENAME TABLE b2 TO nodb.x", [1049,"Unknown database 'nodb'"]],
  ["DROP DATABASE other", [0,0,"",0]],
  ["CREATE TABLE k (id INT PRIMARY KEY, v INT CHECK (v > 0), CONSTRAINT named CHECK (v < 100))", [0,0,"",0]],
  ["RENAME TABLE k TO k2", [0,0,"",0]],
  ["SHOW CREATE TABLE k2", [["k2","CREATE TABLE `k2` (\n  `id` int NOT NULL,\n  `v` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  CONSTRAINT `k2_chk_1` CHECK ((`v` > 0)),\n  CONSTRAINT `named` CHECK ((`v` < 100))\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE p (id INT PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE c (id INT PRIMARY KEY, pid INT, CONSTRAINT c_ibfk_7 FOREIGN KEY (pid) REFERENCES p (id), CONSTRAINT myfk FOREIGN KEY (id) REFERENCES p (id))", [0,0,"",0]],
  ["RENAME TABLE c TO c2", [0,0,"",0]],
  ["SHOW CREATE TABLE c2", [["c2","CREATE TABLE `c2` (\n  `id` int NOT NULL,\n  `pid` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `c_ibfk_7` (`pid`),\n  CONSTRAINT `c2_ibfk_7` FOREIGN KEY (`pid`) REFERENCES `p` (`id`),\n  CONSTRAINT `myfk` FOREIGN KEY (`id`) REFERENCES `p` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["RENAME TABLE p TO pp, pp TO p3", [0,0,"",0]],
  ["SHOW CREATE TABLE c2", [["c2","CREATE TABLE `c2` (\n  `id` int NOT NULL,\n  `pid` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `c_ibfk_7` (`pid`),\n  CONSTRAINT `c2_ibfk_7` FOREIGN KEY (`pid`) REFERENCES `p3` (`id`),\n  CONSTRAINT `myfk` FOREIGN KEY (`id`) REFERENCES `p3` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'app' ORDER BY 1", [["c2_ibfk_7","c2","p3"],["ch2_ibfk_1","ch2","p2"],["myfk","c2","p3"]]],
  ["RENAME TABLE c2 TO x, p3 TO c2, x TO p3", [0,0,"",0]],
  ["SHOW CREATE TABLE p3", [["p3","CREATE TABLE `p3` (\n  `id` int NOT NULL,\n  `pid` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `c_ibfk_7` (`pid`),\n  CONSTRAINT `myfk` FOREIGN KEY (`id`) REFERENCES `c2` (`id`),\n  CONSTRAINT `p3_ibfk_7` FOREIGN KEY (`pid`) REFERENCES `c2` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE self (id INT PRIMARY KEY, up INT, FOREIGN KEY (up) REFERENCES self (id))", [0,0,"",0]],
  ["RENAME TABLE self TO me", [0,0,"",0]],
  ["SHOW CREATE TABLE me", [["me","CREATE TABLE `me` (\n  `id` int NOT NULL,\n  `up` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `up` (`up`),\n  CONSTRAINT `me_ibfk_1` FOREIGN KEY (`up`) REFERENCES `me` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["INSERT INTO me VALUES (1, NULL), (2, 1)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO me VALUES (3, 9)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`me`, CONSTRAINT `me_ibfk_1` FOREIGN KEY (`up`) REFERENCES `me` (`id`))"]],
]

/** ALTER TABLE … RENAME alone, which is RENAME TABLE: across schemas, and into the current database when the name has none. */
const ALTER_SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE a (id INT PRIMARY KEY AUTO_INCREMENT)", [0,0,"",0]],
  ["INSERT INTO a VALUES (NULL), (NULL)", [2,1,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["CREATE DATABASE other", [1,0,"",0]],
  ["ALTER TABLE a RENAME TO other.a2", [0,0,"",0]],
  ["SELECT * FROM other.a2", [["1"],["2"]]],
  ["ALTER TABLE other.a2 RENAME TO app.a", [0,0,"",0]],
  ["ALTER TABLE a RENAME a3", [0,0,"",0]],
  ["ALTER TABLE a3 RENAME AS a4, RENAME TO a5", [0,0,"",0]],
  ["SHOW TABLES", [["a5"]]],
  ["CREATE TABLE b (id INT)", [0,0,"",0]],
  ["ALTER TABLE a5 RENAME TO b", [1050,"Table 'b' already exists"]],
  ["ALTER TABLE a5 RENAME TO a5", [0,0,"",0]],
  ["ALTER TABLE nope RENAME TO z", [1146,"Table 'app.nope' doesn't exist"]],
  ["CREATE TABLE other.t (id INT)", [0,0,"",0]],
  ["ALTER TABLE other.t RENAME TO t2", [0,0,"",0]],
  ["SHOW TABLES FROM other", []],
  ["CREATE TABLE other.v (id INT)", [0,0,"",0]],
  ["RENAME TABLE other.v TO v2", [0,0,"",0]],
  ["SHOW TABLES", [["a5"],["b"],["t2"],["v2"]]],
  ["DROP DATABASE other", [0,0,"",0]],
]

for (const [title, script] of [['RENAME TABLE moves tables, views and the names that follow them as 8.4.11 does', SCRIPT], ['ALTER TABLE … RENAME alone moves a table as RENAME TABLE does', ALTER_SCRIPT]] as const) test(title, async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of script) {
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
