// M5.10 — the date and time slice of the function library: DATE, TIME,
// TIMESTAMP, YEAR, MONTH, DAY, DAYOFMONTH, HOUR, MINUTE, SECOND,
// MICROSECOND, DAYOFWEEK, DAYOFYEAR, WEEK, WEEKDAY, YEARWEEK, QUARTER,
// DAYNAME, MONTHNAME, LAST_DAY, DATE_FORMAT, TIME_FORMAT, STR_TO_DATE,
// UNIX_TIMESTAMP, FROM_UNIXTIME, DATEDIFF, TIMEDIFF, TIMESTAMPDIFF,
// TIMESTAMPADD, ADDTIME, SUBTIME, MAKEDATE, MAKETIME, SEC_TO_TIME,
// TIME_TO_SEC, TO_DAYS, FROM_DAYS, TO_SECONDS, PERIOD_ADD, PERIOD_DIFF,
// EXTRACT, GET_FORMAT and CONVERT_TZ between offsets.
//
// Written against `tools/capture-temporal-functions.mjs`'s corpus, captured
// from 8.4.11 first. The calendar, the readings of a value as a date or a
// time, and the formats are `@myjs/types`' (`calendar.ts`,
// `temporal-args.ts`, `date-format.ts`); what is here is each function's
// result type and which reading it asks for. The rules the corpus holds:
//
//   - An argument is read as a date (`Item::get_date`) or as a time
//     (`Item::get_time`). What cannot be read is NULL and a 1292 warning.
//     The functions that count days refuse a zero date or a zero month or
//     day (TO_DAYS, DAYOFYEAR, WEEK, WEEKDAY, DAYNAME); YEAR, MONTH, DAY
//     and QUARTER take them.
//   - A TIME given where a date is wanted is put on today's date.
//   - A result's fraction digits are its argument's: a temporal's own, a
//     constant string's as written, a decimal's scale, six for other text.
//   - The session's time zone is UTC (`clock` in `compile.ts`): UNIX_TIMESTAMP
//     and FROM_UNIXTIME count from 1970-01-01 00:00:00 there.
import { FIELD_TYPE, type MysqlDateTime, type MysqlTime, expectTyped } from '@myjs/bytes'
import { NODE, type CallNode, type Expression } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import {
  COERCIBILITY,
  DAY_NAMES,
  MAX_DAY_NUMBER,
  MONTH_NAMES,
  dateOf,
  dateStructOf,
  dateOfDayNumber,
  dayNumber,
  daysInMonth,
  decimalValue,
  extractDateTime,
  formatDateTime,
  formatLength,
  formatShape,
  fullYear,
  intValue,
  monthToPeriod,
  parseTime,
  periodToMonth,
  scanDateTime,
  stringValue,
  timeDiff,
  timeOf,
  timeStructOf,
  toDecimal,
  toInteger,
  toText,
  validPeriod,
  week,
  weekBehaviour,
  weekday,
  type Broken,
  type Converted,
  type DateFlags,
  type TimeStruct,
  type Value,
} from '@myjs/types'
import { asNumber, compile, constantNode, raise, rowNumber, type Compiled, type CompileContext, type Env, constantEnv } from './compile.ts'
import { dateAdd } from './interval.ts'
import { charWidth, datetimeType, decimalType, intType, stringType, type ResultType } from './meta.ts'
import { unregistered } from './registry.ts'

type Row = Parameters<Compiled['eval']>[0]

const TIME_MAX_SECONDS = 838 * 3600 + 59 * 60 + 59
/** The last second FROM_UNIXTIME takes: 3001-01-18 23:59:59 UTC (`MYTIME_MAX_VALUE`). */
const MYTIME_MAX_VALUE = 32536771199n
const US_PER_DAY = 86_400_000_000n

const NO_ZERO: DateFlags = { noZeroDate: true, noZeroInDate: true }
const FUZZY: DateFlags = {}

export const TEMPORAL_FUNCTIONS: ReadonlySet<string> = new Set([
  'DATE', 'TIME', 'TIMESTAMP', 'YEAR', 'MONTH', 'DAY', 'DAYOFMONTH', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'DAYOFWEEK', 'DAYOFYEAR',
  'WEEK', 'WEEKDAY', 'YEARWEEK', 'QUARTER', 'DAYNAME', 'MONTHNAME', 'LAST_DAY', 'DATE_FORMAT', 'TIME_FORMAT', 'STR_TO_DATE', 'UNIX_TIMESTAMP',
  'FROM_UNIXTIME', 'DATEDIFF', 'TIMEDIFF', 'TIMESTAMPDIFF', 'TIMESTAMPADD', 'ADDTIME', 'SUBTIME', 'MAKEDATE', 'MAKETIME', 'SEC_TO_TIME',
  'TIME_TO_SEC', 'TO_DAYS', 'FROM_DAYS', 'TO_SECONDS', 'PERIOD_ADD', 'PERIOD_DIFF', 'EXTRACT', 'GET_FORMAT', 'CONVERT_TZ',
])

/** The statement's date, in UTC: where a TIME read as a date lands. */
function today(env: Env): () => MysqlDateTime {
  return () => ({ year: env.now.getUTCFullYear(), month: env.now.getUTCMonth() + 1, day: env.now.getUTCDate(), hour: 0, minute: 0, second: 0, microsecond: 0 })
}

/** A reading's value, its deprecation and its warning raised. */
export function settle<T>(c: Converted<T>, env: Env): T | null {
  if (c.deprecation !== undefined) {
    const { d, text } = c.deprecation
    // A control character is named by its escape: '\t' (8.4.11).
    const char = ({ '\t': '\\t', '\n': '\\n', '\r': '\\r', '\v': '\\v', '\f': '\\f' } as Record<string, string>)[d.char] ?? d.char
    const where = `Delimiter '${char}' in position ${d.position} in datetime value '${text}' at row ${rowNumber(env)}`
    if (d.superfluous) raise(env, 4096, `${where} is superfluous and is deprecated. Please remove.`)
    else raise(env, 4095, `${where} is deprecated. Prefer the standard '${d.prefer}'.`)
  }
  if (c.warning !== undefined) raise(env, 1292, c.warning)
  return c.v
}

