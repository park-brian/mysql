// M2.24 — the value model D-32 promised and no work item created.
//
// D-32 says `@myjs/types` "owns the *rules* — it defines a separate
// engine-facing `StorageValue` and a named `toDriverValue()` for D-15, rather
// than widening `SqlValue`". The structs moved down to `@myjs/bytes` as
// specified; the rules never got written. This is them.
//
// Two functions, pulling in opposite directions:
//
//   `decodeStorageValue` turns MySQL's *storage* bytes into a neutral value.
//   Every codec it needs already exists in this package — it is a dispatcher,
//   not a decoder. It is also what doc 28's binary-JSON reader calls for a
//   `custom-data` tag, which is why M2.13 waited on this.
//
//   `toDriverValue` turns a neutral value into the JavaScript an application
//   sees, exactly as `mysql2` would (D-15). "Exactly" is the whole point:
//   swapping a real connection for ours must change nothing in the
//   application, so every row of doc 15's mapping table is a rule here rather
//   than a default someone can drift from.
//
// The union is deliberately *not* `SqlValue`. `SqlValue` is what crosses the
// protocol seam and is shaped by what a driver can receive; `StorageValue` is
// what the engine holds and is shaped by what MySQL stores — microsecond
// precision, the zero date, durations beyond 24 hours, DECIMAL beyond a
// double. Widening one into the other would lose exactly the values that make
// the distinction worth having.
import {
  CHARSET_BINARY,
  FIELD_TYPE,
  renderMysqlDateTime,
  renderMysqlTime,
  type MysqlDateTime,
  type MysqlTime,
  type SqlValue,
} from '@myjs/bytes'
import { decodeCollation } from '@myjs/charsets'
import { badValue, unsupportedType } from './errors.ts'
import { decodeInt, decodeUnsignedInt } from './integers.ts'
import { decodeDecimal } from './decimal.ts'
import { decodeDouble, decodeFloat } from './floats.ts'
import {
  decodeDatetime2,
  decodeDateField,
  decodeTime2,
  decodeTimestamp2,
  decodeYear,
} from './temporal.ts'
import { decodeBit, decodeEnum, decodeSet, enumMember, setMembers } from './strings.ts'

/**
 * A TIMESTAMP as MySQL stores it: seconds since the epoch, in UTC.
 *
 * Held apart from `MysqlDateTime` because it genuinely is a different thing.
 * Doc 15: "MySQL `DATETIME` has no timezone; `TIMESTAMP` is stored as UTC and
 * converted using the session `time_zone`." That conversion needs a session,
 * which a codec does not have — so this carries the stored value and the
 * executor converts it (M5).
 */
export interface MysqlTimestamp {
  readonly epochSeconds: number
  readonly microsecond: number
}

export function isMysqlTimestamp(v: unknown): v is MysqlTimestamp {
  return typeof v === 'object' && v !== null && 'epochSeconds' in v
}

/** What the engine holds for one column value. */
export type StorageValue =
  | null
  | bigint
  | number
  | string
  | readonly string[]
  | Uint8Array
  | MysqlDateTime
  | MysqlTime
  | MysqlTimestamp

/**
 * Everything a decoder needs beyond the bytes.
 *
 * Not an invention: each field is here because one of the existing codecs
 * takes it. `unsigned` decides the sign flip (doc 24 Rule 1); `precision` and
 * `scale` size a DECIMAL; `decimals` is the fractional-second width a packed
 * temporal was written with; `members` turns an ENUM index or a SET mask back
 * into labels, which is why doc 27 says a record cannot be decoded without the
 * dictionary; `collationId` decides both the charset and — through id 63 —
 * whether a string family column is text or bytes at all.
 */
export interface ColumnMeta {
  readonly type: number
  readonly unsigned?: boolean
  readonly precision?: number
  readonly scale?: number
  /** Fractional-second digits, 0–6. */
  readonly decimals?: number
  readonly members?: readonly string[]
  readonly collationId?: number
  /** Declared width of a BIT column, 1–64. */
  readonly bits?: number
}

