// M5.10 — ICU's regular expression syntax, read as ICU reads it and written
// out as the engine's RegExp (`v` mode).
//
// MySQL 8 matches with ICU, whose pattern language is not the engine's:
// `\Q…\E` quoting, `(?#…)` comments, `(?x)` free spacing (inside brackets
// and intervals too), flags switched on and off anywhere, possessive
// quantifiers and atomic groups, `&&` and `--` between sets, `[:alpha:]`
// with no outer brackets, properties named loosely (`\p{lowercase letter}`),
// `\x{…}`, `\N`, `\h`, `\R`, `\X`, `\A`, `\z`, `\Z`, and `.`, `^`, `$`
// that know seven line terminators. So the pattern is parsed here, every
// refusal given ICU's number, and the result written in the engine's syntax.
// What 8.4.11 answered, beyond what that list says:
//
//   - A syntax error is 3688 at the line and character ICU stopped at (the
//     offending one; the last one when the pattern ends early). A quantifier
//     with nothing to repeat, after another, or after `\b` or a lookaround is
//     one; after `^` or `$` it is not. So are a lone `{` or `}`, and a group
//     name not starting with a letter. A name with any other character, a
//     duplicate, or `\k<x>` before `(?<x>…)` is 3887; a flag group the
//     pattern ends inside is 3900.
//   - An interval missing a number or its brace is 3692; a number past
//     16,777,215 is 4007. A backreference past the last group is 3694, and
//     `\10` is `\1` then `0` while there is one group.
//   - A lookbehind must have a bounded length: `*`, `+`, `{n,}`, a
//     backreference or `\X` inside one is 3695.
//   - `\x{…}` takes one to seven hex digits, `\u` four, `\U` eight, `\0` one to
//     three octal ones, else 3689; so is a trailing `\`. Another letter
//     escaped is itself (`\y` is `y`, `\c` at the end `c`); `\pL`, `\p{^L}`,
//     an unknown property and a lone `\N` are 3685.
//   - In brackets, `]` first is literal, `[]` is unclosed, `-` is literal
//     first, last or after a set, `[a-\w]` and a leading `--` are 3688,
//     `[b-a]` is 3697 and so is a range the pattern ends in.
//   - `.` matches no line terminator without `n`; `$` matches before a final
//     one; `^` and `$` under `m` see all seven, and never split `\r\n`.
//     `(?d)` makes `\n` the only one.
//   - `\w`, `\b` and `\B` are Unicode's, so `'aé' REGEXP 'a\\b'` is 0.
//
// Named divergences: `\N{name}` and Unicode blocks (`\p{InBasicLatin}`) are
// refused with 1235, there being no name table here; `\G` is supported
// only where a pattern begins; a backreference to a group that has not
// matched matches the empty string here and fails in ICU; under mixed
// case-sensitivity (`a(?i)b`), only characters and ranges in a
// case-insensitive stretch fold, not properties or backreferences; `\X` is
// a character and its marks, not a full grapheme cluster, and its warning
// 4077 is not raised.
import { messages, sqlError } from '@myjs/protocol'

/** One compiled pattern: the engine's source and flags, and where ICU's groups went. */
export interface IcuPattern {
  readonly source: string
  readonly flags: string
  /** ICU's group n is the engine's group `groups[n]`; `groups[0]` is 0. */
  readonly groups: readonly number[]
  readonly names: ReadonlyMap<string, number>
}

export interface IcuFlags {
  readonly insensitive: boolean
  readonly multiline: boolean
  readonly dotAll: boolean
}

interface Flags {
  i: boolean
  m: boolean
  s: boolean
  x: boolean
  d: boolean
}

/** ICU's `\w`: `[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}‌‍]`. */
const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u{200C}\\u{200D}'
/** The line terminators: LF, VT, FF, CR, NEL, LS, PS. */
const TERMINATORS = '\\n\\x0B\\f\\r\\x85\\u2028\\u2029'
/** `[:name:]` and `\p{name}` for UTS #18's POSIX-compatible names, as ICU defines them. */
const POSIX: Readonly<Record<string, string>> = {
  alpha: '\\p{Alphabetic}',
  lower: '\\p{Lowercase}',
  upper: '\\p{Uppercase}',
  punct: '\\p{P}',
  digit: '\\p{Nd}',
  xdigit: '[\\p{Nd}\\p{Hex_Digit}]',
  alnum: '[\\p{Alphabetic}\\p{Nd}]',
  space: '\\p{White_Space}',
  blank: '[\\t\\p{Zs}]',
  cntrl: '\\p{Cc}',
  graph: '[^\\p{White_Space}\\p{Cc}\\p{Cs}\\p{Cn}]',
  print: '[[\\t\\p{Zs}[^\\p{White_Space}\\p{Cc}\\p{Cs}\\p{Cn}]]--\\p{Cc}]',
  word: `[${WORD}]`,
  any: '\\p{Any}',
  ascii: '\\p{ASCII}',
  assigned: '\\p{Assigned}',
}

