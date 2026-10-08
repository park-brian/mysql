// M5.1 — what a result column is: the type an expression produces, and the
// ColumnDefinition41 a client reads it by.
//
// A driver decides how to turn the text `'1.50'` into a JavaScript value from
// the column's metadata, not from the text, so metadata is part of the answer
// (doc 43 §2 ranks it second only to the rows). Every rule below was read off
// a real 8.4.11 with `mysql2` (`SELECT id, 1+1, mi/2, …`), not taken from the
// manual, and the differential corpus (`capture:execution`) keeps it honest:
//
//   - A table column reports its own type, length and key flags. Numbers carry
//     no BINARY flag; temporals and binary strings do.
//   - Every integer expression is a BIGINT, whatever its operands were, and
//     reports the display width it would need: `ti+0` on a TINYINT is 5.
//   - A text column's length is in *result-charset* bytes: `VARCHAR(20)` is 80
//     to a utf8mb4 client, and `TEXT` is 65535 × 4.
//   - A literal is NOT NULL, so `SELECT 1` carries NOT_NULL|BINARY; `1/2` does
//     not, because a division can be NULL.
import { CHARSET_BINARY, COLUMN_FLAG, FIELD_TYPE } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, TableDef } from '@myjs/engine'
import type { ColumnDefinition } from '@myjs/protocol'

/** `PART_KEY_FLAG`, `include/mysql_com.h`: the column is in some index. */
export const PART_KEY_FLAG = 0x4000

/** What an expression yields, before a result charset turns it into metadata. */
export type ResultKind = 'int' | 'decimal' | 'double' | 'string' | 'bytes' | 'datetime' | 'time' | 'null'

export interface ResultType {
  readonly kind: ResultKind
  /** The wire field type. */
  readonly field: number
  readonly nullable: boolean
  readonly unsigned: boolean
  /**
   * An integer's display width, its sign included (`INT` is 11, `1` is 2); a
   * DECIMAL's precision; characters for a string; bytes for a binary string.
   */
  readonly length: number
  /** A DECIMAL's scale, a temporal's fractional digits. */
  readonly scale: number
  /** A string's collation; `binary` otherwise. */
  readonly collationId: number
  /** How strongly a string holds its collation (`COERCIBILITY`): a column's is 2, a literal's 4, the default. */
  readonly coercibility?: number
  /** The column it is, when the expression is a bare column reference. */
  readonly column?: SourceColumn
  /** A table column's text width, in its own charset's bytes, when it is a BLOB/TEXT. */
  readonly blobBytes?: number
  /**
   * Copied through a temporary table — a `SELECT DISTINCT` MySQL runs that
   * way. A column then loses its key flags, and gains `GROUP_FLAG` if it is
   * nullable and part of the grouping; a column the WHERE pins to one value
   * (`'pinned'`) is not. An expression keeps only NOT_NULL (8.4.11; the
   * metadata of an expression there is M5.5's, and differs more than this).
   */
  readonly temporary?: boolean | 'pinned' | 'stream'
  /**
   * `AVG`, the variance family and `BIT_*`: aggregates an aggregating
   * temporary table holds as an intermediate (a sum and a count, say) rather
   * than as a result field, so their metadata survives it whole — though not
   * a stream of results into one (8.4.11: AVG is 0x80 grouped by temporary
   * table and 0x00 once streamed for a sort).
   */
  readonly ownInTemporary?: boolean
  /**
   * `MIN`/`MAX` of a bare column: the column's own flags, which a temporary
   * table's copy of it carries less its key flags — `MIN(pk_col)` is
   * NO_DEFAULT_VALUE there (8.4.11).
   */
  readonly fieldFlags?: number
  /**
   * A temporal reported in the result charset, as text is, while keeping its
   * field type: `MIN(date_col)` is type DATE, utf8mb4, 40 wide, with no BINARY
   * flag (8.4.11).
   */
  readonly asText?: boolean
  /** A length reported as is, where no rule of characters times bytes gives it (`GROUP_CONCAT`'s BLOB). */
  readonly wireLength?: number
}

/** `GROUP_FLAG`, `include/mysql_com.h` — the same bit as `NUM_FLAG`. */
export const GROUP_FLAG = 0x8000
/**
 * What a column loses through a temporary table: its key flags. NO_DEFAULT_VALUE
 * survives — `SELECT DISTINCT qty, label` reports a NOT NULL `qty` as 0x1001
 * (8.4.11, found by M5.18's corpus: every NOT NULL column M5.17's drew for
 * DISTINCT held a key, so the table was skipped).
 */
