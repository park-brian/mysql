// M2.3 — charset encode and decode.
//
// Doc 29 says "`TextDecoder`/`TextEncoder` handle `utf-8`, `utf-16`, and most
// legacy encodings natively in both Node and browsers, so the encoding layer
// is mostly a matter of mapping MySQL charset names to WHATWG labels."
//
// **That assumption is false, and it cost us a silent corruption bug**
// (erratum E-11). On a runtime built without full ICU — the GitHub Actions
// runner, among others — `new TextDecoder('windows-1252')` does not throw. It
// succeeds and quietly behaves as ISO-8859-1, because the only single-byte
// decoder such a build has is Latin-1 and every label in that family resolves
// to it. So MySQL's `latin1` decoded `0x80` to `U+0080` instead of `€`, no
// error was raised anywhere, and the wrong character reached the application
// as data. The reverse table built from that decoder then encoded `€` as `?`.
//
// So the single-byte charsets no longer go through `TextDecoder` at all: their
// byte -> code point tables are generated from MySQL's own `CHARSET_INFO`
// (`encodings.ts`), which makes them correct on every runtime and identical on
// all of them. That is the argument D-23 makes about `Intl.Collator`, applied
// one layer down: bytes that land in a database must not depend on which build
// of which engine wrote them.
//
// What remains on `TextDecoder` is UTF-8, the UTF-16 family, and the
// multi-byte legacy charsets, which are far too large to carry. Those are
// probed rather than trusted — see `rejectsLatin1Substitute` below.
import { unsupportedCharset } from './errors.ts'
import { requireCollationInfo } from './collation.ts'
import { PACKED_CHARSET_TO_UNI } from './encodings.ts'
import { expandRuns } from './runs.ts'

/**
 * MySQL charset name → WHATWG encoding label.
 *
 * `null` marks a charset `TextDecoder` cannot do and that therefore needs a
 * generated table before it can be supported (doc 29 names `gb18030` and the
 * `filename` internal charset among them). A `null` here produces a typed
 * error, never a silently wrong decode.
 */
const WHATWG_LABEL: Readonly<Record<string, string | null>> = {
  // Unicode.
  utf8mb4: 'utf-8',
  utf8mb3: 'utf-8', // deprecated; 3-byte subset, so utf-8 decodes it correctly
  utf16: 'utf-16be',
  utf16le: 'utf-16le',
  ucs2: 'utf-16be', // BMP-only in MySQL, but the byte layout is UTF-16BE
  utf32: null, // WHATWG dropped UTF-32 entirely

  // Single-byte.
  // MySQL's `latin1` is cp1252: `0x80` is `€`. Not `iso-8859-1`. Served by
  // the generated table, not by this label — the label is kept only so that
  // `WHATWG_LABEL` stays a complete statement of what each charset is.
  latin1: 'windows-1252',
  latin2: 'iso-8859-2',
  latin5: 'iso-8859-9',
  latin7: 'iso-8859-13',
  ascii: 'windows-1252', // ASCII is a subset; the high half is never valid input
  cp1250: 'windows-1250',
  cp1251: 'windows-1251',
  cp1256: 'windows-1256',
  cp1257: 'windows-1257',
  cp850: 'ibm866', // not exact — see UNSUPPORTED below
  cp852: null,
  cp866: 'ibm866',
  koi8r: 'koi8-r',
  koi8u: 'koi8-u',
  greek: 'iso-8859-7',
  hebrew: 'iso-8859-8',
  tis620: 'windows-874',
  macroman: 'macintosh',
  macce: 'x-mac-cyrillic', // not exact — see UNSUPPORTED below
  dec8: null,
  hp8: null,
  swe7: null,
  armscii8: null,
  geostd8: null,
  keybcs2: null,

  // East Asian.
  big5: 'big5',
  gbk: 'gbk',
  gb2312: 'gbk', // GBK is a superset of GB2312
  gb18030: 'gb18030',
  sjis: 'shift_jis',
  cp932: 'shift_jis', // MySQL distinguishes them; WHATWG's shift_jis is cp932-like
  ujis: 'euc-jp',
  eucjpms: 'euc-jp',
  euckr: 'euc-kr',

  // MySQL internals, never a column or connection charset.
  binary: null,
  filename: null,
}

/**
 * Charsets whose WHATWG label above is an approximation rather than an
 * identity. Named explicitly so the inexactness is a recorded fact rather
 * than a lurking bug.
 *
 * B0 emptied most of this list by generating the tables: `cp850`, `macce` and
 * `ascii` were all approximations and are now exact. The two that remain are
 * multi-byte, which is why they still borrow a label — `cp932` is served by
 * `shift_jis` and `gb2312` by `gbk`, each a near neighbour rather than the
 * same encoding.
 */
export const APPROXIMATE_CHARSETS: readonly string[] = ['cp932', 'gb2312']

const decoders = new Map<string, TextDecoder>()
const encoder = new TextEncoder()

// --- the generated single-byte tables --------------------------------------

/** `charset -> 256 code points`, expanded from the packed table on first use. */
let toUni: Map<string, Uint16Array> | null = null

function singleByteTable(charset: string): Uint16Array | undefined {
  if (toUni === null) {
    toUni = new Map()
    for (const line of PACKED_CHARSET_TO_UNI.split('\n')) {
      const at = line.indexOf(' ')
      toUni.set(line.slice(0, at), Uint16Array.from(expandRuns(line.slice(at + 1), 0, 256)))
    }
  }
  return toUni.get(charset)
}

