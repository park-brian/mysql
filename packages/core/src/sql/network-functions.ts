// M5.10 — the network and UUID functions: INET_ATON, INET_NTOA, INET6_ATON,
// INET6_NTOA, IS_IPV4, IS_IPV6, IS_IPV4_COMPAT, IS_IPV4_MAPPED, IS_UUID,
// UUID_TO_BIN and BIN_TO_UUID.
//
// Written against `tools/capture-more-functions.mjs`'s corpus, captured from
// 8.4.11 first. An address or a UUID that does not parse is NULL with a 1411
// warning naming the function, except where the server refuses it outright.
import { CHARSET_BINARY, hex } from '@myjs/bytes'
import { hexBytes, type CallNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { COERCIBILITY, bool, bytesValue, intValue, stringValue, toText, type Value, valueBytes } from '@myjs/types'
import { hexOf } from './builtins.ts'
import { compile, printedArgument, raise, invalidString, readNonNull, type CompileContext, type Compiled } from './compile.ts'
import { intType, stringType, type ResultType } from './meta.ts'
import { nativeArity, unregistered } from './registry.ts'
import { intReader } from './string-functions.ts'

export const NETWORK_FUNCTIONS: ReadonlySet<string> = new Set([
  'INET_ATON', 'INET_NTOA', 'INET6_ATON', 'INET6_NTOA', 'IS_IPV4', 'IS_IPV6', 'IS_UUID', 'IS_IPV4_COMPAT', 'IS_IPV4_MAPPED', 'UUID_TO_BIN', 'BIN_TO_UUID',
])

const byteView = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** INET_ATON also allows up to three missing parts immediately before the last byte. */
function ipv4(text: string, abbreviated = false): Uint8Array | undefined {
  const parts = text.split('.', 5)
  if (parts.length > 4 || (!abbreviated && parts.length !== 4)) return undefined
  const out = new Uint8Array(4)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if ((!abbreviated && part.length > 3) || !/^\d+$/.test(part)) return undefined
    const byte = Number(part)
    if (byte > 255) return undefined
    out[i === parts.length - 1 ? 3 : i] = byte
  }
  return out
}

/** Explicit words on either side of an IPv6 zero run. */
function ipv6Words(part: string): number[] | undefined {
  if (part === '') return []
  const out: number[] = []
  const groups = part.split(':')
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!
    if (i === groups.length - 1 && g.includes('.')) {
      const v4 = ipv4(g)
      if (v4 === undefined) return undefined
      const view = byteView(v4)
      out.push(view.getUint16(0), view.getUint16(2))
      continue
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return undefined
    out.push(parseInt(g, 16))
  }
  return out
}

/** An IPv6 address: groups of hex, one `::`, an IPv4 tail. */
function ipv6(text: string): Uint8Array | undefined {
  if (text.length === 0 || text.length > 39 + 7) return undefined
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const head = ipv6Words(halves[0]!)
  const tail = ipv6Words(halves[1] ?? '')
  if (head === undefined || tail === undefined) return undefined
  const used = head.length + tail.length
  if (halves.length === 1 ? used !== 8 : used >= 8) return undefined
  const out = new Uint8Array(16)
  const view = byteView(out)
  head.forEach((w, i) => view.setUint16(i * 2, w))
  tail.forEach((w, i) => view.setUint16(2 * (8 - tail.length + i), w))
  return out
}

