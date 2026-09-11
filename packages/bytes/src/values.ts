// D-32 — the neutral value structs live here, in the package with no
// dependencies, because two packages above need to *name* them and neither may
// depend on the other.
//
// `@myjs/protocol` (M1) frames them onto the wire; `@myjs/types` (M2) encodes
// them into storage bytes. The layout table makes `@myjs/protocol` depend only
// on `bytes` and a crypto shim — and it must stay that way, because the release
// plan ships `@myjs/protocol` at 0.1 and `@myjs/charsets`/`@myjs/types` at 0.2.
// D-30 set the precedent when it put `MyjsError` here for the same reason.
//
// These are declarations only. The *rules* — coercion, comparison, the D-15
// driver mapping — belong to `@myjs/types`, which owns a separate
// engine-facing `StorageValue` union rather than widening `SqlValue`.

/**
 * What crosses the protocol/executor seam.
 *
 * D-15 fixes the JS side of this mapping: DECIMAL and TIME arrive as strings,
 * BLOB and BINARY as `Uint8Array`, BIGINT as a number when safe and a `BigInt`
 * otherwise, JSON already parsed.
 */
export type SqlValue = null | number | bigint | string | boolean | Uint8Array | Date

/**
 * A date and time with no timezone, held apart from `Date` because a `Date`
 * cannot represent microseconds and cannot represent the zero date — and doc
 * 15's own byte dumps have both.
 */
export interface MysqlDateTime {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly microsecond: number
}

/**
 * A *duration*, not a clock time: it may be negative and it may exceed 24
 * hours, which is why `days` is a separate field and why a `Date` is never
 * accepted for a TIME column.
 */
export interface MysqlTime {
  readonly negative: boolean
  readonly days: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly microsecond: number
}

export function isMysqlDateTime(v: unknown): v is MysqlDateTime {
  return typeof v === 'object' && v !== null && 'year' in v && 'month' in v
}

export function isMysqlTime(v: unknown): v is MysqlTime {
  return typeof v === 'object' && v !== null && 'negative' in v && 'days' in v
}

/**
 * Render a `MysqlDateTime` the way MySQL prints it.
 *
 * Here rather than in `@myjs/protocol` for D-37's reason: this is a *fact
 * about the format*, not wire behaviour. The same string appears in a text
 * resultset, in `mysqldump` output, and in the text rendering of a JSON
 * document — so more than one package above needs it, which is exactly the
 * test for whether something belongs in this package.
 *
 * It also collapses a duplication rather than adding to one: `renderDateTime`
 * and `binaryValueToText` in `@myjs/protocol` were two independent renderers
 * of the same value, reached from different directions.
 */
export function renderMysqlDateTime(v: MysqlDateTime, decimals = 0): string {
  const date = `${pad(v.year, 4)}-${pad(v.month, 2)}-${pad(v.day, 2)}`
  if (decimals <= 0 && v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0) return date
  const time = `${pad(v.hour, 2)}:${pad(v.minute, 2)}:${pad(v.second, 2)}`
  if (decimals <= 0) return `${date} ${time}`
  return `${date} ${time}.${pad(v.microsecond, 6).slice(0, decimals)}`
}

/**
 * Render a `MysqlTime` the way MySQL prints it.
 *
 * A duration, not a clock time: the hours field carries `days * 24 + hour`
 * and may exceed 24, and the whole value may be negative — which is why doc 15
 * says mapping TIME to a `Date` is wrong and D-15 maps it to a string.
 */
export function renderMysqlTime(v: MysqlTime, decimals = 0): string {
  const hours = v.days * 24 + v.hour
  const base = `${v.negative ? '-' : ''}${hours}:${pad(v.minute, 2)}:${pad(v.second, 2)}`
  if (decimals <= 0) return base
  return `${base}.${pad(v.microsecond, 6).slice(0, decimals)}`
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}
