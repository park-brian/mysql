// A TIME column compared with a constant that is a datetime, or a string or a
// number written as one, as 8.4.11 answered: the constant is converted once
// to its time of day, in `=`, `<=>`, `<`, IN and BETWEEN alike, and
// whether it is a literal, a CAST, CONCAT or DATE_ADD. A string is a
// datetime when it is a date, a space and a time, seconds optional, or 14
// digits. A two-digit year is 2000-2069 below 70 and 1970-1999 from it, and
// CAST of a datetime string AS TIME keeps its time. Found by review.
//
// Two named divergences stay out of the script: an IN list one of whose
// strings is not a time at all (`'x'`) is 0 on the server even when another
// item matches, and `'2020-01-01'` as a TIME is the number prefix 00:20:20.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE tt (id INT PRIMARY KEY, tm TIME, dt DATETIME, d DATE)", [0,0,"",0]],
  ["INSERT INTO tt VALUES (1, '14:37:36', '2020-01-01 14:37:36', '2020-01-01'), (2, '09:00:00', '1970-01-01 09:00:00', '70-01-01')", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, tm = CAST('1970-01-01 14:37:36' AS DATETIME), tm = '20200101143736', tm = 20200101143736, tm = '143736', tm = 143736, tm = '2020-01-01 14:37:36.000' FROM tt ORDER BY id", [["1","1","1","1","1","1","1"],["2","0","0","0","0","0","0"]]],
  ["SELECT id, tm IN ('1970-01-01 14:37:36', '1970-01-01 09:00:00'), tm IN (CAST('2000-01-01 14:37:36' AS DATETIME)), tm BETWEEN '1970-01-01 14:00:00' AND '1970-01-01 15:00:00', tm BETWEEN '14:00' AND '15:00', tm NOT BETWEEN '1970-01-01 14:00:00' AND '1970-01-01 15:00:00' FROM tt ORDER BY id", [["1","1","1","1","1","0"],["2","1","0","0","0","1"]]],
  ["SELECT id, tm = CONCAT('1970-01-01 ', '14:37:36'), tm = DATE_ADD('1970-01-01 14:37:35', INTERVAL 1 SECOND), '1970-01-01 14:37:36' = tm, CAST('1970-01-01 14:37:36' AS DATETIME) = tm, tm <=> '1970-01-01 14:37:36', tm > '1970-01-01 14:00:00' FROM tt ORDER BY id", [["1","1","1","1","1","1","1"],["2","0","0","0","0","0","0"]]],
  ["SELECT id FROM tt WHERE tm IN ('1970-01-01 14:37:36')", [["1"]]],
  ["SELECT id FROM tt WHERE tm BETWEEN '1970-01-01 14:00:00' AND '1970-01-01 15:00:00'", [["1"]]],
  ["SELECT id, tm = '70-01-01 14:37:36', tm = '1970-1-1 14:37:36', tm = '1970-01-01 14:37', tm > '1970-01-01 14:37', tm = '1970/01/01 14:37:36' FROM tt ORDER BY id", [["1","1","1","0","1","1"],["2","0","0","0","0","0"]]],
  ["SELECT id, d, d = '70-01-01', d = '20200101', d BETWEEN '2019-12-31' AND '2020-01-02' FROM tt ORDER BY id", [["1","2020-01-01","0","1","1"],["2","1970-01-01","1","0","0"]]],
  ["SELECT CAST('70-01-01' AS DATE), CAST('69-12-31' AS DATE), CAST('05-1-1 1:2:3' AS DATETIME), CAST('70-01-01 14:37:36' AS TIME), CAST('2020-01-01 14:37:36.5' AS TIME(1)), CAST('20200101143736' AS TIME), CAST('2020-01-01 14:37' AS TIME)", [["1970-01-01","2069-12-31","2005-01-01 01:02:03","14:37:36","14:37:36.5","14:37:36","14:37:00"]]],
  ["DROP TABLE tt", [0,0,"",0]],
]

