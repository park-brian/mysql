// M5.12 — INFORMATION_SCHEMA: the tables an introspecting client reads,
// answered from the catalog.
//
// In 8.4 these are views over the data dictionary, and what a client sees of
// them is partly the dictionary's: a column read straight from it reports
// schema `information_schema`, a computed one does not, and their lengths,
// flags and decimals follow no rule this executor otherwise applies. So each
// column's definition is the one 8.4.11 reports, captured whole by
// `tools/capture-information-schema.mjs` into `information-schema-defs.ts`,
// and a bare reference to it reports exactly that (`ResultType.wire`). What a
// comparison needs is ordinary: names compare in `utf8mb3_bin` (with
// `lower_case_table_names=0`, case-sensitively), column and index names in
// `utf8mb3_tolower_ci`, each as captured.
//
// Each table is a derived source like a view, whose rows are computed from the
// catalog when the statement reads them. Statistics and clocks — row counts,
// sizes, times, cardinality — are answered as a fresh table has them; the
// corpus does not compare them, since two runs of one server disagree.
//
// The rows are the ones the corpus showed, column by column: COLUMN_TYPE's
// text, a default as the column stores it (`'0.00'` for DECIMAL(10,2)),
// EXTRA's `DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)`, COLUMN_KEY from
// the same key flags a column's metadata carries.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { collationInfoByName, requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, TableDef, ViewDef } from '@myjs/engine'
import { parseExpression, type TableName } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { COERCIBILITY, decodeField, encodeField, intValue, stringValue, toText, type Value } from '@myjs/types'
import { compile, EMPTY_SCOPE } from './compile.ts'
import type { DerivedSource } from './from.ts'
import { keyCardinalities, printableSources } from './show.ts'
import { fulltextOf } from './fulltext.ts'
import { checkClause, checksOf } from './checks.ts'
import { foreignKeysOf } from './foreign-keys.ts'
import { INFORMATION_SCHEMA, type InformationSchemaColumn } from './information-schema-defs.ts'
import { datetimeType, intType, keyFlags, NULL_TYPE, stringType, type ResultType } from './meta.ts'
import { planViewQuery, type Run } from './query.ts'
import { viewDefinition, viewUpdatable } from './view-text.ts'
import { generationOf, printGeneration } from './generated.ts'

const COLUMN_FLAG = { PRI_KEY: 2, UNIQUE_KEY: 4, MULTIPLE_KEY: 8 } as const

/** Whether a name is INFORMATION_SCHEMA's, compared as MySQL compares a schema name there. */
export const isInformationSchema = (schema: string): boolean => schema.toLowerCase() === 'information_schema'

/** The ResultType of one captured column: what expressions over it compute with, and what a bare reference reports. */
function typeOf(c: InformationSchemaColumn, table: string, alias: string): ResultType {
  const nullable = (c.flags & 1) === 0
  const unsigned = (c.flags & 32) !== 0
  let base: ResultType
  if (c.text) {
    const id = c.collation === null ? 255 : (collationInfoByName(c.collation)?.id ?? 255)
    const chars = Math.max(1, Math.ceil(c.length / 4))
    const blob = c.type >= FIELD_TYPE.TINY_BLOB && c.type <= FIELD_TYPE.BLOB
    base = { ...stringType(chars, id, nullable), field: c.type, coercibility: COERCIBILITY.IMPLICIT, ...(blob ? { blobBytes: chars } : {}) }
  } else if (c.type === FIELD_TYPE.NULL) base = NULL_TYPE
  else if (c.type === FIELD_TYPE.TIMESTAMP || c.type === FIELD_TYPE.DATETIME) base = datetimeType(FIELD_TYPE.DATETIME, 0, nullable)
  else base = { ...intType(c.length, nullable, unsigned), field: c.type }
  const wire = { field: c.type, length: c.length, flags: c.flags, decimals: c.decimals, text: c.text, streamed: c.streamed }
  // A dictionary column is copied through a temporary table as a table column
  // is, keeping its own flags less its key flags; a computed one as an
  // expression (8.4.11, under a sort over the view's join).
  if (c.column) return { ...base, wire, column: { schema: 'information_schema', table: alias, orgTable: table, orgName: c.name, flags: c.flags & ~(1 | 32 | 128) } }
  return { ...base, wire, names: { schema: '', table: alias, orgTable: table, orgName: c.name } }
}

