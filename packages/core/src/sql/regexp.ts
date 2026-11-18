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
//     With `u`, the parser starts in ICU's LF-only line mode.
//   - An empty pattern, and the POSIX word boundaries `[[:<:]]`, are 3685.
//     ICU's syntax errors keep their own numbers, which `icu-pattern.ts` lists.
//
// A named divergence: ICU folds case fully, so `'Straße' REGEXP 'STRASSE'` is
// 1 there; the engine folds code point by code point, and it is 0 here.
import { wrongArgumentsError } from './errors.ts'
import { CHARSET_BINARY } from '@myjs/bytes'
import { decodeCharset, requireCollationInfo } from '@myjs/charsets'
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
      deepest = Math.max(deepest, open.length)
    } else if (c === ')') {
      const inner = open.pop() === true
      const next = pattern[i + 1]
      if (inner && (next === '*' || next === '+' || (next === '{' && /^\{\d*,\}/.test(pattern.slice(i + 1))))) nested = true
      if (inner && open.length > 0) open[open.length - 1] = true
    } else if ((c === '*' || c === '+' || c === '|' || c === '{') && open.length > 0) open[open.length - 1] = true
  }
  return { depth: deepest, nested }
}

const RUNAWAY_LENGTH = 17

export interface MatchType extends Omit<IcuFlags, 'i'> {
  readonly i: boolean | undefined
}

/** REGEXP_LIKE's third argument: 1210 for a letter it does not know. */
export function matchType(text: string, fn: string): MatchType {
  const flags = { i: undefined as boolean | undefined, m: false, s: false, d: false }
  for (const ch of text) {
    if (ch === 'c') flags.i = false
    else if (ch === 'i') flags.i = true
    else if (ch === 'm') flags.m = true
    else if (ch === 'n') flags.s = true
    else if (ch === 'u') flags.d = true
    else throw wrongArgumentsError(fn)
  }
  return flags
}

const cache = new Map<string, IcuPattern & { readonly re: RegExp }>()