const MAX_NUMBER = 16777215

const err = {
  syntax: (line: number, char: number) => sqlError('ER_REGEXP_RULE_SYNTAX', `Syntax error in regular expression on line ${line}, character ${char}.`),
  escape: () => sqlError('ER_REGEXP_BAD_ESCAPE_SEQUENCE', 'Unrecognized escape sequence in regular expression.'),
  paren: () => sqlError('ER_REGEXP_MISMATCHED_PAREN', 'Mismatched parenthesis in regular expression.'),
  interval: () => sqlError('ER_REGEXP_BAD_INTERVAL', 'Incorrect description of a {min,max} interval.'),
  maxLtMin: () => sqlError('ER_REGEXP_MAX_LT_MIN', 'The maximum is less than the minumum in a {min,max} interval.'),
  backRef: () => sqlError('ER_REGEXP_INVALID_BACK_REF', 'Invalid back-reference in regular expression.'),
  lookBehind: () => sqlError('ER_REGEXP_LOOK_BEHIND_LIMIT', 'The look-behind assertion exceeds the limit in regular expression.'),
  bracket: () => sqlError('ER_REGEXP_MISSING_CLOSE_BRACKET', 'The regular expression contains an unclosed bracket expression.'),
  range: () => sqlError('ER_REGEXP_INVALID_RANGE', 'The regular expression contains an [x-y] character range where x comes after y.'),
  name: () => sqlError('ER_REGEXP_INVALID_CAPTURE_GROUP_NAME', 'A capture group has an invalid name.'),
  flag: () => sqlError('ER_REGEXP_INVALID_FLAG', 'Invalid match mode flag in regular expression.'),
  tooBig: () => sqlError('ER_REGEX_NUMBER_TOO_BIG', 'Decimal number in regular expression is too large.'),
  illegal: () => sqlError('ER_REGEXP_ILLEGAL_ARGUMENT', 'Illegal argument to a regular expression.'),
  unsupported: (what: string) => sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(what)),
}

// --- The tree ---------------------------------------------------------------

type Node =
  | { readonly t: 'char'; readonly cp: number; readonly i: boolean }
  | { readonly t: 'set'; readonly set: SetNode; readonly i: boolean }
  /** Engine syntax that needs no translation, with its length bounds. */
  | { readonly t: 'raw'; readonly src: string; readonly min: number; readonly max: number }
  /** A zero-width assertion; `quantifiable` as `^` is and `\b` is not. */
  | { readonly t: 'assert'; readonly src: string; readonly quantifiable: boolean }
  | { readonly t: 'group'; readonly kind: GroupKind; readonly body: Node[][]; readonly index: number }
  | { readonly t: 'ref'; readonly n: number }
  | { readonly t: 'quant'; readonly atom: Node; readonly min: number; readonly max: number; readonly mode: '' | '?' | '+' }

type GroupKind = 'capture' | 'plain' | 'atomic' | '=' | '!' | '<=' | '<!'

/** A bracket expression: items united, then `&&` and `--` applied left to right, then `^`. */
interface SetNode {
  readonly negated: boolean
  readonly terms: readonly { readonly op: '' | '&&' | '--'; readonly items: SetItem[] }[]
}
type SetItem = { readonly t: 'char'; readonly cp: number } | { readonly t: 'range'; readonly from: number; readonly to: number } | { readonly t: 'class'; readonly src: string } | { readonly t: 'set'; readonly set: SetNode }

/** One character as the parser sees it: quoted by `\Q…\E` or not, and where it stood. */
interface Ch {
  readonly cp: number
  readonly at: number
  readonly quoted: boolean
}

const isDigit = (cp: number | undefined) => cp !== undefined && cp >= 0x30 && cp <= 0x39
const isLetter = (cp: number | undefined) => cp !== undefined && ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a))
const hexValue = (cp: number | undefined): number => {
  if (cp === undefined) return -1
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30
  if (cp >= 0x41 && cp <= 0x46) return cp - 0x37
  if (cp >= 0x61 && cp <= 0x66) return cp - 0x57
  return -1
}
const isSpace = (cp: number) => /\p{White_Space}/u.test(String.fromCodePoint(cp))
const C = (s: string) => s.codePointAt(0) as number

class Parser {
  private readonly cps: number[]
  private i = 0
  private quoting = false
  private groupCount = 0
  readonly names = new Map<string, number>()
  readonly totalGroups: number
  /** Case-sensitivity seen: whether a stretch of each kind holds anything. */
  readonly seen = { i: false, c: false }
  sticky = false

