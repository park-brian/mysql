// M5.2 — the value an expression evaluates to, and MySQL's conversions between
// its kinds.
//
// `StorageValue` (values.ts) is what a column holds and `SqlValue` is what a
// driver receives. Neither is enough to *evaluate* SQL, because evaluation
// needs what both erase: whether an integer is signed (`~0` is unsigned, and
// `-` of it saturates rather than wrapping — M3.2's corpus), the exact scale
// of a DECIMAL (`1.10 + 1` is `2.10`, not `2.1`), and which collation a string
// compares under. So this is a third shape, owned here because doc 03 puts
// "value repr · coercion · comparison" in `types`, and D-62 keeps the rules out
// of the executor.
//
// A DECIMAL is an unscaled `bigint` and a scale, so arithmetic is exact and
// needs no decimal library: `12.50` is `{ v: 1250n, scale: 2 }`.
import type { MysqlDateTime, MysqlTime } from '@myjs/bytes'
import { encodeCollation } from '@myjs/charsets'
import { renderJson, type JsonDoc } from './json-doc.ts'
import { scanDateTime, scanTime, type Deprecation, type ScanFlags } from './temporal-scan.ts'
import { daysInMonth } from './calendar.ts'

const UTF8 = new TextEncoder()

/** A value's bytes as a function of bytes reads them: a binary string's own, a string's in its charset, anything else its text in UTF-8. */
export function valueBytes(v: Exclude<Value, null>): Uint8Array {
  return v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : UTF8.encode(toText(v))
}

export type Value =
  | null
  | IntValue
  | DecimalValue
  | DoubleValue
  | StringValue
  | BytesValue
  | DateTimeValue
  | TimeValue
  | JsonDocValue

/** A BIGINT. `unsigned` decides its range, and how arithmetic promotes it. */
export interface IntValue {
  readonly kind: 'int'
  readonly v: bigint
  readonly unsigned: boolean
  /**
   * What the value is as text, where that is not its digits: a BIT's bytes
   * passed through IF or CASE, which `val_str` hands on as they are while
   * every numeric reading sees the number (8.4.11: `IF(1, b, 0)` is 5 in
   * arithmetic and the byte 0x05 to a client).
   */
  readonly str?: Uint8Array
}

export interface DecimalValue {
  readonly kind: 'decimal'
  /** The digits, unscaled: `12.50` is 1250n at scale 2. */
  readonly v: bigint
  readonly scale: number
  /**
   * The scale it is shown at, when that is less than it holds. A division
   * keeps its quotient to the next multiple of nine digits — MySQL's `decimal_t`
   * is base 10^9 — but shows only `div_precision_increment` more than its
   * dividend, so `2/3` holds 0.666666666 and shows `0.6667`, and `1/7*7` shows
   * `1.0000` rather than `1.0003` (both read off 8.4.11).
   */
  readonly display?: number
}

export interface DoubleValue {
  readonly kind: 'double'
  readonly v: number
  /** Read from a FLOAT column: as text, six significant digits (`FLT_DIG`). */
  readonly float?: true
  /** A FLOAT(M,D)'s D, and arithmetic's over one: as text, exactly this many decimals. */
  readonly decimals?: number
}

/**
 * Text, with the collation it compares under and how strongly it holds it —
 * MySQL's coercibility (`Item::Derivation`): 0 explicit `COLLATE`, 2 a column,
 * 4 a literal. The lower wins when two strings meet.
 */
export interface StringValue {
  readonly kind: 'string'
  readonly v: string
  readonly collationId: number
  readonly coercibility: number
  /**
   * An ENUM's member index or a SET's bitmap, which is what the column is in
   * a numeric context: `e + 0` is 2 for the second member (8.4.11).
   */
  readonly ordinal?: bigint
}

/** A binary string: VARBINARY, BLOB, a hex literal. */
export interface BytesValue {
  readonly kind: 'bytes'
  readonly v: Uint8Array
  /**
   * A hex or bit literal with no introducer, which a numeric context reads as
   * a big-endian unsigned integer: `x'41' + 0` is 65, where `CAST('A' AS
   * BINARY) + 0` is 0 (8.4.11).
   */
  readonly hex?: boolean
}