/** INET6_NTOA's text of 16 bytes: the longest run of zero words as `::`, IPv4-compatible and -mapped tails dotted. */
function ipv6Text(b: Uint8Array): string {
  const view = byteView(b)
  const w = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2))
  const dotted = b.subarray(12).join('.')
  if (zeroPrefix(b, 12) && (w[6] !== 0 || (w[7] as number) > 1)) return `::${dotted}`
  if (ipv4Mapped(b)) return `::ffff:${dotted}`
  let best = -1
  let bestLen = 1
  for (let i = 0, j = 0; i < w.length; i = j + 1) {
    j = i
    while (w[j] === 0) j++
    if (j - i > bestLen) {
      best = i
      bestLen = j - i
    }
  }
  const hex = w.map((x) => x.toString(16))
  if (best < 0) return hex.join(':')
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`
}

const zeroPrefix = (b: Uint8Array, length: number): boolean => b.subarray(0, length).every((x) => x === 0)
const ipv4Mapped = (b: Uint8Array): boolean => zeroPrefix(b, 10) && b[10] === 0xff && b[11] === 0xff

/** A UUID's 16 bytes from its 32-, 36- or 38-character text, or undefined. */
function uuidBytes(text: string): Uint8Array | undefined {
  let hex: string
  if (/^[0-9a-fA-F]{32}$/.test(text)) hex = text
  else {
    const dashed = text[0] === '{' && text.endsWith('}') ? text.slice(1, -1) : text
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dashed)) return undefined
    hex = dashed.replace(/-/g, '')
  }
  return hexBytes(hex)
}

/** UUID_TO_BIN's and BIN_TO_UUID's swap: the time-low and time-high fields exchanged. */
const swapped = (b: Uint8Array): Uint8Array => Uint8Array.from([...b.slice(6, 8), ...b.slice(4, 6), ...b.slice(0, 4), ...b.slice(8)])
const unswapped = (b: Uint8Array): Uint8Array => Uint8Array.from([...b.slice(4, 8), ...b.slice(2, 4), ...b.slice(0, 2), ...b.slice(8)])

const wrongValue = (text: string, fn: string) => sqlError('ER_WRONG_VALUE_FOR_TYPE', `Incorrect string value: '${text}' for function ${fn}`)

export function networkFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const xs = e.args.map((a) => compile(a, ctx))
  const arity = nativeArity(e.name, xs.length)
  const s = xs[0] as Compiled
  const conn = ctx.connectionCollation
  // Diagnostics quote the first argument as it was bound.
  const first = e.args[0]
  const shown = first === undefined ? '?' : printedArgument(first, ctx)
  const textType = (chars: number): ResultType => ({ ...stringType(chars, conn, true), coercibility: COERCIBILITY.COERCIBLE })
  const conv = (s: string): Value => stringValue(s, conn, COERCIBILITY.COERCIBLE)
  switch (name) {
    case 'INET_ATON':
    case 'INET6_ATON': {
      arity(1)
      const v6 = name === 'INET6_ATON'
      return {
        eval: readNonNull(s.eval, (v, env) => {
          const text = toText(v)
          const address = v6 ? ipv4(text) ?? ipv6(text) : ipv4(text, true)
          if (address === undefined) return invalidString(env, shown, v6 ? 'inet6_aton' : 'inet_aton')
          return v6 ? bytesValue(address) : intValue(BigInt(byteView(address).getUint32(0)), true)
        }),
        type: v6 ? stringType(16, CHARSET_BINARY, true) : intType(21, true, true),
      }
    }
    case 'INET_NTOA': {
      arity(1)
      const n = intReader(s)
      return {
        eval: (r, env) => {
          const v = n(r, env)
          if (v === null) return null
          // A number that is no address is NULL, and 1411 names the argument as written.
          if (v < 0n || v > 0xffffffffn) {
            raise(env, 1411, `Incorrect integer value: '${shown}' for function inet_ntoa`)
            return null
          }
          const address = new Uint8Array(4)
          byteView(address).setUint32(0, Number(v))
          return conv(address.join('.'))
        },
        type: textType(31),
      }
    }
    case 'INET6_NTOA': {
      arity(1)
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
      const parse = name === 'IS_IPV4' ? ipv4 : name === 'IS_IPV6' ? ipv6 : uuidBytes
      return {
        eval: readNonNull(s.eval, (v) => bool(parse(toText(v)) !== undefined)),
        type: intType(1, name === 'IS_UUID' || s.type.nullable),
      }
    }
    case 'IS_IPV4_COMPAT':
    case 'IS_IPV4_MAPPED': {
      arity(1)
      const compatible = name === 'IS_IPV4_COMPAT'
      return {
        eval: readNonNull(s.eval, (v) => {
          const b = v.kind === 'bytes' ? v.v : undefined
          return bool(b?.length === 16 && (compatible ? zeroPrefix(b, 12) && byteView(b).getUint32(12) !== 0 : ipv4Mapped(b)))
        }),
        type: intType(1, true),
      }
    }
    case 'UUID_TO_BIN':
    case 'BIN_TO_UUID': {
      arity(1, 2)
      const encode = name === 'UUID_TO_BIN'
      const flag = xs[1]
      const swap = flag && intReader(flag)
      return {
        eval: (r, env) => {
          const v = s.eval(r, env)
          if (v === null) return null
          const text = encode ? toText(v) : undefined
          const b = text === undefined ? valueBytes(v) : uuidBytes(text)
          if (b?.length !== 16) throw wrongValue(text ?? (v.kind === 'bytes' ? hexOf(v.v) : toText(v)), name.toLowerCase())
          const sw = swap?.(r, env) ?? 0n
          const u = sw === 0n ? b : encode ? swapped(b) : unswapped(b)
          if (encode) return bytesValue(u)
          return conv(hex(u).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'))
        },
        type: encode ? stringType(16, CHARSET_BINARY, true) : textType(36),
      }
    }
  }
  throw unregistered(name)
}