/** A pattern compiled once per flags and text: ICU's syntax read, the engine's written. */
function compiled(pattern: string, flags: IcuFlags): IcuPattern & { readonly re: RegExp } {
  const key = `${flags.i}${flags.m}${flags.s}${flags.d}/${pattern}`
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

const collationOf = (v: Value) => (v?.kind === 'string' ? v.collationId : v?.kind === 'bytes' ? CHARSET_BINARY : undefined)
const nameOf = (id: number) => (id === CHARSET_BINARY ? 'binary' : requireCollationInfo(id).name)

/** The first string collation, with 3995 for mixed binary and text operands. */
function pairCollation(a: Value, b: Exclude<Value, null>, fn: string): number {
  const x = collationOf(a)
  const y = collationOf(b)
  if (x !== undefined && y !== undefined && (x === CHARSET_BINARY) !== (y === CHARSET_BINARY)) {
    throw sqlError('ER_CHARACTER_SET_MISMATCH', `Character set '${nameOf(x)}' cannot be used in conjunction with '${nameOf(y)}' in call to ${fn}.`)
  }
  return x ?? y ?? CHARSET_BINARY
}

/** ICU reads a binary string through MySQL's latin1 map, independent of the host decoder. */
const textOf = (v: Exclude<Value, null>): string => (v.kind === 'bytes' ? decodeCharset(v.v, 'latin1') : toText(v))

/** The engine's pattern for `pattern` over `subject`. */
function regexpFor(subject: Value, pattern: Exclude<Value, null>, type: MatchType | undefined, fn: string, searching = true): IcuPattern & { readonly re: RegExp } {
  const base = pairCollation(subject, pattern, fn)
  const collation = subject?.kind === 'string' && pattern.kind === 'string' ? aggregateCollation(subject, pattern) : base
  const text = textOf(pattern)
  if (text === '' || text.includes('[[:<:]]') || text.includes('[[:>:]]')) throw illegal()
  const shape = shapeOf(text)
  if (shape.depth >= 100) throw sqlError('ER_REGEXP_INTERNAL_ERROR', 'Internal error in the regular expression library.')
  const c = compiled(text, { i: type?.i ?? nameOf(collation).endsWith('_ci'), m: type?.m ?? false, s: type?.s ?? false, d: type?.d ?? false })
  if (searching && shape.nested && subject !== null && [...textOf(subject)].length > RUNAWAY_LENGTH) throw sqlError('ER_REGEXP_TIME_OUT', 'Timeout exceeded in regular expression match.')
  return c
}

/** Whether `subject` matches `pattern`, as REGEXP_LIKE has it; NULL in, NULL out. */
export function regexpLike(subject: Value, pattern: Value, type: MatchType | undefined): boolean | null {
  if (pattern === null) return null
  const { re } = regexpFor(subject, pattern, type, 'regexp_like')
  if (subject === null) return null
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
//   - REGEXP_REPLACE uses occurrence 0 for every match, a negative occurrence
//     for the first match, or a positive occurrence for the nth match. The
//     text before the position is kept. The
//     replacement is ICU's: `$n` a group (3686 past the last one), `\x` the
//     character x, and a `$` not before a digit 3887.

const outOfBounds = () => sqlError('ER_REGEXP_INDEX_OUTOFBOUNDS_ERROR', 'Index out of bounds in regular expression search.')

/**
 * The UTF-16 offset of 1-based character `pos`. REGEXP_INSTR takes a
 * position in the subject, any in an empty one; REGEXP_SUBSTR and
 * REGEXP_REPLACE also the place just past its end, and call a position below
 * 1 their arguments' fault, 1583 (8.4.11). Past that, 3686.
 */
function offsetOf(text: string, pos: number, binary: boolean, fn: string): number {
  const length = charsBefore(text, text.length, binary)
  const instr = fn === 'regexp_instr'
  if (instr && length === 0) return 0
  if (pos < 1 || pos > length + (instr ? 0 : 1)) throw outOfBounds()
  if (binary) return pos - 1
  let offset = 0
  for (let i = 1; i < pos; i++) offset += (text.codePointAt(offset) as number) > 0xffff ? 2 : 1
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
function nth(re: RegExp, text: string, start: number, occurrence: number): RegExpExecArray | undefined {
  let n = occurrence || 1
  for (const m of matchesFrom(re, text, start)) if (--n === 0) return m
  return undefined
}

interface Search {
  readonly subject: Value
  readonly pattern: Value
  readonly position: number | null
  readonly occurrence: number
  readonly type: MatchType | undefined
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

/** Compile the pattern once before any matching work. */
export function regexpSearch(s: Search, fn: string, searching: boolean, returnEnd: boolean, replacement: Value): string | bigint | undefined {
  if (replacement) pairCollation(s.subject ?? s.pattern, replacement, fn)
  const pattern = s.pattern && regexpFor(s.subject, s.pattern, s.type, fn, searching)
  if (fn !== 'regexp_instr' && s.position !== null && s.position < 1) throw sqlError('ER_WRONG_PARAMETERS_TO_NATIVE_FCT', `Incorrect parameters in the call to native function '${fn}'`)
  if (!pattern || !searching || !s.subject || s.position === null) return undefined
  const { re, groups, names } = pattern
  const text = textOf(s.subject)
  const binary = s.subject.kind === 'bytes'
  const start = offsetOf(text, s.position, binary, fn)
  const occurrence = s.occurrence < 0 ? 1 : s.occurrence
  if (replacement) {
    const pieces = replacementOf(textOf(replacement), groups.length - 1, names)
    const expand = (m: RegExpExecArray): string => pieces.map((p) => (typeof p === 'string' ? p : (m[groups[p] as number] ?? ''))).join('')
    let out = text.slice(0, start)
    let at = start
    let n = 0
    for (const m of matchesFrom(re, text, start)) {
      n++
      if (occurrence > 0 && n !== occurrence) continue
      out += text.slice(at, m.index) + expand(m)
      at = m.index + m[0].length
      if (occurrence > 0) break
    }
    return out + text.slice(at)
  }
  const match = nth(re, text, start, occurrence)
  if (fn === 'regexp_substr') return match?.[0]
  if (match === undefined) return 0n
  return BigInt(charsBefore(text, match.index + (returnEnd ? match[0].length : 0), binary) + 1)
}

/** The narrowed REGEXP_INSTR return option selects the start or end. */
export function regexpReturnEnd(option: number): boolean {
  if (option !== 0 && option !== 1) throw sqlError('ER_WRONG_ARGUMENTS', 'Incorrect arguments to regexp_instr: return_option must be 1 or 0.')
  return option === 1
}
