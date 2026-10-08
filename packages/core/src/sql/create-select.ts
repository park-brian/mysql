// M5.30 — CREATE TABLE … LIKE and CREATE TABLE … SELECT, as 8.4.11 makes them.
//
// LIKE copies a table's definition: its columns, keys, FULLTEXT keys and
// CHECK constraints (renamed `<table>_chk_<n>`, as new ones are), its
// comment; not its foreign keys, and not its AUTO_INCREMENT counter.
//
// … SELECT makes a column of each column the query returns, after the ones
// the statement declares that the query does not name; a declared column the
// query names keeps its declaration, in the query's place. A column read
// straight from a table is that column again, its AUTO_INCREMENT gone and a
// default of 0 in its place. Anything else takes the type its result has —
// text past 512 characters as TEXT, NULL as VARBINARY(0) — and, when it is
// never NULL, NOT NULL with the default of nothing: 0, '' or none for a
// temporal (`create_tmp_field`). The rows are then the INSERT … SELECT of
// them, IGNORE and REPLACE included, and a statement that fails leaves no
// table behind.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import type { TableDef, TableSpec } from '@myjs/engine'
import { parseStatement, type ColumnDefinition, type CreateTableNode } from '@myjs/parser'
import type { CheckDef } from './checks.ts'
import { checksOf } from './checks.ts'
import type { ResultType } from './meta.ts'
import type { Run } from './query.ts'
import { columnLine } from './show-create.ts'

/** LIKE's copy of `source`, named `name`. */
export function likeSpec(source: TableDef, name: string): TableSpec {
  const { foreignKeys: _fks, checks: _checks, autoIncrement: _counter, ...options } = source.options as Record<string, unknown>
  const checks: CheckDef[] = checksOf(source).map((c, i) => ({ ...c, name: `${name}_chk_${i + 1}` }))
  return {
    name,
    engine: source.engine,
    columns: source.columns,
    indexes: source.indexes.map(({ indexId: _id, ...i }) => i),
    options: { ...options, ...(checks.length > 0 ? { checks } : {}) },
  }
}

/** Past this many characters a string result makes a TEXT or BLOB column (`CONVERT_IF_BIGGER_TO_BLOB`). */
const BLOB_AFTER = 512

/**
 * The column type a result makes, as DDL text, and what NOT NULL defaults it
 * to. An integer is an INT or a BIGINT by its width alone: a function's is a
 * BIGINT past 11 characters, a literal's from 10, since a literal's field is
 * made by `create_tmp_field_from_item` and a function's by its own
 * `tmp_table_field` (8.4.11: `2147483647` is BIGINT, `-2147483648`, a
 * negation, INT).
 */
function typeOf(t: ResultType, literal: boolean): { readonly text: string; readonly zero: string | undefined } {
  switch (t.kind) {
    case 'int':
      if (t.field === FIELD_TYPE.YEAR) return { text: 'year', zero: "'0'" }
      if (t.field === FIELD_TYPE.BIT) return { text: `bit(${t.length})`, zero: "b'0'" }
      return { text: `${t.length >= (literal ? 10 : 12) ? 'bigint' : 'int'}${t.unsigned ? ' unsigned' : ''}`, zero: "'0'" }
    case 'decimal':
      return { text: `decimal(${Math.max(t.length, t.scale, 1)},${t.scale})${t.unsigned ? ' unsigned' : ''}`, zero: "'0'" }
    case 'double':
      return { text: t.field === FIELD_TYPE.FLOAT ? 'float' : 'double', zero: "'0'" }
    case 'datetime':
      if (t.field === FIELD_TYPE.DATE || t.field === FIELD_TYPE.NEWDATE) return { text: 'date', zero: undefined }
      return { text: `${t.field === FIELD_TYPE.TIMESTAMP ? 'timestamp' : 'datetime'}${t.scale > 0 ? `(${t.scale})` : ''}`, zero: undefined }
    case 'time':
      return { text: `time${t.scale > 0 ? `(${t.scale})` : ''}`, zero: undefined }
    case 'json':
      return { text: 'json', zero: undefined }
    case 'null':
      return { text: 'varbinary(0)', zero: undefined }
    case 'bytes':
    case 'string': {
      const binary = t.kind === 'bytes' || t.collationId === CHARSET_BINARY
      const info = binary ? undefined : requireCollationInfo(t.collationId)
      const charset = info === undefined ? '' : ` CHARACTER SET ${info.charset} COLLATE ${info.name}`
      const chars = t.length
      if (t.field === FIELD_TYPE.BLOB || chars > BLOB_AFTER) {
        const bytes = chars * (info?.mbmaxlen ?? 1)
        const size = bytes < 256 ? 'tiny' : bytes < 65536 ? '' : bytes < 16777216 ? 'medium' : 'long'
        return { text: `${size}${binary ? 'blob' : 'text'}${charset}`, zero: undefined }
      }
      const fixed = t.field === FIELD_TYPE.STRING
      return { text: `${binary ? (fixed ? 'binary' : 'varbinary') : fixed ? 'char' : 'varchar'}(${chars})${charset}`, zero: "''" }
    }
  }
}

