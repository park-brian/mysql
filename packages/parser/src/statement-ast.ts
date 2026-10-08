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
  ALTER_TABLE: 'alterTable',
  CREATE_DATABASE: 'createDatabase',
  CREATE_ROUTINE: 'createRoutine',
  CREATE_TRIGGER: 'createTrigger',
  CREATE_EVENT: 'createEvent',
  CALL: 'callStatement',
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
  // M3.17: administration.
  TABLE_MAINTENANCE: 'tableMaintenance',
  FLUSH: 'flush',
  TRUNCATE: 'truncate',
  LOCK_TABLES: 'lockTables',
  UNLOCK_TABLES: 'unlockTables',
  LOCK_INSTANCE: 'lockInstance',
  UNLOCK_INSTANCE: 'unlockInstance',
  RENAME_TABLE: 'renameTable',
  LOAD_DATA: 'loadData',
  GRANT: 'grant',
  REVOKE: 'revoke',
  CREATE_USER: 'createUser',
  ALTER_USER: 'alterUser',
  DROP_USER: 'dropUser',
  RENAME_USER: 'renameUser',
  CREATE_ROLE: 'createRole',
  DROP_ROLE: 'dropRole',
  SET_PASSWORD: 'setPassword',
  SET_ROLE: 'setRole',
  SET_DEFAULT_ROLE: 'setDefaultRole',
  RESET: 'reset',
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
  readonly partition?: Partitioning
  readonly at: number
}

/**
 * How a table is split, from `PARTITION BY`. Parsed, not executed: partitioning
 * is M8.9's.
 *
 * `HASH` and `RANGE`/`LIST` take an expression, while `KEY` and the `COLUMNS`
 * forms take a list of columns, which may be empty for `KEY ()`, meaning the
 * primary key. Exactly one of `expr` and `columns` is set. The method's
 * algorithm (`KEY ALGORITHM = 1|2`) is the only number the grammar itself
 * bounds.
 */
export interface PartitionMethod {
  readonly linear?: boolean
  readonly method: 'HASH' | 'KEY' | 'RANGE' | 'LIST'
  readonly expr?: Expression
  readonly columns?: readonly string[]
  readonly algorithm?: number
  /** `PARTITIONS n` / `SUBPARTITIONS n`. */
  readonly count?: number
}

export interface Partitioning extends PartitionMethod {
  readonly sub?: PartitionMethod
  readonly partitions?: readonly PartitionDefinition[]
}

/**
 * `PARTITION p VALUES LESS THAN (…)` or `VALUES IN (…)`, with its options and
 * subpartitions. `MAXVALUE` is a keyword node, and `LESS THAN MAXVALUE`
 * without parentheses is the same tree as `LESS THAN (MAXVALUE)`.
 */
export interface PartitionDefinition {
  readonly name: string
  readonly lessThan?: readonly Expression[]
  readonly in?: readonly Expression[]
  readonly options: Readonly<Record<string, string>>
  readonly subpartitions?: readonly { readonly name: string; readonly options: Readonly<Record<string, string>> }[]
}

/** `FIRST` or `AFTER c`: where an added or changed column goes. */
export type ColumnPosition = 'FIRST' | { readonly after: string }

/**
 * One change in an `ALTER TABLE` list.
 *
 * Spellings that are one change are one action: `MODIFY c def` is
 * `CHANGE c c def`, `ADD (a INT, b INT)` is `ADD a INT, ADD b INT`, and
 * `DROP KEY` is `DROP INDEX`. `DROP CHECK` and `DROP CONSTRAINT` are kept
 * apart, because the second drops a constraint of any kind.
 */
