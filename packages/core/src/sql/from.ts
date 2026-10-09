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
// The plan is a tree of iterators (M5.43, D-82), each of which both reads its
// rows and says what it is as 8.4.11 prints it, so EXPLAIN shows what ran.
// The WHERE is applied by the FROM, each conjunct at the iterator the server
// places it at: on one table at that table, an equality between two sides by
// their join, anything else above. Every conjunct is applied to every row it
// could reject (D-65); a table's key range only narrows what is read, and
// never for a table on the inner side of an outer join, where `WHERE b.x IS
// NULL` must still see the NULL rows the join made.
import { FIELD_TYPE, expectTyped } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, IndexDef, RowId, Table, TableDef, Trx } from '@myjs/engine'
import { NODE, REF, type Expression, type TableReference } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { truth, type Value } from '@myjs/types'
import type { Compiled, Env, Row, Scope } from './compile.ts'
import { planNode, type PlanNode } from './explain.ts'
import { FULL_SCAN, accessRows, chooseAccess, dynamicAccess, keyOrder, pointAccess, splitAnd, type Access, type OuterColumn, type RangeCosting } from './plan.ts'
import { bestAccess, floorFilter, joinOrder, type Candidate, type KeyChoice, type Positioned } from './cost.ts'
import { rowKey } from './keys.ts'
import { neverEqual, nullRejected } from './optimize.ts'
import type { TableStatistics } from './stats.ts'
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
  /** A query with no FROM: one constant row at most, which the server reads while planning, as a constant table. */
  readonly constant?: boolean
  /** Merged into the query that reads it (`derived_merge`), rather than materialized. */
  readonly merged?: boolean
  /** Its rows, as values in column order. `lateral` is the FROM's row so far, for LATERAL. */
  rows(trx: Trx | undefined, env: Env, lateral: Row | undefined): Iterable<readonly Value[]>
  /**
   * Its plan (M5.44): its query's, and whether the server merges it into the
   * query that reads it (`derived_merge`) or materializes it first, and as
   * what (`Materialize`, `Materialize CTE c`).
   */
  explain?(): DerivedPlan | undefined
}

/** A derived table's plan: merged, its query's own iterator in its place; or materialized, as what and from what. */
export type DerivedPlan = { readonly merged: true; readonly node: PlanNode } | { readonly merged: false; readonly materialize: string; readonly children: readonly PlanNode[] }

type Node =
  | { readonly kind: 'leaf'; readonly table: FromTable }
  | {
      readonly kind: 'join'
      /** The preserved side and the side that may be all NULL; for an inner join, the earlier and the later. */
      readonly outer: Node
      readonly inner: Node
      readonly left: boolean
      /** The ON's conjuncts, each compiled in the scope its join sees. */
      readonly on: readonly Placed[]
      readonly onAst: Expression | undefined
      readonly innerSlots: readonly number[]
      /** `eq_ref`: the later table's unique key, and the expression of the earlier tables it equals. */
      readonly lookup: EqRef | undefined
    }

/** The two halves of a hash join's key: expressions over the outer (earlier, preserved) side and over the inner, and the equalities they come from. */
interface HashKeys {
  readonly outer: readonly Compiled[]
  readonly inner: readonly Compiled[]
  readonly conditions: readonly Placed[]
}

/** A join's index lookup: the inner table's index, the column it leads with, and the outer side's value for it. */
interface EqRef {
  readonly index: IndexDef
  readonly column: ColumnDef
  readonly value: Compiled
  /** `eq_ref`: a unique key, one row at most. */
  readonly unique: boolean
  /** The conjunct it reads by: the key read itself, which EXPLAIN shows no Filter for. */
  readonly condition: Expression
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
   * The columns the query reads of each table (`'all'` for one read whole).
   * A table no condition chooses an access path for is read through the
   * smallest secondary index that holds them all — MySQL's "Covering index
   * scan", which changes the order of an unordered result — and an index
   * lookup through an index that holds them is a "Covering index lookup".
   */
  reads(columns: ReadonlyMap<string, ReadonlySet<string> | 'all'>): void
  /**
   * The WHERE, given once its caller has compiled it where MySQL resolves it
   * (after the select list), conjunct by conjunct. Each is applied by the
   * iterator 8.4.11 places it at: a condition on one table at that table, an
   * equality between two sides by their join, and the rest above (M5.43).
   * The FROM's rows are then the WHERE's: no caller applies it again.
   */
  filter(where: Expression | undefined, compile: (e: Expression) => Compiled, semijoin?: (e: Expression) => PlanNode | undefined): void
  /** The one table an ORDER BY or GROUP BY reads, and the rows a LIMIT keeps: what the join order pays a sort for (M5.7). Given before the plan is first asked for. */
  sortedBy(alias: string | undefined, limit: number): void
  /** Read the one base table whole in an index's order, for an ORDER BY or a grouping it gives; `force` drops a range on another index for it, and `reverse` reads it descending. */
  readInOrder(index: string, force: boolean, reverse?: boolean): void
  /** The FROM as 8.4.11's iterators (M5.44): the tree `rows` runs, as EXPLAIN shows it. */
  explain(env: Env): PlanNode
  /** How the one base table of a single-table FROM is read: what `rows` and `explain` read it by. */
  access(env: Env): Access
  /** The rows of the FROM, the WHERE applied; `ids` asks for each base table's row id too. */
  rows(trx: Trx | undefined, env: Env, options: { readonly locking: boolean; readonly ids?: boolean }): Iterable<JoinedRow>
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
  /** A base table's statistics, as the optimizer reads them (M5.45). */
  statistics?(def: TableDef, table: Table): TableStatistics
  /** The statement's environment, which the cost model evaluates constant conditions in (M5.7). */
  readonly env?: Env
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
/** `straight` is SELECT STRAIGHT_JOIN: the tables joined in the order written. */
export function planFrom(refs: readonly TableReference[], ctx: FromContext, where?: Expression, straightJoin = false): FromPlan {
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
  let straight = straightJoin
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
        const onScope = slotScope(scope, preliminary)
        const on = splitAnd(onAst).map((e) => ({ e, aliases: aliasesOf(e, preliminary), compiled: ctx.compileOn(e, onScope) }))
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
        // A join by an index on the later table, where one serves it: an outer join by its ON, an inner one by its WHERE too.
        const lateral = [...inner.aliases].some((a) => byAlias.get(a)?.lateral === true)
        const lookup = inner.node.kind !== 'leaf' || lateral ? undefined : refOf(inner.node.table, [onAst, ...(!isLeft && (ref.type === 'STRAIGHT' || ref.type === 'INNER') ? [where] : [])], outer.aliases, preliminary, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(outer.aliases, within), preliminary)))
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
    const lookup = r.node.kind !== 'leaf' || r.node.table.lateral ? undefined : refOf(r.node.table, [where], l.aliases, preliminary, (e) => ctx.compileOn(e, preliminary.restrict(l.aliases)))
    if ([...r.aliases].some((a) => byAlias.get(a)?.lateral === true)) nestedLoopJoins.add(r.aliases)
    return {
      node: { kind: 'join', outer: l.node, inner: r.node, left: false, on: [], onAst: undefined, innerSlots, lookup } as Node,
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
  if (tree !== undefined) tree.node = innerWherePossible(tree.node, where, scope)
  // A column of an enclosing query, compiled once: a constant for each run of this one.
  const outerColumns = new Map<Expression, Compiled | undefined>()
  const outer: OuterColumn | undefined =
    ctx.parent === undefined
      ? undefined
      : (e) => {
          if (e.kind !== NODE.COLUMN) return undefined
          if (!outerColumns.has(e)) {
            let compiled: Compiled | undefined
            try {
              if (scope.resolve(e.parts, 'where clause').depth !== undefined) compiled = ctx.compileOn(e, scope)
            } catch (err) {
              expectTyped(err)
            }
            outerColumns.set(e, compiled)
          }
          return outerColumns.get(e)
        }
  const only = tables.length === 1 ? tables[0] : undefined
  const single = only?.def !== undefined && only.table !== undefined ? { alias: only.alias, def: only.def, table: only.table } : undefined

  // The physical tree: built once the WHERE is placed (`filter`), or without one.
  const settings: LeafSettings = { covering, read: new Map(), chosen: new WeakMap(), scope, tables: new Map(tables.map((t) => [t.alias, t])), ...(outer === undefined ? {} : { outer }), ...(ctx.statistics === undefined ? {} : { statistics: ctx.statistics }) }
  // The join order and each join's access: the cost model's, over the WHERE's conjuncts, once the columns read are known (M5.7).
  const onAsts: Expression[] = []
  const gatherOn = (node: Node): void => {
    if (node.kind === 'leaf') return
    if (node.onAst !== undefined) onAsts.push(node.onAst)
    gatherOn(node.outer)
    gatherOn(node.inner)
  }
  if (tree !== undefined) gatherOn(tree.node)
  // The index lookup into `t` after the tables in `before`, by the WHERE or an ON.
  const lookupAfter = (t: FromTable, before: ReadonlySet<string>): EqRef | undefined => {
    const within = coalesced.filter((g) => g.every((i) => [...before].some((a) => inTable(byAlias.get(a), i))))
    return refOf(t, [where, ...onAsts], before, preliminary, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(before, within), preliminary)))
  }
  let planned: JoinPlan | undefined
  let sort: { readonly alias: string; readonly limit: number } | undefined
  const joinPlan = (): JoinPlan | undefined => {
    if (tree === undefined) return undefined
    const env = ctx.env
    const rangeOf = (t: FromTable, conditions: readonly Weighed[]): RangeEstimate | undefined =>
      env === undefined ? undefined : rangeEstimate(t, conditions, tables, scope, (e) => ctx.compileOn(e, preliminary.restrict(new Set([t.alias]))), env, width)
    planned ??= planJoins(tree.node, splitAnd(where).map((e) => ({ e, aliases: aliasesOf(e, scope) })), scope, settings, straight ? undefined : lookupAfter, rangeOf, sort)
    settings.lookups = planned.lookups
    settings.dynamic = planned.dynamic
    return planned
  }
  const physicalOf = (conditions: readonly Placed[]): Op | undefined => {
    const plan = joinPlan()
    return plan === undefined ? undefined : toOp(plan.node, [...conditions, ...plan.on, ...notNullForLookups(plan)], scope, settings, ctx, preliminary)
  }
  // An inner join's lookup keyed by a nullable column of an earlier table: that column IS NOT NULL there,
  // since a NULL finds no row (`add_not_null_conds`; 8.4.11 shows the Filter on the earlier table).
  const notNullForLookups = (plan: JoinPlan): Placed[] => {
    const out: Placed[] = []
    const visit = (node: Node): void => {
      if (node.kind === 'leaf') return
      visit(node.outer)
      visit(node.inner)
      const lookup = node.lookup
      if (node.left || lookup === undefined || node.inner.kind !== 'leaf' || !plan.lookups.has(node.inner.table.alias)) return
      const c = lookup.condition
      if (c.kind !== NODE.BINARY) return
      const own = columnOf(node.inner.table, c.left, scope) !== undefined
      const key = own ? c.right : c.left
      for (const t of tables) {
        const column = t === node.inner.table || t.nullable ? undefined : columnOf(t, key, scope)
        if (column === undefined || !column.nullable) continue
        const e = { kind: NODE.UNARY, op: 'IS NOT NULL', operand: key, at: c.at } as Expression
        out.push({ e, aliases: new Set([t.alias]), compiled: ctx.compileOn(e, slotScope(preliminary, preliminary)) })
      }
    }
    visit(plan.node)
    return out
  }
  let physical: Op | undefined
  const physicalTree = (): Op | undefined => (physical ??= physicalOf([]))

  return {
    scope,
    tables,
    width,
    joins,
    straight,
    reads(columns) {
      settings.chosen = new WeakMap()
      for (const t of tables) {
        const read = columns.get(t.alias) ?? new Set<string>()
        settings.read.set(t.alias, read)
        const best = t.def === undefined || t.nullable ? undefined : coveringIndex(t.def, read)
        if (best !== undefined) covering.set(t.alias, best)
      }
    },
    sortsFirst(aliases) {
      const plan = joinPlan()
      if (plan === undefined) return false
      // The first table in execution order: the outer side all the way down.
      let node = plan.node
      const spine: Node[] = []
      while (node.kind === 'join') {
        spine.push(node)
        node = node.outer
      }
      const first = node.table.alias
      if (node.table.derived?.joined === true) return false
      if ([...aliases].some((a) => a !== first)) return false
      const looked = plan.lookups
      return spine.every((j) => j.kind === 'join' && ((j.inner.kind === 'leaf' && looked.has(j.inner.table.alias)) || [...nestedLoopJoins].some((s) => [...s].every((a) => innerAliasesOf(j).has(a)) && s.size === innerAliasesOf(j).size)))
    },
    ...(single === undefined ? {} : { single }),
    filter(where, compile, semijoin) {
      settings.where = where
      settings.chosen = new WeakMap()
      // What is true of every row the server folds away (8.4.11: no Filter): `IS NOT NULL` of a NOT NULL column no outer join
      // can null, `<>` between such an integer column and a number it never equals, and an OR with either.
      const notNull = (e: Expression): ColumnDef | undefined => {
        for (const t of tables) {
          const c = t.nullable ? undefined : columnOf(t, e, scope)
          if (c !== undefined && !c.nullable) return c
        }
        return undefined
      }
      const alwaysTrue = (e: Expression): boolean => {
        if (e.kind === NODE.UNARY) return e.op === 'IS NOT NULL' && notNull(e.operand) !== undefined
        if (e.kind !== NODE.BINARY) return false
        if (e.op === 'OR' || e.op === '||') return alwaysTrue(e.left) || alwaysTrue(e.right)
        if (e.op !== '<>' && e.op !== '!=') return false
        const l = notNull(e.left)
        return l !== undefined ? neverEqual(l, e.right) : neverEqual(notNull(e.right), e.left)
      }
      const conditions = splitAnd(where).filter((e) => !alwaysTrue(e)).map((e): Placed => {
        const compiled = compile(e)
        const semi = semijoin?.(e)
        return { e, aliases: aliasesOf(e, scope), compiled, ...(semi === undefined ? {} : { semijoin: semi }) }
      })
      physical = physicalOf(conditions)
    },
    sortedBy(alias, limit) {
      sort = alias === undefined ? undefined : { alias, limit }
    },
    readInOrder(index, force, reverse = false) {
      settings.ordered = { index, force, reverse }
    },
    access(env) {
      return leafAccess(tables[0] as FromTable, settings, env)
    },
    explain(env) {
      return physicalTree()?.describe(env) ?? planNode('Rows fetched before execution')
    },
    rows(trx, env, options) {
      const op = physicalTree()
      if (op === undefined) return [{ row: [] }]
      return op.rows({ trx, env, locking: options.locking, ids: options.ids === true, width })
    },
  }
}