/**
 * An INFORMATION_SCHEMA table, planned for one reference to it, or `undefined`
 * when `name` is not in INFORMATION_SCHEMA. One MySQL has that is not built
 * here is refused by name; one MySQL does not have is its 1109.
 */
export function informationSchemaTable(run: Run, name: TableName, alias: string, database: string | null): { schema: string; source: DerivedSource } | undefined {
  const schema = name.schema ?? database
  if (schema === null || !isInformationSchema(schema)) return undefined
  const table = name.name.toUpperCase()
  const defs = INFORMATION_SCHEMA[table]
  if (defs === undefined) {
    if (KNOWN.has(table)) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`INFORMATION_SCHEMA.${table}`))
    throw sqlError('ER_UNKNOWN_TABLE', `Unknown table '${name.name}' in information_schema`)
  }
  const rowsOf = ROWS[table] as (run: Run) => Iterable<readonly Value[]>
  const columns = defs.map((c) => ({ name: c.name, type: typeOf(c, table, alias) }))
  // Each string in its column's own collation, so a comparison is made in it.
  const collations = columns.map((c) => (c.type.kind === 'string' ? c.type.collationId : undefined))
  return {
    schema: 'information_schema',
    source: {
      joined: true,
      columns,
      rows: () => [...rowsOf(run)].map((row) => row.map((v, i) => (v !== null && v.kind === 'string' && collations[i] !== undefined ? stringValue(v.v, collations[i] as number, COERCIBILITY.IMPLICIT) : v))),
    },
  }
}

/** The INFORMATION_SCHEMA tables of 8.4 that are not answered here yet. */
const KNOWN = new Set([
  'ADMINISTRABLE_ROLE_AUTHORIZATIONS', 'APPLICABLE_ROLES', 'CHARACTER_SETS', 'COLLATIONS', 'COLLATION_CHARACTER_SET_APPLICABILITY', 'COLUMN_PRIVILEGES', 'COLUMN_STATISTICS',
  'COLUMNS_EXTENSIONS', 'ENABLED_ROLES', 'ENGINES', 'EVENTS', 'FILES', 'INNODB_BUFFER_PAGE', 'INNODB_TABLES', 'INNODB_COLUMNS', 'INNODB_INDEXES', 'KEYWORDS', 'OPTIMIZER_TRACE',
  'PARAMETERS', 'PARTITIONS', 'PLUGINS', 'PROCESSLIST', 'PROFILING', 'RESOURCE_GROUPS', 'ROLE_COLUMN_GRANTS', 'ROLE_ROUTINE_GRANTS', 'ROLE_TABLE_GRANTS', 'SCHEMA_PRIVILEGES',
  'SCHEMATA_EXTENSIONS', 'ST_GEOMETRY_COLUMNS', 'ST_SPATIAL_REFERENCE_SYSTEMS', 'ST_UNITS_OF_MEASURE', 'TABLES_EXTENSIONS', 'TABLE_CONSTRAINTS_EXTENSIONS', 'TABLE_PRIVILEGES',
  'TABLESPACES_EXTENSIONS', 'TRIGGERS', 'USER_ATTRIBUTES', 'USER_PRIVILEGES', 'VIEW_ROUTINE_USAGE', 'VIEW_TABLE_USAGE',
])

// --- values -------------------------------------------------------------------------

const TEXT = 33 // utf8mb3_general_ci: what the rows are made in; each column's own collation is its type's.
const s = (v: string | null): Value => (v === null ? null : stringValue(v, TEXT, COERCIBILITY.IMPLICIT))
const n = (v: number | bigint | null): Value => (v === null ? null : intValue(BigInt(v)))

function schemaNames(run: Run): string[] {
  return (run.catalog?.schemas() ?? []).map((x) => x.name)
}

function tablesOf(run: Run, schema: string): TableDef[] {
  return run.catalog?.tables(schema) ?? []
}

function viewsOf(run: Run, schema: string): ViewDef[] {
  return run.catalog?.views(schema) ?? []
}

