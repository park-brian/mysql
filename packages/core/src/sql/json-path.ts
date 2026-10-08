// M5.10 — JSON paths, and the functions that take them.
//
// The path language is MySQL's (`sql-common/json_path.cc`), parsed the way
// its parser walks the bytes, so that an error's "character position" is the
// server's: it counts UTF-8 bytes, and points just past the byte the parser
// had read when it gave up. What its parser decides, put to 8.4.11:
//
//   - A path is `$` and legs, whitespace allowed around each: `.key`,
//     `."quoted key"`, `.*`, `[n]`, `[last]`, `[last - n]`, `[m to n]` (the
//     `to` set off by whitespace), `[*]`, and `**`, which may not end a path
//     or be followed by a third `*`. A range that can never match anything,
//     both ends counted from one side and in the wrong order, is an error.
//   - An unquoted key is unescaped as a JSON string would be, then must be an
//     ECMAScript identifier, with "letter" decided as MySQL decides it:
//     `my_isalpha` on the code point's low byte. So `é` (0xE9) is a letter
//     and `ж` (0x436, low byte '6') is not; quote a key to be sure.
//   - An index past 2^32 - 1 is an error.
//
// Evaluating one, as `Json_dom::seek` does: a `[n]` or a range on a value
// that is not an array treats it as a one-element array (`$[0]` of a scalar
// is the scalar), where `[*]` matches nothing; `**` is the value and every
// value below it, each match reported once, in document order.
import { FIELD_TYPE } from '@myjs/bytes'
import { sqlError } from '@myjs/protocol'
import {
  COERCIBILITY,
  JsonSyntaxError,
  compareJson,
  invalidJsonArgument,
  invalidJsonCharset,
  jsonValue,
  parseJson,
  renderJson,
  stringValue,
  toText,
  type JsonDoc,
  type Value,
} from '@myjs/types'
import type { Compiled } from './compile.ts'
import { charWidth, intType, jsonType, stringType, type ResultType } from './meta.ts'

/** The collation of every text these functions make, whatever the connection's (8.4.11: `JSON_UNQUOTE('"ABC"') = 'abc'` is 0). */
const UTF8MB4_BIN = 46

export type Leg =
  | { readonly kind: 'member'; readonly key: string }
  | { readonly kind: 'memberAny' }
  | { readonly kind: 'cell'; readonly index: number; readonly fromEnd: boolean }
  | { readonly kind: 'cellAny' }
  | { readonly kind: 'range'; readonly from: number; readonly fromEnd: boolean; readonly to: number; readonly toEnd: boolean }
  | { readonly kind: 'ellipsis' }

export interface JsonPath {
  readonly legs: readonly Leg[]
  /** A wildcard, a range or an ellipsis: the path may match more than one value. */
  readonly many: boolean
}

const invalidPath = (position: number) => sqlError('ER_INVALID_JSON_PATH', `Invalid JSON path expression. The error is around character position ${position}.`)
const wildcardNotAllowed = () => sqlError('ER_INVALID_JSON_PATH_WILDCARD', 'In this situation, path expressions may not contain the * and ** tokens or an array range.')

// --- parsing ------------------------------------------------------------------------

const UTF8 = new TextEncoder()
const UTF8_DECODE = new TextDecoder('utf-8', { fatal: true })

/** `my_isspace` under utf8mb4_bin: tab through carriage return, and space. */
const isSpace = (b: number | undefined): boolean => b !== undefined && ((b >= 0x09 && b <= 0x0d) || b === 0x20)
const isDigitByte = (b: number | undefined): boolean => b !== undefined && b >= 0x30 && b <= 0x39

/** `my_isalpha(&my_charset_utf8mb4_bin, cp)`, which reads the code point's low byte only. */
function isLetter(cp: number): boolean {
  if (cp >= 0x300 && cp <= 0x36f) return false
  const b = cp & 0xff
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x80 && b <= 0xfe)
}

const CONNECTORS: ReadonlySet<number> = new Set([0x5f, 0x203f, 0x2040, 0x2054, 0xfe33, 0xfe34, 0xfe4d, 0xfe4e, 0xfe4f, 0xff3f])

