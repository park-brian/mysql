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
import { requireCollationInfo } from '@myjs/charsets'
import { clusteredIndexOf, type ColumnDef, type EngineName, type IndexDef, type TableSpec } from '@myjs/engine'
import { BINARY_DEPRECATION, KEY, NODE, deparse, type ColumnDefinition, type CreateTableNode, type DataType, type KeyDefinition } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import type { ColumnType } from '@myjs/types'
import { checkFulltext, type FulltextDef } from './fulltext.ts'
import { checkGenerated } from './generated.ts'
import { NATIONAL_DEPRECATION, UTF8MB3_DEPRECATION } from './meta.ts'
import { resolveCollation } from './collation.ts'

export { resolveCollation } from './collation.ts'

const INTEGER_CODES: ReadonlySet<number> = new Set([FIELD_TYPE.TINY, FIELD_TYPE.SHORT, FIELD_TYPE.INT24, FIELD_TYPE.LONG, FIELD_TYPE.LONGLONG])

const INEXACT_CODES: ReadonlySet<number> = new Set([FIELD_TYPE.FLOAT, FIELD_TYPE.DOUBLE, FIELD_TYPE.NEWDECIMAL, FIELD_TYPE.DECIMAL])

/**
 * The 1681 deprecation warnings a CREATE TABLE draws (8.4.11): one for each
 * integer display width written, TINYINT(1) included — BOOL writes none —
 * one for each ZEROFILL, one for a FLOAT(M,D)'s or DOUBLE(M,D)'s digits, and
 * one for UNSIGNED on a FLOAT, DOUBLE or DECIMAL (ZEROFILL's own UNSIGNED
 * draws none).
 */
export function deprecationWarnings(node: CreateTableNode): Deprecation[] {
  return node.columns.flatMap(columnDeprecations)
}

/** A warning a column's definition draws: 1681 for a type's form, 1287, 3719 and 3720 for its charset. */
export interface Deprecation {
  readonly code: number
  readonly message: string
}

/** One column's share of `deprecationWarnings`, in 8.4.11's order, for ALTER TABLE's added and changed columns too. */
export function columnDeprecations(c: ColumnDefinition): Deprecation[] {
  const t = c.type
  const code = t.code as number
  const out: Deprecation[] = []
  const form = (message: string) => out.push({ code: 1681, message })
  if (t.zerofill === true) form(DEPRECATED.zerofill)
  if (INTEGER_CODES.has(code) && t.length !== undefined) form(DEPRECATED.width)
  if ((code === FIELD_TYPE.FLOAT || code === FIELD_TYPE.DOUBLE) && t.scale !== undefined) form(DEPRECATED.digits)
  if (INEXACT_CODES.has(code) && t.unsigned === true && t.zerofill !== true) form(DEPRECATED.unsigned)
  // The charset's, in the order the definition meets them (8.4.11).
  if (t.binary === true) out.push({ code: 1287, message: BINARY_DEPRECATION })
  if (t.national === true) out.push({ code: 3720, message: NATIONAL_DEPRECATION })
  else if (t.charset === 'utf8mb3') out.push({ code: 1287, message: UTF8MB3_DEPRECATION })
  else if (t.charset === 'utf8') out.push({ code: 3719, message: "'utf8' is currently an alias for the character set UTF8MB3, but will be an alias for UTF8MB4 in a future release. Please consider using UTF8MB4 in order to be unambiguous." })
  return out
}

/** The 1681 texts, as 8.4.11 words them. */
const DEPRECATED = {
  zerofill: 'The ZEROFILL attribute is deprecated and will be removed in a future release. Use the LPAD function to zero-pad numbers, or store the formatted numbers in a CHAR column.',
  width: 'Integer display width is deprecated and will be removed in a future release.',
  digits: 'Specifying number of digits for floating point data types is deprecated and will be removed in a future release.',
  unsigned: 'UNSIGNED for decimal and floating point data types is deprecated and support for it will be removed in a future release.',
}

