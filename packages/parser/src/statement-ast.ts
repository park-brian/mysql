// M3.5 — statement nodes, starting with the DDL the milestone exits on.
//
// M3's exit criterion is "every `CREATE TABLE` in MySQL's own test suite
// parses", so these shapes are what that criterion produces. They record what
// was **written**, not what it resolves to: a column's charset may be absent
// here and inherited from the table, and the table's from the schema, and doing
// that resolution needs a data dictionary, which is M4. A parser that guessed
// the inherited value would bake a default into the AST that doc 03 says is
// cached at prepare time — so the guess would outlive the statement that made
// it and be wrong for every later one.
//
// `const` objects and unions rather than `enum`s, because `erasableSyntaxOnly`
// is on. Same shape as `NODE` in `ast.ts`.
import type { ColumnNode, Expression } from './ast.ts'
import type { DataType } from './data-type.ts'
import type { OrderItem, QueryExpression, TableReference, With } from './query-ast.ts'

export const STATEMENT = {
  CREATE_TABLE: 'createTable',
  CREATE_VIEW: 'createView',
  DROP: 'drop',
  /** A query as a statement: `SELECT`, `WITH`, `VALUES`, `TABLE`, `(…)`. */
  QUERY: 'query',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
} as const

export type StatementKind = (typeof STATEMENT)[keyof typeof STATEMENT]

/** A possibly schema-qualified name: `t`, `db.t`. */
export interface TableName {
  readonly schema?: string
  readonly name: string
}

/**
 * A column's definition.
 *
 * `notNull` and `nullable` are both optional and are not complements: a column
 * that says neither is nullable *by default*, one that says `NULL` is nullable
 * *explicitly*, and the difference matters because `TIMESTAMP` columns and
 * primary-key members have different defaults from everything else. Recording
 * "nothing was said" as `false` would erase the distinction the resolution
 * rules turn on.
 */
export interface ColumnDefinition {
  readonly name: string
  readonly type: DataType
  readonly notNull?: boolean
  readonly nullable?: boolean
  /** `DEFAULT <expr>`. A literal, or an expression in parentheses (8.0.13+). */
  readonly default?: Expression
  /** `ON UPDATE CURRENT_TIMESTAMP[(fsp)]`. */
  readonly onUpdate?: Expression
  readonly autoIncrement?: boolean
  /** `UNIQUE [KEY]` written inline on the column. */
  readonly unique?: boolean
  /** `PRIMARY KEY` written inline on the column. */
  readonly primary?: boolean
  readonly comment?: string
  /** `GENERATED ALWAYS AS (…) [VIRTUAL|STORED]`, or the `AS (…)` shorthand. */
  readonly generated?: { readonly expr: Expression; readonly stored: boolean }
  /** 8.0.23's `INVISIBLE`: the column is omitted from `SELECT *`. */
  readonly invisible?: boolean
  /** `SRID n` on a spatial column. */
  readonly srid?: number
  /** An inline `CHECK (…)`, which MySQL treats as a table constraint anyway. */
  readonly check?: Expression
  readonly at: number
}

export const KEY = {
  PRIMARY: 'primary',
  UNIQUE: 'unique',
  INDEX: 'index',
  FULLTEXT: 'fulltext',
  SPATIAL: 'spatial',
  FOREIGN: 'foreign',
} as const

export type KeyType = (typeof KEY)[keyof typeof KEY]

/**
 * One column in an index.
 *
 * Either a `name` — with an optional prefix `length`, which is how a TEXT
 * column is indexed at all — or an `expr`, since 8.0.13 allows a functional
 * index over `(UPPER(a))`. Exactly one of the two is set.
 */
export interface IndexColumn {
  readonly name?: string
  readonly expr?: Expression
  readonly length?: number
  /** `DESC`. `ASC` is the default and is recorded as absent. */
  readonly desc?: boolean
}

/** What a foreign key points at, and what it does when the target moves. */
export interface Reference {
  readonly table: TableName
  readonly columns: readonly IndexColumn[]
  readonly onDelete?: string
  readonly onUpdate?: string
  readonly match?: string
}

export interface KeyDefinition {
  readonly type: KeyType
  readonly name?: string
  /** The `CONSTRAINT <symbol>` that introduced it, when one was written. */
  readonly constraint?: string
  readonly columns: readonly IndexColumn[]
  /** `USING BTREE` / `USING HASH`. */
  readonly using?: string
  /** Set for `type: 'foreign'`. */
  readonly references?: Reference
  readonly comment?: string
  readonly at: number
}

export interface CheckConstraint {
  readonly name?: string
  readonly expr: Expression
  /** `NOT ENFORCED` makes the constraint documentation rather than a rule. */
  readonly enforced: boolean
  readonly at: number
}

export interface CreateTableNode {
  readonly kind: typeof STATEMENT.CREATE_TABLE
  readonly table: TableName
  readonly temporary?: boolean
  readonly ifNotExists?: boolean
  /** `CREATE TABLE a LIKE b` — the definition is copied and there is no body. */
  readonly like?: TableName
  readonly columns: readonly ColumnDefinition[]
  readonly keys: readonly KeyDefinition[]
  readonly checks: readonly CheckConstraint[]
  /**
   * `ENGINE=InnoDB`, `AUTO_INCREMENT=5`, `CHARACTER SET=utf8mb4` and the rest,
   * keyed by their canonical upper-case name. Values are kept as written
   * because most are engine-specific and this parser has no business
   * interpreting them — but two are not: `CHARACTER SET` and `COLLATE` decide
   * what every column without its own charset inherits.
   */
  readonly options: Readonly<Record<string, string>>
  /**
   * `CREATE TABLE t … SELECT …`: the query whose rows fill the table, and
   * whose columns are appended to any the body declares.
   */
  readonly query?: QueryExpression
  /** For `query`: what a duplicate key does — skip the row, or replace the old one. */
  readonly duplicates?: 'IGNORE' | 'REPLACE'
  readonly at: number
}

