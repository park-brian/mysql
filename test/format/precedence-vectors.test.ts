// M3.2 — replay the operator-precedence corpus captured from a real MySQL.
//
// Precedence is the one part of a parser that cannot be checked against itself.
// A parser with `*` and `+` the wrong way round still parses, still builds a
// tree, still evaluates — and quietly answers `1+2*3 = 9`. Hand-written cases
// only catch the mistakes you already thought of, which is why the roadmap's
// clause for this item names a *generated* corpus and a *real server*.
//
// The evaluator below is what makes this a differential test rather than a
// tautology: **it contains no precedence knowledge at all.** It walks a tree
// bottom-up and applies one operator per node. All the grouping was decided by
// the parser, so a misgrouped tree cannot be rescued here — it comes out as a
// wrong number, checked against what MySQL actually said.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { NODE, parseExpression, parseSqlMode, type Expression } from '@myjs/parser'

const FIXTURE = new URL('./fixtures/precedence.json', import.meta.url).pathname

interface Vector {
  readonly expr: string
  readonly value?: string
  readonly error?: string
}

interface Fixture {
  readonly capturedAgainst: string
  readonly seed: number
  readonly vectors: readonly Vector[]
}

/**
 * A MySQL integer: the value, and whether its type is unsigned.
 *
 * The flag is not decoration. MySQL's bitwise operators return **unsigned**
 * BIGINT, so `~1` is 18446744073709551614 rather than -2, and that unsignedness
 * then infects the arithmetic around it. An evaluator that used plain `bigint`
 * would disagree with the server on every vector containing a `~`, and the
 * disagreement would look like a precedence bug.
 */
interface Value {
  readonly n: bigint
  readonly unsigned: boolean
}

const U64 = (1n << 64n) - 1n
const signed = (n: bigint): Value => ({ n, unsigned: false })
const unsigned = (n: bigint): Value => ({ n: n & U64, unsigned: true })
const bool = (b: boolean): Value => signed(b ? 1n : 0n)

/** As an unsigned 64-bit pattern — two's complement for a negative. */
const bits = (v: Value): bigint => v.n & U64

/**
 * Evaluate a parsed expression the way MySQL evaluates the same text.
 *
 * `null` models SQL NULL, which the corpus reaches through division by zero —
 * `1 DIV 0` is NULL in MySQL, not an error, outside strict division mode.
 */
function evaluate(e: Expression): Value | null {
  switch (e.kind) {
    case NODE.LITERAL:
      if (e.type === 'int') return signed(e.value as bigint)
      if (e.type === 'null') return null
      throw new Error(`the corpus should be integers only, got ${e.type}`)

    case NODE.UNARY: {
      const v = evaluate(e.operand)
      switch (e.op) {
        case '-':
          return v === null ? null : signed(-v.n)
        case '+':
          return v
        // Bitwise NOT is where unsignedness enters.
        case '~':
          return v === null ? null : unsigned(~bits(v))
        case '!':
        case 'NOT':
          return v === null ? null : bool(v.n === 0n)
        default:
          throw new Error(`unary ${e.op} is outside the corpus's alphabet`)
      }
    }

    case NODE.BINARY: {
      const l = evaluate(e.left)
      const r = evaluate(e.right)

      // Three-valued logic first, because AND and OR are not null-propagating:
      // `NULL AND 0` is 0 and `NULL OR 1` is 1, whatever the other side is.
      if (e.op === 'AND') {
        if (l?.n === 0n || r?.n === 0n) return bool(false)
        return l === null || r === null ? null : bool(true)
      }
      if (e.op === 'OR') {
        if ((l !== null && l.n !== 0n) || (r !== null && r.n !== 0n)) return bool(true)
        return l === null || r === null ? null : bool(false)
      }
      if (l === null || r === null) return null

      switch (e.op) {
        // Arithmetic is unsigned if either side is — MySQL's promotion rule.
        case '+':
          return l.unsigned || r.unsigned ? unsigned(l.n + r.n) : signed(l.n + r.n)
        case '-':
          return l.unsigned || r.unsigned ? unsigned(l.n - r.n) : signed(l.n - r.n)
        case '*':
          return l.unsigned || r.unsigned ? unsigned(l.n * r.n) : signed(l.n * r.n)
        // Division by zero is NULL, not an error, and not a crash.
        case 'DIV':
          return r.n === 0n ? null : l.unsigned || r.unsigned ? unsigned(l.n / r.n) : signed(l.n / r.n)
        case '%':
        case 'MOD':
          return r.n === 0n ? null : l.unsigned || r.unsigned ? unsigned(l.n % r.n) : signed(l.n % r.n)

        // Bitwise operators always return unsigned, whatever went in.
        case '|':
          return unsigned(bits(l) | bits(r))
        case '&':
          return unsigned(bits(l) & bits(r))
        case '^':
          return unsigned(bits(l) ^ bits(r))
        case '<<':
          return unsigned(bits(r) >= 64n ? 0n : bits(l) << bits(r))
        case '>>':
          return unsigned(bits(r) >= 64n ? 0n : bits(l) >> bits(r))

        case '=':
        case '<=>':
          return bool(l.n === r.n)
        case '<':
          return bool(l.n < r.n)
        case '>':
          return bool(l.n > r.n)
        case 'XOR':
          return bool((l.n !== 0n) !== (r.n !== 0n))
        default:
          throw new Error(`binary ${e.op} is outside the corpus's alphabet`)
      }
    }

    default:
      throw new Error(`${e.kind} is outside the corpus's alphabet`)
  }
}

