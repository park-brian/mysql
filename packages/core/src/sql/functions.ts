// M5.10 — the string and numeric slices of the function library: SUBSTRING,
// SUBSTR, MID, LEFT, RIGHT, LPAD, RPAD, REPEAT, REVERSE, LOCATE, INSTR,
// POSITION, TRIM, LTRIM, RTRIM, REPLACE, CONCAT_WS, SPACE, ASCII; ROUND,
// FLOOR, CEIL, CEILING, TRUNCATE, SIGN, GREATEST and LEAST.
//
// Written against `tools/capture-functions.mjs`'s corpus, captured from 8.4.11
// first. The rules it holds them to:
//
//   - A string function's result takes its first argument's collation, or
//     the connection's for a number, and is binary when that argument is.
//     The other arguments are converted to it. Lengths count characters, and
//     a binary string's bytes. Every one may be NULL, whatever its arguments.
//   - Its width is the first argument's, narrowed by a constant position or
//     length (`SUBSTRING(s, 3)`, `LEFT(s, 2)`), widened by a constant count
//     (`REPEAT`, `LPAD`), or unbounded (a LONGBLOB's width) when the count is
//     not a constant. REPLACE's is the subject's times the replacement's
//     length less one; CONCAT_WS's the separator's for each gap plus each
//     argument's.
//   - A position or count is an integer as `val_int` reads one: a decimal
//     rounds half away from zero, and BIGINT UNSIGNED's largest value is
//     larger than every string.
//   - LOCATE, INSTR and POSITION compare in the two strings' aggregated
//     collation, so `LOCATE('A', 'abc')` is 1 in a `_ci` one. TRIM and
//     REPLACE match bytes exactly, whatever the collation.
//   - ROUND, TRUNCATE, FLOOR and CEIL keep an integer an integer and a
//     decimal a decimal, with the precision `Item_func_round` and
//     `Item_func_int_val` give it; anything else is a DOUBLE. A double rounds
//     half to even, as `rint` does; an integer or a decimal half away from zero.
//   - GREATEST and LEAST take the type CASE would, and compare in it.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { decodeCollation, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { messages, sqlError } from '@myjs/protocol'
import {
  COERCIBILITY,
  bytesValue,
  compareValues,
  decimalValue,
  doubleValue,
  intValue,
  rescale,
  stringValue,
  toDecimal,
  toDouble,
  toInteger,
  toText,
  valInt,
  type DecimalValue,
  type Value,
  type Condition,
} from '@myjs/types'
import { aggregate, aggregateTypes, asNumber, coercibilityOf, convertTo, raise, type Compiled, type CompileContext, type Env } from './compile.ts'
import { charWidth, decimalType, doubleType, intType, stringType, type ResultType } from './meta.ts'

type V = Exclude<Value, null>

/** `MAX_BLOB_WIDTH` (`include/mysql_com.h`): the characters a string result whose width no constant bounds is given. */
const MAX_BLOB_WIDTH = 16_777_216
const INT_MAX32 = 2147483647n
const INT_MIN32 = -2147483648n

/** `val_int` of a position or count: BIGINT UNSIGNED's values above 2⁶³ stay positive. */
/** A count or a position, as `val_int` reads it: text stops at its first non-digit. */
const intArg = (v: V): bigint => valInt(v)

/** A constant argument's integer value: `null` for a constant NULL, `undefined` for an argument that is not constant. */
function constantInt(c: Compiled | undefined, constant: boolean, conditions?: Condition[]): bigint | null | undefined {
  if (c === undefined || !constant) return undefined
  try {
    // Resolving reads the constant once, and warns once for it, as
    // `resolve_type`'s `val_int` does: `LEFT('abc', 'z')` warns twice (8.4.11).
    const v = c.eval([], { params: [], now: new Date(0), session: undefined as never, state: undefined as never, ...(conditions === undefined ? {} : { conditions }) })
    return v === null ? null : intArg(v)
  } catch {
    return undefined
  }
}

