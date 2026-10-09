// M5.8 — INSERT … ON DUPLICATE KEY UPDATE, REPLACE and INSERT IGNORE, through
// `mysql2`, against answers a real 8.4.11 gave to the same scripts (asked
// first, through the same driver, and written down here). The execution
// corpus (`execution-vectors.test.ts`) generates these statements at random;
// this file holds the cases that taught the rules, each one a script.
//
// An outcome is `[affectedRows, insertId, info, warnings]`, an errno, or rows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = number | readonly (string | number)[] | readonly (readonly (string | null)[])[]

async function run(sql: readonly string[], options: { flags?: string; mode?: string } = {}): Promise<Outcome[]> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream(),
    user: 'root',
    password: '',
    supportBigNumbers: true,
    bigNumberStrings: true,
    ...(options.flags === undefined ? {} : { flags: [options.flags] }),
  })
  const out: Outcome[] = []
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query(`SET sql_mode = '${options.mode ?? 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'}'`)
    for (const s of sql) {
      try {
        const [r] = await conn.query({ sql: s, rowsAsArray: true })
        if (Array.isArray(r)) out.push((r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v)))))
        else {
          const h = r as mysql.ResultSetHeader
          out.push([h.affectedRows, Number(h.insertId), h.info, h.warningStatus])
        }
      } catch (e) {
        out.push((e as { errno: number }).errno)
      }
    }
  } finally {
    await conn.end()
    await db.end()
  }
  return out
}

/** Compare statement by statement, so a failure names the statement. */
function agree(sql: readonly string[], actual: readonly Outcome[], expected: readonly Outcome[]): void {
  for (let i = 0; i < expected.length; i++) assert.deepEqual(actual[i], expected[i], sql[i] ?? "")
}


// `affectedRows` counts an updated row twice and, under `CLIENT_FOUND_ROWS` (which `mysql2` asks for), an
// unchanged one once. `insertId` is the updated row's id, but `LAST_INSERT_ID()` does not move for it. Each
// duplicate costs an AUTO_INCREMENT value (`cy` is 5), except inside a multi-row statement, where the next row
// reuses it (`dee` is 6, and the block of three it came from is gone: `eve` is 12).
test("M5.8: an upsert reports 2 for a row it changed, 1 for one already as asked, and the row's id", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age INT, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('ann', 1), ('bob', 2)",
    "INSERT INTO p (name, age) VALUES ('ann', 5) ON DUPLICATE KEY UPDATE age = 9",
    "INSERT INTO p (name, age) VALUES ('ann', 5) ON DUPLICATE KEY UPDATE age = 9",
    "INSERT INTO p (name, age) VALUES ('cy', 5) ON DUPLICATE KEY UPDATE age = 9",
    "INSERT INTO p (name, age) VALUES ('ann', 7), ('dee', 1), ('bob', 3) ON DUPLICATE KEY UPDATE age = VALUES(age) + 100",
    "INSERT INTO p (name, age) VALUES ('ann', 7) AS n ON DUPLICATE KEY UPDATE age = n.age + p.age",
    "INSERT INTO p (name, age) VALUES ('Ann', 7) AS n(x, y) ON DUPLICATE KEY UPDATE age = y",
    "INSERT INTO p (name) VALUES ('ann') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
    "SELECT LAST_INSERT_ID()",
    "INSERT INTO p (name) VALUES ('eve')",
    "SELECT id, name, age FROM p ORDER BY id",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [2, 1, "Records: 2  Duplicates: 0  Warnings: 0", 0],
    [2, 1, "", 0],
    [1, 0, "", 0],
    [1, 5, "", 0],
    [5, 6, "Records: 3  Duplicates: 2  Warnings: 1", 1],
    [2, 1, "", 0],
    [2, 1, "", 0],
    [1, 1, "", 0],
    [["1"]],
    [1, 12, "", 0],
    [["1", "ann", "7"], ["2", "bob", "103"], ["5", "cy", "5"], ["6", "dee", "1"], ["12", "eve", null]],
  ]
  agree(sql, await run(sql), expected)
})

