// M2.3, M2.4 — encoding, and the limits `mbmaxlen` drives.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CharsetError,
  MAX_KEY_PREFIX_BYTES_DYNAMIC,
  byteLengthFor,
  canDecode,
  decodeCharset,
  decodeCollation,
  encodeCharset,
  encodeCollation,
  maxPrefixCharacters,
  maxVarcharCharacters,
  varcharLengthBytes,
} from '@myjs/charsets'
import { columnLengthForCollation } from '@myjs/protocol'

test("M2.3: MySQL's latin1 is cp1252, so 0x80 decodes to the euro sign", () => {
  // Doc 29: "`latin1` is the one to be careful with: MySQL's `latin1` is cp1252
  // (`windows-1252`), *not* `iso-8859-1`, and the difference is real characters
  // in the 0x80–0x9F range." Under iso-8859-1 these would be C1 controls.
  assert.equal(decodeCharset(Uint8Array.from([0x80]), 'latin1'), '€')
  assert.equal(decodeCharset(Uint8Array.from([0x93, 0x94]), 'latin1'), '“”')
  assert.notEqual(decodeCharset(Uint8Array.from([0x80]), 'latin1'), '')
})

test('M2.3: latin1 round-trips through encode and decode', () => {
  assert.deepEqual(encodeCharset('€', 'latin1'), Uint8Array.from([0x80]))
  assert.deepEqual(encodeCharset('café', 'latin1'), Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))
  assert.equal(decodeCharset(encodeCharset('naïve €5', 'latin1'), 'latin1'), 'naïve €5')
})

test('a character the charset cannot hold becomes ?, as MySQL substitutes it', () => {
  assert.deepEqual(encodeCharset('a\u{1F600}b', 'latin1'), Uint8Array.from([0x61, 0x3f, 0x62]))
})

test('utf8mb4 carries the astral plane, which is the whole point of the mb4', () => {
  const emoji = '\u{1F600}'
  assert.equal(decodeCharset(encodeCharset(emoji, 'utf8mb4'), 'utf8mb4'), emoji)
  assert.equal(encodeCharset(emoji, 'utf8mb4').length, 4)
})

test('M2.3: a charset TextDecoder cannot do raises a typed error, never a wrong decode', () => {
  assert.equal(canDecode('utf8mb4'), true)
  assert.equal(canDecode('latin1'), true)
  // `binary` is not text at all, and `swe7` needs a generated table.
  assert.equal(canDecode('binary'), false)
  assert.throws(() => decodeCharset(Uint8Array.from([1]), 'binary'), CharsetError)
  assert.throws(() => decodeCharset(Uint8Array.from([1]), 'swe7'), CharsetError)
})

test('decode by collation id — what the wire actually carries', () => {
  assert.equal(decodeCollation(Uint8Array.from([0x80]), 8), '€') // latin1_swedish_ci
  assert.equal(decodeCollation(encodeCollation('héllo', 255), 255), 'héllo') // utf8mb4_0900_ai_ci
})

test('M2.4: VARCHAR(255) utf8mb4 reports 1020 on the wire', () => {
  // M1.19's acceptance assertion, now answered from the generated width table
  // rather than from a number the caller had to supply.
  assert.equal(columnLengthForCollation(255, 255), 1020)
  assert.equal(byteLengthFor(255, 255), 1020)
  assert.equal(columnLengthForCollation(255, 8), 255) // latin1
})

test('M2.4: VARCHAR(16383) is the utf8mb4 row-limit boundary', () => {
  assert.equal(maxVarcharCharacters(255), 16383)
  assert.equal(maxVarcharCharacters(8), 65533)
})

test('M2.4: KEY (col(255)) budgets 1020 of the 3072 available', () => {
  assert.equal(byteLengthFor(255, 255), 1020)
  assert.equal(maxPrefixCharacters(255), Math.floor(MAX_KEY_PREFIX_BYTES_DYNAMIC / 4))
  assert.equal(maxPrefixCharacters(8), MAX_KEY_PREFIX_BYTES_DYNAMIC)
})

test('M2.4: DATA_LONG_TRUE_VARCHAR turns on at 255 bytes, not 255 characters', () => {
  assert.equal(varcharLengthBytes(255, 8), 1) // latin1: 255 bytes
  assert.equal(varcharLengthBytes(256, 8), 2)
  assert.equal(varcharLengthBytes(64, 255), 2) // utf8mb4: 256 bytes
  assert.equal(varcharLengthBytes(63, 255), 1) // 252 bytes
})
