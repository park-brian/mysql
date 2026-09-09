// M2.11, M2.12 — temporals, ENUM/SET, BIT, and CHAR/BINARY padding.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { memcmp } from '@myjs/charsets'
import type { MysqlDateTime, MysqlTime } from '@myjs/bytes'
import {
  DATETIMEF_INT_OFS,
  TypeError as MyjsTypeError,
  bitBinSize,
  dateFieldToStorage,
  dateStorageToField,
  datetimeBinSize,
  decodeBit,
  decodeDateField,
  decodeDatetime2,
  decodeEnum,
  decodeLegacyDatetime,
  decodeLegacyTime,
  decodeLegacyTimestamp,
  decodeSet,
  decodeTime2,
  decodeTimestamp2,
  decodeYear,
  encodeBit,
  encodeDateField,
  encodeDatetime2,
  encodeEnum,
  encodeSet,
  encodeTime2,
  encodeTimestamp2,
  encodeYear,
  enumBinSize,
  enumIndexOf,
  enumMember,
  fractionalBytes,
  padBinary,
  padChar,
  setBinSize,
  setMaskOf,
  setMembers,
  timeBinSize,
  timestampBinSize,
  trimTrailingSpaces,
} from '@myjs/types'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')
const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

const dt = (o: Partial<MysqlDateTime> = {}): MysqlDateTime => ({
  year: 2010, month: 10, day: 17, hour: 19, minute: 27, second: 30, microsecond: 0, ...o,
})
const tm = (o: Partial<MysqlTime> = {}): MysqlTime => ({
  negative: false, days: 0, hour: 19, minute: 27, second: 30, microsecond: 0, ...o,
})

// --- M2.11 DATETIME2 --------------------------------------------------------

test("M2.11: doc 24's DATETIMEF_INT_OFS and byte widths", () => {
  assert.equal(DATETIMEF_INT_OFS, 0x8000000000n)
  assert.equal(datetimeBinSize(0), 5)
  assert.equal(datetimeBinSize(3), 7)
  assert.equal(datetimeBinSize(6), 8)
  for (const [dec, extra] of [[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3]] as const) {
    assert.equal(fractionalBytes(dec), extra, `dec ${dec}`)
  }
})

test('M2.11: the month slot is year*13 + month, because month 0 is legal', () => {
  // `year * 12` would collide the zero date with a real one. The check that
  // catches it is that the zero date decodes back to all zeros.
  const zero = dt({ year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 })
  assert.deepEqual(decodeDatetime2(encodeDatetime2(zero, 0), 0), zero)
  // And that a December date is not confused with the next January.
  const dec31 = dt({ year: 2010, month: 12, day: 31 })
  const jan1 = dt({ year: 2011, month: 1, day: 1 })
  assert.notDeepEqual(encodeDatetime2(dec31, 0), encodeDatetime2(jan1, 0))
  assert.deepEqual(decodeDatetime2(encodeDatetime2(dec31, 0), 0), dec31)
  assert.deepEqual(decodeDatetime2(encodeDatetime2(jan1, 0), 0), jan1)
})

test('M2.11: every fractional width 0..6 round-trips', () => {
  for (const dec of [0, 1, 2, 3, 4, 5, 6]) {
    // A precision of `dec` keeps `dec` significant digits, so pick a value
    // that survives the truncation the format performs.
    const micros = dec === 0 ? 0 : Number(String(123456).slice(0, dec).padEnd(6, '0'))
    const v = dt({ microsecond: micros })
    const encoded = encodeDatetime2(v, dec)
    assert.equal(encoded.length, datetimeBinSize(dec), `dec ${dec}`)
    assert.deepEqual(decodeDatetime2(encoded, dec), v, `dec ${dec}`)
  }
})

