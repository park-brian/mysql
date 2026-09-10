// Types for `mysqltest-extract.mjs`, hand-written for the same reason
// `binlog-hexdump.d.mts` is: the tools are plain ESM JavaScript and only the
// ones a TypeScript test drives need declarations. Turning `allowJs` on for the
// whole repo to type two modules would put every generator in the program.

/** One SQL statement lifted out of a `.test` file. */
export interface Statement {
  /** The statement's text, trimmed, without its terminating `;`. */
  readonly text: string
  /** Its leading keyword, upper-cased, or `(other)`. */
  readonly keyword: string
}

/**
 * Why a file was or was not measured.
 *
 * `no-sql` and `not-utf8` are facts about the file rather than defects:
 * a `.test` that is nothing but `--source` directives has no SQL to lex, and
 * `ctype_sjis.test` is deliberately not UTF-8. Only `lex-failed` is a bug.
 */
export type Outcome = 'ok' | 'no-sql' | 'not-utf8' | 'lex-failed'

export interface Extraction {
  readonly statements: readonly Statement[]
  /** Lines dropped as mysqltest directives, comments or heredoc bodies. */
  readonly directives: number
  /** Statements skipped because they contain a `$variable` substitution. */
  readonly skipped: number
  readonly outcome: Outcome
  /** Human-readable detail for a non-`ok` outcome; empty otherwise. */
  readonly detail: string
  readonly delimiter?: string
}

/** Bracket and backtick state carried across a directive's continuation lines. */
export interface OpenState {
  depth: number
  tick: boolean
}

export function advance(line: string, state: OpenState): boolean

export function extract(text: string): Extraction

export function keywordOf(tokens: readonly { kind: string; text: string; quoted?: boolean }[]): string
