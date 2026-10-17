import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareBytes, equalBytes, hex } from '@myjs/bytes'

test('hex preserves every byte, subarray boundaries and large Buffer inputs', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i)
  for (const bytes of [new Uint8Array(), all, all.subarray(1, 255), Buffer.from(all), new Uint8Array(131072).fill(159)]) {
    assert.equal(hex(bytes), Buffer.from(bytes).toString('hex'))
    assert.equal(hex(bytes).length, bytes.length * 2)
  }
})

test('byte equality and ordering agree with native comparisons across byte values and prefixes', () => {
  const cases = [new Uint8Array(), new Uint8Array([0, 1]), new Uint8Array([0, 1, 0])]
  for (let i = 0; i < 256; i++) cases.push(new Uint8Array([i]), new Uint8Array([i, 255-i]))
  for (const a of cases) for (const b of cases) {
    const expected = Math.sign(Buffer.compare(a, b))
    assert.equal(Math.sign(compareBytes(a, b)), expected)
    assert.equal(equalBytes(a, b), expected === 0)
  }
})
