#!/usr/bin/env node
// M3.11 — measure the parser against MySQL's own test corpus.
//
// Doc 43 §1 calls `mysql-test` "the single highest-value testing asset
// available to us": 1,543 files (2,448 at the pinned ref) of SQL that Oracle
// itself uses to define correct behaviour. The roadmap schedules the full
// interpreter as M5.15, behind an executor — correctly, because diffing
// `.result` files needs one.
//
// But the *parse-only* half needs nothing but a parser, and M3's own exit
// criterion already assumes it exists: "every `CREATE TABLE` in MySQL's own
// test suite parses". Nothing owned the tool that would check that. This is it.
//
// Two numbers come out, and today they are at very different stages:
//
//   **lexed** — every statement should tokenise, and M3.1 is done, so this is
//   measurable *now*. It is the first time the lexer meets real-world SQL
//   rather than the cases someone thought to write.
//
//   **parsed** — 0 until M3.3–M3.6 land. Its value is not the number but the
//   *breakdown*: the keyword census says what the corpus actually contains, in
//   frequency order, which is a far better build order than a wish list.
//
// Not every selected file is measurable, and the reasons are recorded rather
// than counted as defects. A `.test` file may be a pure `--source` wrapper —
// `derived_condition_pushdown.test` is two lines, both of them includes — or it
// may not be UTF-8, as `ctype_sjis.test` deliberately is not. Following
// `--source include/*.inc` would reach the SQL behind the wrappers and is worth
// doing; it needs the `--character_set` directive honoured at the same time, so
// that a Shift-JIS include is decoded rather than mangled, which is M5's half of
// this tool rather than M3's.
//
// **Ground rule 7 governs what may be committed.** `mysql-test` is GPLv2 and
// this repository is MIT: the suite is fetched, never vendored. So the emitted
// fixture carries *facts only* — file names, hashes, counts, keyword
// frequencies — and never a line of the SQL itself. That is D-29's rule (the
// generated error table carries numbers and symbols, never MySQL's English
// text) applied to a corpus instead of a table. Failing statements are printed
// to the CI log, which is ephemeral, and never written to a file.
//
// Usage:
//   node tools/mysqltest-census.mjs             # use the committed file list
//   node tools/mysqltest-census.mjs --refresh   # re-list the directory (needs a token)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REF, fetchPinned, combinedSha256 } from './lib/gen-common.mjs'
import { lex, ParseError } from '@myjs/parser'
import { extract } from './lib/mysqltest-extract.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const has = (name) => process.argv.includes(`--${name}`)

const OUT_DIR = arg('out', new URL('../test/format/fixtures/', import.meta.url).pathname)
const FIXTURE = join(OUT_DIR, 'mysqltest-corpus.json')
const DIRECTORY = 'mysql-test/t'

/**
 * How many files the census covers.
 *
 * Doc 43 §1's plan is "a curated allowlist, growing over time" rather than all
 * 2,448 at once, and a cap is what makes the run cheap enough to do on every
 * push. Raising it is a one-line change and a re-capture.
 */
const MAX_FILES = Number(arg('max', '120'))

/**
 * Which files to take, in priority order.
 *
 * Doc 43 §1 proposes `type_*`, `func_*`, `select`, `join*`, `order_by`,
 * `group_by`, `insert*`, `update`, `delete`, `null`, `varbinary`, `ctype_*`.
 * **Half of those do not exist at the pinned ref** — there is no `select.test`,
 * no `order_by.test`, no `update.test`, no `null.test`, no `union.test`, and
 * `type_*` is empty; those tests moved into suites years ago. See E-13.
 *
 * So the names are never hardcoded: the directory is listed and these patterns
 * select from what is actually there. That is D-14's principle — read the fact
 * from the source rather than transcribe it — applied to a file list.
 */
