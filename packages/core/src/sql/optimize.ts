// M5.4 / M5.7 — what MySQL's optimizer knows before it reads a row.
//
// An executor that returns the right rows can still tell a client the wrong
// thing, because 8.4.11 decides whether to copy a query's results through a
// temporary table only after its optimizer has looked at the query — and
// when the optimizer proves the result empty ("Zero rows") it makes no table
// at all, so the items keep their own metadata. Equally, a table the
// optimizer reads as a constant contributes constants, which no temporary
// table copies. So this reproduces the part of the optimizer that decides
// those two things, each rule read off a plan of M5.18's corpus:
//
//   - **Outer-join simplification** (`simplify_joins`): a WHERE condition that
//     rejects NULL on a table an outer join could null turns that join inner,
//     and its ON joins the WHERE.
//   - **Equality propagation**: columns an equality joins form a class, and a
//     constant one of them is held to is substituted into every other
//     condition; one that then folds to false or NULL proves the result empty.
//   - **Impossible ranges**: an indexed column (or one equal to an indexed
//     column) compared with NULL, an empty BETWEEN over one, an integer
//     column against a number it can never equal, a NOT NULL column `IS NULL`.
//     An *unindexed* `c = NULL` is not folded (M5.8's review).
//   - **Const tables**: a table whose PRIMARY or NOT NULL UNIQUE key is held
//     to constants is read while planning; with no such row the result is
//     empty, and with one its columns are constants.
import type { ColumnDef, Table, TableDef, Trx } from '@myjs/engine'
import { NODE, type Expression } from '@myjs/parser'
import { compareValues, integerRange, truth, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type CompileContext, type Env } from './compile.ts'
import type { FromPlan } from './from.ts'
import { accessRows, pointAccess } from './plan.ts'

export interface ConstTable {
  readonly alias: string
  readonly def: TableDef
  readonly table: Table
  /** The key's columns and the constants they are held to. */
  readonly key: readonly { readonly column: ColumnDef; readonly value: Expression }[]
}

export interface OptimizerFacts {
  /** Proved empty without reading a row. */
  readonly empty: boolean
  readonly constTables: readonly ConstTable[]
  /**
   * Under STRAIGHT_JOIN the join order is the statement's, and a const table
   * is not read ahead of it: a missing row proves nothing, though its columns
   * are still constants (8.4.11: "Constant row from c1" over an id it lacks).
   */
  readonly straight: boolean
  /**
   * An outer join's inner tables whose ON can never hold, read as one
   * NULL-complemented row (8.4.11: `LEFT JOIN p1 ON … AND p1.id BETWEEN NULL
   * AND 4` over an indexed `id` plans no read of p1). Their columns are still
   * copied into a temporary table, but are never its key: a GROUP BY on one
   * has no GROUP_FLAG.
   */
  readonly nullTables?: ReadonlySet<string>
}

const NO_FACTS: OptimizerFacts = { empty: false, constTables: [], straight: false }

