// M5.4 — joins, through `mysql2`, against answers a real 8.4.11 gave to the
// same script (asked first, through the same driver, and written down here).
//
// Row order is the point of most of these, and every one has no ORDER BY:
// STRAIGHT_JOIN fixes the join order, so the order is the algorithm's. A hash
// join probes with the later table and lists each probe row's matches newest
// first (`STRAIGHT_JOIN c JOIN a` puts `c3` before `c1`); a LEFT JOIN probes
// with its outer side; a CROSS JOIN is a hash join with no condition. Then
// The tables are analysed first, as M5.18's corpus does, so the server's plans
// are the ones its statistics choose every time. Then USING and NATURAL: the merged column first, the preserved side's under a
// RIGHT JOIN, and a bare name that means it. And the refusals: 1052, 1054 in
// the FROM and in an ON that cannot see a table, 1066.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly (string | number)[] | readonly (readonly (string | null)[])[]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
    ["CREATE TABLE a (id INT NOT NULL PRIMARY KEY, x INT NOT NULL, s VARCHAR(5))", [0, 0, "", 0]],
    ["CREATE TABLE b (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, x INT, t VARCHAR(5) NOT NULL, KEY (x))", [0, 0, "", 0]],
    ["CREATE TABLE c (y INT, u VARCHAR(5))", [0, 0, "", 0]],
    ["INSERT INTO a VALUES (1, 10, 'p'), (2, 20, 'q'), (3, 30, NULL)", [3, 0, "Records: 3  Duplicates: 0  Warnings: 0", 0]],
    ["INSERT INTO b (x, t) VALUES (10, 'B1'), (NULL, 'B2'), (30, 'B3'), (10, 'B4')", [4, 1, "Records: 4  Duplicates: 0  Warnings: 0", 0]],
    ["INSERT INTO c VALUES (10, 'c1'), (20, 'c2'), (10, 'c3'), (NULL, 'c4')", [4, 0, "Records: 4  Duplicates: 0  Warnings: 0", 0]],
    ["ANALYZE TABLE a, b, c", [["app.a", "analyze", "status", "OK"], ["app.b", "analyze", "status", "OK"], ["app.c", "analyze", "status", "OK"]]],
    ["SELECT STRAIGHT_JOIN * FROM a JOIN c ON a.x = c.y", [["1", "10", "p", "10", "c1"], ["2", "20", "q", "20", "c2"], ["1", "10", "p", "10", "c3"]]],
    ["SELECT STRAIGHT_JOIN * FROM c JOIN a ON a.x = c.y", [["10", "c3", "1", "10", "p"], ["10", "c1", "1", "10", "p"], ["20", "c2", "2", "20", "q"]]],
    ["SELECT * FROM a CROSS JOIN c ORDER BY a.id, c.u", [["1", "10", "p", "10", "c1"], ["1", "10", "p", "20", "c2"], ["1", "10", "p", "10", "c3"], ["1", "10", "p", null, "c4"], ["2", "20", "q", "10", "c1"], ["2", "20", "q", "20", "c2"], ["2", "20", "q", "10", "c3"], ["2", "20", "q", null, "c4"], ["3", "30", null, "10", "c1"], ["3", "30", null, "20", "c2"], ["3", "30", null, "10", "c3"], ["3", "30", null, null, "c4"]]],
    ["SELECT STRAIGHT_JOIN * FROM a CROSS JOIN c", [["3", "30", null, "10", "c1"], ["2", "20", "q", "10", "c1"], ["1", "10", "p", "10", "c1"], ["3", "30", null, "20", "c2"], ["2", "20", "q", "20", "c2"], ["1", "10", "p", "20", "c2"], ["3", "30", null, "10", "c3"], ["2", "20", "q", "10", "c3"], ["1", "10", "p", "10", "c3"], ["3", "30", null, null, "c4"], ["2", "20", "q", null, "c4"], ["1", "10", "p", null, "c4"]]],
    ["SELECT * FROM c LEFT JOIN a ON a.x = c.y", [["10", "c1", "1", "10", "p"], ["20", "c2", "2", "20", "q"], ["10", "c3", "1", "10", "p"], [null, "c4", null, null, null]]],
    ["SELECT * FROM c LEFT JOIN b ON b.x = c.y", [["10", "c1", "4", "10", "B4"], ["10", "c1", "1", "10", "B1"], ["20", "c2", null, null, null], ["10", "c3", "4", "10", "B4"], ["10", "c3", "1", "10", "B1"], [null, "c4", null, null, null]]],
    ["SELECT * FROM a LEFT JOIN c ON a.x < c.y", [["1", "10", "p", "20", "c2"], ["2", "20", "q", null, null], ["3", "30", null, null, null]]],
    ["SELECT * FROM a RIGHT JOIN b ON a.x = b.x", [["1", "10", "p", "1", "10", "B1"], [null, null, null, "2", null, "B2"], ["3", "30", null, "3", "30", "B3"], ["1", "10", "p", "4", "10", "B4"]]],
    ["SELECT * FROM a JOIN b USING (x) ORDER BY b.id", [["10", "1", "p", "1", "B1"], ["30", "3", null, "3", "B3"], ["10", "1", "p", "4", "B4"]]],
    ["SELECT * FROM a LEFT JOIN b USING (x) ORDER BY a.id, b.id", [["10", "1", "p", "1", "B1"], ["10", "1", "p", "4", "B4"], ["20", "2", "q", null, null], ["30", "3", null, "3", "B3"]]],
    ["SELECT * FROM a RIGHT JOIN b USING (x) ORDER BY b.id", [["10", "1", "B1", "1", "p"], [null, "2", "B2", null, null], ["30", "3", "B3", "3", null], ["10", "4", "B4", "1", "p"]]],
    ["SELECT * FROM a NATURAL JOIN b", [["1", "10", "p", "B1"], ["3", "30", null, "B3"]]],
    ["SELECT * FROM b NATURAL RIGHT JOIN a ORDER BY a.id", [["1", "10", "p", "B1"], ["2", "20", "q", null], ["3", "30", null, "B3"]]],
    ["SELECT x, a.x, b.x FROM a RIGHT JOIN b USING (x) ORDER BY b.id", [["10", "10", "10"], [null, null, null], ["30", "30", "30"], ["10", "10", "10"]]],
    ["SELECT STRAIGHT_JOIN * FROM c JOIN b ON b.x = c.y JOIN a ON a.id = b.id", [["10", "c3", "1", "10", "B1", "1", "10", "p"], ["10", "c1", "1", "10", "B1", "1", "10", "p"]]],
    ["SELECT * FROM a LEFT JOIN (b JOIN c ON b.x = c.y) ON a.x = b.x ORDER BY a.id, b.id, c.u", [["1", "10", "p", "1", "10", "B1", "10", "c1"], ["1", "10", "p", "1", "10", "B1", "10", "c3"], ["1", "10", "p", "4", "10", "B4", "10", "c1"], ["1", "10", "p", "4", "10", "B4", "10", "c3"], ["2", "20", "q", null, null, null, null, null], ["3", "30", null, null, null, null, null, null]]],
    ["SELECT a.id, COUNT(b.id), GROUP_CONCAT(b.t ORDER BY b.t) FROM a LEFT JOIN b ON a.x = b.x GROUP BY a.id ORDER BY a.id", [["1", "2", "B1,B4"], ["2", "0", null], ["3", "1", "B3"]]],
    ["SELECT c.u FROM c LEFT JOIN b ON b.x = c.y WHERE b.id IS NULL ORDER BY c.u", [["c2"], ["c4"]]],
    ["SELECT DISTINCT a.x FROM a JOIN b ON a.x = b.x ORDER BY 1", [["10"], ["30"]]],
    ["SELECT id FROM a JOIN b USING (x)", 1052],
    ["SELECT x FROM a JOIN b ON a.x = b.x", 1052],
    ["SELECT * FROM a JOIN b USING (nope)", 1054],
    ["SELECT * FROM a JOIN a", 1066],
    ["SELECT * FROM a JOIN b ON c.y = 1", 1054],
    ["SELECT * FROM a, b JOIN a AS d ON a.x = d.x", 1054],
    ["SELECT a.s, b.t FROM a, b WHERE a.x = b.x AND b.t > 'B2' ORDER BY 1, 2", [[null, "B3"], ["p", "B4"]]],
    ["ANALYZE TABLE a, nope", [["app.a", "analyze", "status", "OK"], ["app.nope", "analyze", "Error", "Table 'app.nope' doesn't exist"], ["app.nope", "analyze", "status", "Operation failed"]]],
]

test('M5.4: a script of joins returns what 8.4.11 returned, statement by statement', async () => {
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
