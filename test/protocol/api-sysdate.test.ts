// SYSDATE is the time it is evaluated; NOW is the time the statement began.
//
// MySQL documents the difference (`Item_func_sysdate_local` reads the clock on
// every call), and the executor had SYSDATE share NOW's case, so both were the
// statement's start. Over a scan long enough to cross a millisecond, NOW gives
// one value and SYSDATE more than one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'

test('SYSDATE reads the clock for each row, NOW once per statement', async () => {
  const db = await MySQL.open(':memory:')
  await db.query('CREATE DATABASE d')
  await db.query('CREATE TABLE d.t (n INT PRIMARY KEY)')
  await db.query(
    'INSERT INTO d.t WITH RECURSIVE s (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 999) SELECT a.n * 1000 + b.n FROM s a, s b WHERE a.n < 30',
  )
  const [rows] = await db.query('SELECT COUNT(DISTINCT NOW(6)) AS now_values, COUNT(DISTINCT SYSDATE(6)) AS sysdate_values FROM d.t')
  const [row] = rows as { now_values: number; sysdate_values: number }[]
  assert.equal(row?.now_values, 1)
  assert.ok((row?.sysdate_values ?? 0) > 1, `SYSDATE gave ${row?.sysdate_values} value(s) over 30,000 rows`)
  await db.end()
})
