import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

// Captured from MySQL 8.4.11 with signed/unsigned storage boundaries in both
// protocols. Each row is the result field for one left type against all ten.
const fields = [
  [1, 2, 2, 9, 9, 3, 3, 8, 8, 246],
  [2, 1, 2, 2, 9, 9, 3, 3, 8, 8],
  [2, 2, 2, 9, 9, 3, 3, 8, 8, 246],
  [9, 2, 9, 2, 9, 9, 3, 3, 8, 8],
  [9, 9, 9, 9, 9, 3, 3, 8, 8, 246],
  [3, 9, 3, 9, 3, 9, 3, 3, 8, 8],
  [3, 3, 3, 3, 3, 3, 3, 8, 8, 246],
  [8, 3, 8, 3, 8, 3, 8, 3, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8, 8, 246],
  [246, 8, 246, 8, 246, 8, 246, 8, 246, 8],
] as const
const types = ['TINYINT', 'TINYINT UNSIGNED', 'SMALLINT', 'SMALLINT UNSIGNED', 'MEDIUMINT', 'MEDIUMINT UNSIGNED', 'INT', 'INT UNSIGNED', 'BIGINT', 'BIGINT UNSIGNED']
const widths = [4, 3, 6, 5, 9, 8, 11, 10, 20, 20]
const low = ['-128', '0', '-32768', '0', '-8388608', '0', '-2147483648', '0', '-9223372036854775808', '0']
const high = ['127', '255', '32767', '65535', '8388607', '16777215', '2147483647', '4294967295', '9223372036854775807', '18446744073709551615']

test('integer UNIONs preserve both signed and unsigned storage boundaries and complete metadata', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE union_signedness117')
    await conn.query('USE union_signedness117')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,' + types.map((t, i) => `c${i} ${t}`).join(',') + ')')
    await conn.query('INSERT INTO a VALUES(1,' + low.join(',') + '),(2,' + high.join(',') + ')')
    for (let i = 0; i < types.length; i++) for (let j = 0; j < types.length; j++) {
      const field = fields[i]![j]!
      const unsigned = i % 2 === 1 && j % 2 === 1
      const length = field === 246 ? 21 : Math.max(widths[i]!, widths[j]!)
      const value = (v: string) => field === 8 || field === 246 ? v : Number(v)
      for (const op of ['UNION ALL', 'UNION']) {
        const left = `SELECT c${i} AS v FROM a`
        const right = `SELECT c${j} AS v FROM a`
        const values = [low[i]!, high[i]!, low[j]!, high[j]!]
        const base = op === 'UNION' ? [...new Set(values)] : values
        // Nested and NULL branches must retain the integer merge, while an
        // empty branch still contributes its metadata and no rows.
        const variants = [
          { sql: `${left} ${op} ${right}`, values: base },
          ...(i % 2 === 0 && j === i + 1 ? [
            { sql: `(${left} ${op} ${right}) UNION ALL SELECT NULL`, values: [...base, null] },
            { sql: `SELECT NULL AS v UNION ALL (${left} ${op} ${right})`, values: [null, ...base] },
            { sql: `${left} ${op} (${right} UNION ALL SELECT NULL WHERE FALSE)`, values: base },
          ] : []),
        ]
        for (const { sql, values } of variants) for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, values.map((v) => [v === null ? null : value(v)]), `${method}: ${sql}`)
          assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
            ['v', field, length, unsigned ? 32 : 0, 0, 63, '', '', '', 'v'],
          ], `${method}: ${sql}`)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
          conn.unprepare(options)
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS union_signedness117')
    await conn.end(); await db?.end()
  }
})
