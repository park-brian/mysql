// @myjs/parser — MySQL SQL text in, tokens and (from M3.2) an AST out.
//
// Two things this package does that a naive lexer does not, both because doc 29
// says so and both proven by test rather than asserted:
//
//   - it reads the statement in the **session's charset**, so a `gbk` lead byte
//     cannot smuggle a backslash past a string literal (M3.1);
//   - it takes `sql_mode` as a parameter, so the same text lexes differently
//     under `ANSI_QUOTES` (M3.7).
//
// It depends on `@myjs/bytes`, `@myjs/charsets` and `@myjs/types` — never on
// `@myjs/protocol`, which sits above it.
export { ParseError, parseError, unknownCharset, badMode } from './errors.ts'
export { DEFAULT_SQL_MODE, NO_SQL_MODE, parseSqlMode } from './sql-mode.ts'
export type { SqlMode } from './sql-mode.ts'
export { TOKEN, OPERATORS } from './tokens.ts'
export type { Token, TokenKind } from './tokens.ts'
export { decodeStatement, lex, lexBytes } from './lexer.ts'
export { NODE, LITERAL } from './ast.ts'
export type {
  BinaryNode,
  CallNode,
  CaseNode,
  ColumnNode,
  Expression,
  IntervalNode,
  LiteralNode,
  LiteralType,
  NodeKind,
  PlaceholderNode,
  RowNode,
  UnaryNode,
  VariableNode,
} from './ast.ts'
export { parseExpression } from './expression.ts'
export type { ParseExpressionOptions } from './expression.ts'
export type { LexOptions } from './lexer.ts'