export type AlterAction =
  | { readonly type: 'addColumn'; readonly column: ColumnDefinition; readonly position?: ColumnPosition }
  | { readonly type: 'addKey'; readonly key: KeyDefinition }
  | { readonly type: 'addCheck'; readonly check: CheckConstraint }
  | {
      readonly type: 'changeColumn'
      readonly name: string
      readonly column: ColumnDefinition
      readonly position?: ColumnPosition
    }
  | {
      readonly type: 'drop'
      readonly what: 'COLUMN' | 'INDEX' | 'PRIMARY KEY' | 'FOREIGN KEY' | 'CHECK' | 'CONSTRAINT'
      /** Absent only for `PRIMARY KEY`. */
      readonly name?: string
    }
  | { readonly type: 'setDefault'; readonly column: string; readonly value: Expression }
  | { readonly type: 'dropDefault'; readonly column: string }
  | { readonly type: 'columnVisibility'; readonly column: string; readonly visible: boolean }
  | { readonly type: 'indexVisibility'; readonly index: string; readonly visible: boolean }
  | { readonly type: 'enforce'; readonly what: 'CHECK' | 'CONSTRAINT'; readonly name: string; readonly enforced: boolean }
  | { readonly type: 'rename'; readonly to: TableName }
  | { readonly type: 'renameColumn'; readonly from: string; readonly to: string }
  | { readonly type: 'renameIndex'; readonly from: string; readonly to: string }
  | { readonly type: 'orderBy'; readonly columns: readonly { readonly name: string; readonly desc?: true }[] }
  /** `CONVERT TO CHARACTER SET cs [COLLATE c]`. `charset` is absent for `DEFAULT`. */
  | { readonly type: 'convert'; readonly charset?: string; readonly collation?: string }
  | { readonly type: 'keys'; readonly enable: boolean }
  | { readonly type: 'force' }
  | { readonly type: 'tablespace'; readonly action: 'DISCARD' | 'IMPORT' }

/**
 * `ALTER TABLE`, and `CREATE INDEX`, which MySQL executes as one: `CREATE
 * INDEX i ON t (a)` is the tree of `ALTER TABLE t ADD INDEX i (a)`.
 *
 * Table options (`ENGINE = …`, `COMMENT = …`) are kept apart from the actions
 * in `options`, keyed as `CreateTableNode`'s are. `ALGORITHM` and `LOCK` say
 * how the server should make the change, not what the change is, and are read
 * and not kept, as `DROP INDEX` already does.
 */
