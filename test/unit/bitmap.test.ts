// M0.6 — the offset asymmetry is a test, not a comment.
//
// Binary resultset rows use offset 2 (the low two bits are reserved);
// COM_STMT_EXECUTE parameters and COM_QUERY query attributes use offset 0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bitmapByteLength,
  bitmapGet,
  bitmapSet,
  bitmapFrom,
  RESULTSET_ROW_OFFSET,
  PARAMETER_OFFSET,
  ProtocolError,
} from '@myjs/bytes'

test('byte length follows floor((n + 7 + offset) / 8)', () => {
  assert.equal(bitmapByteLength(0, PARAMETER_OFFSET), 0)
  assert.equal(bitmapByteLength(1, PARAMETER_OFFSET), 1)
  assert.equal(bitmapByteLength(8, PARAMETER_OFFSET), 1)
  assert.equal(bitmapByteLength(9, PARAMETER_OFFSET), 2)
  // offset 2 pushes the boundary two bits earlier
  assert.equal(bitmapByteLength(6, RESULTSET_ROW_OFFSET), 1)
  assert.equal(bitmapByteLength(7, RESULTSET_ROW_OFFSET), 2)
})

test('both offsets round-trip an arbitrary NULL pattern', () => {
  for (const offset of [PARAMETER_OFFSET, RESULTSET_ROW_OFFSET]) {
    for (const n of [1, 2, 7, 8, 9, 15, 16, 17, 64]) {
      const pattern = (i: number) => i % 3 === 0
      const map = bitmapFrom(n, offset, pattern)
      assert.equal(map.length, bitmapByteLength(n, offset), `n=${n} offset=${offset}`)
      for (let i = 0; i < n; i++) {
        assert.equal(bitmapGet(map, i, offset), pattern(i), `bit ${i} at offset ${offset}`)
      }
    }
  }
})

test('offset 2 leaves the two reserved low bits clear', () => {
  const map = bitmapFrom(6, RESULTSET_ROW_OFFSET, () => true)
  assert.equal(map.length, 1)
  assert.equal(map[0], 0b1111_1100)
})

test('the same bit index means different bytes at the two offsets', () => {
  // bit 6 is inside byte 0 at offset 0, and inside byte 1 at offset 2.
  const atZero = bitmapFrom(7, PARAMETER_OFFSET, (i) => i === 6)
  const atTwo = bitmapFrom(7, RESULTSET_ROW_OFFSET, (i) => i === 6)
  assert.deepEqual([...atZero], [0b0100_0000])
  assert.deepEqual([...atTwo], [0b0000_0000, 0b0000_0001])
})

test('reading or writing outside the bitmap is a typed error', () => {
  const map = new Uint8Array(1)
  assert.throws(() => bitmapGet(map, 64, PARAMETER_OFFSET), ProtocolError)
  assert.throws(() => bitmapSet(map, 64, PARAMETER_OFFSET), ProtocolError)
  assert.throws(() => bitmapByteLength(-1, PARAMETER_OFFSET), ProtocolError)
})
