import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('matching integer equality infers an outer range without losing exact bounds or fresh data', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const schema = 'inferred_range111'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const type of ['INT', 'BIGINT', 'BIGINT UNSIGNED']) {
      const base = type === 'INT' ? 0n : 9007199254740992n
      const value = (g: number) => g === 0 ? 'NULL' : String(base + BigInt(g))
      const result = (g: number): number | string => type === 'INT' ? g : String(base + BigInt(g))
      await conn.query(`CREATE TABLE pa(id INT NOT NULL,g ${type},s VARCHAR(12),KEY(g)) STATS_AUTO_RECALC=0`)
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 20 }, (_, i) => `(${i+1},${value(i%4)},'same')`).join(','))
      await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 8 }, (_, i) => `(${i+1},${value((i+1)%4)})`).join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      const all = [2, 3].flatMap((g) => Array.from({ length: 5 }, (_, i) => [g, g+4].map((cid) => [g+1+i*4, result(g), 'same', cid])).flat())
      const ordered = all.toSorted((a, b) => Number(a[0]) - Number(b[0]) || Number(a[3]) - Number(b[3]))
      for (const reversed of [false, true]) for (const buffered of [true, false]) {
        await conn.query("SET optimizer_switch='default" + (buffered ? '' : ',block_nested_loop=off') + "'")
        const source = 'SELECT pa.id,pa.g,pa.s,ch.id AS cid FROM pa STRAIGHT_JOIN ch ON ' + (reversed ? 'ch.g=pa.g' : 'pa.g=ch.g') + ' WHERE ch.g>' + value(1)
        for (const suffix of ['', ' ORDER BY pa.id,ch.id', ' LIMIT 1']) {
          const sql = source + suffix
          const [plan] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
          // The actual range is shared; redundant child-filter elimination remains separate.
          assert.match(String(plan[0]?.EXPLAIN), /Index range scan on pa using g/)
          const sorted = suffix.startsWith(' ORDER')
          const expected = sorted ? ordered : suffix === '' ? all : all.slice(0, 1)
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, expected)
            const unsigned = type === 'BIGINT UNSIGNED' ? 32 : 0
            assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
              ['id', 3, 11, 4097, 0, 63, schema, 'pa', 'pa', 'id'],
              ['g', type === 'INT' ? 3 : 8, type === 'INT' ? 11 : 20, unsigned + (sorted ? 0 : 16392), 0, 63, schema, 'pa', 'pa', 'g'],
              ['s', 253, 48, 0, 0, 224, schema, 'pa', 'pa', 's'],
              ['cid', 3, 11, sorted ? 4097 : 20483, 0, 63, schema, 'ch', 'ch', 'id'],
            ])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            conn.unprepare(options)
          }
        }
      }
      // An ON residual cannot discard the preserved side, and a LATERAL block owns its own access.
      const left = 'SELECT pa.id,pa.g,pa.s,ch.id AS cid FROM pa LEFT JOIN ch ON pa.g=ch.g AND ch.g>' + value(1) + ' ORDER BY pa.id,ch.id'
      const lateral = 'SELECT pa.id,pa.g,pa.s,x.cid FROM pa JOIN LATERAL(SELECT ch.id AS cid FROM ch WHERE ch.g=pa.g AND ch.g>' + value(1) + ' LIMIT 2) AS x ON TRUE ORDER BY pa.id,x.cid'
      const preserved = Array.from({ length: 20 }, (_, i) => {
        const g = i % 4
        return g < 2 ? [[i+1, g === 0 ? null : result(g), 'same', null]] : [g, g+4].map((cid) => [i+1, result(g), 'same', cid])
      }).flat()
      for (const [sql, expected] of [[left, preserved], [lateral, ordered]] as const) {
        const [plan] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
        assert.doesNotMatch(String(plan[0]?.EXPLAIN), /Index range scan on pa using g/)
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, expected)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
          conn.unprepare(options)
        }
      }
      const sql = 'SELECT pa.id,pa.g,pa.s,ch.id AS cid FROM pa STRAIGHT_JOIN ch ON pa.g=ch.g WHERE ch.g>' + value(1) + ' AND pa.id>? ORDER BY pa.id,ch.id'
      const statement = await conn.prepare(sql)
      const objects = (rows: typeof all) => rows.map(([id, g, s, cid]) => ({ id, g, s, cid }))
      try {
        assert.deepEqual((await statement.execute([0]))[0], objects(ordered))
        assert.deepEqual((await statement.execute([10]))[0], objects(ordered.filter((row) => Number(row[0]) > 10)))
        await conn.query('UPDATE ch SET g=NULL WHERE id IN(2,6)')
        assert.deepEqual((await statement.execute([0]))[0], objects(ordered.filter((row) => row[1] === result(3))))
        await conn.query('UPDATE pa SET g=NULL')
        assert.deepEqual((await statement.execute([0]))[0], [])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      } finally { conn.unprepare(sql) }
      await conn.query('DROP TABLE pa,ch')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})
