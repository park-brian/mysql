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
  return new TypeError_('ER_NOT_SUPPORTED_YET', `${what} is not supported yet`, { errno: 1235, sqlState: '0A000' })
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