/** `charset -> code point -> byte`, the inverse, built from the same table. */
const fromUni = new Map<string, Map<number, number>>()

function singleByteInverse(charset: string, table: Uint16Array): Map<number, number> {
  let inverse = fromUni.get(charset)
  if (inverse === undefined) {
    inverse = new Map<number, number>()
    // First byte wins, so ASCII maps to itself wherever a charset has a second
    // byte decoding to the same character. Byte 0 is entered before any of the
    // unmapped 0 entries, so U+0000 correctly encodes to 0x00 and an undefined
    // high byte contributes nothing.
    for (let i = 0; i < 256; i++) {
      const cp = table[i] as number
      if (cp === 0 && i !== 0) continue
      if (!inverse.has(cp)) inverse.set(cp, i)
    }
    fromUni.set(charset, inverse)
  }
  return inverse
}

// --- what is left on TextDecoder -------------------------------------------

/**
 * Reject a decoder that is really the Latin-1 substitute.
 *
 * A runtime without full ICU has exactly one single-byte decoder, and every
 * label in the Latin-1 family resolves to it silently. That is general enough
 * to test generally: bytes `0x80`–`0x9F` are C1 controls in ISO-8859-1 and are
 * *never* those code points in any charset we route here — in UTF-8 and
 * UTF-16 they are malformed, and in every multi-byte legacy charset they are
 * lead bytes or unassigned. So a decoder that returns exactly `U+0080`–`U+009F`
 * for them is not the decoder we asked for.
 *
 * One check, no per-charset table of expected characters — which would be the
 * hand-maintained second source of truth D-14 and M2.17 exist to avoid.
 */
export function rejectsLatin1Substitute(decoder: TextDecoder): boolean {
  const c1 = new Uint8Array(32)
  for (let i = 0; i < 32; i++) c1[i] = 0x80 + i
  let identity = ''
  for (let i = 0; i < 32; i++) identity += String.fromCharCode(0x80 + i)
  return decoder.decode(c1) !== identity
}

function decoderFor(charset: string): TextDecoder {
  const cached = decoders.get(charset)
  if (cached !== undefined) return cached
  const label = WHATWG_LABEL[charset]
  if (label === null || label === undefined) throw unsupportedCharset(charset)
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(label)
  } catch {
    // A runtime built without the full encoding set. This branch is real, and
    // it is *not* the only way that happens — see the probe below.
    throw unsupportedCharset(charset)
  }
  if (!rejectsLatin1Substitute(decoder)) throw unsupportedCharset(charset)
  decoders.set(charset, decoder)
  return decoder
}

/**
 * Whether this runtime can decode the charset at all.
 *
 * True for every charset with a generated table, whatever the runtime — which
 * is the point of generating them.
 */
export function canDecode(charset: string): boolean {
  if (singleByteTable(charset) !== undefined) return true
  try {
    decoderFor(charset)
    return true
  } catch {
    return false
  }
}

/**
 * A byte with no character in this charset.
 *
 * MySQL writes 0 in `to_uni` for a byte the charset does not define, and 128
 * of `ascii`'s 256 entries are exactly that. The sentinel is only ambiguous
 * for byte `0x00`, which every one of these charsets maps to U+0000 — so the
 * byte itself disambiguates it, and no charset can map some other byte to NUL
 * because U+0000 has exactly one encoding.
 *
 * Substituting U+FFFD is what a WHATWG decoder does for an unmappable byte,
 * and it is the second bug these tables exposed: `ascii` used to be decoded
 * through the `windows-1252` label, so a high byte in an `ascii` column came
 * back as a cp1252 character that the charset cannot represent at all.
 */
const UNMAPPED = 0xfffd

/** Bytes → string, in the named MySQL charset. */
export function decodeCharset(bytes: Uint8Array, charset: string): string {
  const table = singleByteTable(charset)
  if (table === undefined) return decoderFor(charset).decode(bytes)
  // One code point per byte, by definition of a single-byte charset.
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    const cp = table[b] as number
    out += String.fromCharCode(cp === 0 && b !== 0 ? UNMAPPED : cp)
  }
  return out
}

/**
 * String → bytes, in the named MySQL charset.
 *
 * `TextEncoder` only ever emits UTF-8 — the WHATWG spec deliberately removed
 * legacy encoders — so everything else goes through a table in reverse. For
 * the single-byte charsets that is now the *generated* table inverted, not a
 * decoder's output inverted, which is what makes the euro sign encodable on a
 * runtime whose decoder never knew about it.
 *
 * A multi-byte legacy charset has no cheap inverse and says so.
 */
export function encodeCharset(text: string, charset: string): Uint8Array {
  const label = WHATWG_LABEL[charset]
  if (label === 'utf-8') return encoder.encode(text)
  const table = singleByteTable(charset)
  if (table === undefined) throw unsupportedCharset(charset)
  const map = singleByteInverse(charset, table)
  const out = new Uint8Array(text.length)
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    const byte = map.get(cp)
    // MySQL substitutes `?` for a character the charset cannot hold, and
    // raises a warning rather than an error. Match that.
    out[n++] = byte ?? 0x3f
  }
  return out.subarray(0, n)
}

/** Decode using a collation id rather than a charset name — what the wire carries. */
export function decodeCollation(bytes: Uint8Array, collationId: number): string {
  return decodeCharset(bytes, requireCollationInfo(collationId).charset)
}

/** Encode using a collation id rather than a charset name. */
export function encodeCollation(text: string, collationId: number): Uint8Array {
  return encodeCharset(text, requireCollationInfo(collationId).charset)
}
