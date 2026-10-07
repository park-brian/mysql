// M2.14 — index key encoding. Doc 24 §Index key encoding.
//
// "Index keys use the same per-column encodings, concatenated in index order."
// Two additions:
//
//   For a nullable indexed column, a 1-byte NULL flag precedes the value in
//   key comparisons (in the record itself, the null bitmap serves this role).
//
//   For prefix indexes (`KEY (col(10))`), only the first n bytes — characters,
//   for a character column — are stored.
//
// And the whole point, from doc 24: because integers, temporals and DECIMAL
// are all encoded to be `memcmp`-ordered, comparing two index keys is a byte
// comparison — **except** for character columns, where the collation's sort
// key must be used, and FLOAT/DOUBLE, which are compared numerically.
//
// So this module's contract is narrow and load-bearing: everything it emits is
// `memcmp`-ordered. A float column goes through a transform that makes it so
// (M4.23): its stored little-endian IEEE bytes become a big-endian double with
// the sign bit flipped, or every bit flipped for a negative — the standard
// order-preserving map, with −0 folded into 0 because MySQL compares them equal.
// A descending part (MySQL 8's `DESC` index) is its ascending bytes
// complemented, which reverses `memcmp` order exactly because every part has a
// fixed width — the same D-35 width that makes concatenation unambiguous.
//
// D-35 is what makes that contract actually true for a PAD SPACE character
// column. Such a collation compares `'a'` *greater* than `'a\x01'` — the
// shorter value is extended with spaces and 0x20 > 0x01 — which no
// variable-length sort key can express, and concatenating variable-length
// parts is ambiguous besides. Both are fixed by the same thing: a declared
// width, padded to.
//
// A NO PAD collation needs neither, and a width does it harm (D-55): its sort
// key can be far longer than its value — `utf8mb4_0900_ai_ci`, the default,
// weighs `'ß'` as `'ss'` and `'ﷺ'` as eight weights — so no width a column's
// declared length implies is safe, and the one that is would be enormous. So a
// NO PAD part is its sort key with every 0x00 written `00 ff`, then `00 00`.
// That is prefix-free and keeps `memcmp` order — the terminator sorts below
// every continuation — so it concatenates unambiguously and complements to its
// exact reverse, with no width at all.
import { collation, type Collation } from '@myjs/charsets'
import { badValue } from './errors.ts'
import { compareFloat, decodeDouble, decodeFloat } from './floats.ts'

/**
 * How a column contributes to a key.
 *
 * `bytes` — already `memcmp`-ordered storage bytes (integers, temporals,
 * DECIMAL, BINARY): used as they are.
 *
 * `text` — a character column: the collation's `sortKey` is used instead of
 * the value, which is the single hardest part of matching MySQL's ordering
 * (doc 24 defers to doc 29 here, and doc 29 explains why `Intl.Collator`
 * cannot supply it).
 *
 * `float` — FLOAT or DOUBLE: not `memcmp`-ordered as stored, so the stored
 * little-endian bytes are mapped to an order-preserving 8-byte form first.
 */
export type KeyPartKind = 'bytes' | 'text' | 'float'

