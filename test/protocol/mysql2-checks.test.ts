// M5.9 — CHECK constraints, as 8.4.11 answered each of these statements.
//
// The script covers: the names a constraint is given, a column's own among
// the table's; every refusal of its definition (3812, 3814, 3815, 3816,
// 3818, 3820, 3822); CHECK_CLAUSE as the server reprints the condition, and
// TABLE_CONSTRAINTS' ENFORCED; 3819 on INSERT, UPDATE and an upsert, NULL
// passing, the first violation in name order, IGNORE skipping a row that
// is then not counted, and a violation that costs no AUTO_INCREMENT value;
// then ALTER TABLE: ADD CHECK checking the rows there, the numbering that
// continues from the highest, DROP CHECK (3821) and DROP CONSTRAINT (3940),
// ALTER CHECK … [NOT] ENFORCED, and a new column's own constraint. Then what
// a review found: a column a foreign key's action writes may not be checked
// (3823), a column's own constraint may name only it (3813), and STRCMP,
// MEMBER OF, JSON_CONTAINS and JSON_OVERLAPS are conditions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE c (a INT, b INT, s VARCHAR(5), CHECK (a > 0), CONSTRAINT bc CHECK (b < a), c INT CHECK (c <> 0), d INT CONSTRAINT dd CHECK (d BETWEEN 1 AND 9), CHECK (s <> '' AND s NOT LIKE 'x%'), CHECK (a + b > 1) NOT ENFORCED)", [0,0,"",0]],
  ["SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema = 'app' ORDER BY 1", [["bc","(`b` < `a`)"],["c_chk_1","(`a` > 0)"],["c_chk_2","(`c` <> 0)"],["c_chk_3","((`s` <> _utf8mb4\\'\\') and (not((`s` like _utf8mb4\\'x%\\'))))"],["c_chk_4","((`a` + `b`) > 1)"],["dd","(`d` between 1 and 9)"]]],
  ["SELECT constraint_name, constraint_type, enforced FROM information_schema.table_constraints WHERE table_schema = 'app' ORDER BY 2, 1", [["bc","CHECK","YES"],["c_chk_1","CHECK","YES"],["c_chk_2","CHECK","YES"],["c_chk_3","CHECK","YES"],["c_chk_4","CHECK","NO"],["dd","CHECK","YES"]]],
  ["INSERT INTO c VALUES (1, 0, 'a', 1, 1)", [1,0,"",0]],
  ["INSERT INTO c VALUES (0, 0, 'a', 1, 1)", [3819,"Check constraint 'bc' is violated."]],
  ["INSERT INTO c VALUES (2, 3, 'a', 1, 1)", [3819,"Check constraint 'bc' is violated."]],
  ["INSERT INTO c VALUES (NULL, NULL, NULL, NULL, NULL)", [1,0,"",0]],
  ["INSERT IGNORE INTO c VALUES (0, 0, 'a', 1, 1), (5, 1, 'b', 1, 1)", [1,0,"Records: 1  Duplicates: 0  Warnings: 1",1]],
  ["UPDATE c SET a = -1 WHERE a = 1", [3819,"Check constraint 'bc' is violated."]],
  ["INSERT INTO c VALUES (3, 1, 'xy', 1, 1)", [3819,"Check constraint 'c_chk_3' is violated."]],
  ["INSERT INTO c VALUES (3, 1, '', 1, 1)", [3819,"Check constraint 'c_chk_3' is violated."]],
  ["INSERT INTO c (a) VALUES (-5)", [3819,"Check constraint 'c_chk_1' is violated."]],
  ["INSERT INTO c VALUES (3, 1, 'q', 0, 1)", [3819,"Check constraint 'c_chk_2' is violated."]],
  ["INSERT INTO c VALUES (3, 1, 'q', 1, 10)", [3819,"Check constraint 'dd' is violated."]],
  ["INSERT INTO c VALUES (3, 1, 'q', 1, 5) ON DUPLICATE KEY UPDATE a = 1", [1,0,"",0]],
  ["SELECT * FROM c ORDER BY a", [[null,null,null,null,null],["1","0","a","1","1"],["3","1","q","1","5"],["5","1","b","1","1"]]],
  ["CREATE TABLE k (id INT AUTO_INCREMENT PRIMARY KEY, n INT, CHECK (n > 0))", [0,0,"",0]],
  ["INSERT INTO k (n) VALUES (1)", [1,1,"",0]],
  ["INSERT INTO k (n) VALUES (0)", [3819,"Check constraint 'k_chk_1' is violated."]],
  ["INSERT INTO k (n) VALUES (2)", [1,2,"",0]],
  ["INSERT INTO k (id, n) VALUES (3, 0)", [3819,"Check constraint 'k_chk_1' is violated."]],
  ["INSERT INTO k (id, n) VALUES (1, 5)", [1062,"Duplicate entry '1' for key 'k.PRIMARY'"]],
  ["SELECT * FROM k ORDER BY id", [["1","1"],["2","2"]]],
  ["CREATE TABLE e1 (a INT, CHECK (z > 0))", [3820,"Check constraint 'e1_chk_1' refers to non-existing column 'z'."]],
  ["CREATE TABLE e2 (a INT, CHECK (a > (SELECT 1)))", [3815,"An expression of a check constraint 'e2_chk_1' contains disallowed function."]],
  ["CREATE TABLE e3 (a INT, CHECK (a > RAND()))", [3814,"An expression of a check constraint 'e3_chk_1' contains disallowed function: rand."]],
  ["CREATE TABLE e4 (a INT AUTO_INCREMENT PRIMARY KEY, CHECK (a > 0))", [3818,"Check constraint 'e4_chk_1' cannot refer to an auto-increment column."]],
  ["CREATE TABLE e5 (a INT, CONSTRAINT bc CHECK (a > 0))", [3822,"Duplicate check constraint name 'bc'."]],
  ["CREATE TABLE e6 (a INT, CHECK (a))", [3812,"An expression of non-boolean type specified to a check constraint 'e6_chk_1'."]],
  ["CREATE TABLE e7 (a INT, CHECK (@x > 0))", [3816,"An expression of a check constraint 'e7_chk_1' cannot refer to a user or system variable."]],
  ["CREATE TABLE e8 (a INT, CHECK (NOW() > 0))", [3814,"An expression of a check constraint 'e8_chk_1' contains disallowed function: now."]],
  ["CREATE TABLE p (a INT, b DECIMAL(5,2), s VARCHAR(9), j JSON, CHECK (a IN (1, 2, 3)), CHECK (a NOT IN (4, 5)), CHECK (a NOT BETWEEN 7 AND 8), CHECK (s IS NOT NULL), CHECK (b IS NULL OR b >= -1.50), CHECK (UPPER(s) <> 'X''Y'), CHECK (CHAR_LENGTH(s) < 9 XOR a = 1), CHECK (a != 3 AND a <=> 3), CHECK (CASE WHEN a > 1 THEN 1 ELSE 0 END = 1), CHECK (-a < 10 AND a % 2 = 0 AND a DIV 2 > 0), CHECK (COALESCE(a, 0) >= 0), CHECK (s LIKE 'a\\\\_b' ESCAPE '|'), CHECK (JSON_VALID(j)), CHECK (NOT a), CHECK (TRUE), CHECK (a > 1e2), CHECK (b <> 0.5))", [0,0,"",0]],
  ["SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema = 'app' AND constraint_name LIKE 'p\\\\_%' ORDER BY LENGTH(constraint_name), constraint_name", [["p_chk_1","(`a` in (1,2,3))"],["p_chk_2","(`a` not in (4,5))"],["p_chk_3","(`a` not between 7 and 8)"],["p_chk_4","(`s` is not null)"],["p_chk_5","((`b` is null) or (`b` >= -(1.50)))"],["p_chk_6","(upper(`s`) <> _utf8mb4\\'X\\\\\\'Y\\')"],["p_chk_7","((char_length(`s`) < 9) xor (`a` = 1))"],["p_chk_8","((`a` <> 3) and (`a` <=> 3))"],["p_chk_9","((case when (`a` > 1) then 1 else 0 end) = 1)"],["p_chk_10","((-(`a`) < 10) and ((`a` % 2) = 0) and ((`a` DIV 2) > 0))"],["p_chk_11","(coalesce(`a`,0) >= 0)"],["p_chk_12","(`s` like _utf8mb4\\'a\\\\\\\\_b\\' escape _utf8mb4\\'|\\')"],["p_chk_13","json_valid(`j`)"],["p_chk_14","(0 = `a`)"],["p_chk_15","true"],["p_chk_16","(`a` > 1e2)"],["p_chk_17","(`b` <> 0.5)"]]],
  ["DROP TABLE p", [0,0,"",0]],
  ["CREATE TABLE IF NOT EXISTS c (a INT, CHECK (zz > 0))", [3820,"Check constraint 'c_chk_1' refers to non-existing column 'zz'."]],
  ["CREATE TABLE ac (a INT, b INT, CHECK (a > 0), CHECK (b > 0))", [0,0,"",0]],
  ["INSERT INTO ac VALUES (5, 5), (50, 1)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ADD CHECK (a < 100)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ADD CONSTRAINT lim CHECK (a < 10)", [3819,"Check constraint 'lim' is violated."]],
  ["ALTER TABLE ac ADD CONSTRAINT lim CHECK (a < 100)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ADD CHECK (a < 9), ADD CHECK (b < 9)", [3819,"Check constraint 'ac_chk_4' is violated."]],
  ["SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema = 'app' AND constraint_name LIKE 'ac%' OR constraint_name = 'lim' ORDER BY 1", [["ac_chk_1","(`a` > 0)"],["ac_chk_2","(`b` > 0)"],["ac_chk_3","(`a` < 100)"],["lim","(`a` < 100)"]]],
  ["ALTER TABLE ac DROP CHECK ac_chk_2", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac DROP CHECK nope", [3821,"Check constraint 'nope' is not found in the table."]],
  ["ALTER TABLE ac DROP CONSTRAINT lim", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac DROP CONSTRAINT nope", [3940,"Constraint 'nope' does not exist."]],
  ["ALTER TABLE ac ALTER CHECK ac_chk_1 NOT ENFORCED", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO ac VALUES (-1, 1)", [1,0,"",0]],
  ["ALTER TABLE ac ALTER CHECK ac_chk_1 ENFORCED", [3819,"Check constraint 'ac_chk_1' is violated."]],
  ["DELETE FROM ac WHERE a = -1", [1,0,"",0]],
  ["ALTER TABLE ac ALTER CHECK ac_chk_1 ENFORCED", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ALTER CONSTRAINT ac_chk_3 NOT ENFORCED", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ALTER CHECK nope ENFORCED", [3821,"Check constraint 'nope' is not found in the table."]],
  ["SELECT constraint_name, enforced FROM information_schema.table_constraints WHERE table_schema = 'app' AND table_name = 'ac' ORDER BY 1", [["ac_chk_1","YES"],["ac_chk_3","NO"]]],
  ["ALTER TABLE ac ADD COLUMN z INT CHECK (z > 0)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ADD COLUMN y INT NOT NULL CHECK (y > 0)", [3819,"Check constraint 'ac_chk_5' is violated."]],
  ["SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema = 'app' AND constraint_name LIKE 'ac%' ORDER BY 1", [["ac_chk_1","(`a` > 0)"],["ac_chk_3","(`a` < 100)"],["ac_chk_4","(`z` > 0)"]]],
  ["CREATE TABLE par (id INT PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE c1 (p INT CHECK (p > 0), FOREIGN KEY (p) REFERENCES par(id) ON UPDATE CASCADE)", [3823,"Column 'p' cannot be used in a check constraint 'c1_chk_1': needed in a foreign key constraint 'c1_ibfk_1' referential action."]],
  ["CREATE TABLE c2 (p INT, CHECK (p > 0), FOREIGN KEY (p) REFERENCES par(id) ON DELETE SET NULL)", [3823,"Column 'p' cannot be used in a check constraint 'c2_chk_1': needed in a foreign key constraint 'c2_ibfk_1' referential action."]],
  ["CREATE TABLE c3 (p INT, CHECK (p > 0), FOREIGN KEY (p) REFERENCES par(id) ON DELETE CASCADE)", [0,0,"",0]],
  ["CREATE TABLE c4 (p INT, CHECK (p > 0), FOREIGN KEY (p) REFERENCES par(id) ON UPDATE RESTRICT ON DELETE NO ACTION)", [0,0,"",0]],
  ["CREATE TABLE c5 (p INT, q INT, CONSTRAINT k CHECK (q > p), FOREIGN KEY (p) REFERENCES par(id) ON UPDATE SET NULL)", [3823,"Column 'p' cannot be used in a check constraint 'k': needed in a foreign key constraint 'c5_ibfk_1' referential action."]],
  ["CREATE TABLE c6 (a INT CHECK (b > 0), b INT)", [3813,"Column check constraint 'c6_chk_1' references other column."]],
  ["CREATE TABLE c7 (a INT CONSTRAINT nm CHECK (a > b), b INT)", [3813,"Column check constraint 'nm' references other column."]],
  ["CREATE TABLE c8 (a INT CHECK (a > 0 AND c8.a < 9))", [0,0,"",0]],
  ["CREATE TABLE c9 (p INT)", [0,0,"",0]],
  ["ALTER TABLE c9 ADD CONSTRAINT cc CHECK (p > 0), ADD FOREIGN KEY (p) REFERENCES par(id) ON DELETE CASCADE", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE c9 ADD FOREIGN KEY (p) REFERENCES par(id) ON DELETE SET NULL", [3823,"Column 'p' cannot be used in a check constraint 'cc': needed in a foreign key constraint 'c9_ibfk_2' referential action."]],
  ["ALTER TABLE c9 ADD CONSTRAINT cc2 CHECK (p > 0)", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE c10 (a INT, b INT, CHECK (STRCMP(a, '1')), CHECK (1 MEMBER OF ('[1, 2]')), CHECK (JSON_CONTAINS('[1]', '1')), CHECK (JSON_OVERLAPS('[1]', '1')), CHECK (a IS TRUE), CHECK (NOT a))", [0,0,"",0]],
  ["INSERT INTO c10 VALUES (2, 0)", [3819,"Check constraint 'c10_chk_6' is violated."]],
  ["INSERT INTO c10 VALUES (1, 0)", [3819,"Check constraint 'c10_chk_1' is violated."]],
  ["SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema = 'app' AND constraint_name REGEXP '^(c[0-9]|cc)' ORDER BY 1", [["c10_chk_1","strcmp(`a`,_utf8mb4\\'1\\')"],["c10_chk_2","1 member of (_utf8mb4\\'[1, 2]\\')"],["c10_chk_3","json_contains(_utf8mb4\\'[1]\\',_utf8mb4\\'1\\')"],["c10_chk_4","json_overlaps(_utf8mb4\\'[1]\\',_utf8mb4\\'1\\')"],["c10_chk_5","((0 <> `a`) is true)"],["c10_chk_6","(0 = `a`)"],["c3_chk_1","(`p` > 0)"],["c4_chk_1","(`p` > 0)"],["c8_chk_1","((`a` > 0) and (`a` < 9))"],["cc","(`p` > 0)"],["cc2","(`p` > 0)"]]],
  ["DROP TABLE c3, c4, c8, c9, c10, par", [0,0,"",0]],
]

test('M5.9: CHECK constraints answer every statement of the script as 8.4.11 did', async () => {
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
