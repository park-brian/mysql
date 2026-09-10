// M3.2 — the expression parser.
//
// Precedence climbing over MySQL's operator table. The table is the whole
// point: an expression parser that gets precedence wrong still parses, still
// produces a tree, and quietly answers `1+2*3 = 9`. That is why this item's
// acceptance clause is "precedence matches a real server across a generated
// expression corpus" rather than a set of hand-written cases — the failure mode
// is silent agreement with yourself.
//
// Two `sql_mode` flags reach in here, which is the rest of M3.7:
//   `PIPES_AS_CONCAT`   `||` stops being OR and becomes concatenation, and
//                       *changes precedence* while it does — it jumps from the
//                       bottom of the table to just below the unary operators.
//   `HIGH_NOT_PRECEDENCE`
//                       `NOT` binds tighter than comparison, as it did before
//                       5.0, so `NOT a = b` regroups from `NOT (a = b)` to
//                       `(NOT a) = b`.
import { parseError } from './errors.ts'
import { TOKEN, type Token } from './tokens.ts'
import { NODE, LITERAL, type Expression, type LiteralType } from './ast.ts'
import { lex, type LexOptions } from './lexer.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'

/**
 * MySQL's operator precedence, lowest binding first.
 *
 * Transcribed from the manual's table, which is itself ordered lowest to
 * highest. Each entry is one *level*; operators in a level bind equally and
 * associate left. `NOT`, the unary operators and the postfix predicates are not
 * here because they are not binary — they are handled in `#unary` and
 * `#predicate`, at the positions this table's comments name.
 */
const LEVELS: readonly (readonly string[])[] = [
  [':='],
  ['OR', '||'], // `||` only when PIPES_AS_CONCAT is off — see `#binaryOpAt`.
  ['XOR'],
  ['AND', '&&'],
  // NOT sits here, unless HIGH_NOT_PRECEDENCE moves it up.
  // The comparison level, where BETWEEN / IN / LIKE / REGEXP / IS also live.
  ['=', '<=>', '>=', '>', '<=', '<', '<>', '!='],
  ['|'],
  ['&'],
  ['<<', '>>'],
  ['-', '+'],
  ['*', '/', 'DIV', '%', 'MOD'],
  ['^'],
  // PIPES_AS_CONCAT puts `||` here, between `^` and the unary operators.
  // Unary -, ~, !, BINARY, COLLATE and INTERVAL bind tighter still.
]

/** The index into `LEVELS` of the comparison level, which needs naming twice. */
const COMPARISON_LEVEL = 4
/** Where `NOT` sits by default: just below comparison. */
const NOT_LEVEL = 4

/** Words that are operators rather than identifiers. */
const WORD_OPERATORS = new Set(['AND', 'OR', 'XOR', 'DIV', 'MOD', 'NOT', 'IS', 'BETWEEN', 'IN', 'LIKE', 'REGEXP', 'RLIKE'])

/** Words that end an expression and must never be eaten as a column name. */
const STOP_WORDS = new Set(['THEN', 'WHEN', 'ELSE', 'END', 'ESCAPE', 'AND', 'FROM', 'WHERE'])

/** `INTERVAL 1 DAY` and friends. */
const INTERVAL_UNITS = new Set([
  'MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR',
  'SECOND_MICROSECOND', 'MINUTE_MICROSECOND', 'MINUTE_SECOND', 'HOUR_MICROSECOND', 'HOUR_SECOND',
  'HOUR_MINUTE', 'DAY_MICROSECOND', 'DAY_SECOND', 'DAY_MINUTE', 'DAY_HOUR', 'YEAR_MONTH',
])

export interface ParseExpressionOptions extends LexOptions {
  readonly sqlMode?: SqlMode
}

/** Parse one expression from SQL text. Throws if anything is left over. */
export function parseExpression(sql: string, options: ParseExpressionOptions = {}): Expression {
  const mode = options.sqlMode ?? NO_SQL_MODE
  const parser = new ExpressionParser(lex(sql, options), mode)
  const expr = parser.parse()
  parser.expectEnd()
  return expr
}

class ExpressionParser {
  readonly #tokens: readonly Token[]
  readonly #mode: SqlMode
  #at = 0