/** What the optimizer proves of a FROM and WHERE. `ctx` compiles constants. */
export function optimizerFacts(from: FromPlan | undefined, where: Expression | undefined, limitCount: number | undefined, ctx: CompileContext, env: Env, straight = false): OptimizerFacts {
  if (limitCount === 0) return { empty: true, constTables: [], straight }
  if (from === undefined) return NO_FACTS
  straight = straight || from.straight
  const scope = from.scope

  const flatten = (e: Expression | undefined, out: Expression[]): Expression[] => {
    if (e === undefined) return out
    if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) {
      flatten(e.left, out)
      flatten(e.right, out)
    } else out.push(e)
    return out
  }
  const slot = (e: Expression): number | undefined => {
    if (e.kind !== NODE.COLUMN) return undefined
    try {
      return scope.resolve(e.parts, 'where clause').index
    } catch {
      return undefined
    }
  }
  const aliasOf = (index: number): string | undefined => scope.columnAt(index)?.table.alias

  // Outer-join simplification, to a fixed point: a null-rejecting condition on
  // an outer join's nullable side makes it an inner join.
  const pool = flatten(where, [])
  for (const j of from.joins) if (!j.left && !j.nested) flatten(j.on, pool)
  const converted = new Set<number>()
  for (let changed = true; changed; ) {
    changed = false
    from.joins.forEach((j, n) => {
      if (!j.left || converted.has(n)) return
      const rejects = pool.some((c) => nullRejected(c, slot).some((i) => j.innerAliases.has(aliasOf(i) ?? '')))
      if (!rejects) return
      converted.add(n)
      changed = true
      if (!j.nested) flatten(j.on, pool)
    })
  }
  const nullable = new Set<string>()
  from.joins.forEach((j, n) => {
    if (j.left && !converted.has(n)) for (const a of j.innerAliases) nullable.add(a)
  })
  const columnAt = (index: number): { def: TableDef; column: ColumnDef; alias: string } | undefined => {
    const hit = scope.columnAt(index)
    const def = hit?.table.def
    if (hit === undefined || def === undefined || nullable.has(hit.table.alias)) return undefined
    const column = def.columns.find((c) => c.name === hit.column.name)
    return column === undefined ? undefined : { def, column, alias: hit.table.alias }
  }

  // Equality classes, and the constants they are held to.
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as number
    return r
  }
  const union = (a: number, b: number): void => {
    parent.set(find(a), find(b))
  }
  const isConstant = (e: Expression): boolean =>
    (e.kind === NODE.LITERAL && e.type !== 'null') || (e.kind === NODE.PLACEHOLDER && ctx.params !== undefined) || (e.kind === NODE.UNARY && e.op === '-' && isConstant(e.operand))
  for (const c of pool) {
    if (c.kind === NODE.BINARY && c.op === '=') {
      const l = slot(c.left)
      const r = slot(c.right)
      if (l !== undefined && r !== undefined) union(l, r)
    }
  }
  const pinned = new Map<number, Expression>()
  for (const c of pool) {
    if (c.kind !== NODE.BINARY || (c.op !== '=' && c.op !== '<=>')) continue
    const l = slot(c.left)
    const r = slot(c.right)
    if (l !== undefined && isConstant(c.right)) pinned.set(find(l), c.right)
    else if (r !== undefined && isConstant(c.left)) pinned.set(find(r), c.left)
  }
  const indexedClass = (index: number): boolean => {
    const root = find(index)
    for (const t of scope.tables) {
      if (t.def === undefined || nullable.has(t.alias)) continue
      for (let i = 0; i < t.columns.length; i++) {
        if (find(t.offset + i) !== root) continue
        const name = (t.columns[i] as { name: string }).name
        if (t.def.indexes.some((x) => x.parts[0]?.column === name && x.parts[0]?.prefix === undefined)) return true
      }
    }
    return false
  }
  const isNull = (e: Expression | undefined): boolean => e !== undefined && e.kind === NODE.LITERAL && e.type === 'null'
  const literalNumber = (e: Expression): number | undefined => {
    const neg = e.kind === NODE.UNARY && e.op === '-'
    const lit = neg ? e.operand : e
    if (lit.kind !== NODE.LITERAL || (lit.type !== 'int' && lit.type !== 'decimal' && lit.type !== 'double')) return undefined
    return (neg ? -1 : 1) * Number(lit.value)
  }

  const impossible = (c: Expression): boolean => {
    if (c.kind === NODE.UNARY && c.op === 'IS NULL') {
      const i = slot(c.operand)
      const col = i === undefined ? undefined : columnAt(i)
      if (col !== undefined && !col.column.nullable) return true
    }
    if (c.kind !== NODE.BINARY) return false
    if (['=', '<', '<=', '>', '>=', '<>', '!='].includes(c.op)) {
      const l = slot(c.left)
      const r = slot(c.right)
      const i = l ?? r
      const other = l !== undefined ? c.right : c.left
      if (i !== undefined && columnAt(i) !== undefined && isNull(other) && indexedClass(i)) return true
      if (c.op === '=' && i !== undefined && neverEqual(columnAt(i)?.column, other)) return true
    }
    if (c.op === 'BETWEEN') {
      const i = slot(c.left)
      if (i !== undefined && columnAt(i) !== undefined && indexedClass(i)) {
        const lo = c.right
        const hi = c.extra as Expression
        if (isNull(lo) || isNull(hi)) return true
        const a = literalNumber(lo)
        const b = literalNumber(hi)
        if (a !== undefined && b !== undefined && a > b) return true
      }
    }
    return false
  }
  if (pool.some(impossible)) return { empty: true, constTables: [], straight }

  // An outer join's ON, judged as a WHERE over its inner tables.
  const nullTables = new Set<string>()
  from.joins.forEach((j, n) => {
    if (!j.left || converted.has(n)) return
    for (const a of j.innerAliases) nullable.delete(a)
    const never = flatten(j.on, []).some((c) => {
      // The range optimizer's proofs, not `IS NULL` on a NOT NULL column: an
      // ON holding that is still a join (8.4.11: a hash antijoin).
      if (c.kind === NODE.BINARY && impossible(c)) return true
      const v = partialTruth(c, () => undefined, ctx, env, true)
      return v === false || v === null
    })
    for (const a of j.innerAliases) {
      nullable.add(a)
      if (never) nullTables.add(a)
    }
  })

  // The range optimizer: an indexed column's ranges, intersected over every
  // condition, that come to nothing — `name > 'cy' AND (name < 'Blue' OR name
  // IS NULL)` on a NOT NULL `name`.
  for (const t of scope.tables) {
    if (t.def === undefined || nullable.has(t.alias)) continue
    for (let i = 0; i < t.columns.length; i++) {
      const index = t.offset + i
      if (!indexedClass(index)) continue
      const col = columnAt(index)
      if (col === undefined) continue
      let acc: RangeSet = 'all'
      for (const c of pool) acc = intersect(acc, rangeOf(c, (e) => slot(e) === index, col.column, ctx, env))
      if (acc !== 'all' && acc.length === 0) return { empty: true, constTables: [], straight }
    }
  }

  // Equality propagation, three-valued: a condition that is false or NULL
  // whatever the columns it still reads hold.
  for (const c of pool) {
    const v = partialTruth(c, (e) => {
      const i = slot(e)
      if (i === undefined) return undefined
      return pinned.get(find(i))
    }, ctx, env)
    if (v === false || v === null) return { empty: true, constTables: [], straight }
  }

  // Const tables.
  const constTables: ConstTable[] = []
  for (const t of from.tables) {
    if (t.def === undefined || t.table === undefined || nullable.has(t.alias)) continue
    const def = t.def
    const keys = def.indexes.filter((i) => i.kind === 'primary' || (i.kind === 'unique' && i.parts.every((p) => def.columns.find((c) => c.name === p.column)?.nullable === false)))
    for (const index of keys) {
      if (index.parts.some((p) => p.prefix !== undefined)) continue
      const key = index.parts.map((p) => {
        const offset = def.columns.findIndex((c) => c.name === p.column)
        const value = pinned.get(find(t.offset + offset))
        return value === undefined ? undefined : { column: def.columns[offset] as ColumnDef, value }
      })
      if (key.every((k) => k !== undefined)) {
        constTables.push({ alias: t.alias, def, table: t.table, key: key as { column: ColumnDef; value: Expression }[] })
        break
      }
    }
  }
  return { empty: false, constTables, straight, ...(nullTables.size > 0 ? { nullTables } : {}) }
}