const ENGINE: Readonly<Record<string, string>> = { native: 'InnoDB', memory: 'MEMORY' }

const collationName = (id: number): string => requireCollationInfo(id).name
const charsetName = (id: number): string => requireCollationInfo(id).charset

/** The table's collation: its own, as CREATE TABLE resolved it. */
export function tableCollation(def: TableDef): number {
  const id = def.options['collationId']
  return typeof id === 'number' ? id : 255
}

// --- COLUMNS -------------------------------------------------------------------------

const INTEGER_NAMES: Readonly<Record<number, [string, number, number]>> = {
  // [name, NUMERIC_PRECISION signed, unsigned]
  [FIELD_TYPE.TINY]: ['tinyint', 3, 3],
  [FIELD_TYPE.SHORT]: ['smallint', 5, 5],
  [FIELD_TYPE.INT24]: ['mediumint', 7, 7],
  [FIELD_TYPE.LONG]: ['int', 10, 10],
  [FIELD_TYPE.LONGLONG]: ['bigint', 19, 20],
}

const BLOB_NAMES: Readonly<Record<number, [string, string, number]>> = {
  [FIELD_TYPE.TINY_BLOB]: ['tinytext', 'tinyblob', 255],
  [FIELD_TYPE.BLOB]: ['text', 'blob', 65535],
  [FIELD_TYPE.MEDIUM_BLOB]: ['mediumtext', 'mediumblob', 16777215],
  [FIELD_TYPE.LONG_BLOB]: ['longtext', 'longblob', 4294967295],
}

const ZEROFILL_WIDTH: Readonly<Record<number, number>> = { [FIELD_TYPE.TINY]: 3, [FIELD_TYPE.SHORT]: 5, [FIELD_TYPE.INT24]: 8, [FIELD_TYPE.LONG]: 10, [FIELD_TYPE.LONGLONG]: 20 }

interface ColumnFacts {
  readonly dataType: string
  readonly columnType: string
  readonly charMax: number | null
  readonly octets: number | null
  readonly precision: number | null
  readonly scale: number | null
  readonly datetimePrecision: number | null
  readonly collationId: number | null
}

