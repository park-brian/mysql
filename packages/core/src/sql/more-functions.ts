// M5.10 — the rest of the string, numeric, hashing and network functions:
// CHAR, FIELD, ELT, MAKE_SET, EXPORT_SET, FIND_IN_SET, INSERT,
// SUBSTRING_INDEX, QUOTE, SOUNDEX, FORMAT, BIT_LENGTH, CONV, TO_BASE64,
// FROM_BASE64, ORD, MD5, SHA1, SHA, SHA2, CRC32; PI, POW, POWER, SQRT, EXP,
// LN, LOG, LOG2, LOG10, SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, COT,
// DEGREES, RADIANS, BIT_COUNT; ISNULL, INTERVAL, INET_ATON, INET_NTOA,
// INET6_ATON, INET6_NTOA, IS_IPV4, IS_IPV6, IS_IPV4_COMPAT, IS_IPV4_MAPPED,
// IS_UUID, UUID_TO_BIN and BIN_TO_UUID.
//
// Written against `tools/capture-more-functions.mjs`'s corpus, captured from
// 8.4.11 first. The string functions keep `functions.ts`' rules (a result in
// its first argument's collation, or the aggregate of the strings it chooses
// among); the numeric ones read text as a double with 1292; the digests are
// `@myjs/types`' (`digest.ts`).
import { CHARSET_BINARY, expectTyped } from '@myjs/bytes'
import { collationInfoByName, decodeCollation, defaultCollationOf, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { sqlError } from '@myjs/protocol'
import {
  COERCIBILITY,
  bool,
  bytesValue,
  compareValues,
  crc32,
  decimalValue,
  doubleValue,
  intValue,
  md5,
  sha1,
  sha256,
  sha512,
  stringValue,
  toDecimal,
  toDouble,
  toText,
  valInt,
  type Value,
} from '@myjs/types'
import { aggregateCollations, aggregateTypes, asNumber, raise, warnedText, type Compiled, type CompileContext, type Env } from './compile.ts'
import { aggregateString, all, firstCollation, result, strOf, textType, widthOf } from './functions.ts'
import { charWidth, doubleType, intType, stringType, type ResultType } from './meta.ts'

type V = Exclude<Value, null>
type Row = Parameters<Compiled['eval']>[0]

export const MORE_FUNCTIONS: ReadonlySet<string> = new Set([
  'CHAR', 'FIELD', 'ELT', 'MAKE_SET', 'EXPORT_SET', 'FIND_IN_SET', 'INSERT', 'SUBSTRING_INDEX', 'QUOTE', 'SOUNDEX', 'FORMAT', 'BIT_LENGTH', 'CONV',
  'TO_BASE64', 'FROM_BASE64', 'ORD', 'MD5', 'SHA1', 'SHA', 'SHA2', 'CRC32', 'PI', 'POW', 'POWER', 'SQRT', 'EXP', 'LN', 'LOG', 'LOG2', 'LOG10', 'SIN',
  'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2', 'COT', 'DEGREES', 'RADIANS', 'BIT_COUNT', 'ISNULL', 'INTERVAL', 'INET_ATON', 'INET_NTOA', 'INET6_ATON',
  'INET6_NTOA', 'IS_IPV4', 'IS_IPV6', 'IS_IPV4_COMPAT', 'IS_IPV4_MAPPED', 'IS_UUID', 'UUID_TO_BIN', 'BIN_TO_UUID',
])

/** A value's bytes, as a digest or BIT_LENGTH counts them: text in its charset, a number as its text. */
const bytesOf = (v: V): Uint8Array => (v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v)))

/** An integer argument read with its 1292, as `val_int` reads it. */
function intReader(c: Compiled): (r: Row, env: Env) => bigint | null {
  const n = asNumber(c, 'INTEGER')
  return (r, env) => {
    const v = n.eval(r, env)
    if (v === null) return null
    // Empty text is no integer either, here (8.4.11: CHAR('') warns).
    if ((v.kind === 'string' && v.ordinal === undefined && v.v.trim() === '') || (v.kind === 'bytes' && v.hex !== true && v.v.every((b) => b === 0x20))) raise(env, 1292, `Truncated incorrect INTEGER value: '${warnedText(v)}'`)
    // A double is `rint`-ed, halves to even (8.4.11: CHAR(2.5e0) is 0x02).
    if (v.kind === 'double') return Number.isFinite(v.v) ? clamp64(BigInt(rint(v.v))) : v.v > 0 ? (1n << 63n) - 1n : -(1n << 63n)
    return valInt(v)
  }
}