test("M5.8: without CLIENT_FOUND_ROWS an unchanged upsert counts 0", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age INT, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('ann', 1)",
    "INSERT INTO p (name, age) VALUES ('ann', 1) ON DUPLICATE KEY UPDATE age = 1",
    "INSERT INTO p (name, age) VALUES ('ann', 1), ('bob', 2) ON DUPLICATE KEY UPDATE age = 1",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [1, 1, "", 0],
    [0, 0, "", 0],
    [1, 3, "Records: 2  Duplicates: 0  Warnings: 0", 0],
  ]
  agree(sql, await run(sql, { flags: "-FOUND_ROWS" }), expected)
})

// A three-row INSERT that fails on its second row costs three ids (`d` is 4). A row given its own value moves
// the handler past it (`i` is 51, and the block of two it reserved loses 52). A value that stores as 0 —
// `'0'`, `0.4` — takes the next value.
test("M5.8: AUTO_INCREMENT reserves a block per statement, and a failed statement loses the block", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age TINYINT, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('a', 1), ('b', 1000), ('c', 1)",
    "INSERT INTO p (name) VALUES ('d')",
    "INSERT INTO p (name) VALUES ('d'), ('e'), ('f')",
    "INSERT INTO p (name) VALUES ('g')",
    "INSERT INTO p (id, name) VALUES (50, 'h'), (NULL, 'i')",
    "INSERT INTO p (name) VALUES ('j')",
    "INSERT INTO p (id, name) VALUES (NULL, 'k'), (100, 'l'), (NULL, 'm')",
    "INSERT INTO p (name) VALUES ('n')",
    "INSERT INTO p (id, name) VALUES ('0', 'o'), (0.4, 'q')",
    "SELECT id, name FROM p ORDER BY id",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    1264,
    [1, 4, "", 0],
    1062,
    [1, 8, "", 0],
    [2, 51, "Records: 2  Duplicates: 0  Warnings: 0", 0],
    [1, 53, "", 0],
    [3, 54, "Records: 3  Duplicates: 0  Warnings: 0", 0],
    [1, 102, "", 0],
    [2, 103, "Records: 2  Duplicates: 0  Warnings: 0", 0],
    [["4", "d"], ["8", "g"], ["50", "h"], ["51", "i"], ["53", "j"], ["54", "k"], ["100", "l"], ["101", "m"], ["102", "n"], ["103", "o"], ["104", "q"]],
  ]
  agree(sql, await run(sql), expected)
})

// Colliding on PRIMARY (not the last unique key) deletes and tries again; on `name` (the last) it updates in
// place. Replacing a row with itself changes nothing and counts 1, not 2.
test("M5.8: REPLACE deletes the row in its way, or updates it when the key is the last UNIQUE one", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age TINYINT, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('ann', 1), ('bob', 2), ('cy', 3)",
    "REPLACE INTO p (name, age) VALUES ('ann', 5)",
    "REPLACE INTO p (id, name, age) VALUES (2, 'bob', 2)",
    "REPLACE INTO p (id, name, age) VALUES (2, 'cy', 9)",
    "REPLACE INTO p (id, name, age) VALUES (2, 'new', 9), (NULL, 'x', 1)",
    "REPLACE p (name) VALUES ('ann')",
    "SELECT id, name, age FROM p ORDER BY id",
    "CREATE TABLE k (k VARCHAR(10) PRIMARY KEY, v INT)",
    "INSERT INTO k VALUES ('a', 1)",
    "REPLACE INTO k VALUES ('A', 2)",
    "REPLACE INTO k VALUES ('A', 2)",
    "SELECT k, v FROM k",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [3, 1, "Records: 3  Duplicates: 0  Warnings: 0", 0],
    [2, 4, "", 0],
    [2, 2, "", 0],
    [3, 2, "", 0],
    [3, 5, "Records: 2  Duplicates: 1  Warnings: 0", 0],
    [2, 7, "", 0],
    [["2", "new", "9"], ["5", "x", "1"], ["7", "ann", null]],
    [0, 0, "", 0],
    [1, 0, "", 0],
    [2, 0, "", 0],
    [1, 0, "", 0],
    [["A", "2"]],
  ]
  agree(sql, await run(sql), expected)
})

