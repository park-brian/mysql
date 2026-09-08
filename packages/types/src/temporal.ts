// M2.11 — the temporal family. Doc 24 §Temporal types, from `mysys/my_time.cc`
// and `sql/field.cc`.
//
// MySQL 5.6.4 introduced the fractional-second types (`DATETIME2`,
// `TIMESTAMP2`, `TIME2`). Modern tables use those; legacy tablespaces may hold
// the old ones, whose byte lengths overlap — so a reader must be told which it
// is by the dictionary, never guess. That is Q-07, and it is why the legacy
// decoders below take no part in encoding.
//
// The two facts that catch people, both from doc 24:
//
//   The month occupies its slot as `year * 13 + month`, not `year * 12`,
//   because month 0 is legal (the zero date).
//
//   All modern temporals are `DATA_FIXBINARY` in InnoDB, so these bytes are
//   *exactly* what is on disk — no further transform. `DATE` and `YEAR` are
//   the exception: they are `DATA_INT` and get the doc-24 Rule 1 treatment on
//   top, which is why `encodeDate` and `dateToStorage` are separate functions.
import type { MysqlDateTime, MysqlTime } from '@myjs/bytes'
import { badValue, outOfRange } from './errors.ts'
import { decodeInt, encodeInt } from './integers.ts'

/** `#define DATETIMEF_INT_OFS 0x8000000000LL` — makes the packed value unsigned so it sorts. */
export const DATETIMEF_INT_OFS = 0x8000000000n

/** `TIME2`'s equivalent offset over its three bytes. */
export const TIMEF_INT_OFS = 0x800000n

/** Extra bytes carried by a fractional precision of 0..6 (doc 24's table). */
export function fractionalBytes(dec: number): number {
  if (dec < 0 || dec > 6) throw outOfRange('fractional seconds precision', dec)
  return Math.ceil(dec / 2)
}

function putBE(out: Uint8Array, at: number, width: number, value: bigint): void {
  for (let i = width - 1; i >= 0; i--) {
    out[at + i] = Number(value & 0xffn)
    value >>= 8n
  }
}

function getBE(bytes: Uint8Array, at: number, width: number): bigint {
  let v = 0n
  for (let i = 0; i < width; i++) v = (v << 8n) | BigInt(bytes[at + i] as number)
  return v
}

/**
 * The fractional tail shared by `DATETIME2`, `TIMESTAMP2` and `TIME2`.
 *
 * | dec  | bytes | content                        |
 * |------|-------|--------------------------------|
 * | 0    | 0     | —                              |
 * | 1, 2 | 1     | `microseconds / 10000`         |
 * | 3, 4 | 2     | `microseconds / 100`, BE       |
 * | 5, 6 | 3     | `microseconds`, BE             |
 */
function writeFraction(out: Uint8Array, at: number, microsecond: number, dec: number): void {
  if (dec >= 5) putBE(out, at, 3, BigInt(microsecond))
  else if (dec >= 3) putBE(out, at, 2, BigInt(Math.floor(microsecond / 100)))
  else if (dec >= 1) putBE(out, at, 1, BigInt(Math.floor(microsecond / 10000)))
}

function readFraction(bytes: Uint8Array, at: number, dec: number): number {
  if (dec >= 5) return Number(getBE(bytes, at, 3))
  if (dec >= 3) return Number(getBE(bytes, at, 2)) * 100
  if (dec >= 1) return Number(getBE(bytes, at, 1)) * 10000
  return 0
}

// --- DATETIME2 --------------------------------------------------------------

/** `DATETIME(dec)` occupies 5 bytes plus the fractional tail. */
export function datetimeBinSize(dec: number): number {
  return 5 + fractionalBytes(dec)
}

/**
 * `my_datetime_packed_to_binary`. Doc 24 gives this one in JavaScript already;
 * this is that, with the range checks a stored value needs.
 */
