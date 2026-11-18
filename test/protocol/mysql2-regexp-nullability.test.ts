import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    charset: 'utf8mb4_0900_ai_ci',
    rowsAsArray: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  return { db, conn, host }
}

test('M5.10: REGEXP_LIKE reports nullable operands in its result flags', async () => {
  const { db, conn, host } = await connect()
  const schema = 'regexp_like_nullability'
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY, s VARCHAR(8) NOT NULL, n VARCHAR(8))')
    await conn.query("INSERT INTO t VALUES (1,'a','a'),(2,'b',NULL)")
    const sql = `SELECT REGEXP_LIKE('a','a'), REGEXP_LIKE(s,'a','c'), REGEXP_LIKE(n,'a'),
      REGEXP_LIKE(s,n), REGEXP_LIKE(s,'a',NULL), REGEXP_LIKE(s,'a',CAST(? AS CHAR))
      FROM t ORDER BY id`
    for (const method of ['query', 'execute'] as const) {
      const [rows, fields] = method === 'query' ? await conn.query(sql, ['u']) : await conn.execute(sql, ['u'])
      assert.deepEqual(rows, [['1', '1', '1', '1', null, '1'], ['1', '0', null, null, null, '0']], method)
      assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
        [129, 129, 128, 128, 128, 128].map((flags) => [8, 1, flags, 0, 63]), method)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], method)
      const read = (statement: string) => method === 'query' ? conn.query(statement) : conn.execute(statement)
      for (const [statement, errno, sqlMessage] of [
        ["SELECT REGEXP_LIKE(NULL, '')", 3685, 'Illegal argument to a regular expression.'],
        ["SELECT NULL NOT RLIKE '('", 3691, 'Mismatched parenthesis in regular expression.'],
        ["SELECT n REGEXP '(' FROM t WHERE id=2", 3691, 'Mismatched parenthesis in regular expression.'],
      ] as const) {
        await conn.query('DO 0')
        await assert.rejects(read(statement), { errno, sqlState: 'HY000', sqlMessage })
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', errno, sqlMessage]])
      }
      assert.deepEqual((await read("SELECT REGEXP_LIKE(NULL, '(', NULL), NULL REGEXP NULL"))[0], [[null, null]])
      assert.deepEqual((await read("SELECT NULL NOT RLIKE '(' LIMIT 0"))[0], [])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const broken = 'Mismatched parenthesis in regular expression.'
      for (const statement of [
        "SELECT REGEXP_SUBSTR(NULL, '(', NULL)",
        "SELECT REGEXP_INSTR('x', '(', 1, 1, NULL)",
        "SELECT REGEXP_REPLACE('x', '(', NULL)",
      ]) {
        await conn.query('DO 0')
        await assert.rejects(read(statement), { errno: 3691, sqlState: 'HY000', sqlMessage: broken })
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', 3691, broken]])
      }
      assert.deepEqual((await read(`SELECT REGEXP_SUBSTR(NULL, '(', 1, 1, NULL),
        REGEXP_REPLACE(REPEAT('a', 30), '(a+)+', NULL)`))[0], [[null, null]])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      for (const [sql, fn] of [
        ["SELECT REGEXP_SUBSTR(NULL, 'x', 0)", 'regexp_substr'],
        ["SELECT REGEXP_SUBSTR('x', NULL, -1)", 'regexp_substr'],
        ["SELECT REGEXP_REPLACE('x', 'x', NULL, 0)", 'regexp_replace'],
      ] as const) {
        const message = `Incorrect parameters in the call to native function '${fn}'`
        await assert.rejects(read(sql), { errno: 1583, sqlState: '42000', sqlMessage: message })
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', 1583, message]])
      }
      await assert.rejects(read("SELECT REGEXP_SUBSTR(NULL, '(', 0, NULL)"), { errno: 3691, sqlState: 'HY000', sqlMessage: broken })
      assert.deepEqual((await read(`SELECT REGEXP_SUBSTR(NULL, 'x', 0, NULL),
        REGEXP_SUBSTR(NULL, '(', 0, 1, NULL), REGEXP_INSTR(NULL, 'x', 0)`))[0], [[null, null, null]])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      const mixed = "Character set 'binary' cannot be used in conjunction with 'utf8mb4_0900_ai_ci' in call to regexp_replace."
      await assert.rejects(read("SELECT REGEXP_REPLACE(_binary 'x', _binary '(', 'z', NULL)"), { errno: 3995, sqlState: 'HY000', sqlMessage: mixed })
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', 3995, mixed]])
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})

test('M5.10: regex search narrows optional integers and selects the first replacement for negative occurrences', async () => {
  const { db, conn, host } = await connect()
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    for (const method of ['query', 'execute'] as const) {
      const read = (statement: string) => method === 'query' ? conn.query(statement) : conn.execute(statement)
      const narrowed = `SELECT REGEXP_SUBSTR('abc','.',4294967297,4294967299),
        REGEXP_INSTR('abc','.',9223372036854775809,4294967299,-9223372036854775807),
        REGEXP_REPLACE('abc','.','z',1,4294967296), REGEXP_REPLACE('abc','.','z',1,-1)`
      assert.deepEqual((await read(narrowed))[0], [['c', '4', 'zzz', 'zbc']], method)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], method)
      const message = "Incorrect parameters in the call to native function 'regexp_substr'"
      await assert.rejects(read("SELECT REGEXP_SUBSTR('abc','.',4294967296)"), {
        errno: 1583, sqlState: '42000', sqlMessage: message,
      })
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', 1583, message]], method)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})

test('M5.10: REGEXP_INSTR checks written return options at preparation', async () => {
  const { db, conn, host } = await connect()
  const error = { errno: 1210, sqlState: 'HY000', sqlMessage: 'Incorrect arguments to regexp_instr: return_option must be 1 or 0.' }
  const invalid = "SELECT REGEXP_INSTR(NULL,'(',1,1,-1) LIMIT 0"
  try {
    if (host !== undefined) assert.deepEqual((await conn.query("SELECT SUBSTRING_INDEX(VERSION(), '-', 1)"))[0], [['8.4.11']])
    await assert.rejects(conn.prepare(invalid), error)
    for (const method of ['query', 'execute'] as const) {
      const read = (statement: string) => method === 'query' ? conn.query(statement) : conn.execute(statement)
      for (const statement of [invalid, "SELECT REGEXP_INSTR('x','x',1,1,+2,NULL) LIMIT 0",
        "SELECT REGEXP_INSTR('x','x',1,1,4294967298) LIMIT 0"]) {
        await assert.rejects(read(statement), error)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [['Error', error.errno, error.sqlMessage]], method)
      }
    }
    const held = await conn.prepare("SELECT REGEXP_INSTR('a','a',1,1,CAST(? AS SIGNED))")
    try {
      assert.deepEqual((await held.execute([1]))[0], [['2']])
      await assert.rejects(held.execute([2]), error)
      assert.deepEqual((await held.execute([null]))[0], [[null]])
    } finally {
      await held.close()
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