  constructor(tokens: readonly Token[], mode: SqlMode) {
    this.#tokens = tokens
    this.#mode = mode
  }

  parse(): Expression {
    return this.#binary(0)
  }

  expectEnd(): void {
    if (this.#peek().kind !== TOKEN.EOF) this.#fail()
  }

  // --- token helpers -------------------------------------------------------

  #peek(ahead = 0): Token {
    // The lexer guarantees a trailing EOF, so this is always in bounds for
    // `ahead === 0` — and for a larger lookahead the clamp keeps it so.
    const i = Math.min(this.#at + ahead, this.#tokens.length - 1)
    return this.#tokens[i] as Token
  }

  #take(): Token {
    const t = this.#peek()
    if (t.kind !== TOKEN.EOF) this.#at++
    return t
  }

  #fail(): never {
    const t = this.#peek()
    throw parseError(t.kind === TOKEN.EOF ? '' : t.text, t.line, t.start)
  }

  /** An unquoted identifier matching `word`, case-insensitively — i.e. a keyword. */
  #atWord(word: string, ahead = 0): boolean {
    const t = this.#peek(ahead)
    return t.kind === TOKEN.IDENTIFIER && t.quoted !== true && t.text.toUpperCase() === word
  }

  #takeWord(word: string): boolean {
    if (!this.#atWord(word)) return false
    this.#at++
    return true
  }

  #expectWord(word: string): void {
    if (!this.#takeWord(word)) this.#fail()
  }

  #atOp(op: string, ahead = 0): boolean {
    const t = this.#peek(ahead)
    return t.kind === TOKEN.OPERATOR && t.text === op
  }

  #takeOp(op: string): boolean {
    if (!this.#atOp(op)) return false
    this.#at++
    return true
  }

  #expectOp(op: string): void {
    if (!this.#takeOp(op)) this.#fail()
  }

  // --- precedence climbing -------------------------------------------------

  /**
   * The operator at the cursor for `level`, or null.
   *
   * `||` is the interesting one and the reason this is a function rather than a
   * set lookup: under `PIPES_AS_CONCAT` it is not an OR at the bottom of the
   * table but a concatenation just below the unary operators, so the *same
   * token* belongs to a different level depending on `sql_mode`.
   */
  #binaryOpAt(level: number): string | null {
    const t = this.#peek()
    if (t.kind === TOKEN.OPERATOR && t.text === '||') {
      // `PIPES_AS_CONCAT` moves it to the extra level above `^`; otherwise it
      // is an OR at the bottom of the table. Checked before the bounds guard
      // below, because the concat level is one past the end of `LEVELS`.
      return this.#mode.pipesAsConcat ? (level === LEVELS.length ? '||' : null) : level === 1 ? '||' : null
    }
    // The extra level exists only for `||`; every other operator is in the
    // table, so anything reaching here past the end has none.
    if (level >= LEVELS.length) return null
    const ops = LEVELS[level] as readonly string[]
    if (t.kind === TOKEN.OPERATOR) return ops.includes(t.text) ? t.text : null
    if (t.kind === TOKEN.IDENTIFIER && t.quoted !== true) {
      const word = t.text.toUpperCase()
      // A word operator must be a word MySQL treats as one; otherwise `a b` is
      // two expressions, not an application of an operator named `b`.
      if (WORD_OPERATORS.has(word) && ops.includes(word)) return word
    }
    return null
  }

  /**
   * `level` counts down the table: 0 is `:=`, `LEVELS.length` is the extra
   * level `PIPES_AS_CONCAT` creates between `^` and the unary operators.
   */
  #binary(level: number): Expression {
    if (level > LEVELS.length) return this.#unary()

    // `NOT` is prefix, not infix, but it sits *between* two binary levels — so
    // it is handled at the level it occupies rather than with the other unary
    // operators. `HIGH_NOT_PRECEDENCE` moves it up beside them instead.
    if (!this.#mode.highNotPrecedence && level === NOT_LEVEL && this.#atWord('NOT')) {
      const t = this.#take()
      return { kind: NODE.UNARY, op: 'NOT', operand: this.#binary(level), at: t.start }
    }

    let left = this.#binary(level + 1)

    if (level === COMPARISON_LEVEL) left = this.#predicate(left)

    for (;;) {
      const op = this.#binaryOpAt(level)
      if (op === null) return left
      const t = this.#take()
      let right = this.#binary(level + 1)
      if (level === COMPARISON_LEVEL) right = this.#predicate(right)
      left = { kind: NODE.BINARY, op, left, right, at: t.start }
    }
  }

  /**
   * The postfix predicates, which all live at the comparison level:
   * `IS [NOT] …`, `[NOT] BETWEEN … AND …`, `[NOT] IN (…)`,
   * `[NOT] LIKE … [ESCAPE …]`, `[NOT] REGEXP …`.
   *
   * They are postfix and they chain, so `a IS NOT NULL IS TRUE` is legal — which
   * is why this loops rather than running once.
   */
  #predicate(left: Expression): Expression {
    for (;;) {
      const at = this.#peek().start

      if (this.#takeWord('IS')) {
        const negated = this.#takeWord('NOT')
        let op = 'IS'
        if (this.#takeWord('NULL')) op = negated ? 'IS NOT NULL' : 'IS NULL'
        else if (this.#takeWord('TRUE')) op = negated ? 'IS NOT TRUE' : 'IS TRUE'
        else if (this.#takeWord('FALSE')) op = negated ? 'IS NOT FALSE' : 'IS FALSE'
        else if (this.#takeWord('UNKNOWN')) op = negated ? 'IS NOT UNKNOWN' : 'IS UNKNOWN'
        else this.#fail()
        left = { kind: NODE.UNARY, op, operand: left, at }
        continue
      }

      // `NOT` here is the start of `NOT BETWEEN` / `NOT IN` / `NOT LIKE` /
      // `NOT REGEXP`, and nothing else — so it is only consumed once one of
      // those follows.
      const negated =
        this.#atWord('NOT') &&
        (this.#atWord('BETWEEN', 1) || this.#atWord('IN', 1) || this.#atWord('LIKE', 1) || this.#atWord('REGEXP', 1) || this.#atWord('RLIKE', 1))
      if (negated) this.#at++

      if (this.#takeWord('BETWEEN')) {
        // The upper bound is parsed *above* the AND level, or the `AND` that
        // separates the bounds would be read as a conjunction and swallow the
        // rest of the expression.
        const lower = this.#binary(COMPARISON_LEVEL + 1)
        this.#expectWord('AND')
        const upper = this.#binary(COMPARISON_LEVEL + 1)
        left = { kind: NODE.BINARY, op: negated ? 'NOT BETWEEN' : 'BETWEEN', left, right: lower, extra: upper, at }
        continue
      }

      if (this.#takeWord('IN')) {
        this.#expectOp('(')
        const items: Expression[] = []
        if (!this.#atOp(')')) {
          do items.push(this.#binary(0))
          while (this.#takeOp(','))
        }
        this.#expectOp(')')
        left = {
          kind: NODE.BINARY,
          op: negated ? 'NOT IN' : 'IN',
          left,
          right: { kind: NODE.ROW, items, at },
          at,
        }
        continue
      }

      if (this.#takeWord('LIKE')) {
        const pattern = this.#binary(COMPARISON_LEVEL + 1)
        const node = { kind: NODE.BINARY, op: negated ? 'NOT LIKE' : 'LIKE', left, right: pattern, at } as const
        left = this.#takeWord('ESCAPE')
          ? { ...node, extra: this.#binary(COMPARISON_LEVEL + 1) }
          : node
        continue
      }

      if (this.#atWord('REGEXP') || this.#atWord('RLIKE')) {
        this.#at++
        const pattern = this.#binary(COMPARISON_LEVEL + 1)
        left = { kind: NODE.BINARY, op: negated ? 'NOT REGEXP' : 'REGEXP', left, right: pattern, at }
        continue
      }

      if (negated) this.#fail() // consumed a NOT with nothing to attach it to
      return left
    }
  }

  // --- unary and primary ---------------------------------------------------

  #unary(): Expression {
    const t = this.#peek()

    if (this.#mode.highNotPrecedence && this.#atWord('NOT')) {
      this.#at++
      return { kind: NODE.UNARY, op: 'NOT', operand: this.#unary(), at: t.start }
    }
    if (this.#atOp('-') || this.#atOp('+') || this.#atOp('~') || this.#atOp('!')) {
      const op = this.#take().text
      return { kind: NODE.UNARY, op, operand: this.#unary(), at: t.start }
    }
    if (this.#atWord('BINARY')) {
      this.#at++
      return { kind: NODE.UNARY, op: 'BINARY', operand: this.#unary(), at: t.start }
    }
    if (this.#atWord('INTERVAL')) {
      this.#at++
      const value = this.#binary(COMPARISON_LEVEL + 1)
      const unit = this.#peek()
      if (unit.kind !== TOKEN.IDENTIFIER || !INTERVAL_UNITS.has(unit.text.toUpperCase())) this.#fail()
      this.#at++
      return { kind: NODE.INTERVAL, value, unit: unit.text.toUpperCase(), at: t.start }
    }
    return this.#postfixCollate(this.#primary())
  }

  /** `expr COLLATE utf8mb4_bin`, which binds tighter than anything binary. */
  #postfixCollate(expr: Expression): Expression {
    if (!this.#atWord('COLLATE')) return expr
    this.#at++
    const name = this.#peek()
    if (name.kind !== TOKEN.IDENTIFIER && name.kind !== TOKEN.STRING) this.#fail()
    this.#at++
    if (expr.kind === NODE.LITERAL) return { ...expr, collation: name.text }
    return { kind: NODE.UNARY, op: 'COLLATE', operand: expr, at: expr.at }
  }

  #primary(): Expression {
    const t = this.#peek()

    switch (t.kind) {
      case TOKEN.NUMBER:
        this.#at++
        return { kind: NODE.LITERAL, ...numericLiteral(t.text), at: t.start }
      case TOKEN.STRING: {
        this.#at++
        // Adjacent string literals concatenate — `'a' 'b'` is `'ab'`, which is
        // SQL-standard and which MySQL does at the lexical level.
        let value = t.text
        while (this.#peek().kind === TOKEN.STRING) value += this.#take().text
        return { kind: NODE.LITERAL, type: LITERAL.STRING, value, at: t.start }
      }
      case TOKEN.HEX:
        this.#at++
        return { kind: NODE.LITERAL, type: LITERAL.HEX, value: hexBytes(t.text), at: t.start }
      case TOKEN.BIT:
        this.#at++
        return { kind: NODE.LITERAL, type: LITERAL.BIT, value: t.text === '' ? 0n : BigInt('0b' + t.text), at: t.start }
      case TOKEN.PLACEHOLDER:
        this.#at++
        return { kind: NODE.PLACEHOLDER, index: t.index ?? 0, at: t.start }
      case TOKEN.VARIABLE:
        this.#at++
        return { kind: NODE.VARIABLE, name: t.text, at: t.start }
      case TOKEN.OPERATOR:
        if (t.text === '(') return this.#parenthesised()
        this.#fail()
        break
      case TOKEN.IDENTIFIER:
        return this.#identifierLike()
      default:
        this.#fail()
    }
    this.#fail()
  }

  /** `(a)` is a parenthesised expression; `(a, b)` is a row constructor. */
  #parenthesised(): Expression {
    const open = this.#take()
    const first = this.#binary(0)
    if (!this.#atOp(',')) {
      this.#expectOp(')')
      return first
    }
    const items: Expression[] = [first]
    while (this.#takeOp(',')) items.push(this.#binary(0))
    this.#expectOp(')')
    return { kind: NODE.ROW, items, at: open.start }
  }

  #identifierLike(): Expression {
    const t = this.#peek()
    const upper = t.text.toUpperCase()

    if (t.quoted !== true) {
      if (upper === 'NULL') {
        this.#at++
        return { kind: NODE.LITERAL, type: LITERAL.NULL, value: null, at: t.start }
      }
      if (upper === 'TRUE' || upper === 'FALSE') {
        this.#at++
        return { kind: NODE.LITERAL, type: LITERAL.BOOL, value: upper === 'TRUE', at: t.start }
      }
      if (upper === 'CASE') return this.#case()
      // `_latin1'x'` — a charset introducer. MySQL lexes this as its own token
      // kind; here the lexer leaves it an identifier and the shape is
      // recognised at the point where it can only mean one thing.
      if (t.text.startsWith('_') && this.#peek(1).kind === TOKEN.STRING) {
        this.#at++
        const s = this.#take()
        return {
          kind: NODE.LITERAL,
          type: LITERAL.STRING,
          value: s.text,
          charset: t.text.slice(1).toLowerCase(),
          at: t.start,
        }
      }
      // A word that ends an expression is never a column reference. Without
      // this, `CASE WHEN a THEN b END` reads `THEN` as a column and the whole
      // construct falls apart in a way that is hard to trace back here.
      if (STOP_WORDS.has(upper)) this.#fail()
    }

    // `name(` is a call. MySQL requires no space between them unless
    // `IGNORE_SPACE` is set, which is exactly what that mode means.
    if (this.#atOp('(', 1) && (this.#mode.ignoreSpace || this.#peek(1).start === t.end)) {
      return this.#call()
    }

    // A qualified name: `a`, `t.a`, `db.t.a`, or `t.*`.
    this.#at++
    const parts = [t.text]
    while (this.#atOp('.')) {
      this.#at++
      if (this.#atOp('*')) {
        this.#at++
        parts.push('*')
        break
      }
      const next = this.#peek()
      if (next.kind !== TOKEN.IDENTIFIER) this.#fail()
      this.#at++
      parts.push(next.text)
    }
    return { kind: NODE.COLUMN, parts, at: t.start }
  }

  #call(): Expression {
    const name = this.#take()
    this.#expectOp('(')
    const distinct = this.#takeWord('DISTINCT')
    const args: Expression[] = []
    if (this.#atOp('*') && !distinct) {
      // `COUNT(*)` — the only place a bare star is an argument.
      this.#at++
      args.push({ kind: NODE.COLUMN, parts: ['*'], at: this.#peek().start })
    } else if (!this.#atOp(')')) {
      do args.push(this.#binary(0))
      while (this.#takeOp(','))
    }
    this.#expectOp(')')
    return {
      kind: NODE.CALL,
      name: name.text,
      args,
      ...(distinct ? { distinct: true } : {}),
      at: name.start,
    }
  }

  #case(): Expression {
    const at = this.#take().start
    // Two forms: `CASE x WHEN …` compares, `CASE WHEN …` tests. They are told
    // apart by whether an expression follows `CASE`.
    const operand = this.#atWord('WHEN') ? undefined : this.#binary(0)
    const whens: { when: Expression; then: Expression }[] = []
    while (this.#takeWord('WHEN')) {
      const when = this.#binary(0)
      this.#expectWord('THEN')
      whens.push({ when, then: this.#binary(0) })
    }
    if (whens.length === 0) this.#fail()
    const otherwise = this.#takeWord('ELSE') ? this.#binary(0) : undefined
    this.#expectWord('END')
    return {
      kind: NODE.CASE,
      ...(operand === undefined ? {} : { operand }),
      whens,
      ...(otherwise === undefined ? {} : { else: otherwise }),
      at,
    }
  }
}

/**
 * A numeric literal's SQL type, from how it was written.
 *
 * MySQL's rule, and the three cases are genuinely different types: `1` is an
 * exact integer, `1.0` is an exact DECIMAL, `1e0` is an approximate DOUBLE.
 * The DECIMAL stays a **string** because that is the only lossless carrier for
 * it in JavaScript — the same reasoning behind D-15 mapping DECIMAL to a
 * string rather than to a float.
 */
function numericLiteral(text: string): { type: LiteralType; value: bigint | number | string } {
  if (/[eE]/.test(text)) return { type: LITERAL.DOUBLE, value: Number(text) }
  if (text.includes('.')) return { type: LITERAL.DECIMAL, value: text }
  return { type: LITERAL.INT, value: BigInt(text) }
}

/** `x'4A'` is a binary string, so its value is bytes rather than a number. */
function hexBytes(text: string): Uint8Array {
  // An odd digit count is left-padded, which is what MySQL does: `x'4'` is
  // `0x04` rather than an error.
  const even = text.length % 2 === 0 ? text : '0' + text
  const out = new Uint8Array(even.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(even.slice(i * 2, i * 2 + 2), 16)
  return out
}
