// M5.37 — a bulk statement does not stall the other connections.
//
// Prisma's chunking tests send a 32,000-row INSERT and a 32,000-item IN list
// as one prepared statement each, and its suite runs files in parallel, each
// file connecting while another's statement runs. A statement that holds the
// event loop for over a second starves those handshakes, and they time out
// ("Can't reach database server"): the drift in Prisma's count that M5.32
// chased with per-row speed. What other connections need is latency, not
// throughput: a statement that yields between batches (D-77).
//
// So connection A runs the bulk statements, each long enough that a stall
// would show, while connection B times `SELECT 1` round trips. The bound is
// B's slowest round trip.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

/** Prisma chunks a statement at 32,766 parameters; these are as large. */
const ROWS = 32_000
/**
 * The longest a second connection may go unanswered while a bulk statement
 * runs: a third of the statement's own time, so that a loaded machine, which
 * slows both alike, does not decide the result. Run alone it is under 200 ms
 * in about 1 s; unpaused, the statement holds it for three quarters of its run.
 */
const bound = (took: number): number => took / 3

/**
 * A statement that never paused lets B in only once it has finished, so B is
 * answered once or twice however long it ran; three answers mean it paused.
 * This, not a floor on the statement's time, is what makes the bound below
 * meaningful, so the test still holds once the statement gets faster.
 */
const answered = (what: string, r: { took: number; trips: number }): string =>
  `SELECT 1 was answered ${r.trips} times during the ${what} (${r.took.toFixed(0)} ms): it did not pause`

/** Run `work` on one connection while another asks `SELECT 1` every 5 ms; the longest it went unanswered, and the work's duration. */
async function whileTiming(db: MySQL, work: (conn: Awaited<ReturnType<MySQL['connect']>>) => Promise<unknown>): Promise<{ slowest: number; took: number; trips: number }> {
  const a = await db.connect()
  const b = await db.connect()
  let done = false
  let slowest = 0
  let trips = 0
  // A round trip's own time misses a stall: its clock starts only once the
  // stalled loop lets it run. What B sees is the gap between one answer and
  // the next, with a 5 ms pause between asking.
  const probe = (async () => {
    // The test for `done` follows a measurement, so the answer that comes
    // after a stall is counted even when the work has finished meanwhile.
    let last = performance.now()
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await b.query('SELECT 1')
      const now = performance.now()
      slowest = Math.max(slowest, now - last)
      last = now
      trips++
      if (done) break
    }
  })()
  const started = performance.now()
  // Let the probe start first, so a stall at the statement's beginning is seen.
  await new Promise((resolve) => setTimeout(resolve, 20))
  const before = trips
  await work(a)
  const during = trips - before
  const took = performance.now() - started
  done = true
  await probe
  await a.end()
  await b.end()
  return { slowest, took, trips: during }
}

test('a 32,000-row prepared INSERT, a 32,000-item IN-list SELECT and DELETE leave other connections answered', async () => {
  const db = await MySQL.open(':memory:')
  await db.query('CREATE DATABASE d')
  await db.query("CREATE TABLE d.t (id INT PRIMARY KEY, v VARCHAR(20) DEFAULT 'row')")
  const ids = Array.from({ length: ROWS }, (_, i) => i + 1)

  const insert = await whileTiming(db, (a) => a.execute(`INSERT INTO d.t (id) VALUES ${ids.map(() => '(?)').join(', ')}`, ids))
  const [[count]] = (await db.query('SELECT COUNT(*) AS n FROM d.t')) as unknown as [[{ n: number }]]
  assert.equal(count?.n, ROWS)
  assert.ok(insert.trips >= 3, answered('INSERT', insert))
  assert.ok(insert.slowest < bound(insert.took), `SELECT 1 waited ${insert.slowest.toFixed(0)} ms while the INSERT ran (${insert.took.toFixed(0)} ms, ${insert.trips} round trips)`)

  // M5.38: a read pauses too, holding no writer slot, and finds its place again if the tree changed meanwhile.
  let found = 0
  const select = await whileTiming(db, async (a) => {
    const [rows] = await a.execute(`SELECT id, v FROM d.t WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
    found = (rows as unknown[]).length
  })
  assert.equal(found, ROWS)
  assert.ok(select.trips >= 3, answered('SELECT', select))
  assert.ok(select.slowest < bound(select.took), `SELECT 1 waited ${select.slowest.toFixed(0)} ms while the IN-list SELECT ran (${select.took.toFixed(0)} ms, ${select.trips} round trips)`)

  const remove = await whileTiming(db, (a) => a.execute(`DELETE FROM d.t WHERE id IN (${ids.map(() => '?').join(', ')})`, ids))
  assert.ok(remove.trips >= 3, answered('DELETE', remove))
  assert.ok(remove.slowest < bound(remove.took), `SELECT 1 waited ${remove.slowest.toFixed(0)} ms while the DELETE ran (${remove.took.toFixed(0)} ms, ${remove.trips} round trips)`)
  await db.end()
})

/** Start a 32,000-row INSERT on a connection of its own, and give it time to be writing. */
async function midInsert(db: MySQL, before?: string): Promise<{ destroy: () => void }> {
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  if (before !== undefined) await conn.query(before)
  const ids = Array.from({ length: ROWS }, (_, i) => i + 1)
  // `mysql2` never settles a command its connection was destroyed under, so nothing waits for this one.
  void conn.execute(`INSERT INTO d.t (id) VALUES ${ids.map(() => '(?)').join(', ')}`, ids).catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 400))
  return { destroy: () => conn.destroy() }
}

test('a connection closed while its statement is paused leaves nothing written, and the writer free', async () => {
  for (const before of [undefined, 'BEGIN']) {
    const db = await MySQL.open(':memory:')
    await db.query('CREATE DATABASE d')
    await db.query("CREATE TABLE d.t (id INT PRIMARY KEY, v VARCHAR(20) DEFAULT 'row')")
    const a = await midInsert(db, before)
    a.destroy()
    // The statement learns of the close at its next pause and rolls back,
    // giving the writer slot back: a slot kept would make this INSERT wait
    // out its lock timeout and fail with 1205.
    await db.query('SET innodb_lock_wait_timeout = 10')
    await db.query('INSERT INTO d.t (id) VALUES (-1)')
    const [rows] = await db.query('SELECT COUNT(*) AS n FROM d.t')
    assert.deepEqual(rows, [{ n: 1 }], before ?? 'autocommit')
    await db.end()
  }
})

test('a database closed while a statement is paused reopens with nothing of it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myjs-pause-'))
  try {
    const db = await MySQL.open(dir)
    await db.query('CREATE DATABASE d')
    await db.query("CREATE TABLE d.t (id INT PRIMARY KEY, v VARCHAR(20) DEFAULT 'row')")
    await midInsert(db)
    await db.end()
    const again = await MySQL.open(dir)
    const [rows] = await again.query('SELECT COUNT(*) AS n FROM d.t')
    assert.deepEqual(rows, [{ n: 0 }])
    await again.query('INSERT INTO d.t (id) VALUES (1)')
    await again.end()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
