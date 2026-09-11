// Types for `mysqltest-extract.mjs`, hand-written for the same reason
// `binlog-hexdump.d.mts` is: the tools are plain ESM JavaScript and only the
// ones a TypeScript test drives need declarations. Turning `allowJs` on for the
// whole repo to type two modules would put every generator in the program.

/** One SQL statement lifted out of a `.test` file. */
export interface Statement {
  /** The statement's text, decoded in its own charset and trimmed. */
  readonly text: string
  /** Its leading keyword, upper-cased, or `(other)`. */
  readonly keyword: string
  /** The charset the statement's bytes were written in. */
  readonly charset: string
}

/**
 * Why a file was or was not measured.
 *
 * `no-sql` is a fact about the file rather than a defect: a `.test` that is
 * nothing but `--source` directives has no SQL to lex. `undecodable` means every
 * region of it is in a charset this build refuses to guess at. Only `lex-failed`
 * is a bug in the lexer.
 */
export type Outcome = 'ok' | 'no-sql' | 'undecodable' | 'lex-failed'

/** Why a charset switch the file asked for did not happen. */
export type RefusalReason = 'prohibited' | 'not-a-charset'

export interface Extraction {
  readonly statements: readonly Statement[]
  /** Lines dropped as mysqltest directives, comments or heredoc bodies. */
  readonly directives: number
  /** Statements skipped because they contain a `$variable` substitution. */
  readonly skipped: number
  readonly outcome: Outcome
  /** Human-readable detail for a non-`ok` outcome; empty otherwise. */
  readonly detail: string
  /** Every charset the file's bytes were read in, in the order first seen. */
  readonly charsets: readonly string[]
  /** Counts of switches a real server would have refused, by reason. */
  readonly refused: Readonly<Partial<Record<RefusalReason, number>>>
  /** Lines in a charset this build will not decode faithfully — coverage lost. */
  readonly unreadLines: number
  readonly unreadCharsets: readonly string[]
  readonly delimiter?: string
}

/** Bracket and backtick state carried across a directive's continuation lines. */
export interface OpenState {
  depth: number
  tick: boolean
}

/** A resolved charset, or the reason the switch to it must not happen. */
export type Resolution =
  | { readonly charset: string; readonly collationId: number; readonly readable: boolean }
  | { readonly reason: RefusalReason }

export function advance(line: string, state: OpenState): boolean

export function resolveCharset(name: string): Resolution

export function extract(bytes: Uint8Array): Extraction

export function keywordOf(tokens: readonly { kind: string; text: string; quoted?: boolean }[]): string
