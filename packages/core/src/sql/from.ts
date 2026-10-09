// M5.4 — FROM: the tables a query reads, joined.
//
// Every table of a FROM has a place in one flat row (D-74): its columns at an
// offset, NULL where an outer join found no match. A join is a generator of
// such rows, and so is a table; what sits above the FROM never knows how many
// tables there were.
//
// **The join algorithms are MySQL's, because they decide the row order** of a
// query without ORDER BY (M5.18's probes of 8.4.11):
//
//   - An inner join is a hash join that builds on the earlier tables and
//     probes with the later one, unless the later one is a table whose PRIMARY
//     or NOT NULL UNIQUE key the condition pins, which is a nested loop with a
//     single-row lookup (`eq_ref`). A hash join emits, for each probe row in
//     its order, the matching build rows newest first; with no equality it is
//     "no condition" and the ON is a filter, which comes to the same order.
//   - A LEFT JOIN probes with the outer side and builds on the inner, so each
//     outer row is followed by its matches, newest first, or by one row of
//     NULLs. A RIGHT JOIN is a LEFT JOIN with its sides swapped.
//
// Which order the optimizer would put the tables in is a cost decision (M5.7);
// here it is the order written, which is what `STRAIGHT_JOIN` asks for. The
// condition is always evaluated in full on every pair, so a hash key could only
// ever be a faster way to the same rows in the same order.
//
// The WHERE is applied above the FROM, to every row (D-65). It narrows a
// table's scan only where that cannot change the answer: never for a table on
// the inner side of an outer join, where `WHERE b.x IS NULL` must still see
// the NULL rows the join made.
import type { ColumnDef, IndexDef, RowId, Table, TableDef, Trx } from '@myjs/engine'
import { NODE, REF, type Expression, type TableReference } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { truth, type Value } from '@myjs/types'
import type { Compiled, Env, Row, Scope } from './compile.ts'
import { accessRows, chooseAccess, pointAccess } from './plan.ts'
import { TableScope, type ScopeColumn, type ScopeTableSpec } from './scope.ts'

/** A table the FROM reads: a base table, or (M5.1) a derived one. */
export interface FromTable {
  readonly alias: string
  readonly def?: TableDef
  readonly table?: Table
  /** A derived table's or a CTE's rows and columns, when it is not a base table. */
  readonly derived?: DerivedSource
  readonly nullable: boolean
  readonly offset: number
  readonly width: number
  /** LATERAL: its rows depend on the tables before it, so it runs once per row of them. */
  readonly lateral: boolean
}

export interface DerivedSource {
  readonly columns: readonly ScopeColumn[]
  /**
   * A view MySQL plans as a join of its own tables — INFORMATION_SCHEMA's, over
   * the data dictionary (M5.12) — so a sort or a DISTINCT over it streams its
   * rows through a temporary table, as over any join.
   */
  readonly joined?: boolean
  /** Its rows, as values in column order. `lateral` is the FROM's row so far, for LATERAL. */
  rows(trx: Trx | undefined, env: Env, lateral: Row | undefined): Iterable<readonly Value[]>
}

type Node =
  | { readonly kind: 'leaf'; readonly table: FromTable }
  | {
      readonly kind: 'join'
      /** The preserved side and the side that may be all NULL; for an inner join, the earlier and the later. */
      readonly outer: Node
      readonly inner: Node
      readonly left: boolean
      readonly on: Compiled | undefined
      readonly onAst: Expression | undefined
      readonly innerSlots: readonly number[]
      /** `eq_ref`: the later table's unique key, and the expression of the earlier tables it equals. */
      readonly lookup: EqRef | undefined
    }

interface EqRef {
  readonly index: IndexDef
  readonly column: ColumnDef
  readonly value: Compiled
}

