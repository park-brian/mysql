// M1.21 — "doc 15's temporal byte dumps encode and decode exactly, shortest
// form on write; INT24 occupies 4 bytes".
//
// Doc 43 §4: golden vectors taken from MySQL's own source comments and
// specification examples are free, authoritative test cases already written
// out. These are doc 15's, byte for byte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { Reader, Writer } from '@myjs/bytes'
import {
  FIELD_TYPE,
  writeBinaryValue,
  readBinaryValue,
  writeBinaryDateTime,
  readBinaryDateTime,
  writeBinaryTime,
  readBinaryTime,
  binaryValueToText,
  isLengthEncodedType,
  type MysqlDateTime,
  type MysqlTime,
} from '@myjs/protocol'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join(' ')
const bytes = (s: string) => new Uint8Array(s.split(' ').map((h) => parseInt(h, 16)))

// --- doc 15's DATE / DATETIME dumps --------------------------------------

test('04 da 07 0a 11 is 2010-10-17', () => {
  const v = readBinaryDateTime(new Reader(bytes('04 da 07 0a 11')))
  assert.deepEqual(v, { year: 2010, month: 10, day: 17, hour: 0, minute: 0, second: 0, microsecond: 0 })
  const w = new Writer()
  writeBinaryDateTime(w, v)
  assert.equal(hex(w.view()), '04 da 07 0a 11', 'and re-encodes to the same bytes')
})

test('0b da 07 0a 11 13 1b 1e 01 00 00 00 is 2010-10-17 19:27:30.000001', () => {
  const v = readBinaryDateTime(new Reader(bytes('0b da 07 0a 11 13 1b 1e 01 00 00 00')))
  assert.deepEqual(v, {
    year: 2010,
    month: 10,
    day: 17,
    hour: 19,
    minute: 27,
    second: 30,
    microsecond: 1,
  })
  assert.equal(binaryValueToText(v), '2010-10-17 19:27:30.000001')
  const w = new Writer()
  writeBinaryDateTime(w, v)
  assert.equal(hex(w.view()), '0b da 07 0a 11 13 1b 1e 01 00 00 00')
})

test('a writer must emit the shortest form; a reader must accept all four', () => {
  // The same instant, written at each legal length, must read back identically.
  const dateOnly: MysqlDateTime = { year: 2010, month: 10, day: 17, hour: 0, minute: 0, second: 0, microsecond: 0 }
  const withTime: MysqlDateTime = { ...dateOnly, hour: 19, minute: 27, second: 30 }
  const withMicros: MysqlDateTime = { ...withTime, microsecond: 1 }
  const zero: MysqlDateTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }

  const lengthOf = (v: MysqlDateTime) => {
    const w = new Writer()
    writeBinaryDateTime(w, v)
    return w.view()[0]
  }
  assert.equal(lengthOf(zero), 0, 'the zero date has its own encoding')
  assert.equal(lengthOf(dateOnly), 4)
  assert.equal(lengthOf(withTime), 7)
  assert.equal(lengthOf(withMicros), 11)

  // And the long forms still decode.
  assert.deepEqual(readBinaryDateTime(new Reader(bytes('07 da 07 0a 11 00 00 00'))), dateOnly)
  assert.deepEqual(readBinaryDateTime(new Reader(bytes('0b da 07 0a 11 13 1b 1e 00 00 00 00'))), withTime)
})

test('an illegal DATETIME length is a typed error, not a misparse', () => {
  assert.throws(() => readBinaryDateTime(new Reader(bytes('05 da 07 0a 11 00'))), /length must be 0, 4, 7 or 11/)
})

// --- doc 15's TIME dumps -------------------------------------------------

test('0c 01 78 00 00 00 13 1b 1e 01 00 00 00 is -120d 19:27:30.000001', () => {
  const v = readBinaryTime(new Reader(bytes('0c 01 78 00 00 00 13 1b 1e 01 00 00 00')))
  assert.deepEqual(v, { negative: true, days: 120, hour: 19, minute: 27, second: 30, microsecond: 1 })
  const w = new Writer()
  writeBinaryTime(w, v)
  assert.equal(hex(w.view()), '0c 01 78 00 00 00 13 1b 1e 01 00 00 00')
})

test('08 01 78 00 00 00 13 1b 1e is -120d 19:27:30', () => {
  const v = readBinaryTime(new Reader(bytes('08 01 78 00 00 00 13 1b 1e')))
  assert.deepEqual(v, { negative: true, days: 120, hour: 19, minute: 27, second: 30, microsecond: 0 })
  const w = new Writer()
  writeBinaryTime(w, v)
  assert.equal(hex(w.view()), '08 01 78 00 00 00 13 1b 1e')
})

