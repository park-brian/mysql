// The values of one column a condition admits, as intervals (M5.7): what the
// range optimizer reads an index by, and what proves a WHERE empty
// (`optimize.ts`). A condition that does not restrict the column, or compares
// it otherwise than as its own type, admits everything (`'all'`), so a range
// built from these is never too narrow; the WHERE is applied to every row it
// reads anyway (D-65).
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { decodeCollation, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef } from '@myjs/engine'
import { NODE, type Expression } from '@myjs/parser'
import { COERCIBILITY, charsetOfCollation, compareValues, intValue, integerBytes, integerRange, toInteger, type Value } from '@myjs/types'
import { REVERSE_COMPARISON, isNotEqual, logicalShortCircuit, nullLiteral, signedOperand } from './ast.ts'
import { proof } from './errors.ts'

/** A constant's value while planning — a literal, or a bound `?` — or `undefined` for anything else. */
export type Constant = (e: Expression) => Value | undefined

export type RangeValue = Extract<Value, { readonly kind: 'int' | 'decimal' | 'string' }>

/** One interval of a column's values, or the NULL point. An absent bound is unbounded. */
export type Interval = { readonly lo?: Bound; readonly hi?: Bound; readonly empty?: boolean } | 'null'
/** The values a condition admits: some intervals, or everything (`'all'`) when it does not restrict the column. */
export type RangeSet = readonly Interval[] | 'all'

const ALL_VALUES: Interval = {}

export function pointInterval(v: RangeValue): Interval {
  const endpoint = { v, inclusive: true }
  return { lo: endpoint, hi: endpoint }
}

const numericRange = (type: number): boolean => integerBytes(type) !== undefined || type === FIELD_TYPE.NEWDECIMAL || type === FIELD_TYPE.DECIMAL

/** CHAR storage drops trailing spaces that a NO PAD comparison still sees. */
export function significantCharPadding(v: Value, { type }: ColumnDef): boolean {
  return type.type === FIELD_TYPE.STRING && v?.kind === 'string' && v.v.endsWith(' ') && type.collationId !== undefined &&
    type.collationId !== CHARSET_BINARY && requireCollationInfo(type.collationId).padAttribute === 'NO PAD'
}

/** A constant brought to the column's comparison, or `undefined` when the two do not compare as the column's type. */
function constantFor(e: Expression, column: ColumnDef, value: Constant): RangeValue | null | undefined {
  const v = value(e)
  if (v === undefined || v === null) return v
  const { type, collationId } = column.type
  if (collationId !== undefined && collationId !== CHARSET_BINARY) {
    if (v.kind !== 'string' || v.coercibility <= COERCIBILITY.IMPLICIT) return undefined
    if (v.collationId === collationId) return v
    // Compare under the indexed collation without moving an unrepresentable key.
    if (charsetOfCollation(v.collationId) !== charsetOfCollation(collationId) &&
      proof(() => decodeCollation(encodeCollation(v.v, collationId), collationId)) !== v.v) return undefined
    return { ...v, collationId }
  }
  if (numericRange(type)) return v.kind === 'int' || v.kind === 'decimal' ? v : undefined
  return undefined
}

/** A fractional NOT IN list that can exclude NULL keys during access selection. */
export function fractionalNullList(items: readonly Expression[], column: ColumnDef, value: Constant): boolean {
  if (items.length !== 2 || !column.nullable || column.type.type !== FIELD_TYPE.LONG || column.type.unsigned === true) return false
  const [first, second] = items
  const other = nullLiteral(first) ? second : nullLiteral(second) ? first : undefined
  return other !== undefined && signedOperand(other).kind === NODE.LITERAL && fractionalIntBound(value(other))
}

/** A fractional decimal whose stored value stays within signed INT bounds. */
export function fractionalIntBound(v: Value | undefined): boolean {
  if (v?.kind !== 'decimal' || v.v % 10n ** BigInt(v.scale) === 0n) return false
  const rounded = toInteger(v)
  return BigInt.asIntN(32, rounded) === rounded
}

/** An indexed BETWEEN with exact written bounds whose comparison cannot hold. */
export function impossibleBetween(x: Expression, indexed: (e: Expression) => ColumnDef | undefined, value: Constant): boolean {
  if (x.kind !== NODE.BINARY || x.op !== 'BETWEEN') return false
  const column = indexed(x.left)
  const high = x.extra as Expression
  if (!column || !numericRange(column.type.type)) return false
  const literal = (bound: Expression): RangeValue | null | undefined => {
    if (signedOperand(bound).kind !== NODE.LITERAL) return undefined
    const v = constantFor(bound, column, value)
    return v === null && !nullLiteral(bound) ? undefined : v
  }
  const a = literal(x.right)
  const b = literal(high)
  if (a === undefined || b === undefined) return false
  // MySQL keeps the arm with a negative upper endpoint on an unsigned key.
  // When only one endpoint is NULL, the same guard applies to the other one.
  if (column.type.unsigned && compareValues(b ?? a, intValue(0n)) === -1) return false
  return a === null || b === null || compareValues(a, b) === 1
}

