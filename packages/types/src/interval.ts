// M5.10 begun — `INTERVAL` arithmetic: `d + INTERVAL n unit`, DATE_ADD and
// DATE_SUB, as `sql/item_timefunc.cc`'s `date_add_interval` computes them.
//
// An interval is months, or microseconds — never both, since a month has no
// fixed length. Months move the year and month and clamp the day to the
// month's last (`2024-01-31 + INTERVAL 1 MONTH` is 2024-02-29); everything
// else is added on MySQL's day number, `calc_daynr`'s proleptic count from
// year 0. A result outside 0000-01-01 … 9999-12-31 is NULL (the server warns
// 1441, "datetime field overflow").
//
// The value is read as the unit says (8.4.11): a simple unit takes an
// integer, so `INTERVAL 1.5 DAY` is two days and `INTERVAL '1.5' DAY` one —
// a number rounds, a string stops at its first non-digit — except SECOND,
// which keeps a number's fraction. A compound unit (`'1 2:3:4.5'
// DAY_MICROSECOND`) reads its digits as fields from the right, so `'1:2:3'
// DAY_SECOND` is one hour, two minutes and three seconds, and a microsecond
// field is a fraction: `.5` is 500000.
import type { MysqlDateTime } from '@myjs/bytes'
import { rescale, roundDouble, textOf, toDecimal, toText, type Value } from './sql-value.ts'

/** The units, each with the fields a compound one reads: `[years, months, days, hours, minutes, seconds, microseconds]` positions. */
const FIELDS: Readonly<Record<string, readonly number[]>> = {
  YEAR: [0],
  QUARTER: [1],
  MONTH: [1],
  WEEK: [2],
  DAY: [2],
  HOUR: [3],
  MINUTE: [4],
  SECOND: [5],
  MICROSECOND: [6],
  YEAR_MONTH: [0, 1],
  DAY_HOUR: [2, 3],
  DAY_MINUTE: [2, 3, 4],
  DAY_SECOND: [2, 3, 4, 5],
  DAY_MICROSECOND: [2, 3, 4, 5, 6],
  HOUR_MINUTE: [3, 4],
  HOUR_SECOND: [3, 4, 5],
  HOUR_MICROSECOND: [3, 4, 5, 6],
  MINUTE_SECOND: [4, 5],
  MINUTE_MICROSECOND: [4, 5, 6],
  SECOND_MICROSECOND: [5, 6],
}

/** Whether `unit` is one of MySQL's interval units. */
export function isIntervalUnit(unit: string): boolean {
  return FIELDS[unit.toUpperCase()] !== undefined
}

/** A unit of whole days or more, which keeps a DATE a DATE. */
export function isDateUnit(unit: string): boolean {
  const u = unit.toUpperCase()
  return u === 'YEAR' || u === 'QUARTER' || u === 'MONTH' || u === 'WEEK' || u === 'DAY' || u === 'YEAR_MONTH'
}

/** A unit of less than a day, which keeps a TIME a TIME. */
export function isTimeUnit(unit: string): boolean {
  return (FIELDS[unit.toUpperCase()]?.[0] ?? 0) >= 3
}

/** The fractional digits an interval adds to a result: six for a microsecond unit, a SECOND's own scale. */
export function intervalFsp(unit: string, scale: number): number {
  const u = unit.toUpperCase()
  if (u.endsWith('MICROSECOND')) return 6
  return u === 'SECOND' ? Math.min(scale, 6) : 0
}

/** An interval: a count of months, or of microseconds. */
export interface Interval {
  readonly months: bigint
  readonly micros: bigint
}

const US = { day: 86_400_000_000n, hour: 3_600_000_000n, minute: 60_000_000n, second: 1_000_000n }

/** The leading integer of a string, as `strtoll` reads it: `'1.5'` is 1, `'x'` 0. */
function integerPrefix(text: string): bigint {
  const m = /^\s*([+-]?)(\d+)/.exec(text)
  if (m === null) return 0n
  return m[1] === '-' ? -BigInt(m[2] as string) : BigInt(m[2] as string)
}

