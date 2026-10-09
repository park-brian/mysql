// Multi-table UPDATE and DELETE, as 8.4.11 ran each of these statements.
//
// What it pins: the joined rows the WHERE keeps are read first, each with
// its tables' row ids. An UPDATE then changes each target row once, from the
// first joined row that reaches it (the hash join's order), every SET item
// reading the row as read, an earlier item of the same table not seen by a
// later one, unlike the single-table form; "Rows matched" counts target rows of every table, a
// self-join's included. ORDER BY and LIMIT are 1221, an ambiguous column
// 1052, a derived target 1288, a subquery reading any joined table 1093
// naming the first. A DELETE removes each target's rows once, in the order
// named; an unknown target is 1109, and ORDER BY after its WHERE a 1064.
// IGNORE, strict conversions and foreign keys behave as in the single-table
// forms. Not pinned (named in the roadmap): the count of a DELETE of a parent
// and its children whose rows the parent's cascade already took.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE a (id INT PRIMARY KEY, x INT, y INT)", [0,0,"",0]],
  ["CREATE TABLE b (id INT PRIMARY KEY, aid INT, z INT)", [0,0,"",0]],
  ["INSERT INTO a VALUES (1, 10, 0), (2, 20, 0), (3, 30, 0)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO b VALUES (1, 1, 100), (2, 1, 200), (3, 2, 300), (4, 9, 400)", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE a JOIN b ON b.aid = a.id SET a.y = b.z", [2,0,"Rows matched: 2  Changed: 2  Warnings: 0",0]],
  ["SELECT * FROM a ORDER BY id", [["1","10","100"],["2","20","300"],["3","30","0"]]],
  ["UPDATE a JOIN b ON b.aid = a.id SET a.y = a.y + 1, b.z = b.z + a.x", [5,0,"Rows matched: 5  Changed: 5  Warnings: 0",0]],
  ["SELECT * FROM a ORDER BY id", [["1","10","101"],["2","20","301"],["3","30","0"]]],
  ["SELECT * FROM b ORDER BY id", [["1","1","110"],["2","1","210"],["3","2","320"],["4","9","400"]]],
  ["UPDATE a, b SET a.x = 0 WHERE a.id = b.aid AND b.z > 250", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM a ORDER BY id", [["1","10","101"],["2","0","301"],["3","30","0"]]],
  ["UPDATE a LEFT JOIN b ON b.aid = a.id SET a.y = IFNULL(b.z, -1) WHERE b.id IS NULL", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM a ORDER BY id", [["1","10","101"],["2","0","301"],["3","30","-1"]]],
  ["UPDATE a JOIN b ON b.aid = a.id SET a.y = 1 ORDER BY a.id", [1221,"Incorrect usage of UPDATE and ORDER BY"]],
  ["UPDATE a JOIN b ON b.aid = a.id SET a.y = 1 LIMIT 1", [1221,"Incorrect usage of UPDATE and LIMIT"]],
  ["UPDATE a JOIN b ON b.aid = a.id SET y = 5", [2,0,"Rows matched: 2  Changed: 2  Warnings: 0",0]],
  ["UPDATE a JOIN b ON b.aid = a.id SET id = 5", [1052,"Column 'id' in field list is ambiguous"]],
  ["UPDATE a JOIN b ON b.aid = a.id SET a.id = a.id + 10 WHERE b.id = 3", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM a ORDER BY id", [["1","10","5"],["3","30","-1"],["12","0","5"]]],
  ["UPDATE a AS t JOIN b ON b.aid = t.id SET t.y = 7", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["UPDATE a JOIN (SELECT 1 AS k) d ON d.k = a.id SET a.y = 8", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM a ORDER BY id", [["1","10","8"],["3","30","-1"],["12","0","5"]]],
  ["UPDATE a JOIN (SELECT 1 AS k) d ON d.k = a.id SET d.k = 2", [1288,"The target table d of the UPDATE is not updatable"]],
  ["DELETE a, b FROM a JOIN b ON b.aid = a.id WHERE a.id = 1", [3,0,"",0]],
  ["SELECT * FROM a ORDER BY id", [["3","30","-1"],["12","0","5"]]],
  ["SELECT * FROM b ORDER BY id", [["3","2","320"],["4","9","400"]]],
  ["DELETE FROM b USING b LEFT JOIN a ON a.id = b.aid WHERE a.id IS NULL", [2,0,"",0]],
  ["SELECT * FROM b ORDER BY id", []],
  ["DELETE b FROM a JOIN b ON b.aid = a.id", [0,0,"",0]],
  ["DELETE c FROM a JOIN b ON b.aid = a.id", [1109,"Unknown table 'c' in MULTI DELETE"]],
  ["DELETE a FROM a JOIN b ON b.aid = a.id ORDER BY a.id", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'ORDER BY a.id' at line 1"]],
  ["INSERT INTO b VALUES (5, 3, 1), (6, 3, 2)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["DELETE a FROM a JOIN b ON b.aid = a.id", [1,0,"",0]],
  ["SELECT * FROM a ORDER BY id", [["12","0","5"]]],
  ["UPDATE IGNORE a JOIN b ON TRUE SET a.id = 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["CREATE TABLE p (id INT PRIMARY KEY, n INT)", [0,0,"",0]],
  ["CREATE TABLE c (id INT PRIMARY KEY, pid INT, v INT, FOREIGN KEY (pid) REFERENCES p (id) ON DELETE CASCADE)", [0,0,"",0]],
  ["INSERT INTO p VALUES (1, 0), (2, 0), (3, 0)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO c VALUES (1, 1, 5), (2, 1, 6), (3, 2, 7)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE p JOIN c ON c.pid = p.id SET p.n = p.n + c.v", [2,0,"Rows matched: 2  Changed: 2  Warnings: 0",0]],
  ["SELECT * FROM p ORDER BY id", [["1","5"],["2","7"],["3","0"]]],
  ["UPDATE p p1 JOIN p p2 ON p2.id = p1.id + 1 SET p1.n = p2.n", [2,0,"Rows matched: 2  Changed: 2  Warnings: 0",0]],
  ["SELECT * FROM p ORDER BY id", [["1","7"],["2","0"],["3","0"]]],
  ["UPDATE p, c SET p.n = 1", [3,0,"Rows matched: 3  Changed: 3  Warnings: 0",0]],
  ["SELECT * FROM p ORDER BY id", [["1","1"],["2","1"],["3","1"]]],
  ["UPDATE p JOIN c ON c.pid = p.id SET p.n = (SELECT COUNT(*) FROM p)", [1093,"You can't specify target table 'p' for update in FROM clause"]],
  ["UPDATE p JOIN c ON c.pid = p.id SET c.v = (SELECT COUNT(*) FROM c)", [1093,"You can't specify target table 'p' for update in FROM clause"]],
  ["UPDATE p JOIN c ON c.pid = p.id SET c.pid = 99", [1452,"Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `c_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE)"]],
  ["UPDATE IGNORE p JOIN c ON c.pid = p.id SET c.pid = 99", [3,0,"Rows matched: 3  Changed: 0  Warnings: 3",3]],
  ["SHOW WARNINGS", [["Warning","1452","Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `c_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE)"],["Warning","1452","Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `c_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE)"],["Warning","1452","Cannot add or update a child row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `c_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `p` (`id`) ON DELETE CASCADE)"]]],
  ["UPDATE p JOIN c ON c.pid = p.id SET p.n = 'abc'", [1366,"Incorrect integer value: 'abc' for column 'n' at row 1"]],
  ["UPDATE p JOIN c ON c.pid = p.id SET p.n = NULL WHERE c.v = 7", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM p ORDER BY id", [["1","1"],["2",null],["3","1"]]],
  ["SELECT * FROM p ORDER BY id", [["1","1"],["2",null],["3","1"]]],
  ["SELECT * FROM c ORDER BY id", [["1","1","5"],["2","1","6"],["3","2","7"]]],
  ["DELETE p FROM p JOIN c ON c.pid = p.id", [2,0,"",0]],
  ["SELECT * FROM c ORDER BY id", []],
  ["DELETE p1 FROM p AS p1 JOIN p AS p2 ON p2.id = p1.id", [1,0,"",0]],
  ["SELECT COUNT(*) FROM p", [["0"]]],
  ["UPDATE nope JOIN p ON TRUE SET p.n = 1", [1146,"Table 'app.nope' doesn't exist"]],
  ["UPDATE p JOIN c ON nope.id = 1 SET p.n = 1", [1054,"Unknown column 'nope.id' in 'on clause'"]],
  ["DELETE FROM c, p USING c JOIN p", [0,0,"",0]],
  ["CREATE TABLE q (id INT PRIMARY KEY, x INT, y INT)", [0,0,"",0]],
  ["CREATE TABLE r (id INT PRIMARY KEY, qid INT)", [0,0,"",0]],
  ["INSERT INTO q VALUES (1, 5, 0)", [1,0,"",0]],
  ["INSERT INTO r VALUES (1, 1)", [1,0,"",0]],
  ["UPDATE q JOIN r ON r.qid = q.id SET q.x = q.x + 1, q.y = q.x * 10", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["SELECT * FROM q", [["1","6","50"]]],
]

test('multi-table UPDATE and DELETE change and count rows as 8.4.11 does', async () => {
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