const dateReader = (x: Compiled, flags: DateFlags) => (r: Row, env: Env): MysqlDateTime | null => settle(dateOf(x.eval(r, env), flags, today(env)), env)
const timeReader = (x: Compiled) => (r: Row, env: Env): MysqlTime | null => settle(timeOf(x.eval(r, env)), env)
/** `get_time` with its type kept: a column of a date type keeps its date. */
const structReader = (x: Compiled) => {
  const field = x.type.column !== undefined
  return (r: Row, env: Env): TimeStruct | null => settle(timeStructOf(x.eval(r, env), field), env)
}

/** A TIME as signed microseconds. */
const timeMicros = (t: MysqlTime): bigint => {
  const us = BigInt((((t.days * 24 + t.hour) * 60 + t.minute) * 60 + t.second) * 1_000_000 + t.microsecond)
  return t.negative ? -us : us
}

/** Signed microseconds as a TIME, or undefined past 838:59:59.999999. */
function microsToTime(us: bigint): MysqlTime | undefined {
  const negative = us < 0n
  const a = negative ? -us : us
  if (a > BigInt(TIME_MAX_SECONDS) * 1_000_000n + 999_999n) return undefined
  const seconds = Number(a / 1_000_000n)
  const hours = Math.floor(seconds / 3600)
  return { negative: negative && a > 0n, days: Math.floor(hours / 24), hour: hours % 24, minute: Math.floor(seconds / 60) % 60, second: seconds % 60, microsecond: Number(a % 1_000_000n) }
}

/** The extreme TIME of a sign: ±838:59:59. */
const extremeTime = (negative: boolean): MysqlTime => ({ negative, days: 34, hour: 22, minute: 59, second: 59, microsecond: 0 })

/** A datetime as microseconds from day 0. */
const datetimeMicros = (v: MysqlDateTime): bigint =>
  BigInt(dayNumber(v.year, v.month, v.day)) * US_PER_DAY + BigInt(((v.hour * 60 + v.minute) * 60 + v.second) * 1_000_000 + v.microsecond)

/** Microseconds from day 0 as a datetime, or undefined outside 0000-01-01 … 9999-12-31. */
function microsToDatetime(us: bigint): MysqlDateTime | undefined {
  if (us < 0n) return undefined
  const days = us / US_PER_DAY
  if (days > BigInt(MAX_DAY_NUMBER)) return undefined
  const rest = Number(us % US_PER_DAY)
  const date = dateOfDayNumber(Number(days))
  return { ...date, hour: Math.floor(rest / 3_600_000_000), minute: Math.floor(rest / 60_000_000) % 60, second: Math.floor(rest / 1_000_000) % 60, microsecond: rest % 1_000_000 }
}

const datetimeValue = (v: MysqlDateTime, fsp: number): Value => ({ kind: 'datetime', v, type: 'DATETIME', fsp })
const dateValue = (v: Pick<MysqlDateTime, 'year' | 'month' | 'day'>): Value => ({ kind: 'datetime', v: { year: v.year, month: v.month, day: v.day, hour: 0, minute: 0, second: 0, microsecond: 0 }, type: 'DATE', fsp: 0 })
const timeValue = (v: MysqlTime, fsp: number): Value => ({ kind: 'time', v: roundTime(v, fsp), fsp })

/** A TIME's fraction cut to `fsp` digits, rounding. */
function roundTime(v: MysqlTime, fsp: number): MysqlTime {
  if (fsp >= 6) return v
  const unit = 10 ** (6 - fsp)
  const us = Math.round(v.microsecond / unit) * unit
  if (us < 1_000_000) return { ...v, microsecond: us }
  return microsToTime(timeMicros({ ...v, microsecond: 0 }) + (v.negative ? -1_000_000n : 1_000_000n)) ?? extremeTime(v.negative)
}

/** A datetime's fraction cut to `fsp` digits, rounding. */
function roundDatetime(v: MysqlDateTime, fsp: number): MysqlDateTime | undefined {
  if (fsp >= 6) return v
  const unit = 10 ** (6 - fsp)
  const us = Math.round(v.microsecond / unit) * unit
  if (us < 1_000_000) return { ...v, microsecond: us }
  return microsToDatetime(datetimeMicros({ ...v, microsecond: 0 }) + 1_000_000n)
}

/** A constant argument's value, evaluated once at compile time; undefined when it is not constant. */
function constantOf(e: Expression, c: Compiled, ctx: CompileContext): Value | undefined {
  if (!constantNode(e)) return undefined
  try {
    return c.eval([], constantEnv(ctx))
  } catch (e) {
    expectTyped(e)
    return undefined
  }
}

/** `Item::datetime_precision`: the fraction digits an argument brings as a datetime. */
function datetimePrecision(c: Compiled, constant: Value | undefined): number {
  const t = c.type
  if (t.kind === 'datetime' || t.kind === 'time') return t.scale
  if (t.kind === 'string' || t.kind === 'bytes') {
    if (constant === null) return 0
    const s = constant === undefined ? 'unreadable' : scanDateTime(toText(constant))
    return typeof s === 'string' ? 6 : Math.min(s.fsp, 6)
  }
  return Math.min(t.kind === 'null' ? 0 : t.scale, 6)
}

/** `Item::time_precision`: the fraction digits an argument brings as a time. */
function timePrecision(c: Compiled, constant: Value | undefined): number {
  const t = c.type
  if (t.kind === 'datetime' || t.kind === 'time') return t.scale
  if (t.kind === 'string' || t.kind === 'bytes') {
    if (constant === null) return 0
    const p = constant === undefined ? undefined : parseTime(toText(constant))
    return p === undefined ? 6 : Math.min(p.fsp, 6)
  }
  return Math.min(t.kind === 'null' ? 0 : t.scale, 6)
}

