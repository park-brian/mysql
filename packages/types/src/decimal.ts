// M2.10 — `decimal2bin`. Doc 24 §DECIMAL / NUMERIC, from `mysys/decimal.cc`.
//
// The format is designed so that two values of the same `(precision, scale)`
// compare correctly with `memcmp`, which is why it is worth reproducing
// exactly rather than storing a string: it is used identically in `.ibd` files
// and in binlog row images.
//
// The algorithm, in doc 24's words:
//
//   1. Digits are grouped base 10^9 (`DIG_PER_DEC1 = 9`).
//   2. Each full group of 9 digits is stored as a 4-byte big-endian integer.
//   3. The leading partial group uses `dig2bytes[intg % 9]` bytes.
//   4. The same for the fractional part.
//   5. If the value is negative, every byte is inverted.
//   6. Finally the most significant bit of the first byte is flipped, so that
//      unsigned `memcmp` orders negatives before positives.
import { badValue, outOfRange } from './errors.ts'

/** `dig2bytes[]` from `decimal.cc`: bytes needed for 0..9 leading digits. */
const DIG2BYTES = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4] as const

const DIG_PER_DEC1 = 9

/** `DECIMAL(65,30)` is the maximum MySQL allows. */
export const MAX_DECIMAL_PRECISION = 65
export const MAX_DECIMAL_SCALE = 30

/** Bytes a `DECIMAL(precision, scale)` occupies, per doc 24's `decimalBinSize`. */
export function decimalBinSize(precision: number, scale: number): number {
  const intg = precision - scale
  return (
    Math.floor(intg / DIG_PER_DEC1) * 4 +
    (DIG2BYTES[intg % DIG_PER_DEC1] as number) +
    Math.floor(scale / DIG_PER_DEC1) * 4 +
    (DIG2BYTES[scale % DIG_PER_DEC1] as number)
  )
}

function checkShape(precision: number, scale: number): void {
  if (precision < 1 || precision > MAX_DECIMAL_PRECISION) throw outOfRange('decimal precision', precision)
  if (scale < 0 || scale > MAX_DECIMAL_SCALE || scale > precision) throw outOfRange('decimal scale', scale)
}

/** Split `'-1234567890.1234'` into sign and zero-padded digit strings. */
function parse(text: string, precision: number, scale: number): { negative: boolean; intg: string; frac: string } {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim())
  if (m === null) throw badValue('decimal', `${JSON.stringify(text)} is not a decimal literal`)
  const negative = m[1] === '-'
  let intg = (m[2] ?? '').replace(/^0+(?=\d)/, '')
  let frac = m[3] ?? ''
  if (intg === '') intg = '0'
  // MySQL rounds a too-long fraction and rejects a too-large integer part.
  if (frac.length > scale) frac = frac.slice(0, scale)
  frac = frac.padEnd(scale, '0')
  const intgDigits = precision - scale
  if (intg.replace(/^0+(?=\d)/, '').length > intgDigits && intg !== '0') {
    throw outOfRange(`decimal(${precision},${scale})`, text)
  }
  if (intgDigits === 0 && intg !== '0') throw outOfRange(`decimal(${precision},${scale})`, text)
  // MySQL has no negative zero in DECIMAL: `-0.00` stores as `0.00`. Without
  // this, two values that compare equal would have different bytes, and a
  // unique index could hold both.
  const allZero = !/[1-9]/.test(intg + frac)
  return { negative: negative && !allZero, intg: intg.padStart(intgDigits, '0'), frac }
}

/**
 * Write big-endian into `out[at..at+width)`. Group values are always below
 * 10^9, so a plain number is exact.
 */
function putBE(out: Uint8Array, at: number, width: number, value: number): void {
  for (let i = width - 1; i >= 0; i--) {
    out[at + i] = value & 0xff
    value = Math.floor(value / 256)
  }
}

function getBE(bytes: Uint8Array, at: number, width: number): number {
  let v = 0
  for (let i = 0; i < width; i++) v = v * 256 + (bytes[at + i] as number)
  return v
}