/** What COLUMNS says of a column's type, as 8.4.11 says it. */
export function typeFacts(column: ColumnDef): ColumnFacts {
  const t = column.type
  const none = { charMax: null, octets: null, precision: null, scale: null, datetimePrecision: null, collationId: null }
  const unsigned = t.unsigned === true ? ' unsigned' : ''
  const zerofill = column.attributes?.['zerofill'] === true
  // ZEROFILL with no width written has the type's own: its unsigned digits (8.4.11: `bigint(20) unsigned zerofill`).
  const width = column.attributes?.['width'] ?? (zerofill ? ZEROFILL_WIDTH[t.type] : undefined)
  const integer = INTEGER_NAMES[t.type]
  if (integer !== undefined) {
    // Only ZEROFILL and the boolean TINYINT(1) keep their width in COLUMN_TYPE.
    const shown = typeof width === 'number' && (zerofill || (t.type === FIELD_TYPE.TINY && width === 1 && t.unsigned !== true)) ? `(${width})` : ''
    return { ...none, dataType: integer[0], columnType: `${integer[0]}${shown}${unsigned}${zerofill ? ' zerofill' : ''}`, precision: t.unsigned === true ? integer[2] : integer[1], scale: 0 }
  }
  const text = t.collationId !== undefined && t.collationId !== CHARSET_BINARY
  const mb = text ? requireCollationInfo(t.collationId as number).mbmaxlen : 1
  switch (t.type) {
    case FIELD_TYPE.NEWDECIMAL:
    case FIELD_TYPE.DECIMAL:
      return { ...none, dataType: 'decimal', columnType: `decimal(${t.precision ?? 10},${t.scale ?? 0})${unsigned}`, precision: t.precision ?? 10, scale: t.scale ?? 0 }
    case FIELD_TYPE.DOUBLE:
    case FIELD_TYPE.FLOAT: {
      // FLOAT(M,D) shows its M and D, as the precision and scale (8.4.11).
      const name = t.type === FIELD_TYPE.FLOAT ? 'float' : 'double'
      const fixed = t.precision !== undefined && t.scale !== undefined
      const columnType = `${name}${fixed ? `(${t.precision},${t.scale})` : ''}${unsigned}${zerofill ? ' zerofill' : ''}`
      return { ...none, dataType: name, columnType, precision: fixed ? (t.precision as number) : name === 'float' ? 12 : 22, scale: fixed ? (t.scale as number) : null }
    }
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE:
      return { ...none, dataType: 'date', columnType: 'date' }
    case FIELD_TYPE.YEAR:
      return { ...none, dataType: 'year', columnType: 'year' }
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIME: {
      const name = t.type === FIELD_TYPE.DATETIME ? 'datetime' : t.type === FIELD_TYPE.TIMESTAMP ? 'timestamp' : 'time'
      const fsp = t.decimals ?? 0
      return { ...none, dataType: name, columnType: fsp > 0 ? `${name}(${fsp})` : name, datetimePrecision: fsp }
    }
    case FIELD_TYPE.BIT:
      return { ...none, dataType: 'bit', columnType: `bit(${t.bits ?? 1})`, precision: t.bits ?? 1 }
    case FIELD_TYPE.JSON:
      return { ...none, dataType: 'json', columnType: 'json' }
    case FIELD_TYPE.ENUM:
    case FIELD_TYPE.SET: {
      const members = t.members ?? []
      const name = t.type === FIELD_TYPE.ENUM ? 'enum' : 'set'
      const longest = t.type === FIELD_TYPE.ENUM ? Math.max(0, ...members.map((m) => [...m].length)) : members.reduce((sum, m) => sum + [...m].length, 0) + Math.max(0, members.length - 1)
      const listed = members.map((m) => `'${m.replace(/'/g, "''")}'`).join(',')
      return { ...none, dataType: name, columnType: `${name}(${listed})`, charMax: longest, octets: longest * mb, collationId: t.collationId ?? null }
    }
    case FIELD_TYPE.STRING:
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.VARCHAR: {
      const length = t.length ?? 0
      const name = t.type === FIELD_TYPE.STRING ? (text ? 'char' : 'binary') : text ? 'varchar' : 'varbinary'
      return { ...none, dataType: name, columnType: `${name}(${length})`, charMax: length, octets: length * mb, collationId: text ? (t.collationId as number) : null }
    }
  }
  const blob = BLOB_NAMES[t.type]
  if (blob !== undefined) {
    const name = text ? blob[0] : blob[1]
    // A TEXT's maximum is its bytes, in characters as well (8.4.11: MEDIUMTEXT is 16777215 both).
    return { ...none, dataType: name, columnType: name, charMax: blob[2], octets: blob[2], collationId: text ? (t.collationId as number) : null }
  }
  return { ...none, dataType: 'unknown', columnType: 'unknown' }
}

/** A function default: CURRENT_TIMESTAMP and its synonyms, with the precision it was given. */
export function generatedDefault(text: string): string | undefined {
  const m = /^\s*(CURRENT_TIMESTAMP|NOW|LOCALTIME|LOCALTIMESTAMP)\s*(?:\(\s*(\d*)\s*\))?\s*$/i.exec(text)
  if (m === null) return undefined
  return m[2] === undefined || m[2] === '' ? 'CURRENT_TIMESTAMP' : `CURRENT_TIMESTAMP(${m[2]})`
}

/** COLUMN_DEFAULT: a literal as the column stores it, a function as MySQL names it, else NULL. */
export function columnDefault(run: Run, column: ColumnDef): string | null {
  const text = column.attributes?.['default']
  if (typeof text !== 'string') return null
  const generated = generatedDefault(text)
  if (generated !== undefined) return generated
  try {
    const v = compile(parseExpression(text), { scope: EMPTY_SCOPE, clause: 'default', connectionCollation: run.env.session.characterSet, session: run.env.session, state: run.state, serverVersion: run.serverVersion }).eval([], run.env)
    if (v === null) return null
    const field = encodeField(v, column, { strict: false, row: 1, warnings: 0 })
    const stored = decodeField(field, column.type)
    return stored === null ? null : toText(stored)
  } catch {
    return text
  }
}