export interface KeyPart {
  readonly kind: KeyPartKind
  readonly nullable: boolean
  /** Collation id, required when `kind` is `'text'`. */
  readonly collationId?: number
  /**
   * Prefix length. Bytes for `'bytes'`, characters for `'text'` — which is why
   * `KEY (col(255))` on utf8mb4 budgets 1020 bytes and not 255.
   */
  readonly prefix?: number
  /**
   * The byte width this part's key occupies, before the NULL flag (D-35).
   *
   * For a NO PAD `'text'` part it is only the budget an index is sized by: the
   * key is variable-length (D-55), and a value whose sort key is longer is
   * still encoded — the engine checks the key's real length against the page.
   *
   * **Required for every PAD SPACE `'text'` part**, for two independent reasons.
   *
   * A PAD SPACE collation compares `'a'` equal to `'a '`, and — less
   * obviously — compares `'a'` *greater* than `'a\x01'`, because the shorter
   * value is extended with spaces and 0x20 > 0x01. Neither is expressible by a
   * variable-length sort key: only bringing both keys to a common width makes
   * `memcmp` agree with the collation, which is what MySQL's `strnxfrm` does
   * with `nweights`.
   *
   * And a variable-length part is ambiguous in a multi-part key regardless of
   * padding: `'ab' + 'c'` and `'a' + 'bc'` concatenate to the same bytes.
   *
   * A fixed-length part — an integer, a temporal, DECIMAL — needs no width:
   * its encoding is already a constant size, so concatenation is unambiguous
   * and there is nothing to pad. Set it only where the length can vary.
   */
  readonly width?: number
  /** A `DESC` part: its bytes complemented, so a scan in key order runs high to low (NULL last). */
  readonly descending?: boolean
  /**
   * A `CHAR` column: trailing spaces are not part of the value — MySQL strips
   * them when it reads one — so they are not part of the key, under NO PAD
   * included. Applied before the prefix.
   */
  readonly trimSpaces?: boolean
}

/**
 * The NULL flag byte.
 *
 * `0x00` for NULL and `0x01` for present, so that under `memcmp` NULL sorts
 * first — which is where MySQL puts it in an ascending index.
 */
const NULL_FLAG = 0x00
const PRESENT_FLAG = 0x01

function collationFor(part: KeyPart): Collation {
  if (part.collationId === undefined) throw badValue('index key', "a 'text' key part needs a collation id")
  return collation(part.collationId)
}

/**
 * Truncate to a prefix. For text this counts **characters**, which for a
 * variable-width charset means decoding far enough to find the boundary — so
 * it is done on the value, before the sort key is taken, exactly as MySQL
 * does. Truncating a sort key instead would cut a weight in half.
 */
function applyPrefix(value: Uint8Array, part: KeyPart): Uint8Array {
  if (part.prefix === undefined) return value
  if (part.kind !== 'text') return value.subarray(0, part.prefix)
  const { mbmaxlen } = collationFor(part)
  if (mbmaxlen === 1) return value.subarray(0, part.prefix)
  // Multi-byte: walk UTF-8 lead bytes. Every charset we can currently build a
  // sort key for is UTF-8 or single-byte, and a non-UTF-8 multi-byte charset
  // has no collation implementation yet, so it cannot reach here.
  let at = 0
  let chars = 0
  while (at < value.length && chars < part.prefix) {
    const b = value[at] as number
    at += b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4
    chars++
  }
  return value.subarray(0, Math.min(at, value.length))
}

/**
 * Bring a key to its declared width (D-35).
 *
 * PAD SPACE pads with the collation's own pad character and stops there: two
 * values that compare equal now have identical bytes, and trailing pad is
 * insignificant by definition, so nothing more is needed.
 *
 * Everything else pads with NUL and appends the unpadded length. The length is
 * not decoration: NUL padding alone cannot tell `'a'` from `'a\x00'`, which
 * under NO PAD are different values, and a unique index that confused them
 * would reject a row MySQL accepts. A *suffix* rather than a prefix, because a
 * leading length would order `'b'` before `'aa'`.
 */
function padToWidth(key: Uint8Array, width: number, unit: Uint8Array | null): Uint8Array {
  if (key.length > width) {
    throw badValue('index key', `a ${key.length}-byte key does not fit a declared width of ${width}`)
  }
  if (unit !== null) {
    const out = new Uint8Array(width)
    out.set(key)
    for (let i = key.length; i < width; i++) out[i] = unit[(i - key.length) % unit.length] as number
    return out
  }
  const out = new Uint8Array(width + 2)
  out.set(key)
  out[width] = (key.length >> 8) & 0xff
  out[width + 1] = key.length & 0xff
  return out
}