function isIdentifier(name: string): boolean {
  if (name === '') return false
  let first = true
  for (const ch of name) {
    const cp = ch.codePointAt(0) as number
    const ok = isLetter(cp) || cp === 0x24 || cp === 0x5f || (!first && ((cp >= 0x300 && cp <= 0x36f) || isDigitByte(cp & 0xff) || CONNECTORS.has(cp) || cp === 0x200c || cp === 0x200d))
    if (!ok) return false
    first = false
  }
  return true
}

/** A JSON string's text, unescaped, or `undefined` when it is not one. */
function jsonString(bytes: Uint8Array): string | undefined {
  let text: string
  try {
    text = UTF8_DECODE.decode(bytes)
  } catch {
    return undefined
  }
  try {
    const doc = parseJson(text)
    return doc.t === 'string' ? doc.v : undefined
  } catch {
    return undefined
  }
}

/** A path, or ER_INVALID_JSON_PATH naming where it went wrong. */
export function parseJsonPath(text: string): JsonPath {
  const b = UTF8.encode(text)
  let at = 0
  const end = b.length
  const legs: Leg[] = []
  const fail = (): never => {
    throw invalidPath(at)
  }
  const skipSpace = () => {
    while (at < end && isSpace(b[at])) at++
  }
  // [n], [last], [last - n]: false when there is no index here.
  const index = (): { n: number; fromEnd: boolean } | undefined => {
    let fromEnd = false
    if (end - at >= 4 && b[at] === 0x6c && b[at + 1] === 0x61 && b[at + 2] === 0x73 && b[at + 3] === 0x74) {
      at += 4
      fromEnd = true
      skipSpace()
      if (at < end && b[at] === 0x2d) {
        at++
        skipSpace()
      } else return { n: 0, fromEnd }
    }
    if (at >= end || !isDigitByte(b[at])) return undefined
    let digits = at
    let n = 0n
    while (digits < end && isDigitByte(b[digits])) n = n * 10n + BigInt((b[digits++] as number) - 0x30)
    if (n > 0xffffffffn) return undefined
    at = digits
    return { n: Number(n), fromEnd }
  }

  skipSpace()
  if (at >= end || b[at++] !== 0x24) fail()
  skipSpace()
  while (at < end) {
    const c = b[at]
    if (c === 0x5b) {
      // [
      at++
      skipSpace()
      if (at >= end) fail()
      if (b[at] === 0x2a) {
        at++
        legs.push({ kind: 'cellAny' })
      } else {
        const first = index() ?? fail()
        skipSpace()
        if (at >= end) fail()
        if (end - at > 3 && isSpace(b[at - 1]) && b[at] === 0x74 && b[at + 1] === 0x6f && isSpace(b[at + 2])) {
          at += 3
          skipSpace()
          const second = index() ?? fail()
          if (first.fromEnd === second.fromEnd && ((first.fromEnd && first.n < second.n) || (!first.fromEnd && second.n < first.n))) fail()
          legs.push({ kind: 'range', from: first.n, fromEnd: first.fromEnd, to: second.n, toEnd: second.fromEnd })
        } else legs.push({ kind: 'cell', index: first.n, fromEnd: first.fromEnd })
      }
      skipSpace()
      if (at >= end || b[at++] !== 0x5d) fail()
    } else if (c === 0x2e) {
      // .
      at++
      skipSpace()
      if (at >= end) fail()
      if (b[at] === 0x2a) {
        at++
        legs.push({ kind: 'memberAny' })
      } else {
        const start = at
        const quoted = b[at] === 0x22
        if (quoted) {
          at++
          let closed = false
          while (at < end) {
            const ch = b[at++]
            if (ch === 0x5c) at++
            else if (ch === 0x22) {
              closed = true
              break
            }
          }
          if (!closed || at > end) at = end
        } else {
          while (at < end && !isSpace(b[at]) && b[at] !== 0x5b && b[at] !== 0x2e && b[at] !== 0x2a) at++
        }
        const raw = b.subarray(start, at)
        let key: string | undefined
        if (quoted) key = jsonString(raw)
        else {
          const wrapped = new Uint8Array(raw.length + 2)
          wrapped[0] = 0x22
          wrapped.set(raw, 1)
          wrapped[raw.length + 1] = 0x22
          key = jsonString(wrapped)
          if (key !== undefined && !isIdentifier(key)) key = undefined
        }
        if (key === undefined) fail()
        legs.push({ kind: 'member', key: key as string })
      }
    } else if (c === 0x2a) {
      // **
      at++
      if (at >= end || b[at++] !== 0x2a) fail()
      if (at >= end) fail()
      if (b[at] === 0x2a) fail()
      legs.push({ kind: 'ellipsis' })
    } else fail()
    skipSpace()
  }
  if (legs.length > 0 && (legs[legs.length - 1] as Leg).kind === 'ellipsis') fail()
  return { legs, many: legs.some((l) => l.kind === 'memberAny' || l.kind === 'cellAny' || l.kind === 'range' || l.kind === 'ellipsis') }
}

