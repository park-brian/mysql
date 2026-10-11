// Binary regex byte semantics, probed against MySQL 8.4.11.
// MYSQL_REFERENCE_HOST runs these same assertions against a disposable reference.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.10: binary regex preserves bytes, matching semantics and positions through both protocols', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  try {
    if (db === undefined) {
      const [rows] = await conn.query({ sql: 'SELECT VERSION()', rowsAsArray: true })
      assert.deepEqual(rows, [['8.4.11']])
    }
    for (const method of ['query', 'execute'] as const) {
      const run = async (sql: string) => method === 'query'
        ? conn.query({ sql, rowsAsArray: true })
        : conn.execute({ sql, rowsAsArray: true })
      for (let b = 0; b < 256; b++) {
        const hex = b.toString(16).padStart(2, '0')
        const sql = `SELECT HEX(REGEXP_SUBSTR(X'${hex}',X'2E',1,1,'n')), HEX(REGEXP_REPLACE(X'${hex}',X'282E29',_binary'$1',1,0,'n'))`
        const [rows] = await run(sql)
        assert.deepEqual(rows, [[hex.toUpperCase(), hex.toUpperCase()]], `${method}: byte ${hex}`)
        if (b >= 0x80 && b <= 0x9f) {
          const [mapped] = await run(`SELECT HEX(REGEXP_SUBSTR(X'${hex}',X'${hex}')), HEX(REGEXP_REPLACE(X'41',X'41',X'${hex}'))`)
          assert.deepEqual(mapped, [[hex.toUpperCase(), hex.toUpperCase()]], `${method}: pattern/replacement byte ${hex}`)
        }
      }

      // MySQL's binary regex input uses its latin1 map, including 85 → ellipsis
      // and 9F → capital Y with diaeresis. Identity decoding changes the match.
      const [classes] = await run("SELECT HEX(REGEXP_SUBSTR(X'85',X'2E')), HEX(REGEXP_SUBSTR(X'9F',_binary'[[:alpha:]]')), HEX(REGEXP_SUBSTR(X'80',X'5C707B53637D'))")
      assert.deepEqual(classes, [['85', '9F', '80']])

      const positions = "SELECT HEX(REGEXP_SUBSTR(X'4180009F42',X'2E',2,1,'n')), REGEXP_INSTR(X'4180009F42',X'9F'), REGEXP_INSTR(X'4180009F42',X'9F',1,1,1), HEX(REGEXP_REPLACE(X'4180009F42',X'282E29',_binary'<$1>',2,2,'n'))"
      const [positionRows] = await run(positions)
      assert.deepEqual(positionRows, [['80', 4, 5, '41803C003E9F42']])

      const empty = "SELECT HEX(REGEXP_SUBSTR(X'80009F',X'2829',2)), REGEXP_INSTR(X'80009F',X'2829',2), HEX(REGEXP_REPLACE(X'80009F',X'2829',_binary'X'))"
      const [emptyRows] = await run(empty)
      assert.deepEqual(emptyRows, [['', 2, '58805800589F58']])

      const large = "SELECT HEX(REGEXP_SUBSTR(CONCAT(REPEAT(X'80',131072),X'9F'),X'9F')), REGEXP_INSTR(CONCAT(REPEAT(X'80',131072),X'9F'),X'9F'), LENGTH(REGEXP_REPLACE(REPEAT(X'80',131072),X'282E29',_binary'$1')), HEX(RIGHT(REGEXP_REPLACE(REPEAT(X'80',131072),X'282E29',_binary'$1'),1))"
      const [largeRows] = await run(large)
      assert.deepEqual(largeRows, [['9F', 131073, 131072, '80']])

      // Latin1 results pin raw bytes and metadata without the separately named
      // default-UTF8 wire conversion gap obscuring the matcher regression.
      await conn.query('SET NAMES latin1')
      const [raw, fields] = await run("SELECT REGEXP_SUBSTR(X'80009F',X'2E',1,1,'n') AS sub, REGEXP_REPLACE(X'80009F',X'282E29',_binary'$1',1,0,'n') AS replaced")
      assert.deepEqual(raw, [[Buffer.from([0x80]), Buffer.from([0x80, 0, 0x9f])]])
      assert.deepEqual((fields as mysql.FieldPacket[]).map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [[253, 3, 128, 31, 63], [251, 16777216, 129, 31, 63]])
      const [warnings] = await conn.query('SHOW WARNINGS')
      assert.deepEqual(warnings, [])
      await conn.query('SET NAMES utf8mb4')
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
