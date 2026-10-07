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
import type { ColumnNode, Expression, KeywordNode } from './ast.ts'
import type { DataType } from './data-type.ts'
import type { Limit, OrderItem, QueryExpression, TableReference, With } from './query-ast.ts'

export const STATEMENT = {
  CREATE_TABLE: 'createTable',
  CREATE_VIEW: 'createView',
  DROP: 'drop',
  /** A query as a statement: `SELECT`, `WITH`, `VALUES`, `TABLE`, `(…)`. */
  QUERY: 'query',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
  SET: 'set',
  SET_TRANSACTION: 'setTransaction',
  USE: 'use',
  SHOW: 'show',
  EXPLAIN: 'explain',
  DESCRIBE: 'describe',
  START_TRANSACTION: 'startTransaction',
  COMMIT: 'commit',
  ROLLBACK: 'rollback',
  SAVEPOINT: 'savepoint',
  RELEASE_SAVEPOINT: 'releaseSavepoint',
  PREPARE: 'prepare',
  EXECUTE: 'execute',
  DEALLOCATE: 'deallocate',
  DO: 'do',
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

// --- M3.6: the statements that drive a session rather than its data ---------

/**
 * Where a system variable is set. `LOCAL` is `SESSION`, and is recorded as it.
 * `PERSIST` sets the global value and writes it to `mysqld-auto.cnf`;
 * `PERSIST_ONLY` does the writing without the setting.
 */
export type VariableScope = 'GLOBAL' | 'SESSION' | 'PERSIST' | 'PERSIST_ONLY'

/**
 * One assignment in a `SET` list.
 *
 * Three targets, because MySQL has three and they behave differently:
 *
 *   - `user` — `@a`, a user variable. Its value is any expression; `DEFAULT`
 *     and `ON` are syntax errors there.
 *   - `system` — `@@x`, `@@global.x`, `GLOBAL x`, and a bare name written
 *     after a scope keyword. Its value may also be one of the keywords
 *     `DEFAULT`, `ON`, `ALL`, `BINARY`, `ROW` and `SYSTEM`, recorded as a
 *     keyword node.
 *   - `name` — a bare name with no scope in force. At top level it is a
 *     system variable at the default scope, but in a stored program it is a
 *     local variable first, so the parser does not decide which.
 *
 * **The scope keyword is sticky and the `@@` form is not**, which a real
 * 8.4.11 settles: after `SET GLOBAL a = 1, b = 2` both are global, while after
 * `SET GLOBAL a = 1, @@b = 2` and `SET @@global.a = 1, b = 2`, `b` is not.
 * Stickiness depends only on the text, so the parser resolves it, and every
 * `system` item records the scope it actually has. Deparsing always writes
 * the `@@scope.x` form, which is never sticky, so the output cannot
 * re-scope a later item.
 *
 * `base` is the first part of a two-part name: a key cache in
 * `default.key_buffer_size`, or a component in `validate_password.length`.
 */
export type SetItem =
  | { readonly type: 'user'; readonly name: string; readonly value: Expression }
  | {
      readonly type: 'system'
      readonly scope?: VariableScope
      readonly base?: string
      readonly name: string
      readonly value: Expression | KeywordNode
    }
  | { readonly type: 'name'; readonly base?: string; readonly name: string; readonly value: Expression | KeywordNode }
  /** `SET NAMES cs [COLLATE c]`. `charset` is absent for `SET NAMES DEFAULT`. */
  | { readonly type: 'names'; readonly charset?: string; readonly collation?: string }
  /** `SET CHARACTER SET cs` and `SET CHARSET cs`. Absent for `DEFAULT`. */
  | { readonly type: 'charset'; readonly charset?: string }

export interface SetNode {
  readonly kind: typeof STATEMENT.SET
  readonly items: readonly SetItem[]
  readonly at: number
}

export type IsolationLevel = 'REPEATABLE READ' | 'READ COMMITTED' | 'READ UNCOMMITTED' | 'SERIALIZABLE'
export type AccessMode = 'READ ONLY' | 'READ WRITE'

/**
 * `SET [scope] TRANSACTION …`. It stands alone: a real 8.4 refuses it inside
 * an assignment list, either before or after the other items. Each
 * characteristic may be given at most once, so the order they were written in
 * carries no meaning and is not kept.
 */
export interface SetTransactionNode {
  readonly kind: typeof STATEMENT.SET_TRANSACTION
  /** Absent means the next transaction only, which is neither `SESSION` nor `GLOBAL`. */
  readonly scope?: VariableScope
  readonly isolation?: IsolationLevel
  readonly access?: AccessMode
  readonly at: number
}

export interface UseNode {
  readonly kind: typeof STATEMENT.USE
  readonly database: string
  readonly at: number
}

/**
 * `SHOW …`. One node for every form, because they are one statement shape:
 * something to list, then optionally where it lives and how to filter it.
 *
 * `what` is canonical, so synonyms that mean the same thing produce the same
 * tree: `FIELDS` is `COLUMNS`, `INDEXES` and `KEYS` are `INDEX`, `SCHEMAS` is
 * `DATABASES`, `CHARSET` is `CHARACTER SET`, and `STORAGE ENGINES` is
 * `ENGINES`. `IN` is `FROM`. `SHOW COLUMNS FROM t FROM db` and
 * `SHOW COLUMNS FROM db.t` are the same tree too. When both are written, the
 * `FROM db` wins, which a real 8.4 shows: `SHOW COLUMNS FROM mysql.t1 FROM test`
 * lists `test.t1`.
 */
export interface ShowNode {
  readonly kind: typeof STATEMENT.SHOW
  readonly what: string
  readonly full?: boolean
  readonly extended?: boolean
  /** `GLOBAL` or `SESSION` for `VARIABLES` and `STATUS`. `LOCAL` is `SESSION`. */
  readonly scope?: 'GLOBAL' | 'SESSION'
  /** `SHOW COUNT(*) WARNINGS`. */
  readonly count?: boolean
  /** The object named: `SHOW CREATE TABLE t`, `SHOW COLUMNS FROM t`. */
  readonly name?: TableName
  /** `SHOW TABLES FROM db` and the other forms that take a database. */
  readonly database?: string
  readonly ifNotExists?: boolean
  /** `SHOW GRANTS FOR u` and `SHOW CREATE USER u`. */
  readonly user?: Definer
  readonly like?: string
  readonly where?: Expression
  readonly limit?: Limit
  readonly at: number
}

/** What an `EXPLAIN` may explain. */
export type ExplainableStatement = QueryExpression | InsertNode | UpdateNode | DeleteNode

/**
 * `EXPLAIN`, `DESCRIBE` and `DESC` in front of a statement, all one thing.
 * Exactly one of `statement` and `connection` is set.
 */
export interface ExplainNode {
  readonly kind: typeof STATEMENT.EXPLAIN
  readonly analyze?: boolean
  /** `FORMAT = TREE`, upper-cased, since `tree`, `'tree'` and `TREE` name one format. */
  readonly format?: string
  /** `INTO @v` — the user variable that receives the plan. */
  readonly into?: string
  /** `FOR SCHEMA db` / `FOR DATABASE db` (8.4): the default database to explain in. */
  readonly schema?: string
  readonly statement?: ExplainableStatement
  /** `FOR CONNECTION n`: explain what another connection is running. */
  readonly connection?: bigint
  readonly at: number
}

/**
 * `DESCRIBE t [col]`, which is `SHOW COLUMNS FROM t` by another name. The
 * column may be written as a name or as a string, and either way it is a
 * `LIKE` pattern, so both spellings are one tree.
 */
export interface DescribeNode {
  readonly kind: typeof STATEMENT.DESCRIBE
  readonly table: TableName
  readonly column?: string
  readonly at: number
}

/**
 * `START TRANSACTION …` and `BEGIN [WORK]`, which is the same statement with
 * no characteristics. Repeating a characteristic is legal and changes
 * nothing, while `READ ONLY` together with `READ WRITE` is a syntax error.
 */
export interface StartTransactionNode {
  readonly kind: typeof STATEMENT.START_TRANSACTION
  readonly consistentSnapshot?: boolean
  readonly access?: AccessMode
  readonly at: number
}

/**
 * `COMMIT` and `ROLLBACK`'s shared tail.
 *
 * `chain` and `release` are tri-state. Absent means `completion_type`
 * decides, while `AND NO CHAIN` and `NO RELEASE` override it explicitly, so
 * `false` is not the same as absent. `AND CHAIN RELEASE` together is a syntax
 * error.
 */
export interface CommitNode {
  readonly kind: typeof STATEMENT.COMMIT
  readonly chain?: boolean
  readonly release?: boolean
  readonly at: number
}

/** `ROLLBACK`, or `ROLLBACK TO [SAVEPOINT] sp`, which takes no `CHAIN` or `RELEASE`. */
export interface RollbackNode {
  readonly kind: typeof STATEMENT.ROLLBACK
  readonly chain?: boolean
  readonly release?: boolean
  readonly savepoint?: string
  readonly at: number
}

export interface SavepointNode {
  readonly kind: typeof STATEMENT.SAVEPOINT | typeof STATEMENT.RELEASE_SAVEPOINT
  readonly name: string
  readonly at: number
}

/**
 * `PREPARE s FROM 'text'` or `PREPARE s FROM @v`. Exactly one of `text` and
 * `variable` is set. The text is a single string literal: a real 8.4 refuses
 * an introducer, adjacent literals and any other expression here.
 */
export interface PrepareNode {
  readonly kind: typeof STATEMENT.PREPARE
  readonly name: string
  readonly text?: string
  readonly variable?: string
  readonly at: number
}

/** `EXECUTE s [USING @a, @b]`. Only user variables may be passed. */
export interface ExecuteNode {
  readonly kind: typeof STATEMENT.EXECUTE
  readonly name: string
  readonly using?: readonly string[]
  readonly at: number
}

/** `DEALLOCATE PREPARE s` and `DROP PREPARE s`. */
export interface DeallocateNode {
  readonly kind: typeof STATEMENT.DEALLOCATE
  readonly name: string
  readonly at: number
}

export interface DoNode {
  readonly kind: typeof STATEMENT.DO
  readonly exprs: readonly Expression[]
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
  | SetNode
  | SetTransactionNode
  | UseNode
  | ShowNode
  | ExplainNode
  | DescribeNode
  | StartTransactionNode
  | CommitNode
  | RollbackNode
  | SavepointNode
  | PrepareNode
  | ExecuteNode
  | DeallocateNode
  | DoNode
