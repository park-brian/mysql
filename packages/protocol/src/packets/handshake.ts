// M1.8, M1.9 — the connection phase.
//
// Layouts from docs/12-connection-phase.md, field for field. The sequence id
// runs continuously across this whole exchange and only resets when the
// command phase begins, which is the framer's business (M1.2), not this
// module's.

import { Reader, Writer } from '@myjs/bytes'
import {
  CLIENT,
  SERVER_ADVERTISED_CAPABILITIES,
  SERVER_STATUS,
  capabilities,
  hasCap,
  type Capabilities,
} from '../constants/capabilities.ts'
import { CHARSET_UTF8MB4_GENERAL_CI } from '../constants/types.ts'
import { messages } from '../errors/messages.ts'
import { protocolError } from '../errors/index.ts'
import { fromUtf8, utf8 } from '../text.ts'

export const PROTOCOL_VERSION = 10

/** The scramble is 20 random bytes, split 8 + 12 with a trailing NUL. */
export const SCRAMBLE_LENGTH = 20
const SCRAMBLE_PART1 = 8
/** Hence `auth_plugin_data_len` is 21 and part 2 is 13 bytes. */
export const AUTH_PLUGIN_DATA_LEN = SCRAMBLE_LENGTH + 1

export const CACHING_SHA2_PASSWORD = 'caching_sha2_password'
export const MYSQL_NATIVE_PASSWORD = 'mysql_native_password'

/** `SSLRequest` is exactly the first 32 bytes of `HandshakeResponse41`. */
export const SSL_REQUEST_LENGTH = 32

export interface HandshakeV10Options {
  readonly serverVersion: string
  readonly connectionId: number
  readonly scramble: Uint8Array
  readonly capabilities?: Capabilities
  readonly characterSet?: number
  readonly statusFlags?: number
  readonly authPluginName?: string
}

/**
 * `HandshakeV10`, the server's opening packet.
 *
 * D-10 shows up here three times: we advertise `CLIENT_LONG_PASSWORD` and zero
 * the reserved bytes, so that MariaDB-aware clients treat us as a MySQL server
 * and do not read `MARIADB_CLIENT_*` capabilities out of them; and the version
 * string puts us in the "modern MySQL" bucket without pretending to be
 * MariaDB, whose version shape changes client behaviour.
 */
export function writeHandshakeV10(w: Writer, options: HandshakeV10Options): void {
  const caps = options.capabilities ?? SERVER_ADVERTISED_CAPABILITIES
  const scramble = options.scramble
  if (scramble.length !== SCRAMBLE_LENGTH) {
    throw protocolError(
      'ER_MALFORMED_PACKET',
      `HandshakeV10: scramble must be ${SCRAMBLE_LENGTH} bytes, got ${scramble.length}`,
    )
  }

  w.u8(PROTOCOL_VERSION)
  w.nulString(utf8(options.serverVersion))
  w.u32(options.connectionId)
  w.bytes(scramble.subarray(0, SCRAMBLE_PART1))
  w.u8(0x00) // filler
  w.u16(caps & 0xffff)
  // Only the *low byte* of the collation id fits here, so ids above 255 cannot
  // be expressed. Servers advertise a low-numbered default and the client sets
  // the real one afterwards with SET NAMES.
  w.u8((options.characterSet ?? CHARSET_UTF8MB4_GENERAL_CI) & 0xff)
  w.u16(options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT)
  w.u16((caps >>> 16) & 0xffff)
  w.u8(hasCap(caps, CLIENT.PLUGIN_AUTH) ? AUTH_PLUGIN_DATA_LEN : 0x00)
  w.zeros(10) // reserved — all zero (D-10)
  // Part 2 is 12 bytes plus the trailing NUL: $len = max(13, 21 - 8) = 13.
  w.bytes(scramble.subarray(SCRAMBLE_PART1))
  w.u8(0x00)
  if (hasCap(caps, CLIENT.PLUGIN_AUTH)) {
    w.nulString(utf8(options.authPluginName ?? CACHING_SHA2_PASSWORD))
  }
}

export interface HandshakeV10 {
  readonly protocolVersion: number
  readonly serverVersion: string
  readonly connectionId: number
  readonly scramble: Uint8Array
  readonly capabilities: Capabilities
  readonly characterSet: number
  readonly statusFlags: number
  readonly authPluginName: string
}