// `Duplicates` under IGNORE is rows not written. A NULL for NOT NULL is the type's zero, and an id that stores
// as 0 (`'abc'`) is generated.
test("M5.8: INSERT IGNORE skips duplicates and stores bad values adjusted, with a warning each", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age TINYINT, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('ann', 1), ('bob', 2)",
    "INSERT IGNORE INTO p (name, age) VALUES ('ann', 5)",
    "INSERT IGNORE INTO p (name, age) VALUES ('ann', 5), ('cy', 1000), ('dee', NULL), ('bob', 1)",
    "INSERT IGNORE INTO p (name, age) VALUES (NULL, 5)",
    "INSERT IGNORE INTO p (name, age) VALUES (NULL, 5), ('ee', 'x')",
    "INSERT IGNORE INTO p (age) VALUES (1)",
    "INSERT IGNORE INTO p (id, name) VALUES ('abc', 'ff')",
    "INSERT IGNORE INTO p (name, age) VALUES ('ann', 2) ON DUPLICATE KEY UPDATE name = 'bob'",
    "SELECT id, name, age FROM p ORDER BY id",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [2, 1, "Records: 2  Duplicates: 0  Warnings: 0", 0],
    [0, 0, "", 1],
    [2, 4, "Records: 4  Duplicates: 2  Warnings: 3", 3],
    [1, 8, "", 1],
    [1, 9, "Records: 2  Duplicates: 1  Warnings: 3", 3],
    [0, 0, "", 2],
    [1, 12, "", 1],
    [1, 0, "", 1],
    [["1", "ann", "1"], ["2", "bob", "2"], ["4", "cy", "127"], ["5", "dee", null], ["8", "", "5"], ["9", "ee", "0"], ["12", "ff", null]],
  ]
  agree(sql, await run(sql), expected)
})

// Not 1264: the value is clamped silently, and REPLACE refuses to replace the row that holds it.
test("M5.8: a generated id past the column's range is its largest, and collides as 1062", async () => {
  const sql = [
    "CREATE TABLE q (id TINYINT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(12))",
    "INSERT INTO q VALUES (126, 'a')",
    "INSERT INTO q (name) VALUES ('b')",
    "INSERT INTO q (name) VALUES ('c')",
    "INSERT IGNORE INTO q (name) VALUES ('d'), ('e')",
    "REPLACE INTO q (name) VALUES ('f')",
    "SELECT id, name FROM q ORDER BY id",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [1, 126, "", 0],
    [1, 127, "", 0],
    1062,
    [0, 0, "Records: 2  Duplicates: 2  Warnings: 2", 2],
    1062,
    [["126", "a"], ["127", "b"]],
  ]
  agree(sql, await run(sql), expected)
})

// Rounded, a negative wrapped to 64 bits, NULL as 0. An UPDATE that evaluated it reports it as its
// `insertId`; one that matched no row did not evaluate it; a DELETE never reports one.
test("M5.8: LAST_INSERT_ID(x) sets x for later statements, and an INSERT or UPDATE reports it", async () => {
  const sql = [
    "CREATE TABLE s (id INT PRIMARY KEY, n INT)",
    "INSERT INTO s VALUES (1, 10)",
    "SELECT LAST_INSERT_ID(5), LAST_INSERT_ID()",
    "SELECT LAST_INSERT_ID(NULL), LAST_INSERT_ID()",
    "SELECT LAST_INSERT_ID(-1), LAST_INSERT_ID(2.6)",
    "UPDATE s SET n = LAST_INSERT_ID(n + 1)",
    "SELECT LAST_INSERT_ID()",
    "UPDATE s SET n = LAST_INSERT_ID(n) WHERE id = 99",
    "INSERT INTO s VALUES (2, LAST_INSERT_ID(42))",
    "DELETE FROM s WHERE id = LAST_INSERT_ID(1)",
    "SELECT LAST_INSERT_ID()",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [1, 0, "", 0],
    [["5", "5"]],
    [[null, "0"]],
    [["18446744073709551615", "3"]],
    [1, 11, "Rows matched: 1  Changed: 1  Warnings: 0", 0],
    [["11"]],
    [0, 0, "Rows matched: 0  Changed: 0  Warnings: 0", 0],
    [1, 42, "", 0],
    [1, 0, "", 0],
    [["1"]],
  ]
  agree(sql, await run(sql), expected)
})