/**
 * Outer-join simplification, for the plan (`simplify_joins`): an outer join
 * whose nullable side a WHERE condition rejects NULL on — or an inner join's
 * ON, or a converted join's own ON — is an inner join, since the rows it adds
 * are filtered out anyway; to a fixed point, as `optimize.ts` decides it for
 * the metadata. The converted joins may then be reordered and their tables
 * read by ranges, and a table no unconverted outer join can null is no longer
 * marked nullable (`FromTable.nullable`; the scope keeps what the columns
 * report).
 */
function innerWherePossible(root: Node, where: Expression | undefined, scope: TableScope): Node {
  const slot = (e: Expression): number | undefined => {
    if (e.kind !== NODE.COLUMN) return undefined
    const p = e.parts[0] as string
    if (e.parts.length === 1 && p.startsWith(SLOT_PREFIX)) return Number(p.slice(SLOT_PREFIX.length))
    try {
      const r = scope.resolve(e.parts, 'where clause')
      return r.depth === undefined ? r.index : undefined
    } catch (err) {
      expectTyped(err)
      return undefined
    }
  }
  let pool: Expression[] = []
  const converted = new Set<Node>()
  // The ONs that hold as a WHERE does: an inner join's, or a converted one's, outside any nullable side.
  const gather = (n: Node, nullable: boolean): void => {
    if (n.kind === 'leaf') return
    const inner = !n.left || converted.has(n)
    if (inner && !nullable) pool.push(...splitAnd(n.onAst))
    gather(n.outer, nullable)
    gather(n.inner, nullable || !inner)
  }
  const visit = (n: Node, nullable: boolean): boolean => {
    if (n.kind === 'leaf') return false
    let changed = visit(n.outer, nullable)
    if (n.left && !converted.has(n) && !nullable) {
      const inner = leafAliases(n.inner)
      if (pool.some((c) => nullRejected(c, slot).some((i) => inner.has(scope.columnAt(i)?.table.alias ?? '')))) {
        converted.add(n)
        pool.push(...splitAnd(n.onAst))
        changed = true
      }
    }
    return visit(n.inner, nullable || (n.left && !converted.has(n))) || changed
  }
  do {
    pool = splitAnd(where)
    gather(root, false)
  } while (visit(root, false))
  if (converted.size === 0) return root
  const rebuilt = (n: Node): Node => (n.kind === 'leaf' ? n : { ...n, outer: rebuilt(n.outer), inner: rebuilt(n.inner), left: n.left && !converted.has(n) })
  const node = rebuilt(root)
  const mark = (n: Node, nullable: boolean): void => {
    if (n.kind === 'leaf') {
      ;(n.table as { nullable: boolean }).nullable = nullable
      return
    }
    mark(n.outer, nullable)
    mark(n.inner, nullable || n.left)
  }
  mark(node, false)
  return node
}

/** The aliases of a join's inner side. */
const innerAliasesOf = (j: Node): Set<string> => (j.kind === 'join' ? leafAliases(j.inner) : new Set())

/** The aliases of every table under a node. */
const leafAliases = (n: Node): Set<string> => (n.kind === 'leaf' ? new Set([n.table.alias]) : new Set([...leafAliases(n.outer), ...leafAliases(n.inner)]))

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

const NONE: readonly number[] = []

/** A row's hash key: its key values' `rowKey`, or `undefined` when one is NULL, which `=` matches to nothing. */
function keyOf(exprs: readonly Compiled[], row: Row, env: Env): string | undefined {
  const values: Value[] = []
  for (const e of exprs) {
    const v = e.eval(row, env)
    if (v === null) return undefined
    values.push(v)
  }
  return rowKey(values)
}

/** The build rows' positions by key, ascending, so a probe walks its bucket newest first as it walked them all. */
function bucket(rows: readonly JoinedRow[], exprs: readonly Compiled[], env: Env): Map<string, number[]> {
  const out = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const k = keyOf(exprs, r.row, env)
    if (k === undefined) return
    const list = out.get(k)
    if (list === undefined) out.set(k, [i])
    else list.push(i)
  })
  return out
}

/**
 * The equalities among `conditions`' conjuncts that may key a hash join of
 * `outer` with `inner`: one side's columns against the other's, where two
 * values that compare equal always have one `rowKey`. That holds for two
 * exact numbers (`1` and `1.0` key alike) and for two strings under one
 * collation (`equalityKey`); a string against a number compares as doubles,
 * and two collations meet under a third, so neither is a key. `undefined`
 * when there is none, and the join tries every pair.
 */
