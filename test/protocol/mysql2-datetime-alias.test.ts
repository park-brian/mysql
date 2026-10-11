// DATETIME names use identifier/alias grammar; DATE/TIME/TIMESTAMP retain typed literals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', timezone: 'Z' }
    : { stream: db.createStream(), user: 'root', timezone: 'Z' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

test('DATETIME aliases and temporal literal controls match native values, fields, warnings and refusals', async () => {
  const { db, conn } = await connect()
  // Entire HEX named-argument and DATETIME-call groups stay excluded; their
  // separate native 1583/function-admission error contracts remain open.
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT DATETIME '2026-10-11 01:02:03.123456' FROM t ORDER BY id",[["column"],[null]],[["2026-10-11 01:02:03.123456",253,128,0,0,224,"datetime_admission","t","t","datetime"]],[]],
    ["SELECT datetime'2026-10-11 01:02:03.123456' FROM t ORDER BY id",[["column"],[null]],[["2026-10-11 01:02:03.123456",253,128,0,0,224,"datetime_admission","t","t","datetime"]],[]],
    ["SELECT DATE '2026-10-11' AS x",[[new Date("2026-10-11T00:00:00.000Z")]],[["x",10,10,129,0,63,"","","",""]],[]],
    ["SELECT DATE '2026-10-11'",[[new Date("2026-10-11T00:00:00.000Z")]],[["DATE '2026-10-11'",10,10,129,0,63,"","","",""]],[]],
    ["SELECT HEX(DATE '2026-10-11') AS x",[["323032362D31302D3131"]],[["x",253,80,0,31,224,"","","",""]],[]],
    ["SELECT DATE '2026-10-11' AS x FROM t ORDER BY id",[[new Date("2026-10-11T00:00:00.000Z")],[new Date("2026-10-11T00:00:00.000Z")]],[["x",10,10,129,0,63,"","","",""]],[]],
    ["SELECT DATE '2026-10-11' FROM t ORDER BY id",[[new Date("2026-10-11T00:00:00.000Z")],[new Date("2026-10-11T00:00:00.000Z")]],[["DATE '2026-10-11'",10,10,129,0,63,"","","",""]],[]],
    ["SELECT DATE '2026-10-11' AS x FROM t ORDER BY id LIMIT 0",[],[["x",10,10,129,0,63,"","","",""]],[]],
    ["SELECT DATE '2026-10-11' AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],[["x",10,10,129,0,63,"","","",""]],[]],
    ["SELECT TIME '01:02:03.123456' AS x",[["01:02:03.123456"]],[["x",11,17,129,6,63,"","","",""]],[]],
    ["SELECT TIME '01:02:03.123456'",[["01:02:03.123456"]],[["TIME '01:02:03.123456'",11,17,129,6,63,"","","",""]],[]],
    ["SELECT HEX(TIME '01:02:03.123456') AS x",[["30313A30323A30332E313233343536"]],[["x",253,136,0,31,224,"","","",""]],[]],
    ["SELECT TIME '01:02:03.123456' AS x FROM t ORDER BY id",[["01:02:03.123456"],["01:02:03.123456"]],[["x",11,17,129,6,63,"","","",""]],[]],
    ["SELECT TIME '01:02:03.123456' FROM t ORDER BY id",[["01:02:03.123456"],["01:02:03.123456"]],[["TIME '01:02:03.123456'",11,17,129,6,63,"","","",""]],[]],
    ["SELECT TIME '01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0",[],[["x",11,17,129,6,63,"","","",""]],[]],
    ["SELECT TIME '01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],[["x",11,17,129,6,63,"","","",""]],[]],
    ["SELECT TIMESTAMP '2026-10-11 01:02:03.123456' AS x",[[new Date("2026-10-11T01:02:03.123Z")]],[["x",12,26,129,6,63,"","","",""]],[]],
    ["SELECT TIMESTAMP '2026-10-11 01:02:03.123456'",[[new Date("2026-10-11T01:02:03.123Z")]],[["TIMESTAMP '2026-10-11 01:02:03.123456'",12,26,129,6,63,"","","",""]],[]],
    ["SELECT HEX(TIMESTAMP '2026-10-11 01:02:03.123456') AS x",[["323032362D31302D31312030313A30323A30332E313233343536"]],[["x",253,208,0,31,224,"","","",""]],[]],
    ["SELECT TIMESTAMP '2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id",[[new Date("2026-10-11T01:02:03.123Z")],[new Date("2026-10-11T01:02:03.123Z")]],[["x",12,26,129,6,63,"","","",""]],[]],
    ["SELECT TIMESTAMP '2026-10-11 01:02:03.123456' FROM t ORDER BY id",[[new Date("2026-10-11T01:02:03.123Z")],[new Date("2026-10-11T01:02:03.123Z")]],[["TIMESTAMP '2026-10-11 01:02:03.123456'",12,26,129,6,63,"","","",""]],[]],
    ["SELECT TIMESTAMP '2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0",[],[["x",12,26,129,6,63,"","","",""]],[]],
    ["SELECT TIMESTAMP '2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],[["x",12,26,129,6,63,"","","",""]],[]],
    ["SELECT DATETIME 'label' FROM t ORDER BY id",[["column"],[null]],[["label",253,128,0,0,224,"datetime_admission","t","t","datetime"]],[]],
    ["SELECT datetime AS x FROM t ORDER BY id",[["column"],[null]],[["x",253,128,0,0,224,"datetime_admission","t","t","datetime"]],[]],
    ["SELECT `DATETIME` 'label' FROM t ORDER BY id",[["column"],[null]],[["label",253,128,0,0,224,"datetime_admission","t","t","datetime"]],[]],
    ["SELECT t.datetime 'label' FROM t ORDER BY id",[["column"],[null]],[["label",253,128,0,0,224,"datetime_admission","t","t","datetime"]],[]],
    ["SELECT CAST('2026-10-11 01:02:03.123456' AS DATETIME(6)) AS x",[[new Date("2026-10-11T01:02:03.123Z")]],[["x",12,26,128,6,63,"","","",""]],[]],
    ["SELECT DATE('2026-10-11') AS x",[[new Date("2026-10-11T00:00:00.000Z")]],[["x",10,10,128,0,63,"","","",""]],[]],
    ["SELECT TIME('01:02:03.123456') AS x",[["01:02:03.123456"]],[["x",11,17,128,6,63,"","","",""]],[]],
    ["SELECT TIMESTAMP('2026-10-11 01:02:03.123456') AS x",[[new Date("2026-10-11T01:02:03.123Z")]],[["x",12,26,128,6,63,"","","",""]],[]],
  ]
  const refusals: [string, [number, string, string]][] = [
    ["SELECT DATETIME '2026-10-11 01:02:03.123456' AS x",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x' at line 1"]],
    ["SELECT DATETIME '2026-10-11 01:02:03.123456'",[1054,"42S22","Unknown column 'DATETIME' in 'field list'"]],
    ["SELECT DATETIME '2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x FROM t ORDER BY id' at line 1"]],
    ["SELECT DATETIME '2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x FROM t ORDER BY id LIMIT 0' at line 1"]],
    ["SELECT DATETIME '2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x FROM t ORDER BY id LIMIT 0 OFFSET 1' at line 1"]],
    ["SELECT datetime'2026-10-11 01:02:03.123456' AS x",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x' at line 1"]],
    ["SELECT datetime'2026-10-11 01:02:03.123456'",[1054,"42S22","Unknown column 'datetime' in 'field list'"]],
    ["SELECT datetime'2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x FROM t ORDER BY id' at line 1"]],
    ["SELECT datetime'2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x FROM t ORDER BY id LIMIT 0' at line 1"]],
    ["SELECT datetime'2026-10-11 01:02:03.123456' AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'AS x FROM t ORDER BY id LIMIT 0 OFFSET 1' at line 1"]],
  ]
  try {
    await conn.query('CREATE DATABASE datetime_admission')
    await conn.query('USE datetime_admission')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,datetime VARCHAR(32))')
    await conn.query("INSERT INTO t VALUES(1,'column'),(2,NULL)")
    for (const [sql, expected, expectedFields, warnings] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [actual, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(actual, expected, method + ': rows: ' + sql)
        assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
        conn.unprepare(options)
      }
    }
    for (const [sql, expected] of refusals) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        await assert.rejects(() => method === 'query' ? conn.query(options) : conn.execute(options), error => {
          const e = error as { errno: number; sqlState: string; message: string }
          assert.deepEqual([e.errno, e.sqlState, e.message], expected, method + ': refusal: ' + sql)
          return true
        })
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE datetime_admission')
    await conn.end()
    await db?.end()
  }
})

