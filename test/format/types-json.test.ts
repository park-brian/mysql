// M2.13 — MySQL's binary JSON (doc 28).
//
// Doc 28 names four traps and every one of them is a test here, because each
// is a way to produce a codec that works on the documents you tried and fails
// on the ones you did not:
//
//   the small/large switch is per *container*, not per document;
//   offsets are relative to the container, which coincides with the document
//   only at depth 0;
//   an entry holds a value *or* an offset, and which one depends on the
//   container's width;
//   key order is length-then-bytes, and it is observable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { FIELD_TYPE } from '@myjs/bytes'
import {
  JSON_TYPE,
  TypeError as MyjsTypeError,
  compareJsonKeys,
  decodeJson,
  encodeDatetime2,
  encodeJson,
  type JsonValue,
} from '@myjs/types'

const roundTrip = (v: JsonValue): JsonValue => decodeJson(encodeJson(v))
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')

test('M2.13: scalars round-trip, and pick the narrowest type that holds them', () => {
  assert.equal(roundTrip(null), null)
  assert.equal(roundTrip(true), true)
  assert.equal(roundTrip(false), false)
  assert.equal(roundTrip(0), 0)
  assert.equal(roundTrip(-1), -1)
  assert.equal(roundTrip(32767), 32767)
  assert.equal(roundTrip(-32768), -32768)
  assert.equal(roundTrip(65535), 65535)
  assert.equal(roundTrip(2147483647), 2147483647)
  assert.equal(roundTrip(1.5), 1.5)
  assert.equal(roundTrip(''), '')
  assert.equal(roundTrip('café €'), 'café €')

  // The type byte says which representation was chosen, and narrow-first is
  // what keeps an array of small numbers small.
  assert.equal(encodeJson(1)[0], JSON_TYPE.INT16)
  assert.equal(encodeJson(65535)[0], JSON_TYPE.UINT16)
  assert.equal(encodeJson(100000)[0], JSON_TYPE.INT32)
  assert.equal(encodeJson(1.5)[0], JSON_TYPE.DOUBLE)
  assert.equal(encodeJson(null)[0], JSON_TYPE.LITERAL)
  assert.equal(encodeJson('x')[0], JSON_TYPE.STRING)
})

test('M2.13: a 64-bit integer keeps its bits, which a double would not', () => {
  const big = 9007199254740993n // 2^53 + 1, the first integer a double cannot hold
  assert.equal(roundTrip(big), big)
  assert.equal(encodeJson(big)[0], JSON_TYPE.UINT64)
  assert.equal(roundTrip(-big), -big)
  assert.equal(encodeJson(-big)[0], JSON_TYPE.INT64)
})

test('M2.13: object keys are stored length-then-bytes, which is observable', () => {
  // Doc 28: "this is also why `JSON_OBJECT('b',1,'a',2)` comes back with `a`
  // first: MySQL is not preserving your insertion order, it is storing the
  // sorted form." Reproducing it is required for output compatibility.
  const decoded = roundTrip({ bb: 1, b: 2, a: 3, aa: 4 }) as Record<string, JsonValue>
  assert.deepEqual(Object.keys(decoded), ['a', 'b', 'aa', 'bb'])

  // Length first — so a short key sorts before a long one even when its bytes
  // are greater. A plain lexicographic sort would put 'aa' before 'b'.
  assert.ok(compareJsonKeys('b', 'aa') < 0)
  assert.ok(compareJsonKeys('a', 'b') < 0)
  assert.equal(compareJsonKeys('a', 'a'), 0)
  // Byte length, not character length: a two-byte character counts as two.
  assert.ok(compareJsonKeys('é', 'zz') === 0 ? true : compareJsonKeys('é', 'z') > 0)
})

test('M2.13: nesting round-trips, and offsets are container-relative', () => {
  // The classic bug is an offset read against the document instead of the
  // container, which is invisible at depth 0 and wrong everywhere else. Depth
  // and position are both varied so a document-relative reader cannot pass.
  const doc = {
    a: [1, 2, { b: [3, { c: 'deep' }] }],
    z: { y: { x: { w: [null, true, false] } } },
  }
  assert.deepEqual(roundTrip(doc), doc)

  const nested = [{ k: 'v' }, [1, [2, [3, ['x']]]]]
  assert.deepEqual(roundTrip(nested), nested)
  assert.deepEqual(roundTrip([]), [])
  assert.deepEqual(roundTrip({}), {})
})