function hashKeys(conditions: readonly Placed[], outer: ReadonlySet<string>, inner: ReadonlySet<string>, scope: TableScope, compile: (e: Expression) => Compiled): HashKeys | undefined {
  const out: Compiled[] = []
  const inn: Compiled[] = []
  const used: Placed[] = []
  const side = (e: Expression): 'outer' | 'inner' | undefined => {
    const a = aliasesOf(e, scope)
    if (a === undefined || a.size === 0) return undefined
    if ([...a].every((x) => outer.has(x))) return 'outer'
    if ([...a].every((x) => inner.has(x))) return 'inner'
    return undefined
  }
  const exact = (k: string): boolean => k === 'int' || k === 'decimal'
  for (const placed of conditions) {
    const c = placed.e
    if (c.kind !== NODE.BINARY || c.op !== '=') continue
    const l = side(c.left)
    const r = side(c.right)
    if (l === undefined || r === undefined || l === r) continue
    let a: Compiled
    let b: Compiled
    try {
      a = compile(l === 'outer' ? c.left : c.right)
      b = compile(l === 'outer' ? c.right : c.left)
    } catch (e) {
      expectTyped(e)
      continue
    }
    const keyed = (exact(a.type.kind) && exact(b.type.kind)) || (a.type.kind === 'string' && b.type.kind === 'string' && a.type.collationId === b.type.collationId)
    if (!keyed) continue
    out.push(a)
    inn.push(b)
    used.push(placed)
  }
  return out.length === 0 ? undefined : { outer: out, inner: inn, conditions: used }
}

/** One table's row id, at its offset. */
function idsAt(offset: number, id: RowId): (RowId | undefined)[] {
  const out: (RowId | undefined)[] = []
  out[offset] = id
  return out
}

/** How the FROM's base tables are read: what the WHERE is, what covers them, and an order asked for. */
interface LeafSettings {
  where?: Expression | undefined
  readonly covering: ReadonlyMap<string, string>
  /** The columns the query reads of each table (`reads`). */
  readonly read: Map<string, ReadonlySet<string> | 'all'>
  /** A base table's statistics, for the cost model (M5.7). */
  readonly statistics?: (def: TableDef, table: Table) => TableStatistics
  /** The FROM's scope, which names a condition's columns. */
  readonly scope?: TableScope
  /** The FROM's tables by alias, for the cost model. */
  readonly tables?: ReadonlyMap<string, FromTable>
  /** The tables the cost model reads by their join's index lookup (`planJoins`). */
  lookups?: ReadonlySet<string>
  /** The tables read by a range re-planned for each row before them (`planJoins`). */
  dynamic?: ReadonlySet<string>
  readonly outer?: OuterColumn
  /** `chosenAccess`'s choices, by statement environment and table. */
  chosen: WeakMap<Env, Map<string, Access>>
  /** The one table read whole in this index's order (`readInOrder`). */
  ordered?: { readonly index: string; readonly force: boolean; readonly reverse: boolean }
}

/**
 * How a base table is read: a key range the WHERE pins, never for a table an
 * outer join may null (see the header); else the covering index chosen for
 * it; else a full scan. An order asked for reads its index whole instead, and
 * `force` drops a range on any other index for it: a grouping by index
 * reads the index it groups by. Both the row reader and EXPLAIN ask this.
 */
function leafAccess(t: FromTable, settings: LeafSettings, env: Env): Access {
  const access = chosenAccess(t, settings, env)
  const order = settings.ordered
  if (order !== undefined && t.def !== undefined) {
    const clustered = t.def.indexes.find((i) => i.name === order.index)?.kind === 'primary' || t.def.clustered === order.index
    const same = clustered ? access.index === undefined : access.index === order.index
    const whole = clustered ? {} : { index: order.index }
    if (access.ranges === undefined || (order.force && !same)) return order.reverse ? { ...whole, reverse: true } : whole
    return access
  }
  const cover = settings.covering.get(t.alias)
  return access.index === undefined && access.ranges === undefined && cover !== undefined ? { index: cover } : access
}

/** The access `chooseAccess` picks for a table under the WHERE, once per statement's environment: a range is weighed by counting its rows. */
function chosenAccess(t: FromTable, settings: LeafSettings, env: Env): Access {
  if (t.nullable || t.def === undefined) return FULL_SCAN
  let chosen = settings.chosen.get(env)
  if (chosen === undefined) settings.chosen.set(env, (chosen = new Map()))
  let access = chosen.get(t.alias)
  if (access === undefined) chosen.set(t.alias, (access = chooseAccess(t.def, t.alias, settings.where, env, settings.outer, rangeCosting(t, settings, env))))
  return access
}

/** What the range optimizer weighs a base table's ranges by: its statistics, what covers the query, and its rows counted in a range. */
function rangeCosting(t: FromTable, settings: LeafSettings, env: Env): RangeCosting | undefined {
  const def = t.def
  const table = t.table
  if (def === undefined || table === undefined || settings.statistics === undefined) return undefined
  const read = settings.read.get(t.alias) ?? 'all'
  const clustered = clusteredIndex(def)
  const cover = settings.covering.get(t.alias)
  // The shortest a clustered record can be: its header, InnoDB's trx id and roll pointer, and its fixed-width columns.
  const fixed = def.columns.reduce((n, c) => n + (c.type.collationId === undefined ? keyBytes(c) - (c.nullable ? 1 : 0) : 0), 0)
  return {
    stats: settings.statistics(def, table),
    covers: (i) => holdsRead(def, i, read),
    recordBytes: (i) => indexBytes(def, i) + indexBytes(def, clustered),
    coveringScan: cover === undefined ? undefined : def.indexes.find((i) => i.name === cover),
    minRecordBytes: 5 + 13 + Math.ceil(def.columns.filter((c) => c.nullable).length / 8) + fixed,
    count(index, range, limit) {
      let n = 0
      for (const _ of accessRows(table, def, { index, ranges: [range] }, env.trx, false)) if (++n > limit) break
      return n
    },
  }
}

/**
 * An index lookup into the later table of a join, by an equality in the ON
 * or the WHERE between one of its indexed columns and an expression over the
 * earlier tables: `eq_ref` when the index is a PRIMARY or NOT NULL UNIQUE key
 * of that one column ("Single-row index lookup"), `ref` on any other index the
 * column leads ("Index lookup"). 8.4.11 joins by an index wherever one serves
 * the join, and by a hash only where none does. The lookup decides the join's
 * order; whether the value converts exactly (D-65) decides only whether it is
 * a key read or a filtered scan, never which rows match. Only `=`, since
 * `<=>` matches NULL, which a key lookup would not find; and only a top-level
 * conjunct, which every row the join returns must satisfy.
 */
function refOf(t: FromTable, conditions: readonly (Expression | undefined)[], outerAliases: ReadonlySet<string>, scope: TableScope, compileOuter: (e: Expression) => Compiled): EqRef | undefined {
  const def = t.def
  if (def === undefined || t.table === undefined) return undefined
  const own = (e: Expression): ColumnDef | undefined => columnOf(t, e, scope)
  const fromOuter = (e: Expression): boolean => {
    const a = aliasesOf(e, scope)
    return a !== undefined && a.size > 0 && [...a].every((x) => outerAliases.has(x))
  }
  const unique = (i: IndexDef, c: ColumnDef): boolean => i.parts.length === 1 && (i.kind === 'primary' || (i.kind === 'unique' && !c.nullable))
  let best: EqRef | undefined
  for (const c of conditions.flatMap((x) => splitAnd(x))) {
    if (c.kind !== NODE.BINARY || c.op !== '=') continue
    const pair = own(c.left) !== undefined && fromOuter(c.right) ? ([own(c.left), c.right] as const) : own(c.right) !== undefined && fromOuter(c.left) ? ([own(c.right), c.left] as const) : undefined
    if (pair === undefined) continue
    const [column, other] = pair as readonly [ColumnDef, Expression]
    // The unique key first, else the first index the column leads.
    const leading = def.indexes.filter((i) => i.invisible !== true && i.parts[0]?.column === column.name && i.parts[0].prefix === undefined && i.parts[0].descending !== true)
    // The unique key first, else the first index the column leads; whether to look up at all is the cost model's (`toOp`).
    const index = leading.find((i) => unique(i, column)) ?? leading[0]
    if (index === undefined || (best !== undefined && (best.unique || !unique(index, column)))) continue
    let value: Compiled
    try {
      value = compileOuter(other)
    } catch (e) {
      expectTyped(e)
      continue
    }
    // A key read needs the two sides to compare as the key's own type.
    const keyKind = new TableScope([{ alias: t.alias, def }]).resolve([t.alias, column.name], 'on clause').type.kind
    if (value.type.kind !== keyKind || (keyKind === 'string' && value.type.collationId !== column.type.collationId)) continue
    best = { index, column, value, unique: unique(index, column), condition: c }
  }
  return best
}

/** A column of a base table an expression names: qualified by its alias, one of USING's slots, or a bare name the scope gives it. */
function columnOf(t: FromTable, e: Expression, scope: TableScope): ColumnDef | undefined {
  if (e.kind !== NODE.COLUMN || t.def === undefined) return undefined
  const p = e.parts[0] as string
  let name: string | undefined
  if (e.parts.length === 1 && p.startsWith(SLOT_PREFIX)) {
    const at = scope.columnAt(Number(p.slice(SLOT_PREFIX.length)))
    name = at?.table.alias === t.alias ? at.column.name : undefined
  } else if (e.parts.length >= 2) name = e.parts[e.parts.length - 2] === t.alias ? (e.parts[e.parts.length - 1] as string) : undefined
  else {
    try {
      const r = scope.resolve(e.parts, 'where clause')
      const at = r.depth === undefined ? scope.columnAt(r.index) : undefined
      name = at?.table.alias === t.alias ? at.column.name : undefined
    } catch (err) {
      expectTyped(err)
    }
  }
  return name === undefined ? undefined : t.def.columns.find((c) => c.name.toLowerCase() === (name as string).toLowerCase())
}

// --- the plan, as EXPLAIN shows it (M5.44) --------------------------------------

