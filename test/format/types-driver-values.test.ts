// M2.24 — D-15's JS type mapping, one case per row of doc 15's table.
//
// D-15's reason for existing is that "swapping a real connection for ours must
// change nothing in the application". That is only true if every row is a
// rule rather than a default, so every row is asserted here — including the
// two that surprise people, which are the two most likely to be quietly wrong:
// TIME is a string because it is a duration, and the zero date becomes `null`
// because `Date` cannot hold it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { encodeCharset } from '@myjs/charsets'
import {
  decodeStorageValue,
  encodeBit,
  encodeDatetime2,
  encodeDecimal,
  encodeInt,
  encodeSet,
  setMaskOf,
  encodeTime2,
  encodeUnsignedInt,
  encodeYear,
  toDriverValue,
  type ColumnMeta,
  type StorageValue,
} from '@myjs/types'

const UTF8MB4 = 255
const col = (type: number, over: Partial<ColumnMeta> = {}): ColumnMeta => ({ type, ...over })
/** Decode then map, which is the path a row actually takes. */
const driver = (bytes: Uint8Array, meta: ColumnMeta, options = {}) =>
  toDriverValue(decodeStorageValue(meta.type, bytes, meta), meta, options)

test('D-15: TINYINT..INT are numbers, and BIGINT narrows only when it is lossless', () => {
  assert.equal(driver(encodeInt(42n, 4, false), col(FIELD_TYPE.LONG)), 42)
  assert.equal(driver(encodeInt(-42n, 4, false), col(FIELD_TYPE.LONG)), -42)
  assert.equal(driver(encodeUnsignedInt(4294967295n, 4), col(FIELD_TYPE.LONG, { unsigned: true })), 4294967295)

  // A BIGINT inside the safe range is a number; one outside it stays a BigInt,
  // because silent precision loss is the thing D-15 exists to prevent.
  const safe = BigInt(Number.MAX_SAFE_INTEGER)
  assert.equal(driver(encodeInt(safe, 8, false), col(FIELD_TYPE.LONGLONG)), Number.MAX_SAFE_INTEGER)
  assert.equal(typeof driver(encodeInt(safe, 8, false), col(FIELD_TYPE.LONGLONG)), 'number')
  const unsafe = safe + 1n
  assert.equal(driver(encodeInt(unsafe, 8, false), col(FIELD_TYPE.LONGLONG)), unsafe)
  assert.equal(typeof driver(encodeInt(unsafe, 8, false), col(FIELD_TYPE.LONGLONG)), 'bigint')

  // …and `supportBigNumbers` makes it a BigInt either way.
  assert.equal(
    typeof driver(encodeInt(1n, 8, false), col(FIELD_TYPE.LONGLONG), { supportBigNumbers: true }),
    'bigint',
  )
})

test('D-15: DECIMAL is a string, because a double cannot hold DECIMAL(30,10)', () => {
  const meta = col(FIELD_TYPE.NEWDECIMAL, { precision: 14, scale: 4 })
  const bytes = encodeDecimal('1234567890.1234', 14, 4)
  const value = driver(bytes, meta)
  assert.equal(typeof value, 'string')
  // Trailing zeros to the declared scale survive, which is the whole reason
  // the string is carried rather than a number.
  assert.equal(driver(encodeDecimal('1.5', 14, 4), meta), '1.5000')
  assert.equal(value, '1234567890.1234')
})

test('D-15: DATE and DATETIME are Dates, and the zero date is null', () => {
  const dt = col(FIELD_TYPE.DATETIME2, { decimals: 6 })
  const value = driver(encodeDatetime2({ year: 2010, month: 10, day: 17, hour: 19, minute: 27, second: 30, microsecond: 1 }, 6), dt)
  assert.ok(value instanceof Date)
  assert.equal((value as Date).toISOString(), '2010-10-17T19:27:30.000Z')

  // The zero date is representable in MySQL and not in `Date`. `mysql2`
  // returns null; so do we.
  const zero = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  assert.equal(driver(encodeDatetime2(zero, 0), col(FIELD_TYPE.DATETIME2)), null)
  // …unless `dateStrings`, where it round-trips instead of vanishing.
  assert.equal(driver(encodeDatetime2(zero, 0), col(FIELD_TYPE.DATETIME2), { dateStrings: true }), '0000-00-00')
})

test('D-15: dateStrings keeps the microseconds a Date would lose', () => {
  const meta = col(FIELD_TYPE.DATETIME2, { decimals: 6 })
  const bytes = encodeDatetime2(
    { year: 2010, month: 10, day: 17, hour: 19, minute: 27, second: 30, microsecond: 1 },
    6,
  )
  assert.equal(driver(bytes, meta, { dateStrings: true }), '2010-10-17 19:27:30.000001')
  // A `Date` cannot: it has millisecond resolution, so the microsecond is gone.
  assert.equal((driver(bytes, meta) as Date).getUTCMilliseconds(), 0)
})

test('D-15: TIME is a string — a duration, not an instant', () => {
  const meta = col(FIELD_TYPE.TIME2, { decimals: 6 })
  const negative = { negative: true, days: 5, hour: 0, minute: 19, second: 27, microsecond: 1 }
  const value = driver(encodeTime2(negative, 6), meta)
  assert.equal(typeof value, 'string')
  // Negative, and past 24 hours: both are why doc 15 says a `Date` is wrong.
  assert.equal(value, '-120:19:27.000001')
  assert.equal(driver(encodeTime2({ negative: false, days: 0, hour: 19, minute: 27, second: 30, microsecond: 0 }, 0), col(FIELD_TYPE.TIME2)), '19:27:30')
  // `dateStrings` changes nothing here — it was already a string.
  assert.equal(driver(encodeTime2(negative, 6), meta, { dateStrings: true }), '-120:19:27.000001')
})

