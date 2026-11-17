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
  return partBytes(precision - scale) + partBytes(scale)
}

function partBytes(digits: number): number {
  return Math.floor(digits / DIG_PER_DEC1) * 4 + (DIG2BYTES[digits % DIG_PER_DEC1] as number)
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
  if (intg !== '0' && intg.length > intgDigits) throw outOfRange(`decimal(${precision},${scale})`, text)
  // MySQL has no negative zero in DECIMAL: `-0.00` stores as `0.00`. Without
  // this, two values that compare equal would have different bytes, and a
  // unique index could hold both.
  const allZero = !/[1-9]/.test(intg + frac)
  // A scale equal to the precision leaves no integer group in the record.
  return { negative: negative && !allZero, intg: intgDigits === 0 ? '' : intg.padStart(intgDigits, '0'), frac }
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

/** Integer digits have a leading partial group. Fraction digits have a trailing one. */
function eachGroup(digits: number, at: number, leading: boolean, visit: (offset: number, width: number, first: number, end: number) => void): number {
  const lead = leading ? digits % DIG_PER_DEC1 : 0
  for (let first = 0; first < digits;) {
    const count = first === 0 && lead > 0 ? lead : Math.min(DIG_PER_DEC1, digits - first)
    const width = DIG2BYTES[count] as number
    const end = first + count
    visit(at, width, first, end)
    at += width
    first = end
  }
  return at
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

  const write = (digits: string, at: number, length: number, leading: boolean): number =>
    eachGroup(length, at, leading, (offset, width, first, end) => putBE(out, offset, width, Number(digits.slice(first, end))))
  const fractionAt = write(intg, 0, intg.length, true)
  write(frac, fractionAt, scale, false)

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

  let intg = ''
  const at = eachGroup(precision - scale, 0, true, (offset, width, first, end) => {
    intg += String(getBE(buf, offset, width)).padStart(end - first, '0')
  })
  let frac = ''
  eachGroup(scale, at, false, (offset, width, first, end) => {
    frac += String(getBE(buf, offset, width)).padStart(end - first, '0')
  })

  const whole = intg === '' ? '0' : intg.replace(/^0+(?=\d)/, '')
  const sign = negative ? '-' : ''
  // Trailing zeros are kept to the declared scale — D-15's reason for making
  // DECIMAL a string in the first place.
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`
}
