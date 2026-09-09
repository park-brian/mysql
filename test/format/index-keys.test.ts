// M2.14 — index key encoding.
//
// Doc 43 §4 names the ordering property "the single most valuable property
// test we have", and this is where it applies to whole keys rather than to one
// column at a time: `sign(compare(a, b)) === sign(memcmp(encodeKey(a), encodeKey(b)))`
// for every non-float type. If it holds, the B+tree's descent is a byte
// comparison and M4 can be built on that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { collation, encodeCharset, memcmp } from '@myjs/charsets'
import {
  TypeError as MyjsTypeError,
  encodeDateField,
  encodeDatetime2,
  encodeDecimal,
  encodeInt,
  encodeKey,
  encodeKeyPart,
  dateFieldToStorage,
  type KeyPart,
} from '@myjs/types'

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

const notNull = (over: Partial<KeyPart> = {}): KeyPart => ({ kind: 'bytes', nullable: false, ...over })
const nullable = (over: Partial<KeyPart> = {}): KeyPart => ({ kind: 'bytes', nullable: true, ...over })

test('M2.14: a NOT NULL key part is exactly its storage bytes', () => {
  const part = notNull()
  assert.equal(hex(encodeKeyPart(encodeInt(1n, 4, false), part)), '80 00 00 01')
})

test('M2.14: a nullable part carries a flag byte, and NULL sorts first', () => {
  // MySQL puts NULL first in an ascending index, so the flag must be 0 for
  // NULL and 1 for present — the other way round would invert it.
  const part = nullable()
  const isNull = encodeKeyPart(null, part)
  const present = encodeKeyPart(encodeInt(-2147483648n, 4, false), part)
  assert.equal(hex(isNull), '00')
  assert.equal(hex(present), '01 00 00 00 00')
  assert.equal(sign(memcmp(isNull, present)), -1)
})

test('M2.14: a null value on a NOT NULL part is a typed error', () => {
  assert.throws(() => encodeKeyPart(null, notNull()), MyjsTypeError)
})

test('M2.14: the ordering property holds for a multi-column integer key', () => {
  const parts = [notNull(), nullable()]
  const value = fc.option(fc.bigInt({ min: -2147483648n, max: 2147483647n }), { nil: null })
  fc.assert(
    fc.property(fc.bigInt({ min: -2147483648n, max: 2147483647n }), value, fc.bigInt({ min: -2147483648n, max: 2147483647n }), value,
      (a0, a1, b0, b1) => {
        const enc = (x: bigint, y: bigint | null) => encodeKey([encodeInt(x, 4, false), y === null ? null : encodeInt(y, 4, false)], parts)
        // Expected order: first column, then NULL-first on the second.
        let expected = sign(a0 < b0 ? -1 : a0 > b0 ? 1 : 0)
        if (expected === 0) {
          if (a1 === null && b1 === null) expected = 0
          else if (a1 === null) expected = -1
          else if (b1 === null) expected = 1
          else expected = sign(a1 < b1 ? -1 : a1 > b1 ? 1 : 0)
        }
        assert.equal(sign(memcmp(enc(a0, a1), enc(b0, b1))), expected)
      }),
    { numRuns: 3000 },
  )
})

