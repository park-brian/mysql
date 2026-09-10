// M2.3, M2.4 — encoding, and the limits `mbmaxlen` drives.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROXIMATE_CHARSETS,
  CharsetError,
  MAX_KEY_PREFIX_BYTES_DYNAMIC,
  byteLengthFor,
  canDecode,
  decodeCharset,
  decodeCollation,
  encodeCharset,
  encodeCollation,
  expandRuns,
  maxPrefixCharacters,
  maxVarcharCharacters,
  rejectsLatin1Substitute,
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

test('M2.3: a charset we cannot decode raises a typed error, never a wrong decode', () => {
  assert.equal(canDecode('utf8mb4'), true)
  assert.equal(canDecode('latin1'), true)
  // B0: the generated tables cover every single-byte charset MySQL's struct
  // names, so seven charsets that used to be undecodable now decode — `swe7`
  // among them, which this test previously asserted could *not* be decoded.
  // The assertion got stronger, not weaker.
  for (const cs of ['swe7', 'dec8', 'hp8', 'armscii8', 'geostd8', 'keybcs2', 'cp852']) {
    assert.equal(canDecode(cs), true, cs)
  }
  // `binary` is not text at all — doc 29: id 63 "is not a text collation".
  assert.equal(canDecode('binary'), false)
  assert.throws(() => decodeCharset(Uint8Array.from([1]), 'binary'), CharsetError)
  // `filename` is a MySQL internal, never a column or connection charset.
  assert.equal(canDecode('filename'), false)
  assert.throws(() => decodeCharset(Uint8Array.from([1]), 'filename'), CharsetError)
})

test('B0: latin1 decodes from the generated table, not from the runtime', async () => {
  // The bug this fixes was invisible on a full-ICU machine, so the assertion
  // has to be about *where the answer comes from*, not only what it is: the
  // packed table itself must say 0x80 is the euro sign, with no `TextDecoder`
  // involved. A runtime whose cp1252 decoder is really ISO-8859-1 cannot make
  // this pass and cannot make it fail.
  const { PACKED_CHARSET_TO_UNI } = await import('@myjs/charsets')
  const line = PACKED_CHARSET_TO_UNI.split('\n').find((l) => l.startsWith('latin1 '))
  assert.ok(line, 'latin1 must have a generated table')
  const table = expandRuns(line.slice('latin1 '.length), 0, 256)
  assert.equal(table[0x80], 0x20ac, 'MySQL latin1 is cp1252: 0x80 is the euro sign')
  assert.equal(table[0x41], 0x41, 'the ASCII half is identity')
  // And the public API agrees with the table it is built from.
  assert.equal(decodeCharset(Uint8Array.from([0x80]), 'latin1'), String.fromCharCode(0x20ac))
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

test('B0: the probe rejects a decoder that is really the Latin-1 substitute', () => {
  // The mechanism that made the bug silent, tested directly. A runtime without
  // full ICU resolves every Latin-1-family label to one decoder, so asking for
  // cp1252 and getting ISO-8859-1 raises nothing.
  //
  // The substitute has to be hand-built rather than requested by label,
  // because WHATWG maps `iso-8859-1` *to* windows-1252 — so on a full-ICU
  // machine there is no label that yields true ISO-8859-1, and asking for one
  // would test a working decoder instead of a broken one.
  const trueLatin1 = {
    encoding: 'windows-1252',
    decode(bytes?: Uint8Array): string {
      let out = ''
      for (const b of bytes ?? []) out += String.fromCharCode(b)
      return out
    },
  } as unknown as TextDecoder
  assert.equal(rejectsLatin1Substitute(trueLatin1), false, 'C1 bytes decoding to C1 controls means Latin-1')
  assert.equal(rejectsLatin1Substitute(new TextDecoder('utf-8')), true)
  assert.equal(rejectsLatin1Substitute(new TextDecoder('windows-1252')), true, 'a real cp1252 passes')
})

test('B0: a byte the charset does not define decodes to U+FFFD, not to NUL', () => {
  // MySQL writes 0 in `to_uni` for an undefined byte, and 128 of `ascii`'s 256
  // entries are exactly that. Taking the 0 literally would turn every high
  // byte in an `ascii` column into a NUL; the old code was worse still, since
  // `ascii` borrowed the `windows-1252` label and returned cp1252 characters
  // that the charset cannot represent at all.
  const replacement = String.fromCharCode(0xfffd)
  const nul = String.fromCharCode(0)
  assert.equal(decodeCharset(Uint8Array.of(0x80), 'ascii'), replacement)
  assert.equal(decodeCharset(Uint8Array.of(0x41), 'ascii'), 'A')
  // The sentinel is only ambiguous at byte 0, and the byte itself settles it:
  // U+0000 has exactly one encoding, so no other byte can mean NUL.
  assert.equal(decodeCharset(Uint8Array.of(0x00), 'ascii'), nul)
  assert.equal(decodeCharset(Uint8Array.of(0x00), 'latin1'), nul)
  // And the inverse never learns a mapping from the sentinel: NUL still
  // encodes to 0x00 rather than to whichever undefined byte came first.
  assert.deepEqual(encodeCharset(nul, 'ascii'), Uint8Array.of(0x00))
  assert.deepEqual(encodeCharset(nul, 'latin1'), Uint8Array.of(0x00))
})

test('B0: three charsets stopped being approximations', () => {
  // `cp850`, `macce` and `ascii` were all borrowing a near-neighbour WHATWG
  // label and are now exact. What is left is multi-byte, which is why it still
  // borrows one.
  assert.deepEqual([...APPROXIMATE_CHARSETS].sort(), ['cp932', 'gb2312'])
})