  constructor(pattern: string) {
    this.cps = Array.from(pattern, (c) => c.codePointAt(0) as number)
    this.totalGroups = countGroups(this.cps)
  }

  /** 3688 at the character at `at`, counted in lines as ICU counts them. */
  syntax(at: number): unknown {
    const end = Math.max(0, Math.min(at, this.cps.length - 1))
    let line = 1
    let char = 0
    for (let k = 0; k <= end; k++) {
      const c = this.cps[k] as number
      if (c === 0x0d || c === 0x85 || c === 0x2028 || (c === 0x0a && this.cps[k - 1] !== 0x0d)) {
        line++
        char = 0
      } else char++
    }
    return err.syntax(line, Math.max(char, 1))
  }

  /** The next character, past `\Q`, `\E`, `(?#…)` and, under `x`, white space and `#` comments; it is not consumed. */
  private scan(x: boolean, inSet: boolean): { ch: Ch | undefined; i: number; quoting: boolean } {
    let i = this.i
    let quoting = this.quoting
    for (;;) {
      const c = this.cps[i]
      if (c === undefined) return { ch: undefined, i, quoting }
      if (c === 0x5c && this.cps[i + 1] === C('E') && quoting) {
        quoting = false
        i += 2
        continue
      }
      if (quoting) return { ch: { cp: c, at: i, quoted: true }, i: i + 1, quoting }
      if (c === 0x5c && this.cps[i + 1] === C('Q')) {
        quoting = true
        i += 2
        continue
      }
      if (x && isSpace(c)) {
        i++
        continue
      }
      if (x && c === C('#')) {
        while (i < this.cps.length && this.cps[i] !== 0x0a) i++
        continue
      }
      if (!inSet && c === C('(') && this.cps[i + 1] === C('?') && this.cps[i + 2] === C('#')) {
        const close = this.cps.indexOf(C(')'), i + 3)
        if (close < 0) throw err.paren()
        i = close + 1
        continue
      }
      return { ch: { cp: c, at: i, quoted: false }, i: i + 1, quoting }
    }
  }

  peek(f: Flags, inSet = false): Ch | undefined {
    return this.scan(f.x, inSet).ch
  }

  take(f: Flags, inSet = false): Ch | undefined {
    const s = this.scan(f.x, inSet)
    this.i = s.i
    this.quoting = s.quoting
    return s.ch
  }

  /** The next code point exactly as written, for the inside of an escape. */
  private raw(): number | undefined {
    return this.cps[this.i++]
  }

  private rawPeek(offset = 0): number | undefined {
    return this.cps[this.i + offset]
  }

  /** Whether the next character is `cp`, unquoted. */
  private is(f: Flags, cp: string, inSet = false): boolean {
    const ch = this.peek(f, inSet)
    return ch !== undefined && !ch.quoted && ch.cp === C(cp)
  }

  // --- Alternation, sequence, term ---

  parseAlternation(f: Flags, depth: number): Node[][] {
    const alts: Node[][] = [this.parseSequence(f)]
    while (this.is(f, '|')) {
      this.take(f)
      alts.push(this.parseSequence(f))
    }
    const ch = this.peek(f)
    if (depth === 0 && ch !== undefined) throw err.paren()
    return alts
  }

  private parseSequence(f: Flags): Node[] {
    const seq: Node[] = []
    for (;;) {
      const ch = this.peek(f)
      if (ch === undefined) return seq
      if (!ch.quoted && (ch.cp === C('|') || ch.cp === C(')'))) return seq
      const atom = this.parseAtom(f, seq.length === 0)
      if (atom === undefined) continue
      seq.push(this.quantified(f, atom))
    }
  }

  private quantified(f: Flags, atom: Node): Node {
    const ch = this.peek(f)
    if (ch === undefined || ch.quoted || !'*+?{'.includes(String.fromCodePoint(ch.cp))) return atom
    if ((atom.t === 'assert' && !atom.quantifiable) || (atom.t === 'group' && atom.kind !== 'capture' && atom.kind !== 'plain' && atom.kind !== 'atomic')) throw this.syntax(ch.at)
    this.take(f)
    let min = 0
    let max = Infinity
    if (ch.cp === C('+')) min = 1
    else if (ch.cp === C('?')) max = 1
    else if (ch.cp === C('{')) [min, max] = this.interval(f)
    let mode: '' | '?' | '+' = ''
    const suffix = this.peek(f)
    if (suffix !== undefined && !suffix.quoted && (suffix.cp === C('?') || suffix.cp === C('+'))) {
      this.take(f)
      mode = suffix.cp === C('?') ? '?' : '+'
    }
    const next = this.peek(f)
    if (next !== undefined && !next.quoted && '*+?{'.includes(String.fromCodePoint(next.cp))) throw this.syntax(next.at)
    return { t: 'quant', atom, min, max, mode }
  }