export interface FromPlan {
  readonly scope: TableScope
  readonly tables: readonly FromTable[]
  readonly width: number
  /** The one base table, when the FROM is exactly that. */
  readonly single?: { readonly alias: string; readonly def: TableDef; readonly table: Table }
  /**
   * Every join's condition, with whether it is an outer join and whether it
   * sits inside an outer join's nullable side — what functional dependence
   * and the optimizer's proofs of an empty result may use.
   */
  readonly joins: readonly JoinCondition[]
  /** A STRAIGHT_JOIN among the joins: the order is the statement's. */
  readonly straight: boolean
  /**
   * Whether a sort on these tables alone can be done on the first table before
   * the joins, as MySQL does when every join after it is a nested loop over a
   * unique key ("Nested loop left join / Sort / … / Single-row index lookup"),
   * so the join's rows are never streamed into a temporary table to sort.
   */
  sortsFirst(aliases: ReadonlySet<string>): boolean
  /**
   * Read a table through a secondary index rather than its clustered one when
   * no condition chooses an access path: MySQL's "Covering index scan", taken
   * when the index holds every column the query reads, which changes the order
   * of an unordered result.
   */
  cover(alias: string, index: string): void
  /** The rows of the FROM. `where` may narrow a scan (see the header); `ids` asks for each base table's row id too. */
  rows(trx: Trx | undefined, env: Env, options: { readonly where: Expression | undefined; readonly locking: boolean; readonly ids?: boolean }): Iterable<JoinedRow>
}

export interface JoinCondition {
  readonly on: Expression | undefined
  readonly left: boolean
  /** The tables of the side an outer join may make NULL; empty for an inner join. */
  readonly innerAliases: ReadonlySet<string>
  /** Inside the nullable side of an enclosing outer join. */
  readonly nested: boolean
}

export interface FromContext {
  /** Open a base table: ER_NO_SUCH_TABLE, ER_NO_DB_ERROR. */
  open(ref: { readonly schema?: string; readonly name: string }, alias?: string): { readonly schema: string; readonly def: TableDef; readonly table: Table }
  /** Compile an ON clause against the scope its join sees. */
  compileOn(e: Expression, scope: Scope): Compiled
  /** Plan a derived table (M5.1); `lateral` is the scope of the tables before it, for LATERAL. */
  derived?(ref: TableReference & { readonly kind: typeof REF.DERIVED }, lateral: Scope | undefined): DerivedSource
  /** A common table expression the statement defines under this name, planned for one reference to it. */
  cte?(name: string): DerivedSource | undefined
  /** An INFORMATION_SCHEMA table of this name (M5.12), or `undefined` when the name is not in it. */
  system?(ref: { readonly schema?: string; readonly name: string }, alias: string): { readonly schema: string; readonly source: DerivedSource } | undefined
  /** A view of this name, planned for one reference to it, or `undefined` when there is none. */
  view?(ref: { readonly schema?: string; readonly name: string }, alias: string): { readonly schema: string; readonly source: DerivedSource } | undefined
  /** The scope an enclosing query gives a correlated name, if any. */
  readonly parent?: Scope
}