/** An integer argument as `val_int` reads it, 1292 for text that is not one. */
function intReader(c: Compiled): (r: Row, env: Env) => bigint | null {
  const n = asNumber(c, 'INTEGER')
  return (r, env) => {
    const v = n.eval(r, env)
    return v === null ? null : toInteger(v)
  }
}

/** The broken-down value DATE_FORMAT writes from a datetime. */
const brokenOfDatetime = (v: MysqlDateTime): Broken => ({ negative: false, ...v })

const INT = (width: number, nullable = true): ResultType => intType(width, nullable)

/** An integer function of one date: its width, the reading it asks for, and the number it makes. */
function ofDate(x: Compiled, width: number, flags: DateFlags, f: (d: MysqlDateTime) => number | bigint | null, nullable = true): Compiled {
  const read = dateReader(x, flags)
  return {
    eval: (r, env) => {
      const d = read(r, env)
      if (d === null) return null
      const n = f(d)
      return n === null ? null : intValue(BigInt(n))
    },
    type: INT(width, nullable),
  }
}

function ofTime(x: Compiled, width: number, f: (t: MysqlTime) => number | bigint): Compiled {
  const read = timeReader(x)
  return {
    eval: (r, env) => {
      const t = read(r, env)
      return t === null ? null : intValue(BigInt(f(t)))
    },
    type: INT(width),
  }
}

/** UNIX_TIMESTAMP's seconds for a UTC datetime; 0 outside 1970-01-01 00:00:00 … 3001-01-18 23:59:59. */
function epochSeconds(v: MysqlDateTime): { readonly seconds: bigint; readonly microsecond: number } {
  if (v.month === 0 || v.day === 0) return { seconds: 0n, microsecond: 0 }
  const seconds = (datetimeMicros({ ...v, microsecond: 0 }) - datetimeMicros({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, microsecond: 0 })) / 1_000_000n
  if (seconds < 0n || seconds > MYTIME_MAX_VALUE) return { seconds: 0n, microsecond: 0 }
  return { seconds, microsecond: v.microsecond }
}

/** A `±HH:MM` time zone's offset in seconds; undefined for a name, which needs the time zone tables. */
function offsetOf(text: string): number | undefined {
  const m = /^\s*([+-])(\d{1,2}):(\d\d)\s*$/.exec(text)
  if (m === null) return text.toUpperCase() === 'UTC' || text.toUpperCase() === 'SYSTEM' ? 0 : undefined
  const minutes = Number(m[2]) * 60 + Number(m[3])
  if (Number(m[3]) >= 60) return undefined
  const signed = m[1] === '-' ? -minutes : minutes
  // `-13:59` … `+14:00` (8.4.11).
  if (signed < -(13 * 60 + 59) || signed > 14 * 60) return undefined
  return signed * 60
}

const GET_FORMATS: Readonly<Record<string, readonly [string, string, string]>> = {
  USA: ['%m.%d.%Y', '%Y-%m-%d %H.%i.%s', '%h:%i:%s %p'],
  JIS: ['%Y-%m-%d', '%Y-%m-%d %H:%i:%s', '%H:%i:%s'],
  ISO: ['%Y-%m-%d', '%Y-%m-%d %H:%i:%s', '%H:%i:%s'],
  EUR: ['%d.%m.%Y', '%Y-%m-%d %H.%i.%s', '%H.%i.%s'],
  INTERNAL: ['%Y%m%d', '%Y%m%d%H%i%s', '%H%i%s'],
}

/** EXTRACT's units, with the width each result is reported at. */
const EXTRACT_WIDTH: Readonly<Record<string, number>> = {
  YEAR: 5, YEAR_MONTH: 7, QUARTER: 2, MONTH: 3, WEEK: 3, DAY: 3, DAY_HOUR: 9, DAY_MINUTE: 11, DAY_SECOND: 13, DAY_MICROSECOND: 20,
  HOUR: 4, HOUR_MINUTE: 6, HOUR_SECOND: 8, HOUR_MICROSECOND: 14, MINUTE: 3, MINUTE_SECOND: 5, MINUTE_MICROSECOND: 11, SECOND: 3,
  SECOND_MICROSECOND: 9, MICROSECOND: 7,
}

