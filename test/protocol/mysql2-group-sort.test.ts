// M5.49: sorting the first table must preserve the groups a lookup join expands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('plain grouping keys read in order before inner lookups, with NULLs and collation ties', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const base = 'SELECT STRAIGHT_JOIN k.s,GROUP_CONCAT(pa.name ORDER BY pa.name DESC) AS names,SUM(DISTINCT k.g) AS total,COUNT(*) AS n FROM k JOIN pa FORCE INDEX(grp) ON pa.grp=k.g GROUP BY k.s ORDER BY 1,2,3,4'
  const loop = 'Sort\n    Stream results\n        Group aggregate\n            Nested loop inner join\n                Sort\n                    Filter\n                        Table scan on k\n                Index lookup on pa using grp'
  const columns = [
    ['s', 253, 40, 0, 0, 224, 'group_sort', 'k', 'k', 's'],
    ['names', 252, 16384, 16, 0, 224, '', '', '', 'names'],
    ['total', 246, 33, 0, 0, 63, '', '', '', 'total'],
    ['n', 8, 21, 1, 0, 63, '', '', '', 'n'],
  ]
  const run = async (sql: string, expected: unknown[][], plan: string, fieldsExpected = columns) => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), fieldsExpected)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan)
    }
  }
  const releaseWriter = async () => {
    if (db === undefined) return
    const locking = base.replace('FROM k JOIN pa', 'FROM group_sort.k JOIN group_sort.pa')
    for await (const row of db.stream(`${locking} FOR UPDATE`)) {
      assert.deepEqual(row, { s: null, names: 'd,c,b', total: '5', n: 3 })
      break
    }
    const other = await db.connect()
    try {
      await other.query('SET innodb_lock_wait_timeout=1')
      await other.query("UPDATE group_sort.k SET s='qq' WHERE id=7")
    } finally {
      await other.end()
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS group_sort')
    await conn.query('USE group_sort')
    await conn.query('DROP TABLE IF EXISTS pa,k')
    await conn.query('CREATE TABLE pa(id INT PRIMARY KEY,name VARCHAR(12) NOT NULL,grp INT,KEY(grp)) STATS_AUTO_RECALC=0')
    await conn.query('CREATE TABLE k(id INT PRIMARY KEY,g INT,s VARCHAR(10)) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(1,'z',1),(2,'a',1),(3,'c',2),(4,'b',2),(5,'d',3)")
    await conn.query("INSERT INTO k VALUES(1,1,'b'),(2,2,'a'),(3,1,'A'),(4,3,NULL),(5,2,NULL),(6,NULL,'x'),(7,8,'q')")
    // Statistics make the existing planner choose lookups rather than a hash join.
    await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 100 }, (_, i) => `(${i + 10},'x${i}',${i + 10})`).join(','))
    await conn.query('ANALYZE TABLE pa,k')
    const ordered = [[null, 'd,c,b', '5', 3], ['a', 'z,c,b,a', '3', 4], ['b', 'z,a', '1', 2]]
    await run(base, ordered, loop)
    await run(base.replace('GROUP BY k.s', 'GROUP BY 1'), ordered, loop)
    await run(base.replace('k.s,GROUP_CONCAT', 'k.s AS label,GROUP_CONCAT').replace('GROUP BY k.s', 'GROUP BY label'), ordered, loop, [['label', ...columns[0]!.slice(1)], ...columns.slice(1)])
    await run(base.replace(' ORDER BY 1,2,3,4', ''), ordered, loop.split('\n').slice(2).map((s: string) => s.slice(8)).join('\n'), [
      columns[0]!,
      ['names', 251, 65536, 0, 31, 224, '', '', '', ''],
      ['total', 246, 33, 128, 0, 63, '', '', '', ''],
      ['n', 8, 21, 129, 0, 63, '', '', '', ''],
    ])
    await run(base.replace('GROUP_CONCAT(pa.name ORDER BY pa.name DESC)', 'GROUP_CONCAT(pa.name)'), [[null, 'd,c,b', '5', 3], ['a', 'c,b,z,a', '3', 4], ['b', 'z,a', '1', 2]], loop)
    await run(`${base} LIMIT 1`, ordered.slice(0, 1), `Limit\n${loop.split('\n').map((s: string) => `    ${s}`).join('\n')}`)
    await run(base.replace('GROUP BY k.s', "WHERE k.id>1 AND pa.name<>'c' GROUP BY k.s"), [[null, 'd,b', '5', 2], ['a', 'z,b,a', '3', 3]], 'Sort\n    Stream results\n        Group aggregate\n            Nested loop inner join\n                Sort\n                    Filter\n                        Index range scan on k using PRIMARY over\n                Filter\n                    Index lookup on pa using grp')
    // Keys on both tables still sort the expanded joined rows.
    const mixed = 'SELECT STRAIGHT_JOIN k.s,GROUP_CONCAT(pa.name ORDER BY pa.name) AS names FROM k JOIN pa FORCE INDEX(grp) ON pa.grp=k.g GROUP BY k.s,pa.name ORDER BY 1,2'
    await run(mixed, [[null, 'b'], [null, 'c'], [null, 'd'], ['A', 'a'], ['a', 'b'], ['a', 'c'], ['A', 'z'], ['b', 'a'], ['b', 'z']], 'Sort\n    Stream results\n        Group aggregate\n            Sort\n                Stream results\n                    Nested loop inner join\n                        Filter\n                            Table scan on k\n                        Index lookup on pa using grp', columns.slice(0, 2))
    const primary = base.replaceAll('k.s', 'k.id')
    await run(primary, [[1, 'z,a', '1', 2], [2, 'c,b', '2', 2], [3, 'z,a', '1', 2], [4, 'd', '3', 1], [5, 'c,b', '2', 2]], 'Sort\n    Stream results\n        Group aggregate\n            Nested loop inner join\n                Filter\n                    Index scan on k using PRIMARY\n                Index lookup on pa using grp', [['id', 3, 11, 4097, 0, 63, 'group_sort', 'k', 'k', 'id'], ...columns.slice(1)])
    // Abandoning either a sorted or indexed locking stream releases its writer.
    await releaseWriter()
    await run(base, ordered, loop)
    await conn.query('ALTER TABLE k ADD KEY sg(s,g)')
    await conn.query('ANALYZE TABLE k')
    const indexed = 'Sort\n    Stream results\n        Group aggregate\n            Nested loop inner join\n                Filter\n                    Covering index scan on k using sg\n                Index lookup on pa using grp'
    const inIndexOrder = [[null, 'd,c,b', '5', 3], ['A', 'z,c,b,a', '3', 4], ['b', 'z,a', '1', 2]]
    await run(base, inIndexOrder, indexed)
    await run(base.replace('GROUP_CONCAT(pa.name ORDER BY pa.name DESC)', 'GROUP_CONCAT(pa.name)'), [[null, 'c,b,d', '5', 3], ['A', 'z,a,c,b', '3', 4], ['b', 'z,a', '1', 2]], indexed)
    await run(base.replace(' ORDER BY 1,2,3,4', ''), inIndexOrder, indexed.split('\n').slice(2).map((s: string) => s.slice(8)).join('\n'), [
      ['s', 253, 40, 16392, 0, 224, 'group_sort', 'k', 'k', 's'],
      ['names', 251, 65536, 0, 31, 224, '', '', '', ''],
      ['total', 246, 33, 128, 0, 63, '', '', '', ''],
      ['n', 8, 21, 129, 0, 63, '', '', '', ''],
    ])
    await releaseWriter()
    await run(base, inIndexOrder, indexed)
    await conn.query('ALTER TABLE k DROP KEY sg,ADD KEY full_s(s)')
    await conn.query('ANALYZE TABLE k')
    await run(base, ordered, loop)
    await conn.query('ALTER TABLE k DROP KEY full_s,ADD KEY short_s(s(1))')
    await conn.query('ANALYZE TABLE k')
    await run(base, ordered, loop)
    await conn.query('ALTER TABLE k DROP KEY short_s')
    await conn.query('DELETE FROM pa WHERE id>=10')
    await conn.query('ANALYZE TABLE pa,k')
    const hash = base.replace(' FORCE INDEX(grp)', '')
    await run(hash, [[null, 'd,c,b', '5', 3], ['A', 'z,c,b,a', '3', 4], ['b', 'z,a', '1', 2]], 'Sort\n    Stream results\n        Group aggregate\n            Sort\n                Stream results\n                    Inner hash join\n                        Table scan on pa\n                        Hash\n                            Table scan on k')
    await conn.query('DELETE FROM k')
    await run(hash, [], loop)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS group_sort')
    await conn.end()
    await db?.end()
  }
})
