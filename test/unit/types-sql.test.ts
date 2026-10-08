// M5.2 — the value rules: conversion, comparison, arithmetic, and a value into a
// column and back. Every expected value that is not a definition was read off
// a real MySQL 8.4.11 (`SELECT 1/3, 2/3, 1.10+1, …`), which is the only
// authority these rules answer to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE, MyjsError } from '@myjs/bytes'
import { loadCollation, memcmp } from '@myjs/charsets'
import {
  add,
  bitNot,
  bitwise,
  compareValues,
  decodeField,
  divide,
  doubleValue,
  encodeField,
  intDivide,
  intValue,
  modulo,
  negate,
  nullSafeEqual,
  parseDecimal,
  renderDecimal,
  renderDouble,
  stringValue,
  toText,
  type ColumnType,
  type StoreContext,
  type Value,
} from '@myjs/types'

const UTF8MB4 = 255
const s = (v: string) => stringValue(v, UTF8MB4)
const n = (v: number | bigint) => intValue(BigInt(v))
const d = (text: string) => parseDecimal(text)
const show = (v: Value): string => (v === null ? 'NULL' : toText(v))

test.before(async () => {
  await loadCollation(UTF8MB4)
})

test('M5.2: DECIMAL is exact, with MySQL scales', () => {
  assert.equal(show(add(d('1.10'), n(1), '+')), '2.10')
  assert.equal(show(add(d('1.5'), d('1.25'), '*')), '1.875')
  // `/` adds div_precision_increment (4) to the dividend's scale, rounding half up.
  assert.equal(show(divide(n(1), n(3))), '0.3333')
  assert.equal(show(divide(n(2), n(3))), '0.6667')
  assert.equal(show(divide(d('3.0'), n(2))), '1.50000')
  assert.equal(show(add(divide(n(1), n(7)), n(7), '*')), '1.0000')
  assert.equal(show(add(d('0.1'), d('0.2'), '+')), '0.3')
  // A quotient is held to nine digits, truncated: 2/3 holds 0.666666666.
  assert.equal(show(add(divide(n(2), n(3)), n(1000000000), '*')), '666666666.0000')
  assert.equal(show(add(divide(d('1.5'), n(7)), n(1000000000000), '*')), '214285714000.00000')
  assert.equal(compareValues(divide(n(1), n(3)), d('0.3333')), 1)
  assert.equal(renderDecimal(d('-0.05')), '-0.05')
})

test('M5.2: integer arithmetic — overflow is an error, NULL for a zero divisor, the M3.2 facts', () => {
  assert.equal(show(intDivide(n(7), n(2))), '3')
  assert.equal(show(intDivide(n(-7), n(2))), '-3')
  assert.equal(show(modulo(n(-5), n(3))), '-2')
  assert.equal(divide(n(5), n(0)), null)
  assert.equal(modulo(n(5), n(0)), null)
  assert.throws(
    () => add(n(9223372036854775807n), n(1), '+', '(9223372036854775807 + 1)'),
    (e: unknown) => e instanceof MyjsError && e.errno === 1690 && e.message === "BIGINT value is out of range in '(9223372036854775807 + 1)'",
  )
  // `-` of an unsigned value too big for a signed one saturates (M3.2's corpus).
  assert.equal(show(negate(bitNot(n(4)))), '-9223372036854775808')
  // `%` follows the dividend's signedness rather than promoting to unsigned.
  assert.equal(show(modulo(n(-5), bitwise(n(0), n(2), '^'))), '-1')
  assert.equal(show(add(intValue(18446744073709551615n, true), n(0), '+')), '18446744073709551615')
})

test('M5.2: a double prints as MySQL prints it', () => {
  // Read off 8.4.11: fixed between exponents -15 and 14, scientific outside.
  const cases: [number, string][] = [
    [1e15, '1e15'],
    [1e14, '100000000000000'],
    [1.5e-7, '0.00000015'],
    [1.5e-15, '0.0000000000000015'],
    [1e-16, '1e-16'],
    [1.23e-20, '1.23e-20'],
    [-0, '-0'],
    [123456789.123456789, '123456789.12345679'],
    [12345678901234567, '1.2345678901234568e16'],
    [0.1 + 0.2, '0.30000000000000004'],
    [123456789012345.6, '123456789012345.6'],
  ]
  for (const [value, text] of cases) assert.equal(renderDouble(value), text, String(value))
  assert.equal(show(add(doubleValue(1), n(1), '+')), '2')
})

test('M5.2: the comparison type is chosen from both operands', () => {
  // Both strings: a collation decides, and '10' sorts before '9'.
  assert.equal(compareValues(s('10'), s('9')), -1)
  // A number against a string: both are doubles, and 10 > 9.
  assert.equal(compareValues(n(10), s('9')), 1)
  // utf8mb4_0900_ai_ci is case-insensitive and NO PAD.
  assert.equal(compareValues(s('a'), s('A')), 0)
  assert.equal(compareValues(s('a '), s('a')), 1)
  // Exact across integers and decimals.
  assert.equal(compareValues(n(1), d('1.000')), 0)
  assert.equal(compareValues(intValue(18446744073709551615n, true), n(-1)), 1)
  assert.equal(compareValues(null, n(1)), null)
  assert.equal(nullSafeEqual(null, null), true)
  assert.equal(nullSafeEqual(null, n(0)), false)
  // A temporal against a string compares as a temporal.
  const date = decodeField(encodeField(s('2024-01-02'), { name: 'd', type: { type: FIELD_TYPE.DATE }, nullable: true }, ctx()), { type: FIELD_TYPE.DATE })
  assert.equal(compareValues(date, s('2024-1-2')), 0)
  assert.equal(compareValues(date, s('2024-01-02 00:00:01')), -1)
})

