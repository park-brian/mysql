// M1.20 — text-protocol value rendering.
//
// Doc 15: "A text resultset row is just the column values back to back, each
// as `string<lenenc>` — with the single byte `0xFB` standing for NULL. Every
// value, including numbers and dates, is its SQL string rendering in the
// column's character set. That is the whole format."
//
// The full value model and its coercion rules are `@myjs/types` (M2). This is
// only what the wire needs: a JS value in, the bytes MySQL would print out.

import type { SqlValue } from '@myjs/bytes'
import { FIELD_TYPE } from './constants/types.ts'
import { utf8 } from './text.ts'
import type { ColumnDefinition } from './packets/column.ts'

// D-32: `SqlValue` is declared in `@myjs/bytes` so that `@myjs/types` can name
// it without a dependency edge in either direction. Re-exported because it is
// part of this package's published surface.
export type { SqlValue }

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

/** `decimals` is 0x1f — "not fixed" — for anything without a declared scale. */
function scaleOf(decimals: number): number {
  return decimals === 0x1f ? 0 : decimals
}

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
      return utf8(renderDateTime(value, scaleOf(column.decimals)))
    }
    return utf8(renderDateTime(value))
  }
  if (typeof value === 'boolean') return utf8(value ? '1' : '0')
  if (typeof value === 'bigint') {
    // TIME is a duration, so a `bigint` on a TIME column is microseconds — not
    // an integer to print. Without this branch `19:27:30` renders as
    // `70050000000`, which is a wrong answer rather than a missing one.
    if (column.type === FIELD_TYPE.TIME) return utf8(renderTime(value, scaleOf(column.decimals)))
    return utf8(value.toString())
  }
  if (typeof value === 'number') {
    if (column.type === FIELD_TYPE.FLOAT || column.type === FIELD_TYPE.DOUBLE) {
      return utf8(renderFloat(value))
    }
    if (!Number.isInteger(value)) return utf8(renderFloat(value))
    // `toFixed(0)` gives up and returns exponential notation at 1e21, which is
    // never valid SQL. Out of contract for an integer column — BIGINT tops out
    // at ~9.22e18 and D-15 sends anything unsafe as a `bigint` — but a wrong
    // answer is worse than a slow one, so print it exactly.
    return utf8(Math.abs(value) < 1e21 ? value.toFixed(0) : BigInt(value).toString())
  }
  // Strings pass through: DECIMAL keeps its trailing zeros to the declared
  // scale precisely because the executor hands us the rendered string rather
  // than a double (D-15).
  return utf8(value)
}