// --- evaluating ---------------------------------------------------------------------

/** Every value `path` matches in `doc`, in document order, each once. */
export function seek(doc: JsonDoc, path: JsonPath): JsonDoc[] {
  let current: JsonDoc[] = [doc]
  for (const leg of path.legs) {
    const next: JsonDoc[] = []
    const seen = new Set<JsonDoc>()
    const add = (d: JsonDoc) => {
      if (seen.has(d)) return
      seen.add(d)
      next.push(d)
    }
    for (const d of current) {
      switch (leg.kind) {
        case 'member':
          if (d.t === 'object') {
            const hit = d.v.find(([k]) => k === leg.key)
            if (hit !== undefined) add(hit[1])
          }
          break
        case 'memberAny':
          if (d.t === 'object') for (const [, v] of d.v) add(v)
          break
        case 'cell': {
          const items = d.t === 'array' ? d.v : [d]
          const i = leg.fromEnd ? items.length - 1 - leg.index : leg.index
          if (i >= 0 && i < items.length) add(items[i] as JsonDoc)
          break
        }
        case 'cellAny':
          if (d.t === 'array') for (const v of d.v) add(v)
          break
        case 'range': {
          const items = d.t === 'array' ? d.v : [d]
          const from = Math.max(0, leg.fromEnd ? items.length - 1 - leg.from : leg.from)
          const to = Math.min(items.length - 1, leg.toEnd ? items.length - 1 - leg.to : leg.to)
          for (let i = from; i <= to; i++) add(items[i] as JsonDoc)
          break
        }
        case 'ellipsis': {
          const walk = (x: JsonDoc) => {
            add(x)
            if (x.t === 'array') for (const v of x.v) walk(v)
            else if (x.t === 'object') for (const [, v] of x.v) walk(v)
          }
          walk(d)
          break
        }
      }
    }
    current = next
  }
  return current
}

// --- the functions ------------------------------------------------------------------

/** An argument as a JSON document: JSON as it is, a string parsed (3141), a binary string 3144, anything else 3146. */
function docOf(v: Exclude<Value, null>, arg: number, fn: string): JsonDoc {
  if (v.kind === 'json') return v.v
  if (v.kind === 'string') {
    try {
      return parseJson(v.v)
    } catch (e) {
      if (e instanceof JsonSyntaxError) throw invalidJsonArgument(e.message, e.position, arg, fn)
      throw e
    }
  }
  if (v.kind === 'bytes') throw invalidJsonCharset(fn)
  throw sqlError('ER_INVALID_TYPE_FOR_JSON', `Invalid data type for JSON data in argument ${arg} to function ${fn}; a JSON string or JSON type is required.`)
}

/** A path argument, parsed once per distinct text. */
function pathReader(): (v: Exclude<Value, null>) => JsonPath {
  const cache = new Map<string, JsonPath>()
  return (v) => {
    const text = toText(v)
    let p = cache.get(text)
    if (p === undefined) {
      p = parseJsonPath(text)
      if (cache.size < 64) cache.set(text, p)
    }
    return p
  }
}

/** `JSON_TYPE`'s names. */
function typeName(d: JsonDoc): string {
  switch (d.t) {
    case 'null':
      return 'NULL'
    case 'bool':
      return 'BOOLEAN'
    case 'int':
      return 'INTEGER'
    case 'uint':
      return 'UNSIGNED INTEGER'
    case 'double':
      return 'DOUBLE'
    case 'decimal':
      return 'DECIMAL'
    case 'string':
      return 'STRING'
    case 'date':
      return 'DATE'
    case 'datetime':
    case 'timestamp':
      return 'DATETIME'
    case 'time':
      return 'TIME'
    case 'array':
      return 'ARRAY'
    case 'object':
      return 'OBJECT'
    case 'opaque':
      if (d.field === FIELD_TYPE.BIT) return 'BIT'
      if (d.field === FIELD_TYPE.GEOMETRY) return 'GEOMETRY'
      if (d.field === FIELD_TYPE.BLOB || d.field === FIELD_TYPE.VARCHAR || d.field === FIELD_TYPE.STRING || d.field === FIELD_TYPE.VAR_STRING || d.field === FIELD_TYPE.TINY_BLOB || d.field === FIELD_TYPE.MEDIUM_BLOB || d.field === FIELD_TYPE.LONG_BLOB) return 'BLOB'
      return 'OPAQUE'
  }
}