/** A string operand as the function sees it: text in the result's collation, or bytes when the result is binary. */
interface Str {
  readonly binary: boolean
  /** Code points, or bytes as Latin-1 code units for a binary result. */
  readonly units: readonly string[]
}

function strOf(v: V, binary: boolean, collation: number): Str {
  if (binary) {
    const b = v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v))
    return { binary, units: Array.from(b, (x) => String.fromCharCode(x)) }
  }
  const text = v.kind === 'bytes' ? asText(v.v, collation) : v.kind === 'string' ? converted(v.v, v.collationId, collation) : toText(v)
  return { binary, units: [...text] }
}

/** Text moved into another character set: 3854 when a character has no place there (8.4.11). */
function converted(text: string, from: number, to: number): string {
  const a = requireCollationInfo(from).charset
  const b = requireCollationInfo(to).charset
  if (a === b || b.startsWith('utf8mb4')) return text
  const back = decodeCollation(encodeCollation(text, to), to)
  if (back !== text) {
    const shown = Array.from(encodeCollation(text, from).slice(0, 16), (x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : `\\x${x.toString(16).toUpperCase().padStart(2, '0')}`)).join('')
    throw sqlError('ER_CANNOT_CONVERT_STRING', `Cannot convert string '${shown}' from ${a} to ${b}`)
  }
  return text
}