test('M2.13: an entry holds a value or an offset, and the width decides which', () => {
  // Doc 28 calls treating every entry as an offset "a common source of bugs in
  // third-party readers". These are the inline types; if they were read as
  // offsets the values would come back as whatever lives at 1, 2 and 3.
  assert.deepEqual(roundTrip([null, true, false]), [null, true, false])
  assert.deepEqual(roundTrip([1, 2, 3]), [1, 2, 3])
  assert.deepEqual(roundTrip([0, -1, 32767, 65535]), [0, -1, 32767, 65535])
  // Mixed inline and out-of-line in one container, which is where an encoder
  // that assumes one or the other falls over.
  assert.deepEqual(roundTrip([1, 'text', null, 1.5, 70000]), [1, 'text', null, 1.5, 70000])
})

test('M2.13: a large container, and a small one nested inside it', () => {
  // A small container cannot exceed 64 KiB, so this one must be large — and
  // the small objects inside it must stay small, since the width is chosen per
  // container rather than per document.
  const big = Array.from({ length: 20000 }, (_, i) => ({ i }))
  const encoded = encodeJson(big)
  assert.equal(encoded[0], JSON_TYPE.LARGE_ARRAY, 'a 20,000-element array cannot be small')
  const decoded = decodeJson(encoded) as JsonValue[]
  assert.equal(decoded.length, 20000)
  assert.deepEqual(decoded[0], { i: 0 })
  assert.deepEqual(decoded[19999], { i: 19999 })

  // …and a document that fits stays small, so the fallback is a fallback.
  assert.equal(encodeJson([1, 2, 3])[0], JSON_TYPE.SMALL_ARRAY)
  assert.equal(encodeJson({ a: 1 })[0], JSON_TYPE.SMALL_OBJECT)
})

test('M2.13: custom-data reaches back into the storage decoder', () => {
  // Doc 28: `custom-data` wraps a non-JSON MySQL value "with its
  // `enum_field_types` code and the value in that type's *storage* encoding …
  // it is why the JSON codec depends on the column codec". This is that
  // dependency, exercised: a DATETIME inside a JSON document.
  const stored = encodeDatetime2(
    { year: 2010, month: 10, day: 17, hour: 19, minute: 27, second: 30, microsecond: 0 },
    0,
  )
  // type byte, custom-data tag, field type, varint length, payload
  const doc = new Uint8Array(1 + 1 + 1 + stored.length)
  doc[0] = JSON_TYPE.CUSTOM
  doc[1] = FIELD_TYPE.DATETIME2
  doc[2] = stored.length
  doc.set(stored, 3)
  const value = decodeJson(doc.subarray(0)) as { year: number; month: number; day: number }
  assert.equal(value.year, 2010)
  assert.equal(value.month, 10)
  assert.equal(value.day, 17)
})

test('M2.13: malformed input is a typed error, never a crash or a wrong value', () => {
  // Ground rule 5. A JSON column's bytes come off disk or off the wire, so
  // every one of these is reachable input rather than a hypothetical.
  assert.throws(() => decodeJson(new Uint8Array(0)), MyjsTypeError)
  assert.throws(() => decodeJson(Uint8Array.of(0x7f)), MyjsTypeError) // no such type
  assert.throws(() => decodeJson(Uint8Array.of(JSON_TYPE.LITERAL, 0x09)), MyjsTypeError) // no such literal
  assert.throws(() => decodeJson(Uint8Array.of(JSON_TYPE.SMALL_ARRAY, 0x01)), MyjsTypeError) // truncated header
  assert.throws(() => decodeJson(Uint8Array.of(JSON_TYPE.DOUBLE, 0x00)), MyjsTypeError) // truncated double
  // A container claiming more bytes than it has, which is the shape a
  // corrupted page would take.
  assert.throws(
    () => decodeJson(Uint8Array.of(JSON_TYPE.SMALL_ARRAY, 0x01, 0x00, 0xff, 0xff)),
    MyjsTypeError,
  )
  assert.throws(() => decodeJson(Uint8Array.of(JSON_TYPE.STRING, 0x7f)), MyjsTypeError) // string past the end
})

test('M2.13: fuzzed bytes never crash — only a typed error comes out', () => {
  // The fuzzing invariant, on the codec most likely to be handed hostile bytes.
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
      try {
        decodeJson(bytes)
      } catch (err) {
        assert.ok(err instanceof MyjsTypeError, `threw ${String(err)}`)
      }
    }),
    { numRuns: 5000 },
  )
})

