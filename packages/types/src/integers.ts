// M2.8 — the integer transform. Doc 24, Rule 1.
//
// From `row_mysql_store_col_in_innobase_format`:
//
//   Store integer data in Innobase in a big-endian format, sign bit negated
//   if the data is a signed integer. In MySQL, integers are stored in a
//   little-endian format.
//
// Both halves exist for the same reason: so that `memcmp` on two encoded
// values yields the correct numeric ordering. Big-endian puts the most
// significant byte first; flipping the sign bit maps the signed range
// `[-2^(n-1), 2^(n-1))` onto unsigned `[0, 2^n)` monotonically. That is what
// makes B+tree key comparison a `memcmp` rather than a type dispatch — the
// single most important property in doc 24, and the one the ordering property
// test exists to defend.
import { outOfRange } from './errors.ts'

/** Declared byte width by MySQL integer type (doc 24 §Integers). */
export const INT_BYTES = {
  TINYINT: 1,
  SMALLINT: 2,
  MEDIUMINT: 3,
  INT: 4,
  BIGINT: 8,
} as const

/** Inclusive bounds for a signed integer of `bytes` bytes. */
export function signedRange(bytes: number): { min: bigint; max: bigint } {
  const bits = BigInt(bytes) * 8n
  const half = 1n << (bits - 1n)
  return { min: -half, max: half - 1n }
}

/** Inclusive bounds for an unsigned integer of `bytes` bytes. */
export function unsignedRange(bytes: number): { min: bigint; max: bigint } {
  return { min: 0n, max: (1n << (BigInt(bytes) * 8n)) - 1n }
}

/**
 * Value → storage bytes: big-endian, sign bit flipped unless UNSIGNED.
 *
 * Doc 24's four worked lines, which the golden test reproduces:
 *
 *   INT signed   -1 -> 7F FF FF FF
 *   INT signed    0 -> 80 00 00 00
 *   INT signed    1 -> 80 00 00 01
 *   INT UNSIGNED  1 -> 00 00 00 01
 */
export function encodeInt(value: bigint, bytes: number, unsigned: boolean): Uint8Array {
  const { min, max } = unsigned ? unsignedRange(bytes) : signedRange(bytes)
  if (value < min || value > max) throw outOfRange(`${unsigned ? 'unsigned ' : ''}int(${bytes})`, value)

  // Two's complement into the declared width, most significant byte first.
  const mask = (1n << (BigInt(bytes) * 8n)) - 1n
  let v = value & mask
  const out = new Uint8Array(bytes)
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  // `*buf ^= 128` — the sign flip, and only for signed columns.
  if (!unsigned) out[0] = (out[0] as number) ^ 0x80
  return out
}

/** Storage bytes → value. The exact inverse of `encodeInt`. */
export function decodeInt(bytes: Uint8Array, unsigned: boolean): bigint {
  const width = bytes.length
  let v = 0n
  for (let i = 0; i < width; i++) {
    const byte = i === 0 && !unsigned ? (bytes[i] as number) ^ 0x80 : (bytes[i] as number)
    v = (v << 8n) | BigInt(byte)
  }
  if (unsigned) return v
  // Sign-extend out of the fixed width.
  const half = 1n << (BigInt(width) * 8n - 1n)
  return v >= half ? v - (half << 1n) : v
}

/**
 * `ENUM` and `SET` are forced `DATA_UNSIGNED` in InnoDB even though MySQL's
 * own `UNSIGNED_FLAG` is clear on them, so they take the big-endian half of
 * the transform and **not** the sign flip (doc 24 §ENUM and SET). Named
 * separately because "unsigned even though the flag says otherwise" is exactly
 * the kind of thing a caller gets wrong.
 */
export function encodeUnsignedInt(value: bigint, bytes: number): Uint8Array {
  return encodeInt(value, bytes, true)
}

export function decodeUnsignedInt(bytes: Uint8Array): bigint {
  return decodeInt(bytes, true)
}
