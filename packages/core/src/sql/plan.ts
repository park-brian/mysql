// M5.7, its first step — which rows to read: a key range when the WHERE clause
// pins an index's leading column, a full scan otherwise.
//
// The rule that keeps this safe (D-65): **the whole WHERE clause is applied
// to every row the range returns.** D-89 permits one FirstMatch integer bound
// to be omitted when a selected physical range and its point-key binding
// already enforce it; cost estimates alone are insufficient.
// A range can therefore only ever lose rows
// by being too narrow, never add wrong ones, and the planner's one job is to
// never be too narrow. It uses exact key conversions or, for decimal
// comparisons with an integer column, the integer endpoints admitted by
// the original comparison. Exact conversions include:
//
//   - an integer column against an integer constant in its range;
//   - a DECIMAL column against an exact constant with no more scale than it;
//   - a DOUBLE against any number (FLOAT is excluded: `f = 1.1` must not
//     find a row the float32 conversion would make equal);
//   - a text column against a string constant, compared under the column's
//     collation — a literal's coercibility always loses to a column's — and
//     no longer than the column;
//   - a binary column against a string or bytes;
//   - a temporal against a constant that parses to that temporal exactly.
//
// Anything else — `varchar_col = 1`, which compares as doubles — is a full
// scan, and correct.
//
// Row order matters as much as the rows: a query without ORDER BY returns
// rows in the order of its access path, and MySQL's choice of path decides
// that. Costed readers compare primary and secondary ranges with the scan.
// Without range costing, the fallback allows points on either key type and
// inequalities on the primary key only.
import { byteText, CHARSET_BINARY, FIELD_TYPE, equalBytes } from '@myjs/bytes'
import type { ColumnDef, IndexDef, KeyBound, KeyRange, TableDef } from '@myjs/engine'
import { NODE, type Expression } from '@myjs/parser'
import {
  MAX_SIGNED,
  MIN_SIGNED,
  bytesValue,
  compareValues,
  decimalValue,
  decodeField,
  doubleValue,
  encodeKey,
  intValue,
  integerRange,
  integerBytes,
  parseDecimal,
  renderDecimal,
  stringValue,
  keyPartOf,
  parseDateTime,
  toInteger,
  type Value,
} from '@myjs/types'
import type { Compiled, Env } from './compile.ts'
import { PAGE_READ, ROW_EVALUATE, rangeBaseline, rangeCost, indexUnionCost, type RangeShape, type RangeRead } from './cost.ts'
import { encodeBound, impossibleBetween, intersect, normalize, pointInterval, pruneImpossibleOr, rangeOf, significantCharPadding, type Constant, type Interval, type RangeSet, type RangeValue } from './ranges.ts'
import type { TableStatistics } from './stats.ts'
import { forwardKeyColumn, forwardKeyPart, singleRefIndex, uniquePoint } from './indexes.ts'
import { columnIndex } from './scope.ts'
import { isNotEqual, REVERSE_COMPARISON, isOrderedComparison, logicalShortCircuit, signedOperand } from './ast.ts'
import { proof } from './errors.ts'

/** Whether a named transformation is enabled in the normalized session settings. */
export function optimizerEnabled(env: Env | undefined, name: string): boolean {
  const setting = env?.state.systemVariable('optimizer_switch', undefined, env.session)
  return setting?.kind !== 'string' || !`,${setting.v},`.includes(`,${name}=off,`)
}

/** Available buffer for a sort, in bytes. */
export function sortBufferBytes(env: Env): number {
  return Number(toInteger(env.state.systemVariable('sort_buffer_size', undefined, env.session) ?? intValue(262144n)))
}

/** An inferred access condition, with source identity only for one proved integer bound. */
export type InferredRange = { readonly condition: Expression } & (
  | { readonly column: ColumnDef; readonly from: ColumnDef; readonly predicate: Extract<Expression, { kind: typeof NODE.BINARY }> }
  | { readonly column?: undefined; readonly from?: undefined; readonly predicate?: undefined }
)

type ImpliedRange = Extract<InferredRange, { readonly column: ColumnDef }>

/** How to read a table: an index and the ranges of it, in index order, or a full scan. */
export interface Access {
  /** A secondary range merged with one clustered range. */
  readonly indexUnion?: {
    readonly index: string
    readonly range: KeyRange
    readonly over: string
    readonly bound: Uint8Array
    readonly ordered: boolean
    readonly primaryFirst: boolean
  }
  /** Table cardinality for a noncovering text range's ordering competitor. */
  readonly orderRows?: number | undefined
  /** Range estimate from the same selection, when the optimizer measured it. */
  readonly quote?: RangeRead | undefined
  readonly index?: string
  /** Disjoint, ascending. Absent for a full scan. */
  readonly ranges?: readonly KeyRange[]
  /** Read in descending key order, for an ORDER BY … DESC the index gives. */
  readonly reverse?: boolean
  /** Exact compiler-produced integer bound applied by this selected range. */
  readonly implied?: ImpliedRange | undefined
  /** The range description for EXPLAIN. */
  readonly over?: string | undefined
}