/** Whether a column of this type and collation holds bytes rather than text. */
function isBinary(meta: ColumnMeta): boolean {
  return meta.collationId === undefined || meta.collationId === CHARSET_BINARY
}

function require<T>(value: T | undefined, what: string, type: number): T {
  if (value === undefined) {
    throw badValue('storage value', `${what} is required to decode field type 0x${type.toString(16)}`)
  }
  return value
}

/**
 * MySQL's *storage* bytes → a neutral value.
 *
 * This is doc 28's `decodeStorageValue`, and doc 24's encodings in reverse.
 * Every branch delegates: the codecs were written in M2.8–M2.12 and none of
 * them is reimplemented here.
 */
export function decodeStorageValue(fieldType: number, bytes: Uint8Array, meta: ColumnMeta = { type: fieldType }): StorageValue {
  const m: ColumnMeta = meta.type === fieldType ? meta : { ...meta, type: fieldType }
  switch (fieldType) {
    case FIELD_TYPE.NULL:
      return null

    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.LONGLONG:
      return m.unsigned === true ? decodeUnsignedInt(bytes) : decodeInt(bytes, false)

    case FIELD_TYPE.FLOAT:
      return decodeFloat(bytes)
    case FIELD_TYPE.DOUBLE:
      return decodeDouble(bytes)

    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return decodeDecimal(bytes, require(m.precision, 'precision', fieldType), require(m.scale, 'scale', fieldType))

    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE: {
      const { year, month, day } = decodeDateField(bytes)
      return { year, month, day, hour: 0, minute: 0, second: 0, microsecond: 0 }
    }
    case FIELD_TYPE.DATETIME2:
    case FIELD_TYPE.DATETIME:
      return decodeDatetime2(bytes, m.decimals ?? 0)
    case FIELD_TYPE.TIMESTAMP2:
    case FIELD_TYPE.TIMESTAMP:
      return decodeTimestamp2(bytes, m.decimals ?? 0)
    case FIELD_TYPE.TIME2:
    case FIELD_TYPE.TIME:
      return decodeTime2(bytes, m.decimals ?? 0)
    case FIELD_TYPE.YEAR:
      return decodeYear(bytes)

    case FIELD_TYPE.ENUM: {
      const members = require(m.members, 'members', fieldType)
      const index = decodeEnum(bytes)
      // Index 0 is MySQL's invalid-value slot and has no label; it renders as
      // the empty string rather than as an error, which is what MySQL does.
      return index === 0 ? '' : (enumMember(index, members) ?? '')
    }
    case FIELD_TYPE.SET:
      return setMembers(decodeSet(bytes), require(m.members, 'members', fieldType))

    case FIELD_TYPE.BIT:
      return decodeBit(bytes)

    case FIELD_TYPE.STRING:
    case FIELD_TYPE.VARCHAR:
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.BLOB:
    case FIELD_TYPE.TINY_BLOB:
    case FIELD_TYPE.MEDIUM_BLOB:
    case FIELD_TYPE.LONG_BLOB:
      // Doc 15's disambiguation rule: the type byte cannot tell VARCHAR from
      // VARBINARY or TEXT from BLOB, and only the collation can.
      return isBinary(m) ? bytes : decodeCollation(bytes, m.collationId as number)

    // JSON, GEOMETRY and VECTOR keep their bytes. JSON's are binary JSON
    // (M2.13); geometry's are SRID + WKB, which doc 15 says we hand over
    // unparsed unless asked.
    case FIELD_TYPE.JSON:
    case FIELD_TYPE.GEOMETRY:
    case FIELD_TYPE.VECTOR:
      return bytes

    default:
      throw unsupportedType(`storage decoding for field type 0x${fieldType.toString(16)}`)
  }
}

