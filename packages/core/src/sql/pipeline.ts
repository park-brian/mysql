// M5.43 — what runs above the FROM, as stages that each say what they are.
//
// A query's rows leave its FROM and pass through its HAVING, its windows, its
// ORDER BY and DISTINCT, and its LIMIT. Each stage here is both halves of one
// iterator: how it transforms the rows, and what EXPLAIN calls it, so the
// plan EXPLAIN prints is the plan that ran (D-81). A stage that cannot say
// what 8.4.11 would call it makes the whole query unexplained, which EXPLAIN
// refuses, rather than describing something else.
import type { Env, Row } from './compile.ts'
import type { PlanNode } from './explain.ts'

/** A row as the stages pass it: the FROM's row, or, after projection, the select list's values. */
export interface Rowed {
  readonly row: Row
}

export interface Stage {
  run(rows: Iterable<Rowed>, env: Env): Iterable<Rowed>
  /** The iterator over `input`, as EXPLAIN prints it; `undefined` when it has no 8.4.11 name yet. */
  describe(input: PlanNode): PlanNode | undefined
}

/** The rows of `source` through every stage, in order. */
export function runStages(source: Iterable<Rowed>, stages: readonly Stage[], env: Env): Iterable<Rowed> {
  let rows = source
  for (const s of stages) rows = s.run(rows, env)
  return rows
}

/** The plan of `source` under every stage, or `undefined` if any stage has none. */
export function describeStages(source: PlanNode, stages: readonly Stage[]): PlanNode | undefined {
  let n: PlanNode | undefined = source
  for (const s of stages) {
    if (n === undefined) return undefined
    n = s.describe(n)
  }
  return n
}
