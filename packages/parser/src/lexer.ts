// M3.1 — the lexer: charset-aware, `sql_mode`-aware.
//
// The acceptance clause is a security property, not a formatting one:
//
//   "a `gbk` or `sjis` lead byte cannot swallow a backslash to escape a quote"
//
// In GBK, `BF 5C` is one legitimate character whose *trail* byte is `5C`, the
// ASCII backslash. A client that escapes `'` to `\'` over raw bytes emits
// `BF 5C 27`, and anything scanning bytes sees a backslash-escape followed by a
// live quote — so the quote closes the literal and everything after it is SQL.
// This is the injection doc 29 §163-165 names, and it is why that section says
// "the parser must be charset-aware when scanning string literals".
//
// **This lexer scans characters, not bytes.** The statement is decoded once,
// in the session's charset, and `BF 5C` becomes one character with no backslash
// in it to find. The vulnerability closes by construction rather than by a
// lead-byte table someone has to keep correct — and MySQL's own lead-byte
// ranges are C macros (`isgbkhead`) rather than struct fields, so generating
// them would mean parsing macros, which is the fragility D-14 and M2.17 exist
// to avoid.
//
// The other half of that bargain: a charset this runtime cannot decode
// faithfully is **refused**. Guessing would mean lexing SQL the client did not
// send, which is worse than an error and is exactly what M2.18's transcoder and
// M2.23's sort key refuse for the same reason.
import { canDecode, collationInfo, decodeCharset } from '@myjs/charsets'
import { parseError, unknownCharset } from './errors.ts'
import { TOKEN, OPERATORS, type Token, type TokenKind } from './tokens.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'

export interface LexOptions {
  /** The session's collation id — what the wire carries (`SET NAMES`, the handshake). */
  readonly collationId?: number
  /** Parsed `sql_mode`. Defaults to no modes, which is the permissive reading. */
  readonly sqlMode?: SqlMode
}

/** Characters MySQL treats as whitespace between tokens. */
const SPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v'])

const DIGITS = /[0-9]/
/**
 * What may start or continue a bare identifier.
 *
 * MySQL allows `$`, `_`, digits (not first), and **every character above
 * U+007F** — an unquoted identifier may be `naïve` or `日本語`. Restricting this
 * to ASCII would reject valid SQL from exactly the sessions this lexer went to
 * the trouble of decoding correctly.
 */
const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 0x7f
const isIdentPart = (c: string): boolean => isIdentStart(c) || DIGITS.test(c)

/** Escapes MySQL resolves inside a string literal, when backslashes are live. */
const ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  "'": "'",
  '"': '"',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  // MySQL's `\\Z` is Ctrl+Z, which Windows once read as end-of-file.
  Z: '\u001a',
  '\\': '\\',
}

/**
 * The server version that version-gated comments are compared against.
 *
 * `mysqldump` output is full of `!nnnnn` comments and they are not comments:
 * the body runs when the server is at least the named version. D-10 targets
 * 8.4, so the number is 8.4.0 in MySQL's `MMmmpp` form. Treating them as
 * comments would silently drop the statements a dump relies on.
 */
const SERVER_VERSION = 80400

/**
 * Decode a statement in its session charset.
 *
 * Separate from the lexing so that the refusal is unmistakable and so a caller
 * that already has text can lex it directly.
 */
export function decodeStatement(bytes: Uint8Array, collationId: number): string {
  const info = collationInfo(collationId)
  if (info === undefined) throw unknownCharset(`collation ${collationId}`)
  if (!canDecode(info.charset)) throw unknownCharset(info.charset)
  return decodeCharset(bytes, info.charset)
}

/** Tokenise a statement's bytes. The charset-safe entry point. */
export function lexBytes(bytes: Uint8Array, options: LexOptions = {}): Token[] {
  const collationId = options.collationId ?? 255
  return lex(decodeStatement(bytes, collationId), options)
}

/**
 * Tokenise already-decoded SQL.
 *
 * Always terminates with an `EOF` token, so a parser can look ahead one token
 * without bounds-checking — the kind of thing ground rule 5 is about.
 */
export function lex(sql: string, options: LexOptions = {}): Token[] {
  return new Lexer(sql, options.sqlMode ?? NO_SQL_MODE).run()
}

