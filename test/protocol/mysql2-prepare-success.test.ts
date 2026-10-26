import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import reference from './fixtures/diagnostics/prepare-success.json' with { type: 'json' }

test('successful PREPARE replaces diagnostics and reports complete wire totals independently of its stored prefix', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const makeClient = async () => {
    const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }) : db.createStream()
    const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
    const conn = raw.promise()
    await conn.connect()
    return { transport, conn }
  }
  const clients = [await makeClient(), await makeClient()]
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations.length, 78)
    if (host !== undefined) assert.equal(String((await clients[0]!.conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!.v).split('-')[0], reference.mysqlVersion)
    await clients[0]!.conn.query('CREATE DATABASE prepare_success')
    for (const { conn } of clients) {
      await conn.query('USE prepare_success')
      await conn.query("SET sql_mode='ERROR_FOR_DIVISION_BY_ZERO'")
    }
    await clients[0]!.conn.query('CREATE TABLE a(id INT)')
    for (const entry of reference.observations) {
      const { conn, transport } = clients[entry.client]!
      const peer = clients[1 - entry.client]!
      if ('peerSeed' in entry) await peer.conn.query(entry.peerSeed)
      try { await conn.query(entry.seed) } catch { /* Error seeds deliberately establish prior diagnostics. */ }
      const prior = (await conn.query('SHOW WARNINGS'))[0]
      let sql: string
      if ('sql' in entry) sql = entry.sql
      else if ('coalesce' in entry) sql = 'SELECT COALESCE(' + Array.from({ length: entry.coalesce }, () => '(CAST(1 AS JSON) AND TRUE)').join(',') + ') AS j'
      else sql = 'SELECT ' + Array.from({ length: entry.prefix }, (_, i) => 'CAST(1 AS JSON) AND TRUE AS j' + i).join(',')
      const chunks: Buffer[] = []
      const received = (value: Uint8Array): void => { chunks.push(Buffer.from(value)) }
      transport.on('data', received)
      const options = { sql, rowsAsArray: true }
      let fields: unknown = null
      let error: unknown = null
      try {
        const statement = await conn.prepare(options)
        fields = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
        await statement.close()
      } catch (e) {
        const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
        error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
      } finally {
        transport.off('data', received)
        conn.unprepare(options)
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
      const wireWarnings = bytes[4] === 0 ? bytes.readUInt16LE(14) : null
      const warnings = (await conn.query('SHOW WARNINGS'))[0]
      const warningCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0])
      const errorCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0])
      const other = (await peer.conn.query('SHOW WARNINGS'))[0]
      const expected = reference.outcomes[entry.outcome]!
      assert.deepEqual(canonical({ prior, fields, error, wireWarnings, packets, warnings, warningCount, errorCount, peer: other }), {
        ...expected,
        prior: expected.prior.map((i) => reference.warnings[i]),
        fields: expected.fields?.map((i) => reference.fields[i]) ?? null,
        warnings: expected.warnings.map((i) => reference.warnings[i]),
        peer: expected.peer.map((i) => reference.warnings[i]),
      }, `${entry.seed}: ${sql}`)
    }
  } finally {
    await clients[0]!.conn.query('DROP DATABASE IF EXISTS prepare_success')
    for (const { conn } of clients) await conn.end()
    await db?.end()
  }
})
