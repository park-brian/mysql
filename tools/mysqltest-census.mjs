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

// --- extraction -------------------------------------------------------------

/**
 * Bare `mysqltest` commands — the ones written without a leading `--`.
 *
 * Directives are usually `--disable_warnings` and the like, but the same verbs
 * are legal bare at command position. Missing one means feeding `connection
 * default` to the SQL lexer and recording a spurious failure.
 */
const COMMANDS =
  /^(let|if|while|echo|connection|connect|disconnect|send|reap|source|sleep|real_sleep|inc|dec|die|exit|skip|end|eval|error|replace_result|replace_column|replace_regex|enable_\w+|disable_\w+|sync_slave_with_master|save_master_pos|start_transaction|delimiter|remove_file|write_file|append_file|copy_file|chmod|mkdir|rmdir|cat_file|diff_files|perl|output|lowercase_result|assert)\b/i

/**
 * Split one `.test` file into SQL statements.
 *
 * Approximate, deliberately, and the approximation is measured rather than
 * hidden: the returned counts say how many lines were dropped as directives and
 * how many statements were skipped for containing `$variables`, so a reader can
 * see how much of the file this actually looked at.
 *
 * Statement boundaries come from **our own lexer** rather than from splitting
 * on `;`, because a naive split breaks on `INSERT INTO t VALUES ('a;b')` — the
 * semicolon inside a string literal is not a terminator. Dogfooding the lexer
 * here is also the point: if it cannot find the boundaries in real SQL, that is
 * the bug this tool exists to surface.
 */
function extract(text) {
  const lines = text.split('\n')
  const sql = []
  let directives = 0
  let delimiter = ';'
  let inHeredoc = false

  for (const line of lines) {
    const trimmed = line.trim()
    // `perl;`, `write_file x;` and friends open a block that runs to `EOF`.
    // Its contents are Perl or file data, not SQL, and letting them through
    // means measuring something that is not the corpus. Rare — about 1.5% of
    // what the first version emitted — but "rare non-SQL that happens to lex"
    // is precisely the way a census flatters itself.
    if (inHeredoc) {
      directives++
      if (trimmed === 'EOF') inHeredoc = false
      continue
    }
    if (/^(perl|write_file|append_file)\b/i.test(trimmed)) {
      directives++
      inHeredoc = true
      continue
    }
    if (trimmed === '') continue
    // A directive, a comment, or a bare command. `--` at column 0 in a `.test`
    // file is mysqltest's prefix, not SQL's comment marker.
    if (trimmed.startsWith('--') || trimmed.startsWith('#') || COMMANDS.test(trimmed)) {
      directives++
      const d = /^(?:--)?delimiter\s+(\S+)/i.exec(trimmed)
      if (d !== null) delimiter = d[1].replace(/;$/, '') || ';'
      continue
    }
    if (trimmed === '{' || trimmed === '}') {
      directives++
      continue
    }
    sql.push(line)
  }

  const joined = sql.join('\n')
  if (joined.trim() === '') return { statements: [], directives, skipped: 0, lexFailed: true }

  // A file that will not lex as a whole is reported rather than worked around:
  // falling back to a naive split would hide exactly the failure worth seeing.
  let tokens
  try {
    tokens = lex(joined)
  } catch {
    return { statements: [], directives, skipped: 0, lexFailed: true }
  }

  const statements = []
  let skipped = 0
  let start = 0
  let held = []
  const emit = (from, to) => {
    const text = joined.slice(from, to).trim()
    if (text === '' || held.length === 0) {
      held = []
      return
    }
    // `$var` is a mysqltest substitution, not SQL. Counted, not parsed.
    if (text.includes('$')) {
      skipped++
      held = []
      return
    }
    statements.push({ text, keyword: keywordOf(held) })
    held = []
  }
  for (const t of tokens) {
    if (t.kind === 'operator' && t.text === ';') {
      emit(start, t.start)
      start = t.end
      continue
    }
    if (t.kind !== 'eof') held.push(t)
  }
  emit(start, joined.length)
  return { statements, directives, skipped, lexFailed: false, delimiter }
}

/**
 * What kind of statement this is, from its **tokens** rather than its text.
 *
 * Classifying with a regex over the raw source looked equivalent and was not:
 * a trailing `# comment` on the previous statement's line lands at the front of
 * the next statement's slice, so `INSERT ...` was filed under `(other)`. The
 * lexer has already skipped that comment, so reading the first token instead is
 * both simpler and right.
 *
 * A leading `(` is skipped, because `(SELECT ...) ORDER BY a` is a `SELECT`.
 */
function keywordOf(tokens) {
  for (const t of tokens) {
    if (t.kind === 'operator' && t.text === '(') continue
    if (t.kind === 'identifier' && t.quoted !== true) return t.text.toUpperCase()
    return '(other)'
  }
  return '(other)'
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

for (const source of sources) {
  const name = source.path.slice(DIRECTORY.length + 1)
  const result = extract(source.text)
  directives += result.directives
  skipped += result.skipped
  if (result.lexFailed) {
    failures.push({ file: name, kind: 'file-lex' })
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
console.log(`${sources.length} file(s), ${directives} directive line(s) skipped`)
console.log(`${statements} statement(s): ${lexed} lexed, ${parsed} parsed, ${skipped} skipped for $variables`)
console.log(`top keywords: ${ranked.slice(0, 15).map(([k, n]) => `${k} ${n}`).join(', ')}`)
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
      totals: { files: sources.length, statements, lexed, parsed, skippedWithVariables: skipped, directives },
      byKeyword: Object.fromEntries(ranked),
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
