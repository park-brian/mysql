// M1.16 — `enum_server_command` from `include/my_command.h`; the table and the
// "what we do" column are from docs/14-command-phase.md.
export const COM = {
  SLEEP: 0x00, // internal, never on the wire
  QUIT: 0x01,
  INIT_DB: 0x02,
  QUERY: 0x03,
  FIELD_LIST: 0x04, // deprecated; some old tools still use it
  CREATE_DB: 0x05, // refused by MySQL
  DROP_DB: 0x06, // refused by MySQL
  REFRESH: 0x07, // removed
  SHUTDOWN: 0x08, // removed (use the SHUTDOWN statement)
  STATISTICS: 0x09,
  PROCESS_INFO: 0x0a, // removed
  CONNECT: 0x0b, // internal
  PROCESS_KILL: 0x0c, // removed (use KILL)
  DEBUG: 0x0d,
  PING: 0x0e,
  TIME: 0x0f, // refused
  DELAYED_INSERT: 0x10, // removed
  CHANGE_USER: 0x11,
  BINLOG_DUMP: 0x12, // replication (doc 18)
  TABLE_DUMP: 0x13, // legacy replication
  CONNECT_OUT: 0x14, // internal
  REGISTER_SLAVE: 0x15, // replication
  STMT_PREPARE: 0x16,
  STMT_EXECUTE: 0x17,
  STMT_SEND_LONG_DATA: 0x18, // no response packet, ever
  STMT_CLOSE: 0x19, // no response packet, ever
  STMT_RESET: 0x1a,
  SET_OPTION: 0x1b, // responds EOF-shaped, not OK
  STMT_FETCH: 0x1c,
  DAEMON: 0x1d, // removed
  BINLOG_DUMP_GTID: 0x1e, // replication (doc 18)
  RESET_CONNECTION: 0x1f,
  CLONE: 0x20, // out of scope
  SUBSCRIBE_GROUP_REPLICATION_STREAM: 0x21, // out of scope
} as const

const COMMAND_NAMES = new Map<number, string>(
  Object.entries(COM).map(([name, code]) => [code, `COM_${name}`]),
)

export function commandName(code: number): string {
  return COMMAND_NAMES.get(code) ?? `COM_UNKNOWN(0x${code.toString(16).padStart(2, '0')})`
}

/**
 * The three commands to which the server writes **nothing at all** — not even
 * on error (doc 14). A helpful OK here desynchronises every client, so this
 * set is consulted by the dispatcher rather than remembered by each handler.
 */
export const NO_RESPONSE_COMMANDS: ReadonlySet<number> = new Set([
  COM.QUIT,
  COM.STMT_CLOSE,
  COM.STMT_SEND_LONG_DATA,
])

/** `COM_SET_OPTION` argument (doc 14): 0 *enables* multi-statements, 1 disables. */
export const SET_OPTION = {
  MULTI_STATEMENTS_ON: 0,
  MULTI_STATEMENTS_OFF: 1,
} as const

/** `enum_cursor_type` (doc 16). */
export const CURSOR_TYPE = {
  NO_CURSOR: 0x00,
  READ_ONLY: 0x01,
  FOR_UPDATE: 0x02,
  SCROLLABLE: 0x04,
  /** With `CLIENT_QUERY_ATTRIBUTES`, says a parameter count follows. */
  PARAMETER_COUNT_AVAILABLE: 0x08,
} as const

/** `max_prepared_stmt_count`'s default (doc 16). */
export const MAX_PREPARED_STMT_COUNT = 16382

/**
 * `max_allowed_packet` (doc 17). MySQL's default is 64 MiB.
 *
 * D-31: for us this is primarily a memory-safety control on unauthenticated
 * input, so it is enforced *during* reassembly rather than after.
 */
export const DEFAULT_MAX_ALLOWED_PACKET = 64 * 1024 * 1024
