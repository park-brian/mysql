// M1.16, M1.17, M1.18 — the COM_* dispatcher, and M1.23's statement state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer } from '@myjs/bytes'
import {
  CLIENT,
  COM,
  CURSOR_TYPE,
  FIELD_TYPE,
  SERVER_STATUS,
  SET_OPTION,
  Session,
  capabilities,
  column,
  dispatch,
  parseColumnDefinition41,
  parseEof,
  parseErr,
  parseOk,
  utf8,
  fromUtf8,
  type ColumnDefinition,
  type DispatchContext,
  type Executor,
  type Parameter,
  type StatementResult,
} from '@myjs/protocol'

const CAPS = capabilities(
  CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS | CLIENT.DEPRECATE_EOF | CLIENT.SESSION_TRACK,
)
const CLASSIC = capabilities(CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS)

class StubExecutor implements Executor {
  results: StatementResult | StatementResult[] = { affectedRows: 0 }
  columns: ColumnDefinition[] = []
  lastSql = ''
  lastParams: readonly Parameter[] = []
  fieldListColumns: ColumnDefinition[] = []
  statisticsLine = 'Uptime: 42  Threads: 1'

  async query(_s: Session, sql: string, attributes: readonly Parameter[]) {
    this.lastSql = sql
    this.lastParams = attributes
    return this.results
  }

  async prepare(_s: Session, sql: string) {
    this.lastSql = sql
    return { paramCount: (sql.match(/\?/g) ?? []).length, columns: this.columns }
  }

  async execute(_s: Session, sql: string, parameters: readonly Parameter[]) {
    this.lastSql = sql
    this.lastParams = parameters
    return this.results
  }

  async fieldList() {
    return this.fieldListColumns
  }

  statistics() {
    return this.statisticsLine
  }
}

interface StubContext extends DispatchContext {
  readonly executor: StubExecutor
}

function context(over: Partial<DispatchContext> = {}): StubContext {
  const caps = over.capabilities ?? CAPS
  return {
    session: new Session({ connectionId: 1, capabilities: caps }),
    executor: new StubExecutor(),
    capabilities: caps,
    ...over,
  } as StubContext
}

const cmd = (code: number, ...rest: number[]) => new Uint8Array([code, ...rest])

function comQuery(sql: string): Uint8Array {
  const w = new Writer()
  w.u8(COM.QUERY)
  w.bytes(utf8(sql))
  return w.toBytes()
}

// --- M1.16: dispatch -----------------------------------------------------

test('COM_PING answers with an OK', async () => {
  const ctx = context()
  const { packets } = await dispatch(cmd(COM.PING), ctx)
  assert.equal(packets.length, 1)
  const ok = parseOk(packets[0] as Uint8Array, CAPS)
  assert.equal(ok.affectedRows, 0n)
  assert.equal(ok.statusFlags & SERVER_STATUS.AUTOCOMMIT, SERVER_STATUS.AUTOCOMMIT)
})

test("a pool's ping loop runs 10,000 times without drifting", async () => {
  const ctx = context()
  const first = await dispatch(cmd(COM.PING), ctx)
  const expected = [...(first.packets[0] as Uint8Array)]
  for (let i = 0; i < 10_000; i++) {
    const { packets } = await dispatch(cmd(COM.PING), ctx)
    assert.equal(packets.length, 1)
    if (i % 1000 === 0) assert.deepEqual([...(packets[0] as Uint8Array)], expected)
  }
})

test('an unknown command is ER_UNKNOWN_COM_ERROR / 08S01', async () => {
  const ctx = context()
  const { packets } = await dispatch(cmd(0x7f), ctx)
  const err = parseErr(packets[0] as Uint8Array, CAPS)
  assert.equal(err.errno, 1047)
  assert.equal(err.sqlState, '08S01')
})

test('an empty command packet is a typed error, not a crash', async () => {
  const { packets } = await dispatch(new Uint8Array(0), context())
  assert.equal(parseErr(packets[0] as Uint8Array, CAPS).errno, 1835)
})

