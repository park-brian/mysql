// M5.10 — DATE_FORMAT's specifiers, and STR_TO_DATE's reading of them
// (`make_date_time` and `extract_date_time`), in the en_US locale. Each is
// pinned by `temporal-functions.json`, captured from 8.4.11.
import type { MysqlDateTime } from '@myjs/bytes'
import { DAY_NAMES, MAX_DAY_NUMBER, MONTH_NAMES, daysInMonth, fullYear, week, weekday } from './calendar.ts'
import { dateOfDayNumber, dayNumber } from './interval.ts'

const pad = (n: number, width: number): string => {
  const s = String(Math.abs(n))
  return (n < 0 ? '-' : '') + s.padStart(width, '0')
}

const suffix = (day: number): string => (day >= 10 && day <= 19 ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th')

/** A broken-down value to format: a datetime, or a TIME whose hours are not cut at 24. */
export interface Broken {
  readonly negative: boolean
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly microsecond: number
}

/**
 * `make_date_time`: `value` written by `format`, or undefined where a
 * specifier has nothing to show (a month name of month 0, a weekday of a
 * TIME). `time` is TIME_FORMAT's: its value is a TIME.
 */
export function formatDateTime(value: Broken, format: string, time: boolean): string | undefined {
  let out = value.negative ? '-' : ''
  const { year, month, day, hour, minute, second } = value
  const noDate = month === 0 && year === 0
  for (let i = 0; i < format.length; i++) {
    const c = format[i] as string
    if (c !== '%' || i + 1 === format.length) {
      out += c
      continue
    }
    const s = format[++i] as string
    switch (s) {
      case 'M':
        if (month === 0) return undefined
        out += MONTH_NAMES[month - 1]
        break
      case 'b':
        if (month === 0) return undefined
        out += (MONTH_NAMES[month - 1] as string).slice(0, 3)
        break
      case 'W':
      case 'a': {
        if (time || noDate) return undefined
        const name = DAY_NAMES[weekday(dayNumber(year, month, day), false)] as string
        out += s === 'W' ? name : name.slice(0, 3)
        break
      }
      case 'D':
        if (time) return undefined
        out += String(day) + suffix(day)
        break
      case 'Y':
        out += pad(year, 4)
        break
      case 'y':
        out += pad(year % 100, 2)
        break
      case 'm':
        out += pad(month, 2)
        break
      case 'c':
        out += String(month)
        break
      case 'd':
        out += pad(day, 2)
        break
      case 'e':
        out += String(day)
        break
      case 'f':
        out += pad(value.microsecond, 6)
        break
      case 'H':
        out += pad(hour, 2)
        break
      case 'h':
      case 'I':
        out += pad(((hour % 24) + 11) % 12 + 1, 2)
        break
      case 'i':
        out += pad(minute, 2)
        break
      case 'j': {
        if (time) return undefined
        out += pad(dayNumber(year, month, day) - dayNumber(year, 1, 1) + 1, 3)
        break
      }
      case 'k':
        out += String(hour)
        break
      case 'l':
        out += String(((hour % 24) + 11) % 12 + 1)
        break
      case 'p':
        out += hour % 24 < 12 ? 'AM' : 'PM'
        break
      case 'r':
        out += `${pad(((hour % 24) + 11) % 12 + 1, 2)}:${pad(minute, 2)}:${pad(second, 2)} ${hour % 24 < 12 ? 'AM' : 'PM'}`
        break
      case 'S':
      case 's':
        out += pad(second, 2)
        break
      case 'T':
        out += `${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`
        break
      case 'U':
      case 'u':
        if (time) return undefined
        out += pad(week(year, month, day, s === 'U' ? 4 : 1).week, 2)
        break
      case 'V':
      case 'v':
        if (time) return undefined
        out += pad(week(year, month, day, s === 'V' ? 6 : 3).week, 2)
        break
      case 'X':
      case 'x':
        if (time) return undefined
        out += pad(week(year, month, day, s === 'X' ? 6 : 3).year, 4)
        break
      case 'w':
        if (time || noDate) return undefined
        out += String(weekday(dayNumber(year, month, day), true))
        break
      default:
        out += s
    }
  }
  return out
}

/** `Item_func_date_format::format_length`: the characters a format can write. */
export function formatLength(format: string): number {
  let size = 0
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== '%' || i === format.length - 1) {
      size++
      continue
    }
    const s = format[++i] as string
    if (s === 'M' || s === 'W') size += 64
    else if ('DYxX'.includes(s)) size += 4
    else if (s === 'a' || s === 'b') size += 32
    else if (s === 'j') size += 3
    else if ('UuVvymdhIilpSsce'.includes(s)) size += 2
    else if (s === 'k' || s === 'H') size += 7
    else if (s === 'r') size += 11
    else if (s === 'T') size += 8
    else if (s === 'f') size += 6
    else size++
  }
  return size
}

