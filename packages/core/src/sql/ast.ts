import { LITERAL, NODE, QUERY, nativeFunctionWord, type CallNode, type Expression, type LiteralNode, type QueryBody, type QueryExpression } from '@myjs/parser'

/** AND can stop on false, OR on true. Other operators have no such value. */
export const logicalShortCircuit = (op: string): boolean | undefined => op === 'AND' || op === '&&' ? false : op === 'OR' || op === '||' ? true : undefined

/** A comparison written with its two operands swapped. */
export const REVERSE_COMPARISON: Readonly<Record<string, string>> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=', '<=>': '<=>', '<>': '<>', '!=': '!=' }

/** A comparison whose direction changes when its operands are swapped. */
export function isOrderedComparison(op: string): boolean {
  const reversed = REVERSE_COMPARISON[op]
  return typeof reversed === 'string' && reversed !== op
}

/** Lookup eligibility, not existence; raw names and collision roles stay on the AST. */
export function nativeCallName(e: Pick<CallNode, 'name' | 'stored' | 'schema'>): string {
  return e.stored || e.schema !== undefined ? '' : nativeFunctionWord(e.name)
}

/** The innermost body; wrapper ORDER, LIMIT and WITH clauses remain on their query nodes. */
export function queryBody(query: QueryExpression): Exclude<QueryBody, QueryExpression> {
  let body = query.body
  while (body.kind === QUERY.QUERY) body = body.body
  return body
}

/** A direct SELECT field, including stars and transparent unary plus, at its own query owner. */
export function hasDirectFields(query: QueryExpression): boolean {
  const body = queryBody(query)
  return body.kind === QUERY.SELECT && body.items.some(({ expr }) => {
    while (expr.kind === NODE.UNARY && expr.op === '+') expr = expr.operand
    return expr.kind === NODE.COLUMN
  })
}

/** Read-only AST proofs: true matches, false prunes, undefined visits children. */
export function someNode(e: unknown, check: (node: object) => boolean | undefined): boolean {
  if (e === null || typeof e !== 'object') return false
  const match = check(e)
  if (match !== undefined) return match
  for (const child of Object.values(e)) {
    if (Array.isArray(child)) {
      for (const item of child) if (someNode(item, check)) return true
    } else if (someNode(child, check)) return true
  }
  return false
}

/** Rewrite an expression tree. A replacement prunes its children. */
export function rewriteExpression(e: Expression, replace: (node: Expression) => Expression | undefined): Expression {
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(walk)
    const node = value as Expression
    if (node.kind === NODE.LITERAL) return node
    const replacement = replace(node)
    if (replacement !== undefined) return replacement
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) out[key] = walk(child)
    return out
  }
  return walk(e) as Expression
}
/** Window calls owned here; subqueries retain their own window scope. */
export function containsWindow(e: unknown): boolean {
  return someNode(e, (value) => {
    const n = value as { kind?: string; over?: unknown }
    if (n.kind === NODE.SUBQUERY) return false
    if (n.kind === NODE.CALL && n.over !== undefined) return true
    return undefined
  })
}

/** Declaration admission visits children before the enclosing expression. */
export function visitPostorder(value: unknown, check: (node: object) => void): void {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return
  Object.values(value).forEach(child => visitPostorder(child, check))
  check(value)
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

/** A written integer literal; expressions, placeholders and DECIMAL spellings stay distinct. */
export function integerLiteral(e: Expression): e is LiteralNode & { readonly type: typeof LITERAL.INT; readonly value: bigint } {
  return e.kind === NODE.LITERAL && e.type === LITERAL.INT
}

/** Operand below permitted signs, for syntax proofs that keep the original reader. */
export function signedOperand(e: Expression, plus?: '+'): Expression {
  while (e.kind === NODE.UNARY && (e.op === '-' || e.op === plus)) e = e.operand
  return e
}