  /** `{n}`, `{n,}`, `{n,m}`, the `{` taken. */
  private interval(f: Flags): [number, number] {
    const number = (): number | undefined => {
      let n: number | undefined
      for (let ch = this.peek(f); ch !== undefined && !ch.quoted && isDigit(ch.cp); ch = this.peek(f)) {
        this.take(f)
        n = (n ?? 0) * 10 + ch.cp - 0x30
        if (n > MAX_NUMBER) throw err.tooBig()
      }
      return n
    }
    const min = number()
    if (min === undefined) throw err.interval()
    let max = min
    if (this.is(f, ',')) {
      this.take(f)
      max = number() ?? Infinity
    }
    if (!this.is(f, '}')) throw err.interval()
    this.take(f)
    if (max < min) throw err.maxLtMin()
    return [min, max]
  }

  /** One atom, or undefined for what matches nothing (a flag group). */
  private parseAtom(f: Flags, first: boolean): Node | undefined {
    const ch = this.take(f) as Ch
    if (ch.quoted) return this.char(f, ch.cp)
    switch (String.fromCodePoint(ch.cp)) {
      case '(':
        return this.group(f, ch)
      case '[': {
        // `[:alpha:]` needs no outer brackets.
        const posix = this.rawPeek() === C(':') ? this.posixAtom() : undefined
        if (posix === undefined) return this.bracket(f, ch)
        this.seen[f.i ? 'i' : 'c'] = true
        return { t: 'set', set: { negated: false, terms: [{ op: '', items: [{ t: 'class', src: posix }] }] }, i: f.i }
      }
      case '.':
        return { t: 'raw', src: f.s ? '[\\s\\S]' : f.d ? '[^\\n]' : `[^${TERMINATORS}]`, min: 1, max: 1 }
      case '^':
        return { t: 'assert', src: caret(f), quantifiable: true }
      case '$':
        return { t: 'assert', src: dollar(f), quantifiable: true }
      case '\\':
        return this.escape(f, first)
      case '*':
      case '+':
      case '?':
      case '{':
      case '}':
        throw this.syntax(ch.at)
      default:
        return this.char(f, ch.cp)
    }
  }

  private char(f: Flags, cp: number): Node {
    if (hasCase(cp)) this.seen[f.i ? 'i' : 'c'] = true
    return { t: 'char', cp, i: f.i }
  }

  private group(f: Flags, open: Ch): Node | undefined {
    let kind: GroupKind = 'capture'
    let name: string | undefined
    const inner: Flags = { ...f }
    if (this.is(f, '?')) {
      this.take(f)
      const c = this.raw()
      const at = this.i - 1
      if (c === undefined) throw this.syntax(at)
      switch (String.fromCodePoint(c)) {
        case ':':
          kind = 'plain'
          break
        case '>':
          kind = 'atomic'
          break
        case '=':
        case '!':
          kind = String.fromCodePoint(c) as GroupKind
          break
        case '<': {
          const d = this.raw()
          if (d === C('=') || d === C('!')) {
            kind = d === C('=') ? '<=' : '<!'
            break
          }
          if (!isLetter(d)) throw this.syntax(this.i - 1)
          name = String.fromCodePoint(d as number)
          for (let e = this.raw(); e !== C('>'); e = this.raw()) {
            if (e === undefined || !(isLetter(e) || isDigit(e))) throw err.name()
            name += String.fromCodePoint(e)
          }
          if (this.names.has(name)) throw err.name()
          break
        }
        default: {
          // Flags: `(?ismwxd-ismwxd)` for the rest of the group, `(?…:…)` for its own.
          let on = true
          let any = false
          for (let e: number | undefined = c; ; e = this.raw()) {
            if (e === undefined) throw err.flag()
            const letter = String.fromCodePoint(e)
            if (letter === ')' || letter === ':') {
              if (!any && letter === ')' && on) throw this.syntax(this.i - 1)
              if (letter === ')') {
                Object.assign(f, inner)
                return undefined
              }
              kind = 'plain'
              break
            }
            any = true
            if (letter === '-' && on) on = false
            else if ('imsxd'.includes(letter)) inner[letter as keyof Flags] = on
            else if (letter !== 'w' && letter !== 'u') throw this.syntax(this.i - 1)
          }
        }
      }
    }
    void open
    const index = kind === 'capture' ? ++this.groupCount : 0
    if (name !== undefined) this.names.set(name, index)
    const body = this.parseAlternation(inner, 1)
    if (!this.is(inner, ')')) throw err.paren()
    this.take(inner)
    const node: Node = { t: 'group', kind, body, index }
    if (kind === '<=' || kind === '<!') {
      if (alternationBounds(body).max === Infinity) throw err.lookBehind()
    }
    return node
  }