export const FULL_SCAN: Access = {}
/** An empty read proved by the stored integer bounds of a direct BETWEEN. */
export const EMPTY_KEY_RANGES: readonly KeyRange[] = []

type Op = '=' | '<=>' | '<' | '<=' | '>' | '>=' | 'IN' | 'IS NULL' | 'IS NOT NULL'

interface KeyedInterval {
  readonly interval: Interval
  readonly range: KeyRange
  readonly point: boolean
}

interface Condition {
  readonly column: ColumnDef
  readonly op: Op
  readonly constants: readonly Expression[]
}


/**
 * A column of an enclosing query, compiled, when `e` is one: a constant for
 * each run of a correlated subquery, so an index can be looked up by it
 * (`ref` access: `WHERE ch.pa_id = pa.id` inside a subquery over `pa`).
 */
export type OuterColumn = (e: Expression) => Compiled | undefined

/** A written literal or marker. Range readers keep the default minus-only grammar. */
export function isConstant(e: Expression, plus?: '+'): boolean {
  const kind = signedOperand(e, plus).kind
  return kind === NODE.LITERAL || kind === NODE.PLACEHOLDER
}

/** BETWEEN requires agreeing literal items; bound markers retain their identity. */
export function equalBounds(e: Expression, env: Env, column: ColumnDef | undefined): boolean {
  if (e.kind !== NODE.BINARY || e.op !== 'BETWEEN' || e.extra === undefined ||
    signedOperand(e.right).kind !== NODE.LITERAL || signedOperand(e.extra as Expression).kind !== NODE.LITERAL) return false
  const a = constantValue(e.right, env)
  const b = constantValue(e.extra as Expression, env)
  // Neither NULL nor an unevaluated value can establish a bound.
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'string') {
    const text = b as typeof a
    return a.collationId === text.collationId && (column && column.type.collationId !== CHARSET_BINARY ? compareValues(a, text) === 0 : a.v === text.v)
  }
  return a.kind === 'bytes' ? equalBytes(a.v, (b as typeof a).v) : compareValues(a, b) === 0
}

/** A condition's top-level `AND`ed conjuncts, appended to `out`. */
export function splitAnd(e: Expression | undefined, out: Expression[] = []): Expression[] {
  if (e === undefined) return out
  if (e.kind === NODE.BINARY && logicalShortCircuit(e.op) === false) {
    splitAnd(e.left, out)
    splitAnd(e.right, out)
  } else out.push(e)
  return out
}

/** A column reference that names a column of this table, by its own name. */
export function tableColumn(e: Expression, def: TableDef, alias: string): ColumnDef | undefined {
  if (e.kind !== NODE.COLUMN) return undefined
  const parts = e.parts
  if (parts.length >= 2 && parts.at(-2) !== alias) return undefined
  if (parts.length === 3 && parts[0] !== def.schema) return undefined
  return def.columns[columnIndex(def.columns, parts.at(-1)!)]
}

function conditionOf(e: Expression, def: TableDef, alias: string, outer: OuterColumn | undefined, env: Env): Condition | undefined {
  const constant = (x: Expression): boolean => isConstant(x) || outer?.(x) !== undefined
  if (e.kind === NODE.UNARY && (e.op === 'IS NULL' || e.op === 'IS NOT NULL')) {
    const column = tableColumn(e.operand, def, alias)
    return column === undefined ? undefined : { column, op: e.op, constants: [] }
  }
  if (e.kind !== NODE.BINARY) return undefined
  const left = tableColumn(e.left, def, alias)
  if (e.op === 'IN' && e.right.kind === NODE.ROW && e.right.items.every(constant)) {
    return left === undefined ? undefined : { column: left, op: 'IN', constants: e.right.items }
  }
  if (e.op === 'BETWEEN' && left !== undefined && equalBounds(e, env, left)) return { column: left, op: '=', constants: [e.right] }
  const op = isNotEqual(e.op) ? undefined : REVERSE_COMPARISON[e.op] as Op | undefined
  if (op === undefined) return undefined
  if (left !== undefined && constant(e.right)) return { column: left, op: e.op as Op, constants: [e.right] }
  const right = tableColumn(e.right, def, alias)
  if (right !== undefined && constant(e.left)) return { column: right, op, constants: [e.left] }
  return undefined
}

