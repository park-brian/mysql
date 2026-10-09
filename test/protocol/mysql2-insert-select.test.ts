// M5.20 — `INSERT … SELECT`, through `mysql2`, against answers a real 8.4.11
// gave to the same script (asked first, through the same driver, and written
// down here).
//
// What they pin: the query's rows are read in full before the first is
// written, so a SELECT from the target table sees none of its own rows; a
// strict mode refuses a NULL for a NOT NULL column (1048), and a string too
// long is 1265 when the SELECT copies a table column and 1406 when it
// computes the value; IGNORE warns once per column for its NULLs; the info
// line is always there, and an upsert's "Duplicates" counts only the rows it
// changed; ON DUPLICATE KEY UPDATE reads the SELECT's columns, and a bare name
// both sides hold is 1052; and REPLACE … SELECT counts its deletions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly (string | number)[] | readonly (readonly (string | null)[])[]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
    ["CREATE TABLE src (id INT NOT NULL PRIMARY KEY, name VARCHAR(12) NOT NULL, n INT)", [0, 0, "", 0]],
    ["CREATE TABLE dst (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(5) NOT NULL, n INT NOT NULL, UNIQUE KEY (name))", [0, 0, "", 0]],
    ["INSERT INTO src VALUES (1, 'ann', 1), (2, 'bob', NULL), (3, 'cy', 3), (4, 'dee', NULL), (5, 'eve-longname', 5)", [5, 0, "Records: 5  Duplicates: 0  Warnings: 0", 0]],
    ["INSERT INTO dst (name, n) SELECT name, n FROM src WHERE n IS NOT NULL AND id < 5", [2, 1, "Records: 2  Duplicates: 0  Warnings: 0", 0]],
    ["INSERT INTO dst (name, n) SELECT name, n FROM src WHERE id = 2", 1048],
    ["INSERT INTO dst (name, n) SELECT name, n FROM src WHERE id = 5", 1265],
    ["INSERT INTO dst (name, n) SELECT name FROM src", 1136],
    ["INSERT INTO dst SELECT * FROM src WHERE id = 1", 1062],
    ["INSERT IGNORE INTO dst (name, n) SELECT name, n FROM src", [3, 4, "Records: 5  Duplicates: 2  Warnings: 4", 4]],
    ["SELECT * FROM dst ORDER BY id", [["1", "ann", "1"], ["2", "cy", "3"], ["4", "bob", "0"], ["5", "dee", "0"], ["6", "eve-l", "5"]]],
    ["INSERT INTO dst (name, n) SELECT name, 7 FROM src WHERE id <= 3 ON DUPLICATE KEY UPDATE n = VALUES(n)", [6, 0, "Records: 3  Duplicates: 3  Warnings: 1", 1]],
    ["INSERT INTO dst (name, n) SELECT name, 7 FROM src WHERE id <= 3 ON DUPLICATE KEY UPDATE n = VALUES(n)", [3, 0, "Records: 3  Duplicates: 0  Warnings: 1", 1]],
    ["INSERT INTO dst (name, n) SELECT CONCAT(name, '2'), id FROM src WHERE id <= 2 ON DUPLICATE KEY UPDATE n = n + 1", 1052],
    ["INSERT INTO dst (name, n) SELECT name, n FROM dst WHERE id = 1", 1062],
    ["INSERT INTO dst (name, n) SELECT CONCAT(name, 'x'), COUNT(*) FROM dst GROUP BY name ORDER BY name LIMIT 2", [2, 10, "Records: 2  Duplicates: 0  Warnings: 0", 0]],
    ["REPLACE INTO dst (name, n) SELECT name, 0 FROM src WHERE id = 1", [2, 13, "Records: 1  Duplicates: 1  Warnings: 0", 0]],
    ["SELECT * FROM dst ORDER BY id", [["2", "cy", "7"], ["4", "bob", "7"], ["5", "dee", "0"], ["6", "eve-l", "5"], ["10", "annx", "1"], ["11", "bobx", "1"], ["13", "ann", "0"]]],
    ["INSERT INTO dst (name, n) SELECT name, id FROM src WHERE id = 3 ON DUPLICATE KEY UPDATE n = src.id + 100", [2, 0, "Records: 1  Duplicates: 1  Warnings: 0", 0]],
    ["INSERT INTO dst (name, n) SELECT name, MAX(id) FROM src GROUP BY name ON DUPLICATE KEY UPDATE n = id", 1265],
    ["INSERT INTO dst (name, n) SELECT 'x' UNION ALL SELECT 'y'", 1136],
    ["INSERT INTO dst (name, n) SELECT 'x', 1 UNION ALL SELECT 'x', 2", 1062],
    ["INSERT INTO dst (name, n) SELECT CONCAT(name, '-long'), 1 FROM src WHERE id = 1", 1406],
    ["INSERT INTO dst (name, n) SELECT name, 1 FROM src WHERE id = 5", 1265],
    ["SELECT * FROM dst ORDER BY id", [["2", "cy", "103"], ["4", "bob", "7"], ["5", "dee", "0"], ["6", "eve-l", "5"], ["10", "annx", "1"], ["11", "bobx", "1"], ["13", "ann", "0"]]],
    ["SET sql_mode = ''", [0, 0, "", 0]],
    ["INSERT INTO dst (name, n) SELECT CONCAT(name, '3'), n FROM src", 1062],
    ["SELECT * FROM dst ORDER BY id", [["2", "cy", "103"], ["4", "bob", "7"], ["5", "dee", "0"], ["6", "eve-l", "5"], ["10", "annx", "1"], ["11", "bobx", "1"], ["13", "ann", "0"]]],
]

test('M5.20: a script of INSERT … SELECT returns what 8.4.11 returned, statement by statement', async () => {
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
        actual = (e as { errno: number }).errno
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
