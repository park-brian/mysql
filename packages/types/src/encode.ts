// M5.2 — a value into a column, and a column's bytes back into a value.
//
// `decodeStorageValue` turns bytes into a neutral value; nothing turned a value
// into bytes, because nothing stored one until the executor. This is that
// direction, and it is where MySQL's *assignment* rules live: what `'12abc'`
// becomes in an INT column, when a string is too long for a VARCHAR, how many
// digits of `1.239` a DECIMAL(5,2) keeps. Under a strict mode each of those is
// an error with its own number; otherwise it is the clamped or truncated value
// and a warning, which is counted.
//
// The bytes are a record field in the engine's framing (D-22): InnoDB's, which
// for every type but one is what `decodeStorageValue` reads. The exception is
// DATE, which InnoDB stores as `DATA_INT` — byte-reversed with the sign bit
// flipped — so that `memcmp` orders it (doc 24). `decodeStorageValue` reads the
// binlog's little-endian form, as D-34's fixtures were captured in, so this
// module converts between the two. A DATE keyed in the little-endian form
// would sort `2024-01-02` before `2023-12-31`.
import { CHARSET_BINARY, FIELD_TYPE, type MysqlDateTime, type MysqlTime } from '@myjs/bytes'
import { collation, decodeCollation, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { ColumnType } from './columns.ts'
import { decodeDecimal, encodeDecimal } from './decimal.ts'
import {
  columnCannotBeNull,
  columnOutOfRange,
  dataTooLong,
  invalidJsonCharset,
  invalidJsonText,
  unsupportedType,
  wrongTemporalValue,
  wrongValueForColumn,
  TypeError_,
} from './errors.ts'
import { decodeDouble, decodeFloat, encodeDouble, encodeFloat } from './floats.ts'
import { decodeInt, encodeInt, signedRange, unsignedRange } from './integers.ts'
import { JsonSyntaxError, decodeJsonDoc, encodeJsonDoc, parseJson } from './json-doc.ts'
import {
  COERCIBILITY,
  MAX_UNSIGNED,
  decimal,
  decimalIntegerDigits,
  double,
  hexNumber,
  int,
  json,
  numericPrefix,
  parseDecimal,
  pow10,
  renderDecimal,
  rescale,
  string,
  toDateTime,
  toDecimal,
  toDouble,
  toInteger,
  toText,
  toTime,
  type DecimalValue,
  type Value,
} from './sql-value.ts'
import { decodeBit, decodeEnum, decodeSet, encodeBit, encodeEnum, encodeSet, enumMember, padBinary, padChar, setMembers, trimTrailingSpaces } from './strings.ts'
import {
  dateFieldToStorage,
  dateStorageToField,
  decodeDateField,
  decodeDatetime2,
  decodeTime2,
  decodeTimestamp2,
  decodeYear,
  encodeDateField,
  encodeDatetime2,
  encodeTime2,
  encodeTimestamp2,
  encodeYear,
} from './temporal.ts'

/** A column as the store sees it. */
export interface FieldColumn {
  readonly name: string
  readonly type: ColumnType
  readonly nullable: boolean
}

/** Where a store happens: the mode it obeys, and the row it is on, for messages and warnings. */
export interface StoreContext {
  /** `STRICT_TRANS_TABLES` or `STRICT_ALL_TABLES`: refuse a bad value rather than adjust it. */
  readonly strict: boolean
  /** 1-based, as MySQL's messages count rows. */
  row: number
  /** Incremented for each value adjusted rather than refused. */
  warnings: number
  /** The table being written, for the messages that name a column as `table.column` (3140). */
  table?: string
}

const INT_WIDTH: Readonly<Record<number, number>> = {
  [FIELD_TYPE.TINY]: 1,
  [FIELD_TYPE.SHORT]: 2,
  [FIELD_TYPE.INT24]: 3,
  [FIELD_TYPE.LONG]: 4,
  [FIELD_TYPE.LONGLONG]: 8,
}

/**
 * An integer type's range, from its pack length (`Field_tiny` … `Field_longlong`
 * in `sql/field.h`): what a column of it can hold. `undefined` for any other
 * type.
 */
export function integerRange(t: { readonly type: number; readonly unsigned?: boolean }): { readonly min: bigint; readonly max: bigint } | undefined {
  const width = INT_WIDTH[t.type]
  if (width === undefined) return undefined
  const bits = BigInt(width * 8)
  return t.unsigned === true ? { min: 0n, max: 2n ** bits - 1n } : { min: -(2n ** (bits - 1n)), max: 2n ** (bits - 1n) - 1n }
}

/** BLOB and TEXT's byte limits, from `Field_blob`'s pack length. */
const BLOB_BYTES: Readonly<Record<number, number>> = {
  [FIELD_TYPE.TINY_BLOB]: 255,
  [FIELD_TYPE.BLOB]: 65535,
  [FIELD_TYPE.MEDIUM_BLOB]: 16777215,
  [FIELD_TYPE.LONG_BLOB]: 4294967295,
}

const FLOAT_MAX = 3.4028234663852886e38

const isBinaryType = (t: ColumnType): boolean => t.collationId === undefined || t.collationId === CHARSET_BINARY

/** Called for a value that does not fit: an error under a strict mode, a warning and `fallback` otherwise. */
function adjust<T>(ctx: StoreContext, error: () => TypeError_, fallback: T): T {
  if (ctx.strict) throw error()
  ctx.warnings++
  return fallback
}

function nameOfType(t: ColumnType): string {
  switch (t.type) {
    case FIELD_TYPE.FLOAT:
    case FIELD_TYPE.DOUBLE:
      return 'double'
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return 'decimal'
    default:
      return 'integer'
  }
}

/**
 * For a numeric column: whether the value is a number at all, refused or
 * warned about if not. Which error depends on the column, and is 8.4.11's: a
 * DOUBLE or FLOAT calls anything left over "Data truncated" (1265), even
 * `'abc'`; a DECIMAL calls it an incorrect value (1366), even `'1x'`; an
 * integer type says 1366 when there is no number at all and 1265 when one is
 * followed by more (`'1.5x'`).
 */
function numericSource(v: Exclude<Value, null>, column: FieldColumn, ctx: StoreContext): Exclude<Value, null> {
  if (v.kind !== 'string' && v.kind !== 'bytes') return v
  if (v.kind === 'string' && v.ordinal !== undefined) return { kind: 'int', v: v.ordinal, unsigned: true }
  if (v.kind === 'bytes' && v.hex === true) return { kind: 'int', v: hexNumber(v.v), unsigned: true }
  const text = toText(v)
  const p = numericPrefix(text)
  if (p.complete) return v
  const kind = nameOfType(column.type)
  const truncation = kind === 'double' || (kind === 'integer' && /^[ \t\n\r]*[+-]?(?:\d|\.\d)/.test(text))
  return adjust(ctx, () => (truncation ? truncated(column.name, ctx.row) : wrongValueForColumn(kind, text, column.name, ctx.row)), v)
}

/** A value into a column's field bytes, or `null` for SQL NULL. */
export function encodeField(value: Value, column: FieldColumn, ctx: StoreContext): Uint8Array | null {
  const t = column.type
  if (value === null) {
    if (!column.nullable) throw columnCannotBeNull(column.name)
    return null
  }
  const width = INT_WIDTH[t.type]
  if (width !== undefined) return encodeIntField(numericSource(value, column, ctx), width, column, ctx)

  switch (t.type) {
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return encodeDecimalField(numericSource(value, column, ctx), column, ctx)

    case FIELD_TYPE.FLOAT:
    case FIELD_TYPE.DOUBLE: {
      let n = toDouble(numericSource(value, column, ctx))
      let max = t.type === FIELD_TYPE.FLOAT ? FLOAT_MAX : Number.MAX_VALUE
      // FLOAT(M,D): rounded to D decimals, half to even on the fraction, and
      // at most M - D digits before the point (`Field_real::truncate`).
      if (t.precision !== undefined && t.scale !== undefined && Number.isFinite(n) && !(t.unsigned === true && n < 0)) {
        const unit = 10 ** t.scale
        max = Math.min(max, 10 ** (t.precision - t.scale) - 1 / unit)
        const whole = Math.floor(n)
        n = whole + roundHalfEven((n - whole) * unit) / unit
      }
      if (!Number.isFinite(n) || Math.abs(n) > max || (t.unsigned === true && n < 0)) {
        n = adjust(ctx, () => columnOutOfRange(column.name, ctx.row), t.unsigned === true && n < 0 ? 0 : Math.sign(n) * max)
      }
      return t.type === FIELD_TYPE.FLOAT ? encodeFloat(n) : encodeDouble(n)
    }

    case FIELD_TYPE.YEAR: {
      let y = Number(toInteger(numericSource(value, column, ctx)))
      // Two-digit years: 1–69 are 2001–2069 and 70–99 are 1970–1999. A
      // numeric 0 is the zero year; a string '0' would be 2000, which the
      // value kind tells apart.
      if (y > 0 && y < 70) y += 2000
      else if (y >= 70 && y < 100) y += 1900
      if (y !== 0 && (y < 1901 || y > 2155)) y = adjust(ctx, () => columnOutOfRange(column.name, ctx.row), 0)
      return encodeYear(y)
    }

    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.DATETIME2:
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIMESTAMP2:
      return encodeTemporalField(value, column, ctx)

    case FIELD_TYPE.TIME:
    case FIELD_TYPE.TIME2: {
      const tv = toTime(value)
      const fsp = t.decimals ?? 0
      if (tv === undefined) {
        adjust(ctx, () => wrongTemporalValue('time', toText(value), column.name, ctx.row), undefined)
        return encodeTime2({ negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }, fsp)
      }
      return encodeTime2(roundTime(tv.v, fsp), fsp)
    }

    case FIELD_TYPE.ENUM: {
      const members = t.members ?? []
      const index = memberIndex(value, members, t.collationId)
      if (index === undefined) return encodeEnum(adjust(ctx, () => truncated(column.name, ctx.row), 0), members.length)
      return encodeEnum(index, members.length)
    }

    case FIELD_TYPE.SET: {
      const members = t.members ?? []
      // A number, or a string of digits that names no member, is the bitmap itself (8.4.11).
      const all = (1n << BigInt(members.length)) - 1n
      const asBits = (n: bigint) => (n > all ? adjust(ctx, () => truncated(column.name, ctx.row), n & all) : n & all)
      if (value.kind === 'int' || value.kind === 'decimal' || value.kind === 'double' || (value.kind === 'bytes' && value.hex === true)) return encodeSet(asBits(toInteger(value)), members.length)
      let mask = 0n
      const text = toText(value)
      if (/^\d+$/.test(text) && !members.includes(text)) return encodeSet(asBits(BigInt(text)), members.length)
      for (const item of text === '' ? [] : text.split(',')) {
        const i = memberIndex(string(item, t.collationId ?? 255), members, t.collationId, false)
        if (i === undefined || i === 0) adjust(ctx, () => truncated(column.name, ctx.row), 0)
        else mask |= 1n << BigInt(i - 1)
      }
      return encodeSet(mask, members.length)
    }

    case FIELD_TYPE.BIT: {
      const bits = t.bits ?? 1
      let n = value.kind === 'bytes' ? bytesToBigint(value.v) : toInteger(value)
      if (n < 0n || n >= 1n << BigInt(bits)) n = adjust(ctx, () => columnOutOfRange(column.name, ctx.row), n < 0n ? 0n : (1n << BigInt(bits)) - 1n)
      return encodeBit(n, bits)
    }

    case FIELD_TYPE.JSON:
      return encodeJsonField(value, column, ctx)

    case FIELD_TYPE.STRING:
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.VARCHAR:
    case FIELD_TYPE.TINY_BLOB:
    case FIELD_TYPE.BLOB:
    case FIELD_TYPE.MEDIUM_BLOB:
    case FIELD_TYPE.LONG_BLOB:
      return isBinaryType(t) ? encodeBinaryField(value, column, ctx) : encodeTextField(value, column, ctx)

    default:
      throw unsupportedType(`storing a value in a column of field type ${t.type}`)
  }
}

/**
 * A value into a JSON column (M5.21): a JSON value as it is, a string parsed
 * as a JSON text, and anything else refused — 3140 even for a number, which
 * "may need CAST", and 3144 for a binary string (8.4.11). A mode does not
 * soften either.
 */
function encodeJsonField(value: Exclude<Value, null>, column: FieldColumn, ctx: StoreContext): Uint8Array {
  const name = ctx.table === undefined ? column.name : `${ctx.table}.${column.name}`
  if (value.kind === 'json') return encodeJsonDoc(value.v)
  if (value.kind === 'bytes') throw invalidJsonCharset('')
  if (value.kind !== 'string') throw invalidJsonText('not a JSON text, may need CAST', 0, name)
  try {
    return encodeJsonDoc(parseJson(value.v))
  } catch (e) {
    if (e instanceof JsonSyntaxError) throw invalidJsonText(e.message, e.position, name)
    throw e
  }
}

/** ER_WARN_DATA_TRUNCATED, 1265 / 01000 — refused under a strict mode. */
function truncated(column: string, row: number): TypeError_ {
  return new TypeError_('WARN_DATA_TRUNCATED', `Data truncated for column '${column}' at row ${row}`, { errno: 1265, sqlState: '01000' })
}

function bytesToBigint(b: Uint8Array): bigint {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n
}

function encodeIntField(v: Exclude<Value, null>, width: number, column: FieldColumn, ctx: StoreContext): Uint8Array {
  const unsigned = column.type.unsigned === true
  const range = unsigned ? unsignedRange(width) : signedRange(width)
  let n: bigint
  if (v.kind === 'double' && !Number.isFinite(v.v)) n = v.v > 0 ? MAX_UNSIGNED + 1n : -(MAX_UNSIGNED + 1n)
  else n = toInteger(v)
  if (n < range.min || n > range.max) n = adjust(ctx, () => columnOutOfRange(column.name, ctx.row), n < range.min ? range.min : range.max)
  return encodeInt(n, width, unsigned)
}

function encodeDecimalField(v: Exclude<Value, null>, column: FieldColumn, ctx: StoreContext): Uint8Array {
  const precision = column.type.precision ?? 10
  const scale = column.type.scale ?? 0
  const exact = toDecimal(v)
  let d: DecimalValue = rescale(exact, scale)
  const max = decimal(pow10(precision) - 1n, scale)
  if (decimalIntegerDigits(d) > precision - scale || (column.type.unsigned === true && d.v < 0n)) {
    d = adjust(ctx, () => columnOutOfRange(column.name, ctx.row), d.v < 0n ? (column.type.unsigned === true ? decimal(0n, scale) : decimal(-max.v, scale)) : max)
  } else if (exact.scale > scale && exact.v % pow10(exact.scale - scale) !== 0n) {
    // Rounded past the scale: Note 1265, whatever the mode (8.4.11).
    ctx.warnings++
  }
  return encodeDecimal(renderDecimal(d), precision, scale)
}

/**
 * Fractional seconds beyond the column's precision are rounded, half up, and
 * the carry is carried: `'2020-12-31 23:59:59.7'` into a DATETIME is
 * `2021-01-01 00:00:00`, as 8.4.11 stores it (`TIME_TRUNCATE_FRACTIONAL` is
 * off by default). Truncating, as this first did, was found by review.
 */
export function roundDateTime(v: MysqlDateTime, fsp: number): MysqlDateTime {
  const unit = 10 ** (6 - fsp)
  const us = Math.round(v.microsecond / unit) * unit
  if (us < 1_000_000) return { ...v, microsecond: us }
  // One second more. `Date` does the calendar; years below 100 are set
  // explicitly, since `Date.UTC` reads them as 1900 + y.
  const d = new Date(0)
  d.setUTCFullYear(v.year, v.month - 1, v.day)
  d.setUTCHours(v.hour, v.minute, v.second + 1, 0)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), microsecond: 0 }
}

