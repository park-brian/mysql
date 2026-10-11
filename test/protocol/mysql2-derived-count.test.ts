// M5.49: filter aggregate outputs inside materialization, preserving its boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('derived COUNT predicates run after grouping and before materialization', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const base = 'SELECT d.k,d.c FROM (SELECT k,COUNT(*) AS c FROM t GROUP BY k) d WHERE d.c>1'
  const pushed = 'Table scan on d\n    Materialize\n        Filter\n            Group aggregate\n                Covering index scan on t using k'
  const metadata = [[3, 11, 0, 0, 63, 'k', 'k', 'd', 't'], [8, 21, 1, 0, 63, 'c', 'c', 'd', '']]
  const run = async (sql: string, expected: unknown[][], plan?: string, values: unknown[] = []) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, values, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.name, f.orgName, f.table, f.orgTable]), metadata)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      if (plan !== undefined) {
        const [explain] = await conn.query<mysql.RowDataPacket[]>({ sql: `EXPLAIN FORMAT=TREE ${sql}`, values })
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
      }
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS derived_count')
    await conn.query('USE derived_count')
    await conn.query('DROP TABLE IF EXISTS t')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,k INT,n INT,KEY(k))')
    await conn.query('INSERT INTO t VALUES(1,NULL,NULL),(2,NULL,NULL),(3,1,3),(4,1,3),(5,2,NULL),(6,3,1),(7,3,NULL),(8,3,2)')
    const kept = [[null, 2], [1, 2], [3, 3]]
    await run(base, kept, pushed)
    await run(`${base} ORDER BY d.k`, kept, `Sort\n${pushed.split('\n').map((line: string) => `    ${line}`).join('\n')}`)
    await run(base.replace('d.c>1', 'c>1'), kept, pushed)
    await run(base.replace('COUNT(*)', 'COUNT(n)'), [[1, 2], [3, 2]], pushed.replace('Covering index scan', 'Index scan'))
    await run(base.replace('COUNT(*)', 'COUNT(DISTINCT n)'), [[3, 2]], pushed.replace('Covering index scan', 'Index scan'))
    await run(base.replace('d.c>1', 'd.c>?'), kept, pushed, [1])
    await run(base.replace('d.c>1', 'd.c>?'), kept, undefined, ['1'])
    await run(base.replace('d.c>1', 'd.c>?'), [], undefined, [null])
    // A LIMIT must choose its groups before the outer predicate can discard them.
    await run(base.replace('GROUP BY k', 'GROUP BY k LIMIT 2').replace('d.c>1', 'd.c>2'), [])
    const windowed = base.replace('COUNT(*) AS c', 'COUNT(*) AS c,ROW_NUMBER() OVER(ORDER BY k) AS rn')
    await run(windowed, kept)
    const [windowPlan] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${windowed}`)
    assert.match(planSkeleton(windowPlan[0]?.EXPLAIN), /^Filter\n    Table scan on d\n        Materialize(?:\n|$)/)
    // A NULL-complemented side and a CTE's other reader must not inherit this predicate.
    for (const [sql, expected] of [
      ['SELECT d.k,d.c FROM t LEFT JOIN (SELECT k,COUNT(*) AS c FROM t GROUP BY k) d ON d.k=t.k WHERE d.c>1 OR d.c IS NULL ORDER BY t.id', [[null, null], [null, null], [1, 2], [1, 2], [3, 3], [3, 3], [3, 3]]],
      ['WITH c AS(SELECT k,COUNT(*) AS c FROM t GROUP BY k) SELECT d.k,d.c,e.k,e.c FROM c d JOIN c e ON TRUE WHERE d.c>2 AND e.c=1', [[3, 3, 2, 1]]],
    ] as const) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
    }
    await conn.query("SET optimizer_switch='derived_condition_pushdown=off'")
    await run(base, kept, 'Filter\n    Table scan on d\n        Materialize\n            Group aggregate\n                Covering index scan on t using k')
    await conn.query("SET optimizer_switch='derived_condition_pushdown=on'")
    await run(base, kept, pushed)
    for (const method of ['query', 'execute'] as const) {
      await assert.rejects(method === 'query' ? conn.query(base.replace('d.c>1', 'd.missing>1')) : conn.execute(base.replace('d.c>1', 'd.missing>1')), { errno: 1054, sqlState: '42S22' })
      const duplicate = base.replace('SELECT k,COUNT(*) AS c', 'SELECT k,COUNT(*) AS c,COUNT(n) AS c')
      await assert.rejects(method === 'query' ? conn.query(duplicate) : conn.execute(duplicate), { errno: 1060, sqlState: '42S21' })
    }
    await conn.query('DELETE FROM t')
    await run(base, [])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS derived_count')
    await conn.end()
    await db?.end()
  }
})