/**
 * Whether `v` compared with column `c` compares as `c`'s own type and converts
 * to it without loss — the condition for using its bytes as a key bound.
 */
function exact(v: Value, c: ColumnDef): boolean {
  if (v === null) return false
  const t = c.type
  switch (t.type) {
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP: {
      // A key bound must not move when stored at the column's precision.
      const parsed = v.kind === 'string' ? parseDateTime(v.v) : undefined
      if (t.type === FIELD_TYPE.DATE) return v.kind === 'datetime' ? v.type === 'DATE' : parsed?.hasTime === false
      const micros = v.kind === 'datetime' ? v.v.microsecond : parsed?.v.microsecond
      return micros !== undefined && micros % 10 ** (6 - (t.decimals ?? 0)) === 0
    }
    case FIELD_TYPE.STRING:
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.VARCHAR: {
      if (t.collationId === undefined || t.collationId === CHARSET_BINARY) return v.kind === 'bytes' || v.kind === 'string'
      // The column's collation decides the comparison only against a string
      // whose own coercibility is weaker (a literal's or a parameter's).
      if (v.kind !== 'string' || v.coercibility <= 2) return false
      return [...v.v].length <= (t.length ?? 1) && !significantCharPadding(v, c)
    }
    default:
      return exactNumber(v, c)
  }
}

/**
 * The access path for a single-table WHERE clause. `alias` is the name the
 * statement gives the table. Constants are evaluated now, with `env`, which
 * is why the plan is made per execution (a `?` is a constant by then).
 */
export function chooseAccess(def: TableDef, alias: string, where: Expression | undefined, env: Env, outer?: OuterColumn, costing?: RangeCosting, inferred?: InferredRange, indexes = def.indexes): Access {
  const conjuncts = splitAnd(inferred?.condition, splitAnd(where))
  const conditions = conjuncts.flatMap((e) => conditionOf(e, def, alias, outer, env) ?? [])
  const read = conditionAccess(def, conditions, env, outer, indexes, costing === undefined)
  return read ?? (costing && (rangeAccess(def, alias, conjuncts, env, costing, undefined, inferred, indexes) ??
    indexUnionAccess(def, alias, inferred?.condition ?? (costing.allowIndexUnion ? where : undefined), env, costing, indexes))) ?? FULL_SCAN
}

/** Points win first, with the primary or clustered key preferred among them. */
function conditionAccess(def: TableDef, conditions: readonly Condition[], env: Env, outer: OuterColumn | undefined, indexes: readonly IndexDef[], allowRange: boolean): Access | undefined {
  if (!conditions.length) return undefined
  const evaluate: Constant = (e) => proof(() => {
    const o = outer?.(e)
    return o === undefined ? constantValue(e, env) : o.eval([], env)
  })
  const unresolved = env.outer === undefined ? outer : undefined
  let point: Access | undefined
  let range: Access | undefined
  for (const index of indexes) {
    const column = forwardKeyColumn(def, index)
    if (column === undefined) continue
    const eligible = conditions.filter((c) => c.column === column)
    const points = pointRanges(column, eligible, unresolved, evaluate)
    if (points) {
      const access = { index: index.name, ranges: points, over: allowRange ? undefined : describePoints(points, column) }
      if (index.kind === 'primary') return access
      if (point === undefined || index.name === def.clustered) point = access
    } else if (points === undefined && allowRange && index.kind === 'primary') {
      range = primaryRange(index, column, eligible, evaluate)
    }
  }
  return point ?? range
}

/**
 * A range re-planned for each row of the tables before it ("range checked
 * for each record"): the range optimizer's choice with `known` giving the
 * earlier tables' values, or a full scan.
 */
export function dynamicAccess(def: TableDef, alias: string, conjuncts: readonly Expression[], env: Env, costing: RangeCosting, known: Constant): Access {
  return rangeAccess(def, alias, conjuncts, env, costing, known) ?? FULL_SCAN
}

/** What the range optimizer weighs a table's ranges by (M5.7). */
export interface RangeCosting {
  /** The query has no early ordered-reader competitor. */
  readonly allowIndexUnion?: boolean | undefined
  /** Request selected-range row estimates alongside the physical access. */
  readonly quote?: boolean
  /** FORCE INDEX excludes the table-scan cost for an eligible unordered read. */
  readonly forceRange?: boolean | undefined
  /** Whether a written index hint can change which keys provide a range. */
  readonly hasIndexHints?: boolean
  readonly stats: TableStatistics
  /** The existing range price inputs for one index. */
  shape(index: IndexDef): RangeShape
  /** The shortest index that covers the query, for a full scan of it, if any. */
  readonly coveringScan: IndexDef | undefined
  /** Count until more than `limit` rows are found: the server's index dives, exact on a small table. */
  count(index: string, range: KeyRange, limit: number): number
}

