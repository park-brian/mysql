// SHOW COLUMNS (and DESCRIBE) and SHOW INDEX, as MySQL 8 runs them: as a
// query over INFORMATION_SCHEMA (sql/dd/info_schema/show.cc). The view's
// columns are renamed in a derived table — `COLUMN_NAME AS Field`, `INDEX_NAME
// AS Key_name` — and the outer query filters it by the database and the table,
// by LIKE on the first column, and by the statement's own WHERE, which names
// the renamed columns (`SHOW KEYS FROM t WHERE Key_name = 'k'`). So the result
// columns and their metadata are the view's, as the server's are, and the
// table must exist first (1146).
//
// A key's cardinality is what the table's statistics say, through the
// server's cache of them (`cardinalities` in stats.ts, M5.45).
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { requireSchema } from './scope.ts'
import { and } from './ast.ts'
import { proof } from './errors.ts'
import { parseStatement, type Expression, type QueryExpression, type ShowNode, type TableName, quoteName } from '@myjs/parser'
import type { ColumnDefinition } from '@myjs/protocol'
import type { TableDef, ViewDef } from '@myjs/engine'
import { defaultDatabase, planViewQuery, type Run } from './query.ts'
import { viewDefinition } from './view-text.ts'
import type { CatalogApi } from './temporary.ts'

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** The query a SHOW COLUMNS, SHOW INDEX or DESCRIBE stands for. */
export function showQuery(run: Run, catalog: CatalogApi, node: ShowNode): QueryExpression {
  const name = node.name as TableName
  const schema = requireSchema(node.database ?? name.schema ?? defaultDatabase(run))
  // The database first, then the table (8.4.11: 1049 before 1146).
  catalog.schema(schema)
  if (catalog.view(schema, name.name) === undefined) catalog.definition(schema, name.name)
  const where = `\`Database\` = ${quote(schema)} AND \`Table\` = ${quote(name.name)}`
  const text =
    node.what === 'INDEX'
      ? `SELECT \`Table\`, \`Non_unique\`, \`Key_name\`, \`Seq_in_index\`, \`Column_name\`, \`Collation\`, \`Cardinality\`, \`Sub_part\`, \`Packed\`, \`Null\`, \`Index_type\`, \`Comment\`, \`Index_comment\`, \`Visible\`, \`Expression\` FROM (SELECT TABLE_SCHEMA AS \`Database\`, TABLE_NAME AS \`Table\`, NON_UNIQUE AS \`Non_unique\`, INDEX_NAME AS \`Key_name\`, SEQ_IN_INDEX AS \`Seq_in_index\`, COLUMN_NAME AS \`Column_name\`, COLLATION AS \`Collation\`, CARDINALITY AS \`Cardinality\`, SUB_PART AS \`Sub_part\`, PACKED AS \`Packed\`, NULLABLE AS \`Null\`, INDEX_TYPE AS \`Index_type\`, COMMENT AS \`Comment\`, INDEX_COMMENT AS \`Index_comment\`, IS_VISIBLE AS \`Visible\`, EXPRESSION AS \`Expression\` FROM information_schema.STATISTICS) AS \`SHOW_STATISTICS\` WHERE ${where}`
      : `SELECT \`Field\`, \`Type\`, ${node.full === true ? '`Collation`, ' : ''}\`Null\`, \`Key\`, \`Default\`, \`Extra\`${node.full === true ? ', `Privileges`, `Comment`' : ''} FROM (SELECT TABLE_SCHEMA AS \`Database\`, TABLE_NAME AS \`Table\`, COLUMN_NAME AS \`Field\`, COLUMN_TYPE AS \`Type\`, COLLATION_NAME AS \`Collation\`, IS_NULLABLE AS \`Null\`, COLUMN_KEY AS \`Key\`, COLUMN_DEFAULT AS \`Default\`, EXTRA AS \`Extra\`, PRIVILEGES AS \`Privileges\`, COLUMN_COMMENT AS \`Comment\`, ORDINAL_POSITION AS \`Ordinal_position\` FROM information_schema.COLUMNS) AS \`COLUMNS\` WHERE ${where}${node.like === undefined ? '' : ` AND \`Field\` LIKE ${quote(node.like)}`} ORDER BY \`Ordinal_position\``
  // The statement's own WHERE, beside the database and the table.
  return withWhere(parseStatement(text) as QueryExpression, node.where)
}

