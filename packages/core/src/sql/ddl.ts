// M5.9 — DDL: a parsed `CREATE TABLE` into the catalog's `TableSpec`.
//
// The parser records a column's type *as written* (`VARCHAR(10) BINARY`, no
// charset); the catalog needs it *resolved*. Most of this file is that
// resolution, in MySQL's order:
//
//   - A string column's collation is its own `COLLATE`, else its `CHARACTER
//     SET`'s default, else the table's, else the schema's, else the server's,
//     `utf8mb4_0900_ai_ci` (D-10). A bare `BINARY` attribute means the `_bin`
//     collation of whichever charset that lands on.
//   - `CHARACTER SET binary` makes CHAR, VARCHAR and TEXT into BINARY,
//     VARBINARY and BLOB.
//   - A PRIMARY KEY's columns are NOT NULL whatever they say; `SERIAL` is
//     `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE`.
//   - An unnamed index takes its first column's name, suffixed `_2`, `_3` when
//     that is taken.
//
// What the engine does not interpret rides in `attributes`: a column's
// `DEFAULT` and `ON UPDATE` as SQL text, compiled when a row needs them.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { collationInfoByName, defaultCollationOf, requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, EngineName, IndexDef, TableSpec } from '@myjs/engine'
import { KEY, deparse, type ColumnDefinition, type CreateTableNode, type DataType, type Expression } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import type { ColumnType } from '@myjs/types'

const INTEGER_CODES: ReadonlySet<number> = new Set([FIELD_TYPE.TINY, FIELD_TYPE.SHORT, FIELD_TYPE.INT24, FIELD_TYPE.LONG, FIELD_TYPE.LONGLONG])

/**
 * The 1681 deprecation warnings a CREATE TABLE draws (8.4.11): one for each
 * integer display width written, TINYINT(1) included — BOOL writes none — and
 * one for each ZEROFILL.
 */
export function deprecationWarnings(node: CreateTableNode): number {
  let n = 0
  for (const c of node.columns) {
    const t = c.type
    if (!INTEGER_CODES.has(t.code as number)) continue
    if (t.length !== undefined) n++
    if (t.zerofill === true) n++
  }
  return n
}

/** The server default (D-10). */
export const DEFAULT_COLLATION = 255

const TEXT_TO_BINARY: Readonly<Record<number, number>> = {
  [FIELD_TYPE.STRING]: FIELD_TYPE.STRING,
  [FIELD_TYPE.VAR_STRING]: FIELD_TYPE.VAR_STRING,
  [FIELD_TYPE.VARCHAR]: FIELD_TYPE.VAR_STRING,
}

const STRING_CODES: ReadonlySet<number> = new Set([
  FIELD_TYPE.STRING,
  FIELD_TYPE.VAR_STRING,
  FIELD_TYPE.VARCHAR,
  FIELD_TYPE.TINY_BLOB,
  FIELD_TYPE.BLOB,
  FIELD_TYPE.MEDIUM_BLOB,
  FIELD_TYPE.LONG_BLOB,
  FIELD_TYPE.ENUM,
  FIELD_TYPE.SET,
])

/** A charset name as MySQL spells it in 8.4: `utf8` is `utf8mb3`. */
const charsetName = (name: string): string => {
  const n = name.toLowerCase()
  return n === 'utf8' ? 'utf8mb3' : n
}

function collationByName(name: string): number {
  const info = collationInfoByName(name.toLowerCase() === 'utf8_bin' ? 'utf8mb3_bin' : name.toLowerCase().replace(/^utf8_/, 'utf8mb3_'))
  if (info === undefined) throw sqlError('ER_UNKNOWN_COLLATION', messages.unknownCollation(name))
  return info.id
}

function charsetDefault(name: string): number {
  const cs = charsetName(name)
  if (cs === 'binary') return CHARSET_BINARY
  const info = defaultCollationOf(cs)
  if (info === undefined) throw sqlError('ER_UNKNOWN_CHARACTER_SET', `Unknown character set: '${name}'`)
  return info.id
}

/** The `_bin` collation of a collation's charset. */
function binCollationOf(id: number): number {
  const cs = requireCollationInfo(id).charset
  if (cs === 'binary') return CHARSET_BINARY
  const info = collationInfoByName(`${cs}_bin`)
  if (info === undefined) throw sqlError('ER_UNKNOWN_COLLATION', messages.unknownCollation(`${cs}_bin`))
  return info.id
}

