// M3.11 — the `.test` file extractor, checked without a network.
//
// The census itself fetches MySQL's corpus and so can only run in CI. The part
// with bugs in it is not the fetching but the rules for telling a mysqltest
// directive from a SQL statement, and those need nothing but a string — hence
// `tools/lib/mysqltest-extract.mjs` and this file, the same split as
// `binlog-hexdump`.
//
// **Every snippet here is written for this test.** Ground rule 7 says
// `mysql-test` is fetched in CI and never vendored; a fixture quoting its SQL
// would put GPLv2 text in an MIT repository just as surely as a checkout would.
// Where a real file motivated a case, the case is described and re-written.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extract, keywordOf } from '../../tools/lib/mysqltest-extract.mjs'

/** The statements a snippet yields, as text, for readable assertions. */
const texts = (source: string): string[] => extract(source).statements.map((s) => s.text)

test('M3.11: directives, comments and bare commands are not SQL', () => {
  const out = extract(
    [
      '--disable_warnings',
      '# a comment',
      'connection default;',
      'CREATE TABLE t (a INT);',
      '--enable_warnings',
      'DROP TABLE t;',
    ].join('\n'),
  )
  assert.equal(out.outcome, 'ok')
  assert.deepEqual(
    out.statements.map((s) => s.keyword),
    ['CREATE', 'DROP'],
  )
  assert.equal(out.directives, 4)
})

test('M3.11: a statement boundary is not a semicolon', () => {
  // The reason the extractor runs the lexer rather than `text.split(";")`: a
  // semicolon inside a string literal is not a terminator, and a naive split
  // turns one INSERT into two fragments that both fail to lex. The census would
  // then report a lexer bug that is really its own.
  assert.deepEqual(texts("INSERT INTO t VALUES ('a;b');\nSELECT 1;"), ["INSERT INTO t VALUES ('a;b')", 'SELECT 1'])
})

test('M3.11: a multi-line directive does not leak its second line into the SQL', () => {
  // Two of the first census run's eight "file will not lex" reports were this,
  // and neither was a lexer bug. A `let` whose value is a backtick query, and
  // an `assert` whose expression is bracketed, may both run past their line —
  // and the continuation carries no `--` of its own, so it looks like SQL.
  const withLet = extract(
    ['let $rest = (t1 join t2 on t2.ref = ', 't1.c1) on t3.ref = t1.c1;', 'SELECT 1;'].join('\n'),
  )
  assert.equal(withLet.outcome, 'ok')
  assert.deepEqual(
    withLet.statements.map((s) => s.text),
    ['SELECT 1'],
  )

  const withAssert = extract(
    ['--assert([SELECT COUNT(*) FROM t1', "  WHERE s = 'x', COUNT, 1] = 1)", 'SELECT 2;'].join('\n'),
  )
  assert.deepEqual(
    withAssert.statements.map((s) => s.text),
    ['SELECT 2'],
  )

  // `if` and `while` take a backtick query as their condition and wrap it the
  // same way.
  const withIf = extract(['if (!` SELECT (@a * @b >', '        @a) AND (@c - 1 >= 3)`)', 'SELECT 3;'].join('\n'))
  assert.deepEqual(
    withIf.statements.map((s) => s.text),
    ['SELECT 3'],
  )
})

test('M3.11: prose in a directive never swallows the SQL after it', () => {
  // The regression this file exists for. The first continuation rule counted
  // brackets and backticks on *every* directive, and `--echo` carries free
  // prose — a bug title with one unbalanced backtick in it removed 25 lines of
  // real SQL across three files. The census kept reporting 100% lexed, over
  // less and less corpus, which is worse than the miscount it fixed: a
  // heuristic that silently drops input flatters every number downstream.
  const out = extract(
    ['--echo # Bug#00000000: val_json: assertion `!m_wrapper->empty()', 'SELECT 1;', 'SELECT 2;'].join('\n'),
  )
  assert.equal(out.outcome, 'ok')
  assert.deepEqual(
    out.statements.map((s) => s.text),
    ['SELECT 1', 'SELECT 2'],
  )

  // `--replace_regex` is the other one: its pattern is a regex, and an
  // unmatched `(` in a character class is ordinary.
  assert.deepEqual(texts('--replace_regex /[(]x/y/\nSELECT 3;'), ['SELECT 3'])
})