/** Parse our own handshake back — used by the trace tests and the client role. */
export function parseHandshakeV10(payload: Uint8Array): HandshakeV10 {
  const r = new Reader(payload)
  const protocolVersion = r.u8()
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw protocolError('ER_MALFORMED_PACKET', `unsupported protocol version ${protocolVersion}`)
  }
  const serverVersion = fromUtf8(r.nulString())
  const connectionId = r.u32()
  const part1 = r.bytes(SCRAMBLE_PART1)
  r.skip(1) // filler
  const capsLower = r.u16()
  const characterSet = r.u8()
  const statusFlags = r.u16()
  const capsUpper = r.u16()
  const caps = capabilities(capsLower | (capsUpper << 16))
  const authPluginDataLen = r.u8()
  r.skip(10) // reserved
  const part2Len = Math.max(13, authPluginDataLen - SCRAMBLE_PART1)
  const part2 = r.bytes(part2Len)
  const authPluginName = hasCap(caps, CLIENT.PLUGIN_AUTH) ? fromUtf8(r.nulString()) : ''
  const scramble = new Uint8Array(SCRAMBLE_LENGTH)
  scramble.set(part1, 0)
  // Drop the trailing NUL that part 2 carries.
  scramble.set(part2.subarray(0, SCRAMBLE_LENGTH - SCRAMBLE_PART1), SCRAMBLE_PART1)
  return {
    protocolVersion,
    serverVersion,
    connectionId,
    scramble,
    capabilities: caps,
    characterSet,
    statusFlags,
    authPluginName,
  }
}

/**
 * Collation ids whose charset has `mbminlen > 1`.
 *
 * Doc 12: "Multibyte connection charsets (UCS2/UTF16/UTF32) are not supported
 * here — the specification says so explicitly, because the NUL-terminated
 * fields would be ambiguous. Reject them." Ids from `strings/ctype-*.cc`;
 * `@myjs/charsets` (M2) replaces this list with the generated registry.
 */
const PROHIBITED_CONNECTION_CHARSETS: ReadonlyArray<readonly [number, number]> = [
  [35, 35], // ucs2_general_ci
  [90, 90], // ucs2_bin
  [128, 151], // ucs2_* collations
  [54, 55], // utf16_general_ci, utf16_bin
  [101, 124], // utf16_* collations
  [56, 56], // utf16le_general_ci
  [62, 62], // utf16le_bin
  [60, 61], // utf32_general_ci, utf32_bin
  [160, 183], // utf32_* collations
]

export function isProhibitedConnectionCharset(id: number): boolean {
  return PROHIBITED_CONNECTION_CHARSETS.some(([lo, hi]) => id >= lo && id <= hi)
}

/** D-31: caps on attacker-controlled, pre-authentication input. */
export const MAX_CONNECT_ATTRS_BYTES = 64 * 1024
export const MAX_CONNECT_ATTRS_COUNT = 128

export interface SslRequest {
  readonly kind: 'ssl-request'
  readonly capabilities: number
  readonly maxPacketSize: number
  readonly characterSet: number
}

export interface HandshakeResponse41 {
  readonly kind: 'handshake-response'
  readonly capabilities: number
  readonly maxPacketSize: number
  readonly characterSet: number
  readonly username: string
  readonly authResponse: Uint8Array
  readonly database: string | null
  readonly clientPluginName: string
  readonly connectAttrs: ReadonlyMap<string, string>
  readonly zstdLevel: number | null
}

/**
 * A client's first packet is either the 32-byte `SSLRequest` — meaning
 * "upgrade now, the real response follows inside TLS" — or the full
 * `HandshakeResponse41`. It is distinguished by being exactly 32 bytes with
 * `CLIENT_SSL` set, not by a header byte.
 */
