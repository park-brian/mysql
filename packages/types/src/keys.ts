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

/** One column's contribution to a key, sort key and NULL flag included. */
export function encodeKeyPart(value: Uint8Array | null, part: KeyPart): Uint8Array {
  if (part.kind === 'float') {
    throw unsupportedType('a FLOAT or DOUBLE index key part — it is not memcmp-ordered (doc 24 Rule 2)')
  }
  if (value === null) {
    if (!part.nullable) throw badValue('index key', 'null value for a NOT NULL key part')
    return Uint8Array.from([NULL_FLAG])
  }
  const truncated = applyPrefix(value, part)
  const encoded = part.kind === 'text' ? collationFor(part).sortKey(truncated) : truncated
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
 * parts, which is the property M4's B+tree is built on.
 */
export function encodeKey(values: ReadonlyArray<Uint8Array | null>, parts: readonly KeyPart[]): Uint8Array {
  if (values.length !== parts.length) {
    throw badValue('index key', `${values.length} values for ${parts.length} key parts`)
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