/** A value as a field holds it: a hex literal's bytes are plain VARBINARY once stored or materialized (8.4.11: `(SELECT x'41' a) d` reads `a + 0` as 0). */
export function withoutHex(v: Value): Value {
  return v !== null && v.kind === 'bytes' && v.hex === true ? { kind: 'bytes', v: v.v } : v
}

/** A value with no trace of the item it came from: no hex literal's number, no ENUM's index — what a user variable or a scalar subquery hands on. */
export function plainValue(v: Value): Value {
  if (v !== null && v.kind === 'string' && v.ordinal !== undefined) return { kind: 'string', v: v.v, collationId: v.collationId, coercibility: v.coercibility }
  if (v !== null && v.kind === 'double' && (v.float !== undefined || v.decimals !== undefined)) return { kind: 'double', v: v.v }
  if (v !== null && v.kind === 'int' && v.str !== undefined) return { kind: 'int', v: v.v, unsigned: v.unsigned }
  return withoutHex(v)
}

/** A hex literal's bytes as the unsigned integer they spell, big-endian; its low 64 bits. */
export function hexNumber(v: Uint8Array): bigint {
  let n = 0n
  for (const b of v) n = ((n << 8n) | BigInt(b)) & 0xffff_ffff_ffff_ffffn
  return n
}

export type TemporalType = 'DATE' | 'DATETIME' | 'TIMESTAMP'

export interface DateTimeValue {
  readonly kind: 'datetime'
  readonly v: MysqlDateTime
  readonly type: TemporalType
  /** Fractional-second digits it carries, 0–6. */
  readonly fsp: number
}

export interface TimeValue {
  readonly kind: 'time'
  readonly v: MysqlTime
  readonly fsp: number
}

/** A JSON value (M5.21): what a JSON column holds and a JSON function returns. */
export interface JsonDocValue {
  readonly kind: 'json'
  readonly v: JsonDoc
}

/** Coercibility, from `sql/item.h`'s `Derivation`. */
export const COERCIBILITY = { EXPLICIT: 0, IMPLICIT: 2, SYSCONST: 3, COERCIBLE: 4, NUMERIC: 5, IGNORABLE: 6 } as const

export const MAX_SIGNED = (1n << 63n) - 1n
export const MIN_SIGNED = -(1n << 63n)
export const MAX_UNSIGNED = (1n << 64n) - 1n

export const int = (v: bigint, unsigned = false): IntValue => ({ kind: 'int', v, unsigned })
export const bool = (b: boolean): IntValue => ({ kind: 'int', v: b ? 1n : 0n, unsigned: false })
export const double = (v: number): DoubleValue => ({ kind: 'double', v })
export const decimal = (v: bigint, scale: number, display?: number): DecimalValue =>
  display === undefined || display >= scale ? { kind: 'decimal', v, scale } : { kind: 'decimal', v, scale, display }

/** The scale a decimal is shown at. */
export const displayScale = (d: DecimalValue): number => d.display ?? d.scale
export const bytes = (v: Uint8Array): BytesValue => ({ kind: 'bytes', v })
export const json = (v: JsonDoc): JsonDocValue => ({ kind: 'json', v })
export const string = (v: string, collationId: number, coercibility: number = COERCIBILITY.COERCIBLE): StringValue => ({
  kind: 'string',
  v,
  collationId,
  coercibility,
})

export const isNumeric = (v: Value): v is IntValue | DecimalValue | DoubleValue =>
  v !== null && (v.kind === 'int' || v.kind === 'decimal' || v.kind === 'double')
export const isText = (v: Value): v is StringValue | BytesValue => v !== null && (v.kind === 'string' || v.kind === 'bytes')

// --- DECIMAL ------------------------------------------------------------------

const TEN = 10n

export function pow10(n: number): bigint {
  return TEN ** BigInt(n)
}

