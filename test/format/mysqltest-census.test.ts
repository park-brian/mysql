// M3.11 — the committed census of MySQL's own test corpus.
//
// The census itself needs the network, so it runs in CI and this replays what
// it recorded. What it records is deliberately narrow: **facts only** — file
// names, a source hash, counts, keyword frequencies. Ground rule 7 says
// `mysql-test` is fetched in CI and never vendored, because it is GPLv2 and
// this repository is MIT, so not one line of its SQL may land in a fixture.
// That is D-29's rule (the generated error table carries numbers and symbols,
// never MySQL's English text) applied to a corpus rather than to a table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const FIXTURE = new URL('./fixtures/mysqltest-corpus.json', import.meta.url).pathname

interface Census {
  readonly source: string
  readonly sourceSha256?: string
  readonly selection: readonly string[]
  readonly totals: {
    readonly files: number
    readonly measured: number
    readonly statements: number
    readonly lexed: number
    /** Refused at the lexer, as MySQL refuses them — `--error ER_PARSE_ERROR`. */
    readonly refusedAtLex: number
    readonly parsed: number
    readonly skippedWithVariables: number
    readonly directives: number
    readonly unreadLines: number
    readonly unreadCharsets: readonly string[]
    readonly expectedToFail: number
    readonly expectedToFailAndDid: number
  }
  readonly byKeyword: Readonly<Record<string, number>>
  readonly byCharset: Readonly<Record<string, number>>
  readonly refusedCharsetSwitches: Readonly<Record<string, number>>
  readonly parsedByKeyword: Readonly<Record<string, number>>
  readonly unsupported: Readonly<Record<string, number>>
  readonly parseFailuresByKeyword: Readonly<Record<string, number>>
  readonly wronglyAcceptedByKeyword: Readonly<Record<string, number>>
  readonly notMeasured: readonly { readonly file: string; readonly reason: string }[]
  readonly failures: readonly { readonly file: string; readonly kind: string }[]
}

const census = (): Census => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Census

test('M3.11: the census is committed and says its numbers out loud', () => {
  assert.ok(existsSync(FIXTURE), 'the census fixture must be committed')
  const c = census()
  assert.match(c.source, /mysql-server@\w+ mysql-test/, 'it must name the tree it came from')
  assert.ok(c.selection.length > 0, 'an empty selection would measure nothing')
  assert.equal(c.totals.files, c.selection.length)

  // M2.22's lesson, a fourth time. Printed rather than merely asserted,
  // because the number *is* the finding: this is how far the parser has got
  // through MySQL's own corpus, and a reader should not have to open a JSON
  // file to see it.
  const { statements, lexed, parsed } = c.totals
  console.log(
    `  [mysqltest] ${c.totals.files} file(s), ${statements} statement(s): ` +
      `${lexed} lexed (${((lexed / statements) * 100).toFixed(1)}%), ` +
      `${parsed} parsed (${((parsed / statements) * 100).toFixed(1)}%)`,
  )
})

test('M3.11: every statement in the corpus lexes', () => {
  // The lexer has no excuse. It may not *parse* `ALTER TABLE ... PARTITION BY`
  // yet — that is M3.5 — but a statement it cannot split into tokens is a bug
  // in M3.1, and this is the first time that claim has been tested against
  // real-world SQL rather than against cases someone thought to write.
  //
  // `refusedAtLex` is the one statement class that is not a miss: SQL the
  // corpus marks `--error ER_PARSE_ERROR`, which a real server rejects and we
  // reject at the lexer rather than the parser. `SELECT \N;` in `null.test` is
  // the case — MySQL removed `\N` in WL#7247, the corpus asserts the removal,
  // and a local 8.4.11 answers 1064. It is counted apart rather than folded
  // into `lexed` because "tokenised" and "correctly refused" are different
  // facts, and one number covering both would be a worse number.
  const c = census()
  const accounted = c.totals.lexed + c.totals.refusedAtLex
  assert.equal(accounted, c.totals.statements, `${c.totals.statements - accounted} statement(s) failed to lex`)
  assert.deepEqual(c.failures, [], 'a file that will not lex means the statement boundaries could not be found')
})