/** Whether `candidate` is contained in `target`, as JSON_CONTAINS has it. */
function contains(target: JsonDoc, candidate: JsonDoc): boolean {
  if (target.t === 'array') {
    if (candidate.t === 'array') return candidate.v.every((c) => target.v.some((t) => contains(t, c)))
    return target.v.some((t) => contains(t, candidate))
  }
  if (target.t === 'object') {
    if (candidate.t !== 'object') return false
    return candidate.v.every(([k, c]) => {
      const hit = target.v.find(([tk]) => tk === k)
      return hit !== undefined && contains(hit[1], c)
    })
  }
  if (candidate.t === 'array' || candidate.t === 'object') return false
  return compareJson(target, candidate) === 0
}

function depthOf(d: JsonDoc): number {
  if (d.t === 'array') return d.v.length === 0 ? 1 : 1 + Math.max(...d.v.map(depthOf))
  if (d.t === 'object') return d.v.length === 0 ? 1 : 1 + Math.max(...d.v.map(([, v]) => depthOf(v)))
  return 1
}

const lengthOf = (d: JsonDoc): number => (d.t === 'array' || d.t === 'object' ? d.v.length : 1)

const int = (n: number | boolean): Value => ({ kind: 'int', v: BigInt(typeof n === 'boolean' ? (n ? 1 : 0) : n), unsigned: false })

/** The arguments evaluated, or `undefined` when one is NULL: every one of these functions is NULL then. */
function present(args: readonly Compiled[], r: Parameters<Compiled['eval']>[0], env: Parameters<Compiled['eval']>[1]): Exclude<Value, null>[] | undefined {
  const out: Exclude<Value, null>[] = []
  for (const a of args) {
    const v = a.eval(r, env)
    if (v === null) return undefined
    out.push(v)
  }
  return out
}

/** `JSON_EXTRACT`'s answer for one document and its paths. */
function extract(doc: JsonDoc, paths: readonly JsonPath[]): Value {
  if (paths.length === 1 && !(paths[0] as JsonPath).many) {
    const hit = seek(doc, paths[0] as JsonPath)[0]
    return hit === undefined ? null : jsonValue(hit)
  }
  const hits = paths.flatMap((p) => seek(doc, p))
  return hits.length === 0 ? null : jsonValue({ t: 'array', v: hits })
}

