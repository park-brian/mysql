// M5.10 — REGEXP, RLIKE, REGEXP_LIKE, REGEXP_INSTR, REGEXP_SUBSTR and REGEXP_REPLACE.
//
// MySQL 8 matches with ICU; this matches with the engine's RegExp, in Unicode
// mode, after translating what ICU writes differently. What 8.4.11 answered:
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
//     ICU's syntax errors keep their own numbers: an unbalanced parenthesis
//     3691, an unclosed bracket 3696, a quantifier with nothing to repeat
//     3688 at its character, `{2,1}` 3693.
//
// ICU's `\w` and `\d` are Unicode's, and are translated to property classes;
// its `\b` is too, and the engine's is ASCII's, a second divergence.
//
// A named divergence: ICU folds case fully, so `'Straße' REGEXP 'STRASSE'` is
// 1 there; the engine folds code point by code point, and it is 0 here.
import { CHARSET_BINARY } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import { sqlError } from '@myjs/protocol'
import { aggregateCollation, toText, type Value } from '@myjs/types'

/** ICU's `\\w`: Unicode's word characters, where the engine's is ASCII's. */
const WORD = '\\p{L}\\p{M}\\p{Nd}\\p{Pc}'

const POSIX: Readonly<Record<string, string>> = {
  alpha: '\\p{Alphabetic}',
  digit: '\\p{Nd}',
  alnum: '\\p{Alphabetic}\\p{Nd}',
  upper: '\\p{Uppercase}',
  lower: '\\p{Lowercase}',
  space: '\\s',
  blank: '\\t\\p{Zs}',
  punct: '\\p{P}',
  xdigit: '0-9A-Fa-f',
  cntrl: '\\p{Cc}',
  print: '\\P{C}',
  graph: '^\\p{Z}\\p{C}',
  word: WORD,
}

/** ICU's Unicode-aware `\\w`, `\\W`, `\\d` and `\\D` as the engine's property classes. */
function unicodeEscapes(p: string): string {
  let out = ''
  let inClass = false
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string
    if (c === '\\' && i + 1 < p.length) {
      const n = p[++i] as string
      if (n === 'w') out += inClass ? WORD : `[${WORD}]`
      else if (n === 'W' && !inClass) out += `[^${WORD}]`
      else if (n === 'd') out += '\\p{Nd}'
      else if (n === 'D') out += '\\P{Nd}'
      else out += c + n
      continue
    }
    if (c === '[' && !inClass) inClass = true
    else if (c === ']' && inClass) inClass = false
    out += c
  }
  return out
}

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

/** ICU's pattern as the engine's: POSIX classes inside brackets, a leading `(?i)`. */
function translate(pattern: string): { source: string; insensitive?: boolean } {
  if (pattern === '' || pattern.includes('[[:<:]]') || pattern.includes('[[:>:]]')) throw illegal()
  if (shapeOf(pattern).depth >= 100) throw sqlError('ER_REGEXP_INTERNAL_ERROR', 'Internal error in the regular expression library.')
  let insensitive: boolean | undefined
  let p = pattern
  const inline = /^\(\?([a-z]*)(?:-([a-z]*))?\)/.exec(p)
  if (inline !== null) {
    if (inline[1]?.includes('i') === true) insensitive = true
    if (inline[2]?.includes('i') === true) insensitive = false
    p = p.slice(inline[0].length)
  }
  const source = unicodeEscapes(p).replace(/\[:([a-z]+):\]/g, (whole, name: string) => POSIX[name] ?? whole)
  return insensitive === undefined ? { source } : { source, insensitive }
}

/** ICU's error for a pattern the engine refuses, from what is wrong with it. */
function syntaxError(pattern: string, e: Error): unknown {
  const m = e.message
  if (/Unterminated character class/i.test(m)) return sqlError('ER_REGEXP_MISSING_CLOSE_BRACKET', 'The regular expression contains an unclosed bracket expression.')
  if (/Unterminated group|Unmatched '\)'/i.test(m)) return sqlError('ER_REGEXP_MISMATCHED_PAREN', 'Mismatched parenthesis in regular expression.')
  if (/numbers out of order/i.test(m)) return sqlError('ER_REGEXP_MAX_LT_MIN', 'The maximum is less than the minumum in a {min,max} interval.')
  if (/Nothing to repeat/i.test(m)) {
    // The character ICU stops at: a quantifier with nothing before it, or
    // one directly after another.
    let at = 0
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i] as string
      const prev = i === 0 ? '' : (pattern[i - 1] as string)
      if ('*+?'.includes(c) && (i === 0 || '(|'.includes(prev) || ('*+'.includes(prev) && (i < 2 || pattern[i - 2] !== '\\')))) {
        at = i + 1
        break
      }
    }
    return sqlError('ER_REGEXP_RULE_SYNTAX', `Syntax error in regular expression on line 1, character ${at === 0 ? 1 : at}.`)
  }
  return illegal()
}

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