const PATTERNS = [
  /^(alias|distinct|having|limit|join|group_by|insert|delete|update)\.test$/,
  /^(join_outer|join_nested|insert_select|insert_update|order_by)\w*\.test$/,
  /^func_(str|math|time|if|in|like|concat|group|misc|op|sapdb|test|encrypt|default|json|regexp)\w*\.test$/,
  /^ctype_(utf8|utf8mb4|latin1|ucs|binary|collate|gbk|sjis|big5|euckr)\w*\.test$/,
  /^(subquery|derived|view|union|cast|case|null)\w*\.test$/,
  /^(create|alter|drop|key|index|constraint|default|comment)\w*\.test$/,
]

// --- listing ----------------------------------------------------------------

/**
 * The `.test` files in the pinned directory, selected by `PATTERNS`.
 *
 * Only reached with `--refresh`. The normal path reads the committed list, so
 * a census run needs no API call and no token — which matters because the
 * unauthenticated GitHub API allows sixty requests an hour and a shared CI
 * runner burns that quickly.
 */
async function listCandidates() {
  const token = arg('token', process.env.GITHUB_TOKEN)
  const headers = { 'user-agent': 'myjs-mysqltest-census' }
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`

  const url = `https://api.github.com/repos/${REPO}/contents/${DIRECTORY}?ref=${REF}&per_page=1000&page=1`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text()
    console.error(
      `listing ${DIRECTORY} failed with ${response.status}.\n` +
        (response.status === 403
          ? '  The unauthenticated GitHub API allows 60 requests an hour. Pass --token or set\n' +
            '  GITHUB_TOKEN; CI has one. Without --refresh the committed file list is used and\n' +
            '  no API call is made at all.'
          : `  ${body.slice(0, 200)}`),
    )
    process.exit(1)
  }
  const entries = await response.json()
  const names = entries.filter((e) => e.type === 'file' && e.name.endsWith('.test')).map((e) => e.name)
  names.sort()

  const picked = []
  for (const pattern of PATTERNS) {
    for (const name of names) {
      if (picked.length >= MAX_FILES) break
      if (pattern.test(name) && !picked.includes(name)) picked.push(name)
    }
  }
  console.log(`listed ${names.length} .test file(s), selected ${picked.length}`)
  return picked
}

// --- main -------------------------------------------------------------------

const previous = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null
const selection = has('refresh') ? await listCandidates() : (previous?.selection ?? [])

if (selection.length === 0) {
  console.error(
    'no file list: run once with --refresh (and a GITHUB_TOKEN) to build one,\n' +
      '  or restore test/format/fixtures/mysqltest-corpus.json.',
  )
  process.exit(1)
}

const sources = []
for (const name of selection) sources.push(await fetchPinned(`${DIRECTORY}/${name}`))

let statements = 0
let lexed = 0
let parsed = 0
let skipped = 0
let directives = 0
const byKeyword = new Map()
/** File and line only — never the statement, which is GPLv2 (ground rule 7). */
const failures = []
/** Files the census deliberately did not measure, by reason. */
const notMeasured = []

for (const source of sources) {
  const name = source.path.slice(DIRECTORY.length + 1)
  const result = extract(source.text)
  directives += result.directives
  skipped += result.skipped
  if (result.outcome === 'no-sql' || result.outcome === 'not-utf8') {
    // A fact about the file, not a defect. Recorded so the measured count and
    // the selected count can differ without the difference going unexplained.
    notMeasured.push({ file: name, reason: result.outcome })
    continue
  }
  if (result.outcome !== 'ok') {
    failures.push({ file: name, kind: 'file-lex' })
    // Printed, never committed: the offending SQL is GPLv2 and the CI log is
    // ephemeral. The fixture records only that this file failed.
    console.error(`  file will not lex: ${name} — ${result.detail}`)
    continue
  }
  for (const { text, keyword } of result.statements) {
    statements++
    byKeyword.set(keyword, (byKeyword.get(keyword) ?? 0) + 1)
    try {
      lex(text)
      lexed++
    } catch (e) {
      failures.push({ file: name, kind: 'statement-lex', code: e instanceof ParseError ? e.code : 'unknown' })
      // Printed, not committed: the CI log is ephemeral and this is the only
      // place the offending SQL may appear.
      if (failures.length <= 25) console.error(`  lex failed in ${name}: ${String(e.message).slice(0, 140)}`)
      continue
    }
    // M3.3–M3.6 will make this climb. Until a statement parser exists the
    // number is 0 by construction, and saying so is better than omitting it.
  }
}

