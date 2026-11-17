import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.10: regex match type u uses LF for dot and line anchors', async () => {
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
    for (const end of ['0A', '0D', '0D0A', '0B', '0C', 'C285', 'E280A8', 'E280A9']) {
      const subject = "CONCAT('a',_utf8mb4 X'" + end + "','b')"
      for (const flags of ['m', 'mu', 'm'] as const) {
        const exprs = ['a.b', '^b', 'a$'].map((pattern) => "REGEXP_LIKE(" + subject + ",'" + pattern + "','" + flags + "')")
        const sql = 'SELECT ' + exprs.join(',')
        const expected = flags === 'm' || end === '0A' ? ['0', '1', '1']
          : end === '0D0A' ? ['0', '1', '0'] : ['1', '0', '0']
        for (const method of ['query', 'execute'] as const) {
          const [rows, fields] = method === 'query' ? await conn.query(sql) : await conn.execute(sql)
          const label = method + ' with ' + flags + ' on ' + end
          assert.deepEqual(rows, [expected], label)
          assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [[8, 1, 128, 0, 63], [8, 1, 128, 0, 63], [8, 1, 128, 0, 63]], label)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], label)
        }
        conn.unprepare(sql)
      }
    }
    const subject = "CONCAT('a',CHAR(13 USING utf8mb4),'b')"
    const match = "CAST(? AS CHAR)"
    const sql = [
      "REGEXP_LIKE(" + subject + ",'(?-d)a.b'," + match + ")",
      "REGEXP_INSTR(" + subject + ",'a.b',1,1,0," + match + ")",
      "REGEXP_SUBSTR(" + subject + ",'a.b',1,1," + match + ")",
      "REGEXP_REPLACE(" + subject + ",'a.b','...',1,0," + match + ")",
    ].join(',')
    const cases = [
      ['', ['0', '0', null, 'a\rb']],
      ['u', ['0', '1', 'a\rb', '...']],
      ['', ['0', '0', null, 'a\rb']],
      ['u', ['0', '1', 'a\rb', '...']],
      [null, [null, null, null, null]],
    ] as const
    for (const [flags, expected] of cases) for (const method of ['query', 'execute'] as const) {
      const values = [flags, flags, flags, flags]
      const query = 'SELECT ' + sql
      const [rows, fields] = method === 'query' ? await conn.query(query, values) : await conn.execute(query, values)
      const label = method + ' with ' + JSON.stringify(flags)
      assert.deepEqual(rows, [expected], label)
      assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [
        [8, 1, 128, 0, 63], [8, 21, 128, 0, 63], [253, 24, 0, 31, 255], [251, 67108864, 0, 31, 255],
      ], label)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], label)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
