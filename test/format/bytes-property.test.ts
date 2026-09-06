// M0.7 — property tests round-tripping every protocol primitive.
//
// Doc 43 §4 names `fast-check`; doc 44's acceptance criterion is that it
// "covers all int widths, lenenc, and all four string forms". The four forms
// from doc 11's table are string<fix>, string<NUL>, string<lenenc> and
// string<EOF> — string<var> is excluded because its length comes from
// elsewhere in the packet, so there is nothing to round-trip on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { Reader, Writer, bitmapFrom, bitmapGet, bitmapByteLength } from '@myjs/bytes'

const RUNS = { numRuns: 2000 }

const U64_MAX = 0xffff_ffff_ffff_ffffn
const I64_MIN = -(2n ** 63n)
const I64_MAX = 2n ** 63n - 1n

// One row per fixed-width primitive: an arbitrary, a writer and a reader.
const INT_WIDTHS: Array<{
  name: string
  arb: fc.Arbitrary<number | bigint>
  write: (w: Writer, v: never) => void
  read: (r: Reader) => number | bigint
}> = [
  { name: 'u8', arb: fc.integer({ min: 0, max: 0xff }), write: (w, v: number) => void w.u8(v), read: (r) => r.u8() },
  { name: 'u16', arb: fc.integer({ min: 0, max: 0xffff }), write: (w, v: number) => void w.u16(v), read: (r) => r.u16() },
  { name: 'u24', arb: fc.integer({ min: 0, max: 0xffffff }), write: (w, v: number) => void w.u24(v), read: (r) => r.u24() },
  { name: 'u32', arb: fc.integer({ min: 0, max: 0xffffffff }), write: (w, v: number) => void w.u32(v), read: (r) => r.u32() },
  { name: 'u48', arb: fc.integer({ min: 0, max: 0xffff_ffff_ffff }), write: (w, v: number) => void w.u48(v), read: (r) => r.u48() },
  { name: 'u64', arb: fc.bigInt({ min: 0n, max: U64_MAX }), write: (w, v: bigint) => void w.u64(v), read: (r) => r.u64() },
  { name: 'i8', arb: fc.integer({ min: -0x80, max: 0x7f }), write: (w, v: number) => void w.i8(v), read: (r) => r.i8() },
  { name: 'i16', arb: fc.integer({ min: -0x8000, max: 0x7fff }), write: (w, v: number) => void w.i16(v), read: (r) => r.i16() },
  { name: 'i32', arb: fc.integer({ min: -0x80000000, max: 0x7fffffff }), write: (w, v: number) => void w.i32(v), read: (r) => r.i32() },
  { name: 'i64', arb: fc.bigInt({ min: I64_MIN, max: I64_MAX }), write: (w, v: bigint) => void w.i64(v), read: (r) => r.i64() },
]

for (const width of INT_WIDTHS) {
  test(`${width.name} round-trips`, () => {
    fc.assert(
      fc.property(width.arb, (v) => {
        const w = new Writer(1)
        width.write(w, v as never)
        const r = new Reader(w.view())
        assert.equal(width.read(r), v)
        assert.equal(r.remaining, 0, 'the width consumed exactly what it wrote')
      }),
      RUNS,
    )
  })
}

test('f32 round-trips for values representable as a single', () => {
  fc.assert(
    fc.property(fc.float({ noNaN: true }), (v) => {
      const w = new Writer(1).f32(v)
      assert.equal(new Reader(w.view()).f32(), v)
    }),
    RUNS,
  )
})

test('f64 round-trips', () => {
  fc.assert(
    fc.property(fc.double({ noNaN: true }), (v) => {
      const w = new Writer(1).f64(v)
      assert.equal(new Reader(w.view()).f64(), v)
    }),
    RUNS,
  )
})

// --- length-encoded ------------------------------------------------------

test('lenEncInt round-trips and is always canonical (shortest)', () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: U64_MAX }), (v) => {
      const w = new Writer(1).lenEncInt(v)
      const bytes = w.view()
      assert.equal(new Reader(bytes).lenEncInt(), v)

      // Canonicity: the encoding must be the shortest one that fits.
      const expected = v < 251n ? 1 : v <= 0xffffn ? 3 : v <= 0xffffffn ? 4 : 9
      assert.equal(bytes.length, expected, `lenEnc(${v}) should be ${expected} bytes`)
    }),
    RUNS,
  )
})