/** A condition placed at an iterator: its text, which decides where it goes, and its closure, which that iterator applies. */
interface Placed {
  readonly e: Expression
  /** The tables it reads; `undefined` when it reads more than a table's row (a subquery, an outer query's column). */
  readonly aliases: ReadonlySet<string> | undefined
  readonly compiled: Compiled
  /** A [NOT] EXISTS the server runs as a semijoin: what EXPLAIN shows in place of its Filter. */
  readonly semijoin?: PlanNode
}

/** The aliases of the FROM's tables an expression reads, or `undefined` if it reads anything else. */
function aliasesOf(e: Expression, scope: TableScope): Set<string> | undefined {
  const out = new Set<string>()
  let other = false
  const visit = (x: unknown): void => {
    if (other || x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(visit)
    const n = x as { kind?: string; parts?: readonly string[] }
    if (n.kind === NODE.SUBQUERY) {
      other = true
      return
    }
    if (n.kind === NODE.COLUMN && n.parts !== undefined) {
      // USING's equalities name slots, which are positions in the FROM's row.
      const p = n.parts[0] as string
      if (n.parts.length === 1 && p.startsWith(SLOT_PREFIX)) {
        const at = scope.columnAt(Number(p.slice(SLOT_PREFIX.length)))
        if (at === undefined) other = true
        else out.add(at.table.alias)
        return
      }
      try {
        const r = scope.resolve(n.parts, 'where clause')
        const at = r.depth === undefined ? scope.columnAt(r.index) : undefined
        if (at === undefined) other = true
        else out.add(at.table.alias)
      } catch (e) {
        expectTyped(e)
        other = true
      }
      return
    }
    for (const v of Object.values(x)) if (typeof v === 'object') visit(v)
  }
  visit(e)
  return other ? undefined : out
}

const within = (c: Placed, aliases: ReadonlySet<string>): boolean => c.aliases !== undefined && c.aliases.size > 0 && [...c.aliases].every((a) => aliases.has(a))


// --- the iterators (M5.43) --------------------------------------------------------

/** One run of the FROM: the transaction, the statement's environment, and what each row carries. */
interface FromRun {
  readonly trx: Trx | undefined
  readonly env: Env
  readonly locking: boolean
  readonly ids: boolean
  readonly width: number
}

/**
 * An iterator of the FROM: it reads its rows, and says what it is as 8.4.11
 * prints it. The tree of them is the plan, run and explained alike (D-81).
 * `context` is the row of the tables before this subtree, for a LATERAL table
 * inside it: `t1 JOIN (t2 JOIN LATERAL (SELECT t1.a) d ON TRUE) ON TRUE`.
 */
interface Op {
  rows(run: FromRun, context?: Row): Iterable<JoinedRow>
  describe(env: Env): PlanNode
}

/** Whether a row satisfies conditions as MySQL's AND does: false at the first FALSE, NULL past any NULL, true only if every one is. */
function holds(conditions: readonly Placed[], row: Row, env: Env): boolean {
  let unknown = false
  for (const c of conditions) {
    const t = truth(c.compiled.eval(row, env))
    if (t === false) return false
    if (t === null) unknown = true
  }
  return !unknown
}

/**
 * The physical tree of a join tree, with `conditions` placed: one that reads
 * a single side goes down to it; an equality between the sides keys a hash
 * join or a nested loop's lookup; the rest is a Filter where both sides are
 * joined. A WHERE condition never goes into the side an outer join may null,
 * nor an outer join's ON condition into its preserved side.
 */
function toOp(node: Node, conditions: readonly Placed[], scope: TableScope, settings: LeafSettings, ctx: FromContext, preliminary: TableScope): Op {
  if (node.kind === 'leaf') return filterOp(tableOp(node.table, settings), conditions, node.table, settings)
  const outerAliases = leafAliases(node.outer)
  const innerAliases = leafAliases(node.inner)
  // An inner join's ON is its WHERE; an outer join's ON may go down only into the side it nulls.
  const all = node.left ? conditions : [...conditions, ...node.on]
  const toOuter = all.filter((c) => within(c, outerAliases))
  const toInner = (node.left ? node.on : all).filter((c) => within(c, innerAliases))
  const here = all.filter((c) => !toOuter.includes(c) && !toInner.includes(c))
  // What the join itself decides a pair by: an outer join's ON; an inner join's conditions on both sides.
  const spanning = node.left ? node.on.filter((c) => !toInner.includes(c)) : here
  const above = node.left ? here : []
  const outer = toOp(node.outer, toOuter, scope, settings, ctx, preliminary)
  if (hasLateral(node.inner)) {
    const inner = toOp(node.inner, toInner, scope, settings, ctx, preliminary)
    return filterOp(lateralOp(node, outer, inner, spanning), above)
  }
  if (node.inner.kind === 'leaf' && settings.dynamic?.has(node.inner.table.alias) === true) {
    const t = node.inner.table
    const known = (e: Expression): Compiled | undefined => {
      const a = aliasesOf(e, scope)
      return a !== undefined && a.size > 0 && [...a].every((x) => outerAliases.has(x)) ? ctx.compileOn(e, slotScope(preliminary.restrict(outerAliases), preliminary)) : undefined
    }
    return filterOp(dynamicOp(node, outer, t, [...toInner, ...spanning], settings, known), above)
  }
  if (node.lookup !== undefined && node.inner.kind === 'leaf' && settings.lookups?.has(node.inner.table.alias) !== false) {
    return filterOp(lookupOp(node, outer, node.inner.table, node.lookup, [...toInner, ...spanning], settings), above)
  }
  const inner = toOp(node.inner, toInner, scope, settings, ctx, preliminary)
  const both = new Set([...outerAliases, ...innerAliases])
  const keys = hashKeys(spanning, outerAliases, innerAliases, scope, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(both), preliminary)))
  // A materialized derived table joined by an equality is indexed on it and looked up (`<auto_key0>`).
  const d = node.inner.kind === 'leaf' ? node.inner.table : undefined
  if (d?.derived !== undefined && keys !== undefined && !d.lateral && d.derived.merged !== true && d.derived.constant !== true) {
    const equalities = node.left ? spanning : spanning.filter((c) => isEquiJoin(c, outerAliases, innerAliases, scope))
    return filterOp(autoKeyOp(node, outer, inner, d, keys, node.left ? spanning : equalities), node.left ? above : spanning.filter((c) => !equalities.includes(c)))
  }
  if (node.left) return filterOp(hashJoinOp(node, outer, inner, spanning, keys), above)
  // An inner join's equalities between its sides are its own condition, whether or not they key the hash
  // (only some can: `hashKeys`); any other condition on both sides is a Filter over it.
  const equalities = spanning.filter((c) => isEquiJoin(c, outerAliases, innerAliases, scope))
  return filterOp(hashJoinOp(node, outer, inner, equalities, keys), spanning.filter((c) => !equalities.includes(c)))
}

// --- the cost model's choices (M5.7) -----------------------------------------------

/** A condition as the cost model weighs it: its text and the tables it reads. */
type Weighed = Pick<Placed, 'e' | 'aliases'>

/** The joins as they run: in the order chosen, each later table read by its lookup or hashed, and the ON conditions a reordered tree applies above its joins. */
interface JoinPlan {
  readonly node: Node
  readonly lookups: ReadonlySet<string>
  readonly on: readonly Placed[]
  /** The tables whose range is re-planned for each row before them (`finish` in `planJoins`). */
  readonly dynamic: ReadonlySet<string>
}

/**
 * The join order and each table's access (`cost.ts`). An inner join of base
 * tables is reordered as the server orders it (`joinOrder`), given
 * `lookupAfter`, which finds the index lookup into a table after the tables
 * before it; anything else — an outer join, a derived or LATERAL table,
 * STRAIGHT_JOIN — runs in the written order. Either way each table is read
 * by its lookup or whole as `bestAccess` decides, given the rows the tables
 * before it are estimated to give. The conditions that filter those
 * estimates are the WHERE and the inner joins' ONs; an outer join's ON keys
 * its lookup but filters nothing (`where_cond`). A table with no statistics
 * to cost it by is looked up.
 */
