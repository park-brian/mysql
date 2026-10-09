// One collation aggregation, `DTCollation::aggregate`, at compile time and at run time.
//
// The compiler aggregated with a port of MySQL's rule, and the run-time
// comparison with a shortcut ("utf8mb4 wins a tie, else the left side"). They
// disagreed wherever a Unicode charset other than utf8mb4 met another
// charset: `latin1_col = utf8mb3_col` compared under latin1_swedish_ci and
// `utf8mb3_col = latin1_col` under utf8mb3_general_ci, so `=` was not
// symmetric, and UNION de-duplicated under a collation its own column did not
// report. MySQL's rule makes utf8mb3 the superset either way round, so both
// compare under utf8mb3_general_ci, where 'a' and 'ä' are equal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'

test('a comparison across charsets is symmetric and uses the aggregated collation', async () => {
  const db = await MySQL.open(':memory:')
  await db.query('CREATE DATABASE d')
  await db.query('CREATE TABLE d.t (l VARCHAR(5) CHARACTER SET latin1, u VARCHAR(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci)')
  await db.query("INSERT INTO d.t VALUES ('a', 'ä')")
  const [rows] = await db.query('SELECT l = u AS lu, u = l AS ul, STRCMP(l, u) AS s, l IN (u) AS i, l LIKE u AS k, COLLATION(CONCAT(l, u)) AS c FROM d.t')
  assert.deepEqual(rows, [{ lu: 1, ul: 1, s: 0, i: 1, k: 1, c: 'utf8mb3_general_ci' }])
  const [union] = await db.query('SELECT l FROM d.t UNION SELECT u FROM d.t')
  assert.deepEqual(union, [{ l: 'a' }])
  await db.end()
})