/** The date and time functions, or undefined for any other name. */
export function temporalFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const conn = ctx.connectionCollation
  const count = (min: number, max = min): void => {
    if (e.args.length < min || e.args.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
  }
  const keyword = (i: number): string => {
    const a = e.args[i] as Expression
    if (a.kind === NODE.KEYWORD) return a.word.toUpperCase()
    if (a.kind === NODE.COLUMN && a.parts.length === 1) return (a.parts[0] as string).toUpperCase()
    throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
  }
  const arg = (i: number): Compiled => compile(e.args[i] as Expression, ctx)
  const constant = (i: number, c: Compiled): Value | undefined => constantOf(e.args[i] as Expression, c, ctx)
  const notNull = (...cs: Compiled[]): boolean => cs.every((c) => !c.type.nullable)

  switch (name) {
    case 'DATE': {
      count(1)
      const read = dateReader(arg(0), FUZZY)
      return {
        eval: (r, env) => {
          const d = read(r, env)
          return d === null ? null : dateValue(d)
        },
        type: datetimeType(FIELD_TYPE.DATE, 0, true),
      }
    }
    case 'TIME': {
      count(1)
      const x = arg(0)
      const fsp = timePrecision(x, constant(0, x))
      const read = timeReader(x)
      return {
        eval: (r, env) => {
          const t = read(r, env)
          return t === null ? null : timeValue(t, fsp)
        },
        type: datetimeType(FIELD_TYPE.TIME, fsp, true),
      }
    }
    case 'TIMESTAMP': {
      count(1, 2)
      const x = arg(0)
      if (e.args.length === 1) {
        const fsp = datetimePrecision(x, constant(0, x))
        const read = dateReader(x, FUZZY)
        return {
          eval: (r, env) => {
            const d = read(r, env)
            if (d === null) return null
            const v = roundDatetime(d, fsp)
            return v === undefined ? null : datetimeValue(v, fsp)
          },
          type: datetimeType(FIELD_TYPE.DATETIME, fsp, true),
        }
      }
      const y = arg(1)
      return addTime(x, y, false, 'datetime', Math.max(datetimePrecision(x, constant(0, x)), timePrecision(y, constant(1, y))), conn)
    }
    case 'YEAR': {
      count(1)
      const c = ofDate(arg(0), 4, FUZZY, (d) => d.year)
      return { ...c, type: { ...intType(4, true, true), field: FIELD_TYPE.YEAR } }
    }
    case 'MONTH':
      count(1)
      return ofDate(arg(0), 3, FUZZY, (d) => d.month)
    case 'DAY':
    case 'DAYOFMONTH':
      count(1)
      return ofDate(arg(0), 3, FUZZY, (d) => d.day)
    case 'QUARTER':
      count(1)
      return ofDate(arg(0), 2, FUZZY, (d) => Math.floor((d.month + 2) / 3))
    case 'DAYOFYEAR':
      count(1)
      return ofDate(arg(0), 4, NO_ZERO, (d) => dayNumber(d.year, d.month, d.day) - dayNumber(d.year, 1, 1) + 1)
    case 'DAYOFWEEK':
      count(1)
      return ofDate(arg(0), 2, NO_ZERO, (d) => weekday(dayNumber(d.year, d.month, d.day), true) + 1)
    case 'WEEKDAY':
      count(1)
      return ofDate(arg(0), 2, NO_ZERO, (d) => weekday(dayNumber(d.year, d.month, d.day), false))
    case 'TO_DAYS':
      count(1)
      return ofDate(arg(0), 8, NO_ZERO, (d) => dayNumber(d.year, d.month, d.day))
    case 'TO_SECONDS':
      count(1)
      return ofDate(arg(0), 21, NO_ZERO, (d) => BigInt(dayNumber(d.year, d.month, d.day)) * 86400n + BigInt((d.hour * 60 + d.minute) * 60 + d.second))
    case 'WEEK':
    case 'YEARWEEK': {
      count(1, 2)
      const read = dateReader(arg(0), NO_ZERO)
      const mode = e.args.length === 2 ? intReader(arg(1)) : undefined
      const yearweek = name === 'YEARWEEK'
      return {
        eval: (r, env) => {
          const d = read(r, env)
          if (d === null) return null
          // A NULL mode is mode 0.
          const m = (mode === undefined ? 0n : mode(r, env)) ?? 0n
          const behaviour = weekBehaviour(Number(BigInt.asUintN(32, m) & 7n)) | (yearweek ? 2 : 0)
          const w = week(d.year, d.month, d.day, behaviour)
          return intValue(BigInt(yearweek ? w.year * 100 + w.week : w.week))
        },
        type: INT(yearweek ? 7 : 3),
      }
    }
    case 'DAYNAME':
    case 'MONTHNAME': {
      count(1)
      const read = dateReader(arg(0), name === 'DAYNAME' ? NO_ZERO : FUZZY)
      return {
        eval: (r, env) => {
          const d = read(r, env)
          if (d === null) return null
          if (name === 'MONTHNAME') return d.month === 0 ? null : stringValue(MONTH_NAMES[d.month - 1] as string, conn, COERCIBILITY.COERCIBLE)
          return stringValue(DAY_NAMES[weekday(dayNumber(d.year, d.month, d.day), false)] as string, conn, COERCIBILITY.COERCIBLE)
        },
        type: stringType(9, conn, true),
      }
    }
    case 'LAST_DAY': {
      count(1)
      const read = dateReader(arg(0), FUZZY)
      return {
        eval: (r, env) => {
          const d = read(r, env)
          if (d === null) return null
          if (d.month === 0) {
            raise(env, 1292, `Incorrect datetime value: '${String(d.year).padStart(4, '0')}-00-${p2(d.day)}'`)
            return null
          }
          return dateValue({ year: d.year, month: d.month, day: daysInMonth(d.year, d.month) })
        },
        type: datetimeType(FIELD_TYPE.DATE, 0, true),
      }
    }
    case 'HOUR':
      count(1)
      return ofTime(arg(0), 4, (t) => t.days * 24 + t.hour)
    case 'MINUTE':
      count(1)
      return ofTime(arg(0), 3, (t) => t.minute)
    case 'SECOND':
      count(1)
      return ofTime(arg(0), 3, (t) => t.second)
    case 'MICROSECOND':
      count(1)
      return ofTime(arg(0), 21, (t) => t.microsecond)
    case 'TIME_TO_SEC':
      count(1)
      return ofTime(arg(0), 10, (t) => (t.negative ? -1 : 1) * (((t.days * 24 + t.hour) * 60 + t.minute) * 60 + t.second))
    case 'DATE_FORMAT':
    case 'TIME_FORMAT': {
      count(2)
      const x = arg(0)
      const f = arg(1)
      const time = name === 'TIME_FORMAT'
      const fixed = (e.args[1] as Expression).kind === NODE.LITERAL ? constant(1, f) : undefined
      const chars = fixed !== undefined && fixed !== null ? formatLength(toText(fixed)) : Math.min(Math.min(charWidth(f.type), 16_777_216) * 10, 16_777_216)
      const read = time ? undefined : dateReader(x, FUZZY)
      const readStruct = structReader(x)
      return {
        eval: (r, env) => {
          let broken: Broken
          if (read !== undefined) {
            const d = read(r, env)
            if (d === null) return null
            broken = brokenOfDatetime(d)
          } else {
            // A time, its date set to zero: `%Y` of any value is 0000.
            const t = readStruct(r, env)
            if (t === null) return null
            broken = { negative: t.negative, year: 0, month: 0, day: 0, hour: t.hour, minute: t.minute, second: t.second, microsecond: t.microsecond }
          }
          const fv = f.eval(r, env)
          if (fv === null) return null
          const format = toText(fv)
          if (format === '') return null
          const out = formatDateTime(broken, format, time)
          return out === undefined ? null : stringValue(out, conn, COERCIBILITY.COERCIBLE)
        },
        type: stringType(chars, conn, true),
      }
    }
    case 'STR_TO_DATE':
      count(2)
      return strToDate(arg(0), arg(1), constant(1, arg(1)), ctx)
    case 'UNIX_TIMESTAMP': {
      count(0, 1)
      if (e.args.length === 0) return { eval: (_r, env) => intValue(BigInt(Math.floor(env.now.getTime() / 1000))), type: INT(21, false) }
      const x = arg(0)
      const fsp = datetimePrecision(x, constant(0, x))
      const nullable = x.type.nullable
      return {
        eval: (r, env) => {
          // NULL is NULL; what is no date is 0, with its warning.
          const v = x.eval(r, env)
          if (v === null) return null
          const d = settle(dateOf(v, FUZZY, today(env)), env)
          if (d === null) return fsp === 0 ? intValue(0n) : decimalValue(0n, fsp)
          const rounded = roundDatetime(d, fsp) ?? d
          const { seconds, microsecond } = epochSeconds(rounded)
          if (fsp === 0) return intValue(seconds)
          return decimalValue(seconds * 10n ** BigInt(fsp) + BigInt(Math.floor(microsecond / 10 ** (6 - fsp))), fsp)
        },
        type: fsp === 0 ? INT(21, nullable) : decimalType(11 + fsp, fsp, nullable),
      }
    }
    case 'FROM_UNIXTIME': {
      count(1, 2)
      const x = arg(0)
      const fsp = Math.min(x.type.kind === 'null' ? 0 : x.type.scale, 6)
      const n = asNumber(x, 'DECIMAL')
      const at = (r: Row, env: Env): MysqlDateTime | null => {
        const v = n.eval(r, env)
        if (v === null) return null
        const d = toDecimal(v)
        if (d.v < 0n) return null
        const unit = 10n ** BigInt(d.scale)
        const seconds = d.v / unit
        if (seconds > MYTIME_MAX_VALUE) return null
        const us = fsp === 0 ? 0n : ((d.v % unit) * 1_000_000n + unit / 2n) / unit
        const out = microsToDatetime(datetimeMicros({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, microsecond: 0 }) + seconds * 1_000_000n + us)
        if (out === undefined) return null
        return roundDatetime(out, fsp) ?? null
      }
      if (e.args.length === 1) {
        return {
          eval: (r, env) => {
            const d = at(r, env)
            return d === null ? null : datetimeValue(d, fsp)
          },
          type: datetimeType(FIELD_TYPE.DATETIME, fsp, true),
        }
      }
      const f = arg(1)
      const fixed = (e.args[1] as Expression).kind === NODE.LITERAL ? constant(1, f) : undefined
      const chars = fixed !== undefined && fixed !== null ? formatLength(toText(fixed)) : Math.min(charWidth(f.type) * 10, 16_777_216)
      return {
        eval: (r, env) => {
          const d = at(r, env)
          if (d === null) return null
          const fv = f.eval(r, env)
          if (fv === null || toText(fv) === '') return null
          const out = formatDateTime(brokenOfDatetime(d), toText(fv), false)
          return out === undefined ? null : stringValue(out, conn, COERCIBILITY.COERCIBLE)
        },
        type: stringType(chars, conn, true),
      }
    }
    case 'DATEDIFF': {
      count(2)
      const a = dateReader(arg(0), NO_ZERO)
      const b = dateReader(arg(1), NO_ZERO)
      return {
        eval: (r, env) => {
          // Both are read, and both warn, whatever the first is.
          const x = a(r, env)
          const y = b(r, env)
          if (x === null || y === null) return null
          return intValue(BigInt(dayNumber(x.year, x.month, x.day) - dayNumber(y.year, y.month, y.day)))
        },
        type: INT(9),
      }
    }
    case 'TIMEDIFF': {
      count(2)
      const x = arg(0)
      const y = arg(1)
      const fsp = Math.max(timePrecision(x, constant(0, x)), timePrecision(y, constant(1, y)))
      // A date against a TIME is no difference; a date on either side reads both as dates, else both as times.
      const dated = x.type.kind === 'datetime' || y.type.kind === 'datetime'
      const never = (x.type.kind === 'datetime' && y.type.kind === 'time') || (y.type.kind === 'datetime' && x.type.kind === 'time')
      const read = (c: Compiled) => {
        const asTime = structReader(c)
        return (r: Row, env: Env): TimeStruct | null => (dated ? settle(dateStructOf(c.eval(r, env), FUZZY, today(env)), env) : asTime(r, env))
      }
      const ra = read(x)
      const rb = read(y)
      return {
        eval: (r, env) => {
          if (never) return null
          const a = ra(r, env)
          if (a === null) return null
          const b = rb(r, env)
          if (b === null || a.type !== b.type) return null
          const sign = a.negative !== b.negative ? -1 : 1
          const us = timeDiff(a, b, sign, dayNumber)
          let negative = us < 0n
          const abs = negative ? -us : us
          if (a.negative && abs !== 0n) negative = !negative
          return clampedTime(negative ? -abs : abs, fsp, env)
        },
        type: datetimeType(FIELD_TYPE.TIME, fsp, true),
      }
    }
    case 'TIMESTAMPDIFF': {
      count(3)
      const unit = keyword(0)
      const a = dateReader(arg(1), NO_ZERO)
      const b = dateReader(arg(2), NO_ZERO)
      return {
        eval: (r, env) => {
          const x = a(r, env)
          if (x === null) return null
          const y = b(r, env)
          if (y === null) return null
          return intValue(timestampDiff(unit, x, y))
        },
        type: INT(21),
      }
    }
    case 'TIMESTAMPADD': {
      count(3)
      const unit = keyword(0)
      return dateAdd(e.args[2] as Expression, e.args[1] as Expression, unit, false, ctx)
    }
    case 'ADDTIME':
    case 'SUBTIME': {
      count(2)
      const x = arg(0)
      const y = arg(1)
      const sub = name === 'SUBTIME'
      if (x.type.kind === 'time') return addTime(x, y, sub, 'time', Math.max(timePrecision(x, constant(0, x)), timePrecision(y, constant(1, y))), conn)
      if (x.type.kind === 'datetime') return addTime(x, y, sub, 'datetime', Math.max(datetimePrecision(x, constant(0, x)), timePrecision(y, constant(1, y))), conn)
      return addTime(x, y, sub, 'text', 6, conn)
    }
    case 'MAKEDATE': {
      count(2)
      const year = intReader(arg(0))
      const doy = intReader(arg(1))
      return {
        eval: (r, env) => {
          const d = doy(r, env)
          if (d === null) return null
          let y = year(r, env)
          if (y === null) return null
          if (y < 0n || y > 9999n || d <= 0n || d > BigInt(MAX_DAY_NUMBER)) return null
          if (y < 100n) y = BigInt(fullYear(Number(y)))
          const days = dayNumber(Number(y), 1, 1) + Number(d) - 1
          if (days < 0 || days > MAX_DAY_NUMBER) return null
          return dateValue(dateOfDayNumber(days))
        },
        type: datetimeType(FIELD_TYPE.DATE, 0, true),
      }
    }
    case 'FROM_DAYS': {
      count(1)
      const n = intReader(arg(0))
      const x = arg(0)
      return {
        eval: (r, env) => {
          const d = n(r, env)
          if (d === null) return null
          if (d <= 0n || d > BigInt(MAX_DAY_NUMBER)) return dateValue({ year: 0, month: 0, day: 0 })
          return dateValue(dateOfDayNumber(Number(d)))
        },
        type: datetimeType(FIELD_TYPE.DATE, 0, x.type.nullable),
      }
    }
    case 'MAKETIME': {
      count(3)
      const h = intReader(arg(0))
      const m = intReader(arg(1))
      const sx = arg(2)
      const s = asNumber(sx, 'DECIMAL')
      const fsp = Math.min(sx.type.kind === 'null' ? 0 : sx.type.scale, 6)
      return {
        eval: (r, env) => {
          const hour = h(r, env)
          if (hour === null) return null
          const minute = m(r, env)
          if (minute === null) return null
          const sv = s.eval(r, env)
          if (sv === null) return null
          const sec = toDecimal(sv)
          const unit = 10n ** BigInt(sec.scale)
          const whole = sec.v / unit
          if (minute < 0n || minute > 59n || whole < 0n || whole > 59n || sec.v < 0n) return null
          const negative = hour < 0n
          const ah = negative ? -hour : hour
          const us = ((sec.v % unit) * 1_000_000n + unit / 2n) / unit
          const total = ((ah * 60n + minute) * 60n + whole) * 1_000_000n + us
          const t = microsToTime(negative ? -total : total)
          if (t === undefined) {
            raise(env, 1292, `Truncated incorrect time value: '${negative ? '-' : ''}${ah}:${String(minute).padStart(2, '0')}:${String(whole).padStart(2, '0')}'`)
            return timeValue(extremeTime(negative), fsp)
          }
          return timeValue(t, fsp)
        },
        type: datetimeType(FIELD_TYPE.TIME, fsp, true),
      }
    }
    case 'SEC_TO_TIME': {
      count(1)
      const x = arg(0)
      const n = asNumber(x, 'DECIMAL')
      const fsp = Math.min(x.type.kind === 'null' ? 0 : x.type.scale, 6)
      return {
        eval: (r, env) => {
          const v = n.eval(r, env)
          if (v === null) return null
          const d = toDecimal(v)
          const unit = 10n ** BigInt(d.scale)
          // To microseconds, a seventh digit rounding half away from zero.
          const scaled = d.v * 1_000_000n
          const t = microsToTime(d.scale > 6 ? (scaled + (d.v < 0n ? -unit / 2n : unit / 2n)) / unit : scaled / unit)
          if (t === undefined) {
            raise(env, 1292, `Truncated incorrect time value: '${toText(v)}'`)
            return timeValue(extremeTime(d.v < 0n), fsp)
          }
          return timeValue(t, fsp)
        },
        type: datetimeType(FIELD_TYPE.TIME, fsp, true),
      }
    }
    case 'PERIOD_ADD':
    case 'PERIOD_DIFF': {
      count(2)
      const a = intReader(arg(0))
      const b = intReader(arg(1))
      const fn = name.toLowerCase()
      const x = arg(0)
      const y = arg(1)
      return {
        eval: (r, env) => {
          const p = a(r, env)
          if (p === null) return null
          const q = b(r, env)
          if (q === null) return null
          if (!validPeriod(p) || (name === 'PERIOD_DIFF' && !validPeriod(q))) throw sqlError('ER_WRONG_ARGUMENTS', `Incorrect arguments to ${fn}`)
          if (name === 'PERIOD_DIFF') return intValue(periodToMonth(p) - periodToMonth(q))
          return intValue(BigInt.asIntN(64, monthToPeriod(BigInt.asUintN(64, periodToMonth(p) + q))))
        },
        type: INT(21, !notNull(x, y)),
      }
    }
    case 'EXTRACT': {
      count(2)
      const unit = keyword(0)
      const width = EXTRACT_WIDTH[unit]
      if (width === undefined) throw sqlError('ER_PARSE_ERROR', messages.parseError(unit, 1))
      const x = arg(1)
      // The units of a date read a date; those of a time, DAY_HOUR and on included, read a time.
      const dated = ['YEAR', 'YEAR_MONTH', 'QUARTER', 'MONTH', 'WEEK', 'DAY'].includes(unit)
      const readDate = dateReader(x, FUZZY)
      const readTime = structReader(x)
      return {
        eval: (r, env) => {
          let v: Broken
          if (dated) {
            const d = readDate(r, env)
            if (d === null) return null
            v = brokenOfDatetime(d)
          } else {
            const t = readTime(r, env)
            if (t === null) return null
            v = t
          }
          return intValue(extract(unit, v))
        },
        type: INT(width),
      }
    }
    case 'GET_FORMAT': {
      count(2)
      const which = keyword(0)
      const column = which === 'DATE' ? 0 : which === 'TIME' ? 2 : 1
      const loc = arg(1)
      return {
        eval: (r, env) => {
          const v = loc.eval(r, env)
          if (v === null) return null
          const formats = GET_FORMATS[toText(v).toUpperCase()]
          return formats === undefined ? null : stringValue(formats[column] as string, conn, COERCIBILITY.COERCIBLE)
        },
        type: stringType(17, conn, true),
      }
    }
    case 'CONVERT_TZ': {
      count(3)
      const x = arg(0)
      const fsp = datetimePrecision(x, constant(0, x))
      const read = dateReader(x, NO_ZERO)
      const from = arg(1)
      const to = arg(2)
      return {
        eval: (r, env) => {
          const f = from.eval(r, env)
          const t = to.eval(r, env)
          if (f === null || t === null) return null
          const a = offsetOf(toText(f))
          const b = offsetOf(toText(t))
          if (a === undefined || b === undefined) return null
          const d = read(r, env)
          if (d === null) return null
          const utc = datetimeMicros(d) - BigInt(a) * 1_000_000n
          const epoch = datetimeMicros({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, microsecond: 0 })
          // Outside TIMESTAMP's range the value is returned as it was.
          if (utc < epoch + 1_000_000n || utc > epoch + MYTIME_MAX_VALUE * 1_000_000n) return datetimeValue(roundDatetime(d, fsp) ?? d, fsp)
          const out = microsToDatetime(utc + BigInt(b) * 1_000_000n)
          return out === undefined ? null : datetimeValue(roundDatetime(out, fsp) ?? out, fsp)
        },
        type: datetimeType(FIELD_TYPE.DATETIME, fsp, true),
      }
    }
  }
  throw unregistered(name)
}