/** Keep the admissible arms of a positive disjunction for range planning. */
export function pruneImpossibleOr(e: Expression, impossible: (e: Expression) => boolean): Expression {
  if (e.kind !== NODE.BINARY || logicalShortCircuit(e.op) !== true) return e
  const left = pruneImpossibleOr(e.left, impossible)
  const right = pruneImpossibleOr(e.right, impossible)
  if (impossible(left)) return impossible(right) ? e : right
  return impossible(right) ? left : left === e.left && right === e.right ? e : { ...e, left, right }
}

export function rangeOf(e: Expression, isColumn: (e: Expression) => boolean, column: ColumnDef, value: Constant, storedBounds = false): RangeSet {
  if (e.kind === NODE.UNARY && (e.op === 'IS NULL' || e.op === 'IS NOT NULL') && isColumn(e.operand)) return e.op === 'IS NULL' ? (column.nullable ? ['null'] : []) : [ALL_VALUES]
  if (e.kind !== NODE.BINARY) return 'all'
  const disjunction = logicalShortCircuit(e.op)
  if (disjunction !== undefined) {
    const left = rangeOf(e.left, isColumn, column, value)
    const right = rangeOf(e.right, isColumn, column, value)
    if (!disjunction) return intersect(left, right)
    return left === 'all' || right === 'all' ? 'all' : [...left, ...right]
  }
  const onLeft = isColumn(e.left)
  if (e.op === 'BETWEEN' && onLeft) {
    const a = constantFor(e.right, column, value)
    const b = constantFor(e.extra as Expression, column, value)
    if (a === undefined || b === undefined) return 'all'
    if (a === null || b === null || (a.kind === 'int' && b.kind === 'int' && a.v > b.v)) return []
    const domain = storedBounds && integerRange(column.type)
    let empty = false
    if (domain) {
      // MySQL compares the original decimals with the stored integer bounds.
      // Adjacent stored bounds still form a range, even when both are exclusive.
      const low = toInteger(a)
      const high = toInteger(b)
      empty = high >= domain.min && low <= domain.max && (compareValues(a, intValue(high)) === 1 || compareValues(b, intValue(low)) === -1)
    }
    return [{ lo: { v: a, inclusive: true }, hi: { v: b, inclusive: true }, empty }]
  }
  if ((e.op === 'IN' || e.op === 'NOT IN') && onLeft && e.right.kind === NODE.ROW) {
    const items = e.right.items
    const negated = e.op === 'NOT IN'
    if (negated && fractionalNullList(items, column, value)) return [ALL_VALUES]
    const points: Interval[] = []
    for (const item of items) {
      const v = constantFor(item, column, value)
      if (v === undefined || (v === null && negated)) return 'all'
      if (v !== null && (!negated || !significantCharPadding(v, column))) points.push(pointInterval(v))
    }
    if (!negated) return points
    const out: Interval[] = []
    let lo: Bound
    for (const p of normalize(points)) {
      if (p === 'null' || p.lo === undefined) return 'all'
      out.push({ lo, hi: { v: p.lo.v, inclusive: false } })
      lo = { v: p.lo.v, inclusive: false }
    }
    out.push(lo === undefined ? ALL_VALUES : { lo })
    return out
  }
  const reverse = REVERSE_COMPARISON[e.op]
  if (reverse === undefined || !onLeft && !isColumn(e.right)) return 'all'
  const op = onLeft ? e.op : reverse
  const v = constantFor(onLeft ? e.right : e.left, column, value)
  if (v === undefined) return 'all'
  if (v === null) return op === '<=>' && column.nullable ? ['null'] : []
  // Leave a lossy exclusion to the residual filter, with only the NULLs skipped.
  if (isNotEqual(op) && significantCharPadding(v, column)) return [ALL_VALUES]
  switch (op) {
    case '=':
    case '<=>':
      return [pointInterval(v)]
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
  return { lo, hi }
}

type Bound = { readonly v: RangeValue; readonly inclusive: boolean } | undefined

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
    if (last === undefined) {
      out.push(x)
      continue
    }
    if (last.hi === undefined) continue
    if (x.lo !== undefined) {
      const order = compareValues(last.hi.v, x.lo.v) ?? 0
      // A shared endpoint separates two intervals only when neither includes it.
      if (order < 0 || (order === 0 && !last.hi.inclusive && !x.lo.inclusive)) {
        out.push(x)
        continue
      }
    }
    const order = x.hi === undefined ? 1 : compareValues(x.hi.v, last.hi.v) ?? 0
    if (order > 0 || (order === 0 && x.hi?.inclusive)) {
      out[out.length - 1] = { lo: last.lo, hi: x.hi }
    }
  }
  return nulls ? ['null', ...out] : out
}
