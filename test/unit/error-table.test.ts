// M1.6 / D-14 — "the error table is generated from
// share/messages_to_clients.txt, not transcribed by hand".
//
// The acceptance assertion is `1062 -> ER_DUP_ENTRY/23000`, plus the pair doc
// 14 warns about: "Transcription is how you get 1451 and 1452 the wrong way
// round." CI runs the generator and diffs, so this file checks the *contract*
// rather than the file's freshness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  errnoOf,
  symbolOf,
  sqlStateOf,
  hasErrorSymbol,
  DEFAULT_SQLSTATE,
  ERROR_TABLE_SIZE,
  ERROR_TABLE_SOURCE,
  ERROR_TABLE_SOURCE_SHA256,
  SqlError,
} from '@myjs/protocol'

test('1062 is ER_DUP_ENTRY with SQLSTATE 23000', () => {
  assert.equal(errnoOf('ER_DUP_ENTRY'), 1062)
  assert.equal(symbolOf(1062), 'ER_DUP_ENTRY')
  assert.equal(sqlStateOf('ER_DUP_ENTRY'), '23000')
  assert.equal(sqlStateOf(1062), '23000')
})

test('1451 and 1452 are the right way round', () => {
  // 1451: you tried to delete a parent row that children still reference.
  assert.equal(errnoOf('ER_ROW_IS_REFERENCED_2'), 1451)
  // 1452: you tried to add a child row with no matching parent.
  assert.equal(errnoOf('ER_NO_REFERENCED_ROW_2'), 1452)
  assert.equal(sqlStateOf(1451), '23000')
  assert.equal(sqlStateOf(1452), '23000')
})

test('the codes doc 14 tabulates all resolve', () => {
  const expected: Array<[string, number, string]> = [
    ['ER_ACCESS_DENIED_ERROR', 1045, '28000'],
    ['ER_NO_DB_ERROR', 1046, '3D000'],
    ['ER_BAD_DB_ERROR', 1049, '42000'],
    ['ER_TABLE_EXISTS_ERROR', 1050, '42S01'],
    ['ER_BAD_TABLE_ERROR', 1051, '42S02'],
    ['ER_BAD_FIELD_ERROR', 1054, '42S22'],
    ['ER_DUP_ENTRY', 1062, '23000'],
    ['ER_PARSE_ERROR', 1064, '42000'],
    ['ER_NO_SUCH_TABLE', 1146, '42S02'],
    ['ER_LOCK_DEADLOCK', 1213, '40001'],
    ['ER_WARN_DATA_OUT_OF_RANGE', 1264, '22003'],
    ['ER_TRUNCATED_WRONG_VALUE', 1292, '22007'],
    ['ER_DATA_TOO_LONG', 1406, '22001'],
  ]
  for (const [symbol, errno, sqlState] of expected) {
    assert.equal(errnoOf(symbol), errno, symbol)
    assert.equal(sqlStateOf(symbol), sqlState, symbol)
  }
})

test('the codes M1 itself emits resolve', () => {
  // M1.16's dispatcher, M1.2's framer, M1.1's cap, M1.23's statement limit.
  assert.equal(errnoOf('ER_UNKNOWN_COM_ERROR'), 1047)
  assert.equal(sqlStateOf('ER_UNKNOWN_COM_ERROR'), '08S01')
  assert.equal(errnoOf('ER_NET_PACKETS_OUT_OF_ORDER'), 1156)
  assert.equal(errnoOf('ER_NET_PACKET_TOO_LARGE'), 1153)
  assert.equal(errnoOf('ER_MAX_PREPARED_STMT_COUNT_REACHED'), 1461)
})

test('D-09s retry-loop codes are present, even though we have no lock manager', () => {
  // ORMs and application retry loops are keyed to these numbers, so they must
  // exist from M1 even though the engine that raises them arrives in M4.
  assert.equal(errnoOf('ER_LOCK_DEADLOCK'), 1213)
  assert.equal(sqlStateOf('ER_LOCK_DEADLOCK'), '40001')
  assert.equal(errnoOf('ER_LOCK_WAIT_TIMEOUT'), 1205)
  assert.equal(sqlStateOf('ER_LOCK_WAIT_TIMEOUT'), 'HY000', 'no declared state falls back to HY000')
})

test('a code with no declared SQLSTATE falls back to HY000', () => {
  assert.equal(DEFAULT_SQLSTATE, 'HY000')
  assert.equal(sqlStateOf(999999), 'HY000', 'and so does an unknown number')
})

test('an unknown symbol is a typed error rather than undefined', () => {
  assert.equal(hasErrorSymbol('ER_NOT_A_REAL_CODE'), false)
  assert.throws(() => errnoOf('ER_NOT_A_REAL_CODE'), /no such MySQL error symbol/)
  assert.equal(symbolOf(999999), undefined)
})

test('the table is large enough to be the real thing, and records its provenance', () => {
  assert.ok(ERROR_TABLE_SIZE > 1500, `expected the full table, got ${ERROR_TABLE_SIZE} entries`)
  assert.match(ERROR_TABLE_SOURCE, /^mysql\/mysql-server@[0-9a-f]+ share\/messages_to_clients\.txt$/)
  assert.match(ERROR_TABLE_SOURCE_SHA256, /^[0-9a-f]{64}$/)
})

test('SqlError carries mysql2s exact shape', () => {
  // doc 42: "Exactly mysql2's error shape, so existing catch blocks keep working."
  const err = new SqlError('ER_DUP_ENTRY', "Duplicate entry 'a@b' for key 'users.email'")
  assert.equal(err.code, 'ER_DUP_ENTRY')
  assert.equal(err.errno, 1062)
  assert.equal(err.sqlState, '23000')
  assert.equal(err.sqlMessage, "Duplicate entry 'a@b' for key 'users.email'")
  assert.ok(err instanceof Error)
})