/** The written FROM, as a plan: its scope, and how to read it. */
export function planFrom(refs: readonly TableReference[], ctx: FromContext, where?: Expression): FromPlan {
  // First pass: the tables, in order, with whether an outer join can null them.
  interface Pending {
    alias: string
    def?: TableDef
    table?: Table
    derivedRef?: TableReference & { readonly kind: typeof REF.DERIVED }
    /** Tables before it that a LATERAL one may not see: a RIGHT JOIN's left side (8.4.11: 1054). */
    hidden?: ReadonlySet<string>
    cte?: DerivedSource
    /** A view's schema, which a qualified name may name it by. */
    schema?: string
    nullable: boolean
    width: number
  }
  const pending: Pending[] = []
  const collect = (ref: TableReference, nullable: boolean, hidden: ReadonlySet<string> = new Set()): void => {
    switch (ref.kind) {
      case REF.TABLE: {
        // A CTE of the statement hides a table of the same name.
        const cte = ref.table.schema === undefined ? ctx.cte?.(ref.table.name) : undefined
        if (cte !== undefined) {
          pending.push({ alias: ref.alias ?? ref.table.name, cte, nullable, width: cte.columns.length })
          return
        }
        const alias = ref.alias ?? ref.table.name
        const system = ctx.system?.(ref.table, alias)
        if (system !== undefined) {
          pending.push({ alias, cte: system.source, schema: system.schema, nullable, width: system.source.columns.length })
          return
        }
        let opened: ReturnType<FromContext['open']>
        try {
          opened = ctx.open(ref.table, alias)
        } catch (e) {
          // Tables and views share their names: a name that is no table may be a view.
          const view = (e as { errno?: number }).errno === 1146 ? ctx.view?.(ref.table, alias) : undefined
          if (view === undefined) throw e
          pending.push({ alias, cte: view.source, schema: view.schema, nullable, width: view.source.columns.length })
          return
        }
        pending.push({ alias, def: opened.def, table: opened.table, nullable, width: opened.def.columns.length })
        return
      }
      case REF.DERIVED:
        if (ref.alias === undefined) throw sqlError('ER_DERIVED_MUST_HAVE_ALIAS', 'Every derived table must have its own alias')
        pending.push({ alias: ref.alias, derivedRef: ref, nullable, width: -1, hidden })
        return
      case REF.LIST:
        for (const item of ref.items) collect(item, nullable, hidden)
        return
      case REF.JOIN: {
        const from = pending.length
        collect(ref.left, nullable || ref.type === 'RIGHT', hidden)
        const left = ref.type === 'RIGHT' ? new Set([...hidden, ...pending.slice(from).map((p) => p.alias)]) : hidden
        collect(ref.right, nullable || ref.type === 'LEFT', left)
        return
      }
    }
  }
  for (const r of refs) collect(r, false)

  // A derived table's columns are known only once it is planned, and a
  // LATERAL one sees the tables before it, so they are planned in order.
  const specs: ScopeTableSpec[] = []
  const tables: FromTable[] = []
  const seen = new Set<string>()
  let offset = 0
  for (const p of pending) {
    if (seen.has(p.alias)) throw sqlError('ER_NONUNIQ_TABLE', messages.nonUniqueTable(p.alias))
    seen.add(p.alias)
    let derived: DerivedSource | undefined = p.cte
    if (p.derivedRef !== undefined) {
      if (ctx.derived === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Derived tables'))
      const visible = specs.filter((sp) => p.hidden?.has(sp.alias) !== true)
      const before = visible.length > 0 ? new TableScope(visible, ctx.parent === undefined ? {} : { parent: ctx.parent }) : ctx.parent
      derived = ctx.derived(p.derivedRef, p.derivedRef.lateral === true ? before : undefined)
      p.width = derived.columns.length
    }
    specs.push({ alias: p.alias, ...(p.def === undefined ? {} : { def: p.def }), ...(derived === undefined ? {} : { columns: derived.columns, schema: p.schema ?? '' }), nullable: p.nullable })
    tables.push({ alias: p.alias, ...(p.def === undefined ? {} : { def: p.def }), ...(p.table === undefined ? {} : { table: p.table }), ...(derived === undefined ? {} : { derived }), nullable: p.nullable, offset, width: p.width, lateral: p.derivedRef?.lateral === true })
    offset += p.width
  }
  const width = offset

  // Second pass: the joins — USING and NATURAL merge columns, which changes
  // what a bare name means and what `*` is; each ON is resolved in the scope
  // of its own two sides.
  const coalesced: number[][] = []
  const byAlias = new Map(tables.map((t) => [t.alias, t]))
  const preliminary = new TableScope(specs, ctx.parent === undefined ? {} : { parent: ctx.parent })
  const columnName = (index: number): string => {
    const at = preliminary.columnAt(index)
    return at === undefined ? '' : at.column.name
  }
  let leafAt = 0
  let straight = false
  const joins: JoinCondition[] = []
  let nesting = 0
  /** A subtree: its node, its aliases, and its visible columns as `*` lists them. */
  const build = (ref: TableReference): { node: Node; aliases: Set<string>; visible: number[] } => {
    switch (ref.kind) {
      case REF.TABLE:
      case REF.DERIVED: {
        const t = tables[leafAt++] as FromTable
        return { node: { kind: 'leaf', table: t }, aliases: new Set([t.alias]), visible: Array.from({ length: t.width }, (_, i) => t.offset + i) }
      }
      case REF.LIST: {
        let acc: { node: Node; aliases: Set<string>; visible: number[] } | undefined
        for (const item of ref.items) {
          const next = build(item)
          acc = acc === undefined ? next : crossJoin(acc, next)
        }
        return acc as { node: Node; aliases: Set<string>; visible: number[] }
      }
      case REF.JOIN: {
        if (ref.type === 'STRAIGHT') straight = true
        const nestedHere = nesting > 0
        if (ref.type === 'RIGHT') nesting++
        const l = build(ref.left)
        if (ref.type === 'RIGHT') nesting--
        if (ref.type === 'LEFT') nesting++
        const r = build(ref.right)
        if (ref.type === 'LEFT') nesting--
        const aliases = new Set([...l.aliases, ...r.aliases])
        const right = ref.type === 'RIGHT'
        let visible = [...l.visible, ...r.visible]
        // USING and NATURAL: the named columns, merged, then each side's rest.
        let names: string[] | undefined
        if (ref.natural === true) {
          const rightNames = new Set(r.visible.map((i) => columnName(i).toLowerCase()))
          names = l.visible.map(columnName).filter((n) => rightNames.has(n.toLowerCase()))
        } else if (ref.using !== undefined) names = [...ref.using]
        const groups: number[][] = []
        if (names !== undefined) {
          const pickFrom = (side: number[], name: string): number => {
            const i = side.find((x) => columnName(x).toLowerCase() === name.toLowerCase())
            if (i === undefined) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(name, 'from clause'))
            return i
          }
          const merged: number[] = []
          const used = new Set<number>()
          for (const name of names) {
            const li = pickFrom(l.visible, name)
            const ri = pickFrom(r.visible, name)
            const primary = right ? ri : li
            const other = right ? li : ri
            merged.push(primary)
            used.add(li).add(ri)
            // Merge with any group either side already belongs to.
            const existing = coalesced.filter((g) => g.includes(li) || g.includes(ri))
            const group = [primary, other, ...existing.flat().filter((x) => x !== primary && x !== other)]
            for (const g of existing) coalesced.splice(coalesced.indexOf(g), 1)
            coalesced.push(group)
            groups.push(group)
          }
          const restL = l.visible.filter((i) => !used.has(i))
          const restR = r.visible.filter((i) => !used.has(i))
          visible = right ? [...merged, ...restR, ...restL] : [...merged, ...restL, ...restR]
        }
        // The ON sees this join's tables, and the merged columns within them.
        const within = coalesced.filter((g) => g.every((i) => [...aliases].some((a) => inTable(byAlias.get(a), i))))
        let onAst: Expression | undefined = ref.on
        // USING (c) is ON l.c = r.c; NATURAL the same over the shared names.
        if (names !== undefined && names.length > 0) {
          const eqs: Expression[] = groups.map((g) => {
            const [a, b] = [g[0] as number, g[1] as number]
            return { kind: NODE.BINARY, op: '=', left: slotRef(a), right: slotRef(b), at: ref.at } as Expression
          })
          onAst = eqs.reduce((acc, e) => ({ kind: NODE.BINARY, op: 'AND', left: acc, right: e, at: ref.at }) as Expression)
        }
        const scope = preliminary.restrict(aliases, within)
        const on = onAst === undefined ? undefined : ctx.compileOn(onAst, slotScope(scope, preliminary))
        const outer = right ? r : l
        const inner = right ? l : r
        const innerSlots = [...inner.aliases].flatMap((a) => {
          const t = byAlias.get(a) as FromTable
          return Array.from({ length: t.width }, (_, i) => t.offset + i)
        })
        const isLeft = ref.type === 'LEFT' || right
        joins.push({ on: onAst, left: isLeft, innerAliases: isLeft ? inner.aliases : new Set(), nested: nestedHere })
        // An outer join over a unique key is a nested loop too; its order is a
        // hash join's, but it lets a sort go first.
        const outerLookup = isLeft && inner.node.kind === 'leaf' ? eqRef(inner.node.table, [onAst], outer.aliases, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(outer.aliases, within), preliminary))) : undefined
        if (outerLookup !== undefined) nestedLoopJoins.add(inner.aliases)
        const lookup = isLeft || inner.node.kind !== 'leaf' ? undefined : eqRef(inner.node.table, [onAst, ...(ref.type === 'STRAIGHT' || ref.type === 'INNER' ? [where] : [])], outer.aliases, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(outer.aliases, within), preliminary)))
        if (lookup !== undefined) nestedLoopJoins.add(inner.aliases)
        // A LATERAL table is read again for each row before it: a nested loop,
        // so a sort over the tables before it goes first (8.4.11: Drizzle's
        // `LEFT JOIN LATERAL … ORDER BY parent.id` keeps parent.id's key flags).
        if ([...inner.aliases].some((a) => byAlias.get(a)?.lateral === true)) nestedLoopJoins.add(inner.aliases)
        return {
          node: { kind: 'join', outer: outer.node, inner: inner.node, left: isLeft, on, onAst, innerSlots, lookup },
          aliases,
          visible,
        }
      }
    }
  }
  const crossJoin = (l: { node: Node; aliases: Set<string>; visible: number[] }, r: { node: Node; aliases: Set<string>; visible: number[] }) => {
    const innerSlots = [...r.aliases].flatMap((a) => {
      const t = byAlias.get(a) as FromTable
      return Array.from({ length: t.width }, (_, i) => t.offset + i)
    })
    const lookup = r.node.kind !== 'leaf' ? undefined : eqRef(r.node.table, [where], l.aliases, (e) => ctx.compileOn(e, preliminary.restrict(l.aliases)))
    if (lookup !== undefined || [...r.aliases].some((a) => byAlias.get(a)?.lateral === true)) nestedLoopJoins.add(r.aliases)
    return {
      node: { kind: 'join', outer: l.node, inner: r.node, left: false, on: undefined, onAst: undefined, innerSlots, lookup } as Node,
      aliases: new Set([...l.aliases, ...r.aliases]),
      visible: [...l.visible, ...r.visible],
    }
  }
  const nestedLoopJoins = new Set<ReadonlySet<string>>()
  const covering = new Map<string, string>()
  let tree: { node: Node; aliases: Set<string>; visible: number[] } | undefined
  for (const r of refs) {
    const next = build(r)
    tree = tree === undefined ? next : crossJoin(tree, next)
  }

  const scope = new TableScope(specs, { coalesced, ...(tree === undefined ? {} : { visible: tree.visible }), ...(ctx.parent === undefined ? {} : { parent: ctx.parent }) })
  const only = tables.length === 1 ? tables[0] : undefined
  const single = only?.def !== undefined && only.table !== undefined ? { alias: only.alias, def: only.def, table: only.table } : undefined

  return {
    scope,
    tables,
    width,
    joins,
    straight,
    cover(alias, index) {
      covering.set(alias, index)
    },
    sortsFirst(aliases) {
      if (tree === undefined) return false
      // The first table in execution order: the outer side all the way down.
      let node = tree.node
      const spine: Node[] = []
      while (node.kind === 'join') {
        spine.push(node)
        node = node.outer
      }
      const first = node.table.alias
      if (node.table.derived?.joined === true) return false
      if ([...aliases].some((a) => a !== first)) return false
      return spine.every((j) => j.kind === 'join' && [...nestedLoopJoins].some((s) => [...s].every((a) => innerAliasesOf(j).has(a)) && s.size === innerAliasesOf(j).size))
    },
    ...(single === undefined ? {} : { single }),
    rows(trx, env, options) {
      if (tree === undefined) return [{ row: [] }]
      return run(tree.node, trx, env, { ...options, covering }, width)
    },
  }
}