/** Merge one nullable integer secondary range and one signed INT primary range. */
function indexUnionAccess(def: TableDef, alias: string, where: Expression | undefined, env: Env, costing: RangeCosting, indexes: readonly IndexDef[]): Access | undefined {
  if (def.engine !== 'native' || where?.kind !== NODE.BINARY || !logicalShortCircuit(where.op)) return undefined
  const primary = indexes.find((key) => key.kind === 'primary')
  if (primary?.parts.length !== 1) return undefined
  const pk = forwardKeyColumn(def, primary)
  if (pk?.type.type !== FIELD_TYPE.LONG || pk.type.unsigned) return undefined
  const left = conditionOf(where.left, def, alias, undefined, env)
  const right = conditionOf(where.right, def, alias, undefined, env)
  const primaryFirst = left?.column === pk
  const [comparison, secondaryCondition] = primaryFirst ? [left, right] : [right, left]
  if (comparison?.column !== pk || !isOrderedComparison(comparison.op)) return undefined
  if (!secondaryCondition) return undefined
  const { op, column } = secondaryCondition
  const ordered = isOrderedComparison(op)
  const point = op === '=' || op === 'IS NULL'
  if (point ? !costing.allowIndexUnion : !ordered && op !== 'IS NOT NULL') return undefined
  if (!column.nullable || !integerBytes(column.type.type)) return undefined
  const [secondary, rival] = indexes.filter((key) => forwardKeyColumn(def, key) === column)
  if (rival || !singleRefIndex(secondary)) return undefined
  const bound = constantValue(comparison.constants[0]!, env)
  if (bound?.kind !== 'int') return undefined
  const edge = { v: bound, inclusive: comparison.op.endsWith('=') }
  const key = encodeBound(bound, pk, edge.inclusive)
  if (!key) return undefined
  const upper = comparison.op.startsWith('<')
  const pkRange = upper ? { to: key } : { from: key }
  let secondaryInterval: Interval = op === 'IS NULL' ? 'null' : {}
  if (ordered || op === '=') {
    const value = constantValue(secondaryCondition.constants[0]!, env)
    if (value?.kind !== 'int' && value?.kind !== 'decimal') return undefined
    const endsBelow = op.startsWith('<')
    // Round a range outward, retaining whether an equality is exact.
    const { integer, fractional } = integerEndpoint(value, endsBelow)
    if (op === '=') {
      if (fractional) return undefined
      secondaryInterval = pointInterval(intValue(integer))
    } else {
      const inclusive = !fractional && op.endsWith('=')
      const { min, max } = integerRange(column.type)!
      const endpoint = endsBelow ? min : max
      if ((endsBelow ? integer < min : integer > max) || (integer === endpoint && !inclusive)) {
        // An impossible arm leaves only the primary comparison as an access path.
        return costing.allowIndexUnion
          ? rangeAccess(def, alias, [primaryFirst ? where.left : where.right], env, costing) : undefined
      }
      if (integer === endpoint && (endsBelow || costing.allowIndexUnion)) {
        if (!costing.allowIndexUnion) return undefined
        secondaryInterval = pointInterval(intValue(endpoint))
      } else {
        // An edge admitting its domain limit admits every non-NULL key.
        const limit = endsBelow ? max : min
        if ((endsBelow ? integer < limit : integer > limit) || (integer === limit && !inclusive)) {
          const edge = { v: intValue(integer), inclusive }
          secondaryInterval = endsBelow ? { hi: edge } : { lo: edge }
        }
      }
    }
  }
  if (!optimizerEnabled(env, 'index_merge')) return undefined
  const keyed = keyRanges([secondaryInterval], column)?.[0]
  const secondaryRange = keyed?.range
  if (secondaryRange?.from === undefined) return undefined
  const rowIdOrdered = keyed!.point && optimizerEnabled(env, 'index_merge_union')
  if (!rowIdOrdered && !optimizerEnabled(env, 'index_merge_sort_union')) return undefined
  const { stats, coveringScan } = costing
  // Keep this merge within the existing range budget for an in-memory Sort Union.
  const limit = Math.min(stats.rows - 2, Math.floor(sortBufferBytes(env) / 64) - 1)
  if (limit < 1) return undefined
  const secondaryRows = Math.max(1, costing.count(secondary.name, secondaryRange, limit))
  if (secondaryRows > limit) return undefined
  const primaryRows = Math.max(1, costing.count(primary.name, pkRange, stats.rows - secondaryRows - 1))
  if (primaryRows + secondaryRows >= stats.rows) return undefined
  const reads = rangeCost(stats, { ...costing.shape(secondary), covering: true }, 1, secondaryRows) +
    rangeCost(stats, { ...costing.shape(primary), covering: rowIdOrdered }, 1, primaryRows)
  if (reads + indexUnionCost(stats, primaryRows, secondaryRows, rowIdOrdered) >=
      rangeBaseline(stats, coveringScan && costing.shape(coveringScan).recordBytes)) return undefined
  return {
    index: primary.name, ranges: [pkRange], over: describeIntervals([upper ? { hi: edge } : { lo: edge }], pk.name),
    indexUnion: {
      index: secondary.name, range: secondaryRange, over: describeIntervals([secondaryInterval], column.name, true),
      bound: encodeKey(key.values, [keyPartOf(pk.type, pk.nullable)]), ordered: rowIdOrdered, primaryFirst,
    },
  }
}

