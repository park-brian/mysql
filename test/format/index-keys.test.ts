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
import { collation, encodeCharset, loadCollation, memcmp } from '@myjs/charsets'
import {
  TypeError as MyjsTypeError,
  compareFloat,
  declaredKeyWidth,
  encodeDouble,
  encodeFloat,
  encodeDateField,
  encodeDatetime2,
  encodeDecimal,
  encodeInt,
  encodeKey,
  encodeKeyPart,
  keyPartLength,
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

// D-35. The ordering property, stated against the *collation's* comparator
// rather than against its own sort key — which is what the previous version of
// this test did, and why it passed while the encoder was wrong.
//
// Run it for a PAD SPACE binary collation, a PAD SPACE weight collation and a
// NO PAD one, over strings that deliberately contain trailing spaces and bytes
// below 0x20: `'a'` vs `'a\x01'` is the pair that inverts if the padding is
// missing, and it is not a pair `fc.string()` reaches often.
const keyed = (id: number, width: number, charset = 'utf8mb4'): KeyPart => ({
  kind: 'text',
  nullable: false,
  collationId: id,
  width,
})

const awkward = () =>
  fc.oneof(
    fc.constantFrom('', 'a', 'a ', 'a  ', '\u0001', 'a\u0001', 'a\u0001 ', 'ab', 'A', '\u00e4', 'z'),
    fc.string({ maxLength: 6 }),
  )

for (const [id, name] of [
  [46, 'utf8mb4_bin (PAD SPACE, memcmp)'],
  [45, 'utf8mb4_general_ci (PAD SPACE, weights)'],
  [63, 'binary (NO PAD)'],
] as const) {
  test(`M2.14/D-35: key order matches ${name}`, () => {
    const c = collation(id)
    const part = keyed(id, declaredKeyWidth(id, 10))
    fc.assert(
      fc.property(awkward(), awkward(), (a, b) => {
        const ba = encodeCharset(a, 'utf8mb4')
        const bb = encodeCharset(b, 'utf8mb4')
        assert.equal(
          sign(memcmp(encodeKeyPart(ba, part), encodeKeyPart(bb, part))),
          sign(c.compare(ba, bb)),
          `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
        )
      }),
      { numRuns: 3000 },
    )
  })
}

test('M2.14/D-35: key order matches utf8mb4_0900_ai_ci (NO PAD, expanding)', async () => {
  // The case D-35 was written for and has never had until now. `binary` above
  // is NO PAD but its sort key is the value, so a key part could not be longer
  // than the value it came from. `utf8mb4_0900_ai_ci` breaks that: one
  // character can weigh several collation elements, so the sort key expands —
  // sharp s alone becomes four bytes — and the declared width has to absorb it.
  //
  // It is also the collation this project actually defaults to (D-10), so if
  // the key encoder is wrong for anything, being wrong for this one is worst.
  const c = await loadCollation(255)
  const part = keyed(255, 160)
  fc.assert(
    fc.property(awkward(), awkward(), (a, b) => {
      const ba = encodeCharset(a, 'utf8mb4')
      const bb = encodeCharset(b, 'utf8mb4')
      assert.equal(
        sign(memcmp(encodeKeyPart(ba, part), encodeKeyPart(bb, part))),
        sign(c.compare(ba, bb)),
        `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
      )
    }),
    { numRuns: 3000 },
  )
})

test('M2.14/D-35: an expanding NO PAD key distinguishes values that pad alike', async () => {
  const c = await loadCollation(255)
  const part = keyed(255, 32)
  const key = (s: string) => encodeKeyPart(encodeCharset(s, 'utf8mb4'), part)
  // NO PAD, so a trailing space is data: the keys differ and the shorter sorts
  // first. Under `utf8mb4_general_ci` the same two values key identically,
  // which is the upgrade surprise doc 29 warns about, made concrete.
  assert.notDeepEqual(key('a'), key('a '))
  assert.equal(sign(memcmp(key('a'), key('a '))), -1)
  const general = keyed(45, 32)
  assert.deepEqual(
    encodeKeyPart(encodeCharset('a', 'utf8mb4'), general),
    encodeKeyPart(encodeCharset('a ', 'utf8mb4'), general),
  )
  // And the expansion is visible in the key: sharp s keys exactly as 'ss'.
  assert.deepEqual(key('\u00df'), key('ss'))
  assert.equal(sign(c.compare(encodeCharset('\u00df', 'utf8mb4'), encodeCharset('ss', 'utf8mb4'))), 0)
})

test('M2.14/D-35 ⊘ D-55: an expanding NO PAD key needs no width, and ignores one too small', async () => {
  // D-35 refused this: 'ß' weighs four bytes under 0900, more than a 2-byte
  // width. That made `VARCHAR(6) PRIMARY KEY` refuse 'Straße' (a 14-byte sort
  // key against the 12 that six characters declare) under the default
  // collation, a value MySQL stores. A NO PAD key is variable-length now, so
  // the width is a budget, never a refusal.
  const c = await loadCollation(255)
  const narrow = keyed(255, 2)
  const none: KeyPart = { kind: 'text', nullable: false, collationId: 255 }
  for (const [a, b] of [['Straße', 'Strasse'], ['Straße', 'Strasse '], ['\ufdfa', '\ufdfb'], ['ææ', 'ae']]) {
    const [ba, bb] = [encodeCharset(a as string, 'utf8mb4'), encodeCharset(b as string, 'utf8mb4')]
    for (const part of [narrow, none]) assert.equal(sign(memcmp(encodeKeyPart(ba, part), encodeKeyPart(bb, part))), sign(c.compare(ba, bb)), `${a} vs ${b}`)
  }
})

test('D-55: NO PAD parts concatenate unambiguously and reverse exactly under DESC', async () => {
  // Two variable-length parts side by side: 'ab' + 'c' must not key like
  // 'a' + 'bc', and a descending part must order exactly backwards — both
  // follow from the encoding being prefix-free, which this checks by property.
  const c = await loadCollation(255)
  const part = (descending: boolean): KeyPart => ({ kind: 'text', nullable: true, collationId: 255, descending })
  const value = () => fc.option(awkward(), { nil: null })
  const cmp = (x: string | null, y: string | null): number =>
    x === null || y === null ? (x === null ? (y === null ? 0 : -1) : 1) : sign(c.compare(encodeCharset(x, 'utf8mb4'), encodeCharset(y, 'utf8mb4')))
  const bytes = (x: string | null) => (x === null ? null : encodeCharset(x, 'utf8mb4'))
  fc.assert(
    fc.property(value(), value(), value(), value(), fc.boolean(), (a1, a2, b1, b2, desc) => {
      const parts = [part(desc), part(false)]
      const ka = encodeKey([bytes(a1), bytes(a2)], parts)
      const kb = encodeKey([bytes(b1), bytes(b2)], parts)
      const expected = (desc ? -cmp(a1, b1) : cmp(a1, b1)) || cmp(a2, b2)
      assert.equal(sign(memcmp(ka, kb)), expected, JSON.stringify([a1, a2, b1, b2, desc]))
    }),
    { numRuns: 3000 },
  )
})

test('D-55: a CHAR part keys without its trailing spaces, under NO PAD too', async () => {
  await loadCollation(255)
  const char: KeyPart = { kind: 'text', nullable: false, collationId: 255, trimSpaces: true }
  const key = (s: string) => encodeKeyPart(encodeCharset(s, 'utf8mb4'), char)
  assert.deepEqual(key('a   '), key('a'))
  assert.equal(sign(memcmp(key('a\t'), key('a  '))), 1)
})

test('M2.14/D-35: the pair that inverted without padding', () => {
  // Under PAD SPACE the shorter value is extended with spaces, so 'a' is
  // *greater* than 'a\x01' — 0x20 > 0x01. Raw `memcmp` of the values says the
  // opposite. This is the concrete case the property above generalises.
  const c = collation(46)
  const part = keyed(46, declaredKeyWidth(46, 4))
  const a = encodeCharset('a', 'utf8mb4')
  const b = encodeCharset('a\u0001', 'utf8mb4')
  assert.equal(sign(c.compare(a, b)), 1)
  assert.equal(sign(memcmp(a, b)), -1, 'the raw values order the other way — that was the bug')
  assert.equal(sign(memcmp(encodeKeyPart(a, part), encodeKeyPart(b, part))), 1)
})

test('M2.14/D-35: PAD SPACE gives equal values identical key bytes', () => {
  const part = keyed(46, declaredKeyWidth(46, 4))
  assert.deepEqual(
    encodeKeyPart(encodeCharset('a', 'utf8mb4'), part),
    encodeKeyPart(encodeCharset('a   ', 'utf8mb4'), part),
  )
})

test('M2.14/D-35: NO PAD keeps a trailing NUL distinguishable', () => {
  // NUL padding on its own would make these the same bytes, and a unique index
  // would then reject a row MySQL accepts. The length suffix is what prevents
  // it — and it must be a suffix, or 'b' would sort before 'aa'.
  const part = keyed(63, 8)
  const a = encodeKeyPart(Uint8Array.of(0x61), part)
  const b = encodeKeyPart(Uint8Array.of(0x61, 0x00), part)
  assert.notDeepEqual(a, b)
  assert.equal(sign(memcmp(a, b)), -1)
  assert.equal(sign(memcmp(encodeKeyPart(Uint8Array.of(0x62), part), encodeKeyPart(Uint8Array.of(0x61, 0x61), part))), 1)
})

test('M2.14/D-35: a PAD SPACE text part without a width is refused', () => {
  assert.throws(() => encodeKeyPart(Uint8Array.of(0x61), { kind: 'text', nullable: false, collationId: 46 }), MyjsTypeError)
})

test('M2.14/D-35: a value wider than its declared width is refused', () => {
  assert.throws(() => encodeKeyPart(encodeCharset('abcdef', 'utf8mb4'), keyed(46, declaredKeyWidth(46, 1))), MyjsTypeError)
})

test('M2.14/D-35: a variable-length part before another part is refused', () => {
  assert.throws(
    () =>
      encodeKey(
        [Uint8Array.of(0x61), Uint8Array.of(0x62)],
        [notNull({ prefix: 3 }), notNull()],
      ),
    MyjsTypeError,
  )
})

test('M2.14: a text prefix counts characters, a byte prefix counts bytes', () => {
  // Doc 29's reason `KEY (col(255))` budgets 1020 bytes on utf8mb4: the
  // declared prefix is in characters, and truncating the *bytes* at 255 would
  // cut a multi-byte character in half. `utf8mb4_bin`'s sort key is the value,
  // so the four bytes of 'hél' are visible in the key before padding.
  const text: KeyPart = { kind: 'text', nullable: false, collationId: 46, prefix: 3, width: declaredKeyWidth(46, 3) }
  const value = encodeCharset('h\u00e9llo', 'utf8mb4') // h(1) é(2) l(1) l(1) o(1)
  // Three *characters* of key, nine bytes: `utf8mb4_bin` writes each code
  // point as three big-endian bytes (M2.21), so `é` is `00 00 E9` rather than
  // its two UTF-8 bytes. Truncating the bytes at three would have produced
  // `68 C3 A9` — half of a character — which is the mistake under test.
  assert.equal(hex(encodeKeyPart(value, text)), '00 00 68 00 00 E9 00 00 6C')
  const bytes: KeyPart = { kind: 'bytes', nullable: false, prefix: 3 }
  assert.equal(encodeKeyPart(value, bytes).length, 3)
})

test('M2.14: a prefix never splits a multi-byte character', () => {
  // Stated as "the key is the first two *characters*, encoded" rather than as
  // "the key does not decode to a replacement character" — the latter is what
  // this test used to say, and it is not the property: a value that already
  // contains U+FFFD satisfies the encoder and fails the assertion. Under
  // `utf8mb4_bin` the sort key is one three-byte weight per code point, so the
  // comparison can still be exact — the expected key is the first two
  // characters put through the same collation.
  const part: KeyPart = { kind: 'text', nullable: false, collationId: 46, prefix: 2, width: declaredKeyWidth(46, 2) }
  const bin = collation(46)
  fc.assert(
    fc.property(fc.string({ unit: 'grapheme' }), (s) => {
      const expected = bin.sortKey(encodeCharset([...s].slice(0, 2).join(''), 'utf8mb4'))
      const key = encodeKeyPart(encodeCharset(s, 'utf8mb4'), part)
      assert.deepEqual(key.subarray(0, expected.length), expected, JSON.stringify(s))
      for (let i = expected.length; i < key.length; i++) {
        // Pad is whole `00 00 20` characters, in phase with the key's end —
        // which is the invariant `encodeKeyPart` now refuses a width for.
        assert.equal(key[i], bin.padUnit[(i - expected.length) % bin.padUnit.length], 'past the prefix is pad')
      }
    }),
    { numRuns: 4000 },
  )
})

test('M4.23: a FLOAT or DOUBLE key part orders as the numbers do — M2.14 refused it, before there was a transform', () => {
  // Doc 24 Rule 2: the stored bytes are little-endian IEEE, whose memcmp order
  // is nonsense for negatives. M2.14 refused such a part rather than build an
  // index in the wrong order; the order-preserving map replaces the refusal.
  const finite = fc.double({ noNaN: true, noDefaultInfinity: false })
  const cmp = (a: Uint8Array, b: Uint8Array) => sign(memcmp(a, b))
  fc.assert(
    fc.property(finite, finite, (a, b) => {
      const part = notNull({ kind: 'float' })
      assert.equal(cmp(encodeKeyPart(encodeDouble(a), part), encodeKeyPart(encodeDouble(b), part)), sign(compareFloat(a, b)), `${a} vs ${b}`)
      const fa = Math.fround(a)
      const fb = Math.fround(b)
      assert.equal(cmp(encodeKeyPart(encodeFloat(fa), part), encodeKeyPart(encodeFloat(fb), part)), sign(compareFloat(fa, fb)), `float ${fa} vs ${fb}`)
    }),
    { numRuns: 4000 },
  )
  const part = notNull({ kind: 'float' })
  assert.deepEqual(encodeKeyPart(encodeDouble(-0), part), encodeKeyPart(encodeDouble(0), part), '−0 is 0')
  assert.throws(() => encodeKeyPart(encodeDouble(Number.NaN), part), MyjsTypeError)
})

test('M4.23: a DESC part reverses the order of its ascending bytes, NULL last', () => {
  fc.assert(
    fc.property(fc.option(fc.uint8Array({ maxLength: 12 }), { nil: null }), fc.option(fc.uint8Array({ maxLength: 12 }), { nil: null }), (a, b) => {
      const asc = nullable({ prefix: 12, width: 12 })
      const desc = nullable({ prefix: 12, width: 12, descending: true })
      assert.equal(sign(memcmp(encodeKeyPart(a, desc), encodeKeyPart(b, desc))), -sign(memcmp(encodeKeyPart(a, asc), encodeKeyPart(b, asc))) || 0)
    }),
    { numRuns: 4000 },
  )
  const desc = nullable({ prefix: 12, width: 12, descending: true })
  assert.ok(memcmp(encodeKeyPart(new Uint8Array(0), desc), encodeKeyPart(null, desc)) < 0, 'NULL sorts last in a DESC part')
  assert.throws(() => encodeKeyPart(new Uint8Array(3), notNull({ prefix: 4, descending: true })), MyjsTypeError, 'complementing a variable-length key does not reverse it')
})

test('M2.14: a text part without a collation is a typed error, not a guess', () => {
  assert.throws(() => encodeKeyPart(new Uint8Array(1), { kind: 'text', nullable: false }), MyjsTypeError)
})

test('M2.14: a key with the wrong number of values is refused', () => {
  assert.throws(() => encodeKey([new Uint8Array(1)], [notNull(), notNull()]), MyjsTypeError)
})

test('D-55: the escape keeps NUL-bearing values apart in a two-part key', () => {
  // `binary` is NO PAD with the value as its sort key, so this reaches 0x00
  // bytes the string properties above never generate: without the escape,
  // 'a\0' + 'b' and 'a' + '\0b' would share a prefix the terminator cannot
  // separate.
  const part = (descending: boolean): KeyPart => ({ kind: 'text', nullable: false, collationId: 63, descending })
  const value = () => fc.uint8Array({ maxLength: 4, max: 2 })
  fc.assert(
    fc.property(value(), value(), value(), value(), fc.boolean(), (a1, a2, b1, b2, desc) => {
      const parts = [part(desc), part(false)]
      const expected = (desc ? -sign(memcmp(a1, b1)) : sign(memcmp(a1, b1))) || sign(memcmp(a2, b2))
      assert.equal(sign(memcmp(encodeKey([a1, a2], parts), encodeKey([b1, b2], parts))), expected)
    }),
    { numRuns: 5000 },
  )
})

test('keyPartLength splits every concatenation encodeKey makes', async () => {
  await loadCollation(255)
  const parts: Array<[KeyPart, number | undefined]> = [
    [{ kind: 'text', nullable: true, collationId: 255 }, undefined],
    [{ kind: 'text', nullable: false, collationId: 46, width: declaredKeyWidth(46, 4), descending: true }, undefined],
    [{ kind: 'bytes', nullable: true, width: 3, descending: true }, undefined],
    [{ kind: 'bytes', nullable: false }, 4],
    [{ kind: 'float', nullable: true }, 8],
    [{ kind: 'text', nullable: false, collationId: 63, descending: true }, undefined],
  ]
  const text = () => fc.option(fc.string({ maxLength: 4 }).map((s) => encodeCharset(s, 'utf8mb4')), { nil: null })
  fc.assert(
    fc.property(text(), fc.string({ maxLength: 4 }), fc.option(fc.uint8Array({ maxLength: 3 }), { nil: null }), fc.uint8Array({ minLength: 4, maxLength: 4 }), fc.option(fc.double({ noNaN: true }), { nil: null }), fc.uint8Array({ maxLength: 4, max: 1 }), (a, b, c, d, e, f) => {
      const values = [a, encodeCharset(b, 'utf8mb4'), c, d, e === null ? null : encodeDouble(e), f]
      const key = encodeKey(values, parts.map(([p]) => p))
      let at = 0
      for (const [i, [p, fixed]] of parts.entries()) {
        const n = keyPartLength(key, at, p, fixed)
        assert.deepEqual(key.subarray(at, at + n), encodeKeyPart(values[i] ?? null, p))
        at += n
      }
      assert.equal(at, key.length)
      for (let cut = 0; cut < key.length; cut++) {
        assert.throws(() => {
          let at = 0
          for (const [p, fixed] of parts) at += keyPartLength(key.subarray(0, cut), at, p, fixed)
        }, MyjsTypeError)
      }
    }),
    { numRuns: 500 },
  )
})
