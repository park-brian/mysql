// M5.6 begun and TRUNCATE (M5.9), through `mysql2`, against answers a real
// 8.4.11 gave to the same script (asked first, through the same driver, and
// written down here).
//
// What they pin: a window sorts by its PARTITION BY, NULL first, then its
// ORDER BY, and the rows leave in that order unless an ORDER BY follows; RANK
// and DENSE_RANK give peers one number; a window in WHERE or HAVING is 3593;
// TRUNCATE commits the open transaction first, so a ROLLBACK after it undoes
// nothing, and the table it leaves numbers AUTO_INCREMENT from 1 again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly (string | number)[] | readonly (readonly (string | null)[])[]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ['CREATE TABLE p (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, g VARCHAR(3), n INT)', [0, 0, '', 0]],
  ["INSERT INTO p (g, n) VALUES ('a', 3), ('b', 1), ('a', 1), (NULL, 2), ('b', 1), ('a', 3)", [6, 1, 'Records: 6  Duplicates: 0  Warnings: 0', 0]],
  [
    'SELECT id, ROW_NUMBER() OVER (ORDER BY n, id) FROM p',
    [
      ['2', '1'],
      ['3', '2'],
      ['5', '3'],
      ['4', '4'],
      ['1', '5'],
      ['6', '6'],
    ],
  ],
  [
    'SELECT id, g, RANK() OVER (PARTITION BY g ORDER BY n), DENSE_RANK() OVER (PARTITION BY g ORDER BY n) FROM p',
    [
      ['4', null, '1', '1'],
      ['3', 'a', '1', '1'],
      ['1', 'a', '2', '2'],
      ['6', 'a', '2', '2'],
      ['2', 'b', '1', '1'],
      ['5', 'b', '1', '1'],
    ],
  ],
  [
    'SELECT id, ROW_NUMBER() OVER (PARTITION BY g ORDER BY id DESC) FROM p ORDER BY id',
    [
      ['1', '3'],
      ['2', '2'],
      ['3', '2'],
      ['4', '1'],
      ['5', '1'],
      ['6', '1'],
    ],
  ],
  [
    'SELECT id, ROW_NUMBER() OVER () FROM p WHERE n > 1',
    [
      ['1', '1'],
      ['4', '2'],
      ['6', '3'],
    ],
  ],
  [
    'SELECT * FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY n DESC, id) AS r FROM p) d WHERE r <= 2',
    [
      ['1', '1'],
      ['6', '2'],
    ],
  ],
  ['SELECT id FROM p WHERE ROW_NUMBER() OVER () > 1', 3593],
  ['SELECT g, COUNT(*) FROM p GROUP BY g HAVING RANK() OVER () > 0', 3593],
  ['START TRANSACTION', [0, 0, '', 0]],
  ["INSERT INTO p (g, n) VALUES ('c', 9)", [1, 7, '', 0]],
  ['TRUNCATE TABLE p', [0, 0, '', 0]],
  ['ROLLBACK', [0, 0, '', 0]],
  ['SELECT COUNT(*) FROM p', [['0']]],
  ["INSERT INTO p (g, n) VALUES ('z', 0)", [1, 1, '', 0]],
  ['SELECT * FROM p', [['1', 'z', '0']]],
  ['TRUNCATE nosuch', 1146],
  ['TRUNCATE TABLE p', [0, 0, '', 0]],
  ['SELECT COUNT(*) FROM p', [['0']]],
]

test('M5.6 and M5.9: window functions and TRUNCATE return what 8.4.11 returned, statement by statement', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream(),
    user: 'root',
    password: '',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  })
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
