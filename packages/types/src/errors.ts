// Ground rule 5: a typed error, always.
import { MyjsError } from '@myjs/bytes'

/** A value that cannot be encoded, or bytes that cannot be decoded. */
export class TypeError_ extends MyjsError {}

export function outOfRange(what: string, value: unknown): TypeError_ {
  return new TypeError_('ER_DATA_OUT_OF_RANGE', `${what}: ${String(value)} is out of range`, {
    errno: 1690,
    sqlState: '22003',
  })
}

export function badValue(what: string, why: string): TypeError_ {
  return new TypeError_('ER_TRUNCATED_WRONG_VALUE', `${what}: ${why}`, { errno: 1292, sqlState: '22007' })
}

export function unsupportedType(what: string): TypeError_ {
  return new TypeError_('ER_NOT_SUPPORTED_YET', `${what} is not supported yet`, { errno: 1235, sqlState: '42000' })
}

/**
 * Malformed binary JSON.
 *
 * Its own constructor rather than `badValue`, which hardcodes 1292/22007 —
 * MySQL has a dedicated code for this and reusing a wrong errno would break
 * exactly the `catch` blocks D-15 exists to keep working.
 */
export function invalidJson(why: string): TypeError_ {
  return new TypeError_('ER_INVALID_JSON_BINARY_DATA', `invalid binary JSON: ${why}`, { errno: 3142 })
}

/** ER_DATA_OUT_OF_RANGE, 1690 / 22003, as an expression raises it: "BIGINT value is out of range in '(a + b)'". */
export function valueOutOfRange(type: string, expr: string): TypeError_ {
  return new TypeError_('ER_DATA_OUT_OF_RANGE', `${type} value is out of range in '${expr}'`, { errno: 1690, sqlState: '22003' })
}

/** ER_WARN_DATA_OUT_OF_RANGE, 1264 / 22003: a value too big for the column it is stored in, under a strict mode. */
export function columnOutOfRange(column: string, row: number): TypeError_ {
  return new TypeError_('ER_WARN_DATA_OUT_OF_RANGE', `Out of range value for column '${column}' at row ${row}`, { errno: 1264, sqlState: '22003' })
}

/** ER_DATA_TOO_LONG, 1406 / 22001. */
export function dataTooLong(column: string, row: number): TypeError_ {
  return new TypeError_('ER_DATA_TOO_LONG', `Data too long for column '${column}' at row ${row}`, { errno: 1406, sqlState: '22001' })
}

/** ER_TRUNCATED_WRONG_VALUE_FOR_FIELD, 1366 / HY000: `'abc'` into an INT column, under a strict mode. */
export function wrongValueForColumn(type: string, value: string, column: string, row: number): TypeError_ {
  return new TypeError_('ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', `Incorrect ${type} value: '${value}' for column '${column}' at row ${row}`, { errno: 1366, sqlState: 'HY000' })
}

/** ER_TRUNCATED_WRONG_VALUE, 1292 / 22007: a temporal that is not one, stored under a strict mode. */
export function wrongTemporalValue(type: string, value: string, column: string, row: number): TypeError_ {
  return new TypeError_('ER_TRUNCATED_WRONG_VALUE', `Incorrect ${type} value: '${value}' for column '${column}' at row ${row}`, { errno: 1292, sqlState: '22007' })
}

/** ER_BAD_NULL_ERROR, 1048 / 23000. */
export function columnCannotBeNull(column: string): TypeError_ {
  return new TypeError_('ER_BAD_NULL_ERROR', `Column '${column}' cannot be null`, { errno: 1048, sqlState: '23000' })
}