/** A binary string read in a character set: 3854 when its bytes are not text there (8.4.11). */
function asText(bytes: Uint8Array, collation: number): string {
  const text = decodeCollation(bytes, collation)
  const back = encodeCollation(text, collation)
  if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) {
    const shown = Array.from(bytes.slice(0, 16), (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('')
    throw sqlError('ER_CANNOT_CONVERT_STRING', `Cannot convert string '${shown}' from binary to ${requireCollationInfo(collation).charset}`)
  }
  return text
}

function result(units: readonly string[], binary: boolean, collation: number, coercibility: number): Value {
  if (binary) return bytesValue(Uint8Array.from(units, (u) => u.charCodeAt(0)))
  return stringValue(units.join(''), collation, coercibility)
}

/** The collation a string function's first argument gives its result: NULL's is binary. */
function firstCollation(t: ResultType, conn: number): { readonly binary: boolean; readonly collation: number; readonly coercibility: number } {
  if (t.kind === 'bytes' || t.kind === 'null') return { binary: true, collation: CHARSET_BINARY, coercibility: coercibilityOf(t) }
  if (t.kind === 'string') return { binary: false, collation: t.collationId, coercibility: coercibilityOf(t) }
  return { binary: false, collation: conn, coercibility: COERCIBILITY.NUMERIC }
}

/**
 * A string result `chars` wide (bytes, for a binary one): `MAX_BLOB_WIDTH`
 * when `chars` is `undefined`. `capped` is `set_data_type_string`'s 64-bit
 * form, which holds the bytes to `MAX_BLOB_WIDTH`; the 32-bit form does not.
 * Past 65,535 bytes it is a MEDIUMTEXT, past 16,777,215 a LONGTEXT, which
 * report their width in bytes (8.4.11: `TRIM(t)` of a TEXT is 250, 1,048,560).
 */
function textType(chars: number | undefined, binary: boolean, collation: number, coercibility: number, capped = false): ResultType {
  const mb = binary ? 1 : requireCollationInfo(collation).mbmaxlen
  let width = chars === undefined ? MAX_BLOB_WIDTH : chars
  if (capped && width * mb > MAX_BLOB_WIDTH) width = Math.floor(MAX_BLOB_WIDTH / mb)
  const bytes = width * mb
  const t = stringType(width, binary ? CHARSET_BINARY : collation, true)
  if (bytes <= 65_535) return binary ? t : { ...t, coercibility }
  const field = bytes > 16_777_215 ? FIELD_TYPE.LONG_BLOB : FIELD_TYPE.MEDIUM_BLOB
  return binary ? { ...t, field } : { ...t, field, coercibility, blobBytes: bytes }
}

/** An argument's width in characters, or in bytes for a binary result; a TEXT's is its byte capacity, as a field's `max_char_length` is. */
function widthOf(t: ResultType, binary: boolean): number {
  const chars = t.kind === 'string' && t.blobBytes !== undefined ? t.blobBytes : charWidth(t)
  return binary && t.kind === 'string' ? chars * requireCollationInfo(t.collationId).mbmaxlen : chars
}

/** The collation several string arguments aggregate to: a binary one wins only at the lowest coercibility. */
function aggregateString(types: readonly ResultType[], conn: number): { readonly binary: boolean; readonly collation: number; readonly coercibility: number } {
  const live = types.filter((t) => t.kind === 'string' || t.kind === 'bytes')
  if (live.length === 0) return { binary: false, collation: conn, coercibility: COERCIBILITY.NUMERIC }
  const least = Math.min(...live.map(coercibilityOf))
  if (live.some((t) => t.kind === 'bytes' && coercibilityOf(t) === least)) return { binary: true, collation: CHARSET_BINARY, coercibility: least }
  return { binary: false, collation: aggregateTypes(live, conn), coercibility: least }
}

/** Every argument evaluated; `undefined` when one is NULL. */
function all(xs: readonly Compiled[], r: Parameters<Compiled['eval']>[0], env: Parameters<Compiled['eval']>[1]): V[] | undefined {
  const out: V[] = []
  for (const x of xs) {
    const v = x.eval(r, env)
    if (v === null) return undefined
    out.push(v)
  }
  return out
}

/** A word the index of a substring search compares by: folded as the collation folds. */
function folder(collation: number, binary: boolean): (s: string) => string {
  if (binary) return (s) => s
  const name = requireCollationInfo(collation).name
  if (!name.endsWith('_ci')) return (s) => s
  const ai = name.includes('_ai_') || (!name.includes('_as_') && !name.includes('0900'))
  return (s) => (ai ? s.normalize('NFD').replace(/\p{M}/gu, '') : s).toLowerCase()
}

/** The 1-based character position of `needle` in `hay` from `start` (0-based), or 0. */
function locate(hay: readonly string[], needle: readonly string[], start: number, fold: (s: string) => string): number {
  if (start < 0 || start > hay.length) return 0
  if (needle.length === 0) return start + 1
  const h = hay.map(fold)
  const n = needle.map(fold)
  for (let i = start; i + n.length <= h.length; i++) if (n.every((c, k) => h[i + k] === c)) return i + 1
  return 0
}

const startsWith = (s: readonly string[], p: readonly string[], at: number) => p.every((c, k) => s[at + k] === c)

/**
 * A string or numeric function by name, or `undefined` for another name. `e`
 * gives the call's text for its arity error and its arguments' constness.
 */
const READS_DOUBLE: ReadonlySet<string> = new Set(['FLOOR', 'CEIL', 'CEILING', 'ROUND', 'TRUNCATE', 'SIGN'])

/** The arguments that are counts and positions, read as integers (1292 "INTEGER"). */
const READS_INTEGER: Readonly<Record<string, readonly number[]>> = { SUBSTRING: [1, 2], SUBSTR: [1, 2], MID: [1, 2], LEFT: [1], RIGHT: [1], LPAD: [1], RPAD: [1], REPEAT: [1], SPACE: [0] }

/** `max_allowed_packet`: the largest string LPAD, RPAD, REPEAT and SPACE build. */
function maxPacket(env: Env): number {
  const v = env.state.systemVariable('max_allowed_packet', undefined, env.session)
  return v === undefined || v === null ? 67_108_864 : Number(toInteger(v))
}

/** A result too large to build: NULL, and 1301 naming the function (8.4.11). */
function packetOverflow(env: Env, name: string): null {
  raise(env, 1301, `Result of ${name.toLowerCase()}() was larger than max_allowed_packet (${maxPacket(env)}) - truncated`)
  return null
}

/** A string's bytes in its charset, as the packet check counts them. */
function byteLength(units: readonly string[], binary: boolean, collation: number): number {
  return binary ? units.length : encodeCollation(units.join(''), collation).length
}

export function libraryFunction(name: string, args: readonly Compiled[], callName: string, constant: readonly boolean[], ctx: CompileContext): Compiled | undefined {
  // The numeric functions read text as a double, warning as they go (1292).
  const integers = READS_INTEGER[name]
  const xs = READS_DOUBLE.has(name) && args[0] !== undefined ? [asNumber(args[0], 'DOUBLE'), ...args.slice(1)] : integers !== undefined ? args.map((a, i) => (integers.includes(i) ? asNumber(a, 'INTEGER') : a)) : args
  const conn = ctx.connectionCollation
  const arity = (min: number, max = min) => {
    if (xs.length < min || xs.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${callName}'`)
  }
  const first = () => firstCollation((xs[0] as Compiled).type, conn)
  switch (name) {
    case 'SUBSTRING':
    case 'SUBSTR':
    case 'MID': {
      arity(2, 3)
      const { binary, collation, coercibility } = first()
      // `Item_func_substr::resolve_type`: a constant position narrows the width
      // (position 0 to nothing, as its unsigned arithmetic has it), then a
      // constant length; a NULL one leaves it whole.
      let width = widthOf((xs[0] as Compiled).type, binary)
      const start = constantInt(xs[1], constant[1] === true, ctx.conditions)
      if (start !== null) {
        if (start !== undefined && start > INT_MIN32 && start <= INT_MAX32) width = start < 0n ? (-start > BigInt(width) ? 0 : Number(-start)) : start === 0n ? 0 : width - Math.min(Number(start) - 1, width)
        const length = constantInt(xs[2], constant[2] === true, ctx.conditions)
        if (length !== null && length !== undefined) width = length < 0n ? 0 : length <= INT_MAX32 ? Math.min(width, Number(length)) : width
      }
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const s = strOf(v[0] as V, binary, collation).units
          const empty = result([], binary, collation, coercibility)
          let from = intArg(v[1] as V)
          const len = v[2] === undefined ? INT_MAX32 : intArg(v[2])
          if (len <= 0n) return empty
          if (from < INT_MIN32 || from > INT_MAX32) return empty
          from = from < 0n ? BigInt(s.length) + from : from - 1n
          if (from < 0n || from + 1n > BigInt(s.length)) return empty
          return result(s.slice(Number(from), Number(from) + Number(len < BigInt(s.length) ? len : BigInt(s.length))), binary, collation, coercibility)
        },
        type: textType(width, binary, collation, coercibility),
      }
    }
    case 'LEFT':
    case 'RIGHT': {
      arity(2)
      const { binary, collation, coercibility } = first()
      let width = widthOf((xs[0] as Compiled).type, binary)
      const n = constantInt(xs[1], constant[1] === true, ctx.conditions)
      if (n !== undefined && n !== null) width = n < 0n ? 0 : n <= INT_MAX32 ? Math.min(width, Number(n)) : width
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const s = strOf(v[0] as V, binary, collation).units
          const count = intArg(v[1] as V)
          if (count <= 0n) return result([], binary, collation, coercibility)
          const k = count >= BigInt(s.length) ? s.length : Number(count)
          return result(name === 'LEFT' ? s.slice(0, k) : s.slice(s.length - k), binary, collation, coercibility)
        },
        type: textType(width, binary, collation, coercibility),
      }
    }
    case 'LPAD':
    case 'RPAD': {
      arity(3)
      const { binary, collation, coercibility } = first()
      const n = constantInt(xs[1], constant[1] === true, ctx.conditions)
      // `val_uint`: a negative count is a huge one.
      const width = n === undefined || n === null ? undefined : Number(n > INT_MAX32 || n < 0n ? INT_MAX32 : n)
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const s = strOf(v[0] as V, binary, collation).units
          const count = intArg(v[1] as V)
          if (count < 0n) return null
          // A count past INT_MAX32 is INT_MAX32, and a result past
          // max_allowed_packet is NULL with 1301 — checked before it is built.
          const k = Number(count > INT_MAX32 ? INT_MAX32 : count)
          if (k <= s.length) return result(s.slice(0, k), binary, collation, coercibility)
          if (byteLength(s, binary, collation) + (k - s.length) * (binary ? 1 : requireCollationInfo(collation).mbmaxlen) > maxPacket(env)) return packetOverflow(env, name)
          const pad = strOf(v[2] as V, binary, collation).units
          if (pad.length === 0) return result([], binary, collation, coercibility)
          const fill: string[] = []
          while (fill.length < k - s.length) fill.push(pad[fill.length % pad.length] as string)
          return result(name === 'LPAD' ? [...fill, ...s] : [...s, ...fill], binary, collation, coercibility)
        },
        type: textType(width, binary, collation, coercibility, width !== undefined),
      }
    }
    case 'REPEAT': {
      arity(2)
      const { binary, collation, coercibility } = first()
      const n = constantInt(xs[1], constant[1] === true, ctx.conditions)
      const width = n === undefined || n === null ? undefined : n === 0n ? 0 : widthOf((xs[0] as Compiled).type, binary) * Number(n > INT_MAX32 || n < 0n ? INT_MAX32 : n)
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const s = strOf(v[0] as V, binary, collation).units
          const count = intArg(v[1] as V)
          if (count <= 0n || s.length === 0) return result([], binary, collation, coercibility)
          if (BigInt(byteLength(s, binary, collation)) * (count > INT_MAX32 ? INT_MAX32 : count) > BigInt(maxPacket(env))) return packetOverflow(env, name)
          return result(Array.from({ length: Number(count) }, () => s).flat(), binary, collation, coercibility)
        },
        type: textType(width, binary, collation, coercibility, width !== undefined),
      }
    }
    case 'REVERSE':
    case 'LTRIM':
    case 'RTRIM': {
      arity(1)
      const { binary, collation, coercibility } = first()
      return {
        eval: (r, env) => {
          const v = (xs[0] as Compiled).eval(r, env)
          if (v === null) return null
          const s = [...strOf(v, binary, collation).units]
          if (name === 'REVERSE') return result(s.reverse(), binary, collation, coercibility)
          let a = 0
          let b = s.length
          if (name === 'LTRIM') while (a < b && s[a] === ' ') a++
          else while (b > a && s[b - 1] === ' ') b--
          return result(s.slice(a, b), binary, collation, coercibility)
        },
        type: textType(widthOf((xs[0] as Compiled).type, binary), binary, collation, coercibility),
      }
    }
    case 'TRIM': {
      // TRIM(s), TRIM(r FROM s) as (r, s), TRIM(side [r] FROM s) as (side, [r,] s).
      arity(1, 3)
      const side = (xs[0] as Compiled & { keyword?: string }).keyword
      const subject = xs[xs.length - 1] as Compiled
      const remove = side === undefined ? (xs.length === 2 ? xs[0] : undefined) : xs.length === 3 ? xs[1] : undefined
      const { binary, collation, coercibility } = firstCollation(subject.type, conn)
      const leading = side !== 'TRAILING'
      const trailing = side !== 'LEADING'
      return {
        eval: (r, env) => {
          const v = subject.eval(r, env)
          if (v === null) return null
          const rv = remove === undefined ? undefined : remove.eval(r, env)
          if (rv === null) return null
          const s = strOf(v, binary, collation).units
          const rm = rv === undefined ? [' '] : strOf(rv, binary, collation).units
          if (rm.length === 0) return result(s, binary, collation, coercibility)
          let a = 0
          let b = s.length
          if (leading) while (b - a >= rm.length && startsWith(s, rm, a)) a += rm.length
          if (trailing) while (b - a >= rm.length && startsWith(s, rm, b - rm.length)) b -= rm.length
          return result(s.slice(a, b), binary, collation, coercibility)
        },
        type: textType(widthOf(subject.type, binary), binary, collation, coercibility),
      }
    }
    case 'REPLACE': {
      arity(3)
      const { binary, collation, coercibility } = first()
      const subjectWidth = widthOf((xs[0] as Compiled).type, binary)
      const replacement = widthOf((xs[2] as Compiled).type, binary)
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const s = strOf(v[0] as V, binary, collation).units
          const from = strOf(v[1] as V, binary, collation).units
          const to = strOf(v[2] as V, binary, collation).units
          if (from.length === 0) return result(s, binary, collation, coercibility)
          const out: string[] = []
          for (let i = 0; i < s.length; ) {
            if (i + from.length <= s.length && startsWith(s, from, i)) {
              out.push(...to)
              i += from.length
            } else out.push(s[i++] as string)
          }
          return result(out, binary, collation, coercibility)
        },
        type: textType(replacement > 1 ? subjectWidth * (replacement - 1) : subjectWidth, binary, collation, coercibility, true),
      }
    }
    case 'CONCAT_WS': {
      arity(2, Infinity)
      const { binary, collation, coercibility } = aggregateString(
        xs.map((x) => x.type),
        conn,
      )
      const width = widthOf((xs[0] as Compiled).type, binary) * (xs.length - 2) + xs.slice(1).reduce((n, x) => n + widthOf(x.type, binary), 0)
      return {
        eval: (r, env) => {
          const sep = (xs[0] as Compiled).eval(r, env)
          if (sep === null) return null
          const parts: string[][] = []
          for (const x of xs.slice(1)) {
            const v = x.eval(r, env)
            if (v !== null) parts.push([...strOf(v, binary, collation).units])
          }
          const s = strOf(sep, binary, collation).units
          return result(parts.flatMap((p, i) => (i === 0 ? p : [...s, ...p])), binary, collation, coercibility)
        },
        type: textType(width, binary, collation, coercibility, true),
      }
    }
    case 'SPACE': {
      arity(1)
      const n = constantInt(xs[0], constant[0] === true, ctx.conditions)
      const width = constant[0] === true ? (n === undefined || n === null || n < 0n ? 0 : Number(n > INT_MAX32 ? INT_MAX32 : n)) : undefined
      return {
        eval: (r, env) => {
          const v = (xs[0] as Compiled).eval(r, env)
          if (v === null) return null
          const count = intArg(v)
          if (count <= 0n) return stringValue('', conn, COERCIBILITY.COERCIBLE)
          if ((count > INT_MAX32 ? INT_MAX32 : count) * BigInt(requireCollationInfo(conn).mbminlen) > BigInt(maxPacket(env))) return packetOverflow(env, name)
          return stringValue(' '.repeat(Number(count)), conn, COERCIBILITY.COERCIBLE)
        },
        type: textType(width, false, conn, COERCIBILITY.COERCIBLE, width !== undefined),
      }
    }
    case 'ASCII': {
      arity(1)
      const x = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          const b = v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v))
          return intValue(BigInt(b[0] ?? 0))
        },
        type: intType(3, x.type.nullable),
      }
    }
    case 'LOCATE':
    case 'POSITION':
    case 'INSTR': {
      if (name === 'LOCATE') arity(2, 3)
      else arity(2)
      // INSTR(str, substr) is LOCATE(substr, str).
      const [needle, hay] = (name === 'INSTR' ? [xs[1], xs[0]] : [xs[0], xs[1]]) as [Compiled, Compiled]
      // The string searched decides: a binary needle in text is converted to
      // it, 3854 if its bytes are not text there (8.4.11).
      const { binary, collation } = firstCollation(hay.type, conn)
      const fold = folder(collation, binary)
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const [n, h] = name === 'INSTR' ? [v[1] as V, v[0] as V] : [v[0] as V, v[1] as V]
          const start = v[2] === undefined ? 0n : intArg(v[2]) - 1n
          const hs = strOf(h, binary, collation).units
          if (start < 0n || start > BigInt(hs.length)) return intValue(0n)
          const ns = strOf(n, binary, collation).units
          // An empty needle is found where the search starts, counted in bytes
          // as the server counts it (8.4.11: LOCATE('', 'ÄÖ', 2) is 3).
          if (ns.length === 0) return intValue(BigInt((binary ? Number(start) : encodeCollation(hs.slice(0, Number(start)).join(''), collation).length) + 1))
          return intValue(BigInt(locate(hs, ns, Number(start), fold)))
        },
        type: intType(11, xs.some((x) => x.type.nullable)),
      }
    }

    // --- numeric ---------------------------------------------------------------------

    case 'FLOOR':
    case 'CEIL':
    case 'CEILING': {
      arity(1)
      const x = xs[0] as Compiled
      const up = name !== 'FLOOR'
      const t = x.type
      if (t.kind === 'int') return { eval: (r, env) => x.eval(r, env), type: { ...intType(21, t.nullable, t.unsigned), unsigned: t.unsigned } }
      if (t.kind === 'decimal') {
        const precision = Math.min(65, t.length - t.scale + (t.scale !== 0 ? 1 : 0))
        const asInt = precision + 1 < 18 - 2 || precision < 18 - 2
        const type = decimalType(precision, 0, t.nullable)
        const small = charWidth(type) < 18 - 2
        return {
          eval: (r, env) => {
            const v = x.eval(r, env)
            if (v === null) return null
            const d = toDecimal(v)
            const q = toWhole(d, up ? 'ceil' : 'floor')
            return small ? intValue(q) : decimalValue(q, 0)
          },
          type: small || asInt ? (small ? intType(21, t.nullable) : type) : type,
        }
      }
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          return doubleValue(up ? Math.ceil(toDouble(v)) : Math.floor(toDouble(v)))
        },
        type: doubleType(t.nullable),
      }
    }
    case 'ROUND':
    case 'TRUNCATE': {
      if (name === 'ROUND') arity(1, 2)
      else arity(2)
      const truncate = name === 'TRUNCATE'
      const x = xs[0] as Compiled
      const places = xs[1]
      const t = x.type
      const nullable = xs.some((c) => c.type.nullable)
      const placesOf = (r: Parameters<Compiled['eval']>[0], env: Parameters<Compiled['eval']>[1]): bigint | null => {
        if (places === undefined) return 0n
        const p = places.eval(r, env)
        return p === null ? null : intArg(p)
      }
      if (t.kind === 'int') {
        return {
          eval: (r, env) => {
            const v = x.eval(r, env)
            const p = placesOf(r, env)
            if (v === null || p === null) return null
            const n = toInteger(v)
            if (p >= 0n) return v.kind === 'int' ? v : intValue(n)
            const unit = p < -20n ? 10n ** 21n : 10n ** -p
            const q = n / unit
            const rem = n % unit
            const away = !truncate && (rem < 0n ? -rem : rem) * 2n >= unit
            return intValue((q + (away ? (n < 0n ? -1n : 1n) : 0n)) * unit, t.unsigned)
          },
          type: { ...intType(21, nullable, t.unsigned) },
        }
      }
      if (t.kind === 'decimal') {
        const fixed = places === undefined ? 0n : constantInt(places, constant[1] === true)
        const wanted = fixed === undefined ? t.scale : fixed === null ? 0 : Number(fixed < -30n ? -30n : fixed > 30n ? 30n : fixed)
        let precision = t.length
        let scale = t.scale
        if (wanted <= 0) {
          precision -= scale
          if (!truncate) precision += 1
          scale = 0
        } else if (wanted < scale) {
          precision -= scale - wanted
          if (!truncate) precision += 1
          scale = wanted
        }
        if (precision === 0) precision = 1
        const type = decimalType(Math.min(65, precision), scale, nullable)
        return {
          eval: (r, env) => {
            const v = x.eval(r, env)
            const p = placesOf(r, env)
            if (v === null || p === null) return null
            const d = toDecimal(v)
            const at = Number(p < -65n ? -65n : p > 30n ? 30n : p)
            const rounded = roundDecimal(d, at, truncate)
            return rescale(rounded, scale)
          },
          type,
        }
      }
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          const p = placesOf(r, env)
          if (v === null || p === null) return null
          return doubleValue(roundDouble(toDouble(v), p, truncate))
        },
        type: doubleType(nullable),
      }
    }
    case 'SIGN': {
      arity(1)
      const x = xs[0] as Compiled
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          const s = v.kind === 'int' ? (v.v > 0n ? 1n : v.v < 0n ? -1n : 0n) : v.kind === 'decimal' ? (v.v > 0n ? 1n : v.v < 0n ? -1n : 0n) : BigInt(Math.sign(toDouble(v)))
          return intValue(s)
        },
        type: intType(21, x.type.nullable),
      }
    }
    case 'GREATEST':
    case 'LEAST': {
      arity(2, Infinity)
      const type = aggregate(
        xs.map((x) => x.type),
        xs.some((x) => x.type.nullable),
        conn,
      )
      const greatest = name === 'GREATEST'
      // Over text and a temporal, the server compares as datetimes and widens
      // the result to six fractional digits by rules not yet captured.
      if ((type.kind === 'string' || type.kind === 'bytes') && xs.some((x) => x.type.kind === 'datetime' || x.type.kind === 'time')) {
        throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`${name} over a string and a temporal value`))
      }
      return {
        eval: (r, env) => {
          const v = all(xs, r, env)
          if (v === undefined) return null
          const as = (x: V): V => (type.kind === 'bytes' ? (x.kind === 'bytes' ? x : bytesValue(x.kind === 'string' ? encodeCollation(x.v, x.collationId) : new TextEncoder().encode(toText(x)))) : (convertTo(x, type) as V))
          let best = as(v[0] as V)
          for (const x of v.slice(1)) {
            const c = as(x)
            const k = compareValues(c, best)
            if (k !== null && (greatest ? k > 0 : k < 0)) best = c
          }
          return best
        },
        type,
      }
    }
    default:
      return undefined
  }
}

