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
import { expectTyped } from '@myjs/bytes'
import type { ColumnDef, Table, TableDef, Trx } from '@myjs/engine'
import { NODE, type Expression } from '@myjs/parser'
import { compareValues, integerRange, truth, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE, type CompileContext, type Env } from './compile.ts'
import type { FromPlan } from './from.ts'
import { accessRows, pointAccess, splitAnd } from './plan.ts'
import { intersect, rangeOf, type RangeSet } from './ranges.ts'

export interface ConstTable {
  readonly alias: string
  readonly def: TableDef
  readonly table: Table
  /**
   * The key's columns and the constants they are held to: an expression, or
   * a column of a const table found before this one (`from`, its place in
   * `constTables` and its column's), whose row is read first.
   */
  readonly key: readonly ConstKeyPart[]
}

export type ConstKeyPart = { readonly column: ColumnDef } & ({ readonly value: Expression } | { readonly from: { readonly table: number; readonly column: number } })

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
   * The const tables read while planning, ahead of the join: all of them,
   * except under STRAIGHT_JOIN, where only the run of them the statement
   * begins with is (8.4.11: `STRAIGHT_JOIN … FROM p JOIN q ON p.id = 2` is
   * "Table scan on q"); the rest are joined as constant rows.
   */
  readonly readAhead?: ReadonlySet<string>
  /**
   * An outer join's single inner table whose ON holds its PRIMARY or NOT NULL
   * UNIQUE key to constants, with those conditions: read once, as a constant
   * row the join NULL-complements where its other conditions fail (8.4.11:
   * `q LEFT JOIN p ON p.id = 1` is "Constant row from p" under a nested-loop
   * left join).
   */
  readonly outerConstants?: ReadonlyMap<string, readonly Expression[]>
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

  const slot = (e: Expression): number | undefined => {
    if (e.kind !== NODE.COLUMN) return undefined
    try {
      return scope.resolve(e.parts, 'where clause').index
    } catch (e) {
      expectTyped(e)
      return undefined
    }
  }
  const aliasOf = (index: number): string | undefined => scope.columnAt(index)?.table.alias

  // Outer-join simplification, to a fixed point: a null-rejecting condition on
  // an outer join's nullable side makes it an inner join.
  const pool = splitAnd(where, [])
  for (const j of from.joins) if (!j.left && !j.nested) splitAnd(j.on, pool)
  const converted = new Set<number>()
  for (let changed = true; changed; ) {
    changed = false
    from.joins.forEach((j, n) => {
      if (!j.left || converted.has(n)) return
      const rejects = pool.some((c) => nullRejected(c, slot, aliasOf).some((i) => j.innerAliases.has(aliasOf(i) ?? '')))
      if (!rejects) return
      converted.add(n)
      changed = true
      if (!j.nested) splitAnd(j.on, pool)
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
  // `col IS NULL` holds its class to NULL, but only for finding const tables by a PRIMARY KEY: `kl.g =
  // ch.id AND kl.g IS NULL` is "no matching row in const table", while `ch.qty = k1.g AND k1.g IS NULL`
  // is still a hash join (8.4.11).
  const nullPinned = new Map<number, Expression>()
  for (const c of pool) {
    if (c.kind !== NODE.UNARY || c.op !== 'IS NULL') continue
    const i = slot(c.operand)
    if (i !== undefined) nullPinned.set(find(i), { kind: NODE.LITERAL, type: 'null', value: null, at: c.at } as Expression)
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

  // `inOn`: the range optimizer's proofs only, not `IS NULL` on a NOT NULL
  // column, which in an ON is still a join (8.4.11: a hash antijoin).
  const impossible = (c: Expression, inOn = false, inner?: ReadonlySet<string>): boolean => {
    // An OR whose every side is impossible: `id IS NULL OR name IS NULL` over
    // NOT NULL columns is "Impossible WHERE" (8.4.11).
    if (c.kind === NODE.BINARY && (c.op === 'OR' || c.op === '||')) return impossible(c.left, inOn, inner) && impossible(c.right, inOn, inner)
    if (c.kind === NODE.BINARY && (c.op === 'AND' || c.op === '&&')) return impossible(c.left, inOn, inner) || impossible(c.right, inOn, inner)
    // In an ON, only over the inner tables' columns: `p2.grp <> NULL` on the preserved side proves nothing (8.4.11).
    if (inner !== undefined && !columnSlots(c, slot).every((i) => inner.has(aliasOf(i) ?? ''))) return false
    if (!inOn && c.kind === NODE.UNARY && c.op === 'IS NULL') {
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
    if (c.op === '<=>') {
      // `int_col <=> 2.5` folds as `=` does, index or none (8.4.11).
      const l = slot(c.left)
      const i = l ?? slot(c.right)
      if (i !== undefined && neverEqual(columnAt(i)?.column, l !== undefined ? c.right : c.left)) return true
    }
    if (['<', '<=', '>', '>='].includes(c.op)) {
      const l = slot(c.left)
      const r = slot(c.right)
      // With the column on the left; `5 < c` is `c > 5`.
      const flip: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }
      const at = l ?? r
      const op = l !== undefined ? c.op : (flip[c.op] as string)
      if (at !== undefined && pastRange(columnAt(at)?.column, op, l !== undefined ? c.right : c.left)) return true
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
  if (pool.some((c) => impossible(c))) return { empty: true, constTables: [], straight }
  // Under STRAIGHT_JOIN the join order is known as conditions are substituted, and `k1.g IS NULL` is
  // rewritten onto its class's first column in that order: a NOT NULL one cannot be NULL (8.4.11:
  // `ch STRAIGHT_JOIN kl ON ch.qty = kl.g AND kl.g IS NULL` is "Impossible WHERE noticed after reading
  // const tables"; with kl first, or without STRAIGHT_JOIN, it is a hash join).
  if (straight) {
    for (const c of pool) {
      if (c.kind !== NODE.UNARY || c.op !== 'IS NULL') continue
      const i = slot(c.operand)
      if (i === undefined) continue
      const root = find(i)
      let first = i
      for (let x = 0; x < i; x++) {
        if (find(x) === root) {
          first = x
          break
        }
      }
      const col = first === i ? undefined : columnAt(first)
      if (col !== undefined && !col.column.nullable) return { empty: true, constTables: [], straight }
    }
  }

  // An outer join's ON, judged as a WHERE over its inner tables.
  const nullTables = new Set<string>()
  from.joins.forEach((j, n) => {
    if (!j.left || converted.has(n)) return
    for (const a of j.innerAliases) nullable.delete(a)
    const never = splitAnd(j.on, []).some((c) => {
      if (impossible(c, true, j.innerAliases)) return true
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
      for (const c of pool) acc = intersect(acc, rangeOf(c, (e) => slot(e) === index, col.column, (e) => plannedConstant(e, ctx, env)))
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
  // Under STRAIGHT_JOIN a table's access is the first key whose parts are all bound, by constants or by
  // the tables before it: only one bound by constants alone makes it const (8.4.11: `q STRAIGHT_JOIN p
  // ON q.n = p.id AND p.name = 'x y'` looks p up by its PRIMARY KEY; `… ON q.t = p.name AND p.id = 2` is
  // a constant row).
  const order = new Map(from.tables.map((t, n) => [t.alias, n]))
  const boundByEarlier = (index: number, n: number): boolean =>
    pool.some((c) => {
      if (c.kind !== NODE.BINARY || c.op !== '=') return false
      const other = slot(c.left) === index ? c.right : slot(c.right) === index ? c.left : undefined
      const slots = other === undefined ? [] : columnSlots(other, slot)
      return slots.length > 0 && slots.every((i) => (order.get(aliasOf(i) ?? '') ?? n) < n)
    })
  // A const table's columns are constants once its row is read, so a table whose key they hold is
  // const too, to a fixed point (8.4.11: `q JOIN p ON q.n = p.id AND p.name = 'x y'` reads p by name,
  // then q by p.id: "Rows fetched before execution").
  const fromConst = new Map<number, { table: number; column: number }>()
  const settled = new Set<string>()
  for (let found = true; found; ) {
    found = false
    from.tables.forEach((t, n) => {
      if (t.def === undefined || t.table === undefined || nullable.has(t.alias) || settled.has(t.alias)) return
      const def = t.def
      const keys = def.indexes.filter((i) => i.kind === 'primary' || (i.kind === 'unique' && i.parts.every((p) => def.columns.find((c) => c.name === p.column)?.nullable === false)))
      for (const index of keys) {
        if (index.parts.some((p) => p.prefix !== undefined)) continue
        const offsets = index.parts.map((p) => def.columns.findIndex((c) => c.name === p.column))
        const key = offsets.map((offset): ConstKeyPart | undefined => {
          const root = find(t.offset + offset)
          const column = def.columns[offset] as ColumnDef
          // NULL holds only a PRIMARY KEY: `p.name = k.s AND k.s IS NULL` over a unique `name` is a lookup (8.4.11).
          const value = pinned.get(root) ?? (index.kind === 'primary' ? nullPinned.get(root) : undefined)
          if (value !== undefined) return { column, value }
          const other = fromConst.get(root)
          return other === undefined ? undefined : { column, from: other }
        })
        if (key.every((k) => k !== undefined)) {
          const at = constTables.length
          constTables.push({ alias: t.alias, def, table: t.table, key: key as ConstKeyPart[] })
          settled.add(t.alias)
          found = true
          for (let i = 0; i < def.columns.length; i++) {
            const root = find(t.offset + i)
            if (!pinned.has(root) && !fromConst.has(root)) fromConst.set(root, { table: at, column: i })
          }
          return
        }
        if (straight && offsets.every((offset, k) => key[k] !== undefined || boundByEarlier(t.offset + offset, n))) {
          settled.add(t.alias)
          return
        }
      }
    })
  }
  const outerConstants = new Map<string, Expression[]>()
  from.joins.forEach((j, n) => {
    if (!j.left || converted.has(n) || j.innerAliases.size !== 1) return
    const alias = [...j.innerAliases][0] as string
    const t = scope.tables.find((x) => x.alias === alias)
    if (t?.def === undefined || nullTables.has(alias)) return
    const def = t.def
    const held = new Map<string, Expression>()
    for (const c of splitAnd(j.on, [])) {
      if (c.kind !== NODE.BINARY || (c.op !== '=' && c.op !== '<=>')) continue
      for (const [col, other] of [[c.left, c.right], [c.right, c.left]] as const) {
        const i = slot(col)
        if (i !== undefined && aliasOf(i) === alias && isConstant(other)) held.set((scope.columnAt(i)?.column.name ?? '').toLowerCase(), c)
      }
    }
    const key = def.indexes.find((x) => (x.kind === 'primary' || (x.kind === 'unique' && x.parts.every((p) => def.columns.find((c) => c.name === p.column)?.nullable === false))) && x.parts.every((p) => p.prefix === undefined && held.has(p.column.toLowerCase())))
    if (key !== undefined) outerConstants.set(alias, key.parts.map((p) => held.get(p.column.toLowerCase()) as Expression))
  })
  const readAhead = new Set<string>()
  for (const t of from.tables) {
    if (!constTables.some((c) => c.alias === t.alias)) {
      if (straight) break
      continue
    }
    readAhead.add(t.alias)
  }
  return { empty: false, constTables, straight, ...(readAhead.size > 0 ? { readAhead } : {}), ...(outerConstants.size > 0 ? { outerConstants } : {}), ...(nullTables.size > 0 ? { nullTables } : {}) }
}

/** Whether a const table has its row: read while planning, as MySQL reads it. */
export function constTablesHaveRows(facts: OptimizerFacts, ctx: CompileContext, env: Env, trx: Trx | undefined): boolean {
  const rows: (readonly (Value | undefined)[] | undefined)[] = []
  for (const t of facts.constTables) {
    // A constant row of a STRAIGHT_JOIN is read where the join reaches it: a missing one proves nothing here.
    if (facts.readAhead?.has(t.alias) !== true || t.key.some((k) => 'from' in k && rows[k.from.table] === undefined)) {
      rows.push(undefined)
      continue
    }
    const values: Value[] = t.key.map((k) => ('value' in k ? compile(k.value, ctx).eval([], env) : (rows[k.from.table]?.[k.from.column] ?? null)))
    if (values.some((v) => v === null)) return false
    const index = t.def.indexes.find((i) => i.parts.length === t.key.length && i.parts.every((p, n) => p.column === t.key[n]?.column.name))
    const access = index !== undefined && t.key.length === 1 ? pointAccess(index, (t.key[0] as { column: ColumnDef }).column, values[0] as Value) : undefined
    let found = false
    for (const { row } of accessRows(t.table, t.def, access ?? {}, trx, false)) {
      // A full scan when the bound does not convert exactly: match as the comparison would.
      if (t.key.every((k, n) => compareValues(row[t.def.columns.indexOf(k.column)] ?? null, values[n] ?? null) === 0)) {
        found = true
        rows.push(row)
        break
      }
    }
    if (!found) return false
  }
  return true
}

/** The table slots a condition rejects NULL on: a comparison, BETWEEN, IN or LIKE with the column as its operand. */
export function nullRejected(c: Expression, slot: (e: Expression) => number | undefined, tableOf?: (i: number) => string | undefined): number[] {
  // An OR rejects NULL on a table both its sides reject it on (`not_null_tables`): `ch.id BETWEEN … OR ch.id BETWEEN …`.
  if (tableOf !== undefined && c.kind === NODE.BINARY && (c.op === 'OR' || c.op === '||')) {
    const right = new Set(nullRejected(c.right, slot, tableOf).map(tableOf))
    return nullRejected(c.left, slot, tableOf).filter((i) => right.has(tableOf(i)))
  }
  if (c.kind === NODE.UNARY && c.op === 'IS NOT NULL') {
    const i = slot(c.operand)
    return i === undefined ? [] : [i]
  }
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

/** The table slots of a condition's columns, outside its subqueries. */
function columnSlots(e: Expression, slot: (e: Expression) => number | undefined): number[] {
  if (e.kind === NODE.COLUMN) {
    const i = slot(e)
    return i === undefined ? [] : [i]
  }
  if (e.kind === NODE.BINARY) return [e.left, e.right, ...(e.extra === undefined ? [] : Array.isArray(e.extra) ? e.extra : [e.extra as Expression])].flatMap((x) => columnSlots(x, slot))
  if (e.kind === NODE.UNARY) return columnSlots(e.operand, slot)
  return []
}

/** `int_col = 9.5`, `tinyint_col = 300`: an integer column against a number it can never equal. */
export function neverEqual(column: ColumnDef | undefined, other: Expression): boolean {
  const n = numericConstant(column, other)
  if (n === undefined) return false
  return n.fraction || n.floor < n.range.min || n.floor > n.range.max
}

/** An integer column against a number constant: its floor, whether it has a fraction, and the column's range. */
function numericConstant(column: ColumnDef | undefined, other: Expression): { floor: bigint; fraction: boolean; range: { min: bigint; max: bigint } } | undefined {
  if (column === undefined) return undefined
  const range = integerRange(column.type)
  if (range === undefined) return undefined
  const negative = other.kind === NODE.UNARY && other.op === '-'
  const literal = negative ? other.operand : other
  if (literal.kind !== NODE.LITERAL) return undefined
  const text = String(literal.value).trim()
  const number = literal.type === 'int' || literal.type === 'decimal' || literal.type === 'double' || (literal.type === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text))
  if (!number) return undefined
  const integral = /^[+-]?\d+$/.test(text)
  const x = (negative ? -1 : 1) * Number(text)
  const fraction = !integral && x % 1 !== 0
  const floor = integral ? (negative ? -1n : 1n) * BigInt(text) : BigInt(Math.floor(x))
  return { floor, fraction, range }
}

/**
 * `c > k` (or `<`, `>=`, `<=`) where no value of the integer column's type
 * can satisfy it: `int_col > 2147483647`, `int_col >= 2147483647.5`,
 * `int_col < -2147483648` (8.4.11 folds each to "Impossible WHERE", index or
 * none; `>= 2147483647` it does not).
 */
function pastRange(column: ColumnDef | undefined, op: string, other: Expression): boolean {
  const n = numericConstant(column, other)
  if (n === undefined) return false
  const ceil = n.fraction ? n.floor + 1n : n.floor
  switch (op) {
    case '>':
      return n.floor >= n.range.max
    case '>=':
      return ceil > n.range.max
    case '<':
      return ceil <= n.range.min
    case '<=':
      return n.floor < n.range.min
  }
  return false
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
  } catch (e) {
    expectTyped(e)
    return undefined
  }
}

/** A literal, or a bound `?`, evaluated while planning: what the range proofs may read. */
function plannedConstant(e: Expression, ctx: CompileContext, env: Env): Value | undefined {
  const lit = e.kind === NODE.UNARY && e.op === '-' ? e.operand : e
  if (lit.kind !== NODE.LITERAL && lit.kind !== NODE.PLACEHOLDER) return undefined
  if (lit.kind === NODE.PLACEHOLDER && ctx.params === undefined) return undefined
  try {
    return compile(e, { ...ctx, scope: EMPTY_SCOPE }).eval([], env)
  } catch (err) {
    expectTyped(err)
    return undefined
  }
}
