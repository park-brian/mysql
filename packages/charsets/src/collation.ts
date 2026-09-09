// M2.1 — the collation registry and the `Collation` interface.
//
// Doc 29 opens by saying why this package exists at all: collation is not a
// display concern. It determines index order, `ORDER BY` results, `=`
// semantics and unique-constraint violations. An engine that gets it wrong is
// not MySQL-compatible however good its protocol implementation is.
//
// The table itself is generated (M2.17, `registry.ts`). This file expands it
// and answers questions about it.
import { unknownCollation } from './errors.ts'
import { COLLATION_TABLE_SIZE, PACKED_COLLATIONS } from './registry.ts'

/**
 * `PAD SPACE` collations compare `'a'` equal to `'a '`; `NO PAD` ones do not.
 *
 * Doc 29: this is one of the most common real-world surprises when upgrading
 * MySQL, because every pre-8.0 collation pads and every `*_0900_*` one does
 * not — so a unique index can start rejecting rows it used to accept. Both
 * behaviours have to be reproduced.
 */
export type PadAttribute = 'PAD SPACE' | 'NO PAD'

/** What the generated table knows about a collation, before any weights. */
export interface CollationInfo {
  readonly id: number
  readonly name: string
  readonly charset: string
  /** Minimum bytes per character. Greater than 1 means it cannot be a connection charset. */
  readonly mbminlen: number
  /** Maximum bytes per character — the multiplier in every length budget (doc 29). */
  readonly mbmaxlen: number
  readonly padAttribute: PadAttribute
  /** Whether this is its charset's default collation (`MY_CS_PRIMARY`). */
  readonly isDefault: boolean
  /** Whether ordering is plain `memcmp` (`MY_CS_BINSORT`). */
  readonly isBinary: boolean
}

/**
 * A collation that can actually order values.
 *
 * `sortKey` is the load-bearing half, and the reason doc 29 rejects
 * `Intl.Collator` as the primary implementation: a B+tree wants a **byte
 * string** it can store and `memcmp`, not a comparator. Index bytes that
 * depended on the runtime's ICU version would not survive being written by one
 * engine and read by another.
 */
export interface Collation extends CollationInfo {
  /** A byte string such that `memcmp(sortKey(a), sortKey(b)) === compare(a, b)`. */
  sortKey(bytes: Uint8Array): Uint8Array
  compare(a: Uint8Array, b: Uint8Array): number
}

// --- the generated table, expanded on first use -----------------------------

let table: Map<number, CollationInfo> | null = null
let byName: Map<string, CollationInfo> | null = null

function expand(): Map<number, CollationInfo> {
  if (table !== null) return table
  const byId = new Map<number, CollationInfo>()
  const names = new Map<string, CollationInfo>()
  for (const line of PACKED_COLLATIONS.split('\n')) {
    const parts = line.split(' ')
    const [id, name, charset, mbminlen, mbmaxlen] = parts
    const flags = parts[5] ?? ''
    const info: CollationInfo = {
      id: Number(id),
      name: name as string,
      charset: charset as string,
      mbminlen: Number(mbminlen),
      mbmaxlen: Number(mbmaxlen),
      padAttribute: flags.includes('n') ? 'NO PAD' : 'PAD SPACE',
      isDefault: flags.includes('d'),
      isBinary: flags.includes('b'),
    }
    byId.set(info.id, info)
    names.set(info.name, info)
  }
  table = byId
  byName = names
  return byId
}

/** Every collation MySQL compiles in, by id. */
export function collationInfo(id: number): CollationInfo | undefined {
  return expand().get(id)
}

/** Throws `ER_UNKNOWN_COLLATION` rather than returning `undefined` (ground rule 5). */
export function requireCollationInfo(id: number): CollationInfo {
  const info = expand().get(id)
  if (info === undefined) throw unknownCollation(id)
  return info
}

export function collationInfoByName(name: string): CollationInfo | undefined {
  expand()
  return byName?.get(name)
}

/** The default collation of a charset, e.g. `utf8mb4` → `utf8mb4_0900_ai_ci`. */
export function defaultCollationOf(charset: string): CollationInfo | undefined {
  for (const info of expand().values()) {
    if (info.charset === charset && info.isDefault) return info
  }
  return undefined
}

export function allCollations(): readonly CollationInfo[] {
  return [...expand().values()]
}

export { COLLATION_TABLE_SIZE }

/**
 * Doc 12: a multibyte connection charset makes the NUL-terminated fields of
 * `HandshakeResponse41` ambiguous, so UCS2/UTF16/UTF32 are refused.
 *
 * `@myjs/protocol` answers this same question from its own generated width
 * table (D-33), because it must answer it before authentication, with no
 * session and no dependency on this package. This is the readable statement of
 * the rule; a test asserts the two agree on every id.
 */
export function isProhibitedConnectionCollation(id: number): boolean {
  const info = expand().get(id)
  return info !== undefined && info.mbminlen > 1
}
