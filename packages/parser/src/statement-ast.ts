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
import type { Expression } from './ast.ts'
import type { DataType } from './data-type.ts'

export const STATEMENT = {
  CREATE_TABLE: 'createTable',
  DROP: 'drop',
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
  /** A `COLLATE` clause written after the column's other attributes. */
  readonly collation?: string
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

export type Statement = CreateTableNode | DropNode
