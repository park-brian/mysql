// The review of the relational slice (M5.18–M5.20): ten findings from a code
// review and three from corpus seeds that were not committed, each put to
// 8.4.11 first. Every expected outcome below is what the server answered,
// through `mysql2`, to the same statements in a fresh database; every case
// failed here before its fix.
//
// Two findings are refused by name rather than run, and are not here: an
// aggregate of only an enclosing query's columns belongs to that query and
// makes it aggregate (`SELECT (SELECT COUNT(t1.x) FROM t2) FROM t1` is one
// row), which the executor cannot yet do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly number[] | readonly (readonly (string | null)[])[]

const CASES: readonly (readonly [string, readonly (readonly [string, Outcome])[]])[] = [
  [
    "a GROUP BY whose keys the WHERE pins is one group, not an implicit aggregate",
    [
      ["CREATE TABLE t(a INT, b INT)", [0, 0]],
      ["SELECT a, COUNT(*) FROM t WHERE a = 1 GROUP BY a", []],
      ["INSERT INTO t VALUES (1,1)", [1, 0]],
      ["SELECT a, COUNT(*), GROUPING(a) FROM t WHERE a = 1 GROUP BY a WITH ROLLUP", [["1", "1", "0"], [null, "1", "1"]]],
      ["SELECT a, COUNT(*) FROM t WHERE a = 2 GROUP BY a", []],
    ],
  ],
  [
    "HAVING may read an enclosing query's column",
    [
      ["CREATE TABLE t1(w INT, x INT)", [0, 0]],
      ["CREATE TABLE t2(a INT)", [0, 0]],
      ["INSERT INTO t1 VALUES (1,1),(2,5)", [2, 0]],
      ["INSERT INTO t2 VALUES (1),(3)", [2, 0]],
      ["SELECT (SELECT COUNT(*) FROM t2 GROUP BY a HAVING a > t1.x ORDER BY a LIMIT 1) FROM t1", [["1"], [null]]],
    ],
  ],
  [
    "an enclosing query's column is a constant to ONLY_FULL_GROUP_BY",
    [
      ["CREATE TABLE t1(w INT, x INT)", [0, 0]],
      ["CREATE TABLE t2(a INT)", [0, 0]],
      ["INSERT INTO t1 VALUES (1,1),(2,5)", [2, 0]],
      ["INSERT INTO t2 VALUES (1),(3)", [2, 0]],
      ["SELECT (SELECT t1.x + COUNT(*) FROM t2) FROM t1", [["3"], ["7"]]],
      ["SELECT (SELECT t1.x + COUNT(*) FROM t2 GROUP BY a ORDER BY a LIMIT 1) FROM t1", [["2"], ["6"]]],
    ],
  ],
  [
    "an ON may read an enclosing query's column",
    [
      ["CREATE TABLE t1(a INT)", [0, 0]],
      ["CREATE TABLE t2(b INT)", [0, 0]],
      ["CREATE TABLE t3(b INT)", [0, 0]],
      ["INSERT INTO t1 VALUES (1),(2)", [2, 0]],
      ["INSERT INTO t2 VALUES (1)", [1, 0]],
      ["INSERT INTO t3 VALUES (1)", [1, 0]],
      ["SELECT a FROM t1 WHERE EXISTS (SELECT 1 FROM t2 JOIN t3 ON t3.b = t1.a) ORDER BY a", [["1"]]],
    ],
  ],
  [
    "a recursive CTE's LIMIT stops it; its ORDER BY is refused",
    [
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r LIMIT 10) SELECT * FROM r", [["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["10"]]],
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<5 LIMIT 2) SELECT * FROM r", [["1"], ["2"]]],
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<5 ORDER BY n) SELECT * FROM r", 1235],
    ],
  ],
  [
    "a recursive CTE runs every recursive member, and refuses aggregates and DISTINCT in them",
    [
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<3 UNION ALL SELECT n+10 FROM r WHERE n<2) SELECT * FROM r ORDER BY n", [["1"], ["2"], ["3"], ["11"]]],
      ["WITH RECURSIVE r(n) AS ((SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<3)) SELECT * FROM r", [["1"], ["2"], ["3"]]],
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT COUNT(*) FROM r WHERE n<3) SELECT * FROM r", 3575],
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT DISTINCT n+1 FROM r WHERE n<3) SELECT * FROM r", 1235],
      ["WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<3 LIMIT 1) SELECT * FROM r", [["1"]]],
    ],
  ],
  [
    "a LATERAL table nested in a join reads the row before it; under a RIGHT JOIN it cannot",
    [
      ["CREATE TABLE t1(a INT)", [0, 0]],
      ["CREATE TABLE t2(b INT)", [0, 0]],
      ["INSERT INTO t1 VALUES (1)", [1, 0]],
      ["INSERT INTO t2 VALUES (2)", [1, 0]],
      ["SELECT * FROM t1 JOIN (t2 JOIN LATERAL (SELECT t1.a AS s) d ON TRUE) ON TRUE", [["1", "2", "1"]]],
      ["SELECT * FROM t1 RIGHT JOIN LATERAL (SELECT t1.a AS s) d ON TRUE", 1054],
      ["SELECT * FROM t1 LEFT JOIN (t2 JOIN LATERAL (SELECT t1.a AS s) d ON TRUE) ON TRUE", [["1", "2", "1"]]],
    ],
  ],
  [
    "LIMIT in an IN, ALL, ANY or SOME subquery is 1235",
    [
      ["CREATE TABLE t(a INT)", [0, 0]],
      ["CREATE TABLE t2(b INT)", [0, 0]],
      ["SELECT * FROM t WHERE a IN (SELECT b FROM t2 LIMIT 1)", 1235],
      ["SELECT * FROM t WHERE a > ALL (SELECT b FROM t2 LIMIT 1)", 1235],
      ["SELECT * FROM t WHERE EXISTS (SELECT b FROM t2 LIMIT 1)", []],
      ["SELECT * FROM t WHERE a = (SELECT b FROM t2 LIMIT 1)", []],
      ["SELECT * FROM t WHERE a IN (SELECT * FROM (SELECT b FROM t2 LIMIT 1) d)", []],
    ],
  ],
  [
    "an INSERT whose VALUES or SET reads its own table is 1093",
    [
      ["CREATE TABLE t(a INT)", [0, 0]],
      ["INSERT INTO t VALUES (1)", [1, 0]],
      ["INSERT INTO t VALUES ((SELECT MAX(a) FROM t)+1), ((SELECT MAX(a) FROM t)+1)", 1093],
      ["SELECT * FROM t", [["1"]]],
      ["INSERT INTO t SET a = (SELECT MAX(a) FROM t) + 1", 1093],
      ["INSERT INTO t SELECT MAX(a) + 1 FROM t", [1, 0]],
      ["SELECT * FROM t ORDER BY a", [["1"], ["2"]]],
    ],
  ],
  [
    "a derived table of the UPDATE target is read once, before any row changes",
    [
      ["CREATE TABLE t(a INT)", [0, 0]],
      ["INSERT INTO t VALUES (1),(2),(3)", [3, 0]],
      ["UPDATE t SET a = a + (SELECT COUNT(*) FROM (SELECT a FROM t) d WHERE d.a > t.a)", [3, 0]],
      ["SELECT * FROM t ORDER BY a", [["3"], ["3"], ["3"]]],
    ],
  ],
  [
    "a row IN a subquery",
    [
      ["CREATE TABLE t(a INT, b INT)", [0, 0]],
      ["INSERT INTO t VALUES (1,2),(3,4)", [2, 0]],
      ["SELECT * FROM t WHERE (a, b) IN (SELECT a, b FROM t WHERE a = 1)", [["1", "2"]]],
    ],
  ],
  [
    "a nested set operation's values meet the outer column's type directly",
    [
      ["CREATE TABLE pa(id INT, amt DECIMAL(6,2))", [0, 0]],
      ["CREATE TABLE kl(g INT, s VARCHAR(10))", [0, 0]],
      ["INSERT INTO pa VALUES (1, 2.5)", [1, 0]],
      ["INSERT INTO kl VALUES (3, 'x')", [1, 0]],
      ["(SELECT amt, amt FROM pa UNION ALL SELECT id, id FROM pa) UNION SELECT s, g FROM kl ORDER BY 1, 2", [["1", "1.00"], ["2.50", "2.50"], ["x", "3.00"]]],
      ["(SELECT amt FROM pa UNION SELECT id FROM pa) UNION SELECT s FROM kl ORDER BY 1", [["1"], ["2.50"], ["x"]]],
      ["(SELECT amt FROM pa INTERSECT SELECT amt FROM pa) UNION SELECT s FROM kl ORDER BY 1", [["2.50"], ["x"]]],
      ["(SELECT id FROM pa UNION ALL SELECT amt FROM pa) EXCEPT SELECT s FROM kl ORDER BY 1", [["1"], ["2.50"]]],
    ],
  ],
  [
    "under ROLLUP nothing is functionally dependent on a key (1055, naming the alias)",
    [
      ["CREATE TABLE pa(id INT PRIMARY KEY, grp INT)", [0, 0]],
      ["CREATE TABLE ch(id INT PRIMARY KEY, pa_id INT)", [0, 0]],
      ["INSERT INTO pa VALUES (1,1)", [1, 0]],
      ["INSERT INTO ch VALUES (1,1)", [1, 0]],
      ["SELECT ch.pa_id, p0.id, COUNT(*) FROM pa AS p0 JOIN ch ON p0.id = ch.pa_id GROUP BY ch.pa_id WITH ROLLUP", 1055],
      ["SELECT ch.pa_id, p0.id, COUNT(*) FROM pa AS p0 JOIN ch ON p0.id = ch.pa_id GROUP BY ch.pa_id", [["1", "1", "1"]]],
      ["SELECT ch.pa_id, p0.grp, COUNT(*) FROM pa AS p0 JOIN ch ON p0.id = ch.pa_id GROUP BY ch.pa_id WITH ROLLUP", 1055],
      ["SELECT p0.id, p0.grp, COUNT(*) FROM pa AS p0 GROUP BY p0.id WITH ROLLUP", 1055],
      ["SELECT ch.pa_id, p0.id FROM pa AS p0 JOIN ch ON p0.id = ch.pa_id WHERE ch.pa_id = 1 GROUP BY ch.pa_id WITH ROLLUP", 1055],
    ],
  ],
  [
    "under ROLLUP neither a WHERE constant nor a key determines a column",
    [
      ["CREATE TABLE pa(id INT PRIMARY KEY, grp INT, k INT)", [0, 0]],
      ["INSERT INTO pa VALUES (1,1,1)", [1, 0]],
      ["SELECT id, grp FROM pa WHERE grp = 1 GROUP BY id WITH ROLLUP", 1055],
      ["SELECT grp, COUNT(*) FROM pa WHERE grp = 1 GROUP BY id WITH ROLLUP", 1055],
      ["SELECT k FROM pa WHERE k = grp GROUP BY grp WITH ROLLUP", 1055],
      ["SELECT id + 1, COUNT(*) FROM pa GROUP BY id WITH ROLLUP", [["2", "1"], [null, "1"]]],
      ["SELECT id, grp FROM pa GROUP BY id, grp WITH ROLLUP", [["1", "1"], ["1", null], [null, null]]],
      ["SELECT grp, COUNT(*) FROM pa GROUP BY id WITH ROLLUP HAVING grp > 0", 1055],
      ["SELECT id, COUNT(*) FROM pa GROUP BY id WITH ROLLUP ORDER BY grp", 1055],
    ],
  ],
  [
    "a VALUES upsert reading its own table is 1093; the SELECT form may",
    [
      ["CREATE TABLE t(a INT PRIMARY KEY, b INT)", [0, 0]],
      ["INSERT INTO t VALUES (1,1)", [1, 0]],
      ["INSERT INTO t VALUES (1,1) ON DUPLICATE KEY UPDATE b = (SELECT MAX(a) FROM t)", 1093],
      ["INSERT INTO t SELECT 1, 1 ON DUPLICATE KEY UPDATE b = (SELECT MAX(a) + 5 FROM t)", [2, 0]],
      ["SELECT * FROM t", [["1", "6"]]],
      ["INSERT INTO t VALUES ((SELECT MAX(a) FROM (SELECT a FROM t) d) + 1, 0)", [1, 0]],
      ["SELECT * FROM t ORDER BY a", [["1", "6"], ["2", "0"]]],
    ],
  ],
  [
    "a row IN or = ANY a subquery, with NULLs",
    [
      ["CREATE TABLE t(a INT, b INT)", [0, 0]],
      ["INSERT INTO t VALUES (1,2),(3,4),(5,NULL),(NULL,9)", [4, 0]],
      ["CREATE TABLE u(x INT, y INT)", [0, 0]],
      ["INSERT INTO u VALUES (1,2),(5,7),(NULL,9)", [3, 0]],
      ["SELECT a, b, (a, b) IN (SELECT x, y FROM u), (a, b) NOT IN (SELECT x, y FROM u) FROM t ORDER BY a", [[null, "9", null, null], ["1", "2", "1", "0"], ["3", "4", "0", "1"], ["5", null, null, null]]],
      ["SELECT * FROM t WHERE (a, b) IN (SELECT x, y FROM u) ORDER BY a", [["1", "2"]]],
      ["SELECT * FROM t WHERE (a, b) NOT IN (SELECT x, y FROM u) ORDER BY a", [["3", "4"]]],
      ["SELECT * FROM t WHERE (a, b) = ANY (SELECT x, y FROM u) ORDER BY a", [["1", "2"]]],
      ["SELECT * FROM t WHERE (a, b) IN (SELECT x FROM u)", 1241],
      ["SELECT * FROM t WHERE a IN (SELECT x, y FROM u)", 1241],
    ],
  ],
]

