// M5.33 — IGNORE_SPACE: a builtin the server's lexer knows by name is a
// function only when `(` follows at once, unless the mode is set. Every
// answer below is 8.4.11's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('a space before ( makes COUNT a syntax error and NOW a stored function, unless IGNORE_SPACE is set', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE probe')
    await conn.query('USE probe')
    await conn.query('CREATE TABLE t (a INT)')
    await conn.query("SET sql_mode = ''")
    await assert.rejects(conn.query('SELECT COUNT (*) FROM t'), { errno: 1064, message: /near '\*\) FROM t'/ })
    await assert.rejects(conn.query('SELECT NOW ()'), {
      errno: 1630,
      message: "FUNCTION probe.NOW does not exist. Check the 'Function Name Parsing and Resolution' section in the Reference Manual",
    })
    await assert.rejects(conn.query('SELECT SUM (a) FROM t'), { errno: 1630 })
    // A builtin the lexer does not know by name takes a space either way.
    assert.deepEqual((await conn.query({ sql: "SELECT CONCAT ('a', 'b'), COUNT(*) FROM t", rowsAsArray: true }))[0], [['ab', 0]])
    await conn.query("SET sql_mode = 'IGNORE_SPACE'")
    assert.deepEqual((await conn.query({ sql: 'SELECT COUNT (*), NOW () IS NOT NULL FROM t', rowsAsArray: true }))[0], [[0, 1]])
  } finally {
    await conn.end()
    await db.end()
  }
})
