// M5.42: the code review that opened the planner slice. Each finding as a
// test that failed before its fix; every expected answer is 8.4.11's, asked
// first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function open() {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  await conn.query('CREATE DATABASE app')
  await conn.query('USE app')
  const one = async (sql: string): Promise<unknown> => {
    const [rows] = (await conn.query({ sql, rowsAsArray: true })) as unknown as [unknown[][]]
    return rows[0]?.[0]
  }
  return { db, conn, one, end: async () => { await conn.end(); await db.end() } }
}

test('M5.42: rows whose values hold the old separator stay distinct, in DISTINCT, UNION, GROUP BY and COUNT(DISTINCT)', async () => {
  const { conn, one, end } = await open()
  try {
    // A latin1_bin sort key is the text itself, `|` included.
    await conn.query('CREATE TABLE t (a VARCHAR(10) CHARACTER SET latin1 COLLATE latin1_bin, b VARCHAR(10) CHARACTER SET latin1 COLLATE latin1_bin)')
    await conn.query("INSERT INTO t VALUES ('x|sy', 'z'), ('x', 'y|sz')")
    assert.equal(await one('SELECT COUNT(*) FROM (SELECT DISTINCT a, b FROM t) d'), 2)
    assert.equal(await one('SELECT COUNT(*) FROM (SELECT a, b FROM t UNION SELECT a, b FROM t) d'), 2)
    assert.equal(await one('SELECT COUNT(*) FROM (SELECT a, b FROM t GROUP BY a, b) d'), 2)
    assert.equal(await one('SELECT COUNT(DISTINCT a, b) FROM t'), 2)
  } finally {
    await end()
  }
})

test('M5.42: a length argument folded at compile time may read the session (CONNECTION_ID, DATABASE)', async () => {
  const { one, end } = await open()
  try {
    assert.equal(await one("SELECT LENGTH(LEFT('abcdefghijklmnopqrstuvwxyz', CONNECTION_ID())) > 0"), 1)
    assert.equal(await one("SELECT RIGHT('xapp', LENGTH(DATABASE()))"), 'app')
  } finally {
    await end()
  }
})

test('M5.42: LIKE against a 100,000-character value answers, with no stack to overflow', async () => {
  const { one, end } = await open()
  try {
    assert.equal(await one("SELECT REPEAT('a', 100000) LIKE '%b'"), 0)
    assert.equal(await one("SELECT REPEAT('a', 100000) LIKE '%a%a'"), 1)
    assert.equal(await one("SELECT 'a%c' LIKE 'a|%_' ESCAPE '|'"), 1)
    assert.equal(await one("SELECT 'abc' LIKE 'a|%_' ESCAPE '|'"), 0)
    assert.equal(await one("SELECT 'xyz' LIKE '%y%%'"), 1)
  } finally {
    await end()
  }
})

test('M5.42: GROUP_CONCAT is cut in its own charset: latin1 by the byte, utf8mb4 at a whole character, binary anywhere', async () => {
  const { conn, one, end } = await open()
  try {
    await conn.query('SET SESSION group_concat_max_len = 5')
    await conn.query('CREATE TABLE g (s VARCHAR(10) CHARACTER SET latin1, u VARCHAR(10) CHARACTER SET utf8mb4)')
    await conn.query("INSERT INTO g VALUES ('ééé', 'ééé'), ('ééé', 'ééé')")
    assert.equal(await one('SELECT HEX(GROUP_CONCAT(s)) FROM g'), 'E9E9E92CE9')
    assert.equal(await one('SELECT HEX(GROUP_CONCAT(u)) FROM g'), 'C3A9C3A9')
    assert.equal(await one('SELECT HEX(GROUP_CONCAT(CAST(u AS BINARY))) FROM g'), 'C3A9C3A9C3')
  } finally {
    await end()
  }
})

test('M5.42: a JSON container nested in another may pass 64 KiB', async () => {
  const { conn, one, end } = await open()
  try {
    await conn.query('CREATE TABLE j (d JSON)')
    await conn.query("INSERT INTO j VALUES (JSON_ARRAY(JSON_ARRAY(REPEAT('a', 70000)))), (JSON_OBJECT('k', JSON_OBJECT('v', REPEAT('b', 70000)), 'n', 1))")
    assert.equal(await one("SELECT SUM(LENGTH(COALESCE(JSON_EXTRACT(d, '$[0][0]'), JSON_EXTRACT(d, '$.k.v')))) FROM j"), '140026')
    assert.equal(await one("SELECT JSON_EXTRACT(d, '$.n') FROM j WHERE JSON_TYPE(d) = 'OBJECT'"), 1)
  } finally {
    await end()
  }
})

