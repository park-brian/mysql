// M2.4 — `mbminlen`/`mbmaxlen` and the limits they drive.
//
// Doc 29 is emphatic that these are not trivia. Four real behaviours depend on
// them, and each one is a boundary a user hits:
//
//   `VARCHAR(n)` reserves `n × mbmaxlen` bytes, which is why the 65535-byte
//   row limit arrives at `VARCHAR(16383)` in utf8mb4 and not at 65535.
//
//   Index prefix limits are in **bytes**, so `KEY (col(255))` on a utf8mb4
//   column needs 1020 of the 3072 available.
//
//   Whether a length-prefixed `VARCHAR` uses one byte or two
//   (`DATA_LONG_TRUE_VARCHAR`) depends on `n × mbmaxlen`.
//
//   `ColumnDefinition41.column_length` is in bytes too (doc 15), which is why
//   `VARCHAR(255)` utf8mb4 reports 1020 on the wire.
import { requireCollationInfo } from './collation.ts'

/** The maximum bytes in one InnoDB row, excluding off-page values (doc 23). */
export const MAX_ROW_BYTES = 65535

/** The index-key prefix limit in DYNAMIC and COMPRESSED row formats (doc 23). */
export const MAX_KEY_PREFIX_BYTES_DYNAMIC = 3072

/** The same limit in COMPACT and REDUNDANT. */
export const MAX_KEY_PREFIX_BYTES_COMPACT = 767

/** Bytes a declared character length can occupy in this collation's charset. */
export function byteLengthFor(characters: number, collationId: number): number {
  return characters * requireCollationInfo(collationId).mbmaxlen
}

/**
 * The largest `VARCHAR(n)` that still fits the row limit on its own.
 *
 * utf8mb4 → 16383, latin1 → 65532 (65535 less the two-byte length prefix).
 */
export function maxVarcharCharacters(collationId: number): number {
  const { mbmaxlen } = requireCollationInfo(collationId)
  return Math.floor((MAX_ROW_BYTES - 2) / mbmaxlen)
}

/**
 * `DATA_LONG_TRUE_VARCHAR`: a `VARCHAR` whose byte budget exceeds 255 carries a
 * two-byte length rather than one.
 */
export function varcharLengthBytes(characters: number, collationId: number): 1 | 2 {
  return byteLengthFor(characters, collationId) > 255 ? 2 : 1
}

/** Characters of a column that fit in a given index-key prefix budget. */
export function maxPrefixCharacters(collationId: number, prefixBytes = MAX_KEY_PREFIX_BYTES_DYNAMIC): number {
  return Math.floor(prefixBytes / requireCollationInfo(collationId).mbmaxlen)
}
