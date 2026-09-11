// M3.1 — the token model.
//
// A `const` object plus a union rather than an `enum`: `tsconfig.base.json` sets
// `erasableSyntaxOnly`, so a TypeScript `enum` will not compile in this repo.
// `packages/protocol/src/constants/` uses the same shape for the same reason.

/** What a token is. */
export const TOKEN = {
  /** A bare word, or one in backticks (or double quotes under `ANSI_QUOTES`). */
  IDENTIFIER: 'identifier',
  /** A string literal, escapes already resolved. */
  STRING: 'string',
  /** An integer, decimal or float literal. */
  NUMBER: 'number',
  /** `x'4A'` or `0x4A`. */
  HEX: 'hex',
  /** `b'101'` or `0b101`. */
  BIT: 'bit',
  /** `@name`, `@@global.name`, `@@name`. */
  VARIABLE: 'variable',
  /** `?`, in the order it appeared. */
  PLACEHOLDER: 'placeholder',
  /** Punctuation and operators, one to three characters. */
  OPERATOR: 'operator',
  /** End of input. Always the last token, so a parser never indexes past the end. */
  EOF: 'eof',
} as const

export type TokenKind = (typeof TOKEN)[keyof typeof TOKEN]

export interface Token {
  readonly kind: TokenKind
  /**
   * The token as written, with quotes stripped from an identifier and escapes
   * resolved in a string. For an operator, the operator itself.
   */
  readonly text: string
  /**
   * Where the token starts, as a **character** offset into the decoded
   * statement — not a byte offset into the packet.
   *
   * Characters, because that is what is well defined after the statement has
   * been decoded in its session charset, and because the one consumer of a
   * position is M3.9's `near '…' at line N`, which needs a line number and a
   * substring rather than a byte address. A caller that genuinely needs the
   * byte offset has both the original bytes and the decoded text and can map
   * between them; building that map here, for every token, to serve nothing,
   * would be cost without a consumer.
   */
  readonly start: number
  /** One past the last character of the token. */
  readonly end: number
  /** 1-based, counting `\n` in the decoded statement. What MySQL reports. */
  readonly line: number
  /** Set on an identifier that was written in quotes, which cannot be a keyword. */
  readonly quoted?: boolean
  /** 0-based order of a `?` among the placeholders in the statement. */
  readonly index?: number
}

/**
 * Operators, longest first.
 *
 * Order is load-bearing: `<=>` must be tried before `<=`, which must be tried
 * before `<`. Getting that backwards turns MySQL's null-safe equality into a
 * less-than followed by a stray `>`, which then parses as something else
 * entirely rather than failing.
 */
export const OPERATORS: readonly string[] = [
  '<=>',
  '->>',
  '<<',
  '>>',
  '<=',
  '>=',
  '<>',
  '!=',
  ':=',
  '&&',
  '||',
  '->',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
  '~',
  '^',
  '&',
  '|',
  '(',
  ')',
  ',',
  ';',
  '.',
  '{',
  '}',
]