/** `'-12.50'` → 1250n at scale 2. The text must already be a plain decimal numeral. */
export function parseDecimal(text: string): DecimalValue {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim())
  if (m === null || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) return decimal(0n, 0)
  const frac = m[3] ?? ''
  const digits = BigInt(`${m[2] === '' ? '0' : m[2]}${frac}`)
  return decimal(m[1] === '-' ? -digits : digits, frac.length)
}

/** At `scale`, rounding half away from zero when it drops digits — MySQL's `ROUND_HALF_UP` on decimals. */
export function rescale(d: DecimalValue, scale: number): DecimalValue {
  if (scale === d.scale) return d
  if (scale > d.scale) return decimal(d.v * pow10(scale - d.scale), scale)
  const div = pow10(d.scale - scale)
  const q = d.v / div
  const r = d.v % div
  const away = (r < 0n ? -r : r) * 2n >= div
  return decimal(away ? q + (d.v < 0n ? -1n : 1n) : q, scale)
}

export function renderDecimal(value: DecimalValue): string {
  const d = value.display === undefined ? value : rescale(decimal(value.v, value.scale), value.display)
  const negative = d.v < 0n
  const digits = (negative ? -d.v : d.v).toString().padStart(d.scale + 1, '0')
  const intPart = digits.slice(0, digits.length - d.scale)
  const text = d.scale === 0 ? intPart : `${intPart}.${digits.slice(digits.length - d.scale)}`
  return negative ? `-${text}` : text
}

/** The digits before the point, for a precision check. */
export function decimalIntegerDigits(d: DecimalValue): number {
  const whole = (d.v < 0n ? -d.v : d.v) / pow10(d.scale)
  return whole === 0n ? 0 : whole.toString().length
}

// --- strings to numbers ---------------------------------------------------------

/**
 * The longest numeric prefix of a string, as MySQL reads `'12abc'` as 12 in a
 * numeric context. `complete` says whether the whole string was a number (after
 * trailing spaces), which is what decides a warning or, in strict mode on a
 * store, ER_TRUNCATED_WRONG_VALUE_FOR_FIELD.
 */
export function numericPrefix(text: string): { readonly text: string; readonly complete: boolean; readonly fractional: boolean } {
  const m = /^[ \t\n\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text)
  if (m === null) return { text: '0', complete: false, fractional: false }
  const rest = text.slice(m[0].length)
  const t = m[1] as string
  return { text: t, complete: /^[ \t\n\r]*$/.test(rest), fractional: /[.eE]/.test(t) }
}

export function textOf(v: StringValue | BytesValue): string {
  // A binary string in a numeric context is read byte by byte, as ASCII is.
  return v.kind === 'string' ? v.v : String.fromCharCode(...v.v.subarray(0, 1024))
}

// --- conversions ----------------------------------------------------------------

/** Text past the doubles is the largest there is, of its sign: `my_strtod` stops at DBL_MAX (8.4.11: `'1e400' + 0`, with 1292). */
const clampedDouble = (n: number): number => (Number.isFinite(n) ? n : n > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE)

/** A value as a double, as MySQL's `val_real()`. */
export function toDouble(v: Exclude<Value, null>): number {
  switch (v.kind) {
    case 'int':
      return Number(v.v)
    case 'decimal':
      return Number(renderDecimal(v))
    case 'double':
      return v.v
    case 'string':
    case 'bytes':
      if (v.kind === 'string' && v.ordinal !== undefined) return Number(v.ordinal)
      if (v.kind === 'bytes' && v.hex === true) return Number(hexNumber(v.v))
      return clampedDouble(Number(numericPrefix(textOf(v)).text))
    case 'datetime':
      return Number(temporalNumber(v))
    case 'time':
      return Number(timeNumber(v.v))
    case 'json': {
      const n = jsonNumber(v)
      return n === undefined ? Number(numericPrefix(renderJson(v.v)).text) : toDouble(n)
    }
  }
}

