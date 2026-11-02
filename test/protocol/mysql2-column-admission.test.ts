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
  ['CREATE TABLE u(v INT DEFAULT(SLEEP(0)))', 3770, false],
  ['CREATE TABLE u(v INT DEFAULT(SLEEP(@x:=@x+1)))', 3772, false],
  ['CREATE TABLE u(v INT DEFAULT((SELECT 1)))', 3769, false],
  ['CREATE TABLE u(v INT DEFAULT(?))', 3769, false],
  ['ALTER TABLE t ADD COLUMN g INT DEFAULT(SLEEP(v))', 3770, false],
  ['ALTER TABLE t MODIFY COLUMN v INT DEFAULT(SLEEP(0))', 3770, false],
  ['ALTER TABLE t ALTER COLUMN v SET DEFAULT(SLEEP(0))', 3770, true],
  ['ALTER TABLE t ALTER COLUMN v SET DEFAULT((SELECT 1))', 3769, true],
  ['CREATE TABLE u(v INT DEFAULT(IF(TRUE,@x:=@x+1,LENGTH())))', 1582, false],
  ['CREATE TABLE u(v INT,g INT AS(ABS(OCTET_LENGTH(v,1))))', 1582, false],
  ['CREATE TABLE u(v INT DEFAULT((WITH c AS(SELECT LENGTH()) SELECT 1)))', 3769, false],
  ['CREATE TABLE u(v INT,g INT AS((WITH c AS(SELECT LENGTH()) SELECT 1)))', 3102, false],
  ...['LENGTH', 'OCTET_LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH'].flatMap(name => [
    [`CREATE TABLE u(v INT DEFAULT(${name}()))`, 1582, false],
    [`ALTER TABLE t ADD COLUMN g INT AS(${name}(v,1))`, 1582, false],
  ] as const),
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
        // Text protocol rejects placeholder syntax before column admission.
        else assert.equal((error as mysql.QueryError | undefined)?.errno, api === 'query' && sql.includes('?') ? 1064 : code, label)
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

// Captured against MySQL 8.4.11. Direct column roots reject arity before
// resolving arguments/table names; nested SELECT/CHECK construction is separate.
test('M5.10: direct length column constructors preserve native diagnostics and schema', async () => {
  const { conn, db } = await connection()
  let created = false
  try {
    await conn.query('CREATE DATABASE column245arity')
    created = true
    await conn.query('USE column245arity')
    await conn.query('CREATE TABLE t(v INT)')
    const definition = (await conn.query<mysql.RowDataPacket[]>('SHOW CREATE TABLE t'))[0][0]!['Create Table']
    for (const name of ['LENGTH', 'OCTET_LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH']) {
      for (const spelling of [name, name.toLowerCase(), `\`${name}\``]) {
        const written = spelling.replaceAll('`', '')
        const message = `Incorrect parameter count in the call to native function '${written}'`
        for (const args of ['', 'missing,1', 'LENGTH(),1']) {
          const call = `${spelling}(${args})`
          for (const sql of [
            `CREATE TABLE u(v INT DEFAULT(${call}))`,
            `CREATE TABLE u(v INT,g INT AS(${call}))`,
            `ALTER TABLE t ADD COLUMN g INT DEFAULT(${call})`,
            `ALTER TABLE t MODIFY COLUMN v INT AS(${call})`,
            `ALTER TABLE absent_table ADD COLUMN g INT AS(${call})`,
          ]) for (const api of apis) {
            const label = `${sql} [${api}]`
            await assert.rejects(command(conn, sql, api), (error: mysql.QueryError & { sqlMessage?: string }) => {
              assert.equal(error.errno, 1582, label)
              assert.equal(error.code, 'ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', label)
              assert.equal(error.sqlState, '42000', label)
              assert.equal(error.sqlMessage, message, label)
              return true
            })
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [{ Level: 'Error', Code: 1582, Message: message }], label)
          }
        }
      }
    }
    for (const name of ['LENGTH', 'OCTET_LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH']) {
      for (const [expression, code] of [
        [`v INT DEFAULT(column245arity.${name}())`, 3770],
        [`v INT,g INT AS(column245arity.${name}())`, 3763],
      ] as const) for (const api of apis) {
        await assert.rejects(command(conn, `CREATE TABLE u(${expression})`, api), (error: mysql.QueryError) => error.errno === code)
      }
    }
    assert.equal((await conn.query<mysql.RowDataPacket[]>('SHOW CREATE TABLE t'))[0][0]!['Create Table'], definition)
    assert.equal((await conn.query<mysql.RowDataPacket[]>('SHOW FULL TABLES'))[0].length, 1)
    for (const api of ['query', 'execute'] as const) {
      await command(conn, "CREATE TABLE u(v INT DEFAULT(LENGTH('é')),g INT AS(CHARACTER_LENGTH('é')))", api)
      await conn.query('INSERT INTO u() VALUES()')
      assert.deepEqual((await conn.query({ sql: 'SELECT * FROM u', rowsAsArray: true }))[0], [[2, 1]])
      await conn.query('DROP TABLE u')
    }
  } finally {
    if (created) await conn.query('DROP DATABASE column245arity')
    await conn.end()
    await db?.end()
  }
})

