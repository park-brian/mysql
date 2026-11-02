import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2/promise'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { MySQL } from '@myjs/core'

async function connection() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const c = await mysql.createConnection({
    stream: db ? db.createStream() : connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }),
    user: 'root', ...(db ? {} : { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }), rowsAsArray: true,
  })
  if (!db) assert.equal(String((await c.query<RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], '8.4.11')
  return { c, db }
}

// MySQL 8.4.11 constructs these warnings during text parsing and PREPARE.
// Successful cached EXECUTE starts a fresh diagnostics area without repeating them.
test('M5.10: isolated charset construction warnings retain command and cache lifetimes', async () => {
  const { c, db } = await connection()
  let created = false
  try {
    await c.query('CREATE DATABASE construction248')
    created = true
    await c.query('USE construction248')
    for (const [cs, code, message] of [
      ['utf8', 3719, "'utf8' is currently an alias for the character set UTF8MB3, but will be an alias for UTF8MB4 in a future release. Please consider using UTF8MB4 in order to be unambiguous."],
      ['utf8mb3', 1287, "'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead"],
    ] as const) for (const expression of [`CAST('é' AS CHAR CHARSET ${cs})`, `_${cs}'é'`]) {
      const warning = [['Warning', code, message]]
      const warnings = async () => (await c.query('SHOW WARNINGS'))[0]
      for (const sql of [
        `SELECT LENGTH(${expression})`,
        `CREATE TABLE u(x INT DEFAULT(LENGTH(${expression})))`,
        `CREATE TABLE u(x INT,g INT AS(LENGTH(${expression})))`,
        `CREATE TABLE u(x INT,CHECK(LENGTH(${expression})>0))`,
      ]) {
        const table = sql.startsWith('CREATE')
        await c.query('DROP TABLE IF EXISTS u')
        const [result] = await c.query(sql)
        if (table) assert.equal((result as ResultSetHeader).warningStatus, 1, sql)
        else assert.deepEqual(result, [[2]], sql)
        assert.deepEqual(await warnings(), warning, sql + ': text')
        if (!table) {
          await c.query(sql)
          assert.deepEqual(await warnings(), warning, sql + ': repeated text')
        }
        await c.query('DROP TABLE IF EXISTS u')
        c.unprepare(sql)
        const prepared = await c.prepare(sql)
        try {
          assert.deepEqual(await warnings(), warning, sql + ': prepare')
          assert.deepEqual((await c.query("SHOW TABLES LIKE 'u'"))[0], [], sql + ': prepare has no DDL effect')
          const [executed] = await prepared.execute([])
          if (table) assert.equal((executed as ResultSetHeader).warningStatus, 0, sql)
          else assert.deepEqual(executed, [[2]], sql)
          assert.deepEqual(await warnings(), [], sql + ': execute')
          if (!table) {
            await prepared.execute([])
            assert.deepEqual(await warnings(), [], sql + ': cached execute')
          }
        } finally { await prepared.close(); c.unprepare(sql) }
        await c.query('DROP TABLE IF EXISTS u')
        const again = await c.prepare(sql)
        try { assert.deepEqual(await warnings(), warning, sql + ': repeated prepare') }
        finally { await again.close(); c.unprepare(sql) }
      }
      for (const sql of [
        `SELECT LENGTH(${expression},1)`,
        `CREATE TABLE u(x INT DEFAULT(ABS(LENGTH(${expression},1))))`,
        `CREATE TABLE u(x INT,CHECK(LENGTH(${expression},1)>0))`,
      ]) for (const api of ['query', 'execute', 'prepare'] as const) {
        c.unprepare(sql)
        let failed: Promise<unknown>
        if (api === 'prepare') failed = c.prepare(sql)
        else if (api === 'query') failed = c.query(sql)
        else failed = c.execute(sql)
        const error = "Incorrect parameter count in the call to native function 'LENGTH'"
        await assert.rejects(failed, { errno: 1582, code: 'ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', sqlState: '42000', sqlMessage: error }, sql + ': ' + api)
        assert.deepEqual(await warnings(), [...warning, ['Error', 1582, error]], sql + ': ' + api)
      }
    }
    const sql = 'SELECT ' + Array.from({ length: 300 }, () => "LENGTH(CAST('x' AS CHAR CHARSET utf8))").join(',')
    for (const limit of [0, 1, 8, 64]) {
      await c.query('SET max_error_count=?', [limit])
      await c.query(sql)
      assert.equal(((await c.query('SHOW WARNINGS'))[0] as unknown[]).length, limit, 'parsed warning prefix')
      assert.equal((await c.query<RowDataPacket[]>('SELECT @@warning_count'))[0][0]![0], limit, 'parsed warning count')
      const bad = 'SELECT LENGTH(' + Array.from({ length: 300 }, () => "CAST('x' AS CHAR CHARSET utf8)").join(',') + ')'
      for (const api of ['query', 'prepare'] as const) {
        c.unprepare(bad)
        await assert.rejects(api === 'query' ? c.query(bad) : c.prepare(bad), { errno: 1582 })
        assert.equal(((await c.query('SHOW WARNINGS'))[0] as unknown[]).length, limit, 'constructor prefix')
        assert.equal((await c.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]![0], limit, 'constructor count')
        assert.equal((await c.query<RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]![0], 0, 'unretained primary error')
      }
    }
  } finally {
    if (created) await c.query('DROP DATABASE construction248')
    await c.end()
    await db?.end()
  }
})
