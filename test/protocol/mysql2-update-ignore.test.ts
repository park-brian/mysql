// UPDATE IGNORE, as 8.4.11 ran each of these statements.
//
// What it pins: a strict mode's conversion errors become warnings (1264,
// 1366, 1048 with the type's zero, 1365), and a row that would duplicate a
// key (1062), fail a CHECK (3819), lose a child (1451) or name a missing
// parent (1452) is skipped with that error as a warning — counted as
// matched, not changed. Rows are updated one at a time in the statement's
// order, so `SET id = id + 1` collides ascending and not descending. A row
// whose cascade fails further down is skipped whole: its cascaded changes
// are undone with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT PRIMARY KEY, u INT UNIQUE, v TINYINT NOT NULL)", [0,0,"",0]],
  ["INSERT INTO t VALUES (1,1,1),(2,2,2),(3,3,3)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE t SET u = 2 WHERE id = 1", [1062,"Duplicate entry '2' for key 't.u'"]],
  ["UPDATE IGNORE t SET u = 2 WHERE id = 1", [1,0,"Rows matched: 1  Changed: 0  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1062","Duplicate entry '2' for key 't.u'"]]],
  ["UPDATE IGNORE t SET u = u + 1", [3,0,"Rows matched: 3  Changed: 1  Warnings: 2",2]],
  ["SHOW WARNINGS", [["Warning","1062","Duplicate entry '2' for key 't.u'"],["Warning","1062","Duplicate entry '3' for key 't.u'"]]],
  ["SELECT * FROM t ORDER BY id", [["1","1","1"],["2","2","2"],["3","4","3"]]],
  ["UPDATE t SET v = 1000", [1264,"Out of range value for column 'v' at row 1"]],
  ["UPDATE IGNORE t SET v = 1000", [3,0,"Rows matched: 3  Changed: 3  Warnings: 3",3]],
  ["SHOW WARNINGS", [["Warning","1264","Out of range value for column 'v' at row 1"],["Warning","1264","Out of range value for column 'v' at row 2"],["Warning","1264","Out of range value for column 'v' at row 3"]]],
  ["UPDATE IGNORE t SET v = NULL WHERE id = 2", [1,0,"Rows matched: 1  Changed: 1  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1048","Column 'v' cannot be null"]]],
  ["UPDATE IGNORE t SET v = 1 / 0 WHERE id = 3", [1,0,"Rows matched: 1  Changed: 1  Warnings: 2",2]],
  ["SHOW WARNINGS", [["Warning","1365","Division by 0"],["Warning","1048","Column 'v' cannot be null"]]],
  ["SELECT * FROM t ORDER BY id", [["1","1","127"],["2","2","0"],["3","4","0"]]],
  ["UPDATE IGNORE t SET id = 1 WHERE id = 3", [1,0,"Rows matched: 1  Changed: 0  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1062","Duplicate entry '1' for key 't.PRIMARY'"]]],
  ["UPDATE IGNORE t SET id = id + 1 ORDER BY id DESC", [3,0,"Rows matched: 3  Changed: 3  Warnings: 0",0]],
  ["SELECT * FROM t ORDER BY id", [["2","1","127"],["3","2","0"],["4","4","0"]]],
  ["UPDATE IGNORE t SET id = id + 1 ORDER BY id", [3,0,"Rows matched: 3  Changed: 1  Warnings: 2",2]],
  ["SHOW WARNINGS", [["Warning","1062","Duplicate entry '3' for key 't.PRIMARY'"],["Warning","1062","Duplicate entry '4' for key 't.PRIMARY'"]]],
  ["SELECT * FROM t ORDER BY id", [["2","1","127"],["3","2","0"],["5","4","0"]]],
  ["CREATE TABLE p (id INT PRIMARY KEY, c INT CHECK (c < 10))", [0,0,"",0]],
  ["CREATE TABLE ch (id INT PRIMARY KEY, pid INT, FOREIGN KEY (pid) REFERENCES p(id))", [0,0,"",0]],
  ["INSERT INTO p VALUES (1,1),(2,2),(3,3)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO ch VALUES (1,1)", [1,0,"",0]],
  ["UPDATE IGNORE p SET c = c + 8", [3,0,"Rows matched: 3  Changed: 1  Warnings: 2",2]],
  ["SHOW WARNINGS", [["Warning","3819","Check constraint 'p_chk_1' is violated."],["Warning","3819","Check constraint 'p_chk_1' is violated."]]],
  ["SELECT * FROM p ORDER BY id", [["1","9"],["2","2"],["3","3"]]],
  ["UPDATE IGNORE p SET id = id + 10", [3,0,"Rows matched: 3  Changed: 2  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1451","Cannot delete or update a parent row: a foreign key constraint fails (`app`.`ch`, CONSTRAINT `ch_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`))"]]],
  ["SELECT * FROM p ORDER BY id", [["1","9"],["12","2"],["13","3"]]],
  ["UPDATE IGNORE ch SET pid = 99", [1,0,"Rows matched: 1  Changed: 0  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1452","Cannot add or update a child row: a foreign key constraint fails (`app`.`ch`, CONSTRAINT `ch_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`))"]]],
  ["UPDATE IGNORE p SET id = 'abc' WHERE id = 1", [1,0,"Rows matched: 1  Changed: 0  Warnings: 2",2]],
  ["SHOW WARNINGS", [["Warning","1366","Incorrect integer value: 'abc' for column 'id' at row 1"],["Warning","1451","Cannot delete or update a parent row: a foreign key constraint fails (`app`.`ch`, CONSTRAINT `ch_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`))"]]],
  ["UPDATE IGNORE p SET c = 'x1' WHERE id = 12", [1,0,"Rows matched: 1  Changed: 1  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1366","Incorrect integer value: 'x1' for column 'c' at row 1"]]],
  ["SELECT * FROM p ORDER BY id", [["1","9"],["12","0"],["13","3"]]],
  ["CREATE TABLE pc (id INT PRIMARY KEY)", [0,0,"",0]],
  ["CREATE TABLE cc (id INT PRIMARY KEY, pid INT UNIQUE, FOREIGN KEY (pid) REFERENCES pc(id) ON UPDATE CASCADE)", [0,0,"",0]],
  ["CREATE TABLE gc (id INT PRIMARY KEY, cpid INT, FOREIGN KEY (cpid) REFERENCES cc(pid))", [0,0,"",0]],
  ["INSERT INTO pc VALUES (1),(2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO cc VALUES (1,1),(2,2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO gc VALUES (1,1)", [1,0,"",0]],
  ["UPDATE IGNORE pc SET id = id + 5", [2,0,"Rows matched: 2  Changed: 1  Warnings: 1",1]],
  ["SHOW WARNINGS", [["Warning","1451","Cannot delete or update a parent row: a foreign key constraint fails (`app`.`gc`, CONSTRAINT `gc_ibfk_1` FOREIGN KEY (`cpid`) REFERENCES `cc` (`pid`))"]]],
  ["SELECT * FROM pc ORDER BY id", [["1"],["7"]]],
  ["SELECT * FROM cc ORDER BY id", [["1","1"],["2","7"]]],
]

test('UPDATE IGNORE turns errors into warnings and skips the rows they stop, as 8.4.11 does', async () => {
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