/** TIMESTAMPDIFF: whole units from `a` to `b`, months counted by the calendar and cut toward zero. */
function timestampDiff(unit: string, a: MysqlDateTime, b: MysqlDateTime): bigint {
  const us = datetimeMicros(b) - datetimeMicros(a)
  switch (unit) {
    case 'MICROSECOND':
      return us
    case 'SECOND':
      return us / 1_000_000n
    case 'MINUTE':
      return us / 60_000_000n
    case 'HOUR':
      return us / 3_600_000_000n
    case 'DAY':
      return us / US_PER_DAY
    case 'WEEK':
      return us / (US_PER_DAY * 7n)
  }
  // Months: from the earlier to the later, less one when the later's day and time come before the earlier's.
  const negative = us < 0n
  const [lo, hi] = negative ? [b, a] : [a, b]
  let months = (hi.year - lo.year) * 12 + (hi.month - lo.month)
  const loRest = (((lo.day * 24 + lo.hour) * 60 + lo.minute) * 60 + lo.second) * 1_000_000 + lo.microsecond
  const hiRest = (((hi.day * 24 + hi.hour) * 60 + hi.minute) * 60 + hi.second) * 1_000_000 + hi.microsecond
  if (hiRest < loRest) months--
  const n = BigInt(unit === 'QUARTER' ? Math.trunc(months / 3) : unit === 'YEAR' ? Math.trunc(months / 12) : months)
  return negative ? -n : n
}

