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
import { expectTyped } from '@myjs/bytes'
import type { ColumnDef, IndexDef, RowId, Table, TableDef, Trx } from '@myjs/engine'
import { NODE, REF, type Expression, type TableReference } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { truth, type Value } from '@myjs/types'
import type { Compiled, Env, Row, Scope } from './compile.ts'
import { planNode, type PlanNode } from './explain.ts'
import { FULL_SCAN, accessRows, chooseAccess, pointAccess, splitAnd, type Access, type OuterColumn } from './plan.ts'
import { rowKey } from './keys.ts'
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
  /**
   * The WHERE, given once its caller has compiled it where MySQL resolves it
   * (after the select list), conjunct by conjunct. Each is applied by the
   * iterator 8.4.11 places it at: a condition on one table at that table, an
   * equality between two sides by their join, and the rest above (M5.43).
   * The FROM's rows are then the WHERE's: no caller applies it again.
   */
  filter(where: Expression | undefined, compile: (e: Expression) => Compiled, semijoin?: (e: Expression) => PlanNode | undefined): void
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
        const outerLookup = isLeft && inner.node.kind === 'leaf' ? eqRef(inner.node.table, [onAst], outer.aliases, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(outer.aliases, within), preliminary))) : undefined
        if (outerLookup !== undefined) nestedLoopJoins.add(inner.aliases)
        const lookup = isLeft || inner.node.kind !== 'leaf' ? undefined : eqRef(inner.node.table, [onAst, ...(ref.type === 'STRAIGHT' || ref.type === 'INNER' ? [where] : [])], outer.aliases, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(outer.aliases, within), preliminary)))
        if (lookup !== undefined) nestedLoopJoins.add(inner.aliases)
        // A LATERAL table is read again for each row before it: a nested loop,
        // so a sort over the tables before it goes first (8.4.11: Drizzle's
        // `LEFT JOIN LATERAL … ORDER BY parent.id` keeps parent.id's key flags).
        if ([...inner.aliases].some((a) => byAlias.get(a)?.lateral === true)) nestedLoopJoins.add(inner.aliases)
        return {
          node: { kind: 'join', outer: outer.node, inner: inner.node, left: isLeft, on, onAst, innerSlots, lookup: lookup ?? outerLookup },
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
  const settings: LeafSettings = { covering, ...(outer === undefined ? {} : { outer }) }
  let physical: Op | undefined
  const physicalTree = (): Op | undefined => (physical ??= tree === undefined ? undefined : toOp(tree.node, [], scope, settings, ctx, preliminary))

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
    filter(where, compile, semijoin) {
      settings.where = where
      const conditions = splitAnd(where).map((e): Placed => {
        const compiled = compile(e)
        const semi = semijoin?.(e)
        return { e, aliases: aliasesOf(e, scope), compiled, ...(semi === undefined ? {} : { semijoin: semi }) }
      })
      physical = tree === undefined ? undefined : toOp(tree.node, conditions, scope, settings, ctx, preliminary)
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
  readonly outer?: OuterColumn
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
  const access = t.nullable ? FULL_SCAN : chooseAccess(t.def as TableDef, t.alias, settings.where, env, settings.outer)
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
  const flatten = (e: Expression | undefined): void => void splitAnd(e, conjuncts)
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
    } catch (e) {
      expectTyped(e)
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
  if (node.lookup !== undefined && node.inner.kind === 'leaf') {
    return filterOp(lookupOp(node, outer, node.inner.table, node.lookup, [...toInner, ...spanning]), above)
  }
  const inner = toOp(node.inner, toInner, scope, settings, ctx, preliminary)
  const both = new Set([...outerAliases, ...innerAliases])
  const keys = hashKeys(spanning, outerAliases, innerAliases, scope, (e) => ctx.compileOn(e, slotScope(preliminary.restrict(both), preliminary)))
  if (node.left) return filterOp(hashJoinOp(node, outer, inner, spanning, keys), above)
  // An inner join's equalities between its sides are its own condition, whether or not they key the hash
  // (only some can: `hashKeys`); any other condition on both sides is a Filter over it.
  const equalities = spanning.filter((c) => isEquiJoin(c, outerAliases, innerAliases, scope))
  return filterOp(hashJoinOp(node, outer, inner, equalities, keys), spanning.filter((c) => !equalities.includes(c)))
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
      const shown = leaf === undefined || settings === undefined ? conditions : conditions.filter((c) => !lookedUp(leaf, c.e, settings, env))
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
 * A nested loop with a single-row lookup on the inner table's unique key, by
 * the outer row's value. A left join emits one row of NULLs for an outer row
 * with no match: the order a hash join over the key gives, since a unique
 * key has one match at most. `on` is every condition the pair must meet.
 */
function lookupOp(node: Node & { kind: 'join' }, outer: Op, t: FromTable, lookup: EqRef, on: readonly Placed[]): Op {
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
      const lookupNode = planNode(`Single-row index lookup on ${t.alias} using ${lookup.index.name}`)
      // The lookup's own equality is the key read, not a filter.
      const rest = on.filter((c) => !isLookupEquality(c.e, t, lookup))
      return planNode(node.left ? 'Nested loop left join' : 'Nested loop inner join', [outer.describe(env), rest.length === 0 ? lookupNode : planNode('Filter', [lookupNode])])
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

/** Whether a condition is the equality a single-row lookup reads its key by. */
function isLookupEquality(e: Expression, t: FromTable, lookup: EqRef): boolean {
  if (e.kind !== NODE.BINARY || e.op !== '=') return false
  const names = (x: Expression): boolean => x.kind === NODE.COLUMN && (x.parts[x.parts.length - 1] as string).toLowerCase() === lookup.column.name.toLowerCase() && (x.parts.length < 2 || x.parts[x.parts.length - 2] === t.alias)
  return names(e.left) || names(e.right)
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
    const clustered = order.index === 'PRIMARY' || order.index === t.def.clustered
    const covers = !clustered && settings.covering.get(t.alias) === order.index
    return planNode(`${covers ? 'Covering index' : 'Index'} scan on ${t.alias} using ${order.index}${order.reverse ? ' (reverse)' : ''}`)
  }
  if (access.index === undefined) return planNode(`Table scan on ${t.alias}`)
  if (access.ranges === undefined) return planNode(`Covering index scan on ${t.alias} using ${access.index}`)
  const index = t.def.indexes.find((i) => i.name === access.index)
  const points = access.ranges.every((r) => r.from !== undefined && r.from === r.to)
  // A secondary index that holds every column the query reads is read alone.
  const covering = settings.covering.get(t.alias) === access.index ? 'Covering index' : 'Index'
  if (points && access.ranges.length === 1 && index !== undefined && index.kind !== 'primary') return planNode(`${covering} lookup on ${t.alias} using ${access.index}`)
  return planNode(`${covering} range scan on ${t.alias} using ${access.index}`)
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
