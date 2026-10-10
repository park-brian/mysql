// The values of one column a condition admits, as intervals (M5.7): what the
// range optimizer reads an index by, and what proves a WHERE empty
// (`optimize.ts`). A condition that does not restrict the column, or compares
// it otherwise than as its own type, admits everything (`'all'`), so a range
// built from these is never too narrow; the WHERE is applied to every row it
// reads anyway (D-65).
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import type { ColumnDef } from '@myjs/engine'
import { NODE, type Expression } from '@myjs/parser'
import { compareValues, integerRange, type Value } from '@myjs/types'

/** A constant's value while planning — a literal, or a bound `?` — or `undefined` for anything else. */
export type Constant = (e: Expression) => Value | undefined

/** One interval of a column's values, or the NULL point. An absent bound is unbounded. */
export type Interval = { readonly lo?: { readonly v: Exclude<Value, null>; readonly inclusive: boolean }; readonly hi?: { readonly v: Exclude<Value, null>; readonly inclusive: boolean } } | 'null'
/** The values a condition admits: some intervals, or everything (`'all'`) when it does not restrict the column. */
export type RangeSet = readonly Interval[] | 'all'

const ALL_VALUES: Interval = {}

/** A constant brought to the column's comparison, or `undefined` when the two do not compare as the column's type. */
function constantFor(e: Expression, column: ColumnDef, value: Constant): Value | undefined {
  const v = value(e)
  if (v === undefined || v === null) return v
  const text = column.type.collationId !== undefined && column.type.collationId !== CHARSET_BINARY
  if (text) return v.kind === 'string' ? { ...v, collationId: column.type.collationId as number, coercibility: 2 } : undefined
  if (integerRange(column.type) !== undefined || column.type.type === FIELD_TYPE.NEWDECIMAL || column.type.type === FIELD_TYPE.DECIMAL) return v.kind === 'int' || v.kind === 'decimal' ? v : undefined
  return undefined
}

export function rangeOf(e: Expression, isColumn: (e: Expression) => boolean, column: ColumnDef, value: Constant): RangeSet {
  if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) return intersect(rangeOf(e.left, isColumn, column, value), rangeOf(e.right, isColumn, column, value))
  if (e.kind === NODE.BINARY && (e.op === 'OR' || e.op === '||')) return union(rangeOf(e.left, isColumn, column, value), rangeOf(e.right, isColumn, column, value))
  if (e.kind === NODE.UNARY && (e.op === 'IS NULL' || e.op === 'IS NOT NULL') && isColumn(e.operand)) return e.op === 'IS NULL' ? (column.nullable ? ['null'] : []) : [ALL_VALUES]
  if (e.kind !== NODE.BINARY) return 'all'
  const point = (v: Exclude<Value, null>): Interval => ({ lo: { v, inclusive: true }, hi: { v, inclusive: true } })
  if (e.op === 'BETWEEN' && isColumn(e.left)) {
    const a = constantFor(e.right, column, value)
    const b = constantFor(e.extra as Expression, column, value)
    if (a === undefined || b === undefined) return 'all'
    if (a === null || b === null) return []
    return [{ lo: { v: a, inclusive: true }, hi: { v: b, inclusive: true } }]
  }
  if (e.op === 'IN' && isColumn(e.left) && e.right.kind === NODE.ROW) {
    const out: Interval[] = []
    for (const item of e.right.items) {
      const v = constantFor(item, column, value)
      if (v === undefined) return 'all'
      if (v !== null) out.push(point(v))
    }
    return out
  }
  if (e.op === 'NOT IN' && isColumn(e.left) && e.right.kind === NODE.ROW) {
    // Everything between the values. A NULL among them makes it true of nothing, which the server's range analysis does not
    // prove (8.4.11 plans `n NOT IN (NULL, 4.5)` as a scan), so neither is it proved here.
    const values: Exclude<Value, null>[] = []
    for (const item of e.right.items) {
      const v = constantFor(item, column, value)
      if (v === undefined || v === null) return 'all'
      values.push(v)
    }
    const points = normalize(values.map((v) => ({ lo: { v, inclusive: true }, hi: { v, inclusive: true } })))
    const out: Interval[] = []
    let lo: { readonly v: Exclude<Value, null>; readonly inclusive: boolean } | undefined
    for (const p of points) {
      if (p === 'null' || p.lo === undefined) return 'all'
      out.push({ ...(lo === undefined ? {} : { lo }), hi: { v: p.lo.v, inclusive: false } })
      lo = { v: p.lo.v, inclusive: false }
    }
    out.push(lo === undefined ? ALL_VALUES : { lo })
    return out
  }
  const FLIP: Readonly<Record<string, string>> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=', '<=>': '<=>', '<>': '<>', '!=': '!=' }
  let op = e.op
  let other: Expression
  if (isColumn(e.left)) other = e.right
  else if (isColumn(e.right)) {
    other = e.left
    op = FLIP[op] ?? op
  } else return 'all'
  if (!(op in FLIP)) return 'all'
  const v = constantFor(other, column, value)
  if (v === undefined) return 'all'
  if (v === null) return op === '<=>' && column.nullable ? ['null'] : []
  switch (op) {
    case '=':
    case '<=>':
      return [point(v)]
    case '<':
      return [{ hi: { v, inclusive: false } }]
    case '<=':
      return [{ hi: { v, inclusive: true } }]
    case '>':
      return [{ lo: { v, inclusive: false } }]
    case '>=':
      return [{ lo: { v, inclusive: true } }]
    default:
      return [{ hi: { v, inclusive: false } }, { lo: { v, inclusive: false } }]
  }
}