/**
 * The cheapest range of any index's leading column (`get_key_scans_params`),
 * if one beats a scan (`rangeBaseline`): its intervals from the conjuncts
 * (`ranges.ts`), each key bound converted as `exact` allows or, for an integer
 * column, rounded outward, so the range is never too narrow; its rows counted
 * as the server's dives count them, at least one a range, a unique key's
 * point one; its cost `rangeCost`. Indexes are tried in the server's key order
 * and a later one wins only if strictly cheaper.
 */
export function rangeAccess(def: TableDef, alias: string, conjuncts: readonly Expression[], env: Env, costing: RangeCosting, known?: Constant, inferred?: InferredRange, indexes = def.indexes): Access | undefined {
  const value = (e: Expression): Value | undefined => (e.kind === NODE.PLACEHOLDER && e.index >= env.params.length ? undefined : isConstant(e) ? constantValue(e, env) : known?.(e))
  const candidates: { readonly index: IndexDef; readonly column: ColumnDef; readonly intervals: Interval[]; readonly keyed: readonly KeyedInterval[]; readonly shape: RangeShape; readonly empty: boolean | undefined; readonly implied: ImpliedRange | undefined }[] = []
  const eligible = keyOrder(def, indexes)
  const indexedColumn = (subject: Expression): ColumnDef | undefined => {
    const column = tableColumn(subject, def, alias)
    return column !== undefined && eligible.some((index) => forwardKeyPart(index)?.column === column.name) ? column : undefined
  }
  const simplify = known === undefined && !costing.hasIndexHints
    ? (e: Expression) => pruneImpossibleOr(e, (arm) => impossibleBetween(arm, indexedColumn, value))
    : undefined
  const storedBounds = known === undefined && conjuncts.length === 1
  const primaryNullList = known === undefined && !costing.hasIndexHints && costing.coveringScan === undefined
  for (const index of eligible) {
    const column = forwardKeyColumn(def, index)
    if (column === undefined) continue
    let set: RangeSet = 'all'
    let implied: ImpliedRange | undefined
    const isColumn = (e: Expression) => tableColumn(e, def, alias) === column
    for (const c of conjuncts) {
      let range = rangeOf(c, isColumn, column, value, storedBounds, primaryNullList && index.kind === 'primary')
      if (range === 'all' && index.kind !== 'primary' && column.type.type === FIELD_TYPE.VAR_STRING) {
        const predicate = simplify?.(c)
        if (predicate !== undefined && predicate !== c) {
          const points = rangeOf(predicate, isColumn, column, value)
          if (points !== 'all' && points.length > 0 && points.every((i) => i !== 'null' && i.lo !== undefined && i.lo === i.hi)) range = points
        }
      }
      if (c === inferred?.condition && range !== 'all' && inferred.column === column) implied = inferred
      set = intersect(set, range)
    }
    if (set === 'all') continue
    const intervals = normalize(set)
    const keyed = keyRanges(intervals, column)
    if (keyed === undefined) continue
    const first = intervals[0]
    // EXPLAIN describes the intervals that could be encoded as key ranges.
    const bounds = keyed.length && keyed.length < intervals.length ? keyed.map((k) => k.interval) : intervals
    candidates.push({ index, column, intervals: bounds, keyed, shape: costing.shape(index), empty: first === 'null' ? undefined : first?.empty, implied })
  }
  // No range at all reads no statistics.
  if (candidates.length === 0) return undefined
  const { stats: t, coveringScan, forceRange } = costing
  let best = rangeBaseline(t, coveringScan && costing.shape(coveringScan).recordBytes, forceRange)
  const competesForOrder = ({ shape, column }: (typeof candidates)[number]): boolean =>
    !shape.clustered && !shape.covering && column.type.collationId !== undefined
  const access = (c: (typeof candidates)[number], rows?: number): Access => ({
    index: c.index.name, ranges: c.empty ? EMPTY_KEY_RANGES : c.keyed.map((k) => k.range), over: describeIntervals(c.intervals, c.column.name), implied: c.implied,
    quote: rows === undefined ? undefined : { index: c.index.name, rows, cost: best }, orderRows: competesForOrder(c) ? t.rows : undefined,
  })
  // One range that wins even reading every row needs no count: no other is weighed against it.
  const only = candidates.length === 1 ? candidates[0] : undefined
  if (!costing.quote && only !== undefined && !competesForOrder(only) && rangeCost(t, only.shape, only.keyed.length, t.rows) < best) return access(only)
  // MySQL skips index dives for one forced key. A nonpoint, non-NULL range estimates one row.
  const skipDive = forceRange && indexes.length === 1
  let chosen: Access | undefined
  for (const c of candidates) {
    // Bound the dive by costs every row incurs. Price the measured range below.
    const minRowCost = c.shape.clustered || c.shape.covering ? ROW_EVALUATE : PAGE_READ + ROW_EVALUATE
    const limit = Math.ceil(best / minRowCost)
    if (limit < c.keyed.length) continue
    // Cost the same range even when its stored endpoints let us skip the dive.
    // A unique key's non-NULL point estimates one row. Other ranges cost at least one row.
    const unique = uniquePoint(c.index, c.column)
    let rows = 0
    for (const { range, point } of c.keyed) {
      const estimated = c.empty || (range.to?.values[0] !== null && (point ? unique : skipDive))
      rows += estimated ? 1 : Math.max(1, costing.count(c.index.name, range, limit - rows + 1))
      if (rows > limit) break
    }
    if (rows > limit) continue
    const cost = rangeCost(t, c.shape, c.keyed.length, rows)
    if (!(cost < best)) continue
    best = cost
    chosen = access(c, rows)
  }
  return chosen
}

