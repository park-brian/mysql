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
export { ParseError, parseError, unknownCharset, badMode, tooDeep, unsupportedStatement } from './errors.ts'
export { DEFAULT_SQL_MODE, NO_SQL_MODE, formatSqlMode, parseSqlMode } from './sql-mode.ts'
export type { SqlMode } from './sql-mode.ts'
export { TOKEN, OPERATORS } from './tokens.ts'
export type { Token, TokenKind } from './tokens.ts'
export { decodeStatement, lex, lexBytes } from './lexer.ts'
export { NODE, LITERAL } from './ast.ts'
export type {
  BinaryNode,
  CallNode,
  CaseNode,
  CastNode,
  CollateNode,
  ConvertNode,
  KeywordNode,
  MatchNode,
  SubqueryNode,
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
export { Cursor } from './cursor.ts'
export { atDataType, parseDataType } from './data-type.ts'
export type { DataType } from './data-type.ts'
export { parseCreateTable, parseCreateView, parseDrop } from './ddl.ts'
export { parseDelete, parseInsert, parseUpdate } from './dml.ts'
export type { DdlOptions } from './ddl.ts'
export { parseStatement, parseStatementBytes, parseStatements } from './statement.ts'
export { deparse, quoteName } from './deparse.ts'
export type { DeparseOptions } from './deparse.ts'
export type { ParseStatementOptions } from './statement.ts'
export { DROP_OBJECT, KEY, STATEMENT } from './statement-ast.ts'
export { QUERY, REF } from './query-ast.ts'
export type {
  CommonTable,
  DerivedTableNode,
  FrameBound,
  GroupBy,
  IndexHint,
  Into,
  JoinNode,
  Limit,
  Locking,
  OrderItem,
  QueryBody,
  QueryExpression,
  SelectItem,
  SelectNode,
  SetOperationNode,
  TableListNode,
  TableRefNode,
  TableReference,
  TableStatementNode,
  ValuesNode,
  WindowSpec,
  With,
} from './query-ast.ts'
export type {
  CheckConstraint,
  ColumnDefinition,
  CreateTableNode,
  Assignment,
  CreateViewNode,
  Definer,
  DeleteNode,
  DropNode,
  InsertNode,
  UpdateNode,
  DropObject,
  IndexColumn,
  KeyDefinition,
  KeyType,
  Reference,
  Statement,
  StatementKind,
  TableName,
  AccessMode,
  CallStatementNode,
  CreateEventNode,
  CreateRoutineNode,
  CreateTriggerNode,
  EventSchedule,
  RoutineBody,
  RoutineParameter,
  AlterAction,
  AlterTableNode,
  ColumnPosition,
  CreateDatabaseNode,
  PartitionDefinition,
  PartitionMethod,
  Partitioning,
  CommitNode,
  DeallocateNode,
  DescribeNode,
  DoNode,
  ExecuteNode,
  ExplainableStatement,
  ExplainNode,
  IsolationLevel,
  PrepareNode,
  RollbackNode,
  SavepointNode,
  SetItem,
  SetNode,
  SetTransactionNode,
  ShowNode,
  StartTransactionNode,
  UseNode,
  VariableScope,
} from './statement-ast.ts'
export type { LexOptions } from './lexer.ts'
