// M5.10 — REGEXP, RLIKE, REGEXP_LIKE, REGEXP_INSTR, REGEXP_SUBSTR and REGEXP_REPLACE.
//
// MySQL 8 matches with ICU; this matches with the engine's RegExp, after
// `icu-pattern.ts` has read ICU's syntax and written the engine's. What
// 8.4.11 answered:
//
//   - The match is case-insensitive when the comparison's collation is (a
//     `_ci` one), and case-sensitive for `_bin`, `_cs` and binary strings. It
//     is never accent-insensitive: `'é' REGEXP 'e'` is 0.
//   - A binary string against a text one is 3995. A number or a temporal is
//     matched as its text.
//   - REGEXP_LIKE's match type is any of `c`, `i`, `m`, `n`, `u`, the last of
//     `c` and `i` winning; anything else is 1210. `.` does not match a line
//     end without `n`; `^` and `$` are the whole subject's without `m`.
//   - An empty pattern, and the POSIX word boundaries `[[:<:]]`, are 3685.
//     ICU's syntax errors keep their own numbers, which `icu-pattern.ts` lists.
//
// A named divergence: ICU folds case fully, so `'Straße' REGEXP 'STRASSE'` is
// 1 there; the engine folds code point by code point, and it is 0 here.
import { CHARSET_BINARY } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import { sqlError } from '@myjs/protocol'
import { aggregateCollation, toText, type Value } from '@myjs/types'
import { compileIcu, type IcuFlags, type IcuPattern } from './icu-pattern.ts'

const illegal = () => sqlError('ER_REGEXP_ILLEGAL_ARGUMENT', 'Illegal argument to a regular expression.')

/**
 * ICU's limits, which the engine does not have. A pattern nested 100 groups
 * deep is 3687. And ICU stops a match after `regexp_time_limit` steps
 * (3699), where the engine would backtrack for as long as it takes: a
 * quantified group with a quantifier or an alternation inside it, `(a+)+b`,
 * is exponential in the subject's length, and 8.4.11 gives up past 17
 * characters. Such a pattern over a longer subject is refused with 3699
 * before it runs, so a statement never hangs; a named divergence, since the
 * server would finish one that happens to match quickly.
 */
function shapeOf(pattern: string): { readonly depth: number; readonly nested: boolean } {
  let depth = 0
  let deepest = 0
  let inClass = false
  // For each open group: whether it holds a quantifier or an alternation.
  const open: boolean[] = []
  let nested = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') {
      open.push(false)
      deepest = Math.max(deepest, ++depth)
    } else if (c === ')') {
      const inner = open.pop() === true
      depth = Math.max(0, depth - 1)
      const next = pattern[i + 1]
      if (inner && (next === '*' || next === '+' || (next === '{' && /^\{\d*,\}/.test(pattern.slice(i + 1))))) nested = true
      if (inner && open.length > 0) open[open.length - 1] = true
    } else if ((c === '*' || c === '+' || c === '|' || c === '{') && open.length > 0) open[open.length - 1] = true
  }
  return { depth: deepest, nested }
}

const RUNAWAY_LENGTH = 17

export interface MatchType {
  readonly insensitive?: boolean
  readonly multiline: boolean
  readonly dotAll: boolean
}

/** REGEXP_LIKE's third argument: 1210 for a letter it does not know. */
export function matchType(text: string, fn: string): MatchType {
  let insensitive: boolean | undefined
  let multiline = false
  let dotAll = false
  for (const ch of text) {
    if (ch === 'c') insensitive = false
    else if (ch === 'i') insensitive = true
    else if (ch === 'm') multiline = true
    else if (ch === 'n') dotAll = true
    else if (ch !== 'u') throw sqlError('ER_WRONG_ARGUMENTS', `Incorrect arguments to ${fn}`)
  }
  return insensitive === undefined ? { multiline, dotAll } : { insensitive, multiline, dotAll }
}

