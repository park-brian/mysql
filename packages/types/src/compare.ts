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
import { CHARSET_BINARY } from '@myjs/bytes'
import { collation, collationInfoByName, encodeCollation, memcmp, requireCollationInfo } from '@myjs/charsets'
import { compareJson, orderJson, toJsonDoc } from './json-doc.ts'
import {
  COERCIBILITY,
  rescale,
  temporalOrdinal,
  timeOrdinal,
  toDateTime,
  toDecimal,
  toDouble,
  toText,
  toTime,
  type DecimalValue,
  type Value,
} from './sql-value.ts'

const UTF8 = new TextEncoder()
const sign = (n: number | bigint): number => (n < 0 ? -1 : n > 0 ? 1 : 0)

// --- Collation aggregation, as `DTCollation::aggregate` does it -----------------
//
// Each argument brings a collation and a derivation (what COERCIBILITY()
// reports): a number or a temporal latin1_swedish_ci at NUMERIC, NULL binary
// at IGNORABLE. They are aggregated pairwise, left to right. In one charset
// the lower derivation wins; at the same one a `_bin` collation wins, two
// EXPLICIT ones are refused, and two others leave the charset's `_bin`
// collation at derivation NONE (1), which a comparison refuses. Across
// charsets a binary string wins at its derivation or lower, a Unicode
// charset is a superset of any other, and a literal gives way to anything
// lower. What cannot be decided is the caller's error (1267, 1270, 1271).

/** A collation and its derivation, `DTCollation`. The derivation is a `COERCIBILITY` value, or `DERIVATION_NONE`. */
export interface Derived {
  readonly collationId: number
  readonly derivation: number
}

/** `DERIVATION_NONE`: two collations of one charset that neither wins, which a comparison refuses. */
export const DERIVATION_NONE = 1

const UNICODE = new Set(['utf8mb4', 'utf8mb3', 'ucs2', 'utf16', 'utf16le', 'utf32'])
const SUPPLEMENT = new Set(['utf8mb4', 'utf16', 'utf16le', 'utf32'])

/** The charset a collation id belongs to; the binary pseudo-collation is `binary`. */
export const charsetOfCollation = (id: number): string => (id === CHARSET_BINARY ? 'binary' : requireCollationInfo(id).charset)

/** `left_is_superset`: conversion into Unicode, or from ASCII. */
function leftIsSuperset(l: Derived, r: Derived): boolean {
  const lc = charsetOfCollation(l.collationId)
  const rc = charsetOfCollation(r.collationId)
  if (UNICODE.has(lc)) {
    if (l.derivation < r.derivation) return true
    if (l.derivation === r.derivation) {
      if (!UNICODE.has(rc)) return true
      const li = requireCollationInfo(l.collationId)
      const ri = requireCollationInfo(r.collationId)
      // utf8mb4 over utf8mb3: more bytes at the most, as many at the least.
      if (SUPPLEMENT.has(lc) && !SUPPLEMENT.has(rc) && li.mbmaxlen > ri.mbmaxlen && li.mbminlen === ri.mbminlen) return true
    }
  }
  return rc === 'ascii' && (l.derivation < r.derivation || (l.derivation === r.derivation && lc !== 'ascii'))
}

/** Two derivations aggregated, or undefined when MySQL cannot. */
export function aggregateDerivations(acc: Derived, dt: Derived): Derived | undefined {
  // Two EXPLICIT collations must be one, in any charsets (8.4.11).
  if (acc.derivation === COERCIBILITY.EXPLICIT && dt.derivation === COERCIBILITY.EXPLICIT && acc.collationId !== dt.collationId) return undefined
  const ac = charsetOfCollation(acc.collationId)
  if (ac !== charsetOfCollation(dt.collationId)) {
    if (acc.collationId === CHARSET_BINARY) return acc.derivation <= dt.derivation ? acc : dt
    if (dt.collationId === CHARSET_BINARY) return dt.derivation <= acc.derivation ? dt : acc
    if (leftIsSuperset(acc, dt)) return acc
    if (leftIsSuperset(dt, acc)) return dt
    if (acc.derivation < dt.derivation && dt.derivation >= COERCIBILITY.SYSCONST) return acc
    if (dt.derivation < acc.derivation && acc.derivation >= COERCIBILITY.SYSCONST) return dt
    return undefined
  }
  if (acc.derivation !== dt.derivation) return acc.derivation < dt.derivation ? acc : dt
  if (acc.collationId === dt.collationId) return acc
  if (acc.derivation === COERCIBILITY.EXPLICIT) return undefined
  if (requireCollationInfo(acc.collationId).isBinary) return acc
  if (requireCollationInfo(dt.collationId).isBinary) return dt
  const bin = collationInfoByName(`${ac}_bin`)
  return { collationId: bin?.id ?? acc.collationId, derivation: DERIVATION_NONE }
}

/**
 * The collation two strings meet under. Where MySQL cannot decide, the
 * statement was refused when it was compiled, unless a side's derivation was
 * not known then; the left side's collation is the answer for those.
 */
export function aggregateCollation(a: { readonly collationId: number; readonly coercibility: number }, b: { readonly collationId: number; readonly coercibility: number }): number {
  if (a.collationId === b.collationId) return a.collationId
  return aggregateDerivations({ collationId: a.collationId, derivation: a.coercibility }, { collationId: b.collationId, derivation: b.coercibility })?.collationId ?? a.collationId
}

function compareText(a: Exclude<Value, null>, b: Exclude<Value, null>): number {
  if (a.kind === 'string' && b.kind === 'string') {
    const id = aggregateCollation(a, b)
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
