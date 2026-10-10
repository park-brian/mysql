// myjs — doc 42's surface, and nothing else.
//
// The packages under `@myjs/*` export what their neighbours need: the
// executor, the transcoder, the protocol's parts. An application needs the
// `MySQL` class, the connection and transaction it hands out, their errors
// and their types. This package re-exports exactly those, so what 1.0
// freezes is this file, not every export of `@myjs/core` (D-79).
export { MySQL, Connection, Transaction, QueryError, RowStream } from '@myjs/core'
export type {
  BeginOptions,
  ColumnInfo,
  ConnectionConfig,
  DatabaseStats,
  DriverStream,
  FieldInfo,
  IsolationLevel,
  MySQLOptions,
  QueryOptions,
  QueryResult,
  ResultSetHeader,
  TableInfo,
  TransactionOptions,
  TypeOptions,
} from '@myjs/core'
