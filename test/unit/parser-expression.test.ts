// M3.2 / M3.9 — expression structure, and the errors a bad one produces.
//
// Precedence is checked against a real server in
// `test/format/precedence-vectors.test.ts`; this file covers the shapes that
// corpus cannot reach — the predicates, `CASE`, calls, qualified names — and
// the refusals ground rule 5 requires.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NODE, ParseError, parseExpression, parseSqlMode, type Expression } from '@myjs/parser'

/**
 * A parenthesised rendering of a tree.
 *
 * Every assertion below is written against this rather than against nested
 * object literals, because a wrong tree should read as a wrong string — an
 * assertion a reader can check against MySQL's manual without decoding an AST.
 */
function show(e: Expression): string {
  switch (e.kind) {
    case NODE.LITERAL: {
      const v = e.value instanceof Uint8Array ? `0x${[...e.value].map((b) => b.toString(16).padStart(2, '0')).join('')}` : String(e.value)
      return `${e.charset === undefined ? '' : `_${e.charset}`}${v}${e.collation === undefined ? '' : ` COLLATE ${e.collation}`}`
    }
    case NODE.PLACEHOLDER:
      return `?${e.index}`
    case NODE.COLUMN:
      return e.parts.join('.')
    case NODE.VARIABLE:
      return e.name
    case NODE.UNARY:
      return `(${e.op} ${show(e.operand)})`
    case NODE.BINARY: {
      const extra =
        e.extra === undefined
          ? ''
          : Array.isArray(e.extra)
            ? ` [${(e.extra as Expression[]).map(show).join(', ')}]`
            : ` [${show(e.extra as Expression)}]`
      return `(${show(e.left)} ${e.op} ${show(e.right)}${extra})`
    }
    case NODE.CALL:
      return `${e.name}(${e.distinct === true ? 'DISTINCT ' : ''}${e.args.map(show).join(', ')})`
    case NODE.ROW:
      return `<${e.items.map(show).join(', ')}>`
    case NODE.CASE:
      return `CASE(${e.operand === undefined ? '' : `${show(e.operand)} `}${e.whens
        .map((w) => `${show(w.when)}=>${show(w.then)}`)
        .join(' ')}${e.else === undefined ? '' : ` else ${show(e.else)}`})`
    case NODE.INTERVAL:
      return `INTERVAL(${show(e.value)} ${e.unit})`
  }
}

const tree = (sql: string, mode?: string) =>
  show(parseExpression(sql, mode === undefined ? {} : { sqlMode: parseSqlMode(mode) }))

test('M3.2: the postfix predicates chain and bind at the comparison level', () => {
  assert.equal(tree('a IS NOT NULL'), '(IS NOT NULL a)')
  // Postfix predicates chain, so this is legal and left-nested.
  assert.equal(tree('a IS NULL IS TRUE'), '(IS TRUE (IS NULL a))')
  assert.equal(tree('a IN (1, 2)'), '(a IN <1, 2>)')
  assert.equal(tree('a NOT IN (1)'), '(a NOT IN <1>)')
  assert.equal(tree("a LIKE 'x' ESCAPE '!'"), '(a LIKE x [!])')
  assert.equal(tree('a REGEXP b'), '(a REGEXP b)')
  assert.equal(tree('a RLIKE b'), '(a REGEXP b)', 'RLIKE is a synonym')
})

test('M3.2: BETWEEN does not let its AND swallow the rest of the expression', () => {
  // The classic bug. `BETWEEN x AND y` contains an `AND` that is *part of the
  // operator*, so parsing the upper bound at the ordinary AND level makes it a
  // conjunction and eats everything after it.
  assert.equal(tree('a BETWEEN 1 AND 2'), '(a BETWEEN 1 [2])')
  assert.equal(tree('a BETWEEN 1 AND 2 AND b'), '((a BETWEEN 1 [2]) AND b)')
  assert.equal(tree('a NOT BETWEEN 1 AND 2'), '(a NOT BETWEEN 1 [2])')
})

test('M3.2: calls, qualified names and the bare star', () => {
  assert.equal(tree('f(1, 2)'), 'f(1, 2)')
  assert.equal(tree('COUNT(*)'), 'COUNT(*)')
  assert.equal(tree('COUNT(DISTINCT x)'), 'COUNT(DISTINCT x)')
  assert.equal(tree('f()'), 'f()')
  assert.equal(tree('db.t.a'), 'db.t.a')
  assert.equal(tree('t.*'), 't.*')
  // **A space before the `(` is allowed**, and this assertion used to say the
  // opposite. The manual's "there must be no whitespace between a function
  // name and the following parenthesis" reads like a general rule and is not
  // one: M3.11's census found `DEFAULT (CONCAT ('[', data, ']'))` in
  // `default_as_expr.test` with no `--error` in front of it, so a real 8.4
  // accepts it. The rule applies to the builtins that are also grammar
  // keywords, which `IGNORE_SPACE` makes reserved; modelling that list needs
  // the reserved words M3.3 brings. Until then the permissive reading is the
  // one the corpus supports, and the strict one refused valid SQL.
  assert.equal(tree('f (1)'), 'f(1)')
  assert.equal(tree('f (1)', 'IGNORE_SPACE'), 'f(1)')
})

test('M3.2: a parenthesised expression is not a row constructor', () => {
  assert.equal(tree('(1)'), '1')
  assert.equal(tree('(1, 2)'), '<1, 2>')
  assert.equal(tree('(1, 2) = (3, 4)'), '(<1, 2> = <3, 4>)')
})