test('M3.11: a lexer refusal is only ever one the corpus predicted', () => {
  // The ratchet on the recovery rule. A statement may be refused at the lexer
  // only when the corpus marks it `--error ER_PARSE_ERROR`; every such refusal
  // is therefore also counted in `expectedToFailAndDid`. Without this, the
  // recovery could quietly absorb a genuine lexer bug — which is exactly the
  // failure mode the file-level report was written to prevent, so removing
  // that report has to bring its guarantee along.
  const c = census()
  assert.ok(
    c.totals.refusedAtLex <= c.totals.expectedToFailAndDid,
    'a lexer refusal must be one MySQL also refuses',
  )
})

test('M3.11: a file the census did not measure says why', () => {
  // The first run reported eight "file will not lex" failures and **none of
  // them was a lexer bug**: five files are pure `--source` wrappers with no SQL
  // in them, one is Shift-JIS on purpose (M3.12 now reads it), and two were the
  // extractor feeding the lexer half of a multi-line `--assert`. A census that
  // reports a defect for each of those trains its reader to ignore it.
  //
  // So each unmeasured file carries a reason, and the reasons are a closed set:
  // a new one means the tool learned something it should be saying out loud.
  const c = census()
  const allowed = new Set(['no-sql', 'undecodable'])
  for (const { file, reason } of c.notMeasured) {
    assert.ok(allowed.has(reason), `${file}: ${reason} is not a reason this census knows how to explain`)
  }
  assert.equal(c.totals.measured, c.totals.files - c.notMeasured.length)

  // And one of the two is bounded. `no-sql` is what a file looks like when the
  // extractor has classified every line in it as a directive, so it is the
  // shape an extractor collapse takes at corpus scale — M2.22's lesson, which
  // this project keeps relearning. `undecodable` is a property of the source
  // file that nothing here can cause, so capping it would only restate the
  // selection.
  const empty = c.notMeasured.filter((f) => f.reason === 'no-sql').length
  assert.ok(empty <= c.totals.files * 0.1, `${empty}/${c.totals.files} files came out with no SQL at all`)

  // What remains unread, said out loud. `binary` is a legal connection charset
  // this build will not decode, so those lines are skipped rather than guessed
  // at — and the count is the difference between "100% lexed" and "100% of what
  // we could read", which are not the same claim.
  if (c.totals.unreadLines > 0) {
    console.log(
      `  [mysqltest] ${c.totals.unreadLines} line(s) unread in ${c.totals.unreadCharsets.join(', ')} — ` +
        'a charset this build refuses to guess at',
    )
  }
})

test('M3.12: the corpus is read in the charset it was written in', () => {
  // The item's whole point, and the reason it existed. Before it, every file
  // was decoded as UTF-8 and the eight `ctype_*` files — MySQL's own tests for
  // the multi-byte lexing M3.1 was built for — were skipped as unreadable. A
  // census that had quietly gone back to reading everything as utf8mb4 would
  // still report 100% lexed, so the charsets themselves are the assertion.
  const c = census()
  const ranked = Object.entries(c.byCharset).sort((a, b) => b[1] - a[1])
  console.log(`  [mysqltest] by charset: ${ranked.map(([k, n]) => `${k} ${n}`).join(', ')}`)

  const total = ranked.reduce((sum, [, n]) => sum + n, 0)
  assert.equal(total, c.totals.statements, 'every statement must be attributed to the charset it was read in')
  assert.ok(ranked.length >= 5, `only ${ranked.length} charset(s) — the corpus is being read as one encoding again`)

  // The multi-byte family is the part that matters: these are the charsets
  // where a lead byte can carry an ASCII backslash in its trail, which is the
  // injection M3.1's acceptance clause names. Reading MySQL's own tests for
  // them as utf8mb4 fails `ctype_sjis.test`, checked by doing it.
  const multiByte = ['sjis', 'gbk', 'big5', 'euckr']
  for (const cs of multiByte) {
    assert.ok((c.byCharset[cs] ?? 0) > 0, `no statement was read as ${cs} — M3.1's own case is untested again`)
  }
})

