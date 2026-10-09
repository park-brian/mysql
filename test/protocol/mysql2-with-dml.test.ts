// WITH on UPDATE and DELETE (M5.1), through `mysql2`, against answers a real
// 8.4.11 gave to the same script.
//
// What they pin: the CTEs are visible to the statement's subqueries and read
// once, before the first row changes — so one reading the table being
// written is no 1093, and a SET that adds its MAX adds the same MAX to every
// row — while a subquery reading that table directly still is; a CTE named as
// the target is 1288. Drizzle's `with … update` and `with … delete` are the
// first two shapes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]
type Outcome = number | readonly (string | number)[] | Rows | readonly [Rows, readonly (readonly (string | number)[])[]]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ['CREATE TABLE p (id INT PRIMARY KEY, price INT, cheap BOOL DEFAULT FALSE)', [0, 0, '', 0]],
  ['INSERT INTO p (id, price) VALUES (1, 10), (2, 20), (3, 30)', [3, 0, 'Records: 3  Duplicates: 0  Warnings: 0', 0]],
  ['WITH a AS (SELECT AVG(price) AS v FROM p) UPDATE p SET cheap = TRUE WHERE p.price < (SELECT * FROM a)', [1, 0, 'Rows matched: 1  Changed: 1  Warnings: 0', 0]],
  ['WITH c AS (SELECT price FROM p) UPDATE p SET cheap = TRUE WHERE price < (SELECT MAX(price) FROM c)', [2, 0, 'Rows matched: 2  Changed: 1  Warnings: 0', 0]],
  ['WITH c AS (SELECT price FROM p) UPDATE p SET price = price + (SELECT MAX(price) FROM c)', [3, 0, 'Rows matched: 3  Changed: 3  Warnings: 0', 0]],
  ['WITH a AS (SELECT MAX(price) AS v FROM p) UPDATE p SET price = price + (SELECT v FROM a) ORDER BY id DESC LIMIT 2', [2, 0, 'Rows matched: 2  Changed: 2  Warnings: 0', 0]],
  [
    'SELECT * FROM p',
    [
      ['1', '40', '1'],
      ['2', '110', '1'],
      ['3', '120', '0'],
    ],
  ],
  ['WITH RECURSIVE r (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3) UPDATE p SET price = (SELECT SUM(n) FROM r)', [3, 0, 'Rows matched: 3  Changed: 3  Warnings: 0', 0]],
  [
    'SELECT * FROM p',
    [
      ['1', '6', '1'],
      ['2', '6', '1'],
      ['3', '6', '0'],
    ],
  ],
  ['WITH a AS (SELECT AVG(price) AS v FROM p) DELETE FROM p WHERE price > (SELECT * FROM a)', [0, 0, '', 0]],
  [
    'SELECT * FROM p',
    [
      ['1', '6', '1'],
      ['2', '6', '1'],
      ['3', '6', '0'],
    ],
  ],
  ['WITH p AS (SELECT 1 AS v) UPDATE p SET price = 2', 1288],
  ['WITH p AS (SELECT 1 AS v) DELETE FROM p', 1288],
  ['WITH a AS (SELECT 1 AS v) DELETE FROM p WHERE id IN (SELECT v FROM a)', [1, 0, '', 0]],
  ['UPDATE p SET price = price + (SELECT MAX(price) FROM p)', 1093],
  [
    'SELECT * FROM p',
    [
      ['2', '6', '1'],
      ['3', '6', '0'],
    ],
  ],
]

test('M5.1: WITH on UPDATE and DELETE returns what 8.4.11 returned', async () => {
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
        const [r, fields] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) {
          const rows = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
          // A SELECT whose expected outcome carries its columns' names and flags compares them too.
          const named =
            Array.isArray(expected) &&
            expected.length === 2 &&
            Array.isArray(expected[0]) &&
            Array.isArray(expected[1]) &&
            Array.isArray((expected[1] as unknown[])[0]) &&
            typeof ((expected[1] as unknown[][])[0] as unknown[])[0] === 'string' &&
            !sql.startsWith('SHOW')
          actual = named ? [rows, (fields as mysql.FieldPacket[]).map((c) => [c.schema ?? '', c.table, c.orgTable, c.orgName, c.flags as number])] : rows
        } else {
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