export function encodeDatetime2(v: MysqlDateTime, dec: number): Uint8Array {
  if (v.year < 0 || v.year > 9999) throw outOfRange('year', v.year)
  if (v.month < 0 || v.month > 12) throw outOfRange('month', v.month)
  if (v.day < 0 || v.day > 31) throw outOfRange('day', v.day)
  if (v.hour < 0 || v.hour > 23) throw outOfRange('hour', v.hour)
  if (v.minute < 0 || v.minute > 59) throw outOfRange('minute', v.minute)
  if (v.second < 0 || v.second > 59) throw outOfRange('second', v.second)
  if (v.microsecond < 0 || v.microsecond > 999999) throw outOfRange('microsecond', v.microsecond)

  // `(year * 13 + month) << 5 | day`, then `<< 17` over hour/minute/second.
  const ymd = BigInt((v.year * 13 + v.month) * 32 + v.day)
  const hms = BigInt((v.hour << 12) | (v.minute << 6) | v.second)
  const withOfs = ((ymd << 17n) | hms) + DATETIMEF_INT_OFS

  const out = new Uint8Array(datetimeBinSize(dec))
  putBE(out, 0, 5, withOfs)
  writeFraction(out, 5, v.microsecond, dec)
  return out
}

export function decodeDatetime2(bytes: Uint8Array, dec: number): MysqlDateTime {
  const size = datetimeBinSize(dec)
  if (bytes.length < size) throw badValue('datetime', `need ${size} bytes, got ${bytes.length}`)
  const packed = getBE(bytes, 0, 5) - DATETIMEF_INT_OFS
  const hms = Number(packed & 0x1ffffn)
  const ymd = packed >> 17n
  const day = Number(ymd & 0x1fn)
  const yearMonth = Number(ymd >> 5n)
  return {
    year: Math.floor(yearMonth / 13),
    month: yearMonth % 13,
    day,
    hour: (hms >> 12) & 0x1f,
    minute: (hms >> 6) & 0x3f,
    second: hms & 0x3f,
    microsecond: readFraction(bytes, 5, dec),
  }
}

// --- TIMESTAMP2 -------------------------------------------------------------

/** `TIMESTAMP(dec)` occupies 4 bytes plus the fractional tail. */
export function timestampBinSize(dec: number): number {
  return 4 + fractionalBytes(dec)
}

/**
 * `my_timestamp_to_binary`: a 4-byte big-endian Unix epoch second, plus the
 * same fractional tail.
 *
 * `TIMESTAMP` is stored as **UTC** and converted to the session `time_zone` on
 * read; `DATETIME` has no timezone at all. Doc 24 calls reproducing that
 * distinction mandatory — it is the most commonly observed behaviour
 * difference between engines. The conversion belongs to the executor's session
 * handling (M5), not here: this codec deals only in epoch seconds.
 */
export function encodeTimestamp2(epochSeconds: number, microsecond: number, dec: number): Uint8Array {
  if (!Number.isInteger(epochSeconds) || epochSeconds < 0 || epochSeconds > 0xffffffff) {
    throw outOfRange('timestamp epoch seconds', epochSeconds)
  }
  if (microsecond < 0 || microsecond > 999999) throw outOfRange('microsecond', microsecond)
  const out = new Uint8Array(timestampBinSize(dec))
  putBE(out, 0, 4, BigInt(epochSeconds))
  writeFraction(out, 4, microsecond, dec)
  return out
}

export function decodeTimestamp2(bytes: Uint8Array, dec: number): { epochSeconds: number; microsecond: number } {
  const size = timestampBinSize(dec)
  if (bytes.length < size) throw badValue('timestamp', `need ${size} bytes, got ${bytes.length}`)
  return { epochSeconds: Number(getBE(bytes, 0, 4)), microsecond: readFraction(bytes, 4, dec) }
}

// --- TIME2 ------------------------------------------------------------------

/** `TIME(dec)` occupies 3 bytes plus the fractional tail. */
export function timeBinSize(dec: number): number {
  return 3 + fractionalBytes(dec)
}

