// M1.21, M1.22 — binary-protocol value codecs.
//
// Layouts and byte dumps from docs/15-wire-types.md. Two rules that catch
// everyone:
//
//   `INT24` occupies **four** bytes on the wire, not three.
//
//   DECIMAL and JSON travel as `string<lenenc>` even in the binary protocol.
//   There is no binary numeric form for DECIMAL on the wire.
//
// Temporals decode into neutral structs rather than `Date`, because a `Date`
// cannot hold microseconds and doc 15's own examples have them. The
// `Date`-shaped mapping D-15 specifies belongs at the driver boundary, not in
// the codec.

import {
  isMysqlDateTime,
  isMysqlTime,
  Reader,
  renderMysqlDateTime,
  renderMysqlTime,
  Writer,
} from '@myjs/bytes'
import type { MysqlDateTime, MysqlTime, SqlValue } from '@myjs/bytes'
import { FIELD_TYPE } from './constants/types.ts'
import { protocolError } from './errors/index.ts'
import { fromUtf8, utf8 } from './text.ts'

// D-32: the structs themselves live in `@myjs/bytes`, so `@myjs/types` can
// name them without either package depending on the other. Re-exported here
// because they are part of this package's published surface.
export { isMysqlDateTime, isMysqlTime }
export type { MysqlDateTime, MysqlTime }

/** Anything the binary codec can carry. */
export type BinaryValue = SqlValue | MysqlDateTime | MysqlTime

const LENENC_TYPES: readonly number[] = [
  FIELD_TYPE.STRING,
  FIELD_TYPE.VARCHAR,
  FIELD_TYPE.VAR_STRING,
  FIELD_TYPE.ENUM,
  FIELD_TYPE.SET,
  FIELD_TYPE.TINY_BLOB,
  FIELD_TYPE.MEDIUM_BLOB,
  FIELD_TYPE.LONG_BLOB,
  FIELD_TYPE.BLOB,
  FIELD_TYPE.GEOMETRY,
  FIELD_TYPE.BIT,
  FIELD_TYPE.DECIMAL,
  FIELD_TYPE.NEWDECIMAL,
  FIELD_TYPE.JSON,
  FIELD_TYPE.VECTOR,
]

export function isLengthEncodedType(type: number): boolean {
  return LENENC_TYPES.includes(type)
}

// --- temporals ------------------------------------------------------------

/**
 * `DATE` / `DATETIME` / `TIMESTAMP`: a length byte of 0, 4, 7 or 11, then that
 * many bytes. A writer **must** emit the shortest form; a reader must accept
 * all four.
 */
export function writeBinaryDateTime(w: Writer, v: MysqlDateTime): void {
  const allZero =
    v.year === 0 && v.month === 0 && v.day === 0 && v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0
  if (allZero) {
    w.u8(0)
    return
  }
  const hasTime = v.hour !== 0 || v.minute !== 0 || v.second !== 0
  const hasMicros = v.microsecond !== 0
  w.u8(hasMicros ? 11 : hasTime ? 7 : 4)
  w.u16(v.year)
  w.u8(v.month)
  w.u8(v.day)
  if (!hasTime && !hasMicros) return
  w.u8(v.hour)
  w.u8(v.minute)
  w.u8(v.second)
  if (hasMicros) w.u32(v.microsecond)
}