test('the commands a real MySQL refuses are refused', async () => {
  for (const code of [COM.CREATE_DB, COM.DROP_DB, COM.TIME]) {
    const { packets } = await dispatch(cmd(code), context())
    assert.equal(parseErr(packets[0] as Uint8Array, CAPS).errno, 1047)
  }
})

// --- M1.17: the no-response commands -------------------------------------

test('COM_QUIT writes nothing and closes', async () => {
  const { packets, close } = await dispatch(cmd(COM.QUIT), context())
  assert.deepEqual(packets, [])
  assert.equal(close, true)
})

test('COM_STMT_CLOSE writes nothing, even for an unknown statement', async () => {
  const w = new Writer()
  w.u8(COM.STMT_CLOSE)
  w.u32(9999)
  const { packets } = await dispatch(w.toBytes(), context())
  assert.deepEqual(packets, [], 'a reply here desynchronises every client')
})

test('COM_STMT_SEND_LONG_DATA writes nothing, even on error', async () => {
  const w = new Writer()
  w.u8(COM.STMT_SEND_LONG_DATA)
  w.u32(9999) // no such statement
  w.u16(0)
  w.bytes(utf8('data'))
  const { packets } = await dispatch(w.toBytes(), context())
  assert.deepEqual(packets, [], 'the error surfaces at the next COM_STMT_EXECUTE instead')
})

// --- M1.18: the three quirks ---------------------------------------------

test('COM_STATISTICS answers with a bare string<EOF>, not an OK packet', async () => {
  const ctx = context()
  ctx.executor.statisticsLine = 'Uptime: 42  Threads: 1'
  const { packets } = await dispatch(cmd(COM.STATISTICS), ctx)
  assert.equal(packets.length, 1)
  const payload = packets[0] as Uint8Array
  assert.notEqual(payload[0], 0x00, 'not an OK header')
  assert.equal(fromUtf8(payload), 'Uptime: 42  Threads: 1')
})

test('COM_SET_OPTION answers EOF-shaped, not OK', async () => {
  const ctx = context({ capabilities: CLASSIC })
  const w = new Writer()
  w.u8(COM.SET_OPTION)
  w.u16(SET_OPTION.MULTI_STATEMENTS_OFF)
  const { packets } = await dispatch(w.toBytes(), ctx)
  const payload = packets[0] as Uint8Array
  assert.equal(payload[0], 0xfe, 'the EOF header')
  assert.equal(payload.length, 5, 'and an EOF body, not an OK body')
  parseEof(payload, CLASSIC)
})

test('COM_SET_OPTION uses 0 to enable and 1 to disable', async () => {
  const ctx = context()
  ctx.session.multipleStatementsEnabled = true
  const off = new Writer()
  off.u8(COM.SET_OPTION)
  off.u16(SET_OPTION.MULTI_STATEMENTS_OFF)
  await dispatch(off.toBytes(), ctx)
  assert.equal(ctx.session.multipleStatementsEnabled, false, '1 disables')
})

test('COM_FIELD_LIST returns column definitions with no column-count prefix', async () => {
  const ctx = context()
  ctx.executor.fieldListColumns = [
    column('id', FIELD_TYPE.LONG),
    column('name', FIELD_TYPE.VAR_STRING, { columnLength: 1020 }),
  ]
  const w = new Writer()
  w.u8(COM.FIELD_LIST)
  w.nulString(utf8('users'))
  w.bytes(utf8('%'))
  const { packets } = await dispatch(w.toBytes(), ctx)

  assert.equal(packets.length, 3, 'two definitions and a terminator — no count packet')
  // The first packet must parse as a column definition, which it cannot if a
  // count precedes it.
  const first = parseColumnDefinition41(packets[0] as Uint8Array, { forFieldList: true })
  assert.equal(first.name, 'id')
  assert.equal((packets[2] as Uint8Array)[0], 0xfe, 'terminated by EOF/OK-as-EOF')
})

// --- session reset boundaries --------------------------------------------