/**
 * The width to declare for a `'text'` key part over `chars` characters (D-35).
 *
 * A declared width is bytes, but a column is declared in characters, and the
 * ratio is the collation's — not the charset's. That distinction is the whole
 * reason this function exists: `CHAR(4)` in `utf8mb4` holds at most 16 bytes,
 * so `mbmaxlen * chars` looks like the answer, but the *key* is 12 bytes under
 * `utf8mb4_bin` (three per code point) and 8 under `utf8mb4_0900_ai_ci` (one
 * two-byte weight per character). Declaring 16 wastes four bytes per key in
 * one case and, worse, declaring 8 for `utf8mb4_bin` rejects legal values.
 *
 * `padUnit` is already defined as one character's worth of key, so its length
 * is the ratio and there is nothing else to keep in sync.
 */
export function declaredKeyWidth(collationId: number, chars: number): number {
  return collation(collationId).padUnit.length * chars
}

/** One column's contribution to a key, sort key, padding and NULL flag included. */
export function encodeKeyPart(value: Uint8Array | null, part: KeyPart): Uint8Array {
  if (part.descending === true && part.kind === 'bytes' && part.prefix !== undefined && part.width === undefined) {
    throw badValue('index key', 'a descending prefix part needs a declared width: complementing a variable-length key does not reverse its order')
  }
  const ascending = encodeAscending(value, part)
  return part.descending === true ? ascending.map((b) => b ^ 0xff) : ascending
}

function encodeAscending(value: Uint8Array | null, part: KeyPart): Uint8Array {
  const c = part.kind === 'text' ? collationFor(part) : undefined
  if (c?.padAttribute === 'PAD SPACE' && part.width === undefined) {
    throw badValue('index key', "a PAD SPACE 'text' key part needs a declared width (D-35)")
  }
  if (value === null) {
    if (!part.nullable) throw badValue('index key', 'null value for a NOT NULL key part')
    return Uint8Array.from([NULL_FLAG])
  }
  const truncated = applyPrefix(part.trimSpaces === true ? trimSpaces(value) : value, part)
  let encoded: Uint8Array
  if (c !== undefined && c.padAttribute !== 'PAD SPACE') {
    encoded = terminated(c.sortKey(truncated))
  } else if (c !== undefined) {
    const padded = c.padUnit
    const width = part.width as number
    // A width that is not a whole number of characters would be padded with a
    // *fragment* of the pad character — `00 00` of `utf8mb4_bin`'s `00 00 20`
    // — and two keys padded to different phases no longer compare the way
    // their values do. Cheap to check, and impossible to see in a hex dump.
    if (width % padded.length !== 0) {
      throw badValue(
        'index key',
        `a declared width of ${width} is not a whole number of ${padded.length}-byte characters — see declaredKeyWidth()`,
      )
    }
    encoded = padToWidth(c.sortKey(truncated), width, padded)
  } else if (part.kind === 'float') {
    encoded = floatKey(truncated)
  } else {
    encoded = part.width === undefined ? truncated : padToWidth(truncated, part.width, null)
  }
  if (!part.nullable) return encoded
  const out = new Uint8Array(encoded.length + 1)
  out[0] = PRESENT_FLAG
  out.set(encoded, 1)
  return out
}

/** Trailing 0x20 bytes removed: a CHAR value as MySQL reads it. */
function trimSpaces(value: Uint8Array): Uint8Array {
  let end = value.length
  while (end > 0 && value[end - 1] === 0x20) end--
  return value.subarray(0, end)
}

/**
 * A NO PAD sort key as a prefix-free, order-keeping byte string (D-55): each
 * 0x00 becomes `00 ff`, and `00 00` ends it. Where two keys first differ, either
 * both bytes are ordinary — the order is the sort keys' — or one key has ended,
 * and its `00 00` is below whatever the other has there, as a shorter key is.
 */
function terminated(key: Uint8Array): Uint8Array {
  let zeros = 0
  for (const b of key) if (b === 0) zeros++
  const out = new Uint8Array(key.length + zeros + 2)
  let at = 0
  for (const b of key) {
    out[at++] = b
    if (b === 0) out[at++] = 0xff
  }
  return out
}

/**
 * A FLOAT (4 bytes) or DOUBLE (8), as stored — little-endian IEEE (doc 24
 * Rule 2) — as 8 bytes whose `memcmp` order is the values' numeric order: a
 * big-endian double with the sign bit flipped, or with every bit flipped when
 * it is negative. −0 becomes 0, which MySQL compares equal to it. NaN cannot be
 * stored in MySQL and is refused rather than given a place.
 */
