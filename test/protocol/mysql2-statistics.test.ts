// M5.45 — a table's statistics, through `mysql2`, against what 8.4.11 said to
// the same script (asked first, and written down here).
//
// Three things are checked. First, the optimizer reads them: an unanalysed
// STATS_AUTO_RECALC=0 table has one row per key, so a join looks it up by
// index; after ANALYZE, with 4 rows over 3 values of `x`, a hash join is
// cheaper, and the rows come in the hash join's order. Second, SHOW INDEX and
// `STATISTICS` show them through the server's cache: a never-analysed table
// shows 1; a table that grows, or is truncated, after its first SHOW INDEX
// shows what it showed until ANALYZE refreshes it. Third, an auto-recalculating
// table shows what its rows say, since its statistics are recomputed once a
// tenth of them have changed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = 'ok' | readonly (readonly (string | null)[])[]

/** SHOW INDEX's key name, part, column and cardinality. */
const index = (rows: unknown[][]) => rows.map((r) => [r[2], r[3], r[4], r[6]].map((v) => (v === null ? null : String(v))))
/** EXPLAIN FORMAT=TREE's iterators, without their costs. */
const plan = (rows: unknown[][]) => [[String(rows[0]?.[0]).replace(/ {2}\(cost=[^)]*\)/g, '').replace(/ \([^()]*(\([^()]*\)[^()]*)*\)$/gm, '')]]

