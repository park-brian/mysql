// M5.21 — JSON as a value: what a JSON column holds and a JSON function
// returns, the text MySQL parses it from and renders it as, and how two of
// them compare.
//
// json.ts is the binary format (M2.13), and its `JsonValue` is the shape a
// reader of `.ibd` or binlog bytes wants. Evaluating SQL needs what that shape
// erases, so this is a second one, lossless where MySQL is observable:
//
//   - An integer is signed or unsigned, and a double is a third kind:
//     `[1, 1.0]` renders as written, and `1e2` is `100.0`.
//   - A DECIMAL keeps its scale: `JSON_ARRAY(1.50)` is `[1.50]`.
//   - A date, a time and a datetime are values of their own, rendered as
//     MySQL renders them (`"10:11:12.000000"`), and compare as temporals.
//   - A binary string is opaque, `"base64:type15:YWJj"`, keeping the field
//     type it came from.
//   - An object's keys are unique and in length-then-bytes order, which is
//     how it is stored and so how it renders: `{"b": 1, "a": 2}` is
//     `{"a": 2, "b": 1}`, and of two equal keys the last value wins.
//
// The text grammar is RFC 8259 as rapidjson parses it (MySQL embeds rapidjson,
// and its error messages are rapidjson's, which is MIT): a number with neither
// a fraction nor an exponent is an INT64 if it fits, a UINT64 if that fits, and
// a double past both; `-0` is the integer 0 and `-0.0` the double -0. All of it
// was read off 8.4.11 (tools/capture-json.mjs, M5.21).
import type { MysqlDateTime, MysqlTime } from '@myjs/bytes'
import { MyjsError, renderMysqlDateTime, renderMysqlTime } from '@myjs/bytes'
import { decodeDecimal, encodeDecimal } from './decimal.ts'
import { invalidJson } from './errors.ts'
import { JSON_TYPE, compareJsonKeys, isInlined, varint, writeVarint } from './json.ts'
import { compareDecimals } from './compare.ts'
import { parseDecimal, renderDecimal, renderDouble, type DecimalValue, type Value } from './sql-value.ts'

export type JsonDoc =
  | { readonly t: 'null' }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'int'; readonly v: bigint }
  | { readonly t: 'uint'; readonly v: bigint }
  | { readonly t: 'double'; readonly v: number }
  | { readonly t: 'decimal'; readonly v: DecimalValue }
  | { readonly t: 'string'; readonly v: string }
  | { readonly t: 'date' | 'datetime' | 'timestamp'; readonly v: MysqlDateTime }
  | { readonly t: 'time'; readonly v: MysqlTime }
  /** A value with no JSON type, kept as the field type it came from and its bytes. */
  | { readonly t: 'opaque'; readonly field: number; readonly v: Uint8Array }
  | { readonly t: 'array'; readonly v: readonly JsonDoc[] }
  /** Unique keys, in `compareJsonKeys` order. */
  | { readonly t: 'object'; readonly v: readonly (readonly [string, JsonDoc])[] }

export const JSON_NULL: JsonDoc = { t: 'null' }
export const JSON_TRUE: JsonDoc = { t: 'bool', v: true }
export const JSON_FALSE: JsonDoc = { t: 'bool', v: false }

const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

/** An integer as JSON holds it: INT64 where it fits, UINT64 past that. */
export function jsonInteger(v: bigint): JsonDoc {
  return v >= INT64_MIN && v <= INT64_MAX ? { t: 'int', v } : { t: 'uint', v }
}

/** An object from members in any order: the last of two equal keys wins, and the keys are sorted. */
export function jsonObject(members: Iterable<readonly [string, JsonDoc]>): JsonDoc {
  const byKey = new Map<string, JsonDoc>()
  for (const [k, v] of members) byKey.set(k, v)
  return { t: 'object', v: [...byKey].sort((a, b) => compareJsonKeys(a[0], b[0])) }
}

// --- text -----------------------------------------------------------------------

/** A JSON text that does not parse: rapidjson's message, and the offset (in characters) it was found at. */
export class JsonSyntaxError extends MyjsError {
  readonly position: number
  constructor(message: string, position: number) {
    super('JSON_SYNTAX', message)
    this.position = position
  }
}

const WS = new Set([' ', '\t', '\n', '\r'])