function planJoins(root: Node, where: readonly Weighed[], scope: TableScope, settings: LeafSettings, lookupAfter: ((t: FromTable, before: ReadonlySet<string>) => EqRef | undefined) | undefined, rangeOf: (t: FromTable, conditions: readonly Weighed[]) => RangeEstimate | undefined, sort: { readonly alias: string; readonly limit: number } | undefined): JoinPlan {
  const conditions = [...where]
  const gather = (node: Node, nullable: boolean): void => {
    if (node.kind === 'leaf') return
    if (!node.left && !nullable) conditions.push(...node.on)
    gather(node.outer, nullable)
    gather(node.inner, nullable || node.left)
  }
  gather(root, false)
  const statsOf = (t: FromTable): TableStatistics | undefined => (t.def !== undefined && t.table !== undefined ? settings.statistics?.(t.def, t.table) : undefined)
  const leaves: FromTable[] = []
  const inner = (node: Node): boolean => (node.kind === 'leaf' ? (leaves.push(node.table), true) : !node.left && inner(node.outer) && inner(node.inner))
  if (lookupAfter !== undefined && inner(root) && leaves.length > 1 && leaves.every((t) => !t.lateral && statsOf(t) !== undefined)) {
    const candidates: Candidate[] = leaves.map((t) => {
      const range = rangeOf(t, conditions)
      return {
        alias: t.alias,
        rows: range?.rows ?? (statsOf(t) as TableStatistics).rows,
        dependent: new Set(),
        keyDependent: keySources(t, conditions, scope),
        place: (prefix) => placeTable(t, lookupAfter(t, new Set(prefix.map((p) => p.alias))), prefix, conditions, scope, settings, statsOf(t), range),
      }
    })
    const order = joinOrder(candidates, sort)
    const byAlias = new Map(leaves.map((t) => [t.alias, t]))
    let node: Node = { kind: 'leaf', table: byAlias.get((order[0] as Positioned).alias) as FromTable }
    const before = new Set([(order[0] as Positioned).alias])
    for (const p of order.slice(1)) {
      const t = byAlias.get(p.alias) as FromTable
      const lookup = p.lookup ? lookupAfter(t, before) : undefined
      node = { kind: 'join', outer: node, inner: { kind: 'leaf', table: t }, left: false, on: [], onAst: undefined, innerSlots: Array.from({ length: t.width }, (_, i) => t.offset + i), lookup }
      before.add(p.alias)
    }
    const on: Placed[] = []
    const ons = (n: Node): void => {
      if (n.kind === 'leaf') return
      on.push(...n.on)
      ons(n.outer)
      ons(n.inner)
    }
    ons(root)
    return finish(node, new Set(order.filter((p) => p.lookup).map((p) => p.alias)), on)
  }
  const candidates = (node: Node): boolean => node.kind === 'join' && (node.lookup !== undefined || candidates(node.outer) || candidates(node.inner))
  if (!candidates(root)) return finish(root, new Set(), [])
  const positions: Positioned[] = []
  const visit = (node: Node, lookup?: EqRef): void => {
    if (node.kind === 'join') {
      visit(node.outer)
      visit(node.inner, node.lookup)
      return
    }
    positions.push(placeTable(node.table, lookup, positions, conditions, scope, settings, statsOf(node.table), rangeOf(node.table, conditions)))
  }
  visit(root)
  return finish(root, new Set(positions.filter((p) => p.lookup).map((p) => p.alias)), [])

  // "Range checked for each record": a later table read whole, with no range of its own on constants, whose indexed
  // column a condition compares by `<`, `>` or BETWEEN with the tables before it — not by `=`, whose key was already
  // weighed as a lookup (`checked_keys`). The server re-plans its range for each row before it, and joins it by a
  // nested loop, never a buffer (8.4.11).
  function finish(node: Node, lookups: ReadonlySet<string>, on: readonly Placed[]): JoinPlan {
    const dynamic = new Set<string>()
    const before = new Set<string>()
    const walk = (n: Node): void => {
      if (n.kind === 'leaf') {
        before.add(n.table.alias)
        return
      }
      walk(n.outer)
      const inner = n.inner
      if (inner.kind === 'leaf' && !lookups.has(inner.table.alias) && !inner.table.lateral && inner.table.def !== undefined && inner.table.table !== undefined) {
        const own = n.left ? n.on : conditions
        if (rangeOf(inner.table, own) === undefined && own.some((c) => comparesWithEarlier(inner.table, c.e, before, scope))) dynamic.add(inner.table.alias)
      }
      walk(inner)
    }
    walk(node)
    return { node, lookups, on, dynamic }
  }
}

/** Whether a condition compares an indexed column of `t` by `<`, `<=`, `>`, `>=` or BETWEEN with columns of the tables in `before` alone. */
function comparesWithEarlier(t: FromTable, e: Expression, before: ReadonlySet<string>, scope: TableScope): boolean {
  const leads = (x: Expression): boolean => {
    const c = columnOf(t, x, scope)
    return c !== undefined && t.def?.indexes.some((i) => i.invisible !== true && i.parts[0]?.column === c.name && i.parts[0].prefix === undefined) === true
  }
  const earlier = (x: Expression | undefined): boolean => {
    const a = x === undefined ? undefined : aliasesOf(x, scope)
    return a !== undefined && a.size > 0 && [...a].every((alias) => before.has(alias))
  }
  return splitAnd(e).some((c) => {
    if (c.kind !== NODE.BINARY) return false
    if (['<', '<=', '>', '>='].includes(c.op)) return (leads(c.left) && earlier(c.right)) || (leads(c.right) && earlier(c.left))
    return c.op.toUpperCase() === 'BETWEEN' && leads(c.left) && (earlier(c.right) || earlier(c.extra as Expression))
  })
}

/** What the range optimizer estimates of a table (`found_records`, `quick_rows`): its rows under the conditions on each column an index leads, and the least of them. */
interface RangeEstimate {
  readonly rows: number
  readonly counts: ReadonlyMap<ColumnDef, number>
}

/**
 * The rows of `t` each index's range would read, as the range optimizer's
 * index dives count them — exactly, on a table this size. A condition counts
 * for a column an index leads where it compares that column alone with
 * constants: a comparison, BETWEEN, IN, IS [NOT] NULL, a LIKE with a fixed
 * prefix, or an AND or OR of them. Two things are done first, as the server
 * does them: an IS NULL on a NOT NULL column is false, so an OR drops it; and
 * a condition on a column joined to this one by `=` holds for this one too
 * (multiple equalities), so `lt.n = pa.id AND pa.id <= 0.5` ranges over
 * `lt.n`. A range that finds nothing estimates one row (`records_in_range`).
 */
function rangeEstimate(t: FromTable, conditions: readonly Weighed[], leaves: readonly FromTable[], scope: TableScope, compile: (e: Expression) => Compiled, env: Env, width: number): RangeEstimate | undefined {
  const def = t.def
  if (def === undefined || t.table === undefined || t.nullable) return undefined
  const leading = new Set(def.indexes.filter((i) => i.invisible !== true && i.parts[0]?.prefix === undefined).map((i) => i.parts[0]?.column))
  const resolve = (e: Expression): { readonly t: FromTable; readonly c: ColumnDef } | undefined => {
    for (const l of leaves) {
      const c = columnOf(l, e, scope)
      if (c !== undefined) return { t: l, c }
    }
    return undefined
  }
  const name = (r: { readonly t: FromTable; readonly c: ColumnDef }): string => `${r.t.alias}\u0000${r.c.name.toLowerCase()}`
  const conjuncts = conditions.flatMap((c) => splitAnd(c.e))
  // The multiple equalities: classes of columns joined by `=`.
  const classes: Set<string>[] = []
  const classOf = (k: string): Set<string> => classes.find((c) => c.has(k)) ?? (classes.push(new Set([k])), classes.at(-1) as Set<string>)
  for (const e of conjuncts) {
    if (e.kind !== NODE.BINARY || e.op !== '=') continue
    const l = resolve(e.left)
    const r = resolve(e.right)
    if (l === undefined || r === undefined || l.t === r.t) continue
    const a = classOf(name(l))
    const b = classOf(name(r))
    if (a === b) continue
    for (const k of b) a.add(k)
    classes.splice(classes.indexOf(b), 1)
  }
  const isNullOfNotNull = (e: Expression): boolean => e.kind === NODE.UNARY && e.op === 'IS NULL' && resolve(e.operand)?.c.nullable === false
  const possible = (e: Expression): Expression => {
    if (e.kind !== NODE.BINARY || (e.op !== 'OR' && e.op !== '||')) return e
    const kept = [possible(e.left), possible(e.right)].filter((x) => !isNullOfNotNull(x))
    return kept.length === 2 ? { ...e, left: kept[0] as Expression, right: kept[1] as Expression } : (kept[0] ?? e)
  }
  const per = new Map<ColumnDef, Expression[]>()
  for (const raw of conjuncts) {
    const e = possible(raw)
    const columns: Expression[] = []
    let plain = true
    const visit = (x: unknown): void => {
      if (!plain || x === null || typeof x !== 'object') return
      if (Array.isArray(x)) return x.forEach(visit)
      const n = x as Expression
      if (n.kind === NODE.SUBQUERY || n.kind === NODE.PLACEHOLDER || n.kind === NODE.VARIABLE) plain = false
      else if (n.kind === NODE.COLUMN) columns.push(n)
      else for (const v of Object.values(n)) if (typeof v === 'object') visit(v)
    }
    visit(e)
    if (!plain || columns.length === 0) continue
    const resolved = columns.map(resolve)
    const first = resolved[0]
    if (first === undefined || resolved.some((r) => r === undefined || name(r) !== name(first))) continue
    const target = first.t === t ? first.c : def.columns.find((c) => classOf(name(first)).has(name({ t, c })))
    if (target === undefined || !leading.has(target.name)) continue
    const column: Expression = { kind: NODE.COLUMN, parts: [t.alias, target.name], at: e.at } as Expression
    const own = (x: Expression): boolean => x.kind === NODE.COLUMN && resolve(x) !== undefined && name(resolve(x) as { t: FromTable; c: ColumnDef }) === name(first)
    const rewrite = (x: Expression): Expression => (own(x) ? column : x)
    const sargable = (x: Expression): Expression | undefined => {
      const constant = (y: Expression | undefined): boolean => y !== undefined && !own(y) && aliasesOf(y, scope)?.size === 0
      if (x.kind === NODE.UNARY) return (x.op === 'IS NULL' || x.op === 'IS NOT NULL') && own(x.operand) ? { ...x, operand: column } : undefined
      if (x.kind !== NODE.BINARY) return undefined
      const op = x.op.toUpperCase()
      if (op === 'AND' || op === '&&' || op === 'OR' || op === '||') {
        const a = sargable(x.left)
        const b = sargable(x.right)
        return a === undefined || b === undefined ? undefined : { ...x, left: a, right: b }
      }
      if (['=', '<=>', '<', '<=', '>', '>=', '<>', '!='].includes(op)) return (own(x.left) && constant(x.right)) || (own(x.right) && constant(x.left)) ? { ...x, left: rewrite(x.left), right: rewrite(x.right) } : undefined
      if (op === 'BETWEEN' || op === 'NOT BETWEEN') return own(x.left) && constant(x.right) && constant(x.extra as Expression) ? { ...x, left: column } : undefined
      if (op === 'IN' || op === 'NOT IN') return own(x.left) && x.right.kind === NODE.ROW && x.right.items.every((i) => constant(i)) ? { ...x, left: column } : undefined
      if (op === 'LIKE') return own(x.left) && x.right.kind === NODE.LITERAL && typeof x.right.value === 'string' && !/^[%_]/.test(x.right.value) && x.extra === undefined ? { ...x, left: column } : undefined
      return undefined
    }
    const range = sargable(e)
    if (range === undefined) continue
    per.set(target, [...(per.get(target) ?? []), range])
  }
  if (per.size === 0) return undefined
  const compiled: [ColumnDef, Compiled][] = []
  for (const [column, es] of per) {
    try {
      compiled.push([column, compile(es.reduce((a, b) => ({ kind: NODE.BINARY, op: 'AND', left: a, right: b, at: a.at }) as Expression))])
    } catch (e) {
      expectTyped(e)
    }
  }
  if (compiled.length === 0) return undefined
  const counts = new Map<ColumnDef, number>(compiled.map(([c]) => [c, 0]))
  const row = new Array<Value>(width).fill(null)
  for (const { row: values } of accessRows(t.table, def, FULL_SCAN, undefined, false)) {
    for (let i = 0; i < t.width; i++) row[t.offset + i] = values[i] ?? null
    for (const [column, c] of compiled) if (truth(c.eval(row, env)) === true) counts.set(column, (counts.get(column) as number) + 1)
  }
  for (const [c, n] of counts) counts.set(c, Math.max(1, n))
  return { rows: Math.min(...counts.values()), counts }
}