const NULL_KEY: KeyBound = { values: [null], inclusive: true }
const pointRange = (bound: KeyBound): KeyRange => ({ from: bound, to: bound })

/** A multi-point read shows the bounds in physical key order. */
function describePoints(points: readonly KeyRange[], column: ColumnDef): string | undefined {
  const t = column.type
  if (points.length < 2) return undefined
  if (integerBytes(t.type) === undefined && (t.type !== FIELD_TYPE.VAR_STRING || t.collationId === undefined || t.collationId === CHARSET_BINARY)) return undefined
  return describeBounds(points, (point) => describeInterval(pointInterval(decodeField(point.from!.values[0]!, t) as RangeValue), column.name))
}

/** Intervals as EXPLAIN writes a range: `(2 < grp <= 5) OR (grp = 7)`, `(NULL < grp)`, `(grp = NULL)`. */
function describeIntervals(intervals: readonly Interval[], name: string, nullLower?: boolean): string {
  return describeBounds(intervals, (i) => describeInterval(i, name, nullLower))
}

function describeBounds<T>(items: readonly T[], describe: (item: T) => string): string {
  if (items.length > 3) return `${describe(items[0]!)} OR ${describe(items[1]!)} OR (${items.length - 2} more)`
  return items.map(describe).join(' OR ')
}

function rangeText(v: RangeValue): string {
  if (v.kind === 'string') return `'${v.v.replace(/'/g, "''")}'`
  return v.kind === 'decimal' ? renderDecimal(v) : String(v.v)
}

function describeInterval(i: Interval, name: string, nullLower?: boolean): string {
  if (i === 'null') return `(${name} = NULL)`
  const { lo, hi } = i
  if (lo?.inclusive && hi?.inclusive && compareValues(lo.v, hi.v) === 0) return `(${name} = ${rangeText(lo.v)})`
  const lower = lo ? `${rangeText(lo.v)} ${lo.inclusive ? '<=' : '<'} ` : hi && !nullLower ? '' : 'NULL < '
  const upper = hi ? ` ${hi.inclusive ? '<=' : '<'} ${rangeText(hi.v)}` : ''
  return `(${lower}${name}${upper})`
}

/** The integer next to an exact numeric endpoint in the requested direction. */
function integerEndpoint(v: Exclude<RangeValue, { readonly kind: 'string' }>, ceil: boolean) {
  const scale = v.kind === 'decimal' ? 10n ** BigInt(v.scale) : 1n
  const fraction = v.v % scale
  const adjustment = ceil ? (fraction > 0n ? 1n : 0n) : (fraction < 0n ? -1n : 0n)
  return { integer: v.v / scale + adjustment, fractional: fraction !== 0n }
}

