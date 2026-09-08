// M2.12 — ENUM, SET, BIT, and CHAR/BINARY padding. Doc 24 §§ENUM and SET,
// BIT(n), Strings and binary.
import { badValue, outOfRange } from './errors.ts'
import { decodeUnsignedInt, encodeUnsignedInt } from './integers.ts'

// --- ENUM -------------------------------------------------------------------

/** 1 byte up to 255 members, otherwise 2 (doc 24). */
export function enumBinSize(memberCount: number): 1 | 2 {
  if (memberCount < 0 || memberCount > 65535) throw outOfRange('enum member count', memberCount)
  return memberCount <= 255 ? 1 : 2
}

/**
 * The stored value is the **1-based** index into the declared member list.
 * `0` means the invalid/empty string — what MySQL stores when a bad `ENUM`
 * value is inserted in non-strict mode, and the reason the indexes start at 1.
 *
 * Forced `DATA_UNSIGNED` in InnoDB even though MySQL's own `UNSIGNED_FLAG` is
 * clear on the column, so big-endian but **no** sign flip.
 */
export function encodeEnum(index: number, memberCount: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > memberCount) throw outOfRange('enum index', index)
  return encodeUnsignedInt(BigInt(index), enumBinSize(memberCount))
}

export function decodeEnum(bytes: Uint8Array): number {
  return Number(decodeUnsignedInt(bytes))
}

/** Resolve a stored index against the member list. `0` is the invalid value. */
export function enumMember(index: number, members: readonly string[]): string | null {
  if (index === 0) return null
  const value = members[index - 1]
  if (value === undefined) throw outOfRange('enum index', index)
  return value
}

/** The 1-based index of a member, or 0 for a value the ENUM does not declare. */
export function enumIndexOf(value: string, members: readonly string[]): number {
  return members.indexOf(value) + 1
}

// --- SET --------------------------------------------------------------------

/** 1, 2, 3, 4 or 8 bytes — the smallest that holds up to 64 members. */
export function setBinSize(memberCount: number): number {
  if (memberCount < 0 || memberCount > 64) throw outOfRange('set member count', memberCount)
  if (memberCount <= 8) return 1
  if (memberCount <= 16) return 2
  if (memberCount <= 24) return 3
  if (memberCount <= 32) return 4
  return 8
}

/** A bitmask, one bit per declared member, big-endian and unsigned like ENUM. */
export function encodeSet(mask: bigint, memberCount: number): Uint8Array {
  const width = setBinSize(memberCount)
  const limit = memberCount === 64 ? (1n << 64n) - 1n : (1n << BigInt(memberCount)) - 1n
  if (mask < 0n || mask > limit) throw outOfRange('set mask', mask)
  return encodeUnsignedInt(mask, width)
}

export function decodeSet(bytes: Uint8Array): bigint {
  return decodeUnsignedInt(bytes)
}

/**
 * Members named by a mask, in declared order.
 *
 * Doc 24: "Both therefore depend entirely on the dictionary's stored member
 * list; the bytes alone are meaningless. Preserving member *order* through any
 * schema change is a correctness requirement."
 */
export function setMembers(mask: bigint, members: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < members.length; i++) {
    if ((mask >> BigInt(i)) & 1n) out.push(members[i] as string)
  }
  return out
}

export function setMaskOf(values: readonly string[], members: readonly string[]): bigint {
  let mask = 0n
  for (const v of values) {
    const i = members.indexOf(v)
    if (i === -1) throw badValue('set', `${JSON.stringify(v)} is not a declared member`)
    mask |= 1n << BigInt(i)
  }
  return mask
}

// --- BIT --------------------------------------------------------------------

/** `ceil(n / 8)` bytes (doc 24 §BIT(n)). */
export function bitBinSize(bits: number): number {
  if (bits < 1 || bits > 64) throw outOfRange('bit width', bits)
  return Math.ceil(bits / 8)
}

/**
 * Big-endian, value right-aligned. `DATA_FIXBINARY` in InnoDB via
 * `Field_bit_as_char`, so the bytes are stored as-is.
 *
 * MyISAM has a genuinely strange variant that packs the leftover bits into the
 * record's null-byte area; InnoDB does not, and neither do we (M8.10 would
 * have to deal with it).
 */
export function encodeBit(value: bigint, bits: number): Uint8Array {
  const width = bitBinSize(bits)
  const limit = bits === 64 ? (1n << 64n) - 1n : (1n << BigInt(bits)) - 1n
  if (value < 0n || value > limit) throw outOfRange(`bit(${bits})`, value)
  return encodeUnsignedInt(value, width)
}

export function decodeBit(bytes: Uint8Array): bigint {
  return decodeUnsignedInt(bytes)
}

// --- CHAR and BINARY padding -----------------------------------------------

const SPACE = 0x20

/**
 * `CHAR(n)` in a single-byte charset is fixed `n` bytes, **space-padded**.
 *
 * With `mbmaxlen > 1` InnoDB stores it variable-length with trailing spaces
 * removed, so on disk it behaves like a `VARCHAR` while still comparing like a
 * `CHAR` (PAD SPACE). Doc 24: "Both halves of that must be reproduced or
 * `CHAR` comparisons go wrong." `padChar` is the fixed half; the variable half
 * is `trimTrailingSpaces`, and which one applies is the record encoder's
 * decision (M4.5), made from the charset's `mbmaxlen`.
 */
export function padChar(bytes: Uint8Array, byteLength: number): Uint8Array {
  if (bytes.length > byteLength) throw outOfRange('char', `${bytes.length} bytes exceeds ${byteLength}`)
  const out = new Uint8Array(byteLength).fill(SPACE)
  out.set(bytes)
  return out
}

/** `BINARY(n)` is fixed `n` bytes, **zero-padded** — not space-padded. */
export function padBinary(bytes: Uint8Array, byteLength: number): Uint8Array {
  if (bytes.length > byteLength) throw outOfRange('binary', `${bytes.length} bytes exceeds ${byteLength}`)
  const out = new Uint8Array(byteLength)
  out.set(bytes)
  return out
}

/** Trailing `0x20` removed — what a multi-byte `CHAR` stores. */
export function trimTrailingSpaces(bytes: Uint8Array): Uint8Array {
  let n = bytes.length
  while (n > 0 && bytes[n - 1] === SPACE) n--
  return bytes.subarray(0, n)
}

/**
 * Trailing `0x00` removed.
 *
 * `BINARY(n)` pads with NUL, and MySQL does **not** strip it on read — a
 * `BINARY(10)` holding `'ab'` returns ten bytes. Provided for the importer,
 * which sometimes needs the unpadded value, and named so that nobody reaches
 * for it thinking it is symmetric with `trimTrailingSpaces`.
 */
export function trimTrailingNuls(bytes: Uint8Array): Uint8Array {
  let n = bytes.length
  while (n > 0 && bytes[n - 1] === 0) n--
  return bytes.subarray(0, n)
}