/** A TIME rounded the same way: `'10:00:59.5'` into a TIME is `10:01:00`. */
export function roundTime(t: MysqlTime, fsp: number): MysqlTime {
  const unit = 10 ** (6 - fsp)
  const seconds = ((t.days * 24 + t.hour) * 60 + t.minute) * 60 + t.second
  const total = Math.round((seconds * 1_000_000 + t.microsecond) / unit) * unit
  const s = Math.floor(total / 1_000_000)
  const hours = Math.floor(s / 3600)
  return { negative: t.negative, days: Math.floor(hours / 24), hour: hours % 24, minute: Math.floor(s / 60) % 60, second: s % 60, microsecond: total % 1_000_000 }
}

const ZERO_DATE: MysqlDateTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }

function encodeTemporalField(value: Exclude<Value, null>, column: FieldColumn, ctx: StoreContext): Uint8Array {
  const t = column.type
  const type = t.type === FIELD_TYPE.DATE || t.type === FIELD_TYPE.NEWDATE ? 'DATE' : t.type === FIELD_TYPE.DATETIME || t.type === FIELD_TYPE.DATETIME2 ? 'DATETIME' : 'TIMESTAMP'
  const fsp = type === 'DATE' ? 0 : (t.decimals ?? 0)
  const dt = toDateTime(value, type)
  let v: MysqlDateTime
  if (dt === undefined) {
    const label = type === 'DATE' ? 'date' : type === 'DATETIME' ? 'datetime' : 'datetime'
    v = adjust(ctx, () => wrongTemporalValue(label, toText(value), column.name, ctx.row), ZERO_DATE)
  } else v = roundDateTime(dt.v, fsp)

  // A time of day a DATE drops: 1292 under a strict mode, 1265 without one,
  // a warning either way (8.4.11) — and a fraction of a second is none.
  if (type === 'DATE' && dt !== undefined) {
    const full = toDateTime(value, 'DATETIME')
    const time = full === undefined ? undefined : roundDateTime(full.v, 0)
    if (time !== undefined && (time.hour !== 0 || time.minute !== 0 || time.second !== 0)) ctx.warnings++
  }
  if (type === 'DATE') return dateFieldToStorage(encodeDateField(v.year, v.month, v.day))
  if (type === 'DATETIME') return encodeDatetime2(v, fsp)
  // TIMESTAMP: the session `time_zone` is taken to be UTC (doc 15's
  // conversion; `@@time_zone` is SYSTEM and the system zone is UTC here).
  if (v.year === 0 && v.month === 0 && v.day === 0) return encodeTimestamp2(0, 0, fsp)
  const seconds = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) / 1000
  if (seconds < 1 || seconds > 2147483647) {
    adjust(ctx, () => wrongTemporalValue('datetime', toText(value), column.name, ctx.row), undefined)
    return encodeTimestamp2(0, 0, fsp)
  }
  return encodeTimestamp2(seconds, v.microsecond, fsp)
}

