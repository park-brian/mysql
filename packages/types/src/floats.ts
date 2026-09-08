// M2.9 — FLOAT and DOUBLE. Doc 24, Rule 2: the exceptions.
//
// Everything else in doc 24 is big-endian and `memcmp`-ordered. These two are
// **little-endian IEEE-754** (`mach_float_read`/`mach_double_read` normalise
// to little-endian) and are compared **numerically**, not by `memcmp` — see
// `cmp_data()` in `rem0cmp.cc`, which switches on `DATA_DOUBLE`/`DATA_FLOAT`
// and compares the decoded values.
//
// "So: most things big-endian, floats little-endian. That asymmetry is real
// and it will bite you." It is also why the ordering property test has to know
// these are the exception rather than asserting `memcmp` everywhere.
import { badValue } from './errors.ts'

export function encodeFloat(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setFloat32(0, value, true)
  return out
}

export function decodeFloat(bytes: Uint8Array): number {
  if (bytes.length < 4) throw badValue('float', `need 4 bytes, got ${bytes.length}`)
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true)
}

export function encodeDouble(value: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, value, true)
  return out
}

export function decodeDouble(bytes: Uint8Array): number {
  if (bytes.length < 8) throw badValue('double', `need 8 bytes, got ${bytes.length}`)
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true)
}

/**
 * Numeric comparison, which is what InnoDB does for these two types.
 *
 * MySQL rejects NaN on insert, so it should never reach storage — but a
 * comparator that returns something incoherent for it would make a sort
 * non-deterministic, so NaN is ordered last and equal to itself. `-0` and `0`
 * compare equal, as they do in SQL.
 */
export function compareFloat(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1
  if (Number.isNaN(b)) return -1
  return a < b ? -1 : a > b ? 1 : 0
}