/**
 * Key ranges for a column's intervals, ascending: each bound the key of its
 * value where it converts exactly, an integer column's bound rounded outward
 * (`< 5.5` reads up to 5, `> 5.5` from 6); `undefined` when a bound converts
 * neither way. Values are non-NULL, so a range with no lower bound starts
 * after the NULLs. `point` marks a range constrained to one key value.
 */
function keyRanges(intervals: readonly Interval[], column: ColumnDef): KeyedInterval[] | undefined {
  const range = integerRange(column.type)
  const side = (b: { readonly v: RangeValue; readonly inclusive: boolean }, lower: boolean): KeyBound | 'empty' | 'open' | undefined => {
    let { v, inclusive } = b
    if (range !== undefined && v.kind !== 'string') {
      const { integer: n, fractional } = integerEndpoint(v, lower)
      inclusive ||= fractional
      if (n > range.max) return lower ? 'empty' : 'open'
      if (n < range.min) return lower ? 'open' : 'empty'
      v = intValue(n, n > MAX_SIGNED)
    } else if (!exact(v, column)) return undefined
    return encodeBound(v, column, inclusive)
  }
  const out: KeyedInterval[] = []
  for (const i of intervals) {
    if (i === 'null') {
      out.push({ interval: i, range: pointRange(NULL_KEY), point: true })
      continue
    }
    const from = i.lo === undefined ? 'open' : side(i.lo, true)
    const to = i.hi === undefined ? 'open' : side(i.hi, false)
    if (from === undefined || to === undefined) return undefined
    if (from === 'empty' || to === 'empty') continue
    const lower = from === 'open' ? (column.nullable ? { values: [null], inclusive: false } : undefined) : from
    // Present endpoints here encode one non-NULL value each.
    const point = from !== 'open' && to !== 'open' && from.inclusive && to.inclusive && equalBytes(from.values[0]!, to.values[0]!)
    const key: { from?: KeyBound; to?: KeyBound } = {}
    if (lower !== undefined) key.from = lower
    if (to !== 'open') key.to = to
    out.push({ interval: i, range: key, point })
  }
  return out
}

/**
 * A table's indexes in the order the server keeps them (`sort_keys`): the
 * PRIMARY KEY, then unique keys of NOT NULL columns, then other unique keys,
 * then the rest, each group as written. Invisible ones are left out.
 */
export function keyOrder(def: TableDef, indexes = def.indexes): IndexDef[] {
  const rank = (i: IndexDef): number => {
    if (i.kind === 'primary') return 0
    if (i.kind !== 'unique') return 3
    return i.parts.every((p) => def.columns.find((c) => c.name === p.column)?.nullable === false) ? 1 : 2
  }
  return indexes.filter((i) => i.invisible !== true).sort((a, b) => rank(a) - rank(b))
}

/**
 * Whether every value an enclosing query's column can hold converts to
 * `column` exactly — `exact` decided by type, for a plan made before the
 * outer row is there to ask (EXPLAIN). It is true only where `exact` is true
 * of every non-NULL value of that type, so the run, which asks the value,
 * reads the same index.
 */
function exactType(t: Compiled['type'], c: ColumnDef): boolean {
  return !(t.kind === 'int' && t.literalInt !== undefined) && exactNumber(t, c)
}

/** Numeric key compatibility for a known value or an outer column's type. */
function exactNumber(t: Exclude<Value, null> | Compiled['type'], c: ColumnDef): boolean {
  const col = c.type
  if (integerBytes(col.type) !== undefined) return t.kind === 'int'
  switch (col.type) {
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return t.kind === 'int' || (t.kind === 'decimal' && t.scale <= (col.scale ?? 0) && !('display' in t && t.display !== undefined))
    case FIELD_TYPE.DOUBLE:
      return t.kind === 'int' || t.kind === 'decimal' || t.kind === 'double'
    default:
      return false
  }
}

/** A bound no row is read by: a plan's lookup by a value it does not have yet (see `exactType`). */
const UNBOUND: KeyBound = { values: [], inclusive: true }

