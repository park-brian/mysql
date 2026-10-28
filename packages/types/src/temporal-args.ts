// M5.10 — a value as a date function reads it: `Item::get_date` and
// `Item::get_time`. A temporal is itself; text is read as `str_to_datetime`
// or `str_to_time` reads it (`temporal-scan.ts`); a number by its digits, as
// `int_to_datetime` and `int_to_time` read them, its fraction a fraction of a
// second. What cannot be read is NULL with a 1292 warning, whose text the
// caller raises; what can be read but was cut short warns too and is kept.
import type { MysqlDateTime, MysqlTime } from '@myjs/bytes'
import { scanDateTime, scanTime, type Deprecation } from './temporal-scan.ts'
import { parseTime, textOf, toDecimal, toText, type Value } from './sql-value.ts'
import { timeFromSeconds, addDateTimeSeconds, TIME_MAX_SECONDS } from './temporal.ts'
import { daysInMonth } from './calendar.ts'

export interface DateFlags {
  /** NO_ZERO_DATE: '0000-00-00' is no date. */
  readonly noZeroDate?: boolean
  /** NO_ZERO_IN_DATE: a zero month or day is none either. */
  readonly noZeroInDate?: boolean
  /** Keep the first six fraction digits instead of rounding nanoseconds. */
  readonly truncateFractional?: boolean
}

/** A conversion's value, or NULL, and the warning it raises, if any. */
export interface Converted<T> {
  readonly v: T | null
  readonly warning?: string
  /** The value's fraction digits, where the reading knows them. */
  readonly fsp?: number
  /** A delimiter the text should not have used (4095, 4096), and the text, for the note. */
  readonly deprecation?: { readonly d: Deprecation; readonly text: string }
}

const ZERO_TIME: MysqlTime = { negative: false, days: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }

const incorrect = (what: string, text: string): string => `Incorrect ${what} value: '${text}'`
const truncated = (what: string, text: string): string => `Truncated incorrect ${what} value: '${text}'`

const isZero = (v: MysqlDateTime): boolean => v.year === 0 && v.month === 0 && v.day === 0

/** `check_date`: whether a date the flags forbid. */
function forbidden(v: MysqlDateTime, flags: DateFlags): boolean {
  if (isZero(v)) return flags.noZeroDate === true && v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0
  return flags.noZeroInDate === true && (v.month === 0 || v.day === 0)
}

/** `int_to_datetime`: YYMMDD, YYYYMMDD, YYMMDDHHMMSS or YYYYMMDDHHMMSS, or undefined. */
export function numberToDateTime(n: bigint): MysqlDateTime | undefined {
  let nr = n
  if (nr < 0n) return undefined
  if (nr !== 0n && nr < 10000101000000n) {
    if (nr < 101n) return undefined
    if (nr <= 691231n) nr = (nr + 20000000n) * 1000000n
    else if (nr < 700101n) return undefined
    else if (nr <= 991231n) nr = (nr + 19000000n) * 1000000n
    else if (nr <= 99991231n) nr *= 1000000n
    else if (nr < 101000000n) return undefined
    else if (nr <= 691231235959n) nr += 20000000000000n
    else if (nr < 700101000000n) return undefined
    else if (nr <= 991231235959n) nr += 19000000000000n
  } else if (nr > 99999999999999n) return undefined
  const date = Number(nr / 1000000n)
  const time = Number(nr % 1000000n)
  const v: MysqlDateTime = {
    year: Math.floor(date / 10000),
    month: Math.floor(date / 100) % 100,
    day: date % 100,
    hour: Math.floor(time / 10000),
    minute: Math.floor(time / 100) % 100,
    second: time % 100,
    microsecond: 0,
  }
  if (v.year > 9999 || v.month > 12 || v.day > 31 || v.hour > 23 || v.minute > 59 || v.second > 59) return undefined
  if (!isZero(v) && v.month !== 0 && v.day !== 0 && v.day > daysInMonth(v.year, v.month)) return undefined
  return v
}


