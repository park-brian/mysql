// M3.11 / M3.12 — the `.test` file extractor, checked without a network.
//
// The census itself fetches MySQL's corpus and so can only run in CI. The part
// with bugs in it is not the fetching but the rules for telling a mysqltest
// directive from a SQL statement, and for deciding what charset a run of bytes
// is written in. Those need nothing but a byte array — hence
// `tools/lib/mysqltest-extract.mjs` and this file, the same split as
// `binlog-hexdump`.
//
// **Every snippet here is written for this test.** Ground rule 7 says
// `mysql-test` is fetched in CI and never vendored; a fixture quoting its SQL
// would put GPLv2 text in an MIT repository just as surely as a checkout would.
// Where a real file motivated a case, the case is described and re-written.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extract, keywordOf, resolveCharset } from '../../tools/lib/mysqltest-extract.mjs'

/** A `.test` file's bytes. ASCII source, written as lines. */
const file = (...lines: string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'))

/**
 * A `.test` file with raw bytes spliced in.
 *
 * `\xNN` in a line becomes that byte and nothing else — no UTF-8 encoding, no
 * escape processing — which is the only way to write a latin1 or Shift-JIS
 * source file in a UTF-8 test file.
 */
const rawFile = (...lines: string[]): Uint8Array => {
  const text = lines.join('\n')
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const esc = /^\\x([0-9a-fA-F]{2})/.exec(text.slice(i, i + 4))
    if (esc !== null) {
      out.push(parseInt(esc[1]!, 16))
      i += 3
      continue
    }
    const code = text.charCodeAt(i)
    assert.ok(code < 0x80, `rawFile takes ASCII plus \\xNN escapes, got U+${code.toString(16)}`)
    out.push(code)
  }
  return new Uint8Array(out)
}

/** A resolution's charset and readability, or its refusal reason. */
const resolved = (name: string): Record<string, unknown> => {
  const r = resolveCharset(name)
  return 'reason' in r ? { reason: r.reason } : { charset: r.charset, readable: r.readable }
}

/** The statements a snippet yields, as text, for readable assertions. */
const texts = (source: Uint8Array): string[] => extract(source).statements.map((s) => s.text)

