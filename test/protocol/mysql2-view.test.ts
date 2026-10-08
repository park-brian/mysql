// Views (M5.9), through `mysql2`, against answers a real 8.4.11 gave to the
// same script (asked first, through the same driver, and written down here).
//
// What they pin: CREATE VIEW commits the open transaction; the query is
// resolved at CREATE (1146, 1353, 1060, 1351, 1350), before the name is
// checked against the tables and views that share it (1050, 1347); a view's
// columns report the view as their original table, and its schema as theirs
// unless they are expressions, which a temporary table then reports with the
// schema and without the table; a derived table's columns report their
// derived names; DROP is all or nothing and IF EXISTS notes what it missed; a
// view whose table is gone is 1356, and one that names itself 1146. SHOW's own
// metadata is M5.12's, so only its rows are compared.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Names = readonly (readonly (string | number)[])[]
type Outcome = number | readonly (string | number)[] | readonly [readonly (readonly (string | null)[])[], Names?]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ['CREATE TABLE t (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(10) NOT NULL, c INT)', [0, 0, '', 0]],
  ["INSERT INTO t (name, c) VALUES ('a', 1), ('b', 2), ('c', 1)", [3, 1, 'Records: 3  Duplicates: 0  Warnings: 0', 0]],
  ['START TRANSACTION', [0, 0, '', 0]],
  ["INSERT INTO t (name, c) VALUES ('d', 1)", [1, 4, '', 0]],
  ['CREATE VIEW v AS SELECT * FROM t WHERE c = 1', [0, 0, '', 0]],
  ['ROLLBACK', [0, 0, '', 0]],
  [
    'SELECT * FROM v',
    [
      [
        ['1', 'a', '1'],
        ['3', 'c', '1'],
        ['4', 'd', '1'],
      ],
      [
        ['app', 'v', 'v', 'id', 16899],
        ['app', 'v', 'v', 'name', 4097],
        ['app', 'v', 'v', 'c', 0],
      ],
    ],
  ],
  [
    'SELECT x.id, name AS nm, c + 1 FROM v x',
    [
      [
        ['1', 'a', '2'],
        ['3', 'c', '2'],
        ['4', 'd', '2'],
      ],
      [
        ['app', 'x', 'v', 'id', 16899],
        ['app', 'x', 'v', 'name', 4097],
        ['', '', '', '', 128],
      ],
    ],
  ],
  ['CREATE VIEW v AS SELECT 1', 1050],
  ['CREATE TABLE v (a INT)', 1050],
  ['CREATE OR REPLACE VIEW t AS SELECT 1', 1347],
  ['CREATE VIEW w (a, b) AS SELECT id, COUNT(*) FROM t GROUP BY id', [0, 0, '', 0]],
  [
    'SELECT * FROM w',
    [
      [
        ['1', '1'],
        ['2', '1'],
        ['3', '1'],
        ['4', '1'],
      ],
      [
        ['app', 'w', 't', 'a', 1],
        ['app', 'w', 'w', 'b', 1],
      ],
    ],
  ],
  ['CREATE VIEW w2 (a) AS SELECT id, c FROM t', 1353],
  ['CREATE VIEW w3 AS SELECT id, id FROM t', 1060],
  ['CREATE VIEW w4 AS SELECT * FROM nosuch', 1146],
  ['CREATE VIEW w5 AS SELECT @x', 1351],
  ['CREATE VIEW w6 AS SELECT 1 INTO @x', 1350],
  ['CREATE VIEW vd AS SELECT id, c * 2 AS dbl, -id, name FROM t', [0, 0, '', 0]],
  [
    'SELECT * FROM vd ORDER BY id',
    [
      [
        ['1', '2', '-1', 'a'],
        ['2', '4', '-2', 'b'],
        ['3', '2', '-3', 'c'],
        ['4', '2', '-4', 'd'],
      ],
      [
        ['app', 'vd', 'vd', 'id', 16899],
        ['', 'vd', 'vd', 'dbl', 128],
        ['', 'vd', 'vd', '-id', 129],
        ['app', 'vd', 'vd', 'name', 4097],
      ],
    ],
  ],
  ['SELECT DISTINCT dbl FROM vd', [[['2'], ['4']], [['app', 'vd', '', 'dbl', 32768]]]],
  [
    'SELECT vd.dbl, t.id FROM vd JOIN t ON t.id = vd.id ORDER BY 2',
    [
      [
        ['2', '1'],
        ['4', '2'],
        ['2', '3'],
        ['2', '4'],
      ],
      [
        ['app', 'vd', '', 'dbl', 0],
        ['app', 't', 't', 'id', 1],
      ],
    ],
  ],
  ['CREATE VIEW vv AS SELECT * FROM vd WHERE id > 1', [0, 0, '', 0]],
  [
    'SELECT * FROM vv',
    [
      [
        ['2', '4', '-2', 'b'],
        ['3', '2', '-3', 'c'],
        ['4', '2', '-4', 'd'],
      ],
      [
        ['app', 'vv', 'vv', 'id', 16899],
        ['', 'vv', 'vv', 'dbl', 128],
        ['', 'vv', 'vv', '-id', 129],
        ['app', 'vv', 'vv', 'name', 4097],
      ],
    ],
  ],
  ['CREATE VIEW vs AS SELECT * FROM (SELECT 1 AS one) d', [0, 0, '', 0]],
  ['SELECT * FROM vs', [[['1']], [['app', 'vs', 'vs', 'one', 1]]]],
  [
    'SELECT k, x.k AS z FROM (SELECT id AS k FROM t) x ORDER BY k',
    [
      [
        ['1', '1'],
        ['2', '2'],
        ['3', '3'],
        ['4', '4'],
      ],
      [
        ['app', 'x', 't', 'k', 16899],
        ['app', 'x', 't', 'k', 16899],
      ],
    ],
  ],
  ['SELECT d FROM (SELECT id * 2 AS d FROM t) x UNION SELECT 9', [[['2'], ['4'], ['6'], ['8'], ['9']], [['', '', '', 'd', 1]]]],
  [
    'SHOW FULL TABLES',
    [
      [
        ['t', 'BASE TABLE'],
        ['v', 'VIEW'],
        ['vd', 'VIEW'],
        ['vs', 'VIEW'],
        ['vv', 'VIEW'],
        ['w', 'VIEW'],
      ],
    ],
  ],
  ['DROP TABLE IF EXISTS v, nosuch', [0, 0, '', 2]],
  ['DROP VIEW t', 1347],
  ['DROP VIEW v, nosuch', 1051],
  ['DROP VIEW IF EXISTS nosuch, v', [0, 0, '', 1]],
  ['SELECT * FROM v', 1146],
  ['CREATE VIEW v2 AS SELECT id FROM t', [0, 0, '', 0]],
  ['CREATE VIEW v3 AS SELECT * FROM v2', [0, 0, '', 0]],
  ['CREATE OR REPLACE VIEW v2 AS SELECT * FROM v3', 1146],
  ['CREATE TABLE t2 (k INT)', [0, 0, '', 0]],
  ['CREATE VIEW vt2 AS SELECT * FROM t2', [0, 0, '', 0]],
  ['DROP TABLE t2', [0, 0, '', 0]],
  ['SELECT * FROM vt2', 1356],
  ['TRUNCATE vd', 1146],
  ['SHOW TABLES', [[['t'], ['v2'], ['v3'], ['vd'], ['vs'], ['vt2'], ['vv'], ['w']]]],
]

