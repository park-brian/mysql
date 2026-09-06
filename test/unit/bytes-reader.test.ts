// M0.3 — `Reader`. The acceptance assertions from docs/44-roadmap.md are that
// every read bounds-checks against `remaining`, and that `0xFB` returns `null`
// and never `251`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Reader, ProtocolError } from '@myjs/bytes'

const b = (...v: number[]) => new Uint8Array(v)

test('fixed-width unsigned reads are little-endian', () => {
  const r = new Reader(b(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08))
  assert.equal(r.u8(), 0x01)
  assert.equal(r.u16(), 0x0302)
  assert.equal(r.u24(), 0x060504)
  assert.equal(r.remaining, 2)
})

test('u24 reads MySQL int<3>', () => {
  assert.equal(new Reader(b(0xff, 0xff, 0xff)).u24(), 0xffffff)
  assert.equal(new Reader(b(0x00, 0x00, 0x80)).u24(), 0x800000)
})

test('u48 reads MySQL int<6> exactly', () => {
  assert.equal(new Reader(b(0xff, 0xff, 0xff, 0xff, 0xff, 0xff)).u48(), 0xffff_ffff_ffff)
  assert.equal(new Reader(b(0x00, 0x00, 0x00, 0x00, 0x00, 0x01)).u48(), 0x0001_0000_0000_00)
})

test('u64 is always a BigInt — affected_rows can exceed MAX_SAFE_INTEGER', () => {
  const r = new Reader(b(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff))
  const v = r.u64()
  assert.equal(typeof v, 'bigint')
  assert.equal(v, 18446744073709551615n)
})

test('signed reads sign-extend', () => {
  assert.equal(new Reader(b(0xff)).i8(), -1)
  assert.equal(new Reader(b(0xff, 0xff)).i16(), -1)
  assert.equal(new Reader(b(0xff, 0xff, 0xff, 0xff)).i32(), -1)
  assert.equal(new Reader(b(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)).i64(), -1n)
})

test('bytes() is zero-copy — it returns a view of the same buffer', () => {
  const src = b(1, 2, 3, 4)
  const got = new Reader(src).bytes(2)
  assert.equal(got.buffer, src.buffer)
  assert.deepEqual([...got], [1, 2])
})

// --- the length-encoded traps (doc 11) ----------------------------------

test('lenEncInt: 0x00..0xFA is the byte itself', () => {
  assert.equal(new Reader(b(0x00)).lenEncInt(), 0n)
  assert.equal(new Reader(b(0xfa)).lenEncInt(), 250n)
})

test('lenEncInt: 0xFB is NULL, never 251', () => {
  assert.equal(new Reader(b(0xfb)).lenEncInt(), null)
})

test('lenEncInt: 0xFC/0xFD/0xFE carry int<2>/int<3>/int<8>', () => {
  assert.equal(new Reader(b(0xfc, 0xfb, 0x00)).lenEncInt(), 251n)
  assert.equal(new Reader(b(0xfd, 0x00, 0x00, 0x01)).lenEncInt(), 0x010000n)
  assert.equal(new Reader(b(0xfe, 1, 0, 0, 0, 0, 0, 0, 0)).lenEncInt(), 1n)
})

test('lenEncInt: 0xFF is never valid — it is the ERR packet header', () => {
  assert.throws(() => new Reader(b(0xff)).lenEncInt(), ProtocolError)
})

test('lenEncBytes propagates NULL and reads the payload otherwise', () => {
  assert.equal(new Reader(b(0xfb)).lenEncBytes(), null)
  assert.deepEqual([...(new Reader(b(0x03, 0x66, 0x6f, 0x6f)).lenEncBytes() as Uint8Array)], [0x66, 0x6f, 0x6f])
})

test('lenEncBytes rejects a length that overruns the payload', () => {
  assert.throws(() => new Reader(b(0x08, 1, 2, 3)).lenEncBytes(), ProtocolError)
})

// --- strings ------------------------------------------------------------

test('nulString stops at the NUL and consumes it', () => {
  const r = new Reader(b(0x61, 0x62, 0x00, 0x63))
  assert.deepEqual([...r.nulString()], [0x61, 0x62])
  assert.equal(r.remaining, 1)
})

test('an unterminated string<NUL> is a typed error, not a buffer overrun', () => {
  assert.throws(() => new Reader(b(0x61, 0x62)).nulString(), ProtocolError)
})

test('restBytes runs to the end of the payload slice, not the array', () => {
  const r = new Reader(b(1, 2, 3, 4, 5), 1, 3)
  assert.deepEqual([...r.restBytes()], [2, 3])
  assert.equal(r.remaining, 0)
})

// --- bounds: the whole attack surface -----------------------------------

test('every read bounds-checks against remaining', () => {
  for (const read of [
    (r: Reader) => r.u8(),
    (r: Reader) => r.u16(),
    (r: Reader) => r.u24(),
    (r: Reader) => r.u32(),
    (r: Reader) => r.u48(),
    (r: Reader) => r.u64(),
    (r: Reader) => r.i64(),
    (r: Reader) => r.f32(),
    (r: Reader) => r.f64(),
    (r: Reader) => r.bytes(1),
    (r: Reader) => r.skip(1),
  ]) {
    assert.throws(() => read(new Reader(new Uint8Array(0))), ProtocolError)
  }
})

test('bytes(n) and skip(n) throw rather than clamp', () => {
  assert.throws(() => new Reader(b(1, 2)).bytes(3), ProtocolError)
  assert.throws(() => new Reader(b(1, 2)).skip(3), ProtocolError)
  assert.throws(() => new Reader(b(1, 2)).bytes(-1), ProtocolError)
  assert.throws(() => new Reader(b(1, 2)).bytes(1.5), ProtocolError)
})

test('a Reader over an invalid range is rejected at construction', () => {
  assert.throws(() => new Reader(b(1, 2), 0, 5), ProtocolError)
  assert.throws(() => new Reader(b(1, 2), 3, 1), ProtocolError)
})

test('a Reader honours a non-zero byteOffset on the underlying array', () => {
  const backing = new Uint8Array([9, 9, 0x2a, 0x00])
  const slice = backing.subarray(2)
  assert.equal(new Reader(slice).u16(), 0x2a)
})