/** Parse a JSON text, as MySQL does for `CAST(… AS JSON)` and a string into a JSON column. */
export function parseJson(text: string): JsonDoc {
  let i = 0
  const fail = (message: string, at = i): never => {
    throw new JsonSyntaxError(message, at)
  }
  const skip = (): void => {
    while (i < text.length && WS.has(text[i] as string)) i++
  }
  const value = (depth: number): JsonDoc => {
    skip()
    const c = text[i]
    if (c === undefined) return fail(depth === 0 ? 'The document is empty.' : 'Invalid value.')
    if (c === '{') return object(depth)
    if (c === '[') return array(depth)
    if (c === '"') return { t: 'string', v: string() }
    if (c === 't') return literal('true', JSON_TRUE)
    if (c === 'f') return literal('false', JSON_FALSE)
    if (c === 'n') return literal('null', JSON_NULL)
    if (c === '-' || (c >= '0' && c <= '9')) return number()
    return fail('Invalid value.')
  }
  const literal = (word: string, v: JsonDoc): JsonDoc => {
    if (text.startsWith(word, i)) {
      i += word.length
      return v
    }
    return fail('Invalid value.')
  }
  const object = (depth: number): JsonDoc => {
    i++
    const members: [string, JsonDoc][] = []
    skip()
    if (text[i] === '}') {
      i++
      return { t: 'object', v: [] }
    }
    for (;;) {
      skip()
      if (text[i] !== '"') return fail('Missing a name for object member.')
      const key = string()
      skip()
      if (text[i] !== ':') return fail('Missing a colon after a name of object member.')
      i++
      members.push([key, value(depth + 1)])
      skip()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === '}') {
        i++
        return jsonObject(members)
      }
      return fail("Missing a comma or '}' after an object member.")
    }
  }
  const array = (depth: number): JsonDoc => {
    i++
    const items: JsonDoc[] = []
    skip()
    if (text[i] === ']') {
      i++
      return { t: 'array', v: items }
    }
    for (;;) {
      items.push(value(depth + 1))
      skip()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === ']') {
        i++
        return { t: 'array', v: items }
      }
      return fail("Missing a comma or ']' after an array element.")
    }
  }
  const hex4 = (): number => {
    const h = text.slice(i, i + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(h)) return fail('Incorrect hex digit after \\u escape in string.')
    i += 4
    return parseInt(h, 16)
  }
  const string = (): string => {
    const start = i
    i++
    let out = ''
    for (;;) {
      const c = text[i]
      if (c === undefined) return fail('Missing a closing quotation mark in string.', start)
      if (c === '"') {
        i++
        return out
      }
      if (c === '\\') {
        const e = text[i + 1]
        i += 2
        switch (e) {
          case '"':
          case '\\':
          case '/':
            out += e
            break
          case 'b':
            out += '\b'
            break
          case 'f':
            out += '\f'
            break
          case 'n':
            out += '\n'
            break
          case 'r':
            out += '\r'
            break
          case 't':
            out += '\t'
            break
          case 'u': {
            let code = hex4()
            if (code >= 0xd800 && code <= 0xdbff) {
              if (text[i] !== '\\' || text[i + 1] !== 'u') return fail('The surrogate pair in string is invalid.')
              i += 2
              const low = hex4()
              if (low < 0xdc00 || low > 0xdfff) return fail('The surrogate pair in string is invalid.')
              code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
            } else if (code >= 0xdc00 && code <= 0xdfff) return fail('The surrogate pair in string is invalid.')
            out += String.fromCodePoint(code)
            break
          }
          default:
            // rapidjson reports the backslash, not the character after it (8.4.11).
            return fail('Invalid escape character in string.', i - 2)
        }
        continue
      }
      if (c < ' ') return fail('Invalid encoding in string.')
      out += c
      i++
    }
  }
  /**
   * A number, as rapidjson's `ParseNumber` reads it without its full-precision
   * flag, which is how MySQL calls it. An integer accumulates in 32 then 64
   * bits; past UINT64 it becomes a double accumulated digit by digit,
   * `d = d * 10 + digit`; a fraction is added to at most 17 significant
   * digits, and the exponent applied by one multiplication or division by
   * `1e|p|`. So `123456789012345678901234567890` is 1.2345678901234566e29 on
   * 8.4.11, one unit in the last place from the correctly rounded value.
   */
  const number = (): JsonDoc => {
    const start = i
    const digit = (): boolean => text[i] !== undefined && text[i]! >= '0' && text[i]! <= '9'
    const take = (): number => (text.charCodeAt(i++) - 48) as number
    const minus = text[i] === '-'
    if (minus) i++
    let n = 0n
    let d = 0
    let useDouble = false
    let significant = 0
    if (text[i] === '0') i++
    else if (digit()) {
      n = BigInt(take())
      const limit = minus ? 2n ** 63n : 2n ** 64n - 1n
      while (digit()) {
        const next = n * 10n + BigInt(text.charCodeAt(i) - 48)
        if (next > limit) {
          d = Number(n)
          useDouble = true
          break
        }
        n = next
        i++
        significant++
      }
      if (useDouble) while (digit()) d = d * 10 + take()
    } else return fail('Invalid value.')
    let expFrac = 0
    if (text[i] === '.') {
      i++
      if (!digit()) return fail('Miss fraction part in number.')
      if (!useDouble) {
        // The fast path: the significand in 64 bits while it is under 2^53.
        while (digit()) {
          if (n > 2n ** 53n - 1n) break
          n = n * 10n + BigInt(take())
          expFrac--
          if (n !== 0n) significant++
        }
        d = Number(n)
        useDouble = true
      }
      while (digit()) {
        if (significant < 17) {
          d = d * 10 + take()
          expFrac--
          if (d > 0) significant++
        } else i++
      }
    }
    let exp = 0
    if (text[i] === 'e' || text[i] === 'E') {
      if (!useDouble) {
        d = Number(n)
        useDouble = true
      }
      i++
      let expMinus = false
      if (text[i] === '+') i++
      else if (text[i] === '-') {
        expMinus = true
        i++
      }
      if (!digit()) return fail('Miss exponent in number.')
      exp = take()
      if (expMinus) {
        const maxExp = Math.trunc((expFrac + 2147483639) / 10)
        while (digit()) {
          exp = exp * 10 + take()
          if (exp > maxExp) while (digit()) i++
        }
      } else {
        const maxExp = 308 - expFrac
        while (digit()) {
          exp = exp * 10 + take()
          if (exp > maxExp) return fail('Number too big to be stored in double.', start)
        }
      }
      if (expMinus) exp = -exp
    }
    if (!useDouble) return jsonInteger(minus ? -n : n)
    const p = exp + expFrac
    const pow10 = (k: number): number => Number(`1e${k}`)
    const fast = (x: number, k: number): number => (k < -308 ? 0 : k >= 0 ? x * pow10(k) : x / pow10(-k))
    d = p < -308 ? fast(fast(d, -308), p + 308) : fast(d, p)
    if (d > Number.MAX_VALUE) return fail('Number too big to be stored in double.', start)
    return { t: 'double', v: minus ? -d : d }
  }
  const doc = value(0)
  skip()
  if (i < text.length) fail('The document root must not be followed by other values.')
  return doc
}