/** The aliases of a join's inner side. */
function innerAliasesOf(j: Node): Set<string> {
  const out = new Set<string>()
  const walk = (n: Node): void => {
    if (n.kind === 'leaf') out.add(n.table.alias)
    else {
      walk(n.outer)
      walk(n.inner)
    }
  }
  if (j.kind === 'join') walk(j.inner)
  return out
}

const inTable = (t: FromTable | undefined, index: number): boolean => t !== undefined && index >= t.offset && index < t.offset + t.width

/** A reference to a slot, written as a column node the scope below resolves by position. */
const SLOT_PREFIX = '\u0000slot'
const slotRef = (index: number): Expression => ({ kind: NODE.COLUMN, parts: [`${SLOT_PREFIX}${index}`], at: 0 }) as Expression

/** A scope that also answers the slot references USING's equalities are written with. */
function slotScope(scope: Scope, full: TableScope): Scope {
  return {
    resolve(parts, clause) {
      const p = parts[0] as string
      if (parts.length === 1 && p.startsWith(SLOT_PREFIX)) {
        const index = Number(p.slice(SLOT_PREFIX.length))
        const at = full.columnAt(index)
        return { index, type: (at?.column as ScopeColumn).type }
      }
      return scope.resolve(parts, clause)
    },
    // The tables MATCH looks for its index among.
    tables: (scope as { readonly tables?: unknown }).tables ?? full.tables,
  } as Scope
}