test('M2.11: DATETIME2 is memcmp-ordered, which is what the offset is for', () => {
  fc.assert(
    fc.property(
      fc.record({
        year: fc.integer({ min: 0, max: 9999 }),
        month: fc.integer({ min: 0, max: 12 }),
        day: fc.integer({ min: 0, max: 31 }),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
      }),
      fc.record({
        year: fc.integer({ min: 0, max: 9999 }),
        month: fc.integer({ min: 0, max: 12 }),
        day: fc.integer({ min: 0, max: 31 }),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
      }),
      (a, b) => {
        const key = (v: typeof a) => [v.year, v.month, v.day, v.hour, v.minute, v.second]
        const ka = key(a)
        const kb = key(b)
        let expected = 0
        for (let i = 0; i < ka.length && expected === 0; i++) {
          expected = sign((ka[i] as number) - (kb[i] as number))
        }
        const bytesA = encodeDatetime2({ ...a, microsecond: 0 }, 0)
        const bytesB = encodeDatetime2({ ...b, microsecond: 0 }, 0)
        assert.equal(sign(memcmp(bytesA, bytesB)), expected)
      },
    ),
    { numRuns: 2000 },
  )
})

// --- M2.11 TIMESTAMP2 -------------------------------------------------------

test('M2.11: TIMESTAMP2 is 4 big-endian epoch seconds plus the same tail', () => {
  assert.equal(timestampBinSize(0), 4)
  assert.equal(timestampBinSize(2), 5)
  assert.equal(timestampBinSize(4), 6)
  assert.equal(timestampBinSize(6), 7)
  assert.equal(hex(encodeTimestamp2(1, 0, 0)), '00 00 00 01')
  for (const dec of [0, 1, 2, 3, 4, 5, 6]) {
    const micros = dec === 0 ? 0 : Number(String(654321).slice(0, dec).padEnd(6, '0'))
    const got = decodeTimestamp2(encodeTimestamp2(1287343650, micros, dec), dec)
    assert.deepEqual(got, { epochSeconds: 1287343650, microsecond: micros }, `dec ${dec}`)
  }
})

test('M2.11: TIMESTAMP2 is memcmp-ordered over the whole 32-bit epoch range', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer({ min: 0, max: 0xffffffff }), (a, b) => {
      assert.equal(sign(memcmp(encodeTimestamp2(a, 0, 0), encodeTimestamp2(b, 0, 0))), sign(a - b))
    }),
    { numRuns: 2000 },
  )
})

// --- M2.11 TIME2 ------------------------------------------------------------

test('M2.11: the 10-bit hour field is why TIME stops at 838:59:59', () => {
  assert.equal(timeBinSize(0), 3)
  assert.equal(timeBinSize(6), 6)
  const max = tm({ days: 34, hour: 22, minute: 59, second: 59 }) // 838 hours
  assert.deepEqual(decodeTime2(encodeTime2(max, 0), 0), max)
  assert.throws(() => encodeTime2(tm({ days: 35, hour: 0 }), 0), MyjsTypeError)
})

test('M2.11: a negative TIME round-trips, fraction included', () => {
  // Doc 24: negatives are the two's complement of the packed value before the
  // offset is added, so the fraction is part of the magnitude — a negative
  // TIME is not "negative hours with positive microseconds".
  for (const dec of [0, 3, 6]) {
    const micros = dec === 0 ? 0 : Number(String(500000).slice(0, dec).padEnd(6, '0'))
    const v = tm({ negative: true, hour: 12, minute: 34, second: 56, microsecond: micros })
    assert.deepEqual(decodeTime2(encodeTime2(v, dec), dec), v, `dec ${dec}`)
  }
})

test('M2.11: TIME2 is memcmp-ordered across the sign boundary', () => {
  // The property the two's complement plus offset exists to provide: -1:00:00
  // must sort before 00:00:00, which must sort before 1:00:00.
  const toSeconds = (v: MysqlTime) =>
    (v.negative ? -1 : 1) * ((v.days * 24 + v.hour) * 3600 + v.minute * 60 + v.second)
  fc.assert(
    fc.property(
      fc.record({
        negative: fc.boolean(),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
      }),
      fc.record({
        negative: fc.boolean(),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
      }),
      (ra, rb) => {
        const a = tm({ ...ra, days: 0, microsecond: 0 })
        const b = tm({ ...rb, days: 0, microsecond: 0 })
        const sa = toSeconds(a)
        const sb = toSeconds(b)
        assert.equal(sign(memcmp(encodeTime2(a, 0), encodeTime2(b, 0))), sign(sa - sb), `${sa} vs ${sb}`)
      },
    ),
    { numRuns: 3000 },
  )
})

