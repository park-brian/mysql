// A group's key and an IN list's key are one key: `equalityKey`.
//
// Under a PAD SPACE collation trailing padding is ignored, and the padding is
// whatever weighs what a space weighs: in `utf8mb3_unicode_ci` (UCA 4.0.0) a
// no-break space and an ideographic space do. The IN list's key dropped the
// pad weights off the sort key; the group key dropped ASCII spaces off the
// text first. So `'a' = 'a<NBSP>'` was true and COUNT(DISTINCT) still counted
// them apart. A tab weighs something else, and is a value of its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'

test('DISTINCT agrees with = on what PAD SPACE ignores', async () => {
  const db = await MySQL.open(':memory:')
  await db.query('CREATE DATABASE d')
  await db.query('CREATE TABLE d.t (c VARCHAR(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci)')
  await db.query("INSERT INTO d.t VALUES ('a'), ('a '), (_utf8mb4 0x61C2A0), (_utf8mb4 0x61E38080), ('a\t')")
  const [eq] = await db.query("SELECT SUM(c = 'a') AS eq, SUM(c IN ('a', 'b')) AS inlist FROM d.t")
  assert.deepEqual(eq, [{ eq: '4', inlist: '4' }])
  const [distinct] = await db.query('SELECT COUNT(DISTINCT c) AS n FROM d.t')
  assert.deepEqual(distinct, [{ n: 2 }])
  const [groups] = await db.query('SELECT COUNT(*) AS n FROM d.t GROUP BY c ORDER BY n')
  assert.deepEqual(groups, [{ n: 1 }, { n: 4 }])
  await db.end()
})
