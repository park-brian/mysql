// M1.24's acceptance assertion:
// "`mysql2.createConnection({ stream: db.createStream() })` completes a full
//  session unpatched."
//
// Doc 42's rule 2 is the point: "Existing MySQL drivers must work unmodified.
// If `mysql2` needs a patch, we have failed." So this test imports the
// published `mysql2` and does nothing to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL, StubExecutor } from '@myjs/core'
import { MapAccountStore } from '@myjs/protocol'

async function connect(db: MySQL, over: Record<string, unknown> = {}) {
  return mysql.createConnection({
    // The whole interop story: mysql2 does not know there is no socket.
    stream: db.createStream() as never,
    user: 'root',
    password: '',
    ...over,
  })
}

test('mysql2 completes a handshake and SELECT 1 against the in-process engine', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    const [rows, fields] = await conn.query('SELECT 1')
    assert.deepEqual(rows, [{ 1: 1 }], 'the column is named after the expression, as MySQL does')
    assert.equal(fields.length, 1)
    assert.equal(fields[0]?.name, '1')
  } finally {
    await conn.end()
  }
})

test('mysql2 sees the version string we advertise', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    // D-10: clients sniff this and branch on it, so it must read as modern
    // MySQL without pretending to be MariaDB.
    const [rows] = await conn.query('SELECT VERSION()')
    const version = (rows as Array<Record<string, string>>)[0]?.['VERSION()'] ?? ''
    assert.match(version, /^8\.4\.\d+-myjs/)
    assert.doesNotMatch(version, /^5\.5\.5-/, 'never a MariaDB-shaped version string')
  } finally {
    await conn.end()
  }
})

test("the mysql CLI's first query — SELECT @@version_comment LIMIT 1 — is answered", async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    const [rows] = await conn.query('SELECT @@version_comment LIMIT 1')
    assert.equal((rows as Array<Record<string, string>>).length, 1)
    assert.ok('@@version_comment' in ((rows as Array<Record<string, string>>)[0] ?? {}))
  } finally {
    await conn.end()
  }
})

test('a prepared statement completes end to end through the binary protocol', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    // conn.execute prepares and executes: COM_STMT_PREPARE, COM_STMT_EXECUTE,
    // a binary resultset, and COM_STMT_CLOSE on the way out.
    const [rows] = await conn.execute('SELECT ?', ['hello'])
    assert.deepEqual(rows, [{ '?': 'hello' }])
  } finally {
    await conn.end()
  }
})

test('COM_PING round-trips', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    await conn.ping()
    await conn.ping()
  } finally {
    await conn.end()
  }
})

test('a pool ping loop does not desynchronise the connection', async () => {
  // M1.16's acceptance assertion, through a real client and the real framer,
  // so the sequence-id reset is exercised rather than asserted.
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    for (let i = 0; i < 500; i++) await conn.ping()
    const [rows] = await conn.query('SELECT 7')
    assert.deepEqual(rows, [{ 7: 7 }], 'still in step after 500 round trips')
  } finally {
    await conn.end()
  }
})

test('COM_RESET_CONNECTION works, which is what pools actually use', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    // M5: `USE` of a database that does not exist is ER_BAD_DB_ERROR, as on a
    // real server, so the database is made first.
    await conn.query('CREATE DATABASE testdb')
    await conn.query('USE testdb')
    await conn.changeUser({ user: 'root', password: '' })
    const [rows] = await conn.query('SELECT DATABASE()')
    assert.deepEqual(rows, [{ 'DATABASE()': null }], 'session state does not survive a change of user')
  } finally {
    await conn.end()
  }
})