test('M3.11: directives, comments and bare commands are not SQL', () => {
  const out = extract(
    file(
      '--disable_warnings',
      '# a comment',
      'connection default;',
      'CREATE TABLE t (a INT);',
      '--enable_warnings',
      'DROP TABLE t;',
    ),
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
  assert.deepEqual(texts(file("INSERT INTO t VALUES ('a;b');", 'SELECT 1;')), [
    "INSERT INTO t VALUES ('a;b')",
    'SELECT 1',
  ])
})

test('M3.11: a multi-line directive does not leak its second line into the SQL', () => {
  // Two of the first census run's eight "file will not lex" reports were this,
  // and neither was a lexer bug. A `let` whose value is a backtick query, and
  // an `assert` whose expression is bracketed, may both run past their line —
  // and the continuation carries no `--` of its own, so it looks like SQL.
  const withLet = extract(file('let $rest = (t1 join t2 on t2.ref = ', 't1.c1) on t3.ref = t1.c1;', 'SELECT 1;'))
  assert.equal(withLet.outcome, 'ok')
  assert.deepEqual(
    withLet.statements.map((s) => s.text),
    ['SELECT 1'],
  )

  const withAssert = extract(
    file('--assert([SELECT COUNT(*) FROM t1', "  WHERE s = 'x', COUNT, 1] = 1)", 'SELECT 2;'),
  )
  assert.deepEqual(
    withAssert.statements.map((s) => s.text),
    ['SELECT 2'],
  )

  // `if` and `while` take a backtick query as their condition and wrap it the
  // same way.
  const withIf = extract(file('if (!` SELECT (@a * @b >', '        @a) AND (@c - 1 >= 3)`)', 'SELECT 3;'))
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
  const out = extract(file('--echo # Bug#00000000: val_json: assertion `!m_wrapper->empty()', 'SELECT 1;', 'SELECT 2;'))
  assert.equal(out.outcome, 'ok')
  assert.deepEqual(
    out.statements.map((s) => s.text),
    ['SELECT 1', 'SELECT 2'],
  )

  // `--replace_regex` is the other one: its pattern is a regex, and an
  // unmatched `(` in a character class is ordinary.
  assert.deepEqual(texts(file('--replace_regex /[(]x/y/', 'SELECT 3;')), ['SELECT 3'])
})

test('M3.11: a continuation is bounded', () => {
  // `advance` is a heuristic, so it must not be able to eat a file. A run of
  // more than twenty lines is assumed spurious, and a fresh `--` directive ends
  // it immediately whatever the bracket count says.
  const out = extract(file('let $x = (unclosed', ...Array.from({ length: 40 }, (_, i) => `SELECT ${i};`)))
  assert.equal(out.outcome, 'ok')
  assert.ok(out.statements.length >= 19, `${out.statements.length} statement(s) survived a runaway continuation`)

  assert.deepEqual(texts(file('let $x = (unclosed', '--echo done', 'SELECT 9;')), ['SELECT 9'])
})

test('M3.11: a heredoc body is not SQL', () => {
  // `perl;` and `write_file` open a block that runs to `EOF`. Its contents are
  // Perl or file data; about 1.5% of what the first version emitted came from
  // one of these, and "rare non-SQL that happens to lex" is exactly how a
  // census flatters itself.
  const out = extract(file('perl;', 'print "SELECT nonsense;";', 'EOF', 'SELECT 1;'))
  assert.deepEqual(
    out.statements.map((s) => s.text),
    ['SELECT 1'],
  )
})

test('M3.11: not measuring a file is a named outcome, not a failure', () => {
  // Five of the first run's eight failures were `--source` wrappers with no SQL
  // in them at all. Reporting those as lexer defects trains the reader to
  // ignore the number.
  const wrapper = extract(file('--source include/not_hypergraph.inc', '--source include/shared_body.inc'))
  assert.equal(wrapper.outcome, 'no-sql')
  assert.equal(wrapper.statements.length, 0)

  const broken = extract(file("SELECT 'unterminated;"))
  assert.equal(broken.outcome, 'lex-failed')
  assert.match(broken.detail, /line \d+: /)
})

test('M3.11: a statement is classified by its first token, not by a regex', () => {
  // Classifying with a regex over the raw slice looked equivalent and was not:
  // a trailing `# comment` on the previous statement's line lands at the front
  // of the next statement's text, which filed 60 INSERTs under `(other)`. The
  // lexer has already skipped the comment, so the first *token* is right.
  const out = extract(file('SELECT 1; # trailing note', 'INSERT INTO t VALUES (1);'))
  assert.deepEqual(
    out.statements.map((s) => s.keyword),
    ['SELECT', 'INSERT'],
  )

  // A leading `(` is skipped: `(SELECT ...) ORDER BY a` is a SELECT.
  assert.equal(extract(file('(SELECT 1) ORDER BY a;')).statements[0]?.keyword, 'SELECT')

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
  const out = extract(file('SELECT 1;', 'CREATE TABLE t (a INT) ENGINE=$engine;'))
  assert.equal(out.skipped, 1)
  assert.equal(out.statements.length, 1)
})

// --- M3.12: the file's own charset ------------------------------------------

test('M3.12: a lead byte cannot swallow the backslash after it', () => {
  // **The case M3.1 exists for, in the shape MySQL's own suite writes it.**
  //
  // `81 5C` is one Shift-JIS character whose trail byte is the ASCII backslash.
  // Read as bytes — or as any charset that is not the one the file is written
  // in — the `5C` is a live escape, it eats the closing quote, and the literal
  // runs on to swallow the rest of the statement. Read in sjis it is one
  // character with no backslash in it and the literal closes where it should.
  //
  // Both halves are asserted, because "it lexed" alone would also be true of a
  // lexer that lost the character entirely.
  const sjis = rawFile('SET NAMES sjis;', "SELECT QUOTE('\\x81\\x5C');", 'SELECT 2;')
  const out = extract(sjis)
  assert.equal(out.outcome, 'ok')
  assert.deepEqual(
    out.statements.map((s) => s.keyword),
    ['SET', 'SELECT', 'SELECT'],
  )
  // One character inside the literal, and it is not a backslash: Shift-JIS
  // `81 5C` is U+2015, HORIZONTAL BAR. (U+FF3C, the fullwidth reverse solidus
  // one might expect from the byte, is `81 5F` — which is the point. The trail
  // byte's ASCII meaning has nothing to do with the character it forms.)
  const literal = out.statements[1]!.text
  assert.equal(literal, "SELECT QUOTE('―')")
  assert.ok(!literal.includes('\\'), 'the trail byte must not survive as a backslash')
  assert.equal(out.statements[1]!.charset, 'sjis')

  // And the same bytes read in the wrong charset do not lex, which is what
  // makes the case above a check rather than a coincidence.
  const misread = extract(rawFile("SELECT QUOTE('\\x81\\x5C');", 'SELECT 2;'))
  assert.equal(misread.outcome, 'lex-failed')
})

test('M3.12: `SET NAMES` changes the charset for the bytes after it, not before', () => {
  // `SET NAMES latin1` is SQL. It executes in whatever charset was in force
  // when it was sent, and only the bytes after it are latin1 — so the switch
  // has to happen after the statement is banked, not before.
  const out = extract(rawFile('SELECT 1;', 'SET NAMES latin1;', "SELECT '\\xE4';"))
  assert.equal(out.outcome, 'ok')
  assert.deepEqual(
    out.statements.map((s) => s.charset),
    ['utf8mb4', 'utf8mb4', 'latin1'],
  )
  // 0xE4 is ä in latin1 and an illegal lead byte in UTF-8.
  assert.equal(out.statements[2]!.text, "SELECT 'ä'")

  // mysqltest's own directive does the same thing one line earlier, because it
  // is not a statement and takes effect immediately.
  const directive = extract(rawFile('--character_set latin1', "SELECT '\\xE4';"))
  assert.equal(directive.statements[0]!.text, "SELECT 'ä'")
  assert.equal(directive.statements[0]!.charset, 'latin1')
})

test('M3.12: a switch a real server would refuse does not happen here either', () => {
  // `ucs2` may not be a connection charset — doc 12: a multi-byte connection
  // charset breaks the NUL-terminated handshake fields — so `SET NAMES ucs2`
  // is an error and the session charset is unchanged. MySQL's `ctype_ucs.test`
  // runs exactly that, on purpose, and following it would misread every line
  // after it.
  const out = extract(rawFile('SET NAMES latin1;', 'SET NAMES ucs2;', "SELECT '\\xE4';"))
  assert.equal(out.refused.prohibited, 1)
  assert.equal(out.statements[2]!.charset, 'latin1')
  assert.equal(out.statements[2]!.text, "SELECT 'ä'")

  // A value that is not a charset name at all — the same file does
  // `SET character_set_client = CONCAT('ucs', …)` — is likewise not followed.
  const computed = extract(file("SET character_set_client = CONCAT('ucs', '2');", 'SELECT 1;'))
  assert.equal(computed.refused['not-a-charset'], 1)
})

test('M3.12: `DEFAULT` and `utf8` resolve rather than being unknown names', () => {
  // Both would be silent mis-reads if they refused. `SET NAMES DEFAULT` is a
  // real reset to the server default, which D-10 pins at utf8mb4 for 8.4, and
  // MySQL 8's `utf8` is an alias for `utf8mb3` — so counting them as unknown
  // would leave the previous charset in force over bytes that changed.
  assert.deepEqual(resolved('DEFAULT'), { charset: 'utf8mb4', readable: true })
  assert.deepEqual(resolved('utf8'), { charset: 'utf8mb3', readable: true })
  assert.deepEqual(resolved('UTF8MB4'), { charset: 'utf8mb4', readable: true })

  const out = extract(rawFile('SET NAMES latin1;', 'SET NAMES DEFAULT;', 'SELECT 1;'))
  assert.deepEqual(out.refused, {})
  assert.equal(out.statements[2]!.charset, 'utf8mb4')
})

test('M3.12: a charset we will not decode costs coverage, and says how much', () => {
  // `binary` is a legal connection charset and this build will not decode it,
  // so those lines are not read. Pretending the switch did not happen would be
  // worse — it would read those bytes in the previous charset, which is the one
  // outcome worse than reading none of them. So the region is entered, skipped,
  // and *counted*: a census that reports 100% lexed must not be reporting it
  // over an unknown fraction of the corpus.
  const out = extract(file('SELECT 1;', 'SET NAMES binary;', 'SELECT 2;', 'SELECT 3;'))
  assert.equal(out.outcome, 'ok')
  assert.equal(out.unreadLines, 2)
  assert.deepEqual(out.unreadCharsets, ['binary'])
  assert.deepEqual(
    out.statements.map((s) => s.text),
    ['SELECT 1', 'SET NAMES binary'],
  )
})

test('M3.12: gb2312 resolves at all, which it did not before this item', () => {
  // Found by the corpus: `func_like.test` runs `SET NAMES gb2312`, and gb2312
  // was absent from the generated registry entirely — `strings/ctype-gb2312.cc`
  // was not among the files the charset generator reads, so ids 24 and 86
  // resolved to nothing and a gb2312 client got "unknown collation" rather than
  // either service or an honest refusal. `APPROXIMATE_CHARSETS` had been naming
  // a charset the registry could not produce.
  assert.deepEqual(resolved('gb2312'), { charset: 'gb2312', readable: true })
  const gb = resolveCharset('gb2312')
  assert.ok('collationId' in gb && gb.collationId === 24, 'gb2312_chinese_ci is collation 24')
})
