// M3.2 — expression AST nodes.
//
// `const` objects and unions rather than `enum`s, because `erasableSyntaxOnly`
// is on. Every node carries the character offset of its first token, so M3.9
// can point at the right place and M5 can attribute a runtime error to a
// subexpression rather than to the whole statement.

export const NODE = {
  LITERAL: 'literal',
  PLACEHOLDER: 'placeholder',
  COLUMN: 'column',
  VARIABLE: 'variable',
  UNARY: 'unary',
  BINARY: 'binary',
  CALL: 'call',
  CASE: 'case',
  ROW: 'row',
  INTERVAL: 'interval',
} as const

export type NodeKind = (typeof NODE)[keyof typeof NODE]

/**
 * How a literal was written, which decides its SQL type.
 *
 * MySQL's rules, and they are not interchangeable: `1` is a BIGINT, `1.0` is an
 * exact DECIMAL, and `1e0` is an approximate DOUBLE. Collapsing all three to a
 * JavaScript `number` would lose the exactness DECIMAL exists for — the same
 * reason D-15 maps DECIMAL to a string rather than to a float.
 */
export const LITERAL = {
  INT: 'int',
  DECIMAL: 'decimal',
  DOUBLE: 'double',
  STRING: 'string',
  HEX: 'hex',
  BIT: 'bit',
  NULL: 'null',
  BOOL: 'bool',
} as const

export type LiteralType = (typeof LITERAL)[keyof typeof LITERAL]

export interface LiteralNode {
  readonly kind: typeof NODE.LITERAL
  readonly type: LiteralType
  /**
   * `bigint` for INT and BIT, `string` for DECIMAL (exact, per D-15) and
   * STRING, `number` for DOUBLE, `Uint8Array` for HEX, `null`, `boolean`.
   */
  readonly value: bigint | number | string | Uint8Array | boolean | null
  /** A `_latin1'…'` introducer, when one was written. */
  readonly charset?: string
  /** A `COLLATE` clause attached to the literal. */
  readonly collation?: string
  readonly at: number
}

export interface PlaceholderNode {
  readonly kind: typeof NODE.PLACEHOLDER
  /** 0-based, in the order the `?`s appeared — what `COM_STMT_EXECUTE` binds by. */
  readonly index: number
  readonly at: number
}

export interface ColumnNode {
  readonly kind: typeof NODE.COLUMN
  /** `['a']`, `['t','a']` or `['db','t','a']`. `['t','*']` for a qualified star. */
  readonly parts: readonly string[]
  readonly at: number
}

export interface VariableNode {
  readonly kind: typeof NODE.VARIABLE
  readonly name: string
  readonly at: number
}

export interface UnaryNode {
  readonly kind: typeof NODE.UNARY
  readonly op: string
  readonly operand: Expression
  readonly at: number
}

export interface BinaryNode {
  readonly kind: typeof NODE.BINARY
  readonly op: string
  readonly left: Expression
  readonly right: Expression
  /** `BETWEEN`'s upper bound, `LIKE`'s `ESCAPE`, `IN`'s list — the third operand. */
  readonly extra?: Expression | readonly Expression[]
  readonly at: number
}

export interface CallNode {
  readonly kind: typeof NODE.CALL
  readonly name: string
  readonly args: readonly Expression[]
  /** `COUNT(DISTINCT x)`. */
  readonly distinct?: boolean
  readonly at: number
}

export interface CaseNode {
  readonly kind: typeof NODE.CASE
  /** Absent for the searched form, `CASE WHEN cond THEN …`. */
  readonly operand?: Expression
  readonly whens: readonly { readonly when: Expression; readonly then: Expression }[]
  readonly else?: Expression
  readonly at: number
}

/** `(a, b)` — a row constructor, which is not the same as a parenthesised `a`. */
export interface RowNode {
  readonly kind: typeof NODE.ROW
  readonly items: readonly Expression[]
  readonly at: number
}

/** `INTERVAL 1 DAY`, which is only meaningful beside `+` or `-`. */
export interface IntervalNode {
  readonly kind: typeof NODE.INTERVAL
  readonly value: Expression
  readonly unit: string
  readonly at: number
}

export type Expression =
  | LiteralNode
  | PlaceholderNode
  | ColumnNode
  | VariableNode
  | UnaryNode
  | BinaryNode
  | CallNode
  | CaseNode
  | RowNode
  | IntervalNode
