// ALTER TABLE and column defaults, as 8.4.11 answered each of these
// statements: what a review of the ALTER-by-copy path found.
//
// An index dropped in the same statement that adds its replacement is not
// "needed in a foreign key" (1553 is decided after the adds). A NOT NULL
// column added to rows that exist takes its type's implicit default: an
// ENUM's first member, an empty BLOB, TEXT or SET, a zero temporal (8.4
// adds such a column in place, so strict mode never sees the zero date),
// and for JSON a value that reads back as NULL. A default may name another
// column of the row, `DEFAULT (x + 1)`. And a literal default that does not
// fit its column is 1067, except a DECIMAL's extra digits, which round with
// a note. Along the way: an ENUM or SET column in a numeric context is its
// member index or bitmap, and a NOT NULL ENUM left out is its first member,
// with no warning.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE ap (id INT PRIMARY KEY, u INT, UNIQUE KEY uu (u))", [0,0,"",0]],
  ["CREATE TABLE ac (id INT PRIMARY KEY, pu INT, CONSTRAINT f1 FOREIGN KEY (pu) REFERENCES ap(u))", [0,0,"",0]],
  ["ALTER TABLE ap ADD UNIQUE KEY uu2 (u), DROP INDEX uu", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac ADD INDEX ix (pu, id), DROP INDEX f1", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE ac DROP INDEX ix", [1553,"Cannot drop index 'ix': needed in a foreign key constraint"]],
  ["SELECT index_name, column_name FROM information_schema.statistics WHERE table_schema = 'app' ORDER BY table_name, index_name, seq_in_index", [["ix","pu"],["ix","id"],["PRIMARY","id"],["PRIMARY","id"],["uu2","u"]]],
  ["CREATE TABLE b (id INT PRIMARY KEY)", [0,0,"",0]],
  ["INSERT INTO b VALUES (1)", [1,0,"",0]],
  ["ALTER TABLE b ADD COLUMN e ENUM('x','y') NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN j JSON NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN bl BLOB NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN tx TEXT NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN st SET('a','b') NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN y YEAR NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN tm TIME NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, e, e + 0, j, HEX(bl), tx, st, y, tm FROM b", [["1","x","1",null,"","","","0","00:00:00"]]],
  ["ALTER TABLE b ADD COLUMN d DATETIME NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN dd DATE NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["ALTER TABLE b ADD COLUMN ts TIMESTAMP NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, ts FROM b", [["1","0000-00-00 00:00:00"]]],
  ["CREATE TABLE be (id INT PRIMARY KEY)", [0,0,"",0]],
  ["ALTER TABLE be ADD COLUMN d DATETIME NOT NULL", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["CREATE TABLE ie (id INT PRIMARY KEY, e ENUM('x','y') NOT NULL, bl BLOB NOT NULL, j JSON NOT NULL)", [0,0,"",0]],
  ["INSERT IGNORE INTO ie (id) VALUES (1)", [1,0,"",2]],
  ["SELECT id, e, HEX(bl), j FROM ie", [["1","x","",null]]],
  ["CREATE TABLE n (id INT PRIMARY KEY, x INT)", [0,0,"",0]],
  ["INSERT INTO n VALUES (1, 5)", [1,0,"",0]],
  ["ALTER TABLE n ADD COLUMN c INT DEFAULT (x + 1)", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["SELECT * FROM n", [["1","5","6"]]],
  ["CREATE TABLE n2 (id INT PRIMARY KEY, x INT, c INT DEFAULT (x + 1))", [0,0,"",0]],
  ["INSERT INTO n2 (id, x) VALUES (1, 5)", [1,0,"",0]],
  ["INSERT INTO n2 (id) VALUES (2)", [1,0,"",0]],
  ["INSERT INTO n2 VALUES (3, 7, DEFAULT)", [1,0,"",0]],
  ["SELECT * FROM n2", [["1","5","6"],["2",null,null],["3","7","8"]]],
  ["CREATE TABLE f (id INT PRIMARY KEY)", [0,0,"",0]],
  ["ALTER TABLE f ADD COLUMN z TINYINT DEFAULT 1000", [1067,"Invalid default value for 'z'"]],
  ["ALTER TABLE f ADD COLUMN v VARCHAR(5) DEFAULT 'toolongvalue'", [1067,"Invalid default value for 'v'"]],
  ["CREATE TABLE f2 (v VARCHAR(5) DEFAULT 'toolongvalue')", [1067,"Invalid default value for 'v'"]],
  ["CREATE TABLE f3 (z TINYINT DEFAULT 1000)", [1067,"Invalid default value for 'z'"]],
  ["CREATE TABLE f4 (z TINYINT UNSIGNED DEFAULT -1)", [1067,"Invalid default value for 'z'"]],
  ["CREATE TABLE f5 (d DATE DEFAULT '2020-13-01')", [1067,"Invalid default value for 'd'"]],
  ["CREATE TABLE f6 (z DECIMAL(3,1) DEFAULT 12.34)", [0,0,"",1]],
  ["CREATE TABLE f7 (z INT DEFAULT 'abc')", [1067,"Invalid default value for 'z'"]],
  ["CREATE TABLE f8 (z INT DEFAULT '12')", [0,0,"",0]],
  ["CREATE TABLE f9 (e ENUM('a') DEFAULT 'b')", [1067,"Invalid default value for 'e'"]],
  ["SHOW CREATE TABLE f6", [["f6","CREATE TABLE `f6` (\n  `z` decimal(3,1) DEFAULT '12.3'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE en (id INT PRIMARY KEY, e ENUM('x','y') NOT NULL, s SET('a','b'), i INT)", [0,0,"",0]],
  ["INSERT INTO en (id, s) VALUES (1, 'a,b')", [1,0,"",0]],
  ["INSERT INTO en VALUES (2, 'y', 'b', NULL)", [1,0,"",0]],
  ["UPDATE en SET i = e + s", [2,0,"Rows matched: 2  Changed: 2  Warnings: 0",0]],
  ["SELECT id, e, e + 0, s + 0, e = 2, CAST(e AS UNSIGNED), IF(1, e, e) + 0, IFNULL(e, 0) + 0, SUM(e), i FROM en GROUP BY id ORDER BY id", [["1","x","1","3","0","1","1","0","1","4"],["2","y","2","2","1","2","2","0","2","4"]]],
  ["DROP TABLE en", [0,0,"",0]],
  ["DROP TABLE ac, ap, b, be, ie, n, n2, f, f6, f8", [0,0,"",0]],
]

test('ALTER TABLE and column defaults answer every statement of the script as 8.4.11 did', async () => {
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