/** The 1-based index of the member a value names, or 0 — ENUM's "no member" slot. */
/** C's `rint` in the default rounding mode: halves go to the even neighbour. */
function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

function memberIndex(value: Exclude<Value, null>, members: readonly string[], collationId: number | undefined, digits = true): number | undefined {
  // A number is an index, whatever its type: `e + 1` is a DOUBLE, and 2.0
  // names the second member (8.4.11). Index 0 is the error value, ''.
  if (value.kind === 'int' || value.kind === 'decimal' || value.kind === 'double' || (value.kind === 'bytes' && value.hex === true)) {
    const n = value.kind === 'double' ? value.v : Number(toText(value.kind === 'bytes' ? int(toInteger(value), true) : value))
    // A number names a member: 0 is not one (8.4.11: 1265).
    if (!Number.isInteger(n)) return undefined
    return n >= 1 && n <= members.length ? n : undefined
  }
  const text = toText(value)
  const id = collationId ?? 255
  const c = collation(id)
  const key = encodeCollation(text.replace(/ +$/, ''), id)
  for (let i = 0; i < members.length; i++) {
    if (c.compare(encodeCollation(members[i] as string, id), key) === 0) return i + 1
  }
  // A string no member is named, that is a whole number, is an index too:
  // '3' is the third member and '0' the error value. Leading spaces are read
  // as the number's, and trailing ones go as they do for a name (8.4.11).
  const trimmed = text.replace(/ +$/, '')
  if (digits && /^\s*\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    return n <= members.length ? n : undefined
  }
  return undefined
}