const cache = new Map<string, IcuPattern & { readonly re: RegExp }>()

/** A pattern compiled once per flags and text: ICU's syntax read, the engine's written. */
function compiled(pattern: string, flags: IcuFlags): IcuPattern & { readonly re: RegExp } {
  const key = `${Number(flags.insensitive)}${Number(flags.multiline)}${Number(flags.dotAll)}/${pattern}`
  let c = cache.get(key)
  if (c === undefined) {
    const p = compileIcu(pattern, flags)
    let re: RegExp
    try {
      re = new RegExp(p.source, p.flags)
    } catch {
      // Never expected — 600,000 fuzzed patterns compile — but a typed error, not a crash, if one does not.
      throw illegal()
    }
    c = { ...p, re }
    if (cache.size > 256) cache.clear()
    cache.set(key, c)
  }
  return c
}

const collationOf = (v: Exclude<Value, null>) => (v.kind === 'string' ? v.collationId : v.kind === 'bytes' ? CHARSET_BINARY : undefined)
const nameOf = (id: number) => (id === CHARSET_BINARY ? 'binary' : requireCollationInfo(id).name)

/** 3995 when one of a pair is a binary string and the other text, naming them in order. */
function sameKind(a: Exclude<Value, null>, b: Exclude<Value, null>, fn: string): void {
  const x = collationOf(a)
  const y = collationOf(b)
  if (x !== undefined && y !== undefined && (x === CHARSET_BINARY) !== (y === CHARSET_BINARY)) {
    throw sqlError('ER_CHARACTER_SET_MISMATCH', `Character set '${nameOf(x)}' cannot be used in conjunction with '${nameOf(y)}' in call to ${fn}.`)
  }
}

/** A value as the text the pattern runs over: a binary string byte for byte. */
const textOf = (v: Exclude<Value, null>): string => (v.kind === 'bytes' ? new TextDecoder('latin1').decode(v.v) : toText(v))

/** The subject's and pattern's collation, as the comparison has it. */
function collationFor(subject: Exclude<Value, null>, pattern: Exclude<Value, null>): number {
  if (subject.kind === 'string' && pattern.kind === 'string') return aggregateCollation(subject, pattern)
  return collationOf(subject) ?? collationOf(pattern) ?? CHARSET_BINARY
}

/** The engine's pattern for `pattern` over `subject`. */
function regexpFor(subject: Exclude<Value, null>, pattern: Exclude<Value, null>, type: MatchType | undefined, fn: string): IcuPattern & { readonly re: RegExp } {
  sameKind(subject, pattern, fn)
  const collation = collationFor(subject, pattern)
  const text = textOf(pattern)
  if (text === '' || text.includes('[[:<:]]') || text.includes('[[:>:]]')) throw illegal()
  const shape = shapeOf(text)
  if (shape.depth >= 100) throw sqlError('ER_REGEXP_INTERNAL_ERROR', 'Internal error in the regular expression library.')
  const c = compiled(text, { insensitive: type?.insensitive ?? /_ci$/.test(nameOf(collation)), multiline: type?.multiline === true, dotAll: type?.dotAll === true })
  if (shape.nested && [...textOf(subject)].length > RUNAWAY_LENGTH) throw sqlError('ER_REGEXP_TIME_OUT', 'Timeout exceeded in regular expression match.')
  return c
}

/** Whether `subject` matches `pattern`, as REGEXP_LIKE has it; NULL in, NULL out. */
export function regexpLike(subject: Value, pattern: Value, type: MatchType | undefined): boolean | null {
  if (subject === null || pattern === null) return null
  const { re } = regexpFor(subject, pattern, type, 'regexp_like')
  re.lastIndex = 0
  return re.test(textOf(subject))
}

