// M3.1 / M3.7 — the lexer.
//
// The headline test is the last one in the first block: a gbk lead byte must
// not be able to swallow a backslash and escape a quote. Everything else here
// exists so that the lexer is trustworthy enough for that claim to mean
// something.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeCharset } from '@myjs/charsets'
import {
  TOKEN,
  ParseError,
  badMode,
  lex,
  lexBytes,
  parseError,
  parseSqlMode,
  unknownCharset,
  type Token,
} from '@myjs/parser'
import { errnoOf, sqlStateOf } from '@myjs/protocol'

const kinds = (sql: string, mode?: string) =>
  lex(sql, mode === undefined ? {} : { sqlMode: parseSqlMode(mode) })
    .filter((t) => t.kind !== TOKEN.EOF)
    .map((t) => t.kind)

const texts = (sql: string, mode?: string) =>
  lex(sql, mode === undefined ? {} : { sqlMode: parseSqlMode(mode) })
    .filter((t) => t.kind !== TOKEN.EOF)
    .map((t) => t.text)

const only = (sql: string, mode?: string): Token => {
  const tokens = lex(sql, mode === undefined ? {} : { sqlMode: parseSqlMode(mode) })
  assert.equal(tokens.length, 2, `expected one token plus EOF, got ${tokens.map((t) => t.text).join('|')}`)
  return tokens[0] as Token
}

// --- M3.1: the security property -------------------------------------------

test('M3.1: a gbk lead byte cannot swallow a backslash to escape a quote', () => {
  // The attack, verbatim. A client escaping `'` to `\'` over raw bytes turns
  //   SELECT '<0xBF>' OR 1=1 -- '
  // into bytes where `BF 5C` is a single gbk character. A byte-scanning lexer
  // reads `5C` as a backslash escaping the `27` after it, so the literal never
  // closes there — it closes at the *next* quote, and everything between is
  // suddenly SQL rather than data.
  //
  // Character-scanning after a charset-correct decode makes `BF 5C` one
  // character with no backslash in it, so the `27` closes the literal exactly
  // where the client meant it to.
  const attack = Uint8Array.from([
    0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, // SELECT<space>
    0x27, 0xbf, 0x5c, 0x27, //                    '<gbk char>'
    0x20, 0x4f, 0x52, 0x20, 0x31, 0x3d, 0x31, //  <space>OR 1=1
  ])
  const tokens = lexBytes(attack, { collationId: 28 }).filter((t) => t.kind !== TOKEN.EOF)

  assert.deepEqual(
    tokens.map((t) => t.kind),
    [TOKEN.IDENTIFIER, TOKEN.STRING, TOKEN.IDENTIFIER, TOKEN.NUMBER, TOKEN.OPERATOR, TOKEN.NUMBER],
    'the literal closes at its own quote, so OR 1=1 is separate tokens rather than more literal',
  )
  const literal = tokens[1] as Token
  assert.equal(literal.kind, TOKEN.STRING)
  assert.equal(literal.text.length, 1, 'BF 5C is one character')
  assert.ok(!literal.text.includes('\\'), 'no backslash survives the decode')
})

test('M3.1: the same bytes under utf8mb4 are refused, not silently re-read', () => {
  // The same bytes are not valid UTF-8. A lexer that shrugged would produce
  // U+FFFD and lex *something*, which is the failure mode this whole design is
  // arranged against: the statement lexed must be the statement sent.
  const attack = Uint8Array.from([0x27, 0xbf, 0x5c, 0x27])
  // `BF` is not valid UTF-8, so it decodes to U+FFFD and the `5C` after it is
  // a real backslash — which escapes the closing quote and leaves the literal
  // unterminated. That is an error, and an error is the right answer: the
  // reading depends on the charset, and under utf8mb4 these bytes are not a
  // well-formed statement. What must never happen is quietly getting the gbk
  // reading, or quietly getting some third one.
  assert.throws(() => lexBytes(attack, { collationId: 255 }), ParseError)
  // And the gbk reading of the same bytes *is* well-formed, which is the point.
  assert.equal((lexBytes(attack, { collationId: 28 })[0] as Token).text, '縗')
})

test('M3.1: a charset this runtime cannot decode is refused', () => {
  // `binary` (collation 63) has no byte-to-character mapping at all, so there
  // is no faithful reading and the lexer must say so rather than pick one.
  assert.throws(() => lexBytes(Uint8Array.of(0x61), { collationId: 63 }), ParseError)
  assert.throws(() => lexBytes(Uint8Array.of(0x61), { collationId: 63 }), /Unknown character set/)
})

test('M3.1: a latin1 statement keeps its high bytes', () => {
  const tokens = lexBytes(encodeCharset("SELECT '€'", 'latin1'), { collationId: 8 })
  assert.equal((tokens[1] as Token).text, '€')
})

// --- M3.7: sql_mode changes what the text means ----------------------------