/** EXTRACT's number for one unit. */
function extract(unit: string, v: Broken): bigint {
  const sign = v.negative ? -1n : 1n
  const day = BigInt(v.day)
  const hour = BigInt(v.hour)
  const minute = BigInt(v.minute)
  const second = BigInt(v.second)
  const us = BigInt(v.microsecond)
  switch (unit) {
    case 'YEAR':
      return BigInt(v.year)
    case 'YEAR_MONTH':
      return BigInt(v.year * 100 + v.month)
    case 'QUARTER':
      return BigInt(Math.floor((v.month + 2) / 3))
    case 'MONTH':
      return BigInt(v.month)
    case 'WEEK':
      return BigInt(week(v.year, v.month, v.day, weekBehaviour(0)).week)
    case 'DAY':
      return day
    case 'DAY_HOUR':
      return sign * (day * 100n + hour)
    case 'DAY_MINUTE':
      return sign * (day * 10000n + hour * 100n + minute)
    case 'DAY_SECOND':
      return sign * (day * 1000000n + hour * 10000n + minute * 100n + second)
    case 'DAY_MICROSECOND':
      return sign * ((day * 1000000n + hour * 10000n + minute * 100n + second) * 1000000n + us)
    case 'HOUR':
      return sign * hour
    case 'HOUR_MINUTE':
      return sign * (hour * 100n + minute)
    case 'HOUR_SECOND':
      return sign * (hour * 10000n + minute * 100n + second)
    case 'HOUR_MICROSECOND':
      return sign * ((hour * 10000n + minute * 100n + second) * 1000000n + us)
    case 'MINUTE':
      return sign * minute
    case 'MINUTE_SECOND':
      return sign * (minute * 100n + second)
    case 'MINUTE_MICROSECOND':
      return sign * ((minute * 100n + second) * 1000000n + us)
    case 'SECOND':
      return sign * second
    case 'SECOND_MICROSECOND':
      return sign * (second * 1000000n + us)
    case 'MICROSECOND':
      return sign * us
  }
  return 0n
}