export function parseHandshakeResponse(payload: Uint8Array): SslRequest | HandshakeResponse41 {
  const r = new Reader(payload)
  const clientCaps = r.u32()
  const maxPacketSize = r.u32()
  const characterSet = r.u8()
  r.skip(23) // filler, all zero

  if (payload.length === SSL_REQUEST_LENGTH && (clientCaps & CLIENT.SSL) !== 0) {
    return { kind: 'ssl-request', capabilities: clientCaps, maxPacketSize, characterSet }
  }

  if (isProhibitedConnectionCharset(characterSet)) {
    throw protocolError('ER_MALFORMED_PACKET', messages.unsupportedCharset(characterSet))
  }

  const username = fromUtf8(r.nulString())

  // Honour CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA: without it the auth response
  // is capped at 255 bytes, which is fine for the 20-byte native scramble and
  // the 32-byte SHA-2 digest but not for an RSA-encrypted password.
  let authResponse: Uint8Array
  if ((clientCaps & CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA) !== 0) {
    authResponse = r.lenEncBytes() ?? new Uint8Array(0)
  } else {
    authResponse = r.bytes(r.u8())
  }

  // An empty name means "no database", not "the database called ''" — mysql2
  // sets CLIENT_CONNECT_WITH_DB and sends an empty string when none is
  // configured, and MySQL leaves such a session with DATABASE() as NULL.
  // `parseComChangeUser` makes the same mapping.
  const declaredDatabase = (clientCaps & CLIENT.CONNECT_WITH_DB) !== 0 ? fromUtf8(r.nulString()) : null
  const database = declaredDatabase === '' ? null : declaredDatabase
  const clientPluginName = (clientCaps & CLIENT.PLUGIN_AUTH) !== 0 ? fromUtf8(r.nulString()) : ''

  const connectAttrs = new Map<string, string>()
  if ((clientCaps & CLIENT.CONNECT_ATTRS) !== 0 && r.remaining > 0) {
    const total = Number(r.lenEncInt() ?? 0n)
    // D-31: refuse before reading. This is unauthenticated input, and the
    // length is attacker-chosen.
    if (total > MAX_CONNECT_ATTRS_BYTES) {
      throw protocolError('ER_MALFORMED_PACKET', messages.connectAttrsTooLarge(MAX_CONNECT_ATTRS_BYTES))
    }
    if (total > r.remaining) {
      throw protocolError('ER_MALFORMED_PACKET', 'connection attributes overrun the packet')
    }
    const end = r.position + total
    while (r.position < end) {
      if (connectAttrs.size >= MAX_CONNECT_ATTRS_COUNT) {
        throw protocolError(
          'ER_MALFORMED_PACKET',
          `more than ${MAX_CONNECT_ATTRS_COUNT} connection attributes`,
        )
      }
      const key = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
      const value = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
      connectAttrs.set(key, value)
    }
  }

  const zstdLevel =
    (clientCaps & CLIENT.ZSTD_COMPRESSION_ALGORITHM) !== 0 && r.remaining > 0 ? r.u8() : null

  return {
    kind: 'handshake-response',
    capabilities: clientCaps,
    maxPacketSize,
    characterSet,
    username,
    authResponse,
    database,
    clientPluginName,
    connectAttrs,
    zstdLevel,
  }
}

/** Build a `HandshakeResponse41` — for tests and the client role. */
export interface WriteHandshakeResponseOptions {
  readonly capabilities: number
  readonly maxPacketSize?: number
  readonly characterSet?: number
  readonly username: string
  readonly authResponse: Uint8Array
  readonly database?: string
  readonly clientPluginName?: string
  readonly connectAttrs?: ReadonlyMap<string, string>
  readonly zstdLevel?: number
}

export function writeHandshakeResponse41(w: Writer, o: WriteHandshakeResponseOptions): void {
  w.u32(o.capabilities)
  w.u32(o.maxPacketSize ?? 16 * 1024 * 1024)
  w.u8(o.characterSet ?? CHARSET_UTF8MB4_GENERAL_CI)
  w.zeros(23)
  w.nulString(utf8(o.username))
  if ((o.capabilities & CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA) !== 0) {
    w.lenEncBytes(o.authResponse)
  } else {
    w.u8(o.authResponse.length)
    w.bytes(o.authResponse)
  }
  if ((o.capabilities & CLIENT.CONNECT_WITH_DB) !== 0) w.nulString(utf8(o.database ?? ''))
  if ((o.capabilities & CLIENT.PLUGIN_AUTH) !== 0) {
    w.nulString(utf8(o.clientPluginName ?? CACHING_SHA2_PASSWORD))
  }
  if ((o.capabilities & CLIENT.CONNECT_ATTRS) !== 0) {
    const inner = new Writer(64)
    for (const [k, v] of o.connectAttrs ?? new Map()) {
      inner.lenEncBytes(utf8(k))
      inner.lenEncBytes(utf8(v))
    }
    const bytes = inner.view()
    w.lenEncInt(bytes.length)
    w.bytes(bytes)
  }
  if ((o.capabilities & CLIENT.ZSTD_COMPRESSION_ALGORITHM) !== 0) w.u8(o.zstdLevel ?? 3)
}

/** `SSLRequest`: the head of the response and nothing else. */
export function writeSslRequest(w: Writer, o: { capabilities: number; maxPacketSize?: number; characterSet?: number }): void {
  w.u32(o.capabilities | CLIENT.SSL)
  w.u32(o.maxPacketSize ?? 16 * 1024 * 1024)
  w.u8(o.characterSet ?? CHARSET_UTF8MB4_GENERAL_CI)
  w.zeros(23)
}