/** SHOW TABLE STATUS's columns, each INFORMATION_SCHEMA.TABLES's, renamed. */
const TABLE_STATUS = [
  ['Name', 'TABLE_NAME'], ['Engine', 'ENGINE'], ['Version', 'VERSION'], ['Row_format', 'ROW_FORMAT'], ['Rows', 'TABLE_ROWS'],
  ['Avg_row_length', 'AVG_ROW_LENGTH'], ['Data_length', 'DATA_LENGTH'], ['Max_data_length', 'MAX_DATA_LENGTH'], ['Index_length', 'INDEX_LENGTH'],
  ['Data_free', 'DATA_FREE'], ['Auto_increment', 'AUTO_INCREMENT'], ['Create_time', 'CREATE_TIME'], ['Update_time', 'UPDATE_TIME'],
  ['Check_time', 'CHECK_TIME'], ['Collation', 'TABLE_COLLATION'], ['Checksum', 'CHECKSUM'], ['Create_options', 'CREATE_OPTIONS'], ['Comment', 'TABLE_COMMENT'],
] as const

/**
 * The query a SHOW TABLE STATUS stands for (M5.13), over
 * INFORMATION_SCHEMA.TABLES, filtered by the database and LIKE on the name,
 * in the names' order, its columns renamed. A statement's own WHERE names the
 * renamed columns, so it filters a derived table instead, and there 8.4.11
 * leaves the rows in the view's order: its sort is inside the derived table,
 * and dropped with it, which its column metadata shows too.
 */
export function tableStatusQuery(run: Run, catalog: CatalogApi, node: ShowNode): QueryExpression {
  const schema = requireSchema(node.database ?? defaultDatabase(run))
  catalog.schema(schema)
  const renamed = TABLE_STATUS.map(([name, column]) => `${column} AS \`${name}\``).join(', ')
  const like = node.like === undefined ? '' : ` AND TABLE_NAME LIKE ${quote(node.like)}`
  if (node.where === undefined) return parseStatement(`SELECT ${renamed} FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quote(schema)}${like} ORDER BY \`Name\``) as QueryExpression
  const names = TABLE_STATUS.map(([name]) => `\`${name}\``).join(', ')
  const query = parseStatement(`SELECT ${names} FROM (SELECT TABLE_SCHEMA AS \`Db\`, ${renamed} FROM information_schema.TABLES) AS \`TABLES\` WHERE \`Db\` = ${quote(schema)}${like.replace('TABLE_NAME', '`Name`')}`) as QueryExpression
  return withWhere(query, node.where)
}

/**
 * The query a SHOW VARIABLES or SHOW STATUS stands for (M5.13): its
 * PERFORMANCE_SCHEMA table renamed in a derived table, filtered by LIKE on
 * the name, case-insensitively as the table's collation compares, and by the
 * statement's own WHERE, which names the renamed columns. `table` names it.
 */
export function variablesQuery(node: ShowNode): { query: QueryExpression; table: string } {
  const table = `${node.scope === 'GLOBAL' ? 'global' : 'session'}_${node.what === 'STATUS' ? 'status' : 'variables'}`
  const like = node.like === undefined ? '' : ` WHERE \`Variable_name\` LIKE ${quote(node.like)}`
  const query = parseStatement(`SELECT \`Variable_name\`, \`Value\` FROM (SELECT VARIABLE_NAME AS \`Variable_name\`, VARIABLE_VALUE AS \`Value\` FROM performance_schema.${table}) AS \`${table}\`${like}`) as QueryExpression
  return { query: withWhere(query, node.where), table }
}

/** `query` with `where` beside its own WHERE, if it has one. */
function withWhere(query: QueryExpression, where: Expression | undefined): QueryExpression {
  if (where === undefined || query.body.kind !== 'select') return query
  const own = query.body.where
  return { ...query, body: { ...query.body, where: and(own, where) } }
}

/** SHOW VARIABLES' and SHOW STATUS's columns, as 8.4.11 describes them: its PERFORMANCE_SCHEMA table's, renamed. */
export function variablesColumns(table: string, resultsCollation: number, mbmaxlen: number): ColumnDefinition[] {
  const column = (name: string, chars: number, flags: number): ColumnDefinition => ({ schema: 'performance_schema', table, orgTable: table, name, orgName: name, characterSet: resultsCollation, columnLength: chars * mbmaxlen, type: 253, flags, decimals: 0 })
  return [column('Variable_name', 64, 4097), column('Value', 1024, 0)]
}

