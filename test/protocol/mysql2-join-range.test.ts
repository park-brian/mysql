import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('join range quotes preserve native ref choices, fields, buffering, order and fresh parameters', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  const schema = 'join_range110'
  const indent = (plan: string, spaces: number) => plan.split('\n').map((line) => ' '.repeat(spaces) + line).join('\n')
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const covering of [false, true]) {
      await conn.query('CREATE TABLE pa(id INT PRIMARY KEY) STATS_AUTO_RECALC=0')
      await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g INT,pa_id INT,KEY lookup_key(pa_id),KEY range_key(g' + (covering ? ',pa_id' : '') + ')) STATS_AUTO_RECALC=0')
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: 20 }, (_, i) => `(${i+1})`).join(','))
      await conn.query('INSERT INTO ch VALUES' + Array.from({ length: 64 }, (_, i) => `(${i+1},${i<2 ? i+1 : 0},${i%2+1})`).join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      for (const buffered of [true, false]) {
        await conn.query("SET optimizer_switch='default" + (buffered ? '' : ',block_nested_loop=off') + "'")
        for (const bound of [0, -1, 999]) for (const suffix of ['', ' ORDER BY pa.id,ch.g', ' LIMIT 1']) {
          const sql = 'SELECT pa.id,ch.g,ch.pa_id FROM pa STRAIGHT_JOIN ch ON ch.pa_id=pa.id WHERE ch.g>' + bound + suffix
          const ordered = suffix.startsWith(' ORDER')
          const broad = [1, 2].flatMap((id) => Array.from({ length: 32 }, (_, i) => [id, i === 0 ? id : 0, id]))
          const all = bound === 999 ? [] : bound === 0 ? [[1, 1, 1], [2, 2, 2]] : broad
          const expected = ordered ? all.toSorted((a, b) => a[0]! - b[0]! || a[1]! - b[1]!) : suffix === ' LIMIT 1' ? all.slice(0, 1) : all
          let plan = bound === -1
            ? 'Nested loop inner join\n    Covering index scan on pa using PRIMARY\n    Filter\n        Index lookup on ch using lookup_key'
            : buffered
              ? 'Inner hash join\n' + (covering ? '    Filter\n        Covering index' : '    Index') + ' range scan on ch using range_key over\n    Hash\n        Covering index scan on pa using PRIMARY'
              : 'Nested loop inner join\n    Covering index scan on pa using PRIMARY\n    Filter\n        ' + (covering ? 'Covering index' : 'Index') + ' range scan on ch using range_key over'
          if (ordered) plan = 'Sort\n    Stream results\n' + indent(plan, 8)
          else if (suffix !== '') plan = 'Limit\n' + indent(plan, 4)
          const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${covering}/${buffered}/${bound}/${suffix}`)
          for (const method of ['query', 'execute'] as const) {
            const options = { sql, rowsAsArray: true }
            const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, expected)
            assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [
              ['id', 3, 11, ordered ? 4097 : 20483, 0, 63, schema, 'pa', 'pa', 'id'],
              ['g', 3, 11, ordered ? 0 : 16392, 0, 63, schema, 'ch', 'ch', 'g'],
              ['pa_id', 3, 11, ordered ? 0 : 16392, 0, 63, schema, 'ch', 'ch', 'pa_id'],
            ])
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [])
            conn.unprepare(options)
          }
        }
        const sql = 'SELECT pa.id,ch.g,ch.pa_id FROM pa STRAIGHT_JOIN ch ON ch.pa_id=pa.id WHERE ch.g>? ORDER BY pa.id,ch.g'
        const statement = await conn.prepare(sql)
        try {
          assert.deepEqual((await statement.execute([0]))[0], [{ id: 1, g: 1, pa_id: 1 }, { id: 2, g: 2, pa_id: 2 }])
          assert.deepEqual((await statement.execute([1]))[0], [{ id: 2, g: 2, pa_id: 2 }])
          assert.deepEqual((await statement.execute([999]))[0], [])
          await conn.query('UPDATE ch SET g=0 WHERE id<=2')
          assert.deepEqual((await statement.execute([0]))[0], [])
          await conn.query('UPDATE ch SET g=id WHERE id<=2')
        } finally { conn.unprepare(sql) }
      }
      await conn.query('DROP TABLE pa,ch')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end(); await db?.end()
  }
})

test('buffered and repeated range joins close reads under LIMIT and stream cancellation', async () => {
  for (const covering of [false, true]) for (const buffered of [true, false]) {
    const db = await MySQL.open(':memory:')
    const schema = 'join_range_reads110'
    const payload = 'same'.repeat(50)
    const switches = "SET optimizer_switch='default" + (buffered ? '' : ',block_nested_loop=off') + "'"
    try {
      await db.query(`CREATE DATABASE ${schema}`)
      await db.query(`CREATE TABLE ${schema}.pa(id INT PRIMARY KEY) STATS_AUTO_RECALC=0`)
      await db.query(`CREATE TABLE ${schema}.ch(id INT PRIMARY KEY,g INT,pa_id INT,s VARCHAR(255),KEY lookup_key(pa_id),KEY range_key(g${covering ? ',pa_id,s' : ''})) STATS_AUTO_RECALC=0`)
      await db.query(`INSERT INTO ${schema}.pa VALUES` + Array.from({ length: 20 }, (_, i) => `(${i+1})`).join(','))
      await db.query(`INSERT INTO ${schema}.ch VALUES` + Array.from({ length: 16384 }, (_, i) => `(${i+1},${i<2048 ? 1 : 0},${i%2+1},'${payload}')`).join(','))
      await db.query(`ANALYZE TABLE ${schema}.pa,${schema}.ch`)
      await db.query(switches)
      const open = db.catalog!.table.bind(db.catalog)
      let opened = 0, visited = 0, closed = 0
      db.catalog!.table = (s, name, trx) => {
        const table = open(s, name, trx)
        if (s === schema && name === 'ch') {
          const scan = table.indexScan.bind(table)
          table.indexScan = function*(index, range, transaction, mode) {
            if (mode !== 'current') { yield* scan(index, range, transaction, mode); return }
            assert.equal(index, 'range_key')
            opened++
            try { for (const row of scan(index, range, transaction, mode)) { visited++; yield row } }
            finally { closed++ }
          }
        }
        return table
      }
      const sql = `SELECT pa.id,ch.g,ch.pa_id,ch.s FROM ${schema}.pa STRAIGHT_JOIN ${schema}.ch ON ch.pa_id=pa.id WHERE ch.g>0`
      try {
        const [rows] = await db.query<unknown[]>(sql + ' ORDER BY pa.id FOR UPDATE')
        assert.equal(rows.length, 2048)
        assert.deepEqual([opened, visited, closed], buffered ? [1, 2048, 1] : [20, 40960, 20])
        opened = visited = closed = 0
        assert.deepEqual((await db.query(sql + ' LIMIT 1 FOR UPDATE'))[0], [{ id: 1, g: 1, pa_id: 1, s: payload }])
        assert.deepEqual([opened, visited, closed], [1, 1, 1])
        opened = visited = closed = 0
        const streaming = await db.connect()
        try {
          await streaming.query(switches)
          // Exceed both protocol queues so cancellation interrupts an active range.
          const wide = sql.replace('ch.s FROM', 'REPEAT(ch.s,16) AS s FROM')
          for await (const row of streaming.stream<{ s: string }>(wide + ' FOR UPDATE')) { assert.equal(row.s, payload.repeat(16)); break }
        } finally { await streaming.end() }
        assert.equal(opened, closed)
        assert.ok(visited > 0 && visited < (buffered ? 2048 : 40960), JSON.stringify({ covering, buffered, opened, visited, closed }))
      } finally { db.catalog!.table = open }
      const writer = await db.connect()
      try {
        await writer.query('SET innodb_lock_wait_timeout=1')
        await writer.query(`UPDATE ${schema}.ch SET g=0 WHERE id=1`)
      } finally { await writer.end() }
    } finally { await db.end() }
  }
})