/** A TIME of signed microseconds, clamped to ±838:59:59 with a 1292 warning (`adjust_time_range_with_warn`). */
function clampedTime(us: bigint, fsp: number, env: Env): Value {
  const t = microsToTime(us)
  if (t !== undefined) return timeValue(t, fsp)
  const abs = us < 0n ? -us : us
  const seconds = abs / 1_000_000n
  const frac = fsp === 0 ? '' : `.${String(abs % 1_000_000n).padStart(6, '0').slice(0, fsp)}`
  raise(env, 1292, `Truncated incorrect time value: '${us < 0n ? '-' : ''}${seconds / 3600n}:${p2(Number((seconds / 60n) % 60n))}:${p2(Number(seconds % 60n))}${frac}'`)
  return timeValue(extremeTime(us < 0n), fsp)
}

/**
 * ADDTIME, SUBTIME and TIMESTAMP(a, b), as `Item_func_add_time` computes
 * them. A date-typed first argument (or TIMESTAMP's) is read as a date, a
 * second that is not a TIME is NULL, and the answer is a DATETIME. Any other
 * first argument is read as a time: a datetime it turns out to be gives a
 * datetime, a second that is a datetime is NULL. A TIME-typed first gives a
 * TIME; text or a number a 29-character string of whichever it made.
 */