export function readBinaryDateTime(r: Reader): MysqlDateTime {
  const length = r.u8()
  if (length === 0) {
    // The zero date, which round-trips only because it has its own encoding.
    return { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  }
  if (length !== 4 && length !== 7 && length !== 11) {
    throw protocolError('ER_MALFORMED_PACKET', `binary DATETIME length must be 0, 4, 7 or 11, got ${length}`)
  }
  const year = r.u16()
  const month = r.u8()
  const day = r.u8()
  if (length === 4) return { year, month, day, hour: 0, minute: 0, second: 0, microsecond: 0 }
  const hour = r.u8()
  const minute = r.u8()
  const second = r.u8()
  const microsecond = length === 11 ? r.u32() : 0
  return { year, month, day, hour, minute, second, microsecond }
}

/**
 * `TIME`: a length byte of 0, 8 or 12.
 *
 * The `days` + `hour` split is why TIME can reach 838 hours: `838:59:59` is 34
 * days and 22 hours. `hour` itself stays in 0..23.
 */
export function writeBinaryTime(w: Writer, v: MysqlTime): void {
  const allZero = v.days === 0 && v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0
  if (allZero) {
    w.u8(0)
    return
  }
  const hasMicros = v.microsecond !== 0
  w.u8(hasMicros ? 12 : 8)
  w.u8(v.negative ? 1 : 0)
  w.u32(v.days)
  w.u8(v.hour)
  w.u8(v.minute)
  w.u8(v.second)
  if (hasMicros) w.u32(v.microsecond)
}

export function readBinaryTime(r: Reader): MysqlTime {
  const length = r.u8()
  if (length === 0) {
    return { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  }
  if (length !== 8 && length !== 12) {
    throw protocolError('ER_MALFORMED_PACKET', `binary TIME length must be 0, 8 or 12, got ${length}`)
  }
  const negative = r.u8() === 1
  const days = r.u32()
  const hour = r.u8()
  const minute = r.u8()
  const second = r.u8()
  const microsecond = length === 12 ? r.u32() : 0
  return { negative, days, hour, minute, second, microsecond }
}

// --- scalars --------------------------------------------------------------

export interface BinaryFieldSpec {
  readonly type: number
  readonly unsigned?: boolean
}

/** Write one value in the binary protocol. NULL is carried by the bitmap. */
export function writeBinaryValue(w: Writer, value: BinaryValue, field: BinaryFieldSpec): void {
  const { type } = field
  if (value === null) return // the bitmap says so; nothing is written

  if (isMysqlTime(value)) return writeBinaryTime(w, value)
  if (isMysqlDateTime(value)) return writeBinaryDateTime(w, value)
  if (value instanceof Date) return writeBinaryDateTime(w, dateToMysql(value))

  if (isLengthEncodedType(type)) {
    w.lenEncBytes(value instanceof Uint8Array ? value : utf8(String(value)))
    return
  }

  switch (type) {
    case FIELD_TYPE.TINY:
      w.u8(Number(value))
      return
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.YEAR:
      w.u16(Number(value))
      return
    // INT24 is four bytes on the wire, exactly like LONG.
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.INT24:
      w.u32(Number(value))
      return
    case FIELD_TYPE.LONGLONG:
      w.u64(typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value))))
      return
    case FIELD_TYPE.FLOAT:
      w.f32(Number(value))
      return
    case FIELD_TYPE.DOUBLE:
      w.f64(Number(value))
      return
    case FIELD_TYPE.NULL:
      return
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
      w.u8(0)
      return
    case FIELD_TYPE.TIME:
      w.u8(0)
      return
    default:
      throw protocolError('ER_MALFORMED_PACKET', `no binary encoding for field type 0x${type.toString(16)}`)
  }
}

/**
 * Read one value in the binary protocol.
 *
 * Signedness is *not* in the value — it comes from `UNSIGNED_FLAG` in the
 * column definition, or from the parameter's flag byte. Decoding `int<8>`
 * without consulting it produces negative `BIGINT UNSIGNED` values, which is a
 * classic driver bug.
 */
export function readBinaryValue(r: Reader, field: BinaryFieldSpec): BinaryValue {
  const { type, unsigned = false } = field

  if (isLengthEncodedType(type)) {
    const bytes = r.lenEncBytes()
    return bytes === null ? null : bytes
  }

  switch (type) {
    case FIELD_TYPE.TINY:
      return unsigned ? r.u8() : r.i8()
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.YEAR:
      return unsigned ? r.u16() : r.i16()
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.INT24:
      return unsigned ? r.u32() : r.i32()
    case FIELD_TYPE.LONGLONG:
      return unsigned ? r.u64() : r.i64()
    case FIELD_TYPE.FLOAT:
      return r.f32()
    case FIELD_TYPE.DOUBLE:
      return r.f64()
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
      return readBinaryDateTime(r)
    case FIELD_TYPE.TIME:
      return readBinaryTime(r)
    case FIELD_TYPE.NULL:
      return null
    default:
      throw protocolError('ER_MALFORMED_PACKET', `no binary decoding for field type 0x${type.toString(16)}`)
  }
}

export function dateToMysql(d: Date): MysqlDateTime {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    microsecond: d.getUTCMilliseconds() * 1000,
  }
}

/** Render a decoded binary value the way the text protocol would print it. */
export function binaryValueToText(value: BinaryValue): string {
  if (value === null) return 'NULL'
  // D-37: the temporal renderers moved to `@myjs/bytes` beside the structs, so
  // this and `@myjs/types`' driver mapping print a value the same way rather
  // than two ways that happen to agree today.
  if (isMysqlTime(value)) return renderMysqlTime(value, value.microsecond === 0 ? 0 : 6)
  if (isMysqlDateTime(value)) return renderMysqlDateTime(value, value.microsecond === 0 ? 0 : 6)
  if (value instanceof Uint8Array) return fromUtf8(value)
  return String(value)
}