/** What STR_TO_DATE's format asks for: a date, a time, or both, and whether a fraction. */
export function formatShape(format: string): { readonly date: boolean; readonly time: boolean; readonly fraction: boolean } {
  let date = false
  let time = false
  let fraction = false
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== '%' || i === format.length - 1) continue
    const s = format[++i] as string
    if ('aDdejMmbcUuVvWwXxYyj'.includes(s)) date = true
    else if ('HhIiklpSsTr'.includes(s)) time = true
    else if (s === 'f') {
      time = true
      fraction = true
    }
  }
  return { date, time, fraction }
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f'
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'

/** A whole number of at most `width` characters at `at`, as `my_strtoll10` reads it; undefined when none. */
function numberAt(text: string, at: number, width: number): { readonly n: number; readonly end: number } | undefined {
  const limit = Math.min(text.length, at + width)
  let i = at
  let negative = false
  if (text[i] === '-' || text[i] === '+') {
    negative = text[i] === '-'
    i++
  }
  const start = i
  let n = 0
  while (i < limit && isDigit(text[i])) n = n * 10 + Number(text[i++])
  if (i === start) return undefined
  return { n: negative ? -n : n, end: i }
}

/** A name from `names` at `at`, case-insensitively, the longest that fits: `check_word`. */
function wordAt(text: string, at: number, names: readonly string[]): { readonly n: number; readonly end: number } | undefined {
  let end = at
  while (end < text.length && /[A-Za-z]/.test(text[end] as string)) end++
  const word = text.slice(at, end).toLowerCase()
  if (word === '') return undefined
  const index = names.findIndex((n) => n.toLowerCase() === word)
  return index < 0 ? undefined : { n: index + 1, end }
}

export interface Extracted {
  readonly v: MysqlDateTime
  /** Text was left over after the format: a warning, the value kept. */
  readonly truncated: boolean
}

/**
 * `extract_date_time`: `text` read by `format`, or undefined (1411,
 * "Incorrect … value … for function str_to_date"). `time` when the result
 * is a TIME, which may be the zero date.
 */