/** A string as MySQL quotes it in JSON text: `"`, `\` and control characters escaped, `/` and non-ASCII not. */
export function quoteJsonString(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (c === 0x08) out += '\\b'
    else if (c === 0x0c) out += '\\f'
    else if (c === 0x0a) out += '\\n'
    else if (c === 0x0d) out += '\\r'
    else if (c === 0x09) out += '\\t'
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

function base64(bytes: Uint8Array): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += (A[a >> 2] as string) + (A[((a & 3) << 4) | ((b ?? 0) >> 4)] as string)
    out += b === undefined ? '=' : (A[((b & 15) << 2) | ((c ?? 0) >> 6)] as string)
    out += c === undefined ? '=' : (A[c & 63] as string)
  }
  return out
}

/** A double as JSON text: MySQL's rendering, with `.0` where it would read as an integer (`1.0`, `100.0`, `-0.0`). */
function renderJsonDouble(v: number): string {
  const s = renderDouble(v)
  return /[.e]/.test(s) ? s : `${s}.0`
}

/** The text MySQL renders a JSON value as: `[1, "a"]`, `{"k": null}`. */
export function renderJson(doc: JsonDoc): string {
  switch (doc.t) {
    case 'null':
      return 'null'
    case 'bool':
      return doc.v ? 'true' : 'false'
    case 'int':
    case 'uint':
      return doc.v.toString()
    case 'double':
      return renderJsonDouble(doc.v)
    case 'decimal':
      return renderDecimal(doc.v)
    case 'string':
      return quoteJsonString(doc.v)
    case 'date':
      return `"${renderMysqlDateTime(doc.v, 0).slice(0, 10)}"`
    case 'datetime':
    case 'timestamp':
      return `"${renderMysqlDateTime(doc.v, 6)}"`
    case 'time': {
      // Hours padded to two digits, a sign in front: `"-01:02:03.000000"` (8.4.11).
      const t = doc.v
      const hours = String(t.days * 24 + t.hour).padStart(2, '0')
      return `"${t.negative ? '-' : ''}${hours}:${renderMysqlTime({ ...t, negative: false, days: 0, hour: 0 }, 6).slice(2)}"`
    }
    case 'opaque':
      return `"base64:type${doc.field}:${base64(doc.v)}"`
    case 'array':
      return `[${doc.v.map(renderJson).join(', ')}]`
    case 'object':
      return `{${doc.v.map(([k, v]) => `${quoteJsonString(k)}: ${renderJson(v)}`).join(', ')}}`
  }
}

