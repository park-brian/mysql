import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('M5.47: retained statements use the database selected at PREPARE', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    rowsAsArray: true,
  })
  const a = 'prepared_context_a'
  const b = 'prepared_context_b'
  try {
    if (host !== undefined) {
      const [rows] = await conn.query('SELECT VERSION()')
      assert.match(String((rows as string[][])[0]?.[0]), /^8\.4\.11(?:-|$)/)
    }
    await conn.query('CREATE DATABASE ' + a)
    await conn.query('CREATE DATABASE ' + b)
    await conn.query('CREATE TABLE ' + a + '.t (id INT PRIMARY KEY, v INT)')
    await conn.query('CREATE TABLE ' + b + '.t (id INT PRIMARY KEY, v INT)')
    await conn.query('INSERT INTO ' + a + '.t VALUES (1, 11)')
    await conn.query('INSERT INTO ' + b + '.t VALUES (1, 22)')
    await assert.rejects(conn.prepare('USE ' + a), { errno: 1295, sqlState: 'HY000' })
    const withoutDatabase = await conn.prepare('SELECT DATABASE()')
    await conn.query('USE ' + a)
    const select = await conn.prepare('SELECT DATABASE(), v, (SELECT MAX(v) FROM t) AS maximum FROM t')
    const create = await conn.prepare('CREATE VIEW v AS SELECT DATABASE() AS viewer, t.v FROM t')
    const update = await conn.prepare('UPDATE t SET v = v + ? WHERE id = 1')
    await conn.query('USE ' + b)
    assert.deepEqual((await withoutDatabase.execute([]))[0], [[null]])
    const [before, fields] = await select.execute([])
    assert.deepEqual(before, [[a, 11, 11]])
    assert.equal(fields[1]?.schema, a)
    const [updated] = await update.execute([1])
    assert.equal((updated as mysql.ResultSetHeader).affectedRows, 1)
    assert.deepEqual((await select.execute([]))[0], [[a, 12, 12]])
    assert.deepEqual((await conn.query('SELECT DATABASE(), v FROM t'))[0], [[b, 22]])
    await create.execute([])
    assert.deepEqual((await conn.query('SELECT * FROM ' + a + '.v'))[0], [[b, 12]])
    await conn.query('DROP DATABASE ' + a)
    await assert.rejects(select.execute([]), { errno: 1049, sqlState: '42000' })
    assert.deepEqual((await withoutDatabase.execute([]))[0], [[null]])
    assert.deepEqual((await conn.query('SELECT DATABASE()'))[0], [[b]])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + a)
    await conn.query('DROP DATABASE IF EXISTS ' + b)
    await conn.end()
    await db?.end()
  }
})