const ranked = [...byKeyword].sort((a, b) => b[1] - a[1])
const measured = sources.length - notMeasured.length
console.log(`${sources.length} file(s), ${measured} measured, ${directives} directive line(s) skipped`)
console.log(`${statements} statement(s): ${lexed} lexed, ${parsed} parsed, ${skipped} skipped for $variables`)
console.log(`top keywords: ${ranked.slice(0, 15).map(([k, n]) => `${k} ${n}`).join(', ')}`)
// Said out loud rather than buried in the fixture: a census that quietly
// stopped measuring half its files would otherwise still report 100% lexed.
for (const { file, reason } of notMeasured) console.log(`  not measured: ${file} — ${reason}`)
if (failures.length > 0) console.log(`${failures.length} failure(s)`)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  FIXTURE,
  JSON.stringify(
    {
      name: 'mysqltest-corpus',
      note:
        'Facts about MySQL\'s own test corpus — names, hashes and counts, never its SQL. ' +
        'Ground rule 7: mysql-test is fetched in CI, never vendored.',
      source: `${REPO}@${REF} ${DIRECTORY}`,
      sourceSha256: combinedSha256(sources),
      selection,
      totals: {
        files: sources.length,
        measured,
        statements,
        lexed,
        parsed,
        skippedWithVariables: skipped,
        directives,
      },
      byKeyword: Object.fromEntries(ranked),
      notMeasured,
      failures,
    },
    null,
    2,
  ) + '\n',
)
console.log(`census -> ${FIXTURE}`)

// The gate. Every statement in MySQL's own corpus must tokenise — the parser
// may not understand `ALTER TABLE ... PARTITION BY` yet, but the *lexer* has no
// excuse: it is charset- and `sql_mode`-aware and a statement it cannot split
// into tokens is a bug in it, not a missing feature.
//
// A file that would not lex as a whole counts too, since that means the
// statement boundaries could not be found at all.
if (lexed !== statements || failures.length > 0) {
  console.error(
    `\n${statements - lexed} statement(s) and ${failures.filter((f) => f.kind === 'file-lex').length} whole file(s) failed to lex.\n` +
      '  Every statement in the corpus must tokenise. The failing SQL is printed above —\n' +
      '  it is GPLv2, so it appears only in this log and is never written to a file.',
  )
  process.exit(1)
}

// The other half of the gate, and the one M2.22 keeps teaching: a census that
// measured nothing would satisfy every line above.
//
// Only `no-sql` is capped, and the distinction is not pedantry. `not-utf8` is a
// property of the *source file* that nothing in this tool can cause — the eight
// `ctype_*` files that trip it are non-UTF-8 on purpose, and the number moves
// only when the selection does. `no-sql` is different: it is what a file looks
// like when the extractor has classified every one of its lines as a directive,
// so it is the shape an extractor collapse would take at corpus scale, and a
// cap on it is a real check rather than a restatement of the selection.
const empty = notMeasured.filter((f) => f.reason === 'no-sql').length
if (empty > sources.length * 0.1) {
  console.error(
    `\n${empty}/${sources.length} file(s) came out with no SQL in them at all.\n` +
      '  A few are genuine `--source` wrappers. This many means the directive extractor\n' +
      '  is eating statements, and every rate above is being reported over what is left.',
  )
  process.exit(1)
}