/** A JSON number as the SQL number it is; undefined for anything else (`val_real` and friends then read its text). */
function jsonNumber(v: JsonDocValue): Exclude<Value, null> | undefined {
  const d = v.v
  if (d.t === 'int') return int(d.v)
  if (d.t === 'uint') return int(d.v, true)
  if (d.t === 'double') return double(d.v)
  if (d.t === 'decimal') return d.v
  if (d.t === 'bool') return int(d.v ? 1n : 0n)
  return undefined
}

/** A value as an exact decimal, as `val_decimal()`. */
export function toDecimal(v: Exclude<Value, null>): DecimalValue {
  switch (v.kind) {
    case 'int':
      return decimal(v.v, 0)
    case 'decimal':
      return v
    case 'double':
      return doubleToDecimal(v.v)
    case 'string':
    case 'bytes': {
      if (v.kind === 'string' && v.ordinal !== undefined) return decimal(v.ordinal, 0)
      if (v.kind === 'bytes' && v.hex === true) return decimal(hexNumber(v.v), 0)
      const p = numericPrefix(textOf(v))
      return /[eE]/.test(p.text) ? doubleToDecimal(Number(p.text)) : parseDecimal(p.text)
    }
    case 'datetime':
      return parseDecimal(temporalNumber(v))
    case 'time':
      return parseDecimal(timeNumber(v.v))
    case 'json': {
      const n = jsonNumber(v)
      return n === undefined ? parseDecimal(numericPrefix(renderJson(v.v)).text.replace(/[eE].*$/, '') || '0') : toDecimal(n)
    }
  }
}

export function doubleToDecimal(n: number): DecimalValue {
  if (!Number.isFinite(n)) return decimal(0n, 0)
  // The shortest round-trip rendering, as MySQL's `double2decimal` does via `%g`-like output.
  const text = Math.abs(n) < 1e21 ? String(n) : n.toFixed(0)
  if (/e/.test(text)) return parseDecimal(n.toFixed(Math.min(30, Math.max(0, -Math.floor(Math.log10(Math.abs(n))) + 15))))
  return parseDecimal(text)
}

/**
 * A value as an integer, rounded as MySQL rounds on the way into an integer
 * context (half away from zero). `undefined` when it does not fit a 64-bit
 * integer of either sign.
 */
export function toInteger(v: Exclude<Value, null>): bigint {
  switch (v.kind) {
    case 'int':
      return v.v
    case 'decimal':
      return rescale(v, 0).v
    case 'double':
      return roundDouble(v.v)
    case 'string':
    case 'bytes': {
      if (v.kind === 'string' && v.ordinal !== undefined) return v.ordinal
      if (v.kind === 'bytes' && v.hex === true) return hexNumber(v.v)
      const p = numericPrefix(textOf(v))
      return p.fractional ? (/[eE]/.test(p.text) ? roundDouble(Number(p.text)) : rescale(parseDecimal(p.text), 0).v) : BigInt(p.text.replace(/^\+/, ''))
    }
    case 'datetime':
      return BigInt(temporalNumber(v).split('.')[0] as string)
    case 'time':
      return BigInt(timeNumber(v.v).split('.')[0] as string)
    case 'json': {
      const n = jsonNumber(v)
      return n === undefined ? toInteger(string(renderJson(v.v), 255)) : toInteger(n)
    }
  }
}

/**
 * A value as `val_int` reads it. Text is read as `my_strtoll10` reads it:
 * leading spaces, a sign and digits, stopping at anything else — so '1.5' is
 * 1 and '2e1' is 2, where storing them into a column rounds — and a number
 * past 64 bits saturates, at 2^64 - 1 or -2^63 (8.4.11:
 * `CAST('99999999999999999999' AS SIGNED)` is -1). Anything else is
 * `toInteger`.
 */