test('a server error arrives with mysql2s error shape', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    // M5: a table that does not exist, which a real server reports the same way.
    await conn.query('CREATE DATABASE d')
    await assert.rejects(
      conn.query('DELETE FROM d.nothing'),
      (err: unknown) => {
        const e = err as { code?: string; errno?: number; sqlState?: string; sqlMessage?: string }
        assert.equal(e.code, 'ER_NO_SUCH_TABLE')
        assert.equal(e.errno, 1146)
        assert.equal(e.sqlState, '42S02')
        assert.ok(typeof e.sqlMessage === 'string' && e.sqlMessage.length > 0)
        return true
      },
    )
    // And the connection is still usable afterwards.
    const [rows] = await conn.query('SELECT 1')
    assert.deepEqual(rows, [{ 1: 1 }])
  } finally {
    await conn.end()
  }
})

test('a wrong password is refused with 1045 / 28000', async () => {
  const accounts = new MapAccountStore()
  await accounts.add('alice', 'correct')
  const db = await MySQL.open(':memory:', { accounts })
  await assert.rejects(
    connect(db, { user: 'alice', password: 'wrong' }),
    (err: unknown) => {
      const e = err as { code?: string; errno?: number; sqlState?: string }
      assert.equal(e.errno, 1045)
      assert.equal(e.sqlState, '28000')
      return true
    },
  )
})

test('a password-protected account authenticates in-process without touching RSA', async () => {
  // D-11: "In-process connections are treated as already secure, so the full
  // path degenerates to compare-and-go — no RSA, no key management." The
  // database is opened with no RSA key at all, so if the exchange reached the
  // RSA branch it could only fail.
  const accounts = new MapAccountStore()
  await accounts.add('alice', 'correct horse')
  const db = await MySQL.open(':memory:', { accounts })
  const conn = await connect(db, { user: 'alice', password: 'correct horse' })
  try {
    const [rows] = await conn.query('SELECT 1')
    assert.deepEqual(rows, [{ 1: 1 }])
  } finally {
    await conn.end()
  }
})

test('multiple statements are refused while the engine switch is off (D-13)', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db, { multipleStatements: true })
  try {
    // The client negotiated the capability; the engine switch did not.
    await assert.rejects(conn.query('SELECT 1; SELECT 2'))
  } finally {
    await conn.end()
  }
})

test('execProtocol is the same object the driver path uses', async () => {
  // D-28: bytes in, every response byte out — and the handshake is the first
  // thing out, before any request.
  const db = await MySQL.open(':memory:')
  const first = await db.execProtocol(new Uint8Array(0))
  assert.ok(first.length > 0, 'the server speaks first')
  assert.equal(first[4], 10, 'protocol_version 10 in the first packet payload')
})

test('a custom executor replaces the stub without the protocol layer noticing', async () => {
  const db = await MySQL.open(':memory:', {
    executor: new StubExecutor({ versionComment: 'a different engine' }),
  })
  const conn = await connect(db)
  try {
    const [rows] = await conn.query('SELECT @@version_comment')
    assert.deepEqual(rows, [{ '@@version_comment': 'a different engine' }])
  } finally {
    await conn.end()
  }
})

test('a handshake naming a database that does not exist is refused with 1049, as 8.4.11 refuses it', async () => {
  // Prisma connects with its database in the URL and creates the database
  // only when the connection says it is unknown; accepting it left every
  // Prisma test with no schema to push into.
  const db = await MySQL.open(':memory:')
  await assert.rejects(connect(db, { database: 'nope' }), { errno: 1049, sqlState: '42000', message: "Unknown database 'nope'" })
  const conn = await connect(db, { database: 'INFORMATION_SCHEMA' })
  try {
    const [rows] = await conn.query('SELECT DATABASE() AS d')
    assert.deepEqual(rows, [{ d: 'information_schema' }], 'the system schema is named in lower case, whatever the client wrote')
  } finally {
    await conn.end()
  }
})

