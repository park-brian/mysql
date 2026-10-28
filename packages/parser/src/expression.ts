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
import { systemVariableParts } from './variable.ts'
import { Cursor, flag, opt } from './cursor.ts'
import { RESERVED } from './keywords.ts'
import { TOKEN, keywordText } from './tokens.ts'
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
import { defaultCollationOf } from '@myjs/charsets'
import { illegalDouble } from './errors.ts'
import { charsetName, collationName } from './names.ts'
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
const TEMPORAL_KEYWORDS = new Set(['DATE', 'TIME', 'TIMESTAMP'])

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
 * The builtins whose names the server's lexer recognises as function tokens
 * only when `(` follows at once, or anywhere under IGNORE_SPACE: the list in
 * the Reference Manual's "Function Name Parsing and Resolution", each name
 * checked against 8.4.11 (`SELECT NAME (1)` is 1630 for these 35, and the
 * builtin for any other).
 */
const SPACE_SENSITIVE: ReadonlySet<string> = new Set([
  'ADDDATE', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'CAST', 'COUNT', 'CURDATE', 'CURTIME', 'DATE_ADD', 'DATE_SUB', 'EXTRACT', 'GROUP_CONCAT',
  'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'MAX', 'MID', 'MIN', 'NOW', 'POSITION', 'SESSION_USER', 'STD', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP',
  'ST_COLLECT', 'SUBDATE', 'SUBSTR', 'SUBSTRING', 'SUM', 'SYSDATE', 'SYSTEM_USER', 'TRIM', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
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
  return cursor.checked(() => {
    const expr = new ExpressionParser(cursor, mode).parse()
    if (!cursor.atEnd()) cursor.fail()
    return expr
  })
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
    const t = this.#c.peek()
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
    const word = keywordText(t)
    // A word operator must be a word MySQL treats as one; otherwise `a b` is
    // two expressions, not an application of an operator named `b`.
    if (WORD_OPERATORS.has(word) && ops.includes(word)) return word
    return null
  }

  /**
   * `level` counts down the table: 0 is `:=`, `LEVELS.length` is the extra
   * level `PIPES_AS_CONCAT` creates between `^` and the unary operators.
   */
  #binary(level: number): Expression {
    const cursor = this.#c
    if (level > LEVELS.length) return this.#unary()

    // `NOT` is prefix, not infix, but it sits *between* two binary levels — so
    // it is handled at the level it occupies rather than with the other unary
    // operators. `HIGH_NOT_PRECEDENCE` moves it up beside them instead.
    if (!this.#mode.highNotPrecedence && level === NOT_LEVEL && cursor.atWord('NOT')) {
      const t = cursor.take()
      return { kind: NODE.UNARY, op: 'NOT', operand: this.#binary(level), at: t.start }
    }

    let left = this.#binary(level + 1)

    if (level === COMPARISON_LEVEL) left = this.#predicate(left)

    for (;;) {
      const op = this.#binaryOpAt(level)
      if (op === null) return left
      // Only a user variable can be assigned: `a := 1`, `@@sql_mode := 1` and
      // `a = 1 := 2` are all ER_PARSE_ERROR on a real 8.4.
      if (op === ':=' && !(left.kind === NODE.VARIABLE && !left.name.startsWith('@@'))) cursor.fail()
      const t = cursor.take()
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
    const cursor = this.#c
    const t = cursor.peek()
    const word = keywordText(t)
    if ((word !== 'ANY' && word !== 'SOME' && word !== 'ALL') || !cursor.atOp('(', 1)) return null
    cursor.skip()
    const quantifier = word === 'ALL' ? 'ALL' : 'ANY'
    return { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), quantifier, at: t.start }
  }

  /** `( query )`, with the cursor on the `(`. */
  #parenthesisedQuery() {
    const cursor = this.#c
    cursor.expectOp('(')
    const query = parseQueryFrom(cursor, this.#mode)
    cursor.expectOp(')')
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
    const cursor = this.#c
    for (;;) {
      const at = cursor.peek().start

      if (cursor.takeWord('IS')) {
        const negated = cursor.takeWord('NOT')
        let op = 'IS'
        if (cursor.takeWord('NULL')) op = negated ? 'IS NOT NULL' : 'IS NULL'
        else if (cursor.takeWord('TRUE')) op = negated ? 'IS NOT TRUE' : 'IS TRUE'
        else if (cursor.takeWord('FALSE')) op = negated ? 'IS NOT FALSE' : 'IS FALSE'
        else if (cursor.takeWord('UNKNOWN')) op = negated ? 'IS NOT UNKNOWN' : 'IS UNKNOWN'
        else cursor.fail()
        left = { kind: NODE.UNARY, op, operand: left, at }
        continue
      }

      // `NOT` here is the start of `NOT BETWEEN` / `NOT IN` / `NOT LIKE` /
      // `NOT REGEXP`, and nothing else — so it is only consumed once one of
      // those follows.
      const negated =
        cursor.atWord('NOT') &&
        (cursor.atWord('BETWEEN', 1) || cursor.atWord('IN', 1) || cursor.atWord('LIKE', 1) || cursor.atWord('REGEXP', 1) || cursor.atWord('RLIKE', 1))
      if (negated) cursor.skip()

      if (cursor.takeWord('BETWEEN')) {
        // The upper bound is parsed *above* the AND level, or the `AND` that
        // separates the bounds would be read as a conjunction and swallow the
        // rest of the expression.
        const lower = this.#binary(COMPARISON_LEVEL + 1)
        cursor.expectWord('AND')
        const upper = this.#binary(COMPARISON_LEVEL + 1)
        left = { kind: NODE.BINARY, op: negated ? 'NOT BETWEEN' : 'BETWEEN', left, right: lower, extra: upper, at }
        continue
      }

      if (cursor.takeWord('IN')) {
        // `IN (SELECT …)` is a membership test against a subquery's rows, not
        // a list holding one scalar subquery — which is what `IN ((SELECT …))`
        // is. The two are told apart by the token after the parenthesis.
        if (cursor.atOp('(') && atQueryStart(cursor, 1)) {
          const open = cursor.peek().start
          const right = { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), at: open } as const
          left = { kind: NODE.BINARY, op: negated ? 'NOT IN' : 'IN', left, right, at }
          continue
        }
        // At least one item: `a IN ()` is a syntax error.
        cursor.expectOp('(')
        const items: Expression[] = []
        do items.push(this.#binary(0))
        while (cursor.takeOp(','))
        cursor.expectOp(')')
        left = {
          kind: NODE.BINARY,
          op: negated ? 'NOT IN' : 'IN',
          left,
          right: { kind: NODE.ROW, items, at },
          at,
        }
        continue
      }

      if (cursor.takeWord('LIKE')) {
        const pattern = this.#binary(COMPARISON_LEVEL + 1)
        const node = { kind: NODE.BINARY, op: negated ? 'NOT LIKE' : 'LIKE', left, right: pattern, at } as const
        left = cursor.takeWord('ESCAPE')
          ? { ...node, extra: this.#binary(COMPARISON_LEVEL + 1) }
          : node
        continue
      }

      if (cursor.atWord('REGEXP') || cursor.atWord('RLIKE')) {
        cursor.skip()
        const pattern = this.#binary(COMPARISON_LEVEL + 1)
        left = { kind: NODE.BINARY, op: negated ? 'NOT REGEXP' : 'REGEXP', left, right: pattern, at }
        continue
      }

      // `a MEMBER OF (json)` (8.0.17) and `a SOUNDS LIKE b`, neither of which
      // takes a `NOT`.
      if (!negated && cursor.atWord('MEMBER') && cursor.atWord('OF', 1)) {
        cursor.skip()
        cursor.skip()
        cursor.expectOp('(')
        const right = this.#binary(0)
        cursor.expectOp(')')
        left = { kind: NODE.BINARY, op: 'MEMBER OF', left, right, at }
        continue
      }
      if (!negated && cursor.atWord('SOUNDS') && cursor.atWord('LIKE', 1)) {
        cursor.skip()
        cursor.skip()
        left = { kind: NODE.BINARY, op: 'SOUNDS LIKE', left, right: this.#binary(COMPARISON_LEVEL + 1), at }
        continue
      }

      if (negated) cursor.fail() // consumed a NOT with nothing to attach it to
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
    const cursor = this.#c
    const t = cursor.peek()

    if (this.#mode.highNotPrecedence && cursor.atWord('NOT')) {
      cursor.skip()
      return { kind: NODE.UNARY, op: 'NOT', operand: this.#unary(), at: t.start }
    }
    if (cursor.atOp('-') || cursor.atOp('+') || cursor.atOp('~') || cursor.atOp('!')) {
      const op = cursor.take().text
      return { kind: NODE.UNARY, op, operand: this.#unary(), at: t.start }
    }
    if (cursor.atWord('BINARY')) {
      cursor.skip()
      return { kind: NODE.UNARY, op: 'BINARY', operand: this.#unary(), at: t.start }
    }
    if (cursor.atWord('INTERVAL')) {
      // `INTERVAL(n, a, b, …)` is a function — the index of the first bound
      // `n` is below — and `INTERVAL (n) DAY` is an interval with a
      // parenthesised value. The comma after the first argument is what tells
      // them apart, since the function needs at least two.
      // Read once, never rewound: a trial parse undone on failure is
      // exponential in nesting depth, which is a hang for anyone who can send
      // `INTERVAL((INTERVAL((…`.
      let value: Expression
      if (cursor.atOp('(', 1)) {
        cursor.skip()
        cursor.skip()
        const first = this.#binary(0)
        if (cursor.takeOp(',')) {
          const args = [first]
          do args.push(this.#binary(0))
          while (cursor.takeOp(','))
          cursor.expectOp(')')
          return { kind: NODE.CALL, name: t.text, args, at: t.start }
        }
        cursor.expectOp(')')
        value = first
      } else {
        cursor.skip()
        value = this.#binary(COMPARISON_LEVEL + 1)
      }
      const unit = cursor.peek()
      if (unit.kind !== TOKEN.IDENTIFIER || !INTERVAL_UNITS.has(unit.text.toUpperCase())) cursor.fail()
      cursor.skip()
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
    const cursor = this.#c
    let out = expr
    while (cursor.takeWord('COLLATE')) {
      if (cursor.atWord('BINARY')) cursor.fail()
      const name = collationName(cursor, true)
      out = out.kind === NODE.LITERAL && out.collation === undefined ? { ...out, collation: name } : { kind: NODE.COLLATE, expr: out, collation: name, at: out.at }
    }
    return out
  }

  #primary(): Expression {
    const cursor = this.#c
    const t = cursor.peek()

    switch (t.kind) {
      case TOKEN.NUMBER:
        cursor.skip()
        return { kind: NODE.LITERAL, ...numericLiteral(t.text, cursor), at: t.start }
      case TOKEN.STRING:
        return { kind: NODE.LITERAL, type: LITERAL.STRING, value: cursor.expectString(true), at: t.start }
      case TOKEN.HEX:
        cursor.skip()
        return { kind: NODE.LITERAL, type: LITERAL.HEX, value: hexBytes(t.text), at: t.start }
      case TOKEN.BIT:
        cursor.skip()
        return { kind: NODE.LITERAL, type: LITERAL.BIT, value: t.text === '' ? 0n : BigInt('0b' + t.text), text: t.text, at: t.start }
      case TOKEN.PLACEHOLDER:
        cursor.skip()
        return { kind: NODE.PLACEHOLDER, index: t.index ?? 0, at: t.start }
      case TOKEN.VARIABLE:
        if (!t.user && t.text.startsWith('@@')) {
          const parts = systemVariableParts(cursor, true)
          return { kind: NODE.VARIABLE, name: '@@' + parts.join('.'), parts, at: t.start }
        }
        cursor.skip()
        return { kind: NODE.VARIABLE, name: t.text, user: true, at: t.start }
      case TOKEN.OPERATOR:
        if (t.text === '(') return this.#parenthesised()
        break
      case TOKEN.IDENTIFIER:
        return this.#identifierLike()
    }
    return cursor.fail()
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
    const cursor = this.#c
    const open = cursor.peek()
    if (atQueryStart(cursor, 1)) {
      return { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), at: open.start }
    }
    cursor.skip()
    let first = this.#binary(0)
    if (first.kind === NODE.SUBQUERY && first.quantifier === undefined && atQueryContinuation(cursor)) {
      first = { kind: NODE.SUBQUERY, query: continueQueryFrom(cursor, this.#mode, first.query), at: open.start }
    }
    if (!cursor.atOp(',')) {
      cursor.expectOp(')')
      return first
    }
    const items: Expression[] = [first]
    while (cursor.takeOp(',')) items.push(this.#binary(0))
    cursor.expectOp(')')
    return { kind: NODE.ROW, items, at: open.start }
  }

  #identifierLike(): Expression {
    const cursor = this.#c
    const t = cursor.peek()
    const keyword = keywordText(t)
    const upper = keyword || t.text.toUpperCase()

    if (t.quoted !== true) {
      if (keyword === 'NULL') {
        cursor.skip()
        return { kind: NODE.LITERAL, type: LITERAL.NULL, value: null, at: t.start }
      }
      if (keyword === 'TRUE' || keyword === 'FALSE') {
        cursor.skip()
        return { kind: NODE.LITERAL, type: LITERAL.BOOL, value: upper === 'TRUE', at: t.start }
      }
      if (keyword === 'CASE') return this.#case()
      // Only a registered charset makes an introducer; otherwise this is a name.
      const next = cursor.peek(1).kind
      if (t.text.startsWith('_') && (next === TOKEN.STRING || next === TOKEN.HEX || next === TOKEN.BIT)) {
        const charset = t.text.slice(1).toLowerCase()
        if (defaultCollationOf(charset) !== undefined) {
          cursor.skip()
          if (next === TOKEN.STRING) return { kind: NODE.LITERAL, type: LITERAL.STRING, value: cursor.expectString(true), charset, at: t.start }
          const lit = this.#primary()
          return { ...(lit as Extract<Expression, { kind: 'literal' }>), charset, at: t.start }
        }
      }
      // `N'x'` is the national charset's literal, which MySQL defines as utf8mb3.
      if (keyword === 'N' && next === TOKEN.STRING && cursor.peek(1).start === t.end) {
        cursor.skip()
        return { kind: NODE.LITERAL, type: LITERAL.STRING, value: cursor.expectString(true), charset: 'utf8mb3', at: t.start }
      }
      if (keyword === 'EXISTS' && cursor.atOp('(', 1)) {
        cursor.skip()
        const open = cursor.peek().start
        const operand = { kind: NODE.SUBQUERY, query: this.#parenthesisedQuery(), at: open } as const
        return { kind: NODE.UNARY, op: 'EXISTS', operand, at: t.start }
      }
      // `ROW(1, 2)` is the row constructor `(1, 2)` spelled out.
      if (keyword === 'ROW' && cursor.atOp('(', 1)) {
        cursor.skip()
        const open = cursor.take()
        const items: Expression[] = []
        do items.push(this.#binary(0))
        while (cursor.takeOp(','))
        cursor.expectOp(')')
        return { kind: NODE.ROW, items, at: open.start }
      }
      if (keyword === 'MATCH' && (cursor.atOp('(', 1) || cursor.peek(1).kind === TOKEN.IDENTIFIER)) return this.#match()
      if (cursor.atOp('(', 1)) {
        // One of the builtins the lexer knows by name, a space before its
        // `(`, and IGNORE_SPACE off: not the builtin, but a stored function
        // of that name (8.4.11: `COUNT (*)` is 1064, `NOW ()` is 1630).
        if (SPACE_SENSITIVE.has(upper) && !this.#mode.ignoreSpace && cursor.peek(1).start !== t.start + t.text.length) return this.#storedCall()
        const special = this.#specialCall(keyword)
        if (special !== null) return special
      }
      // A typed temporal literal: `DATE'2019-10-01'`, and its `TIME` and
      // `TIMESTAMP` siblings. The keyword types the string beside it, so this
      // is a DATE rather than the string it is written with — which is why
      // `DEFAULT DATE'…'` is legal on a DATE column where a bare string is
      // not. Found by M3.11's census in `default.test`.
      if (TEMPORAL_KEYWORDS.has(keyword) && cursor.peek(1).kind === TOKEN.STRING) {
        cursor.skip()
        const s = cursor.take()
        return { kind: NODE.LITERAL, type: LITERAL.TEMPORAL, value: s.text, unit: keyword, at: t.start }
      }
      // A reserved word is never a column reference (M3.15). It may be a
      // builtin function — `IF(`, `LEFT(`, or `CURRENT_TIMESTAMP` with or
      // without its parentheses — and is otherwise where the expression ends,
      // which is what lets `SELECT a FROM t` stop at `FROM`.
      if (RESERVED.has(keyword)) {
        if (NILADIC.has(keyword) && !cursor.atOp('(', 1)) {
          cursor.skip()
          return { kind: NODE.CALL, name: t.text, args: [], at: t.start }
        }
        if (!RESERVED_FUNCTIONS.has(keyword) || !cursor.atOp('(', 1)) cursor.fail()
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
    // rule applies only to the builtins its lexer knows by name, which
    // `SPACE_SENSITIVE` lists and the branch above reads as stored functions
    // when a space comes first (M5.33).
    if (cursor.atOp('(', 1)) return this.#call()

    // A qualified name: `a`, `t.a`, `db.t.a`, `t.*` or `db.t.*` — three parts
    // at most, since `a.b.c.d` names nothing.
    cursor.skip()
    const parts = [t.text]
    while (cursor.atOp('.') && parts.length < 3) {
      cursor.skip()
      if (cursor.atOp('*')) {
        cursor.skip()
        parts.push('*')
        break
      }
      parts.push(cursor.expectNamePart())
    }
    const column = { kind: NODE.COLUMN, parts, at: t.start } as const
    // `col->'$.a'` and `col->>'$.a'`: JSON extraction, which MySQL's grammar
    // allows only on a column name and only with a string literal path.
    if (cursor.atOp('->') || cursor.atOp('->>')) {
      const op = cursor.take()
      const path = cursor.peek()
      if (path.kind !== TOKEN.STRING) cursor.fail()
      cursor.skip()
      const right = { kind: NODE.LITERAL, type: LITERAL.STRING, value: path.text, at: path.start } as const
      return { kind: NODE.BINARY, op: op.text, left: column, right, at: op.start }
    }
    return column
  }

  #call(): Expression {
    const cursor = this.#c
    const name = cursor.take()
    const upper = name.text.toUpperCase()
    cursor.expectOp('(')
    const distinct = cursor.takeWord('DISTINCT')
    // `SUM(ALL a)` is `SUM(a)`: `ALL` is the default an aggregate may spell out.
    if (!distinct && AGGREGATES.has(upper)) cursor.takeWord('ALL')
    const args: Expression[] = []
    if (cursor.atOp('*') && !distinct) {
      // `COUNT(*)` — the only place a bare star is an argument.
      cursor.skip()
      args.push({ kind: NODE.COLUMN, parts: ['*'], at: cursor.peek().start })
    } else if (!cursor.atOp(')')) {
      do {
        // LAG's and LEAD's distance is a number as written or a `?`, nothing signed (8.4.11: `LAG(v, -1)` is 1064 at the `-`).
        if (args.length === 1 && (upper === 'LAG' || upper === 'LEAD') && cursor.peek().kind !== TOKEN.NUMBER && cursor.peek().kind !== TOKEN.PLACEHOLDER) cursor.fail()
        args.push(this.#binary(0))
      } while (cursor.takeOp(','))
    }
    // `GROUP_CONCAT` is the one aggregate with clauses inside its parentheses,
    // and `CHAR` the one function that names a charset there.
    let orderBy: ReturnType<typeof parseOrderBy> | undefined
    let separator: string | undefined
    let using: string | undefined
    if (upper === 'GROUP_CONCAT') {
      if (cursor.atWord('ORDER') && cursor.atWord('BY', 1)) orderBy = parseOrderBy(cursor, this.#mode)
      if (cursor.takeWord('SEPARATOR')) separator = cursor.expectString(true)
    }
    if (upper === 'CHAR' && cursor.takeWord('USING')) using = charsetName(cursor).toLowerCase()
    cursor.expectOp(')')
    const over = this.#over()
    return {
      kind: NODE.CALL,
      name: name.text,
      args,
      ...flag('distinct', distinct),
      ...opt('orderBy', orderBy),
      ...opt('separator', separator),
      ...opt('using', using),
      ...opt('over', over),
      at: name.start,
    }
  }

  /** `OVER w` or `OVER (…)` after a call — a window function, or an aggregate used as one. */
  #over() {
    const cursor = this.#c
    if (!cursor.takeWord('OVER')) return undefined
    if (cursor.atIdentifier()) return cursor.take().text
    cursor.expectOp('(')
    const spec = parseWindowSpec(cursor, this.#mode)
    cursor.expectOp(')')
    return spec
  }

  /** `name (args)` read as a stored function's call: plain arguments, none of a builtin's own syntax. */
  #storedCall(): Expression {
    const cursor = this.#c
    const name = cursor.take()
    cursor.expectOp('(')
    const args: Expression[] = []
    if (!cursor.atOp(')')) {
      do args.push(this.#binary(0))
      while (cursor.takeOp(','))
    }
    cursor.expectOp(')')
    return { kind: NODE.CALL, name: name.text, args, stored: true, at: name.start }
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
    const cursor = this.#c
    const t = cursor.peek()
    switch (upper) {
      case 'CAST': {
        cursor.skip()
        cursor.expectOp('(')
        const expr = this.#binary(0)
        let timeZone: string | undefined
        if (cursor.takeWord('AT')) {
          cursor.expectWord('TIME')
          cursor.expectWord('ZONE')
          cursor.takeWord('INTERVAL')
          timeZone = cursor.expectString(true)
        }
        cursor.expectWord('AS')
        const type = this.#castType()
        const array = cursor.takeWord('ARRAY')
        cursor.expectOp(')')
        return { kind: NODE.CAST, expr, type, ...flag('array', array), ...opt('timeZone', timeZone), at: t.start }
      }
      case 'CONVERT': {
        cursor.skip()
        cursor.expectOp('(')
        const expr = this.#binary(0)
        if (cursor.takeWord('USING')) {
          const charset = charsetName(cursor).toLowerCase()
          cursor.expectOp(')')
          return { kind: NODE.CONVERT, expr, charset, at: t.start }
        }
        cursor.expectOp(',')
        const type = this.#castType()
        cursor.expectOp(')')
        return { kind: NODE.CAST, expr, type, at: t.start }
      }
      case 'EXTRACT': {
        cursor.skip()
        cursor.expectOp('(')
        const unit = this.#unitKeyword()
        cursor.expectWord('FROM')
        const expr = this.#binary(0)
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args: [unit, expr], at: t.start }
      }
      case 'TIMESTAMPADD':
      case 'TIMESTAMPDIFF': {
        cursor.skip()
        cursor.expectOp('(')
        const args: Expression[] = [this.#unitKeyword(true)]
        while (cursor.takeOp(',')) args.push(this.#binary(0))
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'GET_FORMAT': {
        cursor.skip()
        cursor.expectOp('(')
        const k = cursor.peek()
        if (!['DATE', 'TIME', 'DATETIME', 'TIMESTAMP'].some((w) => cursor.atWord(w))) cursor.fail()
        cursor.skip()
        cursor.expectOp(',')
        const args: Expression[] = [{ kind: NODE.KEYWORD, word: k.text.toUpperCase(), at: k.start }, this.#binary(0)]
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'POSITION': {
        // `POSITION(a IN b)`: `a` is read above the comparison level, or its
        // `IN` would be taken for the membership predicate.
        cursor.skip()
        cursor.expectOp('(')
        const needle = this.#binary(COMPARISON_LEVEL + 1)
        cursor.expectWord('IN')
        const haystack = this.#binary(0)
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args: [needle, haystack], at: t.start }
      }
      case 'SUBSTRING':
      case 'SUBSTR': {
        if (!this.#substringHasFrom()) return null
        cursor.skip()
        cursor.expectOp('(')
        const args: Expression[] = [this.#binary(0)]
        cursor.expectWord('FROM')
        args.push(this.#binary(0))
        if (cursor.takeWord('FOR')) args.push(this.#binary(0))
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'TRIM': {
        // `TRIM(s)`, `TRIM(r FROM s)`, `TRIM(LEADING [r] FROM s)`. The side is
        // a keyword argument first; the string being trimmed is always last.
        cursor.skip()
        cursor.expectOp('(')
        const args: Expression[] = []
        const side = cursor.peek()
        if (cursor.atWord('LEADING') || cursor.atWord('TRAILING') || cursor.atWord('BOTH')) {
          cursor.skip()
          args.push({ kind: NODE.KEYWORD, word: side.text.toUpperCase(), at: side.start })
          if (!cursor.atWord('FROM')) args.push(this.#binary(0))
          cursor.expectWord('FROM')
          args.push(this.#binary(0))
        } else {
          args.push(this.#binary(0))
          if (cursor.takeWord('FROM')) args.push(this.#binary(0))
        }
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      case 'WEIGHT_STRING': {
        // `WEIGHT_STRING(s AS CHAR(n))` pads or truncates `s` to `n`
        // characters first; `AS BINARY(n)` to `n` bytes. The cast is kept as
        // two keyword-ish arguments rather than a CAST node, because it is not
        // one — it changes the length the weights are computed over, not the
        // value's type.
        cursor.skip()
        cursor.expectOp('(')
        const args: Expression[] = [this.#binary(0)]
        if (cursor.takeWord('AS')) {
          const k = cursor.peek()
          if (!cursor.atWord('CHAR') && !cursor.atWord('BINARY')) cursor.fail()
          cursor.skip()
          args.push({ kind: NODE.KEYWORD, word: k.text.toUpperCase(), at: k.start })
          cursor.expectOp('(')
          const n = cursor.peek()
          if (n.kind !== TOKEN.NUMBER || !/^\d+$/.test(n.text)) cursor.fail()
          cursor.skip()
          args.push({ kind: NODE.LITERAL, type: LITERAL.INT, value: BigInt(n.text), at: n.start })
          cursor.expectOp(')')
        }
        while (cursor.takeOp(',')) args.push(this.#binary(0))
        cursor.expectOp(')')
        return { kind: NODE.CALL, name: t.text, args, at: t.start }
      }
      default:
        return null
    }
  }

  /** Whether `SUBSTRING(` uses the `FROM` form, by finding `FROM` before the closing paren. */
  #substringHasFrom(): boolean {
    const cursor = this.#c
    let depth = 0
    for (let i = 1; ; i++) {
      const t = cursor.peek(i)
      if (t.kind === TOKEN.EOF) return false
      if (t.kind === TOKEN.OPERATOR && t.text === '(') depth++
      else if (t.kind === TOKEN.OPERATOR && t.text === ')') {
        if (--depth === 0) return false
      } else if (depth === 1 && cursor.atWord('FROM', i)) return true
    }
  }

  /**
   * A time unit as a bare word. `TIMESTAMPADD` and `TIMESTAMPDIFF` also take
   * the ODBC spellings, `SQL_TSI_DAY` for `DAY` — kept as written, since the
   * deparser must write back a word the same function accepts.
   */
  #unitKeyword(odbc = false): Expression {
    const cursor = this.#c
    const u = cursor.peek()
    const word = keywordText(u)
    const unit = odbc && word.startsWith('SQL_TSI_') ? word.slice('SQL_TSI_'.length) : word
    if (!INTERVAL_UNITS.has(unit)) cursor.fail()
    cursor.skip()
    return { kind: NODE.KEYWORD, word, at: u.start }
  }

  /**
   * A `CAST` target. Narrower than a column type — `CAST(x AS INT)` is a
   * syntax error — and with two targets a column cannot have: `SIGNED` and
   * `UNSIGNED`, each optionally followed by `INT` or `INTEGER`.
   */
  #castType(): DataType {
    const cursor = this.#c
    const t = cursor.peek()
    if (cursor.takeWord('SIGNED') || cursor.takeWord('UNSIGNED')) {
      const name = t.text.toUpperCase()
      cursor.takeWord('INTEGER') || cursor.takeWord('INT')
      return { name, code: FIELD_TYPE.LONGLONG, at: t.start }
    }
    const type = parseDataType(cursor, this.#mode, false)
    if (!CAST_TYPES.has(type.name)) cursor.fail()
    // `FLOAT(p)` is a precision and becomes FLOAT or DOUBLE; `FLOAT(m,d)`,
    // `DOUBLE(m)` and `REAL(m)` are column syntax a `CAST` refuses — the
    // corpus's `cast.test` marks all five spellings ER_PARSE_ERROR.
    if ((type.name === 'FLOAT' || type.name === 'DOUBLE') && type.length !== undefined) cursor.fail()
    return type
  }

  /** `MATCH (a, b) AGAINST ('x' [IN NATURAL LANGUAGE MODE | IN BOOLEAN MODE] [WITH QUERY EXPANSION])`. */
  #match(): Expression {
    const cursor = this.#c
    const t = cursor.take()
    // The column list may go without its parentheses: `MATCH a AGAINST (…)`.
    const parenthesised = cursor.takeOp('(')
    // Each is a column's name, qualified or not, and nothing else: the
    // grammar's `simple_ident` (8.4.11: `MATCH(UPPER(t))` is 1064 at its `(`).
    const columns: Expression[] = []
    do {
      const c = cursor.peek()
      if (c.kind !== TOKEN.IDENTIFIER) cursor.fail()
      cursor.skip()
      const parts = [c.text]
      while (cursor.atOp('.') && parts.length < 3) {
        cursor.skip()
        parts.push(cursor.expectNamePart())
      }
      columns.push({ kind: NODE.COLUMN, parts, at: c.start })
    } while (cursor.takeOp(','))
    if (parenthesised) cursor.expectOp(')')
    cursor.expectWord('AGAINST')
    cursor.expectOp('(')
    const against = this.#binary(COMPARISON_LEVEL + 1)
    let modifier: string | undefined
    if (cursor.takeWords('IN', 'NATURAL', 'LANGUAGE', 'MODE')) {
      modifier = cursor.takeWords('WITH', 'QUERY', 'EXPANSION') ? 'IN NATURAL LANGUAGE MODE WITH QUERY EXPANSION' : 'IN NATURAL LANGUAGE MODE'
    } else if (cursor.takeWords('IN', 'BOOLEAN', 'MODE')) modifier = 'IN BOOLEAN MODE'
    else if (cursor.takeWords('WITH', 'QUERY', 'EXPANSION')) modifier = 'WITH QUERY EXPANSION'
    cursor.expectOp(')')
    return { kind: NODE.MATCH, columns, against, ...opt('modifier', modifier), at: t.start }
  }

  #case(): Expression {
    const cursor = this.#c
    const at = cursor.take().start
    // Two forms: `CASE x WHEN …` compares, `CASE WHEN …` tests. They are told
    // apart by whether an expression follows `CASE`.
    const operand = cursor.atWord('WHEN') ? undefined : this.#binary(0)
    const whens: { when: Expression; then: Expression }[] = []
    while (cursor.takeWord('WHEN')) {
      const when = this.#binary(0)
      cursor.expectWord('THEN')
      whens.push({ when, then: this.#binary(0) })
    }
    if (whens.length === 0) cursor.fail()
    const otherwise = cursor.takeWord('ELSE') ? this.#binary(0) : undefined
    cursor.expectWord('END')
    return {
      kind: NODE.CASE,
      ...opt('operand', operand),
      whens,
      ...opt('else', otherwise),
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
function numericLiteral(text: string, cursor: Cursor): { type: LiteralType; value: bigint | number | string; text?: string } {
  // A DOUBLE keeps its text: MySQL sizes the literal by how it was written (`1e1` is 3 wide).
  if (/[eE]/.test(text)) {
    const value = Number(text)
    if (!Number.isFinite(value)) cursor.report(illegalDouble(text))
    return { type: LITERAL.DOUBLE, value, text }
  }
  if (text.includes('.')) return { type: LITERAL.DECIMAL, value: text }
  return { type: LITERAL.INT, value: BigInt(text) }
}