/** C's `rint`: halves to the even neighbour. */
function rint(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

const clamp64 = (n: bigint): bigint => (n > (1n << 63n) - 1n ? (1n << 63n) - 1n : n < -(1n << 63n) ? -(1n << 63n) : n)

/** A double argument read with its 1292. */
function doubleReader(c: Compiled): (r: Row, env: Env) => number | null {
  const n = asNumber(c, 'DOUBLE')
  return (r, env) => {
    const v = n.eval(r, env)
    return v === null ? null : toDouble(v)
  }
}

/** An argument's width in characters, which a binary result counts too (8.4.11: ELT and MAKE_SET over bytes). */
const charsOf = (t: ResultType): number => widthOf(t, false)

const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('')

/** ER_DATA_OUT_OF_RANGE for a double that is infinite or not a number, naming the expression as written. */
const doubleOutOfRange = (expr: string) => sqlError('ER_DATA_OUT_OF_RANGE', `DOUBLE value is out of range in '${expr}'`)

const SOUNDEX_CODES = '01230120022455012623010202'

/** MySQL's SOUNDEX: letters past the fourth are kept, a code repeated or a vowel's dropped, short ones padded with 0. */
function soundex(text: string): string {
  let out = ''
  let last = ''
  for (const ch of text) {
    // Only the 26 letters count; any other character, accented ones included, is skipped (8.4.11).
    if (!/[A-Za-z]/.test(ch)) continue
    const up = ch.toUpperCase()
    const code = SOUNDEX_CODES[up.charCodeAt(0) - 65] as string
    if (out === '') {
      out = up
      last = code
      continue
    }
    if (code !== '0' && code !== last) {
      out += code
      last = code
    }
  }
  if (out === '') return ''
  return out.length < 4 ? out.padEnd(4, '0') : out
}

/**
 * FORMAT's separators, the thousands one and the decimal point, of each of
 * MySQL's locales: captured from 8.4.11 with `FORMAT(1234567890.5, 1, name)`.
 * bg_BG's thousands separator is a NUL; en_IN, ta_IN and te_IN group by twos
 * past the first three digits.
 */
const LOCALE_GROUPS: readonly (readonly [string, string, string])[] = [
  [',', '.', 'ar_AE ar_BH ar_DZ ar_EG ar_IN ar_IQ ar_JO ar_KW ar_LB ar_LY ar_MA ar_OM ar_QA ar_SD ar_SY ar_TN ar_YE en_AU en_CA en_GB en_NZ en_PH en_US en_ZA en_ZW es_DO es_GT es_HN es_MX es_NI es_PA es_PE es_PR es_SV es_US gu_IN he_IL hi_IN ja_JP ko_KR ms_MY th_TH ur_PK zh_CN zh_HK zh_TW en_IN ta_IN te_IN'],
  ['.', ',', 'be_BY da_DK de_BE de_DE de_LU es_AR es_BO es_CL es_CO es_EC es_ES es_PY es_UY es_VE fo_FO hu_HU id_ID is_IS lt_LT mn_MN nb_NO no_NO ro_RO ru_UA sq_AL tr_TR uk_UA vi_VN'],
  ['', ',', 'ca_ES de_AT el_GR eu_ES fr_BE fr_CA fr_CH fr_FR fr_LU gl_ES hr_HR it_IT nl_BE nl_NL pl_PL pt_BR pt_PT sl_SI'],
  [' ', ',', 'cs_CZ es_CR et_EE fi_FI lv_LV mk_MK ru_RU sk_SK sv_FI sv_SE'],
  ['', '.', 'ar_SA sr_RS sr_YU'],
  ["'", '.', 'de_CH'],
  ["'", ',', 'it_CH rm_CH'],
  ['\0', ',', 'bg_BG'],
]
const LOCALES: ReadonlyMap<string, readonly [string, string, boolean]> = new Map(
  LOCALE_GROUPS.flatMap(([sep, point, names]) => names.split(' ').map((n) => [n.toLowerCase(), [sep, point, /^(en|ta|te)_IN$/.test(n)] as const] as const)),
)
const EN_US = LOCALES.get('en_us') as readonly [string, string, boolean]

/** `my_double_round`: `x` rounded to `d` places as a double, halves to even, left alone where the scaling overflows. */
function doubleRound(x: number, d: number): number {
  const scale = 10 ** d
  const scaled = x * scale
  if (!Number.isFinite(scale) || !Number.isFinite(scaled)) return x
  return rint(scaled) / scale
}

/** A double's shortest digits written out with exactly `d` places, its sign kept even at zero. */
function fixedOf(x: number, d: number): string {
  const negative = x < 0 || Object.is(x, -0)
  const [mantissa, exp] = Math.abs(x).toExponential().split('e') as [string, string]
  const digits = mantissa.replace('.', '')
  const point = Number(exp) + 1
  let whole: string
  let frac: string
  if (point <= 0) {
    whole = '0'
    frac = '0'.repeat(-point) + digits
  } else if (point >= digits.length) {
    whole = digits + '0'.repeat(point - digits.length)
    frac = ''
  } else {
    whole = digits.slice(0, point)
    frac = digits.slice(point)
  }
  frac = frac.slice(0, d).padEnd(d, '0')
  return `${negative ? '-' : ''}${whole}${d > 0 ? `.${frac}` : ''}`
}

/** FORMAT: `n` rounded to `d` places, grouped as `locale` groups: a double halves to even and keeps a negative zero's sign, an exact number rounds halves away. */
function format(n: V, d: number, locale: readonly [string, string, boolean]): string {
  let text: string
  if (n.kind === 'double' || n.kind === 'string' || n.kind === 'bytes') text = fixedOf(doubleRound(toDouble(n), d), d)
  else {
    const dec = toDecimal(n)
    const scale = BigInt(dec.scale)
    const target = BigInt(d)
    let v = dec.v
    if (target < scale) {
      const unit = 10n ** (scale - target)
      v = (v < 0n ? v - unit / 2n : v + unit / 2n) / unit
    } else v *= 10n ** (target - scale)
    const negative = v < 0n
    const digits = (negative ? -v : v).toString().padStart(d + 1, '0')
    text = `${negative ? '-' : ''}${digits.slice(0, digits.length - d)}${d > 0 ? `.${digits.slice(digits.length - d)}` : ''}`
  }
  const negative = text.startsWith('-')
  const [whole, frac] = (negative ? text.slice(1) : text).split('.') as [string, string | undefined]
  const [sep, point, indian] = locale
  let grouped = ''
  for (let i = 0; i < whole.length; i++) {
    const left = whole.length - i
    const boundary = indian ? left === 3 || (left > 3 && (left - 3) % 2 === 0) : left % 3 === 0
    if (i > 0 && boundary) grouped += sep
    grouped += whole[i]
  }
  return `${negative ? '-' : ''}${grouped}${frac === undefined ? '' : `${point}${frac}`}`
}

/** `my_strntoull` / `my_strntoll` over a string in `base`: leading space, a sign, digits until one is not. */
function parseInBase(text: string, base: number, signed: boolean, onNone?: () => void): bigint {
  let i = 0
  while (i < text.length && /\s/.test(text[i] as string)) i++
  let negative = false
  if (text[i] === '-' || text[i] === '+') negative = text[i++] === '-'
  let n = 0n
  let overflow = false
  const b = BigInt(base)
  const limit = signed ? (negative ? 1n << 63n : (1n << 63n) - 1n) : (1n << 64n) - 1n
  const start = i
  for (; i < text.length; i++) {
    const d = parseInt(text[i] as string, 36)
    if (Number.isNaN(d) || d >= base) break
    n = n * b + BigInt(d)
    if (n > limit) overflow = true
  }
  if (i === start) onNone?.()
  if (signed) {
    if (overflow) return negative ? -(1n << 63n) : (1n << 63n) - 1n
    return negative ? -n : n
  }
  if (overflow) return (1n << 64n) - 1n
  return negative ? BigInt.asUintN(64, -n) : n
}

/** `longlong2str`: a negative radix writes the number signed, a positive one as unsigned. */
function toBase(n: bigint, radix: number): string {
  const signed = radix < 0
  const r = Math.abs(radix)
  const v = signed ? BigInt.asIntN(64, n) : BigInt.asUintN(64, n)
  return v.toString(r).toUpperCase()
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** TO_BASE64: a line break after every 76 characters. */
function toBase64(b: Uint8Array): string {
  let out = ''
  let line = 0
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    const chunk = (BASE64[(n >> 18) & 63] as string) + (BASE64[(n >> 12) & 63] as string) + (i + 1 < b.length ? (BASE64[(n >> 6) & 63] as string) : '=') + (i + 2 < b.length ? (BASE64[n & 63] as string) : '=')
    if (line === 76) {
      out += '\n'
      line = 0
    }
    out += chunk
    line += 4
  }
  return out
}

/** FROM_BASE64: white space skipped, padding where it may be; undefined for anything else. */
function fromBase64(text: string): Uint8Array | undefined {
  const out: number[] = []
  let acc = 0
  let bits = 0
  let pad = 0
  let count = 0
  for (const ch of text) {
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue
    if (ch !== '=') count++
    if (ch === '=') {
      pad++
      continue
    }
    if (pad > 0) return undefined
    const v = BASE64.indexOf(ch)
    if (v < 0) return undefined
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 255)
    }
  }
  // Whole groups of four, padding included, or nothing (8.4.11: '123' and 'Robert' are NULL).
  if ((count + pad) % 4 !== 0 || pad > 2) return undefined
  return Uint8Array.from(out)
}

