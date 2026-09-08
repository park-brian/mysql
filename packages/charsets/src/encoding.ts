// M2.3 — charset encode/decode over `TextEncoder`/`TextDecoder`.
//
// Doc 29: "`TextDecoder`/`TextEncoder` handle `utf-8`, `utf-16`, and most
// legacy encodings natively in both Node and browsers, so the encoding layer
// is mostly a matter of mapping MySQL charset names to WHATWG labels."
//
// The one to be careful with is `latin1`. MySQL's `latin1` is **cp1252**, not
// ISO-8859-1, and the difference is real characters in 0x80–0x9F — `0x80` is
// `€`, not a control code. Getting this wrong corrupts every European dump.
import { unsupportedCharset } from './errors.ts'
import { requireCollationInfo } from './collation.ts'

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
  // MySQL's `latin1` is cp1252: `0x80` is `€`. Not `iso-8859-1`.
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
 * than a lurking bug: these need generated tables to be exactly right, which
 * is deferred until something actually asks for them.
 */
export const APPROXIMATE_CHARSETS: readonly string[] = ['cp850', 'macce', 'cp932', 'gb2312', 'ascii']

const decoders = new Map<string, TextDecoder>()
const encoder = new TextEncoder()

function decoderFor(charset: string): TextDecoder {
  const cached = decoders.get(charset)
  if (cached !== undefined) return cached
  const label = WHATWG_LABEL[charset]
  if (label === null || label === undefined) throw unsupportedCharset(charset)
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(label)
  } catch {
    // A runtime built without the full encoding set. Doc 29 assumes these are
    // present in both Node and browsers, but say so rather than crash.
    throw unsupportedCharset(charset)
  }
  decoders.set(charset, decoder)
  return decoder
}

/** Whether this runtime can decode the charset at all. */
export function canDecode(charset: string): boolean {
  try {
    decoderFor(charset)
    return true
  } catch {
    return false
  }
}

/** Bytes → string, in the named MySQL charset. */
export function decodeCharset(bytes: Uint8Array, charset: string): string {
  return decoderFor(charset).decode(bytes)
}

/**
 * String → bytes, in the named MySQL charset.
 *
 * `TextEncoder` only ever emits UTF-8 — the WHATWG spec deliberately removed
 * legacy encoders — so anything else has to go through the decode table in
 * reverse. That table is built lazily, once, per charset, and only for the
 * single-byte charsets where it is 256 entries; a multi-byte legacy charset
 * needs a generated table and says so.
 */
export function encodeCharset(text: string, charset: string): Uint8Array {
  const label = WHATWG_LABEL[charset]
  if (label === 'utf-8') return encoder.encode(text)
  return singleByteEncoder(charset)(text)
}

const reverseTables = new Map<string, Map<number, number>>()

function singleByteEncoder(charset: string): (text: string) => Uint8Array {
  let reverse = reverseTables.get(charset)
  if (reverse === undefined) {
    const decoder = decoderFor(charset)
    // A single-byte charset is exactly the one whose 256 byte values each
    // decode to one character. Build the inverse and refuse anything else.
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i++) all[i] = i
    const decoded = decoder.decode(all)
    if (decoded.length !== 256) throw unsupportedCharset(charset)
    reverse = new Map<number, number>()
    for (let i = 0; i < 256; i++) {
      const cp = decoded.codePointAt(i)
      // First byte wins, so ASCII maps to itself even where a charset has a
      // second byte decoding to the same character.
      if (cp !== undefined && !reverse.has(cp)) reverse.set(cp, i)
    }
    reverseTables.set(charset, reverse)
  }
  const map = reverse
  return (text: string) => {
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
}

/** Decode using a collation id rather than a charset name — what the wire carries. */
export function decodeCollation(bytes: Uint8Array, collationId: number): string {
  return decodeCharset(bytes, requireCollationInfo(collationId).charset)
}

/** Encode using a collation id rather than a charset name. */
export function encodeCollation(text: string, collationId: number): Uint8Array {
  return encodeCharset(text, requireCollationInfo(collationId).charset)
}
