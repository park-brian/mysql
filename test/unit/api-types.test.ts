// M5.39 — the query API's types, checked by `tsc` as much as by the runner.
//
// This file is part of `npm run typecheck`. Doc 42's TypeScript example is
// here verbatim, so the documented call compiles as documented; `mysql2` is
// handed `createStream()` with no cast; and a `@ts-expect-error` proves the
// rows' type is the caller's, not `any`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Duplex } from 'node:stream'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test("doc 42's TypeScript example compiles and runs as written", async () => {
  const db = await MySQL.open(':memory:')
  await db.query('CREATE DATABASE app')
  await db.query('USE app')
  await db.query('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(20), email VARCHAR(40))')
  await db.query("INSERT INTO users VALUES (1, 'ann', 'ann@example.com')")
  // --- doc 42 §TypeScript, verbatim ---
  interface User { id: number; name: string; email: string }
  const [rows] = await db.execute<User[]>(
    'SELECT * FROM users WHERE id = ?', [1])
  // ---
  assert.equal(rows[0]?.email, 'ann@example.com')
  // @ts-expect-error — the rows are `User[]`, not `any`.
  assert.equal(rows[0]?.nope, undefined)
  await db.end()
})

test('mysql2 takes createStream() as it is, and on Node it is a Duplex', async () => {
  const db = await MySQL.open(':memory:')
  const stream: Duplex = db.createStream()
  const conn = await mysql.createConnection({ stream, user: 'root', password: '' })
  const [rows] = await conn.query('SELECT 1 AS one')
  assert.deepEqual(rows, [{ one: 1 }])
  await conn.end()
  await db.end()
})

test('an option open() does not honour is refused, not ignored', async () => {
  for (const option of [{ timeZone: '+00:00' }, { sqlMode: 'ANSI' }, { characterSet: 'latin1' }, { collation: 'latin1_bin' }, { readOnly: true }]) {
    // @ts-expect-error — none of them is in MySQLOptions.
    await assert.rejects(MySQL.open(':memory:', option), { code: 'ER_NOT_SUPPORTED_YET' }, Object.keys(option)[0])
  }
})
