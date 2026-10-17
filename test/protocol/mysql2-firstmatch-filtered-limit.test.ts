import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('filtered ordered LIMIT retains native FirstMatch competition, neighboring choices and fields', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const schema = 'firstmatch_limit115'
  // Native default / loosescan=off / firstmatch=off observations. Other means
  // a remaining LooseScan/weedout difference; its full tree is not claimed here.
  const cases = [
    { outer: 2, inner: 2, flags: [0, 16392, 0], strategies: ['other', 'first', 'other'] },
    { outer: 2, inner: 8, flags: [16392, 16392, 16392], strategies: ['first', 'first', 'other'] },
    { outer: 4, inner: 2, flags: [16392, 16392, 0], strategies: ['first', 'first', 'other'] },
    { outer: 4, inner: 8, flags: [16392, 16392, 0], strategies: ['first', 'first', 'other'] },
    { outer: 20, inner: 2, flags: [0, 16392, 0], strategies: ['other', 'material', 'other'] },
    { outer: 20, inner: 8, flags: [16392, 16392, 16392], strategies: ['material', 'material', 'material'] },
  ]
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const type of ['INT', 'BIGINT', 'BIGINT UNSIGNED']) {
      const base = type === 'INT' ? 0n : 9007199254740992n
      const value = (g: number) => g === 0 ? 'NULL' : String(base + BigInt(g))
      const result = (g: number): number | string => type === 'INT' ? g : String(base + BigInt(g))
      await conn.query(`CREATE TABLE pa(id INT NOT NULL,g ${type},s VARCHAR(12),KEY(g)) STATS_AUTO_RECALC=0`)
      await conn.query(`CREATE TABLE ch(id INT PRIMARY KEY,g ${type},KEY(g)) STATS_AUTO_RECALC=0`)
      for (const { outer, inner, flags, strategies } of cases) {
        await conn.query('DELETE FROM pa'); await conn.query('DELETE FROM ch')
        await conn.query('INSERT INTO pa VALUES' + Array.from({ length: outer }, (_, i) => `(${i+1},${value(i%4)},'same')`).join(','))
        await conn.query('INSERT INTO ch VALUES' + Array.from({ length: inner }, (_, i) => `(${i+1},${value((i+1)%4)})`).join(','))
        await conn.query('ANALYZE TABLE pa,ch')
        for (const buffered of [true, false]) for (const [mode, switches] of ['default', 'default,loosescan=off', 'default,firstmatch=off'].entries()) {
          await conn.query('SET optimizer_switch=' + mysql.escape(switches + (buffered ? '' : ',block_nested_loop=off')))
          for (const predicate of ['g IN(SELECT g FROM ch WHERE g>', 'EXISTS(SELECT 1 FROM ch WHERE pa.g=ch.g AND ch.g>', 'EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g AND ch.g>']) {
            const sql = 'SELECT id,g,s FROM pa WHERE ' + predicate + value(1) + ') ORDER BY g,s,id LIMIT 1'
            const [plan] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
            const text = String(plan[0]?.EXPLAIN)
            const strategy = strategies[mode]
            assert.equal(text.includes('Nested loop semijoin'), strategy === 'first')
            assert.equal(text.includes('Materialize with deduplication'), strategy === 'material')
            if (strategy === 'first') {
              assert.match(text, /Index range scan on pa using g/)
              assert.match(text, /Covering index lookup on ch using g/)
            }
            // Additional child filters and other LooseScan/weedout trees remain separate.
            for (const method of ['query', 'execute'] as const) {
              const options = { sql, rowsAsArray: true }
              const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
              assert.deepEqual(rows, outer === 2 ? [] : [[3, result(2), 'same']])
              assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
                ['id', 3, 11, 4097, 0, 63, schema, 'pa', 'pa', 'id'],
                ['g', type === 'INT' ? 3 : 8, type === 'INT' ? 11 : 20, (flags[mode] as number) + (type.endsWith('UNSIGNED') ? 32 : 0), 0, 63, schema, 'pa', 'pa', 'g'],
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

test('filtered ordered FirstMatch closes its sort input before one probe and releases locking streams', async () => {
  for (const buffered of [true, false]) {
    const db = await MySQL.open(':memory:')
    const schema = 'firstmatch_reads115'
    try {
      await db.query(`CREATE DATABASE ${schema}`)
      await db.query(`CREATE TABLE ${schema}.pa(id INT NOT NULL,g INT,s VARCHAR(12),KEY(g)) STATS_AUTO_RECALC=0`)
      await db.query(`CREATE TABLE ${schema}.ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0`)
      await db.query(`INSERT INTO ${schema}.pa VALUES(1,NULL,'same'),(2,1,'same'),(3,2,'same'),(4,3,'same')`)
      await db.query(`INSERT INTO ${schema}.ch VALUES(1,1),(2,2)`)
      await db.query(`ANALYZE TABLE ${schema}.pa,${schema}.ch`)
      const open = db.catalog!.table.bind(db.catalog)
      let events: string[] = []
      db.catalog!.table = (s, name, trx) => {
        const table = open(s, name, trx)
        if (s === schema && (name === 'pa' || name === 'ch')) {
          const scan = table.indexScan.bind(table)
          table.indexScan = function*(index, range, transaction, mode) {
            if (mode !== 'current') { yield* scan(index, range, transaction, mode); return }
            assert.equal(index, 'g')
            events.push(name + ':open')
            try { for (const row of scan(index, range, transaction, mode)) { events.push(name + ':row'); yield row } }
            finally { events.push(name + ':close') }
          }
        }
        return table
      }
      const conn = await db.connect()
      const sql = `SELECT id,g,s FROM ${schema}.pa WHERE EXISTS(SELECT 1 FROM ${schema}.ch WHERE pa.g=ch.g AND ch.g>1) ORDER BY g,s,id LIMIT 1 FOR UPDATE`
      try {
        await conn.query("SET optimizer_switch='default" + (buffered ? '' : ',block_nested_loop=off') + "'")
        const check = () => assert.deepEqual(events, ['pa:open', 'pa:row', 'pa:row', 'pa:close', 'ch:open', 'ch:row', 'ch:close'])
        assert.deepEqual((await conn.query(sql))[0], [{ id: 3, g: 2, s: 'same' }])
        check()
        events = []
        const wide = sql.replace('SELECT id,g,s FROM', 'SELECT id,g,REPEAT(s,8192) AS s FROM')
        for await (const row of conn.stream<{ s: string }>(wide)) { assert.equal(row.s, 'same'.repeat(8192)); break }
        check()
      } finally { await conn.end(); db.catalog!.table = open }
      const writer = await db.connect()
      try {
        await writer.query('SET innodb_lock_wait_timeout=1')
        await writer.query(`UPDATE ${schema}.pa SET s='changed' WHERE id=3`)
        await writer.query(`UPDATE ${schema}.ch SET g=3 WHERE id=2`)
      } finally { await writer.end() }
    } finally { await db.end() }
  }
})
