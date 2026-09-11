// The `.test` file extractor for the corpus census (M3.11, M3.12).
//
// `mysqltest-census.mjs` needs the network — it fetches `mysql-test/t` at the
// pinned ref — so nothing in it could be exercised by `npm test`. The rules for
// telling a directive from a statement are the part with bugs in it, and they
// need no network at all, so they live here and `test/unit/mysqltest-extract.test.ts`
// drives them with snippets written for the purpose. Same split, and the same
// reason, as `tools/lib/binlog-hexdump.mjs`.
//
// **This works on bytes, not text** (M3.12). A `.test` file is not necessarily
// UTF-8: `ctype_latin1.test` is latin1, `ctype_sjis.test` is Shift-JIS, and
// `ctype_utf8.test` switches charset twenty times as it goes. Reading them
// through `Response.text()` turned every one of those bytes into U+FFFD, which
// is why the first census skipped the eight files that would have tested what
// the lexer was built for. Each region of a file is decoded in the charset that
// region is written in, and handed to the lexer as characters — which is
// `lexBytes`, and so the gbk lead-byte case M3.1's clause names is finally
// exercised against MySQL's own tests for it rather than against ours.
//
// Ground rule 7 applies to the test as much as to the census: every snippet in
// it is written here rather than copied out of MySQL's corpus.
import { canDecode, defaultCollationOf, isProhibitedConnectionCollation } from '@myjs/charsets'
import { decodeStatement, lex } from '@myjs/parser'

/**
 * Bare `mysqltest` commands — the ones written without a leading `--`.
 *
 * Directives are usually `--disable_warnings` and the like, but the same verbs
 * are legal bare at command position. Missing one means feeding `connection
 * default` to the SQL lexer and recording a spurious failure.
 */
const COMMANDS =
  /^(let|if|while|echo|connection|connect|disconnect|send|reap|source|sleep|real_sleep|inc|dec|die|exit|skip|end|eval|error|replace_result|replace_column|replace_regex|enable_\w+|disable_\w+|sync_slave_with_master|save_master_pos|start_transaction|delimiter|remove_file|write_file|append_file|copy_file|chmod|mkdir|rmdir|cat_file|diff_files|perl|output|lowercase_result|assert|character_set)\b/i

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
 * that found it looked at what the rule absorbed rather than at what it fixed.
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

/** The charset a `.test` file is read in before it says otherwise. */
const DEFAULT_CHARSET = 'utf8mb4'

/**
 * The three ways a `.test` file changes the charset its bytes are written in.
 *
 * `--character_set` is mysqltest's own directive and takes effect immediately.
 * The other two are SQL — they are statements in their own right, executed in
 * the charset in force *before* them, which is why the switch happens after the
 * line is added to the current region rather than before.
 *
 * All three are matched against the line's bytes read as Latin-1, so a
 * multi-byte character's trail byte cannot spell one of these: every keyword
 * here is ASCII and anchored at the start of the line.
 */
const CHARSET_DIRECTIVE = /^(?:--)?character_set\s+(\S+)/i
/** `--error ER_PARSE_ERROR` or `--error 1064`, possibly a comma-separated list. */
const EXPECTED_ERROR = /^(?:--)?error\s+([A-Za-z0-9_]+)/i
const SET_NAMES = /^set\s+names\s+'?([A-Za-z0-9_]+)'?/i
const SET_CLIENT = /^set\s+(?:@@)?(?:session\.|global\.|local\.)?character_set_client\s*=\s*'?([A-Za-z0-9_]+)'?/i

/**
 * Resolve a charset name to the collation id its bytes should be read with.
 *
 * Returns a `reason` instead of a charset when the switch must **not** happen,
 * and those cases are the interesting ones rather than the leftovers. All three
 * are things a real server does, so leaving the charset alone is not a
 * workaround — it is what actually happens:
 *
 *   - **`prohibited`.** `ucs2` may not be a connection charset (doc 12: a
 *     multi-byte connection charset breaks the NUL-terminated handshake
 *     fields), so `SET NAMES ucs2` is an error and the session charset does not
 *     change. `ctype_ucs.test` runs exactly that, four times over, on purpose;
 *     honouring it would misread every line after it.
 *   - **`not-a-charset`.** `SET character_set_client = CONCAT('ucs', …)` is a
 *     value this cannot evaluate, which `ctype_ucs.test` also does deliberately.
 *
 * A charset this build cannot *decode* — `gb2312` and `binary`, which
 * `func_like.test` and `ctype_binary.test` switch to — is **not** refused here.
 * A real server accepts those, so pretending the switch did not happen would
 * mean reading the next region's bytes in the wrong charset, which is the one
 * outcome worse than reading none of them. The region is entered and then
 * skipped at decode time, and its lines are counted as unread, so the cost is
 * visible instead of silently absorbed.
 *
 * Two names resolve rather than refuse, and both would be silent mis-reads if
 * they did not: MySQL 8's `utf8` is an alias for `utf8mb3`, and `DEFAULT` is
 * the server's own default charset, which D-10 pins at 8.4 — so `SET NAMES
 * DEFAULT` is a real reset to `utf8mb4` and not an unknown name. Resolving
 * rather than recording the name as written is also what lets the census count
 * `SET NAMES utf8` and `SET NAMES utf8mb3` as the one charset they are.
 */
