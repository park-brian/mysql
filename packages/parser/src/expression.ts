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
import { Cursor, checkTreeDepth } from './cursor.ts'
import { RESERVED } from './keywords.ts'
import { TOKEN, type Token } from './tokens.ts'
import { NODE, LITERAL, type Expression, type LiteralType } from './ast.ts'
import { lex, type LexOptions } from './lexer.ts'
import { hexBytes, parseDataType, type DataType } from './data-type.ts'
import {
  atQueryContinuation,
  atQueryStart,
  continueQueryFrom,
  parseOrderBy,
  parseQueryFrom,
  parseWindowSpec,
} from './query.ts'
import { FIELD_TYPE } from '@myjs/bytes'
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

/** Keywords that type the string literal after them — `DATE'2019-10-01'`. */
const TEMPORAL_KEYWORDS = new Set(['DATE', 'TIME', 'TIMESTAMP', 'DATETIME'])

/**
 * Reserved words that are a function call **without** parentheses:
 * `CURRENT_TIMESTAMP` is `CURRENT_TIMESTAMP()`. Both spellings parse to the
 * same call node, because they are the same expression.
 */
const NILADIC = new Set([
  'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER',
  'LOCALTIME', 'LOCALTIMESTAMP', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP',
])

/**
 * Reserved words that are also builtin functions, so a `(` after one makes it a
 * call rather than a syntax error: `IF(a, b, c)`, `LEFT(s, 2)`, `RANK() OVER w`.
 *
 * Written out rather than generated, for the reason M3.5's type table is: the
 * server publishes which words are reserved (M3.15) but not which of those its
 * grammar also accepts as a function name, and the grammar is Bison. The census
 * keeps it honest — a missing name is a corpus statement that fails to parse.
 */
const RESERVED_FUNCTIONS = new Set([
  ...NILADIC,
  'CHAR', 'CONVERT', 'DATABASE', 'DEFAULT', 'IF', 'INSERT', 'LEFT', 'RIGHT', 'MOD', 'REPEAT', 'REPLACE',
  'SCHEMA', 'VALUES', 'GROUPING', 'CUME_DIST', 'DENSE_RANK', 'FIRST_VALUE', 'LAG', 'LAST_VALUE', 'LEAD',
  'NTH_VALUE', 'NTILE', 'PERCENT_RANK', 'RANK', 'ROW_NUMBER',
])

/** `INTERVAL 1 DAY` and friends. */
export const INTERVAL_UNITS: ReadonlySet<string> = new Set([
  'MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR',
  'SECOND_MICROSECOND', 'MINUTE_MICROSECOND', 'MINUTE_SECOND', 'HOUR_MICROSECOND', 'HOUR_SECOND',
  'HOUR_MINUTE', 'DAY_MICROSECOND', 'DAY_SECOND', 'DAY_MINUTE', 'DAY_HOUR', 'YEAR_MONTH',
])

/** Aggregates, which alone may spell out their default `ALL`: `SUM(ALL a)`. */
const AGGREGATES = new Set([
  'AVG', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'COUNT', 'GROUP_CONCAT', 'MAX', 'MIN', 'STD', 'STDDEV',
  'STDDEV_POP', 'STDDEV_SAMP', 'SUM', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
])

/** The types a `CAST` may name, by their canonical names. */
const CAST_TYPES = new Set([
  'BINARY', 'CHAR', 'DATE', 'DATETIME', 'TIME', 'DECIMAL', 'DOUBLE', 'FLOAT', 'JSON', 'YEAR',
  'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION',
])

export interface ParseExpressionOptions extends LexOptions {
  readonly sqlMode?: SqlMode
}

/** Parse one expression from SQL text. Throws if anything is left over. */
export function parseExpression(sql: string, options: ParseExpressionOptions = {}): Expression {
  const mode = options.sqlMode ?? NO_SQL_MODE
  const cursor = new Cursor(lex(sql, options))
  const expr = new ExpressionParser(cursor, mode).parse()
  if (!cursor.atEnd()) cursor.fail()
  checkTreeDepth(expr)
  return expr
}

/**
 * Parse one expression from a cursor another parser is already driving.
 *
 * The DDL parser needs this: `DEFAULT (a + 1)`, `GENERATED ALWAYS AS (…)` and
 * `CHECK (…)` are expressions embedded in a statement, and they must advance
 * the same cursor rather than being handed a re-lexed substring.
 */