const cache = new Map<string, RegExp>()

/** A pattern compiled once per flags and text. */
function compiled(source: string, flags: string, pattern: string): RegExp {
  const key = `${flags}/${source}`
  let re = cache.get(key)
  if (re === undefined) {
    try {
      re = new RegExp(source, flags)
    } catch (e) {
      throw syntaxError(pattern, e as Error)
    }
    if (cache.size > 256) cache.clear()
    cache.set(key, re)
  }
  return re
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

/** The engine's pattern for `pattern` over `subject`, `g` added when every match is wanted. */
function regexpFor(subject: Exclude<Value, null>, pattern: Exclude<Value, null>, type: MatchType | undefined, fn: string, global: boolean): RegExp {
  sameKind(subject, pattern, fn)
  const collation = collationFor(subject, pattern)
  const text = textOf(pattern)
  const translated = translate(text)
  if (shapeOf(text).nested && [...textOf(subject)].length > RUNAWAY_LENGTH) throw sqlError('ER_REGEXP_TIME_OUT', 'Timeout exceeded in regular expression match.')
  const insensitive = type?.insensitive ?? translated.insensitive ?? /_ci$/.test(nameOf(collation))
  const flags = `${global ? 'g' : ''}u${insensitive ? 'i' : ''}${type?.multiline === true ? 'm' : ''}${type?.dotAll === true ? 's' : ''}`
  return compiled(translated.source, flags, text)
}

/** Whether `subject` matches `pattern`, as REGEXP_LIKE has it; NULL in, NULL out. */
export function regexpLike(subject: Value, pattern: Value, type: MatchType | undefined): boolean | null {
  if (subject === null || pattern === null) return null
  return regexpFor(subject, pattern, type, 'regexp_like', false).test(textOf(subject))
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

/** The UTF-16 offset of 1-based character `pos`, 3686 if the subject has no such place. */
function offsetOf(text: string, pos: bigint, binary: boolean): number {
  const length = binary ? text.length : [...text].length
  if (pos < 1n || pos > BigInt(Math.max(1, length))) throw outOfBounds()
  if (binary) return Number(pos) - 1
  let offset = 0
  for (let i = 1n; i < pos; i++) offset += (text.codePointAt(offset) as number) > 0xffff ? 2 : 1
  return offset
}

/** Characters before UTF-16 offset `at`. */
const charsBefore = (text: string, at: number, binary: boolean): number => (binary ? at : [...text.slice(0, at)].length)

/** The matches of `re` in `text` from `start`, in order. */
function* matchesFrom(re: RegExp, text: string, start: number): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.flags)
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
  let n = occurrence < 1n ? 1n : occurrence
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
  const re = regexpFor(s.subject, s.pattern, s.type, 'regexp_instr', true)
  const binary = s.subject.kind === 'bytes'
  const text = textOf(s.subject)
  const m = nth(re, text, offsetOf(text, s.position, binary), s.occurrence)
  if (m === undefined) return 0n
  return BigInt(charsBefore(text, m.index + (returnEnd ? m[0].length : 0), binary) + 1)
}

/** The matched text, or undefined when there is no such match. */
export function regexpSubstr(s: Search): string | undefined {
  const re = regexpFor(s.subject, s.pattern, s.type, 'regexp_substr', true)
  const text = textOf(s.subject)
  return nth(re, text, offsetOf(text, s.position, s.subject.kind === 'bytes'), s.occurrence)?.[0]
}

type Piece = string | number

/** ICU's replacement text as literal pieces and group numbers. */
function replacementOf(text: string): Piece[] {
  const out: Piece[] = []
  let literal = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (c === '\\' && i + 1 < text.length) {
      literal += text[++i]
      continue
    }
    if (c !== '$') {
      literal += c
      continue
    }
    const digits = /^\d+/.exec(text.slice(i + 1))?.[0]
    if (digits === undefined) throw sqlError('ER_REGEXP_INVALID_CAPTURE_GROUP_NAME', 'A capture group has an invalid name.')
    if (literal !== '') out.push(literal)
    literal = ''
    out.push(Number(digits))
    i += digits.length
  }
  if (literal !== '') out.push(literal)
  return out
}

export function regexpReplace(s: Search, replacement: Exclude<Value, null>): string {
  sameKind(s.subject, replacement, 'regexp_replace')
  const re = regexpFor(s.subject, s.pattern, s.type, 'regexp_replace', true)
  const text = textOf(s.subject)
  const start = offsetOf(text, s.position, s.subject.kind === 'bytes')
  const pieces = replacementOf(textOf(replacement))
  const expand = (m: RegExpExecArray): string =>
    pieces
      .map((p) => {
        if (typeof p === 'string') return p
        if (p >= m.length) throw outOfBounds()
        return m[p] ?? ''
      })
      .join('')
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
