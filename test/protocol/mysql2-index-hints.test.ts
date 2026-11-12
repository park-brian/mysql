import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('legacy index hints resolve on physical SELECT sources before column binding', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'index_hint_admission'
  const select = 'SELECT x.id FROM t x'
  const missing = (name: string, alias = 'x') => [1176, '42000', `Key '${name}' doesn't exist in table '${alias}'`] as const
  const absent = [1146, '42S02', `Table '${schema}.absent' doesn't exist`] as const
  const conflict = [1221, 'HY000', 'Incorrect usage of USE INDEX and FORCE INDEX'] as const
  const rejected = [
    [`${select} USE INDEX (ix)`, missing('ix')],
    [`${select} IGNORE INDEX FOR ORDER BY (missing)`, missing('missing')],
    [`${select} FORCE INDEX FOR GROUP BY (hidden)`, missing('hidden')],
    [select + ' USE INDEX (`ékey`)', missing('ékey')],
    [select + ' USE INDEX (`ix_a `)', missing('ix_a ')],
    [`${select} USE INDEX (missing, later)`, missing('later')],
    [`${select} USE INDEX (missing) IGNORE INDEX (later)`, missing('later')],
    [`${select} FORCE INDEX (missing) USE INDEX (ix_a)`, missing('missing')],
    [`${select} USE INDEX FOR JOIN () FORCE INDEX FOR GROUP BY (ix_a)`, conflict],
    [`${select} USE INDEX (ix_a) FORCE INDEX (ix_ab)`, conflict],
    ['SELECT absent FROM t x USE INDEX (missing)', missing('missing')],
    [`${select} USE INDEX (missing) JOIN t y ON y.absent=x.id`, missing('missing')],
    [`${select} USE INDEX (missing) JOIN t y USE INDEX (later) ON y.id=x.id`, missing('missing')],
    [`${select} USE INDEX (missing) WHERE FALSE LIMIT 0`, missing('missing')],
    ['SELECT id FROM tmp FORCE INDEX (missing)', missing('missing', 'tmp')],
    [`${select} USE INDEX (missing) JOIN t x ON x.id=x.id`, [1066, '42000', "Not unique table/alias: 'x'"]],
    [`${select} USE INDEX (missing) JOIN absent y ON y.id=x.id`, absent],
    [`${select} USE INDEX (missing) WHERE id=(SELECT id FROM absent)`, absent],
    [`${select} USE INDEX (missing) UNION ALL SELECT id FROM absent`, absent],
    ['SELECT (SELECT id FROM t USE INDEX (missing)), (SELECT id FROM absent)', absent],
    ['WITH c AS (SELECT id FROM t USE INDEX (missing)) SELECT c.id FROM c JOIN absent ON c.id=absent.id', absent],
  ] as const
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,a INT,b INT,body VARCHAR(16),KEY ix_a(a),KEY ix_ab(a,b),KEY `Ékey`(b),KEY hidden_a(b,a) INVISIBLE,FULLTEXT KEY ft(body))')
    await conn.query("INSERT INTO t VALUES (1,1,2,'one'),(2,1,1,'two'),(3,2,2,'three')")
    await conn.query('CREATE TEMPORARY TABLE tmp(id INT PRIMARY KEY)')
    await conn.query('INSERT INTO tmp VALUES (1)')
    for (const [sql, error] of rejected) {
      const [errno, sqlState, sqlMessage] = error
      for (const method of ['query', 'execute'] as const) {
        const result = method === 'query' ? conn.query(sql) : conn.execute(sql)
        await assert.rejects(result, { errno, sqlState, sqlMessage }, `${method}: ${sql}`)
        const [warnings] = await conn.query({ sql: 'SHOW WARNINGS', rowsAsArray: true })
        assert.deepEqual(warnings, [['Error', errno, sqlMessage]], `${method}: ${sql}`)
      }
      await assert.rejects(conn.query(`EXPLAIN FORMAT=TREE ${sql}`), { errno, sqlState, sqlMessage }, sql)
    }

    const accepted = async (sql: string, expected: number[][]) => {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, `${method}: ${sql}`)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
          [['id', 3, 11, 20483, 0, 63]], `${method}: ${sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
      }
    }
    for (const hint of ['USE INDEX (IX_A)', 'USE INDEX (primary)', 'USE INDEX (`Ék`)', 'USE INDEX (ft)', 'USE INDEX ()']) {
      await accepted(`${select} ${hint} WHERE x.a=1 ORDER BY x.id`, [[1], [2]])
    }
    await accepted('SELECT id FROM tmp USE INDEX (``)', [[1]])
    await conn.query("SET optimizer_switch='use_invisible_indexes=on'")
    await accepted(`${select} USE INDEX (hidden) ORDER BY id`, [[1], [2], [3]])
    const retained = { sql: `${select} USE INDEX (hidden) WHERE x.id=?`, rowsAsArray: true }
    assert.deepEqual((await conn.execute(retained, [1]))[0], [[1]])
    await conn.query("SET optimizer_switch='use_invisible_indexes=off'")
    // The open wire handle outlives the executor's shared parse cache.
    for (let i = 0; i < 32; i++) await conn.execute(`SELECT ${i}`)
    assert.deepEqual((await conn.execute(retained, [2]))[0], [[2]])
    const invisible = { errno: 1176, sqlState: '42000', sqlMessage: missing('hidden')[2] }
    await assert.rejects(conn.execute({ ...retained, sql: retained.sql + ' ' }, [2]), invisible)
    await assert.rejects(conn.query(retained, [2]), invisible)
    await conn.query('ALTER TABLE t ADD COLUMN extra INT')
    await assert.rejects(conn.execute(retained, [2]), invisible)
    await conn.query("SET optimizer_switch='use_invisible_indexes=on'")
    assert.deepEqual((await conn.execute(retained, [3]))[0], [[3]])
    await conn.query("SET optimizer_switch='use_invisible_indexes=off'")
    assert.deepEqual((await conn.execute(retained, [1]))[0], [[1]])

    const withExtra = { ...retained, sql: retained.sql.replace('x.id FROM', 'x.extra FROM') }
    await conn.query("SET optimizer_switch='use_invisible_indexes=on'")
    assert.deepEqual((await conn.execute(withExtra, [1]))[0], [[null]])
    await conn.query('ALTER TABLE t DROP COLUMN extra')
    await assert.rejects(conn.execute(withExtra, [1]), { errno: 1054, sqlState: '42S22' })
    await conn.query("SET optimizer_switch='use_invisible_indexes=off'")
    await assert.rejects(conn.execute(withExtra, [1]), invisible)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
