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
// the cost model chooses it unless `STRAIGHT_JOIN` asks for the order written. The
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
// D-89 permits omitting a FirstMatch integer bound only when its selected
// physical range and exact point equality already enforce it.
import { notSupported, proof, wrongUsage } from './errors.ts'
import { FIELD_TYPE } from '@myjs/bytes'
import { isNotEqual, REVERSE_COMPARISON, and, integerLiteral, isOrderedComparison, logicalShortCircuit, operandPairs, rewriteExpression, signedOperand, someNode, tableAlias } from './ast.ts'
import { requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, IndexDef, RowId, Table, TableDef, Trx } from '@myjs/engine'
import { LITERAL, NODE, QUERY, REF, type Expression, type IndexHint, type QueryExpression, type TableReference } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { integerBytes, truth, type ColumnType, type Value } from '@myjs/types'
import { compatibleEqualityKeys, type Compiled, type Env, type Row, type Scope } from './compile.ts'
import { coveringScan, filterPlan, indexLookup, lookupMaterialized, materialize, planNode, scanMaterialized, tableScan, wrap, type PlanNode } from './explain.ts'
import { FULL_SCAN, chooseAccess, constantValue, dynamicAccess, keyOrder, optimizerEnabled, pointAccess, rangeAccess, splitAnd, type Access, type InferredRange, type OuterColumn, type RangeCosting } from './plan.ts'
import { ROW_EVALUATE, bestAccess, floorFilter, indexScanCost, joinOrder, materializedAntijoinWins, membershipCost, type Candidate, type FirstMatch, type KeyChoice, type Positioned, type RangeRead } from './cost.ts'
import { rowKey, valueKey } from './keys.ts'
import { fulltextOf } from './fulltext.ts'
import { chooseStrategy } from './group.ts'
import { clusteredIndex, forwardKeyPart, indexPartMatchesColumn, indexParts, leadingIndex, singleRefIndex, uniquePoint } from './indexes.ts'
import { accessRows, distinct, sort as sortRows, type SortKey } from './operators.ts'
import { neverEqual, rejectsNullExtension } from './optimize.ts'
import { pruneImpossibleOr, fractionalIntBound } from './ranges.ts'
import type { TableStatistics } from './stats.ts'
import { equalSlots, unknownColumnError, safeIndex, safeResolve, TableScope, type ScopeColumn, type ScopeTableSpec } from './scope.ts'

/** A table the FROM reads: a base table, or (M5.1) a derived one. */
export interface FromTable extends ScopeTableSpec {
  readonly alias: string
  readonly def?: TableDef | undefined
  readonly table?: Table | undefined
  readonly indexHints?: readonly IndexHint[] | undefined
  /** A derived table's or a CTE's rows and columns, when it is not a base table. */
  readonly derived?: DerivedSource | undefined
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
  /** Noncorrelated constant input or a proved singleton materialization reader, read while planning. */
  readonly constant?: boolean
  /** Merged into the query that reads it (`derived_merge`), rather than materialized. */
  readonly merged?: boolean
  /** Its rows, as values in column order. `lateral` is the FROM's row so far, for LATERAL. */
  rows(trx: Trx | undefined, env: Env, lateral: Row | undefined, ready?: () => void): Iterable<readonly Value[]>
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
      readonly innerSlots: readonly number[]
      /** `eq_ref`: the later table's unique key, and the expression of the earlier tables it equals. */
      readonly lookup: EqRef | undefined
    }

function joinNode(outer: Node, inner: Node, innerSlots: readonly number[], lookup: EqRef | undefined, left = false, on: readonly Placed[] = NONE): Node {
  return { kind: 'join', outer, inner, innerSlots, lookup, left, on }
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
  readonly single?: { readonly alias: string; readonly def: TableDef; readonly table: Table } | undefined
  /** Legacy eligibility for the supported scopes of a single physical source. */
  readonly eligibleIndexes?: HintEligibility | undefined
  /** Eligible ordering keys after the covering scan has been selected. */
  orderingIndexes(scope: 'ORDER BY' | 'GROUP BY'): readonly IndexDef[] | undefined
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
  /** Supply grouping order on the first base table of an inner lookup join, by index or sort. */
  orderGroupsFirst(keys: readonly { readonly expr: Expression; readonly compiled: Compiled }[]): 'index' | 'sort' | undefined
  /** Sort the first table before its indexed joins expand or discard rows. */
  sortFirst(alias: string, keys: readonly SortKey[]): void
  /** Select a bounded integer semijoin; return whether its physical order is inner-first. */
  integerSemijoin(alias: string, index: IndexDef | undefined, key: Compiled, residual: Expression | undefined, materializationEligible: boolean, strategy?: 'filteredHash' | 'filteredMaterial' | 'weedout' | 'NOT IN' | 'BETWEEN' | 'OR' | 'parentRange', fanoutOff?: boolean): boolean | undefined
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
   * Preserve a condition attached by post-cost equality substitution.
   */
  filter(where: Expression | undefined, compile: (e: Expression) => Pick<Compiled, 'eval'>, semijoin?: (e: Expression) => PlanNode | undefined, preserve?: Expression): void
  /** The cost model's choice for a table joined after the preserved side. */
  usesLookup(alias: string): boolean
  /** Price a proved pure integer antijoin; undefined leaves unsupported profiles alone. */
  antijoinStrategy(alias: string): 'lookup' | 'materialized' | undefined
  /** Build integer membership once, preserving only unmatched outer rows. */
  hashAntijoin(key: Compiled, rows: (trx: Trx | undefined, env: Env) => Iterable<readonly Value[]>, describe: () => PlanNode): void
  /** The one table an ORDER BY or GROUP BY reads, and the rows a LIMIT keeps: what the join order pays a sort for (M5.7). Given before the plan is first asked for. */
  sortedBy(alias: string | undefined, limit: number): void
  /** SELECT DISTINCT, and the tables its select list reads: the last table in join order it does not read is joined for one match a row. */
  distinctReads(aliases: ReadonlySet<string>): void
  /** The const tables: those joined as constant rows (a STRAIGHT_JOIN's after its first non-const table), those read ahead and absent from the plan, and the tables an impossible ON NULL-complements (M5.48). Given before the plan is first asked for. */
  constants(rows: ReadonlySet<string>, readAhead: ReadonlySet<string>, nullTables?: ReadonlySet<string>, outerConstants?: ReadonlyMap<string, readonly Expression[]>): void
  /** Right primary-key access for a preserved LEFT JOIN whose text key needs conversion. */
  rounded?: { readonly condition: Expression; readonly access: Access; readonly constAccess: Access | undefined }
  /** Read the one base table whole in an index's order, for an ORDER BY or a grouping it gives; `force` drops a range on another index for it, and `reverse` reads it descending. */
  readInOrder(index: string, force: boolean, reverse: boolean, alias?: string): void
  /** The FROM as 8.4.11's iterators (M5.44): the tree `rows` runs, as EXPLAIN shows it. */
  explain(env: Env): PlanNode
  /** How the one base table of a single-table FROM is read: what `rows` and `explain` read it by. */
  access(env: Env, allowIndexUnion?: boolean): Access
  /** The rows of the FROM, the WHERE applied; `ids` asks for each base table's row id too. */
  rows(trx: Trx | undefined, env: Env, options: { readonly locking: boolean; readonly ids?: boolean; readonly ready?: (() => void) | undefined }): Iterable<JoinedRow>
}

export interface JoinCondition {
  readonly on: Expression | undefined
  readonly left: boolean
  /** The tables of the side an outer join may make NULL; empty for an inner join. */
  readonly innerAliases: ReadonlySet<string>
  /** Inside the nullable side of an enclosing outer join. */
  readonly nested: boolean
}

export interface HintAdmission {
  readonly query: QueryExpression
  readonly previous: string | undefined
  checked?: string
}

export interface FromContext {
  /** Open a base table: ER_NO_SUCH_TABLE, ER_NO_DB_ERROR. */
  open(ref: { readonly schema?: string; readonly name: string }, alias?: string): { readonly schema: string; readonly def: TableDef; readonly table: Table }
  /** Compile against the join's scope; `written` identifies binding over physical inputs. */
  compileOn(e: Expression, scope: Scope, written?: boolean): Compiled
  /** A base table's statistics, as the optimizer reads them (M5.45). */
  readonly statistics?: ((def: TableDef, table: Table) => TableStatistics) | undefined
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
  readonly parent?: Scope | undefined
}

function foldIndexName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

type HintEligibility = Partial<Record<NonNullable<IndexHint['for']>, readonly IndexDef[]>> & { readonly force?: IndexHint['for'] }

function hintApplies(hint: IndexHint, scope: IndexHint['for']): boolean {
  return hint.for === undefined || hint.for === scope
}

function indexHintEligibility(def: TableDef, alias: string, hints: readonly IndexHint[], env: Env | undefined, validate: boolean, scope: IndexHint['for']): HintEligibility | undefined {
  const keys = [...def.indexes, ...fulltextOf(def)].map((key) => ({ key, folded: foldIndexName(key.name) }))
  type HintKey = (typeof keys)[number]['key']
  type Mask = { readonly scope: NonNullable<IndexHint['for']>; used?: Set<HintKey>; readonly ignored: Set<HintKey> }
  // Ordering and grouping have their own eligibility, separate from the scan.
  const scopes = scope === undefined ? [] : scope === 'JOIN' ? [scope] : ['JOIN', scope] as const
  const visible = !keys.some(({ key }) => key.invisible)
  const force = hints.some((hint) => hint.type === 'FORCE')
  // Any FORCE scope affects the range cost, even when its name mask is inactive.
  const forceScope = visible && force && keys.length === def.indexes.length &&
    (scope !== 'ORDER BY' || hints.some((hint) => hint.type === 'FORCE' && hintApplies(hint, scope))) ? scope : undefined
  const masks = !visible || (force && forceScope === undefined) ? [] : scopes
    .filter((scope) => hints.some((hint) => hintApplies(hint, scope)))
    .map((scope): Mask => ({ scope, ignored: new Set() }))
  const enabled = forceScope !== undefined || masks.length > 0
  if (!enabled && !validate) return undefined
  // MySQL visits the parsed hint list in reverse, including names in one clause.
  for (const hint of hints.slice().reverse()) {
    const selected = masks.filter((mask) => hintApplies(hint, mask.scope)).map((mask) => {
      if (hint.type === 'IGNORE') return mask.ignored
      if (mask.used === undefined || hint.indexes.length === 0) mask.used = new Set()
      return mask.used
    })
    for (const name of hint.indexes.slice().reverse()) {
      const folded = foldIndexName(name)
      const prefixes = keys.filter((candidate) => candidate.folded.startsWith(folded))
      const key = (prefixes.length === 1 ? prefixes[0] : prefixes.find((candidate) => candidate.folded === folded))?.key
      if (validate && (key === undefined || (key.invisible && !optimizerEnabled(env, 'use_invisible_indexes')))) {
        throw sqlError('ER_KEY_DOES_NOT_EXITS', `Key '${name}' doesn't exist in table '${alias}'`)
      }
      if (key !== undefined) for (const set of selected) set.add(key)
    }
  }
  if (validate && force && hints.some((hint) => hint.type === 'USE')) throw wrongUsage('USE INDEX', 'FORCE INDEX')
  if (!enabled) return undefined
  const eligible: HintEligibility = { force: forceScope }
  for (const { scope, used, ignored } of masks) {
    eligible[scope] = def.indexes.filter((key) => (used === undefined || used.has(key)) && !ignored.has(key))
  }
  return eligible
}

