// M2.5, M2.6, M2.19 — the weight-table collations.
//
// Doc 29 names two quirks of the simple collations and this file pins both,
// because they are the difference between a real weight table and a
// `toLowerCase` that looks like one: `'ä' = 'a'` (a fold onto a *different*
// letter) and `'ß' ≠ 'ss'` (a fold onto a *single* letter, never an expansion).
//
// It also answers Q-04 with a number rather than an adjective, which is M2.19's
// acceptance assertion.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import fc from 'fast-check'
import {
  CharsetError,
  PACKED_UNICASE_WEIGHTS,
  WEIGHT_TABLE_SOURCE_SHA256,
  COLLATION_TABLE_SOURCE_SHA256,
  collation,
  encodeCharset,
  hasCollation,
  isWeightedCollation,
  memcmp,
  requireCollationInfo,
  weightedCollationIds,
} from '@myjs/charsets'

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)
const u8 = (s: string) => encodeCharset(s, 'utf8mb4')
const l1 = (s: string) => encodeCharset(s, 'latin1')
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

test('M2.6: utf8mb4_general_ci folds a-umlaut onto a, and is case-insensitive', () => {
  const c = collation(45)
  assert.equal(c.compare(u8('ä'), u8('a')), 0)
  assert.equal(c.compare(u8('Ä'), u8('a')), 0)
  assert.equal(c.compare(u8('A'), u8('a')), 0)
  assert.equal(c.compare(u8('ö'), u8('o')), 0)
  // The weight of 'ä' is literally the weight of 'A' — U+00E4 -> 0x0041.
  assert.equal(hex(c.sortKey(u8('ä'))), '00 41')
})

test('M2.6: utf8mb4_general_ci does not expand sharp s', () => {
  // Doc 29's second quirk. A simple collation has one weight per character, so
  // 'ß' folds onto a *single* 's' and can never equal 'ss'. Asserting both
  // halves is what distinguishes "no expansions" from "no folding".
  const c = collation(45)
  assert.equal(c.compare(u8('ß'), u8('s')), 0)
  assert.notEqual(c.compare(u8('ß'), u8('ss')), 0)
  assert.equal(c.sortKey(u8('ß')).length, 2)
})

test('M2.6: utf8mb4_general_ci is PAD SPACE, so a equals a-with-trailing-space', () => {
  const c = collation(45)
  assert.equal(c.compare(u8('a'), u8('a ')), 0)
  assert.equal(c.compare(u8('a'), u8('a    ')), 0)
  // And the pair raw byte order gets *backwards*: under PAD SPACE the shorter
  // value is extended with spaces, and 0x20 > 0x01.
  assert.equal(sign(c.compare(u8('a'), u8('a\u0001'))), 1)
  assert.equal(sign(memcmp(u8('a'), u8('a\u0001'))), -1)
})

test('M2.6: latin1_swedish_ci sorts the umlauts after z, which is the point of it', () => {
  const c = collation(8)
  for (const ch of ['å', 'ä', 'ö']) {
    assert.equal(sign(c.compare(l1(ch), l1('z'))), 1, `${ch} must sort after z`)
  }
  assert.equal(sign(c.compare(l1('ä'), l1('a'))), 1, 'and not fold onto a, unlike general_ci')
  assert.equal(c.compare(l1('A'), l1('a')), 0)
  // One byte of weight per byte of value, unlike the Unicode table's two.
  assert.equal(c.sortKey(l1('abc')).length, 3)
})

test('M2.6: the ordering property holds for every 8-bit weighted collation', () => {
  // Doc 43 §4: `sign(compare(a, b)) === sign(memcmp(sortKey(a), sortKey(b)))`.
  // For a PAD SPACE collation that only holds once both keys are brought to a
  // common width, which is D-35's job — so it is asserted here on values of
  // *equal length*, where padding cannot come into play, and the padded case is
  // covered by `index-keys.test.ts`.
  const equalLength = () => fc.uint8Array({ minLength: 4, maxLength: 4 })
  for (const id of weightedCollationIds()) {
    const c = collation(id)
    if (c.mbmaxlen > 1) continue
    fc.assert(
      fc.property(equalLength(), equalLength(), (a, b) => {
        assert.equal(sign(c.compare(a, b)), sign(memcmp(c.sortKey(a), c.sortKey(b))), c.name)
      }),
      { numRuns: 200 },
    )
  }
})