test('lenEncInt NULL round-trips as the single byte 0xFB', () => {
  const w = new Writer(1).lenEncInt(null)
  assert.deepEqual([...w.view()], [0xfb])
  assert.equal(new Reader(w.view()).lenEncInt(), null)
})

test('string<lenenc> round-trips, NULL included', () => {
  fc.assert(
    fc.property(fc.option(fc.uint8Array({ maxLength: 600 }), { nil: null }), (payload) => {
      const w = new Writer(1).lenEncBytes(payload)
      const got = new Reader(w.view()).lenEncBytes()
      if (payload === null) assert.equal(got, null)
      else assert.deepEqual([...(got as Uint8Array)], [...payload])
    }),
    RUNS,
  )
})

// --- the four string forms ----------------------------------------------

test('string<fix> round-trips', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 300 }), (payload) => {
      const w = new Writer(1).bytes(payload)
      assert.deepEqual([...new Reader(w.view()).bytes(payload.length)], [...payload])
    }),
    RUNS,
  )
})

test('string<NUL> round-trips for any NUL-free payload', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 300, min: 1, max: 255 }), (payload) => {
      const w = new Writer(1).nulString(payload)
      const r = new Reader(w.view())
      assert.deepEqual([...r.nulString()], [...payload])
      assert.equal(r.remaining, 0)
    }),
    RUNS,
  )
})

test('string<EOF> round-trips and consumes the whole slice', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 300 }), (payload) => {
      const w = new Writer(1).bytes(payload)
      const r = new Reader(w.view())
      assert.deepEqual([...r.restBytes()], [...payload])
      assert.equal(r.remaining, 0)
    }),
    RUNS,
  )
})

// --- a whole packet's worth of mixed primitives --------------------------

test('a mixed sequence of primitives round-trips in order', () => {
  const step = fc.oneof(
    fc.record({ kind: fc.constant('u8' as const), v: fc.integer({ min: 0, max: 0xff }) }),
    fc.record({ kind: fc.constant('u24' as const), v: fc.integer({ min: 0, max: 0xffffff }) }),
    fc.record({ kind: fc.constant('lenenc' as const), v: fc.bigInt({ min: 0n, max: U64_MAX }) }),
    fc.record({ kind: fc.constant('lenencbytes' as const), v: fc.uint8Array({ maxLength: 40 }) }),
    fc.record({ kind: fc.constant('nul' as const), v: fc.uint8Array({ maxLength: 40, min: 1, max: 255 }) }),
  )
  fc.assert(
    fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
      const w = new Writer(1)
      for (const s of steps) {
        if (s.kind === 'u8') w.u8(s.v)
        else if (s.kind === 'u24') w.u24(s.v)
        else if (s.kind === 'lenenc') w.lenEncInt(s.v)
        else if (s.kind === 'lenencbytes') w.lenEncBytes(s.v)
        else w.nulString(s.v)
      }
      const r = new Reader(w.view())
      for (const s of steps) {
        if (s.kind === 'u8') assert.equal(r.u8(), s.v)
        else if (s.kind === 'u24') assert.equal(r.u24(), s.v)
        else if (s.kind === 'lenenc') assert.equal(r.lenEncInt(), s.v)
        else if (s.kind === 'lenencbytes') assert.deepEqual([...(r.lenEncBytes() as Uint8Array)], [...s.v])
        else assert.deepEqual([...r.nulString()], [...s.v])
      }
      assert.equal(r.remaining, 0)
    }),
    RUNS,
  )
})

// --- bitmaps, both offsets ----------------------------------------------

test('NULL bitmaps round-trip at offset 0 and offset 2', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 200 }),
      fc.constantFrom(0, 2),
      fc.array(fc.boolean(), { maxLength: 200 }),
      (n, offset, flags) => {
        const isSet = (i: number) => flags[i % Math.max(1, flags.length)] === true
        const map = bitmapFrom(n, offset, isSet)
        assert.equal(map.length, bitmapByteLength(n, offset))
        for (let i = 0; i < n; i++) assert.equal(bitmapGet(map, i, offset), isSet(i))
      },
    ),
    RUNS,
  )
})