// --- comparison -----------------------------------------------------------------

/**
 * The order of JSON types when two values' types differ, lowest first, from
 * MySQL's documentation of JSON comparison: NULL, the numbers, STRING,
 * OBJECT, ARRAY, BOOLEAN, DATE, TIME, DATETIME (TIMESTAMP with it), OPAQUE.
 */
const RANK: Readonly<Record<JsonDoc['t'], number>> = {
  null: 0,
  int: 1,
  uint: 1,
  double: 1,
  decimal: 1,
  string: 2,
  object: 3,
  array: 4,
  bool: 5,
  date: 6,
  time: 7,
  datetime: 8,
  timestamp: 8,
  opaque: 9,
}

const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0)

/** Two JSON numbers, exactly: an INT64, a UINT64, a DECIMAL or a double. */
function compareNumbers(a: JsonDoc, b: JsonDoc): number {
  const exact = (x: JsonDoc): DecimalValue | undefined =>
    x.t === 'int' || x.t === 'uint' ? { kind: 'decimal', v: x.v, scale: 0 } : x.t === 'decimal' ? x.v : undefined
  const ea = exact(a)
  const eb = exact(b)
  if (ea !== undefined && eb !== undefined) return compareDecimals(ea, eb)
  const da = a.t === 'double' ? a.v : Number(renderDecimal(ea as DecimalValue))
  const db = b.t === 'double' ? b.v : Number(renderDecimal(eb as DecimalValue))
  return da < db ? -1 : da > db ? 1 : 0
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number)
  return a.length - b.length
}

const utf8 = new TextEncoder()

const temporalKey = (v: MysqlDateTime): number[] => [v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond]
const timeKey = (v: MysqlTime): number => (v.negative ? -1 : 1) * ((((v.days * 24 + v.hour) * 60 + v.minute) * 60 + v.second) * 1e6 + v.microsecond)

/** MySQL's order of two JSON values: negative, zero or positive. */
export function compareJson(a: JsonDoc, b: JsonDoc): number {
  const ra = RANK[a.t]
  const rb = RANK[b.t]
  if (ra !== rb) return ra - rb
  switch (a.t) {
    case 'null':
      return 0
    case 'int':
    case 'uint':
    case 'double':
    case 'decimal':
      return compareNumbers(a, b)
    case 'string':
      return sign(compareBytes(utf8.encode(a.v), utf8.encode((b as typeof a).v)))
    case 'bool':
      return Number(a.v) - Number((b as typeof a).v)
    case 'array': {
      const bv = (b as typeof a).v
      for (let i = 0; i < Math.min(a.v.length, bv.length); i++) {
        const c = compareJson(a.v[i] as JsonDoc, bv[i] as JsonDoc)
        if (c !== 0) return c
      }
      return sign(a.v.length - bv.length)
    }
    case 'object': {
      // Equal only with the same keys and equal values; otherwise an order
      // that is deterministic, which is all MySQL promises.
      const bv = (b as typeof a).v
      if (a.v.length !== bv.length) return sign(a.v.length - bv.length)
      for (let i = 0; i < a.v.length; i++) {
        const [ka, va] = a.v[i] as readonly [string, JsonDoc]
        const [kb, vb] = bv[i] as readonly [string, JsonDoc]
        const k = sign(compareJsonKeys(ka, kb))
        if (k !== 0) return k
        const c = compareJson(va, vb)
        if (c !== 0) return c
      }
      return 0
    }
    case 'date':
    case 'datetime':
    case 'timestamp': {
      const x = temporalKey(a.v)
      const y = temporalKey((b as typeof a).v)
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return sign((x[i] as number) - (y[i] as number))
      return 0
    }
    case 'time':
      return sign(timeKey(a.v) - timeKey((b as typeof a).v))
    case 'opaque': {
      const o = b as typeof a
      return a.field !== o.field ? sign(a.field - o.field) : sign(compareBytes(a.v, o.v))
    }
  }
}

