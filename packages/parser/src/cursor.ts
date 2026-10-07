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
import { parseError, tooDeep } from './errors.ts'
import { RESERVED } from './keywords.ts'
import { TOKEN, type Token } from './tokens.ts'
import type { TableName } from './statement-ast.ts'

/**
 * How deeply a statement may nest before the parser refuses.
 *
 * Without a limit, `'('.repeat(1000) + '1' + ')'.repeat(1000)` throws a
 * `RangeError` — a crash from ordinary input, reachable by anyone who can send
 * a query, and exactly what ground rule 5 forbids.
 *
 * The number is small because a nesting level is expensive: the expression
 * parser descends one frame per precedence level, so a single `(` costs about
 * fifteen. Measured here, V8 gives up at roughly 390 levels; a limit of 400 was
 * therefore no limit at all, since 399 still crashed. 100 leaves a wide margin
 * for a smaller stack on another runtime, and is far past anything real SQL
 * contains — MySQL's own limit on nested `SELECT`s is 63.
 *
 * It lives on the cursor rather than on a parser because the cursor is the one
 * thing every parser of a statement shares. M3.2 kept the counter on the
 * expression parser, which was right while there was one; once a subquery
 * starts a *new* expression parser at every level, a per-parser counter starts
 * at zero each time and never trips (M3.15).
 */
export const MAX_DEPTH = 100

/**
 * How deep a finished tree may be, in levels of object nesting (D-40).
 *
 * `MAX_DEPTH` bounds the *parser's* recursion, but a left-associative chain —
 * `1+1+…`, `a OR a OR …`, a run of `JOIN … ON`, a `UNION` of many `SELECT`s —
 * is built by a loop, so the tree it produces can be as deep as the input is
 * long. Everything that walks the tree afterwards recurses: the deparser
 * overflowed at about 2,700 terms of `+`, and M5's resolver and evaluator will
 * do the same. Bounding the tree once, here, keeps every consumer stack-safe
 * without each being rewritten as a loop.
 *
 * The deepest tree in MySQL's whole test corpus is 70 levels, so 1,000 is a
 * wide margin. It is a divergence all the same: MySQL flattens `AND`, `OR` and
 * `UNION` chains into lists and accepts chains this refuses. A real client that
 * meets it is the signal to flatten them here too, into n-ary nodes.
 */
export const MAX_TREE_DEPTH = 1000

/**
 * Refuse a tree deeper than `MAX_TREE_DEPTH`, with `tooDeep` rather than the
 * `RangeError` a later recursive walk would throw. Iterative, since a recursive
 * check would fail on exactly the trees it exists to refuse.
 */
export function checkTreeDepth(root: object): void {
  const stack: [unknown, number][] = [[root, 1]]
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [unknown, number]
    if (node === null || typeof node !== 'object' || node instanceof Uint8Array) continue
    if (depth > MAX_TREE_DEPTH) throw tooDeep(MAX_TREE_DEPTH)
    for (const child of Object.values(node)) if (typeof child === 'object') stack.push([child, depth + 1])
  }
}

export class Cursor {
  readonly tokens: readonly Token[]
  at = 0
  #depth = 0

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
   * True at a token that may stand as a name: one written in quotes, which may
   * be anything, or an unquoted word that is not reserved (M3.15).
   */
  atIdentifier(ahead = 0): boolean {
    const t = this.peek(ahead)
    return t.kind === TOKEN.IDENTIFIER && (t.quoted === true || !RESERVED.has(t.text.toUpperCase()))
  }

  /**
   * A name, as its text. An unquoted reserved word is refused, as MySQL refuses
   * it: `CREATE TABLE lateral (a INT)` is a syntax error on a real 8.4, and
   * `` CREATE TABLE `lateral` (a INT) `` is not.
   */
  expectIdentifier(): string {
    if (!this.atIdentifier()) this.fail()
    return this.take().text
  }

  /**
   * A name after a `.` in a qualified name, where a reserved word is allowed:
   * `t.select` is a column, since nothing but a name can follow the dot.
   */
  expectNamePart(): string {
    const t = this.peek()
    if (t.kind !== TOKEN.IDENTIFIER) this.fail()
    return this.take().text
  }

  /** `t` or `db.t`. */
  expectTableName(): TableName {
    const first = this.expectIdentifier()
    if (!this.takeOp('.')) return { name: first }
    return { schema: first, name: this.expectNamePart() }
  }

  /** `(a, b, c)` — one or more names in parentheses. */
  expectNameList(): string[] {
    this.expectOp('(')
    const out = [this.expectIdentifier()]
    while (this.takeOp(',')) out.push(this.expectIdentifier())
    this.expectOp(')')
    return out
  }

  /**
   * One string literal's text. Adjacent literals concatenate only inside an
   * expression, which reads them itself; here — a `COMMENT`, a file name — a
   * second literal is a second token.
   */
  expectString(): string {
    const t = this.peek()
    if (t.kind !== TOKEN.STRING) this.fail()
    return this.take().text
  }

  /** Run `parse` one nesting level deeper, refusing past `MAX_DEPTH`. */
  nested<T>(parse: () => T): T {
    if (++this.#depth > MAX_DEPTH) throw tooDeep(MAX_DEPTH)
    try {
      return parse()
    } finally {
      this.#depth--
    }
  }
}