const SCRIPT: readonly (readonly [string, Outcome, ((rows: unknown[][]) => unknown[][])?])[] = [
  ['CREATE TABLE f (id INT PRIMARY KEY, g INT, h INT, KEY (g, h)) STATS_AUTO_RECALC=0', 'ok'],
  ['CREATE TABLE r (id INT PRIMARY KEY, g INT, h INT, KEY (g, h))', 'ok'],
  ['SHOW CREATE TABLE f', [['f', 'CREATE TABLE `f` (\n  `id` int NOT NULL,\n  `g` int DEFAULT NULL,\n  `h` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `g` (`g`,`h`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci STATS_AUTO_RECALC=0']]],
  ['INSERT INTO f VALUES (1,1,1),(2,1,2),(3,2,NULL),(4,NULL,NULL)', 'ok'],
  ['INSERT INTO r VALUES (1,1,1),(2,1,2),(3,2,NULL),(4,NULL,NULL)', 'ok'],
  ['SHOW INDEX FROM f', [['PRIMARY', '1', 'id', '1'], ['g', '1', 'g', '1'], ['g', '2', 'h', '1']], index],
  ['SHOW INDEX FROM r', [['PRIMARY', '1', 'id', '4'], ['g', '1', 'g', '3'], ['g', '2', 'h', '4']], index],
  ['ANALYZE TABLE f, r', 'ok'],
  ['SHOW INDEX FROM f', [['PRIMARY', '1', 'id', '4'], ['g', '1', 'g', '3'], ['g', '2', 'h', '4']], index],
  ['INSERT INTO f VALUES (5,3,3),(6,4,4),(7,5,5),(8,6,6),(9,7,7),(10,8,8)', 'ok'],
  ['INSERT INTO r VALUES (5,3,3),(6,4,4),(7,5,5),(8,6,6),(9,7,7),(10,8,8)', 'ok'],
  ['SHOW INDEX FROM f', [['PRIMARY', '1', 'id', '4'], ['g', '1', 'g', '3'], ['g', '2', 'h', '4']], index],
  ['SHOW INDEX FROM r', [['PRIMARY', '1', 'id', '4'], ['g', '1', 'g', '3'], ['g', '2', 'h', '4']], index],

  ['CREATE TABLE b (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, x INT, t VARCHAR(5) NOT NULL, KEY (x)) STATS_AUTO_RECALC=0', 'ok'],
  ['CREATE TABLE c (y INT, u VARCHAR(5)) STATS_AUTO_RECALC=0', 'ok'],
  ["INSERT INTO b (x, t) VALUES (10, 'B1'), (NULL, 'B2'), (30, 'B3'), (10, 'B4')", 'ok'],
  ["INSERT INTO c VALUES (10, 'c1'), (20, 'c2'), (10, 'c3'), (NULL, 'c4')", 'ok'],
  ['EXPLAIN FORMAT=TREE SELECT * FROM c LEFT JOIN b ON b.x = c.y', [['-> Nested loop left join\n    -> Table scan on c\n    -> Index lookup on b using x\n']], plan],
  ['SELECT * FROM c LEFT JOIN b ON b.x = c.y', [['10', 'c1', '1', '10', 'B1'], ['10', 'c1', '4', '10', 'B4'], ['20', 'c2', null, null, null], ['10', 'c3', '1', '10', 'B1'], ['10', 'c3', '4', '10', 'B4'], [null, 'c4', null, null, null]]],
  ['SHOW INDEX FROM b', [['PRIMARY', '1', 'id', '1'], ['x', '1', 'x', '1']], index],
  ['ANALYZE TABLE b, c', 'ok'],
  ['EXPLAIN FORMAT=TREE SELECT * FROM c LEFT JOIN b ON b.x = c.y', [['-> Left hash join\n    -> Table scan on c\n    -> Hash\n        -> Table scan on b\n']], plan],
  ['SELECT * FROM c LEFT JOIN b ON b.x = c.y', [['10', 'c1', '4', '10', 'B4'], ['10', 'c1', '1', '10', 'B1'], ['20', 'c2', null, null, null], ['10', 'c3', '4', '10', 'B4'], ['10', 'c3', '1', '10', 'B1'], [null, 'c4', null, null, null]]],
  ['SHOW INDEX FROM b', [['PRIMARY', '1', 'id', '4'], ['x', '1', 'x', '3']], index],
  ["INSERT INTO b (x, t) VALUES (40, 'B5'), (50, 'B6'), (60, 'B7'), (70, 'B8'), (80, 'B9'), (90, 'B10')", 'ok'],
  ['SHOW INDEX FROM b', [['PRIMARY', '1', 'id', '4'], ['x', '1', 'x', '3']], index],
  ["SELECT INDEX_NAME, SEQ_IN_INDEX, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'app' AND TABLE_NAME = 'b' ORDER BY 1, 2", [['PRIMARY', '1', '4'], ['x', '1', '3']]],
  ['ANALYZE TABLE b', 'ok'],
  ['SHOW INDEX FROM b', [['PRIMARY', '1', 'id', '10'], ['x', '1', 'x', '9']], index],
  ['TRUNCATE TABLE b', 'ok'],
  ['SHOW INDEX FROM b', [['PRIMARY', '1', 'id', '10'], ['x', '1', 'x', '9']], index],

  // The relational corpus's schema: a key's values in its collation, NULLs as one, a second part's run on through the first.
  ['CREATE TABLE pa (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(12) NOT NULL, grp INT, amt DECIMAL(6,2), UNIQUE KEY (name), KEY (grp)) STATS_AUTO_RECALC=0', 'ok'],
  ['CREATE TABLE ch (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, pa_id INT, label VARCHAR(10), qty INT NOT NULL, KEY (pa_id)) STATS_AUTO_RECALC=0', 'ok'],
  ['CREATE TABLE lt (n INT NOT NULL PRIMARY KEY, s VARCHAR(10) CHARACTER SET latin1, t VARCHAR(10) COLLATE utf8mb4_bin, KEY (s, t)) STATS_AUTO_RECALC=0', 'ok'],
  ["INSERT INTO pa (name, grp, amt) VALUES ('Mo', 1, -15.58), ('x y', 2, NULL), ('ÄNNA', NULL, 112.80), ('zoë', 1, 3), ('b', NULL, 4)", 'ok'],
  ["INSERT INTO ch (pa_id, label, qty) VALUES (5, 'red', 4), (1, 'a', 1), (1, 'b', 2), (NULL, NULL, 3), (9, 'red', 5)", 'ok'],
  ["INSERT INTO lt (n, s, t) VALUES (1, 'ÄNNA', 'x'), (3, 'Mo', NULL), (5, 'ÄNNA', 'Blue'), (7, 'Bob', NULL), (9, 'Mo', NULL), (11, 'anna', 'X')", 'ok'],
  ['ANALYZE TABLE pa, ch, lt', 'ok'],
  ['SHOW INDEX FROM pa', [['PRIMARY', '1', 'id', '5'], ['name', '1', 'name', '5'], ['grp', '1', 'grp', '3']], index],
  ['SHOW INDEX FROM ch', [['PRIMARY', '1', 'id', '5'], ['pa_id', '1', 'pa_id', '4']], index],
  ['SHOW INDEX FROM lt', [['PRIMARY', '1', 'n', '6'], ['s', '1', 's', '4'], ['s', '2', 't', '5']], index],
]

test('M5.45: the optimizer, SHOW INDEX and STATISTICS read a table statistics as 8.4.11 does', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected, shape] of SCRIPT) {
      const [r] = await conn.query({ sql, rowsAsArray: true })
      if (expected === 'ok') continue
      const rows = r as unknown[][]
      const actual = shape === undefined ? rows.map((row) => row.map((v) => (v === null ? null : String(v)))) : shape(rows)
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
