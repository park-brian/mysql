// M3.9 — the parser's typed errors.
//
// Ground rule 5: a malformed input produces a typed error, never a crash, never
// a hang, never an out-of-bounds read. That is the fuzzing invariant (M3.10)
// and it is what makes an untrusted `COM_QUERY` safe to hand to this package.
//
// The errnos are written out here rather than looked up. `@myjs/types` does the
// same and for the same reason: resolving a symbol to a number lives in
// `@myjs/protocol`'s generated table, and neither this package nor that one may
// depend on it (doc 03 gives the parser no dependency on the protocol, and
// D-33's edge runs the other way). The numbers are format facts, they are
// asserted against the generated table by a test, and the alternative — a
// dependency inversion for four integers — is worse.
//
// The *message* is ours (D-29): the generated table carries error numbers,
// symbols and SQLSTATEs, never MySQL's English text, because that text is
// GPLv2 and this project is MIT.
import { MyjsError } from '@myjs/bytes'

/** Anything this package refuses. Carries `errno` and `sqlState` like `SqlError`. */
export class ParseError extends MyjsError {
  /** Byte offset into the original statement, when one is known. */
  readonly offset: number | undefined

  constructor(
    symbol: string,
    message: string,
    options: { errno: number; sqlState: string; offset?: number },
  ) {
    super(symbol, message, { errno: options.errno, sqlState: options.sqlState })
    this.offset = options.offset
  }
}

/**
 * `ER_PARSE_ERROR` — 1064 / 42000.
 *
 * MySQL's shape is `... near '<the rest of the statement>' at line N`, and the
 * `near` text is a *suffix*: everything from the offending token to the end,
 * truncated. Clients and tests match on it, so the shape is part of the
 * compatibility surface rather than cosmetic.
 */
export function parseError(near: string, line: number, offset?: number): ParseError {
  return new ParseError(
    'ER_PARSE_ERROR',
    `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${near}' at line ${line}`,
    { errno: 1064, sqlState: '42000', ...(offset === undefined ? {} : { offset }) },
  )
}

/**
 * A charset this runtime cannot decode faithfully.
 *
 * Refusing is the whole point. A lexer that guessed would be reading different
 * SQL from the one the client sent, which is the failure M2.18's transcoder and
 * M2.23's sort key both refuse for the same reason — and here it is reachable
 * from an untrusted `COM_QUERY`. `ER_UNKNOWN_CHARACTER_SET` is 1115 / 42000.
 */
export function unknownCharset(charset: string): ParseError {
  return new ParseError('ER_UNKNOWN_CHARACTER_SET', `Unknown character set: '${charset}'`, {
    errno: 1115,
    sqlState: '42000',
  })
}

/**
 * A `sql_mode` value that is not a mode name.
 *
 * `ER_WRONG_VALUE_FOR_VAR` is 1231 / 42000 — the same error a real server gives
 * for `SET sql_mode = 'nonsense!'`.
 */
export function badMode(value: string): ParseError {
  return new ParseError('ER_WRONG_VALUE_FOR_VAR', `Variable 'sql_mode' can't be set to the value of '${value}'`, {
    errno: 1231,
    sqlState: '42000',
  })
}