const quote = (name: string): string => `\`${name.replace(/`/g, '``')}\``

/** A made column's collation, and whether it is one the column names itself: what the DDL text cannot carry. */
export interface Collation {
  readonly collationId: number
  readonly explicit: boolean
}

/**
 * The column definitions a query's result makes, as CREATE TABLE … SELECT
 * makes them: a table's column copied, anything else typed by its result;
 * and, by lower-case name, each text column's collation as it is to be.
 */
export function selectColumns(
  run: Run,
  columns: readonly { readonly name: string; readonly type: ResultType }[],
  literal: (i: number) => boolean,
): { readonly columns: ColumnDefinition[]; readonly collations: ReadonlyMap<string, Collation> } {
  const collations = new Map<string, Collation>()
  const lines = columns.map(({ name, type }, i) => {
    const source = type.column
    if (source !== undefined && source.orgTable !== '' && run.catalog !== undefined) {
      let def: TableDef | undefined
      try {
        def = run.catalog.definition(source.schema, source.orgTable)
      } catch {
        def = undefined
      }
      const column = def?.columns.find((c) => c.name === source.orgName)
      if (def !== undefined && column !== undefined) {
        if (column.type.collationId !== undefined) collations.set(name.toLowerCase(), { collationId: column.type.collationId, explicit: column.attributes?.['explicitCollation'] === true })
        // The column again, under the query's name: no AUTO_INCREMENT, and a 0 in its place.
        const own = column.autoIncrement === true ? { ...column, autoIncrement: false, attributes: { ...column.attributes, default: '0' } } : column
        // Its charset always named, since the new table's default may not be the old one's.
        const named = { ...def, options: { ...def.options, collationId: CHARSET_BINARY } }
        return `${quote(name)} ${columnLine(run, named, own).trim().slice(quote(column.name).length + 1)}`
      }
    }
    if ((type.kind === 'string' || type.kind === 'bytes') && !typeOf(type, false).text.includes('blob')) collations.set(name.toLowerCase(), { collationId: type.kind === 'bytes' ? CHARSET_BINARY : type.collationId, explicit: false })
    const { text, zero } = typeOf(type, literal(i))
    return `${quote(name)} ${text}${type.nullable ? '' : ` NOT NULL${zero === undefined ? '' : ` DEFAULT ${zero}`}`}`
  })
  if (lines.length === 0) return { columns: [], collations }
  return { columns: [...(parseStatement(`CREATE TABLE t (${lines.join(', ')})`) as CreateTableNode).columns], collations }
}

/** The made columns' collations, as the query gave them, over the spec's (a declared column keeps its own). */
export function withCollations(spec: TableSpec, collations: ReadonlyMap<string, Collation>, declared: readonly ColumnDefinition[]): TableSpec {
  const own = new Set(declared.map((c) => c.name.toLowerCase()))
  return {
    ...spec,
    columns: spec.columns.map((c) => {
      const made = collations.get(c.name.toLowerCase())
      if (made === undefined || own.has(c.name.toLowerCase()) || c.type.collationId === undefined) return c
      const { attributes: was, ...rest } = c
      const { explicitCollation: _explicit, ...attributes } = was ?? {}
      return {
        ...rest,
        type: { ...c.type, collationId: made.collationId },
        ...(made.explicit || Object.keys(attributes).length > 0 ? { attributes: { ...attributes, ...(made.explicit ? { explicitCollation: true } : {}) } } : {}),
      }
    }),
  }
}

/** The statement's own columns, and the query's: declared first where the query does not name them, a declaration winning. */
export function mergedColumns(declared: readonly ColumnDefinition[], selected: readonly ColumnDefinition[]): ColumnDefinition[] {
  const named = new Set(selected.map((c) => c.name.toLowerCase()))
  const own = new Map(declared.map((c) => [c.name.toLowerCase(), c]))
  return [...declared.filter((c) => !named.has(c.name.toLowerCase())), ...selected.map((c) => own.get(c.name.toLowerCase()) ?? c)]
}
