// M5.25 — foreign keys, as 8.4.11 answered each of these statements.
//
// The script was run against the server first and its answers kept: a result
// set's rows, an OK's counts and info, an error's number and its message,
// which matters here because a client reads the constraint's name out of it
// (Prisma's P2003 does). The one name that cannot agree is the temporary
// table an ALTER copies into, `#sql-<pid>_<thread>` on the server; both sides
// are normalized to `#sql-…`.
//
// What the script covers, in order: the names and indexes a key is made
// with; every refusal of its definition; the I_S rows; a missing parent
// (1452) and a held child (1451), with IGNORE and with the checks off;
// CASCADE and SET NULL through two levels, through a table that references
// itself, and to a table updated further up the chain (1451); REPLACE and an
// upsert on a parent; the indexes a key holds (1553); MATCH SIMPLE's NULLs;
// SET DEFAULT, which InnoDB refuses as RESTRICT; ALTER TABLE adding and
// dropping keys, indexes and columns; DROP and TRUNCATE of a parent; a key
// across schemas, which DROP DATABASE must respect; a parent's own index (1553);
// and REPLACE and an upsert on a table that references itself. Then what a
// review found: a row's keys are checked after it is written, not before (a
// row that becomes its own parent, a duplicate before a missing parent); a
// changed primary key re-checks every key; DELETE IGNORE; a cascaded value
// that does not fit its column refuses the parent's update (1451) rather
// than writing NULL; and BINARY against VARBINARY compares unpadded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE p (id INT PRIMARY KEY, u INT, v VARCHAR(10), w INT NOT NULL, s VARCHAR(5), UNIQUE KEY (u), KEY (w), UNIQUE KEY (s))", [0,0,"",0]],
  ["CREATE TABLE c (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES p(id))", [0,0,"",0]],
  ["CREATE TABLE c2 (id INT PRIMARY KEY, pid INT, CONSTRAINT fk2 FOREIGN KEY (pid) REFERENCES p(id))", [0,0,"",0]],
  ["CREATE TABLE c3 (id INT PRIMARY KEY, pid INT, FOREIGN KEY ix3 (pid) REFERENCES p(id))", [0,0,"",0]],
  ["CREATE TABLE c4 (id INT PRIMARY KEY, pid INT, CONSTRAINT fk4 FOREIGN KEY ix4 (pid) REFERENCES p(id))", [0,0,"",0]],
  ["CREATE TABLE c5 (id INT PRIMARY KEY, pid INT, KEY (pid), FOREIGN KEY (pid) REFERENCES p(id), FOREIGN KEY (pid) REFERENCES p(u))", [0,0,"",0]],
  ["CREATE TABLE c6 (x INT, y INT, KEY k3 (y, x), FOREIGN KEY (x) REFERENCES p(id))", [0,0,"",0]],
  ["SELECT table_name, index_name, column_name, seq_in_index FROM information_schema.statistics WHERE table_schema = 'app' ORDER BY table_name, index_name, seq_in_index", [["c","pid","pid","1"],["c","PRIMARY","id","1"],["c2","fk2","pid","1"],["c2","PRIMARY","id","1"],["c3","ix3","pid","1"],["c3","PRIMARY","id","1"],["c4","fk4","pid","1"],["c4","PRIMARY","id","1"],["c5","pid","pid","1"],["c5","PRIMARY","id","1"],["c6","k3","y","1"],["c6","k3","x","2"],["c6","x","x","1"],["p","PRIMARY","id","1"],["p","s","s","1"],["p","u","u","1"],["p","w","w","1"]]],
  ["SELECT constraint_name, unique_constraint_name, match_option, update_rule, delete_rule, table_name, referenced_table_name FROM information_schema.referential_constraints WHERE constraint_schema = 'app' ORDER BY constraint_name", [["c3_ibfk_1","PRIMARY","NONE","NO ACTION","NO ACTION","c3","p"],["c5_ibfk_1","PRIMARY","NONE","NO ACTION","NO ACTION","c5","p"],["c5_ibfk_2","u","NONE","NO ACTION","NO ACTION","c5","p"],["c6_ibfk_1","PRIMARY","NONE","NO ACTION","NO ACTION","c6","p"],["c_ibfk_1","PRIMARY","NONE","NO ACTION","NO ACTION","c","p"],["fk2","PRIMARY","NONE","NO ACTION","NO ACTION","c2","p"],["fk4","PRIMARY","NONE","NO ACTION","NO ACTION","c4","p"]]],
  ["SELECT constraint_name, table_name, column_name, ordinal_position, position_in_unique_constraint, referenced_table_schema, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = 'app' AND referenced_table_name IS NOT NULL ORDER BY table_name, constraint_name", [["c_ibfk_1","c","pid","1","1","app","p","id"],["fk2","c2","pid","1","1","app","p","id"],["c3_ibfk_1","c3","pid","1","1","app","p","id"],["fk4","c4","pid","1","1","app","p","id"],["c5_ibfk_1","c5","pid","1","1","app","p","id"],["c5_ibfk_2","c5","pid","1","1","app","p","u"],["c6_ibfk_1","c6","x","1","1","app","p","id"]]],
  ["CREATE TABLE e1 (pid INT, FOREIGN KEY (pid) REFERENCES nope(id))", [1824,"Failed to open the referenced table 'nope'"]],
  ["CREATE TABLE e2 (pid INT, FOREIGN KEY (pid) REFERENCES p(v))", [3780,"Referencing column 'pid' and referenced column 'v' in foreign key constraint 'e2_ibfk_1' are incompatible."]],
  ["CREATE TABLE e3 (pid BIGINT, FOREIGN KEY (pid) REFERENCES p(id))", [3780,"Referencing column 'pid' and referenced column 'id' in foreign key constraint 'e3_ibfk_1' are incompatible."]],
  ["CREATE TABLE e4 (pid INT, CONSTRAINT fk2 FOREIGN KEY (pid) REFERENCES p(id))", [1826,"Duplicate foreign key constraint name 'fk2'"]],
  ["CREATE TABLE e5 (pid INT NOT NULL, CONSTRAINT fk5 FOREIGN KEY (pid) REFERENCES p(id) ON DELETE SET NULL)", [1830,"Column 'pid' cannot be NOT NULL: needed in a foreign key constraint 'fk5' SET NULL"]],
  ["CREATE TABLE e6 (pid INT, FOREIGN KEY (pid) REFERENCES p(id, u))", [1239,"Incorrect foreign key definition for 'foreign key without name': Key reference and table reference don't match"]],
  ["CREATE TABLE e7 (pid INT, FOREIGN KEY (pid) REFERENCES p(zz))", [3734,"Failed to add the foreign key constraint. Missing column 'zz' for constraint 'e7_ibfk_1' in the referenced table 'p'"]],
  ["CREATE TABLE e8 (pid INT, FOREIGN KEY (zz) REFERENCES p(id))", [1072,"Key column 'zz' doesn't exist in table"]],
  ["CREATE TABLE e9 (pid INT, FOREIGN KEY (pid) REFERENCES p(w))", [6125,"Failed to add the foreign key constraint. Missing unique key for constraint 'e9_ibfk_1' in the referenced table 'p'"]],
  ["CREATE TABLE e11 (pid INT UNSIGNED, FOREIGN KEY (pid) REFERENCES p(id))", [3780,"Referencing column 'pid' and referenced column 'id' in foreign key constraint 'e11_ibfk_1' are incompatible."]],
  ["CREATE TABLE e12 (pid VARCHAR(10) COLLATE utf8mb4_bin, FOREIGN KEY (pid) REFERENCES p(s))", [3780,"Referencing column 'pid' and referenced column 's' in foreign key constraint 'e12_ibfk_1' are incompatible."]],
  ["CREATE TABLE ok1 (pid CHAR(20), FOREIGN KEY (pid) REFERENCES p(s))", [0,0,"",0]],
  ["CREATE TABLE m (pid INT, FOREIGN KEY (pid) REFERENCES p(id)) ENGINE = MEMORY", [0,0,"",0]],
  ["CREATE TABLE pm (id INT PRIMARY KEY) ENGINE = MEMORY", [0,0,"",0]],
  ["CREATE TABLE cm (pid INT, FOREIGN KEY (pid) REFERENCES pm(id))", [1824,"Failed to open the referenced table 'pm'"]],
  ["SELECT table_name, constraint_name FROM information_schema.table_constraints WHERE table_schema = 'app' AND constraint_type = 'FOREIGN KEY' ORDER BY 1, 2", [["c","c_ibfk_1"],["c2","fk2"],["c3","c3_ibfk_1"],["c4","fk4"],["c5","c5_ibfk_1"],["c5","c5_ibfk_2"],["c6","c6_ibfk_1"],["ok1","ok1_ibfk_1"]]],
  ["DROP TABLE c, c2, c3, c4, c5, c6, ok1, m, pm, p", [0,0,"",0]],
  ["CREATE TABLE p (id INT PRIMARY KEY, s VARCHAR(5) UNIQUE)", [0,0,"",0]],
  ["INSERT INTO p VALUES (1, 'a'), (2, 'b'), (3, 'c')", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE c (id INT PRIMARY KEY AUTO_INCREMENT, pid INT, ps VARCHAR(5), CONSTRAINT fkc FOREIGN KEY (pid) REFERENCES p(id) ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT fks FOREIGN KEY (ps) REFERENCES p(s) ON DELETE SET NULL)", [0,0,"",0]],
  ["CREATE TABLE r (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES p(id) ON DELETE RESTRICT ON UPDATE NO ACTION)", [0,0,"",0]],
  ["INSERT INTO c (pid, ps) VALUES (1, 'A'), (2, 'b'), (NULL, NULL), (1, 'a')", [4,1,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO c (pid) VALUES (9)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `fkc` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE ON UPDATE CASCADE)"]],
  ["INSERT INTO c (pid) VALUES (1), (9), (2)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `fkc` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE ON UPDATE CASCADE)"]],
  ["INSERT IGNORE INTO c (pid) VALUES (1), (9), (2)", [2,9,"Records: 3  Duplicates: 1  Warnings: 1",1]],
  ["SELECT * FROM c ORDER BY id", [["1","1","A"],["2","2","b"],["3",null,null],["4","1","a"],["9","1",null],["10","2",null]]],
  ["INSERT INTO r VALUES (1, 3)", [1,0,"",0]],
  ["INSERT INTO r VALUES (2, 5)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`r`, CONSTRAINT `r_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE RESTRICT)"]],
  ["DELETE FROM p WHERE id = 3", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`r`, CONSTRAINT `r_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE RESTRICT)"]],
  ["UPDATE p SET id = 30 WHERE id = 3", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`r`, CONSTRAINT `r_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE RESTRICT)"]],
  ["UPDATE p SET id = 10 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM c ORDER BY id", [["1","10","A"],["2","2","b"],["3",null,null],["4","10","a"],["9","10",null],["10","2",null]]],
  ["DELETE FROM p WHERE id = 2", [1,0,"",0]],
  ["SELECT * FROM c ORDER BY id", [["1","10","A"],["3",null,null],["4","10","a"],["9","10",null]]],
  ["UPDATE p SET s = 'z' WHERE id = 10", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `fks` FOREIGN KEY (`ps`) REFERENCES `p` (`s`) ON DELETE SET NULL)"]],
  ["UPDATE c SET pid = 99 WHERE id = 1", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `fkc` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE ON UPDATE CASCADE)"]],
  ["UPDATE c SET pid = 10, ps = 'c' WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SET foreign_key_checks = 0", [0,0,"",0]],
  ["INSERT INTO c (pid) VALUES (77)", [1,12,"",0]],
  ["DELETE FROM p WHERE id = 3", [1,0,"",0]],
  ["SET foreign_key_checks = 1", [0,0,"",0]],
  ["SELECT * FROM c ORDER BY id", [["1","10","c"],["3",null,null],["4","10","a"],["9","10",null],["12","77",null]]],
  ["SELECT * FROM r", [["1","3"]]],
  ["DROP TABLE p", [3730,"Cannot drop table 'p' referenced by a foreign key constraint 'fkc' on table 'c'."]],
  ["TRUNCATE TABLE p", [1701,"Cannot truncate a table referenced in a foreign key constraint (`app`.`c`, CONSTRAINT `fkc`)"]],
  ["TRUNCATE TABLE c", [0,0,"",0]],
  ["DROP TABLE c, r, p", [0,0,"",0]],
  ["CREATE TABLE p (id INT PRIMARY KEY, n INT)", [0,0,"",0]],
  ["INSERT INTO p VALUES (1, 0), (2, 0), (3, 0)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE c (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES p(id) ON DELETE CASCADE ON UPDATE CASCADE)", [0,0,"",0]],
  ["INSERT INTO c VALUES (1, 1), (2, 1), (3, 2)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE g (id INT PRIMARY KEY, cid INT, FOREIGN KEY (cid) REFERENCES c(id) ON DELETE CASCADE)", [0,0,"",0]],
  ["INSERT INTO g VALUES (1, 1), (2, 3)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["DELETE FROM p WHERE id IN (1, 2)", [2,0,"",0]],
  ["SELECT * FROM c", []],
  ["SELECT * FROM g", []],
  ["CREATE TABLE s (id INT PRIMARY KEY, parent INT, FOREIGN KEY (parent) REFERENCES s(id) ON DELETE CASCADE)", [0,0,"",0]],
  ["INSERT INTO s VALUES (1, NULL), (2, 1), (3, 2), (4, 3), (5, 5)", [5,0,"Records: 5  Duplicates: 0  Warnings: 0",0]],
  ["DELETE FROM s WHERE id = 1", [1,0,"",0]],
  ["SELECT * FROM s", [["5","5"]]],
  ["DELETE FROM s WHERE id = 5", [1,0,"",0]],
  ["CREATE TABLE s2 (id INT PRIMARY KEY, parent INT, FOREIGN KEY (parent) REFERENCES s2(id) ON UPDATE CASCADE)", [0,0,"",0]],
  ["INSERT INTO s2 VALUES (1, NULL), (2, 1)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE s2 SET id = 10 WHERE id = 1", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`s2`, CONSTRAINT `s2_ibfk_1` FOREIGN KEY (`parent`) REFERENCES `s2` (`id`) ON UPDATE CASCADE)"]],
  ["CREATE TABLE s3 (id INT PRIMARY KEY, parent INT, FOREIGN KEY (parent) REFERENCES s3(id) ON DELETE SET NULL)", [0,0,"",0]],
  ["INSERT INTO s3 VALUES (1, NULL), (2, 1), (3, 1)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["DELETE FROM s3 WHERE id = 1", [1,0,"",0]],
  ["SELECT * FROM s3", [["2",null],["3",null]]],
  ["INSERT INTO c VALUES (5, 3)", [1,0,"",0]],
  ["REPLACE INTO p VALUES (3, 1)", [2,0,"",0]],
  ["SELECT * FROM c", []],
  ["INSERT INTO c VALUES (6, 3)", [1,0,"",0]],
  ["INSERT INTO p VALUES (3, 5) ON DUPLICATE KEY UPDATE id = 33", [2,0,"",0]],
  ["SELECT * FROM c", [["6","33"]]],
  ["ALTER TABLE c DROP INDEX pid", [1553,"Cannot drop index 'pid': needed in a foreign key constraint"]],
  ["CREATE TABLE c7 (pid INT, KEY k1 (pid), FOREIGN KEY (pid) REFERENCES p(id))", [0,0,"",0]],
  ["ALTER TABLE c7 DROP INDEX k1", [1553,"Cannot drop index 'k1': needed in a foreign key constraint"]],
  ["CREATE TABLE p2 (a INT, b INT, UNIQUE KEY ab (a, b))", [0,0,"",0]],
  ["INSERT INTO p2 VALUES (1, 1)", [1,0,"",0]],
  ["CREATE TABLE c8 (x INT, y INT, FOREIGN KEY (x, y) REFERENCES p2(a, b))", [0,0,"",0]],
  ["INSERT INTO c8 VALUES (9, NULL), (NULL, 9)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO c8 VALUES (9, 9)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`c8`, CONSTRAINT `c8_ibfk_1` FOREIGN KEY (`x`, `y`) REFERENCES `p2` (`a`, `b`))"]],
  ["INSERT INTO c8 VALUES (1, 1)", [1,0,"",0]],
  ["CREATE TABLE c9 (pid INT, FOREIGN KEY (pid) REFERENCES p(id) ON DELETE SET DEFAULT ON UPDATE SET DEFAULT)", [0,0,"",0]],
  ["INSERT INTO c9 VALUES (33)", [1,0,"",0]],
  ["DELETE FROM p WHERE id = 33", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`c9`, CONSTRAINT `c9_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`))"]],
  ["CREATE TABLE c5 (pid INT)", [0,0,"",0]],
  ["INSERT INTO c5 VALUES (1), (8)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE c5 ADD CONSTRAINT fk5 FOREIGN KEY (pid) REFERENCES p(id)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`#sql-…`, CONSTRAINT `fk5` FOREIGN KEY (`pid`) REFERENCES `p` (`id`))"]],
  ["DELETE FROM c5 WHERE pid = 8", [1,0,"",0]],
  ["ALTER TABLE c5 ADD CONSTRAINT fk5 FOREIGN KEY (pid) REFERENCES p(id) ON DELETE RESTRICT ON UPDATE CASCADE", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`#sql-…`, CONSTRAINT `fk5` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE)"]],
  ["ALTER TABLE c5 ADD COLUMN z INT DEFAULT 5, ADD INDEX iz (z)", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM c5", [["1","5"]]],
  ["ALTER TABLE c5 DROP FOREIGN KEY fk5", [1091,"Can't DROP 'fk5'; check that column/key exists"]],
  ["ALTER TABLE c5 DROP FOREIGN KEY nope", [1091,"Can't DROP 'nope'; check that column/key exists"]],
  ["ALTER TABLE c5 DROP INDEX nope", [1091,"Can't DROP 'nope'; check that column/key exists"]],
  ["ALTER TABLE c5 DROP INDEX fk5", [1091,"Can't DROP 'fk5'; check that column/key exists"]],
  ["ALTER TABLE c5 ADD COLUMN y VARCHAR(3) NOT NULL FIRST", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM c5", [["","1","5"]]],
  ["ALTER TABLE c5 ADD UNIQUE KEY uz (z)", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SET foreign_key_checks = 0", [0,0,"",0]],
  ["ALTER TABLE c5 ADD CONSTRAINT fk6 FOREIGN KEY (z) REFERENCES p(id)", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE c10 (pid INT, FOREIGN KEY (pid) REFERENCES ghost(id))", [0,0,"",0]],
  ["SET foreign_key_checks = 1", [0,0,"",0]],
  ["INSERT INTO c10 VALUES (1)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`c10`, CONSTRAINT `c10_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `ghost` (`id`))"]],
  ["ALTER TABLE c5 ADD COLUMN w INT AFTER y, ADD FOREIGN KEY (w) REFERENCES p(id)", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SELECT constraint_name, update_rule, delete_rule FROM information_schema.referential_constraints WHERE table_name = 'c5' ORDER BY 1", [["c5_ibfk_1","NO ACTION","NO ACTION"],["fk6","NO ACTION","NO ACTION"]]],
  ["CREATE DATABASE other", [1,0,"",0]],
  ["CREATE TABLE other.x (pid INT, FOREIGN KEY (pid) REFERENCES app.p(id))", [0,0,"",0]],
  ["INSERT INTO other.x VALUES (7)", [1452,"Cannot add or update a child row: a foreign key constraint fails (`other`.`x`, CONSTRAINT `x_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `app`.`p` (`id`))"]],
  ["DROP DATABASE app", [3730,"Cannot drop table 'p' referenced by a foreign key constraint 'x_ibfk_1' on table 'x'."]],
  ["DROP DATABASE other", [1,0,"",0]],
  ["DROP DATABASE app", [12,0,"",0]],
  ["CREATE DATABASE app", [1,0,"",0]],
  ["USE app", [0,0,"",0]],
  ["CREATE TABLE p (id INT PRIMARY KEY, u INT, v INT, UNIQUE KEY uu (u), UNIQUE KEY uv (v))", [0,0,"",0]],
  ["CREATE TABLE c (x INT, FOREIGN KEY (x) REFERENCES p(u))", [0,0,"",0]],
  ["ALTER TABLE p DROP INDEX uv", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE p DROP INDEX uu", [1553,"Cannot drop index 'uu': needed in a foreign key constraint"]],
  ["ALTER TABLE p ADD COLUMN z INT", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE p (id INT PRIMARY KEY, FOREIGN KEY (id) REFERENCES nope(id))", [1050,"Table 'p' already exists"]],
  ["CREATE TABLE self (id INT PRIMARY KEY, x INT, FOREIGN KEY (x) REFERENCES self(id) ON DELETE SET NULL)", [0,0,"",0]],
  ["INSERT INTO self VALUES (1, NULL), (2, 1)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["REPLACE INTO self VALUES (1, NULL)", [2,0,"",0]],
  ["SELECT * FROM self", [["1",null],["2",null]]],
  ["CREATE TABLE self2 (id INT PRIMARY KEY, x INT, FOREIGN KEY (x) REFERENCES self2(id) ON UPDATE SET NULL)", [0,0,"",0]],
  ["INSERT INTO self2 VALUES (1, NULL), (2, 1)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO self2 VALUES (1, NULL) ON DUPLICATE KEY UPDATE id = 3", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`self2`, CONSTRAINT `self2_ibfk_1` FOREIGN KEY (`x`) REFERENCES `self2` (`id`) ON UPDATE SET NULL)"]],
  ["DROP TABLE self, self2", [0,0,"",0]],
  ["CREATE TABLE t (id INT PRIMARY KEY, p INT, FOREIGN KEY (p) REFERENCES t(id))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1, NULL)", [1,0,"",0]],
  ["UPDATE t SET id = 5, p = 5 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM t", [["5","5"]]],
  ["CREATE TABLE tp (id INT PRIMARY KEY)", [0,0,"",0]],
  ["INSERT INTO tp VALUES (1)", [1,0,"",0]],
  ["CREATE TABLE tc (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES tp(id))", [0,0,"",0]],
  ["INSERT INTO tc VALUES (1, 1), (2, 1)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE tc SET id = 1, pid = 9 WHERE id = 2", [1062,"Duplicate entry '1' for key 'tc.PRIMARY'"]],
  ["SET foreign_key_checks = 0", [0,0,"",0]],
  ["INSERT INTO tc VALUES (3, 7)", [1,0,"",0]],
  ["SET foreign_key_checks = 1", [0,0,"",0]],
  ["UPDATE tc SET id = 4 WHERE id = 3", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`tc`, CONSTRAINT `tc_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `tp` (`id`))"]],
  ["UPDATE tc SET id = 5 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM tc ORDER BY id", [["2","1"],["3","7"],["5","1"]]],
  ["DELETE IGNORE FROM tp", [0,0,"",1]],
  ["SELECT * FROM tp", [["1"]]],
  ["CREATE TABLE sp (a VARCHAR(10) PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE sc (a VARCHAR(3), FOREIGN KEY (a) REFERENCES sp(a) ON UPDATE CASCADE)", [0,0,"",0]],
  ["INSERT INTO sp VALUES ('abc')", [1,0,"",0]],
  ["INSERT INTO sc VALUES ('abc')", [1,0,"",0]],
  ["UPDATE sp SET a = 'abcdef'", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`sc`, CONSTRAINT `sc_ibfk_1` FOREIGN KEY (`a`) REFERENCES `sp` (`a`) ON UPDATE CASCADE)"]],
  ["SELECT * FROM sc", [["abc"]]],
  ["SELECT * FROM sp", [["abc"]]],
  ["UPDATE sp SET a = 'xy'", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM sc", [["xy"]]],
  ["CREATE TABLE pb (a BINARY(4) PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE cb (a VARBINARY(4), FOREIGN KEY (a) REFERENCES pb(a))", [0,0,"",0]],
  ["INSERT INTO pb VALUES ('ab')", [1,0,"",0]],
  ["INSERT INTO cb VALUES ('ab')", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`cb`, CONSTRAINT `cb_ibfk_1` FOREIGN KEY (`a`) REFERENCES `pb` (`a`))"]],
  ["INSERT INTO cb VALUES (x'61620000')", [1,0,"",0]],
  ["SELECT HEX(a) FROM cb", [["61620000"]]],
  ["DROP TABLE t, tc, tp, sc, sp, cb, pb", [0,0,"",0]],
]

test('M5.25: foreign keys answer every statement of the script as 8.4.11 did', async () => {
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
        actual = [err.errno, err.message.replace(/#sql-[0-9a-f]+_[0-9a-f]+/g, '#sql-…')]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
