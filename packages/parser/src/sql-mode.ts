// M3.7 — `sql_mode`, as flags the lexer and parser can branch on.
//
// `sql_mode` is a comma-separated string on the session and, until now, nothing
// in this codebase read it: `Session.sqlMode` was set, snapshotted for
// `COM_RESET_CONNECTION`, reported by `SELECT @@sql_mode`, and never consulted.
// That is fine while a stub answers every query and impossible once a parser
// exists, because two of these modes change what a given string *means*.
//
// The roadmap's clause for this item is "the same text parses differently under
// `ANSI_QUOTES`, proven by test", which is why the flags are threaded as a
// parameter from the first commit rather than read from a global later. A
// parser that acquires `sql_mode` awareness afterwards gets rewritten.
import { badMode } from './errors.ts'

/**
 * The modes that change how SQL is *read*.
 *
 * Deliberately not all of them. MySQL 8.0 has around twenty, and most —
 * `STRICT_TRANS_TABLES`, `NO_ZERO_DATE`, `ONLY_FULL_GROUP_BY` — change what a
 * statement *does*, which is M5's problem. These six change what it *is*, so
 * they belong to the parser and nothing else can decide them.
 */
export interface SqlMode {
  /** `"` is an identifier quote, not a string quote. */
  readonly ansiQuotes: boolean
  /** `\` is an ordinary character inside a string literal. */
  readonly noBackslashEscapes: boolean
  /** `||` is string concatenation rather than logical OR. */
  readonly pipesAsConcat: boolean
  /** `NOT` binds tighter, as it did before 5.0 — `NOT a BETWEEN b AND c` regroups. */
  readonly highNotPrecedence: boolean
  /** A space is allowed between a function name and its `(`, making names reserved. */
  readonly ignoreSpace: boolean
  /** `REAL` is a synonym for `FLOAT` rather than for `DOUBLE`. */
  readonly realAsFloat: boolean
  /** Every mode named, including the ones above and the ones this package ignores. */
  readonly names: ReadonlySet<string>
}

/**
 * The two combination modes, expanded.
 *
 * MySQL treats these as shorthand and stores the expansion, so
 * `SET sql_mode='ANSI'` then `SELECT @@sql_mode` reports the five it stands
 * for. Expanding them here means `ANSI` turns on `ANSI_QUOTES` — which it must,
 * and which a naive `split(',').includes('ANSI_QUOTES')` would miss.
 *
 * `TRADITIONAL` expands to strictness modes only, none of which this package
 * reads; it is listed anyway so `names` is faithful and a later consumer of
 * `names` does not have to redo the expansion.
 */
const COMBINATION_MODES: Readonly<Record<string, readonly string[]>> = {
  ANSI: ['REAL_AS_FLOAT', 'PIPES_AS_CONCAT', 'ANSI_QUOTES', 'IGNORE_SPACE', 'ONLY_FULL_GROUP_BY'],
  TRADITIONAL: [
    'STRICT_TRANS_TABLES',
    'STRICT_ALL_TABLES',
    'NO_ZERO_IN_DATE',
    'NO_ZERO_DATE',
    'ERROR_FOR_DIVISION_BY_ZERO',
    'NO_ENGINE_SUBSTITUTION',
  ],
}

/** MySQL 8.0's default, and this package's when a session names nothing. */
export const DEFAULT_SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'

/**
 * Parse a `sql_mode` string.
 *
 * Case-insensitive and whitespace-tolerant, as MySQL is. An empty string is
 * legal and means no modes at all — that is `sql_mode=''`, not an error.
 *
 * A mode name that is not a valid identifier shape is refused rather than
 * ignored: `sql_mode` reaches this from `SET sql_mode = <user string>`, and
 * silently dropping a mode the user asked for is how a session ends up parsing
 * differently from what its own `@@sql_mode` reports.
 */
export function parseSqlMode(text: string): SqlMode {
  const names = new Set<string>()
  for (const raw of text.split(',')) {
    const name = raw.trim().toUpperCase()
    if (name === '') continue
    if (!/^[A-Z0-9_]+$/.test(name)) throw badMode(raw.trim())
    names.add(name)
    for (const expanded of COMBINATION_MODES[name] ?? []) names.add(expanded)
  }
  return {
    ansiQuotes: names.has('ANSI_QUOTES'),
    noBackslashEscapes: names.has('NO_BACKSLASH_ESCAPES'),
    pipesAsConcat: names.has('PIPES_AS_CONCAT'),
    highNotPrecedence: names.has('HIGH_NOT_PRECEDENCE'),
    ignoreSpace: names.has('IGNORE_SPACE'),
    realAsFloat: names.has('REAL_AS_FLOAT'),
    names,
  }
}

/** No modes at all — `sql_mode=''`. Useful as a test baseline. */
export const NO_SQL_MODE: SqlMode = parseSqlMode('')
