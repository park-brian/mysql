// M2.8, M2.9, M2.10 — integers, floats and DECIMAL.
//
// Doc 43 §4: golden vectors from MySQL's own source comments are free,
// authoritative test cases already written out. Doc 24 quotes four `INT` lines
// and the `decimal.cc` worked example; those are the anchors here. Around them
// sits the ordering property, which doc 43 calls the single most valuable test
// we have, because it catches every sign-flip and endianness mistake.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { memcmp } from '@myjs/charsets'
import {
  INT_BYTES,
  TypeError as MyjsTypeError,
  compareFloat,
  decimalBinSize,
  decodeDecimal,
  decodeDouble,
  decodeFloat,
  decodeInt,
  encodeDecimal,
  encodeDouble,
  encodeFloat,
  encodeInt,
  signedRange,
  unsignedRange,
} from '@myjs/types'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')
const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

// --- M2.8 integers ----------------------------------------------------------

test("M2.8: doc 24's four worked INT lines reproduce byte for byte", () => {
  assert.equal(hex(encodeInt(-1n, 4, false)), '7F FF FF FF')
  assert.equal(hex(encodeInt(0n, 4, false)), '80 00 00 00')
  assert.equal(hex(encodeInt(1n, 4, false)), '80 00 00 01')
  assert.equal(hex(encodeInt(1n, 4, true)), '00 00 00 01')
})

test('M2.8: every declared width round-trips at both range ends', () => {
  for (const bytes of Object.values(INT_BYTES)) {
    for (const unsigned of [false, true]) {
      const { min, max } = unsigned ? unsignedRange(bytes) : signedRange(bytes)
      for (const v of [min, min + 1n, -1n, 0n, 1n, max - 1n, max]) {
        if (v < min || v > max) continue
        const encoded = encodeInt(v, bytes, unsigned)
        assert.equal(encoded.length, bytes, `width for ${v}`)
        assert.equal(decodeInt(encoded, unsigned), v, `${unsigned ? 'u' : ''}int${bytes} ${v}`)
      }
    }
  }
})

test('M2.8: MEDIUMINT really is three bytes, not four', () => {
  // The width that gets quietly promoted if you reach for a DataView.
  assert.equal(encodeInt(1n, INT_BYTES.MEDIUMINT, false).length, 3)
  assert.equal(signedRange(3).max, 8388607n)
  assert.equal(decodeInt(encodeInt(-8388608n, 3, false), false), -8388608n)
})

test('M2.8: BIGINT stays exact past the safe-integer boundary', () => {
  const v = 9223372036854775807n
  assert.equal(decodeInt(encodeInt(v, 8, false), false), v)
  assert.equal(decodeInt(encodeInt(-9223372036854775808n, 8, false), false), -9223372036854775808n)
  assert.equal(decodeInt(encodeInt(18446744073709551615n, 8, true), true), 18446744073709551615n)
})

test('M2.8: out of range is a typed error, not a wrapped value', () => {
  assert.throws(() => encodeInt(128n, 1, false), MyjsTypeError)
  assert.throws(() => encodeInt(-1n, 1, true), MyjsTypeError)
  assert.throws(() => encodeInt(256n, 1, true), MyjsTypeError)
})

test('M2.8: the ordering property — the test that catches every sign-flip', () => {
  // Doc 24: big-endian plus the sign flip is what makes B+tree comparison a
  // `memcmp` rather than a type dispatch. If either half is wrong, this fails.
  for (const bytes of [1, 2, 3, 4, 8]) {
    for (const unsigned of [false, true]) {
      const { min, max } = unsigned ? unsignedRange(bytes) : signedRange(bytes)
      fc.assert(
        fc.property(fc.bigInt({ min, max }), fc.bigInt({ min, max }), (a, b) => {
          const expected = a < b ? -1 : a > b ? 1 : 0
          const actual = sign(memcmp(encodeInt(a, bytes, unsigned), encodeInt(b, bytes, unsigned)))
          assert.equal(actual, expected, `${unsigned ? 'u' : ''}int${bytes}: ${a} vs ${b}`)
        }),
        { numRuns: 500 },
      )
    }
  }
})

