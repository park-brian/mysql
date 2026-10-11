// The value reader maps binary bytes to code points; charset codecs own decoding.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytesValue, intValue, toText } from '@myjs/types'

test('binary value text retains every byte as the same code point', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, byte) => byte)
  const text = toText(bytesValue(bytes))
  assert.equal(text.length, 256)
  assert.deepEqual(Array.from(text, char => char.charCodeAt(0)), Array.from(bytes))
})

test('BIT payload text uses the same identity byte reader', () => {
  const bytes = Uint8Array.of(0, 0x7f, 0x80, 0x9f, 0xff, 0, 1, 2)
  assert.deepEqual(Array.from(toText({ ...intValue(0n, true), str: bytes }), char => char.charCodeAt(0)), Array.from(bytes))
})

test('binary value text retains large subjects including embedded NUL and high bytes', () => {
  const bytes = Uint8Array.from({ length: 200_003 }, (_, index) => index % 256)
  const text = toText(bytesValue(bytes))
  assert.equal(text.length, bytes.length)
  assert.deepEqual(Uint16Array.from(text, char => char.charCodeAt(0)), Uint16Array.from(bytes))
  assert.equal(toText(bytesValue(new Uint8Array())), '')
})