/** A number's whole part and its fraction in nanoseconds, both carrying its sign: `my_decimal2lldiv_t`. */
function wholeAndNanos(v: Exclude<Value, null>): { readonly whole: bigint; readonly nanos: bigint } | undefined {
  if (v.kind === 'int') return { whole: v.v, nanos: 0n }
  if (v.kind === 'double' && !Number.isFinite(v.v)) return undefined
  const d = toDecimal(v)
  const scale = BigInt(d.scale)
  const unit = 10n ** scale
  const whole = d.v / unit
  const rest = d.v - whole * unit
  // To nanoseconds, the tenth digit rounding the ninth.
  const nanos = scale <= 9n ? rest * 10n ** (9n - scale) : (rest + (rest < 0n ? -1n : 1n) * (10n ** (scale - 9n) / 2n)) / 10n ** (scale - 9n)
  return { whole, nanos }
}

/** The native nanosecond rounding boundary; sign, carry and range belong to callers. */
const microsFromNanos = (nanos: bigint, truncate: boolean): number => Number((nanos + (truncate ? 0n : 500n)) / 1000n)

/** A datetime moved forward by microseconds that may carry into the second, minute, hour or day. */
function carry(v: MysqlDateTime, us: number): MysqlDateTime | undefined {
  const out = addDateTimeSeconds(v, 0, us - v.microsecond)
  return out.year > 9999 ? undefined : out
}

/**
 * `Item::get_date`: a value as a datetime. `today` is the date a TIME is
 * put on. NULL in, NULL out, with no warning.
 */
export function dateOf(value: Value, flags: DateFlags, today: () => MysqlDateTime): Converted<MysqlDateTime> {
  if (value === null) return { v: null }
  switch (value.kind) {
    case 'datetime':
      // A temporal the flags refuse is NULL without a word (`Field::get_date`).
      return forbidden(value.v, flags) ? { v: null } : { v: value.v, fsp: value.fsp }
    case 'time': {
      const t = today()
      const us = (((value.v.days * 24 + value.v.hour) * 60 + value.v.minute) * 60 + value.v.second) * 1_000_000 + value.v.microsecond
      const signed = value.v.negative ? -us : us
      const seconds = Math.floor(signed / 1_000_000)
      const d = new Date(Date.UTC(t.year, t.month - 1, t.day) + seconds * 1000)
      return { v: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), microsecond: signed - seconds * 1_000_000 }, fsp: value.fsp }
    }
    case 'string':
    case 'bytes':
    case 'json': {
      const text = value.kind === 'json' ? toText(value) : textOf(value)
      const s = scanDateTime(text, flags)
      if (typeof s === 'string') return { v: null, warning: incorrect('datetime', text) }
      const noted = s.deprecation === undefined ? {} : { deprecation: { d: s.deprecation, text } }
      let v = s.v
      if (!flags.truncateFractional && s.nanoseconds >= 500) {
        const c = carry(v, v.microsecond + 1)
        if (c === undefined) return { v: null, warning: incorrect('datetime', text), ...noted }
        v = c
      }
      return s.truncated ? { v, fsp: s.fsp, warning: truncated('datetime', text), ...noted } : { v, fsp: s.fsp, ...noted }
    }
    default: {
      const text = toText(value)
      const n = wholeAndNanos(value)
      if (n === undefined || n.whole < 0n || n.nanos < 0n) return { v: null, warning: incorrect('datetime', text) }
      const v = numberToDateTime(n.whole)
      if (v === undefined || forbidden(v, flags)) return { v: null, warning: incorrect('datetime', text) }
      if (n.nanos === 0n) return { v, fsp: 0 }
      // A date has no fraction to keep: it is dropped, with a word (8.4.11: '101112.5').
      if (n.whole !== 0n && n.whole <= 99991231n) return { v, fsp: 0, warning: truncated('date', text) }
      const c = carry(v, microsFromNanos(n.nanos, flags.truncateFractional === true))
      return c === undefined ? { v: null, warning: incorrect('datetime', text) } : { v: c, fsp: 6 }
    }
  }
}