const KEY_FLAGS = COLUMN_FLAG.PRI_KEY | COLUMN_FLAG.UNIQUE_KEY | COLUMN_FLAG.MULTIPLE_KEY | PART_KEY_FLAG | COLUMN_FLAG.AUTO_INCREMENT

export interface SourceColumn {
  readonly schema: string
  /** The table as the query names it — its alias, if it has one. */
  readonly table: string
  readonly orgTable: string
  readonly orgName: string
  /** Flags only a table column has: keys, AUTO_INCREMENT, ENUM, BLOB, ZEROFILL. */
  readonly flags: number
}

const INT_WIDTH: Readonly<Record<number, readonly [number, number]>> = {
  // [signed, unsigned] display widths, as `Field_*::max_display_length()`.
  [FIELD_TYPE.TINY]: [4, 3],
  [FIELD_TYPE.SHORT]: [6, 5],
  [FIELD_TYPE.INT24]: [9, 8],
  [FIELD_TYPE.LONG]: [11, 10],
  [FIELD_TYPE.LONGLONG]: [20, 20],
}

const BLOB_BYTES: Readonly<Record<number, number>> = {
  [FIELD_TYPE.TINY_BLOB]: 255,
  [FIELD_TYPE.BLOB]: 65535,
  [FIELD_TYPE.MEDIUM_BLOB]: 16777215,
  [FIELD_TYPE.LONG_BLOB]: 4294967295,
}

const isBinaryCollation = (id: number | undefined): boolean => id === undefined || id === CHARSET_BINARY

export const NULL_TYPE: ResultType = {
  kind: 'null',
  field: FIELD_TYPE.NULL,
  nullable: true,
  unsigned: false,
  length: 0,
  scale: 0,
  collationId: CHARSET_BINARY,
}

/** A BIGINT expression `width` characters wide. */
export const intType = (width: number, nullable: boolean, unsigned = false): ResultType => ({
  kind: 'int',
  field: FIELD_TYPE.LONGLONG,
  nullable,
  unsigned,
  length: width,
  scale: 0,
  collationId: CHARSET_BINARY,
})

/** A boolean: `a = b`, `a IS NULL`, `NOT a`. */
export const boolType = (nullable: boolean): ResultType => intType(1, nullable)

export const decimalType = (precision: number, scale: number, nullable: boolean, unsigned = false): ResultType => ({
  kind: 'decimal',
  field: FIELD_TYPE.NEWDECIMAL,
  nullable,
  unsigned,
  length: Math.min(65, Math.max(precision, scale, 1)),
  scale: Math.min(30, scale),
  collationId: CHARSET_BINARY,
})

/** A DOUBLE: a column is 22 wide, and every double an expression makes is 23 (8.4.11). */
export const doubleType = (nullable: boolean, length = 23): ResultType => ({
  kind: 'double',
  field: FIELD_TYPE.DOUBLE,
  nullable,
  unsigned: false,
  length,
  scale: 31,
  collationId: CHARSET_BINARY,
})

export const stringType = (chars: number, collationId: number, nullable: boolean): ResultType =>
  isBinaryCollation(collationId)
    ? { kind: 'bytes', field: FIELD_TYPE.VAR_STRING, nullable, unsigned: false, length: chars, scale: 31, collationId: CHARSET_BINARY }
    : { kind: 'string', field: FIELD_TYPE.VAR_STRING, nullable, unsigned: false, length: chars, scale: 31, collationId }

export const datetimeType = (field: number, fsp: number, nullable: boolean): ResultType => ({
  kind: field === FIELD_TYPE.TIME ? 'time' : 'datetime',
  field,
  nullable,
  unsigned: false,
  length: 0,
  scale: fsp,
  collationId: CHARSET_BINARY,
})

/** The key flags a column has from the indexes it is in. */
function keyFlags(def: TableDef, name: string): number {
  let flags = 0
  for (const index of def.indexes) {
    const at = index.parts.findIndex((p) => p.column === name)
    if (at < 0) continue
    flags |= PART_KEY_FLAG
    if (index.kind === 'primary') flags |= COLUMN_FLAG.PRI_KEY
    else if (index.kind === 'unique' && index.parts.length === 1) flags |= COLUMN_FLAG.UNIQUE_KEY
    else if (at === 0) flags |= COLUMN_FLAG.MULTIPLE_KEY
  }
  return flags
}