export function resolveCharset(name) {
  const lower = name.toLowerCase()
  const charset = lower === 'utf8' ? 'utf8mb3' : lower === 'default' ? DEFAULT_CHARSET : lower
  const info = defaultCollationOf(charset)
  if (info === undefined) return { reason: 'not-a-charset' }
  if (isProhibitedConnectionCollation(info.id)) return { reason: 'prohibited' }
  return { charset: info.charset, collationId: info.id, readable: canDecode(info.charset) }
}

/** Split on `0x0A`, which no MySQL charset can produce as a trail byte. */
function splitLines(bytes) {
  const lines = []
  let start = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      lines.push(bytes.subarray(start, i))
      start = i + 1
    }
  }
  lines.push(bytes.subarray(start))
  return lines
}

/**
 * A line's bytes as Latin-1, for classification only.
 *
 * Never for lexing. Latin-1 is the one encoding that is total and reversible
 * over bytes, so a directive can be recognised before the file has said what
 * charset it is in — and a multi-byte character simply becomes some high
 * characters that no directive pattern matches. The SQL itself is decoded
 * properly, per region, further down.
 */
const asLatin1 = (bytes) => {
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}

/** Join a region's lines back into one byte buffer, newlines included. */
function joinLines(lines) {
  let total = 0
  for (const l of lines) total += l.length + 1
  const out = new Uint8Array(Math.max(0, total - 1))
  let at = 0
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out[at++] = 0x0a
    out.set(lines[i], at)
    at += lines[i].length
  }
  return out
}

/**
 * Split one `.test` file's bytes into SQL statements.
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
 * The outcome is named rather than boolean. `no-sql` and `undecodable` are facts
 * about the *file*, not defects in the lexer, and lumping them in with a real
 * lexer failure is how a census gets a scary number for an uninteresting
 * reason — five of the first run's eight failures were `--source` wrappers
 * containing no SQL at all.
 */
