// M1.5 — OK / ERR / EOF, capability-conditional, including the OK-as-EOF form.
//
// Layouts from docs/10-protocol-overview.md. The trap worth stating once: OK
// orders `status_flags` then `warnings`, and EOF orders `warnings` then
// `status_flags` — the reverse. A shared writer that gets this wrong produces
// packets that parse, and mean something else.

import { Reader, Writer } from '@myjs/bytes'
import { CLIENT, SERVER_STATUS, hasCap, type Capabilities } from '../constants/capabilities.ts'
import { DEFAULT_SQLSTATE, errnoOf, protocolError, sqlStateOf, symbolOf } from '../errors/index.ts'
import { utf8, fromUtf8 } from '../text.ts'

export const OK_HEADER = 0x00
export const EOF_HEADER = 0xfe
export const ERR_HEADER = 0xff
export const LOCAL_INFILE_HEADER = 0xfb

export interface OkPacket {
  readonly affectedRows: bigint
  readonly lastInsertId: bigint
  readonly statusFlags: number
  readonly warnings: number
  readonly info: string
  readonly sessionStateChanges: Uint8Array | null
}

export interface WriteOkOptions {
  readonly affectedRows?: number | bigint
  readonly lastInsertId?: number | bigint
  readonly statusFlags?: number
  readonly warnings?: number
  readonly info?: string
  /** Doc 17's session-state block, already encoded. */
  readonly sessionStateChanges?: Uint8Array
  /**
   * Write header `0xFE` instead of `0x00`.
   *
   * Under `CLIENT_DEPRECATE_EOF` the server sends an OK packet with header
   * `0xFE` everywhere an EOF used to appear. A server must honour the flag in
   * both directions or drivers misparse resultsets.
   */
  readonly asEof?: boolean
}

export function writeOk(w: Writer, caps: Capabilities, options: WriteOkOptions = {}): void {
  const statusFlags = options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT
  const warnings = options.warnings ?? 0
  const info = options.info ?? ''
  const stateChanges = options.sessionStateChanges ?? null

  w.u8(options.asEof === true ? EOF_HEADER : OK_HEADER)
  w.lenEncInt(BigInt(options.affectedRows ?? 0))
  w.lenEncInt(BigInt(options.lastInsertId ?? 0))

  if (hasCap(caps, CLIENT.PROTOCOL_41)) {
    w.u16(statusFlags)
    w.u16(warnings)
  } else if (hasCap(caps, CLIENT.TRANSACTIONS)) {
    w.u16(statusFlags)
  }

  if (hasCap(caps, CLIENT.SESSION_TRACK)) {
    const stateChanged = (statusFlags & SERVER_STATUS.SESSION_STATE_CHANGED) !== 0
    // Note the asymmetry: `info` is only present when there is something to
    // say. This is what keeps the minimal OK seven bytes even with session
    // tracking negotiated.
    if (stateChanged || info !== '') w.lenEncBytes(utf8(info))
    if (stateChanged) w.lenEncBytes(stateChanges ?? new Uint8Array(0))
  } else if (info !== '') {
    w.bytes(utf8(info))
  }
}

