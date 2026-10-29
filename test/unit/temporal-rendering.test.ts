import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMysqlDateTime, renderMysqlTime } from '@myjs/bytes'
import { extremeAccumulator, plainValue, renderDateTime, renderTime, type Value } from '@myjs/types'

test('temporal formatting preserves inferred wire shapes and explicit SQL shapes', () => {
  const midnight = { year: 2024, month: 1, day: 2, hour: 0, minute: 0, second: 0, microsecond: 0 }
  const afternoon = { ...midnight, hour: 3, minute: 4, second: 5, microsecond: 123456 }
  assert.equal(renderMysqlDateTime(midnight), '2024-01-02')
  assert.equal(renderMysqlDateTime(midnight, 0, false), '2024-01-02 00:00:00')
  assert.equal(renderMysqlDateTime(afternoon, 6, true), '2024-01-02')
  assert.equal(renderDateTime(midnight, 'DATETIME', 0), '2024-01-02 00:00:00')
  assert.equal(renderDateTime(afternoon, 'DATE', 6), '2024-01-02')
  assert.equal(renderDateTime(afternoon, 'TIMESTAMP', 3), '2024-01-02 03:04:05.123')
  assert.equal(renderMysqlDateTime(midnight, NaN), '2024-01-02 00:00:00.')
  assert.equal(renderDateTime(midnight, 'DATETIME', NaN), '2024-01-02 00:00:00')
})

test('duration formatting preserves signs, extended hours and caller padding', () => {
  const zero = { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  assert.equal(renderMysqlTime(zero), '0:00:00')
  assert.equal(renderMysqlTime(zero, 0, 2), '00:00:00')
  assert.equal(renderTime({ ...zero, negative: true }, 0), '-00:00:00')
  assert.equal(renderMysqlTime({ ...zero, negative: true }), '-0:00:00')
  const extended = { ...zero, negative: true, days: 34, hour: 22, minute: 59, second: 59, microsecond: 123456 }
  assert.equal(renderMysqlTime(extended, 6), '-838:59:59.123456')
  assert.equal(renderTime(extended, 3), '-838:59:59.123')
  assert.equal(renderMysqlTime(zero, NaN), '0:00:00.')
  assert.equal(renderTime(zero, NaN), '00:00:00')
})

test('legacy temporal rendering callbacks ignore the map array argument', () => {
  const midnight = { year: 2024, month: 1, day: 2, hour: 0, minute: 0, second: 0, microsecond: 0 }
  const afternoon = { ...midnight, hour: 3, minute: 4, second: 5, microsecond: 123456 }
  assert.deepEqual([midnight, afternoon, midnight].map(renderMysqlDateTime), [
    '2024-01-02', '2024-01-02 03:04:05.1', '2024-01-02 00:00:00.00',
  ])
  const zero = { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  assert.deepEqual([zero, { ...zero, negative: true }, { ...zero, hour: 1, microsecond: 123456 }].map(renderMysqlTime), [
    '0:00:00', '-0:00:00.0', '1:00:00.12',
  ])
})

test('value and accumulator callbacks do not interpret map indexes as declared TIME proofs', () => {
  const v = { negative: false, days: 0, hour: 0, minute: 0, second: 59, microsecond: 500000 }
  const values: Value[] = Array.from({ length: 3 }, () => ({ kind: 'time', v, fsp: 6, integer: 100n }))
  assert.deepEqual(values.map(plainValue), Array.from({ length: 3 }, () => ({ kind: 'time', v, fsp: 6 })))
  for (const accumulator of [false, true].map(extremeAccumulator)) {
    accumulator.add(values[0]!)
    assert.deepEqual(accumulator.result(), { kind: 'time', v, fsp: 6 })
  }
})