export function valInt(v: Exclude<Value, null>): bigint {
  if (v.kind !== 'string' && v.kind !== 'bytes') return toInteger(v)
  if (v.kind === 'string' && v.ordinal !== undefined) return v.ordinal
  if (v.kind === 'bytes' && v.hex === true) return hexNumber(v.v)
  const m = /^[ \t\n\r]*([+-]?)(\d*)/.exec(textOf(v)) as RegExpExecArray
  const digits = m[2] as string
  if (digits === '') return 0n
  const n = BigInt(digits)
  if (m[1] === '-') return n > -MIN_SIGNED ? MIN_SIGNED : -n
  return n > MAX_UNSIGNED ? MAX_UNSIGNED : n
}

export function roundDouble(n: number): bigint {
  if (!Number.isFinite(n)) return n > 0 ? MAX_UNSIGNED + 1n : MIN_SIGNED - 1n
  const r = n < 0 ? -Math.round(-n) : Math.round(n)
  return BigInt(r)
}

/** `TRUE` in a boolean context: nonzero. `null` for NULL. */
export function truth(v: Value): boolean | null {
  if (v === null) return null
  switch (v.kind) {
    case 'int':
      return v.v !== 0n
    case 'decimal':
      return v.v !== 0n
    default:
      return toDouble(v) !== 0
  }
}

// --- rendering ------------------------------------------------------------------

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

export function renderDateTime(v: MysqlDateTime, type: TemporalType, fsp: number): string {
  const date = `${pad(v.year, 4)}-${pad(v.month, 2)}-${pad(v.day, 2)}`
  if (type === 'DATE') return date
  const frac = fsp > 0 ? `.${pad(v.microsecond, 6).slice(0, fsp)}` : ''
  return `${date} ${pad(v.hour, 2)}:${pad(v.minute, 2)}:${pad(v.second, 2)}${frac}`
}

export function renderTime(v: MysqlTime, fsp: number): string {
  const hours = v.days * 24 + v.hour
  const frac = fsp > 0 ? `.${pad(v.microsecond, 6).slice(0, fsp)}` : ''
  return `${v.negative ? '-' : ''}${pad(hours, 2)}:${pad(v.minute, 2)}:${pad(v.second, 2)}${frac}`
}

/** `2024-01-02 03:04:05` as the number `20240102030405`, which is what a temporal is in a numeric context. */
function temporalNumber(v: DateTimeValue): string {
  const d = v.v
  const date = `${d.year}${pad(d.month, 2)}${pad(d.day, 2)}`
  if (v.type === 'DATE') return date
  const frac = v.fsp > 0 ? `.${pad(d.microsecond, 6).slice(0, v.fsp)}` : ''
  return `${date}${pad(d.hour, 2)}${pad(d.minute, 2)}${pad(d.second, 2)}${frac}`
}

function timeNumber(t: MysqlTime): string {
  const n = `${t.days * 24 + t.hour}${pad(t.minute, 2)}${pad(t.second, 2)}`
  return `${t.negative ? '-' : ''}${n}`
}

/** A value as text, as `val_str()`. */
export function toText(v: Exclude<Value, null>): string {
  switch (v.kind) {
    case 'int':
      // A BIT's bytes read as text as a binary string's are, byte by byte.
      return v.str === undefined ? v.v.toString() : String.fromCharCode(...v.str)
    case 'decimal':
      return renderDecimal(v)
    case 'double':
      if (v.decimals !== undefined && Number.isFinite(v.v) && Math.abs(v.v) < 1e21) return v.v.toFixed(v.decimals)
      return v.float === true ? renderFloat(v.v) : renderDouble(v.v)
    case 'string':
      return v.v
    case 'bytes':
      return textOf(v)
    case 'datetime':
      return renderDateTime(v.v, v.type, v.fsp)
    case 'time':
      return renderTime(v.v, v.fsp)
    case 'json':
      return renderJson(v.v)
  }
}

/** A value as the bytes of a string in `collationId`'s charset. */
export function toTextBytes(v: Exclude<Value, null>, collationId: number): Uint8Array {
  if (v.kind === 'bytes') return v.v
  if (v.kind === 'int' && v.str !== undefined) return v.str
  return encodeCollation(toText(v), collationId)
}