/** A charset and collation pair, as table and schema options give them, to one collation. */
export function resolveCollation(charset: string | undefined, collate: string | undefined, fallback: number): number {
  if (collate !== undefined) {
    const id = collationByName(collate)
    if (charset !== undefined && requireCollationInfo(id).charset !== charsetName(charset)) {
      throw sqlError('ER_COLLATION_CHARSET_MISMATCH', `COLLATION '${collate}' is not valid for CHARACTER SET '${charset}'`)
    }
    return id
  }
  if (charset !== undefined) return charsetDefault(charset)
  return fallback
}

/** A table option, looked up by any of its spellings. */
function option(options: Readonly<Record<string, string>>, ...names: string[]): string | undefined {
  for (const [k, v] of Object.entries(options)) {
    if (names.includes(k.toUpperCase().replace(/^DEFAULT /, ''))) return v
  }
  return undefined
}

/** `ENGINE=…` to the engine that stores it. */
export function engineFor(name: string | undefined): EngineName {
  if (name === undefined) return 'native'
  switch (name.toUpperCase()) {
    case 'INNODB':
    case 'MYISAM':
      // MyISAM tables are stored natively: transactional where MySQL's would
      // not be, which an application cannot tell from a correct result.
      return 'native'
    case 'MEMORY':
    case 'HEAP':
      return 'memory'
    default:
      throw sqlError('ER_UNKNOWN_STORAGE_ENGINE', `Unknown storage engine '${name}'`)
  }
}

/** ER_TOO_BIG_DISPLAYWIDTH, 1439. */
const displayWidth = (column: string, max: number) => sqlError('ER_TOO_BIG_DISPLAYWIDTH', `Display width out of range for column '${column}' (max = ${max})`)
/** ER_TOO_BIG_FIELDLENGTH, 1074. */
const fieldLength = (column: string, max: number) => sqlError('ER_TOO_BIG_FIELDLENGTH', `Column length too big for column '${column}' (max = ${max}); use BLOB or TEXT instead`)

/**
 * The limits a declared length must be inside, as 8.4.11 refuses them: a
 * length past 2^32 - 1 is out of any range (1439); a CHAR or BINARY is 255 at
 * most, a VARBINARY 65,535 bytes and a VARCHAR as many characters as fit in
 * 65,535 bytes of its charset (1074); an integer's display width is 255 and a
 * BIT's 64 (1439); a DECIMAL's precision 65 and scale 30, and a fractional
 * second 6 (1426, 1425).
 */
function checkLength(t: DataType, column: string, collationId: number | undefined): void {
  const n = t.length
  if (n === undefined) return
  if (n > 4294967295) throw displayWidth(column, 4294967295)
  const code = t.code as number
  switch (code) {
    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.LONGLONG:
      if (n > 255) throw displayWidth(column, 255)
      return
    case FIELD_TYPE.BIT:
      if (n > 64) throw displayWidth(column, 64)
      return
    case FIELD_TYPE.NEWDECIMAL:
    case FIELD_TYPE.DECIMAL:
      if (n > 65) throw sqlError('ER_TOO_BIG_PRECISION', `Too-big precision ${n} specified for '${column}'. Maximum is 65.`)
      if ((t.scale ?? 0) > 30) throw sqlError('ER_TOO_BIG_SCALE', `Too big scale ${t.scale} specified for '${column}'. Maximum is 30.`)
      return
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIME:
      if (n > 6) throw sqlError('ER_TOO_BIG_PRECISION', `Too-big precision ${n} specified for '${column}'. Maximum is 6.`)
      return
    case FIELD_TYPE.STRING:
      if (n > 255) throw fieldLength(column, 255)
      return
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.VARCHAR: {
      const max = collationId === undefined || collationId === CHARSET_BINARY ? 65535 : Math.floor(65535 / requireCollationInfo(collationId).mbmaxlen)
      if (n > max) throw fieldLength(column, max)
      return
    }
    default:
      return
  }
}

/** One column's type, resolved against the table's default collation. */
export function columnType(t: DataType, tableCollation: number, column = ''): ColumnType {
  const resolved = resolveColumnType(t, tableCollation)
  checkLength(t, column, resolved.collationId)
  return resolved
}