/** A JSON function over paths, or `undefined` for another name. */
export function jsonPathFunction(name: string, args: readonly Compiled[], callName: string): Compiled | undefined {
  const fn = name.toLowerCase()
  const arity = (min: number, max: number) => {
    if (args.length < min || args.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${callName}'`)
  }
  const path = pathReader()
  switch (name) {
    case 'JSON_EXTRACT':
      arity(2, Infinity)
      return {
        eval: (r, env) => {
          const vs = present(args, r, env)
          if (vs === undefined) return null
          const doc = docOf(vs[0] as Exclude<Value, null>, 1, fn)
          return extract(doc, vs.slice(1).map(path))
        },
        type: jsonType(true),
      }
    case 'JSON_UNQUOTE':
      arity(1, 1)
      return unquote(args[0] as Compiled)
    case 'JSON_CONTAINS':
      arity(2, 3)
      return {
        eval: (r, env) => {
          const vs = present(args, r, env)
          if (vs === undefined) return null
          let target = docOf(vs[0] as Exclude<Value, null>, 1, fn)
          const candidate = docOf(vs[1] as Exclude<Value, null>, 2, fn)
          if (vs.length === 3) {
            const p = path(vs[2] as Exclude<Value, null>)
            if (p.many) throw wildcardNotAllowed()
            const hit = seek(target, p)[0]
            if (hit === undefined) return null
            target = hit
          }
          return int(contains(target, candidate))
        },
        type: intType(21, true),
      }
    case 'JSON_CONTAINS_PATH':
      arity(3, Infinity)
      return {
        eval: (r, env) => {
          const vs = present(args, r, env)
          if (vs === undefined) return null
          const doc = docOf(vs[0] as Exclude<Value, null>, 1, fn)
          const mode = toText(vs[1] as Exclude<Value, null>).toLowerCase()
          if (mode !== 'one' && mode !== 'all') throw sqlError('ER_JSON_BAD_ONE_OR_ALL_ARG', `The oneOrAll argument to ${fn} may take these values: 'one' or 'all'.`)
          const found = vs.slice(2).map((p) => seek(doc, path(p)).length > 0)
          return int(mode === 'one' ? found.some((x) => x) : found.every((x) => x))
        },
        type: intType(21, true),
      }
    case 'JSON_TYPE':
      arity(1, 1)
      return {
        eval: (r, env) => {
          const v = (args[0] as Compiled).eval(r, env)
          return v === null ? null : stringValue(typeName(docOf(v, 1, fn)), UTF8MB4_BIN, COERCIBILITY.IMPLICIT)
        },
        type: stringType(17, UTF8MB4_BIN, true),
      }
    case 'JSON_LENGTH':
    case 'JSON_DEPTH':
    case 'JSON_KEYS': {
      if (name === 'JSON_DEPTH') arity(1, 1)
      else arity(1, 2)
      return {
        eval: (r, env) => {
          const vs = present(args, r, env)
          if (vs === undefined) return null
          let doc = docOf(vs[0] as Exclude<Value, null>, 1, fn)
          if (vs.length === 2) {
            const p = path(vs[1] as Exclude<Value, null>)
            if (p.many && name === 'JSON_KEYS') throw wildcardNotAllowed()
            const hit = seek(doc, p)[0]
            if (hit === undefined) return null
            doc = hit
          }
          if (name === 'JSON_LENGTH') return int(lengthOf(doc))
          if (name === 'JSON_DEPTH') return int(depthOf(doc))
          return doc.t === 'object' ? jsonValue({ t: 'array', v: doc.v.map(([k]) => ({ t: 'string', v: k })) }) : null
        },
        type: name === 'JSON_KEYS' ? jsonType(true) : intType(21, true),
      }
    }
    case 'JSON_VALID':
      arity(1, 1)
      return {
        eval: (r, env) => {
          const v = (args[0] as Compiled).eval(r, env)
          if (v === null) return null
          if (v.kind === 'json') return int(true)
          if (v.kind !== 'string') return int(false)
          try {
            parseJson(v.v)
            return int(true)
          } catch (e) {
            if (e instanceof JsonSyntaxError) return int(false)
            throw e
          }
        },
        type: intType(21, true),
      }
    default:
      return undefined
  }
}

/**
 * `JSON_UNQUOTE(x)`: a JSON string's text, or any other JSON value's; a SQL
 * string that is a quoted JSON string, unescaped (3141 when its escapes are
 * not JSON's); any other string as it is; anything else 3064. A JSON
 * argument makes a LONGTEXT, a string one the string's width.
 */
export function unquote(arg: Compiled): Compiled {
  const type: ResultType = arg.type.kind === 'json' ? { ...stringType(4294967295 / 4, UTF8MB4_BIN, true), field: FIELD_TYPE.LONG_BLOB, length: 4294967295 } : stringType(charWidth(arg.type), UTF8MB4_BIN, true)
  return {
    eval: (r, env) => {
      const v = arg.eval(r, env)
      if (v === null) return null
      const out = (s: string) => stringValue(s, UTF8MB4_BIN, COERCIBILITY.IMPLICIT)
      if (v.kind === 'json') return out(v.v.t === 'string' ? v.v.v : renderJson(v.v))
      if (v.kind !== 'string') throw sqlError('ER_INCORRECT_TYPE', 'Incorrect type for argument 1 in function json_unquote.')
      const s = v.v
      if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return out(s)
      let doc: JsonDoc
      try {
        doc = parseJson(s)
      } catch (e) {
        if (e instanceof JsonSyntaxError) throw invalidJsonArgument(e.message, e.position, 1, 'json_unquote')
        throw e
      }
      return out(doc.t === 'string' ? doc.v : s)
    },
    type,
  }
}