class Lexer {
  readonly #sql: string
  readonly #mode: SqlMode
  #at = 0
  #line = 1
  #placeholders = 0
  /** Depth of open version-gated bodies, whose contents are live SQL. */
  #executableComments = 0

  constructor(sql: string, mode: SqlMode) {
    this.#sql = sql
    this.#mode = mode
  }

  run(): Token[] {
    const out: Token[] = []
    for (;;) {
      this.#skipTrivia()
      if (this.#at >= this.#sql.length) break
      out.push(this.#next())
    }
    out.push({ kind: TOKEN.EOF, text: '', start: this.#at, end: this.#at, line: this.#line })
    return out
  }

  // --- character helpers ---------------------------------------------------

  #peek(ahead = 0): string {
    return this.#sql[this.#at + ahead] ?? ''
  }

  #advance(n = 1): void {
    for (let i = 0; i < n && this.#at < this.#sql.length; i++) {
      if (this.#sql[this.#at] === '\n') this.#line++
      this.#at++
    }
  }

  #fail(): never {
    // MySQL's `near` is a *suffix* — everything from here to the end, capped.
    // Clients and its own test suite match on that shape, so it is part of the
    // compatibility surface rather than a nicety.
    throw parseError(this.#sql.slice(this.#at, this.#at + 80), this.#line, this.#at)
  }

  #token(kind: TokenKind, text: string, start: number, startLine: number, extra: Partial<Token> = {}): Token {
    return { kind, text, start, end: this.#at, line: startLine, ...extra }
  }

  // --- trivia --------------------------------------------------------------

  /** Whitespace and comments, including the executable ones that are not comments. */
  #skipTrivia(): void {
    for (;;) {
      const c = this.#peek()
      if (c === '') return
      if (SPACE.has(c)) {
        this.#advance()
        continue
      }
      // `#` to end of line.
      if (c === '#') {
        this.#skipToEol()
        continue
      }
      // `--` needs whitespace (or end of input) after it. `SELECT 1--2` is
      // arithmetic, not a comment, and MySQL differs from most dialects here.
      if (c === '-' && this.#peek(1) === '-') {
        const after = this.#peek(2)
        if (after === '' || SPACE.has(after)) {
          this.#skipToEol()
          continue
        }
        return
      }
      if (c === '/' && this.#peek(1) === '*') {
        if (this.#openBlockComment()) continue
        return
      }
      // The `*/` that closes an executable comment we lexed *through*.
      if (c === '*' && this.#peek(1) === '/' && this.#executableComments > 0) {
        this.#advance(2)
        this.#executableComments--
        continue
      }
      return
    }
  }

  #skipToEol(): void {
    while (this.#at < this.#sql.length && this.#peek() !== '\n') this.#advance()
  }

  /**
   * Handle `/*`. Returns true when trivia was consumed and the caller should
   * loop; false when the caller should stop skipping and lex a token.
   *
   * Three openers, and only two of them are comments:
   *   `slash-star`        an ordinary comment — skipped.
   *   `slash-star-plus`   an optimizer hint — skipped; nothing plans yet.
   *   `slash-star-bang`   a version gate, and its body is **live SQL** when
   *                       our version is at least the five digits that follow.
   */
  #openBlockComment(): boolean {
    const marker = this.#peek(2)
    if (marker === '!') {
      const digits = /^[0-9]{5}/.exec(this.#sql.slice(this.#at + 3))
      const version = digits === null ? 0 : Number(digits[0])
      if (version <= SERVER_VERSION) {
        // Step over `/*!` and the version, and lex the body as ordinary SQL.
        this.#advance(3 + (digits === null ? 0 : 5))
        this.#executableComments++
        return true
      }
      // Too new for us: MySQL skips the body entirely.
      this.#skipBlockComment()
      return true
    }
    this.#skipBlockComment()
    return true
  }

  #skipBlockComment(): void {
    const start = this.#at
    const startLine = this.#line
    this.#advance(2)
    for (;;) {
      if (this.#at >= this.#sql.length) {
        // An unterminated comment is a syntax error, not an implicit EOF —
        // otherwise `SELECT 1 /* DROP TABLE t` would run as `SELECT 1`.
        throw parseError(this.#sql.slice(start, start + 80), startLine, start)
      }
      if (this.#peek() === '*' && this.#peek(1) === '/') {
        this.#advance(2)
        return
      }
      this.#advance()
    }
  }

  // --- tokens --------------------------------------------------------------

  #next(): Token {
    const start = this.#at
    const startLine = this.#line
    const c = this.#peek()

    if (c === '`') return this.#quotedIdentifier('`', start, startLine)
    if (c === '"') {
      // The M3.7 fork, and the whole reason `sql_mode` is a parameter here:
      // under `ANSI_QUOTES` this is an identifier, otherwise a string literal.
      return this.#mode.ansiQuotes
        ? this.#quotedIdentifier('"', start, startLine)
        : this.#string('"', start, startLine)
    }
    if (c === "'") return this.#string("'", start, startLine)
    if (c === '?') {
      this.#advance()
      return this.#token(TOKEN.PLACEHOLDER, '?', start, startLine, { index: this.#placeholders++ })
    }
    if (c === '@') return this.#variable(start, startLine)
    if (DIGITS.test(c) || (c === '.' && DIGITS.test(this.#peek(1)))) return this.#number(start, startLine)
    if ((c === 'x' || c === 'X') && this.#peek(1) === "'") return this.#quotedBinary(TOKEN.HEX, start, startLine)
    if ((c === 'b' || c === 'B') && this.#peek(1) === "'") return this.#quotedBinary(TOKEN.BIT, start, startLine)
    if (isIdentStart(c)) return this.#identifier(start, startLine)

    for (const op of OPERATORS) {
      if (this.#sql.startsWith(op, this.#at)) {
        // `||` is logical OR by default and concatenation under
        // `PIPES_AS_CONCAT`. The token is the same either way; M3.2 reads the
        // mode to decide what it means, which keeps that knowledge in one place.
        this.#advance(op.length)
        return this.#token(TOKEN.OPERATOR, op, start, startLine)
      }
    }
    this.#fail()
  }

  /**
   * A bare identifier, scanned from `start`.
   *
   * Scans `isIdentPart`, not `isIdentStart`, so it can also be entered from
   * `#number` for the digit-leading identifiers MySQL allows (`0xZZ`, `1a`).
   */
  #identifier(start: number, startLine: number): Token {
    while (this.#at < this.#sql.length && isIdentPart(this.#peek())) this.#advance()
    return this.#token(TOKEN.IDENTIFIER, this.#sql.slice(start, this.#at), start, startLine)
  }

  /**
   * A backtick- or (under `ANSI_QUOTES`) double-quote-delimited identifier.
   *
   * The quote is doubled to escape itself — `` `a``b` `` is the one name
   * `` a`b ``. Backslash is **never** an escape inside a quoted identifier,
   * whatever `sql_mode` says; that is a real asymmetry with string literals and
   * getting it wrong would let a backslash hide a closing backtick.
   */
  #quotedIdentifier(quote: string, start: number, startLine: number): Token {
    this.#advance()
    let text = ''
    for (;;) {
      if (this.#at >= this.#sql.length) throw parseError(this.#sql.slice(start, start + 80), startLine, start)
      const c = this.#peek()
      if (c === quote) {
        if (this.#peek(1) === quote) {
          text += quote
          this.#advance(2)
          continue
        }
        this.#advance()
        return this.#token(TOKEN.IDENTIFIER, text, start, startLine, { quoted: true })
      }
      text += c
      this.#advance()
    }
  }

  /**
   * A string literal.
   *
   * Two escape mechanisms, and `NO_BACKSLASH_ESCAPES` turns one of them off:
   *   - the quote doubled (`'it''s'`), always available;
   *   - a backslash escape (`'it\'s'`), unless `NO_BACKSLASH_ESCAPES`.
   *
   * `\%` and `\_` deliberately keep their backslash: they are `LIKE`
   * metacharacter escapes and are resolved by `LIKE`, not here. Every other
   * unrecognised `\x` yields a bare `x`, which is what MySQL does.
   */
  #string(quote: string, start: number, startLine: number): Token {
    this.#advance()
    let value = ''
    for (;;) {
      if (this.#at >= this.#sql.length) {
        // An unterminated literal must be an error. This is the case the GBK
        // attack tries to reach by other means: if `BF 5C 27` had been read as
        // an escape plus a live quote, the literal would have closed here and
        // the attacker's text would be SQL.
        throw parseError(this.#sql.slice(start, start + 80), startLine, start)
      }
      const c = this.#peek()
      if (c === quote) {
        if (this.#peek(1) === quote) {
          value += quote
          this.#advance(2)
          continue
        }
        this.#advance()
        return this.#token(TOKEN.STRING, value, start, startLine)
      }
      if (c === '\\' && !this.#mode.noBackslashEscapes) {
        const next = this.#peek(1)
        if (next === '') this.#fail()
        if (next === '%' || next === '_') {
          value += '\\' + next
        } else {
          value += ESCAPES[next] ?? next
        }
        this.#advance(2)
        continue
      }
      value += c
      this.#advance()
    }
  }

  /** `x'4A'` and `b'1010'` — the quoted forms, whose body is constrained. */
  #quotedBinary(kind: TokenKind, start: number, startLine: number): Token {
    const allowed = kind === TOKEN.HEX ? /^[0-9A-Fa-f]*$/ : /^[01]*$/
    this.#advance(2)
    const bodyStart = this.#at
    while (this.#at < this.#sql.length && this.#peek() !== "'") this.#advance()
    if (this.#at >= this.#sql.length) throw parseError(this.#sql.slice(start, start + 80), startLine, start)
    const body = this.#sql.slice(bodyStart, this.#at)
    this.#advance()
    if (!allowed.test(body)) throw parseError(this.#sql.slice(start, start + 80), startLine, start)
    return this.#token(kind, body, start, startLine)
  }

  /** `@user`, `@@system`, `@@global.system`, and `@'quoted'`. */
  #variable(start: number, startLine: number): Token {
    this.#advance()
    if (this.#peek() === '@') this.#advance()
    if (this.#peek() === '`' || this.#peek() === "'" || this.#peek() === '"') {
      const inner = this.#quotedIdentifier(this.#peek(), this.#at, startLine)
      return this.#token(TOKEN.VARIABLE, inner.text, start, startLine)
    }
    // A system variable may be qualified: `@@session.sql_mode`.
    while (this.#at < this.#sql.length && (isIdentPart(this.#peek()) || this.#peek() === '.')) this.#advance()
    return this.#token(TOKEN.VARIABLE, this.#sql.slice(start, this.#at), start, startLine)
  }

  /**
   * A numeric literal, or the `0x`/`0b` forms that are not numbers at all.
   *
   * `0x4A` is a hex literal and `0b101` a bit literal — but only when what
   * follows is entirely hex or binary digits. `0x` followed by anything else is
   * an identifier in MySQL, which is why this checks before committing.
   */
  #number(start: number, startLine: number): Token {
    if (this.#peek() === '0' && (this.#peek(1) === 'x' || this.#peek(1) === 'X')) {
      const m = /^0[xX][0-9A-Fa-f]+/.exec(this.#sql.slice(this.#at))
      if (m !== null && !isIdentPart(this.#peek(m[0].length))) {
        this.#advance(m[0].length)
        return this.#token(TOKEN.HEX, m[0].slice(2), start, startLine)
      }
    }
    if (this.#peek() === '0' && (this.#peek(1) === 'b' || this.#peek(1) === 'B')) {
      const m = /^0[bB][01]+/.exec(this.#sql.slice(this.#at))
      if (m !== null && !isIdentPart(this.#peek(m[0].length))) {
        this.#advance(m[0].length)
        return this.#token(TOKEN.BIT, m[0].slice(2), start, startLine)
      }
    }
    const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(this.#sql.slice(this.#at))
    if (m === null) this.#fail()
    // MySQL lets an unquoted identifier *begin* with a digit — it may only not
    // be all digits. So `0xZZ` is the identifier `0xZZ` rather than the number
    // `0` followed by `xZZ`, and `1a` is an identifier too. Restricted to a
    // plain digit run: a decimal or an exponent followed by letters is
    // malformed either way, and re-reading `2.5e` as one identifier would have
    // to swallow a `.`, which is an operator.
    if (/^[0-9]+$/.test(m[0]) && isIdentPart(this.#peek(m[0].length))) {
      return this.#identifier(start, startLine)
    }
    this.#advance(m[0].length)
    return this.#token(TOKEN.NUMBER, m[0], start, startLine)
  }
}