/** `'u'@'h'`, `u@h`, `'u'` (any host), or `CURRENT_USER`. */
export type Definer = 'CURRENT_USER' | { readonly user: string; readonly host?: string }

export interface CreateViewNode {
  readonly kind: typeof STATEMENT.CREATE_VIEW
  readonly view: TableName
  readonly orReplace?: boolean
  readonly algorithm?: 'UNDEFINED' | 'MERGE' | 'TEMPTABLE'
  readonly definer?: Definer
  readonly security?: 'DEFINER' | 'INVOKER'
  readonly columns?: readonly string[]
  readonly query: QueryExpression
  /** `WITH CHECK OPTION` is `CASCADED`, MySQL's default. */
  readonly checkOption?: 'CASCADED' | 'LOCAL'
  readonly at: number
}

/** What a `DROP` names. `TABLE` and `VIEW` may name several at once. */
export const DROP_OBJECT = {
  TABLE: 'TABLE',
  VIEW: 'VIEW',
  INDEX: 'INDEX',
  DATABASE: 'DATABASE',
} as const

export type DropObject = (typeof DROP_OBJECT)[keyof typeof DROP_OBJECT]

export interface DropNode {
  readonly kind: typeof STATEMENT.DROP
  readonly object: DropObject
  readonly names: readonly TableName[]
  readonly ifExists?: boolean
  readonly temporary?: boolean
  /** `DROP INDEX i ON t` — the table the index belongs to. */
  readonly on?: TableName
  /** `RESTRICT` or `CASCADE`, which MySQL parses and ignores. */
  readonly behaviour?: string
  readonly at: number
}

/**
 * `col = value` in `SET`, `UPDATE … SET` and `ON DUPLICATE KEY UPDATE`. The
 * value may be the bare keyword `DEFAULT`, which is a keyword node.
 */
export interface Assignment {
  readonly column: ColumnNode
  readonly value: Expression
}

/**
 * `INSERT` and `REPLACE`, which share a grammar and differ in what a duplicate
 * key does. Exactly one of `values`, `set` and `query` is the source of rows.
 *
 * Four spellings of a row list are one shape here — `VALUES (1)`,
 * `VALUE (1)`, `VALUES ROW(1)` and the empty `VALUES ()` — because they are
 * one thing; `INSERT … SELECT`, `INSERT … TABLE u` and `INSERT … (SELECT …)`
 * are a query.
 */
export interface InsertNode {
  readonly kind: typeof STATEMENT.INSERT
  /** `REPLACE`: a row with a duplicate key replaces the old one. */
  readonly replace?: boolean
  readonly priority?: 'LOW_PRIORITY' | 'DELAYED' | 'HIGH_PRIORITY'
  readonly ignore?: boolean
  readonly table: TableName
  readonly partitions?: readonly string[]
  /** The column list, when one is written — `()` is an empty one. */
  readonly columns?: readonly ColumnNode[]
  readonly values?: readonly (readonly Expression[])[]
  readonly set?: readonly Assignment[]
  readonly query?: QueryExpression
  /** 8.0.19's `AS new [(a, b)]`, which `ON DUPLICATE KEY UPDATE` refers to. */
  readonly rowAlias?: { readonly name: string; readonly columns?: readonly string[] }
  readonly onDuplicate?: readonly Assignment[]
  readonly at: number
}

/**
 * `UPDATE`. One shape for the single- and multi-table forms: the tables are a
 * list of references either way. `ORDER BY` and `LIMIT` are legal only with
 * one table, which the server checks after parsing (ER_WRONG_USAGE), not the
 * grammar.
 */
export interface UpdateNode {
  readonly kind: typeof STATEMENT.UPDATE
  readonly with?: With
  readonly priority?: 'LOW_PRIORITY'
  readonly ignore?: boolean
  readonly tables: readonly TableReference[]
  readonly set: readonly Assignment[]
  readonly where?: Expression
  readonly orderBy?: readonly OrderItem[]
  /** A row count only: `LIMIT 1, 2` is a syntax error here. */
  readonly limit?: Expression
  readonly at: number
}

/**
 * `DELETE`. A single-table delete names one table in `tables`; a multi-table
 * one also names its `targets` — the tables rows are removed from — and its two
 * spellings, `DELETE t FROM …` and `DELETE FROM t USING …`, are one shape.
 */
export interface DeleteNode {
  readonly kind: typeof STATEMENT.DELETE
  readonly with?: With
  readonly priority?: 'LOW_PRIORITY'
  readonly quick?: boolean
  readonly ignore?: boolean
  readonly targets?: readonly TableName[]
  readonly tables: readonly TableReference[]
  readonly where?: Expression
  readonly orderBy?: readonly OrderItem[]
  readonly limit?: Expression
  readonly at: number
}

export type Statement =
  | CreateTableNode
  | CreateViewNode
  | DropNode
  | QueryExpression
  | InsertNode
  | UpdateNode
  | DeleteNode