export function extractDateTime(text: string, format: string, flags: { readonly noZeroDate: boolean; readonly noZeroInDate: boolean }): Extracted | undefined {
  const t = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }
  let weekdayN = 0
  let yearday = 0
  let daypart = 0
  let weekNumber = -1
  let strictYear = -1
  let usa = false
  let sundayFirst = false
  let strict = false
  let strictYearType = false
  let at = 0
  const run = (fmt: string, sub: boolean): boolean => {
    void sub
    for (let p = 0; p < fmt.length && at < text.length; p++) {
      while (at < text.length && isSpace(text[at])) at++
      if (at >= text.length) break
      if (fmt[p] === '%' && p + 1 < fmt.length) {
        const s = fmt[++p] as string
        const left = text.length - at
        let got: { readonly n: number; readonly end: number } | undefined
        switch (s) {
          case 'Y':
            got = numberAt(text, at, Math.min(4, left))
            if (got === undefined) return false
            t.year = got.end - at <= 2 ? fullYear(got.n) : got.n
            break
          case 'y':
            got = numberAt(text, at, Math.min(2, left))
            if (got === undefined) return false
            t.year = fullYear(got.n)
            break
          case 'm':
          case 'c':
            got = numberAt(text, at, 2)
            if (got === undefined) return false
            t.month = got.n
            break
          case 'M':
            got = wordAt(text, at, MONTH_NAMES)
            if (got === undefined) return false
            t.month = got.n
            break
          case 'b':
            got = wordAt(
              text,
              at,
              MONTH_NAMES.map((m) => m.slice(0, 3)),
            )
            if (got === undefined) return false
            t.month = got.n
            break
          case 'd':
          case 'e':
            got = numberAt(text, at, 2)
            if (got === undefined) return false
            t.day = got.n
            break
          case 'D':
            got = numberAt(text, at, 2)
            if (got === undefined) return false
            t.day = got.n
            got = { n: got.n, end: Math.min(text.length, got.end + 2) }
            break
          case 'h':
          case 'I':
          case 'l':
            usa = true
          // falls through
          case 'k':
          case 'H':
            got = numberAt(text, at, 2)
            if (got === undefined) return false
            t.hour = got.n
            break
          case 'i':
            got = numberAt(text, at, 2)
            if (got === undefined) return false
            t.minute = got.n
            break
          case 's':
          case 'S':
            got = numberAt(text, at, 2)
            if (got === undefined) return false
            t.second = got.n
            break
          case 'f': {
            got = numberAt(text, at, 6)
            if (got === undefined) return false
            t.microsecond = got.n * 10 ** (6 - (got.end - at))
            break
          }
          case 'p': {
            if (left < 2 || !usa) return false
            const ampm = text.slice(at, at + 2).toUpperCase()
            if (ampm === 'PM') daypart = 12
            else if (ampm !== 'AM') return false
            got = { n: 0, end: at + 2 }
            break
          }
          case 'W':
            got = wordAt(text, at, DAY_NAMES)
            if (got === undefined) return false
            weekdayN = got.n
            break
          case 'a':
            got = wordAt(
              text,
              at,
              DAY_NAMES.map((d) => d.slice(0, 3)),
            )
            if (got === undefined) return false
            weekdayN = got.n
            break
          case 'w':
            got = numberAt(text, at, 1)
            if (got === undefined || got.n < 0 || got.n >= 7) return false
            weekdayN = got.n === 0 ? 7 : got.n
            break
          case 'j':
            got = numberAt(text, at, 3)
            if (got === undefined) return false
            yearday = got.n
            break
          case 'V':
          case 'U':
          case 'v':
          case 'u':
            sundayFirst = s === 'U' || s === 'V'
            strict = s === 'V' || s === 'v'
            got = numberAt(text, at, 2)
            if (got === undefined || got.n < 0 || (strict && got.n === 0) || got.n > 53) return false
            weekNumber = got.n
            break
          case 'X':
          case 'x':
            strictYearType = s === 'X'
            got = numberAt(text, at, 4)
            if (got === undefined) return false
            strictYear = got.n
            break
          case 'r':
          case 'T': {
            // A compound specifier is its own pattern, its hour read and settled within it.
            const saved = [usa, daypart] as const
            usa = false
            daypart = 0
            const ok = run(s === 'r' ? '%I:%i:%S %p' : '%H:%i:%S', true)
            ;[usa, daypart] = saved
            if (!ok) return false
            continue
          }
          case '.':
            while (at < text.length && /[!-/:-@[-`{-~]/.test(text[at] as string)) at++
            continue
          case '@':
            while (at < text.length && /[A-Za-z]/.test(text[at] as string)) at++
            continue
          case '#':
            while (at < text.length && isDigit(text[at])) at++
            continue
          default:
            return false
        }
        at = got.end
      } else if (!isSpace(fmt[p])) {
        if (text[at] !== fmt[p]) return false
        at++
      }
    }
    if (usa) {
      if (t.hour > 12 || t.hour < 1) return false
      t.hour = (t.hour % 12) + daypart
    }
    return true
  }
  if (!run(format, false)) return undefined
  if (yearday > 0) {
    const days = dayNumber(t.year, 1, 1) + yearday - 1
    if (days <= 0 || days > MAX_DAY_NUMBER) return undefined
    Object.assign(t, dateOfDayNumber(days))
  }
  if (weekNumber >= 0 && weekdayN !== 0) {
    if ((strict && (strictYear < 0 || strictYearType !== sundayFirst)) || (!strict && strictYear >= 0)) return undefined
    let days = dayNumber(strict ? strictYear : t.year, 1, 1)
    const first = weekday(days, sundayFirst)
    days += sundayFirst ? (first === 0 ? 0 : 7) - first + (weekNumber - 1) * 7 + (weekdayN % 7) : (first <= 3 ? 0 : 7) - first + (weekNumber - 1) * 7 + (weekdayN - 1)
    if (days <= 0 || days > MAX_DAY_NUMBER) return undefined
    Object.assign(t, dateOfDayNumber(days))
  }
  if (t.year > 9999 || t.month > 12 || t.day > 31 || t.hour > 23 || t.minute > 59 || t.second > 59) return undefined
  const zero = t.year === 0 && t.month === 0 && t.day === 0
  if (zero ? flags.noZeroDate : (flags.noZeroInDate && (t.month === 0 || t.day === 0)) || (t.month !== 0 && t.day > daysInMonth(t.year, t.month))) return undefined
  let truncated = false
  for (let i = at; i < text.length; i++) {
    if (!isSpace(text[i])) {
      truncated = true
      break
    }
  }
  return { v: t, truncated }
}
