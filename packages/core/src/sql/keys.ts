// M5.5 — a value as a hash key: two values get the same key exactly when MySQL
// would put them in one group.
//
// Grouping, DISTINCT, UNION and a hash join all ask "is this the same value?"
// many times over, and the answer must be the comparison's own, not
// JavaScript's: under `utf8mb4_0900_ai_ci` `'ann'` and `'ÄNN'` are one group,
// under a PAD SPACE collation `'a'` and `'a '` are, and `1.50` is `1.5`. So a
// string's key is its collation's sort key (with trailing spaces dropped first
// where the collation pads), a number's is its exact decimal with no trailing
// zeros, and a temporal's is its ordinal text. `distinct()` compared each row
// against every earlier one; a key makes it one lookup.
import { CHARSET_BINARY } from '@myjs/bytes'
import { collation, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { renderDecimal, toDecimal, toText, type Value } from '@myjs/types'

const hex = (b: Uint8Array): string => {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

/** The key of one value. */
export function valueKey(v: Value): string {
  if (v === null) return 'N'
  switch (v.kind) {
    case 'string': {
      const info = requireCollationInfo(v.collationId)
      const text = info.padAttribute === 'PAD SPACE' ? v.v.replace(/ +$/, '') : v.v
      if (v.collationId === CHARSET_BINARY) return `b${hex(encodeCollation(text, v.collationId))}`
      return `s${hex(collation(v.collationId).sortKey(encodeCollation(text, v.collationId)))}`
    }
    case 'bytes':
      return `b${hex(v.v)}`
    case 'int':
    case 'decimal': {
      // `1.50` and `1.5` and `1` with `1.0` are one value.
      const text = renderDecimal(toDecimal(v))
      return `n${text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text}`.replace(/^n-0$/, 'n0')
    }
    case 'double':
      return `d${Object.is(v.v, -0) ? 0 : v.v}`
    case 'datetime':
    case 'time':
    {
      // `10:00:00.500` and `10:00:00.5` are one value: only the fraction is normalised.
      const text = toText(v)
      return `t${text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text}`
    }
  }
}

/** The key of a row of values. */
export function rowKey(values: readonly Value[]): string {
  let s = ''
  for (const v of values) s += `${valueKey(v)}|`
  return s
}