  /** What follows `\`, outside brackets. */
  private escape(f: Flags, first: boolean): Node {
    const c = this.raw()
    if (c === undefined) throw err.escape()
    const letter = String.fromCodePoint(c)
    if (isDigit(c) && c !== 0x30) {
      let n = c - 0x30
      while (isDigit(this.rawPeek()) && n * 10 + ((this.rawPeek() as number) - 0x30) <= this.totalGroups) n = n * 10 + ((this.raw() as number) - 0x30)
      if (n > this.totalGroups) throw err.backRef()
      return { t: 'ref', n }
    }
    switch (letter) {
      case 'b':
        return { t: 'assert', src: `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`, quantifiable: false }
      case 'B':
        return { t: 'assert', src: `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`, quantifiable: false }
      case 'A':
        return { t: 'assert', src: '(?<![\\s\\S])', quantifiable: true }
      case 'z':
        return { t: 'assert', src: '(?![\\s\\S])', quantifiable: true }
      case 'Z':
        return { t: 'assert', src: dollar({ ...f, m: false }), quantifiable: true }
      case 'G':
        // The end of the previous match: the engine's sticky flag, where a pattern begins.
        if (!first) throw err.unsupported('\\G after the start of a regular expression')
        this.sticky = true
        return { t: 'assert', src: '', quantifiable: true }
      case 'R':
        return { t: 'raw', src: `(?:\\r\\n|[${TERMINATORS}])`, min: 1, max: 2 }
      case 'X':
        return { t: 'raw', src: '(?:\\r\\n|\\P{M}\\p{M}*)', min: 1, max: Infinity }
      case 'N':
        if (this.rawPeek() !== C('{')) throw err.illegal()
        throw err.unsupported('\\N{name} in a regular expression')
      case 'k': {
        if (this.raw() !== C('<')) throw err.name()
        let name = ''
        for (let e = this.raw(); e !== C('>'); e = this.raw()) {
          if (e === undefined) throw err.name()
          name += String.fromCodePoint(e)
        }
        const n = this.names.get(name)
        if (n === undefined) throw err.name()
        return { t: 'ref', n }
      }
    }
    const cls = this.classEscape(c)
    if (cls !== undefined) {
      this.seen[f.i ? 'i' : 'c'] = true
      return { t: 'set', set: { negated: false, terms: [{ op: '', items: [{ t: 'class', src: cls }] }] }, i: f.i }
    }
    return this.char(f, this.charEscape(c))
  }

  /** `\d`, `\w`, `\p{…}` and their kind: the engine's syntax for the class, or undefined. */
  private classEscape(c: number): string | undefined {
    switch (String.fromCodePoint(c)) {
      case 'd':
        return '\\p{Nd}'
      case 'D':
        return '\\P{Nd}'
      case 's':
        return '\\p{White_Space}'
      case 'S':
        return '\\P{White_Space}'
      case 'w':
        return `[${WORD}]`
      case 'W':
        return `[^${WORD}]`
      case 'h':
        return '[\\t\\p{Zs}]'
      case 'H':
        return '[^\\t\\p{Zs}]'
      case 'v':
        return `[${TERMINATORS}]`
      case 'V':
        return `[^${TERMINATORS}]`
      case 'p':
      case 'P': {
        if (this.raw() !== C('{')) throw err.illegal()
        let name = ''
        for (let e = this.raw(); e !== C('}'); e = this.raw()) {
          if (e === undefined) throw err.illegal()
          name += String.fromCodePoint(e)
        }
        const p = property(name)
        return c === C('P') ? `[^${p}]` : p
      }
    }
    return undefined
  }

  /** A character escape's code point, `\` and the letter taken. */
  private charEscape(c: number): number {
    const hex = (count: number, exact: boolean): number => {
      let n = 0
      let k = 0
      for (; k < count && hexValue(this.rawPeek()) >= 0; k++) n = n * 16 + hexValue(this.raw())
      if (k === 0 || (exact && k < count)) throw err.escape()
      return n
    }
    switch (String.fromCodePoint(c)) {
      case 'a':
        return 7
      case 'e':
        return 0x1b
      case 'f':
        return 0x0c
      case 'n':
        return 0x0a
      case 'r':
        return 0x0d
      case 't':
        return 9
      case 'c': {
        const d = this.raw()
        return d === undefined ? c : d & 0x1f
      }
      case 'x': {
        if (this.rawPeek() !== C('{')) return hex(2, false)
        this.raw()
        const n = hex(7, false)
        if (this.raw() !== C('}') || n > 0x10ffff) throw err.escape()
        return n
      }
      case 'u':
        return hex(4, true)
      case 'U': {
        const n = hex(8, true)
        if (n > 0x10ffff) throw err.escape()
        return n
      }
      case '0': {
        let n = 0
        let k = 0
        for (; k < 3 && (this.rawPeek() ?? 0) >= 0x30 && (this.rawPeek() ?? 0) <= 0x37; k++) n = n * 8 + (this.raw() as number) - 0x30
        if (k === 0) throw err.escape()
        return n
      }
    }
    return c
  }

