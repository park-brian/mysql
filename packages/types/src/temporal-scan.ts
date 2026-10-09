// Reading text as a DATETIME or a TIME, as MySQL's `str_to_datetime` and
// `str_to_time` read it (mysys/my_time.cc, read for behaviour, not copied).
//
// The rules that a pair of regular expressions got wrong, each checked
// against 8.4.11:
//
//   - A run of digits that reaches the end of the text, or a '.', is the
//     "internal" form, with fixed-width fields: YYMMDD, YYYYMMDD,
//     YYMMDDHHMMSS, YYYYMMDDHHMMSS. The year is four digits when the run is
//     4, 8 or 14 or more digits long, else two. '20102' is 2020-10-02.
//   - Otherwise fields are separated by any punctuation, or by spaces after
//     the day and after the fraction: '20.01.02 03.04.05' is a datetime. Each
//     field has as many digits as it has, so the year may have one to four
//     ('1-01-01' is 0001-01-01), and a two-digit year (not one or three) is
//     1970–2069.
//   - 'T' may separate the date from the time; a time zone displacement
//     (+HH:MM) may follow the seconds or the fraction.
//   - Seven or more fraction digits round on the seventh.
//   - Text after a valid value truncates it, and in a strict mode refuses it.
//   - The checks come after the scan, in this order: the field ranges
//     (month 13, hour 25: "truncated"), then the zero date and zero parts,
//     then the day of the month (February 30: "out of range").
//
// A delimiter other than the standard one, or one too many, is deprecated:
// the first is reported (4095, 4096) when the value is stored.

import type { MysqlDateTime } from '@myjs/bytes'
import { isLeapYear } from './calendar.ts'

/** The first deprecated delimiter in a datetime's text, as the server reports it. */
export interface Deprecation {
  /** 4096 "superfluous", or 4095 "prefer the standard one". */
  readonly superfluous: boolean
  /** Its offset in the text, from 0. */
  readonly position: number
  readonly char: string
  /** The standard delimiter there, for 4095. */
  readonly prefer: '-' | ':' | ' '
}

export interface ScannedDateTime {
  /** The value, its two-digit year expanded, its displacement not yet applied. */
  readonly v: MysqlDateTime
  /** How many fields there were: 3 is a date, more a datetime. */
  readonly fields: number
  /** Fraction digits as written, at most 6. */
  readonly fsp: number
  /** The seventh fraction digit times 100, for rounding. */
  readonly nanoseconds: number
  /** A `+HH:MM` displacement, in seconds. */
  readonly displacement?: number
  /** Text after a valid value. */
  readonly truncated: boolean
  /** All parts zero. */
  readonly zero: boolean
  readonly deprecation?: Deprecation
}

/**
 * Why text is not a datetime. `unreadable`: it never became one (MySQL's
 * TIMESTAMP_NONE). The rest are a value with a bad part (TIMESTAMP_ERROR):
 * a field out of range or too few fields (`truncated`), a zero where the
 * mode forbids one, or a day its month lacks (`out-of-range`).
 */
export type ScanError = 'unreadable' | 'truncated' | 'zero-date' | 'zero-in-date' | 'out-of-range'