function encodeBinaryField(value: Exclude<Value, null>, column: FieldColumn, ctx: StoreContext): Uint8Array {
  const t = column.type
  let b = value.kind === 'bytes' ? value.v : value.kind === 'string' ? encodeCollation(value.v, value.collationId) : new TextEncoder().encode(toText(value))
  const limit = BLOB_BYTES[t.type] ?? t.length ?? 1
  if (b.length > limit) b = adjust(ctx, () => dataTooLong(column.name, ctx.row), b.subarray(0, limit))
  return t.type === FIELD_TYPE.STRING ? padBinary(b, t.length ?? 1) : b
}

function encodeTextField(value: Exclude<Value, null>, column: FieldColumn, ctx: StoreContext): Uint8Array {
  const t = column.type
  const id = t.collationId as number
  let text = value.kind === 'bytes' ? decodeCollation(value.v, id) : toText(value)
  const blobLimit = BLOB_BYTES[t.type]
  if (blobLimit === undefined) {
    const chars = [...text]
    const length = t.length ?? 1
    if (chars.length > length) {
      // Excess trailing spaces are dropped with a note, not refused; a
      // CHAR's are padding, and go silently (8.4.11).
      const kept = chars.slice(0, length).join('')
      if (/^ *$/.test(chars.slice(length).join(''))) {
        text = kept
        if (t.type !== FIELD_TYPE.STRING) ctx.warnings++
      }
      else text = adjust(ctx, () => dataTooLong(column.name, ctx.row), kept)
    }
  }
  let b = encodeCollation(text, id)
  if (blobLimit !== undefined && b.length > blobLimit) b = adjust(ctx, () => dataTooLong(column.name, ctx.row), b.subarray(0, blobLimit))
  if (t.type === FIELD_TYPE.STRING) {
    const info = requireCollationInfo(id)
    // doc 24: a CHAR is fixed and space-padded in a single-byte charset, and
    // stored without its trailing spaces in a multi-byte one.
    return info.mbmaxlen === 1 ? padChar(b, t.length ?? 1) : trimTrailingSpaces(b)
  }
  return b
}

