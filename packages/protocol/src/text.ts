// The encoding boundary, isomorphic by construction.
//
// Doc 11 is emphatic that there is no single connection charset: identifiers
// and error messages use `character_set_results`, and a text-resultset value
// uses the *column's* charset.
//
// M2.18 splits that in two, along the line D-33 draws:
//
//   `utf8()`/`fromUtf8()` stay, and are honestly named. Everything this
//   package *frames* — plugin names, connection attributes, the parts of a
//   packet whose encoding the protocol itself fixes — is UTF-8 and always was.
//
//   A `Transcoder` is injected for everything whose charset is a *session*
//   property. `@myjs/core` supplies one backed by `@myjs/charsets`; the
//   default here handles UTF-8 and refuses anything else with a typed error,
//   so `@myjs/protocol` stays standalone and stays 40 KB.
//
// The alternative — depending on `@myjs/charsets` — is ruled out by the
// release plan, which ships this package at 0.1 and that one at 0.2.
import { protocolError } from './errors/index.ts'
import { messages } from './errors/messages.ts'
import { charsetWidths } from './constants/charset-widths.ts'
import { CHARSET_UTF8MB4_0900_AI_CI, CHARSET_UTF8MB4_GENERAL_CI } from './constants/types.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export function utf8(s: string): Uint8Array {
  return encoder.encode(s)
}

export function fromUtf8(b: Uint8Array): string {
  return decoder.decode(b)
}

/**
 * Text whose charset the session decides, rather than the protocol.
 *
 * Deliberately keyed by collation id, because that is what the wire carries —
 * `HandshakeResponse41`'s charset byte, `COM_CHANGE_USER`'s, and every column
 * definition's — and translating it to a charset name is the registry's job,
 * not this package's.
 */
export interface Transcoder {
  encode(text: string, collationId: number): Uint8Array
  decode(bytes: Uint8Array, collationId: number): string
}

/** The utf8mb4 collations this package can serve without a registry. */
function isUtf8(collationId: number): boolean {
  // utf8mb4 and utf8mb3 are both UTF-8 on the wire; utf8mb3 is the 3-byte
  // subset, so a UTF-8 decoder reads it correctly.
  const widths = charsetWidths(collationId)
  return widths !== undefined && widths.mbminlen === 1 && (widths.mbmaxlen === 3 || widths.mbmaxlen === 4)
}

/**
 * The fallback: UTF-8, and a typed error for anything else.
 *
 * A silently wrong decode is the failure mode worth ruling out here — latin1
 * bytes read as UTF-8 do not throw, they produce replacement characters that
 * reach the application as data.
 */
export const utf8Transcoder: Transcoder = {
  encode(text: string, collationId: number): Uint8Array {
    if (!isUtf8(collationId)) throw protocolError('ER_UNKNOWN_CHARACTER_SET', messages.noTranscoder(collationId))
    return utf8(text)
  },
  decode(bytes: Uint8Array, collationId: number): string {
    if (!isUtf8(collationId)) throw protocolError('ER_UNKNOWN_CHARACTER_SET', messages.noTranscoder(collationId))
    return fromUtf8(bytes)
  },
}

/** Collation ids the built-in transcoder can serve, for a caller that wants to check. */
export const BUILTIN_TRANSCODER_COLLATIONS: readonly number[] = [
  CHARSET_UTF8MB4_GENERAL_CI,
  CHARSET_UTF8MB4_0900_AI_CI,
]
