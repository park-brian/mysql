export { CharsetError, unknownCollation, unsupportedCollation, unsupportedCharset } from './errors.ts'
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
export { collation, hasCollation, memcmp, memcmpPadSpace, MEMCMP_COLLATION_IDS } from './collations/memcmp.ts'
export { COLLATION_TABLE_SOURCE, COLLATION_TABLE_SOURCE_SHA256, PACKED_COLLATIONS } from './registry.ts'