// A bare name under `AS n` is ambiguous (1052), the alias has only the inserted columns (1054 for `n.id`),
// a column list of the wrong length is 1353, and an alias named like the table is 1066. An AUTO_INCREMENT
// column's DEFAULT is 0, and an upsert that sets the id reports it.
test("M5.8: a row alias is the INSERT's own columns, and VALUES() costs a deprecation warning a call", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age INT, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('ann', 1)",
    "INSERT INTO p (name, age) VALUES ('ann', 7) AS n ON DUPLICATE KEY UPDATE age = age + 1",
    "INSERT INTO p (name, age) VALUES ('ann', 7) AS n ON DUPLICATE KEY UPDATE age = n.id",
    "INSERT INTO p (name, age) VALUES ('ann', 7) AS n(x) ON DUPLICATE KEY UPDATE age = 1",
    "INSERT INTO p (name, age) VALUES ('ann', 7) AS p ON DUPLICATE KEY UPDATE age = 1",
    "INSERT INTO p (name) VALUES ('ann') ON DUPLICATE KEY UPDATE age = VALUES(id) + VALUES(age) + VALUES(age)",
    "INSERT INTO p SET name = 'ann', age = 2 AS n ON DUPLICATE KEY UPDATE age = n.age",
    "INSERT INTO p (name, age) VALUES ('ann', 7) ON DUPLICATE KEY UPDATE age = DEFAULT",
    "INSERT INTO p (name, age) VALUES ('ann', 7) ON DUPLICATE KEY UPDATE id = 50",
    "INSERT INTO p (name) VALUES ('bob')",
    "SELECT VALUES(age) FROM p",
    "SELECT id, name, age FROM p ORDER BY id",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    [1, 1, "", 0],
    1052,
    1054,
    1353,
    1066,
    [2, 1, "", 3],
    [2, 1, "", 0],
    [2, 1, "", 0],
    [2, 50, "", 0],
    [1, 51, "", 0],
    [[null], [null]],
    [["50", "ann", null], ["51", "bob", null]],
  ]
  agree(sql, await run(sql), expected)
})

// An upsert's own assignment of NULL is refused unless IGNORE; an UPDATE's is the type's zero and a warning.
test("M5.8: outside a strict mode, NULL into NOT NULL is refused for one row and adjusted for several", async () => {
  const sql = [
    "CREATE TABLE p (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL, age TINYINT NOT NULL, UNIQUE KEY (name))",
    "INSERT INTO p (name, age) VALUES ('a', NULL)",
    "INSERT INTO p (name, age) VALUES ('b', NULL), ('c', 1)",
    "INSERT INTO p (name, age) VALUES ('c', 2) ON DUPLICATE KEY UPDATE age = NULL",
    "INSERT IGNORE INTO p (name, age) VALUES ('c', 2) ON DUPLICATE KEY UPDATE age = NULL",
    "UPDATE p SET age = NULL WHERE name = 'b'",
    "UPDATE p SET id = DEFAULT WHERE name = 'b'",
    "SELECT id, name, age FROM p ORDER BY id",
  ]
  const expected: Outcome[] = [
    [0, 0, "", 0],
    1048,
    [2, 1, "Records: 2  Duplicates: 0  Warnings: 1", 1],
    1048,
    [2, 2, "", 1],
    [1, 0, "Rows matched: 1  Changed: 0  Warnings: 1", 1],
    [1, 0, "Rows matched: 1  Changed: 1  Warnings: 0", 0],
    [["0", "b", "0"], ["2", "c", "0"]],
  ]
  agree(sql, await run(sql, { mode: "" }), expected)
})

// --- M5.8's review: each finding a test that failed before its fix, against 8.4.11's answers ---

