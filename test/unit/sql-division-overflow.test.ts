import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MyjsError } from '@myjs/bytes'
import { parseStatement } from '@myjs/parser'
import { SqlError } from '@myjs/protocol'
import { TypeError as ValueError, decimalValue as decimal, intDivide, intValue as int } from '@myjs/types'
import { valueOutOfRange } from '../../packages/types/src/errors.ts'
import { conditionsFor, promotedError } from '../../packages/core/src/sql/strict.ts'
import { toSqlError } from '../../packages/core/src/sql/executor.ts'

test('integer overflow retains its exact coefficient without changing the public error shape', () => {
  let labels = 0
  const label = () => { labels++; return 'quotient' }
  assert.equal(intDivide(int(1n), int(0n), label), null)
  assert.deepEqual(intDivide(int(7n), int(2n), label), int(3n))
  assert.equal(labels, 0)
  let error: ValueError | undefined
  assert.throws(() => intDivide(int(9223372036854775807n), decimal(5n, 1), label), (e) => {
    assert.ok(e instanceof ValueError)
    error = e
    return true
  })
  assert.equal(labels, 1)
  assert.equal(error!.integer, 18446744073709551614n)
  assert.equal(Object.getOwnPropertyDescriptor(error, 'integer')!.enumerable, false)
  assert.equal(Object.getOwnPropertyDescriptor(error, 'integer')!.writable, false)
  const previousShape = valueOutOfRange('BIGINT', 'quotient')
  assert.equal(Object.getPrototypeOf(error), Object.getPrototypeOf(previousShape))
  assert.deepEqual(Object.keys(error!), Object.keys(previousShape))
  assert.equal(JSON.stringify(error), JSON.stringify(previousShape))
})

test('strict promotion records the exact primary and retains later errors in order', () => {
  const statement = parseStatement('INSERT INTO t VALUES(1)')
  const area = conditionsFor(statement, 'STRICT_TRANS_TABLES')
  const warning = { level: 'Warning', code: 1292, message: 'conversion' } as const
  let primary: unknown
  try { area.push(warning) } catch (error) { primary = error }
  assert.ok(primary instanceof SqlError)
  assert.equal(promotedError(area, primary), true)
  assert.equal(promotedError(area, new SqlError(primary.code, primary.message)), false)
  assert.equal(promotedError(area, undefined), false)
  assert.equal(promotedError(conditionsFor(statement, 'STRICT_TRANS_TABLES'), primary), false)
  assert.deepEqual(Array.from(area), [{ ...warning, level: 'Error' }])
  area.push({ level: 'Error', code: 1690, message: 'range' })
  assert.deepEqual(area.map(c => c.code), [1292, 1690])
  assert.equal(promotedError(area, primary), true)
  assert.equal(warning.level, 'Warning')
  const copy = area.slice()
  assert.equal(promotedError(copy, primary), false)
  assert.doesNotThrow(() => copy.push(warning))
})

test('strict severity and statement admission preserve SELECT, IGNORE and nonwarning controls', () => {
  for (const [sql, mode] of [['SELECT 1', 'STRICT_TRANS_TABLES'], ['INSERT IGNORE INTO t VALUES(1)', 'STRICT_ALL_TABLES'], ['INSERT INTO t VALUES(1)', '']]) {
    const area = conditionsFor(parseStatement(sql!), mode!)
    assert.doesNotThrow(() => area.push({ level: 'Warning', code: 1292, message: 'conversion' }))
    assert.equal(area[0]!.level, 'Warning')
  }
  const area = conditionsFor(parseStatement('INSERT INTO t VALUES(1)'), 'STRICT_ALL_TABLES')
  for (const level of ['Note', 'Error'] as const) assert.doesNotThrow(() => area.push({ level, code: 1292, message: level }))
  assert.equal(promotedError(area, undefined), false)
})

test('SQL error normalization preserves primary identity and constructor defaults', () => {
  const primary = new SqlError('ER_TRUNCATED_WRONG_VALUE', 'conversion')
  assert.equal(toSqlError(primary), primary)
  const defaults = new SqlError('ER_DATA_OUT_OF_RANGE', 'range', { errno: undefined, sqlState: undefined })
  assert.equal(defaults.errno, 1690)
  assert.equal(defaults.sqlState, '22003')
  const typed = toSqlError(new MyjsError('ER_DATA_OUT_OF_RANGE', 'range', { errno: 1690 }))
  assert.equal(typed.errno, defaults.errno)
  assert.equal(typed.sqlState, defaults.sqlState)
  for (const failure of [new Error('bug'), undefined, null, 7]) {
    const error = toSqlError(failure)
    assert.equal(error.code, 'ER_INTERNAL_ERROR')
    assert.equal(error.errno, 1815)
    assert.equal(error.sqlState, 'HY000')
    assert.equal(error.message, 'Internal error: ' + (failure instanceof Error ? failure.message : String(failure)))
  }
})