  // --- Brackets ---

  private bracket(f: Flags, open: Ch): Node {
    this.seen[f.i ? 'i' : 'c'] = true
    return { t: 'set', set: this.setBody(f, open), i: f.i }
  }

  /** A bracket expression's inside and its `]`, the `[` taken. */
  private setBody(f: Flags, open: Ch): SetNode {
    const end = () => {
      throw this.i >= this.cps.length && pendingRange ? err.range() : err.bracket()
    }
    let pendingRange = false
    let negated = false
    if (this.is(f, '^', true)) {
      this.take(f, true)
      negated = true
    }
    const terms: { op: '' | '&&' | '--'; items: SetItem[] }[] = [{ op: '', items: [] }]
    let items = (terms[0] as { items: SetItem[] }).items
    let first = true
    // The last item, when it is a single character a `-` could start a range from.
    let last: number | undefined
    for (;;) {
      const ch = this.take(f, true)
      if (ch === undefined) return end()
      const was = first
      first = false
      if (ch.quoted) {
        items.push({ t: 'char', cp: ch.cp })
        last = ch.cp
        continue
      }
      const s = String.fromCodePoint(ch.cp)
      if (s === ']' && !was) return { negated, terms }
      if ((s === '&' || s === '-') && this.is(f, s, true)) {
        const second = this.take(f, true) as Ch
        if (was) throw this.syntax(second.at)
        items = []
        terms.push({ op: s === '&' ? '&&' : '--', items })
        last = undefined
        continue
      }
      if (s === '-' && last !== undefined && !was) {
        const next = this.peek(f, true)
        if (next === undefined) {
          pendingRange = true
          return end()
        }
        if (next.quoted || next.cp !== C(']')) {
          const to = this.setChar(f)
          if (to === undefined) throw this.syntax(this.i - 1)
          if (to < last) throw err.range()
          items.pop()
          items.push({ t: 'range', from: last, to })
          last = undefined
          continue
        }
      }
      if (s === '[') {
        if (this.rawPeek() === C(':')) {
          const posix = this.posix()
          if (posix !== undefined) {
            items.push({ t: 'class', src: posix })
            last = undefined
            continue
          }
        }
        items.push({ t: 'set', set: this.setBody(f, ch) })
        last = undefined
        continue
      }
      if (s === '\\') {
        const c = this.raw()
        if (c === undefined) return end()
        if (c === C('N')) {
          if (this.rawPeek() !== C('{')) throw err.illegal()
          throw err.unsupported('\\N{name} in a regular expression')
        }
        const cls = this.classEscape(c)
        if (cls !== undefined) {
          items.push({ t: 'class', src: cls })
          last = undefined
          continue
        }
        const cp = this.charEscape(c)
        items.push({ t: 'char', cp })
        last = cp
        continue
      }
      items.push({ t: 'char', cp: ch.cp })
      last = ch.cp
    }
    void open
  }

  /** A range's end: one character, or undefined when it is a set. */
  private setChar(f: Flags): number | undefined {
    const ch = this.take(f, true) as Ch
    if (ch.quoted) return ch.cp
    if (ch.cp === C('[')) return undefined
    if (ch.cp !== C('\\')) return ch.cp
    const c = this.raw()
    if (c === undefined) throw err.bracket()
    if ('dDsSwWhHvVpPN'.includes(String.fromCodePoint(c))) return undefined
    return this.charEscape(c)
  }

  /** `[:name:]` or `[:^name:]`, the `[` taken; undefined, nothing consumed, when it is not one. */
  private posix(): string | undefined {
    const close = this.cps.indexOf(C(':'), this.i + 1)
    if (close < 0 || this.cps[close + 1] !== C(']')) return undefined
    let name = String.fromCodePoint(...this.cps.slice(this.i + 1, close))
    const negated = name.startsWith('^')
    if (negated) name = name.slice(1)
    this.i = close + 2
    const p = property(name)
    return negated ? `[^${p}]` : p
  }

  /** `[:name:]` where an atom may stand, outside brackets. */
  posixAtom(): string | undefined {
    return this.posix()
  }
}

/** ICU's capturing groups, counted before parsing so `\10` can know whether there are ten. */
function countGroups(cps: readonly number[]): number {
  let n = 0
  let inSet = 0
  let quoting = false
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]
    if (quoting) {
      if (c === 0x5c && cps[i + 1] === C('E')) quoting = false
      continue
    }
    if (c === 0x5c) {
      if (cps[i + 1] === C('Q')) quoting = true
      i++
      continue
    }
    if (c === C('[')) inSet++
    else if (c === C(']') && inSet > 0) inSet--
    else if (c === C('(') && inSet === 0) {
      if (cps[i + 1] !== C('?')) n++
      else if (cps[i + 2] === C('<') && cps[i + 3] !== C('=') && cps[i + 3] !== C('!')) n++
    }
  }
  return n
}

