import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('small filtered materialized scans retain native exact weedout ties and neighboring choices', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const schema = 'material_ties114'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const type of ['INT', 'BIGINT', 'BIGINT UNSIGNED']) {
      const base = type === 'INT' ? 0n : 9007199254740992n
      const value = (g: number) => g === 0 ? 'NULL' : String(base + BigInt(g))
      const result = (g: number): number | string => type === 'INT' ? g : String(base + BigInt(g))
      await conn.query(`CREATE TABLE pa(id INT NOT NULL,g ${type},s VARCHAR(12),KEY(g)) STATS_AUTO_RECALC=0`)
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
      for (const outer of [2, 4, 20]) for (const inner of [2, 8]) {
        await conn.query('DELETE FROM pa'); await conn.query('DELETE FROM ch')
        await conn.query('INSERT INTO pa VALUES' + Array.from({ length: outer }, (_, i) => `(${i+1},${value(i%4)},'same')`).join(','))
        await conn.query('INSERT INTO ch VALUES' + Array.from({ length: inner }, (_, i) => `(${i+1},${value((i+1)%4)})`).join(','))
        await conn.query('ANALYZE TABLE pa,ch')
        const expected = [2, ...(inner === 8 ? [3] : [])].flatMap((g) => Array.from({ length: outer }, (_, i) => i+1).filter((id) => (id-1)%4 === g).map((id) => [id, result(g), 'same']))
        for (const buffered of [true, false]) {
          await conn.query("SET optimizer_switch='default,firstmatch=off,loosescan=off" + (buffered ? '' : ',block_nested_loop=off') + "'")
          for (const predicate of ['g IN(SELECT g FROM ch WHERE g>', 'EXISTS(SELECT 1 FROM ch WHERE pa.g=ch.g AND ch.g>', 'EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g AND ch.g>']) {
            const sql = 'SELECT id,g,s FROM pa WHERE ' + predicate + value(1) + ')'
            const [plan] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
            const text = String(plan[0]?.EXPLAIN)
            if (inner === 2 || outer === 20) {
              assert.match(text, /Materialize with deduplication/)
              assert.match(text, /Table scan on <subquery2>/)
              assert.match(text, /Index lookup on pa using g/)
            } else {
              assert.doesNotMatch(text, /Materialize with deduplication|Remove duplicate/)
              assert.match(text, /Index range scan on pa using g/)
              assert.match(text, /Covering index lookup on ch using g/)
            }
            // Redundant child Filter placement is outside the exact strategy-tie contract.
            for (const method of ['query', 'execute'] as const) {
              const options = { sql, rowsAsArray: true }
              const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
              assert.deepEqual(rows, expected)
              assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
                ['id', 3, 11, 4097, 0, 63, schema, 'pa', 'pa', 'id'],
                ['g', type === 'INT' ? 3 : 8, type === 'INT' ? 11 : 20, type.endsWith('UNSIGNED') ? 16424 : 16392, 0, 63, schema, 'pa', 'pa', 'g'],
                ['s', 253, 48, 0, 0, 224, schema, 'pa', 'pa', 's'],
              ])
              assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
              conn.unprepare({ sql, rowsAsArray: true })
            }
          }
        }
      }
      await conn.query('DROP TABLE pa,ch')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})