// --- M2.9 floats ------------------------------------------------------------

test('M2.9: FLOAT and DOUBLE are little-endian, unlike everything else', () => {
  // Doc 24 Rule 2. 1.0 as a double is 3F F0 00 00 00 00 00 00 big-endian, so
  // little-endian storage puts the 3F last.
  assert.equal(hex(encodeDouble(1)), '00 00 00 00 00 00 F0 3F')
  assert.equal(hex(encodeFloat(1)), '00 00 80 3F')
})

test('M2.9: doubles round-trip exactly; floats round-trip at float precision', () => {
  fc.assert(
    fc.property(fc.double({ noNaN: true }), (v) => {
      assert.equal(decodeDouble(encodeDouble(v)), v)
    }),
    { numRuns: 2000 },
  )
  fc.assert(
    fc.property(fc.float({ noNaN: true }), (v) => {
      assert.equal(decodeFloat(encodeFloat(v)), v)
    }),
    { numRuns: 2000 },
  )
})

test('M2.9: floats are the memcmp exception, and are compared numerically', () => {
  // The whole point of the exception: -1 and 1 as little-endian doubles do not
  // compare in numeric order under memcmp, which is why `cmp_data()` switches
  // on DATA_DOUBLE. Assert the exception rather than pretending it away.
  const a = encodeDouble(-1)
  const b = encodeDouble(1)
  assert.equal(sign(compareFloat(-1, 1)), -1)
  assert.notEqual(sign(memcmp(a, b)), sign(compareFloat(-1, 1)))
})

test('M2.9: the float comparator is a coherent total order, NaN included', () => {
  fc.assert(
    fc.property(fc.double(), fc.double(), (a, b) => {
      assert.equal(sign(compareFloat(a, b)) + sign(compareFloat(b, a)), 0)
      assert.equal(compareFloat(a, a), 0)
    }),
    { numRuns: 2000 },
  )
  assert.equal(compareFloat(0, -0), 0)
  assert.equal(compareFloat(Number.NaN, Number.NaN), 0)
})

// --- M2.10 DECIMAL ----------------------------------------------------------

test("M2.10: decimal.cc's worked DECIMAL(14,4) example, and its negative", () => {
  assert.equal(decimalBinSize(14, 4), 7)
  assert.equal(hex(encodeDecimal('1234567890.1234', 14, 4)), '81 0D FB 38 D2 04 D2')
  assert.equal(hex(encodeDecimal('-1234567890.1234', 14, 4)), '7E F2 04 C7 2D FB 2D')
})

test('M2.10: decode is the exact inverse, and keeps trailing zeros to scale', () => {
  assert.equal(decodeDecimal(encodeDecimal('1234567890.1234', 14, 4), 14, 4), '1234567890.1234')
  assert.equal(decodeDecimal(encodeDecimal('-1234567890.1234', 14, 4), 14, 4), '-1234567890.1234')
  // D-15's reason for making DECIMAL a string: 1234.5 at scale 4 is '1234.5000'.
  assert.equal(decodeDecimal(encodeDecimal('1234.5', 14, 4), 14, 4), '1234.5000')
  assert.equal(decodeDecimal(encodeDecimal('0', 14, 4), 14, 4), '0.0000')
})

test("M2.10: doc 24's size formula holds across the whole shape space", () => {
  const DIG2BYTES = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4]
  for (let precision = 1; precision <= 65; precision++) {
    for (let scale = 0; scale <= Math.min(precision, 30); scale++) {
      const intg = precision - scale
      const expected =
        Math.floor(intg / 9) * 4 + (DIG2BYTES[intg % 9] as number) + Math.floor(scale / 9) * 4 + (DIG2BYTES[scale % 9] as number)
      assert.equal(decimalBinSize(precision, scale), expected, `DECIMAL(${precision},${scale})`)
      // `0` is the one value every shape can hold — `DECIMAL(1,1)` has no
      // integer digits at all, so it cannot store 1.
      assert.equal(encodeDecimal('0', precision, scale).length, expected)
    }
  }
})

