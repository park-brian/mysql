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
// `memcmp`-ordered. A float column cannot go through it, and says so.
//
// D-35 is what makes that contract actually true for a character column. A
// PAD SPACE collation compares `'a'` *greater* than `'a\x01'` — the shorter
// value is extended with spaces and 0x20 > 0x01 — which no variable-length
// sort key can express, and concatenating variable-length parts is ambiguous
// besides. Both are fixed by the same thing: a declared width, padded to.
import { collation, type Collation } from '@myjs/charsets'
import { badValue, unsupportedType } from './errors.ts'
import { compareFloat } from './floats.ts'

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
 * `float` — FLOAT or DOUBLE: **not** `memcmp`-ordered, so it cannot appear in
 * a key this module builds. Named rather than omitted so the refusal is
 * explicit.
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
   * **Required for every `'text'` part**, for two independent reasons.
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
  if (part.kind === 'float') {
    throw unsupportedType('a FLOAT or DOUBLE index key part — it is not memcmp-ordered (doc 24 Rule 2)')
  }
  if (part.kind === 'text' && part.width === undefined) {
    throw badValue('index key', "a 'text' key part needs a declared width (D-35)")
  }
  if (value === null) {
    if (!part.nullable) throw badValue('index key', 'null value for a NOT NULL key part')
    return Uint8Array.from([NULL_FLAG])
  }
  const truncated = applyPrefix(value, part)
  let encoded: Uint8Array
  if (part.kind === 'text') {
    const c = collationFor(part)
    const padded = c.padAttribute === 'PAD SPACE' ? c.padUnit : null
    const width = part.width as number
    // A width that is not a whole number of characters would be padded with a
    // *fragment* of the pad character — `00 00` of `utf8mb4_bin`'s `00 00 20`
    // — and two keys padded to different phases no longer compare the way
    // their values do. Cheap to check, and impossible to see in a hex dump.
    if (padded !== null && width % padded.length !== 0) {
      throw badValue(
        'index key',
        `a declared width of ${width} is not a whole number of ${padded.length}-byte characters — see declaredKeyWidth()`,
      )
    }
    encoded = padToWidth(c.sortKey(truncated), width, padded)
  } else {
    encoded = part.width === undefined ? truncated : padToWidth(truncated, part.width, null)
  }
  if (!part.nullable) return encoded
  const out = new Uint8Array(encoded.length + 1)
  out[0] = PRESENT_FLAG
  out.set(encoded, 1)
  return out
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
