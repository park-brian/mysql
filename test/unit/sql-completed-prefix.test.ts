import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL, SqlExecutor, toSqlError } from '@myjs/core'
import {
  CLIENT, COM, FIELD_TYPE, SERVER_STATUS, Session, SqlError, capabilities, column,
  dispatch, fromUtf8, isResultSet, parseEof, parseErr, parseOk, sqlError, utf8,
  textResultsetPackets, binaryResultsetPackets, type DispatchContext,
} from '@myjs/protocol'
import { Writer } from '@myjs/bytes'

const classic = capabilities(CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS | CLIENT.MULTI_STATEMENTS | CLIENT.MULTI_RESULTS)
function query(sql: string): Uint8Array {
  const w = new Writer()
  w.u8(COM.QUERY)
  w.bytes(utf8(sql))
  return w.toBytes()
}

test('direct callers retain the primary error and ordinary JSON while completed results carry private snapshots', async () => {
  const executor = new SqlExecutor()
  const session = new Session({ connectionId: 1, capabilities: classic, multipleStatements: true })
  try {
    const single = await executor.query(session, 'SELECT 1 AS v')
    const multiple = await executor.query(session, 'SELECT 1 AS v;SELECT 1 AS v')
    assert.ok(Array.isArray(multiple))
    assert.deepEqual(multiple[0], single, 'successful direct-call enumeration is unchanged')
    const status = Object.getOwnPropertyDescriptor(multiple[0]!, 'statusFlags')!
    assert.equal(status.value, SERVER_STATUS.AUTOCOMMIT)
    assert.equal(status.enumerable, false)
    assert.equal(status.writable, false)
    await assert.rejects(executor.query(session, 'SELECT 9223372036854775807 AS v;SELECT missing'), (error: unknown) => {
      assert.ok(error instanceof SqlError)
      assert.equal(toSqlError(error), error)
      assert.equal(error.errno, 1054)
      assert.equal(error.completed?.length, 1)
      assert.ok(isResultSet(error.completed![0]!))
      const cell = error.completed![0]!.rows[0]![0]
      assert.ok(cell instanceof Uint8Array)
      assert.equal(fromUtf8(cell), '9223372036854775807')
      const descriptor = Object.getOwnPropertyDescriptor(error, 'completed')!
      assert.equal(descriptor.enumerable, false)
      assert.equal(descriptor.writable, false)
      assert.equal(descriptor.configurable, false)
      assert.equal(Object.keys(error).includes('completed'), false)
      assert.doesNotThrow(() => JSON.stringify(error), 'completed data stays out of error serialization')
      return true
    })
  } finally { executor.end(session) }
})

test('a completed write retains bigint insert identity without changing error JSON', async () => {
  const db = await MySQL.open(':memory:')
  const executor = new SqlExecutor({ catalog: db.catalog! })
  const session = new Session({ connectionId: 1, capabilities: classic, multipleStatements: true })
  try {
    await db.query('CREATE DATABASE completed_prefix_unit')
    await db.query('CREATE TABLE completed_prefix_unit.t(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY)')
    await assert.rejects(executor.query(session, 'INSERT INTO completed_prefix_unit.t VALUES(NULL);SELECT missing'), (error: unknown) => {
      assert.ok(error instanceof SqlError)
      const first = error.completed?.[0]
      assert.ok(first !== undefined && 'insertId' in first)
      assert.equal(typeof first.insertId, 'bigint')
      assert.equal(first.insertId, 1n)
      assert.doesNotThrow(() => JSON.stringify(error))
      return true
    })
    assert.deepEqual((await db.query('SELECT * FROM completed_prefix_unit.t'))[0], [{ id: 1 }])
  } finally { executor.end(session); await db.end() }
})

test('later syntax preserves completed results and cannot replace an earlier runtime error', async () => {
  const executor = new SqlExecutor()
  const session = new Session({ connectionId: 1, capabilities: classic, multipleStatements: true })
  try {
    await assert.rejects(executor.query(session, 'SELECT 1 AS v;SELECT FROM'), (error: unknown) => {
      assert.ok(error instanceof SqlError)
      assert.equal(error.errno, 1064)
      assert.equal(error.completed?.length, 1)
      assert.ok(isResultSet(error.completed![0]!))
      assert.doesNotThrow(() => JSON.stringify(error))
      return true
    })
    await assert.rejects(executor.query(session, 'SELECT missing;SELECT FROM'), (error: unknown) => {
      assert.ok(error instanceof SqlError)
      assert.equal(error.errno, 1054)
      assert.equal(error.completed?.length, 0)
      return true
    })
  } finally { executor.end(session) }
})

