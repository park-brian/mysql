// M5.13 — the system variables, as 8.4.11 has them (`tools/capture-variables.mjs`):
// what `@@name` reads, what a `SET` takes and refuses, and SHOW VARIABLES as
// the query over PERFORMANCE_SCHEMA it is. Every expected answer is 8.4.11's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connected<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    return await fn(conn)
  } finally {
    await conn.end()
    await db.end()
  }
}

const rows = async (conn: mysql.Connection, sql: string): Promise<unknown[]> => (await conn.query({ sql, rowsAsArray: true }))[0] as unknown[]

test("@@name reads 8.4.11's variables in their scopes, and refuses the wrong scope with 1238", async () => {
  await connected(async (conn) => {
    assert.deepEqual(await rows(conn, 'SELECT @@max_connections, @@innodb_page_size, @@optimizer_trace_offset, @@ssl_ca, @@admin_address, @@long_query_time'), [[151, 16384, -1, 'ca.pem', null, 10]])
    // Past BIGINT's range, an unsigned integer.
    assert.deepEqual(await rows(conn, 'SELECT @@max_join_size = 18446744073709551615, @@pseudo_thread_id = CONNECTION_ID()'), [[1, 1]])
    await assert.rejects(conn.query('SELECT @@SESSION.max_connections'), { errno: 1238, message: "Variable 'max_connections' is a GLOBAL variable" })
    await assert.rejects(conn.query('SELECT @@GLOBAL.sql_log_bin'), { errno: 1238, message: "Variable 'sql_log_bin' is a SESSION variable" })
    await assert.rejects(conn.query('SELECT @@have_ssl'), { errno: 1193 })
  })
})

test('SET checks a variable as 8.4.11 does: its existence, scope, writability and type, clamping with 1292', async () => {
  await connected(async (conn) => {
    await assert.rejects(conn.query('SET GLOBAL nope = 1'), { errno: 1193, message: "Unknown system variable 'nope'" })
    await assert.rejects(conn.query('SET @@SESSION.version = 1'), { errno: 1238, message: "Variable 'version' is a read only variable" })
    await assert.rejects(conn.query('SET max_connections = 10'), { errno: 1229 })
    await assert.rejects(conn.query('SET GLOBAL sql_log_bin = 1'), { errno: 1228 })
    await assert.rejects(conn.query('SET SESSION max_allowed_packet = 1024'), { errno: 1621, message: "SESSION variable 'max_allowed_packet' is read-only. Use SET GLOBAL to assign the value" })
    await assert.rejects(conn.query("SET foreign_key_checks = 'maybe'"), { errno: 1231 })
    await assert.rejects(conn.query('SET foreign_key_checks = 2'), { errno: 1231 })
    await assert.rejects(conn.query('SET max_join_size = 1.5'), { errno: 1232 })
    await assert.rejects(conn.query("SET long_query_time = 'x'"), { errno: 1232 })
    await conn.query('SET sort_buffer_size = 1')
    assert.deepEqual(await rows(conn, 'SHOW WARNINGS'), [['Warning', 1292, "Truncated incorrect sort_buffer_size value: '1'"]])
    assert.deepEqual(await rows(conn, 'SELECT @@sort_buffer_size'), [[32768]])
    await conn.query("SET foreign_key_checks = 'off', long_query_time = 2.5")
    assert.deepEqual(await rows(conn, 'SELECT @@foreign_key_checks, @@long_query_time, @@GLOBAL.long_query_time'), [[0, 2.5, 10]])
    // A session's DEFAULT is the global value, except for the two that are bits of its options.
    await conn.query('SET sort_buffer_size = DEFAULT, foreign_key_checks = DEFAULT')
    assert.deepEqual(await rows(conn, 'SELECT @@sort_buffer_size, @@foreign_key_checks'), [[262144, 0]])
  })
})

test('SHOW VARIABLES is a query over PERFORMANCE_SCHEMA, its LIKE and WHERE and its columns as 8.4.11 answers', async () => {
  await connected(async (conn) => {
    const [found, fields] = await conn.query({ sql: "SHOW VARIABLES WHERE Variable_name LIKE 'auto%' AND Value > 0", rowsAsArray: true })
    assert.deepEqual(found, [['auto_increment_increment', '1'], ['auto_increment_offset', '1']])
    const meta = (fields as mysql.FieldPacket[]).map((f) => [f.name, f.table, f.db, f.columnLength, f.flags])
    assert.deepEqual(meta, [['Variable_name', 'session_variables', 'performance_schema', 256, 4097], ['Value', 'session_variables', 'performance_schema', 4096, 0]])
    assert.deepEqual(await rows(conn, "SHOW VARIABLES LIKE 'AUTOCOMMIT'"), [['autocommit', 'ON']])
    assert.deepEqual(await rows(conn, "SHOW VARIABLES LIKE 'admin_address'"), [['admin_address', '']])
    await conn.query('SET long_query_time = 2.5')
    assert.deepEqual(await rows(conn, "SHOW VARIABLES LIKE 'long_query%'"), [['long_query_time', '2.500000']])
    assert.deepEqual(await rows(conn, "SHOW GLOBAL VARIABLES LIKE 'long_query%'"), [['long_query_time', '10.000000']])
    assert.deepEqual(await rows(conn, "SHOW GLOBAL VARIABLES LIKE 'sql_log_bin'"), [], 'a session-only variable has no global row')
    assert.deepEqual(await rows(conn, 'SELECT COUNT(*) FROM performance_schema.session_variables UNION ALL SELECT COUNT(*) FROM performance_schema.global_variables'), [[619], [595]])
    await assert.rejects(conn.query('SELECT * FROM performance_schema.nope'), { errno: 1146 })
    await assert.rejects(conn.query('SELECT * FROM PERFORMANCE_SCHEMA.global_variables'), { errno: 1049 })
  })
})

test('SHOW STATUS counts what this server keeps: its statements, its connections, its uptime', async () => {
  await connected(async (conn) => {
    const before = Number(((await rows(conn, "SHOW SESSION STATUS LIKE 'Questions'"))[0] as [string, string])[1])
    await conn.query('SELECT 1')
    const after = Number(((await rows(conn, "SHOW SESSION STATUS LIKE 'Questions'"))[0] as [string, string])[1])
    assert.equal(after - before, 2, 'the SELECT and the SHOW itself')
    assert.deepEqual(await rows(conn, "SHOW GLOBAL STATUS WHERE Variable_name IN ('Connections', 'Threads_connected')"), [['Connections', '1'], ['Threads_connected', '1']])
  })
})
