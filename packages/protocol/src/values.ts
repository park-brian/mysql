// M1.20 — text-protocol value rendering.
//
// Doc 15: "A text resultset row is just the column values back to back, each
// as `string<lenenc>` — with the single byte `0xFB` standing for NULL. Every
// value, including numbers and dates, is its SQL string rendering in the
// column's character set. That is the whole format."
//
// The full value model and its coercion rules are `@myjs/types` (M2). This is
// only what the wire needs: a JS value in, the bytes MySQL would print out.

import { FIELD_TYPE } from './constants/types.ts'
import { utf8 } from './text.ts'
import type { ColumnDefinition } from './packets/column.ts'

/**
 * What crosses the protocol/executor seam.
 *
 * D-15 fixes the JS side of this mapping: DECIMAL and TIME arrive as strings,
 * BLOB and BINARY as `Uint8Array`, BIGINT as a number when safe and a `BigInt`
 * otherwise, JSON already parsed.
 */
export type SqlValue = null | number | bigint | string | boolean | Uint8Array | Date

/**
 * Shortest round-trippable float, in MySQL's spelling.
 *
 * JavaScript already prints the shortest form that round-trips, but writes an
 * exponent as `e+308` where MySQL writes `e308` (doc 15's own example is
 * `1.7976931348623157e308`).
 */
export function renderFloat(v: number): string {
  if (Number.isNaN(v)) return 'NULL'
  if (v === Number.POSITIVE_INFINITY) return 'inf'
  if (v === Number.NEGATIVE_INFINITY) return '-inf'
  return String(v).replace('e+', 'e')
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function four(n: number): string {
  return String(n).padStart(4, '0')
}

/** `2010-10-17`. */
export function renderDate(d: Date): string {
  return `${four(d.getUTCFullYear())}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`
}

/** `2010-10-17 19:27:30`, plus `.ffffff` when the column has fractional precision. */
export function renderDateTime(d: Date, decimals = 0): string {
  const base = `${renderDate(d)} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
  if (decimals <= 0) return base
  const micros = d.getUTCMilliseconds() * 1000
  return `${base}.${String(micros).padStart(6, '0').slice(0, decimals)}`
}

/**
 * `-120:19:27` — a *duration*, not a clock time.
 *
 * Doc 15: "TIME is the one that catches people: it is a duration, not a clock
 * time. It can be negative and it can exceed 24 hours, so mapping it to a
 * `Date` is wrong." Hence the input is microseconds, and a `Date` is never
 * accepted for a TIME column.
 */
export function renderTime(totalMicros: bigint, decimals = 0): string {
  const negative = totalMicros < 0n
  const abs = negative ? -totalMicros : totalMicros
  const micros = abs % 1_000_000n
  const totalSeconds = abs / 1_000_000n
  const hours = totalSeconds / 3600n
  const minutes = (totalSeconds % 3600n) / 60n
  const seconds = totalSeconds % 60n
  const base = `${negative ? '-' : ''}${hours}:${two(Number(minutes))}:${two(Number(seconds))}`
  if (decimals <= 0) return base
  return `${base}.${String(micros).padStart(6, '0').slice(0, decimals)}`
}

const TEMPORAL_TYPES: readonly number[] = [
  FIELD_TYPE.DATE,
  FIELD_TYPE.DATETIME,
  FIELD_TYPE.TIMESTAMP,
  FIELD_TYPE.NEWDATE,
]

/**
 * Render one value for the text protocol. `null` means "write `0xFB`", which
 * is the caller's job because it replaces the whole length-encoded string.
 */
export function renderTextValue(value: SqlValue, column: Pick<ColumnDefinition, 'type' | 'decimals'>): Uint8Array | null {
  if (value === null) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof Date) {
    if (column.type === FIELD_TYPE.DATE) return utf8(renderDate(value))
    if (TEMPORAL_TYPES.includes(column.type)) {
      return utf8(renderDateTime(value, column.decimals === 0x1f ? 0 : column.decimals))
    }
    return utf8(renderDateTime(value))
  }
  if (typeof value === 'boolean') return utf8(value ? '1' : '0')
  if (typeof value === 'bigint') return utf8(value.toString())
  if (typeof value === 'number') {
    if (column.type === FIELD_TYPE.FLOAT || column.type === FIELD_TYPE.DOUBLE) {
      return utf8(renderFloat(value))
    }
    return utf8(Number.isInteger(value) ? value.toFixed(0) : renderFloat(value))
  }
  // Strings pass through: DECIMAL keeps its trailing zeros to the declared
  // scale precisely because the executor hands us the rendered string rather
  // than a double (D-15).
  return utf8(value)
}