/** A dotted IPv4 address of exactly four parts, as INET6_ATON and IS_IPV4 read one. */
function ipv4(text: string): Uint8Array | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  const out = new Uint8Array(4)
  for (let i = 0; i < 4; i++) {
    const p = parts[i] as string
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return undefined
    out[i] = Number(p)
  }
  return out
}

/** An IPv6 address: groups of hex, one `::`, an IPv4 tail. */
function ipv6(text: string): Uint8Array | undefined {
  if (text.length === 0 || text.length > 39 + 7) return undefined
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const words = (part: string): number[] | undefined => {
    if (part === '') return []
    const out: number[] = []
    const groups = part.split(':')
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as string
      if (i === groups.length - 1 && g.includes('.')) {
        const v4 = ipv4(g)
        if (v4 === undefined) return undefined
        out.push(((v4[0] as number) << 8) | (v4[1] as number), ((v4[2] as number) << 8) | (v4[3] as number))
        continue
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return undefined
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = words(halves[0] as string)
  const tail = halves.length === 2 ? words(halves[1] as string) : []
  if (head === undefined || tail === undefined) return undefined
  const fill = 8 - head.length - tail.length
  if (halves.length === 1 ? fill !== 0 : fill < 1) return undefined
  const all8 = [...head, ...new Array<number>(halves.length === 2 ? fill : 0).fill(0), ...tail]
  const out = new Uint8Array(16)
  all8.forEach((w, i) => {
    out[i * 2] = w >> 8
    out[i * 2 + 1] = w & 255
  })
  return out
}

/** INET6_NTOA's text of 16 bytes: the longest run of zero words as `::`, IPv4-compatible and -mapped tails dotted. */
function ipv6Text(b: Uint8Array): string {
  const w = Array.from({ length: 8 }, (_, i) => ((b[i * 2] as number) << 8) | (b[i * 2 + 1] as number))
  const dotted = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`
  if (w.slice(0, 6).every((x) => x === 0) && (w[6] !== 0 || (w[7] as number) > 1)) return `::${dotted}`
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return `::ffff:${dotted}`
  let best = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (w[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && w[j] === 0) j++
    if (j - i > bestLen && j - i >= 2) {
      best = i
      bestLen = j - i
    }
    i = j
  }
  const hex = w.map((x) => x.toString(16))
  if (best < 0) return hex.join(':')
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`
}

/** A UUID's 16 bytes from its 32-, 36- or 38-character text, or undefined. */
function uuidBytes(text: string): Uint8Array | undefined {
  let hex: string
  if (/^[0-9a-fA-F]{32}$/.test(text)) hex = text
  else if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text)) hex = text.replace(/-/g, '')
  else if (/^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/.test(text)) hex = text.slice(1, -1).replace(/-/g, '')
  else return undefined
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

/** UUID_TO_BIN's and BIN_TO_UUID's swap: the time-low and time-high fields exchanged. */
const swapped = (b: Uint8Array): Uint8Array => Uint8Array.from([...b.slice(6, 8), ...b.slice(4, 6), ...b.slice(0, 4), ...b.slice(8)])
const unswapped = (b: Uint8Array): Uint8Array => Uint8Array.from([...b.slice(4, 8), ...b.slice(2, 4), ...b.slice(0, 2), ...b.slice(8)])

const wrongValue = (text: string, fn: string) => sqlError('ER_WRONG_VALUE_FOR_TYPE', `Incorrect string value: '${text}' for function ${fn}`)

/** The function, or undefined for any other name. `callName` is as written, for arity errors; `label` the call's text, for 1690. */
export function moreFunction(name: string, xs: readonly Compiled[], callName: string, label: string, using: string | undefined, constant: readonly boolean[], ctx: CompileContext, args: readonly string[] = []): Compiled | undefined {
  if (!MORE_FUNCTIONS.has(name)) return undefined
  const conn = ctx.connectionCollation
  const arity = (min: number, max = min): void => {
    if (xs.length < min || xs.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${callName}'`)
  }
  const nullableAny = (...cs: readonly Compiled[]): boolean => cs.some((c) => c.type.nullable)
  const hexText = (chars: number, nullable: boolean): ResultType => ({ ...stringType(chars, conn, nullable), coercibility: COERCIBILITY.COERCIBLE })
  const conv = (s: string): Value => stringValue(s, conn, COERCIBILITY.COERCIBLE)
  const dbl = (nullable = true): ResultType => doubleType(nullable, 23)
  const fn = name.toLowerCase()

  switch (name) {
    case 'CHAR': {
      arity(1, Infinity)
      const reads = xs.map(intReader)
      const target = using === undefined ? undefined : using.toLowerCase() === 'binary' ? CHARSET_BINARY : (defaultCollationOf(using.toLowerCase() === 'utf8' ? 'utf8mb3' : using.toLowerCase())?.id ?? collationInfoByName(using.toLowerCase())?.id)
      if (using !== undefined && target === undefined) throw sqlError('ER_UNKNOWN_CHARACTER_SET', `Unknown character set: '${using}'`)
      const binary = target === undefined || target === CHARSET_BINARY
      return {
        eval: (r, env) => {
          const bytes: number[] = []
          for (const read of reads) {
            const n = read(r, env)
            if (n === null) continue
            const u = Number(BigInt.asUintN(32, n))
            if (u > 0xffffff) bytes.push(u >>> 24)
            if (u > 0xffff) bytes.push((u >>> 16) & 255)
            if (u > 0xff) bytes.push((u >>> 8) & 255)
            bytes.push(u & 255)
          }
          const b = Uint8Array.from(bytes)
          if (binary) return bytesValue(b)
          const info = requireCollationInfo(target as number)
          // A single-byte charset takes any byte; ascii's past 127 are '?' (8.4.11).
          if (info.mbmaxlen === 1) {
            if (info.charset === 'ascii' && b.some((x) => x > 127)) raise(env, 1300, `Invalid ascii character string: '${hexOf(b)}'`)
            const text = info.charset === 'ascii' ? Array.from(b, (x) => (x > 127 ? '?' : String.fromCharCode(x))).join('') : decodeCollation(b, target as number)
            return stringValue(text, target as number, COERCIBILITY.COERCIBLE)
          }
          const text = decodeCollation(b, target as number)
          const back = encodeCollation(text, target as number)
          if (back.length !== b.length || back.some((x, i) => x !== b[i])) {
            raise(env, 1300, `Invalid ${requireCollationInfo(target as number).charset} character string: '${hexOf(b)}'`)
            return null
          }
          return stringValue(text, target as number, COERCIBILITY.COERCIBLE)
        },
        type: binary ? stringType(4 * xs.length, CHARSET_BINARY, true) : { ...stringType(4 * xs.length, target as number, true), coercibility: COERCIBILITY.COERCIBLE },
      }
    }
    case 'FIELD': {
      arity(2, Infinity)
      const kinds = xs.map((x) => x.type.kind)
      const textual = kinds.every((k) => k === 'string' || k === 'bytes' || k === 'null')
      const integral = kinds.every((k) => k === 'int' || k === 'null')
      const exact = kinds.every((k) => k === 'int' || k === 'decimal' || k === 'null')
      // The first argument's collation is the comparison's, and every other
      // argument is converted into its charset — bytes validated there — with
      // 3854 when one cannot be: a constant's before any row is read, a
      // column's at the row (`Item_func_field::resolve_type`; 8.4.11 converts
      // columns too, and an explicit COLLATE after the first is ignored).
      const first = xs[0] as Compiled
      const id = first.type.kind === 'string' ? first.type.collationId : CHARSET_BINARY
      const allBytes = id === CHARSET_BINARY
      if (textual) {
        const env = { params: ctx.params ?? [], now: new Date(0), session: ctx.session, state: ctx.state }
        for (let i = 1; i < xs.length; i++) {
          if (constant[i] !== true) continue
          const v = (xs[i] as Compiled).eval([], env)
          if (v !== null) strOf(v, allBytes, id)
        }
      }
      const reads = textual ? xs : xs.map((x) => (exact ? asNumber(x, 'DECIMAL') : asNumber(x, 'DOUBLE')))
      return {
        eval: (r, env) => {
          const v = (reads[0] as Compiled).eval(r, env)
          if (v === null) return intValue(0n)
          for (let i = 1; i < reads.length; i++) {
            const w = (reads[i] as Compiled).eval(r, env)
            if (w === null) continue
            let equal: boolean
            if (textual) {
              const a = strOf(v, allBytes, id).units.join('')
              const b = strOf(w, allBytes, id).units.join('')
              equal = allBytes ? a === b : compareValues(stringValue(a, id), stringValue(b, id)) === 0
            } else if (integral || exact) equal = compareValues(decimalValue(toDecimal(v).v, toDecimal(v).scale), decimalValue(toDecimal(w).v, toDecimal(w).scale)) === 0
            else equal = toDouble(v) === toDouble(w)
            if (equal) return intValue(BigInt(i))
          }
          return intValue(0n)
        },
        type: intType(3, false),
      }
    }
    case 'ELT': {
      arity(2, Infinity)
      const n = intReader(xs[0] as Compiled)
      const choices = xs.slice(1)
      aggregateCollations(
        choices.map((c) => c.type),
        'elt',
        false,
      )
      const texts = choices.some((c) => c.type.kind !== 'null')
      const agg = aggregateString(
        choices.map((c) => c.type),
        conn,
      )
      // Only NULLs to choose among is binary's.
      const { binary, collation, coercibility } = texts ? agg : { binary: true, collation: CHARSET_BINARY, coercibility: COERCIBILITY.IGNORABLE }
      return {
        eval: (r, env) => {
          const i = n(r, env)
          if (i === null || i < 1n || i > BigInt(choices.length)) return null
          const v = (choices[Number(i) - 1] as Compiled).eval(r, env)
          return v === null ? null : result(strOf(v, binary, collation).units, binary, collation, coercibility)
        },
        type: textType(Math.max(...choices.map((c) => charsOf(c.type))), binary, collation, coercibility),
      }
    }
    case 'MAKE_SET':
    case 'EXPORT_SET': {
      const make = name === 'MAKE_SET'
      arity(make ? 2 : 3, make ? Infinity : 5)
      const bits = intReader(xs[0] as Compiled)
      const parts = make ? xs.slice(1) : xs.slice(1, 4)
      aggregateCollations(
        parts.map((c) => c.type),
        fn,
        false,
      )
      const texts = parts.some((c) => c.type.kind !== 'null')
      const agg = aggregateString(
        parts.map((c) => c.type),
        conn,
      )
      const { binary, collation, coercibility } = texts ? agg : { binary: true, collation: CHARSET_BINARY, coercibility: COERCIBILITY.IGNORABLE }
      const count = make ? undefined : xs[4] === undefined ? undefined : intReader(xs[4])
      // MAKE_SET counts characters even into bytes; EXPORT_SET counts bytes (8.4.11).
      const widths = parts.map((c) => (make ? charsOf(c.type) : widthOf(c.type, binary)))
      const chars = make
        ? widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1)
        : Math.max(widths[0] as number, widths[1] as number) * 64 + (xs[3] === undefined ? 1 : (widths[2] as number)) * 63
      const nullable = make ? xs.some((x) => x.type.nullable) : true
      return {
        eval: (r, env) => {
          const b = bits(r, env)
          if (b === null) return null
          const mask = BigInt.asUintN(64, b)
          if (make) {
            const out: string[][] = []
            for (let i = 0; i < parts.length; i++) {
              if (((mask >> BigInt(i)) & 1n) === 0n) continue
              const v = (parts[i] as Compiled).eval(r, env)
              if (v !== null) out.push([...strOf(v, binary, collation).units])
            }
            return result(out.flatMap((u, i) => (i === 0 ? u : [',', ...u])), binary, collation, coercibility)
          }
          const vs = all(parts, r, env)
          if (vs === undefined) return null
          const [on, off] = vs.map((v) => strOf(v, binary, collation).units) as [readonly string[], readonly string[]]
          const sep = vs[2] === undefined ? [','] : strOf(vs[2], binary, collation).units
          let n = 64
          if (count !== undefined) {
            const c = count(r, env)
            if (c === null) return null
            n = c < 0n || c > 64n ? 64 : Number(c)
          }
          const out: string[] = []
          for (let i = 0; i < n; i++) {
            if (i > 0) out.push(...sep)
            out.push(...(((mask >> BigInt(i)) & 1n) === 1n ? on : off))
          }
          return result(out, binary, collation, coercibility)
        },
        type: { ...textType(chars, binary, collation, coercibility, true), nullable },
      }
    }
    case 'FIND_IN_SET': {
      arity(2)
      const [s, list] = xs as [Compiled, Compiled]
      const agg = aggregateCollations([s.type, list.type], 'find_in_set', true)
      const binary = s.type.kind === 'bytes' || list.type.kind === 'bytes'
      const id = binary ? CHARSET_BINARY : (agg?.collationId ?? conn)
      return {
        eval: (r, env) => {
          const a = s.eval(r, env)
          const b = list.eval(r, env)
          if (a === null || b === null) return null
          const needle = strOf(a, binary, id).units.join('')
          const hay = strOf(b, binary, id).units.join('')
          if (needle.includes(',') || hay === '') return intValue(0n)
          const items = hay.split(',')
          for (let i = 0; i < items.length; i++) {
            const x = binary ? needle === items[i] : compareValues(stringValue(needle, id), stringValue(items[i] as string, id)) === 0
            if (x) return intValue(BigInt(i + 1))
          }
          return intValue(0n)
        },
        type: intType(3, nullableAny(s, list)),
      }
    }
    case 'INSERT': {
      arity(4)
      const [s, posC, lenC, sub] = xs as [Compiled, Compiled, Compiled, Compiled]
      const { binary, collation, coercibility } = firstCollation(s.type, conn)
      // A constant number inserted is as wide as its text, sign and all (8.4.11: INSERT('', 1, 1, 123) is 3 wide, -4.5 is 4).
      let insertedWidth = widthOf(sub.type, binary)
      if (!binary && (sub.type.kind === 'int' || sub.type.kind === 'decimal') && constant[3] === true) {
        try {
          const v = sub.eval([], { params: ctx.params ?? [], now: new Date(0), session: ctx.session, state: ctx.state })
          if (v !== null) insertedWidth = toText(v).length
        } catch (e) {
          expectTyped(e)
          // A constant that cannot be read now is read when the row is.
        }
      }
      const pos = intReader(posC)
      const len = intReader(lenC)
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          const p = pos(r, env)
          const l = len(r, env)
          const w = sub.eval(r, env)
          if (v === null || p === null || l === null || w === null) return null
          const units = strOf(v, binary, collation).units
          // The inserted text is converted first, and fails (3854) even when it is not used.
          const inserted = strOf(w, binary, collation).units
          if (p < 1n || p > BigInt(units.length)) return result(units, binary, collation, coercibility)
          const start = Number(p) - 1
          const rest = units.length - start
          const take = l < 0n || l > BigInt(rest) ? rest : Number(l)
          return result([...units.slice(0, start), ...inserted, ...units.slice(start + take)], binary, collation, coercibility)
        },
        // A number inserted counts its digits, not the sign's place it has elsewhere (8.4.11: INSERT('', 1, 1, 123) is 3 wide).
        type: textType(widthOf(s.type, binary) + insertedWidth, binary, collation, coercibility),
      }
    }
    case 'SUBSTRING_INDEX': {
      arity(3)
      const [s, delimC, countC] = xs as [Compiled, Compiled, Compiled]
      const { binary, collation, coercibility } = firstCollation(s.type, conn)
      const count = intReader(countC)
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          const d = delimC.eval(r, env)
          const c = count(r, env)
          if (v === null || d === null || c === null) return null
          const text = strOf(v, binary, collation).units
          const delim = strOf(d, binary, collation).units
          if (delim.length === 0 || c === 0n) return result([], binary, collation, coercibility)
          const hits: number[] = []
          for (let i = 0; i + delim.length <= text.length; ) {
            if (delim.every((u, k) => text[i + k] === u)) {
              hits.push(i)
              i += delim.length
            } else i++
          }
          const n = c
          if (n > 0n) {
            if (n > BigInt(hits.length)) return result(text, binary, collation, coercibility)
            return result(text.slice(0, hits[Number(n) - 1]), binary, collation, coercibility)
          }
          const k = -n
          if (k > BigInt(hits.length)) return result(text, binary, collation, coercibility)
          return result(text.slice((hits[hits.length - Number(k)] as number) + delim.length), binary, collation, coercibility)
        },
        type: textType(widthOf(s.type, binary), binary, collation, coercibility),
      }
    }
    case 'QUOTE': {
      arity(1)
      const s = xs[0] as Compiled
      // Bytes are quoted as the connection's text, 3854 when they are not text there.
      const first = firstCollation(s.type, conn)
      const { binary, collation, coercibility } = first.binary ? { binary: false, collation: conn, coercibility: COERCIBILITY.COERCIBLE } : first
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return result([...'NULL'], binary, collation, coercibility)
          const out: string[] = ["'"]
          for (const u of strOf(v, binary, collation).units) {
            if (u === '\\' || u === "'") out.push('\\', u)
            else if (u === '\0') out.push('\\', '0')
            else if (u === '\x1a') out.push('\\', 'Z')
            else out.push(u)
          }
          out.push("'")
          return result(out, binary, collation, coercibility)
        },
        // At least 'NULL''s four.
        type: textType(Math.max(4, s.type.kind === 'null' ? 4 : 2 * widthOf(s.type, binary) + 2), binary, collation, coercibility),
      }
    }
    case 'SOUNDEX': {
      arity(1)
      const s = xs[0] as Compiled
      const { binary, collation, coercibility } = firstCollation(s.type, conn)
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          return result([...soundex(strOf(v, binary, collation).units.join(''))], binary, collation, coercibility)
        },
        type: textType(Math.max(widthOf(s.type, binary), 4), binary, collation, coercibility),
      }
    }
    case 'FORMAT': {
      arity(2, 3)
      const n = asNumber(xs[0] as Compiled, 'DOUBLE')
      const d = intReader(xs[1] as Compiled)
      const chars = charWidth((xs[0] as Compiled).type)
      // A constant locale is looked up once, and an unknown one warns once (8.4.11).
      const lookup = (l: Value, warn: (name: string) => void): readonly [string, string, boolean] => {
        const name = l === null ? 'NULL' : toText(l)
        const found = LOCALES.get(name.toLowerCase())
        if (found !== undefined) return found
        warn(name)
        return EN_US
      }
      let loc = xs[2]
      let fixedLocale: readonly [string, string, boolean] | undefined
      if (loc !== undefined && constant[2] === true) {
        const l = loc.eval([], { params: ctx.params ?? [], now: new Date(0), session: ctx.session, state: ctx.state })
        fixedLocale = lookup(l, (name) => ctx.conditions?.push({ level: 'Warning', code: 1649, message: `Unknown locale: '${name}'` }))
        loc = undefined
      }
      return {
        eval: (r, env) => {
          // The places are read first; NULL ones leave the number unread.
          const places = d(r, env)
          if (places === null) return null
          const v = n.eval(r, env)
          if (v === null) return null
          // An unknown locale, NULL's included, is en_US with 1649.
          const locale = fixedLocale ?? (loc === undefined ? EN_US : lookup(loc.eval(r, env), (name) => raise(env, 1649, `Unknown locale: '${name}'`)))
          // The places are cut to a 32-bit int: 2⁶⁴ − 1 and 2⁶³ − 1 are both −1, and so none.
          const signed = BigInt.asIntN(32, places)
          const p = signed < 0n ? 0 : signed > 30n ? 30 : Number(signed)
          return conv(format(v, p, locale))
        },
        type: hexText(chars + Math.floor(chars / 3) + 1 + 1 + 30, true),
      }
    }
    case 'BIT_LENGTH': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          return v === null ? null : intValue(BigInt(bytesOf(v).length * 8))
        },
        type: intType(10, s.type.nullable),
      }
    }
    case 'CONV': {
      arity(3)
      const [nC, fromC, toC] = xs as [Compiled, Compiled, Compiled]
      const from = intReader(fromC)
      const to = intReader(toC)
      return {
        eval: (r, env) => {
          const v = nC.eval(r, env)
          const f = from(r, env)
          const t = to(r, env)
          if (v === null || f === null || t === null) return null
          const fb = Number(f < 0n ? -f : f)
          const tb = Number(t < 0n ? -t : t)
          if (fb < 2 || fb > 36 || tb < 2 || tb > 36) return null
          // A hex literal is its number; anything else is read as text, a number's digits in the from-base included.
          if (v.kind === 'bytes' && v.hex === true) return conv(toBase(valInt(v), Number(t)))
          const text = v.kind === 'bytes' ? new TextDecoder('latin1').decode(v.v) : toText(v)
          if (text.length === 0) return null
          // Not one digit of the base is 1292 (8.4.11: CONV('abc', 2, 10) warns, CONV('12', 2, 10) does not).
          const n = parseInBase(text, fb, f < 0n, () => raise(env, 1292, `Truncated incorrect DECIMAL value: '${text}'`))
          return conv(toBase(n, Number(t)))
        },
        type: hexText(65, true),
      }
    }
    case 'TO_BASE64': {
      arity(1)
      const s = xs[0] as Compiled
      const bytes = widthOf(s.type, true)
      const len = Math.ceil(bytes / 3) * 4
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          return v === null ? null : conv(toBase64(bytesOf(v)))
        },
        type: hexText(len + Math.floor(len / 76), true),
      }
    }
    case 'FROM_BASE64': {
      arity(1)
      const s = xs[0] as Compiled
      const bytes = widthOf(s.type, true)
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const out = fromBase64(new TextDecoder('latin1').decode(bytesOf(v)))
          return out === undefined ? null : bytesValue(out)
        },
        type: stringType(Math.floor((bytes * 3) / 4), CHARSET_BINARY, true),
      }
    }
    case 'ORD': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          if (v.kind !== 'string') {
            const b = bytesOf(v)
            return intValue(BigInt(b[0] ?? 0))
          }
          const first = [...v.v][0]
          if (first === undefined) return intValue(0n)
          let n = 0n
          for (const b of encodeCollation(first, v.collationId)) n = n * 256n + BigInt(b)
          return intValue(n)
        },
        type: intType(21, s.type.nullable),
      }
    }
    case 'MD5':
    case 'SHA1':
    case 'SHA':
    case 'CRC32': {
      arity(1)
      const s = xs[0] as Compiled
      if (name === 'CRC32') {
        return {
          eval: (r, env) => {
            const v = s.eval(r, env)
            return v === null ? null : intValue(BigInt(crc32(bytesOf(v))), true)
          },
          type: intType(10, s.type.nullable, true),
        }
      }
      const digest = name === 'MD5' ? md5 : sha1
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          return v === null ? null : conv(digest(bytesOf(v)))
        },
        type: hexText(name === 'MD5' ? 32 : 40, true),
      }
    }
    case 'SHA2': {
      arity(2)
      const [s, bitsC] = xs as [Compiled, Compiled]
      const bits = intReader(bitsC)
      // A constant length decides the width, 64 for one that is no length; any other 128.
      let shaWidth = 128
      let fixedBits: bigint | null | undefined
      if (constant[1] === true) {
        try {
          const b = bitsC.eval([], { params: ctx.params ?? [], now: new Date(0), session: ctx.session, state: ctx.state })
          const n = b === null ? null : valInt(b)
          shaWidth = n === 224n ? 56 : n === 384n ? 96 : n === 512n ? 128 : 64
          // A constant length that is none is NULL, warned once (8.4.11).
          fixedBits = n === 0n ? 256n : n
          if (fixedBits === null || ![224n, 256n, 384n, 512n].includes(fixedBits)) {
            ctx.conditions?.push({ level: 'Warning', code: 1583, message: `Incorrect parameters in the call to native function 'sha2'` })
            fixedBits = null
          }
        } catch (e) {
          expectTyped(e)
          shaWidth = 64
        }
      }
      return {
        eval: (r, env) => {
          if (fixedBits === null) return null
          const v = s.eval(r, env)
          const b = fixedBits ?? bits(r, env)
          if (v === null || b === null) return null
          const n = b === 0n ? 256n : b
          if (n !== 224n && n !== 256n && n !== 384n && n !== 512n) {
            raise(env, 1583, `Incorrect parameters in the call to native function 'sha2'`)
            return null
          }
          const data = bytesOf(v)
          return conv(n <= 256n ? sha256(data, Number(n) as 224 | 256) : sha512(data, Number(n) as 384 | 512))
        },
        type: hexText(shaWidth, true),
      }
    }
    case 'PI':
      arity(0)
      return { eval: () => doubleValue(Math.PI), type: { ...doubleType(false, 8), scale: 6 } }
    case 'BIT_COUNT': {
      arity(1)
      const x = intReader(xs[0] as Compiled)
      return {
        eval: (r, env) => {
          const n = x(r, env)
          if (n === null) return null
          let u = BigInt.asUintN(64, n)
          let c = 0n
          while (u > 0n) {
            c += u & 1n
            u >>= 1n
          }
          return intValue(c)
        },
        type: intType(21, (xs[0] as Compiled).type.nullable),
      }
    }
    case 'ISNULL': {
      arity(1)
      const x = xs[0] as Compiled
      return { eval: (r, env) => bool(x.eval(r, env) === null), type: intType(1, false) }
    }
    case 'INTERVAL': {
      arity(2, Infinity)
      const exact = xs.every((x) => x.type.kind === 'int' || x.type.kind === 'decimal' || x.type.kind === 'null')
      const reads = xs.map((x) => asNumber(x, exact ? 'DECIMAL' : 'DOUBLE'))
      return {
        eval: (r, env) => {
          const v = (reads[0] as Compiled).eval(r, env)
          if (v === null) return intValue(-1n)
          for (let i = 1; i < reads.length; i++) {
            // A NULL bound is passed over.
            const w = (reads[i] as Compiled).eval(r, env)
            if (w === null) continue
            const greater = exact ? compareValues(w, v) === 1 : toDouble(w) > toDouble(v)
            if (greater) return intValue(BigInt(i - 1))
          }
          return intValue(BigInt(reads.length - 1))
        },
        type: intType(2, false),
      }
    }
    case 'INET_ATON': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const text = toText(v)
          let total = 0n
          let byte = 0n
          let dots = 0
          let digits = 0
          for (const ch of text) {
            if (ch >= '0' && ch <= '9') {
              byte = byte * 10n + BigInt(ch.charCodeAt(0) - 48)
              digits++
              if (byte > 255n) return invalidIp(env, args[0] ?? text, 'inet_aton')
            } else if (ch === '.') {
              if (digits === 0 || dots >= 3) return invalidIp(env, args[0] ?? text, 'inet_aton')
              total = (total << 8n) + byte
              byte = 0n
              digits = 0
              dots++
            } else return invalidIp(env, args[0] ?? text, 'inet_aton')
          }
          if (digits === 0) return invalidIp(env, args[0] ?? text, 'inet_aton')
          if (dots === 1) total <<= 16n
          else if (dots === 2) total <<= 8n
          return intValue((total << 8n) + byte, true)
        },
        type: intType(21, true, true),
      }
    }
    case 'INET_NTOA': {
      arity(1)
      const n = intReader(xs[0] as Compiled)
      const shown = args[0] ?? '?'
      return {
        eval: (r, env) => {
          const v = n(r, env)
          if (v === null) return null
          // A number that is no address is NULL, and 1411 names the argument as written.
          if (v < 0n || v > 0xffffffffn) {
            raise(env, 1411, `Incorrect integer value: '${shown}' for function inet_ntoa`)
            return null
          }
          const x = Number(v)
          return conv(`${x >>> 24}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`)
        },
        type: hexText(31, true),
      }
    }
    case 'INET6_ATON': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const text = toText(v)
          const out = ipv4(text) ?? ipv6(text)
          return out === undefined ? invalidIp(env, args[0] ?? text, 'inet6_aton') : bytesValue(out)
        },
        type: stringType(16, CHARSET_BINARY, true),
      }
    }
    case 'INET6_NTOA': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          if (v.kind !== 'bytes' || (v.v.length !== 4 && v.v.length !== 16)) return invalidIp(env, args[0] ?? toText(v), 'inet6_ntoa')
          return conv(v.v.length === 4 ? Array.from(v.v).join('.') : ipv6Text(v.v))
        },
        type: hexText(39, true),
      }
    }
    case 'IS_IPV4':
    case 'IS_IPV6':
    case 'IS_UUID': {
      arity(1)
      const s = xs[0] as Compiled
      const test = name === 'IS_IPV4' ? (t: string) => ipv4(t) !== undefined : name === 'IS_IPV6' ? (t: string) => ipv6(t) !== undefined : (t: string) => uuidBytes(t) !== undefined
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          return bool(test(toText(v)))
        },
        type: intType(1, name === 'IS_UUID' ? true : s.type.nullable),
      }
    }
    case 'IS_IPV4_COMPAT':
    case 'IS_IPV4_MAPPED': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          if (v.kind !== 'bytes' || v.v.length !== 16) return intValue(0n)
          const b = v.v
          const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0)
          if (name === 'IS_IPV4_COMPAT') return bool(zero(0, 12) && !zero(12, 16))
          return bool(zero(0, 10) && b[10] === 0xff && b[11] === 0xff)
        },
        type: intType(1, true),
      }
    }
    case 'UUID_TO_BIN': {
      arity(1, 2)
      const s = xs[0] as Compiled
      const swap = xs[1] === undefined ? undefined : intReader(xs[1])
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const text = toText(v)
          const b = uuidBytes(text)
          if (b === undefined) throw wrongValue(text, 'uuid_to_bin')
          const sw = swap === undefined ? 0n : swap(r, env)
          return bytesValue(sw !== null && sw !== 0n ? swapped(b) : b)
        },
        type: stringType(16, CHARSET_BINARY, true),
      }
    }
    case 'BIN_TO_UUID': {
      arity(1, 2)
      const s = xs[0] as Compiled
      const swap = xs[1] === undefined ? undefined : intReader(xs[1])
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const b = bytesOf(v)
          if (b.length !== 16) throw wrongValue(v.kind === 'bytes' ? hexOf(b) : toText(v), 'bin_to_uuid')
          const sw = swap === undefined ? 0n : swap(r, env)
          const u = sw !== null && sw !== 0n ? unswapped(b) : b
          const h = Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('')
          return conv(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`)
        },
        type: hexText(36, true),
      }
    }
  }

  // The numeric functions of doubles.
  const one = (f: (x: number) => number | null, nullable = true): Compiled => {
    arity(1)
    const x = doubleReader(xs[0] as Compiled)
    return {
      eval: (r, env) => {
        const v = x(r, env)
        if (v === null) return null
        const out = f(v)
        if (out === null) return null
        if (!Number.isFinite(out)) throw doubleOutOfRange(label)
        return doubleValue(out)
      },
      type: dbl(nullable),
    }
  }
  const logOf = (f: (x: number) => number) => (env: Env, x: number): number | null => {
    if (x <= 0) {
      raise(env, 3020, 'Invalid argument for logarithm')
      return null
    }
    return f(x)
  }
  const logged = (f: (x: number) => number): Compiled => {
    arity(1)
    const x = doubleReader(xs[0] as Compiled)
    const g = logOf(f)
    return {
      eval: (r, env) => {
        const v = x(r, env)
        if (v === null) return null
        const out = g(env, v)
        return out === null ? null : doubleValue(out)
      },
      type: dbl(),
    }
  }
  switch (name) {
    case 'SQRT':
      return one((x) => (x < 0 ? null : Math.sqrt(x)))
    case 'EXP':
      return one(Math.exp)
    case 'LN':
      return logged(Math.log)
    case 'LOG2':
      return logged(Math.log2)
    case 'LOG10':
      return logged(Math.log10)
    case 'LOG': {
      if (xs.length === 1) return logged(Math.log)
      arity(2)
      const b = doubleReader(xs[0] as Compiled)
      const x = doubleReader(xs[1] as Compiled)
      return {
        eval: (r, env) => {
          // The base is read and judged before the value is read (`Item_func_log::val_real`).
          const base = b(r, env)
          if (base === null) return null
          if (base <= 0) {
            raise(env, 3020, 'Invalid argument for logarithm')
            return null
          }
          const v = x(r, env)
          if (v === null) return null
          if (v <= 0 || base === 1) {
            raise(env, 3020, 'Invalid argument for logarithm')
            return null
          }
          return doubleValue(Math.log(v) / Math.log(base))
        },
        type: dbl(),
      }
    }
    case 'SIN':
      return one(Math.sin)
    case 'COS':
      return one(Math.cos)
    case 'TAN':
      return one(Math.tan)
    case 'ASIN':
      return one((x) => (x < -1 || x > 1 ? null : Math.asin(x)))
    case 'ACOS':
      return one((x) => (x < -1 || x > 1 ? null : Math.acos(x)))
    case 'COT':
      return one((x) => 1 / Math.tan(x))
    case 'DEGREES':
      return one((x) => (x * 180) / Math.PI, (xs[0] as Compiled).type.nullable)
    case 'RADIANS':
      return one((x) => (x * Math.PI) / 180, (xs[0] as Compiled).type.nullable)
    case 'ATAN':
      if (xs.length === 1) return one(Math.atan)
    // falls through
    case 'ATAN2':
    case 'POW':
    case 'POWER': {
      arity(2)
      const a = doubleReader(xs[0] as Compiled)
      const b = doubleReader(xs[1] as Compiled)
      const pow = name === 'POW' || name === 'POWER'
      return {
        eval: (r, env) => {
          // POW reads both; ATAN stops at a NULL first (8.4.11).
          const x = a(r, env)
          if (x === null && !pow) return null
          const y = b(r, env)
          if (x === null || y === null) return null
          const out = pow ? Math.pow(x, y) : Math.atan2(x, y)
          if (!Number.isFinite(out)) throw doubleOutOfRange(label)
          return doubleValue(out)
        },
        type: dbl(),
      }
    }
  }
  return undefined
}

/** An address that is not one: NULL, and 1411 naming the function. */
function invalidIp(env: Env, text: string, fn: string): null {
  raise(env, 1411, `Incorrect string value: '${text}' for function ${fn}`)
  return null
}

