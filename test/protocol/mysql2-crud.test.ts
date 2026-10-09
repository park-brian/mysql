// M5.17 — a real table, end to end, through an unmodified `mysql2`.
//
// Doc 42's promise is that swapping a real connection for ours changes
// nothing in the application. Until M5 that held for `SELECT 1`; this is the
// first time it is tested over storage: DDL, writes through both protocols,
// reads in MySQL's order, MySQL's counters, transactions, and two connections
// contending for the one writer slot (D-53).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connect(db: MySQL, database?: string) {
  return mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', ...(database === undefined ? {} : { database }) })
}

type Err = { errno?: number; sqlState?: string; code?: string; message?: string }
const errno = (n: number, state?: string) => (e: unknown) => {
  const x = e as Err
  assert.equal(x.errno, n, x.message ?? "")
  if (state !== undefined) assert.equal(x.sqlState, state)
  return true
}

async function seeded() {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  await conn.query('CREATE DATABASE app')
  await conn.query('USE app')
  await conn.query(
    'CREATE TABLE people (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL UNIQUE, age INT, score DECIMAL(6,2), born DATE)',
  )
  return { db, conn }
}

test('M5.17: CREATE, INSERT through both protocols, and insertId', async () => {
  const { db, conn } = await seeded()
  try {
    const [multi] = (await conn.query("INSERT INTO people (name, age, score) VALUES ('bob', 30, 1.5), ('ann', 20, 2.25)")) as [mysql.ResultSetHeader, unknown]
    assert.equal(multi.affectedRows, 2)
    assert.equal(multi.insertId, 1)
    assert.equal(multi.info, 'Records: 2  Duplicates: 0  Warnings: 0')
    const [one] = (await conn.execute('INSERT INTO people (name, age, born) VALUES (?, ?, ?)', ['cy', 41, '1983-04-05'])) as [mysql.ResultSetHeader, unknown]
    assert.equal(one.affectedRows, 1)
    assert.equal(one.insertId, 3)
    const [rows] = await conn.query('SELECT id, name, age, score, born FROM people ORDER BY id')
    assert.deepEqual(rows, [
      { id: 1, name: 'bob', age: 30, score: '1.50', born: null },
      { id: 2, name: 'ann', age: 20, score: '2.25', born: null },
      { id: 3, name: 'cy', age: 41, score: null, born: new Date('1983-04-05T00:00:00Z') },
    ])
    const [ids] = await conn.query('SELECT LAST_INSERT_ID() AS id')
    assert.deepEqual(ids, [{ id: 3 }])
  } finally {
    await conn.end()
    await db.end()
  }
})

test('M5.17: a duplicate is ER_DUP_ENTRY with mysql2s error shape, and leaves nothing behind', async () => {
  const { db, conn } = await seeded()
  try {
    await conn.query("INSERT INTO people (name) VALUES ('ann')")
    // utf8mb4_0900_ai_ci: 'ANN' is 'ann'. The second row of a multi-row
    // INSERT fails, and the first is undone with it (statement atomicity).
    await assert.rejects(conn.query("INSERT INTO people (name) VALUES ('zed'), ('ANN')"), (e: unknown) => {
      errno(1062, '23000')(e)
      assert.equal((e as Err).code, 'ER_DUP_ENTRY')
      assert.equal((e as Err).message, "Duplicate entry 'ANN' for key 'people.name'")
      return true
    })
    const [rows] = await conn.query('SELECT name FROM people')
    assert.deepEqual(rows, [{ name: 'ann' }])
    await assert.rejects(conn.query('INSERT INTO people (age) VALUES (1)'), errno(1364))
    await assert.rejects(conn.query("INSERT INTO people (name, age) VALUES ('x', 'many')"), errno(1366))
    await assert.rejects(conn.query("INSERT INTO people (name) VALUES ('this name is too long for it')"), errno(1406, '22001'))
    await assert.rejects(conn.query('SELECT nope FROM people'), errno(1054, '42S22'))
    await assert.rejects(conn.query('SELECT * FROM nowhere'), errno(1146, '42S02'))
  } finally {
    await conn.end()
    await db.end()
  }
})

test('M5.17: SELECT orders by collation, filters, and limits', async () => {
  const { db, conn } = await seeded()
  try {
    await conn.query("INSERT INTO people (name, age) VALUES ('b', 3), ('A', 1), ('c', NULL), ('B2', 2)")
    const [ordered] = await conn.query('SELECT name FROM people ORDER BY name')
    assert.deepEqual(ordered, [{ name: 'A' }, { name: 'b' }, { name: 'B2' }, { name: 'c' }], "collation order, not code-point order: 'A' < 'b' < 'B2'")
    const [page] = await conn.execute('SELECT name, age FROM people WHERE age IS NOT NULL ORDER BY age DESC LIMIT ? OFFSET ?', ['1', '1'])
    assert.deepEqual(page, [{ name: 'B2', age: 2 }])
    const [byKey] = await conn.execute('SELECT name FROM people WHERE id IN (4, 2, 99)')
    assert.deepEqual(byKey, [{ name: 'A' }, { name: 'B2' }], 'an IN list on the primary key, in key order')
    const [nulls] = await conn.query('SELECT name FROM people WHERE age = NULL OR age IS NULL')
    assert.deepEqual(nulls, [{ name: 'c' }])
    const [like] = await conn.query("SELECT name FROM people WHERE name LIKE 'b%' ORDER BY id")
    assert.deepEqual(like, [{ name: 'b' }, { name: 'B2' }])
    const [, fields] = await conn.query('SELECT id, name FROM people LIMIT 0')
    assert.deepEqual(
      (fields as mysql.FieldPacket[]).map((f) => [f.name, f.columnType, f.columnLength, f.flags]),
      [
        ['id', 3, 11, 16899],
        ['name', 253, 80, 20485],
      ],
      'the metadata a real 8.4.11 sends for these columns',
    )
  } finally {
    await conn.end()
    await db.end()
  }
})

