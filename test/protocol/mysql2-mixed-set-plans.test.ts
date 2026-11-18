import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('set-operation plans preserve duplicate handling and execution stages', async () => {
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
      ['INTERSECT ALL', 'INTERSECT ALL', [], [1, 2]],
      ['INTERSECT ALL', 'INTERSECT ALL', [], [1, 2], true],
      ['INTERSECT ALL', 'INTERSECT DISTINCT', [], [1, 2], true],
      ['UNION DISTINCT', 'UNION ALL', ['t2'], [1, 1, 2, 2, 2, 3, 3, 4, 5, 7]],
      ['EXCEPT ALL', 'EXCEPT ALL', [], [1, 1, 2, 2, 3, 4], true],
    ] as const
    for (const method of ['query', 'execute'] as const) {
      const run = (sql: string) => method === 'query' ? conn.query(sql) : conn.execute(sql)
      for (const [first, second, kept, expected, nested] of cases) {
        const right = `SELECT v FROM t1 ${second} SELECT v FROM t2`
        const sql = `SELECT v FROM t0 ${first} ${nested ? `(${right})` : right} ORDER BY 1`
        const [planRows] = await run('EXPLAIN FORMAT=TREE ' + sql)
        const plan = String((planRows as string[][])[0]?.[0])
        const labels = [...plan.matchAll(/Disable deduplication\n\s+-> Table scan on (t\d)/g)].map((m) => m[1])
        assert.deepEqual(labels, kept, `${method}: ${sql}`)
        if (first === 'EXCEPT ALL' && second === 'EXCEPT ALL') {
          assert.equal([...plan.matchAll(/Except all materialize/g)].length, nested ? 2 : 1, `${method}: ${sql}`)
        }
        if (first === 'INTERSECT ALL') {
          const stages = [...plan.matchAll(/Intersect (all materialize|materialize with deduplication)/g)]
          assert.deepEqual(stages.map((stage) => stage[1]), second === 'INTERSECT ALL'
            ? ['all materialize', 'all materialize']
            : ['materialize with deduplication'], `${method}: ${sql}`)
        }
        assert.deepEqual((await run(sql))[0], expected.map((v) => [v]))
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      }
      for (const [tail, stage] of [['LIMIT 2', /Append/], ['ORDER BY 1 LIMIT 2', /Union all materialize/]] as const) {
        const sql = 'SELECT v FROM t0 UNION ALL SELECT v FROM t1 ' + tail
        const [planRows] = await run('EXPLAIN FORMAT=TREE ' + sql)
        assert.match(String((planRows as string[][])[0]?.[0]), stage, `${method}: ${sql}`)
        assert.deepEqual((await run(sql))[0], [[1], [1]])
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})
