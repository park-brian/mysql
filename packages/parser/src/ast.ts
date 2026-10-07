// M3.2 — expression AST nodes.
//
// `const` objects and unions rather than `enum`s, because `erasableSyntaxOnly`
// is on. Every node carries the character offset of its first token, so M3.9
// can point at the right place and M5 can attribute a runtime error to a
// subexpression rather than to the whole statement.
import type { DataType } from './data-type.ts'
import type { OrderItem, QueryExpression, WindowSpec } from './query-ast.ts'

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
  COLLATE: 'collate',
  SUBQUERY: 'subquery',
  CAST: 'cast',
  CONVERT: 'convert',
  KEYWORD: 'keyword',
  MATCH: 'match',
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
  /**
   * A typed temporal literal: `DATE'2019-10-01'`, `TIME'01:02:03'`,
   * `TIMESTAMP'2019-10-01 01:02:03'`.
   *
   * Not the same as the string beside it. `DATE'2019-10-01'` is a DATE, so it
   * compares and sorts as one, and a `DEFAULT DATE'…'` on a DATE column is
   * legal where a bare string default is not. The distinction is in the type,
   * which is why it is a literal type rather than a call — found by M3.11's
   * census, in `default.test`.
   */
  TEMPORAL: 'temporal',
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
  /** For `TEMPORAL`: which keyword introduced it — `DATE`, `TIME`, `TIMESTAMP`. */
  readonly unit?: string
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
  /** `GROUP_CONCAT(a ORDER BY b)`. */
  readonly orderBy?: readonly OrderItem[]
  /** `GROUP_CONCAT(a SEPARATOR ';')`. */
  readonly separator?: string
  /** `CHAR(77 USING utf8mb4)`. */
  readonly using?: string
  /** `RANK() OVER w` names a window; `OVER (…)` defines one inline. */
  readonly over?: string | WindowSpec
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

/**
 * `expr COLLATE name` on anything but a literal, which carries its collation
 * itself.
 *
 * M3.2 parsed this to a unary node with no field for the name, so
 * `a COLLATE utf8mb4_bin` and `a COLLATE latin1_bin` were the same tree — the
 * name was read and dropped. The deparser's round-trip found it (M3.3), since a
 * name the tree does not hold is a name the deparser cannot write back.
 */
export interface CollateNode {
  readonly kind: typeof NODE.COLLATE
  readonly expr: Expression
  readonly collation: string
  readonly at: number
}

/**
 * A query in an expression: `(SELECT …)`, `EXISTS (SELECT …)`'s operand,
 * `IN (SELECT …)`'s right side, and `= ANY (SELECT …)`'s.
 */
export interface SubqueryNode {
  readonly kind: typeof NODE.SUBQUERY
  readonly query: QueryExpression
  /** `ANY` or `ALL` for a quantified comparison. `SOME` is `ANY`. */
  readonly quantifier?: 'ANY' | 'ALL'
  readonly at: number
}

/** `CAST(x AS type)` and `CONVERT(x, type)`, which are the same thing. */
export interface CastNode {
  readonly kind: typeof NODE.CAST
  readonly expr: Expression
  readonly type: DataType
  /** `CAST(j AS UNSIGNED ARRAY)`, the multi-valued index form. */
  readonly array?: boolean
  /** `CAST(ts AT TIME ZONE '+00:00' AS DATETIME)`. */
  readonly timeZone?: string
  readonly at: number
}

/** `CONVERT(x USING utf8mb4)` — a change of charset, not of type. */
export interface ConvertNode {
  readonly kind: typeof NODE.CONVERT
  readonly expr: Expression
  readonly charset: string
  readonly at: number
}

/**
 * A bare keyword in an argument position: the unit in `EXTRACT(YEAR FROM d)`
 * and `TIMESTAMPADD(DAY, 1, d)`, the type in `GET_FORMAT(DATE, 'USA')`, the
 * side in `TRIM(LEADING 'x' FROM s)`. Not a column, which is the point.
 */
export interface KeywordNode {
  readonly kind: typeof NODE.KEYWORD
  readonly word: string
  readonly at: number
}

/** `MATCH (a, b) AGAINST ('x' IN BOOLEAN MODE)`. */
export interface MatchNode {
  readonly kind: typeof NODE.MATCH
  readonly columns: readonly Expression[]
  readonly against: Expression
  readonly modifier?: string
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
  | CollateNode
  | SubqueryNode
  | CastNode
  | ConvertNode
  | KeywordNode
  | MatchNode
