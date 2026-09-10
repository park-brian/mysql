// M2.2 — the `memcmp` collations.
//
// Doc 43 §4 calls the ordering property the single most valuable test here:
// `sign(compare(a, b)) === sign(memcmp(sortKey(a), sortKey(b)))` catches every
// sign-flip and endianness mistake. For a byte collation it also pins the
// weaker but load-bearing claim that the sort key really is the value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import {
  MEMCMP_COLLATION_IDS,
  CharsetError,
  collation,
  collationAvailability,
  hasCollation,
  memcmp,
  memcmpPadSpace,
} from '@myjs/charsets'

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)
// `assert.strictEqual` is `Object.is`, and `Object.is(0, -0)` is false — so
// antisymmetry is asserted as a sum rather than as `x === -y`.
const antisymmetric = (x: number, y: number) => assert.equal(sign(x) + sign(y), 0)
const bytes = () => fc.uint8Array({ maxLength: 24 })

test('M2.2: ordering equals memcmp on arbitrary bytes', () => {
  const binary = collation(63)
  fc.assert(
    fc.property(bytes(), bytes(), (a, b) => {
      assert.equal(sign(binary.compare(a, b)), sign(memcmp(a, b)))
    }),
    { numRuns: 2000 },
  )
})

test('M2.2: the sort key is the value, so a B+tree can memcmp stored keys', () => {
  for (const id of MEMCMP_COLLATION_IDS) {
    const c = collation(id)
    fc.assert(
      fc.property(bytes(), (v) => {
        assert.deepEqual(c.sortKey(v), v)
      }),
      { numRuns: 200 },
    )
  }
})

test('memcmp is a total order: antisymmetric, transitive, and reflexive', () => {
  fc.assert(
    fc.property(bytes(), bytes(), bytes(), (a, b, c) => {
      antisymmetric(memcmp(a, b), memcmp(b, a))
      assert.equal(memcmp(a, a), 0)
      if (memcmp(a, b) <= 0 && memcmp(b, c) <= 0) assert.ok(memcmp(a, c) <= 0)
    }),
    { numRuns: 2000 },
  )
})

test('memcmp compares unsigned, so 0x80 sorts after 0x7f', () => {
  // The mistake this catches is treating a byte as signed, which puts every
  // high-bit value before every low-bit one and silently reverses half an index.
  assert.equal(sign(memcmp(Uint8Array.from([0x80]), Uint8Array.from([0x7f]))), 1)
  assert.equal(sign(memcmp(Uint8Array.from([0xff]), Uint8Array.from([0x00]))), 1)
})

test('a prefix sorts before what extends it', () => {
  assert.equal(sign(memcmp(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 0]))), -1)
  assert.equal(sign(memcmp(new Uint8Array(0), Uint8Array.from([0]))), -1)
})

test("doc 29: `binary` is NO PAD, so 'a' and 'a ' differ", () => {
  const binary = collation(63)
  const a = Uint8Array.from([0x61])
  const aSpace = Uint8Array.from([0x61, 0x20])
  assert.equal(binary.padAttribute, 'NO PAD')
  assert.notEqual(binary.compare(a, aSpace), 0)
})

test("doc 29: utf8mb4_bin is PAD SPACE, so 'a' = 'a ' is true", () => {
  // The upgrade surprise doc 29 names. `utf8mb4_bin` predates the `_0900_`
  // family and pads; `utf8mb4_0900_ai_ci` does not. Getting it backwards makes
  // a unique index accept rows a real server rejects.
  const bin = collation(46)
  assert.equal(bin.padAttribute, 'PAD SPACE')
  assert.equal(bin.compare(Uint8Array.from([0x61]), Uint8Array.from([0x61, 0x20])), 0)
  assert.equal(bin.compare(Uint8Array.from([0x61]), Uint8Array.from([0x61, 0x20, 0x20])), 0)
})

test('PAD SPACE still orders correctly when the next byte is below a space', () => {
  // `'a\\x00'` is longer than `'a'`, but its next byte is under 0x20, so it
  // sorts *before* the space-padded shorter value rather than after it.
  const bin = collation(46)
  assert.equal(sign(bin.compare(Uint8Array.from([0x61, 0x00]), Uint8Array.from([0x61]))), -1)
  assert.equal(sign(bin.compare(Uint8Array.from([0x61, 0x21]), Uint8Array.from([0x61]))), 1)
})

test('PAD SPACE is a total order too', () => {
  // Same property as memcmp, on the comparator that actually gets used for
  // every pre-8.0 collation.
  const padded = () => fc.uint8Array({ maxLength: 8 }).map((u) => u)
  fc.assert(
    fc.property(padded(), padded(), padded(), (a, b, c) => {
      antisymmetric(memcmpPadSpace(a, b), memcmpPadSpace(b, a))
      assert.equal(memcmpPadSpace(a, a), 0)
      if (memcmpPadSpace(a, b) <= 0 && memcmpPadSpace(b, c) <= 0) assert.ok(memcmpPadSpace(a, c) <= 0)
    }),
    { numRuns: 3000 },
  )
})

test('an unimplemented collation refuses rather than falling back to byte order', () => {
  // A silent fallback to memcmp would build an index in the wrong order and
  // only show up as wrong query results much later. `ucs2_bin` is the shape
  // that still refuses outright: a two-byte pad character, which the padded
  // comparator would need as its unit.
  assert.equal(hasCollation(90), false)
  assert.equal(collationAvailability(90), 'unsupported')
  assert.throws(() => collation(90), (err: unknown) => {
    assert.ok(err instanceof CharsetError)
    assert.equal((err as CharsetError).code, 'ER_COLLATION_NOT_IMPLEMENTED')
    assert.match((err as Error).message, /ucs2_bin/)
    return true
  })
})

test('a UCA collation refuses differently: not unsupported, just not loaded', () => {
  // D-36. `utf8mb4_0900_ai_ci` has tables, they are simply 50 KB away behind
  // an `await import()`. Saying "not implemented" here would be a lie that
  // sends a caller looking for a missing feature instead of a missing await —
  // so the two refusals carry different codes.
  // Whether the tables are already resident depends on test ordering, so this
  // asserts the *pair* of states is coherent rather than one of them.
  assert.notEqual(collationAvailability(255), 'unsupported')
  if (collationAvailability(255) === 'loadable') {
    assert.throws(() => collation(255), (err: unknown) => {
      assert.ok(err instanceof CharsetError)
      assert.equal((err as CharsetError).code, 'ER_COLLATION_NOT_LOADED')
      assert.match((err as Error).message, /utf8mb4_0900_ai_ci/)
      return true
    })
  }
})