/** A table column's result type, as `SELECT c FROM t` reports it. */
export function columnResultType(def: TableDef, column: ColumnDef, tableAlias: string): ResultType {
  const t = column.type
  const nullable = column.nullable
  const unsigned = t.unsigned === true
  let flags = keyFlags(def, column.name)
  if (column.autoIncrement === true) flags |= COLUMN_FLAG.AUTO_INCREMENT
  if (!nullable && column.autoIncrement !== true && column.attributes?.['default'] === undefined) flags |= COLUMN_FLAG.NO_DEFAULT_VALUE
  if (t.type === FIELD_TYPE.YEAR) flags |= COLUMN_FLAG.ZEROFILL
  const source: SourceColumn = { schema: def.schema, table: tableAlias, orgTable: def.name, orgName: column.name, flags }
  const base = { nullable, unsigned, column: source }

  const width = INT_WIDTH[t.type]
  if (width !== undefined) return { ...intType(unsigned ? width[1] : width[0], nullable, unsigned), ...base, field: t.type }
  switch (t.type) {
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return { ...decimalType(t.precision ?? 10, t.scale ?? 0, nullable, unsigned), ...base }
    case FIELD_TYPE.FLOAT:
      return { ...doubleType(nullable, 12), ...base, field: FIELD_TYPE.FLOAT }
    case FIELD_TYPE.DOUBLE:
      return { ...doubleType(nullable, 22), ...base }
    case FIELD_TYPE.YEAR:
      return { ...intType(4, nullable, true), ...base, field: FIELD_TYPE.YEAR, unsigned: true }
    case FIELD_TYPE.BIT:
      return { ...intType(t.bits ?? 1, nullable, true), ...base, field: FIELD_TYPE.BIT, unsigned: true }
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE:
      return { ...datetimeType(FIELD_TYPE.DATE, 0, nullable), ...base }
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.DATETIME2:
      return { ...datetimeType(FIELD_TYPE.DATETIME, t.decimals ?? 0, nullable), ...base }
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIMESTAMP2:
      return { ...datetimeType(FIELD_TYPE.TIMESTAMP, t.decimals ?? 0, nullable), ...base }
    case FIELD_TYPE.TIME:
    case FIELD_TYPE.TIME2:
      return { ...datetimeType(FIELD_TYPE.TIME, t.decimals ?? 0, nullable), ...base }
    case FIELD_TYPE.ENUM:
    case FIELD_TYPE.SET: {
      const longest = Math.max(0, ...(t.members ?? []).map((m) => [...m].length))
      const length = t.type === FIELD_TYPE.SET ? (t.members ?? []).reduce((n, m) => n + [...m].length, 0) + Math.max(0, (t.members ?? []).length - 1) : longest
      const kindFlag = t.type === FIELD_TYPE.ENUM ? COLUMN_FLAG.ENUM : COLUMN_FLAG.SET
      return { ...stringType(length, t.collationId ?? 255, nullable), ...base, field: FIELD_TYPE.STRING, scale: 0, coercibility: 2, column: { ...source, flags: flags | kindFlag } }
    }
    default: {
      const blob = BLOB_BYTES[t.type]
      if (blob !== undefined) {
        const s = stringType(blob, t.collationId ?? CHARSET_BINARY, nullable)
        return { ...s, ...base, field: FIELD_TYPE.BLOB, scale: 0, blobBytes: blob, coercibility: 2, column: { ...source, flags: flags | COLUMN_FLAG.BLOB } }
      }
      const s = stringType(t.length ?? 1, t.collationId ?? CHARSET_BINARY, nullable)
      return { ...s, ...base, field: t.type === FIELD_TYPE.STRING ? FIELD_TYPE.STRING : FIELD_TYPE.VAR_STRING, scale: 0, coercibility: 2 }
    }
  }
}

/** The width a result's text takes, in characters — what string functions and `CAST(… AS CHAR)` size by. */
export function charWidth(t: ResultType): number {
  switch (t.kind) {
    case 'int':
      return t.length
    case 'decimal':
      return t.length + (t.scale > 0 ? 1 : 0) + (t.unsigned ? 0 : 1)
    case 'double':
      return t.field === FIELD_TYPE.FLOAT ? 12 : 22
    case 'datetime':
      return t.field === FIELD_TYPE.DATE ? 10 : 19 + (t.scale > 0 ? t.scale + 1 : 0)
    case 'time':
      return 10 + (t.scale > 0 ? t.scale + 1 : 0)
    case 'null':
      return 0
    default:
      return t.length
  }
}

/**
 * The ColumnDefinition41 a client receives. `resultsCollation` is the
 * session's: text is converted into it, so its charset and its width are what
 * the column reports.
 */
