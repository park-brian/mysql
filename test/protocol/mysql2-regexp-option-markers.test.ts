import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.10: bare regex option markers fail at prepare after the operands bind', async () => {
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
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    const invalid = "Invalid use of parameters in '?'"
    const failures = [
      ["REGEXP_LIKE('a','a',?)", 'u', 3994, 'HY000', invalid],
      ["REGEXP_LIKE(NULL,'',(?))", 'u', 3994, 'HY000', invalid],
      ["REGEXP_INSTR('a','a',1,1,?, 'u')", 0, 3994, 'HY000', invalid],
      ["REGEXP_INSTR('a','a',1,1,2,?)", 'u', 3994, 'HY000', invalid],
      ["REGEXP_SUBSTR('a','a',1,1,?)", 'u', 3994, 'HY000', invalid],
      ["REGEXP_REPLACE('a','a','b',1,0,?)", 'u', 3994, 'HY000', invalid],
      ["REGEXP_LIKE(missing,'a',?)", 'u', 1054, '42S22', "Unknown column 'missing' in 'field list'"],
      ["REGEXP_LIKE('a','a',?,0)", 'u', 1582, '42000', "Incorrect parameter count in the call to native function 'REGEXP_LIKE'"],
      ["REGEXP_LIKE('a' COLLATE utf8mb4_bin,'a' COLLATE utf8mb4_0900_ai_ci,?)", 'u', 1267, 'HY000',
        "Illegal mix of collations (utf8mb4_bin,EXPLICIT) and (utf8mb4_0900_ai_ci,EXPLICIT) for operation 'regexp_like'"],
    ] as const
    for (const [expr, bind, errno, sqlState, sqlMessage] of failures) {
      const sql = 'SELECT ' + expr
      for (const api of ['prepare', 'execute'] as const) {
        await assert.rejects(() => api === 'prepare' ? conn.prepare(sql) : conn.execute(sql, [bind]), { errno, sqlState, sqlMessage }, api + ' ' + expr)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', errno, sqlMessage]])
      }
    }

    const accepted = [
      ["REGEXP_LIKE(CONCAT('a'), 'a', ?)", 'u', '1', 'query'],
      ["REGEXP_LIKE(?, 'a', 'u')", 'a', '1', 'execute'],
      ["REGEXP_LIKE('a', ?, 'u')", 'a', '1', 'execute'],
      ["REGEXP_LIKE('a','a',CAST(? AS CHAR))", 'u', '1', 'execute'],
      ["REGEXP_INSTR('a','a',?,1,0,'u')", 1, '1', 'execute'],
      ["REGEXP_INSTR('a','a',1,?,0,'u')", 1, '1', 'execute'],
      ["REGEXP_INSTR('a','a',1,1,CAST(? AS SIGNED),'u')", 0, '1', 'execute'],
      ["REGEXP_REPLACE('a','a',?,1,0,'u')", 'b', 'b', 'execute'],
    ] as const
    for (const [expr, bind, value, api] of accepted) {
      const sql = 'SELECT ' + expr
      if (api === 'execute') {
        await conn.prepare(sql)
        assert.deepEqual((await conn.execute(sql, [bind]))[0], [[value]], expr)
        conn.unprepare(sql)
      } else {
        assert.deepEqual((await conn.query(sql, [bind]))[0], [[value]], expr)
      }
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