// --- binary ---------------------------------------------------------------------
//
// D-22: a JSON column holds MySQL's binary format, so the codec above (json.ts)
// is the format and this is the mapping onto it. What JSON has no type for is
// custom data: a field type byte and its payload. A DECIMAL's payload is its
// precision, its scale and its binary DECIMAL (`Json_decimal`); a temporal's
// is MySQL's packed int64 (`TIME_to_longlong_*_packed`); anything else is the
// bytes it came with.

/** `FIELD_TYPE`s custom data carries, from `include/field_types.h`. */
const F = { DATE: 10, TIME: 11, DATETIME: 12, TIMESTAMP: 7, NEWDECIMAL: 246 } as const

function packDateTime(v: MysqlDateTime): bigint {
  const ymd = BigInt(((v.year * 13 + v.month) << 5) | v.day)
  const hms = BigInt((v.hour << 12) | (v.minute << 6) | v.second)
  return (((ymd << 17n) | hms) << 24n) + BigInt(v.microsecond)
}

function unpackDateTime(n: bigint): MysqlDateTime {
  const microsecond = Number(n & 0xffffffn)
  const ymdhms = n >> 24n
  const ymd = Number(ymdhms >> 17n)
  const hms = Number(ymdhms & 0x1ffffn)
  const ym = ymd >> 5
  return { year: Math.floor(ym / 13), month: ym % 13, day: ymd & 31, hour: hms >> 12, minute: (hms >> 6) & 63, second: hms & 63, microsecond }
}

function packTime(v: MysqlTime): bigint {
  const hms = BigInt(((v.days * 24 + v.hour) << 12) | (v.minute << 6) | v.second)
  const n = (hms << 24n) + BigInt(v.microsecond)
  return v.negative ? -n : n
}

function unpackTime(packed: bigint): MysqlTime {
  const negative = packed < 0n
  const n = negative ? -packed : packed
  const hms = Number(n >> 24n)
  const hours = hms >> 12
  return { negative, days: Math.floor(hours / 24), hour: hours % 24, minute: (hms >> 6) & 63, second: hms & 63, microsecond: Number(n & 0xffffffn) }
}

function int64Bytes(n: bigint, unsigned = false): Uint8Array {
  const b = new Uint8Array(8)
  if (unsigned) new DataView(b.buffer).setBigUint64(0, n, true)
  else new DataView(b.buffer).setBigInt64(0, n, true)
  return b
}

interface Piece {
  readonly type: number
  /** Out-of-line bytes; empty when inlined. */
  readonly body: Uint8Array
  readonly inline?: number
}

function custom(field: number, payload: Uint8Array): Piece {
  const len = writeVarint(payload.length)
  const body = new Uint8Array(1 + len.length + payload.length)
  body[0] = field
  body.set(len, 1)
  body.set(payload, 1 + len.length)
  return { type: JSON_TYPE.CUSTOM, body }
}