test('M2.14: DECIMAL, DATETIME and DATE all keep their ordering inside a key', () => {
  const parts = [notNull()]
  const order = <T>(vs: readonly T[], enc: (v: T) => Uint8Array, cmp: (a: T, b: T) => number) => {
    for (const a of vs) {
      for (const b of vs) {
        assert.equal(sign(memcmp(encodeKey([enc(a)], parts), encodeKey([enc(b)], parts))), sign(cmp(a, b)), `${String(a)} vs ${String(b)}`)
      }
    }
  }
  order(
    ['-9999.9999', '-1.0000', '0.0000', '0.0001', '1234.5000'],
    (v) => encodeDecimal(v, 14, 4),
    (a, b) => Number(a) - Number(b),
  )
  const dts = [
    { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 },
    { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, microsecond: 0 },
    { year: 2010, month: 10, day: 17, hour: 19, minute: 27, second: 30, microsecond: 0 },
    { year: 9999, month: 12, day: 31, hour: 23, minute: 59, second: 59, microsecond: 0 },
  ]
  order(dts, (v) => encodeDatetime2(v, 0), (a, b) => dts.indexOf(a) - dts.indexOf(b))
  const dates: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0], [1999, 12, 31], [2000, 1, 1], [2000, 1, 2], [9999, 12, 31],
  ]
  order(dates, ([y, m, d]) => dateFieldToStorage(encodeDateField(y, m, d)), (a, b) => dates.indexOf(a) - dates.indexOf(b))
})

test('M2.14: a character column compares on the sort key, not on the value', () => {
  // The whole point of the `'text'` kind. `utf8mb4_bin`'s sort key happens to
  // be the value, so assert that the sort key is what gets called rather than
  // that the bytes differ — a collation with real weights (M2.7) will make the
  // distinction visible, and this test will keep holding.
  const part: KeyPart = { kind: 'text', nullable: false, collationId: 46 }
  const c = collation(46)
  const value = encodeCharset('café', 'utf8mb4')
  assert.deepEqual(encodeKeyPart(value, part), c.sortKey(value))
  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => {
      const ba = encodeCharset(a, 'utf8mb4')
      const bb = encodeCharset(b, 'utf8mb4')
      const ka = encodeKeyPart(ba, part)
      const kb = encodeKeyPart(bb, part)
      assert.equal(sign(memcmp(ka, kb)), sign(memcmp(c.sortKey(ba), c.sortKey(bb))))
    }),
    { numRuns: 1000 },
  )
})

test('M2.14: a text prefix counts characters, a byte prefix counts bytes', () => {
  // Doc 29's reason `KEY (col(255))` budgets 1020 bytes on utf8mb4: the
  // declared prefix is in characters, and truncating the *bytes* at 255 would
  // cut a multi-byte character in half.
  const text: KeyPart = { kind: 'text', nullable: false, collationId: 46, prefix: 3 }
  const value = encodeCharset('héllo', 'utf8mb4') // h(1) é(2) l(1) l(1) o(1)
  assert.equal(encodeKeyPart(value, text).length, 4) // 'hél' is four bytes
  const bytes: KeyPart = { kind: 'bytes', nullable: false, prefix: 3 }
  assert.equal(encodeKeyPart(value, bytes).length, 3)
})

test('M2.14: a prefix never splits a multi-byte character', () => {
  const part: KeyPart = { kind: 'text', nullable: false, collationId: 46, prefix: 2 }
  fc.assert(
    fc.property(fc.string({ unit: 'grapheme' }), (s) => {
      const encoded = encodeKeyPart(encodeCharset(s, 'utf8mb4'), part)
      // Decoding must not produce a replacement character from a split.
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(encoded)
      assert.ok(!decoded.includes('�'), `split a character in ${JSON.stringify(s)}`)
    }),
    { numRuns: 2000 },
  )
})

test('M2.14: a FLOAT key part refuses rather than producing a wrong order', () => {
  // Doc 24 Rule 2. Silently encoding a little-endian double into a key would
  // build an index whose order is nonsense for negatives, and nothing would
  // notice until a range scan returned the wrong rows.
  assert.throws(() => encodeKeyPart(new Uint8Array(8), { kind: 'float', nullable: false }), MyjsTypeError)
})

test('M2.14: a text part without a collation is a typed error, not a guess', () => {
  assert.throws(() => encodeKeyPart(new Uint8Array(1), { kind: 'text', nullable: false }), MyjsTypeError)
})

test('M2.14: a key with the wrong number of values is refused', () => {
  assert.throws(() => encodeKey([new Uint8Array(1)], [notNull(), notNull()]), MyjsTypeError)
})