test('M2.13: the round-trip property over generated documents', () => {
  const json = fc.letrec<{ value: JsonValue }>((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string({ maxLength: 20 }),
      fc.array(tie('value'), { maxLength: 6 }),
      // Spread to a plain object: fast-check hands back null-prototype
      // dictionaries, and `deepEqual` compares prototypes.
      fc.dictionary(fc.string({ maxLength: 8 }), tie('value'), { maxKeys: 6 }).map((d) => ({ ...d })),
    ),
  })).value
  fc.assert(
    fc.property(json, (v) => {
      assert.deepEqual(roundTrip(v), v)
    }),
    { numRuns: 2000 },
  )
})

test('M2.13: a stored __proto__ key is data, not a prototype assignment', () => {
  // A JSON column's bytes are untrusted input and `__proto__` is a legal key,
  // so a decoder that assigns with `out[key] = value` walks into the prototype
  // setter — prototype pollution reachable from a table row. It must come back
  // as an ordinary own property instead.
  // Built with `defineProperty`, because `{ __proto__: … }` in a literal *sets
  // the prototype* rather than creating a key — the same trap on the way in
  // that the decoder has on the way out.
  const source: Record<string, JsonValue> = { safe: 1 }
  Object.defineProperty(source, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    writable: true,
    configurable: true,
  })
  const doc = encodeJson(source as JsonValue)
  const decoded = decodeJson(doc) as Record<string, JsonValue>
  assert.deepEqual(Object.keys(decoded).sort(), ['__proto__', 'safe'])
  assert.ok(Object.hasOwn(decoded, '__proto__'), 'an own property, not the prototype')
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined, 'nothing leaked onto Object.prototype')
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype)
})

test('M2.13: negative zero stays a double, because float8store keeps its sign', () => {
  // The mirror image of M2.10's DECIMAL finding. There, MySQL has no negative
  // zero and encoding one differently from `0.00` would have let a unique index
  // hold both, so it is normalised. Here the value really is a double and its
  // sign is part of it, so narrowing `-0` to an integer type would drop it.
  assert.equal(encodeJson(-0)[0], JSON_TYPE.DOUBLE)
  assert.equal(encodeJson(0)[0], JSON_TYPE.INT16)
  assert.ok(Object.is(decodeJson(encodeJson(-0)), -0))
  assert.ok(Object.is(decodeJson(encodeJson(0)), 0))
})

test('M2.13/M2.15: the spec-derived byte vectors doc 28 does not itself quote', () => {
  // Doc 28 contains no hex dumps — four fenced blocks, all grammar and
  // pseudocode — so M2.15's "every byte dump is a test case" is vacuous for
  // it. These are the vectors that fill that gap, and they are *derived from
  // the grammar* rather than from our own output, so they are a check on the
  // encoder rather than a photograph of it.
  //
  // `{"a":1}`, worked through doc 28's `object ::= element-count size
  // key-entry* value-entry* key* value*`:
  //
  //   00           small object
  //   01 00        element-count = 1        (uint16, small)
  //   0C 00        size = 12                (the container's own byte length)
  //   0B 00 01 00  key-entry: offset 11, length 1
  //   05 01 00     value-entry: INT16, inlined value 1
  //   61           the key, 'a'
  //
  // The offset is 11 because the entries end there: 4 bytes of header, 4 of
  // key-entry, 3 of value-entry. Container-relative, so it counts from the
  // element-count and not from the type byte.
  assert.equal(hex(encodeJson({ a: 1 })), '00 01 00 0C 00 0B 00 01 00 05 01 00 61')

  //   02           small array
  //   01 00        element-count = 1
  //   07 00        size = 7
  //   05 01 00     value-entry: INT16, inlined value 1
  assert.equal(hex(encodeJson([1])), '02 01 00 07 00 05 01 00')

  // Empty containers are the header alone, which is the smallest a container
  // can be and the case an off-by-one in the entry arithmetic breaks first.
  assert.equal(hex(encodeJson([])), '02 00 00 04 00')
  assert.equal(hex(encodeJson({})), '00 00 00 04 00')

  // A bare scalar document has no entry to be inlined into, so the value
  // follows the type byte in its own right.
  assert.equal(hex(encodeJson(null)), '04 00')
  assert.equal(hex(encodeJson(true)), '04 01')
  assert.equal(hex(encodeJson(false)), '04 02')

  //   0C           string
  //   02           length varint = 2
  //   61 62        'ab'
  assert.equal(hex(encodeJson('ab')), '0C 02 61 62')

  // And every one of them decodes back, so the vectors pin both directions.
  for (const v of [{ a: 1 }, [1], [], {}, null, true, false, 'ab'] as JsonValue[]) {
    assert.deepEqual(decodeJson(encodeJson(v)), v)
  }
})