test('COM_RESET_CONNECTION restores exactly the post-connect state', async () => {
  const ctx = context()
  ctx.session.database = 'other'
  ctx.session.multipleStatementsEnabled = true
  ctx.session.statements.create('SELECT 1', 0, [])
  ctx.session.connectAttrs.set('_pid', '1')

  const { packets } = await dispatch(cmd(COM.RESET_CONNECTION), ctx)
  parseOk(packets[0] as Uint8Array, CAPS)
  assert.equal(ctx.session.database, null, 'pooled connections must not leak state')
  assert.equal(ctx.session.multipleStatementsEnabled, false)
  assert.equal(ctx.session.statements.size, 0, 'statements belong to the connection')
  assert.equal(ctx.session.connectAttrs.size, 0)
})

test('COM_CHANGE_USER hands the payload back for re-authentication', async () => {
  const ctx = context()
  const { packets, changeUser } = await dispatch(cmd(COM.CHANGE_USER, 1, 2), ctx)
  assert.deepEqual(packets, [])
  assert.ok(changeUser !== undefined, 'the connection owns the auth exchange')
})

// --- M1.20: text resultsets ----------------------------------------------

test('a text resultset is count, definitions, rows, terminator', async () => {
  const ctx = context()
  ctx.executor.results = {
    columns: [column('n', FIELD_TYPE.LONG)],
    rows: [[1], [2]],
  }
  const { packets } = await dispatch(comQuery('SELECT n FROM t'), ctx)
  assert.equal(packets.length, 5, 'count + 1 definition + 2 rows + terminator')
  assert.equal((packets[0] as Uint8Array)[0], 1, 'one column')
  assert.equal(fromUtf8((packets[2] as Uint8Array).subarray(1)), '1')
})

test('DECIMAL keeps its trailing zeros to the declared scale', async () => {
  const ctx = context()
  ctx.executor.results = {
    columns: [column('d', FIELD_TYPE.NEWDECIMAL, { decimals: 4 })],
    rows: [['123.4500']],
  }
  const { packets } = await dispatch(comQuery('SELECT d'), ctx)
  const row = packets[2] as Uint8Array
  assert.equal(fromUtf8(row.subarray(1)), '123.4500')
})

test('NULL is the single byte 0xFB in a text row', async () => {
  const ctx = context()
  ctx.executor.results = { columns: [column('n', FIELD_TYPE.LONG)], rows: [[null]] }
  const { packets } = await dispatch(comQuery('SELECT NULL'), ctx)
  assert.deepEqual([...(packets[2] as Uint8Array)], [0xfb])
})

test('SERVER_MORE_RESULTS_EXISTS is set on every terminator but the last', async () => {
  const ctx = context()
  ctx.session.multipleStatementsEnabled = true
  ctx.executor.results = [
    { columns: [column('a', FIELD_TYPE.LONG)], rows: [[1]] },
    { columns: [column('b', FIELD_TYPE.LONG)], rows: [[2]] },
    { affectedRows: 3 },
  ]
  const { packets } = await dispatch(comQuery('SELECT 1; SELECT 2; DELETE FROM t'), ctx)

  // Terminators are at 3 (first resultset), 7 (second), 8 (the OK).
  const flagsOf = (p: Uint8Array) => parseOk(p, CAPS).statusFlags
  assert.notEqual(flagsOf(packets[3] as Uint8Array) & SERVER_STATUS.MORE_RESULTS_EXISTS, 0)
  assert.notEqual(flagsOf(packets[7] as Uint8Array) & SERVER_STATUS.MORE_RESULTS_EXISTS, 0)
  assert.equal(
    flagsOf(packets[8] as Uint8Array) & SERVER_STATUS.MORE_RESULTS_EXISTS,
    0,
    'the last terminator must clear it, or the client keeps reading forever',
  )
})