/** The written FROM, as a plan: its scope, and how to read it. */
/** `straight` is SELECT STRAIGHT_JOIN: the tables joined in the order written. */
export function planFrom(refs: readonly TableReference[], ctx: FromContext, where?: Expression, straightJoin = false, hints?: HintAdmission, hintScope?: IndexHint['for'], joinSortUnion?: boolean): FromPlan {
  const whereParts = splitAnd(where)
  // First pass: the tables, in order, with whether an outer join can null them.
  interface Pending {
    alias: string
    def?: TableDef
    table?: Table
    indexHints?: readonly IndexHint[] | undefined
    derivedRef?: TableReference & { readonly kind: typeof REF.DERIVED }
    /** Tables before it that a LATERAL one may not see: a RIGHT JOIN's left side (8.4.11: 1054). */
    hidden?: ReadonlySet<string>
    cte?: DerivedSource
    /** A view's schema, which a qualified name may name it by. */
    schema?: string | undefined
    nullable: boolean
  }
  const pending: Pending[] = []
  const collect = (ref: TableReference, nullable: boolean, hidden = NO_ALIASES): void => {
    switch (ref.kind) {
      case REF.TABLE: {
        // A CTE hides base/system tables; only a missing base table falls back to a view.
        const alias = tableAlias(ref)
        const cte = ref.table.schema === undefined ? ctx.cte?.(ref.table.name) : undefined
        let source = cte === undefined ? ctx.system?.(ref.table, alias) : { source: cte, schema: undefined }
        if (source === undefined) {
          try {
            const opened = ctx.open(ref.table, alias)
            pending.push({ alias, def: opened.def, table: opened.table, indexHints: ref.indexHints, nullable })
            return
          } catch (e) {
            source = (e as { errno?: number }).errno === 1146 ? ctx.view?.(ref.table, alias) : undefined
            if (source === undefined) throw e
          }
        }
        pending.push({ alias, cte: source.source, schema: source.schema, nullable })
        return
      }
      case REF.DERIVED:
        if (ref.alias === undefined) throw sqlError('ER_DERIVED_MUST_HAVE_ALIAS', 'Every derived table must have its own alias')
        pending.push({ alias: ref.alias, derivedRef: ref, nullable, hidden })
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
  const tables: FromTable[] = []
  const byAlias = new Map<string, FromTable>()
  let offset = 0
  for (const p of pending) {
    if (byAlias.has(p.alias)) throw sqlError('ER_NONUNIQ_TABLE', messages.nonUniqueTable(p.alias))
    let derived: DerivedSource | undefined = p.cte
    if (p.derivedRef !== undefined) {
      if (ctx.derived === undefined) throw notSupported('Derived tables')
      const visible = tables.filter((sp) => p.hidden?.has(sp.alias) !== true)
      const before = visible.length > 0 ? new TableScope(visible, { parent: ctx.parent }) : ctx.parent
      derived = ctx.derived(p.derivedRef, p.derivedRef.lateral === true ? before : undefined)
    }
    const width = derived?.columns.length ?? p.def!.columns.length
    const table: FromTable = { alias: p.alias, def: p.def, table: p.table, indexHints: p.indexHints, columns: derived?.columns, schema: p.schema, derived, nullable: p.nullable, offset, width, lateral: p.derivedRef?.lateral === true }
    byAlias.set(p.alias, table)
    tables.push(table)
    offset += width
  }
  const width = offset

  // Open all direct sources and check aliases before hints, then bind ON and projections.
  let eligibleIndexes: HintEligibility | undefined
  if (hints && pending.some((p) => p.indexHints) && pending.every((p) => p.def) &&
      !someNode(hints.query, (node) => (node !== hints.query && (node as QueryExpression).kind === QUERY.QUERY) || undefined)) {
    const tableIds = pending.map((p) => p.def!.id).join(',')
    const validate = hints.previous !== tableIds
    if (validate || hintScope !== undefined) {
      for (const p of pending) {
        if (p.indexHints !== undefined) eligibleIndexes = indexHintEligibility(p.def!, p.alias, p.indexHints, ctx.env, validate, hintScope)
      }
    }
    hints.checked = tableIds
  }
  const joinIndexes = eligibleIndexes?.JOIN

  // Second pass: the joins — USING and NATURAL merge columns, which changes
  // what a bare name means and what `*` is; each ON is resolved in the scope
  // of its own two sides.
  const coalesced: number[][] = []
  const groupsWithin = (aliases: ReadonlySet<string>): number[][] => {
    const visible = [...aliases].map((alias) => byAlias.get(alias))
    return coalesced.filter((group) => group.every((index) => visible.some((table) => inTable(table, index))))
  }
  const preliminary = new TableScope(tables, { parent: ctx.parent })
  const columnName = (index: number): string => {
    const at = preliminary.columnAt(index)
    return at === undefined ? '' : at.column.name
  }
  let leafAt = 0
  let straight = straightJoin
  const joins: JoinCondition[] = []
  const nestedLoopJoins = new Set<ReadonlySet<string>>()
  const innerLayout = (aliases: Set<string>) => {
    const inputs = [...aliases].map((alias) => byAlias.get(alias)!)
    // A LATERAL loop keeps the order of the preceding input.
    const lateral = inputs.some((t) => t.lateral)
    if (lateral) nestedLoopJoins.add(aliases)
    return { innerSlots: inputs.flatMap(slotsOf), lateral }
  }
  let nesting = 0
  /** A subtree: its node, its aliases, and its visible columns as `*` lists them. */
  const build = (ref: TableReference): { node: Node; aliases: Set<string>; visible: number[] } => {
    switch (ref.kind) {
      case REF.TABLE:
      case REF.DERIVED: {
        const t = tables[leafAt++] as FromTable
        return { node: { kind: 'leaf', table: t }, aliases: new Set([t.alias]), visible: slotsOf(t) }
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
        const right = ref.type === 'RIGHT'
        const left = ref.type === 'LEFT'
        if (right) nesting++
        const l = build(ref.left)
        if (right) nesting--
        if (left) nesting++
        const r = build(ref.right)
        if (left) nesting--
        const aliases = new Set([...l.aliases, ...r.aliases])
        const outer = right ? r : l
        const inner = right ? l : r
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
            if (i === undefined) throw unknownColumnError(name, 'from clause')
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
          visible = [...merged, ...outer.visible.filter((i) => !used.has(i)), ...inner.visible.filter((i) => !used.has(i))]
        }
        // The ON sees this join's tables, and the merged columns within them.
        const within = groupsWithin(aliases)
        let onAst: Expression | undefined = ref.on
        // USING (c) is ON l.c = r.c; NATURAL the same over the shared names.
        if (names !== undefined && names.length > 0) {
          const eqs: Expression[] = groups.map((g) => ({ kind: NODE.BINARY, op: '=', left: slotRef(g[0]!), right: slotRef(g[1]!), at: ref.at }))
          onAst = eqs.reduce(and)
        }
        const onScope = slotScope(preliminary, aliases, within)
        const predicates = splitAnd(onAst)
        const physical = l.node.kind === 'leaf' && r.node.kind === 'leaf' && l.node.table.table !== undefined && r.node.table.table !== undefined
        const on = predicates.map((e) => ({ e, aliases: aliasesOf(e, preliminary), compiled: ctx.compileOn(e, onScope, physical) }))
        const { innerSlots, lateral } = innerLayout(inner.aliases)
        const isLeft = left || right
        joins.push({ on: onAst, left: isLeft, innerAliases: isLeft ? inner.aliases : NO_ALIASES, nested: nestedHere })
        // An outer join over a unique key is a nested loop too; its order is a
        // hash join's, but it lets a sort go first.
        // A join by an index on the later table, where one serves it: an outer join by its ON, an inner one by its WHERE too.
        const lookupPredicates = !isLeft && (ref.type === 'STRAIGHT' || ref.type === 'INNER') ? [...predicates, ...whereParts] : predicates
        const lookup = inner.node.kind !== 'leaf' || lateral ? undefined : refOf(inner.node.table, lookupPredicates, outer.aliases, preliminary, (e) => ctx.compileOn(e, slotScope(preliminary, outer.aliases, within)))
        return {
          node: joinNode(outer.node, inner.node, innerSlots, lookup, isLeft, on),
          aliases,
          visible,
        }
      }
    }
  }
  const crossJoin = (l: { node: Node; aliases: Set<string>; visible: number[] }, r: { node: Node; aliases: Set<string>; visible: number[] }) => {
    const { innerSlots, lateral } = innerLayout(r.aliases)
    const lookup = r.node.kind !== 'leaf' || lateral ? undefined : refOf(r.node.table, whereParts, l.aliases, preliminary, (e) => ctx.compileOn(e, preliminary.restrict(l.aliases)))
    return {
      node: joinNode(l.node, r.node, innerSlots, lookup),
      aliases: new Set([...l.aliases, ...r.aliases]),
      visible: [...l.visible, ...r.visible],
    }
  }
  const covering = new Map<string, string>()
  let tree: { node: Node; aliases: Set<string>; visible: number[] } | undefined
  for (const r of refs) {
    const next = build(r)
    tree = tree === undefined ? next : crossJoin(tree, next)
  }

  const scope = new TableScope(tables, { coalesced, visible: tree?.visible, parent: ctx.parent })
  if (tree !== undefined) tree.node = innerWherePossible(tree.node, whereParts, scope)
  // A column of an enclosing query, compiled once: a constant for each run of this one.
  const outerColumns = new Map<Expression, Compiled | undefined>()
  const outer: OuterColumn | undefined =
    ctx.parent === undefined
      ? undefined
      : (e) => {
          if (e.kind !== NODE.COLUMN) return undefined
          if (!outerColumns.has(e)) {
            const r = safeResolve(scope, e.parts, 'where clause')
            outerColumns.set(e, r?.depth === undefined ? undefined : compileProof(e, (e) => ctx.compileOn(e, scope)))
          }
          return outerColumns.get(e)
        }
  const only = tables.length === 1 ? tables[0] : undefined
  // Keep the physical table record as the source proof; both required fields are bound.
  const single = only?.def !== undefined && only.table !== undefined ? only as NonNullable<FromPlan['single']> : undefined

  // The physical tree: built once the WHERE is placed (`filter`), or without one.
  const settings: LeafSettings = { covering, read: new Map(), inferred: new Map(), chosen: new WeakMap(), scope, tables: byAlias, outer, where, eligibleIndexes, statistics: ctx.statistics, joinSortUnion, buffered: optimizerEnabled(ctx.env, 'block_nested_loop') }
  // The join order and each join's access: the cost model's, over the WHERE's conjuncts, once the columns read are known (M5.7).
  // The index lookup into `t` after the tables in `before`, by the WHERE or an ON.
  const lookupAfter = (t: FromTable, before: ReadonlySet<string>, conditions: readonly Expression[]): EqRef | undefined => {
    return refOf(t, conditions, before, preliminary, (e) => ctx.compileOn(e, slotScope(preliminary, before, groupsWithin(before))))
  }
  let planned: JoinPlan | undefined
  let sort: { readonly alias: string; readonly limit: number } | undefined
  const joinPlan = (materialization = false): JoinPlan | undefined => {
    if (tree === undefined) return undefined
    // A FROM of one table has no join to plan.
    if (tree.node.kind === 'leaf') planned ??= { node: tree.node, positions: NONE, lookups: NO_ALIASES, on: NONE, dynamic: NO_ALIASES }
    const env = ctx.env
    // Range predicates bind one qualified slot and retain fixed operands.
    const rangeOf = (t: FromTable, conditions: readonly Weighed[]): RangeEstimate | undefined =>
      env === undefined ? undefined : rangeEstimate(t, conditions, (e) => ctx.compileOn(e, preliminary), env, settings)
    planned ??= planJoins(tree.node, whereParts.map((e) => ({ e, aliases: aliasesOf(e, scope) })), settings, straight ? undefined : lookupAfter, rangeOf, sort, materialization, optimizerEnabled(env, 'duplicateweedout'))
    settings.lookups = planned.lookups
    settings.dynamic = planned.dynamic
    return planned
  }
  const physicalOf = (conditions: readonly Placed[]): Op | undefined => {
    const plan = joinPlan()
    const last = plan?.node.kind === 'join' && plan.node.inner.kind === 'leaf' ? plan.node.inner.table.alias : undefined
    settings.distinctLast = last !== undefined && settings.distinctSelect !== undefined && !settings.distinctSelect.has(last) ? last : undefined
    return plan === undefined ? undefined : toOp(plan.node, [...conditions, ...plan.on, ...notNullForLookups(plan)], settings, ctx, preliminary)
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
      const key = columnOf(node.inner.table, c.left, scope) !== undefined ? c.right : c.left
      const source = columnSource(key, settings)
      if (source === undefined || source.table === node.inner.table || source.table.nullable || !source.column.nullable) return
      const e = { kind: NODE.UNARY, op: 'IS NOT NULL', operand: key, at: c.at } as Expression
      out.push({ e, aliases: new Set([source.table.alias]), compiled: ctx.compileOn(e, slotScope(preliminary)) })
    }
    visit(plan.node)
    return out
  }
  let physical: Op | undefined
  let conditions: Placed[] = []
  // Compile filters eagerly, but construct iterators after access/order settings are final.
  const physicalTree = (): Op | undefined => (physical ??= physicalOf(conditions))

  return {
    scope,
    tables,
    width,
    joins,
    straight,
    eligibleIndexes,
    orderingIndexes(scope) {
      const indexes = eligibleIndexes?.[scope]
      if (indexes === undefined || single === undefined) return indexes
      const scanned = covering.get(single.alias)
      if (scanned === undefined || indexes.some((key) => key.name === scanned)) return indexes
      // Reconsidering an excluded covering scan can only choose another covering key.
      const read = readOf(settings, single.alias)
      return indexes.filter((key) => joinIndexes?.includes(key) !== false && holdsRead(single.def, key, read))
    },
    reads(columns) {
      settings.chosen = new WeakMap()
      for (const t of tables) {
        const read = columns.get(t.alias) ?? NO_ALIASES
        settings.read.set(t.alias, read)
        const best = t.def === undefined || t.nullable ? undefined : coveringIndex(t.def, read, joinIndexes)
        if (best !== undefined) covering.set(t.alias, best)
      }
    },
    sortsFirst(aliases) {
      const plan = joinPlan()
      if (plan === undefined) return false
      // Every join on the preserved spine must keep its outer input order.
      let node = plan.node
      while (node.kind === 'join') {
        if (node.inner.kind !== 'leaf' || !plan.lookups.has(node.inner.table.alias)) {
          const inner = leafAliases(node.inner)
          if (![...nestedLoopJoins].some((s) => s.size === inner.size && subsetOf(s, inner))) return false
        }
        node = node.outer
      }
      return node.table.derived?.joined !== true && [...aliases].every((a) => a === node.table.alias)
    },
    orderGroupsFirst(keys) {
      if (keys.length === 0 || keys.some((k) => k.expr.kind !== NODE.COLUMN || k.compiled.type.kind === 'json')) return undefined
      const plan = joinPlan()
      if (plan?.node.kind !== 'join') return undefined
      let node: Node = plan.node
      while (node.kind === 'join') {
        if (node.left || node.inner.kind !== 'leaf' || node.lookup === undefined || !plan.lookups.has(node.inner.table.alias) || plan.dynamic.has(node.inner.table.alias) || settings.constants?.has(node.inner.table.alias)) return undefined
        node = node.outer
      }
      const { table } = node
      if (table.def === undefined || table.derived?.joined === true || settings.constants?.has(table.alias) || settings.hidden?.has(table.alias)) return undefined
      const driver = new Set([table.alias])
      for (const key of keys) {
        const own = aliasesOf(key.expr, scope)
        if (own === undefined || !subsetOf(own, driver)) return undefined
      }
      const candidate = chooseStrategy(table.def, keys.map((k) => columnOf(table, k.expr, scope)?.name), false, true).index
      // A non-covering secondary scan competes with a scan and sort by cost; leave that choice open.
      const clustered = candidate !== undefined && clusteredIndex(table.def)?.name === candidate
      const index = clustered || settings.covering.get(table.alias) === candidate ? candidate : undefined
      if (index === undefined) this.sortFirst(table.alias, keys.map((k) => ({ expr: k.compiled, desc: false })))
      else this.readInOrder(index, true, false, table.alias)
      return index === undefined ? 'sort' : 'index'
    },
    sortFirst(alias, keys) {
      settings.firstSort = { alias, keys }
    },
    integerSemijoin(alias, index, key, residual, materializationEligible, strategy, fanoutOff) {
      // A noncovering residual can feed either a clustered lookup or a hash build.
      const filteredScan = !index && residual !== undefined
      const buffered = !index && !filteredScan
      const compoundScan = strategy === 'filteredMaterial'
      const legacy = fanoutOff && (settings.buffered || compoundScan)
      const canBuffer = settings.buffered && optimizerEnabled(ctx.env, 'condition_fanout_filter')
      if (buffered && !canBuffer) return undefined
      const firstMatch = { alias, enabled: optimizerEnabled(ctx.env, 'firstmatch'), filteredScan, fanoutFilter: !legacy }
      if (index && optimizerEnabled(ctx.env, 'loosescan')) settings.loose = { alias, index, key, competeRange: strategy === 'BETWEEN' }
      // A primary BETWEEN competes with materialization on its first search.
      if (strategy !== 'BETWEEN' && residual !== undefined && materializationEligible && index) {
        joinPlan()
        // The actual predicate stays in settings.where; only its bounded cost admission changes.
        if (settings.inferred.size > 0) {
          residual = undefined
          planned = undefined
        }
      }
      if (residual === undefined || filteredScan || strategy === 'BETWEEN') settings.firstMatch = firstMatch
      const materialization = materializationEligible && settings.firstMatch && optimizerEnabled(ctx.env, 'materialization')
      let plan = joinPlan(materialization)
      const probe = plan?.positions[1]
      const probesMember = probe?.alias === alias
      // Filtered materialization keeps the child predicate in its keyed build.
      if (legacy && probesMember && (probe.lookup || !firstMatch.enabled || plan?.dynamic.has(alias))) {
        if (compoundScan) {
          if (probe.lookup === 'materialized') {
            delete settings.firstMatch
            return false
          }
          // The actual point read proves the signed membership equality before its filter.
          if (!settings.buffered && probe.lookup === true && firstMatch.enabled && plan?.node.kind === 'join' && plan.node.lookup) return false
          return undefined
        }
        // Other unsupported outer-first lookups leave the previous weedout search available.
        firstMatch.fanoutFilter = true
        planned = undefined
        plan = joinPlan(materialization)
      }
      if (plan === undefined) return undefined
      const node = plan.node
      if (node.kind !== 'join' || node.left || node.outer.kind !== 'leaf' || node.inner.kind !== 'leaf') return undefined
      const outer = node.outer.table
      const inner = node.inner.table
      const materialized = settings.materialized
      const innerFirst = outer.alias === alias
      if (strategy === 'parentRange') {
        if (materialized || !firstMatch.enabled || !singleRefIndex(index) ||
          inner.alias !== alias || node.lookup?.index.name !== index.name || !plan.lookups.has(alias) || !ctx.env) return undefined
        const access = chosenAccess(outer, settings, ctx.env)
        if (access.index !== 'PRIMARY' || access.ranges?.length !== 1) return undefined
        delete settings.loose
        return false
      }
      const primary = node.lookup?.index.kind === 'primary' && node.lookup.unique
      if (filteredScan) {
        // A constant residual cannot request a range based on the probe.
        if (!innerFirst) {
          const hash = firstMatch.fanoutFilter ? strategy === 'filteredHash' && canBuffer : settings.buffered && probesMember
          if (!hash || !firstMatch.enabled || materialized || node.lookup) return undefined
          return false
        }
        if (!primary) return undefined
        // The fanout-off estimate can also select a materialized scan.
        if (materialized) {
          if (materialized !== 'scan' || strategy === 'weedout' && firstMatch.fanoutFilter) return undefined
          return true
        }
        if (compoundScan || !optimizerEnabled(ctx.env, 'duplicateweedout')) return undefined
        settings.weedout = inner
        delete settings.firstMatch
        return true
      }
      if (buffered && materialized) return undefined
      // Indexed LooseScan retains PRIMARY identity; weedout retains physical outer identity.
      const loose = !materialized && innerFirst && settings.loose && (node.lookup ? primary : settings.buffered)
      if (index && strategy) {
        if (!firstMatch.enabled) return undefined
        if (!loose || !plan.positions[0]?.loose) {
          // The selected temporary strategy keeps a primary range and its point probe.
          const access = strategy === 'BETWEEN' && settings.loose && innerFirst && primary && ctx.env && chosenAccess(outer, settings, ctx.env)
          if (!access || access.ranges?.length !== 1 || access.index !== 'PRIMARY' ||
            (materialized ? materialized !== 'scan' : !optimizerEnabled(ctx.env, 'duplicateweedout'))) return undefined
          delete settings.loose
          delete settings.firstMatch
          if (materialized) settings.rangeBuild = true
          else settings.weedout = inner
          return true
        }
        if (strategy === 'OR') {
          // Keep the chosen range on the ordered membership index when one wins.
          const access = ctx.env && chosenAccess(outer, settings, ctx.env)
          if (!primary || !singleRefIndex(index) || !access ||
            (access.ranges && (access.index !== index.name || access.ranges.length !== 1))) return undefined
        }
      }
      if (!loose) delete settings.loose
      if (!materialized && !loose && innerFirst && residual === undefined) settings.weedout = inner
      if (materialized || loose || settings.weedout) {
        delete settings.firstMatch
        if (index) this.readInOrder(index.name, true, false, alias)
        return materialized !== 'lookup'
      }
      if (inner.alias !== alias || (buffered ? !firstMatch.enabled : !plan.lookups.has(alias))) return undefined
      // Empty residual ranges retain their materialization boundary.
      if (residual !== undefined && ctx.env !== undefined && inner.table !== undefined && inner.def !== undefined) {
        const access = chooseAccess(inner.def, alias, residual, ctx.env, settings.outer, rangeCosting(inner, settings, ctx.env))
        if (access.ranges !== undefined && countRows(accessRows(inner.table, access, ctx.env.trx), 0) === 0) return undefined
      }
      if (firstMatch.enabled) settings.firstMatch = firstMatch
      else settings.distinctSelect = new Set([outer.alias])
      return false
    },
    single,
    filter(where, compile, semijoin, preserve) {
      settings.where = where
      settings.chosen = new WeakMap()
      // What is true of every row the server folds away (8.4.11: no Filter): `IS NOT NULL` of a NOT NULL column no outer join
      // can null, `<>` between such an integer column and a number it never equals, and an OR with either.
      const notNull = (e: Expression): ColumnDef | undefined => {
        const source = columnSource(e, settings)
        return source === undefined || source.table.nullable || source.column.nullable ? undefined : source.column
      }
      const alwaysTrue = (e: Expression): boolean => {
        if (e.kind === NODE.UNARY) return e.op === 'IS NOT NULL' && notNull(e.operand) !== undefined
        if (e.kind !== NODE.BINARY) return false
        if (logicalShortCircuit(e.op) === true) return alwaysTrue(e.left) || alwaysTrue(e.right)
        if (!isNotEqual(e.op)) return false
        const l = notNull(e.left)
        return l !== undefined ? neverEqual(l, e.right) : neverEqual(notNull(e.right), e.left)
      }
      conditions = []
      let allFolded = true
      for (const e of splitAnd(where)) {
        if (e === preserve || !alwaysTrue(e)) allFolded = false
        // Retain a direct NULL check on the side that was nullable before join conversion.
        else if (e.kind !== NODE.UNARY || scope.columnAt(localSlot(e.operand, scope) ?? -1)?.table.nullable !== true) continue
        const compiled = compile(e)
        const semi = semijoin?.(e)
        conditions.push({ e, aliases: aliasesOf(e, scope), compiled, semijoin: semi })
      }
      // Conditions that are already true of stored rows cannot drive range access.
      if (allFolded) settings.where = undefined
      physical = undefined
    },
    usesLookup(alias) {
      return joinPlan()?.lookups.has(alias) === true
    },
    antijoinStrategy(alias) {
      const plan = joinPlan()
      const firstMatch = optimizerEnabled(ctx.env, 'firstmatch')
      const materialization = optimizerEnabled(ctx.env, 'materialization')
      if (!plan?.lookups.has(alias)) return undefined
      const node = plan.node
      const [outer, probe] = plan.positions
      if (node.kind !== 'join' || !node.left || node.outer.kind !== 'leaf' || node.inner.kind !== 'leaf' || outer === undefined || probe === undefined) return undefined
      const table = node.inner.table
      const index = node.lookup?.index
      const stats = table.def === undefined || table.table === undefined ? undefined : ctx.statistics?.(table.def, table.table)
      if (stats === undefined || table.def === undefined || !singleRefIndex(index) || !holdsRead(table.def, index, readOf(settings, alias))) return undefined
      if (!materialization) return 'lookup'
      // A proved materialized candidate need not beat disabled weedout.
      if (!firstMatch && !optimizerEnabled(ctx.env, 'duplicateweedout')) return 'materialized'
      const built = placeTable(table, undefined, NONE, NONE, settings, stats)
      if (!firstMatch) return materializedAntijoinWins(outer, probe, built) ? 'materialized' : 'lookup'
      const rows = outer.fetched * outer.filter
      // Probe work does not multiply the preserved-side output cardinality.
      return membershipCost(built.read, built.fetched, rows)
        < probe.read + ROW_EVALUATE * rows * probe.fetched
        ? 'materialized' : 'lookup'
    },
    hashAntijoin(key, rows, describe) {
      const input = physicalTree()
      if (input !== undefined) physical = hashAntijoinOp(input, key, rows, describe)
    },
    distinctReads(aliases) {
      settings.distinctSelect = aliases
    },
    constants(rows, readAhead, nullTables, outerConstants) {
      settings.constants = rows
      settings.hidden = readAhead
      if (nullTables !== undefined) settings.nullTables = nullTables
      if (outerConstants !== undefined) settings.outerConstants = outerConstants
      settings.rounded = this.rounded
    },
    sortedBy(alias, limit) {
      sort = alias === undefined ? undefined : { alias, limit }
    },
    readInOrder(index, force, reverse, alias) {
      // An unhinted read can use any declared key that holds its columns.
      const indexes = only?.indexHints === undefined ? only?.def?.indexes : joinIndexes ?? eligibleIndexes?.[force ? 'GROUP BY' : 'ORDER BY']
      const covering = single && indexes?.some(
        (key) => key.name === index && holdsRead(single.def, key, readOf(settings, single.alias)),
      )
      settings.ordered = { index, force, reverse, alias, covering }
    },
    access(env, allowIndexUnion) {
      if (allowIndexUnion) settings.allowIndexUnion = true
      return leafAccess(tables[0] as FromTable, settings, env)
    },
    explain(env) {
      const op = physicalTree()
      return op === undefined || op.hidden === true ? planNode('Rows fetched before execution') : op.describe(env)
    },
    rows(trx, env, options) {
      const op = physicalTree()
      if (op === undefined) return [{ row: [] }]
      return op.rows({ ...options, trx, env, width })
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
function innerWherePossible(root: Node, where: readonly Expression[], scope: TableScope): Node {
  const slot = (e: Expression): number | undefined => localSlot(e, scope)
  const aliasOf = (i: number) => scope.columnAt(i)?.table.alias
  let pool: Expression[] = []
  const converted = new Set<Node>()
  const addOn = (on: readonly Placed[]): void => {
    for (const { e } of on) pool.push(e)
  }
  // The ONs that hold as a WHERE does: an inner join's, or a converted one's, outside any nullable side.
  const gather = (n: Node, nullable: boolean): void => {
    if (n.kind === 'leaf') return
    const inner = !n.left || converted.has(n)
    if (inner && !nullable) addOn(n.on)
    gather(n.outer, nullable)
    gather(n.inner, nullable || !inner)
  }
  const visit = (n: Node, nullable: boolean): boolean => {
    if (n.kind === 'leaf') return false
    let changed = visit(n.outer, nullable)
    if (n.left && !converted.has(n) && !nullable) {
      const inner = leafAliases(n.inner)
      if (rejectsNullExtension(pool, slot, (i) => inner.has(aliasOf(i) ?? ''), aliasOf)) {
        converted.add(n)
        addOn(n.on)
        changed = true
      }
    }
    return visit(n.inner, nullable || (n.left && !converted.has(n))) || changed
  }
  do {
    pool = where.slice()
    gather(root, false)
  } while (visit(root, false))
  if (converted.size === 0) return root
  // Rebuild converted joins and mark their leaves in the same ownership pass.
  const rebuilt = (n: Node, nullable: boolean): Node => {
    if (n.kind === 'leaf') {
      ;(n.table as { nullable: boolean }).nullable = nullable
      return n
    }
    const left = n.left && !converted.has(n)
    return { ...n, outer: rebuilt(n.outer, nullable), inner: rebuilt(n.inner, nullable || left), left }
  }
  return rebuilt(root, false)
}

/** The aliases of every table under a node. */
function leafAliases(n: Node, aliases = new Set<string>()): Set<string> {
  if (n.kind === 'leaf') aliases.add(n.table.alias)
  else {
    leafAliases(n.outer, aliases)
    leafAliases(n.inner, aliases)
  }
  return aliases
}

/** The logical slots owned by one table. */
const slotsOf = (t: FromTable): number[] => Array.from({ length: t.width }, (_, i) => t.offset + i)

const inTable = (t: FromTable | undefined, index: number): boolean => t !== undefined && index >= t.offset && index < t.offset + t.width

/** A reference to a slot, written as a column node the scope below resolves by position. */
const SLOT_PREFIX = '\u0000slot'
const slotRef = (index: number): Expression => ({ kind: NODE.COLUMN, parts: [`${SLOT_PREFIX}${index}`], at: 0 }) as Expression

/** Decode the compiler's synthetic slot reference in either planning scope. */
function syntheticSlot(parts: readonly string[]): number | undefined {
  const first = parts[0] as string
  return parts.length === 1 && first.startsWith(SLOT_PREFIX) ? Number(first.slice(SLOT_PREFIX.length)) : undefined
}

/** A scope that also answers the slot references USING's equalities are written with. */
function slotScope(full: TableScope, aliases?: ReadonlySet<string>, coalesced?: readonly (readonly number[])[]): Scope {
  const scope = aliases === undefined ? full : full.restrict(aliases, coalesced)
  return {
    resolve(parts, clause) {
      const index = syntheticSlot(parts)
      if (index !== undefined) {
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
  readonly ids?: readonly (RowId | undefined)[] | undefined
}

/** Two sides' ids as one row's. */
function joinIds(a: JoinedRow['ids'], b: JoinedRow['ids']): JoinedRow['ids'] {
  if (a === undefined) return b
  if (b === undefined) return a
  const out = a.slice()
  b.forEach((id, i) => {
    if (id !== undefined) out[i] = id
  })
  return out
}

const joined = (row: Row, ids?: readonly (RowId | undefined)[]): JoinedRow => ({ row, ids })

const hasLateral = (node: Node): boolean => (node.kind === 'leaf' ? node.table.lateral : hasLateral(node.outer) || hasLateral(node.inner))

/** Whether every alias or column in one proof belongs to the other set. */
function subsetOf(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (!b.has(value)) return false
  return true
}

const NONE: readonly never[] = []
const NO_ALIASES: ReadonlySet<string> = new Set()

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
  for (const placed of conditions) {
    const pair = equalitySides(placed.e, outer, inner, scope)
    if (pair === undefined) continue
    const a = compileProof(pair[0], compile)
    if (a === undefined) continue
    const b = compileProof(pair[1], compile)
    if (b === undefined) continue
    if (!compatibleEqualityKeys(a.type, b.type)) continue
    out.push(a)
    inn.push(b)
    used.push(placed)
  }
  return out.length === 0 ? undefined : { outer: out, inner: inn, conditions: used }
}

type Materialization = false | 'lookup' | 'scan' | 'loop'

/** How the FROM's base tables are read: what the WHERE is, what covers them, and an order asked for. */
interface LeafSettings {
  allowIndexUnion?: boolean
  readonly joinSortUnion?: boolean | undefined
  readonly eligibleIndexes?: HintEligibility | undefined
  where?: Expression | undefined
  /** Necessary access predicates inferred from the written WHERE or ON. */
  readonly inferred: Map<string, InferredRange>
  /** A STRAIGHT_JOIN's const tables past its first non-const one, joined as constant rows (`constants`). */
  constants?: ReadonlySet<string>
  /** The const tables read while planning, absent from the plan (`constants`). */
  hidden?: ReadonlySet<string>
  /** Outer joins' inner tables whose ON can never hold (`OptimizerFacts.nullTables`). */
  nullTables?: ReadonlySet<string>
  /** Outer joins' inner tables their ON holds by a key to constants, and those conditions (`OptimizerFacts.outerConstants`). */
  outerConstants?: ReadonlyMap<string, readonly Expression[]>
  rounded?: FromPlan['rounded']
  readonly covering: ReadonlyMap<string, string>
  /** The columns the query reads of each table (`reads`). */
  readonly read: Map<string, ReadonlySet<string> | 'all'>
  /** A base table's statistics, for the cost model (M5.7). */
  readonly statistics: ((def: TableDef, table: Table) => TableStatistics) | undefined
  /** The FROM's scope, which names a condition's columns. */
  readonly scope: TableScope
  /** The FROM's tables by alias, for the cost model. */
  readonly tables: ReadonlyMap<string, FromTable>
  /** The tables the cost model reads by their join's index lookup (`planJoins`). */
  lookups?: ReadonlySet<string>
  /** SELECT DISTINCT: the tables its select list reads (`distinctReads`). */
  distinctSelect?: ReadonlySet<string>
  /** The last table in join order, when the DISTINCT's select list does not read it: one match a row is enough. */
  distinctLast?: string | undefined
  /** The tables read by a range re-planned for each row before them (`planJoins`). */
  dynamic?: ReadonlySet<string>
  readonly outer: OuterColumn | undefined
  /** `chosenAccess`'s choices, by statement environment and table. */
  chosen: WeakMap<Env, Map<string, Access>>
  /** The one table read whole in this index's order (`readInOrder`). */
  /** Read in an index's order: the one table's, or `alias`'s in a join its const tables reduce to it. */
  ordered?: { readonly index: string; readonly force: boolean; readonly reverse: boolean; readonly alias: string | undefined; readonly covering: boolean | undefined }
  /** Order supplied before an indexed join expands or discards first-table rows. */
  firstSort?: { readonly alias: string; readonly keys: readonly SortKey[] }
  /** Materializing the primary range keeps the residual and NULL filters separate. */
  rangeBuild?: true
  /** LooseScan removes adjacent equal integer keys after the inner filter. */
  loose?: { readonly alias: string; readonly index: IndexDef; readonly key: Compiled; readonly competeRange?: boolean }
  /** Logical inner and FirstMatch availability for admitted semijoins; undefined keeps unmodeled residual costs. */
  firstMatch?: FirstMatch & { readonly fanoutFilter?: boolean }
  /** Whether scanned joins may buffer their inner side. */
  buffered: boolean
  /** Bounded lazy lookup, eager hash scan or eager nested loop. */
  materialized?: Materialization
  /** The physical outer table whose identities weedout retains across raw reads. */
  weedout?: FromTable
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
  const order = orderFor(t, settings)
  if (order && t.def) {
    const clustered = clusteredIndex(t.def)?.name === order.index
    const same = clustered ? access.index === undefined : access.index === order.index
    const whole = clustered ? FULL_SCAN : { index: order.index }
    if (access.ranges === undefined || (order.force && !same)) return order.reverse ? { ...whole, reverse: true } : whole
    return order.reverse && access.index === order.index ? { ...access, reverse: true } : access
  }
  const cover = settings.covering.get(t.alias)
  return access.index === undefined && access.ranges === undefined && cover !== undefined ? { index: cover } : access
}

/** The order asked of `t`'s reads, if any. */
function orderFor(t: FromTable, settings: LeafSettings): LeafSettings['ordered'] {
  const order = settings.ordered
  return (order?.alias ?? t.alias) === t.alias ? order : undefined
}

/** The access `chooseAccess` picks for a table under the WHERE, once per statement's environment: a range is weighed by counting its rows. */
function chosenAccess(t: FromTable, settings: LeafSettings, env: Env, quote = false): Access {
  if (t.nullable || t.def === undefined) return FULL_SCAN
  let chosen = settings.chosen.get(env)
  if (chosen === undefined) settings.chosen.set(env, (chosen = new Map()))
  let access = chosen.get(t.alias)
  if (access === undefined) chosen.set(t.alias, (access = chooseAccess(t.def, t.alias, settings.where, env, settings.outer, rangeCosting(t, settings, env, quote), settings.inferred.get(t.alias), settings.eligibleIndexes?.JOIN)))
  return access
}

/** What the range optimizer weighs a base table's ranges by: its statistics, what covers the query, and its rows counted in a range. */
function rangeCosting(t: FromTable, settings: LeafSettings, env: Env, quote = false): RangeCosting | undefined {
  const def = t.def
  const table = t.table
  if (def === undefined || table === undefined || settings.statistics === undefined) return undefined
  const read = readOf(settings, t.alias)
  const clustered = clusteredIndex(def)
  const cover = settings.covering.get(t.alias)
  // The shortest a clustered record can be: its header, InnoDB's trx id and roll pointer, and its fixed-width columns.
  let minRecordBytes = 5 + 13
  let nullable = 0
  for (const { type, nullable: allowsNull } of def.columns) {
    if (allowsNull) nullable++
    if (type.collationId === undefined) minRecordBytes += keyValueBytes(type)
  }
  minRecordBytes += Math.ceil(nullable / 8)
  const statistics = settings.statistics
  let stats: TableStatistics | undefined
  return {
    allowIndexUnion: settings.allowIndexUnion,
    hasIndexHints: t.indexHints !== undefined,
    // Read only when a range is weighed: on a table just written, statistics are recomputed.
    get stats() {
      return (stats ??= statistics(def, table))
    },
    quote,
    forceRange: settings.eligibleIndexes?.force === 'JOIN',
    shape: (i) => ({ clustered: i === clustered, covering: holdsRead(def, i, read), recordBytes: indexRecordBytes(def, i), minRecordBytes }),
    coveringScan: cover === undefined ? undefined : def.indexes.find((i) => i.name === cover),
    count(index, range, limit) {
      return countRows(table.indexScan(index, range, env.trx), limit)
    },
  }
}

/** Count until the limit is exceeded, closing the reader even on early return. */
function countRows(rows: Iterable<unknown>, limit: number): number {
  let count = 0
  for (const _ of rows) if (++count > limit) break
  return count
}

/**
 * An index lookup into the later table of a join, by an equality in the ON
 * or the WHERE between one of its indexed columns and an expression over the
 * earlier tables. Equality rejects NULL, so a complete single-column unique
 * key can supply `eq_ref` ("Single-row index lookup"). Other indexes the
 * column leads can supply `ref` ("Index lookup"). 8.4.11 joins by an index wherever one serves
 * the join, and by a hash only where none does. The lookup decides the join's
 * order; whether the value converts exactly (D-65) decides only whether it is
 * a key read or a filtered scan, never which rows match. Only `=`, since
 * `<=>` matches NULL, which a key lookup would not find; and only a top-level
 * conjunct, which every row the join returns must satisfy.
 */
function refOf(t: FromTable, conditions: readonly Expression[], outerAliases: ReadonlySet<string>, scope: TableScope, compileOuter: (e: Expression) => Compiled): EqRef | undefined {
  const def = t.def
  if (def === undefined || t.table === undefined) return undefined
  let best: EqRef | undefined
  for (const c of conditions) {
    if (c.kind !== NODE.BINARY || c.op !== '=') continue
    for (const [inner, outer] of operandPairs(c)) {
      const slot = localSlot(inner, scope)
      if (slot === undefined) continue
      const column = def.columns[slot - t.offset]
      if (column === undefined || !within(aliasesOf(outer, scope), outerAliases)) continue
      let index: IndexDef | undefined
      let single = false
      for (const candidate of def.indexes) {
        if (forwardKeyPart(candidate, true)?.column !== column.name) continue
        // Prefer a unique key, retaining declaration order within each class.
        if (uniquePoint(candidate, false)) {
          index = candidate
          single = true
          break
        }
        index ??= candidate
      }
      if (index === undefined || (best !== undefined && !single)) continue
      const value = compileProof(outer, compileOuter)
      if (value === undefined) continue
      // A key read needs the two sides to compare as the key's own type.
      const keyKind = scope.columnAt(slot)!.column.type.kind
      if (value.type.kind !== keyKind || (keyKind === 'string' && value.type.collationId !== column.type.collationId)) continue
      best = { index, column, value, unique: single, condition: c }
      if (single) return best
    }
  }
  return best
}

/** A local logical slot, including USING's synthetic references; correlations decline. */
function localSlot(e: Expression, scope: TableScope): number | undefined {
  if (e.kind !== NODE.COLUMN) return undefined
  return syntheticSlot(e.parts) ?? safeIndex(scope, e.parts, 'where clause')
}

/** A column of a base table an expression names: qualified by its alias, one of USING's slots, or a bare name the scope gives it. */
function columnOf(t: FromTable, e: Expression, scope: TableScope): ColumnDef | undefined {
  if (t.def === undefined) return undefined
  const index = localSlot(e, scope)
  return index === undefined ? undefined : t.def.columns[index - t.offset]
}

/** Resolve the slot once, then recover the base column that owns its stored type. */
function columnSource(e: Expression, { scope, tables }: LeafSettings) {
  const slot = localSlot(e, scope)
  if (slot === undefined) return undefined
  const bound = scope.columnAt(slot)?.table
  if (bound?.def === undefined) return undefined
  return { table: tables.get(bound.alias)!, column: bound.def.columns[slot - bound.offset]!, slot }
}

/** Speculative compilation may decline a typed SQL error, never an internal failure. */
function compileProof(e: Expression, compile: (e: Expression) => Compiled): Compiled | undefined {
  return proof(() => compile(e))
}

// --- the plan, as EXPLAIN shows it (M5.44) --------------------------------------

/** A condition placed at an iterator: its text, which decides where it goes, and its closure, which that iterator applies. */
interface Placed {
  readonly e: Expression
  /** The tables it reads; `undefined` when it reads more than a table's row (a subquery, an outer query's column). */
  readonly aliases: ReadonlySet<string> | undefined
  readonly compiled: Pick<Compiled, 'eval'>
  /** A [NOT] EXISTS the server runs as a semijoin: what EXPLAIN shows in place of its Filter. */
  readonly semijoin?: PlanNode | undefined
}

/** A direct test of a field that can be NULL only after extension. */
function testsNullExtension(e: Expression, table: FromTable, scope: TableScope): boolean {
  if (e.kind === NODE.UNARY && e.op === 'IS NULL') return columnOf(table, e.operand, scope)?.nullable === false
  if (e.kind !== NODE.BINARY || e.op !== '<=>') return false
  const [column, marker] = e.left.kind === NODE.LITERAL ? [e.right, e.left] : [e.left, e.right]
  return marker.kind === NODE.LITERAL && marker.type === LITERAL.NULL && columnOf(table, column, scope)?.nullable === false
}

/** The aliases of the FROM's tables an expression reads, or `undefined` if it reads anything else. */
function aliasesOf(e: Expression, scope: TableScope): Set<string> | undefined {
  const out = new Set<string>()
  const other = someNode(e, (node) => {
    const n = node as { kind?: string; parts?: readonly string[] }
    if (n.kind === NODE.LITERAL || n.kind === NODE.PLACEHOLDER) return false
    if (n.kind === NODE.SUBQUERY) return true
    if (n.kind === NODE.COLUMN && n.parts !== undefined) {
      const index = localSlot(n as Expression, scope)
      const at = index === undefined ? undefined : scope.columnAt(index)
      if (at === undefined) return true
      out.add(at.table.alias)
      return false
    }
    return undefined
  })
  return other ? undefined : out
}

/** A nonconstant expression reads only these aliases. */
const within = (own: ReadonlySet<string> | undefined, aliases: ReadonlySet<string>): boolean => own !== undefined && own.size > 0 && subsetOf(own, aliases)


// --- the iterators (M5.43) --------------------------------------------------------

/** One run of the FROM: the transaction, the statement's environment, and what each row carries. */
interface FromRun {
  readonly trx: Trx | undefined
  readonly env: Env
  readonly locking: boolean
  readonly ids?: boolean
  readonly width: number
  readonly ready?: (() => void) | undefined
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
  /** Read while planning, so absent from the plan: a const table (`hidden`), or a join of only such. */
  readonly hidden?: boolean
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
function toOp(node: Node, conditions: readonly Placed[], settings: LeafSettings, ctx: FromContext, preliminary: TableScope, held?: Access): Op {
  if (node.kind === 'leaf') {
    let op = filterOp(tableOp(node.table, settings, held), conditions, node.table, settings)
    const loose = settings.loose
    if (loose?.alias === node.table.alias) {
      const input = op
      op = {
        *rows(run, context) {
          let previous: bigint | undefined
          for (const row of input.rows(run, context)) {
            const key = loose.key.eval(row.row, run.env)
            if (key === null || key.kind !== 'int' || key.v === previous) continue
            previous = key.v
            yield row
          }
        },
        describe: (env) => planNode(`Remove duplicates from input sorted on ${loose.index.name}`, input.describe(env)),
      }
    }
    if (settings.firstSort?.alias === node.table.alias) {
      const input = op
      const keys = settings.firstSort.keys
      op = {
        rows: (run, context) => sortRows(input.rows(run, context), keys, run.env),
        describe: (env) => planNode('Sort', input.describe(env)),
      }
    }
    return settings.hidden?.has(node.table.alias) ? { ...op, hidden: true } : op
  }
  const { materialized, scope } = settings
  const innerTable = node.inner.kind === 'leaf' ? node.inner.table : undefined
  const outerAliases = leafAliases(node.outer)
  const innerAliases = leafAliases(node.inner)
  // An inner join's ON is its WHERE; an outer join's ON may go down only into the side it nulls.
  const toOuter: Placed[] = []
  const toInner: Placed[] = []
  const spanning: Placed[] = []
  const above: Placed[] = []
  for (const c of node.left ? conditions : [...conditions, ...node.on]) {
    if (within(c.aliases, outerAliases)) toOuter.push(c)
    else if (!node.left && within(c.aliases, innerAliases)) toInner.push(c)
    else (node.left ? above : spanning).push(c)
  }
  if (node.left) for (const c of node.on) (within(c.aliases, innerAliases) ? toInner : spanning).push(c)
  const outer = toOp(node.outer, toOuter, settings, ctx, preliminary)
  // An outer join whose ON can never hold, its inner tables NULL-complemented without a read (8.4.11).
  if (node.left && settings.nullTables && within(innerAliases, settings.nullTables)) return filterOp(outer, above)
  const keyHeld = node.left && innerTable ? settings.outerConstants?.get(innerTable.alias) : undefined
  if (keyHeld !== undefined && innerTable !== undefined) return filterOp(constantRowOp(outer, innerTable, node.innerSlots, toInner, spanning, settings, keyHeld), above)
  if (!node.left && (outer.hidden || innerTable && settings.hidden?.has(innerTable.alias))) {
    return constJoinOp(outer, toOp(node.inner, toInner, settings, ctx, preliminary), node.innerSlots, spanning)
  }
  if (hasLateral(node.inner)) {
    const inner = toOp(node.inner, toInner, settings, ctx, preliminary)
    return filterOp(nestedJoinOp(node, outer, inner, spanning), above)
  }
  if (innerTable && settings.dynamic?.has(innerTable.alias)) {
    const outerScope = slotScope(preliminary, outerAliases)
    const known = (e: Expression): Compiled | undefined => within(aliasesOf(e, scope), outerAliases) ? ctx.compileOn(e, outerScope) : undefined
    return filterOp(indexedJoinOp(node, outer, innerTable, undefined, [...toInner, ...spanning], settings, known), above)
  }
  if (!node.left && innerTable && settings.constants?.has(innerTable.alias)) return constantRowOp(outer, innerTable, node.innerSlots, toInner, spanning, settings)
  if (node.lookup !== undefined && innerTable !== undefined && settings.lookups?.has(innerTable.alias) !== false && materialized !== 'lookup') {
    return filterOp(weedoutOp(indexedJoinOp(node, outer, innerTable, node.lookup, [...toInner, ...spanning], settings), settings.weedout), above)
  }
  const repeated = settings.buffered === false && !materialized
  const access = node.left && settings.buffered && innerTable && ctx.env ? localOnRange(innerTable, toInner, settings, ctx.env) : undefined
  const inner = toOp(node.inner, repeated ? [...toInner, ...spanning] : toInner, settings, ctx, preliminary, access)
  if (repeated) return filterOp(weedoutOp(nestedJoinOp(node, outer, inner, []), settings.weedout), above)
  const joinScope = slotScope(preliminary, new Set([...outerAliases, ...innerAliases]))
  const keys = hashKeys(spanning, outerAliases, innerAliases, scope, (e) => ctx.compileOn(e, joinScope))
  // Automatic derived indexes and MaterializeLookup build on the inner side.
  const derived = innerTable?.derived
  const autoIndex = innerTable && keys && (materialized === 'lookup' ||
    (derived && !innerTable.lateral && derived.merged !== true && derived.constant !== true)) ? innerTable : undefined
  const semi = settings.firstMatch?.enabled && settings.firstMatch.alias === innerTable?.alias
  // A FirstMatch probe stops only after a pair passes its join conditions.
  const pairs = node.left || semi
  const on = pairs ? spanning : spanning.filter((c) => equalitySides(c.e, outerAliases, innerAliases, scope) !== undefined)
  const anti = node.left && !materialized && !autoIndex && innerTable !== undefined && node.outer.kind === 'leaf' &&
    above.length === 1 && testsNullExtension(above[0]!.e, innerTable, scope) && spanning.some(({ e }) => equalitySides(e, outerAliases, innerAliases, scope) !== undefined)
  return filterOp(buildJoinOp(semi ? 'semi' : anti ? 'anti' : node.left, node.innerSlots, outer, inner, on, keys, autoIndex, materialized, settings.weedout), pairs ? above : spanning.filter((c) => !on.includes(c)))
}

/** Quote an already placed right-side ON bound before the hash build. */
function localOnRange(table: FromTable, conditions: readonly Placed[], settings: LeafSettings, env: Env): Access | undefined {
  const { def, alias, indexHints } = table
  const index = def?.indexes[0]
  if (!def || def.indexes.length !== 1 || index?.kind !== 'primary' || index.parts.length !== 1) return undefined
  const hints = indexHints && indexHintEligibility(def, alias, indexHints, env, false, 'JOIN')
  if (hints?.JOIN?.length === 0) return undefined
  for (const { e } of conditions) {
    if (e.kind !== NODE.BINARY || (e.op !== 'IN' && e.op !== 'NOT IN') || e.right.kind !== NODE.ROW || e.right.items.length !== 2) continue
    const column = columnOf(table, e.left, settings.scope)
    if (column?.type.type !== FIELD_TYPE.LONG) continue
    let predicate = e
    if (e.op === 'NOT IN') {
      const [first, second] = e.right.items
      if (column.type.unsigned || !integerLiteral(first) || second?.kind !== NODE.LITERAL || !fractionalIntBound(constantValue(second, env))) continue
      // A signed integer key cannot equal the fraction. Keep the written ON filter.
      predicate = { ...e, op: '<>', right: first }
    } else if (!e.right.items.every((item) => integerLiteral(signedOperand(item)))) continue
    const costing = rangeCosting(table, settings, env)
    const range = costing && rangeAccess(def, alias, [predicate], env, costing)
    if (range?.ranges?.length === 2) return range
  }
  return undefined
}

// --- the cost model's choices (M5.7) -----------------------------------------------

/** An already split conjunct: its text and the tables it reads. */
type Weighed = Pick<Placed, 'e' | 'aliases'>

/** The joins as they run: in the order chosen, each later table read by its lookup or hashed, and the ON conditions a reordered tree applies above its joins. */
interface JoinPlan {
  readonly node: Node
  readonly positions: readonly Positioned[]
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
function planJoins(root: Node, where: readonly Weighed[], settings: LeafSettings, lookupAfter: ((t: FromTable, before: ReadonlySet<string>, onAsts: readonly Expression[]) => EqRef | undefined) | undefined, rangeOf: (t: FromTable, conditions: readonly Weighed[]) => RangeEstimate | undefined, sort: { readonly alias: string; readonly limit: number } | undefined, materialization: boolean, weedout: boolean): JoinPlan {
  const { scope } = settings
  const conditions = [...where]
  const on: Placed[] = []
  const leaves: FromTable[] = []
  let reorderable = true
  let hasLookup = false
  const gather = (node: Node, nullable: boolean): void => {
    if (node.kind === 'leaf') { leaves.push(node.table); return }
    if (node.left) reorderable = false
    hasLookup ||= node.lookup !== undefined
    on.push(...node.on)
    if (!node.left && !nullable) conditions.push(...node.on)
    gather(node.outer, nullable)
    gather(node.inner, nullable || node.left)
  }
  gather(root, false)
  const lookupConditions = [...where, ...on].map((c) => c.e)
  const statsOf = (t: FromTable): TableStatistics | undefined => (t.def !== undefined && t.table !== undefined ? settings.statistics?.(t.def, t.table) : undefined)
  if (lookupAfter !== undefined && reorderable && leaves.length > 1 && leaves.every((t) => !t.lateral && statsOf(t) !== undefined)) {
    const candidates: Candidate[] = leaves.map((t) => {
      const range = rangeOf(t, conditions)
      const stats = statsOf(t) as TableStatistics
      return {
        alias: t.alias,
        found: range?.rows ?? stats.rows,
        rows: stats.rows,
        range: range?.range !== undefined,
        keyDependent: keySources(t, conditions, scope),
        place: (prefix) => placeTable(t, lookupAfter(t, new Set(prefix.map((p) => p.alias)), lookupConditions), prefix, conditions, settings, stats, range),
      }
    })
    const driver = leaves.find((t) => t.alias === settings.loose?.alias)
    const index = settings.loose?.index
    const stats = driver === undefined ? undefined : statsOf(driver)
    const loose = driver?.def === undefined || index === undefined || stats === undefined ? undefined : {
      alias: driver.alias,
      rows: stats.rows,
      read: indexScanCost(stats.rows, indexRecordBytes(driver.def, index)),
      fetched: stats.rows / stats.recordsPerKey(index, 1),
      competeRange: settings.loose?.competeRange,
    }
    const order = joinOrder(candidates, sort, loose, settings.firstMatch, materialization, weedout)
    settings.materialized = false
    if (order[0]?.lookup === 'materialized-scan') settings.materialized = settings.buffered === false ? 'loop' : 'scan'
    else if (order[1]?.lookup === 'materialized') settings.materialized = 'lookup'
    const first = (order[0] as Positioned).alias
    let node: Node = { kind: 'leaf', table: settings.tables.get(first) as FromTable }
    const before = new Set([first])
    for (const p of order.slice(1)) {
      const t = settings.tables.get(p.alias) as FromTable
      const lookup = p.lookup ? lookupAfter(t, before, lookupConditions) : undefined
      node = joinNode(node, { kind: 'leaf', table: t }, slotsOf(t), lookup)
      before.add(p.alias)
    }
    const plan = finish(node, order, on)
    const probe = order[1]
    // Inner hash joins build on the first table and probe the second.
    if (settings.joinSortUnion && settings.buffered && !settings.firstMatch && leaves.length === 2 &&
      where.length === 0 && conditions.length === 1 && probe?.lookup === false &&
      leaves.every((t) => t.def?.engine === 'native' && !t.indexHints) &&
      candidates.some((c) => c.alias === first && c.rows === 1)) {
      const condition = joinUnionCondition(conditions[0]!.e, settings)
      if (condition !== undefined) settings.inferred.set(probe.alias, { condition })
    }
    return plan
  }
  if (!hasLookup) return finish(root, NONE, [])
  const positions: Positioned[] = []
  const visit = (node: Node, lookup?: EqRef): void => {
    if (node.kind === 'join') {
      visit(node.outer)
      visit(node.inner, node.lookup)
      return
    }
    positions.push(placeTable(node.table, lookup, positions, conditions, settings, statsOf(node.table), rangeOf(node.table, conditions)))
  }
  visit(root)
  return finish(root, positions, [])

  // "Range checked for each record": a later table read whole, with no range of its own on constants, whose indexed
  // column a condition compares by `<`, `>` or BETWEEN with the tables before it — not by `=`, whose key was already
  // weighed as a lookup (`checked_keys`). The server re-plans its range for each row before it, and joins it by a
  // nested loop, never a buffer (8.4.11).
  function finish(node: Node, positions: readonly Positioned[], on: readonly Placed[]): JoinPlan {
    const lookups = new Set(positions.filter((p) => p.lookup).map((p) => p.alias))
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
        if (rangeOf(inner.table, own) === undefined && comparesWithEarlier(inner.table, own, before, scope)) dynamic.add(inner.table.alias)
      }
      walk(inner)
    }
    walk(node)
    return { node, positions, lookups, on, dynamic }
  }
}

/** Project one necessary local range from each arm, preserving the written OR order. */
function joinUnionCondition(e: Expression, settings: LeafSettings): Expression | undefined {
  if (e.kind !== NODE.BINARY || !logicalShortCircuit(e.op)) return undefined
  for (const [arm, other] of operandPairs(e)) {
    if (arm.kind !== NODE.BINARY || logicalShortCircuit(arm.op) !== false) continue
    for (const [equality, comparison] of operandPairs(arm)) {
      if (equality.kind !== NODE.BINARY || equality.op !== '=') continue
      const a = columnSource(equality.left, settings)
      const b = columnSource(equality.right, settings)
      if (a?.column.type.type === FIELD_TYPE.LONG && b?.column.type.type === FIELD_TYPE.LONG && a.table !== b.table) {
        return { ...e, left: arm === e.left ? comparison : other, right: arm === e.left ? other : comparison }
      }
    }
  }
}

/** Whether an existing conjunct can look up an ordered bound from earlier tables. */
function comparesWithEarlier(t: FromTable, predicates: readonly Weighed[], before: ReadonlySet<string>, scope: TableScope): boolean {
  const leads = (x: Expression): boolean => leadingIndex(t.def, columnOf(t, x, scope), true) !== undefined
  const earlier = (x: Expression | undefined): boolean => within(x === undefined ? undefined : aliasesOf(x, scope), before)
  return predicates.some(({ e }) => {
    if (e.kind !== NODE.BINARY) return false
    if (isOrderedComparison(e.op)) return (leads(e.left) && earlier(e.right)) || (leads(e.right) && earlier(e.left))
    return e.op === 'BETWEEN' && leads(e.left) && (earlier(e.right) || earlier(e.extra as Expression))
  })
}

/** What the range optimizer estimates of a table (`found_records`, `quick_rows`): its rows under the conditions on each column an index leads, and the least of them. */
interface RangeEstimate {
  readonly range?: RangeRead | undefined
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
function rangeEstimate(t: FromTable, conditions: readonly Weighed[], compile: (e: Expression) => Compiled, env: Env, settings: LeafSettings): RangeEstimate | undefined {
  settings.inferred.delete(t.alias)
  const def = t.def
  if (def === undefined || t.table === undefined || t.nullable) return undefined
  const scope = settings.scope
  const resolve = (e: Expression) => columnSource(e, settings)
  // The multiple equalities: classes of columns joined by `=`.
  const classes = equalSlots()
  for (const { e } of conditions) {
    if (e.kind !== NODE.BINARY || e.op !== '=') continue
    const l = resolve(e.left)
    const r = resolve(e.right)
    if (l === undefined || r === undefined || l.table === r.table) continue
    classes.union(l.slot, r.slot)
  }
  const isNullOfNotNull = (e: Expression): boolean => e.kind === NODE.UNARY && e.op === 'IS NULL' && resolve(e.operand)?.column.nullable === false
  const per = new Map<ColumnDef, Expression>()
  let inferred: InferredRange | undefined
  const constant = (x: Expression | undefined): boolean => x !== undefined && !someNode(x, (node) => {
    const { kind } = node as Expression
    return kind === NODE.COLUMN || kind === NODE.SUBQUERY || kind === NODE.PLACEHOLDER || kind === NODE.VARIABLE || undefined
  })
  for (const { e: raw } of conditions) {
    const e = pruneImpossibleOr(raw, isNullOfNotNull)
    let first: ReturnType<typeof resolve>
    const subject = (x: Expression): boolean => {
      const resolved = resolve(x)
      if (resolved === undefined) return false
      first ??= resolved
      return resolved.slot === first.slot
    }
    // Bind the same source slot throughout the range before rewriting it for this table.
    const sargable = (x: Expression): boolean => {
      if (x.kind === NODE.UNARY) return (x.op === 'IS NULL' || x.op === 'IS NOT NULL') && subject(x.operand)
      if (x.kind !== NODE.BINARY) return false
      const { op, left, right } = x
      if (logicalShortCircuit(op) !== undefined) return sargable(left) && sargable(right)
      if (Object.hasOwn(REVERSE_COMPARISON, op)) return (subject(left) && constant(right)) || (subject(right) && constant(left))
      if (!subject(left)) return false
      switch (op) {
        case 'BETWEEN':
        case 'NOT BETWEEN':
          return constant(right) && constant(x.extra as Expression)
        case 'IN':
        case 'NOT IN':
          return right.kind === NODE.ROW && constant(right)
        case 'LIKE':
          return right.kind === NODE.LITERAL && typeof right.value === 'string' && !/^[%_]/.test(right.value) && x.extra === undefined
        default:
          return false
      }
    }
    if (!sargable(e) || first === undefined) continue
    const { slot: sourceSlot, column: source, table } = first
    const own = table.alias === t.alias
    const root = classes.root(sourceSlot)
    const size = classes.size(root)
    const target = own ? source : size > 1 ? def.columns.find((_, i) => classes.root(t.offset + i) === root) : undefined
    if (target === undefined || leadingIndex(def, target, true) === undefined) continue
    const column: Expression = { kind: NODE.COLUMN, parts: [t.alias, target.name], at: e.at }
    const range = rewriteExpression(e, (node) => {
      // Keep each original bound for the statement's conversion warning cache.
      if (node.kind === NODE.UNARY) return { ...node, operand: column }
      if (node.kind !== NODE.BINARY || logicalShortCircuit(node.op) !== undefined) return undefined
      return node.left.kind === NODE.COLUMN ? { ...node, left: column } : { ...node, right: column }
    })
    per.set(target, and(per.get(target), range))
    // columnOf resolves base tables only. A direct, non-nullable integer equality preserves this literal bound.
    const type = target.type
    const sourceType = source.type
    if (!own && settings.tables.size === 2 && !table.nullable && size === 2 && (type.type === FIELD_TYPE.LONG || type.type === FIELD_TYPE.LONGLONG) && sourceType.type === type.type && sourceType.unsigned === type.unsigned && e.kind === NODE.BINARY && e.op === '>' && integerLiteral(e.right)) {
      inferred = inferred === undefined ? { condition: range, column: target, from: source, predicate: e } : { condition: and(inferred.condition, range) }
    }
  }
  const compiled: [column: ColumnDef, condition: Compiled, rows: number][] = []
  for (const [column, e] of per) {
    const c = compileProof(e, compile)
    if (c !== undefined) compiled.push([column, c, 0])
  }
  if (compiled.length === 0) return undefined
  if (inferred !== undefined) settings.inferred.set(t.alias, inferred)
  const row = new Array<Value>(scope.width).fill(null)
  for (const { row: values } of accessRows(t.table, FULL_SCAN)) {
    fillTable(t, values, row)
    for (const c of compiled) if (truth(c[1].eval(row, env)) === true) c[2]++
  }
  const counts = new Map(compiled.map(([column, , rows]) => [column, Math.max(1, rows)]))
  const access = chosenAccess(t, settings, env, true)
  const range = access.ranges?.length === 1 ? access.quote : undefined
  return { rows: Math.min(...counts.values()), counts, range }
}

/** The tables an index lookup into `t` could take its key from: the other side of an equality with a column an index leads (`key_dependent`). */
function keySources(t: FromTable, conditions: readonly Weighed[], scope: TableScope): Set<string> {
  const out = new Set<string>()
  // planJoins owns top-level conjunct splitting for WHERE and ON.
  for (const { e } of conditions) {
    if (e.kind !== NODE.BINARY || e.op !== '=') continue
    for (const [own, other] of operandPairs(e)) {
      if (leadingIndex(t.def, columnOf(t, own, scope), false) === undefined) continue
      for (const a of aliasesOf(other, scope) ?? []) if (a !== t.alias) out.add(a)
    }
  }
  return out
}

/**
 * A table placed after `prefix` (`best_access_path`): read by `lookup` or
 * whole, whichever costs less, with the rows it fetches for each prefix row
 * and the share of them the conditions keep.
 */
function placeTable(t: FromTable, lookup: EqRef | undefined, prefix: readonly Positioned[], conditions: readonly Weighed[], settings: LeafSettings, stats: TableStatistics | undefined, range?: RangeEstimate): Positioned {
  if (t.def === undefined || stats === undefined) return { alias: t.alias, fetched: 1, filter: 1, keyFrom: NO_ALIASES, lookup: lookup !== undefined, read: 0 }
  const def = t.def
  const { scope } = settings
  const read = readOf(settings, t.alias)
  const before = new Set(prefix.map((p) => p.alias))
  // A range's estimate is the filter of the columns it was made on, unless the lookup's key is one of them; the rest are guessed (`calculate_condition_filter`).
  const ranged = new Set(range?.counts.keys() ?? [])
  const filter = (available: ReadonlySet<string>, key?: ColumnDef): number => {
    let f = 1
    for (const [column, n] of range?.counts ?? []) if (column !== key) f *= Math.min(1, Math.fround(n / stats.rows))
    const ignore = key === undefined ? ranged : new Set([...ranged, key])
    const effect = filterEffect(t, stats, available, scope, ignore, settings.firstMatch?.filteredScan)
    return conditions.reduce((g, c) => g * effect(c.e), f)
  }
  const key: KeyChoice | undefined =
    lookup === undefined
      ? undefined
      : {
          index: lookup.index.name,
          kind: lookup.unique ? 'unique' : lookup.index === clusteredIndex(def) ? 'clustered' : 'ref',
          fanout: lookup.unique ? 1 : stats.recordsPerKey(lookup.index, 1),
          covering: holdsRead(def, lookup.index, read),
          recordBytes: indexRecordBytes(def, lookup.index),
          keyFrom: new Set([...(aliasesOf(lookup.condition, scope) ?? [])].filter((a) => a !== t.alias)),
        }
  const coveredByAnyIndex = def.indexes.some((i) => holdsRead(def, i, read))
  const fanout = settings.firstMatch?.fanoutFilter !== false
  // Without the fanout filter, MySQL estimates a scan keeps 75% if a preceding ref condition exists.
  const constant = !fanout ? (key === undefined ? 1 : 0.75) : stats.rows < 1 ? 1 : floorFilter(filter(NO_ALIASES), stats.rows, stats.rows)
  const access = bestAccess({ stats, coveredByAnyIndex, constantFilter: constant, range: range?.range }, prefix, key, rowBytes(prefix, settings), settings.buffered)
  const kept = !fanout ? 1 : access.lookup
    ? access.fetched < 1
      ? 1
      : floorFilter(filter(before, lookup?.column), stats.rows, access.fetched)
    : Math.min(1, (stats.rows * floorFilter(filter(before), stats.rows, stats.rows)) / access.fetched)
  return { alias: t.alias, fetched: access.fetched, filter: kept, keyFrom: access.lookup && key !== undefined ? key.keyFrom : NO_ALIASES, lookup: access.lookup, read: access.read }
}


/** An unmodeled filter stays unmodeled under negation. */
const negateFilter = (fraction: number): number => fraction === 1 ? 1 : 1 - fraction

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
function filterEffect(t: FromTable, stats: TableStatistics, available: ReadonlySet<string>, scope: TableScope, ignore: ReadonlySet<ColumnDef>, filteredScan?: boolean): (e: Expression) => number {
  const minimum = Math.fround(1 / stats.rows)
  const atLeast = (f: number): number => Math.max(minimum, f)
  const known = (x: Expression): boolean => {
    const a = aliasesOf(x, scope)
    return a !== undefined && subsetOf(a, available)
  }
  const own = (x: Expression): ColumnDef | undefined => {
    const c = columnOf(t, x, scope)
    return c !== undefined && !ignore.has(c) ? c : undefined
  }
  // A comparison counts where one side is this table's column, not the lookup's, and the other is known.
  const compared = (x: Expression, y: Expression): ColumnDef | undefined => {
    const c = own(x)
    if (c === undefined) return undefined
    const other = columnOf(t, y, scope)
    return known(y) || (other !== undefined && ignore.has(other)) ? c : undefined
  }
  return function effect(e: Expression): number {
    if (e.kind === NODE.UNARY) {
      if (e.op === 'NOT' || e.op === '!') {
        return negateFilter(effect(e.operand))
      }
      const c = own(e.operand)
      if (c === undefined) return 1
      if (e.op === 'IS NULL') return atLeast(0.1)
      if (e.op === 'IS NOT NULL') return c.nullable ? 1 - atLeast(0.1) : 1
      return 1
    }
    if (e.kind !== NODE.BINARY) return 1
    const { op } = e
    const logical = logicalShortCircuit(op)
    if (logical !== undefined) {
      const left = effect(e.left)
      const right = effect(e.right)
      return logical ? left + right - left * right : left * right
    }
    switch (op) {
      case 'BETWEEN':
      case 'NOT BETWEEN': {
        if (own(e.left) === undefined || !known(e.right) || (e.extra !== undefined && !known(e.extra as Expression))) return 1
        return op === 'BETWEEN' ? atLeast(1 / 9) : 1 - atLeast(1 / 9)
      }
      case 'IN':
      case 'NOT IN': {
        if (own(e.left) === undefined || e.right.kind !== NODE.ROW || !known(e.right)) return 1
        const f = Math.min(e.right.items.length * atLeast(0.1), 0.5)
        return op === 'IN' ? f : 1 - f
      }
    }
    const like = op === 'LIKE' || op === 'NOT LIKE'
    if (!like && !Object.hasOwn(REVERSE_COMPARISON, op)) return 1
    const pair = compared(e.left, e.right) ?? compared(e.right, e.left)
    if (pair === undefined) return 1
    if (op === '=') {
      // A multiple equality: each of this table's columns in it, by the first index it leads.
      const index = keyOrder(t.def!).find((i) => i.parts[0]?.column.toLowerCase() === pair.name.toLowerCase())
      if (index !== undefined) return Math.min(1, Math.fround(stats.recordsPerKey(index, 1) / stats.rows))
    }
    let estimate = 0.1
    if (like) estimate = filteredScan ? Math.fround(0.1111) : 1 / 9
    else if (isOrderedComparison(op)) estimate = filteredScan ? Math.fround(0.3333) : 1 / 3
    const kept = atLeast(estimate)
    return isNotEqual(op) || op === 'NOT LIKE' ? negateFilter(kept) : kept
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
    const read = readOf(settings, alias)
    const t = settings.tables.get(alias)
    if (t?.def === undefined) {
      bytes += 8 * (read === 'all' ? (t?.width ?? 1) : read.size)
      continue
    }
    const columns = t.def.columns.filter((c) => read === 'all' || read.has(c.name.toLowerCase()))
    for (const column of columns) bytes += keyValueBytes(column.type)
    if (columns.some((c) => c.nullable)) bytes += Math.ceil(t.def.columns.filter((c) => c.nullable).length / 8)
  }
  return bytes
}

/** Fill a table's local values without changing other tables. */
function fillTable(t: FromTable, values: readonly Value[], row: Value[]): Value[] {
  for (let i = 0; i < t.width; i++) row[t.offset + i] = values[i] ?? null
  return row
}

/** A base or derived table, read by `leafAccess`, each row as wide as the whole FROM. */
function tableOp(t: FromTable, settings: LeafSettings, held?: Access): Op {
  return {
    *rows(run, context) {
      if (t.derived !== undefined) {
        for (const values of t.derived.rows(run.trx, run.env, t.lateral ? context : undefined, run.ready)) yield joined(fillTable(t, values, context?.slice() ?? new Array<Value>(run.width).fill(null)))
        return
      }
      yield* scanTable(t, held ?? leafAccess(t, settings, run.env), run, context)
    },
    describe(env) {
      if (t.def === undefined) {
        const d = t.derived?.explain?.()
        if (d?.merged) return d.node
        return tableScan(t.alias, planNode(d?.materialize ?? 'Materialize', d?.children))
      }
      const access = held ?? leafAccess(t, settings, env)
      const order = orderFor(t, settings)
      if (order !== undefined && access.ranges === undefined) {
        // Read whole in an index's order: covering when it holds every column the query reads.
        const covers = order.covering || settings.covering.get(t.alias) === order.index
        return planNode(`${covers ? 'Covering index' : 'Index'} scan on ${t.alias} using ${order.index}${order.reverse ? ' (reverse)' : ''}`)
      }
      if (access.index === undefined) return tableScan(t.alias)
      if (access.ranges === undefined) return coveringScan(t.alias, access.index)
      const index = t.def.indexes.find((i) => i.name === access.index)
      const points = access.ranges.every((r) => r.from !== undefined && r.from === r.to)
      // A secondary index that holds every column the query reads is read alone.
      const covering = settings.covering.get(t.alias) === access.index
      if (points && access.ranges.length === 1 && index !== undefined && index.kind !== 'primary') return indexLookup(t.alias, access.index, false, covering)
      const range = (read: Access, covers?: boolean) =>
        planNode(`${covers ? 'Covering index' : 'Index'} range scan on ${t.alias} using ${read.index}${read.over === undefined ? '' : ` over ${read.over}`}`)
      const merge = access.indexUnion
      if (!merge) return range(access, covering)
      const { ordered } = merge
      const clustered = range(access)
      const primary = ordered ? clustered : planNode('Clustered primary key (scanned separately)', [clustered])
      const secondary = range(merge)
      return planNode(ordered ? 'Deduplicate rows sorted by row ID' : 'Sort-deduplicate by row ID', merge.primaryFirst ? [primary, secondary] : [secondary, primary])
    },
  }
}

/** A base reader projects storage values and identities into one logical row frame. */
function* scanTable(t: FromTable, access: Access | undefined, run: FromRun, context?: Row, ids?: JoinedRow['ids']): Generator<JoinedRow> {
  if (access === undefined) return
  for (const { id, row } of accessRows(t.table as Table, access, run.trx, run.locking, run.ready)) {
    const result = { row: fillTable(t, row, context?.slice() ?? new Array<Value>(run.width).fill(null)), ids: run.ids ? ids?.slice() ?? [] : undefined }
    if (result.ids !== undefined) result.ids[t.offset] = id
    yield result
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
      const shown = leaf === undefined || settings === undefined ? conditions : scanFilters(leaf, conditions, settings, env)
      const below = input.describe(env)
      const semi = shown.length === 1 ? shown[0]?.semijoin : undefined
      if (semi !== undefined) return { ...semi, children: [below, ...semi.children] }
      // MySQL places the inferred non-NULL test above the residual build filter.
      const firstMatch = settings?.firstMatch
      return filterPlan(shown.length === 2 && (settings?.rangeBuild || (firstMatch?.filteredScan && firstMatch.alias === leaf?.alias)), filterPlan(shown.length > 0, below))
    },
  }
}

function hashJoinPlan(name: string, probe: PlanNode, build: PlanNode): PlanNode {
  return planNode(name, [probe, planNode('Hash', build)])
}

/** An antijoin builds the filtered inner keys and probes in the outer iterator's order. */
function hashAntijoinOp(input: Op, key: Compiled, rows: (trx: Trx | undefined, env: Env) => Iterable<readonly Value[]>, describe: () => PlanNode): Op {
  return {
    *rows(run, context) {
      const keys = new Set<string>()
      for (const [value] of rows(run.trx, run.env)) if (value != null) keys.add(valueKey(value))
      for (const outer of input.rows(run, context)) {
        const value = key.eval(outer.row, run.env)
        if (value === null || !keys.has(valueKey(value))) yield outer
      }
    },
    describe: (env) => hashJoinPlan('Hash antijoin', input.describe(env), describe()),
  }
}

/**
 * Candidate pairs share ON evaluation and preserve an unmatched outer identity.
 * Reverse maps physical build/probe order to logical slots. Weedout consumes
 * every candidate, but emits only the first match for this one outer identity.
 * An antijoin emits only the NULL-extended row and retains ON evaluation.
 */
function* matchingRows(outer: JoinedRow, inner: Iterable<JoinedRow>, slots: readonly number[], on: readonly Placed[], env: Env, left: boolean | 'anti' | 'semi', reverse = false, weedout = false): Iterable<JoinedRow> {
  let matched = false
  for (const candidate of inner) {
    const o = reverse ? candidate : outer
    const i = reverse ? outer : candidate
    const row = o.row.slice()
    for (const slot of slots) row[slot] = i.row[slot] ?? null
    if (!holds(on, row, env)) continue
    if (left === 'semi') { yield outer; return }
    if (left !== 'anti' && (!weedout || !matched)) yield joined(row, joinIds(o.ids, i.ids))
    matched = true
  }
  if (left && left !== 'semi' && !matched) yield outer
}

/** The ordinary nested-loop topology shared by constant, dynamic and derived reads. */
function nestedLoop(left: boolean, outer: PlanNode, inner: PlanNode, semi = false): PlanNode {
  return planNode(`Nested loop ${semi ? 'semijoin' : left ? 'left join' : 'inner join'}`, [outer, inner])
}

/**
 * One complete build, then candidate probes, with every pair checked by ON.
 * Hash joins build on the earlier side (or the nullable side of a left join)
 * and visit matches newest first. Automatic indexes build on the inner side
 * and visit matches oldest first. MaterializeLookup defers its build until a
 * non-NULL outer key. MaterializeScan builds eagerly and skips an empty probe.
 */
function buildJoinOp(left: boolean | 'anti' | 'semi', slots: readonly number[], outer: Op, inner: Op, on: readonly Placed[], keys: HashKeys | undefined, index?: FromTable, materialized: Materialization = false, weedout?: FromTable): Op {
  const deduplicate = weedout !== undefined
  const indexed = index !== undefined
  const buildOuter = !indexed && !left
  const build = buildOuter ? outer : inner
  const probe = buildOuter ? inner : outer
  const buildKey = buildOuter ? keys?.outer : keys?.inner
  const probeKey = buildOuter ? keys?.inner : keys?.outer
  return {
    *rows(run, context) {
      const env = run.env
      const read = () => {
        const rows = [...build.rows(run, context)]
        if (buildKey === undefined) return indexed ? rows : rows.reverse()
        const built = new Map<string, JoinedRow[]>()
        for (const row of rows) {
          const key = keyOf(buildKey, row.row, env)
          if (key === undefined) continue
          const group = built.get(key)
          if (group === undefined) built.set(key, [row])
          else if (!materialized) group.push(row)
        }
        // Owned hash buckets visit newest first; indexes keep insertion order.
        if (!indexed) for (const group of built.values()) group.reverse()
        return built
      }
      let built = materialized === 'lookup' ? undefined : read()
      if ((materialized || deduplicate || left === 'semi') && built instanceof Map && built.size === 0) return
      // Buffered probes run once; each materialized loop key owns an outer scan.
      const groups = materialized === 'loop' && built instanceof Map ? built.values() : [undefined]
      for (const group of groups) for (const p of probe.rows(run, context)) {
        const key = probeKey === undefined ? undefined : keyOf(probeKey, p.row, env)
        if (key !== undefined) built ??= read()
        const candidates = group ?? (built instanceof Map ? built.get(key ?? '') ?? NONE : built ?? NONE)
        yield* matchingRows(p, candidates, slots, on, env, left, buildOuter, deduplicate)
      }
    },
    describe(env) {
      const built = materialized ? materialize(filterPlan(buildKey?.[0]?.type.nullable === true, build.describe(env))) : undefined
      if (materialized === 'lookup') return nestedLoop(false, outer.describe(env), lookupMaterialized(built!))
      if (!indexed) {
        const input = built === undefined ? build.describe(env) : scanMaterialized(built)
        if (materialized === 'loop') return nestedLoop(false, input, filterPlan(on.length > 0, probe.describe(env)))
        const name = typeof left === 'string' ? `Hash ${left}join` : left ? 'Left hash join' : 'Inner hash join'
        return wrap(deduplicate, `Remove duplicate ${weedout?.alias} rows using temporary table`, hashJoinPlan(name, probe.describe(env), input))
      }
      const d = index.derived?.explain?.()
      const lookup = indexLookup(index.alias, '<auto_key0>', false, false, d === undefined || d.merged ? undefined : planNode(d.materialize, d.children))
      const rest = on.filter((c) => !keys?.conditions.includes(c))
      return nestedLoop(left === true, outer.describe(env), filterPlan(rest.length > 0, lookup))
    },
  }
}

/** Point and per-row range reads share pair checking, identities and scan closure. */
function indexedJoinOp(node: Node & { kind: 'join' }, outer: Op, t: FromTable, lookup: EqRef | undefined, on: readonly Placed[], settings: LeafSettings, known?: (e: Expression) => Compiled | undefined): Op {
  const compiled = new Map<Expression, Compiled | undefined>()
  const point = lookup !== undefined && !node.left
  const materialized = point && settings.materialized
  const semi = point && settings.firstMatch?.enabled && settings.firstMatch.alias === t.alias
  // DISTINCT's unused final table and FirstMatch both stop after one qualifying point-read match.
  const firstOnly = point && settings.weedout === undefined && (semi || settings.distinctLast === t.alias)
  // The range reader's own constraints, carried through exact integer
  // equality, can subsume an inner bound. Cost quotes alone cannot.
  const driver = semi && node.outer.kind === 'leaf' ? node.outer.table : undefined
  // In refOf's restricted slot scope, DEFAULT and correlations decline.
  // Field provenance needs both the alias and name, including self-joins.
  const key = lookup?.value.type.column
  const remaining = (env: Env): readonly Placed[] => {
    if (driver === undefined) return on
    const source = leafAccess(driver, settings, env).implied
    if (source === undefined || source.from !== lookup!.column || key?.table !== driver.alias || key.orgName !== source.column.name) return on
    return on.filter((c) => c.e !== source.predicate)
  }
  return {
    *rows(run, context) {
      const env = run.env
      const checked = remaining(env)
      const costing = lookup === undefined ? rangeCosting(t, settings, env) : undefined
      const conjuncts = on.map((c) => c.e)
      // Materialized drivers finish their unique build before the first point read.
      const rows = outer.rows(run, context)
      const source = materialized ? [...distinct(rows, (row) => valueKey(lookup!.value.eval(row.row, env)))] : rows
      for (const o of source) {
        let access: Access | undefined
        if (lookup !== undefined) {
          const v = lookup.value.eval(o.row, env)
          // A value that does not convert exactly is a filtered scan (D-65).
          access = v === null ? undefined : pointAccess(lookup.index, lookup.column, v) ?? FULL_SCAN
        } else {
          const value = (e: Expression): Value | undefined => {
            if (!compiled.has(e)) compiled.set(e, known?.(e))
            return compiled.get(e)?.eval(o.row, env)
          }
          access = costing === undefined ? FULL_SCAN : dynamicAccess(t.def as TableDef, t.alias, conjuncts, env, costing, value)
        }
        let matched = false
        for (const candidate of scanTable(t, access, run, o.row, o.ids)) {
          if (!holds(checked, candidate.row, env)) continue
          matched = true
          yield candidate
          if (firstOnly) break
        }
        if (node.left && !matched) yield o
      }
    },
    describe(env) {
      let input = outer.describe(env)
      if (materialized) input = filterPlan(lookup!.value.type.nullable, scanMaterialized(materialize(input)))
      if (lookup === undefined) return nestedLoop(node.left, input, filterPlan(on.length > 0, planNode(`Index range scan on ${t.alias} (re-planned for each iteration)`)))
      const covering = t.def !== undefined && holdsRead(t.def, lookup.index, readOf(settings, t.alias))
      const lookupNode = indexLookup(t.alias, lookup.index.name, lookup.unique, covering)
      // The lookup's own equality is the key read, not a filter.
      const rest = remaining(env).filter((c) => c.e !== lookup.condition)
      const read = filterPlan(rest.length > 0, lookupNode)
      return nestedLoop(node.left, input, wrap(firstOnly && !semi, 'Limit', read), semi)
    },
  }
}

/**
 * An inner join one side of which is read while planning (`hidden`): that
 * side's rows once, joined to each of the other's, and the plan the other
 * side's alone, the conditions over both a Filter on it — the optimizer has
 * made the const side's columns constants (8.4.11: `FROM kl, pa WHERE pa.id =
 * 1` is "Table scan on kl").
 */
function constJoinOp(outer: Op, inner: Op, innerSlots: readonly number[], on: readonly Placed[]): Op {
  const fixedOuter = outer.hidden === true
  const fixed = fixedOuter ? outer : inner
  const other = fixedOuter ? inner : outer
  return {
    *rows(run, context) {
      const held = [...fixed.rows(run, context)]
      if (held.length === 0) return
      for (const r of other.rows(run, context)) yield* matchingRows(r, held, innerSlots, on, run.env, false, fixedOuter)
    },
    describe(env) {
      return filterPlan(on.length > 0, other.describe(env))
    },
    hidden: fixedOuter && inner.hidden === true,
  }
}

/**
 * A constant inner table, read lazily once for the preceding rows. An outer
 * join's held key preserves unmatched rows and hides its guaranteed conditions;
 * STRAIGHT_JOIN's constant table keeps the ordinary inner-loop boundary.
 */
function constantRowOp(outer: Op, t: FromTable, slots: readonly number[], own: readonly Placed[], on: readonly Placed[], settings: LeafSettings, heldKey?: readonly Expression[]): Op {
  const point = heldKey && settings.rounded
  // A const left input retains the DOUBLE comparison after the rounded read.
  const recheck = settings.hidden?.size
  const predicates = point && !recheck ? own.filter((c) => c.e !== point.condition) : own
  const access = (recheck && point?.constAccess) || point?.access
  const leaf = filterOp(tableOp(t, settings, access), predicates)
  return {
    *rows(run, context) {
      let inner: JoinedRow[] | undefined
      for (const o of outer.rows(run, context)) {
        inner ??= [...leaf.rows(run, context)]
        yield* matchingRows(o, inner, slots, on, run.env, heldKey !== undefined)
      }
    },
    describe(env) {
      const row = planNode(`Constant row from ${t.alias}`)
      const shown = heldKey === undefined ? on : [...own, ...on].filter((c) => !heldKey.includes(c.e))
      return nestedLoop(heldKey !== undefined, outer.describe(env), filterPlan(shown.length > 0, row))
    },
  }
}

/** Each emitted physical identity once, after the input checks every candidate pair. */
function weedoutOp(input: Op, table: FromTable | undefined): Op {
  if (table === undefined) return input
  return {
    rows: (run, context) => distinct(input.rows({ ...run, ids: true }, context), (row) => row.ids![table.offset]!.join()),
    describe: (env) => planNode(`Remove duplicate ${table.alias} rows using temporary table`, input.describe(env)),
  }
}

/** Repeated inner scans share LATERAL context and ordinary generator closure. */
function nestedJoinOp(node: Node & { kind: 'join' }, outer: Op, inner: Op, on: readonly Placed[]): Op {
  return {
    *rows(run, context) {
      for (const o of outer.rows(run, context)) {
        yield* matchingRows(o, inner.rows(run, o.row), node.innerSlots, on, run.env, node.left)
      }
    },
    describe(env) {
      const input = wrap(hasLateral(node.inner), 'Invalidate materialized tables', outer.describe(env))
      return nestedLoop(node.left, input, filterPlan(!node.left && on.length > 0, inner.describe(env)))
    },
  }
}

/** An equality's expressions in outer/inner order, shared by placement, point and hash keys. */
function equalitySides(e: Expression, outer: ReadonlySet<string>, inner: ReadonlySet<string>, scope: TableScope): readonly [Expression, Expression] | undefined {
  if (e.kind !== NODE.BINARY || e.op !== '=') return undefined
  const l = aliasesOf(e.left, scope)
  const r = aliasesOf(e.right, scope)
  if (within(l, outer) && within(r, inner)) return [e.left, e.right]
  if (within(l, inner) && within(r, outer)) return [e.right, e.left]
  return undefined
}


/**
 * EXPLAIN omits a single-point lookup's key condition and conditions checked
 * inside a noncovering secondary range on the columns that index holds.
 */
function scanFilters(t: FromTable, conditions: readonly Placed[], settings: LeafSettings, env: Env): readonly Placed[] {
  const def = t.def
  if (def === undefined) return conditions
  const access = leafAccess(t, settings, env)
  const index = def.indexes.find((i) => i.name === access.index)
  if (access.ranges === undefined || index === undefined) return conditions
  const point = access.ranges.length === 1 && access.ranges[0]?.from === access.ranges[0]?.to
  const column = point && index.parts.length === 1 ? index.parts[0]?.column.toLowerCase() : undefined
  const names = (x: Expression): boolean => x.kind === NODE.COLUMN && x.parts.at(-1)!.toLowerCase() === column && (x.parts.length < 2 || x.parts.at(-2) === t.alias)
  const clustered = clusteredIndex(def)
  const held = index === clustered || settings.covering.get(t.alias) === index.name ? undefined : new Set(indexParts(index, clustered).map((p) => p.column.toLowerCase()))
  return conditions.filter(({ e, aliases, semijoin }) => {
    if (column !== undefined) {
      if (e.kind === NODE.UNARY && e.op === 'IS NULL' && names(e.operand)) return false
      if (e.kind === NODE.BINARY && (e.op === '=' || e.op === '<=>') && (names(e.left) || names(e.right))) return false
    }
    if (held === undefined || aliases === undefined || semijoin !== undefined || (aliases.size > 0 && (aliases.size !== 1 || !aliases.has(t.alias)))) return true
    return someNode(e, (node) => {
      const n = node as Expression
      if (n.kind === NODE.SUBQUERY || n.kind === NODE.VARIABLE) return true
      if (n.kind === NODE.COLUMN) {
        const column = columnOf(t, n, settings.scope)
        return column === undefined || !held.has(column.name.toLowerCase())
      }
      return undefined
    })
  })
}

// --- covering indexes -------------------------------------------------------------

const INDEX_WIDTHS: Readonly<Record<number, number>> = { [FIELD_TYPE.FLOAT]: 4, [FIELD_TYPE.DOUBLE]: 8, [FIELD_TYPE.DATE]: 3, [FIELD_TYPE.YEAR]: 1 }

/** The value width in a key, before the caller accounts for NULL markers. */
function keyValueBytes(t: ColumnType): number {
  const bytes = integerBytes(t.type) ?? INDEX_WIDTHS[t.type]
  if (bytes !== undefined) return bytes
  if (t.type === FIELD_TYPE.NEWDECIMAL || t.type === FIELD_TYPE.DECIMAL) return Math.ceil((t.precision ?? 10) / 2) + 1
  if (t.type === FIELD_TYPE.DATETIME || t.type === FIELD_TYPE.TIMESTAMP) return 5 + Math.ceil((t.decimals ?? 0) / 2)
  const mb = t.collationId === undefined ? 1 : requireCollationInfo(t.collationId).mbmaxlen
  return (t.length ?? 1) * mb + 2
}

/** An index's key bytes (`key_length`); a hidden row id's 6. */
function indexBytes(def: TableDef, index = clusteredIndex(def)): number {
  if (index === undefined) return 6
  let bytes = 0
  for (const part of index.parts) {
    const column = def.columns.find((c) => c.name === part.column)!
    bytes += keyValueBytes(column.type) + Number(column.nullable)
  }
  return bytes
}

/** Key bytes plus the clustered record address, for the optimizer's index read cost. */
export function indexRecordBytes(def: TableDef, index: IndexDef): number {
  return indexBytes(def, index) + indexBytes(def)
}

/** Whether an index holds every complete column read, including a secondary key's clustered parts. */
export function holdsRead(def: TableDef, index: IndexDef, read: ReadonlySet<string> | 'all'): boolean {
  if (read === 'all' || index.invisible === true) return false
  const parts = indexParts(index, clusteredIndex(def))
  for (const name of read) {
    if (!parts.some((p) => indexPartMatchesColumn(p, name))) return false
  }
  return true
}

const readOf = (settings: LeafSettings, alias: string): ReadonlySet<string> | 'all' => settings.read.get(alias) ?? 'all'

/**
 * The index a table read whole is read through (`find_shortest_key`): the
 * smallest secondary index that holds every column in `read`, by key bytes;
 * else the clustered index itself when `read` is only its columns, which
 * 8.4.11 shows as a covering index scan of PRIMARY.
 */
function coveringIndex(def: TableDef, read: ReadonlySet<string> | 'all', indexes = def.indexes): string | undefined {
  let best: string | undefined
  let size = Infinity
  const clustered = clusteredIndex(def)
  for (const index of indexes) {
    if (!holdsRead(def, index, read)) continue
    const bytes = index === clustered ? Infinity : indexBytes(def, index)
    if (best === undefined || bytes < size) {
      best = index.name
      size = bytes
    }
  }
  return best
}