/** The server's SHOW view columns, with lengths in characters for text. */
type Shown = readonly [length: number, flags: number, type?: number, orgTable?: string]

const COLUMNS_SHOWN: Readonly<Record<string, Shown>> = {
  Field: [64, 0],
  Type: [16777215, 4241, 252, 'columns'],
  Collation: [64, 0],
  Null: [3, 1],
  Key: [3, 4481, 254, 'columns'],
  Default: [65535, 144, 252, 'columns'],
  Extra: [256, 0],
  Privileges: [154, 0],
  Comment: [6144, 145, 252],
}

const INDEX_SHOWN: readonly Shown[] = [
  [64, 4225, 253, 'tables'],
  [2, 1, 3],
  [64, 0],
  [10, 4129, 3, 'index_column_usage'],
  [64, 0],
  [1, 0],
  [21, 0, 8],
  [21, 0, 8],
  // Packed is the NULL literal, which no table holds.
  [0, 128, 6],
  [3, 1],
  [11, 129],
  [8, 1],
  [2048, 4225, 253, 'indexes'],
  [3, 1],
  [4294967295, 144, 252],
]

/** The column definitions a SHOW COLUMNS or SHOW INDEX answers with, in the results' collation. */
export function shownColumns(node: ShowNode, names: readonly string[], resultsCollation: number, mbmaxlen: number): ColumnDefinition[] {
  const index = node.what === 'INDEX'
  return names.map((name, i) => {
    const [length, flags, type = FIELD_TYPE.VAR_STRING, orgTable = ''] = (index ? INDEX_SHOWN[i] : COLUMNS_SHOWN[name])!
    const literal = type === FIELD_TYPE.NULL
    const text = type === FIELD_TYPE.BLOB || type === FIELD_TYPE.VAR_STRING || type === FIELD_TYPE.STRING
    return {
      schema: '', table: literal ? '' : index ? 'SHOW_STATISTICS' : 'COLUMNS', orgTable, name, orgName: literal ? '' : name,
      characterSet: text ? resultsCollation : CHARSET_BINARY, columnLength: text ? Math.min(4294967295, length * mbmaxlen) : length, type, flags, decimals: 0,
    }
  })
}

/**
 * What a view's text names, for printing it: a table's definition, or a
 * view's columns as a table's would be (8.4.11 prints `select v.id AS id …
 * from v` for a view over a view).
 */
function printableSources(catalog: CatalogApi): (schema: string, name: string) => TableDef | undefined {
  return (schema, name) => {
    const view = catalog.view(schema, name)
    if (view !== undefined) return { schema, name, columns: (view.columns ?? []).map((c) => ({ name: c })) } as unknown as TableDef
    return proof(() => catalog.definition(schema, name))
  }
}

/** Bind the original view and render its select list for either catalog view. */
export function printedView(run: Run, view: ViewDef, catalog = run.catalog, current?: string | null) {
  return proof(() => {
    const { query, plan } = planViewQuery(run, view)
    const tables = catalog === undefined ? () => undefined : printableSources(catalog)
    return { query, text: viewDefinition(query, plan.columns.map((c) => c.name), view.database ?? view.schema, tables, view.query, current) }
  })
}

/** SHOW CREATE VIEW's statement: the view as 8.4.11 writes it back, names in the current database unqualified. */
export function showCreateView(run: Run, catalog: CatalogApi, view: ViewDef): string {
  const current = defaultDatabase(run)
  const text = printedView(run, view, catalog, current)?.text
  const q = quoteName
  const [user, host] = (view.definer ?? 'root@%').split('@') as [string, string | undefined]
  const name = view.schema === current ? q(view.name) : `${q(view.schema)}.${q(view.name)}`
  const columns = view.listed === true && view.columns !== undefined ? ` (${view.columns.map(q).join(',')})` : ''
  const check = view.checkOption === undefined ? '' : ` WITH ${view.checkOption} CHECK OPTION`
  return `CREATE ALGORITHM=${view.algorithm ?? 'UNDEFINED'} DEFINER=${q(user)}@${q(host ?? '%')} SQL SECURITY ${view.security ?? 'DEFINER'} VIEW ${name}${columns} AS ${text ?? view.query}${check}`
}
