import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('mixed set operations report the operands that keep duplicates', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    rowsAsArray: true,
  })
  const schema = 'mixed_set_plan_labels'
  try {
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    const inputs = [[1, 1, 1, 2, 2, 3, 4], [1, 1, 2, 5], [1, 2, 2, 3, 7]]
    for (const [i, values] of inputs.entries()) {
      await conn.query(`CREATE TABLE t${i} (v INT)`)
      await conn.query(`INSERT INTO t${i} VALUES ?`, [values.map((v) => [v])])
    }
    const cases = [
      ['EXCEPT ALL', 'EXCEPT DISTINCT', ['t1'], [4]],
      ['EXCEPT DISTINCT', 'EXCEPT ALL', [], [4]],
      ['EXCEPT ALL', 'EXCEPT ALL', [], [4]],
      ['INTERSECT DISTINCT', 'INTERSECT ALL', [], [1, 2]],
      ['UNION DISTINCT', 'UNION ALL', ['t2'], [1, 1, 2, 2, 2, 3, 3, 4, 5, 7]],
      ['EXCEPT ALL', 'EXCEPT ALL', [], [1, 1, 2, 2, 3, 4], true],
    ] as const
    for (const [first, second, kept, expected, nested] of cases) {
      const right = `SELECT v FROM t1 ${second} SELECT v FROM t2`
      const sql = `SELECT v FROM t0 ${first} ${nested ? `(${right})` : right} ORDER BY 1`
      const explain = 'EXPLAIN FORMAT=TREE ' + sql
      for (const method of ['query', 'execute'] as const) {
        const [planRows] = method === 'query' ? await conn.query(explain) : await conn.execute(explain)
        const plan = String((planRows as string[][])[0]?.[0])
        const labels = [...plan.matchAll(/Disable deduplication\n\s+-> Table scan on (t\d)/g)].map((m) => m[1])
        assert.deepEqual(labels, kept, `${method}: ${sql}`)
        if (first === 'EXCEPT ALL' && second === 'EXCEPT ALL') {
          assert.equal([...plan.matchAll(/Except all materialize/g)].length, nested ? 2 : 1, `${method}: ${sql}`)
        }
        const [rows] = method === 'query' ? await conn.query(sql) : await conn.execute(sql)
        assert.deepEqual(rows, expected.map((v) => [v]))
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})