const ctx = (strict = true): StoreContext => ({ strict, row: 1, warnings: 0 })
const col = (type: ColumnType, nullable = true) => ({ name: 'c', type, nullable })
const roundTrip = (v: Value, type: ColumnType, strict = true) => show(decodeField(encodeField(v, col(type), ctx(strict)), type))

test('M5.2: values round-trip through every column type in scope', () => {
  assert.equal(roundTrip(n(-128), { type: FIELD_TYPE.TINY }), '-128')
  assert.equal(roundTrip(s('42'), { type: FIELD_TYPE.LONG }), '42')
  assert.equal(roundTrip(d('2.5'), { type: FIELD_TYPE.LONG }), '3')
  assert.equal(roundTrip(d('1.239'), { type: FIELD_TYPE.NEWDECIMAL, precision: 5, scale: 2 }), '1.24')
  assert.equal(roundTrip(n(7), { type: FIELD_TYPE.NEWDECIMAL, precision: 5, scale: 2 }), '7.00')
  assert.equal(roundTrip(doubleValue(1.5), { type: FIELD_TYPE.DOUBLE }), '1.5')
  assert.equal(roundTrip(s('héllo'), { type: FIELD_TYPE.VAR_STRING, length: 5, collationId: UTF8MB4 }), 'héllo')
  assert.equal(roundTrip(s('ab  '), { type: FIELD_TYPE.STRING, length: 4, collationId: UTF8MB4 }), 'ab')
  assert.equal(roundTrip(s('ab'), { type: FIELD_TYPE.STRING, length: 4, collationId: 8 }), 'ab')
  assert.equal(roundTrip(s('2024-02-29 13:14:15.123456'), { type: FIELD_TYPE.DATETIME, decimals: 3 }), '2024-02-29 13:14:15.123')
  assert.equal(roundTrip(s('2024-02-29 13:14:15'), { type: FIELD_TYPE.TIMESTAMP }), '2024-02-29 13:14:15')
  assert.equal(roundTrip(s('-12:30:00'), { type: FIELD_TYPE.TIME }), '-12:30:00')
  assert.equal(roundTrip(s('b'), { type: FIELD_TYPE.ENUM, members: ['a', 'b'], collationId: UTF8MB4 }), 'b')
  const binary = decodeField(encodeField(s('ab'), col({ type: FIELD_TYPE.STRING, length: 4, collationId: 63 }), ctx()), { type: FIELD_TYPE.STRING, length: 4, collationId: 63 })
  assert.deepEqual(binary, { kind: 'bytes', v: Uint8Array.from([0x61, 0x62, 0, 0]) })
})

test('M5.2: a DATE is stored so that memcmp orders it', () => {
  // The binlog's little-endian DATE would sort 2024-01-02 before 2023-12-31.
  const type: ColumnType = { type: FIELD_TYPE.DATE }
  const a = encodeField(s('2023-12-31'), col(type), ctx()) as Uint8Array
  const b = encodeField(s('2024-01-02'), col(type), ctx()) as Uint8Array
  assert.equal(memcmp(a, b) < 0, true)
})

test('M5.2: a bad value is an error under a strict mode, and a warning and an adjusted value otherwise', () => {
  const code = (fn: () => unknown): number | undefined => {
    try {
      fn()
    } catch (e) {
      return (e as MyjsError).errno
    }
    return undefined
  }
  const tiny: ColumnType = { type: FIELD_TYPE.TINY }
  assert.equal(code(() => encodeField(n(300), col(tiny), ctx())), 1264)
  // Which number depends on the column (8.4.11). This line asserted 1366 for
  // '12abc' until M5.8's corpus put such a value into a DOUBLE and the server
  // said 1265; asked directly, it says 1265 for '12abc' into an INT as well.
  assert.equal(code(() => encodeField(s('12abc'), col({ type: FIELD_TYPE.LONG }), ctx())), 1265)
  assert.equal(code(() => encodeField(s('abc12'), col({ type: FIELD_TYPE.LONG }), ctx())), 1366)
  assert.equal(code(() => encodeField(s('abc'), col({ type: FIELD_TYPE.DOUBLE }), ctx())), 1265)
  assert.equal(code(() => encodeField(s('1x'), col({ type: FIELD_TYPE.NEWDECIMAL, precision: 5, scale: 2 }), ctx())), 1366)
  assert.equal(code(() => encodeField(s('abcdef'), col({ type: FIELD_TYPE.VAR_STRING, length: 3, collationId: UTF8MB4 }), ctx())), 1406)
  assert.equal(code(() => encodeField(s('2024-13-01'), col({ type: FIELD_TYPE.DATE }), ctx())), 1292)
  assert.equal(code(() => encodeField(null, col(tiny, false), ctx())), 1048)
  // Trailing spaces beyond a VARCHAR's length are dropped, not refused.
  assert.equal(roundTrip(s('abc   '), { type: FIELD_TYPE.VAR_STRING, length: 3, collationId: UTF8MB4 }), 'abc')

  const lax = ctx(false)
  assert.equal(show(decodeField(encodeField(n(300), col(tiny), lax), tiny)), '127')
  assert.equal(lax.warnings, 1)
})
