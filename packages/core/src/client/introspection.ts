// M5.13 — doc 42's introspection methods: `db.schemas()`, `tables()`,
// `columns()`, `explain()` and `stats()`. Each is a query through the client,
// as doc 42's first rule asks, over what 8.4.11 answers the same questions
// with: INFORMATION_SCHEMA, EXPLAIN FORMAT=TREE, SHOW GLOBAL STATUS and
// INNODB_METRICS. So what they report is what a migration tool reading those
// tables directly would see.
import type { QueryOptions, QueryResult } from './api.ts'

/** A function that runs one statement as `db.query()` does. */
type Query = (sql: string | QueryOptions, values?: readonly unknown[]) => Promise<QueryResult<unknown>>

export interface TableInfo {
  readonly name: string
  readonly type: 'BASE TABLE' | 'VIEW'
  /** `InnoDB` or `MEMORY`; `null` for a view. */
  readonly engine: string | null
  readonly collation: string | null
  readonly comment: string
}

export interface ColumnInfo {
  readonly name: string
  /** 1-based, in the table's order. */
  readonly position: number
  /** As CREATE TABLE writes it: `varchar(20)`, `int unsigned`, `enum('a','b')`. */
  readonly type: string
  readonly nullable: boolean
  /** The default as INFORMATION_SCHEMA gives it, `null` for none. */
  readonly default: string | null
  readonly key: '' | 'PRI' | 'UNI' | 'MUL'
  /** `auto_increment`, `DEFAULT_GENERATED`, `VIRTUAL GENERATED` and their like. */
  readonly extra: string
  readonly collation: string | null
  readonly comment: string
}

export interface DatabaseStats {
  /** The buffer pool, in pages of `pageSize` bytes, and its traffic since the database opened. */
  readonly bufferPool: {
    readonly pages: number
    readonly dataPages: number
    readonly dirtyPages: number
    readonly freePages: number
    readonly readRequests: number
    readonly reads: number
    readonly pagesFlushed: number
  }
  readonly pageSize: number
  /** Committed transactions whose undo purge has not freed yet. */
  readonly historyLength: number
  readonly uptime: number
  readonly questions: number
  readonly connections: number
}

const rows = async <T>(query: Query, sql: string, values?: readonly unknown[]): Promise<T[]> => (await query(sql, values))[0] as T[]

/** Every schema, as SHOW DATABASES lists them. */
export async function schemas(query: Query): Promise<string[]> {
  return (await rows<{ name: string }>(query, 'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME')).map((r) => r.name)
}

/** A schema's tables and views, by name; the session's database when none is named. */
export async function tables(query: Query, schema?: string): Promise<TableInfo[]> {
  return rows<TableInfo>(
    query,
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) ORDER BY TABLE_NAME',
    [schema ?? null],
  )
}

/** A table's or a view's columns, in its order. */
export async function columns(query: Query, schema: string, table: string): Promise<ColumnInfo[]> {
  const found = await rows<Omit<ColumnInfo, 'nullable'> & { nullable: string }>(
    query,
    'SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS position, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS `default`, COLUMN_KEY AS `key`, EXTRA AS extra, COLLATION_NAME AS collation, COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [schema, table],
  )
  return found.map((c) => ({ ...c, nullable: c.nullable === 'YES' }))
}

/** The plan a statement would run, as EXPLAIN FORMAT=TREE prints it. */
export async function explain(query: Query, sql: string, values?: readonly unknown[]): Promise<string> {
  const [row] = await rows<{ EXPLAIN: string }>(query, `EXPLAIN FORMAT=TREE ${sql}`, values)
  return row?.EXPLAIN ?? ''
}

/** The buffer pool, the history of committed transactions, and the server's counters. */
export async function stats(query: Query): Promise<DatabaseStats> {
  const status = new Map((await rows<{ Variable_name: string; Value: string }>(query, 'SHOW GLOBAL STATUS')).map((r) => [r.Variable_name, Number(r.Value)]))
  const [history] = await rows<{ n: number }>(query, "SELECT COUNT AS n FROM information_schema.INNODB_METRICS WHERE NAME = 'trx_rseg_history_len'")
  const of = (name: string): number => status.get(name) ?? 0
  return {
    bufferPool: {
      pages: of('Innodb_buffer_pool_pages_total'),
      dataPages: of('Innodb_buffer_pool_pages_data'),
      dirtyPages: of('Innodb_buffer_pool_pages_dirty'),
      freePages: of('Innodb_buffer_pool_pages_free'),
      readRequests: of('Innodb_buffer_pool_read_requests'),
      reads: of('Innodb_buffer_pool_reads'),
      pagesFlushed: of('Innodb_buffer_pool_pages_flushed'),
    },
    pageSize: of('Innodb_page_size'),
    historyLength: Number(history?.n ?? 0),
    uptime: of('Uptime'),
    questions: of('Questions'),
    connections: of('Connections'),
  }
}