/**
 * `decimal2bin`. The value arrives as a string because D-15 says DECIMAL is a
 * string at the driver boundary and because a double cannot represent
 * `DECIMAL(30,10)` — round-tripping through a `number` would defeat the whole
 * point of the type.
 */
export function encodeDecimal(text: string, precision: number, scale: number): Uint8Array {
  checkShape(precision, scale)
  const { negative, intg, frac } = parse(text, precision, scale)
  const out = new Uint8Array(decimalBinSize(precision, scale))

  let at = 0
  // Integer part: a leading partial group, then full 9-digit groups.
  const intgLead = intg.length % DIG_PER_DEC1
  if (intgLead > 0) {
    const width = DIG2BYTES[intgLead] as number
    putBE(out, at, width, Number(intg.slice(0, intgLead)))
    at += width
  }
  for (let i = intgLead; i < intg.length; i += DIG_PER_DEC1) {
    putBE(out, at, 4, Number(intg.slice(i, i + DIG_PER_DEC1)))
    at += 4
  }
  // Fractional part: full groups first, then a trailing partial group.
  const fracFull = Math.floor(scale / DIG_PER_DEC1) * DIG_PER_DEC1
  for (let i = 0; i < fracFull; i += DIG_PER_DEC1) {
    putBE(out, at, 4, Number(frac.slice(i, i + DIG_PER_DEC1)))
    at += 4
  }
  const fracTail = scale - fracFull
  if (fracTail > 0) {
    const width = DIG2BYTES[fracTail] as number
    // A partial trailing group is left-aligned: `.1234` at scale 4 is 1234,
    // not 0.1234 scaled. The digits are already exactly `fracTail` long.
    putBE(out, at, width, Number(frac.slice(fracFull)))
    at += width
  }

  // Step 5: invert every byte for a negative value. Step 6: flip the top bit,
  // so unsigned `memcmp` puts negatives first.
  if (negative) for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) ^ 0xff
  out[0] = (out[0] as number) ^ 0x80
  return out
}

/** `bin2decimal`. Returns the canonical string rendering at the declared scale. */
export function decodeDecimal(bytes: Uint8Array, precision: number, scale: number): string {
  checkShape(precision, scale)
  const size = decimalBinSize(precision, scale)
  if (bytes.length < size) throw badValue('decimal', `need ${size} bytes, got ${bytes.length}`)

  const buf = bytes.slice(0, size)
  // The sign lives in the top bit *as stored*, so it must be read before step
  // 6 is undone. Encoding sets that bit for a positive value and clears it for
  // a negative one, which is precisely what makes unsigned `memcmp` order
  // negatives first.
  const negative = ((buf[0] as number) & 0x80) === 0
  buf[0] = (buf[0] as number) ^ 0x80
  if (negative) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] as number) ^ 0xff

  let at = 0
  let intg = ''
  const intgDigits = precision - scale
  const intgLead = intgDigits % DIG_PER_DEC1
  if (intgLead > 0) {
    const width = DIG2BYTES[intgLead] as number
    intg += String(getBE(buf, at, width)).padStart(intgLead, '0')
    at += width
  }
  for (let i = intgLead; i < intgDigits; i += DIG_PER_DEC1) {
    intg += String(getBE(buf, at, 4)).padStart(DIG_PER_DEC1, '0')
    at += 4
  }

  let frac = ''
  const fracFull = Math.floor(scale / DIG_PER_DEC1) * DIG_PER_DEC1
  for (let i = 0; i < fracFull; i += DIG_PER_DEC1) {
    frac += String(getBE(buf, at, 4)).padStart(DIG_PER_DEC1, '0')
    at += 4
  }
  const fracTail = scale - fracFull
  if (fracTail > 0) {
    const width = DIG2BYTES[fracTail] as number
    frac += String(getBE(buf, at, width)).padStart(fracTail, '0')
  }

  const whole = intg === '' ? '0' : intg.replace(/^0+(?=\d)/, '')
  const sign = negative ? '-' : ''
  // Trailing zeros are kept to the declared scale — D-15's reason for making
  // DECIMAL a string in the first place.
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`
}
