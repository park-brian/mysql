// M5.49: supply outer order before the indexed semijoin probes its inner table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

const base = 'SELECT name FROM pa WHERE id IN (SELECT pa_id FROM ch WHERE id>1)'
const inner = '    Filter\n        Covering index lookup on ch using pa_id'
const cover = `Nested loop semijoin\n    Covering index scan on pa using name\n${inner}`
const primary = cover.replace('Covering index scan on pa using name', 'Index scan on pa using PRIMARY')
const sorted = cover.replace('    Covering index scan', '    Sort\n        Covering index scan')
const limited = (plan: string, label = 'Limit') => `${label}\n${plan.split('\n').map((s) => `    ${s}`).join('\n')}`

async function populate(query: (sql: string) => Promise<unknown>, descending = false) {
  await query(`CREATE TABLE pa(id INT,name VARCHAR(12) NOT NULL,PRIMARY KEY(id${descending ? ' DESC' : ''}),UNIQUE KEY(name)) STATS_AUTO_RECALC=0`)
  await query('CREATE TABLE ch(id INT PRIMARY KEY,pa_id INT,KEY(pa_id)) STATS_AUTO_RECALC=0')
  await query("INSERT INTO pa VALUES(1,'z'),(2,'a'),(3,'empty')")
  await query('INSERT INTO ch VALUES(1,1),(2,1),(3,1),(4,2),(5,NULL),' + Array.from({ length: 200 }, (_, i) => `(${i + 10},${i + 10})`).join(','))
  await query('ANALYZE TABLE pa,ch')
}