/** The rows of a join tree, each as wide as the whole FROM. */
type RunOptions = { readonly where: Expression | undefined; readonly locking: boolean; readonly covering?: ReadonlyMap<string, string>; readonly ids?: boolean }

/** A row of the join, and with `ids`, each base table's row id at that table's offset: what a multi-table UPDATE or DELETE writes. */
export interface JoinedRow {
  readonly row: Row
  readonly ids?: readonly (RowId | undefined)[]
}

/** Two sides' ids as one row's. */
function joinIds(a: JoinedRow, b: JoinedRow): readonly (RowId | undefined)[] | undefined {
  if (a.ids === undefined) return b.ids
  if (b.ids === undefined) return a.ids
  const out = a.ids.slice()
  b.ids.forEach((id, i) => {
    if (id !== undefined) out[i] = id
  })
  return out
}

const joined = (row: Row, ids: readonly (RowId | undefined)[] | undefined): JoinedRow => (ids === undefined ? { row } : { row, ids })

const hasLateral = (node: Node): boolean => (node.kind === 'leaf' ? node.table.lateral : hasLateral(node.outer) || hasLateral(node.inner))

/**
 * `context` is the row of the tables before this subtree, for a LATERAL
 * table inside it that reads them: `t1 JOIN (t2 JOIN LATERAL (SELECT t1.a)
 * d ON TRUE) ON TRUE` (8.4.11 reads t1's row there).
 */