/** Whether a const table has its row: read while planning, as MySQL reads it. */
export function constTablesHaveRows(facts: OptimizerFacts, ctx: CompileContext, env: Env, trx: Trx | undefined): boolean {
  if (facts.straight) return true
  for (const t of facts.constTables) {
    const values: Value[] = t.key.map((k) => compile(k.value, ctx).eval([], env))
    if (values.some((v) => v === null)) return false
    const index = t.def.indexes.find((i) => i.parts.length === t.key.length && i.parts.every((p, n) => p.column === t.key[n]?.column.name))
    const access = index !== undefined && t.key.length === 1 ? pointAccess(t.def, index, (t.key[0] as { column: ColumnDef }).column, values[0] as Value) : undefined
    let found = false
    for (const { row } of accessRows(t.table, t.def, access ?? {}, trx, false)) {
      // A full scan when the bound does not convert exactly: match as the comparison would.
      if (t.key.every((k, n) => compareValues(row[t.def.columns.indexOf(k.column)] ?? null, values[n] ?? null) === 0)) {
        found = true
        break
      }
    }
    if (!found) return false
  }
  return true
}

/** The table slots a condition rejects NULL on: a comparison, BETWEEN, IN or LIKE with the column as its operand. */
function nullRejected(c: Expression, slot: (e: Expression) => number | undefined): number[] {
  if (c.kind === NODE.BINARY && ['=', '<', '<=', '>', '>=', '<>', '!=', 'BETWEEN', 'IN', 'LIKE', 'NOT IN', 'NOT BETWEEN', 'NOT LIKE'].includes(c.op)) {
    const out: number[] = []
    for (const side of [c.left, c.op === '=' || c.op === '<' || c.op === '<=' || c.op === '>' || c.op === '>=' || c.op === '<>' || c.op === '!=' ? c.right : undefined]) {
      if (side === undefined) continue
      const i = slot(side)
      if (i !== undefined) out.push(i)
    }
    return out
  }
  return []
}

