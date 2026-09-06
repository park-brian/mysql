// M1.3 — capability flags.
//
// Constants from `include/mysql_com.h` (ground rule 4: every format constant
// cites the header it came from, so it can be re-verified against a newer
// tree). Layout and commentary from docs/12-connection-phase.md.
//
// D-01 forbids `enum`, so these are `const` objects. That is not a workaround:
// the negotiated set has to be an ordinary number anyway, because it is a
// bitwise AND of two peers' claims.

export const CLIENT = {
  /** Historic. MariaDB overloads its *absence*: it leaves this clear and repurposes 4 reserved handshake bytes. D-10 says set it. */
  LONG_PASSWORD: 0x00000001,
  /** `affected_rows` reports matched rather than changed rows. */
  FOUND_ROWS: 0x00000002,
  /** Send all column flags. */
  LONG_FLAG: 0x00000004,
  /** Initial schema in the handshake response. */
  CONNECT_WITH_DB: 0x00000008,
  NO_SCHEMA: 0x00000010,
  /** zlib compression (doc 17). D-12: never advertised in-process. */
  COMPRESS: 0x00000020,
  ODBC: 0x00000040,
  /** Permit `LOAD DATA LOCAL INFILE` (doc 17). */
  LOCAL_FILES: 0x00000080,
  /** Allow space before `(` in function calls. */
  IGNORE_SPACE: 0x00000100,
  /** Always set in practice; gates most packet layouts. */
  PROTOCOL_41: 0x00000200,
  INTERACTIVE: 0x00000400,
  /** Upgrade to TLS. D-12: never advertised in-process. */
  SSL: 0x00000800,
  IGNORE_SIGPIPE: 0x00001000,
  /** Status flags in OK/EOF. */
  TRANSACTIONS: 0x00002000,
  RESERVED: 0x00004000,
  /** Was `CLIENT_SECURE_CONNECTION`; removed in 8.0 but still set by clients. */
  RESERVED2: 0x00008000,
  /** `;`-separated statements in one `COM_QUERY`. D-13 gates this behind an engine switch defaulting off. */
  MULTI_STATEMENTS: 0x00010000,
  MULTI_RESULTS: 0x00020000,
  PS_MULTI_RESULTS: 0x00040000,
  /** Pluggable authentication — required for `caching_sha2_password`. */
  PLUGIN_AUTH: 0x00080000,
  CONNECT_ATTRS: 0x00100000,
  /** Auth response is length-encoded rather than `int<1>`-prefixed. Needed for an RSA-encrypted password. */
  PLUGIN_AUTH_LENENC_CLIENT_DATA: 0x00200000,
  CAN_HANDLE_EXPIRED_PASSWORDS: 0x00400000,
  /** Session state changes in OK packets (doc 17). */
  SESSION_TRACK: 0x00800000,
  /** OK packets replace EOF packets; changes resultset parsing in both directions. */
  DEPRECATE_EOF: 0x01000000,
  OPTIONAL_RESULTSET_METADATA: 0x02000000,
  /** D-12: never. */
  ZSTD_COMPRESSION_ALGORITHM: 0x04000000,
  /** Named attributes on `COM_QUERY`/`COM_STMT_EXECUTE` (8.0.23+). */
  QUERY_ATTRIBUTES: 0x08000000,
  MULTI_FACTOR_AUTHENTICATION: 0x10000000,
  CAPABILITY_EXTENSION: 0x20000000,
  SSL_VERIFY_SERVER_CERT: 0x40000000,
  REMEMBER_OPTIONS: 0x80000000,
} as const

export type CapabilityName = keyof typeof CLIENT

/**
 * A negotiated capability set: `client_caps & server_caps`, computed once at
 * the end of the connection phase and passed to every reader and writer.
 *
 * Doc 10's implementation note 1: "Model the negotiated capabilities as an
 * immutable value ... Do not consult mutable connection state." The branded
 * type is what stops a raw client-claimed number being used by mistake.
 */
export type Capabilities = number & { readonly __brand: 'Capabilities' }

export function capabilities(bits: number): Capabilities {
  return (bits >>> 0) as Capabilities
}

/** The intersection — the whole of MySQL's negotiation rule. */
export function negotiate(clientClaims: number, serverOffers: number): Capabilities {
  return capabilities(clientClaims & serverOffers)
}

export function hasCap(caps: Capabilities, flag: number): boolean {
  return (caps & flag) !== 0
}

export function capabilityNames(caps: number): CapabilityName[] {
  return (Object.keys(CLIENT) as CapabilityName[]).filter((k) => (caps & CLIENT[k]) !== 0)
}

/**
 * What we advertise. Doc 12 lists this set verbatim.
 *
 * `CLIENT_SSL` and `CLIENT_COMPRESS` are deliberately absent (D-12: it costs
 * CPU to compress a memcpy, and in-process there is no channel to secure). The
 * TCP listener adds `CLIENT_SSL` when TLS is configured, which is why the
 * advertised set is a listener parameter rather than a module constant.
 */
export const SERVER_ADVERTISED_CAPABILITIES: Capabilities = capabilities(
  CLIENT.PROTOCOL_41 |
    CLIENT.LONG_PASSWORD |
    CLIENT.LONG_FLAG |
    CLIENT.CONNECT_WITH_DB |
    CLIENT.TRANSACTIONS |
    CLIENT.RESERVED2 |
    CLIENT.PLUGIN_AUTH |
    CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA |
    CLIENT.CONNECT_ATTRS |
    CLIENT.SESSION_TRACK |
    CLIENT.DEPRECATE_EOF |
    CLIENT.MULTI_STATEMENTS |
    CLIENT.MULTI_RESULTS |
    CLIENT.PS_MULTI_RESULTS |
    CLIENT.QUERY_ATTRIBUTES |
    CLIENT.LOCAL_FILES |
    CLIENT.FOUND_ROWS |
    CLIENT.OPTIONAL_RESULTSET_METADATA,
)

/** `SERVER_STATUS_*` from `include/mysql_com.h`; table from doc 10. */
export const SERVER_STATUS = {
  IN_TRANS: 0x0001,
  AUTOCOMMIT: 0x0002,
  /** Another resultset follows — set on every terminator but the last. */
  MORE_RESULTS_EXISTS: 0x0008,
  QUERY_NO_GOOD_INDEX_USED: 0x0010,
  QUERY_NO_INDEX_USED: 0x0020,
  /** A read-only cursor was opened; the terminator carries no rows. */
  CURSOR_EXISTS: 0x0040,
  /** Cursor exhausted. */
  LAST_ROW_SENT: 0x0080,
  DB_DROPPED: 0x0100,
  NO_BACKSLASH_ESCAPES: 0x0200,
  /** A re-prepared statement changed shape. */
  METADATA_CHANGED: 0x0400,
  QUERY_WAS_SLOW: 0x0800,
  /** This resultset carries OUT parameters. */
  PS_OUT_PARAMS: 0x1000,
  IN_TRANS_READONLY: 0x2000,
  /** Session-tracking data present in this OK. */
  SESSION_STATE_CHANGED: 0x4000,
} as const

/** `enum_session_state_type` (doc 17). */
export const SESSION_TRACK = {
  SYSTEM_VARIABLES: 0,
  SCHEMA: 1,
  STATE_CHANGE: 2,
  GTIDS: 3,
  TRANSACTION_CHARACTERISTICS: 4,
  TRANSACTION_STATE: 5,
} as const

/** `enum_resultset_metadata` (doc 17). */
export const RESULTSET_METADATA = {
  NONE: 0,
  FULL: 1,
} as const
