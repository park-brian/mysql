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
  multiStatementsDisabled: (): string =>
    "Multiple statements are disabled; enable them with the engine's multipleStatements option",
  unsupportedCharset: (id: number): string =>
    `Character set id ${id} is not supported for the connection character set`,
  connectAttrsTooLarge: (limit: number): string =>
    `Connection attributes exceed the ${limit}-byte limit`,
} as const
