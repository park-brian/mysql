// `x IN (…)` over a long list of constants: the answers a short list gives,
// in time that does not grow with the list times the rows.
//
// Prisma's chunking tests send `WHERE id IN (?, ?, …)` with 65,535 bind
// values, against as many rows. Compared item by item, that is 4 x 10^9
// comparisons, and the server stopped answering every other suite while it
// ran. MySQL sorts a list of constants of one comparison type and searches
// it (`in_vector`); this does the same where the order is provably the
// pairwise comparison's, and compares item by item everywhere else.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('a long IN list answers as the same list item by item does — kinds, NULLs, collations, NOT IN — and fast', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE t (id INT PRIMARY KEY, d DECIMAL(6,2), f DOUBLE, s VARCHAR(10) COLLATE utf8mb4_0900_ai_ci, b VARCHAR(10) COLLATE utf8mb4_bin)')
    const rows = Array.from({ length: 40 }, (_, i) => `(${i}, ${i / 4}, ${i / 8}, '${String.fromCharCode(97 + (i % 26))}${i}', '${String.fromCharCode(65 + (i % 26))}${i}')`)
    await conn.query(`INSERT INTO t VALUES ${rows.join(', ')}, (40, NULL, NULL, NULL, NULL)`)
    // Ten or more items take the sorted path; the same list split into
    // OR-ed short lists is compared item by item. The two must agree.
    const lists: [string, string[]][] = [
      ['id', ['3', '1', '39', '7', '100', '-1', '20', '5', '11', '13', '2.0', '30.5']],
      ['id', ['3', '1', 'NULL', '7', '100', '-1', '20', '5', '11', '13']],
      ['d', ['0.25', '1', '2.50', '7', '100', '-1', '9.75', '5', '1.125', '3']],
      ['f', ['0.125', '1', '2.5', '4.875', '100', '-1', '0.375', '5e0', '1.25', '3']],
      ['d', ['1e0', '0.5', '2.25', '4.75', '100', '-1', '0.375', '5', '1.25', '3']],
      ['s', ["'A0'", "'b1'", "'Z25'", "'c2'", "'zz'", "'E4'", "'f5'", "'G6'", "'h7'", "'I8'", "'j35'"]],
      ['b', ["'A0'", "'b1'", "'Z25'", "'C2'", "'zz'", "'E4'", "'F5'", "'g6'", "'H7'", "'i8'"]],
      ['s', ["_utf8mb4'A0' COLLATE utf8mb4_bin", "'b1'", "'z25'", "'C2'", "'zz'", "'E4'", "'F5'", "'g6'", "'H7'", "'i8'"]],
      // Trailing spaces: utf8mb4_bin pads them away, utf8mb4_0900_ai_ci
      // does not, and a tab or a NUL is no space in either.
      ['b', ["'A0 '", "'B1  '", "'C2\\t'", "'D3\\0'", "' E4'", "'F5 '", "'g6 '", "'H7'", "'I8   '", "'j9'"]],
      ['s', ["'a0 '", "'B1'", "'c2\\t'", "'d3 '", "'E4'", "'f5  '", "'G6'", "'h7'", "'I8 '", "'j9'"]],
      ['s', ["'a0 ' COLLATE utf8mb4_general_ci", "'B1'", "'c2\\t'", "'d3 '", "'E4'", "'f5  '", "'G6'", "'h7'", "'I8 '", "'j9'"]],
    ]
    for (const [column, items] of lists) {
      for (const not of ['', 'NOT ']) {
        const long = `SELECT id, ${column} ${not}IN (${items.join(', ')}) FROM t ORDER BY id`
        const pairs: string[] = []
        for (let i = 0; i < items.length; i += 3) pairs.push(`${column} IN (${items.slice(i, i + 3).join(', ')})`)
        const ored = `(${pairs.join(' OR ')})`
        const short = `SELECT id, ${not === '' ? ored : `NOT ${ored}`} FROM t ORDER BY id`
        let expected: unknown
        try {
          expected = (await conn.query({ sql: short, rowsAsArray: true }))[0]
        } catch (e) {
          expected = (e as { errno: number }).errno
        }
        let actual: unknown
        try {
          actual = (await conn.query({ sql: long, rowsAsArray: true }))[0]
        } catch (e) {
          actual = (e as { errno: number }).errno
        }
        assert.deepEqual(actual, expected, long)
      }
    }
    // Prisma's shape: as many bind values as rows, through a prepared statement.
    await conn.query('CREATE TABLE tag (id INT PRIMARY KEY)')
    const ids = Array.from({ length: 12000 }, (_, i) => i + 1)
    await conn.query(`INSERT INTO tag VALUES ${ids.map((i) => `(${i})`).join(', ')}`)
    const started = performance.now()
    const [found] = await conn.execute(`SELECT id FROM tag WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
    assert.equal((found as unknown[]).length, 12000)
    // Item by item this is 144 million comparisons, about 2.6 s here;
    // searched, under 200,000, and about 0.3 s, most of it the protocol.
    assert.ok(performance.now() - started < 1200, `${Math.round(performance.now() - started)} ms`)
  } finally {
    await conn.end()
    await db.end()
  }
})

test('a statement of more than 65,535 placeholders is 1390, and the connection goes on (8.4.11)', async () => {
  // COM_STMT_PREPARE_OK counts parameters in two bytes: one more and the
  // count wraps to 0, the client reads garbage, and the connection is lost.
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    const sql = (n: number) => `SELECT 1 IN (${Array(n).fill('?').join(',')})`
    const ok = await conn.prepare(sql(65535))
    const [rows] = await ok.execute(Array(65535).fill(2))
    assert.deepEqual(Object.values((rows as object[])[0] as object), [0])
    await ok.close()
    await assert.rejects(conn.prepare(sql(65536)), { errno: 1390, sqlState: 'HY000', message: 'Prepared statement contains too many placeholders' })
    assert.deepEqual((await conn.query('SELECT 1 AS one'))[0], [{ one: 1 }])
  } finally {
    await conn.end()
    await db.end()
  }
})
