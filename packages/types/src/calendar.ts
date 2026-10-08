// M5.10 — MySQL's calendar, as the date functions count it (`my_time.cc`):
// day numbers from year 0 (`dayNumber`, `dateOfDayNumber` in `interval.ts`),
// weekdays, the eight week numberings WEEK() takes, and periods (YYMM or
// YYYYMM). Each is pinned by `temporal-functions.json`, captured from 8.4.11.
import { dayNumber } from './interval.ts'

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** The last day number a date may have: 9999-12-31's. */
export const MAX_DAY_NUMBER = 3652424

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInYear = (y: number): number => (isLeapYear(y) ? 366 : 365)
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export const daysInMonth = (y: number, m: number): number => (m === 2 && isLeapYear(y) ? 29 : (MONTH_DAYS[m - 1] as number))

/** `calc_weekday`: 0 for Monday, or for Sunday when `sundayFirst`. */
export function weekday(daynr: number, sundayFirst: boolean): number {
  return (daynr + 5 + (sundayFirst ? 1 : 0)) % 7
}

/** WEEK()'s mode as `week_mode` makes it a behaviour: bit 0 Monday first, 1 a week in its year, 2 the first weekday's week is week 1. */
export function weekBehaviour(mode: number): number {
  let behaviour = mode & 7
  if ((behaviour & 1) === 0) behaviour ^= 4
  return behaviour
}

const MONDAY_FIRST = 1
const WEEK_YEAR = 2
const FIRST_WEEKDAY = 4

/** `calc_week`: a date's week number under `behaviour`, and the year it belongs to. */
export function week(year: number, month: number, day: number, behaviour: number): { readonly week: number; readonly year: number } {
  const daynr = dayNumber(year, month, day)
  let first = dayNumber(year, 1, 1)
  const mondayFirst = (behaviour & MONDAY_FIRST) !== 0
  let weekYear = (behaviour & WEEK_YEAR) !== 0
  const firstWeekday = (behaviour & FIRST_WEEKDAY) !== 0
  let wd = weekday(first, !mondayFirst)
  let y = year
  if (month === 1 && day <= 7 - wd) {
    if (!weekYear && ((firstWeekday && wd !== 0) || (!firstWeekday && wd >= 4))) return { week: 0, year: y }
    weekYear = true
    y--
    const days = daysInYear(y)
    first -= days
    wd = (wd + 53 * 7 - days) % 7
  }
  const days = (firstWeekday && wd !== 0) || (!firstWeekday && wd >= 4) ? daynr - (first + (7 - wd)) : daynr - (first - wd)
  if (weekYear && days >= 52 * 7) {
    const next = (wd + daysInYear(y)) % 7
    if ((!firstWeekday && next < 4) || (firstWeekday && next === 0)) return { week: 1, year: y + 1 }
  }
  // `days` is unsigned there: a zero date's wraps (8.4.11: `EXTRACT(WEEK FROM 0)` is 613566757).
  return { week: Math.floor((days < 0 ? days + 2 ** 32 : days) / 7) + 1, year: y }
}

/** A two-digit year as MySQL reads one: 00–69 are 2000–2069, 70–99 1970–1999. */
export const fullYear = (y: number): number => (y < 70 ? y + 2000 : y < 100 ? y + 1900 : y)

/** A period (YYMM or YYYYMM) PERIOD_ADD and PERIOD_DIFF accept: positive, with a month 1–12. */
export const validPeriod = (p: bigint): boolean => p > 0n && p % 100n !== 0n && p % 100n <= 12n

/** `convert_period_to_month`. */
export function periodToMonth(p: bigint): bigint {
  if (p === 0n) return 0n
  let year = p / 100n
  if (year < 70n) year += 2000n
  else if (year < 100n) year += 1900n
  return year * 12n + (p % 100n) - 1n
}

/** `convert_month_to_period`. */
export function monthToPeriod(month: bigint): bigint {
  if (month === 0n) return 0n
  let year = month / 12n
  if (year < 100n) year += year < 70n ? 2000n : 1900n
  return year * 100n + (month % 12n) + 1n
}