export function union(a: RangeSet, b: RangeSet): RangeSet {
  if (a === 'all' || b === 'all') return 'all'
  return [...a, ...b]
}

export function intersect(a: RangeSet, b: RangeSet): RangeSet {
  if (a === 'all') return b
  if (b === 'all') return a
  const out: Interval[] = []
  for (const x of a) {
    for (const y of b) {
      const z = meet(x, y)
      if (z !== undefined) out.push(z)
    }
  }
  return out
}

/** Two intervals' common part, or `undefined` when they share nothing. */
function meet(x: Interval, y: Interval): Interval | undefined {
  if (x === 'null' || y === 'null') return x === 'null' && y === 'null' ? 'null' : undefined
  const lo = tighter(x.lo, y.lo, 1)
  const hi = tighter(x.hi, y.hi, -1)
  if (lo !== undefined && hi !== undefined) {
    const c = compareValues(lo.v, hi.v)
    if (c === null) return undefined
    if (c > 0 || (c === 0 && !(lo.inclusive && hi.inclusive))) return undefined
  }
  return { ...(lo === undefined ? {} : { lo }), ...(hi === undefined ? {} : { hi }) }
}

type Bound = { readonly v: Exclude<Value, null>; readonly inclusive: boolean } | undefined

/** The tighter of two lower bounds (`dir` 1) or upper bounds (`dir` -1). */
function tighter(a: Bound, b: Bound, dir: 1 | -1): Bound {
  if (a === undefined) return b
  if (b === undefined) return a
  const c = compareValues(a.v, b.v)
  if (c === null) return a
  if (c === 0) return { v: a.v, inclusive: a.inclusive && b.inclusive }
  return c * dir > 0 ? a : b
}

/**
 * Intervals as an index reads them: the NULL point first, then the rest in
 * ascending order, those that overlap or touch merged into one.
 */
export function normalize(set: readonly Interval[]): Interval[] {
  const nulls = set.includes('null')
  const values = set.filter((i): i is Exclude<Interval, 'null'> => i !== 'null').sort((a, b) => {
    if (a.lo === undefined || b.lo === undefined) return a.lo === b.lo ? 0 : a.lo === undefined ? -1 : 1
    const c = compareValues(a.lo.v, b.lo.v) ?? 0
    return c !== 0 ? c : Number(b.lo.inclusive) - Number(a.lo.inclusive)
  })
  const out: Exclude<Interval, 'null'>[] = []
  for (const x of values) {
    const last = out.at(-1)
    // Disjoint when the last ends before this starts, or at its start with one of the two excluding it.
    const apart = last !== undefined && last.hi !== undefined && x.lo !== undefined && ((compareValues(last.hi.v, x.lo.v) ?? 0) < 0 || ((compareValues(last.hi.v, x.lo.v) ?? 0) === 0 && !last.hi.inclusive && !x.lo.inclusive))
    if (last === undefined || apart) {
      out.push(x)
      continue
    }
    if (last.hi === undefined) continue
    const hi = x.hi === undefined ? undefined : (compareValues(x.hi.v, last.hi.v) ?? 0) > 0 || ((compareValues(x.hi.v, last.hi.v) ?? 0) === 0 && x.hi.inclusive) ? x.hi : last.hi
    out[out.length - 1] = { ...(last.lo === undefined ? {} : { lo: last.lo }), ...(hi === undefined ? {} : { hi }) }
  }
  return nulls ? ['null', ...out] : out
}
