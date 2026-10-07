// M2.18 / D-33 — the real transcoder, and `SET NAMES`.
//
// `@myjs/protocol` defines the `Transcoder` interface and ships a UTF-8-only
// default, because it must stay free of a dependency on `@myjs/charsets`
// (the release plan gives them different versions). `@myjs/core` depends on
// both, so this is where the two meet: the registry supplies the charset name
// for a collation id, and the encoder/decoder pair follows from that.
import {
  collationInfo,
  collationInfoByName,
  decodeCollation,
  defaultCollationOf,
  encodeCollation,
  preloadCollation,
} from '@myjs/charsets'
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
 * Resolve what `SET NAMES <charset> [COLLATE <collation>]`, `SET CHARACTER SET`
 * and their `DEFAULT` forms name: the parsed item, as `@myjs/parser` reads it.
 *
 * Doc 29 notes that `HandshakeV10` carries only a single byte for the default
 * collation, "which is why servers advertise a low-numbered default and
 * clients issue `SET NAMES` afterwards". So this is not a nicety: it is how a
 * client reaches `utf8mb4_0900_ai_ci` (255) at all.
 *
 * Until M3.6 this took the statement's text and matched it with a regex,
 * which saw `SET NAMES` only when it was the whole statement. It is one item
 * of a list now, `SET @a = 1, NAMES latin1` included, because the parser says so.
 */
export function charsetChange(item: { readonly charset?: string; readonly collation?: string }): CharsetChange | 'unknown' {
  // An absent charset is `SET NAMES DEFAULT`: the server default, not a name.
  const charset = (item.charset ?? 'utf8mb4').toLowerCase()
  if (item.collation !== undefined) {
    const info = collationInfoByName(item.collation.toLowerCase())
    // A COLLATE that does not belong to the named charset is an error in
    // MySQL, not a silent override.
    if (info === undefined || info.charset !== charset) return 'unknown'
    return { collationId: info.id, charset: info.charset, collation: info.name }
  }
  const info = defaultCollationOf(charset)
  if (info === undefined) return 'unknown'
  return { collationId: info.id, charset: info.charset, collation: info.name }
}

/**
 * Make a collation's ordering usable, loading its weight tables if need be.
 *
 * Delegates to `preloadCollation` rather than testing `collationAvailability`
 * itself, and that is not a stylistic choice: `collationAvailability` lives
 * beside the synchronous resolver, so importing it here would pull all 42
 * legacy 8-bit weight tables into `@myjs/core`'s bundle — 10 KB gzipped that
 * nothing in this package orders anything with. Measured, not guessed.
 */
export async function ensureCollationResident(collationId: number): Promise<void> {
  await preloadCollation(collationId)
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