/** The tables an index lookup into `t` could take its key from: the other side of an equality with a column an index leads (`key_dependent`). */
function keySources(t: FromTable, conditions: readonly Weighed[], scope: TableScope): Set<string> {
  const out = new Set<string>()
  const leads = (c: ColumnDef | undefined): boolean => c !== undefined && t.def?.indexes.some((i) => i.invisible !== true && i.parts[0]?.column === c.name) === true
  for (const { e } of conditions) {
    for (const c of splitAnd(e)) {
      if (c.kind !== NODE.BINARY || c.op !== '=') continue
      for (const [own, other] of [[c.left, c.right], [c.right, c.left]] as const) {
        if (!leads(columnOf(t, own, scope))) continue
        for (const a of aliasesOf(other, scope) ?? []) if (a !== t.alias) out.add(a)
      }
    }
  }
  return out
}

/**
 * A table placed after `prefix` (`best_access_path`): read by `lookup` or
 * whole, whichever costs less, with the rows it fetches for each prefix row
 * and the share of them the conditions keep.
 */
function placeTable(t: FromTable, lookup: EqRef | undefined, prefix: readonly Positioned[], conditions: readonly Weighed[], scope: TableScope, settings: LeafSettings, stats: TableStatistics | undefined, range?: RangeEstimate): Positioned {
  if (t.def === undefined || stats === undefined) return { alias: t.alias, fetched: 1, filter: 1, keyFrom: new Set(), lookup: lookup !== undefined, read: 0 }
  const def = t.def
  const read = settings.read.get(t.alias) ?? 'all'
  const before = new Set(prefix.map((p) => p.alias))
  // A range's estimate is the filter of the columns it was made on, unless the lookup's key is one of them; the rest are guessed (`calculate_condition_filter`).
  const ranged = new Set(range?.counts.keys() ?? [])
  const filter = (available: ReadonlySet<string>, key?: ColumnDef): number => {
    let f = 1
    for (const [column, n] of range?.counts ?? []) if (column !== key) f *= Math.min(1, Math.fround(n / stats.rows))
    const ignore = key === undefined ? ranged : new Set([...ranged, key])
    return conditions.reduce((g, c) => g * filterEffect(c.e, t, stats, available, scope, ignore), f)
  }
  const key: KeyChoice | undefined =
    lookup === undefined
      ? undefined
      : {
          kind: lookup.unique ? 'unique' : isClustered(def, lookup.index) ? 'clustered' : 'ref',
          fanout: lookup.unique ? 1 : stats.recordsPerKey(lookup.index, 1),
          covering: holdsRead(def, lookup.index, read),
          recordBytes: indexBytes(def, lookup.index) + indexBytes(def, clusteredIndex(def)),
          keyFrom: new Set([...(aliasesOf(lookup.condition, scope) ?? [])].filter((a) => a !== t.alias)),
        }
  const coveredByAnyIndex = def.indexes.some((i) => holdsRead(def, i, read))
  const constant = stats.rows < 1 ? 1 : floorFilter(filter(new Set()), stats.rows, stats.rows)
  const access = bestAccess({ stats, coveredByAnyIndex, constantFilter: constant }, prefix, key, rowBytes(prefix, settings))
  const kept = access.lookup
    ? access.fetched < 1
      ? 1
      : floorFilter(filter(before, lookup?.column), stats.rows, access.fetched)
    : Math.min(1, (stats.rows * floorFilter(filter(before), stats.rows, stats.rows)) / access.fetched)
  return { alias: t.alias, fetched: access.fetched, filter: kept, keyFrom: access.lookup ? (key?.keyFrom ?? new Set()) : new Set(), lookup: access.lookup, read: access.read }
}

const NO_COLUMNS: ReadonlySet<ColumnDef> = new Set()

/**
 * The fraction of a table's rows one condition keeps, given the tables
 * already read (`get_filtering_effect`, with no histograms): a condition
 * counts only where it compares a column of this table with what is known —
 * a constant, or a column of a table read before it. An equality keeps the
 * rows per value of an index the column leads, else a tenth; `<>` the rest;
 * a range a third; BETWEEN and LIKE a ninth; IN a tenth per value, at most a
 * half; IS NULL a tenth. Each is at least one row's worth. `ignore` holds
 * the columns the table's rows are already counted by — its lookup's key,
 * and the columns a range was estimated on.
 */
function filterEffect(e: Expression, t: FromTable, stats: TableStatistics, available: ReadonlySet<string>, scope: TableScope, ignore: ReadonlySet<ColumnDef> = NO_COLUMNS): number {
  const def = t.def as TableDef
  const atLeast = (f: number): number => Math.max(Math.fround(1 / stats.rows), f)
  const known = (x: Expression): boolean => {
    const a = aliasesOf(x, scope)
    return a !== undefined && [...a].every((alias) => available.has(alias))
  }
  const own = (x: Expression): ColumnDef | undefined => columnOf(t, x, scope)
  // A comparison counts where one side is this table's column, not the lookup's, and the other is known.
  const compared = (x: Expression, y: Expression): boolean => {
    const c = own(x)
    const other = own(y)
    return c !== undefined && !ignore.has(c) && (known(y) || (other !== undefined && ignore.has(other)))
  }
  const comparison = (x: Expression, y: Expression, f: number): number => (compared(x, y) || compared(y, x) ? atLeast(f) : 1)
  if (e.kind === NODE.UNARY) {
    if (e.op === 'NOT' || e.op === '!') {
      const f = filterEffect(e.operand, t, stats, available, scope, ignore)
      return f === 1 ? 1 : 1 - f
    }
    const c = own(e.operand)
    if (c === undefined || ignore.has(c)) return 1
    if (e.op === 'IS NULL') return atLeast(0.1)
    if (e.op === 'IS NOT NULL') return c.nullable ? 1 - atLeast(0.1) : 1
    return 1
  }
  if (e.kind !== NODE.BINARY) return 1
  switch (e.op.toUpperCase()) {
    case 'AND':
    case '&&':
      return filterEffect(e.left, t, stats, available, scope, ignore) * filterEffect(e.right, t, stats, available, scope, ignore)
    case 'OR':
    case '||': {
      const a = filterEffect(e.left, t, stats, available, scope, ignore)
      const b = filterEffect(e.right, t, stats, available, scope, ignore)
      return a + b - a * b
    }
    case '=': {
      // A multiple equality: each of this table's columns in it, by the first index it leads.
      const pair = compared(e.left, e.right) ? own(e.left) : compared(e.right, e.left) ? own(e.right) : undefined
      if (pair === undefined) return 1
      const index = keyOrder(def).find((i) => i.parts[0]?.column.toLowerCase() === pair.name.toLowerCase())
      return index === undefined ? atLeast(0.1) : Math.min(1, Math.fround(stats.recordsPerKey(index, 1) / stats.rows))
    }
    case '<=>':
      return comparison(e.left, e.right, 0.1)
    case '<>':
    case '!=': {
      const f = comparison(e.left, e.right, 0.1)
      return f === 1 ? 1 : 1 - f
    }
    case '<':
    case '<=':
    case '>':
    case '>=':
      return comparison(e.left, e.right, 1 / 3)
    case 'BETWEEN':
    case 'NOT BETWEEN': {
      const c = own(e.left)
      if (c === undefined || ignore.has(c) || !known(e.right) || (e.extra !== undefined && !known(e.extra as Expression))) return 1
      return e.op.toUpperCase() === 'BETWEEN' ? atLeast(1 / 9) : 1 - atLeast(1 / 9)
    }
    case 'LIKE':
      return comparison(e.left, e.right, 1 / 9)
    case 'NOT LIKE': {
      const f = comparison(e.left, e.right, 1 / 9)
      return f === 1 ? 1 : 1 - f
    }
    case 'IN':
    case 'NOT IN': {
      const c = own(e.left)
      if (c === undefined || ignore.has(c) || e.right.kind !== NODE.ROW || !known(e.right)) return 1
      const f = Math.min(e.right.items.length * atLeast(0.1), 0.5)
      return e.op.toUpperCase() === 'IN' ? f : 1 - f
    }
    default:
      return 1
  }
}

/**
 * What a join buffer holds for each row of the tables before a join
 * (`cache_record_length`): the columns the query reads of each, at their
 * stored width, and their NULL flags.
 */
function rowBytes(prefix: readonly Positioned[], settings: LeafSettings): number {
  let bytes = 0
  for (const { alias } of prefix) {
    const read = settings.read.get(alias) ?? 'all'
    const t = settings.tables?.get(alias)
    if (t?.def === undefined) {
      bytes += 8 * (read === 'all' ? (t?.width ?? 1) : read.size)
      continue
    }
    const columns = t.def.columns.filter((c) => read === 'all' || read.has(c.name.toLowerCase()))
    bytes += columns.reduce((n, c) => n + keyBytes(c) - (c.nullable ? 1 : 0), 0)
    if (columns.some((c) => c.nullable)) bytes += Math.ceil(t.def.columns.filter((c) => c.nullable).length / 8)
  }
  return bytes
}

