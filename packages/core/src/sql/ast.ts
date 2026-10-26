import { NODE, type Expression } from '@myjs/parser'

/** Object-valued AST children, with lists visited in their written order. */
export function children(e: object): unknown[] {
  return Object.values(e).flat().filter((v) => typeof v === 'object')
}

/** Read-only AST proofs: true matches, false prunes, undefined visits children. */
export function someNode(e: unknown, check: (node: object) => boolean | undefined): boolean {
  if (e === null || typeof e !== 'object') return false
  return check(e) ?? children(e).some((child) => someNode(child, check))
}
/** Columns in written order; callers decide whether nested query blocks count. */
export function columnRefs(e: unknown, subqueries = false): (readonly string[])[] {
  const out: (readonly string[])[] = []
  someNode(e, (value) => {
    const n = value as { kind?: string; parts?: readonly string[] }
    if (n.kind === NODE.SUBQUERY && !subqueries) return false
    if (n.kind === NODE.COLUMN && n.parts !== undefined) {
      out.push(n.parts)
      return false
    }
    return undefined
  })
  return out
}

/** Conjuncts retain their original expressions and source positions. */
export function and(a: Expression | undefined, b: Expression): Expression
export function and(a: Expression, b: Expression | undefined): Expression
export function and(a: Expression | undefined, b: Expression | undefined): Expression | undefined
export function and(a: Expression | undefined, b: Expression | undefined): Expression | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return { kind: NODE.BINARY, op: 'AND', left: a, right: b, at: a.at }
}
