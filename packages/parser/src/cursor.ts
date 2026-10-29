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
import { ParseError, parseError, tooDeep, type ParseCondition } from './errors.ts'
import { RESERVED } from './keywords.ts'
import { TOKEN, keywordText, type Token } from './tokens.ts'
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

const grammarWarnings = new WeakMap<object, readonly ParseCondition[]>()

export class Cursor {
  /** Successful grammar provenance belongs to this exact root and is never consumed. */
  static conditions(root: object): readonly ParseCondition[] | undefined {
    return grammarWarnings.get(root)
  }

  readonly tokens: readonly Token[]
  /**
   * The decoded statement the tokens came from, for the one construct whose
   * text is kept as written: a stored program's body (M3.8).
   */
  readonly source: string
  at = 0
  #depth = 0
  #primary: ParseError | undefined
  #conditions: ParseCondition[] | undefined
  /** Legacy successful-root provenance excludes runtime-owned failure warnings. */
  #warnings: ParseCondition[] | undefined

  constructor(tokens: readonly Token[], source = '') {
    this.tokens = tokens
    this.source = source
  }

  /** Recoverable grammar errors collect only inside a checked entry point. */
  report(error: ParseError): void {
    if (!this.#conditions) throw error
    this.#primary ??= error
    this.#conditions.push({ errno: error.errno!, message: error.message })
  }

  /** Runtime-owned warnings survive failure without changing valid-AST provenance. */
  warn(errno: number, message: string, failureOnly = false): void {
    if (!this.#conditions) return
    const condition: ParseCondition = { errno, message, level: 'Warning' }
    this.#conditions.push(condition)
    if (!failureOnly) (this.#warnings ??= []).push(condition)
  }

  /** Refuse an invalid statement before its AST reaches a consumer. */
  checked<T extends object>(parse: () => T): T {
    if (this.#conditions) return parse()
    this.#conditions = []
    try {
      const result = parse()
      if (this.#primary !== undefined) throw this.#primary
      checkTreeDepth(result)
      if (this.#warnings) grammarWarnings.set(result, Object.freeze(this.#warnings))
      return result
    } catch (error) {
      if (!(error instanceof ParseError) || this.#conditions.length === 0) throw error
      const primary = this.#primary ?? error
      if (error !== this.#primary) this.report(error)
      if (this.#conditions.length > 1) Object.defineProperty(primary, 'conditions', { value: this.#conditions })
      throw primary
    } finally {
      this.#primary = undefined
      this.#conditions = undefined
      this.#warnings = undefined
    }
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
    return this.tokens[this.at + ahead] ?? this.tokens[this.tokens.length - 1]!
  }

  /** Consume and return the current token. `EOF` is never consumed. */
  take(): Token {
    const t = this.peek()
    if (t.kind !== TOKEN.EOF) this.at++
    return t
  }

  /** Advance one token unconditionally — for callers that already matched. */
  skip(): void {
    this.take()
  }

  atEnd(): boolean {
    return this.peek().kind === TOKEN.EOF
  }

  /** ER_PARSE_ERROR at the cursor, with the position M3.9 reports. */
  fail(t = this.peek()): never {
    // The rest of the statement from here, capped as the lexer's is (E-20):
    // `near 'WHERE x = 1'`, not `near 'WHERE'`. A cursor without its source
    // has only the token.
    const near = t.kind === TOKEN.EOF ? '' : this.source === '' ? t.text : this.source.slice(t.start, t.start + 80)
    throw parseError(near, t.line, t.start)
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
    return word !== '' && keywordText(this.peek(ahead)) === word
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
    return t.kind === TOKEN.IDENTIFIER && !RESERVED.has(keywordText(t))
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
   * One string literal's text, optionally concatenating adjacent literals for
   * expression and ENUM/SET readers. A COMMENT or file name keeps one token.
   */
  expectString(adjacent = false): string {
    const t = this.peek()
    if (t.kind !== TOKEN.STRING) this.fail()
    let text = this.take().text
    if (adjacent) while (this.peek().kind === TOKEN.STRING) text += this.take().text
    return text
  }

  /** Run `parse` one nesting level deeper, refusing past `MAX_DEPTH`. */
  nested<T>(parse: () => T): T {
    if (this.#depth >= MAX_DEPTH) throw this.#primary ?? tooDeep(MAX_DEPTH)
    this.#depth++
    try {
      return parse()
    } finally {
      this.#depth--
    }
  }
}

/** Decimal-digit NUMBER spelling; callers own the grammar bound and its later meaning. */
export function unsignedValue(c: Cursor, max?: number): string {
  const t = c.peek()
  if (t.kind !== TOKEN.NUMBER || !/^\d+$/.test(t.text) || (max !== undefined && Number(t.text) > max)) c.fail()
  c.at++ // The validated NUMBER is not EOF; consume the token already read.
  return t.text
}

/** One string token or any identifier, including a reserved word. */
export function wordOrString(c: Cursor): string {
  const t = c.peek()
  if (t.kind !== TOKEN.IDENTIFIER && t.kind !== TOKEN.STRING) c.fail()
  return c.take().text
}

/** `{ key: value }` when defined, `{}` when not — an absent field, never `undefined`. */
export const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

/** `{ name: true }` when on, `{}` when not. */
export const flag = (name: string, on: boolean): Record<string, true> => (on ? { [name]: true } : {})
