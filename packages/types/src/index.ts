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
// M5.21 — JSON as a value: the lossless model, its text, its order and its binary form.
export {
  JSON_FALSE,
  JSON_NULL,
  JSON_TRUE,
  JsonSyntaxError,
  compareJson,
  decodeJsonDoc,
  encodeJsonDoc,
  jsonInteger,
  jsonKey,
  jsonObject,
  orderJson,
  parseJson,
  quoteJsonString,
  renderJson,
  toJsonDoc,
} from './json-doc.ts'
export type { JsonDoc } from './json-doc.ts'
export { declaredKeyWidth, encodeKey, encodeKeyPart, keyPartLength } from './keys.ts'
export type { KeyPart, KeyPartKind } from './keys.ts'
export { keyPartOf, storageWidth } from './columns.ts'
export type { ColumnType, KeyPartOptions } from './columns.ts'
// M5.2 — the evaluation value, MySQL's comparison and arithmetic, and a value
// into a column's bytes and back (D-62).
export {
  COERCIBILITY,
  MAX_SIGNED,
  MAX_UNSIGNED,
  MIN_SIGNED,
  bool,
  bytes as bytesValue,
  json as jsonValue,
  decimal as decimalValue,
  doubleToDecimal,
  double as doubleValue,
  int as intValue,
  isNumeric,
  isText,
  hexNumber,
  plainValue,
  withoutHex,
  numericPrefix,
  parseDateTime,
  parseDecimal,
  parseTime,
  pow10,
  renderDateTime,
  renderDecimal,
  renderDouble,
  renderFloat,
  renderTime,
  rescale,
  string as stringValue,
  textOf,
  timeOrdinal,
  toDateTime,
  toDecimal,
  toDouble,
  toInteger,
  toText,
  toTextBytes,
  toTime,
  truth,
  validDate,
} from './sql-value.ts'
export type { BytesValue, DateTimeValue, DecimalValue, DoubleValue, IntValue, JsonDocValue, StringValue, TemporalType, TimeValue, Value } from './sql-value.ts'
export { aggregateCollation, commonCollation, compareDecimals, compareValues, nullSafeEqual, orderValues, sortValues } from './compare.ts'
export { SUM_PRECISION_INCREMENT, avgAccumulator, avgPrecision, bitAccumulator, extremeAccumulator, sumAccumulator, sumPrecision, varianceAccumulator } from './aggregate.ts'
export type { Accumulator } from './aggregate.ts'
export { DIV_PRECISION_INCREMENT, add, bitNot, bitwise, divide, intDivide, modulo, negate, not } from './arith.ts'
export { decodeField, encodeField, integerRange } from './encode.ts'
export type { FieldColumn, StoreContext } from './encode.ts'
export { columnCannotBeNull, columnOutOfRange, dataTooLong, invalidJsonArgument, invalidJsonCharset, invalidJsonText, valueOutOfRange, wrongTemporalValue, wrongValueForColumn } from './errors.ts'
export { addInterval, dayNumber, intervalFsp, intervalOf, isDateUnit, isIntervalUnit, isTimeUnit, type Interval } from './interval.ts'
