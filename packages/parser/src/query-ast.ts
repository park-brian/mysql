// M3.3 — query expressions: `SELECT`, set operations, `WITH`, `VALUES`,
// `TABLE`, and the table references they read from.
//
// Two placements here are decisions rather than transcriptions of the grammar:
//
//   - **`ORDER BY`, `LIMIT`, `INTO` and the locking clause belong to the query
//     expression, not to a `SELECT`.** That is where MySQL's own grammar puts
//     the first two, and it is what makes `SELECT a FROM t UNION SELECT b FROM u
//     ORDER BY 1` order the *union* rather than its second branch. A branch that
//     orders itself is a parenthesised query expression with its own clause —
//     which is exactly the shape of the SQL that says so. `INTO` may be written
//     in three positions and means the same thing in each, so it is recorded in
//     one.
//   - **A join is a binary tree in the shape MySQL groups it.** A comma binds
//     more loosely than any `JOIN` (since 5.0.12), so `FROM a, b JOIN c ON …`
//     is a list of two references, the second a join. Getting that wrong
//     changes which tables an `ON` may name, which M3.16 checks against a real
//     server.
import type { Expression } from './ast.ts'
import type { TableName } from './statement-ast.ts'

export const QUERY = {
  QUERY: 'query',
  SELECT: 'select',
  SET_OPERATION: 'setOperation',
  VALUES: 'values',
  TABLE: 'tableStatement',
} as const

export const REF = {
  TABLE: 'table',
  DERIVED: 'derived',
  JOIN: 'join',
  /** A parenthesised list of references: `FROM (a, b JOIN c)`. */
  LIST: 'list',
} as const

/** `ORDER BY` items, and the shape `GROUP BY` and window specs reuse. */
export interface OrderItem {
  readonly expr: Expression
  /** `DESC`. `ASC` is the default and is recorded as absent. */
  readonly desc?: boolean
}

export interface Limit {
  readonly count: Expression
  readonly offset?: Expression
}

/** `FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`. */
export interface Locking {
  /** `UPDATE` or `SHARE`; `LOCK IN SHARE MODE` is recorded as `SHARE` with `legacy`. */
  readonly strength: 'UPDATE' | 'SHARE'
  readonly legacy?: boolean
  readonly of?: readonly TableName[]
  readonly wait?: 'NOWAIT' | 'SKIP LOCKED'
}

/** `INTO @a, @b`, `INTO OUTFILE '…' …`, `INTO DUMPFILE '…'`. */
export type Into =
  | { readonly kind: 'variables'; readonly targets: readonly Expression[] }
  | {
      readonly kind: 'outfile'
      readonly file: string
      readonly charset?: string
      /**
       * `FIELDS TERMINATED BY ','` and the rest, keyed as written in upper
       * case — `FIELDS TERMINATED BY`, `LINES STARTING BY` — with
       * `FIELDS OPTIONALLY ENCLOSED BY` distinct from `FIELDS ENCLOSED BY`.
       */
      readonly options: Readonly<Record<string, string>>
    }
  | { readonly kind: 'dumpfile'; readonly file: string }

export interface CommonTable {
  readonly name: string
  readonly columns?: readonly string[]
  readonly query: QueryExpression
}

export interface With {
  readonly recursive?: boolean
  readonly tables: readonly CommonTable[]
}

export interface QueryExpression {
  readonly kind: typeof QUERY.QUERY
  readonly with?: With
  readonly body: QueryBody
  readonly orderBy?: readonly OrderItem[]
  readonly limit?: Limit
  readonly into?: Into
  readonly locking?: readonly Locking[]
  readonly at: number
}

/**
 * What a query expression is made of. A `QueryExpression` here is a
 * parenthesised one — `(SELECT … LIMIT 1) UNION …` — kept as written because
 * its own `ORDER BY` and `LIMIT` apply to it alone.
 */
export type QueryBody = SelectNode | SetOperationNode | ValuesNode | TableStatementNode | QueryExpression