test('M3.7: the same text parses differently under ANSI_QUOTES', () => {
  // The roadmap's acceptance clause for M3.7, stated as literally as it is
  // written. This is why `sql_mode` is a parameter rather than something the
  // lexer reads from a global later.
  assert.equal(only('"x"').kind, TOKEN.STRING)
  assert.equal(only('"x"', 'ANSI_QUOTES').kind, TOKEN.IDENTIFIER)
  assert.equal(only('"x"', 'ANSI_QUOTES').quoted, true)
})

test('M3.7: ANSI is a combination mode and turns ANSI_QUOTES on', () => {
  // `SET sql_mode='ANSI'` must behave as `ANSI_QUOTES` (and four others).
  // A naive `split(',').includes('ANSI_QUOTES')` misses this entirely.
  assert.equal(only('"x"', 'ANSI').kind, TOKEN.IDENTIFIER)
  const mode = parseSqlMode('ansi')
  assert.equal(mode.ansiQuotes, true)
  assert.equal(mode.pipesAsConcat, true)
  assert.equal(mode.realAsFloat, true)
  assert.ok(mode.names.has('ONLY_FULL_GROUP_BY'), 'the expansion is recorded, not just the flags read')
})

test('M3.7: NO_BACKSLASH_ESCAPES makes a backslash ordinary', () => {
  assert.equal(only("'a\\nb'").text, 'a\nb')
  assert.equal(only("'a\\nb'", 'NO_BACKSLASH_ESCAPES').text, 'a\\nb')
  // And with backslashes inert, `\'` no longer escapes — so this is a closed
  // string followed by more tokens rather than one long literal.
  assert.equal(kinds("'a\\' OR 1=1", 'NO_BACKSLASH_ESCAPES').length, 5)
})

test('M3.7: a sql_mode that is not a mode name is refused', () => {
  // It arrives from `SET sql_mode = <user string>`. Dropping an unparseable
  // mode silently would leave the session parsing differently from what its
  // own `@@sql_mode` reports.
  assert.throws(() => parseSqlMode('ANSI_QUOTES, nonsense!'), ParseError)
  assert.equal(parseSqlMode('').names.size, 0, "sql_mode='' is legal and means no modes")
  assert.equal(parseSqlMode('  ansi_quotes , ').ansiQuotes, true, 'case and space tolerant, as MySQL is')
})

// --- literals ---------------------------------------------------------------

test('M3.1: string escapes follow MySQL, including the two that keep their backslash', () => {
  assert.equal(only("'it''s'").text, "it's", 'a doubled quote is always an escape')
  assert.equal(only("'it\\'s'").text, "it's")
  assert.equal(only("'a\\tb'").text, 'a\tb')
  assert.equal(only("'\\q'").text, 'q', 'an unknown escape yields the bare character')
  // `\%` and `\_` are LIKE metacharacter escapes and are resolved by LIKE, not
  // here — so the backslash must survive lexing.
  assert.equal(only("'\\%'").text, '\\%')
  assert.equal(only("'\\_'").text, '\\_')
})

test('M3.1: an unterminated literal is an error, not an implicit close at EOF', () => {
  assert.throws(() => lex("SELECT 'abc"), ParseError)
  assert.throws(() => lex('SELECT `abc'), ParseError)
  // The same for a comment: closing it implicitly would make
  // `SELECT 1 /* DROP TABLE t` run as `SELECT 1`.
  assert.throws(() => lex('SELECT 1 /* unterminated'), ParseError)
})

test('M3.1: numbers, hex and bit literals', () => {
  assert.deepEqual(kinds('1 2.5 .5 1e3 1.5E-2'), Array(5).fill(TOKEN.NUMBER))
  assert.equal(only("x'4A'").kind, TOKEN.HEX)
  assert.equal(only('0x4A').kind, TOKEN.HEX)
  assert.equal(only("b'1010'").kind, TOKEN.BIT)
  assert.equal(only('0b1010').kind, TOKEN.BIT)
  assert.equal(only("x'4A'").text, '4A')
  // `0xZZ` is not a hex literal; MySQL reads it as an identifier.
  assert.equal(only('0xZZ').kind, TOKEN.IDENTIFIER)
  assert.throws(() => lex("x'4G'"), ParseError, 'a bad digit in the quoted form is an error')
})

test('M3.1: a backslash never escapes inside a quoted identifier', () => {
  // The asymmetry with string literals is real and load-bearing: if a
  // backslash could escape here, it could hide a closing backtick.
  const t = only('`a\\`')
  assert.equal(t.kind, TOKEN.IDENTIFIER)
  assert.equal(t.text, 'a\\')
  assert.equal(only('`a``b`').text, 'a`b', 'a doubled backtick is the escape')
})

test('M3.1: an identifier may be non-ASCII', () => {
  assert.equal(only('naïve').kind, TOKEN.IDENTIFIER)
  assert.equal(only('日本語').text, '日本語')
})