export function extract(bytes) {
  const lines = splitLines(bytes)
  /** Runs of SQL lines, each with the collation its bytes are written in. */
  const regions = []
  let charset = DEFAULT_CHARSET
  let collationId = resolveCharset(DEFAULT_CHARSET).collationId
  let readable = true
  let current = { charset, collationId, readable, lines: [], errors: [] }
  /** A `--error` directive waiting for the statement it applies to. */
  let pendingError = null
  /** Lines in a charset this build will not decode — coverage lost, counted. */
  let unreadLines = 0
  const unreadCharsets = new Set()
  const charsets = new Set([charset])
  /** Charset switches the file asked for and a real server would refuse, by reason. */
  const refused = new Map()

  let directives = 0
  let delimiter = ';'
  let inHeredoc = false
  const open = { depth: 0, tick: false }
  let continuation = 0

  /**
   * Every exit from this function goes through here.
   *
   * The four returns below used to spell the result out separately, and adding
   * one field to it produced two copies of that field in three of them. A shape
   * repeated four times is a shape that will drift.
   */
  const result = (outcome, detail, extra = {}) => ({
    statements: [],
    directives,
    skipped: 0,
    outcome,
    detail,
    charsets: [...charsets],
    refused: Object.fromEntries(refused),
    unreadLines,
    unreadCharsets: [...unreadCharsets],
    ...extra,
  })

  const switchTo = (name) => {
    const resolved = resolveCharset(name)
    if (resolved.collationId === undefined) {
      refused.set(resolved.reason, (refused.get(resolved.reason) ?? 0) + 1)
      return
    }
    if (resolved.collationId === collationId) return
    if (current.lines.length > 0) regions.push(current)
    charset = resolved.charset
    collationId = resolved.collationId
    readable = resolved.readable
    charsets.add(charset)
    current = { charset, collationId, readable, lines: [], errors: [] }
  }

  for (const raw of lines) {
    const line = asLatin1(raw)
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
      // mysqltest's own directive: it takes effect here, before the next line.
      const cs = CHARSET_DIRECTIVE.exec(trimmed)
      if (cs !== null) switchTo(cs[1])
      // `--error ER_PARSE_ERROR` says the *next* statement is expected to fail,
      // and that turns the census from "how much parses" into "how much of what
      // MySQL accepts parses" — which is the question M3's exit criterion asks.
      // Without it a corpus full of deliberate syntax errors makes a correct
      // parser look incomplete.
      const err = EXPECTED_ERROR.exec(trimmed)
      if (err !== null) pendingError = err[1].toUpperCase()
      // …and it applies to the next *command*, not to the next statement. A
      // directive in between consumes it: `--error ER_X` followed by
      // `eval $query;` arms the error for the eval, and the `DROP TABLE` three
      // lines later is an ordinary statement. Carrying it over made the census
      // report that we wrongly accepted a plain `DROP TABLE t1`.
      else if (!trimmed.startsWith('#')) pendingError = null
      if (CONTINUES.test(trimmed) && advance(line, open)) continuation = 1
      continue
    }
    if (trimmed === '{' || trimmed === '}') {
      directives++
      continue
    }
    current.errors[current.lines.length] = pendingError
    pendingError = null
    current.lines.push(raw)
    // `SET NAMES` is SQL: it belongs to the region it was written in, and only
    // the bytes *after* it are in the new charset. Hence the push above first.
    const named = SET_NAMES.exec(trimmed) ?? SET_CLIENT.exec(trimmed)
    if (named !== null) switchTo(named[1])
  }
  if (current.lines.length > 0) regions.push(current)

  if (regions.length === 0) {
    // Not a failure. Several files in the corpus are pure `--source` wrappers
    // that set a variable and include a shared body — `ctype_utf8mb4_heap.test`
    // is three directives long. There is nothing there to lex.
    return result('no-sql', 'no SQL lines outside directives')
  }

  const statements = []
  let skipped = 0

  for (const region of regions) {
    // A region in a charset this build will not decode faithfully. M2.18's
    // posture is to refuse rather than guess, and the refusal is *counted*
    // rather than quietly dropped — otherwise the census would report 100%
    // lexed over whatever it happened to be able to read.
    if (!region.readable) {
      unreadLines += region.lines.length
      unreadCharsets.add(region.charset)
      continue
    }

    // The charset-aware step, and the one M3.12 exists for: these bytes are
    // decoded in the charset they were written in, then lexed as characters.
    // That is `lexBytes` in two halves, split only so a decode failure can be
    // told apart from a lex failure.
    let sql
    try {
      sql = decodeStatement(joinLines(region.lines), region.collationId)
    } catch (e) {
      return result('undecodable', `${region.charset}: ${String(e.message).slice(0, 100)}`)
    }

    // A region that will not lex is reported rather than worked around: falling
    // back to a naive split would hide exactly the failure worth seeing.
    //
    // The error and the offending line come back with it. The first version
    // returned a bare flag, so a run that found eight broken files said only
    // "eight" — and the census promises the failing SQL is printed. A diagnostic
    // that reports a count and withholds the reason is the same mistake as a
    // gate that passes without checking.
    let tokens
    try {
      tokens = lex(sql)
    } catch (e) {
      const line = Number(/at line (\d+)/.exec(String(e.message))?.[1] ?? 0)
      const context = sql.split('\n')[line - 1]?.trim() ?? ''
      return result('lex-failed', `${region.charset} line ${line}: ${context.slice(0, 120)}`)
    }

    // Character offset of the first character of each line, so a statement's
    // starting line — and therefore the `--error` that preceded it — can be
    // found from its offset in the joined region.
    const lineStarts = [0]
    for (let i = 0; i < sql.length; i++) if (sql.charCodeAt(i) === 10) lineStarts.push(i + 1)
    const lineAt = (offset) => {
      let lo = 0
      let hi = lineStarts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= offset) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    let start = 0
    let held = []
    const emit = (from, to) => {
      const text = sql.slice(from, to).trim()
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
      // `from` sits just after the previous `;`, so it points at the whitespace
      // before this statement rather than at the statement. The `--error`
      // belongs to the line the *text* starts on.
      const textStart = from + (sql.slice(from, to).length - sql.slice(from, to).trimStart().length)
      const expected = region.errors[lineAt(textStart)]
      statements.push({
        text,
        keyword: keywordOf(held),
        charset: region.charset,
        ...(expected === undefined || expected === null ? {} : { expectedError: expected }),
      })
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
    emit(start, sql.length)
  }

  return result('ok', '', { statements, skipped, delimiter })
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