test('M5.17: UPDATE counts changed rows, or matched rows under CLIENT_FOUND_ROWS', async () => {
  const { db, conn } = await seeded()
  try {
    await conn.query("INSERT INTO people (name, age) VALUES ('a', 1), ('b', 2), ('c', NULL)")
    // mysql2 negotiates CLIENT_FOUND_ROWS, so affectedRows counts matched rows.
    const [same] = (await conn.query('UPDATE people SET age = 1 WHERE id = 1')) as [mysql.ResultSetHeader, unknown]
    assert.equal(same.affectedRows, 1)
    assert.equal(same.changedRows, 0)
    assert.equal(same.info, 'Rows matched: 1  Changed: 0  Warnings: 0')
    const [bump] = (await conn.query('UPDATE people SET age = age + 10, name = CONCAT(name, age) WHERE age IS NOT NULL')) as [mysql.ResultSetHeader, unknown]
    assert.equal(bump.changedRows, 2)
    // Assignments apply left to right: the name sees the new age.
    const [rows] = await conn.query('SELECT name, age FROM people ORDER BY id')
    assert.deepEqual(rows, [{ name: 'a11', age: 11 }, { name: 'b12', age: 12 }, { name: 'c', age: null }])
    const [gone] = (await conn.execute('DELETE FROM people WHERE age > ? ORDER BY id DESC LIMIT 1', [10])) as [mysql.ResultSetHeader, unknown]
    assert.equal(gone.affectedRows, 1)
    const [left] = await conn.query('SELECT name FROM people ORDER BY id')
    assert.deepEqual(left, [{ name: 'a11' }, { name: 'c' }])
  } finally {
    await conn.end()
    await db.end()
  }
})

test('M5.17: transactions — rollback, savepoints, and a failed statement that leaves its transaction open', async () => {
  const { db, conn } = await seeded()
  try {
    await conn.beginTransaction()
    await conn.query("INSERT INTO people (name) VALUES ('kept')")
    await conn.query('SAVEPOINT s1')
    await conn.query("INSERT INTO people (name) VALUES ('undone')")
    await conn.query('ROLLBACK TO SAVEPOINT s1')
    await assert.rejects(conn.query("INSERT INTO people (name) VALUES ('kept')"), errno(1062))
    await conn.commit()
    const [rows] = await conn.query('SELECT name FROM people')
    assert.deepEqual(rows, [{ name: 'kept' }])

    await conn.query('START TRANSACTION')
    await conn.query("INSERT INTO people (name) VALUES ('never')")
    await conn.query('ROLLBACK')
    const [after] = await conn.query('SELECT name FROM people')
    assert.deepEqual(after, [{ name: 'kept' }])

    await conn.query('SET autocommit = 0')
    await conn.query("INSERT INTO people (name) VALUES ('implicit')")
    await conn.query('ROLLBACK')
    await conn.query('SET autocommit = 1')
    const [still] = await conn.query('SELECT name FROM people')
    assert.deepEqual(still, [{ name: 'kept' }])
  } finally {
    await conn.end()
    await db.end()
  }
})

test('M5.17: one writer — a second writer waits, and times out with ER_LOCK_WAIT_TIMEOUT', async () => {
  const { db, conn } = await seeded()
  const other = await connect(db, 'app')
  try {
    await conn.beginTransaction()
    await conn.query("INSERT INTO people (name) VALUES ('first')")
    // A reader is never blocked, and does not see the uncommitted row.
    const [seen] = await other.query('SELECT name FROM people')
    assert.deepEqual(seen, [])
    await other.query('SET innodb_lock_wait_timeout = 1')
    const started = Date.now()
    await assert.rejects(other.query("INSERT INTO people (name) VALUES ('second')"), errno(1205, 'HY000'))
    assert.ok(Date.now() - started >= 900, 'it waited for the timeout rather than failing at once')
    // A writer that waits gets the slot once the first commits.
    const waiting = other.query("INSERT INTO people (name) VALUES ('third')")
    await new Promise((r) => setTimeout(r, 50))
    await conn.commit()
    await waiting
    const [rows] = await other.query('SELECT name FROM people ORDER BY id')
    assert.deepEqual(rows, [{ name: 'first' }, { name: 'third' }])
  } finally {
    await other.end()
    await conn.end()
    await db.end()
  }
})

test('M5.17: a connection that goes away mid-transaction releases the writer', async () => {
  const { db, conn } = await seeded()
  const other = await connect(db, 'app')
  try {
    await other.beginTransaction()
    await other.query("INSERT INTO people (name) VALUES ('orphan')")
    other.destroy()
    await new Promise((r) => setTimeout(r, 10))
    await conn.query("INSERT INTO people (name) VALUES ('next')")
    const [rows] = await conn.query('SELECT name FROM people')
    assert.deepEqual(rows, [{ name: 'next' }], 'the orphaned transaction was rolled back')
  } finally {
    await conn.end()
    await db.end()
  }
})