test('D-15: YEAR is a number', () => {
  assert.equal(driver(encodeYear(2010), col(FIELD_TYPE.YEAR)), 2010)
})

test('D-15: text decodes per the column charset; binary stays bytes', () => {
  const text = col(FIELD_TYPE.VAR_STRING, { collationId: UTF8MB4 })
  assert.equal(driver(encodeCharset('café', 'utf8mb4'), text), 'café')

  // The type byte is identical; only the collation says VARBINARY rather than
  // VARCHAR (doc 15). Charset 63 is how a client tells them apart, and it is
  // how we do too.
  const binary = col(FIELD_TYPE.VAR_STRING, { collationId: CHARSET_BINARY })
  const bytes = Uint8Array.of(0x00, 0xff, 0x41)
  assert.deepEqual(driver(bytes, binary), bytes)
  assert.ok(driver(bytes, binary) instanceof Uint8Array)

  // latin1 goes through the generated table, so this is the B0 fix reaching
  // all the way out to the driver boundary.
  const latin1 = col(FIELD_TYPE.VAR_STRING, { collationId: 8 })
  assert.equal(driver(Uint8Array.of(0x80), latin1), '€')
})

test('D-15: ENUM is its label, SET is the labels joined', () => {
  const members = ['small', 'medium', 'large']
  const e = col(FIELD_TYPE.ENUM, { members })
  // Indexes are 1-based; 0 is MySQL's invalid slot and has no label.
  assert.equal(driver(Uint8Array.of(0x02), e), 'medium')
  assert.equal(driver(Uint8Array.of(0x00), e), '')

  const s = col(FIELD_TYPE.SET, { members })
  assert.equal(driver(encodeSet(setMaskOf(['small', 'large'], members), members.length), s), 'small,large')
  assert.equal(driver(encodeSet(0n, members.length), s), '')
})

test('D-15: BIT is a number up to BIT(53) and bytes beyond it', () => {
  assert.equal(driver(encodeBit(1n, 1), col(FIELD_TYPE.BIT, { bits: 1 })), 1)
  assert.equal(driver(encodeBit(0n, 1), col(FIELD_TYPE.BIT, { bits: 1 })), 0)
  assert.equal(driver(encodeBit(0x1234n, 16), col(FIELD_TYPE.BIT, { bits: 16 })), 0x1234)
  // 53 is where a double stops being exact, so that is where doc 15 switches.
  const wide = (1n << 60n) | 1n
  const value = driver(encodeBit(wide, 64), col(FIELD_TYPE.BIT, { bits: 64 }))
  assert.ok(value instanceof Uint8Array)
  assert.equal((value as Uint8Array).length, 8)
  assert.equal((value as Uint8Array)[0], 0x10)
  assert.equal((value as Uint8Array)[7], 0x01)
})

test('D-15: JSON arrives parsed', () => {
  const doc = { b: 1, a: [1, 2, null] }
  const bytes = new TextEncoder().encode(JSON.stringify(doc))
  assert.deepEqual(toDriverValue(bytes, col(FIELD_TYPE.JSON)) as unknown, doc)
})

test('D-15: NULL is null, whatever the column', () => {
  for (const type of [FIELD_TYPE.LONG, FIELD_TYPE.DATETIME2, FIELD_TYPE.VAR_STRING, FIELD_TYPE.JSON]) {
    assert.equal(toDriverValue(null, col(type)), null)
  }
  assert.equal(decodeStorageValue(FIELD_TYPE.NULL, new Uint8Array(0)), null)
})

test('M2.24: a decoder that needs metadata refuses rather than guessing', () => {
  // DECIMAL without precision and scale, and ENUM without its member list,
  // cannot be decoded at all — doc 27's point that a record needs the
  // dictionary. Guessing would produce a plausible wrong value.
  assert.throws(() => decodeStorageValue(FIELD_TYPE.NEWDECIMAL, Uint8Array.of(0x81)), /precision is required/)
  assert.throws(() => decodeStorageValue(FIELD_TYPE.ENUM, Uint8Array.of(0x01)), /members is required/)
  assert.throws(() => decodeStorageValue(0x99, Uint8Array.of(0x01)), /not supported yet/)
})

test('M2.24: TIMESTAMP keeps its UTC instant rather than inventing a zone', () => {
  // Doc 15: TIMESTAMP is stored as UTC and converted using the session
  // `time_zone`. A codec has no session, so it returns the stored value and
  // the executor converts it — the alternative is to bake in the host's zone
  // and shift every value by hours.
  const stored = decodeStorageValue(FIELD_TYPE.TIMESTAMP2, timestampBytes(), col(FIELD_TYPE.TIMESTAMP2)) as {
    epochSeconds: number
    microsecond: number
  }
  assert.equal(typeof stored.epochSeconds, 'number')
  const value = toDriverValue(stored as StorageValue, col(FIELD_TYPE.TIMESTAMP2))
  assert.ok(value instanceof Date)
  assert.equal((value as Date).toISOString(), '2010-10-17T19:27:30.000Z')
})

function timestampBytes(): Uint8Array {
  // 2010-10-17 19:27:30 UTC, big-endian seconds, no fraction.
  const seconds = Math.floor(Date.UTC(2010, 9, 17, 19, 27, 30) / 1000)
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, seconds, false)
  return out
}
