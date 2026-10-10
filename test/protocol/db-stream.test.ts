// M5.40 — `db.stream()`: a query's rows one at a time, never held whole.
//
// The done-when, measured: a 1,000 × 1,000 cross join streams its 1,000,000
// rows with the heap kept near its baseline, and a stream broken after ten
// rows of `FOR UPDATE` gives the writer slot back at once. The heap is read
// after a full collection, so what is counted is what is held.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
// The browser's host, over the Web Streams Node has too: it has no test of its own elsewhere.
import { createStream as webStream } from '../../packages/core/src/host/browser.ts'

setFlagsFromString('--expose-gc')
const gc = runInNewContext('gc') as () => void

const heap = (): number => {
  gc()
  gc()
  return process.memoryUsage().heapUsed
}

/** A database whose `d.t` holds the integers 1 to 1,000. */
async function thousand(): Promise<MySQL> {
  const db = await MySQL.open(':memory:')
  await db.query('CREATE DATABASE d')
  await db.query('CREATE TABLE d.t (a INT PRIMARY KEY)')
  await db.query('INSERT INTO d.t WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 1000) SELECT n FROM s')
  return db
}

/**
 * The most the heap may grow while a million rows stream past. Held whole,
 * the same rows take about 65 MB here (200,000 of them take 13), and
 * streamed the growth stays near 4 MB: the bound sits between, far from both.
 */
const BOUND = 16 * 1024 * 1024

test('1,000,000 rows stream with the heap within a fixed bound of its baseline', async () => {
  const db = await thousand()
  try {
    const base = heap()
    let rows = 0
    let peak = 0
    let sum = 0
    // No ORDER BY: a sort reads all its input before its first row (M5.23).
    for await (const row of db.stream<[number, number]>({ sql: 'SELECT x.a, y.a AS b FROM d.t x, d.t y', rowsAsArray: true })) {
      sum += row[0] - row[1]
      if (++rows % 100_000 === 0) peak = Math.max(peak, heap() - base)
    }
    assert.equal(rows, 1_000_000)
    assert.equal(sum, 0, 'every pair, as numbers')
    assert.ok(peak < BOUND, `the heap grew ${(peak / 1e6).toFixed(1)} MB over its baseline`)
  } finally {
    await db.end()
  }
})

test('breaking out of a FOR UPDATE stream frees the writer for another connection at once', async () => {
  const db = await thousand()
  try {
    let seen = 0
    for await (const row of db.stream('SELECT x.a FROM d.t x, d.t y FOR UPDATE')) {
      assert.ok(row !== undefined)
      if (++seen === 10) break
    }
    assert.equal(seen, 10)
    // A writer slot still held would make this wait out its timeout and fail with 1205.
    const other = await db.connect()
    await other.query('SET innodb_lock_wait_timeout = 1')
    const started = performance.now()
    await other.query('INSERT INTO d.t VALUES (1001)')
    assert.ok(performance.now() - started < 500, 'the write did not wait for the stream')
    await other.end()
    assert.deepEqual((await db.query('SELECT COUNT(*) AS n FROM d.t'))[0], [{ n: 1001 }])
    assert.equal(db.openConnections, 1, "the stream's connection ended with it")
  } finally {
    await db.end()
  }
})

test("a stream's rows are query()'s, and a failure part way comes after the rows before it (8.4.11)", async () => {
  const db = await thousand()
  try {
    await db.query('CREATE TABLE d.u (k INT)')
    await db.query('INSERT INTO d.u VALUES (700), (700)')
    const [queried] = await db.query('SELECT a, a * 2 AS b, NULL AS c FROM d.t WHERE a <= 300')
    const streamed: unknown[] = []
    for await (const row of db.stream('SELECT a, a * 2 AS b, NULL AS c FROM d.t WHERE a <= ?', [300])) streamed.push(row)
    assert.deepEqual(streamed, queried)
    // A subquery's 1242 at the 700th row: 8.4.11 sends the 699 rows first.
    let rows = 0
    await assert.rejects(
      (async () => {
        for await (const _ of db.stream('SELECT a, (SELECT k FROM d.u WHERE u.k = t.a) FROM d.t ORDER BY a')) rows++
      })(),
      { errno: 1242 },
    )
    assert.equal(rows, 699)
  } finally {
    await db.end()
  }
})

for (const [host, open] of [
  ['Node', (db: MySQL) => db.createStream()],
  ['browser', (db: MySQL) => Duplex.fromWeb(webStream(db.createConnection()) as unknown as Parameters<typeof Duplex.fromWeb>[0])],
] as const) test(`mysql2's own .stream() reads a streamed resultset through the ${host} host's stream, pausing as it pleases`, async () => {
  const db = await thousand()
  try {
    const conn = mysql.createConnection({ stream: open(db), user: 'root', password: '' })
    let rows = 0
    await new Promise<void>((resolve, reject) => {
      const s = conn.query('SELECT x.a FROM d.t x, d.t y WHERE y.a <= 100').stream()
      s.on('data', () => {
        // A reader that stops for a while: the server waits for it, and nothing is lost.
        if (++rows % 20_000 === 0) {
          s.pause()
          setTimeout(() => s.resume(), 20)
        }
      })
      s.on('end', resolve)
      s.on('error', reject)
    })
    assert.equal(rows, 100_000)
    await new Promise<void>((resolve) => conn.end(() => resolve()))
  } finally {
    await db.end()
  }
})