export interface AlterTableNode {
  readonly kind: typeof STATEMENT.ALTER_TABLE
  readonly table: TableName
  readonly actions: readonly AlterAction[]
  readonly options: Readonly<Record<string, string>>
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

/** `CREATE DATABASE`, with its options keyed by canonical upper-case name. */
export interface CreateDatabaseNode {
  readonly kind: typeof STATEMENT.CREATE_DATABASE
  readonly name: string
  readonly ifNotExists?: boolean
  readonly options: Readonly<Record<string, string>>
  readonly at: number
}

// --- M3.8: stored programs, accepted and stored ------------------------------

/**
 * A stored program's body, kept as the source text it was written in.
 *
 * M3.8 accepts and stores and does not execute; executing is M8.5's. A body
 * that is one ordinary statement is parsed as well, since a real 8.4 refuses
 * `CREATE PROCEDURE p() garbage`, but only its text is kept. A compound body
 * — `BEGIN … END`, `IF`, `WHILE` and the rest of the stored-program language —
 * is stored without being read, and is the one place this parser accepts SQL
 * it has not checked. The census's wrongly-accepted count would show it if
 * that mattered.
 */
export type RoutineBody = string

export interface RoutineParameter {
  /** `IN`, `OUT` or `INOUT` — a procedure's only; absent means `IN`. */
  readonly mode?: 'IN' | 'OUT' | 'INOUT'
  readonly name: string
  readonly type: DataType
}

/**
 * `CREATE PROCEDURE` and `CREATE FUNCTION`.
 *
 * The characteristics are a bag in any order, repeats allowed, and the last
 * one written wins. `deterministic` and `dataAccess` are absent when not
 * written, which is not the same as their defaults.
 */
export interface CreateRoutineNode {
  readonly kind: typeof STATEMENT.CREATE_ROUTINE
  readonly object: 'PROCEDURE' | 'FUNCTION'
  readonly name: TableName
  readonly definer?: Definer
  readonly ifNotExists?: boolean
  readonly parameters: readonly RoutineParameter[]
  /** A function's `RETURNS` type. */
  readonly returns?: DataType
  readonly comment?: string
  readonly deterministic?: boolean
  readonly dataAccess?: 'CONTAINS SQL' | 'NO SQL' | 'READS SQL DATA' | 'MODIFIES SQL DATA'
  readonly security?: 'DEFINER' | 'INVOKER'
  readonly body: RoutineBody
  readonly at: number
}

export interface CreateTriggerNode {
  readonly kind: typeof STATEMENT.CREATE_TRIGGER
  readonly name: TableName
  readonly definer?: Definer
  readonly ifNotExists?: boolean
  readonly timing: 'BEFORE' | 'AFTER'
  readonly event: 'INSERT' | 'UPDATE' | 'DELETE'
  readonly table: TableName
  /** `FOLLOWS t` / `PRECEDES t`: where it runs among the table's other triggers. */
  readonly order?: { readonly position: 'FOLLOWS' | 'PRECEDES'; readonly trigger: string }
  readonly body: RoutineBody
  readonly at: number
}

/** `AT t [+ INTERVAL …]`, or `EVERY n unit [STARTS t] [ENDS t]`. */
export type EventSchedule =
  | { readonly at: Expression }
  | { readonly every: Expression; readonly unit: string; readonly starts?: Expression; readonly ends?: Expression }

export interface CreateEventNode {
  readonly kind: typeof STATEMENT.CREATE_EVENT
  readonly name: TableName
  readonly definer?: Definer
  readonly ifNotExists?: boolean
  readonly schedule: EventSchedule
  /** `ON COMPLETION [NOT] PRESERVE`; absent leaves the default, which is `NOT PRESERVE`. */
  readonly preserve?: boolean
  readonly status?: 'ENABLE' | 'DISABLE' | 'DISABLE ON REPLICA'
  readonly comment?: string
  readonly body: RoutineBody
  readonly at: number
}

/** `CALL p` and `CALL p()`, which are one statement. */
export interface CallStatementNode {
  readonly kind: typeof STATEMENT.CALL
  readonly name: TableName
  readonly args: readonly Expression[]
  readonly at: number
}

/** What a `DROP` names. `TABLE` and `VIEW` may name several at once. */
export const DROP_OBJECT = {
  TABLE: 'TABLE',
  VIEW: 'VIEW',
  INDEX: 'INDEX',
  DATABASE: 'DATABASE',
  PROCEDURE: 'PROCEDURE',
  FUNCTION: 'FUNCTION',
  TRIGGER: 'TRIGGER',
  EVENT: 'EVENT',
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
 * `PREPARE s FROM 'text'` or `PREPARE s FROM @v`. The text is a single string
 * literal: a real 8.4 refuses an introducer, adjacent literals and any other
 * expression here.
 */
export type PrepareNode = {
  readonly kind: typeof STATEMENT.PREPARE
  readonly name: string
  readonly at: number
} & ({ readonly text: string } | { readonly variable: string })

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

// --- M3.17: administration ------------------------------------------------------
//
// Parsed in full and stored as written; what they *do* is the executor's call.
// Every acceptance and refusal below was put to a real 8.4.11 first.

/** An account: `'u'@'h'`, `u@h` or `'u'`. A role is named the same way. */
export interface Account {
  readonly user: string
  readonly host?: string
}

/** An account, or the session's own: `CURRENT_USER`, `CURRENT_USER()`. */
export type AccountOrCurrent = 'CURRENT_USER' | Account

/**
 * `ANALYZE`/`CHECK`/`CHECKSUM`/`OPTIMIZE`/`REPAIR TABLE t, …`, one node with
 * the verb in `op`. `TABLE` and `TABLES` are one spelling.
 */
export interface TableMaintenanceNode {
  readonly kind: typeof STATEMENT.TABLE_MAINTENANCE
  readonly op: 'ANALYZE' | 'CHECK' | 'CHECKSUM' | 'OPTIMIZE' | 'REPAIR'
  /** `NO_WRITE_TO_BINLOG` or its synonym `LOCAL` (not `CHECK`, not `CHECKSUM`). */
  readonly noWriteToBinlog?: boolean
  readonly tables: readonly TableName[]
  /**
   * The option words, in order, repeats kept: `CHECK`'s `FOR UPGRADE`,
   * `QUICK`, `FAST`, `MEDIUM`, `EXTENDED`, `CHANGED`; `REPAIR`'s `QUICK`,
   * `EXTENDED`, `USE_FRM`; `CHECKSUM`'s one `QUICK` or `EXTENDED`.
   */
  readonly options?: readonly string[]
  /** `ANALYZE TABLE … UPDATE|DROP HISTOGRAM ON c, …`. */
  readonly histogram?: Histogram
  readonly at: number
}

export type Histogram =
  | {
      readonly action: 'UPDATE'
      readonly columns: readonly string[]
      readonly buckets?: string
      /** `AUTO UPDATE` or `MANUAL UPDATE`. */
      readonly update?: 'AUTO' | 'MANUAL'
    }
  | { readonly action: 'UPDATE'; readonly columns: readonly string[]; readonly data: string }
  | { readonly action: 'DROP'; readonly columns: readonly string[] }

/**
 * `FLUSH [NO_WRITE_TO_BINLOG | LOCAL] option, …`, or the `TABLES` form, which
 * stands alone: `FLUSH TABLES t, PRIVILEGES` flushes a *table* named
 * `PRIVILEGES`.
 */
export type FlushNode = {
  readonly kind: typeof STATEMENT.FLUSH
  readonly noWriteToBinlog?: boolean
  readonly at: number
} & (
  | {
      /** `BINARY LOGS`, `PRIVILEGES`, `RELAY LOGS` and the rest, as written in upper case. */
      readonly options: readonly FlushOption[]
    }
  | {
      readonly tables: readonly TableName[]
      /** `WITH READ LOCK`, or `FOR EXPORT` (which needs tables). */
      readonly lock?: 'READ' | 'EXPORT'
    }
)

export interface FlushOption {
  readonly option: string
  /** `RELAY LOGS FOR CHANNEL 'c'`. */
  readonly channel?: string
}

/** `TRUNCATE [TABLE] t`. */
export interface TruncateNode {
  readonly kind: typeof STATEMENT.TRUNCATE
  readonly table: TableName
  readonly at: number
}

/** `LOCK TABLES t [AS a] READ [LOCAL] | WRITE, …`. */
export interface LockTablesNode {
  readonly kind: typeof STATEMENT.LOCK_TABLES
  readonly tables: readonly LockedTable[]
  readonly at: number
}

export interface LockedTable {
  readonly table: TableName
  readonly alias?: string
  readonly lock: 'READ' | 'READ LOCAL' | 'WRITE'
}

/** `UNLOCK TABLES`, `LOCK INSTANCE FOR BACKUP`, `UNLOCK INSTANCE`. */
export interface UnlockTablesNode {
  readonly kind: typeof STATEMENT.UNLOCK_TABLES | typeof STATEMENT.LOCK_INSTANCE | typeof STATEMENT.UNLOCK_INSTANCE
  readonly at: number
}

/** `RENAME TABLE a TO b, c TO d`. */
export interface RenameTableNode {
  readonly kind: typeof STATEMENT.RENAME_TABLE
  readonly pairs: readonly { readonly from: TableName; readonly to: TableName }[]
  readonly at: number
}

/**
 * `LOAD DATA` and `LOAD XML`, clause for clause. A field or line delimiter is a
 * string, hex or bit literal, kept as the expression the literal parses to.
 */
export interface LoadDataNode {
  readonly kind: typeof STATEMENT.LOAD_DATA
  readonly format: 'DATA' | 'XML'
  readonly priority?: 'LOW_PRIORITY' | 'CONCURRENT'
  readonly local?: boolean
  /** `INFILE`, `URL` or `S3`, with `FROM` before it or not — one spelling. */
  readonly source: 'INFILE' | 'URL' | 'S3'
  readonly file: string
  readonly count?: string
  readonly inPrimaryKeyOrder?: boolean
  readonly duplicates?: 'REPLACE' | 'IGNORE'
  readonly table: TableName
  readonly partitions?: readonly string[]
  readonly charset?: string
  readonly rowsIdentifiedBy?: string
  /** `FIELDS` (or `COLUMNS`) sub-options in order; a repeat is legal and kept. */
  readonly fields?: readonly LoadDelimiter[]
  /** `LINES` sub-options in order. */
  readonly lines?: readonly LoadDelimiter[]
  /** `IGNORE n LINES` (or `ROWS`, the same). */
  readonly ignoreLines?: string
  /** `(a, @b)`: columns and user variables; `()` is an empty list. */
  readonly columns?: readonly (ColumnNode | { readonly variable: string })[]
  readonly set?: readonly Assignment[]
  readonly parallel?: string
  readonly memory?: string
  readonly algorithm?: 'BULK'
  readonly at: number
}

export interface LoadDelimiter {
  /** `TERMINATED`, `ENCLOSED`, `OPTIONALLY ENCLOSED`, `ESCAPED` or `STARTING`. */
  readonly what: string
  readonly value: Expression
}

/** A privilege as `GRANT` and `REVOKE` name one. */
export type Privilege =
  /** A static privilege — `SELECT`, `CREATE TEMPORARY TABLES` — with columns or not. */
  | { readonly privilege: string; readonly columns?: readonly string[] }
  /** Any other name: a dynamic privilege (`BACKUP_ADMIN`) or, with no `ON`, a role. */
  | { readonly name: string; readonly host?: string }

/** What `ON` names: `*.*`, `*`, `db.*`, or a table or routine. */
export type PrivilegeLevel =
  | { readonly level: 'global' }
  | { readonly level: 'default' }
  | { readonly level: 'schema'; readonly schema: string }
  | { readonly level: 'object'; readonly name: TableName }

export type GrantNode = {
  readonly kind: typeof STATEMENT.GRANT
  readonly at: number
} & (
  | {
      readonly privileges: readonly Privilege[]
      readonly objectType?: 'TABLE' | 'FUNCTION' | 'PROCEDURE'
      readonly on: PrivilegeLevel
      readonly to: readonly AccountOrCurrent[]
      readonly withGrantOption?: boolean
      readonly as?: AccountOrCurrent
      readonly withRole?: RoleSpec
    }
  | {
      readonly proxy: AccountOrCurrent
      readonly to: readonly AccountOrCurrent[]
      readonly withGrantOption?: boolean
    }
  | { readonly roles: readonly Account[]; readonly to: readonly AccountOrCurrent[]; readonly withAdminOption?: boolean }
)

export type RevokeNode = {
  readonly kind: typeof STATEMENT.REVOKE
  readonly ifExists?: boolean
  readonly from: readonly AccountOrCurrent[]
  readonly ignoreUnknownUser?: boolean
  readonly at: number
} & (
  | { readonly privileges: readonly Privilege[]; readonly objectType?: 'TABLE' | 'FUNCTION' | 'PROCEDURE'; readonly on: PrivilegeLevel }
  /** `REVOKE ALL [PRIVILEGES], GRANT OPTION FROM …`. */
  | { readonly all: true }
  | { readonly proxy: AccountOrCurrent }
  | { readonly roles: readonly Account[] }
)

/** `DEFAULT`, `NONE`, `ALL [EXCEPT r, …]` or a list of roles. */
export type RoleSpec =
  | { readonly which: 'DEFAULT' | 'NONE' }
  | { readonly which: 'ALL'; readonly except?: readonly Account[] }
  | { readonly roles: readonly Account[] }

/** One way of authenticating, as `IDENTIFIED …` writes it. */
export interface Identification {
  readonly plugin?: string
  /** `BY 'password'`. */
  readonly password?: string
  /** `BY RANDOM PASSWORD`. */
  readonly random?: boolean
  /** `AS 'hash'`. */
  readonly hash?: string
}

export interface UserSpec {
  readonly account: AccountOrCurrent
  /** `IDENTIFIED …`, then `AND IDENTIFIED …` for each further factor. */
  readonly auth?: readonly Identification[]
  /** `ALTER USER`'s `REPLACE 'current'`. */
  readonly replace?: string
  readonly retainCurrentPassword?: boolean
  readonly discardOldPassword?: boolean
}

/** Everything after the users in `CREATE USER` and `ALTER USER`. */
export interface AccountOptions {
  /** `REQUIRE NONE`, `SSL`, `X509`, or `ISSUER`/`SUBJECT`/`CIPHER` values. */
  readonly require?: 'NONE' | 'SSL' | 'X509' | readonly { readonly what: 'ISSUER' | 'SUBJECT' | 'CIPHER'; readonly value: string }[]
  /** `WITH MAX_QUERIES_PER_HOUR n …`, in order. */
  readonly resources?: readonly { readonly name: string; readonly value: string }[]
  /** `PASSWORD EXPIRE …`, `ACCOUNT LOCK`, `FAILED_LOGIN_ATTEMPTS n` and the rest, in order, as written in upper case. */
  readonly passwordOptions?: readonly string[]
  readonly comment?: string
  readonly attribute?: string
}

export interface CreateUserNode extends AccountOptions {
  readonly kind: typeof STATEMENT.CREATE_USER
  readonly ifNotExists?: boolean
  readonly users: readonly UserSpec[]
  readonly defaultRoles?: readonly Account[]
  readonly at: number
}

export type AlterUserNode = {
  readonly kind: typeof STATEMENT.ALTER_USER
  readonly ifExists?: boolean
  readonly at: number
} & (
  | (AccountOptions & { readonly users: readonly UserSpec[] })
  /** `ALTER USER USER() IDENTIFIED BY …`: the session's own account. */
  | { readonly self: UserSpec }
  | { readonly user: AccountOrCurrent; readonly defaultRole: RoleSpec }
)

/** `DROP USER` and `DROP ROLE`. */
export interface DropUserNode {
  readonly kind: typeof STATEMENT.DROP_USER | typeof STATEMENT.DROP_ROLE
  readonly ifExists?: boolean
  readonly users: readonly AccountOrCurrent[]
  readonly at: number
}

export interface CreateRoleNode {
  readonly kind: typeof STATEMENT.CREATE_ROLE
  readonly ifNotExists?: boolean
  readonly roles: readonly Account[]
  readonly at: number
}

export interface RenameUserNode {
  readonly kind: typeof STATEMENT.RENAME_USER
  readonly pairs: readonly { readonly from: AccountOrCurrent; readonly to: AccountOrCurrent }[]
  readonly at: number
}

/** `SET PASSWORD [FOR u] = 'p' | TO RANDOM [REPLACE 'c'] [RETAIN CURRENT PASSWORD]`. */
export interface SetPasswordNode {
  readonly kind: typeof STATEMENT.SET_PASSWORD
  readonly for?: AccountOrCurrent
  /** The new password; absent for `TO RANDOM`. */
  readonly password?: string
  readonly replace?: string
  readonly retainCurrentPassword?: boolean
  readonly at: number
}

export interface SetRoleNode {
  readonly kind: typeof STATEMENT.SET_ROLE
  readonly role: RoleSpec
  readonly at: number
}

/** `SET DEFAULT ROLE NONE | ALL | r, … TO u, …`. */
export interface SetDefaultRoleNode {
  readonly kind: typeof STATEMENT.SET_DEFAULT_ROLE
  readonly role: RoleSpec
  readonly to: readonly AccountOrCurrent[]
  readonly at: number
}

/**
 * `RESET PERSIST [[IF EXISTS] name]`, or `RESET` replication state:
 * `REPLICA [ALL] [FOR CHANNEL 'c']` and `BINARY LOGS AND GTIDS [TO n]`, which
 * may be listed together.
 */
export type ResetNode = {
  readonly kind: typeof STATEMENT.RESET
  readonly at: number
} & (
  | { readonly persist: true; readonly ifExists?: boolean; readonly name?: string }
  | {
      readonly options: readonly (
        | { readonly option: 'REPLICA'; readonly all?: boolean; readonly channel?: string }
        | { readonly option: 'BINARY LOGS AND GTIDS'; readonly to?: string }
      )[]
    }
)

export type Statement =
  | CreateTableNode
  | CreateViewNode
  | AlterTableNode
  | CreateDatabaseNode
  | CreateRoutineNode
  | CreateTriggerNode
  | CreateEventNode
  | CallStatementNode
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
  | TableMaintenanceNode
  | FlushNode
  | TruncateNode
  | LockTablesNode
  | UnlockTablesNode
  | RenameTableNode
  | LoadDataNode
  | GrantNode
  | RevokeNode
  | CreateUserNode
  | AlterUserNode
  | DropUserNode
  | CreateRoleNode
  | RenameUserNode
  | SetPasswordNode
  | SetRoleNode
  | SetDefaultRoleNode
  | ResetNode