test('D-13: multiple resultsets are refused while the engine switch is off', async () => {
  const ctx = context()
  assert.equal(ctx.session.multipleStatementsEnabled, false, 'off by default')
  ctx.executor.results = [{ affectedRows: 1 }, { affectedRows: 2 }]
  const { packets } = await dispatch(comQuery('DELETE FROM a; DELETE FROM b'), ctx)
  assert.equal(packets.length, 1)
  assert.match(parseErr(packets[0] as Uint8Array, CAPS).message, /Multiple statements are disabled/)
})

test('the EOF after column definitions appears only without DEPRECATE_EOF', async () => {
  const modern = context()
  modern.executor.results = { columns: [column('a', FIELD_TYPE.LONG)], rows: [] }
  assert.equal((await dispatch(comQuery('SELECT a'), modern)).packets.length, 3)

  const classic = context({ capabilities: CLASSIC })
  classic.executor.results = { columns: [column('a', FIELD_TYPE.LONG)], rows: [] }
  assert.equal(
    (await dispatch(comQuery('SELECT a'), classic)).packets.length,
    4,
    'count + definition + EOF + terminator',
  )
})

// --- M1.19: ColumnDefinition41 -------------------------------------------

test('VARCHAR(255) in utf8mb4 reports column_length 1020', async () => {
  const ctx = context()
  ctx.executor.results = {
    columns: [column('name', FIELD_TYPE.VAR_STRING, { characterSet: 255, columnLength: 255 * 4 })],
    rows: [],
  }
  const { packets } = await dispatch(comQuery('SELECT name'), ctx)
  const def = parseColumnDefinition41(packets[1] as Uint8Array)
  assert.equal(def.columnLength, 1020, 'column_length is in bytes, not characters')
  assert.equal(def.characterSet, 255)
})

test('charset 63 is what distinguishes BLOB from TEXT', async () => {
  const ctx = context()
  ctx.executor.results = {
    columns: [
      column('t', FIELD_TYPE.BLOB, { characterSet: 255 }), // TEXT
      column('b', FIELD_TYPE.BLOB, { characterSet: 63 }), // BLOB
    ],
    rows: [],
  }
  const { packets } = await dispatch(comQuery('SELECT t, b'), ctx)
  const asText = parseColumnDefinition41(packets[1] as Uint8Array)
  const asBlob = parseColumnDefinition41(packets[2] as Uint8Array)
  assert.equal(asText.type, asBlob.type, 'the type byte is identical')
  assert.notEqual(asText.characterSet, asBlob.characterSet, 'only the charset separates them')
  assert.equal(asBlob.characterSet, 63)
})

// --- M1.23: prepared statements ------------------------------------------

function comStmtExecute(
  id: number,
  flags: number,
  params: Array<{ type: number; value: number | null }>,
  newParamsBindFlag = 1,
): Uint8Array {
  const w = new Writer()
  w.u8(COM.STMT_EXECUTE)
  w.u32(id)
  w.u8(flags)
  w.u32(1)
  if (params.length > 0) {
    // parameter_count, present because CLIENT_QUERY_ATTRIBUTES is off here.
    const bitmap = new Uint8Array(Math.floor((params.length + 7) / 8))
    params.forEach((p, i) => {
      if (p.value === null) bitmap[i >> 3] = (bitmap[i >> 3] as number) | (1 << (i & 7))
    })
    w.bytes(bitmap)
    w.u8(newParamsBindFlag)
    if (newParamsBindFlag !== 0) for (const p of params) w.u16(p.type)
    for (const p of params) if (p.value !== null) w.u32(p.value)
  }
  return w.toBytes()
}

test('COM_STMT_PREPARE reports parameters as VAR_STRING placeholders', async () => {
  const ctx = context()
  ctx.executor.columns = [column('n', FIELD_TYPE.LONG)]
  const w = new Writer()
  w.u8(COM.STMT_PREPARE)
  w.bytes(utf8('SELECT n FROM t WHERE a = ? AND b = ?'))
  const { packets } = await dispatch(w.toBytes(), ctx)

  const head = packets[0] as Uint8Array
  assert.equal(head[0], 0x00)
  assert.equal(head[5] as number, 1, 'num_columns')
  assert.equal(head[7] as number, 2, 'num_params')

  const param = parseColumnDefinition41(packets[1] as Uint8Array)
  assert.equal(param.name, '?')
  assert.equal(param.type, FIELD_TYPE.VAR_STRING, 'MySQL reports every ? as VAR_STRING')
  assert.equal(param.characterSet, 63)
})