test('outer-first semijoins choose ordered PRIMARY or covering scans and sort before probing', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const run = async (sql: string, expected: unknown[][], plan: string, alias = 'pa', name = 'name') => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(rows, expected, `${method}: ${sql}`)
      assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]),
        [[name, 253, 48, 20485, 0, 224, 'semi_order', alias, 'pa', 'name']], `${method}: fields`)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: warnings`)
      const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
      assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, `${method}: ${sql}`)
      conn.unprepare(options)
    }
  }
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS semi_order')
    await conn.query('USE semi_order')
    await conn.query('DROP TABLE IF EXISTS pa,ch')
    await populate((sql) => conn.query(sql))
    await run(base, [['a'], ['z']], cover)
    for (const desc of [false, true]) {
      const order = desc ? ' DESC' : ''
      const rows = desc ? [['a'], ['z']] : [['z'], ['a']]
      await run(`${base} ORDER BY id${order}`, rows, primary)
      await run(`${base} ORDER BY id${order} LIMIT 1`, rows.slice(0, 1), limited(primary))
      await run(`${base} ORDER BY name${order}`, [...rows].reverse(), cover)
    }
    await run(`${base} ORDER BY id LIMIT 1 OFFSET 1`, [['a']], limited(primary, 'Limit/Offset'))
    await run(`${base} ORDER BY name DESC LIMIT 1`, [['z']], limited(cover))
    await run(`${base} ORDER BY name,id`, [['a'], ['z']], cover)
    await run(`${base.replace('SELECT name', 'SELECT name AS label')} ORDER BY label DESC`, [['z'], ['a']], cover, 'pa', 'label')
    await run('SELECT name AS label FROM pa ORDER BY label DESC', [['z'], ['empty'], ['a']], 'Covering index scan on pa using name', 'pa', 'label')
    await run(`${base} ORDER BY id + 0`, [['z'], ['a']], sorted)
    await run(`${base} ORDER BY id DESC,name ASC`, [['a'], ['z']], sorted)
    await run('SELECT p.name FROM pa p WHERE EXISTS (SELECT 1 FROM ch c WHERE p.id=c.pa_id AND c.id>1) ORDER BY p.id DESC',
      [['a'], ['z']], primary.replaceAll('on pa ', 'on p ').replaceAll('on ch ', 'on c '), 'p')
    await conn.query("SET optimizer_switch='prefer_ordering_index=off'")
    await run(`${base} ORDER BY id`, [['z'], ['a']], sorted)
    await run(`${base} ORDER BY id LIMIT 1`, [['z']], limited(sorted))
    await conn.query("SET optimizer_switch='prefer_ordering_index=on,firstmatch=off'")
    const distinct = primary.replace('Nested loop semijoin', 'Nested loop inner join').replace('    Filter', '    Limit\n        Filter').replace('        Covering index lookup', '            Covering index lookup')
    await run(`${base} ORDER BY id`, [['z'], ['a']], distinct)
    await run(`${base} ORDER BY id LIMIT 1`, [['z']], limited(distinct))
    await conn.query("SET optimizer_switch='firstmatch=on'")
    await conn.query('UPDATE ch SET pa_id=2 WHERE id IN (2,3)')
    await run(`${base} ORDER BY id`, [['a']], primary)
    await conn.query('DROP TABLE pa,ch')
    await populate((sql) => conn.query(sql), true)
    for (const desc of [false, true]) {
      const order = desc ? ' DESC' : ''
      const rows = desc ? [['a'], ['z']] : [['z'], ['a']]
      await run(`${base} ORDER BY id${order}`, rows, primary)
      await run(`${base} ORDER BY id${order} LIMIT 1`, rows.slice(0, 1), limited(primary))
      await run(`${base} ORDER BY id${order} LIMIT 1 OFFSET 1`, rows.slice(1), limited(primary, 'Limit/Offset'))
      await run(`${base} ORDER BY name${order}`, [...rows].reverse(), cover)
    }
    await run(`${base} ORDER BY name,id`, [['a'], ['z']], sorted)
    await conn.query("SET optimizer_switch='prefer_ordering_index=off'")
    await run(`${base} ORDER BY id`, [['z'], ['a']], sorted)
    await run(`${base} ORDER BY id DESC LIMIT 1`, [['a']], limited(sorted))
    await conn.query("SET optimizer_switch='prefer_ordering_index=on,firstmatch=off'")
    await run(`${base} ORDER BY id`, [['z'], ['a']], distinct)
    await run(`${base} ORDER BY id DESC LIMIT 1`, [['a']], limited(distinct))
  } finally {
    await conn.query('DROP DATABASE IF EXISTS semi_order')
    await conn.end()
    await db?.end()
  }
})

test('first-table sorting precedes lookup probes and both ordered paths release locking streams', async () => {
  const db = await MySQL.open(':memory:')
  const sql = base.replace('FROM pa', 'FROM d.pa').replace('FROM ch', 'FROM d.ch')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await populate((sql) => db.query(sql))
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let probes = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          const probe = index === 'pa_id' && range?.from !== undefined && range.to !== undefined
          if (probe) probes++
          try {
            yield* scan(index, range, transaction, mode)
          } finally {
            if (probe) closed++
          }
        }
      }
      return table
    }
    try {
      for (const order of ['id', 'id + 0']) {
        probes = closed = 0
        assert.deepEqual((await db.query(`${sql} ORDER BY ${order} LIMIT 1`))[0], [{ name: 'z' }])
        assert.equal(probes, 1, 'order is supplied before probing, so LIMIT needs only the first match')
        assert.equal(closed, 1)
      }
    } finally {
      catalog.table = open
    }
    for (const order of ['id', 'id + 0']) {
      for await (const row of db.stream(`${sql} ORDER BY ${order} FOR UPDATE`)) {
        assert.deepEqual(row, { name: 'z' })
        break
      }
      const other = await db.connect()
      try {
        await other.query('SET innodb_lock_wait_timeout=1')
        await other.query('UPDATE d.ch SET pa_id=1 WHERE id=2')
      } finally {
        await other.end()
      }
      assert.equal(db.openConnections, 1)
    }
  } finally {
    await db.end()
  }
})

test('DESC PRIMARY scans stop after the first semijoin match and release locks in either direction', async () => {
  const db = await MySQL.open(':memory:')
  const sql = base.replace('FROM pa', 'FROM d.pa').replace('FROM ch', 'FROM d.ch')
  try {
    await db.query('CREATE DATABASE d')
    await db.query('USE d')
    await populate((sql) => db.query(sql), true)
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let probes = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 'ch') {
        const scan = table.indexScan.bind(table)
        table.indexScan = function*(index, range, transaction, mode) {
          const probe = index === 'pa_id' && range?.from !== undefined && range.to !== undefined
          if (probe) probes++
          try {
            yield* scan(index, range, transaction, mode)
          } finally {
            if (probe) closed++
          }
        }
      }
      return table
    }
    try {
      for (const [order, name, expectedProbes] of [['id', 'z', 1], ['id DESC', 'a', 2]] as const) {
        probes = closed = 0
        assert.deepEqual((await db.query(`${sql} ORDER BY ${order} LIMIT 1`))[0], [{ name }])
        assert.equal(probes, expectedProbes, 'DESC skips unmatched id=3 before reaching its first match; ASC starts at id=1')
        assert.equal(closed, expectedProbes)
      }
    } finally {
      catalog.table = open
    }
    for (const [order, name] of [['id', 'z'], ['id DESC', 'a']]) {
      for await (const row of db.stream(`${sql} ORDER BY ${order} FOR UPDATE`)) {
        assert.deepEqual(row, { name })
        break
      }
      const other = await db.connect()
      try {
        await other.query('SET innodb_lock_wait_timeout=1')
        await other.query('UPDATE d.ch SET pa_id=pa_id WHERE id IN (2,4)')
      } finally {
        await other.end()
      }
      assert.equal(db.openConnections, 1)
    }
  } finally {
    await db.end()
  }
})