test('M5.9: views return what 8.4.11 returned, statement by statement, names and all', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream() as never,
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
          actual = sql.startsWith('SHOW') ? [rows] : [rows, (fields as mysql.FieldPacket[]).map((c) => [c.schema ?? '', c.table, c.orgTable, c.orgName, c.flags as number])]
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

test('a bare column of a view, a derived table, a CTE or INFORMATION_SCHEMA is named as its source names it, not as written (8.4.11)', async () => {
  // A base table's column is named as the query spells it; any other
  // source's is an item that already has a name, and keeps it. So
  // `SELECT table_name FROM information_schema.tables` reads as TABLE_NAME,
  // which clients that index a row by name depend on.
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE t (Id INT, nAme VARCHAR(5))')
    await conn.query('CREATE VIEW v AS SELECT Id, nAme AS Nm FROM t')
    const names = async (sql: string) => ((await conn.query(sql))[1] as mysql.FieldPacket[]).map((f) => f.name)
    assert.deepEqual(await names('SELECT id, NAME FROM t'), ['id', 'NAME'])
    assert.deepEqual(await names('SELECT t.ID FROM t'), ['ID'])
    assert.deepEqual(await names('SELECT ID, nm FROM v'), ['Id', 'Nm'])
    assert.deepEqual(await names('SELECT id FROM (SELECT Id FROM t) d'), ['Id'])
    assert.deepEqual(await names('WITH c AS (SELECT Id FROM t) SELECT ID FROM c'), ['Id'])
    assert.deepEqual(await names("SELECT table_name, Table_Schema FROM information_schema.tables WHERE table_schema = 'app'"), ['TABLE_NAME', 'TABLE_SCHEMA'])
    assert.deepEqual(await names("SELECT x.table_name AS tn, COUNT(*) FROM information_schema.tables x WHERE table_schema = 'app' GROUP BY x.table_name"), ['tn', 'COUNT(*)'])
    assert.deepEqual(await names("SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' GROUP BY table_name"), ['TABLE_NAME'])
  } finally {
    await conn.end()
    await db.end()
  }
})
