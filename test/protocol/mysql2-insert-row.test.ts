// INSERT reading the row it writes (M5.8), and a promoted key's flags (M5.9),
// through `mysql2`, against answers a real 8.4.11 gave to the same script.
//
// What they pin: a VALUES or SET expression names columns of the row being
// written, which starts as its defaults (a NOT NULL column with none holds
// its type's zero, AUTO_INCREMENT 0) and takes each value in the list's
// order, so `VALUES (UPPER(a), 'y')` reads '' and `VALUES ('x', UPPER(a))`
// reads 'x' — Drizzle's `$onUpdateFn` writes the second. With no PRIMARY KEY,
// the first unique key of NOT NULL columns is reported as PRI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]
type Outcome = number | readonly (string | number)[] | Rows | readonly [Rows, readonly (readonly (string | number)[])[]]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ['CREATE TABLE t (id SERIAL, a VARCHAR(10) NOT NULL, b VARCHAR(10), c INT DEFAULT 7, d INT)', [0, 0, '', 0]],
  ["INSERT INTO t (a, b) VALUES ('x', UPPER(a))", [1, 1, '', 0]],
  ["INSERT INTO t (b, a) VALUES (UPPER(a), 'y')", [1, 2, '', 0]],
  ["INSERT INTO t (a, b, d) VALUES ('z', c, c + 1)", [1, 3, '', 0]],
  ["INSERT INTO t (a, b) VALUES ('w', id)", [1, 4, '', 0]],
  ["INSERT INTO t (a, b) VALUES ('q', CONCAT(a, b))", [1, 5, '', 0]],
  ["INSERT INTO t (a, b) VALUES ('m', UPPER(a)), ('n', UPPER(a))", [2, 6, 'Records: 2  Duplicates: 0  Warnings: 0', 0]],
  ["INSERT INTO t SET a = 'k', b = a", [1, 8, '', 0]],
  ["INSERT INTO t (a, c, b) VALUES ('u', DEFAULT, c)", [1, 9, '', 0]],
  ["INSERT INTO t (a, b) VALUES ('p', t.a)", [1, 10, '', 0]],
  ["INSERT INTO t (a, b) VALUES ('r', nosuch)", 1054],
  ["INSERT INTO t (a, b) SELECT 's', a FROM DUAL", 1054],
  ['INSERT INTO t (b) VALUES (a)', 1364],
  [
    'SELECT * FROM t ORDER BY id',
    [
      [
        ['1', 'x', 'X', '7', null],
        ['2', 'y', '', '7', null],
        ['3', 'z', '7', '7', '8'],
        ['4', 'w', '0', '7', null],
        ['5', 'q', null, '7', null],
        ['6', 'm', 'M', '7', null],
        ['7', 'n', 'N', '7', null],
        ['8', 'k', 'k', '7', null],
        ['9', 'u', '7', '7', null],
        ['10', 'p', 'p', '7', null],
      ],
      [
        ['app', 't', 't', 'id', 16931],
        ['app', 't', 't', 'a', 4097],
        ['app', 't', 't', 'b', 0],
        ['app', 't', 't', 'c', 0],
        ['app', 't', 't', 'd', 0],
      ],
    ],
  ],
  ['CREATE TABLE k (x INT NOT NULL, y INT NOT NULL, z INT, UNIQUE KEY k2 (y), UNIQUE KEY k1 (x), UNIQUE KEY (z))', [0, 0, '', 0]],
  [
    'SELECT * FROM k',
    [
      [],
      [
        ['app', 'k', 'k', 'x', 20485],
        ['app', 'k', 'k', 'y', 20483],
        ['app', 'k', 'k', 'z', 16388],
      ],
    ],
  ],
]

test('M5.8 and M5.9: INSERT reads its own row, and a promoted key is PRI, as 8.4.11 answered', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream(),
    user: 'root',
    password: '',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r, fields] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) {
          const rows = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
          // A SELECT whose expected outcome carries its columns' names and flags compares them too.
          const named =
            Array.isArray(expected) &&
            expected.length === 2 &&
            Array.isArray(expected[0]) &&
            Array.isArray(expected[1]) &&
            Array.isArray((expected[1] as unknown[])[0]) &&
            typeof ((expected[1] as unknown[][])[0] as unknown[])[0] === 'string' &&
            !sql.startsWith('SHOW')
          actual = named ? [rows, (fields as mysql.FieldPacket[]).map((c) => [c.schema ?? '', c.table, c.orgTable, c.orgName, c.flags as number])] : rows
        } else {
          const h = r as mysql.ResultSetHeader
          actual = [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
        }
      } catch (e) {
        actual = (e as { errno: number }).errno
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})


test('a signed explicit AUTO_INCREMENT ID is encoded in the OK packet', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  const schema = 'signed_insert_id'
  try {
    if (db === undefined) {
      const [version] = await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version')
      assert.equal(version[0]?.version, '8.4.11')
    }
    await conn.query('CREATE DATABASE ' + schema)
    await conn.query('USE ' + schema)
    for (const method of ['query', 'execute'] as const) {
      const write = async (sql: string) => {
        const [ok] = method === 'query'
          ? await conn.query<mysql.ResultSetHeader>(sql)
          : await conn.execute<mysql.ResultSetHeader>(sql)
        return [ok.affectedRows, ok.insertId, ok.warningStatus]
      }
      const last = async (sql = 'SELECT LAST_INSERT_ID() AS id') => {
        const [rows] = method === 'query' ? await conn.query<mysql.RowDataPacket[]>(sql) : await conn.execute<mysql.RowDataPacket[]>(sql)
        return rows[0]?.id
      }
      await conn.query('CREATE TABLE t(id BIGINT AUTO_INCREMENT PRIMARY KEY, payload INT)')
      assert.equal(await last('SELECT LAST_INSERT_ID(40) AS id'), '40')
      assert.deepEqual(await write('INSERT INTO t VALUES (-9223372036854775808,1)'), [1, '-9223372036854775808', 0])
      assert.deepEqual(await write('REPLACE INTO t SELECT -6,2'), [1, '-6', 0])
      assert.equal(await last(), '40')
      assert.deepEqual(await write('INSERT INTO t VALUES (-5,3),(NULL,4)'), [2, 1, 0])
      assert.equal(await last(), '1')
      const [rows] = await conn.query('SELECT id,payload FROM t ORDER BY id')
      assert.deepEqual(rows, [
        { id: '-9223372036854775808', payload: 1 },
        { id: '-6', payload: 2 },
        { id: '-5', payload: 3 },
        { id: '1', payload: 4 },
      ])
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ' + schema)
    await conn.end()
    await db?.end()
  }
})
