// Text read as a number, and the messages that quote an argument, as 8.4.11
// answered each of these statements in its default sql_mode (M5.10).
//
// A VARCHAR or VARBINARY column read as a double or an integer is quiet when
// the bytes left unconverted are exactly twice its length bytes: 2 in a
// column under 256 bytes, 4 from there; a CHAR warns whatever is left. A
// 1292 quotes bytes up to their first NUL, as UTF-8. FIELD compares in its
// first argument's collation, every other argument converted into its
// charset (3854 when one cannot be, a constant's before any row). INET_ATON,
// INET6_ATON, INET6_NTOA and INET_NTOA quote their argument as
// `Item::print` prints it, not its value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT PRIMARY KEY, v VARCHAR(10), w VARCHAR(400), c CHAR(10), b VARBINARY(10), s VARCHAR(10), l VARCHAR(10) CHARACTER SET latin1)", [0,0,"",0]],
  ["INSERT INTO t VALUES (1, '1x', '1x', '1x', X'00FF', 'é', 'é'), (2, '1xy', '1xy', '1xy', X'C3A9', 'ж', 'x'), (3, 'xy', '1abc', 'xy', '', 'E', 'e'), (4, '1.2.3', '1.2.3.4', '1.2.3', X'0A000509', 'ab', 'ab')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, v + 0, w + 0, c + 0 FROM t ORDER BY id", [["1","1","1","1"],["2","1","1","1"],["3","0","1","0"],["4","1.2","1.2","1.2"]]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: '1x'"],["Warning","1292","Truncated incorrect DOUBLE value: '1x'"],["Warning","1292","Truncated incorrect DOUBLE value: '1x'"],["Warning","1292","Truncated incorrect DOUBLE value: '1xy'"],["Warning","1292","Truncated incorrect DOUBLE value: '1xy'"],["Warning","1292","Truncated incorrect DOUBLE value: '1abc'"],["Warning","1292","Truncated incorrect DOUBLE value: 'xy'"],["Warning","1292","Truncated incorrect DOUBLE value: '1.2.3'"]]],
  ["SELECT id, HEX(CHAR(v)), HEX(CHAR(w)) FROM t ORDER BY id", [["1","01","01"],["2","01","01"],["3","00","01"],["4","01","01"]]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect INTEGER value: '1x'"],["Warning","1292","Truncated incorrect INTEGER value: '1x'"],["Warning","1292","Truncated incorrect INTEGER value: '1xy'"],["Warning","1292","Truncated incorrect INTEGER value: 'xy'"],["Warning","1292","Truncated incorrect INTEGER value: '1abc'"],["Warning","1292","Truncated incorrect INTEGER value: '1.2.3'"],["Warning","1292","Truncated incorrect INTEGER value: '1.2.3.4'"]]],
  ["SELECT id, b + 0, HEX(CHAR(b)) FROM t ORDER BY id", [["1","0","00"],["2","0","00"],["3","0","00"],["4","0","00"]]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect INTEGER value: ''"],["Warning","1292","Truncated incorrect INTEGER value: 'é'"],["Warning","1292","Truncated incorrect INTEGER value: ''"],["Warning","1292","Truncated incorrect DOUBLE value: '\n'"],["Warning","1292","Truncated incorrect INTEGER value: '\n'"]]],
  ["SELECT id, FIELD(b, s), FIELD(b, 'AB'), FIELD(l, s, 'E') FROM t WHERE id <> 2 ORDER BY id", [["1","0","0","1"],["3","0","0","1"],["4","0","0","1"]]],
  ["SELECT id, FIELD(s, b) FROM t ORDER BY id", [3854,"Cannot convert string '\\x00\\xFF' from binary to utf8mb4"]],
  ["SELECT id, FIELD(l, s) FROM t ORDER BY id", [3854,"Cannot convert string '\\xD0\\xB6' from utf8mb4 to latin1"]],
  ["SELECT id, FIELD(l, 'ж') FROM t WHERE id > 9", [3854,"Cannot convert string '\\xD0\\xB6' from utf8mb4 to latin1"]],
  ["SELECT id, FIELD(s, 'e' COLLATE utf8mb4_bin) FROM t ORDER BY id", [["1","1"],["2","0"],["3","1"],["4","0"]]],
  ["SELECT INET_ATON(v), INET6_ATON(v) FROM t AS x WHERE id = 3", [[null,null]]],
  ["SHOW WARNINGS", [["Warning","1411","Incorrect string value: '`app`.`x`.`v`' for function inet_aton"],["Warning","1411","Incorrect string value: '`app`.`x`.`v`' for function inet6_aton"]]],
  ["SELECT INET_ATON(CONCAT(v, 'x')), INET6_NTOA('abc'), INET6_NTOA(X'0102'), INET_NTOA(-1), INET_NTOA('-1') FROM t WHERE id = 1", [[null,null,null,null,null]]],
  ["SHOW WARNINGS", [["Warning","1411","Incorrect string value: 'concat(`app`.`t`.`v`,'x')' for function inet_aton"],["Warning","1411","Incorrect string value: ''abc'' for function inet6_ntoa"],["Warning","1411","Incorrect string value: '0x0102' for function inet6_ntoa"],["Warning","1411","Incorrect integer value: '-(1)' for function inet_ntoa"],["Warning","1411","Incorrect integer value: ''-1'' for function inet_ntoa"]]],
  ["CREATE TABLE u (id INT PRIMARY KEY, x VARCHAR(400), y VARBINARY(300))", [0,0,"",0]],
  ["INSERT INTO u VALUES (1, ' xyz', X'0A000509'), (2, CONCAT('a', CHAR(0), 'bcd'), 'ab'), (3, '  xy', X'2020')", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, x + 0, y + 0 FROM u ORDER BY id", [["1","0","0"],["2","0","0"],["3","0","0"]]],
  ["SHOW WARNINGS", [["Warning","1292","Truncated incorrect DOUBLE value: 'a'"],["Warning","1292","Truncated incorrect DOUBLE value: 'ab'"]]],
]

test('text read as a number warns, and FIELD and the address functions quote, as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : String(v))))
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
