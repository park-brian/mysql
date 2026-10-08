// D-29 — message text.
//
// The generated table (M1.6) carries error numbers, symbols and SQLSTATEs:
// facts, and the part D-14 insists must not be transcribed by hand. The
// English message *templates* in MySQL's source are expression rather than
// fact, and ground rule 7 keeps GPLv2 text out of this MIT repository — so the
// strings a client sees from us are written here.
//
// They are deliberately close in shape to what a client expects (an ORM that
// regex-matches a message is doing something unwise, but it exists), and they
// carry the same substitutions MySQL's do.

export const messages = {
  accessDenied: (user: string, host: string): string =>
    // M1.15 / D-11: identical for an unknown user and a wrong password.
    `Access denied for user '${user}'@'${host}' (using password: YES)`,
  unknownCommand: (): string => 'Unknown command',
  packetsOutOfOrder: (expected: number, got: number): string =>
    `Got packets out of order (expected sequence ${expected}, got ${got})`,
  packetTooLarge: (limit: number): string =>
    `Got a packet bigger than 'max_allowed_packet' bytes (limit ${limit})`,
  malformedPacket: (what: string): string => `Malformed communication packet: ${what}`,
  unknownDatabase: (db: string): string => `Unknown database '${db}'`,
  noDatabaseSelected: (): string => 'No database selected',
  parseError: (near: string, line: number): string =>
    `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${near}' at line ${line}`,
  unknownStatementHandler: (what: string): string =>
    `Unknown prepared statement handler (${what}) given to mysqld_stmt_execute`,
  maxPreparedStmtCount: (limit: number): string =>
    `Can't create more than max_prepared_stmt_count statements (current value: ${limit})`,
  notSupported: (what: string): string => `${what} is not supported by this server yet`,
  // M5 — what the executor reports. MySQL's own names for the clauses
  // (`'field list'`, `'where clause'`) are kept, since clients and tests
  // match on them.
  unknownColumn: (column: string, clause: string): string => `Unknown column '${column}' in '${clause}'`,
  ambiguousColumn: (column: string, clause: string): string => `Column '${column}' in ${clause} is ambiguous`,
  unknownCollation: (name: string): string => `Unknown collation: '${name}'`,
  duplicateEntry: (value: string, key: string): string => `Duplicate entry '${value}' for key '${key}'`,
  noSuchTable: (schema: string, table: string): string => `Table '${schema}.${table}' doesn't exist`,
  wrongValueCount: (row: number): string => `Column count doesn't match value count at row ${row}`,
  noDefaultForField: (column: string): string => `Field '${column}' doesn't have a default value`,
  lockWaitTimeout: (): string => 'Lock wait timeout exceeded; try restarting transaction',
  nonUniqueTable: (alias: string): string => `Not unique table/alias: '${alias}'`,
  objectExists: (kind: string, name: string): string => `${kind} ${name} already exists`,
  objectMissing: (kind: string, name: string): string => `${kind} ${name} does not exist`,
  multiStatementsDisabled: (): string =>
    "Multiple statements are disabled; enable them with the engine's multipleStatements option",
  unsupportedCharset: (id: number): string =>
    `Character set id ${id} is not supported for the connection character set`,
  noTranscoder: (id: number): string =>
    `Character set id ${id} needs a transcoder; supply one from @myjs/charsets (D-33)`,
  connectAttrsTooLarge: (limit: number): string =>
    `Connection attributes exceed the ${limit}-byte limit`,
} as const
