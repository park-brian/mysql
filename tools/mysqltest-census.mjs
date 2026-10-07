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
import { REPO, REF, fetchPinnedBytes, combinedSha256, listPinnedDirectory, sourceMode } from './lib/gen-common.mjs'
import { lex, parseStatement, ParseError } from '@myjs/parser'
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
  const names = (await listNames()).filter((n) => n.endsWith('.test')).sort()

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

/**
 * The directory listing, from a local clone when there is one.
 *
 * The API path is the fallback rather than the default now. It allows sixty
 * unauthenticated requests an hour, it needs a token on a shared runner, and a
 * sandbox that blocks `api.github.com` cannot refresh the census at all — while
 * `git ls-tree` over the pinned commit answers the identical question offline.
 */
async function listNames() {
  const local = listPinnedDirectory(DIRECTORY)
  if (local !== null) {
    console.log(`listing ${DIRECTORY} from ${sourceMode()}`)
    return local
  }
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
  return entries.filter((e) => e.type === 'file').map((e) => e.name)
}

// --- main -------------------------------------------------------------------

const previous = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null
const selection = has('refresh') ? await listCandidates() : (previous?.selection ?? [])

if (selection.length === 0) {
  console.error(
    'no file list: run once with --refresh to build one (from reference/mysql, or\n' +
      '  from the GitHub API with a GITHUB_TOKEN),\n' +
      '  or restore test/format/fixtures/mysqltest-corpus.json.',
  )
  process.exit(1)
}

// Bytes, not text (M3.12). A `.test` file is written in whatever charset it
// declares, so decoding all 120 of them as UTF-8 destroyed exactly the bytes
// the `ctype_*` files exist to test.
const sources = []
for (const name of selection) sources.push(await fetchPinnedBytes(`${DIRECTORY}/${name}`))

let statements = 0
let lexed = 0
let parsed = 0
let parseFailed = 0
let permissive = 0
/** Statements we accept that MySQL rejects — a divergence the other way. */
const tooPermissive = new Map()
let skipped = 0
let directives = 0
const byKeyword = new Map()
/** File and line only — never the statement, which is GPLv2 (ground rule 7). */
const failures = []
/** Files the census deliberately did not measure, by reason. */
const notMeasured = []
/** How many statements were read in each charset — M3.12's whole point. */
const byCharset = new Map()
/** Charset switches a real server would refuse, by reason (M3.12). */
const refused = new Map()
/** Statements the corpus marks `--error`: MySQL rejects them, and so should we. */
let expectedToFail = 0
let expectedToFailAndDid = 0
/** Statements a real parser would accept and this one does not implement yet. */
const unsupported = new Map()
/** Statements that lexed and would not parse, by leading keyword. */
const parseFailures = new Map()
/** Parsed, by leading keyword — the exit criterion lives in this table. */
const parsedByKeyword = new Map()
/** Lines in a charset this build will not decode. Coverage lost, and counted. */
/** Statements a real server also refuses, which we refuse at the lexer. */
let refusedAtLex = 0
let unreadLines = 0
const unreadCharsets = new Set()