// --- REGEXP_INSTR, REGEXP_SUBSTR, REGEXP_REPLACE --------------------------------
//
// Positions count characters — code points — from 1, and bytes in a binary
// string. What 8.4.11 answered, beyond REGEXP_LIKE's rules:
//
//   - A position below 1, or past the subject's last character (1 is allowed
//     in an empty subject), is 3686. An occurrence below 1 is 1.
//   - REGEXP_INSTR's return option is 0 (the match's start) or 1 (just past
//     its end), else 1210; it is 0 when there is no such match.
//   - REGEXP_SUBSTR is NULL when there is no such match, and `''` for an
//     empty one.
//   - REGEXP_REPLACE replaces every match from the position with occurrence
//     0, or only the nth; the text before the position is kept. The
//     replacement is ICU's: `$n` a group (3686 past the last one), `\x` the
//     character x, and a `$` not before a digit 3887.

const outOfBounds = () => sqlError('ER_REGEXP_INDEX_OUTOFBOUNDS_ERROR', 'Index out of bounds in regular expression search.')

/**
 * The UTF-16 offset of 1-based character `pos`. REGEXP_INSTR takes a
 * position in the subject, any in an empty one; REGEXP_SUBSTR and
 * REGEXP_REPLACE also the place just past its end, and call a position below
 * 1 their arguments' fault, 1583 (8.4.11). Past that, 3686.
 */
function offsetOf(text: string, pos: bigint, binary: boolean, fn: string): number {
  const length = binary ? text.length : [...text].length
  if (fn === 'regexp_instr') {
    if (length === 0) return 0
    if (pos < 1n || pos > BigInt(length)) throw outOfBounds()
  } else {
    if (pos < 1n) throw sqlError('ER_WRONG_PARAMETERS_TO_NATIVE_FCT', `Incorrect parameters in the call to native function '${fn}'`)
    if (pos > BigInt(length + 1)) throw outOfBounds()
  }
  if (binary) return Number(pos) - 1
  let offset = 0
  for (let i = 1n; i < pos; i++) offset += (text.codePointAt(offset) as number) > 0xffff ? 2 : 1
  return offset
}

/** Characters before UTF-16 offset `at`. */
const charsBefore = (text: string, at: number, binary: boolean): number => (binary ? at : [...text.slice(0, at)].length)

/** The matches of `re` in `text` from `start`, in order. */
function* matchesFrom(re: RegExp, text: string, start: number): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.sticky ? re.flags : `${re.flags}g`)
  r.lastIndex = start
  for (;;) {
    const m = r.exec(text)
    if (m === null) return
    yield m
    // An empty match moves on one character, as ICU's `find` does.
    if (m[0] === '') r.lastIndex = m.index + ((text.codePointAt(m.index) ?? 0) > 0xffff ? 2 : 1)
    if (r.lastIndex > text.length) return
  }
}

/** The nth match from `start`, or undefined. */
function nth(re: RegExp, text: string, start: number, occurrence: bigint): RegExpExecArray | undefined {
  // The server keeps an occurrence in 32 bits: BIGINT's largest is -1 there, and so the first.
  const wrapped = BigInt.asIntN(32, occurrence > 9223372036854775807n ? 9223372036854775807n : occurrence)
  let n = wrapped < 1n ? 1n : wrapped
  for (const m of matchesFrom(re, text, start)) if (--n === 0n) return m
  return undefined
}

export interface Search {
  readonly subject: Exclude<Value, null>
  readonly pattern: Exclude<Value, null>
  readonly position: bigint
  readonly occurrence: bigint
  readonly type: MatchType | undefined
}

export function regexpInstr(s: Search, returnEnd: boolean): bigint {
  const { re } = regexpFor(s.subject, s.pattern, s.type, 'regexp_instr')
  const binary = s.subject.kind === 'bytes'
  const text = textOf(s.subject)
  const m = nth(re, text, offsetOf(text, s.position, binary, 'regexp_instr'), s.occurrence)
  if (m === undefined) return 0n
  return BigInt(charsBefore(text, m.index + (returnEnd ? m[0].length : 0), binary) + 1)
}

