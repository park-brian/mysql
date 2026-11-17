import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.52: TABLE queries use the SELECT source and preserve its field metadata', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    charset: 'utf8mb4_0900_ai_ci',
    rowsAsArray: true,
  })
  const schema = 'table_query_sources'
  const id = ['id', 'id', 3, 11, 20483, 63, 0, 't', 't', schema]
  const s = ['s', 's', 253, 80, 0, 255, 0, 't', 't', schema]
  const d = ['d', 'd', 246, 8, 0, 63, 2, 't', 't', schema]
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY, s VARCHAR(20), d DECIMAL(6,2))')
    await conn.query('CREATE TABLE u LIKE t')
    await conn.query("INSERT INTO t VALUES (1,'a',3.00),(3,NULL,1.10),(2,'x',NULL)")
    await conn.query("INSERT INTO u VALUES (10,'w',3.00),(20,'y',1.10)")

    for (const method of ['query', 'execute'] as const) {
      const read = (sql: string, params: number[] = []) => method === 'query'
        ? conn.query<RowDataPacket[]>(sql, params)
        : conn.execute<RowDataPacket[]>(sql, params)
      const check = async (sql: string, rows: readonly unknown[][], fields: readonly unknown[][], params?: number[]) => {
        const [actual, metadata] = await read(sql, params)
        assert.deepEqual(actual, rows, `${method}: ${sql}`)
        assert.deepEqual(metadata.map((f) => [f.name, f.orgName, f.columnType, f.columnLength, f.flags, f.characterSet, f.decimals, f.table, f.orgTable, f.schema]), fields, `${method}: ${sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
      }
      await check('TABLE t ORDER BY 2 DESC LIMIT 1,1', [[1, 'a', '3.00']], [id, s, d])
      await check('TABLE t ORDER BY id LIMIT ? OFFSET ?', [[2, 'x', null]], [id, s, d], [1, 1])
      await check('TABLE t FOR UPDATE', [[1, 'a', '3.00'], [2, 'x', null], [3, null, '1.10']], [id, s, d])
      await check('TABLE t UNION TABLE u ORDER BY id DESC LIMIT 3', [[20, 'y', '1.10'], [10, 'w', '3.00'], [3, null, '1.10']],
        [id, s, d].map((f, i) => [...f.slice(0, 4), i === 0 ? 1 : 0, ...f.slice(5, 7), '', '', '']))
      await check('WITH x AS (TABLE t) TABLE x ORDER BY id DESC', [[3, null, '1.10'], [2, 'x', null], [1, 'a', '3.00']],
        [id, s, d].map((f) => [...f.slice(0, 7), 'x', 't', schema]))
      await check('SELECT a FROM (TABLE t) z(a,b,c) ORDER BY a', [[1], [2], [3]], [['a', 'a', ...id.slice(2, 7), 'z', 't', schema]])

      const [plan] = await read('EXPLAIN FORMAT=TREE TABLE t ORDER BY id DESC LIMIT 1')
      assert.match(plan[0]![0], /Limit[^\n]*\n +-> Index scan on t using PRIMARY/)
      const message = "Unknown column 'missing' in 'order clause'"
      await assert.rejects(read('TABLE t ORDER BY missing'), { errno: 1054, sqlState: '42S22', sqlMessage: message })
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', 1054, message]])
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})
