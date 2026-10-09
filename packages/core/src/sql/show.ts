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
import { expectTyped } from '@myjs/bytes'
import { NODE, STATEMENT, parseStatement, type Expression, type QueryExpression, type ShowNode, type TableName, quoteName } from '@myjs/parser'
import { messages, sqlError, type ColumnDefinition } from '@myjs/protocol'
import type { TableDef, ViewDef } from '@myjs/engine'
import { planViewQuery, type Run } from './query.ts'
import { viewDefinition } from './view-text.ts'
import type { CatalogApi } from './temporary.ts'

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** The query a SHOW COLUMNS, SHOW INDEX or DESCRIBE stands for. */
export function showQuery(run: Run, catalog: CatalogApi, node: ShowNode): QueryExpression {
  const name = node.name as TableName
  const schema = node.database ?? name.schema ?? run.env.session.database
  if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
  // The database first, then the table (8.4.11: 1049 before 1146).
  catalog.schema(schema)
  if (catalog.view(schema, name.name) === undefined) catalog.definition(schema, name.name)
  const where = `\`Database\` = ${quote(schema)} AND \`Table\` = ${quote(name.name)}`
  const text =
    node.what === 'INDEX'
      ? `SELECT \`Table\`, \`Non_unique\`, \`Key_name\`, \`Seq_in_index\`, \`Column_name\`, \`Collation\`, \`Cardinality\`, \`Sub_part\`, \`Packed\`, \`Null\`, \`Index_type\`, \`Comment\`, \`Index_comment\`, \`Visible\`, \`Expression\` FROM (SELECT TABLE_SCHEMA AS \`Database\`, TABLE_NAME AS \`Table\`, NON_UNIQUE AS \`Non_unique\`, INDEX_NAME AS \`Key_name\`, SEQ_IN_INDEX AS \`Seq_in_index\`, COLUMN_NAME AS \`Column_name\`, COLLATION AS \`Collation\`, CARDINALITY AS \`Cardinality\`, SUB_PART AS \`Sub_part\`, PACKED AS \`Packed\`, NULLABLE AS \`Null\`, INDEX_TYPE AS \`Index_type\`, COMMENT AS \`Comment\`, INDEX_COMMENT AS \`Index_comment\`, IS_VISIBLE AS \`Visible\`, EXPRESSION AS \`Expression\` FROM information_schema.STATISTICS) AS \`SHOW_STATISTICS\` WHERE ${where}`
      : `SELECT \`Field\`, \`Type\`, ${node.full === true ? '`Collation`, ' : ''}\`Null\`, \`Key\`, \`Default\`, \`Extra\`${node.full === true ? ', `Privileges`, `Comment`' : ''} FROM (SELECT TABLE_SCHEMA AS \`Database\`, TABLE_NAME AS \`Table\`, COLUMN_NAME AS \`Field\`, COLUMN_TYPE AS \`Type\`, COLLATION_NAME AS \`Collation\`, IS_NULLABLE AS \`Null\`, COLUMN_KEY AS \`Key\`, COLUMN_DEFAULT AS \`Default\`, EXTRA AS \`Extra\`, PRIVILEGES AS \`Privileges\`, COLUMN_COMMENT AS \`Comment\`, ORDINAL_POSITION AS \`Ordinal_position\` FROM information_schema.COLUMNS) AS \`COLUMNS\` WHERE ${where}${node.like === undefined ? '' : ` AND \`Field\` LIKE ${quote(node.like)}`} ORDER BY \`Ordinal_position\``
  const query = parseStatement(text) as QueryExpression
  if (node.where === undefined || query.kind !== STATEMENT.QUERY || query.body.kind !== 'select') return query
  // The statement's own WHERE, beside the database and the table.
  const own = query.body.where as Expression
  return { ...query, body: { ...query.body, where: { kind: NODE.BINARY, op: 'AND', left: own, right: node.where, at: own.at } } }
}

/**
 * The result columns as the server describes them: its SHOW views' own
 * definitions, not a derived table's (8.4.11, through `mysql2`). Each is
 * [table, original table, name, original name, characters of text or
 * `undefined` for a number, length of a number, type, flags]; text is as
 * long as its characters in the results' charset, as every text column is.
 */
type Shown = readonly [string, string, string, string, number | undefined, number, number, number]

const COLUMNS_SHOWN: Readonly<Record<string, Shown>> = {
  Field: ['COLUMNS', '', 'Field', 'Field', 64, 0, 253, 0],
  Type: ['COLUMNS', 'columns', 'Type', 'Type', 16777215, 0, 252, 4241],
  Collation: ['COLUMNS', '', 'Collation', 'Collation', 64, 0, 253, 0],
  Null: ['COLUMNS', '', 'Null', 'Null', 3, 0, 253, 1],
  Key: ['COLUMNS', 'columns', 'Key', 'Key', 3, 0, 254, 4481],
  Default: ['COLUMNS', 'columns', 'Default', 'Default', 65535, 0, 252, 144],
  Extra: ['COLUMNS', '', 'Extra', 'Extra', 256, 0, 253, 0],
  Privileges: ['COLUMNS', '', 'Privileges', 'Privileges', 154, 0, 253, 0],
  Comment: ['COLUMNS', '', 'Comment', 'Comment', 6144, 0, 252, 145],
}