test('M2.6: the ordering property holds for utf8mb4_general_ci over real text', () => {
  const c = collation(45)
  fc.assert(
    fc.property(fc.string({ minLength: 3, maxLength: 3 }), fc.string({ minLength: 3, maxLength: 3 }), (a, b) => {
      const ba = u8(a)
      const bb = u8(b)
      // Only where the *weight strings* are the same length; otherwise PAD
      // SPACE is in play and the padded form is what must agree (D-35).
      if (c.sortKey(ba).length !== c.sortKey(bb).length) return
      assert.equal(sign(c.compare(ba, bb)), sign(memcmp(c.sortKey(ba), c.sortKey(bb))))
    }),
    { numRuns: 2000 },
  )
})

test('M2.6: a supplementary character weighs the replacement weight', () => {
  // `my_unicase_default`'s maxchar is 0xFFFF, so everything above the BMP
  // collapses to one weight — which is why the table is kilobytes and not a
  // megabyte, and also why general_ci cannot order emoji.
  const c = collation(45)
  assert.equal(hex(c.sortKey(u8('\u{1F600}'))), 'FF FD')
  assert.equal(c.compare(u8('\u{1F600}'), u8('\u{1F601}')), 0)
})

test('M2.19: Q-04 — the packed general_ci table is a few KB, not a megabyte', () => {
  // The acceptance assertion, as a number. MySQL's source weights for this
  // collation are ~1.1 MB; the packed form here is the same data with its 245
  // identity pages elided and delta-plus-run inside the 11 that remain.
  const raw = Buffer.byteLength(PACKED_UNICASE_WEIGHTS, 'utf8')
  const gzip = gzipSync(Buffer.from(PACKED_UNICASE_WEIGHTS, 'utf8'), { level: 9 }).length
  assert.ok(raw < 20 * 1024, `packed general_ci weights are ${raw} bytes raw, budget 20480`)
  assert.ok(gzip < 10 * 1024, `packed general_ci weights are ${gzip} bytes gzipped, budget 10240`)
  assert.equal(PACKED_UNICASE_WEIGHTS.split('\n').length, 11, '11 non-null pages of 256')
})

test('M2.5: the weight tables carry the same source hash as the registry', () => {
  // One parse, one pin: if the two ever differ the generator emitted them from
  // different fetches, and the id -> table mapping cannot be trusted.
  assert.equal(WEIGHT_TABLE_SOURCE_SHA256, COLLATION_TABLE_SOURCE_SHA256)
})

test('M2.6: every weighted id resolves, and its pad unit is the weight of a space', () => {
  for (const id of weightedCollationIds()) {
    const c = collation(id)
    const info = requireCollationInfo(id)
    assert.equal(c.id, info.id)
    assert.equal(c.padUnit.length, info.mbmaxlen > 1 ? 2 : 1, info.name)
    // The weight of a space, not the byte 0x20 — for a collation that reorders
    // ASCII those are not the same thing.
    assert.deepEqual(c.padUnit, c.sortKey(info.mbmaxlen > 1 ? u8(' ') : Uint8Array.of(0x20)))
  }
})

test('M2.2: the memcmp set is now every single-byte *_bin collation', () => {
  // Widened in M2.6: ordering under a binary collation is byte order whatever
  // the charset, so refusing `latin2_bin` while accepting `latin1_bin` was an
  // accident of the hardcoded list.
  assert.ok(hasCollation(77), 'latin2_bin')
  assert.ok(hasCollation(63), 'binary')
  assert.ok(hasCollation(46), 'utf8mb4_bin')
  // `ucs2_bin` is not: its pad character is two bytes, which `comparePadded`
  // would need as its unit.
  assert.equal(requireCollationInfo(90).name, 'ucs2_bin')
  assert.equal(hasCollation(90), false)
  assert.throws(() => collation(90), CharsetError)
})

test('M2.6: the weight tables do not serve the UCA default', () => {
  // `utf8mb4_0900_ai_ci` is UCA (M2.7), and its tables are not these. Nothing
  // in this file loads them, so it is still not resident here — and a silent
  // fallback to byte order would build an index in the wrong order and surface
  // as wrong results much later, so the synchronous path refuses to run.
  assert.equal(isWeightedCollation(255), false)
  assert.equal(hasCollation(255), false)
  assert.throws(() => collation(255), CharsetError)
})