test('A TIME compared with a datetime constant answers as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
        else {
          const h = r as mysql.ResultSetHeader
          actual = [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
        }
      } catch (e) {
        const err = e as { errno: number; message: string }
        actual = [err.errno, err.message.replace(/#sql-[0-9a-f]+_[0-9a-f]+/g, '#sql-…')]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})

test('M5.10: CAST of TIME anchors on the session date before rounding', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({
    ...(db === undefined
      ? { host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream() }),
    user: 'root',
    dateStrings: true,
  })
  const cases = [
    ['+00:00', '', '-00:00:00.500000', 'DATE', '2024-02-29'],
    ['+00:00', '', '-00:00:00.500000', 'DATETIME', '2024-03-01 00:00:00'],
    ['+08:00', '', '23:59:59.999999', 'DATETIME(3)', '2024-03-02 00:00:00.000', '2024-03-02 00:00:00'],
    ['-07:00', '', '-00:00:00.000001', 'DATETIME(3)', '2024-02-29 00:00:00.000', '2024-02-29 00:00:00'],
    ['-07:00', 'TIME_TRUNCATE_FRACTIONAL', '-00:00:00.000001', 'DATETIME(3)', '2024-02-28 23:59:59.999', '2024-02-28 23:59:59.999000'],
    ['+00:00', '', '838:59:59.999999', 'DATETIME(6)', '2024-04-04 22:59:59.000000', '2024-04-04 22:59:59'],
    ['+00:00', '', null, 'DATETIME(6)', null],
  ] as const
  try {
    if (host !== undefined) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version')
      assert.equal(rows[0]?.version.split('-')[0], '8.4.11')
    }
    await conn.query('SET timestamp=1709251200')
    for (const [zone, mode, value, target, text, binary = text] of cases) {
      await conn.query('SET time_zone=?', [zone])
      await conn.query('SET sql_mode=?', [mode])
      const sql = `SELECT CAST(CAST(? AS TIME(6)) AS ${target}) AS v`
      const options = { sql, rowsAsArray: true }
      const fsp = target === 'DATETIME(3)' ? 3 : target === 'DATETIME(6)' ? 6 : 0
      const width = target === 'DATE' ? 10 : fsp ? 20 + fsp : 19
      for (const method of ['query', 'execute'] as const) {
        const [rows, fields] = method === 'query' ? await conn.query(options, [value]) : await conn.execute(options, [value])
        assert.deepEqual(rows, [[method === 'query' ? text : binary]], `${method} ${zone} ${mode} ${value} ${target}`)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [
          ['v', target === 'DATE' ? 10 : 12, width, 128, fsp, 63],
        ])
        const [warnings] = await conn.query<mysql.RowDataPacket[]>('SHOW WARNINGS')
        assert.deepEqual(warnings.map((w) => [w.Level, w.Code, w.Message]), value === '838:59:59.999999'
          ? [['Warning', 1292, "Truncated incorrect time value: '838:59:59.999999'"]]
          : [])
      }
    }
    await conn.query("SET time_zone='-07:00'")
    const sql = "SELECT UTC_DATE(), CURDATE(), CURRENT_DATE(), CAST(CAST('00:00:00' AS TIME) AS DATE)"
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, [['2024-03-01', '2024-02-29', '2024-02-29', '2024-02-29']], method)
      const clocks = { sql: 'SELECT NOW(), UTC_TIMESTAMP(), CURTIME(), UTC_TIME()', rowsAsArray: true }
      const [clockRows, clockFields] = method === 'query' ? await conn.query(clocks) : await conn.execute(clocks)
      assert.deepEqual(clockRows, [['2024-02-29 17:00:00', '2024-03-01 00:00:00', '17:00:00', '00:00:00']], method)
      assert.deepEqual(clockFields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), [
        [12, 19, 129, 0, 63], [12, 19, 129, 0, 63], [11, 8, 129, 0, 63], [11, 8, 129, 0, 63],
      ])
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