test('M3.11: a continuation is bounded', () => {
  // `advance` is a heuristic, so it must not be able to eat a file. A run of
  // more than twenty lines is assumed spurious, and a fresh `--` directive ends
  // it immediately whatever the bracket count says.
  const runaway = ['let $x = (unclosed', ...Array.from({ length: 40 }, (_, i) => `SELECT ${i};`)].join('\n')
  const out = extract(runaway)
  assert.equal(out.outcome, 'ok')
  assert.ok(out.statements.length >= 19, `${out.statements.length} statement(s) survived a runaway continuation`)

  assert.deepEqual(texts(['let $x = (unclosed', '--echo done', 'SELECT 9;'].join('\n')), ['SELECT 9'])
})

test('M3.11: a heredoc body is not SQL', () => {
  // `perl;` and `write_file` open a block that runs to `EOF`. Its contents are
  // Perl or file data; about 1.5% of what the first version emitted came from
  // one of these, and "rare non-SQL that happens to lex" is exactly how a
  // census flatters itself.
  const out = extract(['perl;', 'print "SELECT nonsense;";', 'EOF', 'SELECT 1;'].join('\n'))
  assert.deepEqual(
    out.statements.map((s) => s.text),
    ['SELECT 1'],
  )
})

test('M3.11: not measuring a file is a named outcome, not a failure', () => {
  // Five of the first run's eight failures were `--source` wrappers with no SQL
  // in them at all, and one was Shift-JIS on purpose. Reporting those as lexer
  // defects trains the reader to ignore the number.
  const wrapper = extract(['--source include/not_hypergraph.inc', '--source include/shared_body.inc'].join('\n'))
  assert.equal(wrapper.outcome, 'no-sql')
  assert.equal(wrapper.statements.length, 0)

  // `Response.text()` decodes as UTF-8 with replacement, so a Shift-JIS source
  // arrives carrying U+FFFD. Lexing that measures the decoder, not the lexer.
  const mangled = extract('SELECT ��;')
  assert.equal(mangled.outcome, 'not-utf8')

  const broken = extract("SELECT 'unterminated;")
  assert.equal(broken.outcome, 'lex-failed')
  assert.match(broken.detail, /^line \d+: /)
})

test('M3.11: a statement is classified by its first token, not by a regex', () => {
  // Classifying with a regex over the raw slice looked equivalent and was not:
  // a trailing `# comment` on the previous statement's line lands at the front
  // of the next statement's text, which filed 60 INSERTs under `(other)`. The
  // lexer has already skipped the comment, so the first *token* is right.
  const out = extract(['SELECT 1; # trailing note', 'INSERT INTO t VALUES (1);'].join('\n'))
  assert.deepEqual(
    out.statements.map((s) => s.keyword),
    ['SELECT', 'INSERT'],
  )

  // A leading `(` is skipped: `(SELECT ...) ORDER BY a` is a SELECT.
  assert.equal(extract('(SELECT 1) ORDER BY a;').statements[0]?.keyword, 'SELECT')

  // A quoted identifier is not a keyword, and neither is a bare `(`.
  assert.equal(keywordOf([{ kind: 'identifier', text: 'sELEct' }]), 'SELECT')
  assert.equal(keywordOf([{ kind: 'identifier', text: 't1', quoted: true }]), '(other)')
  assert.equal(keywordOf([]), '(other)')
})

test('M3.11: a $variable is counted rather than parsed', () => {
  // `$var` is a mysqltest substitution. Feeding it to the SQL lexer would
  // record a failure for a statement that is not SQL yet — but dropping it
  // silently would let the extractor hide however much it liked, so it is
  // counted where a reader can see it.
  const out = extract(['SELECT 1;', 'CREATE TABLE t (a INT) ENGINE=$engine;'].join('\n'))
  assert.equal(out.skipped, 1)
  assert.equal(out.statements.length, 1)
})