/**
 * The keys that repeat an earlier one: the same kind over the same parts, in
 * the same order and direction. Each is a warning, 1831, which says the
 * duplicate is deprecated (8.4.11); a FULLTEXT key repeats only a FULLTEXT
 * one. `before` keys of each list were there already and are not counted.
 */
export function duplicateKeys(indexes: readonly IndexDef[], fulltext: readonly FulltextDef[], before: { readonly indexes: number; readonly fulltext: number } = { indexes: 0, fulltext: 0 }): string[] {
  const shape = (i: IndexDef) => `${i.kind === 'primary' ? 'unique' : i.kind}:${i.parts.map((p) => `${p.column.toLowerCase()}(${p.prefix ?? ''})${p.descending === true ? 'D' : 'A'}`).join(',')}`
  const out: string[] = []
  indexes.forEach((x, k) => {
    if (k >= before.indexes && indexes.slice(0, k).some((y) => shape(y) === shape(x))) out.push(x.name)
  })
  const words = (f: FulltextDef) => f.columns.map((c) => c.toLowerCase()).join(',')
  fulltext.forEach((x, k) => {
    if (k >= before.fulltext && fulltext.slice(0, k).some((y) => words(y) === words(x))) out.push(x.name)
  })
  return out
}

/** 1831's text, for a key `duplicateKeys` found. */
export const duplicateKeyText = (key: string, schema: string, table: string): string => `Duplicate index '${key}' defined on the table '${schema}.${table}'. This is deprecated and will be disallowed in a future release.`

/** The server default (D-10). */
export const DEFAULT_COLLATION = 255

const STRING_CODES: ReadonlySet<number> = new Set([
  FIELD_TYPE.STRING,
  FIELD_TYPE.VAR_STRING,
  FIELD_TYPE.TINY_BLOB,
  FIELD_TYPE.BLOB,
  FIELD_TYPE.MEDIUM_BLOB,
  FIELD_TYPE.LONG_BLOB,
  FIELD_TYPE.ENUM,
  FIELD_TYPE.SET,
])

/** A table option, looked up by any of its spellings. */
function option(options: Readonly<Record<string, string>>, ...names: string[]): string | undefined {
  for (const [k, v] of Object.entries(options)) {
    if (names.includes(k.toUpperCase().replace(/^DEFAULT /, ''))) return v
  }
  return undefined
}

/** Schema and table options share collation resolution and option spellings. */
export function resolveOptionsCollation(options: Readonly<Record<string, string>>, fallback: number): number {
  return resolveCollation(option(options, 'CHARACTER SET', 'CHARSET'), option(options, 'COLLATE'), fallback)
}