/** A base or derived table, read by `leafAccess`, each row as wide as the whole FROM. */
function tableOp(t: FromTable, settings: LeafSettings): Op {
  return {
    *rows(run, context) {
      const fill = (values: readonly Value[]): Value[] => {
        const row = new Array<Value>(run.width).fill(null)
        for (let i = 0; i < t.width; i++) row[t.offset + i] = values[i] ?? null
        return row
      }
      if (t.derived !== undefined) {
        for (const values of t.derived.rows(run.trx, run.env, t.lateral ? context : undefined)) yield { row: fill(values) }
        return
      }
      for (const { id, row } of accessRows(t.table as Table, t.def as TableDef, leafAccess(t, settings, run.env), run.trx, run.locking)) {
        yield run.ids ? { row: fill(row), ids: idsAt(t.offset, id) } : { row: fill(row) }
      }
    },
    describe: (env) => describeLeaf(t, settings, env),
  }
}

/**
 * Conditions over an iterator's rows. EXPLAIN leaves out one the table's key
 * read already guarantees (`lookedUp`), which the row loop still checks
 * (D-65); and shows a [NOT] EXISTS the server runs as a semijoin as that join.
 */
function filterOp(input: Op, conditions: readonly Placed[], leaf?: FromTable, settings?: LeafSettings): Op {
  if (conditions.length === 0) return input
  return {
    *rows(run, context) {
      for (const r of input.rows(run, context)) if (holds(conditions, r.row, run.env)) yield r
    },
    describe(env) {
      const shown = leaf === undefined || settings === undefined ? conditions : conditions.filter((c) => !lookedUp(leaf, c.e, settings, env) && !pushedToIndex(leaf, c, settings, env))
      const below = input.describe(env)
      const semi = shown.length === 1 ? shown[0]?.semijoin : undefined
      if (semi !== undefined) return { ...semi, children: [below, ...semi.children] }
      return shown.length === 0 ? below : planNode('Filter', [below])
    },
  }
}

/** Two rows as one: the outer row with the inner side's slots filled in. */
function merge(outer: Row, inner: Row, slots: readonly number[]): Value[] {
  const out = outer.slice()
  for (const s of slots) out[s] = inner[s] ?? null
  return out
}

/**
 * A hash join (D-75). An inner join builds on the earlier side and probes
 * with the later one, each probe row's matches newest first; a left join
 * builds on the side it nulls and probes with the preserved one, each outer
 * row followed by its matches newest first or one row of NULLs. The key
 * narrows which build rows are tried and never which match: `on` is still
 * evaluated on every pair.
 */
function hashJoinOp(node: Node & { kind: 'join' }, outer: Op, inner: Op, on: readonly Placed[], keys: HashKeys | undefined): Op {
  return {
    *rows(run, context) {
      const env = run.env
      const [build, probe, buildKey, probeKey] = node.left ? [inner, outer, keys?.inner, keys?.outer] : [outer, inner, keys?.outer, keys?.inner]
      const built = [...build.rows(run, context)]
      const buckets = buildKey === undefined ? undefined : bucket(built, buildKey, env)
      for (const p of probe.rows(run, context)) {
        const candidates = buckets === undefined ? undefined : (buckets.get(keyOf(probeKey ?? [], p.row, env) ?? '') ?? NONE)
        let matched = false
        for (let n = (candidates ?? built).length - 1; n >= 0; n--) {
          const b = built[candidates === undefined ? n : (candidates[n] as number)] as JoinedRow
          const [o, i] = node.left ? [p, b] : [b, p]
          const combined = merge(o.row, i.row, node.innerSlots)
          if (!holds(on, combined, env)) continue
          matched = true
          yield joined(combined, joinIds(o, i))
        }
        if (node.left && !matched) yield p
      }
    },
    describe(env) {
      if (node.left) return planNode('Left hash join', [outer.describe(env), planNode('Hash', [inner.describe(env)])])
      // Probe with the later side, build on the earlier (D-75).
      return planNode('Inner hash join', [inner.describe(env), planNode('Hash', [outer.describe(env)])])
    },
  }
}

/**
 * A nested loop with an index lookup on the inner table (`refOf`), by the
 * outer row's value: each outer row, then its matches in the index's order —
 * the key's, then the clustered key's — or, under a left join, one row of
 * NULLs. `on` is every condition the pair must meet.
 */
function lookupOp(node: Node & { kind: 'join' }, outer: Op, t: FromTable, lookup: EqRef, on: readonly Placed[], settings: LeafSettings): Op {
  return {
    *rows(run, context) {
      const env = run.env
      for (const o of outer.rows(run, context)) {
        const v = lookup.value.eval(o.row, env)
        let matched = false
        if (v !== null) {
          // A value that does not convert exactly is a filtered scan, which finds the same rows (D-65).
          for (const { id, row: values } of accessRows(t.table as Table, t.def as TableDef, pointAccess(lookup.index, lookup.column, v) ?? FULL_SCAN, run.trx, run.locking)) {
            const combined = o.row.slice()
            for (let i = 0; i < t.width; i++) combined[t.offset + i] = values[i] ?? null
            if (!holds(on, combined, env)) continue
            matched = true
            yield joined(combined, run.ids ? joinIds(o, { row: values, ids: idsAt(t.offset, id) }) : undefined)
          }
        }
        if (node.left && !matched) yield o
      }
    },
    describe(env) {
      const covering = t.def !== undefined && holdsRead(t.def, lookup.index, settings.read.get(t.alias) ?? 'all')
      const lookupNode = planNode(`${lookup.unique ? 'Single-row ' : ''}${covering ? (lookup.unique ? 'covering index' : 'Covering index') : lookup.unique ? 'index' : 'Index'} lookup on ${t.alias} using ${lookup.index.name}`)
      // The lookup's own equality is the key read, not a filter.
      const rest = on.filter((c) => c.e !== lookup.condition)
      return planNode(node.left ? 'Nested loop left join' : 'Nested loop inner join', [outer.describe(env), rest.length === 0 ? lookupNode : planNode('Filter', [lookupNode])])
    },
  }
}

/**
 * A nested loop whose later table's range is planned again for each row
 * before it, the earlier tables' columns read from that row (`dynamicAccess`).
 * Every condition is still checked of every pair.
 */
function dynamicOp(node: Node & { kind: 'join' }, outer: Op, t: FromTable, on: readonly Placed[], settings: LeafSettings, known: (e: Expression) => Compiled | undefined): Op {
  const compiled = new Map<Expression, Compiled | undefined>()
  return {
    *rows(run, context) {
      const env = run.env
      const costing = rangeCosting(t, settings, env)
      const conjuncts = on.map((c) => c.e)
      for (const o of outer.rows(run, context)) {
        const value = (e: Expression): Value | undefined => {
          if (!compiled.has(e)) compiled.set(e, known(e))
          return compiled.get(e)?.eval(o.row, env)
        }
        const access = costing === undefined ? FULL_SCAN : dynamicAccess(t.def as TableDef, t.alias, conjuncts, env, costing, value)
        let matched = false
        for (const { id, row: values } of accessRows(t.table as Table, t.def as TableDef, access, run.trx, run.locking)) {
          const combined = o.row.slice()
          for (let i = 0; i < t.width; i++) combined[t.offset + i] = values[i] ?? null
          if (!holds(on, combined, env)) continue
          matched = true
          yield joined(combined, run.ids ? joinIds(o, { row: values, ids: idsAt(t.offset, id) }) : undefined)
        }
        if (node.left && !matched) yield o
      }
    },
    describe(env) {
      const read = planNode(`Index range scan on ${t.alias} (re-planned for each iteration)`)
      return planNode(node.left ? 'Nested loop left join' : 'Nested loop inner join', [outer.describe(env), on.length === 0 ? read : planNode('Filter', [read])])
    },
  }
}

/**
 * A nested loop into a materialized derived table by the index the server
 * builds on its join columns (`<auto_key0>`): the rows materialized once and
 * kept by key in the order they were made, each row before them looking up
 * its key's. Every condition is still checked of every pair.
 */
function autoKeyOp(node: Node & { kind: 'join' }, outer: Op, inner: Op, t: FromTable, keys: HashKeys, on: readonly Placed[]): Op {
  return {
    *rows(run, context) {
      const env = run.env
      const built = [...inner.rows(run, context)]
      const byKey = bucket(built, keys.inner, env)
      for (const o of outer.rows(run, context)) {
        const k = keyOf(keys.outer, o.row, env)
        let matched = false
        for (const i of k === undefined ? NONE : (byKey.get(k) ?? NONE)) {
          const r = built[i] as JoinedRow
          const combined = merge(o.row, r.row, node.innerSlots)
          if (!holds(on, combined, env)) continue
          matched = true
          yield joined(combined, run.ids ? joinIds(o, r) : undefined)
        }
        if (node.left && !matched) yield o
      }
    },
    describe(env) {
      const d = t.derived?.explain?.()
      const lookup = planNode(`Index lookup on ${t.alias} using <auto_key0>`, d === undefined || d.merged ? [] : [planNode(d.materialize, d.children)])
      const rest = on.filter((c) => !keys.conditions.includes(c))
      return planNode(node.left ? 'Nested loop left join' : 'Nested loop inner join', [outer.describe(env), rest.length === 0 ? lookup : planNode('Filter', [lookup])])
    },
  }
}

