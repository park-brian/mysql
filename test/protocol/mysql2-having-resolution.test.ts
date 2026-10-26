import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import reference from './fixtures/diagnostics/having-resolution.json' with { type: 'json' }

test('HAVING binds native diagnostics before ORDER while group readers and prepared values retain their lifetimes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }) : db.createStream()
  const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
  const conn = raw.promise()
  await conn.connect()
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  const descriptors = (list: readonly mysql.FieldPacket[]) => list.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, 641)
    if (host !== undefined) assert.equal(String((await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await conn.query('CREATE DATABASE having_resolution')
    await conn.query('USE having_resolution')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY)')
    await conn.query('CREATE TABLE b(n INT)')
    await conn.query('INSERT INTO b VALUES(1),(2)')
    await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    let filled = false
    for (const entry of reference.observations) {
      const { sql, api } = entry
      if (entry.filled !== filled) {
        await conn.query('TRUNCATE TABLE a')
        if (entry.filled) await conn.query('INSERT INTO a VALUES(1),(2),(3)')
        filled = entry.filled
      }
      if ('before' in entry) await conn.query(entry.before)
      await conn.query('SELECT LAST_INSERT_ID(0)')
      await conn.query('DO 1/0')
      const prior = (await conn.query('SHOW WARNINGS'))[0]
      const options = { sql, rowsAsArray: true }
      const chunks: Buffer[] = []
      const received = (value: Uint8Array): void => { chunks.push(Buffer.from(value)) }
      let rows: unknown[] | null = null
      let fields: unknown = null
      let error: unknown = null
      transport.on('data', received)
      try {
        if (api === 'prepare') {
          const statement = await conn.prepare(options)
          fields = descriptors((statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns)
          await statement.close()
        } else {
          const collected: unknown[] = []
          rows = collected
          await new Promise<void>((resolve, reject) => {
            const command = api === 'execute' ? raw.execute(options, 'params' in entry ? entry.params : []) : raw.query(options)
            command.on('fields', (list: mysql.FieldPacket[]) => { fields = descriptors(list) })
            command.on('result', (row: unknown) => collected.push(row))
            command.once('error', reject)
            command.once('end', resolve)
          })
        }
      } catch (e) {
        const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
        error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
      } finally {
        transport.off('data', received)
        if (api !== 'query' && !('retain' in entry && entry.retain)) conn.unprepare(options)
      }
      const bytes = Buffer.concat(chunks)
      const packets: number[] = []
      let at = 0
      while (at < bytes.length) {
        const length = bytes.readUIntLE(at, 3)
        packets.push(bytes[at + 4]!)
        at += length + 4
      }
      assert.equal(at, bytes.length, sql + ': complete packets')
      const warnings = (await conn.query('SHOW WARNINGS'))[0]
      const warningCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0])
      const errorCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0])
      const insertId = (await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS v'))[0][0]!.v
      const expected = reference.outcomes[entry.outcome]!
      if (api === 'prepare' && error === null) assert.equal(bytes.readUInt16LE(14), expected.warningCount & 0xffff, sql + ': PREPARE warning count')
      assert.deepEqual(canonical({ prior, rows, fields, error, packets, warnings, warningCount, errorCount, insertId }), {
        ...expected,
        prior: expected.prior.map((i) => reference.warnings[i]),
        fields: expected.fields?.map((i) => reference.fields[i]) ?? null,
        warnings: expected.warnings.map((i) => reference.warnings[i]),
      }, `${api}: filled=${filled}: ${sql}`)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS having_resolution')
    await conn.end()
    await db?.end()
  }
})