const hasCase = (cp: number): boolean => {
  const s = String.fromCodePoint(cp)
  return s.toLowerCase() !== s || s.toUpperCase() !== s
}

function caret(f: Flags): string {
  if (!f.m) return '(?<![\\s\\S])'
  return f.d ? '(?:(?<![\\s\\S])|(?<=\\n)(?=[\\s\\S]))' : `(?:(?<![\\s\\S])|(?<=[${TERMINATORS}])(?!(?<=\\r)\\n)(?=[\\s\\S]))`
}

function dollar(f: Flags): string {
  if (f.d) return f.m ? '(?=\\n|(?![\\s\\S]))' : '(?=\\n?(?![\\s\\S]))'
  return f.m ? `(?=[${TERMINATORS}]|(?![\\s\\S]))(?!(?<=\\r)\\n)` : `(?=(?:\\r\\n|[${TERMINATORS}])?(?![\\s\\S]))(?!(?<=\\r)\\n)`
}

const valid = (src: string): boolean => {
  try {
    new RegExp(src, 'v')
    return true
  } catch {
    return false
  }
}

/**
 * A property named as ICU allows: loosely (case, spaces, `-` and `_` do
 * not matter, `Is` may lead), as `key=value`, or as one of UTS #18's POSIX
 * names. 3685 when nothing has that name.
 */
function property(name: string): string {
  const loose = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
  if (name.startsWith('^')) throw err.illegal()
  const eq = name.indexOf('=')
  const key = eq < 0 ? undefined : loose(name.slice(0, eq))
  const value = eq < 0 ? name : name.slice(eq + 1)
  if (key === undefined) {
    const posix = POSIX[loose(value)]
    if (posix !== undefined) return posix
    if (/^in/i.test(value.trim()) && !valid(`\\p{${value.trim()}}`) && !valid(`\\p{Script=${value.trim()}}`)) {
      const rest = value.trim().slice(2)
      if (rest !== '' && candidates(rest).every((c) => !valid(`\\p{${c}}`) && !valid(`\\p{Script=${c}}`))) throw err.unsupported('Unicode blocks in a regular expression')
    }
  }
  const prefixes =
    key === undefined ? ['', 'Script='] : key === 'gc' || key === 'generalcategory' ? ['General_Category='] : key === 'sc' || key === 'script' ? ['Script='] : key === 'scx' || key === 'scriptextensions' ? ['Script_Extensions='] : undefined
  if (prefixes === undefined) throw err.illegal()
  for (const v of [value, ...(key === undefined && /^is/i.test(value.trim()) ? [value.trim().slice(2)] : [])]) {
    for (const c of candidates(v)) for (const p of prefixes) if (valid(`\\p{${p}${c}}`)) return `\\p{${p}${c}}`
  }
  throw err.illegal()
}

/** The spellings the engine's exact names could take for a loosely written one. */
function candidates(name: string): string[] {
  const words = name.trim().split(/[\s_-]+/).filter((w) => w !== '')
  if (words.length === 0) return []
  const title = words.map((w) => (w[0] as string).toUpperCase() + w.slice(1).toLowerCase())
  return [...new Set([name.trim(), words.join('_'), title.join('_'), title.join(''), words.join('').toUpperCase(), words.join('').toLowerCase(), words.join('')])]
}

/** A node's length in characters: bounds a lookbehind must keep finite. */
function bounds(node: Node): { min: number; max: number } {
  switch (node.t) {
    case 'char':
    case 'set':
      return { min: 1, max: 1 }
    case 'raw':
      return { min: node.min, max: node.max }
    case 'assert':
      return { min: 0, max: 0 }
    case 'ref':
      return { min: 0, max: Infinity }
    case 'group':
      if (node.kind !== 'capture' && node.kind !== 'plain' && node.kind !== 'atomic') return { min: 0, max: 0 }
      return alternationBounds(node.body)
    case 'quant': {
      const b = bounds(node.atom)
      return { min: b.min * node.min, max: node.max === 0 ? 0 : b.max * node.max }
    }
  }
}

function alternationBounds(alts: Node[][]): { min: number; max: number } {
  let min = Infinity
  let max = 0
  for (const seq of alts) {
    let a = 0
    let b = 0
    for (const n of seq) {
      const x = bounds(n)
      a += x.min
      b += x.max
    }
    min = Math.min(min, a)
    max = Math.max(max, b)
  }
  return { min, max }
}