function addTime(x: Compiled, y: Compiled, sub: boolean, shape: 'datetime' | 'time' | 'text', fsp: number, conn: number): Compiled {
  const readA = structReader(x)
  const readB = structReader(y)
  const type =
    shape === 'datetime' ? datetimeType(FIELD_TYPE.DATETIME, fsp, true) : shape === 'time' ? datetimeType(FIELD_TYPE.TIME, fsp, true) : { ...stringType(29, conn, true), field: FIELD_TYPE.STRING }
  return {
    eval: (r, env) => {
      let a: TimeStruct | null
      if (shape === 'datetime') a = settle(dateStructOf(x.eval(r, env), FUZZY, today(env)), env)
      else a = readA(r, env)
      if (a === null) return null
      const b = readB(r, env)
      if (b === null) return null
      if (shape === 'datetime' ? b.type !== 'TIME' : b.type === 'DATETIME') return null
      const isTime = a.type === 'TIME'
      let sign: 1 | -1 = sub ? -1 : 1
      if (a.negative !== b.negative) sign = sign === 1 ? -1 : 1
      const us = timeDiff(a, b, sign === 1 ? -1 : 1, dayNumber)
      let negative = us < 0n
      const abs = negative ? -us : us
      if (a.negative && abs !== 0n) negative = !negative
      if (!isTime) {
        if (negative) return null
        const out = microsToDatetime(abs)
        if (out === undefined) {
          raise(env, 1441, 'Datetime function: datetime field overflow')
          return null
        }
        if (out.day === 0) return null
        if (shape === 'text') return stringValue(renderDatetime(out), conn, COERCIBILITY.COERCIBLE)
        const v = roundDatetime(out, fsp)
        return v === undefined ? null : datetimeValue(v, fsp)
      }
      const t = clampedTime(negative ? -abs : abs, shape === 'text' ? 6 : fsp, env)
      if (shape === 'text') return stringValue(renderTimeText((t as { v: MysqlTime }).v), conn, COERCIBILITY.COERCIBLE)
      return t
    },
    type,
  }
}

const p2 = (n: number): string => String(n).padStart(2, '0')
const fraction = (us: number): string => (us === 0 ? '' : `.${String(us).padStart(6, '0')}`)
const renderDatetime = (v: MysqlDateTime): string => `${String(v.year).padStart(4, '0')}-${p2(v.month)}-${p2(v.day)} ${p2(v.hour)}:${p2(v.minute)}:${p2(v.second)}${fraction(v.microsecond)}`
const renderTimeText = (t: MysqlTime): string => `${t.negative ? '-' : ''}${p2(t.days * 24 + t.hour)}:${p2(t.minute)}:${p2(t.second)}${fraction(t.microsecond)}`

/**
 * STR_TO_DATE: its type is decided by a constant format, a DATE, a TIME or
 * a DATETIME, six digits if it reads `%f`; with any other format a
 * DATETIME(6). A string it cannot read is NULL and a 1411 warning.
 */
function strToDate(s: Compiled, f: Compiled, fixed: Value | undefined, ctx: CompileContext): Compiled {
  let field: number = FIELD_TYPE.DATETIME
  let fsp = 6
  if (fixed !== undefined && fixed !== null) {
    const shape = formatShape(toText(fixed))
    fsp = shape.fraction ? 6 : 0
    field = shape.date && shape.time ? FIELD_TYPE.DATETIME : shape.date ? FIELD_TYPE.DATE : shape.time ? FIELD_TYPE.TIME : FIELD_TYPE.DATETIME
  }
  void ctx
  const kind = field === FIELD_TYPE.DATE ? 'date' : field === FIELD_TYPE.TIME ? 'time' : 'datetime'
  return {
    eval: (r, env) => {
      const v = s.eval(r, env)
      if (v === null) return null
      const fv = f.eval(r, env)
      if (fv === null) return null
      const text = toText(v)
      const out = extractDateTime(text, toText(fv), { noZeroDate: false, noZeroInDate: false })
      if (out === undefined) {
        raise(env, 1411, `Incorrect ${kind === 'time' ? 'time' : kind === 'date' ? 'date' : 'datetime'} value: '${text}' for function str_to_date`)
        return null
      }
      if (out.truncated) raise(env, 1292, `Truncated incorrect ${kind} value: '${text}'`)
      const d = out.v
      if (kind === 'date') return dateValue(d)
      if (kind === 'time') return timeValue({ negative: false, days: 0, hour: d.hour, minute: d.minute, second: d.second, microsecond: d.microsecond }, fsp)
      return datetimeValue(d, fsp)
    },
    type: datetimeType(field, fsp, true),
  }
}

