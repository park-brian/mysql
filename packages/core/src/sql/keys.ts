// M5.5 — a value as a hash key: two values get the same key exactly when MySQL
// would put them in one group.
//
// Grouping, DISTINCT, UNION and a hash join all ask "is this the same value?"
// many times over, and the answer must be the comparison's own, not
// JavaScript's: under `utf8mb4_0900_ai_ci` `'ann'` and `'ÄNN'` are one group,
// under a PAD SPACE collation `'a'` and `'a '` are, and `1.50` is `1.5`. So a
// string's key is `equalityKey`'s (its sort key, a PAD SPACE collation's
// trailing pad weights dropped), a number's is its exact decimal with no
// trailing zeros, and a temporal's is its ordinal text. `distinct()` compared
// each row against every earlier one; a key makes it one lookup.
import { CHARSET_BINARY, hex } from '@myjs/bytes'
import { encodeCollation } from '@myjs/charsets'
import { equalityKey, jsonKey, renderDecimal, toText, type Value } from '@myjs/types'

/** Keep the integer part and remove only padding on a fractional part. */
function trimFraction(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

export const NULL_VALUE_KEY = 'N'

/** A byte sequence as a string key, preserving every byte and its order. */
export function byteKey(bytes: Uint8Array): string {
  let key = ''
  for (const byte of bytes) key += String.fromCharCode(byte)
  return key
}

/** The key of one value. */
export function valueKey(v: Value): string {
  if (v === null) return NULL_VALUE_KEY
  switch (v.kind) {
    case 'string': {
      if (v.collationId === CHARSET_BINARY) return `b${hex(encodeCollation(v.v, v.collationId))}`
      return `s${equalityKey(v.v, v.collationId)}`
    }
    case 'bytes':
      return `b${hex(v.v)}`
    case 'int':
      return `n${v.v}`
    case 'decimal':
      return `n${trimFraction(renderDecimal(v))}`
    case 'double':
      return `d${v.v}`
    case 'json':
      return `j${jsonKey(v.v)}`
    case 'datetime':
    case 'time':
      return `t${trimFraction(toText(v))}`
  }
}

/**
 * The key of a row of values: each value's key behind its length, so no
 * value's bytes can be read as a separator (a `latin1_bin` sort key is the
 * text itself, `|` included).
 */
export function rowKey(values: readonly Value[]): string {
  let s = ''
  for (const v of values) {
    const k = valueKey(v)
    s += `${k.length}:${k}`
  }
  return s
}

/** Insert a canonical key once, without a second hash lookup. */
export function firstKey<T>(seen: Set<T>, key: T): boolean {
  const before = seen.size
  seen.add(key)
  return seen.size > before
}