/** `ENGINE=…` to the engine that stores it. */
function engineFor(name: string | undefined): EngineName {
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
const tooBigScale = (scale: number, column: string) => sqlError('ER_TOO_BIG_SCALE', `Too big scale ${scale} specified for column '${column}'. Maximum is 30.`)

function checkLength(t: DataType, column: string, collationId: number | undefined): void {
  // FLOAT(p) past 53 bits is no type at all.
  if ((t.precision ?? 0) > 53) throw sqlError('ER_WRONG_FIELD_SPEC', `Incorrect column specifier for column '${column}'`)
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
      if ((t.scale ?? 0) > 30) throw tooBigScale(t.scale as number, column)
      return
    // FLOAT(M,D) and DOUBLE(M,D): the scale first, then the width, which is
    // 1 to 255 (8.4.11: `float(0,0)` is 1439).
    case FIELD_TYPE.FLOAT:
    case FIELD_TYPE.DOUBLE:
      if ((t.scale ?? 0) > 30) throw tooBigScale(t.scale as number, column)
      if (n > 255 || n < 1) throw displayWidth(column, 255)
      if ((t.scale ?? 0) > n) throw mBiggerThanD(column)
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
  const resolved = resolveColumnType(t, tableCollation, column)
  checkLength(t, column, resolved.collationId)
  return resolved
}

const mBiggerThanD = (column: string) => sqlError('ER_M_BIGGER_THAN_D', `For float(M,D), double(M,D) or decimal(M,D), M must be >= D (column '${column}').`)

function resolveColumnType(t: DataType, tableCollation: number, column: string): ColumnType {
  let code = t.code as number
  if (code === FIELD_TYPE.VARCHAR) code = FIELD_TYPE.VAR_STRING
  const { length, scale: writtenScale } = t
  if (code === FIELD_TYPE.JSON) return { type: FIELD_TYPE.JSON }
  if (code === FIELD_TYPE.GEOMETRY || code === FIELD_TYPE.VECTOR) {
    throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The ${t.name} type`))
  }
  if (!STRING_CODES.has(code)) {
    const unsigned = t.unsigned === true || t.zerofill === true || t.serial === true ? { unsigned: true } : {}
    switch (code) {
      case FIELD_TYPE.NEWDECIMAL:
      case FIELD_TYPE.DECIMAL: {
        // DECIMAL(0) is DECIMAL(10) (8.4.11).
        const precision = length === undefined || length === 0 ? 10 : length
        const scale = writtenScale ?? 0
        if (scale > precision) throw mBiggerThanD(column)
        return { type: FIELD_TYPE.NEWDECIMAL, precision, scale, ...unsigned }
      }
      case FIELD_TYPE.FLOAT:
      case FIELD_TYPE.DOUBLE: {
        // FLOAT(M,D): a width and a fixed number of decimals, which every
        // value is rounded to as it is stored (`Field_real::truncate`).
        if (length !== undefined && writtenScale !== undefined) return { type: code, precision: length, scale: writtenScale, ...unsigned }
        break
      }
      case FIELD_TYPE.DATETIME:
      case FIELD_TYPE.TIMESTAMP:
      case FIELD_TYPE.TIME: {
        return { type: code, decimals: length ?? 0 }
      }
      case FIELD_TYPE.BIT:
        return { type: code, bits: length ?? 1 }
    }
    return { type: code, ...unsigned }
  }

  // A string family type: text, or bytes when it is binary.
  const declaredBinary = t.name === 'BINARY' || t.name === 'VARBINARY' || t.name.endsWith('BLOB')
  let collationId: number
  if (declaredBinary) collationId = CHARSET_BINARY
  else {
    collationId = resolveCollation(t.charset, t.collation, tableCollation)
    // BINARY selects this charset's _bin collation; binary itself already is one.
    if (t.binary === true && collationId !== CHARSET_BINARY) collationId = resolveCollation(undefined, `${requireCollationInfo(collationId).charset}_bin`, collationId)
  }
  if (code === FIELD_TYPE.ENUM || code === FIELD_TYPE.SET) {
    const members = (t.values ?? []).map((v) => (typeof v === 'string' ? v : new TextDecoder().decode(v)))
    return { type: code, members, collationId }
  }
  if (code === FIELD_TYPE.VAR_STRING) {
    if (length === undefined) throw sqlError('ER_PARSE_ERROR', messages.parseError(')', 1))
    return { type: code, length, collationId }
  }
  if (code === FIELD_TYPE.STRING) return { type: code, length: length ?? 1, collationId }
  return { type: code, collationId }
}

/**
 * `CREATE TABLE` → the catalog's spec. `schemaCollation` is the schema's
 * default, which a table without a charset of its own inherits.
 */
export function createTableSpec(node: CreateTableNode, schemaCollation: number): TableSpec {
  if (node.partition !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Partitioning'))

  const tableCollation = resolveOptionsCollation(node.options, schemaCollation)
  const engine = engineFor(option(node.options, 'ENGINE'))

  const inlinePrimary = node.columns.filter((c) => c.primary === true)
  const tablePrimary = node.keys.filter((k) => k.type === KEY.PRIMARY)
  const primary = new Set<string>()
  for (const c of inlinePrimary) primary.add(c.name.toLowerCase())
  for (const k of tablePrimary) for (const p of k.columns) if (p.name !== undefined) primary.add(p.name.toLowerCase())

  const declared = new Map<string, string>()
  const columns: ColumnDef[] = node.columns.map((c) => {
    const lower = c.name.toLowerCase()
    if (declared.has(lower)) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${c.name}'`)
    declared.set(lower, c.name)
    return column(c, tableCollation, primary.has(lower))
  })

  const indexes: IndexDef[] = []
  const names = new Set<string>()
  const nameFor = (wanted: string | undefined, first: string): string => {
    let name = wanted ?? first
    if (wanted === undefined) {
      for (let i = 2; names.has(name.toLowerCase()) || name.toUpperCase() === 'PRIMARY'; i++) name = `${first}_${i}`
    }
    const lower = name.toLowerCase()
    if (names.has(lower)) throw sqlError('ER_DUP_KEYNAME', `Duplicate key name '${name}'`)
    names.add(lower)
    return name
  }
  const known = (name: string): string => {
    const c = declared.get(name.toLowerCase())
    if (c === undefined) throw sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', `Key column '${name}' doesn't exist in table`)
    return c
  }

  if (inlinePrimary.length + tablePrimary.length > 1) throw sqlError('ER_MULTIPLE_PRI_KEY', 'Multiple primary key defined')
  if (inlinePrimary.length === 1) {
    names.add('primary')
    indexes.push({ name: 'PRIMARY', kind: 'primary', parts: [{ column: (inlinePrimary[0] as ColumnDefinition).name }] })
  }
  const fulltext: FulltextDef[] = []
  for (const k of node.keys) {
    // A foreign key needs its parent, so the catalog: `withForeignKeys` (M5.25).
    if (k.type === KEY.FOREIGN) continue
    if (k.type === KEY.SPATIAL) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('SPATIAL indexes'))
    if (k.type === KEY.FULLTEXT) {
      // Kept in the definition and not built: MATCH reads the table (M5.26).
      const names = k.columns.map((p) => known(p.name ?? ''))
      checkFulltext(engine, columns, names, k.columns.some((p) => p.desc === true || p.asc === true))
      if (k.parser !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('WITH PARSER'))
      fulltext.push({ name: nameFor(k.name ?? k.constraint, names[0] as string), columns: names, ...keyExtras(k) })
      continue
    }
    const parts = k.columns.map((p) => {
      if (p.name === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Functional key parts'))
      return { column: known(p.name), ...(p.length === undefined ? {} : { prefix: p.length }), ...(p.desc === true ? { descending: true } : {}) }
    })
    if (k.type === KEY.PRIMARY) {
      names.add('primary')
      indexes.unshift({ name: 'PRIMARY', kind: 'primary', parts, ...keyExtras(k) })
    } else indexes.push({ name: nameFor(k.name ?? k.constraint, (parts[0] as { column: string }).column), kind: k.type === KEY.UNIQUE ? 'unique' : 'index', parts, ...keyExtras(k) })
  }
  for (const c of node.columns) {
    if (c.unique === true || c.type.serial === true) indexes.push({ name: nameFor(undefined, c.name), kind: 'unique', parts: [{ column: c.name }] })
  }
  visiblePrimary(columns, indexes)

  const options: Record<string, unknown> = { collationId: tableCollation }
  if (fulltext.length > 0) options['fulltext'] = fulltext
  const comment = option(node.options, 'COMMENT')
  if (comment !== undefined) options['comment'] = comment
  // Statistics kept from the last ANALYZE rather than recomputed as rows change (M5.45).
  // STATS_AUTO_RECALC=0 freezes the table's statistics at its last ANALYZE (M5.45); either value written is shown again.
  const recalc = option(node.options, 'STATS_AUTO_RECALC')
  if (recalc === '0' || recalc === '1') options['statsAutoRecalc'] = recalc === '1'
  checkGenerated(columns)
  return { name: node.table.name, engine, columns, indexes, options }
}

/** A key's COMMENT and INVISIBLE, as a definition keeps them. */
export function keyExtras(k: KeyDefinition): { comment?: string; invisible?: true } {
  return { ...(k.comment === undefined ? {} : { comment: k.comment }), ...(k.invisible === true ? { invisible: true as const } : {}) }
}

/**
 * The index InnoDB clusters on may not be invisible: the primary key, or the
 * UNIQUE key on NOT NULL columns promoted in its place (8.4.11: 3522 for both).
 */
export function visiblePrimary(columns: readonly ColumnDef[], indexes: readonly IndexDef[]): void {
  const clustered = clusteredIndexOf(columns, indexes)
  if (indexes.some((i) => i.name === clustered && i.invisible === true)) throw sqlError('ER_PK_INDEX_CANT_BE_INVISIBLE', 'A primary key index cannot be invisible')
}

export function column(c: ColumnDefinition, tableCollation: number, inPrimary: boolean): ColumnDef {
  // A generated column has its expression and no default (8.4.11: 1221).
  if (c.generated !== undefined && c.default !== undefined) throw sqlError('ER_WRONG_USAGE', 'Incorrect usage of DEFAULT and generated column')
  const declaration = c.type
  const type = columnType(declaration, tableCollation, c.name)
  const code = type.type
  const serial = declaration.serial === true
  const nullable = !(c.notNull === true || inPrimary || serial) && c.nullable !== false
  if (inPrimary && c.nullable === true) throw sqlError('ER_PRIMARY_CANT_HAVE_NULL', 'All parts of a PRIMARY KEY must be NOT NULL; if you need NULL in a key, use UNIQUE instead')
  // AUTO_INCREMENT is for integers alone: 8.4 refuses FLOAT, DOUBLE and DECIMAL.
  if (c.autoIncrement === true && INEXACT_CODES.has(code)) throw sqlError('ER_WRONG_FIELD_SPEC', `Incorrect column specifier for column '${c.name}'`)
  const attributes: Record<string, unknown> = {}
  // A nullable TEXT or BLOB's DEFAULT NULL is no default at all: SHOW CREATE TABLE writes none (8.4.11).
  const nullDefault = c.default?.kind === NODE.LITERAL && c.default.type === 'null' && c.defaultExpression !== true
  if (c.default !== undefined && !(nullDefault && nullable && code >= FIELD_TYPE.TINY_BLOB && code <= FIELD_TYPE.BLOB)) attributes['default'] = deparse(c.default)
  if (c.defaultExpression === true) attributes['defaultExpression'] = true
  if (c.generated !== undefined) {
    attributes['generated'] = deparse(c.generated.expr)
    if (c.generated.stored) attributes['stored'] = true
  }
  // A charset or collation the column names itself, which SHOW CREATE TABLE then always writes (`is_explicit_collation`).
  if (type.collationId !== undefined && type.collationId !== CHARSET_BINARY && (declaration.charset !== undefined || declaration.collation !== undefined || declaration.binary === true)) attributes['explicitCollation'] = true
  if (c.onUpdate !== undefined) attributes['onUpdate'] = deparse(c.onUpdate)
  if (c.comment !== undefined) attributes['comment'] = c.comment
  if (declaration.zerofill === true) attributes['zerofill'] = true
  // BOOL and BOOLEAN are TINYINT(1), width and all.
  if (INTEGER_CODES.has(code) && (declaration.length !== undefined || declaration.boolean === true)) attributes['width'] = declaration.length ?? 1
  return {
    name: c.name,
    type,
    nullable,
    ...(c.autoIncrement === true || serial ? { autoIncrement: true } : {}),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  }
}
