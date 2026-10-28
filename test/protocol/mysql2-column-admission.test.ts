import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'

async function connection() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const raw = mysql.createConnection({
    stream: db ? db.createStream() : connect({ host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }),
    user: 'root', ...(db ? {} : { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }),
  })
  const conn = raw.promise()
  await conn.connect()
  if (!db) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], '8.4.11')
  return { conn, db }
}

// MySQL 8.4.11: admission fails before implicit commit; reference resolution and
// ALTER SET DEFAULT execution fail after it. PREPARE never performs either write.
const cases = [
  ['CREATE TABLE u(v INT AS(SLEEP(0)))', 3763, false],
  ['CREATE TABLE u(v INT AS(@x:=@x+1))', 3772, false],
  ['CREATE TABLE u(v INT,g INT AS(SUM(SLEEP(0))))', 3763, false],
  ['CREATE TABLE u(v VARCHAR(4) CHARACTER SET latin1 COLLATE utf8mb4_bin AS(SLEEP(0)))', 1253, false],
  ['CREATE TABLE u(v INT,g INT AS(missing))', 1054, true],
  ['CREATE TABLE u(v INT,g INT AS(SUM(v)))', 1111, true],
  ['CREATE TABLE u(v INT,g INT AS(ROW_NUMBER() OVER()))', 3593, true],
  ['ALTER TABLE t ADD COLUMN g INT AS(SLEEP(v))', 3763, false],
  ['ALTER TABLE t ADD COLUMN g INT AS(missing)', 1054, true],
  ['ALTER TABLE t ALTER COLUMN v SET DEFAULT((SELECT 1))', 3769, true],
] as const
const apis = ['query', 'execute', 'prepare'] as const

async function command(conn: Awaited<ReturnType<typeof connection>>['conn'], sql: string, api: typeof apis[number]) {
  if (api !== 'query') conn.unprepare(sql)
  try {
    if (api === 'prepare') {
      const statement = await conn.prepare(sql)
      await statement.close()
    } else if (api === 'execute') await conn.execute(sql)
    else await conn.query(sql)
  } finally {
    if (api !== 'query') conn.unprepare(sql)
  }
}

test('M5.10: column admission preserves rollbackability while later resolution retains implicit commit', async () => {
  const { conn, db } = await connection()
  let created = false
  try {
    await conn.query('CREATE DATABASE column195tx')
    created = true
    await conn.query('USE column195tx')
    for (const mode of ['ERROR_FOR_DIVISION_BY_ZERO', 'IGNORE_SPACE,ERROR_FOR_DIVISION_BY_ZERO', 'ANSI_QUOTES,IGNORE_SPACE,ERROR_FOR_DIVISION_BY_ZERO']) {
      await conn.query('SET sql_mode=?', [mode])
      for (const [sql, code, late] of cases) for (const api of apis) {
        const label = `${sql} [${api}, ${mode}]`
        await conn.query('DROP TABLE IF EXISTS u')
        await conn.query('DROP TABLE IF EXISTS t')
        await conn.query('CREATE TABLE t(v INT)')
        await conn.query('SET @x=3')
        const definition = (await conn.query<mysql.RowDataPacket[]>('SHOW CREATE TABLE t'))[0][0]!['Create Table']
        const views = db?.catalog!.store.transactions.stats().openViews
        await conn.query('BEGIN')
        await conn.query('INSERT INTO t VALUES(7)')
        let error: unknown
        try { await command(conn, sql, api) } catch (e) { error = e }
        if (api === 'prepare' && late) assert.equal(error, undefined, label)
        else assert.equal((error as mysql.QueryError | undefined)?.errno, code, label)
        await conn.query('ROLLBACK')
        const rows = (await conn.query({ sql: 'SELECT * FROM t', rowsAsArray: true }))[0]
        assert.deepEqual(rows, api !== 'prepare' && late ? [[7]] : [], label + ': prior write')
        assert.equal((await conn.query<mysql.RowDataPacket[]>('SELECT CAST(@x AS CHAR) AS v'))[0][0]!.v, '3', label + ': variable')
        assert.equal((await conn.query<mysql.RowDataPacket[]>('SHOW CREATE TABLE t'))[0][0]!['Create Table'], definition, label + ': definition')
        assert.equal((await conn.query<mysql.RowDataPacket[]>('SHOW FULL TABLES'))[0].length, 1, label + ': tables')
        if (db) assert.equal(db.catalog!.store.transactions.stats().openViews, views, label + ': views')
      }
    }
  } finally {
    if (created) { await conn.query('ROLLBACK'); await conn.query('DROP DATABASE column195tx') }
    await conn.end()
    await db?.end()
  }
})

test('M5.10: a missing default database precedes column-expression admission', async () => {
  const { conn, db } = await connection()
  try {
    for (const sql of ['CREATE TABLE u(v INT AS(SLEEP(0)))', 'CREATE TABLE u(v INT DEFAULT(SLEEP(0)))', 'CREATE TABLE u(v INT AS(missing))']) for (const api of apis) {
      await assert.rejects(command(conn, sql, api), (e: mysql.QueryError) => e.errno === 1046, `${sql} [${api}]`)
    }
  } finally { await conn.end(); await db?.end() }
})
