// The `.test` file extractor for M3.11's census, split out so it can be tested.
//
// `mysqltest-census.mjs` needs the network — it fetches `mysql-test/t` at the
// pinned ref — so nothing in it could be exercised by `npm test`. The rules for
// telling a directive from a statement are the part with bugs in it, and they
// need no network at all, so they live here and `test/unit/mysqltest-extract.test.ts`
// drives them with snippets written for the purpose. Same split, and the same
// reason, as `tools/lib/binlog-hexdump.mjs`.
//
// Ground rule 7 applies to the test as much as to the census: every snippet in
// it is written here rather than copied out of MySQL's corpus.
import { lex } from '@myjs/parser'

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
 * Does this line leave a bracket or a backtick open?
 *
 * A mysqltest directive may run over several lines, and its continuation lines
 * carry no `--` prefix of their own:
 *
 *     --let $x = `SELECT COUNT(*)
 *                   FROM t1`
 *     --assert([SELECT COUNT(*) FROM information_schema.tables
 *               WHERE table_schema = 'test', COUNT, 1] = 1)
 *
 * Fed to the SQL lexer, the second line of either is a fragment. Two of the
 * eight "file will not lex" reports in the first census run were exactly this,
 * and **neither was a lexer bug** — the instrument was measuring its own
 * extraction mistake. The state is carried across lines because a directive can
 * span more than two.
 *
 * Which directives may continue is a **closed list**, not a bracket count over
 * every directive, and that distinction is the whole of it. Counting brackets
 * everywhere swallowed 25 lines of real SQL across three files, because
 * `--echo` carries free prose:
 *
 *     --echo # Bug#32239484: Item_sum_json::val_json: assertion `!m_wrapper->empty()'
 *
 * One backtick, never closed, and every statement after it disappears into a
 * directive that ended on its own line. A heuristic that silently *removes*
 * corpus is worse than the miscount it was fixing, since the census would keep
 * reporting 100% lexed over less and less SQL. `CONTINUES` is why the check
 * below verifies what the rule absorbed rather than only what it fixed.
 */
export function advance(line, state) {
  for (const ch of line) {
    if (state.tick) {
      if (ch === '`') state.tick = false
      continue
    }
    if (ch === '`') state.tick = true
    else if (ch === '(' || ch === '[') state.depth++
    else if (ch === ')' || ch === ']') state.depth = Math.max(0, state.depth - 1)
  }
  return state.depth > 0 || state.tick
}

/**
 * The directives that may run past their own line: `--let $x = \`SELECT …\``,
 * `--assert([SELECT …] = 1)`, `--expr` (the same expression grammar as
 * `--assert`), and `if` / `while`, whose condition may be a backtick query —
 * `func_misc.test` opens one with `if (!\` SELECT …` and closes it on the next
 * line. Everything else ends where its line does, `--echo` and
 * `--replace_regex` emphatically included.
 */
const CONTINUES = /^(?:--)?(let|assert|expr|if|while)\b/i

/** How far one of those may run before the continuation is assumed spurious. */
const MAX_CONTINUATION = 20

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
 *
 * The outcome is named rather than boolean. `no-sql` and `not-utf8` are facts
 * about the *file*, not defects in the lexer, and lumping them in with a real
 * lexer failure is how a census gets a scary number for an uninteresting
 * reason — five of the first run's eight failures were `--source` wrappers
 * containing no SQL at all.
 */
export function extract(text) {
  // `fetchPinned` decodes with `Response.text()`, which is UTF-8 with
  // replacement. `ctype_sjis.test` is Shift-JIS on purpose, so its bytes come
  // back as U+FFFD and lexing them measures the decoder, not the lexer. The
  // charset-specific `ctype_*` files are M5's business, once the census can
  // read a file's `--character_set` directive and decode it accordingly.
  if (text.includes('�')) {
    return { statements: [], directives: 0, skipped: 0, outcome: 'not-utf8', detail: 'not UTF-8 at the source' }
  }

  const lines = text.split('\n')
  const sql = []
  let directives = 0
  let delimiter = ';'
  let inHeredoc = false
  const open = { depth: 0, tick: false }
  let continuation = 0

  for (const line of lines) {
    const trimmed = line.trim()
    // A directive that has not closed its brackets yet. A fresh `--` line ends
    // the run, because that can only mean the detection was wrong.
    if (continuation > 0 && !trimmed.startsWith('--')) {
      directives++
      const stillOpen = advance(line, open)
      continuation = stillOpen && continuation < MAX_CONTINUATION ? continuation + 1 : 0
      if (continuation === 0) {
        open.depth = 0
        open.tick = false
      }
      continue
    }
    continuation = 0
    open.depth = 0
    open.tick = false
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
      if (CONTINUES.test(trimmed) && advance(line, open)) continuation = 1
      continue
    }
    if (trimmed === '{' || trimmed === '}') {
      directives++
      continue
    }
    sql.push(line)
  }

  const joined = sql.join('\n')
  if (joined.trim() === '') {
    // Not a failure. Several files in the corpus are pure `--source` wrappers
    // that set a variable and include a shared body — `ctype_utf8mb4_heap.test`
    // is three directives long. There is nothing there to lex.
    return { statements: [], directives, skipped: 0, outcome: 'no-sql', detail: 'no SQL lines outside directives' }
  }

  // A file that will not lex as a whole is reported rather than worked around:
  // falling back to a naive split would hide exactly the failure worth seeing.
  //
  // The error and the offending line come back with it. The first version
  // returned a bare flag, so a run that found eight broken files said only
  // "eight" — and the header of this file promises the failing SQL is printed.
  // A diagnostic that reports a count and withholds the reason is the same
  // mistake as a gate that passes without checking.
  let tokens
  try {
    tokens = lex(joined)
  } catch (e) {
    const line = Number(/at line (\d+)/.exec(String(e.message))?.[1] ?? 0)
    const context = sql[line - 1]?.trim() ?? ''
    return {
      statements: [],
      directives,
      skipped: 0,
      outcome: 'lex-failed',
      detail: `line ${line}: ${context.slice(0, 120)}`,
    }
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
  return { statements, directives, skipped, outcome: 'ok', detail: '', delimiter }
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
export function keywordOf(tokens) {
  for (const t of tokens) {
    if (t.kind === 'operator' && t.text === '(') continue
    if (t.kind === 'identifier' && t.quoted !== true) return t.text.toUpperCase()
    return '(other)'
  }
  return '(other)'
}
