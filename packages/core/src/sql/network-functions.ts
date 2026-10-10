// M5.10 — the network and UUID functions: INET_ATON, INET_NTOA, INET6_ATON,
// INET6_NTOA, IS_IPV4, IS_IPV6, IS_IPV4_COMPAT, IS_IPV4_MAPPED, IS_UUID,
// UUID_TO_BIN and BIN_TO_UUID.
//
// Written against `tools/capture-more-functions.mjs`'s corpus, captured from
// 8.4.11 first. An address or a UUID that does not parse is NULL with a 1411
// warning naming the function, except where the server refuses it outright.
import { CHARSET_BINARY } from '@myjs/bytes'
import type { CallNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { COERCIBILITY, bool, bytesValue, intValue, stringValue, toText, type Value, valueBytes } from '@myjs/types'
import { hexOf } from './builtins.ts'
import { compile, printedArgument, raise, type CompileContext, type Compiled, type Env } from './compile.ts'
import { intType, stringType, type ResultType } from './meta.ts'
import { unregistered } from './registry.ts'
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

export function networkFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const xs = e.args.map((a) => compile(a, ctx))
  const arity = (min: number, max = min): void => {
    if (xs.length < min || xs.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
  }
  const conn = ctx.connectionCollation
  // Each argument as the server prints it, for the messages that quote one.
  const args = e.args.map((a) => printedArgument(a, ctx))
  const hexText = (chars: number, nullable: boolean): ResultType => ({ ...stringType(chars, conn, nullable), coercibility: COERCIBILITY.COERCIBLE })
  const conv = (s: string): Value => stringValue(s, conn, COERCIBILITY.COERCIBLE)
  switch (name) {
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
          const b = valueBytes(v)
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
  throw unregistered(name)
}

/** An address that is not one: NULL, and 1411 naming the function. */
function invalidIp(env: Env, text: string, fn: string): null {
  raise(env, 1411, `Incorrect string value: '${text}' for function ${fn}`)
  return null
}
