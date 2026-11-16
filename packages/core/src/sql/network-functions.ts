// M5.10 — the network and UUID functions: INET_ATON, INET_NTOA, INET6_ATON,
// INET6_NTOA, IS_IPV4, IS_IPV6, IS_IPV4_COMPAT, IS_IPV4_MAPPED, IS_UUID,
// UUID_TO_BIN and BIN_TO_UUID.
//
// Written against `tools/capture-more-functions.mjs`'s corpus, captured from
// 8.4.11 first. An address or a UUID that does not parse is NULL with a 1411
// warning naming the function, except where the server refuses it outright.
import { CHARSET_BINARY, hex } from '@myjs/bytes'
import type { CallNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { COERCIBILITY, bool, bytesValue, intValue, stringValue, toText, type Value, valueBytes } from '@myjs/types'
import { hexDigits, hexOf } from './builtins.ts'
import { compile, printedArgument, raise, invalidString, readNonNull, type CompileContext, type Compiled } from './compile.ts'
import { intType, stringType, type ResultType } from './meta.ts'
import { nativeArity, unregistered } from './registry.ts'
import { intReader } from './string-functions.ts'

export const NETWORK_FUNCTIONS: ReadonlySet<string> = new Set([
  'INET_ATON', 'INET_NTOA', 'INET6_ATON', 'INET6_NTOA', 'IS_IPV4', 'IS_IPV6', 'IS_UUID', 'IS_IPV4_COMPAT', 'IS_IPV4_MAPPED', 'UUID_TO_BIN', 'BIN_TO_UUID',
])

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

/** INET_ATON also reads abbreviated addresses of one to three parts. */
function packedIpv4(text: string): number | undefined {
  let total = 0
  let byte = 0
  let dots = 0
  let hasDigit = false
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      byte = byte * 10 + ch.charCodeAt(0) - 48
      hasDigit = true
      if (byte > 255) return undefined
    } else if (ch === '.') {
      if (!hasDigit || dots === 3) return undefined
      total = total * 256 + byte
      byte = 0
      hasDigit = false
      dots++
    } else return undefined
  }
  if (!hasDigit) return undefined
  return total * 256 ** (4 - dots) + byte
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
  const dotted = b.subarray(12).join('.')
  if (zeroBytes(b, 0, 12) && (w[6] !== 0 || (w[7] as number) > 1)) return `::${dotted}`
  if (ipv4Mapped(b)) return `::ffff:${dotted}`
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

const zeroBytes = (b: Uint8Array, from: number, to: number): boolean => b.subarray(from, to).every((x) => x === 0)
const ipv4Mapped = (b: Uint8Array): boolean => zeroBytes(b, 0, 10) && b[10] === 0xff && b[11] === 0xff

/** A UUID's 16 bytes from its 32-, 36- or 38-character text, or undefined. */
function uuidBytes(text: string): Uint8Array | undefined {
  let hex: string
  if (/^[0-9a-fA-F]{32}$/.test(text)) hex = text
  else {
    const dashed = text[0] === '{' && text.endsWith('}') ? text.slice(1, -1) : text
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dashed)) return undefined
    hex = dashed.replace(/-/g, '')
  }
  return hexDigits(hex)
}

/** UUID_TO_BIN's and BIN_TO_UUID's swap: the time-low and time-high fields exchanged. */
const swapped = (b: Uint8Array): Uint8Array => Uint8Array.from([...b.slice(6, 8), ...b.slice(4, 6), ...b.slice(0, 4), ...b.slice(8)])
const unswapped = (b: Uint8Array): Uint8Array => Uint8Array.from([...b.slice(4, 8), ...b.slice(2, 4), ...b.slice(0, 2), ...b.slice(8)])

const wrongValue = (text: string, fn: string) => sqlError('ER_WRONG_VALUE_FOR_TYPE', `Incorrect string value: '${text}' for function ${fn}`)

export function networkFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const xs = e.args.map((a) => compile(a, ctx))
  const arity = nativeArity(e.name, xs.length)
  const conn = ctx.connectionCollation
  // Diagnostics quote the first argument as it was bound.
  const first = e.args[0]
  const shown = first === undefined ? '?' : printedArgument(first, ctx)
  const textType = (chars: number): ResultType => ({ ...stringType(chars, conn, true), coercibility: COERCIBILITY.COERCIBLE })
  const conv = (s: string): Value => stringValue(s, conn, COERCIBILITY.COERCIBLE)
  switch (name) {
    case 'INET_ATON': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: readNonNull(s.eval, (v, env) => {
          const packed = packedIpv4(toText(v))
          return packed === undefined ? invalidString(env, shown, 'inet_aton') : intValue(BigInt(packed), true)
        }),
        type: intType(21, true, true),
      }
    }
    case 'INET_NTOA': {
      arity(1)
      const n = intReader(xs[0] as Compiled)
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
        type: textType(31),
      }
    }
    case 'INET6_ATON': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: readNonNull(s.eval, (v, env) => {
          const text = toText(v)
          const out = ipv4(text) ?? ipv6(text)
          return out === undefined ? invalidString(env, shown, 'inet6_aton') : bytesValue(out)
        }),
        type: stringType(16, CHARSET_BINARY, true),
      }
    }
    case 'INET6_NTOA': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: readNonNull(s.eval, (v, env) => {
          if (v.kind !== 'bytes' || (v.v.length !== 4 && v.v.length !== 16)) return invalidString(env, shown, 'inet6_ntoa')
          return conv(v.v.length === 4 ? v.v.join('.') : ipv6Text(v.v))
        }),
        type: textType(39),
      }
    }
    case 'IS_IPV4':
    case 'IS_IPV6':
    case 'IS_UUID': {
      arity(1)
      const s = xs[0] as Compiled
      const test = name === 'IS_IPV4' ? (t: string) => ipv4(t) !== undefined : name === 'IS_IPV6' ? (t: string) => ipv6(t) !== undefined : (t: string) => uuidBytes(t) !== undefined
      return {
        eval: readNonNull(s.eval, (v) => bool(test(toText(v)))),
        type: intType(1, name === 'IS_UUID' ? true : s.type.nullable),
      }
    }
    case 'IS_IPV4_COMPAT':
    case 'IS_IPV4_MAPPED': {
      arity(1)
      const s = xs[0] as Compiled
      return {
        eval: readNonNull(s.eval, (v) => {
          if (v.kind !== 'bytes' || v.v.length !== 16) return intValue(0n)
          const b = v.v
          return bool(name === 'IS_IPV4_COMPAT' ? zeroBytes(b, 0, 12) && !zeroBytes(b, 12, 16) : ipv4Mapped(b))
        }),
        type: intType(1, true),
      }
    }
    case 'UUID_TO_BIN':
    case 'BIN_TO_UUID': {
      arity(1, 2)
      const encode = name === 'UUID_TO_BIN'
      const s = xs[0] as Compiled
      const swap = xs[1] === undefined ? undefined : intReader(xs[1])
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const text = encode ? toText(v) : undefined
          const b = text === undefined ? valueBytes(v) : uuidBytes(text)
          if (b?.length !== 16) throw wrongValue(text ?? (v.kind === 'bytes' ? hexOf(v.v) : toText(v)), name.toLowerCase())
          const sw = swap?.(r, env) ?? 0n
          if (encode) return bytesValue(sw === 0n ? b : swapped(b))
          const u = sw === 0n ? b : unswapped(b)
          const h = hex(u)
          return conv(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`)
        },
        type: encode ? stringType(16, CHARSET_BINARY, true) : textType(36),
      }
    }
  }
  throw unregistered(name)
}
