// CREATE TEMPORARY TABLE, as 8.4.11 answered each of these statements from
// two connections, `a` and `b`, in one database.
//
// A temporary table hides the table of its name for its own session only,
// and neither SHOW TABLES nor INFORMATION_SCHEMA lists it, or the schema
// that holds it here. Its rows are transactional, and ROLLBACK takes them,
// but not its creation or its drop (1751, 1752; to a savepoint as well, and
// under autocommit = 0). A statement may name it once (1137), a view may not
// read it (1352), and it takes no FULLTEXT key (1796) and no foreign key,
// either way (1215, 1824). DROP TABLE drops it before the table beneath;
// DROP TEMPORARY TABLE nothing else. ALTER TABLE copies it, its rename
// included. Its holding schema answers to no name (1049, 1051), and it ends
// with its session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly ['a' | 'b', string, Outcome])[] = [
  ["a", "CREATE TABLE tp (id INT PRIMARY KEY, v VARCHAR(5))", [0,0,"",0]],
  ["a", "INSERT INTO tp VALUES (1,'perm')", [1,0,"",0]],
  ["a", "START TRANSACTION", [0,0,"",0]],
  ["a", "INSERT INTO tp VALUES (2,'tx')", [1,0,"",0]],
  ["a", "CREATE TEMPORARY TABLE tp (id INT, w INT)", [0,0,"",0]],
  ["a", "ROLLBACK", [0,0,"",1]],
  ["a", "SHOW WARNINGS", [["Warning","1751","The creation of some temporary tables could not be rolled back."]]],
  ["a", "SELECT * FROM tp", []],
  ["a", "CREATE TEMPORARY TABLE tp (id INT, w INT)", [1050,"Table 'tp' already exists"]],
  ["a", "INSERT INTO tp VALUES (5, 50)", [1,0,"",0]],
  ["a", "SELECT * FROM tp", [["5","50"]]],
  ["b", "SELECT * FROM tp", [["1","perm"]]],
  ["a", "SHOW TABLES", [["tp"]]],
  ["a", "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1", [["tp","BASE TABLE"]]],
  ["a", "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tp'", [["2"]]],
  ["a", "SHOW CREATE TABLE tp", [["tp","CREATE TEMPORARY TABLE `tp` (\n  `id` int DEFAULT NULL,\n  `w` int DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["a", "START TRANSACTION", [0,0,"",0]],
  ["a", "INSERT INTO tp VALUES (6, 60)", [1,0,"",0]],
  ["a", "ROLLBACK", [0,0,"",0]],
  ["a", "SELECT * FROM tp", [["5","50"]]],
  ["a", "SELECT * FROM tp t1 JOIN tp t2 ON t1.id = t2.id", [1137,"Can't reopen table: 't1'"]],
  ["a", "SELECT * FROM tp WHERE id IN (SELECT id FROM tp)", [1137,"Can't reopen table: 'tp'"]],
  ["a", "INSERT INTO tp SELECT * FROM tp", [1137,"Can't reopen table: 'tp'"]],
  ["a", "CREATE TEMPORARY TABLE tp (x INT)", [1050,"Table 'tp' already exists"]],
  ["a", "CREATE TEMPORARY TABLE IF NOT EXISTS tp (x INT)", [0,0,"",1]],
  ["a", "ALTER TABLE tp ADD COLUMN z INT", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["a", "SHOW CREATE TABLE tp", [["tp","CREATE TEMPORARY TABLE `tp` (\n  `id` int DEFAULT NULL,\n  `w` int DEFAULT NULL,\n  `z` int DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["a", "CREATE VIEW vtp AS SELECT * FROM tp", [1352,"View's SELECT refers to a temporary table 'tp'"]],
  ["a", "CREATE TEMPORARY TABLE tf (t TEXT, FULLTEXT(t))", [1796,"Cannot create FULLTEXT index on temporary InnoDB table"]],
  ["a", "CREATE TEMPORARY TABLE tk (id INT, FOREIGN KEY (id) REFERENCES tp(id))", [1215,"Cannot add foreign key constraint"]],
  ["a", "CREATE TEMPORARY TABLE tz (id INT PRIMARY KEY)", [0,0,"",0]],
  ["a", "CREATE TABLE pk (id INT, FOREIGN KEY (id) REFERENCES tz(id))", [1824,"Failed to open the referenced table 'tz'"]],
  ["a", "CREATE TEMPORARY TABLE tm2 (one INT) ENGINE=MEMORY", [0,0,"",0]],
  ["a", "INSERT INTO tm2 VALUES (1)", [1,0,"",0]],
  ["a", "SHOW CREATE TABLE tm2", [["tm2","CREATE TEMPORARY TABLE `tm2` (\n  `one` int DEFAULT NULL\n) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["a", "ALTER TABLE tp RENAME TO tp3", [1,0,"Records: 1  Duplicates: 0  Warnings: 0",0]],
  ["a", "SELECT * FROM tp3", [["5","50",null]]],
  ["a", "SELECT * FROM tp", [["1","perm"]]],
  ["a", "DROP TEMPORARY TABLE tp", [1051,"Unknown table 'tt.tp'"]],
  ["a", "DROP TEMPORARY TABLE IF EXISTS tp, tp3", [0,0,"",1]],
  ["a", "SHOW WARNINGS", [["Note","1051","Unknown table 'tt.tp'"]]],
  ["a", "SELECT * FROM tp", [["1","perm"]]],
  ["a", "CREATE TEMPORARY TABLE tq (id INT)", [0,0,"",0]],
  ["a", "DROP TABLE tq", [0,0,"",0]],
  ["a", "TRUNCATE TABLE tm2", [0,0,"",0]],
  ["a", "SELECT * FROM tm2", []],
  ["a", "DROP TABLE tm2, tz, tp", [0,0,"",0]],
  ["a", "SELECT * FROM tp", [1146,"Table 'tt.tp' doesn't exist"]],
  ["a", "CREATE TEMPORARY TABLE tp (id INT)", [0,0,"",0]],
  ["a", "DROP TABLE tp", [0,0,"",0]],
  ["a", "SELECT * FROM tp", [1146,"Table 'tt.tp' doesn't exist"]],
  ["a", "DROP TABLE tp", [1051,"Unknown table 'tt.tp'"]],
  ["a", "SELECT * FROM tp", [1146,"Table 'tt.tp' doesn't exist"]],
  ["a", "CREATE TEMPORARY TABLE tr (id INT PRIMARY KEY, n INT, UNIQUE KEY (n))", [0,0,"",0]],
  ["a", "INSERT INTO tr VALUES (1, 1), (2, 1)", [1062,"Duplicate entry '1' for key 'tr.n'"]],
  ["a", "INSERT INTO tr VALUES (1, 5) ON DUPLICATE KEY UPDATE n = 9", [1,0,"",0]],
  ["a", "SELECT * FROM tr", [["1","5"]]],
  ["a", "UPDATE tr SET n = n + 1", [1,0,"Rows matched: 1  Changed: 1  Warnings: 0",0]],
  ["a", "DELETE FROM tr WHERE id = 1", [1,0,"",0]],
  ["a", "SELECT * FROM tr", []],
  ["b", "SELECT * FROM tr", [1146,"Table 'tt.tr' doesn't exist"]],
  ["b", "CREATE TEMPORARY TABLE tr (other INT)", [0,0,"",0]],
  ["b", "INSERT INTO tr VALUES (7)", [1,0,"",0]],
  ["b", "SELECT * FROM tr", [["7"]]],
  ["a", "SELECT * FROM tr", []],
  ["a", "CREATE TEMPORARY TABLE d1 (id INT)", [0,0,"",0]],
  ["a", "INSERT INTO d1 VALUES (1)", [1,0,"",0]],
  ["a", "START TRANSACTION", [0,0,"",0]],
  ["a", "INSERT INTO d1 VALUES (2)", [1,0,"",0]],
  ["a", "DROP TEMPORARY TABLE d1", [0,0,"",0]],
  ["a", "ROLLBACK", [0,0,"",1]],
  ["a", "SHOW WARNINGS", [["Warning","1752","Some temporary tables were dropped, but these operations could not be rolled back."]]],
  ["a", "SELECT * FROM d1", [1146,"Table 'tt.d1' doesn't exist"]],
  ["a", "START TRANSACTION", [0,0,"",0]],
  ["a", "SAVEPOINT s1", [0,0,"",0]],
  ["a", "CREATE TEMPORARY TABLE d2 (id INT)", [0,0,"",0]],
  ["a", "INSERT INTO d2 VALUES (1)", [1,0,"",0]],
  ["a", "ROLLBACK TO SAVEPOINT s1", [0,0,"",1]],
  ["a", "SHOW WARNINGS", [["Warning","1751","The creation of some temporary tables could not be rolled back."]]],
  ["a", "SELECT * FROM d2", []],
  ["a", "COMMIT", [0,0,"",0]],
  ["a", "SELECT * FROM d2", []],
  ["a", "SET autocommit = 0", [0,0,"",0]],
  ["a", "CREATE TEMPORARY TABLE d3 (id INT)", [0,0,"",0]],
  ["a", "INSERT INTO d3 VALUES (1)", [1,0,"",0]],
  ["a", "ROLLBACK", [0,0,"",1]],
  ["a", "SELECT * FROM d3", []],
  ["a", "SET autocommit = 1", [0,0,"",0]],
  ["a", "START TRANSACTION", [0,0,"",0]],
  ["a", "CREATE TEMPORARY TABLE d4 (id INT)", [0,0,"",0]],
  ["a", "INSERT INTO d4 VALUES (1)", [1,0,"",0]],
  ["a", "COMMIT", [0,0,"",0]],
  ["a", "SELECT * FROM d4", [["1"]]],
  ["a", "START TRANSACTION", [0,0,"",0]],
  ["a", "CREATE TEMPORARY TABLE d5 (id INT)", [0,0,"",0]],
  ["a", "DROP TEMPORARY TABLE d5", [0,0,"",0]],
  ["a", "ROLLBACK", [0,0,"",2]],
  ["a", "SHOW WARNINGS", [["Warning","1751","The creation of some temporary tables could not be rolled back."],["Warning","1752","Some temporary tables were dropped, but these operations could not be rolled back."]]],
  ["a", "SELECT * FROM d5", [1146,"Table 'tt.d5' doesn't exist"]],
  ["a", "CREATE TEMPORARY TABLE d1 (id INT)", [0,0,"",0]],
  ["a", "DROP TEMPORARY TABLE d1", [0,0,"",0]],
  ["b", "DROP TABLE `#tmp#2#0`.tr", [1051,"Unknown table '#tmp#2#0.tr'"]],
  ["b", "DROP TABLE IF EXISTS `#tmp#2#0`.tr", [0,0,"",1]],
  ["b", "SELECT * FROM `#tmp#2#0`.tr", [1049,"Unknown database '#tmp#2#0'"]],
  ["b", "SELECT * FROM tr", [["7"]]],
  ["b", "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE '#%'", [["0"]]],
  ["b", "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA LIKE '#%'", [["0"]]],
]

async function outcome(conn: mysql.Connection, sql: string): Promise<Outcome> {
  try {
    const [r] = await conn.query({ sql, rowsAsArray: true })
    if (Array.isArray(r)) return (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
    const h = r as mysql.ResultSetHeader
    return [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
  } catch (e) {
    const err = e as { errno: number; message: string }
    return [err.errno, err.message]
  }
}

test('temporary tables answer every statement of the script as 8.4.11 did, and end with their session', async () => {
  const db = await MySQL.open(':memory:')
  const open = () => mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '' })
  const setup = await open()
  await setup.query('CREATE DATABASE tt')
  await setup.end()
  const a = await open()
  const b = await open()
  try {
    for (const c of [a, b]) await c.query('USE tt')
    for (const [who, sql, expected] of SCRIPT) assert.deepEqual(await outcome(who === 'a' ? a : b, sql), expected, `${who}: ${sql}`)
    // The schema that holds \`a\`'s temporary tables, by its real name, is no schema to \`b\`.
    const held = db.catalog?.schemas().map((x) => x.name).filter((n) => n.startsWith('#')) ?? []
    assert.equal(held.length, 2)
    for (const name of held) {
      for (const sql of [`SELECT * FROM \`${name}\`.tr`, `INSERT INTO \`${name}\`.tr VALUES (1)`, `SHOW CREATE TABLE \`${name}\`.tr`]) {
        assert.deepEqual(await outcome(b, sql), [1049, `Unknown database '${name}'`], sql)
      }
    }
    // `a` made d2 and d4 and still has them; when it goes, they go, and the schema that held them.
    await a.end()
    const c = await open()
    await c.query('USE tt')
    assert.deepEqual(await outcome(c, 'SELECT * FROM d4'), [1146, "Table 'tt.d4' doesn't exist"])
    await c.end()
    // Only \`b\`'s schema of temporary tables is left in the store: \`a\`'s went with it.
    assert.deepEqual(
      db.catalog?.schemas().map((x) => x.name).filter((n) => n.startsWith('#')),
      ['#tmp#3#0'],
    )
  } finally {
    await b.end()
    await db.end()
  }
})