test('M5.10: nested scalar column arity precedes policy and binding with query fences intact', async () => {
  const { conn, db } = await connection()
  let created = false
  try {
    await conn.query('CREATE DATABASE column246arity')
    created = true
    await conn.query('USE column246arity')
    await conn.query('CREATE TABLE t(v INT)')
    const calls = [
      ['ABS(LENGTH())', 'LENGTH'],
      ['ABS(OCTET_LENGTH(missing,1))', 'OCTET_LENGTH'],
      ['IF(TRUE,1,CHAR_LENGTH())', 'CHAR_LENGTH'],
      ['CASE WHEN FALSE THEN CHARACTER_LENGTH() ELSE 1 END', 'CHARACTER_LENGTH'],
      ['ABS(char_length(LENGTH(),1))', 'char_length'],
      ['ABS(`CHAR_LENGTH`(LENGTH(),1))', 'CHAR_LENGTH'],
      ['IF(TRUE,LENGTH(),OCTET_LENGTH())', 'LENGTH'],
      ['CASE WHEN FALSE THEN CHAR_LENGTH() ELSE CHARACTER_LENGTH() END', 'CHAR_LENGTH'],
      ['SLEEP(LENGTH())', 'LENGTH'],
      ['stored_fn(LENGTH())', 'LENGTH'],
      ['ABS(LENGTH(@@no_such_246,1))', 'LENGTH'],
    ] as const
    for (const [call, name] of calls) {
      const message = `Incorrect parameter count in the call to native function '${name}'`
      for (const sql of [
        `CREATE TABLE u(v INT DEFAULT(${call}))`,
        `CREATE TABLE u(v INT,g INT AS(${call}))`,
        `ALTER TABLE t ADD COLUMN g INT DEFAULT(${call})`,
        `ALTER TABLE absent_table ADD COLUMN g INT AS(${call})`,
      ]) for (const api of apis) {
        const label = `${sql} [${api}]`
        await assert.rejects(command(conn, sql, api), {
          errno: 1582, code: 'ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', sqlState: '42000', sqlMessage: message,
        }, label)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [{ Level: 'Error', Code: 1582, Message: message }], label)
      }
    }
    assert.deepEqual((await conn.query({ sql: 'SELECT * FROM t', rowsAsArray: true }))[0], [])
    assert.equal((await conn.query<mysql.RowDataPacket[]>('SHOW FULL TABLES'))[0].length, 1)
    await conn.query("CREATE TABLE u(v INT DEFAULT(ABS(LENGTH('é'))),g INT AS(IF(TRUE,CHAR_LENGTH('é'),1)))")
    await conn.query('INSERT INTO u() VALUES()')
    assert.deepEqual((await conn.query({ sql: 'SELECT * FROM u', rowsAsArray: true }))[0], [[2, 1]])
  } finally {
    if (created) await conn.query('DROP DATABASE column246arity')
    await conn.end()
    await db?.end()
  }
})
