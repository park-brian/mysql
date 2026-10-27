import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('DDL BINARY names and utf8mb4_0900_bin retain native admission and byte ordering', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const c = await mysql.createConnection(db === undefined
    ? { host: host!, port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', rowsAsArray: true }
    : { stream: db.createStream(), user: 'root', rowsAsArray: true })
  try {
    if (db === undefined) assert.equal(String((await c.query<mysql.RowDataPacket[]>('SELECT VERSION()'))[0][0]![0]).split('-')[0], '8.4.11')
    for (const api of ['query', 'execute'] as const) {
      const run = (sql: string) => api === 'query' ? c.query<mysql.RowDataPacket[]>(sql) : c.execute<mysql.RowDataPacket[]>(sql)
      await c.query('DROP DATABASE IF EXISTS collation_admission')
      await run('CREATE DATABASE collation_admission COLLATE binary')
      await c.query('USE collation_admission')
      await run('CREATE TABLE b(v VARCHAR(4)) COLLATE binary')
      await run("INSERT INTO b VALUES('a'),('a ')")
      assert.deepEqual((await run('SELECT HEX(v),COLLATION(v) FROM b ORDER BY v'))[0], [['61', 'binary'], ['6120', 'binary']], api + ': schema/table binary')
      await run('CREATE TABLE c(v VARCHAR(4) COLLATE binary)')
      await run("INSERT INTO c VALUES('a ')")
      assert.deepEqual((await run('SELECT HEX(v),COLLATION(v) FROM c'))[0], [['6120', 'binary']], api + ': column binary')
      await assert.rejects(run("SELECT 'x' COLLATE binary"), { errno: 1064, sqlState: '42000' }, api + ': expression keyword')
      await assert.rejects(run('CREATE TABLE bad(v VARCHAR(4) CHARACTER SET utf8mb4 COLLATE binary)'), { errno: 1253, sqlState: '42000' }, api + ': explicit incompatible charset')
      await run('CREATE TABLE u(v VARCHAR(4) COLLATE utf8mb4_0900_bin UNIQUE)')
      await run("INSERT INTO u VALUES('a '),('a'),('A'),('é'),('中'),('😀')")
      assert.deepEqual((await run('SELECT HEX(v) FROM u ORDER BY v'))[0], [['41'], ['61'], ['6120'], ['C3A9'], ['E4B8AD'], ['F09F9880']], api + ': binary UTF-8 order')
      assert.deepEqual((await run("SELECT COUNT(*) FROM u WHERE v='a'"))[0], [[1]], api + ': NO PAD equality and uniqueness')
      const statement = await c.prepare('CREATE TABLE prepared_binary(v VARCHAR(4)) COLLATE binary')
      await statement.close()
      assert.deepEqual((await c.query("SHOW TABLES LIKE 'prepared_binary'"))[0], [], api + ': PREPARE does not create the table')
    }
  } finally {
    await c.query('DROP DATABASE IF EXISTS collation_admission')
    await c.end()
    await db?.end()
  }
})
