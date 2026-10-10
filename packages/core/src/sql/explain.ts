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
  /** The iterator's name as 8.4.11 prints it, `Table scan on t`. */
  readonly label: string
  /** Printed after `: `, as MySQL prints a condition or a sort key. */
  readonly detail?: string
  readonly children: readonly PlanNode[]
}

export const planNode = (label: string, children: readonly PlanNode[] = [], detail?: string): PlanNode => (detail === undefined ? { label, children } : { label, detail, children })

/** `node` under `label`, or `node` alone when `when` is false. */
export const wrap = (when: boolean, label: string, node: PlanNode, detail?: string): PlanNode => (when ? planNode(label, [node], detail) : node)

/** EXPLAIN FORMAT=TREE's text: each iterator on its own line as `-> name`, its inputs four spaces in. */
export function renderTree(roots: readonly PlanNode[]): string {
  const lines: string[] = []
  const walk = (n: PlanNode, depth: number): void => {
    lines.push(`${'    '.repeat(depth)}-> ${n.label}${n.detail === undefined ? '' : `: ${n.detail}`}`)
    for (const c of n.children) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return `${lines.join('\n')}\n`
}
