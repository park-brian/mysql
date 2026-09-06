// M0.5 — the typed-error base.
//
// Ground rule 5 (docs/44-roadmap.md): a malformed input produces a typed error
// — never a crash, never a hang, never an out-of-bounds read. That is the
// fuzzing invariant (M0.8), and it only holds if no path in this package
// throws a bare `Error`.
//
// D-30: `MyjsError` is the base; `ProtocolError` covers framing and parse
// faults. Both can carry a MySQL errno and SQLSTATE, but this package never
// resolves them — `@myjs/bytes` has no dependencies and no error table, so
// `@myjs/protocol` supplies the numbers from its generated table (M1.6).

/** Optional MySQL-shaped detail attached to an error. */
export interface ErrorInfo {
  /** MySQL error number, e.g. 1153 for ER_NET_PACKET_TOO_LARGE. */
  readonly errno?: number
  /** Five-character SQLSTATE, e.g. '08S01'. */
  readonly sqlState?: string
  readonly cause?: unknown
}

/**
 * The base every error this project throws derives from.
 *
 * `code` is the symbolic name (`'ER_DUP_ENTRY'`, `'PROTOCOL_OUT_OF_BOUNDS'`),
 * matching the `err.code` shape `mysql2` exposes so existing `catch` blocks
 * keep working (doc 42).
 */
export class MyjsError extends Error {
  readonly code: string
  readonly errno: number | undefined
  readonly sqlState: string | undefined

  constructor(code: string, message: string, info: ErrorInfo = {}) {
    super(message, info.cause !== undefined ? { cause: info.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.errno = info.errno
    this.sqlState = info.sqlState
  }
}

/**
 * A malformed or truncated byte stream. Every bounds check in `Reader` throws
 * this, and it is the only error type the M0.8 fuzz target may observe.
 */
export class ProtocolError extends MyjsError {}

/** Reading past the end of a payload — the check doc 11 calls the whole attack surface. */
export function outOfBounds(need: number, remaining: number, what: string): ProtocolError {
  return new ProtocolError(
    'PROTOCOL_OUT_OF_BOUNDS',
    `${what}: need ${need} byte(s), ${remaining} remaining`,
  )
}
