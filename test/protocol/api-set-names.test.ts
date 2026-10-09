// SET NAMES refuses a charset the session could not then speak.
//
// It accepted every charset the registry names, and the session's next
// statement failed to decode: `SET NAMES binary` (or gbk, or sjis, which have
// no encoder here) left a connection that answered every later statement with
// "has no decoder available here". MySQL refuses the non-ASCII-compatible
// charsets for `character_set_client` with 1231 (8.4.11); the ones this
// runtime cannot transcode are refused by name. Either way the session keeps
// its charset and goes on working.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'

const CASES: readonly [string, number, RegExp][] = [
  ['SET NAMES ucs2', 1231, /Variable 'character_set_client' can't be set to the value of 'ucs2'/],
  ['SET NAMES utf32', 1231, /value of 'utf32'/],
  ['SET CHARACTER SET utf16', 1231, /value of 'utf16'/],
  ['SET NAMES filename', 1115, /Unknown character set: 'filename'/],
  ['SET NAMES nope', 1115, /Unknown character set: 'nope'/],
  ['SET NAMES binary', 1235, /'binary' is not supported/],
  ['SET NAMES sjis', 1235, /'sjis' is not supported/],
]

test('a connection charset that cannot be spoken is refused, and the session still works', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await db.connect()
  for (const [sql, errno, message] of CASES) {
    await assert.rejects(conn.query(sql), (e: { errno?: number; message: string }) => e.errno === errno && message.test(e.message), sql)
    const [rows] = await conn.query("SELECT 'é' AS e, @@character_set_client AS cs")
    assert.deepEqual(rows, [{ e: 'é', cs: 'utf8mb4' }], `after ${sql}`)
  }
  await conn.query('SET NAMES latin1')
  const [rows] = await conn.query('SELECT @@character_set_client AS cs')
  assert.deepEqual(rows, [{ cs: 'latin1' }])
  await db.end()
})
