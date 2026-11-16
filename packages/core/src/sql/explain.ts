// M5.43, M5.44 — a plan as a tree of 8.4.11's iterators, and EXPLAIN FORMAT=TREE.
//
// A node is named as the server's iterator prints itself — "Table scan on t",
// "Inner hash join", "Sort" — because the corpus compares plans by that
// text (`planSkeleton` in `tools/capture-relational.mjs`: each line up to its
// first `:` or ` (`). The same decisions that choose how rows are read decide
// what a node says, so a plan that agrees is the plan that ran: where it does,
// the replay compares rows in order (D-81).
//
// What follows the name — a condition, a sort key, a range — is detail, cut
// by the skeleton, and kept short here; costs and row estimates are M5.7's.

/** One iterator: what it is, and what it reads from. */
export interface PlanNode {
  /** The iterator's printed label, including any range or other detail. */
  readonly label: string
  readonly children: readonly PlanNode[]
}

export const planNode = (label: string, input: PlanNode | readonly PlanNode[] = []): PlanNode => ({ label, children: 'label' in input ? [input] : input })

/** A temporary set's build and its whole-table read are independent iterators. */
export const materialize = (input?: PlanNode | readonly PlanNode[]): PlanNode => planNode('Materialize with deduplication', input)
export const scanMaterialized = (build: PlanNode): PlanNode => planNode('Table scan on <subquery2>', build)
export const lookupMaterialized = (build: PlanNode, dependent = false): PlanNode =>
  indexLookup(dependent ? '<materialized_subquery>' : '<subquery2>', '<auto_distinct_key>', !dependent, false, build)

/** The same index-read facts name physical and dependent-subquery lookups. */
export function indexLookup(alias: string, index: string, unique: boolean, covering: boolean, input?: PlanNode): PlanNode {
  const label = unique ? (covering ? 'Single-row covering index' : 'Single-row index') : (covering ? 'Covering index' : 'Index')
  return planNode(`${label} lookup on ${alias} using ${index}`, input)
}

/** `node` under `label`, or `node` alone when `when` is false. */
export const wrap = (when: boolean, label: string, node: PlanNode): PlanNode => (when ? planNode(label, node) : node)

export const filterPlan = (when: boolean, input: PlanNode): PlanNode => wrap(when, 'Filter', input)

/** EXPLAIN FORMAT=TREE's text: each iterator on its own line as `-> name`, its inputs four spaces in. */
export function renderTree(roots: readonly PlanNode[]): string {
  const lines: string[] = []
  const walk = (level: readonly PlanNode[], indent: string): void => {
    for (const { label, children } of level) {
      lines.push(`${indent}-> ${label}`)
      if (children.length > 0) walk(children, `${indent}    `)
    }
  }
  walk(roots, '')
  return `${lines.join('\n')}\n`
}