const render = (v: Value | null): string => (v === null ? 'NULL' : v.n.toString())

test('M3.2: the precedence corpus is visible, empty or not', () => {
  // M2.22's lesson, a third time: a check that passes because it has nothing to
  // check is not a check. This cannot *fail* on an empty corpus, because the
  // vectors can only come from a real MySQL and `npm test` runs with neither a
  // server nor Docker — the `precedence-vectors` CI job is what fills it.
  if (!existsSync(FIXTURE)) {
    console.log(
      '  [precedence] no corpus committed yet — run `npm run capture:precedence` against a real\n' +
        '               MySQL 8.4, or download the artifact from CI, and commit it.',
    )
  }
  assert.ok(true)
})

test('M3.2: every captured expression groups the way the server grouped it', () => {
  if (!existsSync(FIXTURE)) return
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')

  let checked = 0
  const mismatches: string[] = []
  for (const v of fixture.vectors) {
    // An expression the server refused (an overflow, say) says nothing about
    // grouping — we do not implement MySQL's range checks, so agreeing or
    // disagreeing about it would be noise.
    if (v.value === undefined) continue
    let actual: string
    try {
      actual = render(evaluate(parseExpression(v.expr)))
    } catch (err) {
      mismatches.push(`${v.expr}\n    server ${v.value}, we threw ${(err as Error).message}`)
      continue
    }
    if (actual !== v.value) mismatches.push(`${v.expr}\n    server ${v.value}, we ${actual}`)
    checked++
  }

  assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} expression(s) disagree with ${fixture.capturedAgainst}`)
  assert.ok(checked > 100, `only ${checked} expressions checked — the corpus is too thin to mean anything`)
})

test('M3.2: the worked cases MySQL’s own manual turns on', () => {
  // Not from the corpus: these are the specific groupings the operator table
  // exists to get right, spelled out so a reader can see what is being claimed
  // without downloading a fixture. They are checked against the same evaluator,
  // so they also demonstrate what a corpus mismatch would look like.
  const cases: readonly (readonly [string, string])[] = [
    ['1 + 2 * 3', '7'],
    ['1 * 2 + 3', '5'],
    // `^` is bitwise XOR in MySQL, not exponentiation — and it binds tighter
    // than `*`, so this is `(2 ^ 3) * 4` and not `2 ^ (3 * 4)`.
    ['2 ^ 3 * 4', '4'],
    ['1 | 2 & 3', '3'],
    // `+` binds tighter than `<<`, which is the reverse of C.
    ['1 << 2 + 3', '32'],
    ['5 - 3 - 1', '1'],
    // `NOT` binds looser than `=`, so this is `NOT (1 = 0)` and not `(NOT 1) = 0`.
    ['NOT 1 = 0', '1'],
    ['1 DIV 0', 'NULL'],
    ['~ 0', '18446744073709551615'],
    ['- 1 + 2', '1'],
  ]
  for (const [expr, expected] of cases) {
    assert.equal(render(evaluate(parseExpression(expr))), expected, expr)
  }
})

test('M3.7 in the parser: two modes that regroup rather than re-spell', () => {
  // Both of these change the *shape* of the tree, which is why they belong to
  // the parser and cannot be a rendering detail.
  //
  // `NOT 2 = 1` is the discriminator worth knowing: most `NOT x = y` pairs
  // give the same answer under both readings by accident of boolean algebra,
  // and `2` is the smallest operand where they part company —
  // `NOT (2 = 1)` is 1, while `(NOT 2) = 1` is `0 = 1`, which is 0.
  const high = { sqlMode: parseSqlMode('HIGH_NOT_PRECEDENCE') }
  assert.equal(render(evaluate(parseExpression('NOT 2 = 1'))), '1')
  assert.equal(render(evaluate(parseExpression('NOT 2 = 1', high))), '0')

  // `PIPES_AS_CONCAT` moves `||` from the bottom of the table to just below
  // the unary operators, so it stops being an OR *and* starts binding tighter
  // than `+`. Only the grouping is checked here — concatenation itself is a
  // string operation and belongs to M5.
  const pipes = { sqlMode: parseSqlMode('PIPES_AS_CONCAT') }
  const asOr = parseExpression('1 || 2 + 3')
  const asConcat = parseExpression('1 || 2 + 3', pipes)
  assert.equal(asOr.kind, NODE.BINARY)
  assert.equal(asConcat.kind, NODE.BINARY)
  // Default: `1 || (2 + 3)`. With the mode: `(1 || 2) + 3`.
  assert.equal((asOr as { op: string }).op, '||')
  assert.equal((asConcat as { op: string }).op, '+')
})
