import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

// MySQL 8.4.11's UNION DECIMAL holder is signed even when every source is unsigned.
const integers = [
  ['TINYINT UNSIGNED', '255', 10],
  ['SMALLINT UNSIGNED', '65535', 10],
  ['MEDIUMINT UNSIGNED', '16777215', 12],
  ['INT UNSIGNED', '4294967295', 14],
  ['BIGINT UNSIGNED', '18446744073709551615', 24],
] as const

test('unsigned DECIMAL UNION holders retain signed metadata across NULLs, integers and nesting', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE union_decimal119')
    await conn.query('USE union_decimal119')
    await conn.query('CREATE TABLE n(d DECIMAL(8,2) UNSIGNED,' + integers.map(([type], i) => `c${i} ${type}`).join(',') + ')')
    await conn.query('INSERT INTO n VALUES(1.25,0,0,0,0,0),(2.25,' + integers.map(([, max]) => max).join(',') + ')')
    const operands = [
      ...integers.map(([, max, length], i) => ({ sql: `SELECT c${i} AS v FROM n`, values: ['0.00', `${max}.00`], length })),
      { sql: 'SELECT d AS v FROM n', values: ['1.25', '2.25'], length: 10 },
      { sql: 'SELECT NULL AS v', values: [null], length: 10 },
      { sql: 'SELECT NULL AS v WHERE FALSE', values: [], length: 10 },
      { sql: 'SELECT CAST(1 AS UNSIGNED) AS v', values: ['1.00'], length: 25 },
    ]
    for (const operand of operands) for (const reverse of [false, true]) for (const op of ['UNION ALL', 'UNION']) {
      const decimal = 'SELECT d AS v FROM n'
      const base = `${reverse ? operand.sql : decimal} ${op} ${reverse ? decimal : operand.sql}`
      const values = reverse ? [...operand.values, '1.25', '2.25'] : ['1.25', '2.25', ...operand.values]
      const rows = op === 'UNION' ? [...new Set(values)] : values
      for (const variant of [
        { sql: base, values: rows, length: operand.length },
        { sql: `(${base}) UNION ALL SELECT NULL`, values: [...rows, null], length: operand.length },
        { sql: `SELECT NULL AS v UNION ALL (${base})`, values: [null, ...rows], length: operand.length },
        { sql: `(${base}) UNION ALL SELECT CAST(1 AS UNSIGNED)`, values: [...rows, '1.00'], length: 25 },
      ]) for (const method of ['query', 'execute'] as const) {
        const options = { sql: variant.sql, rowsAsArray: true }
        const [result, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(result, variant.values.map((v) => [v]), `${method}: ${variant.sql}`)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
          ['v', 246, variant.length, 0, 2, 63, '', '', '', 'v'],
        ], `${method}: ${variant.sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${variant.sql}`)
        conn.unprepare(options)
      }
    }
    // A run of NULLs contributes nullability, without becoming a binary
    // string before the first live branch. All-NULL retains its own holder.
    const profiles = [
      { sql: 'NULL', value: null, field: [253, 0, 128, 0, 63] },
      { sql: '1', value: '1', field: [8, 2, 0, 0, 63] },
      { sql: 'CAST(1 AS UNSIGNED)', value: '1', field: [8, 21, 32, 0, 63] },
      { sql: '1.25', value: '1.25', field: [246, 5, 0, 2, 63] },
      { sql: "'a'", value: 'a', field: [253, 4, 0, 0, 224] },
      { sql: "X'61'", value: Buffer.from([97]), field: [253, 1, 128, 0, 63] },
    ]
    for (const profile of profiles) for (const count of [2, 3, 4]) for (const op of ['UNION ALL', 'UNION']) for (const method of ['query', 'execute'] as const) {
      const sql = Array.from({ length: count }, () => 'SELECT NULL AS v').join(` ${op} `) + ` ${op} SELECT ${profile.sql} AS v`
      const options = { sql, rowsAsArray: true }
      const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      const values = [...Array<null>(count).fill(null), profile.value]
      assert.deepEqual(rows, (op === 'UNION' ? [...new Set(values)] : values).map((v) => [v]), `${method}: ${sql}`)
      assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
        ['v', ...profile.field, '', '', '', 'v'],
      ], `${method}: ${sql}`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
      conn.unprepare(options)
    }
    const [rows, fields] = await conn.query('SELECT d FROM n')
    assert.deepEqual(rows, [{ d: '1.25' }, { d: '2.25' }])
    assert.deepEqual(fields.map((f) => [f.columnType, f.columnLength, f.flags, f.decimals, f.schema, f.table, f.orgName]), [[246, 9, 32, 2, 'union_decimal119', 'n', 'd']])
  } finally {
    await conn.query('DROP DATABASE IF EXISTS union_decimal119')
    await conn.end(); await db?.end()
  }
})