/** `int_col = 9.5`, `tinyint_col = 300`: an integer column against a number it can never equal. */
function neverEqual(column: ColumnDef | undefined, other: Expression): boolean {
  if (column === undefined) return false
  const range = integerRange(column.type)
  if (range === undefined) return false
  const negative = other.kind === NODE.UNARY && other.op === '-'
  const literal = negative ? other.operand : other
  if (literal.kind !== NODE.LITERAL) return false
  const text = String(literal.value).trim()
  const number = literal.type === 'int' || literal.type === 'decimal' || literal.type === 'double' || (literal.type === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text))
  if (!number) return false
  if (!/^[+-]?\d+$/.test(text) && Number(text) % 1 !== 0) return true
  const v = (negative ? -1n : 1n) * (/^[+-]?\d+$/.test(text) ? BigInt(text) : BigInt(Math.trunc(Number(text))))
  return v < range.min || v > range.max
}

/**
 * A condition's truth with some columns known: `true`, `false`, `null`, or
 * `undefined` when it depends on a column that is not. AND and OR short-cut
 * on a known side, as three-valued logic allows; anything else is evaluated
 * only when every column in it is known.
 */
function partialTruth(e: Expression, known: (column: Expression) => Expression | undefined, ctx: CompileContext, env: Env, constants = false): boolean | null | undefined {
  if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&' || e.op === 'OR' || e.op === '||')) {
    const a = partialTruth(e.left, known, ctx, env, constants)
    const b = partialTruth(e.right, known, ctx, env, constants)
    const and = e.op === 'AND' || e.op === '&&'
    if (and) {
      if (a === false || b === false) return false
      if (a === undefined || b === undefined) return undefined
      return a === null || b === null ? null : true
    }
    if (a === true || b === true) return true
    if (a === undefined || b === undefined) return undefined
    return a === null || b === null ? null : false
  }
  let complete = true
  let touched = false
  const substitute = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x
    if (Array.isArray(x)) return x.map(substitute)
    const node = x as { kind?: string }
    if (node.kind === NODE.SUBQUERY || node.kind === NODE.CALL || node.kind === NODE.VARIABLE) {
      complete = false
      return x
    }
    if (node.kind === NODE.COLUMN) {
      const v = known(x as Expression)
      if (v === undefined) complete = false
      else touched = true
      return v ?? x
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) out[k] = typeof v === 'object' ? substitute(v) : v
    return out
  }
  const replaced = substitute(e) as Expression
  if (!complete || (!touched && !constants)) return undefined
  try {
    return truth(compile(replaced, { ...ctx, scope: EMPTY_SCOPE }).eval([], env))
  } catch {
    return undefined
  }
}

