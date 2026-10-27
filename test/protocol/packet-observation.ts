import assert from 'node:assert/strict'
import type { Duplex } from 'node:stream'
import type mysql from 'mysql2'
import type { Connection as PromiseConnection } from 'mysql2/promise'

interface Command {
  readonly sql: string
  readonly api: string
  readonly params?: mysql.ExecuteValues[]
  readonly retain?: boolean
}

/** Observe one complete command, including partial output and its command-local diagnostics. */
export async function observeCommand(raw: mysql.Connection, conn: PromiseConnection, transport: Duplex, entry: Command, captureWire = false) {
  const { sql, api } = entry
  const descriptors = (list: readonly mysql.FieldPacket[] | undefined) => list?.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]) ?? null
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
      conn.unprepare(options)
      const statement = await conn.prepare(options)
      fields = descriptors((statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns)
      await statement.close()
    } else {
      const collected: unknown[] = []
      rows = collected
      await new Promise<void>((resolve, reject) => {
        const command = api === 'execute' ? raw.execute(options, entry.params ?? []) : raw.query(options, entry.params ?? [])
        command.on('fields', (list: mysql.FieldPacket[]) => { fields = descriptors(list) })
        command.on('result', (row: unknown) => collected.push(Array.isArray(row) ? row : { ...(row as mysql.ResultSetHeader) }))
        command.once('error', reject)
        command.once('end', resolve)
      })
    }
  } catch (e) {
    const failure = e as { code: string; errno: number; sqlState: string; sqlMessage: string }
    error = [failure.code, failure.errno, failure.sqlState, failure.sqlMessage]
  } finally {
    transport.off('data', received)
    if (api !== 'query' && !entry.retain) conn.unprepare(options)
  }
  const bytes = Buffer.concat(chunks)
  const packets: number[] = []
  const wire: string[] | undefined = captureWire ? [] : undefined
  let at = 0
  while (at < bytes.length) {
    const length = bytes.readUIntLE(at, 3)
    packets.push(bytes[at + 4]!)
    wire?.push(bytes.subarray(at + 4, at + 4 + length).toString('hex'))
    at += length + 4
  }
  assert.equal(at, bytes.length, sql + ': complete packets')
  const warnings = (await conn.query('SHOW WARNINGS'))[0]
  const warningCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) WARNINGS'))[0][0]!)[0])
  const errorCount = Number(Object.values((await conn.query<mysql.RowDataPacket[]>('SHOW COUNT(*) ERRORS'))[0][0]!)[0])
  const insertId = (await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS v'))[0][0]!.v
  return {
    outcome: { prior, rows, fields, error, packets, warnings, warningCount, errorCount, insertId },
    prepareWarnings: api === 'prepare' && error === null ? bytes.readUInt16LE(14) : undefined,
    wire,
  }
}