const INDEX_SHOWN: readonly Shown[] = [
  ['SHOW_STATISTICS', 'tables', 'Table', 'Table', 64, 0, 253, 4225],
  ['SHOW_STATISTICS', '', 'Non_unique', 'Non_unique', undefined, 2, 3, 1],
  ['SHOW_STATISTICS', '', 'Key_name', 'Key_name', 64, 0, 253, 0],
  ['SHOW_STATISTICS', 'index_column_usage', 'Seq_in_index', 'Seq_in_index', undefined, 10, 3, 4129],
  ['SHOW_STATISTICS', '', 'Column_name', 'Column_name', 64, 0, 253, 0],
  ['SHOW_STATISTICS', '', 'Collation', 'Collation', 1, 0, 253, 0],
  ['SHOW_STATISTICS', '', 'Cardinality', 'Cardinality', undefined, 21, 8, 0],
  ['SHOW_STATISTICS', '', 'Sub_part', 'Sub_part', undefined, 21, 8, 0],
  // NULL, which no table holds.
  ['', '', 'Packed', '', undefined, 0, 6, 128],
  ['SHOW_STATISTICS', '', 'Null', 'Null', 3, 0, 253, 1],
  ['SHOW_STATISTICS', '', 'Index_type', 'Index_type', 11, 0, 253, 129],
  ['SHOW_STATISTICS', '', 'Comment', 'Comment', 8, 0, 253, 1],
  ['SHOW_STATISTICS', 'indexes', 'Index_comment', 'Index_comment', 2048, 0, 253, 4225],
  ['SHOW_STATISTICS', '', 'Visible', 'Visible', 3, 0, 253, 1],
  ['SHOW_STATISTICS', '', 'Expression', 'Expression', 4294967295, 0, 252, 144],
]

/** The column definitions a SHOW COLUMNS or SHOW INDEX answers with, in the results' collation. */
export function shownColumns(node: ShowNode, names: readonly string[], resultsCollation: number, mbmaxlen: number): ColumnDefinition[] {
  return names.map((name, i) => {
    const shown = node.what === 'INDEX' ? (INDEX_SHOWN[i] as Shown) : (COLUMNS_SHOWN[name] as Shown)
    const [table, orgTable, , orgName, chars, length, type, flags] = shown
    const text = chars !== undefined
    return { schema: '', table, orgTable, name, orgName, characterSet: text ? resultsCollation : 63, columnLength: text ? Math.min(4294967295, chars * mbmaxlen) : length, type, flags, decimals: 0 }
  })
}

/**
 * What a view's text names, for printing it: a table's definition, or a
 * view's columns as a table's would be (8.4.11 prints `select v.id AS id …
 * from v` for a view over a view).
 */
export function printableSources(catalog: CatalogApi): (schema: string, name: string) => TableDef | undefined {
  return (schema, name) => {
    const view = catalog.view(schema, name)
    if (view !== undefined) return { schema, name, columns: (view.columns ?? []).map((c) => ({ name: c })) } as unknown as TableDef
    try {
      return catalog.definition(schema, name)
    } catch (e) {
      expectTyped(e)
      return undefined
    }
  }
}

/** SHOW CREATE VIEW's statement: the view as 8.4.11 writes it back, names in the current database unqualified. */
export function showCreateView(run: Run, catalog: CatalogApi, view: ViewDef): string {
  const current = run.env.session.database
  let text: string | undefined
  try {
    const { query, plan } = planViewQuery(run, view)
    text = viewDefinition(query, plan.columns.map((c) => c.name), view.database ?? view.schema, printableSources(catalog), view.query, current)
  } catch (e) {
    expectTyped(e)
  }
  const q = quoteName
  const [user, host] = (view.definer ?? 'root@%').split('@') as [string, string | undefined]
  const name = view.schema === current ? q(view.name) : `${q(view.schema)}.${q(view.name)}`
  const columns = view.listed === true && view.columns !== undefined ? ` (${view.columns.map(q).join(',')})` : ''
  const check = view.checkOption === undefined ? '' : ` WITH ${view.checkOption} CHECK OPTION`
  return `CREATE ALGORITHM=${view.algorithm ?? 'UNDEFINED'} DEFINER=${q(user)}@${q(host ?? '%')} SQL SECURITY ${view.security ?? 'DEFINER'} VIEW ${name}${columns} AS ${text ?? view.query}${check}`
}
