// M5.10 — REGEXP, RLIKE and REGEXP_LIKE.
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
// A named divergence: ICU folds case fully, so `'Straße' REGEXP 'STRASSE'` is
// 1 there; the engine folds code point by code point, and it is 0 here.
import { CHARSET_BINARY } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import { sqlError } from '@myjs/protocol'
import { aggregateCollation, toText, type Value } from '@myjs/types'

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
  word: '\\w',
}

const illegal = () => sqlError('ER_REGEXP_ILLEGAL_ARGUMENT', 'Illegal argument to a regular expression.')

/** ICU's pattern as the engine's: POSIX classes inside brackets, a leading `(?i)`. */
function translate(pattern: string): { source: string; insensitive?: boolean } {
  if (pattern === '' || pattern.includes('[[:<:]]') || pattern.includes('[[:>:]]')) throw illegal()
  let insensitive: boolean | undefined
  let p = pattern
  const inline = /^\(\?([a-z]*)(?:-([a-z]*))?\)/.exec(p)
  if (inline !== null) {
    if (inline[1]?.includes('i') === true) insensitive = true
    if (inline[2]?.includes('i') === true) insensitive = false
    p = p.slice(inline[0].length)
  }
  const source = p.replace(/\[:([a-z]+):\]/g, (whole, name: string) => POSIX[name] ?? whole)
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

/** Whether `subject` matches `pattern`, as REGEXP_LIKE has it; NULL in, NULL out. */
export function regexpLike(subject: Value, pattern: Value, type: MatchType | undefined): boolean | null {
  if (subject === null || pattern === null) return null
  const binary = (v: Exclude<Value, null>) => v.kind === 'bytes'
  const collationOf = (v: Exclude<Value, null>) => (v.kind === 'string' ? v.collationId : v.kind === 'bytes' ? CHARSET_BINARY : undefined)
  const sc = collationOf(subject)
  const pc = collationOf(pattern)
  if (sc !== undefined && pc !== undefined && (sc === CHARSET_BINARY) !== (pc === CHARSET_BINARY)) {
    throw sqlError('ER_CHARACTER_SET_MISMATCH', `Character set '${requireCollationInfo(sc).name}' cannot be used in conjunction with '${requireCollationInfo(pc).name}' in call to regexp_like.`)
  }
  let collation = sc ?? pc ?? CHARSET_BINARY
  if (subject.kind === 'string' && pattern.kind === 'string') collation = aggregateCollation(subject, pattern)
  const name = collation === CHARSET_BINARY ? 'binary' : requireCollationInfo(collation).name
  const text = (v: Exclude<Value, null>) => (binary(v) ? new TextDecoder('latin1').decode((v as { v: Uint8Array }).v) : toText(v))
  const translated = translate(text(pattern))
  const insensitive = type?.insensitive ?? translated.insensitive ?? /_ci$/.test(name)
  const flags = `u${insensitive ? 'i' : ''}${type?.multiline === true ? 'm' : ''}${type?.dotAll === true ? 's' : ''}`
  const key = `${flags}/${translated.source}`
  let re = cache.get(key)
  if (re === undefined) {
    try {
      re = new RegExp(translated.source, flags)
    } catch (e) {
      throw syntaxError(text(pattern), e as Error)
    }
    if (cache.size > 256) cache.clear()
    cache.set(key, re)
  }
  return re.test(text(subject))
}