function piece(doc: JsonDoc): Piece {
  switch (doc.t) {
    case 'null':
      return { type: JSON_TYPE.LITERAL, body: new Uint8Array(0), inline: 0 }
    case 'bool':
      return { type: JSON_TYPE.LITERAL, body: new Uint8Array(0), inline: doc.v ? 1 : 2 }
    case 'int': {
      const v = doc.v
      if (v >= -0x8000n && v <= 0x7fffn) return { type: JSON_TYPE.INT16, body: new Uint8Array(0), inline: Number(v) & 0xffff }
      if (v >= -0x80000000n && v <= 0x7fffffffn) {
        const body = new Uint8Array(4)
        new DataView(body.buffer).setInt32(0, Number(v), true)
        return { type: JSON_TYPE.INT32, body, inline: Number(v) >>> 0 }
      }
      return { type: JSON_TYPE.INT64, body: int64Bytes(v) }
    }
    case 'uint':
      return { type: JSON_TYPE.UINT64, body: int64Bytes(doc.v, true) }
    case 'double': {
      const body = new Uint8Array(8)
      new DataView(body.buffer).setFloat64(0, doc.v, true)
      return { type: JSON_TYPE.DOUBLE, body }
    }
    case 'string': {
      const bytes = new TextEncoder().encode(doc.v)
      const len = writeVarint(bytes.length)
      const body = new Uint8Array(len.length + bytes.length)
      body.set(len)
      body.set(bytes, len.length)
      return { type: JSON_TYPE.STRING, body }
    }
    case 'decimal': {
      const text = renderDecimal(doc.v)
      const digits = text.replace(/^-/, '').split('.')
      const intg = Math.max(1, (digits[0] as string).replace(/^0+(?=.)/, '').length)
      const precision = Math.min(65, intg + doc.v.scale)
      const bin = encodeDecimal(text, precision, doc.v.scale)
      const payload = new Uint8Array(2 + bin.length)
      payload[0] = precision
      payload[1] = doc.v.scale
      payload.set(bin, 2)
      return custom(F.NEWDECIMAL, payload)
    }
    case 'date':
      return custom(F.DATE, int64Bytes(packDateTime(doc.v)))
    case 'datetime':
      return custom(F.DATETIME, int64Bytes(packDateTime(doc.v)))
    case 'timestamp':
      return custom(F.TIMESTAMP, int64Bytes(packDateTime(doc.v)))
    case 'time':
      return custom(F.TIME, int64Bytes(packTime(doc.v)))
    case 'opaque':
      return custom(doc.field, doc.v)
    case 'array':
      return container(doc.v.map((v) => [undefined, v] as const), false)
    case 'object':
      return container(doc.v, true)
  }
}

/**
 * A container: small unless its bytes cannot be addressed in 16 bits, then
 * large. Widths are per container, so each child has chosen its own already.
 */
function container(members: readonly (readonly [string | undefined, JsonDoc])[], isObject: boolean): Piece {
  const keys = isObject ? members.map(([k]) => utf8.encode(k as string)) : []
  const pieces = members.map(([, v]) => piece(v))
  const small = layout(keys, pieces, false)
  if (small !== undefined) return { type: isObject ? JSON_TYPE.SMALL_OBJECT : JSON_TYPE.SMALL_ARRAY, body: small }
  return { type: isObject ? JSON_TYPE.LARGE_OBJECT : JSON_TYPE.LARGE_ARRAY, body: layout(keys, pieces, true) as Uint8Array }
}

/** A container's bytes: header, key entries for an object, value entries, keys, then out-of-line values; undefined when too large for a small one. */
function layout(keys: readonly Uint8Array[], pieces: readonly Piece[], large: boolean): Uint8Array | undefined {
  const w = large ? 4 : 2
  const isObject = keys.length > 0
  let cursor = 2 * w + (isObject ? pieces.length * (w + 2) : 0) + pieces.length * (1 + w)
  const keyAt = keys.map((k) => {
    const at = cursor
    cursor += k.length
    return at
  })
  const valueAt = pieces.map((p) => {
    if (isInlined(p.type, large)) return -1
    const at = cursor
    cursor += p.body.length
    return at
  })
  if (!large && cursor > 0xffff) return undefined
  const out = new Uint8Array(cursor)
  const view = new DataView(out.buffer)
  const put = (at: number, v: number): void => (large ? view.setUint32(at, v, true) : view.setUint16(at, v, true))
  put(0, pieces.length)
  put(w, cursor)
  let at = 2 * w
  keys.forEach((k, i) => {
    put(at, keyAt[i] as number)
    view.setUint16(at + w, k.length, true)
    out.set(k, keyAt[i] as number)
    at += w + 2
  })
  pieces.forEach((p, i) => {
    out[at] = p.type
    const v = valueAt[i] as number
    if (v < 0) put(at + 1, p.inline ?? 0)
    else {
      put(at + 1, v)
      out.set(p.body, v)
    }
    at += 1 + w
  })
  return out
}

/** A JSON value as MySQL's binary JSON (D-22). */
export function encodeJsonDoc(doc: JsonDoc): Uint8Array {
  const p = piece(doc)
  if (isInlined(p.type, false)) {
    // A bare scalar document has no entry to inline into: its value follows the type byte.
    const out = new Uint8Array(p.type === JSON_TYPE.LITERAL ? 2 : 3)
    out[0] = p.type
    if (p.type === JSON_TYPE.LITERAL) out[1] = p.inline ?? 0
    else new DataView(out.buffer).setUint16(1, p.inline ?? 0, true)
    return out
  }
  const out = new Uint8Array(1 + p.body.length)
  out[0] = p.type
  out.set(p.body, 1)
  return out
}