/**
 * 3 bytes big-endian with offset `0x800000`, packing sign, an unused bit, a
 * **10-bit** hour, then minute and second. The 10 bits are why the range is
 * `-838:59:59` to `838:59:59`.
 *
 * Doc 24: "Negative `TIME` values are stored as the two's complement of the
 * packed value before adding the offset, so `memcmp` ordering still holds."
 * The fractional part is part of the magnitude, so it is negated with the rest
 * — a negative `TIME` is not "negative hours, positive microseconds".
 */
export function encodeTime2(v: MysqlTime, dec: number): Uint8Array {
  const hours = v.days * 24 + v.hour
  if (hours < 0 || hours > 838) throw outOfRange('time hours', hours)
  if (v.minute < 0 || v.minute > 59) throw outOfRange('minute', v.minute)
  if (v.second < 0 || v.second > 59) throw outOfRange('second', v.second)
  if (v.microsecond < 0 || v.microsecond > 999999) throw outOfRange('microsecond', v.microsecond)

  const fracBytes = fractionalBytes(dec)
  const fracValue = dec >= 5 ? v.microsecond : dec >= 3 ? Math.floor(v.microsecond / 100) : dec >= 1 ? Math.floor(v.microsecond / 10000) : 0
  const fracBits = BigInt(fracBytes) * 8n

  // Pack magnitude as one integer covering the 3-byte head and the tail, so
  // the two's complement of a negative value carries across the boundary.
  const magnitude = (BigInt((hours << 12) | (v.minute << 6) | v.second) << fracBits) | BigInt(fracValue)
  const total = (TIMEF_INT_OFS << fracBits) + (v.negative ? -magnitude : magnitude)

  const out = new Uint8Array(3 + fracBytes)
  putBE(out, 0, 3 + fracBytes, total)
  return out
}

export function decodeTime2(bytes: Uint8Array, dec: number): MysqlTime {
  const fracBytes = fractionalBytes(dec)
  const size = 3 + fracBytes
  if (bytes.length < size) throw badValue('time', `need ${size} bytes, got ${bytes.length}`)
  const fracBits = BigInt(fracBytes) * 8n

  const signed = getBE(bytes, 0, size) - (TIMEF_INT_OFS << fracBits)
  const negative = signed < 0n
  const magnitude = negative ? -signed : signed

  const fracMask = (1n << fracBits) - 1n
  const rawFrac = Number(magnitude & fracMask)
  const hms = Number(magnitude >> fracBits)
  const microsecond = dec >= 5 ? rawFrac : dec >= 3 ? rawFrac * 100 : dec >= 1 ? rawFrac * 10000 : 0

  const hours = (hms >> 12) & 0x3ff
  return {
    negative,
    days: Math.floor(hours / 24),
    hour: hours % 24,
    minute: (hms >> 6) & 0x3f,
    second: hms & 0x3f,
    microsecond,
  }
}

// --- DATE and YEAR ----------------------------------------------------------

/**
 * `Field_date::get_date_internal` reads `uint3korr` — a **little-endian**
 * 3-byte value packing `year << 9 | month << 5 | day`.
 *
 * This is only half the story on disk. `DATE` maps to `DATA_INT`, so InnoDB
 * then byte-reverses it to big-endian and flips the sign bit on the way into
 * the record. Doc 24: "Both steps matter when reading a `.ibd`; only the first
 * matters when reading a binlog row image." Hence two functions, and D-34's
 * fixtures record which framing they are.
 */
export function encodeDateField(year: number, month: number, day: number): Uint8Array {
  if (year < 0 || year > 9999) throw outOfRange('year', year)
  if (month < 0 || month > 12) throw outOfRange('month', month)
  if (day < 0 || day > 31) throw outOfRange('day', day)
  const packed = (year << 9) | (month << 5) | day
  // Little-endian, as MySQL's `Field` wrote it.
  return Uint8Array.from([packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff])
}

