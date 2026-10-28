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
import { utf8ErrorLabel } from '@myjs/charsets'

/** Grammar conditions, independent of the executor's diagnostic area. */
export interface ParseCondition {
  readonly errno: number
  readonly message: string
  /** Errors keep their existing two-field representation. */
  readonly level?: 'Warning'
}

/** 3720: national character types, shared with execution of valid ASTs. */
export const NATIONAL_DEPRECATION =
  'NATIONAL/NCHAR/NVARCHAR implies the character set UTF8MB3, which will be replaced by UTF8MB4 in a future release. Please consider using CHAR(x) CHARACTER SET UTF8MB4 in order to be unambiguous.'

/** 1287 text shared by grammar failures and execution of valid ASTs. */
export const BINARY_DEPRECATION = "'BINARY as attribute of a type' is deprecated and will be removed in a future release. Please use a CHARACTER SET clause with _bin collation instead"

/** Anything this package refuses. Carries `errno` and `sqlState` like `SqlError`. */
export class ParseError extends MyjsError {
  /** Nonenumerable history when grammar conditions precede or follow the primary error. */
  declare readonly conditions?: readonly ParseCondition[]
  /** UTF-16 code-unit offset into the original statement, when one is known. */
  readonly offset: number | undefined

  constructor(
    symbol: string,
    message: string,
    options: { errno: number; sqlState: string; offset?: number | undefined },
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
    { errno: 1064, sqlState: '42000', offset },
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

/** A repeated WITH name; native formatting clips 192 UTF-8 bytes, replacing partial bytes. */
export function duplicateTable(name: string): ParseError {
  return new ParseError('ER_NONUNIQ_TABLE', `Not unique table/alias: '${utf8ErrorLabel(name, 192)}'`, {
    errno: 1066,
    sqlState: '42000',
  })
}

/** An unresolved COLLATE name is refused when its grammar production completes. */
export function unknownCollation(name: string): ParseError {
  const label = name.split('\0', 1)[0]!.replace(/[\u{10000}-\u{10FFFF}]/gu, '?')
  return new ParseError('ER_UNKNOWN_COLLATION', `Unknown collation: '${utf8ErrorLabel(label, 64)}'`, {
    errno: 1273,
    sqlState: 'HY000',
  })
}

/** A DOUBLE literal's overflow precedes resolution and retains its original spelling. */
export function illegalDouble(text: string): ParseError {
  return new ParseError('ER_ILLEGAL_VALUE_FOR_TYPE', `Illegal double '${utf8ErrorLabel(text, 192)}' value found during parsing`, {
    errno: 1367,
    sqlState: '22007',
  })
}

/** 1426: a completed temporal CAST exceeds its fractional precision limit. */
export function castPrecisionError(precision: number): ParseError {
  return new ParseError('ER_TOO_BIG_PRECISION', `Too-big precision ${precision} specified for 'CAST'. Maximum is 6.`, {
    errno: 1426,
    sqlState: '42000',
  })
}

/**
 * An expression nested deeper than this parser will recurse.
 *
 * Not a nicety: without it, `'('.repeat(1000) + '1' + ')'.repeat(1000)` blows
 * the JavaScript stack and throws a `RangeError`, which is a crash from
 * ordinary input reachable by anyone who can send a query. Ground rule 5 says a
 * malformed input produces a typed error, and a `RangeError` is not one.
 *
 * `ER_STACK_OVERRUN_NEED_MORE` is 1436 / HY000, which is what a real MySQL
 * raises when its own parser runs out of thread stack — the same condition,
 * reported the same way.
 */
export function tooDeep(limit: number): ParseError {
  return new ParseError(
    'ER_STACK_OVERRUN_NEED_MORE',
    `Thread stack overrun: expression nested more than ${limit} levels deep`,
    { errno: 1436, sqlState: 'HY000' },
  )
}

/**
 * A statement this parser does not implement **yet**.
 *
 * Distinct from `ER_PARSE_ERROR` on purpose, and the distinction is not
 * cosmetic. `SELECT 1` is valid SQL; telling a client its syntax is wrong would
 * be a lie, and telling M3.11's census that the statement failed to parse would
 * make the exit criterion's number mean "what M3.5 happens to cover" rather
 * than "what parses". A refusal that names the missing feature keeps both
 * honest.
 *
 * `ER_NOT_SUPPORTED_YET` is 1235 / 42000, the same error a real MySQL raises
 * for a statement its parser accepts and its executor does not.
 */
export function unsupportedStatement(what: string): ParseError {
  return new ParseError('ER_NOT_SUPPORTED_YET', `This version of myjs doesn't yet support '${what}'`, {
    errno: 1235,
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
