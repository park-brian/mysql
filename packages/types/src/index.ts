export { TypeError_ as TypeError, outOfRange, badValue, invalidJson, unsupportedType } from './errors.ts'
export {
  INT_BYTES,
  signedRange,
  unsignedRange,
  encodeInt,
  decodeInt,
  encodeUnsignedInt,
  decodeUnsignedInt,
} from './integers.ts'
export {
  MAX_DECIMAL_PRECISION,
  MAX_DECIMAL_SCALE,
  decimalBinSize,
  encodeDecimal,
  decodeDecimal,
} from './decimal.ts'
export { encodeFloat, decodeFloat, encodeDouble, decodeDouble, compareFloat } from './floats.ts'
export {
  DATETIMEF_INT_OFS,
  TIMEF_INT_OFS,
  fractionalBytes,
  datetimeBinSize,
  encodeDatetime2,
  decodeDatetime2,
  timestampBinSize,
  encodeTimestamp2,
  decodeTimestamp2,
  timeBinSize,
  encodeTime2,
  decodeTime2,
  encodeDateField,
  decodeDateField,
  dateFieldToStorage,
  dateStorageToField,
  encodeYear,
  decodeYear,
  decodeLegacyDatetime,
  decodeLegacyTimestamp,
  decodeLegacyTime,
  legacyToStorage,
} from './temporal.ts'
export {
  enumBinSize,
  encodeEnum,
  decodeEnum,
  enumMember,
  enumIndexOf,
  setBinSize,
  encodeSet,
  decodeSet,
  setMembers,
  setMaskOf,
  bitBinSize,
  encodeBit,
  decodeBit,
  padChar,
  padBinary,
  trimTrailingSpaces,
  trimTrailingNuls,
} from './strings.ts'
export {
  decodeStorageValue,
  isMysqlTimestamp,
  toDriverValue,
} from './values.ts'
export type { ColumnMeta, DriverOptions, MysqlTimestamp, StorageValue } from './values.ts'
// D-32 says both packages above re-export the neutral structs; `@myjs/protocol`
// always did and this one never got round to it.
export { isMysqlDateTime, isMysqlTime, renderMysqlDateTime, renderMysqlTime } from '@myjs/bytes'
export type { MysqlDateTime, MysqlTime, SqlValue } from '@myjs/bytes'
export { JSON_TYPE, compareJsonKeys, decodeJson, encodeJson } from './json.ts'
export type { JsonValue } from './json.ts'
export { encodeKey, encodeKeyPart } from './keys.ts'
export type { KeyPart, KeyPartKind } from './keys.ts'