function resolveColumnType(t: DataType, tableCollation: number): ColumnType {
  const code = t.code as number
  if (code === FIELD_TYPE.JSON) return { type: FIELD_TYPE.JSON }
  if (code === FIELD_TYPE.GEOMETRY || code === FIELD_TYPE.VECTOR) {
    throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The ${t.name} type`))
  }
  if (!STRING_CODES.has(code)) {
    const unsigned = t.unsigned === true || t.zerofill === true || t.serial === true ? { unsigned: true } : {}
    switch (code) {
      case FIELD_TYPE.NEWDECIMAL:
      case FIELD_TYPE.DECIMAL: {
        const precision = t.length ?? 10
        const scale = t.scale ?? 0
        if (scale > precision) throw sqlError('ER_M_BIGGER_THAN_D', 'For float(M,D), double(M,D) or decimal(M,D), M must be >= D.')
        return { type: FIELD_TYPE.NEWDECIMAL, precision, scale, ...unsigned }
      }
      case FIELD_TYPE.DATETIME:
      case FIELD_TYPE.TIMESTAMP:
      case FIELD_TYPE.TIME: {
        return { type: code, decimals: t.length ?? 0 }
      }
      case FIELD_TYPE.BIT:
        return { type: code, bits: t.length ?? 1 }
      default:
        return { type: code, ...unsigned }
    }
  }

  // A string family type: text, or bytes when it is binary.
  const declaredBinary = t.name === 'BINARY' || t.name === 'VARBINARY' || t.name.endsWith('BLOB')
  let collationId: number
  if (declaredBinary) collationId = CHARSET_BINARY
  else {
    collationId = t.collation !== undefined ? collationByName(t.collation) : t.charset !== undefined ? charsetDefault(t.charset) : tableCollation
    if (t.binary === true) collationId = binCollationOf(collationId)
  }
  const length = t.length
  if (code === FIELD_TYPE.ENUM || code === FIELD_TYPE.SET) {
    const members = (t.values ?? []).map((v) => (typeof v === 'string' ? v : new TextDecoder().decode(v)))
    return { type: code, members, collationId }
  }
  const type = collationId === CHARSET_BINARY ? (TEXT_TO_BINARY[code] ?? code) : code === FIELD_TYPE.VARCHAR ? FIELD_TYPE.VAR_STRING : code
  if (code === FIELD_TYPE.VAR_STRING || code === FIELD_TYPE.VARCHAR) {
    if (length === undefined) throw sqlError('ER_PARSE_ERROR', messages.parseError(')', 1))
    return { type, length, collationId }
  }
  if (code === FIELD_TYPE.STRING) return { type, length: length ?? 1, collationId }
  return { type, collationId }
}

/** The SQL text a default is kept as. */
const sqlText = (e: Expression): string => deparse(e)

export interface ResolvedTable {
  readonly spec: TableSpec
  readonly ifNotExists: boolean
}

/**
 * `CREATE TABLE` → the catalog's spec. `schemaCollation` is the schema's
 * default, which a table without a charset of its own inherits.
 */
export function createTableSpec(node: CreateTableNode, schemaCollation: number): TableSpec {
  if (node.temporary === true) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('CREATE TEMPORARY TABLE'))
  if (node.like !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('CREATE TABLE … LIKE'))
  if (node.query !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('CREATE TABLE … SELECT'))
  if (node.partition !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Partitioning'))

  const tableCollation = resolveCollation(option(node.options, 'CHARACTER SET', 'CHARSET'), option(node.options, 'COLLATE'), schemaCollation)
  const engine = engineFor(option(node.options, 'ENGINE'))

  const primary = new Set<string>()
  for (const c of node.columns) if (c.primary === true) primary.add(c.name.toLowerCase())
  for (const k of node.keys) if (k.type === KEY.PRIMARY) for (const p of k.columns) if (p.name !== undefined) primary.add(p.name.toLowerCase())

  const seen = new Set<string>()
  const columns: ColumnDef[] = node.columns.map((c) => {
    const lower = c.name.toLowerCase()
    if (seen.has(lower)) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${c.name}'`)
    seen.add(lower)
    return column(c, tableCollation, primary.has(lower))
  })

  const indexes: IndexDef[] = []
  const names = new Set<string>()
  const nameFor = (wanted: string | undefined, first: string): string => {
    if (wanted !== undefined) {
      if (names.has(wanted.toLowerCase())) throw sqlError('ER_DUP_KEYNAME', `Duplicate key name '${wanted}'`)
      names.add(wanted.toLowerCase())
      return wanted
    }
    let name = first
    for (let i = 2; names.has(name.toLowerCase()) || name.toUpperCase() === 'PRIMARY'; i++) name = `${first}_${i}`
    names.add(name.toLowerCase())
    return name
  }
  const known = (name: string): string => {
    const c = node.columns.find((col) => col.name.toLowerCase() === name.toLowerCase())
    if (c === undefined) throw sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', `Key column '${name}' doesn't exist in table`)
    return c.name
  }

  const inlinePrimary = node.columns.filter((c) => c.primary === true)
  const tablePrimary = node.keys.filter((k) => k.type === KEY.PRIMARY)
  if (inlinePrimary.length + tablePrimary.length > 1) throw sqlError('ER_MULTIPLE_PRI_KEY', 'Multiple primary key defined')
  if (inlinePrimary.length === 1) {
    names.add('primary')
    indexes.push({ name: 'PRIMARY', kind: 'primary', parts: [{ column: (inlinePrimary[0] as ColumnDefinition).name }] })
  }
  for (const k of node.keys) {
    // A foreign key needs its parent, so the catalog: `withForeignKeys` (M5.25).
    if (k.type === KEY.FOREIGN) continue
    if (k.type === KEY.FULLTEXT || k.type === KEY.SPATIAL) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`${k.type.toUpperCase()} indexes`))
    const parts = k.columns.map((p) => {
      if (p.name === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Functional key parts'))
      return { column: known(p.name), ...(p.length === undefined ? {} : { prefix: p.length }), ...(p.desc === true ? { descending: true } : {}) }
    })
    if (k.type === KEY.PRIMARY) {
      names.add('primary')
      indexes.push({ name: 'PRIMARY', kind: 'primary', parts })
    } else indexes.push({ name: nameFor(k.name ?? k.constraint, (parts[0] as { column: string }).column), kind: k.type === KEY.UNIQUE ? 'unique' : 'index', parts })
  }
  for (const c of node.columns) {
    if (c.unique === true || c.type.serial === true) indexes.push({ name: nameFor(undefined, c.name), kind: 'unique', parts: [{ column: c.name }] })
  }
  // The primary key first, as MySQL lists it.
  indexes.sort((a, b) => (a.kind === 'primary' ? -1 : 0) - (b.kind === 'primary' ? -1 : 0))

  const options: Record<string, unknown> = { collationId: tableCollation }
  const comment = option(node.options, 'COMMENT')
  if (comment !== undefined) options['comment'] = comment
  return { name: node.table.name, engine, columns, indexes, options }
}

export function column(c: ColumnDefinition, tableCollation: number, inPrimary: boolean): ColumnDef {
  if (c.generated !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Generated columns'))
  const type = columnType(c.type, tableCollation, c.name)
  const serial = c.type.serial === true
  const nullable = !(c.notNull === true || inPrimary || serial) && c.nullable !== false
  if (inPrimary && c.nullable === true) throw sqlError('ER_PRIMARY_CANT_HAVE_NULL', 'All parts of a PRIMARY KEY must be NOT NULL; if you need NULL in a key, use UNIQUE instead')
  const attributes: Record<string, unknown> = {}
  if (c.default !== undefined) attributes['default'] = sqlText(c.default)
  if (c.onUpdate !== undefined) attributes['onUpdate'] = sqlText(c.onUpdate)
  if (c.comment !== undefined) attributes['comment'] = c.comment
  if (c.type.zerofill === true) attributes['zerofill'] = true
  // BOOL and BOOLEAN are TINYINT(1), width and all.
  const boolean = c.type.boolean === true
  if (INTEGER_CODES.has(c.type.code as number) && (c.type.length !== undefined || boolean)) attributes['width'] = c.type.length ?? 1
  return {
    name: c.name,
    type,
    nullable,
    ...(c.autoIncrement === true || serial ? { autoIncrement: true } : {}),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  }
}