// --- comments and operators -------------------------------------------------

test('M3.1: `--` is only a comment when whitespace follows', () => {
  // MySQL differs from most dialects here, and `SELECT 1--2` is arithmetic.
  assert.deepEqual(texts('SELECT 1 -- a comment'), ['SELECT', '1'])
  assert.deepEqual(texts('SELECT 1--2'), ['SELECT', '1', '-', '-', '2'])
  assert.deepEqual(texts('SELECT 1 # hash'), ['SELECT', '1'])
})

test('M3.1: a version-gated comment is executed, not skipped', () => {
  // `mysqldump` output is full of these. Treating them as comments would drop
  // the statements a dump depends on.
  assert.deepEqual(texts('SELECT /*!40101 1 */'), ['SELECT', '1'])
  assert.deepEqual(texts('SELECT /*!99999 1 */ 2'), ['SELECT', '2'], 'too new for us: skipped')
  assert.deepEqual(texts('SELECT /* 1 */ 2'), ['SELECT', '2'], 'an ordinary comment')
  assert.deepEqual(texts('SELECT /*+ HINT */ 2'), ['SELECT', '2'], 'an optimizer hint')
})

test('M3.1: multi-character operators are matched longest-first', () => {
  // `<=>` before `<=` before `<`. Getting the order wrong turns null-safe
  // equality into a comparison plus a stray `>`, which then parses as
  // something else rather than failing.
  assert.deepEqual(texts('a <=> b'), ['a', '<=>', 'b'])
  assert.deepEqual(texts('a <= b'), ['a', '<=', 'b'])
  assert.deepEqual(texts('a < b'), ['a', '<', 'b'])
  assert.deepEqual(texts('a ->> b'), ['a', '->>', 'b'])
})

test('M3.1: placeholders are numbered in order', () => {
  const tokens = lex('SELECT ? + ?').filter((t) => t.kind === TOKEN.PLACEHOLDER)
  assert.deepEqual(
    tokens.map((t) => t.index),
    [0, 1],
  )
})

test('M3.1: variables', () => {
  assert.equal(only('@x').kind, TOKEN.VARIABLE)
  assert.equal(only('@@session.sql_mode').text, '@@session.sql_mode')
})

// --- positions --------------------------------------------------------------

test('M3.9 groundwork: tokens carry a line number and a span', () => {
  const tokens = lex('SELECT\n  1,\n  2')
  const two = tokens.find((t) => t.text === '2') as Token
  assert.equal(two.line, 3)
  const one = tokens.find((t) => t.text === '1') as Token
  assert.equal(one.line, 2)
  assert.equal(one.end - one.start, 1)
})

test('M3.9: a syntax error reports MySQL’s shape', () => {
  // The `near` text is a *suffix* — from the offending position to the end,
  // capped — because that is the shape clients and MySQL's own suite match on.
  const err = (() => {
    try {
      lex('SELECT  bad')
      return null
    } catch (e) {
      return e as ParseError
    }
  })()
  assert.ok(err !== null, 'an unlexable character must be refused')
  assert.equal(err.errno, 1064)
  assert.equal(err.sqlState, '42000')
  assert.match(err.message, /You have an error in your SQL syntax/)
  assert.match(err.message, /at line 1$/)
})

test('M3.10 groundwork: the token stream always ends with EOF', () => {
  // So a parser can look ahead one token without a bounds check — which is
  // ground rule 5's invariant expressed as a data-structure property.
  for (const sql of ['', '   ', 'SELECT 1', '-- only a comment']) {
    const tokens = lex(sql)
    assert.equal((tokens[tokens.length - 1] as Token).kind, TOKEN.EOF, JSON.stringify(sql))
  }
})

test('M3.9: the parser’s hardcoded errnos agree with the generated table', () => {
  // `@myjs/parser` writes 1064/1115/1231 out rather than looking them up,
  // because it must not depend on `@myjs/protocol` (doc 03) and that is where
  // the generated table lives — the same trade `@myjs/types` makes. The trade
  // is only safe if something checks it, so this is that something: a test may
  // import both packages even though neither may import the other.
  for (const [make, symbol, errno, sqlState] of [
    [() => parseError('x', 1), 'ER_PARSE_ERROR', 1064, '42000'],
    [() => unknownCharset('x'), 'ER_UNKNOWN_CHARACTER_SET', 1115, '42000'],
    [() => badMode('x'), 'ER_WRONG_VALUE_FOR_VAR', 1231, '42000'],
  ] as const) {
    const err = make()
    assert.equal(err.code, symbol)
    assert.equal(err.errno, errnoOf(symbol), `${symbol} errno drifted from the generated table`)
    assert.equal(err.errno, errno)
    assert.equal(err.sqlState, sqlStateOf(symbol), `${symbol} SQLSTATE drifted from the generated table`)
    assert.equal(err.sqlState, sqlState)
  }
})
