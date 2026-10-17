import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

test('filtered integer materialization preserves native bounds, strategies, fields and fresh LIMIT values', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const schema = 'filtered_material112'
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
      const all = [2, 3].flatMap((g) => Array.from({ length: 5 }, (_, i) => [g+1+i*4, result(g), 'same']))
      const forms = ['g IN(SELECT g FROM ch WHERE g>', 'EXISTS(SELECT 1 FROM ch WHERE pa.g=ch.g AND ch.g>', 'EXISTS(SELECT 1 FROM ch WHERE ch.g=pa.g AND ch.g>']
      for (const buffered of [true, false]) {
        await conn.query("SET optimizer_switch='default,firstmatch=off,loosescan=off" + (buffered ? '' : ',block_nested_loop=off') + "'")
        for (const form of forms) for (const suffix of ['', ' LIMIT 1', ' ORDER BY g,s,id', ' ORDER BY g,s,id LIMIT 1', ' ORDER BY g,s,id LIMIT 10', ' ORDER BY id DESC LIMIT 10']) {
          const sql = 'SELECT id,g,s FROM pa WHERE ' + form + value(1) + ')' + suffix
          const [plan] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
          const text = String(plan[0]?.EXPLAIN)
          assert.match(text, /Materialize with deduplication/)
          assert.match(text, /Covering index range scan on ch using g/)
          const lookup = suffix === ' ORDER BY g,s,id LIMIT 1'
          assert.match(text, lookup ? /Single-row index lookup on <subquery2>/ : /Index lookup on pa using g/)
          // Native retains one additional redundant Filter; full plan parity remains open.
          const streamed = suffix.startsWith(' ORDER') && !lookup
          const expected = suffix === ' LIMIT 1' || lookup ? all.slice(0, 1) : suffix.startsWith(' ORDER BY id DESC') ? all.toSorted((a, b) => Number(b[0]) - Number(a[0])) : all
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, expected)
            assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
              ['id', 3, 11, 4097, 0, 63, schema, 'pa', 'pa', 'id'],
              ['g', type === 'INT' ? 3 : 8, type === 'INT' ? 11 : 20, (type === 'BIGINT UNSIGNED' ? 32 : 0) + (streamed ? 0 : 16392), 0, 63, schema, 'pa', 'pa', 'g'],
              ['s', 253, 48, 0, 0, 224, schema, 'pa', 'pa', 's'],
            ])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            conn.unprepare(options)
          }
        }
      }
      const sql = 'SELECT id,g,s FROM pa WHERE EXISTS(SELECT 1 FROM ch WHERE pa.g=ch.g AND ch.g>' + value(1) + ') ORDER BY g,s,id LIMIT ?'
      const statement = await conn.prepare(sql)
      const objects = (rows: typeof all) => rows.map(([id, g, s]) => ({ id, g, s }))
      try {
        assert.deepEqual((await statement.execute([1]))[0], objects(all.slice(0, 1)))
        assert.deepEqual((await statement.execute([10]))[0], objects(all))
        assert.deepEqual((await statement.execute([0]))[0], [])
        await conn.query('UPDATE ch SET g=NULL WHERE id IN(2,6)')
        assert.deepEqual((await statement.execute([10]))[0], objects(all.filter((row) => row[1] === result(3))))
        await conn.query('UPDATE pa SET g=NULL WHERE MOD(id,4)=0')
        assert.deepEqual((await statement.execute([10]))[0], [])
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
      } finally { conn.unprepare(sql) }
      await conn.query('DROP TABLE pa,ch')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('filtered eager builds finish before point probes and close on LIMIT and cancellation', async () => {
  for (const buffered of [true, false]) {
    const db = await MySQL.open(':memory:')
    const schema = 'filtered_reads112', payload = 'same'.repeat(50)
    const switches = "SET optimizer_switch='default,firstmatch=off,loosescan=off" + (buffered ? '' : ',block_nested_loop=off') + "'"
    try {
      await db.query(`CREATE DATABASE ${schema}`)
      await db.query(`CREATE TABLE ${schema}.pa(id INT NOT NULL,g INT,s VARCHAR(255),KEY(g)) STATS_AUTO_RECALC=0`)
      await db.query(`CREATE TABLE ${schema}.ch(id INT PRIMARY KEY,g INT,KEY(g)) STATS_AUTO_RECALC=0`)
      await db.query(`INSERT INTO ${schema}.pa VALUES` + Array.from({ length: 4096 }, (_, i) => `(${i+1},${i%4===0 ? 'NULL' : i%4},'${payload}')`).join(','))
      await db.query(`INSERT INTO ${schema}.ch VALUES(1,1),(2,2),(3,3),(4,NULL),(5,1),(6,2),(7,3),(8,NULL)`)
      await db.query(`ANALYZE TABLE ${schema}.pa,${schema}.ch`)
      await db.query(switches)
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
      const sql = `SELECT id,g,s FROM ${schema}.pa WHERE EXISTS(SELECT 1 FROM ${schema}.ch WHERE pa.g=ch.g AND ch.g>1)`
      try {
        const [rows] = await db.query<unknown[]>(sql + ' ORDER BY g,s,id FOR UPDATE')
        assert.equal(rows.length, 2048)
        assert.deepEqual(['ch:open', 'ch:row', 'ch:close', 'pa:open', 'pa:row', 'pa:close'].map((e) => events.filter((x) => x === e).length), [1, 4, 1, 2, 2048, 2])
        assert.deepEqual(events.slice(0, 6), ['ch:open', 'ch:row', 'ch:row', 'ch:row', 'ch:row', 'ch:close'])
        events = []
        assert.deepEqual((await db.query(sql + ' LIMIT 1 FOR UPDATE'))[0], [{ id: 3, g: 2, s: payload }])
        assert.deepEqual(events.slice(6), ['pa:open', 'pa:row', 'pa:close'])
        assert.equal(events.filter((e) => e === 'ch:row').length, 4)
        events = []
        const streaming = await db.connect()
        try {
          await streaming.query(switches)
          const wide = sql.replace('SELECT id,g,s FROM', 'SELECT id,g,REPEAT(s,16) AS s FROM')
          for await (const row of streaming.stream<{ s: string }>(wide + ' FOR UPDATE')) { assert.equal(row.s, payload.repeat(16)); break }
        } finally { await streaming.end() }
        assert.deepEqual(events.slice(0, 6), ['ch:open', 'ch:row', 'ch:row', 'ch:row', 'ch:row', 'ch:close'])
        const visited = events.filter((e) => e === 'pa:row').length
        assert.ok(visited > 0 && visited < 2048)
        assert.equal(events.filter((e) => e === 'pa:open').length, events.filter((e) => e === 'pa:close').length)
      } finally { db.catalog!.table = open }
      const writer = await db.connect()
      try { await writer.query('SET innodb_lock_wait_timeout=1'); await writer.query(`UPDATE ${schema}.pa SET g=4 WHERE id=3`) }
      finally { await writer.end() }
    } finally { await db.end() }
  }
})