test('cached DATETIME alias reads retain real column values after writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], [string | null, unknown[][], unknown[], unknown[]][]][] = [
    ["SELECT DATETIME 'label' FROM t ORDER BY id LIMIT ? OFFSET ?",[["label",253,128,0,0,224,"datetime_alias_fresh","t","t","datetime"]],[["2026-10-11 01:02:03.123456",[["2026-10-11 01:02:03.123456"]],[{"label":"2026-10-11 01:02:03.123456"}],[]],["not a date",[["not a date"]],[{"label":"not a date"}],[]],["",[[""]],[{"label":""}],[]],[null,[[null]],[{"label":null}],[]]]],
    ["SELECT datetime 'label' FROM t ORDER BY id LIMIT ? OFFSET ?",[["label",253,128,0,0,224,"datetime_alias_fresh","t","t","datetime"]],[["2026-10-11 01:02:03.123456",[["2026-10-11 01:02:03.123456"]],[{"label":"2026-10-11 01:02:03.123456"}],[]],["not a date",[["not a date"]],[{"label":"not a date"}],[]],["",[[""]],[{"label":""}],[]],[null,[[null]],[{"label":null}],[]]]],
    ["SELECT `DATETIME` 'label' FROM t ORDER BY id LIMIT ? OFFSET ?",[["label",253,128,0,0,224,"datetime_alias_fresh","t","t","datetime"]],[["2026-10-11 01:02:03.123456",[["2026-10-11 01:02:03.123456"]],[{"label":"2026-10-11 01:02:03.123456"}],[]],["not a date",[["not a date"]],[{"label":"not a date"}],[]],["",[[""]],[{"label":""}],[]],[null,[[null]],[{"label":null}],[]]]],
    ["SELECT t.datetime 'label' FROM t ORDER BY id LIMIT ? OFFSET ?",[["label",253,128,0,0,224,"datetime_alias_fresh","t","t","datetime"]],[["2026-10-11 01:02:03.123456",[["2026-10-11 01:02:03.123456"]],[{"label":"2026-10-11 01:02:03.123456"}],[]],["not a date",[["not a date"]],[{"label":"not a date"}],[]],["",[[""]],[{"label":""}],[]],[null,[[null]],[{"label":null}],[]]]],
  ]
  try {
    await conn.query('CREATE DATABASE datetime_alias_fresh')
    await conn.query('USE datetime_alias_fresh')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,datetime VARCHAR(32))')
    for (const [sql, expectedFields, writes] of fixtures) {
      await conn.query('DELETE FROM t')
      await conn.query("INSERT INTO t VALUES(1,'first'),(2,'middle'),(3,'last')")
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const prepared = statement as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual(fields(prepared.statement.columns), expectedFields, 'prepare: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], 'prepare warnings: ' + sql)
        for (const [value, expectedRows, expectedObjects, warnings] of writes) {
          await conn.query('UPDATE t SET datetime=? WHERE id=2', [value])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [actual, columns] = method === 'statement' ? await statement.execute([1,1]) : method === 'query' ? await conn.query(options, [1,1]) : await conn.execute(options, [1,1])
            assert.deepEqual(actual, method === 'statement' ? expectedObjects : expectedRows, method + ': rows: ' + sql)
            assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
          }
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE datetime_alias_fresh')
    await conn.end()
    await db?.end()
  }
})