/**
 * A double as MySQL prints one: the shortest digits that round-trip, written
 * out in full when the decimal exponent is from -15 to 14 and in scientific
 * notation outside it — `1e15`, `1e-16`, but `0.0000000000000015` and
 * `123456789012345.6`. The bounds were read off a real 8.4.11, not a manual.
 */
/** A FLOAT prints six significant digits, as `my_gcvt` does for `FLT_DIG`. */
export function renderFloat(n: number): string {
  if (!Number.isFinite(n) || n === 0) return renderDouble(n)
  return renderDouble(Number(n.toPrecision(6)))
}

export function renderDouble(n: number): string {
  if (Number.isNaN(n)) return 'NaN'
  if (n === 0) return Object.is(n, -0) ? '-0' : '0'
  const [mantissa, e] = n.toExponential().split('e') as [string, string]
  const exp = Number(e)
  if (exp < -15 || exp > 14) return `${mantissa}e${exp}`
  const negative = mantissa.startsWith('-')
  const digits = mantissa.replace(/^-/, '').replace('.', '')
  let text: string
  if (exp < 0) text = `0.${'0'.repeat(-exp - 1)}${digits}`
  else if (digits.length <= exp + 1) text = digits + '0'.repeat(exp + 1 - digits.length)
  else text = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
  return negative ? `-${text}` : text
}

// --- temporals from text ----------------------------------------------------------

/**
 * Text as a datetime, as `str_to_datetime` reads it (`temporal-scan.ts` has
 * the rules): the value, its displacement applied and a seventh fraction
 * digit rounded in; whether it had a time; and whether text followed it,
 * which a strict mode refuses and anything else ignores with a warning.
 * `undefined` when it is no datetime at all. A zero month or day is refused
 * unless `flags` say otherwise; the zero date is allowed unless they forbid it.
 */
export function parseDateTime(
  text: string,
  flags: ScanFlags = { noZeroInDate: true },
): { readonly v: MysqlDateTime; readonly hasTime: boolean; readonly fsp: number; readonly truncated: boolean; readonly deprecation?: Deprecation } | undefined {
  const s = scanDateTime(text, flags)
  if (typeof s === 'string') return undefined
  let v = s.v
  if (s.nanoseconds >= 500) v = addSeconds(v, 0, 1)
  // A displacement is converted into the session's zone, UTC here.
  if (s.displacement !== undefined) v = addSeconds(v, -s.displacement, 0)
  return { v, hasTime: s.fields > 3, fsp: s.fsp, truncated: s.truncated, ...(s.deprecation === undefined ? {} : { deprecation: s.deprecation }) }
}

/** A datetime moved by whole seconds and microseconds, the calendar carrying. */
function addSeconds(v: MysqlDateTime, seconds: number, microseconds: number): MysqlDateTime {
  let us = v.microsecond + microseconds
  let carry = seconds
  if (us >= 1_000_000) {
    us -= 1_000_000
    carry++
  }
  if (carry === 0) return { ...v, microsecond: us }
  const d = new Date(0)
  d.setUTCFullYear(v.year, v.month - 1, v.day)
  d.setUTCHours(v.hour, v.minute, v.second + carry, 0)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), microsecond: us }
}

/** MySQL's default `sql_mode` refuses an invalid day for its month, but allows the zero date's parts only when they are all zero. */
export function validDate(v: Pick<MysqlDateTime, 'year' | 'month' | 'day'>): boolean {
  if (v.year === 0 && v.month === 0 && v.day === 0) return true
  if (v.month < 1 || v.month > 12 || v.day < 1) return false
  const days = daysInMonth(v.year, v.month)
  return v.day <= days
}


/**
 * Text as a TIME, as `str_to_time` reads it: `'12:34:56'`, `'-1 02:03'`,
 * `'123456'`, `'10.5'`, or a datetime's time of day. Past 838:59:59 it is
 * clamped, and says so; `undefined` when it is no time at all.
 */