for (const source of sources) {
  const name = source.path.slice(DIRECTORY.length + 1)
  const result = extract(source.bytes)
  directives += result.directives
  skipped += result.skipped
  for (const [reason, n] of Object.entries(result.refused)) refused.set(reason, (refused.get(reason) ?? 0) + n)
  unreadLines += result.unreadLines
  for (const c of result.unreadCharsets) unreadCharsets.add(c)
  if (result.outcome === 'no-sql' || result.outcome === 'undecodable') {
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
  for (const { text, keyword, charset, expectedError } of result.statements) {
    statements++
    byKeyword.set(keyword, (byKeyword.get(keyword) ?? 0) + 1)
    byCharset.set(charset, (byCharset.get(charset) ?? 0) + 1)
    // Hoisted above the lex: a statement the corpus marks `--error
    // ER_PARSE_ERROR` is one a real server refuses, and *where* we refuse it —
    // lexer or parser — is our business rather than a divergence. `SELECT \N;`
    // is the case that proved it: MySQL removed `\N` in WL#7247, `null.test`
    // asserts the removal, and a local 8.4.11 answers 1064. Counting our
    // matching refusal as a lex failure would have been the instrument
    // reporting itself as a defect, which M3.11 already did once.
    const shouldFail = expectedError === 'ER_PARSE_ERROR' || expectedError === '1064'
    try {
      lex(text)
      lexed++
    } catch (e) {
      if (shouldFail) {
        expectedToFail++
        expectedToFailAndDid++
        refusedAtLex++
        continue
      }
      failures.push({ file: name, kind: 'statement-lex', code: e instanceof ParseError ? e.code : 'unknown' })
      // Printed, not committed: the CI log is ephemeral and this is the only
      // place the offending SQL may appear.
      if (failures.length <= 25) console.error(`  lex failed in ${name}: ${String(e.message).slice(0, 140)}`)
      continue
    }
    // M3.5 makes this climb. The three outcomes are counted apart on purpose:
    // a statement this parser does not *implement* is not the same as one it
    // cannot parse, and folding them together would make the exit criterion's
    // number mean "what M3.5 happens to cover" rather than "what parses".
    // A statement the corpus marks `--error ER_PARSE_ERROR` is one MySQL itself
    // rejects, and refusing it is the correct outcome rather than a miss. This
    // is what turns the census from "how much parses" into "how much of what
    // MySQL accepts parses" — the question M3's exit criterion actually asks,
    // and the difference between 80.8% and the real number.
    if (shouldFail) expectedToFail++
    try {
      parseStatement(text)
      parsed++
      parsedByKeyword.set(keyword, (parsedByKeyword.get(keyword) ?? 0) + 1)
      if (shouldFail) {
        // We accepted something MySQL rejects. Not a crash, but a divergence,
        // and the only one this census can see in that direction.
        tooPermissive.set(keyword, (tooPermissive.get(keyword) ?? 0) + 1)
        if (permissive++ < 20) console.error(`  accepted but MySQL rejects, in ${name}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    } catch (e) {
      if (shouldFail) {
        expectedToFailAndDid++
      } else if (e instanceof ParseError && e.code === 'ER_NOT_SUPPORTED_YET') {
        const what = /support '([^']*)'/.exec(String(e.message))?.[1] ?? '(unknown)'
        unsupported.set(what, (unsupported.get(what) ?? 0) + 1)
      } else {
        parseFailures.set(keyword, (parseFailures.get(keyword) ?? 0) + 1)
        if (parseFailed++ < 400) console.error(`  parse failed in ${name}: ${text.replace(/\s+/g, ' ').slice(0, 400)}`)
      }
    }
  }
}

const ranked = [...byKeyword].sort((a, b) => b[1] - a[1])
const measured = sources.length - notMeasured.length
console.log(`${sources.length} file(s), ${measured} measured, ${directives} directive line(s) skipped`)
console.log(
  `${statements} statement(s): ${lexed} lexed, ${refusedAtLex} refused at the lexer as MySQL does, ` +
    `${parsed} parsed, ${skipped} skipped for $variables`,
)
console.log(`top keywords: ${ranked.slice(0, 15).map(([k, n]) => `${k} ${n}`).join(', ')}`)
// M3's exit criterion is "every `CREATE TABLE` in MySQL's own test suite
// parses", so the per-keyword rate is the criterion's own scoreboard rather
// than a curiosity. Printed for the keywords that lead the census.
const rate = (k) => {
  const total = byKeyword.get(k) ?? 0
  const ok = parsedByKeyword.get(k) ?? 0
  return `${k} ${ok}/${total} (${total === 0 ? 0 : ((ok / total) * 100).toFixed(1)}%)`
}
console.log(`parsed by keyword: ${ranked.slice(0, 8).map(([k]) => rate(k)).join(', ')}`)
const topUnsupported = [...unsupported].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`not implemented yet: ${topUnsupported.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`)
const topParseFailures = [...parseFailures].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`would not parse: ${topParseFailures.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`)
console.log(
  `${expectedToFail} statement(s) the corpus expects to fail; we refuse ${expectedToFailAndDid} of them` +
    (tooPermissive.size === 0 ? '' : `, and wrongly accept ${[...tooPermissive].map(([k, n]) => `${k} ${n}`).join(', ')}`),
)
// Said out loud rather than buried in the fixture: a census that quietly
// stopped measuring half its files would otherwise still report 100% lexed.
for (const { file, reason } of notMeasured) console.log(`  not measured: ${file} — ${reason}`)
// M3.12's number. A corpus read entirely as utf8mb4 would say so here, and that
// is the state this item was created to leave behind.
const charsetRanked = [...byCharset].sort((a, b) => b[1] - a[1])
console.log(`by charset: ${charsetRanked.map(([c, n]) => `${c} ${n}`).join(', ')}`)
console.log(
  `charset switches refused: ${[...refused].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`,
)
// The honest cost of M2.18's posture, in lines rather than in prose: a charset
// this build will not decode faithfully is not read at all, and saying how much
// that is stops "100% lexed" from meaning "100% of what we could read".
console.log(
  `${unreadLines} line(s) unread in ${unreadCharsets.size} charset(s)` +
    (unreadCharsets.size > 0 ? `: ${[...unreadCharsets].join(', ')}` : ''),
)
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
        refusedAtLex,
        parsed,
        skippedWithVariables: skipped,
        directives,
        unreadLines,
        unreadCharsets: [...unreadCharsets].sort(),
        expectedToFail,
        expectedToFailAndDid,
      },
      byKeyword: Object.fromEntries(ranked),
      parsedByKeyword: Object.fromEntries([...parsedByKeyword].sort((a, b) => b[1] - a[1])),
      unsupported: Object.fromEntries([...unsupported].sort((a, b) => b[1] - a[1])),
      parseFailuresByKeyword: Object.fromEntries([...parseFailures].sort((a, b) => b[1] - a[1])),
      wronglyAcceptedByKeyword: Object.fromEntries([...tooPermissive].sort((a, b) => b[1] - a[1])),
      byCharset: Object.fromEntries(charsetRanked),
      refusedCharsetSwitches: Object.fromEntries([...refused].sort((a, b) => b[1] - a[1])),
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
//
// `refusedAtLex` is the one thing that is not a miss: SQL the corpus marks
// `--error ER_PARSE_ERROR`, which a real server rejects and we reject at the
// lexer instead of the parser. Those are kept in their own column rather than
// folded into `lexed`, because "tokenised" and "correctly refused" are
// different facts and a gate that blurs them reports a worse number than it
// could.
if (lexed + refusedAtLex !== statements || failures.length > 0) {
  console.error(
    `\n${statements - lexed - refusedAtLex} statement(s) and ${failures.filter((f) => f.kind === 'file-lex').length} whole file(s) failed to lex.\n` +
      '  Every statement in the corpus must tokenise. The failing SQL is printed above —\n' +
      '  it is GPLv2, so it appears only in this log and is never written to a file.',
  )
  process.exit(1)
}

// M3's exit criterion, enforced rather than merely reported.
//
// "Every `CREATE TABLE` in MySQL's own test suite parses" is not the same
// claim as "every CREATE statement parses", because the suite is full of
// statements MySQL itself rejects — 102 of them carry `--error
// ER_PARSE_ERROR`. So the criterion is: **a statement the corpus expects to
// succeed, in a form this parser implements, must parse.** Anything else is a
// divergence from the server, in one direction or the other.
const wouldNotParse = [...parseFailures.values()].reduce((a, b) => a + b, 0)
if (wouldNotParse > 0) {
  console.error(
    `\n${wouldNotParse} statement(s) that MySQL accepts failed to parse. The failing SQL is\n` +
      '  printed above — it is GPLv2, so it appears only in this log and is never written\n' +
      '  to a file. A statement this parser does not implement is reported separately and\n' +
      '  does not reach here.',
  )
  process.exit(1)
}

// The divergence in the other direction, which the expected-failure accounting
// is the only thing that can see: SQL we accept and a real server rejects.
// Two remain and both need machinery M3.5 does not own — MySQL's reserved-word
// list (`create table lateral(…)`) and its rules for which characters may
// appear in an unquoted identifier. Both arrive with M3.3. The bound is a
// ratchet: it may fall, and a rise means a new one.
const wronglyAccepted = [...tooPermissive.values()].reduce((a, b) => a + b, 0)
if (wronglyAccepted > 2) {
  console.error(
    `\n${wronglyAccepted} statement(s) parsed that MySQL rejects, and the ratchet allows 2.\n` +
      '  Being more permissive than the server is a divergence like any other.',
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