test('M2.10: DECIMAL(65,30), the maximum MySQL allows, round-trips', () => {
  const v = `${'9'.repeat(35)}.${'9'.repeat(30)}`
  assert.equal(decodeDecimal(encodeDecimal(v, 65, 30), 65, 30), v)
  assert.equal(decodeDecimal(encodeDecimal(`-${v}`, 65, 30), 65, 30), `-${v}`)
})

test('M2.10: the memcmp-ordering property, which is why this format exists', () => {
  // "Stored in a form that IS memcmp-comparable" — doc 24. Two values of the
  // same (precision, scale) must order correctly as bytes, negatives first.
  const shapes: ReadonlyArray<readonly [number, number]> = [
    [14, 4],
    [10, 0],
    [20, 6],
    [65, 30],
    [9, 9],
    [1, 0],
  ]
  for (const [precision, scale] of shapes) {
    const intgDigits = precision - scale
    const digits = (n: number) => fc.stringMatching(new RegExp(`^[0-9]{0,${n}}$`))
    fc.assert(
      fc.property(
        fc.boolean(),
        digits(intgDigits),
        digits(scale),
        fc.boolean(),
        digits(intgDigits),
        digits(scale),
        (negA, ia, fa, negB, ib, fb) => {
          const textA = `${negA ? '-' : ''}${ia === '' ? '0' : ia}${scale > 0 ? `.${fa}` : ''}`
          const textB = `${negB ? '-' : ''}${ib === '' ? '0' : ib}${scale > 0 ? `.${fb}` : ''}`
          const a = encodeDecimal(textA, precision, scale)
          const b = encodeDecimal(textB, precision, scale)
          // Compare the canonical decoded forms, so '-0' and '0' agree.
          const da = decodeDecimal(a, precision, scale)
          const db = decodeDecimal(b, precision, scale)
          const expected = sign(Number(da) < Number(db) ? -1 : Number(da) > Number(db) ? 1 : 0)
          assert.equal(sign(memcmp(a, b)), expected, `DECIMAL(${precision},${scale}): ${da} vs ${db}`)
        },
      ),
      { numRuns: 400 },
    )
  }
})

test('M2.10: MySQL has no negative zero in DECIMAL', () => {
  // Otherwise two values that compare equal would have different bytes, and a
  // unique index would happily hold both `0.00` and `-0.00`.
  assert.deepEqual(encodeDecimal('-0.0000', 14, 4), encodeDecimal('0.0000', 14, 4))
  assert.equal(decodeDecimal(encodeDecimal('-0.0000', 14, 4), 14, 4), '0.0000')
  assert.equal(decodeDecimal(encodeDecimal('-0', 10, 0), 10, 0), '0')
})

test('M2.10: a bad shape or a non-numeric literal is a typed error', () => {
  assert.throws(() => encodeDecimal('1', 0, 0), MyjsTypeError)
  assert.throws(() => encodeDecimal('1', 66, 0), MyjsTypeError)
  assert.throws(() => encodeDecimal('1', 10, 31), MyjsTypeError)
  assert.throws(() => encodeDecimal('1', 4, 5), MyjsTypeError)
  assert.throws(() => encodeDecimal('not a number', 10, 2), MyjsTypeError)
  assert.throws(() => encodeDecimal('12345', 4, 0), MyjsTypeError)
  // DECIMAL(1,1) holds 0.0 to 0.9 — there is no room for an integer digit.
  assert.throws(() => encodeDecimal('1', 1, 1), MyjsTypeError)
  assert.throws(() => decodeDecimal(new Uint8Array(2), 14, 4), MyjsTypeError)
})