export function parseTime(
  text: string,
): { readonly v: MysqlTime; readonly fsp: number; readonly truncated: boolean; readonly clamped: boolean; readonly dateDropped: boolean; readonly deprecation?: Deprecation } | undefined {
  const s = scanTime(text)
  if (typeof s === 'string') return undefined
  let us = s.microsecond
  let seconds = (s.hours * 60 + s.minute) * 60 + s.second
  if (s.nanoseconds >= 500 && !s.clamped) {
    us++
    if (us === 1_000_000) {
      us = 0
      seconds++
    }
  }
  const hours = Math.floor(seconds / 3600)
  return {
    v: { negative: s.negative && (seconds > 0 || us > 0), days: Math.floor(hours / 24), hour: hours % 24, minute: Math.floor(seconds / 60) % 60, second: seconds % 60, microsecond: us },
    fsp: s.fsp,
    truncated: s.truncated,
    clamped: s.clamped,
    dateDropped: s.datetime !== undefined && (s.datetime.v.year !== 0 || s.datetime.v.month !== 0 || s.datetime.v.day !== 0),
    ...(s.deprecation === undefined ? {} : { deprecation: s.deprecation }),
  }
}

/** A temporal as microseconds since 0000-00-00, for ordering; calendar-exact is not needed, only monotonic. */
export function temporalOrdinal(v: MysqlDateTime): bigint {
  const day = BigInt(v.year) * 416n + BigInt(v.month) * 32n + BigInt(v.day)
  return ((day * 24n + BigInt(v.hour)) * 3600n + BigInt(v.minute) * 60n + BigInt(v.second)) * 1_000_000n + BigInt(v.microsecond)
}

export function timeOrdinal(t: MysqlTime): bigint {
  const us = (((BigInt(t.days) * 24n + BigInt(t.hour)) * 60n + BigInt(t.minute)) * 60n + BigInt(t.second)) * 1_000_000n + BigInt(t.microsecond)
  return t.negative ? -us : us
}

/** A value as a datetime of `type`, as an implicit cast does; `undefined` when it is not one. */
export function toDateTime(v: Exclude<Value, null>, type: TemporalType): DateTimeValue | undefined {
  switch (v.kind) {
    case 'datetime':
      return truncateTemporal(v, type)
    case 'string':
    case 'bytes': {
      const p = parseDateTime(textOf(v))
      if (p === undefined) return undefined
      return truncateTemporal({ kind: 'datetime', v: p.v, type: p.hasTime ? 'DATETIME' : 'DATE', fsp: p.fsp }, type)
    }
    case 'int':
    case 'decimal':
    case 'double': {
      const t = toText(v.kind === 'double' ? toDecimal(v) : v)
      const whole = t.replace(/^-/, '').split('.')[0] as string
      if (t.startsWith('-')) return undefined
      // `20240102` is a date and `20240102030405` a datetime, as a number.
      const padded = whole.length <= 8 ? whole.padStart(8, '0') : whole.padStart(14, '0')
      const p = parseDateTime(padded)
      if (p === undefined) return undefined
      return truncateTemporal({ kind: 'datetime', v: p.v, type: p.hasTime ? 'DATETIME' : 'DATE', fsp: 0 }, type)
    }
    case 'time':
      return undefined
  }
}

function truncateTemporal(v: DateTimeValue, type: TemporalType): DateTimeValue {
  if (type === 'DATE') return { kind: 'datetime', v: { ...v.v, hour: 0, minute: 0, second: 0, microsecond: 0 }, type, fsp: 0 }
  return { kind: 'datetime', v: v.v, type, fsp: v.fsp }
}

export function toTime(v: Exclude<Value, null>): TimeValue | undefined {
  if (v.kind === 'time') return v
  if (v.kind === 'datetime') return { kind: 'time', v: { negative: false, days: 0, hour: v.v.hour, minute: v.v.minute, second: v.v.second, microsecond: v.v.microsecond }, fsp: v.fsp }
  // `str_to_time`: a datetime written out is its time of day, and a date
  // alone is a number's prefix ('2020-01-01' is 00:20:20, 8.4.11).
  const p = parseTime(toText(v))
  return p === undefined ? undefined : { kind: 'time', v: p.v, fsp: p.fsp }
}
