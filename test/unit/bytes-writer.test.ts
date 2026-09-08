// M0.4 — `Writer`. The acceptance assertion from docs/44-roadmap.md is that
// `lenEnc(250)` is one byte and `lenEnc(251)` is three, which is what makes
// byte-exact trace comparison (doc 43 §3) possible at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer, Reader, ProtocolError } from '@myjs/bytes'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join(' ')

test('length-encoded integers use the shortest form', () => {
  assert.equal(new Writer().lenEncInt(250).length, 1, 'lenEnc(250) is 1 byte')
  assert.equal(new Writer().lenEncInt(251).length, 3, 'lenEnc(251) is 3 bytes')
  assert.equal(new Writer().lenEncInt(0xffff).length, 3)
  assert.equal(new Writer().lenEncInt(0x10000).length, 4)
  assert.equal(new Writer().lenEncInt(0xffffff).length, 4)
  assert.equal(new Writer().lenEncInt(0x1000000).length, 9)
})

test('the canonical encodings are byte-exact', () => {
  assert.equal(hex(new Writer().lenEncInt(250).view()), 'fa')
  assert.equal(hex(new Writer().lenEncInt(251).view()), 'fc fb 00')
  assert.equal(hex(new Writer().lenEncInt(null).view()), 'fb')
})

test('a bigint above int<3> range still takes the 9-byte form', () => {
  assert.equal(new Writer().lenEncInt(0xffffffffn).length, 9)
  assert.equal(new Writer().lenEncInt(250n).length, 1, 'small bigints narrow to the shortest form')
})

test('out-of-range length-encoded integers are typed errors', () => {
  assert.throws(() => new Writer().lenEncInt(-1), ProtocolError)
  assert.throws(() => new Writer().lenEncInt(1.5), ProtocolError)
  assert.throws(() => new Writer().lenEncInt(-1n), ProtocolError)
})

test('every fixed-width write round-trips through Reader', () => {
  const w = new Writer()
  w.u8(0xff).u16(0xfffe).u24(0xfffffd).u32(0xfffffffc).u48(0xffff_ffff_fffb).u64(0xffff_ffff_ffff_fffan)
  w.i8(-1).i16(-2).i32(-3).i64(-4n).f32(0.5).f64(-0.25)
  const r = new Reader(w.view())
  assert.equal(r.u8(), 0xff)
  assert.equal(r.u16(), 0xfffe)
  assert.equal(r.u24(), 0xfffffd)
  assert.equal(r.u32(), 0xfffffffc)
  assert.equal(r.u48(), 0xffff_ffff_fffb)
  assert.equal(r.u64(), 0xffff_ffff_ffff_fffan)
  assert.equal(r.i8(), -1)
  assert.equal(r.i16(), -2)
  assert.equal(r.i32(), -3)
  assert.equal(r.i64(), -4n)
  assert.equal(r.f32(), 0.5)
  assert.equal(r.f64(), -0.25)
  assert.equal(r.remaining, 0)
})

test('geometric growth keeps content intact across many reallocations', () => {
  const w = new Writer(16)
  for (let i = 0; i < 5000; i++) w.u8(i & 0xff)
  const out = w.view()
  assert.equal(out.length, 5000)
  for (let i = 0; i < 5000; i++) assert.equal(out[i], i & 0xff)
})

test('reserve + patch backfills a packet header written before its length', () => {
  const w = new Writer()
  const header = w.reserve(4)
  w.bytes(new Uint8Array([0x01, 0x02, 0x03]))
  w.patchU24(header, w.length - header - 4)
  w.patchU8(header + 3, 7)
  assert.equal(hex(w.view()), '03 00 00 07 01 02 03')
})

test('patching outside what has been written is a typed error', () => {
  const w = new Writer()
  w.reserve(4)
  assert.throws(() => w.patchU24(3, 1), ProtocolError)
  assert.throws(() => w.patchU8(-1, 1), ProtocolError)
})

test('nulString and lenEncBytes round-trip', () => {
  const w = new Writer()
  w.nulString(new Uint8Array([0x61, 0x62]))
  w.lenEncBytes(new Uint8Array([0x63]))
  w.lenEncBytes(null)
  const r = new Reader(w.view())
  assert.deepEqual([...r.nulString()], [0x61, 0x62])
  assert.deepEqual([...(r.lenEncBytes() as Uint8Array)], [0x63])
  assert.equal(r.lenEncBytes(), null)
})

test('toBytes copies and view aliases', () => {
  const w = new Writer()
  w.u8(1)
  const copy = w.toBytes()
  const alias = w.view()
  w.reset()
  w.u8(2)
  assert.equal(copy[0], 1, 'toBytes is a snapshot')
  assert.equal(alias[0], 2, 'view aliases the writer')
})
