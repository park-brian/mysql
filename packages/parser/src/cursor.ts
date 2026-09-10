// A position in a token stream, shared by every parser in this package.
//
// M3.2 had one parser and kept these helpers private to it. M3.5 adds a second
// that must interleave with the first — a column's `DEFAULT (a + 1)`, a
// generated column's expression and a `CHECK` constraint are all expressions
// inside DDL — so both have to advance the *same* cursor rather than each
// holding its own copy of the token array and its own index.
//
// Composition rather than inheritance, because the two parsers share a position
// and nothing else: precedence climbing and DDL have no common shape worth
// modelling as a base class.
import { parseError } from './errors.ts'
import { TOKEN, type Token } from './tokens.ts'

export class Cursor {
  readonly tokens: readonly Token[]
  at = 0

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens
  }

  /**
   * The token `ahead` positions on, clamped to the last.
   *
   * The lexer guarantees a trailing `EOF`, so the clamp lands on that rather
   * than on `undefined`. That is ground rule 5 in one line: lookahead past the
   * end of the input is a normal thing for a parser to do and must never be an
   * out-of-bounds read.
   */
  peek(ahead = 0): Token {
    const i = Math.min(this.at + ahead, this.tokens.length - 1)
    return this.tokens[i] as Token
  }

  /** Consume and return the current token. `EOF` is never consumed. */
  take(): Token {
    const t = this.peek()
    if (t.kind !== TOKEN.EOF) this.at++
    return t
  }

  /** Advance one token unconditionally — for callers that already matched. */
  skip(): void {
    if (this.peek().kind !== TOKEN.EOF) this.at++
  }

  atEnd(): boolean {
    return this.peek().kind === TOKEN.EOF
  }

  /** ER_PARSE_ERROR at the cursor, with the position M3.9 reports. */
  fail(): never {
    const t = this.peek()
    throw parseError(t.kind === TOKEN.EOF ? '' : t.text, t.line, t.start)
  }

  /**
   * An **unquoted** identifier matching `word`, case-insensitively — a keyword.
   *
   * The `quoted` check is not a detail. `` `select` `` is a column named
   * `select`, and a parser that treated it as the keyword would refuse valid
   * SQL that MySQL accepts — which is precisely why the lexer records how an
   * identifier was written rather than normalising it away.
   */
  atWord(word: string, ahead = 0): boolean {
    const t = this.peek(ahead)
    return t.kind === TOKEN.IDENTIFIER && t.quoted !== true && t.text.toUpperCase() === word
  }

  takeWord(word: string): boolean {
    if (!this.atWord(word)) return false
    this.at++
    return true
  }

  expectWord(word: string): void {
    if (!this.takeWord(word)) this.fail()
  }

  /** True if the next tokens are these words in order — `NOT NULL`, `PRIMARY KEY`. */
  atWords(...words: readonly string[]): boolean {
    return words.every((w, i) => this.atWord(w, i))
  }

  takeWords(...words: readonly string[]): boolean {
    if (!this.atWords(...words)) return false
    this.at += words.length
    return true
  }

  atOp(op: string, ahead = 0): boolean {
    const t = this.peek(ahead)
    return t.kind === TOKEN.OPERATOR && t.text === op
  }

  takeOp(op: string): boolean {
    if (!this.atOp(op)) return false
    this.at++
    return true
  }

  expectOp(op: string): void {
    if (!this.takeOp(op)) this.fail()
  }

  /**
   * An identifier of any kind — quoted or not — as its text.
   *
   * A quoted one may be anything, including a keyword or an empty-looking
   * name; an unquoted one may not be a reserved word, but this package does not
   * yet carry MySQL's reserved-word list, so the check that would use it is
   * M3.3's rather than a silent no-op here.
   */
  expectIdentifier(): string {
    const t = this.peek()
    if (t.kind !== TOKEN.IDENTIFIER) this.fail()
    this.at++
    return t.text
  }
}