test('M3.12: a charset switch a real server refuses is refused here too', () => {
  // `SET NAMES ucs2` is an error on a real server — doc 12: a multi-byte
  // connection charset breaks the NUL-terminated handshake fields — and
  // `ctype_ucs.test` runs it on purpose. Following it would misread every line
  // after it, so the refusals are recorded rather than being invisible.
  const c = census()
  const reasons = Object.entries(c.refusedCharsetSwitches)
  if (reasons.length > 0) {
    console.log(`  [mysqltest] charset switches refused: ${reasons.map(([r, n]) => `${r} ${n}`).join(', ')}`)
  }
  for (const [reason] of reasons) {
    assert.ok(
      reason === 'prohibited' || reason === 'not-a-charset',
      `${reason} is not a refusal this census knows how to explain`,
    )
  }
})

test('M3.5: every statement MySQL accepts, in a form this parser implements, parses', () => {
  // **M3's exit criterion**, and the phrasing matters. "Every `CREATE TABLE` in
  // MySQL's own test suite parses" is not "every CREATE statement parses",
  // because the suite is full of statements MySQL itself rejects — 102 of them
  // carry `--error ER_PARSE_ERROR`, and refusing those is correct rather than a
  // miss. What is left over is the real claim.
  const c = census()
  assert.deepEqual(
    c.parseFailuresByKeyword,
    {},
    'a statement MySQL accepts, in a form this parser implements, failed to parse',
  )

  const create = c.byKeyword['CREATE'] ?? 0
  const parsedCreate = c.parsedByKeyword['CREATE'] ?? 0
  const createSelect = c.unsupported['CREATE TABLE ... SELECT'] ?? 0
  console.log(
    `  [mysqltest] ${c.totals.parsed}/${c.totals.statements} parsed; ` +
      `CREATE ${parsedCreate}/${create}, with ${createSelect} more waiting on M3.3's query parser`,
  )
  assert.ok(parsedCreate > 2000, `only ${parsedCreate} CREATE statements parsed`)
})

test('M3.5: being more permissive than the server is a divergence too', () => {
  // The direction a parse rate cannot see. Accepting SQL a real MySQL rejects
  // is as wrong as refusing SQL it accepts, and only the corpus's own `--error`
  // directives can tell us — which is why the extractor tracks them.
  //
  // Two remain, and both need machinery M3.5 does not own: MySQL's
  // reserved-word list (`create table lateral(…)`) and its rules for which
  // characters may appear in an unquoted identifier. Both arrive with M3.3.
  // The bound is a ratchet — it may fall, and a rise means a new one.
  const c = census()
  const wrong = Object.values(c.wronglyAcceptedByKeyword).reduce((a, b) => a + b, 0)
  assert.ok(wrong <= 2, `${wrong} statement(s) parsed that MySQL rejects: ${JSON.stringify(c.wronglyAcceptedByKeyword)}`)
  assert.equal(c.totals.expectedToFail - c.totals.expectedToFailAndDid, wrong)
})

test('M3.11: the corpus is big enough for the number to mean something', () => {
  // A census over three statements would pass every assertion above while
  // establishing nothing. The floor is deliberately well under the current
  // count so that growing the corpus is not a chore, and well over the point
  // where the result is noise.
  const c = census()
  assert.ok(c.totals.statements > 1000, `only ${c.totals.statements} statements — too thin to conclude anything`)
  assert.ok(c.totals.directives > 100, 'a file whose directives were not recognised would look like SQL')
})

test('M3.11: the keyword census is the build order for M3.3–M3.6', () => {
  // This is the *useful* output today, and the reason the tool exists before
  // the statement parser rather than after it. The corpus says what MySQL
  // actually tests, in frequency order, which is a better build order than a
  // list someone drew up from memory — `DROP` outranking `UPDATE` by twenty to
  // one is not what I would have guessed.
  const c = census()
  const ranked = Object.entries(c.byKeyword).sort((a, b) => b[1] - a[1])
  const top = ranked.slice(0, 8)
  console.log(`  [mysqltest] build order: ${top.map(([k, n]) => `${k} ${n}`).join(', ')}`)

  const total = ranked.reduce((sum, [, n]) => sum + n, 0)
  assert.equal(total, c.totals.statements, 'every statement must be classified, or the census hides some')

  // The four that matter. If these ever stop leading, the corpus changed shape
  // and the build order should be revisited rather than assumed.
  const leaders = new Set(top.slice(0, 4).map(([k]) => k))
  for (const expected of ['SELECT', 'INSERT', 'CREATE', 'DROP']) {
    assert.ok(leaders.has(expected), `${expected} is no longer in the top four — re-read the census`)
  }
})