// --- Writing the engine's syntax ------------------------------------------------

/** A code point as the engine reads it anywhere: letters and digits bare, the rest escaped. */
const literal = (cp: number): string => (isLetter(cp) || isDigit(cp) ? String.fromCodePoint(cp) : `\\u{${cp.toString(16)}}`)

/** The code points a case-insensitive match would take for `cp`. */
function variants(cp: number): number[] {
  const s = String.fromCodePoint(cp)
  const out = new Set([cp])
  for (const v of [s.toLowerCase(), s.toUpperCase(), s.toUpperCase().toLowerCase()]) if ([...v].length === 1) out.add(v.codePointAt(0) as number)
  return [...out]
}

class Writer {
  private next = 0
  readonly groups: number[] = [0]
  /** The engine's group for each capturing group, atomic group and possessive quantifier. */
  private readonly index = new Map<Node, number>()

  private readonly fold: boolean

  constructor(fold: boolean, tree: Node[][]) {
    this.fold = fold
    // Numbered first, in the order they are written, so a reference before its group is right.
    const walk = (n: Node): void => {
      if (n.t === 'group') {
        if (n.kind === 'capture' || n.kind === 'atomic') this.index.set(n, ++this.next)
        if (n.kind === 'capture') this.groups[n.index] = this.next
        for (const seq of n.body) seq.forEach(walk)
      } else if (n.t === 'quant') {
        if (n.mode === '+') this.index.set(n, ++this.next)
        walk(n.atom)
      }
    }
    for (const seq of tree) seq.forEach(walk)
  }

  alternation(alts: Node[][]): string {
    return alts.map((seq) => seq.map((n) => this.node(n)).join('')).join('|')
  }

  node(n: Node): string {
    switch (n.t) {
      case 'char':
        return this.fold && n.i && hasCase(n.cp) ? `[${variants(n.cp).map(literal).join('')}]` : literal(n.cp)
      case 'set':
        return this.set(n.set, this.fold && n.i)
      case 'raw':
      case 'assert':
        return n.src
      case 'ref':
        return `(?:\\${this.groups[n.n] as number})`
      case 'group': {
        const body = this.alternation(n.body)
        if (n.kind === 'capture') return `(${body})`
        // An atomic group: what a lookahead matched, taken whole and never given back.
        if (n.kind === 'atomic') return `(?:(?=(${body}))\\${this.index.get(n) as number})`
        return `(?${n.kind === 'plain' ? ':' : n.kind}${body})`
      }
      case 'quant': {
        const q = n.min === 0 && n.max === Infinity ? '*' : n.min === 1 && n.max === Infinity ? '+' : n.min === 0 && n.max === 1 ? '?' : `{${n.min},${n.max === Infinity ? '' : n.max}}`
        if (n.mode === '+') return `(?:(?=((?:${this.node(n.atom)})${q}))\\${this.index.get(n) as number})`
        return `(?:${this.node(n.atom)})${q}${n.mode}`
      }
    }
  }

  /** A bracket expression as a `v`-mode class. */
  private set(s: SetNode, fold: boolean): string {
    let out = ''
    for (const term of s.terms) {
      const united = `[${term.items.map((item) => this.item(item, fold)).join('')}]`
      out = term.op === '' ? united : `[${out}${term.op}${united}]`
    }
    return s.negated ? `[^${out}]` : out
  }

  private item(item: SetItem, fold: boolean): string {
    switch (item.t) {
      case 'char':
        return fold ? variants(item.cp).map(literal).join('') : literal(item.cp)
      case 'range': {
        let out = `${literal(item.from)}-${literal(item.to)}`
        // Folded one by one: a range wider than this is left as written.
        if (fold && item.to - item.from < 4096) {
          for (let cp = item.from; cp <= item.to; cp++) for (const v of variants(cp)) if (v < item.from || v > item.to) out += literal(v)
        }
        return out
      }
      case 'class':
        return item.src
      case 'set':
        return this.set(item.set, fold)
    }
  }
}

/** ICU's pattern as the engine's, or ICU's error for it. */
export function compileIcu(pattern: string, initial: IcuFlags): IcuPattern {
  const parser = new Parser(pattern)
  const flags: Flags = { i: initial.insensitive, m: initial.multiline, s: initial.dotAll, x: false, d: false }
  const tree = parser.parseAlternation(flags, 0)
  // One case-sensitivity throughout is the engine's flag; a mix is folded by hand.
  const mixed = parser.seen.i && parser.seen.c
  const writer = new Writer(mixed, tree)
  const source = writer.alternation(tree)
  const insensitive = parser.seen.i && !mixed
  return { source, flags: `v${insensitive ? 'i' : ''}${parser.sticky ? 'y' : ''}`, groups: writer.groups, names: parser.names }
}