/** MySQL's binary JSON as a value. */
export function decodeJsonDoc(bytes: Uint8Array): JsonDoc {
  if (bytes.length === 0) throw invalidJson('empty document')
  return decodeAt(bytes[0] as number, bytes.subarray(1), false)
}

function need(b: Uint8Array, at: number, n: number): void {
  if (at < 0 || at + n > b.length) throw invalidJson(`needs ${n} byte(s) at ${at} of ${b.length}`)
}

function decodeAt(type: number, body: Uint8Array, inEntryOfLarge: boolean | undefined): JsonDoc {
  void inEntryOfLarge
  const view = (n: number): DataView => {
    need(body, 0, n)
    return new DataView(body.buffer, body.byteOffset, n)
  }
  switch (type) {
    case JSON_TYPE.SMALL_OBJECT:
    case JSON_TYPE.LARGE_OBJECT:
    case JSON_TYPE.SMALL_ARRAY:
    case JSON_TYPE.LARGE_ARRAY:
      return decodeContainer(body, type === JSON_TYPE.LARGE_OBJECT || type === JSON_TYPE.LARGE_ARRAY, type <= JSON_TYPE.LARGE_OBJECT)
    case JSON_TYPE.LITERAL:
      need(body, 0, 1)
      return body[0] === 0 ? JSON_NULL : body[0] === 1 ? JSON_TRUE : body[0] === 2 ? JSON_FALSE : invalidLiteral(body[0] as number)
    case JSON_TYPE.INT16:
      return { t: 'int', v: BigInt(view(2).getInt16(0, true)) }
    case JSON_TYPE.UINT16:
      return { t: 'int', v: BigInt(view(2).getUint16(0, true)) }
    case JSON_TYPE.INT32:
      return { t: 'int', v: BigInt(view(4).getInt32(0, true)) }
    case JSON_TYPE.UINT32:
      return { t: 'int', v: BigInt(view(4).getUint32(0, true)) }
    case JSON_TYPE.INT64:
      return { t: 'int', v: view(8).getBigInt64(0, true) }
    case JSON_TYPE.UINT64:
      return jsonInteger(view(8).getBigUint64(0, true))
    case JSON_TYPE.DOUBLE:
      return { t: 'double', v: view(8).getFloat64(0, true) }
    case JSON_TYPE.STRING: {
      const { value: n, size } = varint(body, 0)
      need(body, size, n)
      return { t: 'string', v: new TextDecoder().decode(body.subarray(size, size + n)) }
    }
    case JSON_TYPE.CUSTOM: {
      need(body, 0, 1)
      const field = body[0] as number
      const { value: n, size } = varint(body, 1)
      need(body, 1 + size, n)
      const payload = body.subarray(1 + size, 1 + size + n)
      const packed = (): bigint => {
        need(payload, 0, 8)
        return new DataView(payload.buffer, payload.byteOffset, 8).getBigInt64(0, true)
      }
      switch (field) {
        case F.NEWDECIMAL: {
          need(payload, 0, 2)
          const precision = payload[0] as number
          const scale = payload[1] as number
          const text = decodeDecimal(payload.subarray(2), precision, scale)
          return { t: 'decimal', v: parseDecimal(text) }
        }
        case F.DATE:
          return { t: 'date', v: unpackDateTime(packed()) }
        case F.DATETIME:
          return { t: 'datetime', v: unpackDateTime(packed()) }
        case F.TIMESTAMP:
          return { t: 'timestamp', v: unpackDateTime(packed()) }
        case F.TIME:
          return { t: 'time', v: unpackTime(packed()) }
        default:
          return { t: 'opaque', field, v: payload.slice() }
      }
    }
    default:
      throw invalidJson(`type 0x${type.toString(16)} is not a JSON type`)
  }
}

function invalidLiteral(b: number): never {
  throw invalidJson(`literal 0x${b.toString(16)} is not null, true or false`)
}