/** False rejects the index. Undefined leaves its inequalities eligible. */
function pointRanges(column: ColumnDef, conditions: readonly Condition[], outer: OuterColumn | undefined, evaluate: Constant): KeyRange[] | false | undefined {
  if (outer) for (const c of conditions) {
    if (c.op !== '=') continue
    const bound = outer(c.constants[0]!)
    if (bound !== undefined) return exactType(bound.type, column) && [pointRange(UNBOUND)]
  }
  for (const c of conditions) {
    if (c.op === 'IS NULL' || c.op === '<=>') {
      // NULL-safe: `= v` for a value, IS NULL for NULL — a key read either way.
      const v = c.op === 'IS NULL' ? null : evaluate(c.constants[0] as Expression)
      // Separate bounds keep this a range in the plan description.
      if (v === null && column.nullable) return [{ from: NULL_KEY, to: { ...NULL_KEY } }]
      const b = v === undefined || v === null || !exact(v, column) ? undefined : encodeBound(v, column, true)
      if (b !== undefined) return [pointRange(b)]
      continue
    }
    if (c.op === '=' || c.op === 'IN') {
      const values = c.constants.map(evaluate)
      if (values.some((v) => v === undefined || !exact(v ?? null, column))) continue
      // The points are ordered and made distinct by their encoded keys —
      // the index's own order and equality. Comparing the constants as
      // values would use the literal's collation, not the column's: under
      // `SET NAMES … COLLATE utf8mb4_bin`, `IN ('a', 'A')` on a case-
      // insensitive column read the same key twice (found by review).
      // A byte a character: the strings order as the keys do.
      const part = keyPartOf(column.type, true)
      const points = new Map<string, KeyBound>()
      for (const v of values as Value[]) {
        const b = encodeBound(v, column, true)
        if (b === undefined) return false
        points.set(byteText(encodeKey(b.values, [part])), b)
      }
      return [...points.keys()].sort().map((key) => pointRange(points.get(key)!))
    }
  }
  return undefined
}

/** Without the cost model, only the primary key can use inequality bounds. */
function primaryRange(index: IndexDef, column: ColumnDef, conditions: readonly Condition[], evaluate: Constant): Access | undefined {
  const range: { from?: KeyBound; to?: KeyBound } = {}
  for (const c of conditions) {
    if (!isOrderedComparison(c.op)) continue
    const v = evaluate(c.constants[0] as Expression)
    if (v === undefined || !exact(v, column)) continue
    const b = encodeBound(v, column, c.op === '<=' || c.op === '>=')
    if (b === undefined) continue
    if (c.op === '>' || c.op === '>=') range.from ??= b
    else range.to ??= b
  }
  // A lower bound alone still skips the NULLs a clustered key cannot hold anyway.
  return range.from === undefined && range.to === undefined ? undefined : { index: index.name, ranges: [range] }
}

/**
 * A point read of a unique index for one value, or `undefined` when the value
 * does not convert to the key's type exactly — in which case the caller scans
 * and filters, which finds the same rows (D-65).
 */
export function pointAccess(index: IndexDef, column: ColumnDef, v: Value): Access | undefined {
  if (!exact(v, column)) return undefined
  const b = encodeBound(v, column, true)
  return b === undefined ? undefined : { index: index.name, ranges: [pointRange(b)] }
}

/** A literal, `-literal` or `?`, evaluated. */
export function constantValue(e: Expression, env: Env): Value | undefined {
  switch (e.kind) {
    case NODE.PLACEHOLDER:
      return env.params[e.index] ?? null
    case NODE.UNARY: {
      const v = constantValue(e.operand, env)
      if (v === undefined || v === null) return v
      if (v.kind === 'int') {
        // A signed literal can cross the BIGINT range without becoming NULL.
        const n = -v.v
        return n < MIN_SIGNED || n > MAX_SIGNED ? decimalValue(n, 0) : intValue(n)
      }
      if (v.kind === 'decimal') return { ...v, v: -v.v }
      if (v.kind === 'double') return doubleValue(-v.v)
      return undefined
    }
    case NODE.LITERAL:
      return literalValue(e, env)
    default:
      return undefined
  }
}

/** A literal's value, without compiling it: the planner's own small evaluator, kept to the kinds `exact` accepts. */
function literalValue(e: Expression & { kind: typeof NODE.LITERAL }, env: Env): Value | undefined {
  switch (e.type) {
    case 'int': {
      const n = e.value as bigint
      return intValue(n, n > MAX_SIGNED)
    }
    case 'decimal':
      return parseDecimal(e.value as string)
    case 'double':
      return doubleValue(e.value as number)
    case 'string':
      // An introducer or COLLATE changes what the literal compares as; leave those to the scan.
      if (e.charset !== undefined || e.collation !== undefined) return undefined
      return stringValue(e.value as string, env.session.characterSet)
    case 'hex':
      return bytesValue(e.value as Uint8Array)
    case 'null':
      return null
    default:
      // An unevaluated literal is not SQL NULL: leave its comparison to the scan.
      return undefined
  }
}

