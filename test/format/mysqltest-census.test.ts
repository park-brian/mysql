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
    readonly statements: number
    readonly lexed: number
    readonly parsed: number
    readonly skippedWithVariables: number
    readonly directives: number
  }
  readonly byKeyword: Readonly<Record<string, number>>
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
  const c = census()
  assert.equal(c.totals.lexed, c.totals.statements, `${c.totals.statements - c.totals.lexed} statement(s) failed to lex`)
  assert.deepEqual(c.failures, [], 'a file that will not lex means the statement boundaries could not be found')
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
