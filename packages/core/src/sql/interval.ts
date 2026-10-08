// M5.10 begun — `d ± INTERVAL n unit`, DATE_ADD, DATE_SUB, ADDDATE and
// SUBDATE: one operation, `Item_date_add_interval`, whose arithmetic is
// `@myjs/types`' (`interval.ts`) and whose result type is decided here, by
// the argument's type and the unit (8.4.11):
//
//   - a DATETIME or TIMESTAMP gives a DATETIME, its fraction the wider of
//     the argument's and the interval's;
//   - a DATE stays a DATE under a unit of days or more, and is a DATETIME
//     under any other;
//   - a TIME stays a TIME under a unit of less than a day, and under any
//     other is a DATETIME on today's date;
//   - anything else — a string, a number, NULL — gives a string 29
//     characters wide in the connection's charset, a date or a datetime as
//     its text and the unit decide, and NULL where it is no temporal.
//
// The result is always nullable: an overflow is NULL.
import { FIELD_TYPE, type MysqlDateTime } from '@myjs/bytes'
import type { Expression, IntervalNode } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { addInterval, intervalFsp, intervalOf, isDateUnit, isIntervalUnit, isTimeUnit, parseDateTime, renderMysqlDateTime, stringValue, textOf, timeOrdinal, toText, COERCIBILITY } from '@myjs/types'
import { compile, type CompileContext, type Compiled, type Env } from './compile.ts'
import { datetimeType, stringType, type ResultType } from './meta.ts'

/** `arg ± INTERVAL value unit`; `negate` for `-`, DATE_SUB and SUBDATE. */
export function dateAdd(arg: Expression, value: Expression, unit: string, negate: boolean, ctx: CompileContext): Compiled {
  if (!isIntervalUnit(unit)) throw sqlError('ER_PARSE_ERROR', messages.parseError(unit, 1))
  const a = compile(arg, ctx)
  const n = compile(value, ctx)
  const scale = n.type.kind === 'decimal' ? n.type.scale : n.type.kind === 'double' ? 31 : 0
  const fsp = intervalFsp(unit, scale)
  const t = a.type
  const dateUnit = isDateUnit(unit)
  let type: ResultType
  let shape: 'datetime' | 'date' | 'time' | 'string'
  if (t.kind === 'datetime' && t.field === FIELD_TYPE.DATE) {
    shape = dateUnit ? 'date' : 'datetime'
    type = dateUnit ? datetimeType(FIELD_TYPE.DATE, 0, true) : datetimeType(FIELD_TYPE.DATETIME, fsp, true)
  } else if (t.kind === 'datetime') {
    shape = 'datetime'
    type = datetimeType(FIELD_TYPE.DATETIME, Math.max(t.scale, fsp), true)
  } else if (t.kind === 'time') {
    shape = isTimeUnit(unit) ? 'time' : 'datetime'
    type = datetimeType(shape === 'time' ? FIELD_TYPE.TIME : FIELD_TYPE.DATETIME, Math.max(t.scale, fsp), true)
  } else {
    shape = 'string'
    type = { ...stringType(29, ctx.connectionCollation, true), field: FIELD_TYPE.STRING }
  }
  const result = type
  return {
    eval: (row, env) => {
      const v = a.eval(row, env)
      if (v === null) return null
      const interval = intervalOf(n.eval(row, env), unit)
      if (interval === undefined) return null
      switch (shape) {
        case 'date':
        case 'datetime': {
          const from = v.kind === 'datetime' ? v.v : v.kind === 'time' ? onToday(v.v, env) : undefined
          if (from === undefined) return null
          const to = addInterval(from, interval, negate)
          if (to === undefined) return null
          return shape === 'date' ? { kind: 'datetime', v: to, type: 'DATE', fsp: 0 } : { kind: 'datetime', v: to, type: 'DATETIME', fsp: result.scale }
        }
        case 'time': {
          if (v.kind !== 'time') return null
          const us = timeOrdinal(v.v) + (negate ? -interval.micros : interval.micros)
          const abs = us < 0n ? -us : us
          if (abs > 838n * 3_600_000_000n + 59n * 60_000_000n + 59_999_999n) return null
          const hours = abs / 3_600_000_000n
          return {
            kind: 'time',
            v: { negative: us < 0n, days: Number(hours / 24n), hour: Number(hours % 24n), minute: Number((abs / 60_000_000n) % 60n), second: Number((abs / 1_000_000n) % 60n), microsecond: Number(abs % 1_000_000n) },
            fsp: result.scale,
          }
        }
        case 'string': {
          const text = v.kind === 'string' || v.kind === 'bytes' ? textOf(v) : v.kind === 'int' ? numberAsTemporal(v.v) : toText(v)
          const parsed = parseDateTime(text)
          if (parsed === undefined) return null
          const to = addInterval(parsed.v, interval, negate)
          if (to === undefined) return null
          const asDate = !parsed.hasTime && dateUnit
          const out = asDate ? renderMysqlDateTime(to).slice(0, 10) : renderMysqlDateTime(to, to.microsecond === 0 ? 0 : 6)
          return stringValue(out, ctx.connectionCollation, COERCIBILITY.COERCIBLE)
        }
      }
    },
    type: result,
  }
}

/** Whether an expression is an `INTERVAL n unit`. */
export function isInterval(e: Expression): e is IntervalNode {
  return e.kind === 'interval'
}

/** A TIME on today's date, as a datetime: TIME plus a unit of days or more. */
function onToday(t: { readonly negative: boolean; readonly days: number; readonly hour: number; readonly minute: number; readonly second: number; readonly microsecond: number }, env: Env): MysqlDateTime | undefined {
  const now = env.now
  const today: MysqlDateTime = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: 0, minute: 0, second: 0, microsecond: 0 }
  return addInterval(today, { months: 0n, micros: timeOrdinal(t) })
}

/** An integer as a temporal's digits: `20240131` is a date. */
function numberAsTemporal(n: bigint): string {
  const s = (n < 0n ? -n : n).toString()
  return s.length <= 8 ? s.padStart(8, '0') : s.padStart(14, '0')
}