export function parseOk(payload: Uint8Array, caps: Capabilities): OkPacket {
  const r = new Reader(payload)
  const header = r.u8()
  if (header !== OK_HEADER && header !== EOF_HEADER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected an OK packet, got header 0x${header.toString(16)}`)
  }
  const affectedRows = r.lenEncInt() ?? 0n
  const lastInsertId = r.lenEncInt() ?? 0n
  let statusFlags = 0
  let warnings = 0
  if (hasCap(caps, CLIENT.PROTOCOL_41)) {
    statusFlags = r.u16()
    warnings = r.u16()
  } else if (hasCap(caps, CLIENT.TRANSACTIONS)) {
    statusFlags = r.u16()
  }
  let info = ''
  let sessionStateChanges: Uint8Array | null = null
  if (hasCap(caps, CLIENT.SESSION_TRACK)) {
    if (r.remaining > 0) info = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
    if ((statusFlags & SERVER_STATUS.SESSION_STATE_CHANGED) !== 0 && r.remaining > 0) {
      sessionStateChanges = r.lenEncBytes()
    }
  } else if (r.remaining > 0) {
    info = fromUtf8(r.restBytes())
  }
  return { affectedRows, lastInsertId, statusFlags, warnings, info, sessionStateChanges }
}

export interface ErrPacket {
  readonly errno: number
  readonly sqlState: string
  readonly message: string
}

export interface WriteErrOptions {
  readonly errno: number
  readonly sqlState?: string
  readonly message: string
}

export function writeErr(w: Writer, caps: Capabilities, options: WriteErrOptions): void {
  w.u8(ERR_HEADER)
  w.u16(options.errno)
  if (hasCap(caps, CLIENT.PROTOCOL_41)) {
    // During the *connection* phase a client that has not yet negotiated
    // CLIENT_PROTOCOL_41 must be sent an ERR with no SQL-state fields at all —
    // which is why this is capability-conditional rather than unconditional.
    w.u8(0x23) // '#'
    const state = options.sqlState ?? sqlStateOf(options.errno)
    const bytes = utf8(state)
    w.bytes(bytes.length === 5 ? bytes : utf8(DEFAULT_SQLSTATE))
  }
  w.bytes(utf8(options.message))
}

/** Convenience: build an ERR from a symbol, taking errno and SQLSTATE from the generated table. */
export function writeErrSymbol(w: Writer, caps: Capabilities, symbol: string, message: string): void {
  writeErr(w, caps, { errno: errnoOf(symbol), sqlState: sqlStateOf(symbol), message })
}

export function parseErr(payload: Uint8Array, caps: Capabilities): ErrPacket {
  const r = new Reader(payload)
  const header = r.u8()
  if (header !== ERR_HEADER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected an ERR packet, got header 0x${header.toString(16)}`)
  }
  const errno = r.u16()
  let sqlState = DEFAULT_SQLSTATE
  if (hasCap(caps, CLIENT.PROTOCOL_41)) {
    const marker = r.u8()
    if (marker !== 0x23) {
      throw protocolError('ER_MALFORMED_PACKET', `ERR packet: expected '#', got 0x${marker.toString(16)}`)
    }
    sqlState = fromUtf8(r.bytes(5))
  }
  return { errno, sqlState, message: fromUtf8(r.restBytes()) }
}

export interface EofPacket {
  readonly warnings: number
  readonly statusFlags: number
}

export interface WriteEofOptions {
  readonly warnings?: number
  readonly statusFlags?: number
}

/** A real EOF packet. Note: warnings first, then status flags — unlike OK. */
export function writeEof(w: Writer, caps: Capabilities, options: WriteEofOptions = {}): void {
  w.u8(EOF_HEADER)
  if (hasCap(caps, CLIENT.PROTOCOL_41)) {
    w.u16(options.warnings ?? 0)
    w.u16(options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT)
  }
}

export function parseEof(payload: Uint8Array, caps: Capabilities): EofPacket {
  const r = new Reader(payload)
  const header = r.u8()
  if (header !== EOF_HEADER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected an EOF packet, got header 0x${header.toString(16)}`)
  }
  if (!hasCap(caps, CLIENT.PROTOCOL_41)) return { warnings: 0, statusFlags: 0 }
  return { warnings: r.u16(), statusFlags: r.u16() }
}

/**
 * Whatever terminates a resultset or a definition block for this client: an
 * OK packet with header `0xFE` under `CLIENT_DEPRECATE_EOF`, an EOF packet
 * otherwise. Every caller uses this rather than choosing for itself.
 */
export function writeTerminator(
  w: Writer,
  caps: Capabilities,
  options: WriteEofOptions & { readonly affectedRows?: number | bigint; readonly lastInsertId?: number | bigint } = {},
): void {
  if (hasCap(caps, CLIENT.DEPRECATE_EOF)) {
    writeOk(w, caps, {
      asEof: true,
      affectedRows: options.affectedRows ?? 0,
      lastInsertId: options.lastInsertId ?? 0,
      statusFlags: options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT,
      warnings: options.warnings ?? 0,
    })
  } else {
    writeEof(w, caps, options)
  }
}

/** Human-readable name for an errno, for logs and test failures. */
export function describeErrno(errno: number): string {
  return symbolOf(errno) ?? `errno ${errno}`
}
