// M2.18 / D-33 — the real transcoder, and `SET NAMES`.
//
// `@myjs/protocol` defines the `Transcoder` interface and ships a UTF-8-only
// default, because it must stay free of a dependency on `@myjs/charsets`
// (the release plan gives them different versions). `@myjs/core` depends on
// both, so this is where the two meet: the registry supplies the charset name
// for a collation id, and the encoder/decoder pair follows from that.
import { decodeCollation, encodeCollation, collationInfo, collationInfoByName, defaultCollationOf } from '@myjs/charsets'
import type { Transcoder } from '@myjs/protocol'

/** A `Transcoder` backed by the full charset registry. */
export const charsetTranscoder: Transcoder = {
  encode(text: string, collationId: number): Uint8Array {
    return encodeCollation(text, collationId)
  },
  decode(bytes: Uint8Array, collationId: number): string {
    return decodeCollation(bytes, collationId)
  },
}

/** What a `SET NAMES` or `SET CHARACTER SET` statement resolved to. */
export interface CharsetChange {
  readonly collationId: number
  readonly charset: string
  readonly collation: string
}

/**
 * Resolve `SET NAMES <charset> [COLLATE <collation>]`.
 *
 * Doc 29 notes that `HandshakeV10` carries only a single byte for the default
 * collation, "which is why servers advertise a low-numbered default and
 * clients issue `SET NAMES` afterwards". So this is not a nicety: it is how a
 * client reaches `utf8mb4_0900_ai_ci` (255) at all.
 *
 * Returns `null` when the statement is not a charset change, so the caller can
 * fall through to its other `SET` handling.
 */
export function parseSetNames(sql: string): CharsetChange | null | 'unknown' {
  const names = /^\s*SET\s+NAMES\s+([A-Za-z0-9_]+|'[^']*'|"[^"]*")\s*(?:COLLATE\s+([A-Za-z0-9_]+|'[^']*'|"[^"]*"))?\s*;?\s*$/i.exec(sql)
  const charsetOnly = /^\s*SET\s+(?:SESSION\s+|GLOBAL\s+)?CHARACTER\s+SET\s+([A-Za-z0-9_]+|'[^']*'|"[^"]*")\s*;?\s*$/i.exec(sql)
  const m = names ?? charsetOnly
  if (m === null) return null

  const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '')
  const charset = unquote(m[1] as string).toLowerCase()
  const collationName = names?.[2] === undefined ? null : unquote(names[2]).toLowerCase()

  // `SET NAMES DEFAULT` restores the server default rather than naming a charset.
  if (charset === 'default') {
    const fallback = defaultCollationOf('utf8mb4')
    return fallback === undefined ? 'unknown' : { collationId: fallback.id, charset: fallback.charset, collation: fallback.name }
  }

  if (collationName !== null) {
    const info = collationInfoByName(collationName)
    // A COLLATE that does not belong to the named charset is an error in
    // MySQL, not a silent override.
    if (info === undefined || info.charset !== charset) return 'unknown'
    return { collationId: info.id, charset: info.charset, collation: info.name }
  }

  const info = defaultCollationOf(charset)
  if (info === undefined) return 'unknown'
  return { collationId: info.id, charset: info.charset, collation: info.name }
}

/** The `character_set_*` / `collation_*` values a session should report. */
export function charsetVariables(collationId: number): Record<string, string> {
  const info = collationInfo(collationId)
  const charset = info?.charset ?? 'utf8mb4'
  const collation = info?.name ?? 'utf8mb4_0900_ai_ci'
  return {
    character_set_client: charset,
    character_set_connection: charset,
    character_set_results: charset,
    character_set_server: 'utf8mb4',
    collation_connection: collation,
    collation_server: 'utf8mb4_0900_ai_ci',
  }
}