test('M3.2: CASE in both forms', () => {
  assert.equal(tree('CASE WHEN a THEN 1 ELSE 2 END'), 'CASE(a=>1 else 2)')
  assert.equal(tree("CASE x WHEN 1 THEN 'a' WHEN 2 THEN 'b' END"), 'CASE(x 1=>a 2=>b)')
  // A `CASE` with no `WHEN` is not a CASE.
  assert.throws(() => parseExpression('CASE x END'), ParseError)
})

test('M3.2: literal types follow how the literal was written', () => {
  // MySQL's three numeric literal types are genuinely different, and collapsing
  // them to one JavaScript `number` would lose what DECIMAL exists for.
  const lit = (sql: string) => parseExpression(sql) as { type: string; value: unknown }
  assert.deepEqual([lit('1').type, lit('1').value], ['int', 1n])
  assert.deepEqual([lit('1.5').type, lit('1.5').value], ['decimal', '1.5'], 'exact, so a string (D-15)')
  assert.deepEqual([lit('1e3').type, lit('1e3').value], ['double', 1000])
  assert.equal(lit('NULL').type, 'null')
  assert.equal(lit('TRUE').value, true)
  assert.equal(tree("x'4a'"), '0x4a', 'a hex literal is bytes, not a number')
  assert.deepEqual([lit('0b101').type, lit('0b101').value], ['bit', 5n])
})

test('M3.2: introducers, COLLATE and adjacent string concatenation', () => {
  assert.equal(tree("_latin1'x'"), '_latin1x')
  assert.equal(tree("'a' 'b'"), 'ab', 'adjacent string literals concatenate, as in standard SQL')
  assert.equal(tree("'a' COLLATE utf8mb4_bin"), 'a COLLATE utf8mb4_bin')
  assert.equal(tree('a COLLATE utf8mb4_bin'), '(COLLATE a)')
})

test('M3.2: INTERVAL is an operand, not an operator', () => {
  assert.equal(tree('a + INTERVAL 1 DAY'), '(a + INTERVAL(1 DAY))')
  assert.equal(tree('a - INTERVAL 3 DAY_HOUR'), '(a - INTERVAL(3 DAY_HOUR))')
  assert.throws(() => parseExpression('INTERVAL 1 FORTNIGHT'), ParseError, 'an invented unit is refused')
})

test('M3.2: placeholders keep the order COM_STMT_EXECUTE binds them in', () => {
  assert.equal(tree('? + ? * ?'), '(?0 + (?1 * ?2))')
})

// --- M3.9 -------------------------------------------------------------------

test('M3.9: a syntax error carries MySQL’s errno, SQLSTATE and message shape', () => {
  const err = (() => {
    try {
      parseExpression('1 +')
      return null
    } catch (e) {
      return e as ParseError
    }
  })()
  assert.ok(err !== null)
  assert.equal(err.code, 'ER_PARSE_ERROR')
  assert.equal(err.errno, 1064)
  assert.equal(err.sqlState, '42000')
  assert.match(err.message, /^You have an error in your SQL syntax; check the manual/)
  assert.match(err.message, /at line 1$/)
})

test('M3.9: the reported line is the line the error is on', () => {
  const err = (() => {
    try {
      parseExpression('1 +\n2 *\n')
      return null
    } catch (e) {
      return e as ParseError
    }
  })()
  assert.ok(err !== null)
  assert.match(err.message, /at line 3$/)
})

test('M3.9 / ground rule 5: leftover input is refused rather than ignored', () => {
  // `parseExpression` consumes one expression. If it returned the first one and
  // dropped the rest, `1 2` would silently become `1` — the shape of bug that
  // makes a parser dangerous rather than merely wrong.
  assert.throws(() => parseExpression('1 2'), ParseError)
  assert.throws(() => parseExpression('(1'), ParseError)
  assert.throws(() => parseExpression(''), ParseError)
  assert.throws(() => parseExpression('a IN 1'), ParseError, 'IN needs a parenthesised list')
})

test('M3.9: a word operator is not mistaken for a column name', () => {
  // `a AND b` must not parse as the column `a` followed by junk, and `a b` must
  // not parse as an operator named `b`. Both directions matter.
  assert.equal(tree('a AND b'), '(a AND b)')
  assert.throws(() => parseExpression('a b'), ParseError)
})

test('M3.10 / ground rule 5: deep nesting is refused, not a stack overflow', () => {
  // Found by reading rather than by fuzzing, because the fuzzer's nesting
  // bound sat just under the depth that crashes — the generator's bounds are
  // part of what it tests, and that one has been raised.
  //
  // `'('.repeat(1000) + '1' + ')'.repeat(1000)` is eleven bytes of typing and
  // used to throw a `RangeError` from anyone who could send a query. A
  // `RangeError` is not a typed error, so this was a ground-rule-5 violation
  // and a trivial denial of service.
  for (const depth of [200, 1000, 100_000]) {
    const sql = '('.repeat(depth) + '1' + ')'.repeat(depth)
    assert.throws(
      () => parseExpression(sql),
      (e: unknown) => e instanceof ParseError && (e as ParseError).errno === 1436,
      `depth ${depth} must be a typed refusal`,
    )
  }
  // A chain of unary operators nests too, through a different path.
  assert.throws(() => parseExpression('-'.repeat(100_000) + '1'), ParseError)
  // And the limit is generous enough that real SQL never reaches it.
  assert.equal(tree('('.repeat(50) + '1 + 2' + ')'.repeat(50)), '(1 + 2)')
})