/** `value unit` as an interval; `undefined` for NULL, or a compound string with more fields than its unit has. */
export function intervalOf(value: Value, unit: string): Interval | undefined {
  if (value === null) return undefined
  const u = unit.toUpperCase()
  const fields = FIELDS[u]
  if (fields === undefined) return undefined
  if (fields.length === 1) {
    if (u === 'SECOND' && (value.kind === 'decimal' || value.kind === 'double')) {
      const d = rescale(toDecimal(value), 6)
      return { months: 0n, micros: d.v }
    }
    const n = value.kind === 'string' && value.ordinal !== undefined ? value.ordinal : value.kind === 'string' || value.kind === 'bytes' ? integerPrefix(textOf(value)) : value.kind === 'double' ? roundDouble(value.v) : value.kind === 'decimal' ? rescale(value, 0).v : value.kind === 'int' ? value.v : integerPrefix(toText(value))
    switch (u) {
      case 'YEAR':
        return { months: n * 12n, micros: 0n }
      case 'QUARTER':
        return { months: n * 3n, micros: 0n }
      case 'MONTH':
        return { months: n, micros: 0n }
      case 'WEEK':
        return { months: 0n, micros: n * 7n * US.day }
      case 'DAY':
        return { months: 0n, micros: n * US.day }
      case 'HOUR':
        return { months: 0n, micros: n * US.hour }
      case 'MINUTE':
        return { months: 0n, micros: n * US.minute }
      case 'SECOND':
        return { months: 0n, micros: n * US.second }
      default:
        return { months: 0n, micros: n }
    }
  }
  // A compound unit reads its value as text: its runs of digits are the
  // fields, aligned to the right, and a leading `-` negates them all.
  const text = toText(value).trim()
  const negative = text.startsWith('-')
  const runs = [...text.matchAll(/\d+/g)].map((m) => m[0])
  if (runs.length > fields.length) return undefined
  const parts = new Array<bigint>(7).fill(0n)
  const offset = fields.length - runs.length
  runs.forEach((digits, i) => {
    const at = fields[offset + i] as number
    // A microsecond field is a fraction: `.5` is 500000, `.000001` is 1.
    parts[at] = at === 6 ? BigInt(digits.slice(0, 6).padEnd(6, '0')) : BigInt(digits)
  })
  const sign = negative ? -1n : 1n
  const [years, months, days, hours, minutes, seconds, micros] = parts as [bigint, bigint, bigint, bigint, bigint, bigint, bigint]
  if (fields[0] === 0) return { months: sign * (years * 12n + months), micros: 0n }
  return { months: 0n, micros: sign * (days * US.day + hours * US.hour + minutes * US.minute + seconds * US.second + micros) }
}

/** `calc_daynr`: days since 0000-00-00 on MySQL's proleptic calendar. */
export function dayNumber(year: number, month: number, day: number): number {
  if (year === 0 && month === 0) return 0
  let delsum = 365 * year + 31 * (month - 1) + day
  let y = year
  if (month <= 2) y--
  else delsum -= Math.trunc((month * 4 + 23) / 10)
  const temp = Math.trunc(((Math.trunc(y / 100) + 1) * 3) / 4)
  return delsum + Math.trunc(y / 4) - temp
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const daysInMonth = (y: number, m: number): number => (m === 2 && isLeap(y) ? 29 : (MONTH_DAYS[m - 1] as number))

/** `get_date_from_daynr`: the date of a day number — the zero date in year 0, as MySQL gives it (`'0001-01-01' - INTERVAL 1 DAY` is `0000-00-00`). */
export function dateOfDayNumber(daynr: number): { year: number; month: number; day: number } {
  if (daynr <= 365 || daynr >= 3652500) return { year: 0, month: 0, day: 0 }
  let year = Math.trunc((daynr * 100) / 36525)
  const temp = Math.trunc(((Math.trunc((year - 1) / 100) + 1) * 3) / 4)
  let dayOfYear = daynr - year * 365 - Math.trunc((year - 1) / 4) + temp
  for (let length = isLeap(year) ? 366 : 365; dayOfYear > length; length = isLeap(year) ? 366 : 365) {
    dayOfYear -= length
    year++
  }
  let month = 1
  while (dayOfYear > daysInMonth(year, month)) {
    dayOfYear -= daysInMonth(year, month)
    month++
  }
  return { year, month, day: dayOfYear }
}

/** The last day number `date_add_interval` accepts: 9999-12-31's. */
const MAX_DAY_NUMBER = 3652424

/** `t` moved by `interval` (subtracted when `negate`), or `undefined` when the result leaves MySQL's range. */
export function addInterval(t: MysqlDateTime, interval: Interval, negate = false): MysqlDateTime | undefined {
  // A zero date, or one with a zero month or day, is no date to move (8.4.11: NULL).
  if (t.month === 0 || t.day === 0) return undefined
  const sign = negate ? -1n : 1n
  if (interval.months !== 0n || interval.micros === 0n) {
    const period = BigInt(t.year) * 12n + BigInt(t.month - 1) + sign * interval.months
    if (period < 0n || period >= 120000n) return undefined
    const year = Number(period / 12n)
    const month = Number(period % 12n) + 1
    return { ...t, year, month, day: Math.min(t.day, daysInMonth(year, month)) }
  }
  const time = BigInt(t.hour) * US.hour + BigInt(t.minute) * US.minute + BigInt(t.second) * US.second + BigInt(t.microsecond)
  const total = BigInt(dayNumber(t.year, t.month, t.day)) * US.day + time + sign * interval.micros
  let days = total / US.day
  let rest = total % US.day
  if (rest < 0n) {
    rest += US.day
    days--
  }
  if (days < 0n || days > BigInt(MAX_DAY_NUMBER)) return undefined
  const date = dateOfDayNumber(Number(days))
  const us = Number(rest)
  return {
    ...date,
    hour: Math.floor(us / 3_600_000_000),
    minute: Math.floor(us / 60_000_000) % 60,
    second: Math.floor(us / 1_000_000) % 60,
    microsecond: us % 1_000_000,
  }
}
