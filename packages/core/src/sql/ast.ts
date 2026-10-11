/** Object-valued AST children, with lists visited in their written order. */
export function children(e: object): unknown[] {
  return Object.values(e).flat().filter((v) => typeof v === 'object')
}

/** Read-only AST proofs: true matches, false prunes, undefined visits children. */
export function someNode(e: unknown, check: (node: object) => boolean | undefined): boolean {
  if (e === null || typeof e !== 'object') return false
  return check(e) ?? children(e).some((child) => someNode(child, check))
}
