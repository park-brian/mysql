// M5.10 — the string functions, and the rounding ones captured beside them:
// SUBSTRING, SUBSTR, MID, LEFT, RIGHT, LPAD, RPAD, REPEAT, REVERSE, LOCATE,
// INSTR, POSITION, TRIM, LTRIM, RTRIM, REPLACE, CONCAT_WS, SPACE, ASCII;
// ROUND, FLOOR, CEIL, CEILING, TRUNCATE, SIGN, GREATEST and LEAST. The second
// slice, and the digests, are at the end.
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
import { CHARSET_BINARY, FIELD_TYPE, expectTyped } from '@myjs/bytes'
import { collationInfoByName, decodeCollation, defaultCollationOf, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { NODE, deparse, type CallNode } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import {
  COERCIBILITY,
  bytesValue,
  compareValues,
  crc32,
  decimalValue,
  doubleValue,
  intValue,
  md5,
  rescale,
  sha1,
  sha256,
  sha512,
  stringValue,
  toDecimal,
  toDouble,
  toInteger,
  toText,
  valInt,
  type Condition,
  type DecimalValue,
  type Value,
} from '@myjs/types'
import { hexOf } from './builtins.ts'
import {
  aggregate,
  aggregateCollations,
  aggregateTypes,
  asNumber,
  coercibilityOf,
  compile,
  constantNode,
  convertTo,
  printedArgument,
  raise,
  warnedText,
  type CompileContext,
  type Compiled,
  type Env,
} from './compile.ts'
import { NULL_TYPE, charWidth, decimalType, doubleType, intType, stringType, type ResultType } from './meta.ts'
import { unregistered } from './registry.ts'

type V = Exclude<Value, null>

/** `MAX_BLOB_WIDTH` (`include/mysql_com.h`): the characters a string result whose width no constant bounds is given. */
const MAX_BLOB_WIDTH = 16_777_216
const INT_MAX32 = 2147483647n
const INT_MIN32 = -2147483648n

/** `val_int` of a position or count: BIGINT UNSIGNED's values above 2⁶³ stay positive. */
/** A count or a position, as `val_int` reads it: text stops at its first non-digit. */
export const intArg = (v: V): bigint => valInt(v)

/** A constant argument's integer value: `null` for a constant NULL, `undefined` for an argument that is not constant. */
function constantInt(c: Compiled | undefined, constant: boolean, conditions?: Condition[]): bigint | null | undefined {
  if (c === undefined || !constant) return undefined
  try {
    // Resolving reads the constant once, and warns once for it, as
    // `resolve_type`'s `val_int` does: `LEFT('abc', 'z')` warns twice (8.4.11).
    const v = c.eval([], { params: [], now: new Date(0), session: undefined as never, state: undefined as never, ...(conditions === undefined ? {} : { conditions }) })
    return v === null ? null : intArg(v)
  } catch (e) {
    expectTyped(e)
    return undefined
  }
}

/** A string operand as the function sees it: text in the result's collation, or bytes when the result is binary. */
export interface Str {
  readonly binary: boolean
  /** Code points, or bytes as Latin-1 code units for a binary result. */
  readonly units: readonly string[]
}

export function strOf(v: V, binary: boolean, collation: number): Str {
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

export function result(units: readonly string[], binary: boolean, collation: number, coercibility: number): Value {
  if (binary) return bytesValue(Uint8Array.from(units, (u) => u.charCodeAt(0)))
  return stringValue(units.join(''), collation, coercibility)
}

/** The collation a string function's first argument gives its result: NULL's is binary. */
export function firstCollation(t: ResultType, conn: number): { readonly binary: boolean; readonly collation: number; readonly coercibility: number } {
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
export function textType(chars: number | undefined, binary: boolean, collation: number, coercibility: number, capped = false): ResultType {
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
export function widthOf(t: ResultType, binary: boolean): number {
  const chars = t.kind === 'string' && t.blobBytes !== undefined ? t.blobBytes : charWidth(t)
  return binary && t.kind === 'string' ? chars * requireCollationInfo(t.collationId).mbmaxlen : chars
}

/** The collation several string arguments aggregate to: a binary one wins only at the lowest coercibility. */
export function aggregateString(types: readonly ResultType[], conn: number): { readonly binary: boolean; readonly collation: number; readonly coercibility: number } {
  const live = types.filter((t) => t.kind === 'string' || t.kind === 'bytes')
  if (live.length === 0) return { binary: false, collation: conn, coercibility: COERCIBILITY.NUMERIC }
  const least = Math.min(...live.map(coercibilityOf))
  if (live.some((t) => t.kind === 'bytes' && coercibilityOf(t) === least)) return { binary: true, collation: CHARSET_BINARY, coercibility: least }
  return { binary: false, collation: aggregateTypes(live, conn), coercibility: least }
}

/** Every argument evaluated; `undefined` when one is NULL. */
export function all(xs: readonly Compiled[], r: Parameters<Compiled['eval']>[0], env: Parameters<Compiled['eval']>[1]): V[] | undefined {
  const out: V[] = []
  for (const x of xs) {
    const v = x.eval(r, env)
    if (v === null) return undefined
    out.push(v)
  }
  return out
}

/** A word the index of a substring search compares by: folded as the collation folds. */
export function folder(collation: number, binary: boolean): (s: string) => string {
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

/** The first slice: the names `libraryFunction` compiles. */
const LIBRARY: ReadonlySet<string> = new Set([
  'SUBSTRING', 'SUBSTR', 'MID', 'LEFT', 'RIGHT', 'LPAD', 'RPAD', 'REPEAT', 'REVERSE', 'LOCATE', 'INSTR', 'POSITION', 'TRIM', 'LTRIM', 'RTRIM',
  'REPLACE', 'CONCAT_WS', 'SPACE', 'ASCII', 'ROUND', 'FLOOR', 'CEIL', 'CEILING', 'TRUNCATE', 'SIGN', 'GREATEST', 'LEAST',
])

function libraryFunction(name: string, args: readonly Compiled[], callName: string, constant: readonly boolean[], ctx: CompileContext): Compiled {
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
      aggregateCollations(
        xs.map((x) => x.type),
        'concat_ws',
        false,
      )
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
      const hay = (name === 'INSTR' ? xs[0] : xs[1]) as Compiled
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
        name.toLowerCase(),
        true,
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
      throw unregistered(name)
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

// --- The second string slice, and the digests -------------------------------
//
// CHAR, FIELD, ELT, MAKE_SET, EXPORT_SET, FIND_IN_SET, INSERT,
// SUBSTRING_INDEX, QUOTE, SOUNDEX, FORMAT, BIT_LENGTH, CONV, TO_BASE64,
// FROM_BASE64, ORD; MD5, SHA1, SHA, SHA2 and CRC32. Written against
// `tools/capture-more-functions.mjs`'s corpus. They keep the rules above (a
// result in its first argument's collation, or the aggregate of the strings
// it chooses among); the digests are `@myjs/types`' (`digest.ts`).

const MORE_STRING_FUNCTIONS: ReadonlySet<string> = new Set([
  'CHAR', 'FIELD', 'ELT', 'MAKE_SET', 'EXPORT_SET', 'FIND_IN_SET', 'INSERT', 'SUBSTRING_INDEX', 'QUOTE', 'SOUNDEX', 'FORMAT', 'BIT_LENGTH',
  'CONV', 'TO_BASE64', 'FROM_BASE64', 'ORD', 'MD5', 'SHA1', 'SHA', 'CRC32', 'SHA2',
])

type Row = Parameters<Compiled['eval']>[0]

/** A value's bytes, as a digest or BIT_LENGTH counts them: text in its charset, a number as its text. */
export const bytesOf = (v: V): Uint8Array => (v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v)))

/** An integer argument read with its 1292, as `val_int` reads it. */
export function intReader(c: Compiled): (r: Row, env: Env) => bigint | null {
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

/** An argument's width in characters, which a binary result counts too (8.4.11: ELT and MAKE_SET over bytes). */
const charsOf = (t: ResultType): number => widthOf(t, false)

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

function moreStringFunction(name: string, xs: readonly Compiled[], callName: string, label: string, using: string | undefined, constant: readonly boolean[], ctx: CompileContext, args: readonly string[]): Compiled {
  const conn = ctx.connectionCollation
  const arity = (min: number, max = min): void => {
    if (xs.length < min || xs.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${callName}'`)
  }
  const nullableAny = (...cs: readonly Compiled[]): boolean => cs.some((c) => c.type.nullable)
  const hexText = (chars: number, nullable: boolean): ResultType => ({ ...stringType(chars, conn, nullable), coercibility: COERCIBILITY.COERCIBLE })
  const conv = (s: string): Value => stringValue(s, conn, COERCIBILITY.COERCIBLE)
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
  }
  throw unregistered(name)
}

/** Every function this file compiles. */
export const STRING_FUNCTIONS: ReadonlySet<string> = new Set([...LIBRARY, ...MORE_STRING_FUNCTIONS])

export function stringFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const constant = e.args.map(constantNode)
  if (LIBRARY.has(name)) {
    // TRIM's side is a keyword argument, carried as such.
    const xs = e.args.map((a): Compiled => (a.kind === NODE.KEYWORD ? Object.assign({ eval: () => null, type: NULL_TYPE }, { keyword: a.word }) : compile(a, ctx)))
    return libraryFunction(name, xs, e.name, constant, ctx)
  }
  return moreStringFunction(name, e.args.map((a) => compile(a, ctx)), e.name, deparse(e), e.using, constant, ctx, e.args.map((a) => printedArgument(a, ctx)))
}