function* run(node: Node, trx: Trx | undefined, env: Env, options: RunOptions, width: number, context?: Row): Generator<JoinedRow> {
  if (node.kind === 'leaf') {
    yield* leafRows(node.table, trx, env, options, width, node.table.lateral ? context : undefined)
    return
  }
  if (hasLateral(node.inner)) {
    // LATERAL: the tables after it again for each row of the tables before it.
    const on = node.on
    for (const outer of run(node.outer, trx, env, options, width, context)) {
      const own = outer.row
      const row = context === undefined ? own : own.map((v, i) => v ?? context[i] ?? null)
      let matched = false
      for (const inner of run(node.inner, trx, env, options, width, row)) {
        const combined = row.slice()
        for (const s of node.innerSlots) combined[s] = inner.row[s] ?? null
        if (on === undefined || truth(on.eval(combined, env)) === true) {
          matched = true
          yield joined(combined, joinIds(outer, inner))
        }
      }
      if (!matched && node.left) yield joined(row, outer.ids)
    }
    return
  }
  const on = node.on
  const accepts = (row: Row): boolean => on === undefined || truth(on.eval(row, env)) === true
  const merge = (a: Row, b: Row): Value[] => {
    const out = a.slice()
    for (const s of node.innerSlots) out[s] = b[s] ?? null
    return out
  }
  if (node.left) {
    // Probe with the outer side, build on the inner: each outer row, then its
    // matches newest first, or one row of NULLs.
    const build = [...run(node.inner, trx, env, options, width, context)]
    for (const outer of run(node.outer, trx, env, options, width, context)) {
      let matched = false
      for (let i = build.length - 1; i >= 0; i--) {
        const inner = build[i] as JoinedRow
        const combined = merge(outer.row, inner.row)
        if (accepts(combined)) {
          matched = true
          yield joined(combined, joinIds(outer, inner))
        }
      }
      if (!matched) yield outer
    }
    return
  }
  const lookup = node.lookup
  if (lookup !== undefined && node.inner.kind === 'leaf') {
    // A nested loop with a single-row lookup on the later table's unique key.
    const t = node.inner.table
    for (const outer of run(node.outer, trx, env, options, width, context)) {
      const v = lookup.value.eval(outer.row, env)
      if (v === null) continue
      const access = pointAccess(t.def as TableDef, lookup.index, lookup.column, v)
      for (const { id, row: values } of accessRows(t.table as Table, t.def as TableDef, access ?? {}, trx, options.locking)) {
        const combined = outer.row.slice()
        for (let i = 0; i < t.width; i++) combined[t.offset + i] = values[i] ?? null
        if (accepts(combined)) yield joined(combined, options.ids === true ? joinIds(outer, { row: values, ids: idsAt(t.offset, id) }) : undefined)
      }
    }
    return
  }
  // A hash join: build on the earlier tables, probe with the later one; each
  // probe row's matches newest first.
  const build = [...run(node.outer, trx, env, options, width, context)]
  for (const inner of run(node.inner, trx, env, options, width, context)) {
    for (let i = build.length - 1; i >= 0; i--) {
      const outer = build[i] as JoinedRow
      const combined = merge(outer.row, inner.row)
      if (accepts(combined)) yield joined(combined, joinIds(outer, inner))
    }
  }
}

