export {
  CharsetError,
  unknownCollation,
  unsupportedCollation,
  unsupportedCharset,
  collationNotLoaded,
} from './errors.ts'
export {
  collationInfo,
  requireCollationInfo,
  collationInfoByName,
  defaultCollationOf,
  allCollations,
  isProhibitedConnectionCollation,
  COLLATION_TABLE_SIZE,
} from './collation.ts'
export type { Collation, CollationInfo, PadAttribute } from './collation.ts'
export {
  APPROXIMATE_CHARSETS,
  canDecode,
  decodeCharset,
  encodeCharset,
  decodeCollation,
  encodeCollation,
  rejectsLatin1Substitute,
} from './encoding.ts'
export {
  MAX_ROW_BYTES,
  MAX_KEY_PREFIX_BYTES_DYNAMIC,
  MAX_KEY_PREFIX_BYTES_COMPACT,
  byteLengthFor,
  maxVarcharCharacters,
  varcharLengthBytes,
  maxPrefixCharacters,
} from './limits.ts'
export { memcmp, memcmpPadSpace, comparePadded, MEMCMP_COLLATION_IDS } from './collations/memcmp.ts'
export { collation, hasCollation, loadCollation, collationAvailability } from './collations/resolve.ts'
export type { CollationAvailability } from './collations/resolve.ts'
// Deliberately no re-export of `uca900.ts`: naming its packed table here
// would make it a static import of the barrel and undo the whole point of
// M2.20. `uca.ts` reaches it by `await import()` and nothing else may.
export { isUcaCollation, loadUcaTables, ucaTablesLoaded, UCA_COLLATION_IDS } from './collations/uca.ts'
// `preloadCollation` lives apart from `collation`/`collationAvailability` on
// purpose: a caller that only wants to *load* must not have to import the
// module that can synchronously *resolve*, because that one carries every
// weight table in the package. See the note in `collations/preload.ts`.
export { preloadCollation } from './collations/preload.ts'
export { intlCollationFor, isIntlFallbackEnabled, noSortKey, setIntlFallbackEnabled } from './collations/intl.ts'
export { isWeightedCollation, weightedCollationIds } from './collations/weighted.ts'
export { WEIGHT_TABLE_SOURCE_SHA256, PACKED_BYTE_WEIGHTS, PACKED_UNICASE_WEIGHTS } from './collations/weights.ts'
// B0: already a static import of `encoding.ts`, so naming it here costs
// nothing — unlike the UCA weights above, which must stay unnamed.
export { ENCODING_TABLE_SOURCE_SHA256, PACKED_CHARSET_TO_UNI } from './encodings.ts'
export { expandRuns } from './runs.ts'
export { COLLATION_TABLE_SOURCE, COLLATION_TABLE_SOURCE_SHA256, PACKED_COLLATIONS } from './registry.ts'
