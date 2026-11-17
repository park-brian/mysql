import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.10: REGEXP_LIKE reports nullable operands in its result flags', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    charset: 'utf8mb4_0900_ai_ci',
    rowsAsArray: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  const schema = 'regexp_like_nullability'
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY, s VARCHAR(8) NOT NULL, n VARCHAR(8))')
    await conn.query("INSERT INTO t VALUES (1,'a','a'),(2,'b',NULL)")
    const sql = `SELECT REGEXP_LIKE('a','a'), REGEXP_LIKE(s,'a','c'), REGEXP_LIKE(n,'a'),
      REGEXP_LIKE(s,n), REGEXP_LIKE(s,'a',NULL), REGEXP_LIKE(s,'a',CAST(? AS CHAR))
      FROM t ORDER BY id`
    for (const method of ['query', 'execute'] as const) {
      const [rows, fields] = method === 'query' ? await conn.query(sql, ['u']) : await conn.execute(sql, ['u'])
      assert.deepEqual(rows, [['1', '1', '1', '1', null, '1'], ['1', '0', null, null, null, '0']], method)
      assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
        [129, 129, 128, 128, 128, 128].map((flags) => [8, 1, flags, 0, 63]), method)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], method)
      const read = (statement: string) => method === 'query' ? conn.query(statement) : conn.execute(statement)
      for (const [statement, errno, sqlMessage] of [
        ["SELECT REGEXP_LIKE(NULL, '')", 3685, 'Illegal argument to a regular expression.'],
        ["SELECT NULL NOT RLIKE '('", 3691, 'Mismatched parenthesis in regular expression.'],
        ["SELECT n REGEXP '(' FROM t WHERE id=2", 3691, 'Mismatched parenthesis in regular expression.'],
      ] as const) {
        await conn.query('DO 0')
        await assert.rejects(read(statement), { errno, sqlState: 'HY000', sqlMessage })
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', errno, sqlMessage]])
      }
      assert.deepEqual((await read("SELECT REGEXP_LIKE(NULL, '(', NULL), NULL REGEXP NULL"))[0], [[null, null]])
      assert.deepEqual((await read("SELECT NULL NOT RLIKE '(' LIMIT 0"))[0], [])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})