for (const [name, steps] of CASES) {
  test(`review: ${name}`, async () => {
    const db = await MySQL.open(':memory:')
    const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, charset: 'utf8mb4_0900_ai_ci' })
    try {
      await conn.query('CREATE DATABASE app')
      await conn.query('USE app')
      for (const [sql, expected] of steps) {
        let actual: Outcome
        try {
          const [r] = await conn.query({ sql, rowsAsArray: true })
          if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
          else {
            const h = r as mysql.ResultSetHeader
            actual = [h.affectedRows, h.warningStatus]
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
}

test("review: an aggregate of only an enclosing query's columns is refused by name, never answered wrongly", async () => {
  // 8.4.11 answers `SELECT (SELECT COUNT(t1.x) FROM t2) FROM t1` with one row,
  // 2: the COUNT is the outer query's, and makes it aggregate. This executor
  // counted once per t2 row instead, and said 1, 1.
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE t1 (x INT)')
    await conn.query('CREATE TABLE t2 (y INT)')
    await conn.query('INSERT INTO t1 VALUES (1), (2)')
    await conn.query('INSERT INTO t2 VALUES (5)')
    await assert.rejects(conn.query('SELECT (SELECT COUNT(t1.x) FROM t2) FROM t1'), (e: { errno?: number }) => e.errno === 1235)
    // An aggregate that reads its own query's columns, or none, is its own.
    const [rows] = await conn.query({ sql: 'SELECT (SELECT COUNT(*) + t1.x FROM t2) FROM t1 ORDER BY 1', rowsAsArray: true })
    assert.deepEqual((rows as unknown[][]).map((r) => String(r[0])), ['2', '3'])
  } finally {
    await conn.end()
    await db.end()
  }
})