export function columnDefinition(name: string, t: ResultType, resultsCollation: number): ColumnDefinition {
  let flags = t.column?.flags ?? 0
  if (!t.nullable) flags |= COLUMN_FLAG.NOT_NULL
  if (t.unsigned && t.kind !== 'null') flags |= COLUMN_FLAG.UNSIGNED
  const isText = t.kind === 'string' || (t.asText === true && !(t.temporary !== undefined && t.temporary !== false))
  // A bare column of a number type carries no BINARY flag; every other
  // non-text result does, a literal and an expression included.
  const numericColumn = t.column !== undefined && (t.kind === 'int' || t.kind === 'decimal' || t.kind === 'double')
  if (!isText && !numericColumn) flags |= COLUMN_FLAG.BINARY
  // A string in a `_bin` collation is flagged binary too, column or expression.
  if (t.kind === 'string' && requireCollationInfo(t.collationId).name.endsWith('_bin')) flags |= COLUMN_FLAG.BINARY
  if (t.field === FIELD_TYPE.BLOB && t.kind === 'bytes') flags |= COLUMN_FLAG.BINARY
  // Read from a temporary table's field rather than from the item: what a
  // grouping, a DISTINCT or a sort after grouping copies into one (M5.5).
  const materialized = t.temporary !== undefined && t.temporary !== false
  if (materialized) {
    // GROUP_FLAG marks a nullable field of the table's key — a DISTINCT's
    // every item, a grouping's keys — column or expression: every non-key
    // DISTINCT column the first corpus drew was nullable, which hid the
    // NOT NULL half of that (8.4.11, E-17, M5.18).
    const grouped = t.temporary === true && t.nullable ? GROUP_FLAG : 0
    if (t.column !== undefined) flags = (flags & ~KEY_FLAGS) | grouped
    else if (!(t.ownInTemporary === true && t.temporary !== 'stream')) {
      const keep = COLUMN_FLAG.NOT_NULL | COLUMN_FLAG.UNSIGNED | (t.kind === 'string' && requireCollationInfo(t.collationId).name.endsWith('_bin') ? COLUMN_FLAG.BINARY : 0)
      flags = (flags & keep) | ((t.fieldFlags ?? 0) & ~KEY_FLAGS & ~COLUMN_FLAG.NOT_NULL) | grouped
    }
  }
  // A materialized temporal is a temporal field again, binary and its own width.
  const asText = t.asText === true && !materialized
  if (t.asText === true && materialized && t.column === undefined) flags |= COLUMN_FLAG.BINARY

  let length: number
  let decimals = t.scale
  switch (t.kind) {
    case 'int':
      length = t.length
      decimals = 0
      break
    case 'decimal':
      length = charWidth(t)
      break
    case 'double':
      length = t.length
      decimals = 31
      break
    case 'datetime':
    case 'time':
      length = charWidth(t) * (asText ? requireCollationInfo(resultsCollation).mbmaxlen : 1)
      break
    case 'null':
      length = 0
      decimals = 0
      break
    case 'bytes':
      length = t.length
      decimals = t.column !== undefined || materialized ? 0 : 31
      break
    case 'string': {
      const mb = requireCollationInfo(resultsCollation).mbmaxlen
      length = Math.min(4294967295, t.blobBytes !== undefined ? t.blobBytes * mb : t.length * mb)
      decimals = t.column !== undefined || materialized ? 0 : 31
      break
    }
  }
  let field = t.field
  // An integer expression's temporary field is an INT below ten characters
  // and a BIGINT from there (8.4.11: `n IS NULL` is type 3, `LENGTH(s)` type 8);
  // MIN and MAX of a column copy the column's own field.
  if (materialized && t.kind === 'int' && t.column === undefined && t.fieldFlags === undefined && t.ownInTemporary !== true) field = t.length < 10 ? FIELD_TYPE.LONG : FIELD_TYPE.LONGLONG
  if (t.wireLength !== undefined) {
    // GROUP_CONCAT's BLOB: as the item, a length no rule gives; as a
    // temporary table's field, a BLOB of that many bytes over the argument
    // charset's width, flagged BLOB (8.4.11: 252, 16,384 over utf8mb4 and
    // 4,096 over latin1, 0x10).
    if (materialized) {
      field = FIELD_TYPE.BLOB
      length = Math.floor(t.wireLength / (t.kind === 'string' ? requireCollationInfo(t.collationId).mbmaxlen : 1))
      flags |= COLUMN_FLAG.BLOB
    } else length = t.wireLength
  }
  return {
    ...(t.column === undefined ? { schema: '', table: '', orgTable: '', orgName: '' } : { schema: t.column.schema, table: t.column.table, orgTable: t.column.orgTable, orgName: t.column.orgName }),
    name,
    characterSet: isText ? resultsCollation : CHARSET_BINARY,
    columnLength: length,
    type: field,
    flags,
    decimals,
  }
}