function decodeContainer(c: Uint8Array, large: boolean, isObject: boolean): JsonDoc {
  const w = large ? 4 : 2
  need(c, 0, 2 * w)
  const v = new DataView(c.buffer, c.byteOffset, c.length)
  const get = (at: number): number => {
    need(c, at, w)
    return large ? v.getUint32(at, true) : v.getUint16(at, true)
  }
  const count = get(0)
  const entry = (at: number): JsonDoc => {
    need(c, at, 1 + w)
    const type = c[at] as number
    if (isInlined(type, large)) {
      const raw = get(at + 1)
      const tmp = new Uint8Array(4)
      new DataView(tmp.buffer).setUint32(0, raw, true)
      return decodeAt(type, tmp, large)
    }
    const offset = get(at + 1)
    if (offset >= c.length) throw invalidJson(`value offset ${offset} past a ${c.length}-byte container`)
    return decodeAt(type, c.subarray(offset), large)
  }
  if (!isObject) {
    const items: JsonDoc[] = []
    for (let i = 0; i < count; i++) items.push(entry(2 * w + i * (1 + w)))
    return { t: 'array', v: items }
  }
  const members: [string, JsonDoc][] = []
  const values = 2 * w + count * (w + 2)
  for (let i = 0; i < count; i++) {
    const keyEntry = 2 * w + i * (w + 2)
    const keyAt = get(keyEntry)
    need(c, keyEntry + w, 2)
    const keyLength = v.getUint16(keyEntry + w, true)
    need(c, keyAt, keyLength)
    members.push([new TextDecoder().decode(c.subarray(keyAt, keyAt + keyLength)), entry(values + i * (1 + w))])
  }
  return { t: 'object', v: members }
}

/**
 * A key on which two values are equal exactly when `compareJson` says so:
 * `1`, `1.0` and `1.00` are one key, as are two objects with the same members.
 * What DISTINCT and GROUP BY group by.
 */
export function jsonKey(doc: JsonDoc): string {
  switch (doc.t) {
    case 'int':
    case 'uint':
    case 'decimal':
    case 'double': {
      const text = doc.t === 'double' ? (Object.is(doc.v, -0) ? '0' : String(doc.v)) : doc.t === 'decimal' ? renderDecimal(doc.v) : doc.v.toString()
      // Exact where the value is exact; a double compares with an integer by value.
      const n = doc.t === 'double' ? Number(text) : undefined
      const plain = n !== undefined && Number.isInteger(n) && Math.abs(n) < 2 ** 63 ? BigInt(n).toString() : text
      return `n${plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain}`.replace(/^n-0$/, 'n0')
    }
    case 'array':
      return `[${doc.v.map(jsonKey).join(',')}]`
    case 'object':
      return `{${doc.v.map(([k, v]) => `${quoteJsonString(k)}:${jsonKey(v)}`).join(',')}}`
    default:
      return `${doc.t}:${renderJson(doc)}`
  }
}

/**
 * A SQL value as JSON, knowing only the value: what a comparison with a JSON
 * value converts its other side to. A string is a JSON string, never parsed
 * (`doc = 'x'` compares with `"x"`); a binary string is opaque, as a VARCHAR's
 * bytes. The executor, knowing the type, refines this for a boolean and for a
 * binary column's own field type.
 */
export function toJsonDoc(v: Exclude<Value, null>): JsonDoc {
  switch (v.kind) {
    case 'json':
      return v.v
    case 'int':
      return v.unsigned ? { t: v.v > INT64_MAX ? 'uint' : 'int', v: v.v } : { t: 'int', v: v.v }
    case 'decimal':
      return { t: 'decimal', v }
    case 'double':
      return { t: 'double', v: v.v }
    case 'string':
      return { t: 'string', v: v.v }
    case 'bytes':
      return { t: 'opaque', field: 15, v: v.v }
    case 'datetime':
      return { t: v.type === 'DATE' ? 'date' : v.type === 'TIMESTAMP' ? 'timestamp' : 'datetime', v: v.v }
    case 'time':
      return { t: 'time', v: v.v }
  }
}

/**
 * MySQL's order of two JSON values in a sort — ORDER BY, and a sort-based
 * GROUP BY — which is not `compareJson`: the sort key of an array or an
 * object holds only its type and its number of members, so `[false]` sorts
 * before `[{}, 1, true]` and two one-member objects tie, keeping their input
 * order (8.4.11, M5.21). Scalars sort as they compare.
 */
export function orderJson(a: JsonDoc, b: JsonDoc): number {
  if ((a.t === 'array' || a.t === 'object') && a.t === b.t) return sign(a.v.length - (b as typeof a).v.length)
  return compareJson(a, b)
}
