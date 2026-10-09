// HAVING, as 8.4.11 ran each of these statements.
//
// What it pins: HAVING without GROUP BY or an aggregate filters the rows the
// WHERE kept. Either way it sees the select list — an alias (which wins over
// a column of the same name), a selected column, and what an alias's
// expression reads — and no other column of the row: one that is not
// selected is 1054. Two items of one alias are 1052, a window function is
// 3593 and an alias of one 3594. An aggregate in HAVING reads the whole row,
// and makes the query an aggregate one (1140 under ONLY_FULL_GROUP_BY for a
// column beside it). An overflow names its expression as `Item::print`
// does, which is printed only when there is one. MATCH in HAVING finds its
// index through the query's tables and its columns through the select
// list. And a CAST to NCHAR draws 3720 as an NCHAR column does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE h (id INT PRIMARY KEY, a INT, s VARCHAR(10))", [0,0,"",0]],
  ["INSERT INTO h VALUES (1, 10, 'x'), (2, 20, 'y'), (3, 30, 'z')", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM h HAVING id > 1", [["2"],["3"]]],
  ["SELECT id AS i FROM h HAVING i > 1", [["2"],["3"]]],
  ["SELECT id FROM h HAVING a > 10", [1054,"Unknown column 'a' in 'having clause'"]],
  ["SELECT id, a FROM h HAVING h.a > 10", [["2","20"],["3","30"]]],
  ["SELECT id, a + 1 AS b FROM h HAVING b > 20 ORDER BY id DESC", [["3","31"],["2","21"]]],
  ["SELECT id, a AS id2 FROM h HAVING id2 > 10 AND id < 3", [["2","20"]]],
  ["SELECT a AS id FROM h HAVING id > 15", [["20"],["30"]]],
  ["SELECT id FROM h WHERE a > 10 HAVING id < 3 LIMIT 1", [["2"]]],
  ["SELECT 1 AS one HAVING one = 1", [["1"]]],
  ["SELECT 1 HAVING 1 = 0", []],
  ["SELECT * FROM h HAVING s = 'y'", [["2","20","y"]]],
  ["SELECT id FROM h HAVING (SELECT 1) = 1", [["1"],["2"],["3"]]],
  ["SELECT id, (SELECT MAX(id) FROM h) m FROM h HAVING m = id", [["3","3"]]],
  ["SELECT DISTINCT a > 15 AS big FROM h HAVING big", [["1"]]],
  ["SELECT id FROM h HAVING id IN (SELECT id FROM h WHERE a > 10)", [["2"],["3"]]],
  ["SELECT id x, a x FROM h HAVING x > 1", [1052,"Column 'x' in having clause is ambiguous"]],
  ["SELECT id FROM h HAVING ROW_NUMBER() OVER () > 1", [3593,"You cannot use the window function 'row_number' in this context.'"]],
  ["SELECT id, ROW_NUMBER() OVER () rn FROM h HAVING rn > 1", [3594,"You cannot use the alias 'rn' of an expression containing a window function in this context.'"]],
  ["SELECT h.id FROM h HAVING h.id > 2", [["3"]]],
  ["SELECT id FROM h HAVING MAX(a) > 1", [1140,"In aggregated query without GROUP BY, expression #1 of SELECT list contains nonaggregated column 'app.h.id'; this is incompatible with sql_mode=only_full_group_by"]],
  ["SELECT id FROM h HAVING COUNT(*) > 1", [1140,"In aggregated query without GROUP BY, expression #1 of SELECT list contains nonaggregated column 'app.h.id'; this is incompatible with sql_mode=only_full_group_by"]],
  ["SELECT COUNT(*) FROM h HAVING MAX(a) > 1", [["3"]]],
  ["SELECT COUNT(*) c FROM h HAVING SUM(a) = 60 AND c = 3", [["3"]]],
  ["SELECT s, COUNT(*) FROM h GROUP BY s HAVING MAX(a) > 15 ORDER BY s", [["y","1"],["z","1"]]],
  ["SELECT s FROM h GROUP BY s HAVING MIN(id) > 1 ORDER BY s", [["y"],["z"]]],
  ["SELECT s FROM h GROUP BY s HAVING a > 1", [1054,"Unknown column 'a' in 'having clause'"]],
  ["SELECT COUNT(*) FROM h HAVING id > 1", [1054,"Unknown column 'id' in 'having clause'"]],
  ["SELECT a + 9223372036854775807 AS big FROM h HAVING big > 0", [1690,"BIGINT value is out of range in '(`app`.`h`.`a` + 9223372036854775807)'"]],
  ["SELECT COUNT(*) FROM h HAVING SUM(a) * 9223372036854775807 > 0", [["3"]]],
  ["SELECT s, COUNT(*) n FROM h GROUP BY s HAVING n x", [1064,"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'x' at line 1"]],
  ["SELECT id x, a x FROM h GROUP BY id, a HAVING x > 1", [1052,"Column 'x' in having clause is ambiguous"]],
  ["CREATE TABLE ft (id INT PRIMARY KEY, s VARCHAR(20), FULLTEXT KEY (s))", [0,0,"",0]],
  ["INSERT INTO ft VALUES (1, 'hello world'), (2, 'foo bar')", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM ft GROUP BY id HAVING MATCH(s) AGAINST ('hello')", [1054,"Unknown column 's' in 'having clause'"]],
  ["SELECT id, MATCH(s) AGAINST ('hello') m FROM ft HAVING m > 0", [["1","0.0906190574169159"]]],
  ["SELECT id, s FROM ft HAVING MATCH(s) AGAINST ('foo')", [["2","foo bar"]]],
  ["SELECT CAST('a' AS NCHAR), CAST('a' AS NATIONAL CHAR(3))", [["a","a"]]],
  ["SHOW WARNINGS", [["Warning","3720","NATIONAL/NCHAR/NVARCHAR implies the character set UTF8MB3, which will be replaced by UTF8MB4 in a future release. Please consider using CHAR(x) CHARACTER SET UTF8MB4 in order to be unambiguous."],["Warning","3720","NATIONAL/NCHAR/NVARCHAR implies the character set UTF8MB3, which will be replaced by UTF8MB4 in a future release. Please consider using CHAR(x) CHARACTER SET UTF8MB4 in order to be unambiguous."]]],
]

test('HAVING filters, resolves and refuses as 8.4.11 does, grouped or not', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
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
