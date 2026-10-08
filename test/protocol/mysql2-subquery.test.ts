// M5.1 and M5.19 — subqueries, derived tables, LATERAL, CTEs and set
// operations, through `mysql2`, against answers a real 8.4.11 gave to the same
// script (asked first, through the same driver, and written down here).
//
// What they pin: a scalar subquery is 1242 only when it is evaluated with two
// rows; `NOT IN` a subquery holding a NULL is never true; ALL over no rows is
// true and ANY false; a derived table needs distinct names (1060); a recursive
// CTE stops at `cte_max_recursion_depth` (3636); a set operation names its
// columns from its first branch, dedupes in first-appearance order, counts
// under ALL, and refuses a table-qualified ORDER BY (1250) and a different
// column count (1222); and an UPDATE or DELETE reading its own table in a
// subquery is 1093.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly (string | number)[] | readonly (readonly (string | null)[])[]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
    ["CREATE TABLE a (id INT NOT NULL PRIMARY KEY, x INT NOT NULL, s VARCHAR(5))", [0, 0, "", 0]],
    ["CREATE TABLE b (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, x INT, t VARCHAR(5) NOT NULL, KEY (x))", [0, 0, "", 0]],
    ["INSERT INTO a VALUES (1, 10, 'p'), (2, 20, 'q'), (3, 30, NULL)", [3, 0, "Records: 3  Duplicates: 0  Warnings: 0", 0]],
    ["INSERT INTO b (x, t) VALUES (10, 'B1'), (NULL, 'B2'), (30, 'B3'), (10, 'B4')", [4, 1, "Records: 4  Duplicates: 0  Warnings: 0", 0]],
    ["ANALYZE TABLE a, b", [["app.a", "analyze", "status", "OK"], ["app.b", "analyze", "status", "OK"]]],
    ["SELECT id, (SELECT COUNT(*) FROM b WHERE b.x = a.x) AS n FROM a ORDER BY id", [["1", "2"], ["2", "0"], ["3", "1"]]],
    ["SELECT id, (SELECT t FROM b WHERE b.x = a.x ORDER BY b.id DESC LIMIT 1) FROM a ORDER BY id", [["1", "B4"], ["2", null], ["3", "B3"]]],
    ["SELECT (SELECT x FROM b)", 1242],
    ["SELECT id FROM a WHERE x = (SELECT x FROM b WHERE id = 1) ORDER BY id", [["1"]]],
    ["SELECT id FROM a WHERE x = (SELECT x FROM b) ORDER BY id", 1242],
    ["SELECT id FROM a WHERE x IN (SELECT x FROM b) ORDER BY id", [["1"], ["3"]]],
    ["SELECT id FROM a WHERE x NOT IN (SELECT x FROM b) ORDER BY id", []],
    ["SELECT id FROM a WHERE x NOT IN (SELECT x FROM b WHERE x IS NOT NULL) ORDER BY id", [["2"]]],
    ["SELECT id, x IN (SELECT x FROM b), x NOT IN (SELECT x FROM b) FROM a ORDER BY id", [["1", "1", "0"], ["2", null, null], ["3", "1", "0"]]],
    ["SELECT id FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.x = a.x) ORDER BY id", [["1"], ["3"]]],
    ["SELECT id FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.x = a.x) ORDER BY id", [["2"]]],
    ["SELECT id, x > ALL (SELECT x FROM b WHERE x IS NOT NULL), x < ANY (SELECT x FROM b), x = SOME (SELECT x FROM b WHERE x > 100) FROM a ORDER BY id", [["1", "0", "1", "0"], ["2", "0", "1", "0"], ["3", "0", null, "0"]]],
    ["SELECT d.k, d.c FROM (SELECT x AS k, COUNT(*) AS c FROM b GROUP BY x) AS d ORDER BY d.k", [[null, "1"], ["10", "2"], ["30", "1"]]],
    ["SELECT * FROM (SELECT id, s FROM a) AS d (p, q) ORDER BY p", [["1", "p"], ["2", "q"], ["3", null]]],
    ["SELECT * FROM (SELECT 1 AS v, 2 AS v) AS d", 1060],
    ["SELECT * FROM (SELECT id FROM a) d1, (SELECT id FROM b) AS d2 WHERE d1.id = d2.id ORDER BY 1", [["1", "1"], ["2", "2"], ["3", "3"]]],
    ["SELECT a.id, x.c FROM a, LATERAL (SELECT COUNT(*) AS c FROM b WHERE b.x = a.x) AS x ORDER BY a.id", [["1", "2"], ["2", "0"], ["3", "1"]]],
    ["SELECT a.id, x.t FROM a LEFT JOIN LATERAL (SELECT t FROM b WHERE b.x = a.x ORDER BY t LIMIT 1) AS x ON TRUE ORDER BY a.id", [["1", "B1"], ["2", null], ["3", "B3"]]],
    ["WITH c AS (SELECT x, COUNT(*) AS n FROM b GROUP BY x) SELECT a.id, c.n FROM a JOIN c ON c.x = a.x ORDER BY a.id", [["1", "2"], ["3", "1"]]],
    ["WITH RECURSIVE r (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 5) SELECT n FROM r", [["1"], ["2"], ["3"], ["4"], ["5"]]],
    ["WITH RECURSIVE r (n) AS (SELECT 1 UNION DISTINCT SELECT n % 3 + 1 FROM r) SELECT n FROM r ORDER BY n", [["1"], ["2"], ["3"]]],
    ["WITH RECURSIVE r (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT COUNT(*) FROM r", 3636],
    ["SELECT x FROM a UNION SELECT x FROM b ORDER BY 1", [[null], ["10"], ["20"], ["30"]]],
    ["SELECT x FROM a UNION ALL SELECT x FROM b ORDER BY 1", [[null], ["10"], ["10"], ["10"], ["20"], ["30"], ["30"]]],
    ["SELECT x FROM a INTERSECT SELECT x FROM b", [["10"], ["30"]]],
    ["SELECT x FROM b EXCEPT SELECT x FROM a", [[null]]],
    ["SELECT x FROM b EXCEPT ALL SELECT x FROM a ORDER BY 1", [[null], ["10"]]],
    ["(SELECT x FROM a ORDER BY x DESC LIMIT 1) UNION ALL (SELECT x FROM b ORDER BY id LIMIT 2)", [["30"], ["10"], [null]]],
    ["SELECT id, s FROM a UNION SELECT id, t FROM b ORDER BY 2 LIMIT 3", [["3", null], ["1", "B1"], ["2", "B2"]]],
    ["SELECT id FROM a UNION SELECT id, t FROM b", 1222],
    ["SELECT id FROM a UNION SELECT id FROM b ORDER BY a.id", 1250],
    ["DELETE FROM b WHERE x IN (SELECT x FROM b)", 1093],
    ["DELETE FROM b WHERE x IN (SELECT x FROM a WHERE id > 1)", [1, 0, "", 0]],
    ["UPDATE a SET s = (SELECT MAX(t) FROM b WHERE b.x = a.x)", [3, 0, "Rows matched: 3  Changed: 2  Warnings: 0", 0]],
    ["SELECT * FROM a ORDER BY id", [["1", "10", "B4"], ["2", "20", null], ["3", "30", null]]],
    ["SELECT * FROM b ORDER BY id", [["1", "10", "B1"], ["2", null, "B2"], ["4", "10", "B4"]]],
]

test('M5.1: a script of subqueries, CTEs and set operations returns what 8.4.11 returned, statement by statement', async () => {
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