for (const modern of [false, true]) test('completed prefix terminators advertise the following error: ' + (modern ? 'modern' : 'classic'), async () => {
  const caps = capabilities(Number(classic) | (modern ? CLIENT.DEPRECATE_EOF : 0))
  const executor = new SqlExecutor()
  const session = new Session({ connectionId: 1, capabilities: caps, multipleStatements: true })
  try {
    const { packets } = await dispatch(query('SELECT 1 AS v;SELECT missing'), { executor, session, capabilities: caps })
    assert.equal(packets.length, modern ? 5 : 6)
    assert.equal(parseErr(packets.at(-1)!, caps).errno, 1054)
    const endings = packets.filter(p => p[0] === 0xfe)
    assert.equal(endings.length, modern ? 1 : 2)
    for (const p of endings) {
      const status = modern ? parseOk(p, caps).statusFlags : parseEof(p, caps).statusFlags
      assert.equal(status, SERVER_STATUS.AUTOCOMMIT | SERVER_STATUS.MORE_RESULTS_EXISTS)
    }
  } finally { executor.end(session) }
})

test('completed error data cannot bypass the engine switch or leak into a no-response command', async () => {
  const error = sqlError('ER_BAD_FIELD_ERROR', 'missing')
  Object.defineProperty(error, 'completed', { value: [{ affectedRows: 1 }] })
  const ctx: DispatchContext = {
    session: new Session({ connectionId: 1, capabilities: classic }),
    capabilities: classic,
    executor: {
      query: async () => { throw error },
      execute: async () => { throw error },
      prepare: async () => ({ paramCount: 0, columns: [] }),
      end: () => { throw error },
    },
  }
  const result = await dispatch(query('SELECT 1'), ctx)
  assert.equal(result.packets.length, 1)
  assert.equal(parseErr(result.packets[0]!, classic).errno, 1054)
  ctx.session.multipleStatementsEnabled = true
  assert.deepEqual((await dispatch(new Uint8Array([COM.QUIT]), ctx)).packets, [])
})

test('the shared batch writer preserves binary rows, named writer formats and zero status snapshots', async () => {
  const columns = [column('v', FIELD_TYPE.LONG)]
  const result = { columns, rows: [[12345]] }
  assert.deepEqual([...binaryResultsetPackets(classic, result, { binary: false })[3]!], [0, 0, 0x39, 0x30, 0, 0])
  assert.deepEqual([...textResultsetPackets(classic, result, { binary: true })[3]!], [5, 0x31, 0x32, 0x33, 0x34, 0x35])
  const results = [{ ...result, statusFlags: 0 }, { ...result, statusFlags: SERVER_STATUS.AUTOCOMMIT }]
  const ctx: DispatchContext = {
    session: new Session({ connectionId: 1, capabilities: classic, multipleStatements: true }), capabilities: classic,
    executor: {
      query: async () => results,
      execute: async () => results,
      prepare: async () => ({ paramCount: 0, columns: [] }),
    },
  }
  const { packets } = await dispatch(query('SELECT v;SELECT v'), ctx)
  assert.equal(parseEof(packets[2]!, classic).statusFlags, SERVER_STATUS.MORE_RESULTS_EXISTS)
  assert.equal(parseEof(packets[4]!, classic).statusFlags, SERVER_STATUS.MORE_RESULTS_EXISTS)
  assert.equal(parseEof(packets[7]!, classic).statusFlags, SERVER_STATUS.AUTOCOMMIT)
  assert.equal(parseEof(packets[9]!, classic).statusFlags, SERVER_STATUS.AUTOCOMMIT)
  assert.equal(parseEof(textResultsetPackets(classic, result, { statusFlags: undefined })[4]!, classic).statusFlags, SERVER_STATUS.AUTOCOMMIT)
  const stmt = ctx.session.statements.create('CALL p()', 0, columns)
  const execute = new Writer()
  execute.u8(COM.STMT_EXECUTE)
  execute.u32(stmt.id)
  execute.u8(0)
  execute.u32(1)
  const binary = (await dispatch(execute.toBytes(), ctx)).packets
  assert.equal(binary.length, 10)
  for (const i of [3, 8]) assert.deepEqual([...binary[i]!], [0, 0, 0x39, 0x30, 0, 0])
  for (const i of [2, 4]) assert.equal(parseEof(binary[i]!, classic).statusFlags, SERVER_STATUS.MORE_RESULTS_EXISTS)
  for (const i of [7, 9]) assert.equal(parseEof(binary[i]!, classic).statusFlags, SERVER_STATUS.AUTOCOMMIT)
})