test('the all-zero TIME encodes as a bare length byte of 0 (see E-07)', () => {
  // Doc 15's third dump prints `01` for this value, which contradicts the
  // layout three lines above it: the length byte is 0, 8 or 12, and nothing
  // follows a length of 0. We encode `00` and treat `01` as a typo — recorded
  // as E-07 and checked against a real server by the trace fixtures.
  const zero: MysqlTime = { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  const w = new Writer()
  writeBinaryTime(w, zero)
  assert.equal(hex(w.view()), '00')
  assert.deepEqual(readBinaryTime(new Reader(bytes('00'))), zero)
  assert.equal(binaryValueToText(zero), '0:00:00')
})

test('an illegal TIME length is a typed error', () => {
  assert.throws(() => readBinaryTime(new Reader(bytes('01 00'))), /length must be 0, 8 or 12/)
})

test('TIME carries hours beyond 24 in `days`', () => {
  // 838:59:59 is 34 days and 22 hours — the reason for the split.
  const v: MysqlTime = { negative: false, days: 34, hour: 22, minute: 59, second: 59, microsecond: 0 }
  const w = new Writer()
  writeBinaryTime(w, v)
  assert.deepEqual(readBinaryTime(new Reader(w.view())), v)
  assert.equal(binaryValueToText(v), '838:59:59')
})

// --- scalars -------------------------------------------------------------

test('INT24 occupies 4 bytes on the wire, not 3', () => {
  const w = new Writer()
  writeBinaryValue(w, 0x123456, { type: FIELD_TYPE.INT24 })
  assert.equal(w.length, 4)
  assert.equal(readBinaryValue(new Reader(w.view()), { type: FIELD_TYPE.INT24 }), 0x123456)
})

test('DECIMAL and JSON travel as length-encoded strings even in the binary protocol', () => {
  for (const type of [FIELD_TYPE.NEWDECIMAL, FIELD_TYPE.DECIMAL, FIELD_TYPE.JSON]) {
    assert.equal(isLengthEncodedType(type), true)
  }
  const w = new Writer()
  writeBinaryValue(w, '123.4500', { type: FIELD_TYPE.NEWDECIMAL })
  const got = readBinaryValue(new Reader(w.view()), { type: FIELD_TYPE.NEWDECIMAL })
  assert.equal(binaryValueToText(got), '123.4500', 'trailing zeros to the declared scale survive')
})

test('signedness comes from the column flag, not the value', () => {
  // Decoding int<8> without consulting it produces negative BIGINT UNSIGNED
  // values — a classic driver bug.
  const w = new Writer()
  writeBinaryValue(w, 0xffff_ffff_ffff_ffffn, { type: FIELD_TYPE.LONGLONG })
  assert.equal(readBinaryValue(new Reader(w.view()), { type: FIELD_TYPE.LONGLONG, unsigned: true }), 18446744073709551615n)
  assert.equal(readBinaryValue(new Reader(w.view()), { type: FIELD_TYPE.LONGLONG, unsigned: false }), -1n)

  const t = new Writer()
  writeBinaryValue(t, 0xff, { type: FIELD_TYPE.TINY })
  assert.equal(readBinaryValue(new Reader(t.view()), { type: FIELD_TYPE.TINY, unsigned: true }), 255)
  assert.equal(readBinaryValue(new Reader(t.view()), { type: FIELD_TYPE.TINY, unsigned: false }), -1)
})

test('floats round-trip at their own width', () => {
  const w = new Writer()
  writeBinaryValue(w, 0.5, { type: FIELD_TYPE.FLOAT })
  writeBinaryValue(w, -0.25, { type: FIELD_TYPE.DOUBLE })
  const r = new Reader(w.view())
  assert.equal(readBinaryValue(r, { type: FIELD_TYPE.FLOAT }), 0.5)
  assert.equal(readBinaryValue(r, { type: FIELD_TYPE.DOUBLE }), -0.25)
})

// --- properties ----------------------------------------------------------

test('every DATETIME round-trips through the shortest form', () => {
  fc.assert(
    fc.property(
      fc.record({
        year: fc.integer({ min: 1000, max: 9999 }),
        month: fc.integer({ min: 1, max: 12 }),
        day: fc.integer({ min: 1, max: 28 }),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
        microsecond: fc.integer({ min: 0, max: 999999 }),
      }),
      (v) => {
        const w = new Writer()
        writeBinaryDateTime(w, v)
        // Spread: fast-check builds null-prototype records, and
        // node:assert/strict compares prototypes.
        assert.deepEqual(readBinaryDateTime(new Reader(w.view())), { ...v })
      },
    ),
    { numRuns: 2000 },
  )
})

test('every TIME round-trips through the shortest form', () => {
  fc.assert(
    fc.property(
      fc.record({
        negative: fc.boolean(),
        days: fc.integer({ min: 0, max: 34 }),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
        microsecond: fc.integer({ min: 0, max: 999999 }),
      }),
      (v) => {
        const w = new Writer()
        writeBinaryTime(w, v)
        const got = readBinaryTime(new Reader(w.view()))
        // The all-zero value loses its sign, which is correct: there is no
        // negative zero duration, and the zero encoding carries no sign byte.
        const allZero =
          v.days === 0 && v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0
        assert.deepEqual(got, allZero ? { ...v, negative: false } : { ...v })
      },
    ),
    { numRuns: 2000 },
  )
})