// --- M2.11 DATE and YEAR ----------------------------------------------------

test('M2.11: DATE packs year<<9 | month<<5 | day, little-endian as Field wrote it', () => {
  const field = encodeDateField(2010, 10, 17)
  assert.deepEqual(decodeDateField(field), { year: 2010, month: 10, day: 17 })
  // 2010<<9 | 10<<5 | 17 = 1029457 = 0x0FB551, little-endian 51 B5 0F.
  assert.equal(hex(field), '51 B5 0F')
})

test('M2.11: DATE has two steps, and only the first applies to a binlog row image', () => {
  // Doc 24: "Both steps matter when reading a `.ibd`; only the first matters
  // when reading a binlog row image." Hence two named functions, tested apart.
  const field = encodeDateField(2010, 10, 17)
  const storage = dateFieldToStorage(field)
  assert.equal(hex(storage), '8F B5 51')
  assert.deepEqual(dateStorageToField(storage), field)
  assert.deepEqual(decodeDateField(dateStorageToField(storage)), { year: 2010, month: 10, day: 17 })
})

test('M2.11: the storage form of DATE is memcmp-ordered; the field form is not', () => {
  const early = dateFieldToStorage(encodeDateField(1999, 12, 31))
  const late = dateFieldToStorage(encodeDateField(2000, 1, 1))
  assert.equal(sign(memcmp(early, late)), -1)
  // The little-endian field form gets this backwards, which is the entire
  // reason InnoDB reverses it.
  assert.equal(sign(memcmp(encodeDateField(1999, 12, 31), encodeDateField(2000, 1, 1))), 1)
})

test('M2.11: 0000-00-00 is representable, and is all zeros', () => {
  assert.equal(hex(encodeDateField(0, 0, 0)), '00 00 00')
  assert.deepEqual(decodeDateField(encodeDateField(0, 0, 0)), { year: 0, month: 0, day: 0 })
})

test('M2.11: YEAR stores year - 1900, with 0 reserved for the zero year', () => {
  assert.equal(hex(encodeYear(1901)), '01')
  assert.equal(hex(encodeYear(2155)), 'FF')
  assert.equal(hex(encodeYear(0)), '00')
  assert.equal(decodeYear(encodeYear(2026)), 2026)
  assert.equal(decodeYear(encodeYear(0)), 0)
  assert.throws(() => encodeYear(1900), MyjsTypeError)
  assert.throws(() => encodeYear(2156), MyjsTypeError)
})

// --- M2.11 legacy -----------------------------------------------------------

test('M2.11: the legacy decoders read the pre-5.6.4 forms', () => {
  // Old DATETIME is the decimal number YYYYMMDDHHMMSS in an int64.
  const packed = 20101017192730n
  const bytes = new Uint8Array(8)
  let v = packed
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn)
    v >>= 8n
  }
  bytes[0] = (bytes[0] as number) ^ 0x80 // DATA_INT sign flip
  assert.deepEqual(decodeLegacyDatetime(bytes), dt({ microsecond: 0 }))
  // Old TIMESTAMP is little-endian epoch seconds.
  assert.equal(decodeLegacyTimestamp(Uint8Array.from([0x01, 0x00, 0x00, 0x00])), 1)
  // Old TIME is the decimal number HHMMSS.
  const t = new Uint8Array([0x00, 0x00, 0x00])
  const hhmmss = 192730
  t[0] = (hhmmss >> 16) & 0xff
  t[1] = (hhmmss >> 8) & 0xff
  t[2] = hhmmss & 0xff
  t[0] = (t[0] as number) ^ 0x80
  assert.deepEqual(decodeLegacyTime(t), tm({ microsecond: 0 }))
})

// --- M2.12 ENUM and SET -----------------------------------------------------