export interface SetOperationNode {
  readonly kind: typeof QUERY.SET_OPERATION
  readonly op: 'UNION' | 'INTERSECT' | 'EXCEPT'
  /** `ALL`. `DISTINCT` is the default and is recorded as absent. */
  readonly all?: boolean
  readonly left: QueryBody
  readonly right: QueryBody
  readonly at: number
}

export interface SelectItem {
  /** `*` and `t.*` are a column node whose last part is `'*'`. */
  readonly expr: Expression
  readonly alias?: string
}

export interface GroupBy {
  readonly items: readonly Expression[]
  readonly rollup?: boolean
}

/** A frame bound: `UNBOUNDED PRECEDING`, `CURRENT ROW`, `3 FOLLOWING`. */
export interface FrameBound {
  readonly kind: 'unbounded' | 'current' | 'value'
  readonly value?: Expression
  readonly direction?: 'PRECEDING' | 'FOLLOWING'
}

export interface WindowSpec {
  /** `OVER (w ORDER BY a)` — a named window this one extends. */
  readonly base?: string
  readonly partitionBy?: readonly Expression[]
  readonly orderBy?: readonly OrderItem[]
  readonly frame?: {
    readonly units: 'ROWS' | 'RANGE'
    readonly start: FrameBound
    readonly end?: FrameBound
  }
}

export interface SelectNode {
  readonly kind: typeof QUERY.SELECT
  /** `DISTINCT` or its synonym `DISTINCTROW`. `ALL` is the default. */
  readonly distinct?: boolean
  /** `HIGH_PRIORITY`, `STRAIGHT_JOIN`, `SQL_CALC_FOUND_ROWS` and friends, upper-case. */
  readonly options?: readonly string[]
  readonly items: readonly SelectItem[]
  /** Absent for `SELECT 1` and for `SELECT 1 FROM DUAL`, which are the same. */
  readonly from?: readonly TableReference[]
  readonly where?: Expression
  readonly groupBy?: GroupBy
  readonly having?: Expression
  readonly windows?: readonly { readonly name: string; readonly spec: WindowSpec }[]
  readonly at: number
}

/** `VALUES ROW(1, 2), ROW(3, 4)` as a query. */
export interface ValuesNode {
  readonly kind: typeof QUERY.VALUES
  readonly rows: readonly (readonly Expression[])[]
  readonly at: number
}

/** `TABLE t`, which is `SELECT * FROM t`. */
export interface TableStatementNode {
  readonly kind: typeof QUERY.TABLE
  readonly table: TableName
  readonly at: number
}

/** `USE INDEX (a)`, `FORCE KEY FOR JOIN (b)`, `IGNORE INDEX ()`. */
export interface IndexHint {
  readonly type: 'USE' | 'IGNORE' | 'FORCE'
  readonly for?: 'JOIN' | 'ORDER BY' | 'GROUP BY'
  readonly indexes: readonly string[]
}

export interface TableRefNode {
  readonly kind: typeof REF.TABLE
  readonly table: TableName
  readonly partitions?: readonly string[]
  readonly alias?: string
  readonly indexHints?: readonly IndexHint[]
  readonly at: number
}

export interface DerivedTableNode {
  readonly kind: typeof REF.DERIVED
  readonly query: QueryExpression
  readonly lateral?: boolean
  readonly alias?: string
  readonly columns?: readonly string[]
  readonly at: number
}

export interface JoinNode {
  readonly kind: typeof REF.JOIN
  /** `INNER` covers `JOIN`, `INNER JOIN` and `CROSS JOIN`, which MySQL treats alike. */
  readonly type: 'INNER' | 'LEFT' | 'RIGHT' | 'STRAIGHT'
  readonly natural?: boolean
  readonly left: TableReference
  readonly right: TableReference
  readonly on?: Expression
  readonly using?: readonly string[]
  readonly at: number
}

export interface TableListNode {
  readonly kind: typeof REF.LIST
  readonly items: readonly TableReference[]
  readonly at: number
}

export type TableReference = TableRefNode | DerivedTableNode | JoinNode | TableListNode