test('M5.42: an expression default is not in the row until it is taken, and is never evaluated for a column the row is given', async () => {
  const { conn, end } = await open()
  try {
    // A literal default is in the row from the start.
    await conn.query('CREATE TABLE t2 (a INT DEFAULT 2, b INT)')
    await conn.query('INSERT INTO t2 (b) VALUES (a)')
    await conn.query('INSERT INTO t2 (b, a) VALUES (a, 7)')
    assert.deepEqual((await conn.query({ sql: 'SELECT a, b FROM t2', rowsAsArray: true }))[0], [[2, 2], [7, 2]])
    // An expression default reads NULL until DEFAULT takes it, or the row is done.
    await conn.query('CREATE TABLE t3 (a INT DEFAULT (1 + 1), b INT)')
    await conn.query('INSERT INTO t3 (b) VALUES (a)')
    await conn.query('INSERT INTO t3 (b, a) VALUES (a + 1, 7)')
    await conn.query('INSERT INTO t3 (a, b) VALUES (DEFAULT, a)')
    await conn.query('INSERT INTO t3 SET b = a')
    assert.deepEqual((await conn.query({ sql: 'SELECT a, b FROM t3', rowsAsArray: true }))[0], [[2, null], [7, null], [2, 2], [2, null]])
    // Defaults left to the end are taken in column order, so b's reads a's.
    await conn.query('CREATE TABLE t4 (a INT DEFAULT (1 + 1), b INT DEFAULT (a * 10), c INT)')
    await conn.query('INSERT INTO t4 (c) VALUES (b)')
    await conn.query('INSERT INTO t4 (c, b) VALUES (b, 5)')
    assert.deepEqual((await conn.query({ sql: 'SELECT a, b, c FROM t4', rowsAsArray: true }))[0], [[2, 20, null], [2, 5, null]])
    // A default that would fail under strict mode fails only when it is taken.
    await conn.query("CREATE TABLE w (a INT DEFAULT (CAST('9x' AS SIGNED)), b INT)")
    await conn.query('INSERT INTO w (a, b) VALUES (5, 1)')
    await conn.query('INSERT INTO w (b, a) VALUES (a, 3)')
    assert.deepEqual((await conn.query({ sql: 'SELECT a, b FROM w', rowsAsArray: true }))[0], [[5, 1], [3, null]])
    await conn.query('CREATE TABLE u (a TINYINT DEFAULT (300), b INT)')
    const [given] = (await conn.query('INSERT IGNORE INTO u (a, b) VALUES (5, 1)')) as unknown as [{ warningStatus: number }]
    assert.equal(given.warningStatus, 0)
    const [taken] = (await conn.query('INSERT IGNORE INTO u (b) VALUES (2)')) as unknown as [{ warningStatus: number }]
    assert.equal(taken.warningStatus, 1)
  } finally {
    await end()
  }
})

test('M5.42 probe: a length bound by `?` does not size the result; the column is as wide as its string (8.4.11)', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE t (s VARCHAR(20))')
    await conn.query("INSERT INTO t VALUES ('abcdef')")
    // 80 is the whole VARCHAR(20) in utf8mb4; a literal length sizes the column, a bound one never does.
    const [bound, boundFields] = await conn.execute('SELECT LEFT(s, ?) AS l FROM t', [3])
    assert.deepEqual([bound, boundFields.map((f) => f.columnLength)], [[{ l: 'abc' }], [80]])
    const [, literalFields] = await conn.query('SELECT LEFT(s, 3) AS l FROM t')
    assert.deepEqual(literalFields.map((f) => f.columnLength), [12])
    const [, others] = await conn.execute("SELECT RIGHT(s, ?) AS r, SUBSTRING(s, 1, ?) AS m, REPEAT(s, ?) AS p, LPAD(s, ?, 'x') AS d FROM t", [2, 2, 2, 25])
    assert.deepEqual(others.map((f) => f.columnLength), [80, 80, 268435456, 268435456])
  } finally {
    await conn.end()
    await db.end()
  }
})
