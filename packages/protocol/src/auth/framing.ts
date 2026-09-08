// M1.10 — the auth-exchange packets.
//
// Doc 13: "Note the header-byte overloading: `0xFE` as the first byte of a
// *connection phase* packet is an auth switch, not an EOF; `0x01` is
// AuthMoreData, not a length. Context, not byte value, decides." The
// discriminator (M1.4) takes the phase for exactly this reason.

import { Reader, Writer } from '@myjs/bytes'
import { protocolError } from '../errors/index.ts'
import { fromUtf8, utf8 } from '../text.ts'

export const AUTH_SWITCH_HEADER = 0xfe
export const AUTH_MORE_DATA_HEADER = 0x01
export const AUTH_NEXT_FACTOR_HEADER = 0x02

/**
 * `caching_sha2_password` markers, from `sql/auth/sha2_password.cc`
 * (`fast_auth_success = '\3'`, `perform_full_authentication = '\4'`).
 */
export const SHA2 = {
  FAST_AUTH_SUCCESS: 0x03,
  PERFORM_FULL_AUTHENTICATION: 0x04,
  /** Client -> server: "send me your public key". */
  REQUEST_SERVER_KEY: 0x02,
} as const

/** `0xFE`, plugin name, plugin data. */
export function writeAuthSwitchRequest(w: Writer, pluginName: string, pluginData: Uint8Array): void {
  w.u8(AUTH_SWITCH_HEADER)
  w.nulString(utf8(pluginName))
  w.bytes(pluginData)
}

export interface AuthSwitchRequest {
  readonly pluginName: string
  readonly pluginData: Uint8Array
}

export function parseAuthSwitchRequest(payload: Uint8Array): AuthSwitchRequest {
  const r = new Reader(payload)
  const header = r.u8()
  if (header !== AUTH_SWITCH_HEADER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected AuthSwitchRequest, got 0x${header.toString(16)}`)
  }
  // A bare 0xFE is OldAuthSwitchRequest — "switch to mysql_old_password",
  // which D-11 says never to implement. Recognising it is what turns a hang
  // into a clear error.
  if (r.remaining === 0) return { pluginName: 'mysql_old_password', pluginData: new Uint8Array(0) }
  return { pluginName: fromUtf8(r.nulString()), pluginData: r.restBytes() }
}

/** `0x01`, then raw plugin data. */
export function writeAuthMoreData(w: Writer, data: Uint8Array): void {
  w.u8(AUTH_MORE_DATA_HEADER)
  w.bytes(data)
}

export function parseAuthMoreData(payload: Uint8Array): Uint8Array {
  const r = new Reader(payload)
  const header = r.u8()
  if (header !== AUTH_MORE_DATA_HEADER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected AuthMoreData, got 0x${header.toString(16)}`)
  }
  return r.restBytes()
}

/**
 * `0x02`, plugin name, plugin data.
 *
 * MFA is out of scope, but the packet must at least be *recognised* so a
 * misconfigured client gets a clear error instead of a hang (doc 13, M1.10).
 */
export function writeAuthNextFactor(w: Writer, pluginName: string, pluginData: Uint8Array): void {
  w.u8(AUTH_NEXT_FACTOR_HEADER)
  w.nulString(utf8(pluginName))
  w.bytes(pluginData)
}

export function parseAuthNextFactor(payload: Uint8Array): AuthSwitchRequest {
  const r = new Reader(payload)
  const header = r.u8()
  if (header !== AUTH_NEXT_FACTOR_HEADER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected AuthNextFactor, got 0x${header.toString(16)}`)
  }
  return { pluginName: fromUtf8(r.nulString()), pluginData: r.restBytes() }
}

/** `AuthSwitchResponse` is raw plugin output with no header at all. */
export function writeAuthSwitchResponse(w: Writer, data: Uint8Array): void {
  w.bytes(data)
}
