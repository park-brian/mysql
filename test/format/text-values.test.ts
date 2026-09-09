// M2.16 — text-protocol value rendering.
//
// `renderTextValue` is the whole text codec and until now had no direct test:
// it was exercised only end to end through the frozen traces, which cover the
// shapes the stub happens to emit. Doc 15 §"Text protocol encoding": every
// value, including numbers and dates, is its SQL string rendering.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHARSET_BINARY,
  CHARSET_UTF8MB4_0900_AI_CI,
  DECIMALS_NOT_FIXED,
  FIELD_TYPE,
  renderDate,
  renderDateTime,
  renderFloat,
  renderTextValue,
  renderTime,
  type ColumnDefinition,
} from '@myjs/protocol'

const col = (type: number, decimals = DECIMALS_NOT_FIXED): Pick<ColumnDefinition, 'type' | 'decimals'> => ({
  type,
  decimals,
})

const text = (v: Parameters<typeof renderTextValue>[0], c: Pick<ColumnDefinition, 'type' | 'decimals'>) => {
  const bytes = renderTextValue(v, c)
  return bytes === null ? null : new TextDecoder().decode(bytes)
}

test('NULL renders as null, which the caller turns into 0xFB', () => {
  assert.equal(renderTextValue(null, col(FIELD_TYPE.LONG)), null)
})

test('doc 15: a float exponent is MySQL-spelled, without the +', () => {
  assert.equal(renderFloat(1.7976931348623157e308), '1.7976931348623157e308')
  assert.equal(renderFloat(Number.POSITIVE_INFINITY), 'inf')
  assert.equal(renderFloat(Number.NEGATIVE_INFINITY), '-inf')
})

test('an integral number on a non-float column never gains an exponent', () => {
  // `String(1e21)` is '1e+21'; toFixed(0) is the 22-digit integer MySQL prints.
  assert.equal(text(1e21, col(FIELD_TYPE.LONGLONG)), '1000000000000000000000')
  assert.equal(text(-1, col(FIELD_TYPE.LONG)), '-1')
})

test('a DOUBLE column keeps float spelling even for an integral value', () => {
  assert.equal(text(2, col(FIELD_TYPE.DOUBLE)), '2')
  assert.equal(text(1.5, col(FIELD_TYPE.DOUBLE)), '1.5')
})

test('BIGINT arrives as a bigint and prints exactly', () => {
  assert.equal(text(9007199254740993n, col(FIELD_TYPE.LONGLONG)), '9007199254740993')
})

test('a boolean is 1 or 0, as MySQL has no boolean type', () => {
  assert.equal(text(true, col(FIELD_TYPE.TINY)), '1')
  assert.equal(text(false, col(FIELD_TYPE.TINY)), '0')
})

test('DATE renders without a time; DATETIME with one', () => {
  const d = new Date(Date.UTC(2010, 9, 17, 19, 27, 30))
  assert.equal(renderDate(d), '2010-10-17')
  assert.equal(text(d, col(FIELD_TYPE.DATE)), '2010-10-17')
  assert.equal(text(d, col(FIELD_TYPE.DATETIME)), '2010-10-17 19:27:30')
})

test('a DATETIME column with a declared scale pads the fraction to that scale', () => {
  const d = new Date(Date.UTC(2010, 9, 17, 19, 27, 30, 123))
  assert.equal(renderDateTime(d, 6), '2010-10-17 19:27:30.123000')
  assert.equal(text(d, col(FIELD_TYPE.DATETIME, 3)), '2010-10-17 19:27:30.123')
  // 0x1f — "not fixed" — means no fractional part at all, not scale 31.
  assert.equal(text(d, col(FIELD_TYPE.DATETIME)), '2010-10-17 19:27:30')
})

test('TIME is a duration: it may be negative and may exceed 24 hours', () => {
  assert.equal(renderTime(70_050_000_000n), '19:27:30')
  assert.equal(renderTime(-433_167_000_000n), '-120:19:27')
  assert.equal(renderTime(1_500_000n, 6), '0:00:01.500000')
})

test('M2.16: a bigint on a TIME column is microseconds, not an integer to print', () => {
  // Before this was wired up, `renderTime` was exported and called by nothing,
  // and a TIME column rendered its own microsecond count as a decimal integer —
  // a wrong answer rather than a missing one.
  assert.equal(text(70_050_000_000n, col(FIELD_TYPE.TIME)), '19:27:30')
  assert.equal(text(-433_167_000_000n, col(FIELD_TYPE.TIME)), '-120:19:27')
  assert.equal(text(1_500_000n, col(FIELD_TYPE.TIME, 6)), '0:00:01.500000')
})

test('D-15: DECIMAL arrives already rendered, so trailing zeros survive', () => {
  assert.equal(text('1234.5000', col(FIELD_TYPE.NEWDECIMAL, 4)), '1234.5000')
})

test('bytes pass through untouched — a BLOB is not text', () => {
  const raw = Uint8Array.from([0x00, 0xff, 0x80])
  const out = renderTextValue(raw, col(FIELD_TYPE.BLOB))
  assert.deepEqual(out, raw)
})

test('the column helper names its default collation rather than spelling 255', () => {
  // M2.16 replaced a raw literal 255 here with the constant two files away.
  assert.equal(CHARSET_UTF8MB4_0900_AI_CI, 255)
  assert.equal(CHARSET_BINARY, 63)
})