function floatKey(stored: Uint8Array): Uint8Array {
  if (stored.length !== 4 && stored.length !== 8) throw badValue('index key', `a ${stored.length}-byte FLOAT or DOUBLE`)
  let n = stored.length === 4 ? decodeFloat(stored) : decodeDouble(stored)
  if (Number.isNaN(n)) throw badValue('index key', 'NaN in a FLOAT or DOUBLE key')
  if (n === 0) n = 0
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, n)
  if (((out[0] as number) & 0x80) !== 0) for (let i = 0; i < 8; i++) out[i] = (out[i] as number) ^ 0xff
  else out[0] = (out[0] as number) ^ 0x80
  return out
}

/**
 * How many bytes of `key`, from `at`, one part's encoding takes — the inverse
 * a reader needs to split a concatenated key, such as a secondary entry's own
 * key from the primary key after it. `fixed` is the value's width for a
 * `'bytes'` part that declares none (an integer, a temporal). Malformed bytes
 * are `ER_TRUNCATED_WRONG_VALUE`, never a read past the key.
 */
export function keyPartLength(key: Uint8Array, at: number, part: KeyPart, fixed?: number): number {
  const flip = part.descending === true ? 0xff : 0
  const byte = (i: number): number => {
    if (i >= key.length) throw badValue('index key', `a key part runs past the ${key.length}-byte key`)
    return (key[i] as number) ^ flip
  }
  let n = 0
  if (part.nullable) {
    if (byte(at) === NULL_FLAG) return 1
    n = 1
  }
  let body: number
  if (part.kind === 'float') body = 8
  else if (part.kind === 'text' && collationFor(part).padAttribute !== 'PAD SPACE') {
    let i = at + n
    for (;;) {
      if (byte(i) === 0) {
        if (byte(i + 1) === 0) break
        i += 2
      } else i++
    }
    body = i + 2 - (at + n)
  } else if (part.kind === 'text') body = part.width as number
  else if (part.width !== undefined) body = part.width + 2
  else if (fixed !== undefined) body = Math.min(fixed, part.prefix ?? fixed)
  else throw badValue('index key', 'a variable-length bytes part with no width cannot be split')
  if (at + n + body > key.length) throw badValue('index key', `a key part runs past the ${key.length}-byte key`)
  return n + body
}

/**
 * A whole index key: the parts concatenated in index order.
 *
 * The result is `memcmp`-comparable against any other key built from the same
 * parts, which is the property M4's B+tree is built on — and which, before
 * D-35, was not actually true for a character column: see `KeyPart.width`.
 */
export function encodeKey(values: ReadonlyArray<Uint8Array | null>, parts: readonly KeyPart[]): Uint8Array {
  if (values.length !== parts.length) {
    throw badValue('index key', `${values.length} values for ${parts.length} key parts`)
  }
  // A variable-length part before another part makes the concatenation
  // ambiguous — `'ab' + 'c'` and `'a' + 'bc'` are the same bytes — so a
  // truncating `'bytes'` part must declare its width unless it is last.
  // `'text'` parts always declare one, checked in `encodeKeyPart`.
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as KeyPart
    if (part.kind === 'bytes' && part.prefix !== undefined && part.width === undefined) {
      throw badValue('index key', `key part ${i} is variable-length and not last, so it needs a width (D-35)`)
    }
  }
  const encoded = parts.map((part, i) => encodeKeyPart(values[i] ?? null, part))
  let total = 0
  for (const e of encoded) total += e.length
  const out = new Uint8Array(total)
  let at = 0
  for (const e of encoded) {
    out.set(e, at)
    at += e.length
  }
  return out
}

/**
 * The comparator for a value that cannot be `memcmp`-ordered.
 *
 * Exported so that a caller who has a FLOAT column knows there is an answer,
 * and knows it is not a key encoding. Doc 24 Rule 2: `cmp_data()` switches on
 * `DATA_DOUBLE`/`DATA_FLOAT` and compares the decoded values.
 */
export { compareFloat }
