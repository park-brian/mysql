// A select item's name stops where it ends, even at the end of the statement.
//
// An item's name is its source text, and the text was cut at the token after
// it. At the end of the statement that token was the end of input, which the
// cut counted as part of the item, so `SELECT 1` followed by a newline and an
// indent named its column '1\n      '. Prisma's raw queries are template
// literals that end that way, and its `query-raw` tests compare the row's
// keys: 8.4.11 names the column `1`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('a trailing newline and indent are not part of the last item', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  for (const sql of ['SELECT 1\n      ', '\n  SELECT 1, 2.5, 3 + 4\n  ', 'SELECT 1 ']) {
    for (const run of [(q: string) => conn.query(q), (q: string) => conn.execute(q)]) {
      const [, fields] = await run(sql)
      assert.deepEqual(
        (fields as { name: string }[]).map((f) => f.name),
        sql.includes('2.5') ? ['1', '2.5', '3 + 4'] : ['1'],
        JSON.stringify(sql),
      )
    }
  }
  await conn.end()
  await db.end()
})
