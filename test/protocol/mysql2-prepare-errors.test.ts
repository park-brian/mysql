import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import mysql from 'mysql2'
import { MySQL } from '@myjs/core'
import capture from './fixtures/diagnostics/prepare-errors.json' with { type: 'json' }

interface Outcome { readonly prior: number[]; readonly error: unknown; readonly packets: number[]; readonly warnings: number[]; readonly warningCount: number; readonly errorCount: number; readonly peer: number[] | null }
const reference = capture as { mysqlVersion: string; observations: number; warnings: unknown[]; outcomes: Outcome[]; index: number[] }
const cases = [
  ['column', 'SELECT absent FROM a'],
  ['table', 'SELECT id FROM absent_table'],
  ['ambiguous', 'SELECT id FROM a JOIN b ON TRUE'],
  ['hidden', 'SELECT a.id FROM a AS x'],
  ['syntax', 'SELECT FROM'],
  ['empty', ''],
  ['semicolons', ' ; '],
  ['block_comment', '/* only a comment */'],
  ['dash_comment', '-- only a comment\n'],
  ['hash_comment', '# only a comment'],
  ['aggregate', 'SELECT COUNT(absent) FROM a'],
  ['parameter', 'SELECT absent+? FROM a'],
  ['parameter_limit', 'SELECT ' + Array.from({ length: 65536 }, () => '?').join(',')],
  ['qualified', 'SELECT x.absent FROM a AS x'],
  ['lexical', "SELECT 'unterminated"],
  ...[1, 1023, 1024, 1100].map((count) => ['prefix_' + count, 'SELECT ' + Array.from({ length: count }, (_, i) => 'CAST(1 AS JSON) AND TRUE AS j' + i).join(',') + ',absent FROM a']),
] as const
const seeds = ['DO 0', 'DO 1/0', 'DO CAST(1 AS JSON) AND CAST(2 AS JSON)', 'SELECT old_seed FROM a']

test('a failed PREPARE publishes its own diagnostics, with warning prefix and session isolation', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const makeClient = async () => {
    const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }) : db.createStream()
    const raw = mysql.createConnection({ stream: transport, user: 'root', ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
    const conn = raw.promise()
    await conn.connect()
    return { transport, raw, conn }
  }
  type Client = Awaited<ReturnType<typeof makeClient>>
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
  const expand = (outcome: Outcome): unknown => ({ ...outcome,
    prior: outcome.prior.map((i) => reference.warnings[i]),
    warnings: outcome.warnings.map((i) => reference.warnings[i]),
    peer: outcome.peer === null ? null : outcome.peer.map((i) => reference.warnings[i]),
  })
  let observation = 0
  const observe = async (client: Client, sql: string, label: string, other?: Client): Promise<void> => {
    const prior = (await client.conn.query('SHOW WARNINGS'))[0]
    const chunks: Buffer[] = []
    const received = (value: Uint8Array): void => { chunks.push(Buffer.from(value)) }
    client.transport.on('data', received)
    let error: unknown = null
    const options = { sql, rowsAsArray: true }
    try {
      await client.conn.prepare(options)
    } catch (e) {
      const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
      error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
    } finally {
      client.transport.off('data', received)
      client.conn.unprepare(options)
    }
    const bytes = Buffer.concat(chunks)
    const packets: number[] = []
    let at = 0
    while (at < bytes.length) {
      const length = bytes.readUIntLE(at, 3)
      packets.push(bytes[at + 4]!)
      at += length + 4
    }
    assert.equal(at, bytes.length, label + ': complete packets')
    const warnings = (await client.conn.query('SHOW WARNINGS'))[0]
    const warningCount = Number(Object.values((await client.conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0])
    const errorCount = Number(Object.values((await client.conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0])
    const peer = other === undefined ? null : (await other.conn.query('SHOW WARNINGS'))[0]
    const expected = reference.outcomes[reference.index[observation++]!]!
    assert.deepEqual(canonical({ prior, error, packets, warnings, warningCount, errorCount, peer }), expand(expected), label)
  }
  const client = await makeClient()
  let peer: Client | undefined
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations, 78)
    await client.conn.query('CREATE DATABASE prepare_error_lifetime')
    await client.conn.query('USE prepare_error_lifetime')
    await client.conn.query('CREATE TABLE a(id INT PRIMARY KEY)')
    await client.conn.query('CREATE TABLE b(id INT)')
    for (const seed of seeds) for (const [name, sql] of cases) {
      try { await client.conn.query(seed) } catch { /* This seed deliberately records its own error. */ }
      await observe(client, sql, seed + ': ' + name)
    }
    peer = await makeClient()
    await peer.conn.query('USE prepare_error_lifetime')
    await peer.conn.query('DO 1/0')
    await client.conn.query('DO 0')
    await observe(client, cases[0]![1], 'first session', peer)
    await observe(peer, cases[3]![1], 'second session', client)

    assert.equal(observation, reference.observations)
    assert.equal(reference.index.length, observation)
  } finally {
    await client.conn.query('DROP DATABASE IF EXISTS prepare_error_lifetime')
    await peer?.conn.end()
    await client.conn.end(); await db?.end()
  }
})
