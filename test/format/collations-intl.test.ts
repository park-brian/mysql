// M2.23 / D-23 — the `Intl.Collator` fallback.
//
// The acceptance assertion is a negative one: "index bytes are never
// runtime-dependent, because the path that would produce them refuses to run".
// So most of this file is about what the fallback *will not* do — it is off
// until asked for, it never produces a sort key, and it never quietly
// displaces a collation we actually have tables for.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CharsetError,
  allCollations,
  canDecode,
  collation,
  collationAvailability,
  encodeCharset,
  intlCollationFor,
  isIntlFallbackEnabled,
  requireCollationInfo,
  setIntlFallbackEnabled,
} from '@myjs/charsets'

// `utf8mb4_0900_as_cs`: UCA, accent- and case-sensitive, and deliberately not
// served by our level-1 tables — doc 29 puts it in Layer 3. So it is exactly
// the shape the fallback exists for: a real collation, in a charset we can
// decode, with no weights of ours.
const AS_CS = 278
const GENERAL_CI = 45
const u8 = (s: string) => encodeCharset(s, 'utf8mb4')
const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

test('M2.23: the fallback is off, and a collation with no tables still refuses', () => {
  assert.equal(isIntlFallbackEnabled(), false, 'a silent fallback is the failure mode this prevents')
  assert.equal(requireCollationInfo(AS_CS).name, 'utf8mb4_0900_as_cs')
  assert.equal(collationAvailability(AS_CS), 'unsupported')
  assert.throws(
    () => collation(AS_CS),
    (err: unknown) => {
      assert.ok(err instanceof CharsetError)
      assert.equal((err as CharsetError).code, 'ER_COLLATION_NOT_IMPLEMENTED')
      return true
    },
  )
})

test('M2.23: the acceptance assertion — sortKey refuses, so no ICU bytes reach an index', () => {
  // The whole point. `compare` is a runtime-dependent approximation, which an
  // application may knowingly accept for `ORDER BY`; a sort key is *stored*,
  // and a stored ICU ordering means a database written by one engine version
  // is silently misread by another. The path that would produce those bytes
  // does not exist.
  const c = intlCollationFor(AS_CS)
  assert.throws(
    () => c.sortKey(u8('a')),
    (err: unknown) => {
      assert.ok(err instanceof CharsetError)
      assert.equal((err as CharsetError).code, 'ER_COLLATION_NO_SORT_KEY')
      assert.match((err as Error).message, /index order would depend on the runtime/)
      return true
    },
  )
})

test('M2.23: the comparator works, and is case- and accent-sensitive for an _as_cs name', () => {
  const c = intlCollationFor(AS_CS)
  assert.equal(sign(c.compare(u8('a'), u8('a'))), 0)
  assert.equal(sign(c.compare(u8('a'), u8('b'))), -1)
  assert.equal(sign(c.compare(u8('b'), u8('a'))), 1)
  // `_as_cs`: 'a' and 'A' are different, and so are 'a' and a-umlaut. This is
  // the sensitivity mapping doing its job — under an `_ai_ci` name the same
  // comparisons come back equal.
  assert.notEqual(c.compare(u8('a'), u8('A')), 0)
  assert.notEqual(c.compare(u8('a'), u8('ä')), 0)
})

test('M2.23: an _ai_ci name maps to a base-sensitivity collator', () => {
  // 224 is `utf8mb4_unicode_ci` — UCA 4.0.0, which we have no tables for
  // either. Its name ends `_ci`, so the fallback compares at base sensitivity
  // and folds case and accents together, the way the real collation does.
  const c = intlCollationFor(224)
  assert.equal(requireCollationInfo(224).name, 'utf8mb4_unicode_ci')
  assert.equal(c.compare(u8('a'), u8('A')), 0)
  assert.equal(c.compare(u8('a'), u8('ä')), 0)
  assert.notEqual(c.compare(u8('a'), u8('b')), 0)
})

test('M2.23: a PAD SPACE fallback pads rather than trims', () => {
  // The distinction D-35 was written about, at the character level this time.
  // Trimming trailing spaces would say 'a' < 'a\\u0001'; padding both to a common
  // width says the opposite, because a space outranks U+0001. Getting this
  // wrong here would be invisible — the fallback has no sort key to check it
  // against — so it is asserted directly.
  const info = requireCollationInfo(224)
  assert.equal(info.padAttribute, 'PAD SPACE')
  const c = intlCollationFor(224)
  assert.equal(c.compare(u8('a'), u8('a ')), 0, 'PAD SPACE ignores a trailing space')
  assert.equal(
    sign(c.compare(u8('a'), u8('a\u0001'))),
    1,
    "'a' padded to two characters is 'a ', and a space outranks U+0001",
  )
})

test('M2.23: switching it on changes resolve, and never displaces real tables', () => {
  try {
    setIntlFallbackEnabled(true)
    assert.equal(isIntlFallbackEnabled(), true)
    // Now resolvable — as a comparator that still refuses to be indexed.
    const c = collation(AS_CS)
    assert.equal(c.id, AS_CS)
    assert.equal(c.compare(u8('a'), u8('b')), -1)
    assert.throws(() => c.sortKey(u8('a')), CharsetError)

    // And a collation we *do* have tables for is untouched: it still comes
    // back from the generated weights, sort key and all. A fallback that
    // shadowed a real implementation would be far worse than no fallback.
    const general = collation(GENERAL_CI)
    assert.equal(general.sortKey(u8('ä')).length, 2)
    assert.equal(general.compare(u8('ä'), u8('a')), 0)
  } finally {
    setIntlFallbackEnabled(false)
  }
  assert.equal(isIntlFallbackEnabled(), false)
  assert.throws(() => collation(AS_CS), CharsetError)
})

test('M2.23: a charset we cannot decode is refused rather than mis-decoded', () => {
  // The fallback compares decoded text, so it is only available where a
  // decoder is. Guessing here would compare the wrong characters and report an
  // order with no relationship to the value. The registry is asked which
  // charsets those are rather than one being hardcoded, since the answer moves
  // with the runtime's `TextDecoder`.
  const missing = allCollations().find((c) => !canDecode(c.charset))
  if (missing === undefined) return // every charset in the registry decodes here
  assert.throws(
    () => intlCollationFor(missing.id),
    (err: unknown) => {
      assert.ok(err instanceof CharsetError)
      assert.equal((err as CharsetError).code, 'ER_UNKNOWN_CHARACTER_SET')
      assert.match((err as Error).message, /has no decoder available here/)
      return true
    },
  )
})