/** The matched text, or undefined when there is no such match. */
export function regexpSubstr(s: Search): string | undefined {
  const { re } = regexpFor(s.subject, s.pattern, s.type, 'regexp_substr')
  const text = textOf(s.subject)
  return nth(re, text, offsetOf(text, s.position, s.subject.kind === 'bytes', 'regexp_substr'), s.occurrence)?.[0]
}

type Piece = string | number

/**
 * ICU's replacement text as literal pieces and ICU group numbers. `\\uhhhh`
 * and `\\Uhhhhhhhh` are a character, `\\` before anything else is that
 * thing, and a trailing one nothing. `$` takes one digit, and more while
 * the number stays a group (`$10` is group 1 and `0` with one group);
 * `${name}` a named group. Anything else after `$`, or a name not a
 * group's, is 3887; a number past the last group 3686 (8.4.11).
 */
function replacementOf(text: string, groups: number, names: ReadonlyMap<string, number>): Piece[] {
  const out: Piece[] = []
  let literal = ''
  const cps = Array.from(text)
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i] as string
    if (c === '\\') {
      const n = cps[i + 1]
      if (n === undefined) break
      const width = n === 'u' ? 4 : n === 'U' ? 8 : 0
      const hex = cps.slice(i + 2, i + 2 + width).join('')
      const cp = width > 0 && hex.length === width && /^[0-9a-fA-F]+$/.test(hex) ? parseInt(hex, 16) : -1
      if (cp >= 0 && cp <= 0x10ffff) {
        literal += String.fromCodePoint(cp)
        i += 1 + width
      } else literal += cps[++i]
      continue
    }
    if (c !== '$') {
      literal += c
      continue
    }
    let group: number
    if (cps[i + 1] === '{') {
      const close = cps.indexOf('}', i + 2)
      const name = close < 0 ? undefined : cps.slice(i + 2, close).join('')
      const n = name === undefined ? undefined : names.get(name)
      if (n === undefined) throw sqlError('ER_REGEXP_INVALID_CAPTURE_GROUP_NAME', 'A capture group has an invalid name.')
      group = n
      i = close
    } else {
      const d = cps[i + 1]
      if (d === undefined || !/[0-9]/.test(d)) throw sqlError('ER_REGEXP_INVALID_CAPTURE_GROUP_NAME', 'A capture group has an invalid name.')
      group = Number(d)
      i++
      while (/[0-9]/.test(cps[i + 1] ?? '') && group * 10 + Number(cps[i + 1]) <= groups) group = group * 10 + Number(cps[++i])
      if (group > groups) throw outOfBounds()
    }
    if (literal !== '') out.push(literal)
    literal = ''
    out.push(group)
  }
  if (literal !== '') out.push(literal)
  return out
}

export function regexpReplace(s: Search, replacement: Exclude<Value, null>): string {
  sameKind(s.subject, replacement, 'regexp_replace')
  const { re, groups, names } = regexpFor(s.subject, s.pattern, s.type, 'regexp_replace')
  const text = textOf(s.subject)
  const start = offsetOf(text, s.position, s.subject.kind === 'bytes', 'regexp_replace')
  const pieces = replacementOf(textOf(replacement), groups.length - 1, names)
  const expand = (m: RegExpExecArray): string => pieces.map((p) => (typeof p === 'string' ? p : (m[groups[p] as number] ?? ''))).join('')
  let out = text.slice(0, start)
  let at = start
  let n = 0n
  for (const m of matchesFrom(re, text, start)) {
    n++
    if (s.occurrence > 0n && n !== s.occurrence) continue
    out += text.slice(at, m.index) + expand(m)
    at = m.index + m[0].length
    if (s.occurrence > 0n) break
  }
  return out + text.slice(at)
}