export interface ScanFlags {
  /** NO_ZERO_DATE: '0000-00-00' is an error. */
  readonly noZeroDate?: boolean
  /** NO_ZERO_IN_DATE: a zero month or day in a date that is not all zero is an error. */
  readonly noZeroInDate?: boolean
  /** Only a datetime, never a bare date: what `str_to_time` asks of a long text. */
  readonly datetimeOnly?: boolean
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f'
const isPunct = (c: string | undefined): boolean => c !== undefined && /^[!-/:-@[-`{-~]$/.test(c)

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** `{+-}HH:MM`, at most 14 hours, and not -00:00; undefined when it is not one. */
function displacementOf(text: string): number | undefined {
  const m = /^([+-])(\d\d):(\d\d)\s*$/.exec(text)
  if (m === null) return undefined
  const hours = Number(m[2])
  const minutes = Number(m[3])
  if (minutes >= 60) return undefined
  const seconds = hours * 3600 + minutes * 60
  if (seconds > 14 * 3600 || (m[1] === '-' && seconds === 0)) return undefined
  return m[1] === '-' ? -seconds : seconds
}

/** Text as a DATETIME (or a DATE, with three fields): the value, or why it is none. */
export function scanDateTime(text: string, flags: ScanFlags = {}): ScannedDateTime | ScanError {
  let deprecation: Deprecation | undefined
  const deprecate = (d: Deprecation): void => {
    if (deprecation === undefined) deprecation = d
  }
  const end = text.length
  let at = 0
  while (at < end && isSpace(text[at])) {
    deprecate({ superfluous: true, position: at, char: text[at] as string, prefer: ' ' })
    at++
  }
  if (at === end || !isDigit(text[at])) return 'unreadable'

  // The leading run decides the form.
  let run = at
  while (run < end && (isDigit(text[run]) || text[run] === 'T')) run++
  const digits = run - at
  const internal = run === end || text[run] === '.'
  let yearLength = internal ? (digits === 4 || digits === 8 || digits >= 14 ? 4 : 2) : 0
  let width = internal ? yearLength : 4

  const parts = [0, 0, 0, 0, 0, 0, 0, 0]
  const lengths = [0, 0, 0, 0, 0, 0, 0, 0]
  let notZero = false
  let foundDelimiter = false
  let foundSpace = false
  let displacement: number | undefined
  let lastField = at
  let i = 0
  for (; i < 7 && at < end && isDigit(text[at]); i++) {
    const start = at
    let value = Number(text[at++])
    const untilDelimiter = !internal && i !== 6
    while (at < end && isDigit(text[at]) && (untilDelimiter || --width > 0)) {
      value = value * 10 + Number(text[at++])
      if (value > 999999) return 'unreadable'
    }
    lengths[i] = at - start
    parts[i] = value
    if (value !== 0) notZero = true
    width = 2
    lastField = at
    if (at === end) {
      i++
      break
    }
    if (i === 2 && text[at] === 'T') {
      at++
      continue
    }
    if (i === 5) {
      if (text[at] === '.') {
        at++
        lastField = at
        width = 6
      } else if (isDigit(text[at])) {
        i++
        break
      } else if (text[at] === '+' || text[at] === '-') {
        displacement = displacementOf(text.slice(at))
        if (displacement === undefined) return 'unreadable'
        at = end
        lastField = at
      }
      continue
    }
    if (i === 6 && (text[at] === '+' || text[at] === '-')) {
      displacement = displacementOf(text.slice(at))
      if (displacement === undefined) return 'unreadable'
      at = end
      lastField = at
    }
    let seen = false
    while (at < end && (isPunct(text[at]) || isSpace(text[at]))) {
      const c = text[at] as string
      if (seen) deprecate({ superfluous: true, position: at, char: c, prefer: ' ' })
      if (isSpace(c)) {
        // Spaces belong after the day and after the fraction only.
        if (i !== 2 && i !== 6) return 'unreadable'
        if (i === 6) deprecate({ superfluous: true, position: at, char: c, prefer: ' ' })
        foundSpace = true
        if (c !== ' ') deprecate({ superfluous: false, position: at, char: c, prefer: ' ' })
      } else if (!((c === '-' && i < 2) || (c === ':' && (i === 3 || i === 4))) && i !== 2) {
        // 4.12.3 keeps its dots: as 4-12-3 it would be another year.
        if (!(internal && yearLength === 2 && lengths[0] === 1)) deprecate({ superfluous: false, position: at, char: c, prefer: i > 1 ? ':' : '-' })
      } else if (i === 2 && (c !== '.' || !internal)) {
        deprecate({ superfluous: false, position: at, char: c, prefer: ' ' })
      }
      at++
      seen = true
      foundDelimiter = true
    }
    if (i === 6) i++
    lastField = at
  }
  if (foundDelimiter) {
    if (foundSpace && i === 3 && at === end) deprecate({ superfluous: true, position: at - 1, char: text[at - 1] as string, prefer: ' ' })
    else if (!foundSpace && flags.datetimeOnly === true) return 'unreadable'
  }
  at = lastField
  const fields = i
  if (!internal) {
    yearLength = lengths[0] as number
    if (yearLength === 0) return 'unreadable'
  }
  const fsp = lengths[6] as number
  const fraction = (parts[6] as number) * 10 ** (6 - Math.min(6, fsp))
  let year = parts[0] as number
  if (yearLength === 2 && notZero) year += year < 70 ? 2000 : 1900
  const v: MysqlDateTime = { year, month: parts[1] as number, day: parts[2] as number, hour: parts[3] as number, minute: parts[4] as number, second: parts[5] as number, microsecond: fraction }

  if (fields < 3 || v.year > 9999 || v.month > 12 || v.day > 31 || v.hour > 23 || v.minute > 59 || v.second > 59) {
    // Zero parts followed by nothing but spaces are the zero date's error; anything else is truncation.
    return notZero || text.slice(at).trim() !== '' ? 'truncated' : 'zero-date'
  }
  if (notZero) {
    if (flags.noZeroInDate === true && (v.month === 0 || v.day === 0)) return 'zero-in-date'
    if (v.month !== 0 && v.day > (DAYS[v.month - 1] as number) && !(v.month === 2 && v.day === 29 && isLeapYear(v.year))) return 'out-of-range'
  } else if (flags.noZeroDate === true) return 'zero-date'

  let nanoseconds = 0
  if (fsp >= 6 && at < end && isDigit(text[at])) {
    nanoseconds = 100 * Number(text[at])
    while (at < end && isDigit(text[at])) at++
  }
  if (at < end && (text[at] === '+' || text[at] === '-')) {
    displacement = displacementOf(text.slice(at))
    if (displacement === undefined) return 'unreadable'
    at = end
  }
  let truncated = false
  for (; at < end; at++) {
    if (!isSpace(text[at])) {
      truncated = true
      break
    }
    deprecate({ superfluous: true, position: at, char: text[at] as string, prefer: ' ' })
  }
  return { v, fields, fsp: Math.min(6, fsp), nanoseconds, ...(displacement === undefined ? {} : { displacement }), truncated, zero: !notZero, ...(deprecation === undefined ? {} : { deprecation }) }
}

export interface ScannedTime {
  readonly negative: boolean
  /** Hours, days folded in; up to 838, or more before `out-of-range` clamps it. */
  readonly hours: number
  readonly minute: number
  readonly second: number
  readonly microsecond: number
  readonly fsp: number
  readonly nanoseconds: number
  readonly truncated: boolean
  /** Past ±838:59:59, clamped to it. */
  readonly clamped: boolean
  /** A full datetime read as a time: its time of day, as `str_to_time` keeps it. */
  readonly datetime?: ScannedDateTime
  readonly deprecation?: Deprecation
}

/** Text as a TIME: '10:00:00', '-1 02:03', '100000', '10.5', or a datetime's time of day. */
export function scanTime(text: string): ScannedTime | ScanError {
  let deprecation: Deprecation | undefined
  const deprecate = (d: Deprecation): void => {
    if (deprecation === undefined) deprecation = d
  }
  const end = text.length
  let at = 0
  while (at < end && isSpace(text[at])) {
    deprecate({ superfluous: true, position: at, char: text[at] as string, prefer: ' ' })
    at++
  }
  let negative = false
  if (at < end && text[at] === '-') {
    negative = true
    at++
  }
  if (at === end) return 'truncated'
  const start = at

  // A long text is probably a whole timestamp.
  if (end - at >= 12) {
    // A datetime with a bad part is no time either; only text that never
    // became a datetime is read as a time instead (`str_to_time`).
    const full = scanDateTime(text.slice(at), { datetimeOnly: true })
    if (typeof full === 'string' && full !== 'unreadable') return 'truncated'
    if (typeof full !== 'string') {
      if (negative) return 'truncated'
      const v = full.v
      // A displacement moves the time of day into the session's zone, UTC.
      const day = 86400
      const shifted = (((v.hour * 3600 + v.minute * 60 + v.second - (full.displacement ?? 0)) % day) + day) % day
      return { negative: false, hours: Math.floor(shifted / 3600), minute: Math.floor(shifted / 60) % 60, second: shifted % 60, microsecond: v.microsecond, fsp: full.fsp, nanoseconds: full.nanoseconds, truncated: full.truncated, clamped: false, datetime: full, ...(full.deprecation === undefined ? {} : { deprecation: full.deprecation }) }
    }
  }

  const number = (): number => {
    let value = 0
    while (at < end && isDigit(text[at])) value = value * 10 + Number(text[at++])
    return value
  }
  const parts = [0, 0, 0, 0, 0]
  let value = number()
  if (value > 4294967295) return 'truncated'
  const endOfDays = at
  let spaces = 0
  while (at < end && isSpace(text[at])) {
    at++
    spaces++
  }
  if (spaces > 1 || (spaces === 1 && at === end)) deprecate({ superfluous: true, position: endOfDays, char: text[endOfDays] as string, prefer: ' ' })
  let state: number
  let compact = false
  if (end - at > 1 && at !== endOfDays && isDigit(text[at])) {
    // Days, then hours.
    parts[0] = value
    state = 1
  } else if (end - at > 1 && text[at] === ':' && isDigit(text[at + 1])) {
    parts[1] = value
    state = 2
    at++
  } else {
    // [H]HMMSS, read from the right.
    parts[1] = Math.floor(value / 10000)
    parts[2] = Math.floor(value / 100) % 100
    parts[3] = value % 100
    state = 4
    compact = true
  }
  if (!compact) {
    const days = state === 1
    const hours = state === 2
    for (;;) {
      value = number()
      parts[state++] = value
      if (state === 4 || end - at < 2 || text[at] !== ':' || !isDigit(text[at + 1])) break
      at++
    }
    if (state !== 4) {
      if (!hours && !days) {
        // Fewer fields than HH:MM:SS from a bare number: they are the last ones.
        const got = parts.slice(1, state)
        parts[1] = 0
        parts[2] = 0
        parts[3] = 0
        got.forEach((p, k) => {
          parts[4 - got.length + k] = p
        })
      } else for (let k = state; k < 4; k++) parts[k] = 0
    }
  }
  let fsp = 0
  let nanoseconds = 0
  if (end - at >= 2 && text[at] === '.' && isDigit(text[at + 1])) {
    at++
    let digits = 0
    let fraction = 0
    while (at < end && isDigit(text[at])) {
      if (digits < 6) fraction = fraction * 10 + Number(text[at])
      else if (digits === 6) nanoseconds = 100 * Number(text[at])
      digits++
      at++
    }
    fsp = Math.min(6, digits)
    parts[4] = fraction * 10 ** (6 - fsp)
  } else if (end - at === 1 && text[at] === '.') at++
  if (end - at > 1 && (text[at] === 'e' || text[at] === 'E') && (isDigit(text[at + 1]) || ((text[at + 1] === '-' || text[at + 1] === '+') && end - at > 2 && isDigit(text[at + 2])))) return 'truncated'
  const minute = parts[2] as number
  const second = parts[3] as number
  if (minute >= 60 || second >= 60) return 'out-of-range'
  let hours = (parts[1] as number) + (parts[0] as number) * 24
  let microsecond = parts[4] as number
  let mm = minute
  let ss = second
  // Past 838:59:59 is 838:59:59 (`adjust_time_range`).
  const clamped = hours > 838 || (hours === 838 && mm === 59 && ss === 59 && microsecond > 0)
  if (clamped) {
    hours = 838
    mm = 59
    ss = 59
    microsecond = 0
  }
  let truncated = false
  for (; at < end; at++) {
    if (!isSpace(text[at])) {
      truncated = true
      if (at === start) return 'truncated'
      break
    }
    deprecate({ superfluous: true, position: at, char: text[at] as string, prefer: ' ' })
  }
  return { negative, hours, minute: mm, second: ss, microsecond, fsp, nanoseconds, truncated, clamped, ...(deprecation === undefined ? {} : { deprecation }) }
}