test('a fresh database has the system schemas 8.4.11 has, and `mysql` cannot be made or dropped (3552)', async () => {
  // Prisma's schema engine connects to `mysql` to CREATE DATABASE its own.
  const db = await MySQL.open(':memory:')
  const conn = await connect(db, { database: 'mysql' })
  try {
    const [rows] = await conn.query('SHOW DATABASES')
    assert.deepEqual(rows, [{ Database: 'information_schema' }, { Database: 'mysql' }, { Database: 'performance_schema' }, { Database: 'sys' }])
    for (const sql of ['CREATE DATABASE mysql', 'DROP DATABASE mysql']) await assert.rejects(conn.query(sql), { errno: 3552, message: "Access to system schema 'mysql' is rejected." })
    await conn.query('CREATE DATABASE IF NOT EXISTS mysql')
  } finally {
    await conn.end()
  }
})

test('an empty statement is 1065; one of comments only is an OK, and not preparable (1295), as 8.4.11 answers', async () => {
  // Prisma's `$executeRaw(Prisma.empty)` expects 1065 "Query was empty".
  // The grammar's own rule: END_OF_INPUT is ER_EMPTY_QUERY unless the text
  // held a comment, which makes it the empty statement.
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    const empty = { errno: 1065, sqlState: '42000', message: 'Query was empty' }
    for (const sql of ['', '   ', ';']) {
      await assert.rejects(conn.query(sql), empty)
      await assert.rejects(conn.prepare(sql), empty)
    }
    for (const sql of ['/* x */', '-- c\n']) {
      const [ok] = await conn.query(sql)
      assert.equal((ok as mysql.ResultSetHeader).affectedRows, 0)
      await assert.rejects(conn.prepare(sql), { errno: 1295, sqlState: 'HY000', message: 'This command is not supported in the prepared statement protocol yet' })
    }
  } finally {
    await conn.end()
  }
})

test('a TIME column compared with a DATETIME constant compares as TIME; two constants compare as DATETIME (8.4.11)', async () => {
  // Prisma binds a TIME as a DATETIME on 1970-01-01. The server converts a
  // constant compared with a TIME column to the column's type
  // (`convert_constant_item`), so any date matches; constants alone meet as
  // DATETIME, the TIME on today's date.
  const db = await MySQL.open(':memory:')
  const conn = await connect(db, { timezone: 'Z' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE t (id INT, tm TIME, dt DATETIME)')
    await conn.query("INSERT INTO t VALUES (1, '14:37:36', '1970-01-01 14:37:36')")
    const rows = async (sql: string, params?: Date[]) => (await (params === undefined ? conn.query({ sql, rowsAsArray: true }) : conn.execute({ sql, rowsAsArray: true }, params)))[0]
    assert.deepEqual(await rows("SELECT TIME'14:37:36' = TIMESTAMP'1970-01-01 14:37:36', TIME'14:37:36' = CAST(CONCAT(CURDATE(), ' 14:37:36') AS DATETIME)"), [[0, 1]])
    assert.deepEqual(await rows("SELECT id FROM t WHERE tm = TIMESTAMP'1970-01-01 14:37:36'"), [[1]])
    assert.deepEqual(await rows("SELECT id FROM t WHERE tm = '1970-01-01 14:37:36'"), [[1]])
    assert.deepEqual(await rows("SELECT id FROM t WHERE dt = TIME'14:37:36'"), [])
    assert.deepEqual(await rows('SELECT id FROM t WHERE tm = ?', [new Date(Date.UTC(1970, 0, 1, 14, 37, 36))]), [[1]])
    assert.deepEqual(await rows('SELECT id FROM t WHERE tm = ?', [new Date(Date.UTC(2020, 5, 1, 14, 37, 36))]), [[1]])
  } finally {
    await conn.end()
  }
})

test('a `?` in a plain query is the grammar error at it, 1064, and a prepared one is a parameter (8.4.11, found by review)', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await connect(db)
  try {
    await assert.rejects(conn.query('SELECT 1 + ?, 2'), { errno: 1064, message: "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '?, 2' at line 1" })
    assert.deepEqual((await conn.query({ sql: "SELECT '?', 3", rowsAsArray: true }))[0], [['?', 3]])
    assert.deepEqual((await conn.execute({ sql: 'SELECT ? + 1', rowsAsArray: true }, [2]))[0], [[3]])
  } finally {
    await conn.end()
  }
})