/** A connection to a fresh in-memory database with one table, and the flags a query's columns carry. */
async function flagsOf(): Promise<{
  flags: (sql: string, params?: unknown[]) => Promise<number[]>
  prepared: (sql: string) => Promise<number[]>
  query: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true })
  await conn.query('CREATE DATABASE app')
  await conn.query('USE app')
  await conn.query('CREATE TABLE t (u INT UNIQUE, a INT, b INT, x INT PRIMARY KEY)')
  await conn.query('INSERT INTO t VALUES (NULL, 5, 1, 1), (NULL, 5, 2, 2), (3, 6, 1, 3)')
  return {
    async flags(sql, params) {
      const [, fields] = params === undefined ? await conn.query(sql) : await conn.execute(sql, params as (string | number)[])
      return (fields as { flags: number }[]).map((f) => f.flags)
    },
    async prepared(sql) {
      const st = (await conn.prepare(sql)) as unknown as { statement?: { columns: { flags: number }[] }; columns?: { flags: number }[] }
      return (st.statement?.columns ?? st.columns ?? []).map((f) => f.flags)
    },
    async query(sql) {
      const [rows] = await conn.query({ sql, rowsAsArray: true })
      return rows
    },
    async close() {
      await conn.end()
      await db.end()
    },
  }
}

test('M5.8 review: LAST_INSERT_ID(x) saturates a value past 64 bits rather than wrapping it', async () => {
  // A negative integer wraps (-1 is 2^64 - 1), but a non-integer past the
  // signed range saturates at 2^63 - 1, and one below it is 1690.
  const sql = ['SELECT LAST_INSERT_ID(1e30), LAST_INSERT_ID()', 'SELECT LAST_INSERT_ID(18446744073709551616)', 'SELECT LAST_INSERT_ID(-1e30)', 'SELECT LAST_INSERT_ID(-1)']
  const expected: Outcome[] = [[["9223372036854775807", "9223372036854775807"]], [["9223372036854775807"]], 1690, [["18446744073709551615"]]]
  agree(sql, await run(sql), expected)
})

test('M5.8 review: a row alias may not name a column twice', async () => {
  const sql = [
    'CREATE TABLE t (x INT PRIMARY KEY, v INT)',
    'INSERT INTO t (x, v) VALUES (1, 2) AS n(a, A) ON DUPLICATE KEY UPDATE v = 1',
  ]
  agree(sql, await run(sql), [[0, 0, '', 0], 1060])
})

test('M5.8 review: what pins a DISTINCT column, and what does not', async () => {
  const t = await flagsOf()
  try {
    // A nullable UNIQUE key matched with `<=> NULL` matches many rows, so the
    // table is not a constant one and the temporary table is made.
    assert.deepEqual(await t.flags('SELECT DISTINCT b FROM t WHERE u <=> NULL'), [32768])
    // A value shared by every branch of an OR pins the column, through AND.
    assert.deepEqual(await t.flags('SELECT DISTINCT a, b FROM t WHERE (a = 5 AND b = 1) OR (a = 5 AND b = 2)'), [0, 32768])
    // Two placeholders are two values, whatever they are bound to.
    assert.deepEqual(await t.flags('SELECT DISTINCT a FROM t WHERE a = ? OR a = ?', [5, 5]), [32768])
    // NULL pins nothing, and `c = NULL` is not folded to false.
    assert.deepEqual(await t.flags('SELECT DISTINCT a FROM t WHERE a <=> NULL'), [32768])
    assert.deepEqual(await t.flags('SELECT DISTINCT b FROM t WHERE a = NULL'), [32768])
  } finally {
    await t.close()
  }
})

test('M5.8 review: a prepare reports a DISTINCT before MySQL optimizes it, and runs nothing', async () => {
  const t = await flagsOf()
  try {
    // The temporary table is the optimizer's, and COM_STMT_PREPARE's metadata
    // comes before the optimizer: no GROUP_FLAG there, GROUP_FLAG on execute.
    assert.deepEqual(await t.prepared('SELECT DISTINCT b FROM t WHERE a > ?'), [0])
    assert.deepEqual(await t.flags('SELECT DISTINCT b FROM t WHERE a > ?', [1]), [32768])
    // Neither a prepare nor a WHERE MySQL knows to be false evaluates a call.
    await t.prepared('SELECT DISTINCT b FROM t WHERE LAST_INSERT_ID(7) = 7')
    await t.query('SELECT DISTINCT b FROM t WHERE LAST_INSERT_ID(8) = 8 AND 1 = 0')
    assert.deepEqual(await t.query('SELECT LAST_INSERT_ID()'), [['0']])
  } finally {
    await t.close()
  }
})