/** One table's row id, at its offset. */
function idsAt(offset: number, id: RowId): (RowId | undefined)[] {
  const out: (RowId | undefined)[] = []
  out[offset] = id
  return out
}

function* leafRows(t: FromTable, trx: Trx | undefined, env: Env, options: RunOptions, width: number, lateral: Row | undefined): Generator<JoinedRow> {
  const base = (): Value[] => new Array<Value>(width).fill(null)
  if (t.derived !== undefined) {
    for (const values of t.derived.rows(trx, env, lateral)) {
      const row = base()
      for (let i = 0; i < t.width; i++) row[t.offset + i] = values[i] ?? null
      yield { row }
    }
    return
  }
  const def = t.def as TableDef
  let access = t.nullable ? {} : chooseAccess(def, t.alias, options.where, env)
  const cover = options.covering?.get(t.alias)
  if (access.index === undefined && access.ranges === undefined && cover !== undefined) access = { index: cover }
  for (const { id, row: values } of accessRows(t.table as Table, def, access, trx, options.locking)) {
    const row = base()
    for (let i = 0; i < t.width; i++) row[t.offset + i] = values[i] ?? null
    yield options.ids === true ? { row, ids: idsAt(t.offset, id) } : { row }
  }
}

/**
 * `eq_ref`: the later table of an inner join has a PRIMARY or NOT NULL UNIQUE
 * single-column key that an equality in the ON or the WHERE pins to a column
 * of the earlier tables. The lookup is the join's order; whether the bound
 * converts exactly (D-65) decides only whether it is a key read or a filtered
 * scan, never which rows match. Only `=`: `<=>` matches NULL, which a key
 * lookup would not find, and only a top-level conjunct, which every row the
 * query returns must satisfy.
 */
function eqRef(t: FromTable, conditions: readonly (Expression | undefined)[], outerAliases: ReadonlySet<string>, compileOuter: (e: Expression) => Compiled): EqRef | undefined {
  const def = t.def
  if (def === undefined || t.table === undefined) return undefined
  const conjuncts: Expression[] = []
  const flatten = (e: Expression | undefined): void => {
    if (e === undefined) return
    if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) {
      flatten(e.left)
      flatten(e.right)
    } else conjuncts.push(e)
  }
  for (const c of conditions) flatten(c)
  const own = (e: Expression): string | undefined => {
    if (e.kind !== NODE.COLUMN || e.parts.length < 2 || e.parts[e.parts.length - 2] !== t.alias) return undefined
    const name = (e.parts[e.parts.length - 1] as string).toLowerCase()
    return def.columns.find((c) => c.name.toLowerCase() === name)?.name
  }
  const outerColumn = (e: Expression): boolean => e.kind === NODE.COLUMN && e.parts.length >= 2 && outerAliases.has(e.parts[e.parts.length - 2] as string)
  for (const c of conjuncts) {
    if (c.kind !== NODE.BINARY || c.op !== '=') continue
    let col: string | undefined
    let other: Expression | undefined
    if (own(c.left) !== undefined && outerColumn(c.right)) [col, other] = [own(c.left), c.right]
    else if (own(c.right) !== undefined && outerColumn(c.left)) [col, other] = [own(c.right), c.left]
    if (col === undefined || other === undefined) continue
    const column = def.columns.find((x) => x.name === col) as ColumnDef
    const index = def.indexes.find((i) => i.invisible !== true && i.parts.length === 1 && i.parts[0]?.column === col && i.parts[0].prefix === undefined && (i.kind === 'primary' || (i.kind === 'unique' && !column.nullable)))
    if (index === undefined) continue
    let value: Compiled
    try {
      value = compileOuter(other)
    } catch {
      continue
    }
    // `ref` access needs the two sides to compare as the key's own type.
    const k = value.type.kind
    const keyKind = t.def === undefined ? undefined : (new TableScope([{ alias: t.alias, def: t.def }]).resolve([t.alias, col], 'on clause').type.kind)
    if (k !== keyKind || (k === 'string' && value.type.collationId !== column.type.collationId)) continue
    return { index, column, value }
  }
  return undefined
}