export function decodeDateField(bytes: Uint8Array): { year: number; month: number; day: number } {
  if (bytes.length < 3) throw badValue('date', `need 3 bytes, got ${bytes.length}`)
  const packed = (bytes[0] as number) | ((bytes[1] as number) << 8) | ((bytes[2] as number) << 16)
  return { day: packed & 31, month: (packed >> 5) & 15, year: packed >> 9 }
}

/** The second step: `DATA_INT`'s byte-reverse and sign flip, for a `.ibd` record. */
export function dateFieldToStorage(field: Uint8Array): Uint8Array {
  const reversed = Uint8Array.from([field[2] as number, field[1] as number, field[0] as number])
  reversed[0] = (reversed[0] as number) ^ 0x80
  return reversed
}

export function dateStorageToField(storage: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(storage.subarray(0, 3))
  copy[0] = (copy[0] as number) ^ 0x80
  return Uint8Array.from([copy[2] as number, copy[1] as number, copy[0] as number])
}

/**
 * `Field_year` is a `Field_tiny` constructed with `unsigned = true`, so no sign
 * flip. The stored byte is `year - 1900`, with `0` reserved for the zero year.
 * Range 1901–2155.
 */
export function encodeYear(year: number): Uint8Array {
  if (year === 0) return Uint8Array.from([0])
  if (year < 1901 || year > 2155) throw outOfRange('year', year)
  return Uint8Array.from([year - 1900])
}

export function decodeYear(bytes: Uint8Array): number {
  if (bytes.length < 1) throw badValue('year', 'need 1 byte, got 0')
  const b = bytes[0] as number
  return b === 0 ? 0 : b + 1900
}

// --- legacy (pre-5.6.4) decoders -------------------------------------------
//
// Doc 24: "A reader must distinguish them by the *dictionary's* declared type,
// since the byte lengths overlap with the modern forms." These are read-only:
// nothing this engine writes is ever in a legacy format.

/** Old `DATETIME`: 8 bytes holding the decimal number `YYYYMMDDHHMMSS`. */
export function decodeLegacyDatetime(bytes: Uint8Array): MysqlDateTime {
  const n = decodeInt(bytes.subarray(0, 8), false)
  const s = n.toString().padStart(14, '0')
  return {
    year: Number(s.slice(0, 4)),
    month: Number(s.slice(4, 6)),
    day: Number(s.slice(6, 8)),
    hour: Number(s.slice(8, 10)),
    minute: Number(s.slice(10, 12)),
    second: Number(s.slice(12, 14)),
    microsecond: 0,
  }
}

/** Old `TIMESTAMP`: 4 bytes of Unix epoch seconds, little-endian. */
export function decodeLegacyTimestamp(bytes: Uint8Array): number {
  if (bytes.length < 4) throw badValue('legacy timestamp', `need 4 bytes, got ${bytes.length}`)
  return (
    (bytes[0] as number) |
    ((bytes[1] as number) << 8) |
    ((bytes[2] as number) << 16) |
    ((bytes[3] as number) << 24)
  ) >>> 0
}

/** Old `TIME`: 3 bytes holding the decimal number `HHMMSS`. */
export function decodeLegacyTime(bytes: Uint8Array): MysqlTime {
  const n = Number(decodeInt(bytes.subarray(0, 3), false))
  const negative = n < 0
  const s = Math.abs(n).toString().padStart(6, '0')
  const hours = Number(s.slice(0, s.length - 4))
  return {
    negative,
    days: Math.floor(hours / 24),
    hour: hours % 24,
    minute: Number(s.slice(-4, -2)),
    second: Number(s.slice(-2)),
    microsecond: 0,
  }
}

/** The `DATA_INT` transform legacy temporals also receive, for symmetry with `DATE`. */
export function legacyToStorage(field: Uint8Array): Uint8Array {
  return encodeInt(decodeInt(field, false), field.length, false)
}
