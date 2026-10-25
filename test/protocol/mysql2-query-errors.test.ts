import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2'
import { connect } from 'node:net'
import { MySQL } from '@myjs/core'
import capture from './fixtures/diagnostics/query-errors.json' with { type: 'json' }

const reference = capture as { mysqlVersion: string; observations: number; outcomes: unknown[] }
const modes = ['ERROR_FOR_DIVISION_BY_ZERO', 'ERROR_FOR_DIVISION_BY_ZERO,ANSI_QUOTES,NO_BACKSLASH_ESCAPES']
const seeds = ['DO 0', 'DO 1/0', 'DO CAST(1 AS JSON) AND TRUE', 'SELECT old_seed']
const cases = [
  'SELECT FROM', "SELECT 'unterminated", '', ' ; ', 'SELECT ?', 'SELECT 1 +', 'SELECT (1', 'SELECT 1 garbage more',
  '/* only a comment */', '-- only a comment' + String.fromCharCode(10),
  "SELECT ?,'unterminated", 'SELECT ? FROM', "SELECT '?' +", 'SELECT 1 /* ? */ +',
  'SELECT' + String.fromCharCode(10) + '? ', 'SELECT "?" +', 'SELECT ' + String.fromCharCode(39, 92, 39) + ', ?',
  ...[9, 10, 13, 11, 12].map((c) => 'SELECT ?' + String.fromCharCode(c)),
  'SELECT ?' + ' '.repeat(90) + 'x',
  ...[160, 8232, 65279].map((c) => 'SELECT ?' + String.fromCharCode(c)),
  ...[8232, 65279].map((c) => 'SELECT ? ' + String.fromCharCode(c)),
]

test('query preflight replaces seeded diagnostics without losing SQL-mode or parameter error precedence', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations, 448)
    let observation = 0
    for (const mode of modes) for (const multipleStatements of [false, true]) {
      const transport = db === undefined ? connect({ host: host ?? 'reference', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306) }) : db.createStream()
      const raw = mysql.createConnection({ stream: transport, user: 'root', multipleStatements, ...(db === undefined ? { password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' } : {}) })
      const conn = raw.promise()
      await conn.connect()
      try {
        if (host !== undefined) {
          const versionRows = (await conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v'))[0]
          assert.equal(String(versionRows[0]?.v).split('-')[0], reference.mysqlVersion)
        }
        await conn.query('SET sql_mode=?', [mode])
        for (const seed of seeds) for (const sql of cases) {
          try { await conn.query(seed) } catch { /* Seed the preceding error area. */ }
          const prior = (await conn.query('SHOW WARNINGS'))[0]
          const chunks: Buffer[] = []
          const received = (value: Uint8Array): void => { chunks.push(Buffer.from(value)) }
          transport.on('data', received)
          let error: unknown = null
          let answer: unknown = null
          try {
            const [result] = await conn.query<mysql.ResultSetHeader>(sql)
            answer = { affectedRows: result.affectedRows, warningStatus: result.warningStatus }
          } catch (e) {
            const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
            error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
          } finally {
            transport.off('data', received)
          }
          const bytes = Buffer.concat(chunks)
          const packets: number[] = []
          let at = 0
          while (at < bytes.length) {
            const length = bytes.readUIntLE(at, 3)
            packets.push(bytes[at + 4]!)
            at += length + 4
          }
          assert.equal(at, bytes.length, 'complete packets')
          const warnings = (await conn.query('SHOW WARNINGS'))[0]
          const warningCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0])
          const errorCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0])
          const outcome = { mode, multipleStatements, seed, sql, prior, error, answer, packets, warnings, warningCount, errorCount }
          assert.deepEqual(JSON.parse(JSON.stringify(outcome)), reference.outcomes[observation++], mode + ': ' + multipleStatements + ': ' + seed + ': ' + sql)
        }
      } finally {
        await conn.end()
      }
    }
    assert.equal(observation, reference.observations)
    assert.equal(reference.outcomes.length, observation)
  } finally {
    await db?.end()
  }
})