/** LATERAL: the tables after it again for each row of the tables before it, their materialized rows thrown away first. */
function lateralOp(node: Node & { kind: 'join' }, outer: Op, inner: Op, on: readonly Placed[]): Op {
  return {
    *rows(run, context) {
      for (const o of outer.rows(run, context)) {
        const row = context === undefined ? o.row : o.row.map((v, i) => v ?? context[i] ?? null)
        let matched = false
        for (const i of inner.rows(run, row)) {
          const combined = merge(row, i.row, node.innerSlots)
          if (!holds(on, combined, run.env)) continue
          matched = true
          yield joined(combined, joinIds(o, i))
        }
        if (node.left && !matched) yield joined(row, o.ids)
      }
    },
    describe(env) {
      const innerNode = inner.describe(env)
      return planNode(node.left ? 'Nested loop left join' : 'Nested loop inner join', [planNode('Invalidate materialized tables', [outer.describe(env)]), node.left || on.length === 0 ? innerNode : planNode('Filter', [innerNode])])
    },
  }
}

/** An equality with one side's tables on its left and the other's on its right. */
function isEquiJoin(c: Placed, outer: ReadonlySet<string>, inner: ReadonlySet<string>, scope: TableScope): boolean {
  const e = c.e
  if (e.kind !== NODE.BINARY || e.op !== '=') return false
  const l = aliasesOf(e.left, scope)
  const r = aliasesOf(e.right, scope)
  const on = (a: Set<string> | undefined, side: ReadonlySet<string>): boolean => a !== undefined && a.size > 0 && [...a].every((x) => side.has(x))
  return (on(l, outer) && on(r, inner)) || (on(l, inner) && on(r, outer))
}


/** A base or derived table's iterator, as EXPLAIN names it. */
function describeLeaf(t: FromTable, settings: LeafSettings, env: Env): PlanNode {
  if (t.def === undefined) {
    const d = t.derived?.explain?.()
    if (d === undefined) return planNode(`Table scan on ${t.alias}`, [planNode('Materialize')])
    return d.merged ? d.node : planNode(`Table scan on ${t.alias}`, [planNode(d.materialize, d.children)])
  }
  const access = leafAccess(t, settings, env)
  const order = settings.ordered
  if (order !== undefined && access.ranges === undefined) {
    // Read whole in an index's order: covering when it holds every column the query reads.
    const covers = settings.covering.get(t.alias) === order.index
    return planNode(`${covers ? 'Covering index' : 'Index'} scan on ${t.alias} using ${order.index}${order.reverse ? ' (reverse)' : ''}`)
  }
  if (access.index === undefined) return planNode(`Table scan on ${t.alias}`)
  if (access.ranges === undefined) return planNode(`Covering index scan on ${t.alias} using ${access.index}`)
  const index = t.def.indexes.find((i) => i.name === access.index)
  const points = access.ranges.every((r) => r.from !== undefined && r.from === r.to)
  // A secondary index that holds every column the query reads is read alone.
  const covering = settings.covering.get(t.alias) === access.index ? 'Covering index' : 'Index'
  if (points && access.ranges.length === 1 && index !== undefined && index.kind !== 'primary') return planNode(`${covering} lookup on ${t.alias} using ${access.index}`)
  return planNode(`${covering} range scan on ${t.alias} using ${access.index}${access.over === undefined ? '' : ` over ${access.over}`}`)
}

/**
 * Whether a condition is the equality a table's single-point lookup reads by:
 * the lookup returns exactly its rows, so EXPLAIN shows no Filter for it.
 */
function lookedUp(t: FromTable, e: Expression, settings: LeafSettings, env: Env): boolean {
  if (t.def === undefined || !((e.kind === NODE.BINARY && (e.op === '=' || e.op === '<=>')) || (e.kind === NODE.UNARY && e.op === 'IS NULL'))) return false
  const access = leafAccess(t, settings, env)
  if (access.ranges?.length !== 1 || access.ranges[0]?.from !== access.ranges[0]?.to) return false
  const index = t.def.indexes.find((i) => i.name === access.index)
  const column = index?.parts.length === 1 ? index.parts[0]?.column.toLowerCase() : undefined
  const names = (x: Expression): boolean => x.kind === NODE.COLUMN && (x.parts[x.parts.length - 1] as string).toLowerCase() === column && (x.parts.length < 2 || x.parts[x.parts.length - 2] === t.alias)
  return column !== undefined && (e.kind === NODE.UNARY ? names(e.operand) : e.kind === NODE.BINARY && (names(e.left) || names(e.right)))
}

/**
 * Whether InnoDB evaluates a condition inside the index read, where EXPLAIN
 * shows it on the read rather than as a Filter (index condition pushdown):
 * a read of a secondary index by a range or a lookup, not covering the
 * query, and a condition on nothing but that index's columns and the
 * clustered key it carries, with no subquery in it.
 */
function pushedToIndex(t: FromTable, c: Placed, settings: LeafSettings, env: Env): boolean {
  const def = t.def
  if (def === undefined || c.aliases === undefined || c.semijoin !== undefined || [...c.aliases].some((a) => a !== t.alias)) return false
  const access = leafAccess(t, settings, env)
  const index = def.indexes.find((i) => i.name === access.index)
  const clustered = clusteredIndex(def)
  if (access.ranges === undefined || index === undefined || index === clustered || settings.covering.get(t.alias) === index.name) return false
  const held = new Set([...index.parts, ...(clustered?.parts ?? [])].map((p) => p.column.toLowerCase()))
  let ok = true
  const visit = (x: unknown): void => {
    if (!ok || x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(visit)
    const n = x as Expression
    if (n.kind === NODE.SUBQUERY || n.kind === NODE.VARIABLE) ok = false
    else if (n.kind === NODE.COLUMN) {
      const column = columnOf(t, n, settings.scope as TableScope)
      if (column === undefined || !held.has(column.name.toLowerCase())) ok = false
    } else for (const v of Object.values(n)) if (typeof v === 'object') visit(v)
  }
  visit(c.e)
  return ok
}

// --- covering indexes -------------------------------------------------------------

/** The bytes a column takes in an index key, as `key_length` counts it: what makes one covering index cheaper than another. */
function keyBytes(c: ColumnDef): number {
  const t = c.type
  const widths: Record<number, number> = { [FIELD_TYPE.TINY]: 1, [FIELD_TYPE.SHORT]: 2, [FIELD_TYPE.INT24]: 3, [FIELD_TYPE.LONG]: 4, [FIELD_TYPE.LONGLONG]: 8, [FIELD_TYPE.FLOAT]: 4, [FIELD_TYPE.DOUBLE]: 8, [FIELD_TYPE.DATE]: 3, [FIELD_TYPE.YEAR]: 1 }
  const fixed = widths[t.type]
  if (fixed !== undefined) return fixed + (c.nullable ? 1 : 0)
  if (t.type === FIELD_TYPE.NEWDECIMAL || t.type === FIELD_TYPE.DECIMAL) return Math.ceil((t.precision ?? 10) / 2) + 1 + (c.nullable ? 1 : 0)
  if (t.type === FIELD_TYPE.DATETIME || t.type === FIELD_TYPE.TIMESTAMP) return 5 + Math.ceil((t.decimals ?? 0) / 2) + (c.nullable ? 1 : 0)
  const mb = t.collationId === undefined ? 1 : requireCollationInfo(t.collationId).mbmaxlen
  return (t.length ?? 1) * mb + 2 + (c.nullable ? 1 : 0)
}

/** The index a table's rows are stored in: its PRIMARY KEY, or the unique key InnoDB chose in its place; none for a hidden row id. */
const clusteredIndex = (def: TableDef): IndexDef | undefined => def.indexes.find((i) => i.kind === 'primary' || i.name === def.clustered)

const isClustered = (def: TableDef, index: IndexDef): boolean => index === clusteredIndex(def)

/** An index's key bytes (`key_length`); a hidden row id's 6. */
function indexBytes(def: TableDef, index: IndexDef | undefined): number {
  if (index === undefined) return 6
  return index.parts.reduce((n, p) => n + keyBytes(def.columns.find((c) => c.name === p.column) as ColumnDef), 0)
}

/** Whether an index holds every column in `read` (`covering_keys`): a secondary one with the clustered key it carries, or the clustered key itself when `read` is only its columns. */
function holdsRead(def: TableDef, index: IndexDef, read: ReadonlySet<string> | 'all'): boolean {
  if (index !== clusteredIndex(def)) return covers(def, index, read)
  return read !== 'all' && index.invisible !== true && [...read].every((c) => index.parts.some((p) => p.column.toLowerCase() === c))
}

/** Whether a secondary index, with the clustered key it carries, holds every column in `read`. */
function covers(def: TableDef, index: IndexDef, read: ReadonlySet<string> | 'all'): boolean {
  const clustered = clusteredIndex(def)
  if (read === 'all' || clustered === undefined || index === clustered || index.invisible === true || index.parts.some((p) => p.prefix !== undefined)) return false
  const holds = new Set([...index.parts, ...clustered.parts].map((p) => p.column.toLowerCase()))
  return [...read].every((c) => holds.has(c))
}

/**
 * The index a table read whole is read through (`find_shortest_key`): the
 * smallest secondary index that holds every column in `read`, by key bytes;
 * else the clustered index itself when `read` is only its columns, which
 * 8.4.11 shows as a covering index scan of PRIMARY.
 */
function coveringIndex(def: TableDef, read: ReadonlySet<string> | 'all'): string | undefined {
  let best: { name: string; bytes: number } | undefined
  for (const index of def.indexes) {
    if (!covers(def, index, read)) continue
    const bytes = index.parts.reduce((n, p) => n + keyBytes(def.columns.find((c) => c.name === p.column) as ColumnDef), 0)
    if (best === undefined || bytes < best.bytes) best = { name: index.name, bytes }
  }
  const clustered = clusteredIndex(def)
  if (best === undefined && read !== 'all' && clustered !== undefined && clustered.invisible !== true && [...read].every((c) => clustered.parts.some((p) => p.column.toLowerCase() === c))) return clustered.name
  return best?.name
}