/** `int_to_time`: HHMMSS, signed, or past 838:59:59 a datetime's time of day, or clamped. */
function numberToTime(n: bigint): { readonly v: MysqlTime; readonly bad: boolean; readonly clamped: boolean } {
  const MAX = 8385959n
  if (n > MAX) {
    if (n >= 10000000000n) {
      const dt = numberToDateTime(n)
      if (dt !== undefined) return { v: { ...ZERO_TIME, hour: dt.hour, minute: dt.minute, second: dt.second }, bad: false, clamped: false }
    }
  }
  if (n > MAX || n < -MAX) return { v: timeFromSeconds(n < 0n, TIME_MAX_SECONDS, 0), bad: false, clamped: true }
  const negative = n < 0n
  const a = negative ? -n : n
  if (a % 100n >= 60n || (a / 100n) % 100n >= 60n) return { v: ZERO_TIME, bad: true, clamped: false }
  const seconds = Number(a / 10000n) * 3600 + Number((a / 100n) % 100n) * 60 + Number(a % 100n)
  return { v: timeFromSeconds(negative, seconds, 0), bad: false, clamped: false }
}

/** `Item::get_time`: a value as a TIME. A datetime is its time of day. */
export function timeOf(value: Value, truncate = false): Converted<MysqlTime> {
  if (value === null) return { v: null }
  switch (value.kind) {
    case 'time':
      return { v: value.v, fsp: value.fsp }
    case 'datetime':
      return { v: { ...ZERO_TIME, hour: value.v.hour, minute: value.v.minute, second: value.v.second, microsecond: value.v.microsecond }, fsp: value.fsp }
    case 'string':
    case 'bytes':
    case 'json': {
      const text = value.kind === 'json' ? toText(value) : textOf(value)
      const p = parseTime(text, truncate)
      if (p === undefined) return { v: null, warning: truncated('time', text) }
      return { v: p.v, fsp: p.fsp, ...(p.truncated || p.clamped ? { warning: truncated('time', text) } : {}) }
    }
    default: {
      const text = toText(value)
      const n = wholeAndNanos(value)
      if (n === undefined) return { v: null, warning: truncated('time', text) }
      const t = numberToTime(n.whole)
      // Out of range is an error for a number (`int_to_time`), where text is clamped.
      if (t.bad || t.clamped) return { v: null, warning: truncated('time', text) }
      if (n.nanos === 0n) return { v: t.v, fsp: 0 }
      // The fraction rounds at the microsecond, carrying into the second.
      const us = microsFromNanos(n.nanos < 0n ? -n.nanos : n.nanos, truncate)
      const negative = t.v.negative || n.whole < 0n || n.nanos < 0n
      const seconds = ((t.v.days * 24 + t.v.hour) * 60 + t.v.minute) * 60 + t.v.second + (us === 1_000_000 ? 1 : 0)
      if (seconds > TIME_MAX_SECONDS || (truncate && seconds === TIME_MAX_SECONDS && us > 0)) return { v: timeFromSeconds(negative, TIME_MAX_SECONDS, 0), fsp: 6, warning: truncated('time', text) }
      return { v: timeFromSeconds(negative, seconds, us === 1_000_000 ? 0 : us), fsp: 6 }
    }
  }
}

/**
 * `MYSQL_TIME`: what `get_date` and `get_time` fill in, its type kept. A
 * TIME's hours are whole (up to 838) and its date zero; a DATE or a
 * DATETIME read as a time keeps its date, which TIMEDIFF and ADDTIME look at.
 */
export interface TimeStruct {
  readonly type: 'DATE' | 'DATETIME' | 'TIME'
  readonly negative: boolean
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly microsecond: number
}

/** A failed reading as any other type's. */
const failed = <T>(c: Converted<unknown>): Converted<T> => (c.warning === undefined ? { v: null } : { v: null, warning: c.warning })