// --- ranges -----------------------------------------------------------------------

/** One interval of a column's values, or the NULL point. An absent bound is unbounded. */
type Interval = { readonly lo?: { readonly v: Exclude<Value, null>; readonly inclusive: boolean }; readonly hi?: { readonly v: Exclude<Value, null>; readonly inclusive: boolean } } | 'null'
/** The values a condition admits: some intervals, or everything (`'all'`) when it does not restrict the column. */
type RangeSet = readonly Interval[] | 'all'

const ALL_VALUES: Interval = {}

/** A constant brought to the column's comparison, or `undefined` when the two do not compare as the column's type. */
function constantFor(e: Expression, column: ColumnDef, ctx: CompileContext, env: Env): Value | undefined {
  const lit = e.kind === NODE.UNARY && e.op === '-' ? e.operand : e
  if (lit.kind !== NODE.LITERAL && lit.kind !== NODE.PLACEHOLDER) return undefined
  if (lit.kind === NODE.PLACEHOLDER && ctx.params === undefined) return undefined
  let v: Value
  try {
    v = compile(e, { ...ctx, scope: EMPTY_SCOPE }).eval([], env)
  } catch {
    return undefined
  }
  if (v === null) return null
  const text = column.type.collationId !== undefined && column.type.collationId !== 63
  if (text) return v.kind === 'string' ? { ...v, collationId: column.type.collationId as number, coercibility: 2 } : undefined
  if (integerRange(column.type) !== undefined || column.type.type === 246 || column.type.type === 0) return v.kind === 'int' || v.kind === 'decimal' ? v : undefined
  return undefined
}

function rangeOf(e: Expression, isColumn: (e: Expression) => boolean, column: ColumnDef, ctx: CompileContext, env: Env): RangeSet {
  if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) return intersect(rangeOf(e.left, isColumn, column, ctx, env), rangeOf(e.right, isColumn, column, ctx, env))
  if (e.kind === NODE.BINARY && (e.op === 'OR' || e.op === '||')) return union(rangeOf(e.left, isColumn, column, ctx, env), rangeOf(e.right, isColumn, column, ctx, env))
  if (e.kind === NODE.UNARY && (e.op === 'IS NULL' || e.op === 'IS NOT NULL') && isColumn(e.operand)) return e.op === 'IS NULL' ? ['null'] : [ALL_VALUES]
  if (e.kind !== NODE.BINARY) return 'all'
  const point = (v: Exclude<Value, null>): Interval => ({ lo: { v, inclusive: true }, hi: { v, inclusive: true } })
  if (e.op === 'BETWEEN' && isColumn(e.left)) {
    const a = constantFor(e.right, column, ctx, env)
    const b = constantFor(e.extra as Expression, column, ctx, env)
    if (a === undefined || b === undefined) return 'all'
    if (a === null || b === null) return []
    return [{ lo: { v: a, inclusive: true }, hi: { v: b, inclusive: true } }]
  }
  if (e.op === 'IN' && isColumn(e.left) && e.right.kind === NODE.ROW) {
    const out: Interval[] = []
    for (const item of e.right.items) {
      const v = constantFor(item, column, ctx, env)
      if (v === undefined) return 'all'
      if (v !== null) out.push(point(v))
    }
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
  const v = constantFor(other, column, ctx, env)
  if (v === undefined) return 'all'
  if (v === null) return op === '<=>' ? ['null'] : []
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

function union(a: RangeSet, b: RangeSet): RangeSet {
  if (a === 'all' || b === 'all') return 'all'
  return [...a, ...b]
}

function intersect(a: RangeSet, b: RangeSet): RangeSet {
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