/** Options an application can set, matching `mysql2`'s names (doc 15). */
export interface DriverOptions {
  /** Return temporals as strings rather than `Date`, so the zero date survives. */
  readonly dateStrings?: boolean
  /** Return every BIGINT as a `BigInt`, even when it would fit a double. */
  readonly supportBigNumbers?: boolean
}

/** The zero date, which MySQL can represent and `Date` cannot. */
function isZeroDate(v: MysqlDateTime): boolean {
  return v.year === 0 && v.month === 0 && v.day === 0
}

function toDate(v: MysqlDateTime): Date {
  // UTC, because a `MysqlDateTime` carries no zone and a local-time
  // constructor would shift the value by the host's offset.
  const d = new Date(Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second, Math.floor(v.microsecond / 1000)))
  // `Date.UTC` maps years 0–99 into 1900–1999; MySQL means the year literally.
  if (v.year >= 0 && v.year < 100) d.setUTCFullYear(v.year)
  return d
}

/**
 * A neutral value → the JavaScript an application sees (D-15).
 *
 * Every row of doc 15's mapping table, as code. The two that surprise people
 * are both here and both deliberate: TIME is a string because it is a
 * *duration* and mapping it to a `Date` is wrong, and the zero date becomes
 * `null` unless `dateStrings` is on, because `Date` cannot hold it — which is
 * what `mysql2` does.
 */
export function toDriverValue(value: StorageValue, meta: ColumnMeta, options: DriverOptions = {}): SqlValue {
  if (value === null) return null

  switch (meta.type) {
    case FIELD_TYPE.LONGLONG: {
      const n = value as bigint
      if (options.supportBigNumbers === true) return n
      // Silent precision loss is unacceptable, so narrow only when it is
      // provably lossless.
      return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n
    }
    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.LONG:
      // Always exact in a double: the widest is 32 bits unsigned.
      return Number(value as bigint)

    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.DATETIME2: {
      const v = value as MysqlDateTime
      const decimals = meta.type === FIELD_TYPE.DATE ? 0 : (meta.decimals ?? 0)
      if (options.dateStrings === true) return renderMysqlDateTime(v, decimals)
      return isZeroDate(v) ? null : toDate(v)
    }
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIMESTAMP2: {
      const v = value as MysqlTimestamp
      const d = new Date(v.epochSeconds * 1000 + Math.floor(v.microsecond / 1000))
      if (options.dateStrings !== true) return d
      return renderMysqlDateTime(
        {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          hour: d.getUTCHours(),
          minute: d.getUTCMinutes(),
          second: d.getUTCSeconds(),
          microsecond: v.microsecond,
        },
        meta.decimals ?? 0,
      )
    }
    case FIELD_TYPE.TIME:
    case FIELD_TYPE.TIME2:
      // Always a string, `dateStrings` or not: a duration is not an instant.
      return renderMysqlTime(value as MysqlTime, meta.decimals ?? 0)

    case FIELD_TYPE.SET:
      return (value as readonly string[]).join(',')

    case FIELD_TYPE.BIT: {
      const n = value as bigint
      // Doc 15: a `number` up to BIT(53), where a double is still exact.
      if ((meta.bits ?? 64) <= 53) return Number(n)
      return bitsToBytes(n, meta.bits ?? 64)
    }

    case FIELD_TYPE.JSON:
      return JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value as Uint8Array)) as SqlValue

    default:
      // DECIMAL is already a string, FLOAT/DOUBLE/YEAR are already numbers,
      // text is already a string and BLOB/BINARY/GEOMETRY are already bytes —
      // `decodeStorageValue` made those choices, and D-15 agrees with every
      // one of them.
      return value as SqlValue
  }
}

function bitsToBytes(value: bigint, bits: number): Uint8Array {
  const width = Math.ceil(bits / 8)
  const out = new Uint8Array(width)
  let v = value
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}
