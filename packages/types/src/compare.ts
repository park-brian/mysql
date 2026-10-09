// M5.2 — comparing two values the way MySQL compares them.
//
// MySQL does not compare "values"; it first picks a *comparison type* from the
// two operands (`Arg_comparator::set_cmp_func`, `item_cmp_type`), converts both
// to it, and compares those. The type picked is the whole difference between
// `'10' < '9'` (true: both strings, so a collation decides) and `10 < '9'`
// (false: a number meets a string, so both become doubles). The rules, in the
// order the server applies them:
//
//   1. Either side NULL — the result is NULL (`<=>` handles NULL itself).
//   2. Both strings — compare by collation; the operand with the lower
//      coercibility chooses it (a column beats a literal). A binary string on
//      either side makes the comparison binary.
//   3. A temporal against a temporal, a string or a number — compare as
//      temporals, the other side converted. A string that is not a date falls
//      back to comparing the two as strings.
//   4. Two integers — exactly, as integers of either sign.
//   5. Integers and decimals — exactly, as decimals.
//   6. Anything else — a number against a string, or a double anywhere — as
//      doubles.
import { collation, encodeCollation, memcmp, requireCollationInfo } from '@myjs/charsets'
import { compareJson, orderJson, toJsonDoc } from './json-doc.ts'
import {
  rescale,
  temporalOrdinal,
  timeOrdinal,
  toDateTime,
  toDecimal,
  toDouble,
  toText,
  toTime,
  type DecimalValue,
  type StringValue,
  type Value,
} from './sql-value.ts'

const UTF8 = new TextEncoder()
const sign = (n: number | bigint): number => (n < 0 ? -1 : n > 0 ? 1 : 0)

/**
 * The collation two strings meet under (`DTCollation::aggregate`): the lower
 * coercibility wins; on a tie, a utf8mb4 collation wins over another charset's,
 * since the other converts into it losslessly, and within one charset a `_bin`
 * collation wins. Otherwise the left one. `CONCAT(latin1_col, utf8mb4_bin_col)`
 * is `utf8mb4_bin`, which 8.4.11 reports with the BINARY flag that follows from it.
 */
export function aggregateCollation(a: { readonly collationId: number; readonly coercibility: number }, b: { readonly collationId: number; readonly coercibility: number }): number {
  if (a.coercibility !== b.coercibility) return b.coercibility < a.coercibility ? b.collationId : a.collationId
  if (a.collationId === b.collationId) return a.collationId
  const x = requireCollationInfo(a.collationId)
  const y = requireCollationInfo(b.collationId)
  if (x.charset !== y.charset) return y.charset === 'utf8mb4' && x.charset !== 'utf8mb4' ? b.collationId : a.collationId
  return y.name.endsWith('_bin') && !x.name.endsWith('_bin') ? b.collationId : a.collationId
}

/** The collation two strings compare under. */
export function commonCollation(a: StringValue, b: StringValue): number {
  return aggregateCollation(a, b)
}

function compareText(a: Exclude<Value, null>, b: Exclude<Value, null>): number {
  if (a.kind === 'string' && b.kind === 'string') {
    const id = commonCollation(a, b)
    if (a.v === b.v) return 0
    const c = collation(id)
    return sign(c.compare(encodeCollation(a.v, id), encodeCollation(b.v, id)))
  }
  // A binary string on either side: bytes against bytes, `memcmp`.
  const bytesOf = (v: Exclude<Value, null>): Uint8Array =>
    v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : UTF8.encode(toText(v))
  return sign(memcmp(bytesOf(a), bytesOf(b)))
}

export function compareDecimals(a: DecimalValue, b: DecimalValue): number {
  const scale = Math.max(a.scale, b.scale)
  return sign(rescale(a, scale).v - rescale(b, scale).v)
}

/** MySQL's three-way comparison: negative, zero or positive, or `null` when either side is NULL. */
export function compareValues(a: Value, b: Value): number | null {
  if (a === null || b === null) return null
  // JSON on either side: the other is brought to JSON and the two compare as JSON do (M5.21).
  if (a.kind === 'json' || b.kind === 'json') return sign(compareJson(toJsonDoc(a), toJsonDoc(b)))
  const textual = (v: Exclude<Value, null>): boolean => v.kind === 'string' || v.kind === 'bytes'

  if (textual(a) && textual(b)) return compareText(a, b)

  if (a.kind === 'datetime' || b.kind === 'datetime') {
    // A DATE is a DATETIME at midnight, so everything compares as DATETIME.
    const x = toDateTime(a, 'DATETIME')
    const y = toDateTime(b, 'DATETIME')
    if (x !== undefined && y !== undefined) return sign(temporalOrdinal(x.v) - temporalOrdinal(y.v))
    if (textual(a) || textual(b)) return compareText(a, b)
    return sign(toDouble(a) - toDouble(b))
  }

  if (a.kind === 'time' || b.kind === 'time') {
    const x = toTime(a)
    const y = toTime(b)
    if (x !== undefined && y !== undefined) return sign(timeOrdinal(x.v) - timeOrdinal(y.v))
    return compareText(a, b)
  }

  if (a.kind === 'int' && b.kind === 'int') return sign(a.v - b.v)
  if ((a.kind === 'int' || a.kind === 'decimal') && (b.kind === 'int' || b.kind === 'decimal')) {
    return compareDecimals(toDecimal(a), toDecimal(b))
  }
  const x = toDouble(a)
  const y = toDouble(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** `a <=> b`: equality in which NULL equals NULL and nothing else. */
export function nullSafeEqual(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === null && b === null
  return compareValues(a, b) === 0
}

/**
 * An ordering for `ORDER BY` and `DISTINCT`: NULL first, as MySQL sorts it in
 * ascending order, then `compareValues`.
 */
/**
 * The order a sort puts two values in: `orderValues`, except that an ENUM or
 * SET column sorts by its member index or bitmap, as its field's sort key
 * does (8.4.11: `ORDER BY e` over ENUM('b','a') puts 'b' first). MIN and MAX
 * compare the text, and use `orderValues`.
 */
export function sortValues(a: Value, b: Value): number {
  if (a !== null && b !== null && a.kind === 'string' && b.kind === 'string' && a.ordinal !== undefined && b.ordinal !== undefined) return a.ordinal < b.ordinal ? -1 : a.ordinal > b.ordinal ? 1 : 0
  return orderValues(a, b)
}

export function orderValues(a: Value, b: Value): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : -1) : 1
  if (a.kind === 'json' || b.kind === 'json') return sign(orderJson(toJsonDoc(a), toJsonDoc(b)))
  return compareValues(a, b) ?? 0
}