test('M2.12: ENUM indexes are 1-based and 0 is the invalid value', () => {
  const members = ['small', 'medium', 'large']
  assert.equal(enumBinSize(3), 1)
  assert.equal(enumBinSize(256), 2)
  assert.equal(enumIndexOf('small', members), 1)
  assert.equal(enumIndexOf('nope', members), 0)
  assert.equal(enumMember(2, members), 'medium')
  assert.equal(enumMember(0, members), null)
  assert.equal(decodeEnum(encodeEnum(3, 3)), 3)
  assert.throws(() => encodeEnum(4, 3), MyjsTypeError)
})

test('M2.12: ENUM and SET are forced unsigned — big-endian with no sign flip', () => {
  // The trap doc 24 calls out: `UNSIGNED_FLAG` is clear on the column, but
  // InnoDB forces DATA_UNSIGNED anyway. A sign flip here would make 1 encode
  // as 0x81.
  assert.equal(hex(encodeEnum(1, 3)), '01')
  assert.equal(hex(encodeEnum(1, 300)), '00 01')
  assert.equal(hex(encodeSet(1n, 8)), '01')
})

test('M2.12: SET is a bitmask sized to the smallest width that holds it', () => {
  for (const [members, width] of [[1, 1], [8, 1], [9, 2], [16, 2], [17, 3], [24, 3], [25, 4], [32, 4], [33, 8], [64, 8]] as const) {
    assert.equal(setBinSize(members), width, `${members} members`)
  }
  const members = ['a', 'b', 'c', 'd']
  const mask = setMaskOf(['a', 'c'], members)
  assert.equal(mask, 0b0101n)
  assert.deepEqual(setMembers(mask, members), ['a', 'c'])
  assert.equal(decodeSet(encodeSet(mask, members.length)), mask)
  assert.throws(() => setMaskOf(['z'], members), MyjsTypeError)
})

test('M2.12: a 64-member SET uses the full 8 bytes without overflowing', () => {
  const all = (1n << 64n) - 1n
  assert.equal(decodeSet(encodeSet(all, 64)), all)
  assert.equal(encodeSet(all, 64).length, 8)
})

// --- M2.12 BIT --------------------------------------------------------------

test('M2.12: BIT(n) is ceil(n/8) bytes, big-endian, right-aligned', () => {
  assert.equal(bitBinSize(1), 1)
  assert.equal(bitBinSize(8), 1)
  assert.equal(bitBinSize(9), 2)
  assert.equal(bitBinSize(64), 8)
  assert.equal(hex(encodeBit(1n, 9)), '00 01')
  assert.equal(hex(encodeBit(0x1ffn, 9)), '01 FF')
  assert.equal(decodeBit(encodeBit(0b101n, 3)), 0b101n)
  assert.throws(() => encodeBit(0b1000n, 3), MyjsTypeError)
  assert.throws(() => encodeBit(1n, 65), MyjsTypeError)
})

// --- M2.12 padding ----------------------------------------------------------

test('M2.12: CHAR space-pads and BINARY zero-pads', () => {
  const ab = Uint8Array.from([0x61, 0x62])
  assert.equal(hex(padChar(ab, 4)), '61 62 20 20')
  assert.equal(hex(padBinary(ab, 4)), '61 62 00 00')
  assert.throws(() => padChar(ab, 1), MyjsTypeError)
  assert.throws(() => padBinary(ab, 1), MyjsTypeError)
})

test('M2.12: a multi-byte CHAR stores variable-length, with trailing spaces stripped', () => {
  // Doc 24: with utf8mb4, InnoDB stores CHAR variable-length with trailing
  // spaces removed, so it behaves like VARCHAR on disk while still comparing
  // like CHAR. `trimTrailingSpaces` is that half.
  assert.equal(hex(trimTrailingSpaces(Uint8Array.from([0x61, 0x62, 0x20, 0x20]))), '61 62')
  assert.equal(trimTrailingSpaces(Uint8Array.from([0x20, 0x20])).length, 0)
  // Interior and leading spaces survive.
  assert.equal(hex(trimTrailingSpaces(Uint8Array.from([0x20, 0x61, 0x20, 0x62]))), '20 61 20 62')
})