test('new_params_bind_flag === 0 reuses the previous execution types', async () => {
  // mysql2 always sends 1; the C client — and so the mysql CLI — does not.
  const ctx = context()
  const stmt = ctx.session.statements.create('SELECT ?', 1, [])
  ctx.executor.results = { affectedRows: 0 }

  await dispatch(comStmtExecute(stmt.id, 0, [{ type: FIELD_TYPE.LONG, value: 42 }], 1), ctx)
  assert.deepEqual(ctx.executor.lastParams.map((p) => p.value), [42])

  await dispatch(comStmtExecute(stmt.id, 0, [{ type: FIELD_TYPE.LONG, value: 7 }], 0), ctx)
  assert.deepEqual(
    ctx.executor.lastParams.map((p) => p.value),
    [7],
    'the type came from the previous execution',
  )
})

test('binding with flag 0 and no previous execution is a clean error', async () => {
  const ctx = context()
  const stmt = ctx.session.statements.create('SELECT ?', 1, [])
  const { packets } = await dispatch(
    comStmtExecute(stmt.id, 0, [{ type: FIELD_TYPE.LONG, value: 1 }], 0),
    ctx,
  )
  assert.match(parseErr(packets[0] as Uint8Array, CAPS).message, /no previously bound types/)
})

test('long data is merged in by parameter index at execute time', async () => {
  const ctx = context()
  const stmt = ctx.session.statements.create('INSERT INTO t VALUES (?)', 1, [])
  ctx.executor.results = { affectedRows: 1 }

  for (const chunk of ['hello ', 'world']) {
    const w = new Writer()
    w.u8(COM.STMT_SEND_LONG_DATA)
    w.u32(stmt.id)
    w.u16(0)
    w.bytes(utf8(chunk))
    assert.deepEqual((await dispatch(w.toBytes(), ctx)).packets, [], 'no response, ever')
  }

  // The parameter is in the bitmap as NULL and absent from the values.
  await dispatch(comStmtExecute(stmt.id, 0, [{ type: FIELD_TYPE.VAR_STRING, value: null }]), ctx)
  const merged = ctx.executor.lastParams[0]?.value as Uint8Array
  assert.equal(fromUtf8(merged), 'hello world', 'chunks concatenate in order')
})

test('a cursor returns definitions and no rows, then fetches', async () => {
  const ctx = context()
  const columns = [column('n', FIELD_TYPE.LONG)]
  const stmt = ctx.session.statements.create('SELECT n FROM t', 0, columns)
  ctx.executor.results = { columns, rows: [[1], [2], [3]] }

  const opened = await dispatch(comStmtExecute(stmt.id, CURSOR_TYPE.READ_ONLY, []), ctx)
  assert.equal(opened.packets.length, 3, 'count + definition + terminator, no rows')
  const status = parseOk(opened.packets[2] as Uint8Array, CAPS).statusFlags
  assert.notEqual(status & SERVER_STATUS.CURSOR_EXISTS, 0)

  const fetchTwo = new Writer()
  fetchTwo.u8(COM.STMT_FETCH)
  fetchTwo.u32(stmt.id)
  fetchTwo.u32(2)
  const first = await dispatch(fetchTwo.toBytes(), ctx)
  assert.equal(first.packets.length, 3, 'two rows and a terminator')
  assert.equal(
    parseOk(first.packets[2] as Uint8Array, CAPS).statusFlags & SERVER_STATUS.LAST_ROW_SENT,
    0,
    'more rows remain',
  )

  const second = await dispatch(fetchTwo.toBytes(), ctx)
  assert.equal(second.packets.length, 2, 'the last row and a terminator')
  assert.notEqual(
    parseOk(second.packets[1] as Uint8Array, CAPS).statusFlags & SERVER_STATUS.LAST_ROW_SENT,
    0,
    'the cursor is exhausted',
  )
})

