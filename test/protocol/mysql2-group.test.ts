// M5.5 — GROUP BY, the aggregates, HAVING and WITH ROLLUP, through `mysql2`,
// against answers a real 8.4.11 gave to the same script (asked first, through
// the same driver, and written down here). The relational corpus
// (`relational-vectors.test.ts`) draws grouped queries at random; this holds
// the cases that taught the rules.
//
// What they pin: a group is a value under the column's collation (`'ann'` and
// `'ÄNN'` are one group, and so are `'Bob'` and `'bob'`); groups come out in
// first-appearance order through a temporary table and in index order through
// an index; ROLLUP sorts and adds its super-aggregate rows; an aggregate over no
// rows is one row; AVG holds four more digits; and ONLY_FULL_GROUP_BY's
// refusals (1055, 1140), HAVING's (1054), and the misplaced aggregate's (1111,
// 1056, 3029).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly (string | number)[] | readonly (readonly (string | null)[])[]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
    ["CREATE TABLE t (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, k INT NOT NULL, n INT, s VARCHAR(8), d DECIMAL(5,2), KEY (k))", [0, 0, "", 0]],
    ["INSERT INTO t (k, n, s, d) VALUES (2, 5, 'ann', 1.10), (1, NULL, 'Bob', NULL), (2, 7, 'ÄNN', 2.25), (3, 1, NULL, 3.00), (1, 9, 'bob', 0.05), (2, 5, 'cy', -1.50)", [6, 1, "Records: 6  Duplicates: 0  Warnings: 0", 0]],
    ["SELECT s, COUNT(*) FROM t GROUP BY s", [["ann", "2"], ["Bob", "2"], [null, "1"], ["cy", "1"]]],
    ["SELECT k, COUNT(*), SUM(n), AVG(n), MIN(s), MAX(s) FROM t GROUP BY k", [["1", "2", "9", "9.0000", "Bob", "Bob"], ["2", "3", "17", "5.6667", "ann", "cy"], ["3", "1", "1", "1.0000", null, null]]],
    ["SELECT n, COUNT(*) FROM t GROUP BY n", [["5", "2"], [null, "1"], ["7", "1"], ["1", "1"], ["9", "1"]]],
    ["SELECT k, n, SUM(d) FROM t GROUP BY k, n WITH ROLLUP", [["1", null, null], ["1", "9", "0.05"], ["1", null, "0.05"], ["2", "5", "-0.40"], ["2", "7", "2.25"], ["2", null, "1.85"], ["3", "1", "3.00"], ["3", null, "3.00"], [null, null, "4.90"]]],
    ["SELECT k, GROUPING(k), COUNT(*) FROM t GROUP BY k WITH ROLLUP", [["1", "0", "2"], ["2", "0", "3"], ["3", "0", "1"], [null, "1", "6"]]],
    ["SELECT COUNT(*), COUNT(n), SUM(n), AVG(d), MIN(n), MAX(n) FROM t WHERE k > 9", [["0", "0", null, null, null, null]]],
    ["SELECT k AS kk, COUNT(*) AS c FROM t GROUP BY kk HAVING c > 1 ORDER BY c DESC, kk", [["2", "3"], ["1", "2"]]],
    ["SELECT k, GROUP_CONCAT(s), GROUP_CONCAT(DISTINCT n ORDER BY n DESC SEPARATOR '|') FROM t GROUP BY k ORDER BY k", [["1", "Bob,bob", "9"], ["2", "ann,ÄNN,cy", "7|5"], ["3", null, "1"]]],
    ["SELECT COUNT(DISTINCT n), COUNT(DISTINCT s), COUNT(DISTINCT k, n) FROM t", [["4", "3", "4"]]],
    ["SELECT AVG(d), STD(n), VARIANCE(n), VAR_SAMP(n), STDDEV_SAMP(n), BIT_AND(k), BIT_OR(n), BIT_XOR(n) FROM t", [["0.980000", "2.65329983228432", "7.040000000000001", "8.8", "2.9664793948382653", "0", "15", "15"]]],
    ["SELECT k, AVG(d) FROM t GROUP BY k ORDER BY k", [["1", "0.050000"], ["2", "0.616667"], ["3", "3.000000"]]],
    ["SELECT s, COUNT(*) FROM t GROUP BY k", 1055],
    ["SELECT s, COUNT(*) FROM t", 1140],
    ["SELECT k, COUNT(*) FROM t WHERE k = 2", [["2", "3"]]],
    ["SELECT id, s FROM t GROUP BY id ORDER BY id", [["1", "ann"], ["2", "Bob"], ["3", "ÄNN"], ["4", null], ["5", "bob"], ["6", "cy"]]],
    ["SELECT k FROM t GROUP BY k HAVING n > 1", 1054],
    ["SELECT COUNT(*) c FROM t GROUP BY c", 1056],
    ["SELECT s FROM t ORDER BY COUNT(*)", 3029],
    ["SELECT COUNT(*) FROM t WHERE COUNT(*) > 1", 1111],
    ["SELECT SUM(COUNT(*)) FROM t", 1111],
    ["SELECT k FROM t GROUP BY k ORDER BY n", 1055],
    ["SELECT k + 1, COUNT(*) FROM t GROUP BY k + 1 ORDER BY 1", [["2", "2"], ["3", "3"], ["4", "1"]]],
    ["SELECT ANY_VALUE(s), k FROM t GROUP BY k ORDER BY k", [["Bob", "1"], ["ann", "2"], [null, "3"]]],
    ["SELECT COUNT(*) FROM t HAVING COUNT(*) > 100", []],
    ["SELECT k, SUM(n) FROM t GROUP BY 1 ORDER BY 2 DESC, 1", [["2", "17"], ["1", "9"], ["3", "1"]]],
]

test('M5.5: a grouped script returns what 8.4.11 returned, statement by statement', async () => {
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