const fromDateTime = (v: MysqlDateTime, type: 'DATE' | 'DATETIME'): TimeStruct => ({ type, negative: false, ...v })
const fromTime = (t: MysqlTime): TimeStruct => ({ type: 'TIME', negative: t.negative, year: 0, month: 0, day: 0, hour: t.days * 24 + t.hour, minute: t.minute, second: t.second, microsecond: t.microsecond })

/** `get_date` with its type: a DATE or a DATETIME. */
export function dateStructOf(value: Value, flags: DateFlags, today: () => MysqlDateTime): Converted<TimeStruct> {
  if (value === null) return { v: null }
  const c = dateOf(value, flags, today)
  if (c.v === null) return failed(c)
  let type: 'DATE' | 'DATETIME' = 'DATETIME'
  if (value.kind === 'datetime') type = value.type === 'DATE' ? 'DATE' : 'DATETIME'
  else if (value.kind === 'string' || value.kind === 'bytes') {
    const s = scanDateTime(textOf(value), flags)
    type = typeof s !== 'string' && s.fields <= 3 ? 'DATE' : 'DATETIME'
  } else if (value.kind === 'int' || value.kind === 'decimal' || value.kind === 'double') {
    const n = wholeAndNanos(value)
    type = n !== undefined && n.whole !== 0n && n.whole <= 99991231n ? 'DATE' : 'DATETIME'
  }
  return { ...c, v: fromDateTime(c.v, type) }
}

/** `get_time` with its type: a TIME, or a DATE or DATETIME a long text or number turned out to be. */
export function timeStructOf(value: Value, field = false, truncate = false): Converted<TimeStruct> {
  if (value === null) return { v: null }
  switch (value.kind) {
    case 'datetime':
      // A column keeps its date (`Field::get_time`); any other date-valued expression is its time of day.
      if (field) return { v: fromDateTime(value.v, value.type === 'DATE' ? 'DATE' : 'DATETIME'), fsp: value.fsp }
      break
    case 'time':
      break
    case 'string':
    case 'bytes':
    case 'json': {
      const text = value.kind === 'json' ? toText(value) : textOf(value)
      const s = scanTime(text)
      if (typeof s !== 'string' && s.datetime !== undefined) {
        const d = dateOf(value, { truncateFractional: truncate }, () => s.datetime?.v as MysqlDateTime)
        if (d.v !== null) return { ...d, v: fromDateTime(d.v, 'DATETIME') }
      }
      break
    }
    default: {
      const n = wholeAndNanos(value)
      if (n !== undefined && n.whole > 8385959n && n.whole >= 10000000000n) {
        const dt = numberToDateTime(n.whole)
        if (dt !== undefined) {
          const us = microsFromNanos(n.nanos, truncate)
          const v = carry(dt, us)
          if (v !== undefined) return { v: fromDateTime(v, 'DATETIME'), fsp: n.nanos === 0n ? 0 : 6 }
        }
      }
      break
    }
  }
  const c = timeOf(value, truncate)
  return c.v === null ? failed(c) : { ...c, v: fromTime(c.v) }
}

/**
 * `calc_time_diff`: `a - sign * b` in microseconds. A TIME first counts the
 * second's day of month, whatever its type; a date first counts day numbers.
 */
export function timeDiff(a: TimeStruct, b: TimeStruct, sign: 1 | -1, dayNumber: (y: number, m: number, d: number) => number): bigint {
  let days: number
  if (a.type === 'TIME') days = a.day - sign * b.day
  else {
    days = dayNumber(a.year, a.month, a.day)
    days -= sign * (b.type === 'TIME' ? b.day : dayNumber(b.year, b.month, b.day))
  }
  const sa = a.hour * 3600 + a.minute * 60 + a.second
  const sb = b.hour * 3600 + b.minute * 60 + b.second
  return (BigInt(days) * 86400n + BigInt(sa) - BigInt(sign * sb)) * 1_000_000n + BigInt(a.microsecond) - BigInt(sign * b.microsecond)
}