export function parseExpressionFrom(cursor: Cursor, mode: SqlMode): Expression {
  return new ExpressionParser(cursor, mode).parse()
}

class ExpressionParser {
  readonly #c: Cursor
  readonly #mode: SqlMode

  constructor(cursor: Cursor, mode: SqlMode) {
    this.#c = cursor
    this.#mode = mode
  }

  parse(): Expression {
    return this.#binary(0)
  }

  // --- token helpers, all delegating to the shared cursor -------------------

  #peek(ahead = 0): Token {
    return this.#c.peek(ahead)
  }

  #take(): Token {
    return this.#c.take()
  }

  #fail(): never {
    this.#c.fail()
  }

  #atWord(word: string, ahead = 0): boolean {
    return this.#c.atWord(word, ahead)
  }

  #takeWord(word: string): boolean {
    return this.#c.takeWord(word)
  }

  #expectWord(word: string): void {
    this.#c.expectWord(word)
  }

  #atOp(op: string, ahead = 0): boolean {
    return this.#c.atOp(op, ahead)
  }

  #takeOp(op: string): boolean {
    return this.#c.takeOp(op)
  }

  #expectOp(op: string): void {
    this.#c.expectOp(op)
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
      // Only a user variable can be assigned: `a := 1`, `@@sql_mode := 1` and
      // `a = 1 := 2` are all ER_PARSE_ERROR on a real 8.4.
      if (op === ':=' && !(left.kind === NODE.VARIABLE && !left.name.startsWith('@@'))) this.#fail()
      const t = this.#take()
      // `a = ANY (SELECT …)`: a comparison against every row of a subquery.
      // `SOME` is `ANY`'s synonym; `<=>` takes no quantifier.
      const quantified = level === COMPARISON_LEVEL && op !== '<=>' ? this.#quantifiedSubquery() : null
      // `:=` is the one operator that associates right: `@a := @b := 1`
      // assigns 1 to both. Its right side is read at its own level.
      let right = quantified ?? this.#binary(op === ':=' ? level : level + 1)
      if (level === COMPARISON_LEVEL && quantified === null) right = this.#predicate(right)
      left = { kind: NODE.BINARY, op, left, right, at: t.start }
    }
  }

  #quantifiedSubquery(): Expression | null {
    const t = this.#peek()
    const word = t.kind === TOKEN.IDENTIFIER && t.quoted !== true ? t.text.toUpperCase() : ''
    if ((word !== 'ANY' && word !== 'SOME' && word !== 'ALL') || !this.#atOp('(', 1)) return null
    this.#c.skip()
    const quantifier = word === 'ALL' ? 'ALL' : 'ANY'
    return { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), quantifier, at: t.start }
  }

  /** `( query )`, with the cursor on the `(`. */
  #parenthesisedQuery() {
    this.#expectOp('(')
    const query = parseQueryFrom(this.#c, this.#mode)
    this.#expectOp(')')
    return query
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
      if (negated) this.#c.skip()

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
        // `IN (SELECT …)` is a membership test against a subquery's rows, not
        // a list holding one scalar subquery — which is what `IN ((SELECT …))`
        // is. The two are told apart by the token after the parenthesis.
        if (this.#atOp('(') && atQueryStart(this.#c, 1)) {
          const open = this.#peek().start
          const right = { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), at: open } as const
          left = { kind: NODE.BINARY, op: negated ? 'NOT IN' : 'IN', left, right, at }
          continue
        }
        // At least one item: `a IN ()` is a syntax error.
        this.#expectOp('(')
        const items: Expression[] = []
        do items.push(this.#binary(0))
        while (this.#takeOp(','))
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
        this.#c.skip()
        const pattern = this.#binary(COMPARISON_LEVEL + 1)
        left = { kind: NODE.BINARY, op: negated ? 'NOT REGEXP' : 'REGEXP', left, right: pattern, at }
        continue
      }

      // `a MEMBER OF (json)` (8.0.17) and `a SOUNDS LIKE b`, neither of which
      // takes a `NOT`.
      if (!negated && this.#atWord('MEMBER') && this.#atWord('OF', 1)) {
        this.#c.skip()
        this.#c.skip()
        this.#expectOp('(')
        const right = this.#binary(0)
        this.#expectOp(')')
        left = { kind: NODE.BINARY, op: 'MEMBER OF', left, right, at }
        continue
      }
      if (!negated && this.#atWord('SOUNDS') && this.#atWord('LIKE', 1)) {
        this.#c.skip()
        this.#c.skip()
        left = { kind: NODE.BINARY, op: 'SOUNDS LIKE', left, right: this.#binary(COMPARISON_LEVEL + 1), at }
        continue
      }

      if (negated) this.#fail() // consumed a NOT with nothing to attach it to
      return left
    }
  }

  // --- unary and primary ---------------------------------------------------

  /**
   * Prefix operators and the operand they apply to.
   *
   * The depth guard is entered here because every nesting level passes through
   * this method — a parenthesised subexpression reaches `#parenthesised` via
   * `#primary`, and a chain of unary operators recurses directly — so one
   * guard in one place bounds both. The counter itself is the cursor's, so it
   * is shared with every other parser of the same statement (M3.15).
   */
  #unary(): Expression {
    return this.#c.nested(() => this.#unaryInner())
  }

  #unaryInner(): Expression {
    const t = this.#peek()

    if (this.#mode.highNotPrecedence && this.#atWord('NOT')) {
      this.#c.skip()
      return { kind: NODE.UNARY, op: 'NOT', operand: this.#unary(), at: t.start }
    }
    if (this.#atOp('-') || this.#atOp('+') || this.#atOp('~') || this.#atOp('!')) {
      const op = this.#take().text
      return { kind: NODE.UNARY, op, operand: this.#unary(), at: t.start }
    }
    if (this.#atWord('BINARY')) {
      this.#c.skip()
      return { kind: NODE.UNARY, op: 'BINARY', operand: this.#unary(), at: t.start }
    }
    if (this.#atWord('INTERVAL')) {
      // `INTERVAL(n, a, b, …)` is a function — the index of the first bound
      // `n` is below — and `INTERVAL (n) DAY` is an interval with a
      // parenthesised value. The comma after the first argument is what tells
      // them apart, since the function needs at least two.
      // Read once, never rewound: a trial parse undone on failure is
      // exponential in nesting depth, which is a hang for anyone who can send
      // `INTERVAL((INTERVAL((…`.
      let value: Expression
      if (this.#atOp('(', 1)) {
        this.#c.skip()
        this.#c.skip()
        const first = this.#binary(0)
        if (this.#takeOp(',')) {
          const args = [first]
          do args.push(this.#binary(0))
          while (this.#takeOp(','))
          this.#expectOp(')')
          return { kind: NODE.CALL, name: t.text, args, at: t.start }
        }
        this.#expectOp(')')
        value = first
      } else {
        this.#c.skip()
        value = this.#binary(COMPARISON_LEVEL + 1)
      }
      const unit = this.#peek()
      if (unit.kind !== TOKEN.IDENTIFIER || !INTERVAL_UNITS.has(unit.text.toUpperCase())) this.#fail()
      this.#c.skip()
      return { kind: NODE.INTERVAL, value, unit: unit.text.toUpperCase(), at: t.start }
    }
    return this.#postfixCollate(this.#primary())
  }

  /**
   * `expr COLLATE utf8mb4_bin`, which binds tighter than anything binary,
   * and may follow another: `'a' COLLATE x COLLATE y` is in y. `BINARY` is
   * the keyword, not a collation, and so 1064 (8.4.11).
   */
  #postfixCollate(expr: Expression): Expression {
    let out = expr
    while (this.#atWord('COLLATE')) {
      this.#c.skip()
      const name = this.#peek()
      if (name.kind !== TOKEN.IDENTIFIER && name.kind !== TOKEN.STRING) this.#fail()
      if (name.kind === TOKEN.IDENTIFIER && name.quoted !== true && name.text.toUpperCase() === 'BINARY') this.#fail()
      this.#c.skip()
      out = out.kind === NODE.LITERAL && out.collation === undefined ? { ...out, collation: name.text } : { kind: NODE.COLLATE, expr: out, collation: name.text, at: out.at }
    }
    return out
  }

  #primary(): Expression {
    const t = this.#peek()

    switch (t.kind) {
      case TOKEN.NUMBER:
        this.#c.skip()
        return { kind: NODE.LITERAL, ...numericLiteral(t.text), at: t.start }
      case TOKEN.STRING: {
        this.#c.skip()
        // Adjacent string literals concatenate — `'a' 'b'` is `'ab'`, which is
        // SQL-standard and which MySQL does at the lexical level.
        let value = t.text
        while (this.#peek().kind === TOKEN.STRING) value += this.#take().text
        return { kind: NODE.LITERAL, type: LITERAL.STRING, value, at: t.start }
      }
      case TOKEN.HEX:
        this.#c.skip()
        return { kind: NODE.LITERAL, type: LITERAL.HEX, value: hexBytes(t.text), at: t.start }
      case TOKEN.BIT:
        this.#c.skip()
        return { kind: NODE.LITERAL, type: LITERAL.BIT, value: t.text === '' ? 0n : BigInt('0b' + t.text), at: t.start }
      case TOKEN.PLACEHOLDER:
        this.#c.skip()
        return { kind: NODE.PLACEHOLDER, index: t.index ?? 0, at: t.start }
      case TOKEN.VARIABLE:
        this.#c.skip()
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

  /**
   * `(a)` is a parenthesised expression, `(a, b)` a row constructor, and
   * `(SELECT …)` a subquery.
   *
   * `((SELECT 1) UNION (SELECT 2))` is the hard one: `(SELECT 1)` reads as a
   * scalar subquery, as it is in `((SELECT 1) + 1)`, and only the `UNION` after
   * it says it was a query's first branch. That is decided from the token, and
   * the query continued from where it is (`continueQueryFrom`), rather than by
   * parsing twice.
   */
  #parenthesised(): Expression {
    const open = this.#peek()
    if (atQueryStart(this.#c, 1)) {
      return { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), at: open.start }
    }
    this.#c.skip()
    let first = this.#binary(0)
    if (first.kind === NODE.SUBQUERY && first.quantifier === undefined && atQueryContinuation(this.#c)) {
      first = { kind: NODE.SUBQUERY, query: continueQueryFrom(this.#c, this.#mode, first.query), at: open.start }
    }
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
        this.#c.skip()
        return { kind: NODE.LITERAL, type: LITERAL.NULL, value: null, at: t.start }
      }
      if (upper === 'TRUE' || upper === 'FALSE') {
        this.#c.skip()
        return { kind: NODE.LITERAL, type: LITERAL.BOOL, value: upper === 'TRUE', at: t.start }
      }
      if (upper === 'CASE') return this.#case()
      // `_latin1'x'` — a charset introducer. MySQL lexes this as its own token
      // kind; here the lexer leaves it an identifier and the shape is
      // recognised at the point where it can only mean one thing.
      if (t.text.startsWith('_') && this.#peek(1).kind === TOKEN.STRING) {
        this.#c.skip()
        let value = this.#take().text
        while (this.#peek().kind === TOKEN.STRING) value += this.#take().text
        return { kind: NODE.LITERAL, type: LITERAL.STRING, value, charset: t.text.slice(1).toLowerCase(), at: t.start }
      }
      // …and before a hex or bit literal: `_binary 0x41`, `_utf8mb4 x'C3A6'`.
      if (t.text.startsWith('_') && (this.#peek(1).kind === TOKEN.HEX || this.#peek(1).kind === TOKEN.BIT)) {
        this.#c.skip()
        const lit = this.#primary()
        return { ...(lit as Extract<Expression, { kind: 'literal' }>), charset: t.text.slice(1).toLowerCase(), at: t.start }
      }
      // `N'x'` is the national charset's literal, which MySQL defines as utf8mb3.
      if (upper === 'N' && this.#peek(1).kind === TOKEN.STRING && this.#peek(1).start === t.end) {
        this.#c.skip()
        let value = this.#take().text
        while (this.#peek().kind === TOKEN.STRING) value += this.#take().text
        return { kind: NODE.LITERAL, type: LITERAL.STRING, value, charset: 'utf8mb3', at: t.start }
      }
      if (upper === 'EXISTS' && this.#atOp('(', 1)) {
        this.#c.skip()
        const open = this.#peek().start
        const operand = { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), at: open } as const
        return { kind: NODE.UNARY, op: 'EXISTS', operand, at: t.start }
      }
      // `ROW(1, 2)` is the row constructor `(1, 2)` spelled out.
      if (upper === 'ROW' && this.#atOp('(', 1)) {
        this.#c.skip()
        const open = this.#take()
        const items: Expression[] = []
        do items.push(this.#binary(0))
        while (this.#takeOp(','))
        this.#expectOp(')')
        return { kind: NODE.ROW, items, at: open.start }
      }
      if (upper === 'MATCH' && (this.#atOp('(', 1) || this.#peek(1).kind === TOKEN.IDENTIFIER)) return this.#match()
      if (this.#atOp('(', 1)) {
        const special = this.#specialCall(upper)
        if (special !== null) return special
      }
      // A typed temporal literal: `DATE'2019-10-01'`, and its `TIME` and
      // `TIMESTAMP` siblings. The keyword types the string beside it, so this
      // is a DATE rather than the string it is written with — which is why
      // `DEFAULT DATE'…'` is legal on a DATE column where a bare string is
      // not. Found by M3.11's census in `default.test`.
      if (TEMPORAL_KEYWORDS.has(upper) && this.#peek(1).kind === TOKEN.STRING) {
        this.#c.skip()
        const s = this.#take()
        return { kind: NODE.LITERAL, type: LITERAL.TEMPORAL, value: s.text, unit: upper, at: t.start }
      }
      // A reserved word is never a column reference (M3.15). It may be a
      // builtin function — `IF(`, `LEFT(`, or `CURRENT_TIMESTAMP` with or
      // without its parentheses — and is otherwise where the expression ends,
      // which is what lets `SELECT a FROM t` stop at `FROM`.
      if (RESERVED.has(upper)) {
        if (NILADIC.has(upper) && !this.#atOp('(', 1)) {
          this.#c.skip()
          return { kind: NODE.CALL, name: t.text, args: [], at: t.start }
        }
        if (!RESERVED_FUNCTIONS.has(upper) || !this.#atOp('(', 1)) this.#fail()
        return this.#call()
      }
    }

    // `name(` is a call, **and a space before the `(` is allowed**.
    //
    // This started life as the opposite rule, on the strength of the manual's
    // "there must be no whitespace between a function name and the following
    // parenthesis". M3.11's census disagreed: `default_as_expr.test` contains
    //
    //     something VARCHAR(64) NOT NULL DEFAULT (CONCAT ('[', data, ']'))
    //
    // with no `--error` in front of it, so a real 8.4 accepts it. The manual's
    // rule applies only to the builtin functions that are *also grammar
    // keywords* — `COUNT`, `LEFT`, `IF` and their like — which become reserved
    // under `IGNORE_SPACE`. Modelling that list needs the reserved-word list
    // M3.3 will bring; until then the permissive reading is the one the corpus
    // supports, and the strict one silently refused valid SQL.
    if (this.#atOp('(', 1)) return this.#call()

    // A qualified name: `a`, `t.a`, `db.t.a`, `t.*` or `db.t.*` — three parts
    // at most, since `a.b.c.d` names nothing.
    this.#c.skip()
    const parts = [t.text]
    while (this.#atOp('.') && parts.length < 3) {
      this.#c.skip()
      if (this.#atOp('*')) {
        this.#c.skip()
        parts.push('*')
        break
      }
      parts.push(this.#c.expectNamePart())
    }
    const column = { kind: NODE.COLUMN, parts, at: t.start } as const
    // `col->'$.a'` and `col->>'$.a'`: JSON extraction, which MySQL's grammar
    // allows only on a column name and only with a string literal path.
    if (this.#atOp('->') || this.#atOp('->>')) {
      const op = this.#take()
      const path = this.#peek()
      if (path.kind !== TOKEN.STRING) this.#fail()
      this.#c.skip()
      const right = { kind: NODE.LITERAL, type: LITERAL.STRING, value: path.text, at: path.start } as const
      return { kind: NODE.BINARY, op: op.text, left: column, right, at: op.start }
    }
    return column
  }

  #call(): Expression {
    const name = this.#take()
    const upper = name.text.toUpperCase()
    this.#expectOp('(')
    const distinct = this.#takeWord('DISTINCT')
    // `SUM(ALL a)` is `SUM(a)`: `ALL` is the default an aggregate may spell out.
    if (!distinct && AGGREGATES.has(upper)) this.#takeWord('ALL')
    const args: Expression[] = []
    if (this.#atOp('*') && !distinct) {
      // `COUNT(*)` — the only place a bare star is an argument.
      this.#c.skip()
      args.push({ kind: NODE.COLUMN, parts: ['*'], at: this.#peek().start })
    } else if (!this.#atOp(')')) {
      do {
        // LAG's and LEAD's distance is a number as written or a `?`, nothing signed (8.4.11: `LAG(v, -1)` is 1064 at the `-`).
        if (args.length === 1 && (upper === 'LAG' || upper === 'LEAD') && this.#peek().kind !== TOKEN.NUMBER && this.#peek().kind !== TOKEN.PLACEHOLDER) this.#fail()
        args.push(this.#binary(0))
      } while (this.#takeOp(','))
    }
    // `GROUP_CONCAT` is the one aggregate with clauses inside its parentheses,
    // and `CHAR` the one function that names a charset there.
    let orderBy: ReturnType<typeof parseOrderBy> | undefined
    let separator: string | undefined
    let using: string | undefined
    if (upper === 'GROUP_CONCAT') {
      if (this.#atWord('ORDER') && this.#atWord('BY', 1)) orderBy = parseOrderBy(this.#c, this.#mode)
      if (this.#takeWord('SEPARATOR')) separator = this.#stringText()
    }
    if (upper === 'CHAR' && this.#takeWord('USING')) using = this.#charsetName()
    this.#expectOp(')')
    const over = this.#over()
    return {
      kind: NODE.CALL,
      name: name.text,
      args,
      ...(distinct ? { distinct: true } : {}),
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(separator === undefined ? {} : { separator }),
      ...(using === undefined ? {} : { using }),
      ...(over === undefined ? {} : { over }),
      at: name.start,
    }
  }

  /** `OVER w` or `OVER (…)` after a call — a window function, or an aggregate used as one. */
  #over() {
    if (!this.#takeWord('OVER')) return undefined
    if (this.#c.atIdentifier()) return this.#take().text
    this.#expectOp('(')
    const spec = parseWindowSpec(this.#c, this.#mode)
    this.#expectOp(')')
    return spec
  }

  /**
   * The builtins whose arguments are not a comma-separated list — MySQL's
   * grammar gives each its own production. Each parses to the node a plain
   * call would, where one exists, so the deparser and every later stage see
   * one shape: `SUBSTRING(s FROM 2 FOR 3)` *is* `SUBSTRING(s, 2, 3)`.
   *
   * Only an unquoted name gets here: `` `cast`(x) `` is a stored function.
   */
  #specialCall(upper: string): Expression | null {
    const t = this.#peek()
    switch (upper) {
      case 'CAST': {
        this.#c.skip()
        this.#expectOp('(')
        const expr = this.#binary(0)
        let timeZone: string | undefined
        if (this.#takeWord('AT')) {
          this.#expectWord('TIME')
          this.#expectWord('ZONE')
          this.#takeWord('INTERVAL')
          timeZone = this.#stringText()
        }
        this.#expectWord('AS')
        const type = this.#castType()
        const array = this.#takeWord('ARRAY')
        this.#expectOp(')')
        return { kind: NODE.CAST, expr, type, ...(array ? { array } : {}), ...(timeZone === undefined ? {} : { timeZone }), at: t.start }
      }
      case 'CONVERT': {
        this.#c.skip()
        this.#expectOp('(')
        const expr = this.#binary(0)
        if (this.#takeWord('USING')) {
          const charset = this.#charsetName()
          this.#expectOp(')')
          return { kind: NODE.CONVERT, expr, charset, at: t.start }
        }
        this.#expectOp(',')
        const type = this.#castType()
        this.#expectOp(')')
        return { kind: NODE.CAST, expr, type, at: t.start }
      }
      case 'EXTRACT': {
        this.#c.skip()
        this.#expectOp('(')
        const unit = this.#unitKeyword()
        this.#expectWord('FROM')
        const expr = this.#binary(0)
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args: [unit, expr], at: t.start }
      }
      case 'TIMESTAMPADD':
      case 'TIMESTAMPDIFF': {
        this.#c.skip()
        this.#expectOp('(')
        const args: Expression[] = [this.#unitKeyword(true)]
        while (this.#takeOp(',')) args.push(this.#binary(0))
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'GET_FORMAT': {
        this.#c.skip()
        this.#expectOp('(')
        const k = this.#peek()
        if (!['DATE', 'TIME', 'DATETIME', 'TIMESTAMP'].some((w) => this.#atWord(w))) this.#fail()
        this.#c.skip()
        this.#expectOp(',')
        const args: Expression[] = [{ kind: NODE.KEYWORD, word: k.text.toUpperCase(), at: k.start }, this.#binary(0)]
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'POSITION': {
        // `POSITION(a IN b)`: `a` is read above the comparison level, or its
        // `IN` would be taken for the membership predicate.
        this.#c.skip()
        this.#expectOp('(')
        const needle = this.#binary(COMPARISON_LEVEL + 1)
        this.#expectWord('IN')
        const haystack = this.#binary(0)
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args: [needle, haystack], at: t.start }
      }
      case 'SUBSTRING':
      case 'SUBSTR': {
        if (!this.#substringHasFrom()) return null
        this.#c.skip()
        this.#expectOp('(')
        const args: Expression[] = [this.#binary(0)]
        this.#expectWord('FROM')
        args.push(this.#binary(0))
        if (this.#takeWord('FOR')) args.push(this.#binary(0))
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'TRIM': {
        // `TRIM(s)`, `TRIM(r FROM s)`, `TRIM(LEADING [r] FROM s)`. The side is
        // a keyword argument first; the string being trimmed is always last.
        this.#c.skip()
        this.#expectOp('(')
        const args: Expression[] = []
        const side = this.#peek()
        if (this.#atWord('LEADING') || this.#atWord('TRAILING') || this.#atWord('BOTH')) {
          this.#c.skip()
          args.push({ kind: NODE.KEYWORD, word: side.text.toUpperCase(), at: side.start })
          if (!this.#atWord('FROM')) args.push(this.#binary(0))
          this.#expectWord('FROM')
          args.push(this.#binary(0))
        } else {
          args.push(this.#binary(0))
          if (this.#takeWord('FROM')) args.push(this.#binary(0))
        }
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'WEIGHT_STRING': {
        // `WEIGHT_STRING(s AS CHAR(n))` pads or truncates `s` to `n`
        // characters first; `AS BINARY(n)` to `n` bytes. The cast is kept as
        // two keyword-ish arguments rather than a CAST node, because it is not
        // one — it changes the length the weights are computed over, not the
        // value's type.
        this.#c.skip()
        this.#expectOp('(')
        const args: Expression[] = [this.#binary(0)]
        if (this.#takeWord('AS')) {
          const k = this.#peek()
          if (!this.#atWord('CHAR') && !this.#atWord('BINARY')) this.#fail()
          this.#c.skip()
          args.push({ kind: NODE.KEYWORD, word: k.text.toUpperCase(), at: k.start })
          this.#expectOp('(')
          const n = this.#peek()
          if (n.kind !== TOKEN.NUMBER || !/^\d+$/.test(n.text)) this.#fail()
          this.#c.skip()
          args.push({ kind: NODE.LITERAL, type: LITERAL.INT, value: BigInt(n.text), at: n.start })
          this.#expectOp(')')
        }
        while (this.#takeOp(',')) args.push(this.#binary(0))
        this.#expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      default:
        return null
    }
  }

  /** Whether `SUBSTRING(` uses the `FROM` form, by finding `FROM` before the closing paren. */
  #substringHasFrom(): boolean {
    let depth = 0
    for (let i = 1; ; i++) {
      const t = this.#peek(i)
      if (t.kind === TOKEN.EOF) return false
      if (t.kind === TOKEN.OPERATOR && t.text === '(') depth++
      else if (t.kind === TOKEN.OPERATOR && t.text === ')') {
        if (--depth === 0) return false
      } else if (depth === 1 && this.#atWord('FROM', i)) return true
    }
  }

  /**
   * A time unit as a bare word. `TIMESTAMPADD` and `TIMESTAMPDIFF` also take
   * the ODBC spellings, `SQL_TSI_DAY` for `DAY` — kept as written, since the
   * deparser must write back a word the same function accepts.
   */
  #unitKeyword(odbc = false): Expression {
    const u = this.#peek()
    const word = u.text.toUpperCase()
    const unit = odbc && word.startsWith('SQL_TSI_') ? word.slice('SQL_TSI_'.length) : word
    if (u.kind !== TOKEN.IDENTIFIER || u.quoted === true || !INTERVAL_UNITS.has(unit)) this.#fail()
    this.#c.skip()
    return { kind: NODE.KEYWORD, word, at: u.start }
  }

  /**
   * A `CAST` target. Narrower than a column type — `CAST(x AS INT)` is a
   * syntax error — and with two targets a column cannot have: `SIGNED` and
   * `UNSIGNED`, each optionally followed by `INT` or `INTEGER`.
   */
  #castType(): DataType {
    const t = this.#peek()
    if (this.#atWord('SIGNED') || this.#atWord('UNSIGNED')) {
      const name = this.#take().text.toUpperCase()
      this.#takeWord('INTEGER') || this.#takeWord('INT')
      return { name, code: FIELD_TYPE.LONGLONG, at: t.start }
    }
    const type = parseDataType(this.#c, this.#mode)
    if (!CAST_TYPES.has(type.name) || type.unsigned !== undefined || type.zerofill !== undefined) this.#fail()
    // `FLOAT(p)` is a precision and becomes FLOAT or DOUBLE; `FLOAT(m,d)`,
    // `DOUBLE(m)` and `REAL(m)` are column syntax a `CAST` refuses — the
    // corpus's `cast.test` marks all five spellings ER_PARSE_ERROR.
    if ((type.name === 'FLOAT' || type.name === 'DOUBLE') && type.length !== undefined) this.#fail()
    return type
  }

  #charsetName(): string {
    const t = this.#peek()
    if (t.kind !== TOKEN.IDENTIFIER && t.kind !== TOKEN.STRING) this.#fail()
    this.#c.skip()
    return t.text.toLowerCase()
  }

  #stringText(): string {
    const t = this.#peek()
    if (t.kind !== TOKEN.STRING) this.#fail()
    this.#c.skip()
    let text = t.text
    while (this.#peek().kind === TOKEN.STRING) text += this.#take().text
    return text
  }

  /** `MATCH (a, b) AGAINST ('x' [IN NATURAL LANGUAGE MODE | IN BOOLEAN MODE] [WITH QUERY EXPANSION])`. */
  #match(): Expression {
    const t = this.#take()
    // The column list may go without its parentheses: `MATCH a AGAINST (…)`.
    const parenthesised = this.#takeOp('(')
    // Each is a column's name, qualified or not, and nothing else: the
    // grammar's `simple_ident` (8.4.11: `MATCH(UPPER(t))` is 1064 at its `(`).
    const columns: Expression[] = []
    do {
      const c = this.#peek()
      if (c.kind !== TOKEN.IDENTIFIER) this.#fail()
      this.#c.skip()
      const parts = [c.text]
      while (this.#atOp('.') && parts.length < 3) {
        this.#c.skip()
        parts.push(this.#c.expectNamePart())
      }
      columns.push({ kind: NODE.COLUMN, parts, at: c.start })
    } while (this.#takeOp(','))
    if (parenthesised) this.#expectOp(')')
    this.#expectWord('AGAINST')
    this.#expectOp('(')
    const against = this.#binary(COMPARISON_LEVEL + 1)
    let modifier: string | undefined
    if (this.#c.takeWords('IN', 'NATURAL', 'LANGUAGE', 'MODE')) {
      modifier = this.#c.takeWords('WITH', 'QUERY', 'EXPANSION') ? 'IN NATURAL LANGUAGE MODE WITH QUERY EXPANSION' : 'IN NATURAL LANGUAGE MODE'
    } else if (this.#c.takeWords('IN', 'BOOLEAN', 'MODE')) modifier = 'IN BOOLEAN MODE'
    else if (this.#c.takeWords('WITH', 'QUERY', 'EXPANSION')) modifier = 'WITH QUERY EXPANSION'
    this.#expectOp(')')
    return { kind: NODE.MATCH, columns, against, ...(modifier === undefined ? {} : { modifier }), at: t.start }
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
function numericLiteral(text: string): { type: LiteralType; value: bigint | number | string; text?: string } {
  // A DOUBLE keeps its text: MySQL sizes the literal by how it was written (`1e1` is 3 wide).
  if (/[eE]/.test(text)) return { type: LITERAL.DOUBLE, value: Number(text), text }
  if (text.includes('.')) return { type: LITERAL.DECIMAL, value: text }
  return { type: LITERAL.INT, value: BigInt(text) }
}