test('an abandoned cursor is reclaimed on a timeout', async () => {
  let now = 1000
  const ctx = context({ cursorTimeoutMs: 500, now: () => now })
  const columns = [column('n', FIELD_TYPE.LONG)]
  const stmt = ctx.session.statements.create('SELECT n', 0, columns)
  ctx.executor.results = { columns, rows: [[1], [2]] }
  await dispatch(comStmtExecute(stmt.id, CURSOR_TYPE.READ_ONLY, []), ctx)
  assert.notEqual(stmt.cursor, null)

  now += 5000
  await dispatch(cmd(COM.PING), ctx) // any dispatch sweeps
  const fetch = new Writer()
  fetch.u8(COM.STMT_FETCH)
  fetch.u32(stmt.id)
  fetch.u32(1)
  const { packets } = await dispatch(fetch.toBytes(), ctx)
  assert.equal(parseErr(packets[0] as Uint8Array, CAPS).errno, 1243, 'ER_UNKNOWN_STMT_HANDLER')
})

test('COM_STMT_RESET drops long data and the cursor but keeps the statement', async () => {
  const ctx = context()
  const stmt = ctx.session.statements.create('SELECT ?', 1, [])
  const send = new Writer()
  send.u8(COM.STMT_SEND_LONG_DATA)
  send.u32(stmt.id)
  send.u16(0)
  send.bytes(utf8('x'))
  await dispatch(send.toBytes(), ctx)
  assert.equal(stmt.longData.size, 1)

  const reset = new Writer()
  reset.u8(COM.STMT_RESET)
  reset.u32(stmt.id)
  const { packets } = await dispatch(reset.toBytes(), ctx)
  parseOk(packets[0] as Uint8Array, CAPS)
  assert.equal(stmt.longData.size, 0)
  assert.equal(ctx.session.statements.get(stmt.id), stmt, 'the statement survives')
})

test('executing an unknown statement is ER_UNKNOWN_STMT_HANDLER', async () => {
  const { packets } = await dispatch(comStmtExecute(4242, 0, []), context())
  assert.equal(parseErr(packets[0] as Uint8Array, CAPS).errno, 1243)
})

test('max_prepared_stmt_count is enforced', async () => {
  const ctx = context()
  const session = new Session({ connectionId: 1, capabilities: CAPS, maxPreparedStmtCount: 2 })
  const limited = { ...ctx, session }
  const prepare = (sql: string) => {
    const w = new Writer()
    w.u8(COM.STMT_PREPARE)
    w.bytes(utf8(sql))
    return w.toBytes()
  }
  await dispatch(prepare('SELECT 1'), limited)
  await dispatch(prepare('SELECT 2'), limited)
  const { packets } = await dispatch(prepare('SELECT 3'), limited)
  assert.equal(parseErr(packets[0] as Uint8Array, CAPS).errno, 1461)
})

test('long data beyond max_allowed_packet fails at execute time, not on send', async () => {
  const session = new Session({ connectionId: 1, capabilities: CAPS, maxAllowedPacket: 16 })
  const ctx = { ...context(), session }
  const stmt = session.statements.create('INSERT INTO t VALUES (?)', 1, [])

  const send = new Writer()
  send.u8(COM.STMT_SEND_LONG_DATA)
  send.u32(stmt.id)
  send.u16(0)
  send.bytes(new Uint8Array(64))
  assert.deepEqual((await dispatch(send.toBytes(), ctx)).packets, [], 'still silent')

  const { packets } = await dispatch(
    comStmtExecute(stmt.id, 0, [{ type: FIELD_TYPE.VAR_STRING, value: null }]),
    ctx,
  )
  assert.equal(parseErr(packets[0] as Uint8Array, CAPS).errno, 1153)
})