// --- reading --------------------------------------------------------------------

/** A column's field bytes back into a value. */
export function decodeField(field: Uint8Array | null, t: ColumnType): Value {
  if (field === null) return null
  const width = INT_WIDTH[t.type]
  if (width !== undefined) return int(decodeInt(field, t.unsigned === true), t.unsigned === true)
  switch (t.type) {
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return parseDecimal(decodeDecimal(field, t.precision ?? 10, t.scale ?? 0))
    case FIELD_TYPE.JSON:
      return json(decodeJsonDoc(field))
    // A FLOAT's value prints as a float does, and a FLOAT(M,D)'s with its D.
    case FIELD_TYPE.FLOAT:
      return { ...double(decodeFloat(field)), float: true, ...(t.precision !== undefined && t.scale !== undefined ? { decimals: t.scale } : {}) }
    case FIELD_TYPE.DOUBLE:
      return t.precision !== undefined && t.scale !== undefined ? { ...double(decodeDouble(field)), decimals: t.scale } : double(decodeDouble(field))
    case FIELD_TYPE.YEAR:
      return int(BigInt(decodeYear(field)), true)
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE: {
      const d = decodeDateField(dateStorageToField(field))
      return { kind: 'datetime', v: { ...d, hour: 0, minute: 0, second: 0, microsecond: 0 }, type: 'DATE', fsp: 0 }
    }
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.DATETIME2:
      return { kind: 'datetime', v: decodeDatetime2(field, t.decimals ?? 0), type: 'DATETIME', fsp: t.decimals ?? 0 }
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIMESTAMP2: {
      const { epochSeconds, microsecond } = decodeTimestamp2(field, t.decimals ?? 0)
      if (epochSeconds === 0 && microsecond === 0) return { kind: 'datetime', v: ZERO_DATE, type: 'TIMESTAMP', fsp: t.decimals ?? 0 }
      const d = new Date(epochSeconds * 1000)
      const v: MysqlDateTime = {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        microsecond,
      }
      return { kind: 'datetime', v, type: 'TIMESTAMP', fsp: t.decimals ?? 0 }
    }
    case FIELD_TYPE.TIME:
    case FIELD_TYPE.TIME2:
      return { kind: 'time', v: decodeTime2(field, t.decimals ?? 0), fsp: t.decimals ?? 0 }
    case FIELD_TYPE.ENUM: {
      const i = decodeEnum(field)
      return { ...string(i === 0 ? '' : (enumMember(i, t.members ?? []) ?? ''), t.collationId ?? 255, COERCIBILITY.IMPLICIT), ordinal: BigInt(i) }
    }
    case FIELD_TYPE.SET: {
      const bits = decodeSet(field)
      return { ...string(setMembers(bits, t.members ?? []).join(','), t.collationId ?? 255, COERCIBILITY.IMPLICIT), ordinal: BigInt(bits) }
    }
    case FIELD_TYPE.BIT:
      return int(decodeBit(field), true)
    case FIELD_TYPE.STRING:
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.VARCHAR:
    case FIELD_TYPE.TINY_BLOB:
    case FIELD_TYPE.BLOB:
    case FIELD_TYPE.MEDIUM_BLOB:
    case FIELD_TYPE.LONG_BLOB: {
      if (isBinaryType(t)) return { kind: 'bytes', v: field }
      const text = decodeCollation(field, t.collationId as number)
      // A CHAR's trailing spaces are padding, and are not returned
      // (`PAD_CHAR_TO_FULL_LENGTH` off).
      return string(t.type === FIELD_TYPE.STRING ? text.replace(/ +$/, '') : text, t.collationId as number, COERCIBILITY.IMPLICIT)
    }
    default:
      throw unsupportedType(`reading a column of field type ${t.type}`)
  }
}