function extraOf(column: ColumnDef): string {
  if (column.autoIncrement === true) return 'auto_increment'
  const generation = generationOf(column)
  if (generation !== undefined) return generation.stored ? 'STORED GENERATED' : 'VIRTUAL GENERATED'
  const parts: string[] = []
  const d = column.attributes?.['default']
  if (typeof d === 'string' && generatedDefault(d) !== undefined) parts.push('DEFAULT_GENERATED')
  const u = column.attributes?.['onUpdate']
  if (typeof u === 'string') parts.push(`on update ${generatedDefault(u) ?? u}`)
  return parts.join(' ')
}

function columnKey(def: TableDef, column: ColumnDef): string {
  const f = keyFlags(def, column.name)
  return f & COLUMN_FLAG.PRI_KEY ? 'PRI' : f & COLUMN_FLAG.UNIQUE_KEY ? 'UNI' : f & COLUMN_FLAG.MULTIPLE_KEY ? 'MUL' : ''
}

/** COLUMNS's rows for one table or view, from its columns and what each reports. */
function* columnRows(run: Run, schema: string, table: string, columns: readonly { column: ColumnDef; key: string; extra: string; def: string | null }[]): Generator<readonly Value[]> {
  for (const [i, x] of columns.entries()) {
    const c = x.column
    const f = typeFacts(c)
    const comment = c.attributes?.['comment']
    const generation = generationOf(c)
    yield [
      s('def'), s(schema), s(table), s(c.name), n(i + 1), s(x.def), s(c.nullable ? 'YES' : 'NO'), s(f.dataType), n(f.charMax), n(f.octets), n(f.precision), n(f.scale), n(f.datetimePrecision),
      s(f.collationId === null ? null : charsetName(f.collationId)), s(f.collationId === null ? null : collationName(f.collationId)), s(f.columnType), s(x.key), s(x.extra),
      s('select,insert,update,references'), s(typeof comment === 'string' ? comment : ''), s(generation === undefined ? '' : printGeneration(c, generation).replace(/'/g, "\\'")), null,
    ]
  }
}

/** The base table column a view's column reads, if it reads one. */
function baseColumn(run: Run, t: ResultType): ColumnDef | undefined {
  const c = t.column
  if (c === undefined) return undefined
  return tablesOf(run, c.schema).find((d) => d.name === c.orgTable)?.columns.find((x) => x.name === c.orgName)
}

/** A column for a view's computed one, typed as its temporary field would be. */
function synthesized(t: ResultType): ColumnDef {
  const base = { name: '', nullable: t.nullable }
  switch (t.kind) {
    case 'int':
      return { ...base, type: { type: t.length < 10 ? FIELD_TYPE.LONG : FIELD_TYPE.LONGLONG, ...(t.unsigned ? { unsigned: true } : {}) } }
    case 'decimal':
      return { ...base, type: { type: FIELD_TYPE.NEWDECIMAL, precision: Math.max(1, t.length - (t.scale > 0 ? 1 : 0) - (t.unsigned ? 0 : 1)), scale: t.scale } }
    case 'double':
      return { ...base, type: { type: FIELD_TYPE.DOUBLE } }
    case 'string':
      return { ...base, type: { type: FIELD_TYPE.VAR_STRING, length: t.length, collationId: t.collationId } }
    case 'bytes':
      return { ...base, type: { type: FIELD_TYPE.VAR_STRING, length: t.length, collationId: CHARSET_BINARY } }
    case 'datetime':
    case 'time':
      return { ...base, type: { type: t.field, decimals: t.scale } }
    case 'json':
      return { ...base, type: { type: FIELD_TYPE.JSON } }
    default:
      return { ...base, type: { type: FIELD_TYPE.VAR_STRING, length: 0, collationId: CHARSET_BINARY } }
  }
}

/** A NOT NULL view column's default: a number's zero, as the column stores it; nothing for any other type (8.4.11). */
function zeroOf(run: Run, column: ColumnDef): string | null {
  const t = column.type.type
  const numeric = INTEGER_NAMES[t] !== undefined || t === FIELD_TYPE.NEWDECIMAL || t === FIELD_TYPE.DECIMAL || t === FIELD_TYPE.DOUBLE || t === FIELD_TYPE.FLOAT
  return numeric ? columnDefault(run, { ...column, attributes: { default: '0' } }) : null
}

// --- the tables -----------------------------------------------------------------------

function* everyTable(run: Run): Generator<{ schema: string; def: TableDef }> {
  for (const schema of schemaNames(run)) for (const def of tablesOf(run, schema)) yield { schema, def }
}

const ROWS: Readonly<Record<string, (run: Run) => Iterable<readonly Value[]>>> = {
  *SCHEMATA(run) {
    for (const x of run.catalog?.schemas() ?? []) {
      const id = x.collationId ?? 255
      yield [s('def'), s(x.name), s(charsetName(id)), s(collationName(id)), null, s('NO')]
    }
  },

  *TABLES(run) {
    for (const schema of schemaNames(run)) {
      for (const def of tablesOf(run, schema)) {
        const comment = def.options['comment']
        // Statistics and clocks as a table fresh from CREATE has them.
        yield [s('def'), s(schema), s(def.name), s('BASE TABLE'), s(ENGINE[def.engine] ?? 'InnoDB'), n(10), s(def.engine === 'memory' ? 'Fixed' : 'Dynamic'), n(0), n(0), n(16384), n(0), n(0), n(0), null, null, null, null, s(collationName(tableCollation(def))), null, s(''), s(typeof comment === 'string' ? comment : '')]
      }
      for (const v of viewsOf(run, schema)) {
        yield [s('def'), s(schema), s(v.name), s('VIEW'), null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, s('VIEW')]
      }
    }
  },

  *COLUMNS(run) {
    // Tables and views in one order, by name as bytes (8.4.11: `User`,
    // `User_v`, `checked28`). A view's columns have no key and no auto_increment.
    for (const schema of schemaNames(run)) {
      const objects: { name: string; rows: () => Iterable<readonly Value[]> }[] = []
      for (const def of tablesOf(run, schema)) objects.push({ name: def.name, rows: () => columnRows(run, schema, def.name, def.columns.map((c) => ({ column: c, key: columnKey(def, c), extra: extraOf(c), def: columnDefault(run, c) }))) })
      for (const v of viewsOf(run, schema)) {
        objects.push({
          name: v.name,
          rows: function* () {
            let planned
            try {
              planned = planViewQuery(run, v).plan
            } catch {
              return
            }
            const rows = planned.columns.map((c, i) => {
              const base = baseColumn(run, c.type)
              const column: ColumnDef = { ...(base ?? synthesized(c.type)), name: v.columns?.[i] ?? c.name, nullable: c.type.nullable }
              const extra = base === undefined ? '' : extraOf({ ...base, autoIncrement: false })
              const d = base === undefined ? null : columnDefault(run, base)
              // A NOT NULL column with no default reports its type's zero when
              // it is computed or AUTO_INCREMENT, and NULL when it is a plain
              // column of the table (8.4.11).
              const zero = column.nullable || (base !== undefined && base.autoIncrement !== true) ? null : zeroOf(run, column)
              return { column, key: '', extra, def: d ?? zero }
            })
            yield* columnRows(run, schema, v.name, rows)
          },
        })
      }
      objects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const o of objects) yield* o.rows()
    }
  },

  *STATISTICS(run) {
    for (const { schema, def } of everyTable(run)) {
      // Counted only for SHOW INDEX, which asks of one table (show.ts).
      const counts = run.exactStatistics === true && run.catalog !== undefined ? keyCardinalities(run.catalog, def) : undefined
      const cardinality = (index: string, i: number) => n(counts?.get(index)?.[i] ?? 0)
      for (const index of def.indexes) {
        const unique = index.kind === 'primary' || index.kind === 'unique'
        for (const [i, p] of index.parts.entries()) {
          const column = def.columns.find((c) => c.name === p.column)
          yield [s('def'), s(schema), s(def.name), n(unique ? 0 : 1), s(schema), s(index.name), n(i + 1), s(p.column), s(p.descending === true ? 'D' : 'A'), cardinality(index.name, i), n(p.prefix ?? null), null, s(column?.nullable === true ? 'YES' : ''), s(def.engine === 'memory' ? 'HASH' : 'BTREE'), s(''), s(index.comment ?? ''), s(index.invisible === true ? 'NO' : 'YES'), null]
        }
      }
      // A FULLTEXT key has no order, so no COLLATION (8.4.11).
      for (const index of fulltextOf(def)) {
        for (const [i, name] of index.columns.entries()) {
          const column = def.columns.find((c) => c.name === name)
          yield [s('def'), s(schema), s(def.name), n(1), s(schema), s(index.name), n(i + 1), s(name), null, cardinality(index.name, i), null, null, s(column?.nullable === true ? 'YES' : ''), s('FULLTEXT'), s(''), s(index.comment ?? ''), s(index.invisible === true ? 'NO' : 'YES'), null]
        }
      }
    }
  },

  *KEY_COLUMN_USAGE(run) {
    for (const { schema, def } of everyTable(run)) {
      for (const index of def.indexes) {
        if (index.kind === 'index') continue
        for (const [i, p] of index.parts.entries()) yield [s('def'), s(schema), s(index.name), s('def'), s(schema), s(def.name), s(p.column), n(i + 1), null, null, null, null]
      }
      for (const fk of foreignKeysOf(def)) {
        for (const [i, c] of fk.columns.entries()) yield [s('def'), s(schema), s(fk.name), s('def'), s(schema), s(def.name), s(c), n(i + 1), n(i + 1), s(fk.references.schema), s(fk.references.table), s(fk.references.columns[i] ?? null)]
      }
    }
  },

  *REFERENTIAL_CONSTRAINTS(run) {
    for (const { schema, def } of everyTable(run)) {
      for (const fk of foreignKeysOf(def)) {
        const parent = run.catalog === undefined ? undefined : tablesOf(run, fk.references.schema).find((t) => t.name === fk.references.table)
        const unique = parent?.indexes.find((i) => i.kind !== 'index' && i.parts.length === fk.references.columns.length && i.parts.every((p, k) => p.column.toLowerCase() === fk.references.columns[k]?.toLowerCase()))
        yield [s('def'), s(schema), s(fk.name), s('def'), s(fk.references.schema), s(unique?.name ?? null), s('NONE'), s(fk.onUpdate), s(fk.onDelete), s(def.name), s(fk.references.table)]
      }
    }
  },

  *TABLE_CONSTRAINTS(run) {
    for (const { schema, def } of everyTable(run)) {
      for (const index of def.indexes) {
        if (index.kind === 'index') continue
        yield [s('def'), s(schema), s(index.name), s(schema), s(def.name), s(index.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'), s('YES')]
      }
      for (const fk of foreignKeysOf(def)) yield [s('def'), s(schema), s(fk.name), s(schema), s(def.name), s('FOREIGN KEY'), s('YES')]
      for (const c of checksOf(def)) yield [s('def'), s(schema), s(c.name), s(schema), s(def.name), s('CHECK'), s(c.enforced ? 'YES' : 'NO')]
    }
  },

  *CHECK_CONSTRAINTS(run) {
    for (const { schema, def } of everyTable(run)) for (const c of checksOf(def)) yield [s('def'), s(schema), s(c.name), s(checkClause(c))]
  },

  *VIEWS(run) {
    for (const schema of schemaNames(run)) {
      for (const v of viewsOf(run, schema)) {
        let text: string | undefined
        let updatable = false
        try {
          const { query, plan } = planViewQuery(run, v)
          // The select list keeps its own names: a column list renames the view's columns, not them (8.4.11).
          text = viewDefinition(query, plan.columns.map((c) => c.name), v.database ?? v.schema, run.catalog === undefined ? () => undefined : printableSources(run.catalog), v.query)
          updatable = viewUpdatable(query)
        } catch {}
        const collation = v.collationConnection ?? 255
        yield [s('def'), s(schema), s(v.name), s(text ?? v.query), s(v.checkOption ?? 'NONE'), s(updatable ? 'YES' : 'NO'), s(v.definer ?? 'root@%'), s(v.security ?? 'DEFINER'), s(charsetName(collation)), s(collationName(collation))]
      }
    }
  },

  *ROUTINES() {},
}