/** A decimal's integer part, toward the floor or the ceiling. */
function toWhole(d: DecimalValue, toward: 'floor' | 'ceil'): bigint {
  const unit = 10n ** BigInt(d.scale)
  const q = d.v / unit
  const rem = d.v % unit
  if (rem === 0n) return q
  if (toward === 'floor') return d.v < 0n ? q - 1n : q
  return d.v > 0n ? q + 1n : q
}

/** A decimal rounded (half away from zero) or truncated at `places`, which may be negative. */
function roundDecimal(d: DecimalValue, places: number, truncate: boolean): DecimalValue {
  if (places >= d.scale) return d
  const drop = BigInt(d.scale - places)
  const unit = 10n ** drop
  const q = d.v / unit
  const rem = d.v % unit
  const away = !truncate && (rem < 0n ? -rem : rem) * 2n >= unit
  const whole = q + (away ? (d.v < 0n ? -1n : 1n) : 0n)
  return places >= 0 ? { kind: 'decimal', v: whole, scale: places } : { kind: 'decimal', v: whole * 10n ** BigInt(-places), scale: 0 }
}

/** `my_double_round`: half to even, as `rint`, at `places`, which may be negative. */
function roundDouble(value: number, places: bigint, truncate: boolean): number {
  const negative = places < 0n
  const abs = Number(negative ? -places : places)
  const tmp = 10 ** abs
  const mul = value * tmp
  const div = value / tmp
  if (negative && !Number.isFinite(tmp)) return 0
  if (!negative && !Number.isFinite(mul)) return value
  const rint = (x: number) => {
    const f = Math.floor(x)
    const diff = x - f
    const r = diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1
    // `rint(-0.25)` is -0, which MySQL prints as such.
    return r === 0 && x < 0 ? -0 : r
  }
  if (truncate) {
    if (value >= 0) return negative ? Math.floor(div) * tmp : Math.floor(mul) / tmp
    return negative ? Math.ceil(div) * tmp : Math.ceil(mul) / tmp
  }
  return negative ? rint(div) * tmp : rint(mul) / tmp
}
