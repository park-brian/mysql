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
const PART_KEY_FLAG = 0x4000

/** What an expression yields, before a result charset turns it into metadata. */
export type ResultKind = 'int' | 'decimal' | 'double' | 'string' | 'bytes' | 'datetime' | 'time' | 'json' | 'null'

export interface ResultType {
  readonly kind: ResultKind
  /**
   * A hex or bit literal: bytes as written, and in arithmetic an integer as
   * wide as its largest value — unsigned for hex, signed for bits (8.4.11).
   */
  readonly literalInt?: { readonly digits: number; readonly unsigned: boolean }
  /** A derived table's, a CTE's or a view's column of one: bytes again, but with 0 decimals (8.4.11). */
  readonly wasLiteralInt?: true
  /** The wire field type. */
  readonly field: number
  /**
   * What an expression column reports in place of a table column's names,
   * when not the defaults (8.4.11). Read through a derived table, CTE or view,
   * its original name is the derived column's and its original table a view's
   * name, or none. Read from a temporary table's field, its original name is
   * its own name — though not an aggregate an aggregating table computes,
   * which is the aggregate and not the field.
   */
  readonly names?: Omit<SourceColumn, 'flags'> & {
    /**
     * A merged view's expression: the view's schema, which it reports once
     * a temporary table copies it (a DISTINCT, a grouping, a sort over a
     * join), with no original table (8.4.11).
     */
    readonly viewSchema?: string
  }
  /**
   * An INFORMATION_SCHEMA column read bare (M5.12): the definition 8.4.11
   * reports for it, captured whole, because a view over the data dictionary
   * reports a dictionary column and a computed one in ways no rule here
   * derives. `length` is in bytes of a utf8mb4 result for text, as captured.
   */
  readonly wire?: { readonly field: number; readonly length: number; readonly flags: number; readonly decimals: number; readonly text: boolean; readonly streamed?: readonly [number, number, number, number] }
  /** A boolean's result — a comparison, `TRUE`, `NOT`: JSON takes it as `true` or `false`. */
  readonly boolean?: boolean
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
  /** A string literal's text, which collation aggregation must be able to convert into the collation it chooses (1267, 1270). */
  readonly literalText?: string
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
  /**
   * A set operation's column (`Item_type_holder`): its field type is the
   * branches' aggregate, kept as is — `INT UNION INT` is an INT, where an
   * integer expression's temporary field would be sized by its width.
   */
  readonly keepField?: boolean
  /**
   * A set operation's column that holds a table column from some branch: what
   * `INSERT … SELECT` copies from it is copied field to field, and a string too
   * long for its target is 1265 rather than 1406 (8.4.11, M5.20).
   */
  readonly fromField?: boolean
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
/** A boolean result: an INT(1), and `true` or `false` when it meets JSON (8.4.11: `JSON_ARRAY(1 = 1)` is `[true]`). */
export const boolType = (nullable: boolean): ResultType => ({ ...intType(1, nullable), boolean: true })

/** The longest a JSON value may be: `max_length` of a JSON field, 2³² − 1. */
const JSON_MAX = 4294967295

/**
 * A JSON result (M5.21). As an expression it is reported in the results
 * charset, 4,294,967,292 long — the most whole utf8mb4 characters in 2³² − 1
 * bytes — with 31 decimals and BINARY; as a column, or a temporary table's
 * field, it is charset 63, 2³² − 1 long, BLOB and BINARY (8.4.11).
 */
/** JSON where it meets a string: a LONGTEXT in utf8mb4_bin, the collation a JSON value's text has (8.4.11: `s UNION ALL doc` is 252, BLOB and BINARY). */
export const jsonAsText = (nullable: boolean): ResultType => ({ ...stringType(JSON_MAX / 4, CHARSET_UTF8MB4_BIN, nullable), field: FIELD_TYPE.BLOB, blobBytes: JSON_MAX / 4, coercibility: 2 })

/** utf8mb4_bin (`strings/ctype-utf8.cc`): the collation of a JSON value's text. */
export const CHARSET_UTF8MB4_BIN = 46
/** utf8mb3_general_ci (`strings/ctype-utf8.cc`): the system charset, which COLLATION() and CHARSET() answer in. */
export const CHARSET_UTF8MB3_GENERAL_CI = 33

export const jsonType = (nullable: boolean): ResultType => ({ kind: 'json', field: FIELD_TYPE.JSON, nullable, unsigned: false, length: JSON_MAX, scale: 0, collationId: CHARSET_BINARY })

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

/**
 * A DOUBLE with fixed decimals, from FLOAT(M,D) operands: when every operand
 * has a scale below 31 and one of them is such a double, the result keeps
 * the largest scale and is as wide as the widest integer part plus it
 * (`Item::aggregate_float_properties`). Otherwise undefined: 31 decimals.
 */
export function fixedDouble(types: readonly ResultType[], nullable: boolean): ResultType | undefined {
  if (!types.some((t) => t.kind === 'double' && t.scale < 31)) return undefined
  if (!types.every((t) => (t.kind === 'int' || t.kind === 'decimal' || t.kind === 'double') && t.scale < 31)) return undefined
  const scale = Math.max(...types.map((t) => t.scale))
  const whole = Math.max(...types.map((t) => (t.kind === 'decimal' ? charWidth(t) : t.length) - t.scale))
  return { ...doubleType(nullable, whole + scale), scale }
}

/** A function of one fixed-decimal double, or an aggregate of it: `float_length`, DBL_DIG + 2 + D wide. */
export const floatLength = (scale: number, nullable: boolean): ResultType => (scale >= 31 ? doubleType(nullable, 23) : { ...doubleType(nullable, 17 + scale), scale })

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
export function keyFlags(def: TableDef, name: string): number {
  let flags = 0
  for (const index of def.indexes) {
    const at = index.parts.findIndex((p) => p.column === name)
    if (at < 0) continue
    flags |= PART_KEY_FLAG
    // With no PRIMARY KEY, the unique key InnoDB clusters on — the first whose
    // columns are all NOT NULL — is reported as one (8.4.11: SERIAL's key).
    if (index.kind === 'primary' || index.name === def.clustered) flags |= COLUMN_FLAG.PRI_KEY
    else if (index.kind === 'unique' && index.parts.length === 1) flags |= COLUMN_FLAG.UNIQUE_KEY
    else if (at === 0) flags |= COLUMN_FLAG.MULTIPLE_KEY
  }
  // A FULLTEXT key is a key too: every column of it a part, its first a
  // multiple one (8.4.11: SHOW COLUMNS says MUL, and the result flags agree).
  const fulltext = def.options['fulltext']
  if (Array.isArray(fulltext)) {
    for (const index of fulltext as readonly { readonly columns?: readonly string[] }[]) {
      const at = index.columns?.indexOf(name) ?? -1
      if (at < 0) continue
      flags |= PART_KEY_FLAG
      if (at === 0) flags |= COLUMN_FLAG.MULTIPLE_KEY
    }
  }
  return flags
}

const fixedScale = (t: ColumnDef['type']): { scale?: number } => (t.precision !== undefined && t.scale !== undefined ? { scale: t.scale } : {})

/** A table column's result type, as `SELECT c FROM t` reports it. */
export function columnResultType(def: TableDef, column: ColumnDef, tableAlias: string): ResultType {
  const t = column.type
  const nullable = column.nullable
  const unsigned = t.unsigned === true
  let flags = keyFlags(def, column.name)
  if (column.autoIncrement === true) flags |= COLUMN_FLAG.AUTO_INCREMENT
  if (!nullable && column.autoIncrement !== true && column.attributes?.['default'] === undefined) flags |= COLUMN_FLAG.NO_DEFAULT_VALUE
  if (t.type === FIELD_TYPE.YEAR || column.attributes?.['zerofill'] === true) flags |= COLUMN_FLAG.ZEROFILL
  const source: SourceColumn = { schema: def.schema, table: tableAlias, orgTable: def.name, orgName: column.name, flags }
  const base = { nullable, unsigned, column: source }

  const width = INT_WIDTH[t.type]
  // A declared display width is the field's length, deprecated or not: TINYINT(1)
  // reports 1, which is how a driver knows a boolean (8.4.11).
  const declared = column.attributes?.['width']
  if (width !== undefined) return { ...intType(typeof declared === 'number' ? declared : unsigned ? width[1] : width[0], nullable, unsigned), ...base, field: t.type }
  switch (t.type) {
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return { ...decimalType(t.precision ?? 10, t.scale ?? 0, nullable, unsigned), ...base }
    // FLOAT(M,D) reports M as its length and D as its decimals (8.4.11).
    case FIELD_TYPE.FLOAT:
      return { ...doubleType(nullable, t.precision ?? 12), ...fixedScale(t), ...base, field: FIELD_TYPE.FLOAT }
    case FIELD_TYPE.DOUBLE:
      return { ...doubleType(nullable, t.precision ?? 22), ...fixedScale(t), ...base }
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
    case FIELD_TYPE.JSON:
      return { ...jsonType(nullable), ...base, column: { ...source, flags: flags | COLUMN_FLAG.BLOB } }
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
      // A FLOAT(M,D) column is M wide as text (8.4.11: CONCAT of a FLOAT(5,2) is 20 bytes over utf8mb4).
      if (t.column !== undefined && t.scale < 31) return t.length
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
  // A NULL constant in the view is not copied into a temporary table: it
  // reports what it always does (8.4.11: STATISTICS.PACKED under a sort).
  if (t.wire !== undefined && (t.temporary === undefined || t.temporary === false || t.temporary === 'stream' || t.wire.field === FIELD_TYPE.NULL)) {
    // Under a sort, what 8.4.11 reports for the column streamed through a
    // temporary table, captured as such: a constant is not copied at all.
    const streamed = t.temporary === 'stream' ? t.wire.streamed : undefined
    const w = streamed === undefined ? t.wire : { ...t.wire, field: streamed[0], length: streamed[1], flags: streamed[2], decimals: streamed[3] }
    const mb = requireCollationInfo(resultsCollation).mbmaxlen
    return {
      ...(t.names ?? { schema: '', table: '', orgTable: '', orgName: '' }),
      name,
      characterSet: w.text ? resultsCollation : CHARSET_BINARY,
      columnLength: w.text ? Math.min(4294967295, Math.ceil(w.length / 4) * mb) : w.length,
      type: w.field,
      // The column's own NOT NULL, unless the query made it nullable: an outer join's inner side.
      flags: t.nullable ? w.flags & ~COLUMN_FLAG.NOT_NULL : w.flags,
      decimals: w.decimals,
    }
  }
  let flags = t.column?.flags ?? 0
  if (!t.nullable) flags |= COLUMN_FLAG.NOT_NULL
  // A hex literal is reported unsigned, bytes or not, as the integer it can be (8.4.11).
  if ((t.unsigned || t.literalInt?.unsigned === true) && t.kind !== 'null') flags |= COLUMN_FLAG.UNSIGNED
  const isText = t.kind === 'string' || (t.asText === true && !(t.temporary !== undefined && t.temporary !== false))
  // A bare column of a number type carries no BINARY flag; every other
  // non-text result does, a literal and an expression included.
  const numericColumn = t.column !== undefined && (t.kind === 'int' || t.kind === 'decimal' || t.kind === 'double')
  // A BIT, column or expression (MAX(b), COALESCE(b)), carries none either (8.4.11).
  if (!isText && !numericColumn && !(t.field === FIELD_TYPE.BIT && t.kind === 'int')) flags |= COLUMN_FLAG.BINARY
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
      // A number's field carries no BINARY; a temporal's, a byte string's and
      // a `_bin` string's do.
      const binaryField = t.kind === 'datetime' || t.kind === 'time' || t.kind === 'bytes' || (t.kind === 'string' && requireCollationInfo(t.collationId).name.endsWith('_bin'))
      const keep = COLUMN_FLAG.NOT_NULL | COLUMN_FLAG.UNSIGNED | (binaryField ? COLUMN_FLAG.BINARY : 0)
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
      // 31, NOT_FIXED_DEC, unless a FLOAT(M,D) fixed them (8.4.11).
      decimals = t.scale < 31 ? t.scale : 31
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
      decimals = t.column !== undefined || materialized || t.literalInt !== undefined || t.wasLiteralInt === true ? 0 : 31
      break
    case 'string': {
      const mb = requireCollationInfo(resultsCollation).mbmaxlen
      length = Math.min(4294967295, t.blobBytes !== undefined ? t.blobBytes * mb : t.length * mb)
      decimals = t.column !== undefined || materialized ? 0 : 31
      break
    }
    case 'json': {
      if (t.column !== undefined || materialized) {
        length = JSON_MAX
        decimals = 0
        flags |= COLUMN_FLAG.BLOB | COLUMN_FLAG.BINARY
      } else {
        const mb = requireCollationInfo(resultsCollation).mbmaxlen
        length = Math.floor(JSON_MAX / mb) * mb
        decimals = 31
      }
      break
    }
  }
  let field = t.field
  // An integer expression's temporary field is an INT below ten characters
  // and a BIGINT from there (8.4.11: `n IS NULL` is type 3, `LENGTH(s)` type 8);
  // MIN and MAX of a column copy the column's own field.
  if (materialized && t.kind === 'int' && t.column === undefined && t.fieldFlags === undefined && t.ownInTemporary !== true && t.keepField !== true) field = t.length < 10 ? FIELD_TYPE.LONG : FIELD_TYPE.LONGLONG
  // A temporary table holds a string expression over 512 characters as a
  // BLOB of its bytes (`CONVERT_IF_BIGGER_TO_BLOB`); a column's copy keeps its
  // own field (8.4.11: `e UNION 'k'` over a VARCHAR(513) is type 252, 8,208).
  if (materialized && t.column === undefined && (t.kind === 'string' || t.kind === 'bytes') && (field === FIELD_TYPE.VAR_STRING || field === FIELD_TYPE.VARCHAR || field === FIELD_TYPE.STRING) && t.length > 512 && t.wireLength === undefined) {
    field = FIELD_TYPE.BLOB
    length = t.kind === 'bytes' ? t.length : Math.min(4294967295, t.length * requireCollationInfo(t.collationId).mbmaxlen * requireCollationInfo(resultsCollation).mbmaxlen)
    decimals = 0
  }
  // A BLOB field says so, column or not, and a temporary table's is a BLOB
  // whatever its size: LONGTEXT's 251 is reported as 252 (8.4.11).
  if (materialized && t.column === undefined && field >= FIELD_TYPE.TINY_BLOB && field <= FIELD_TYPE.BLOB) {
    flags |= COLUMN_FLAG.BLOB
    field = FIELD_TYPE.BLOB
  }
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
    ...(t.column === undefined ? (materialized && t.names?.viewSchema !== undefined ? { schema: t.names.viewSchema, table: t.names.table, orgTable: '', orgName: t.names.orgName } : (t.names ?? { schema: '', table: '', orgTable: '', orgName: materialized ? name : '' })) : { schema: t.column.schema, table: t.column.table, orgTable: t.column.orgTable, orgName: t.column.orgName }),
    name,
    characterSet: isText || (t.kind === 'json' && t.column === undefined && !materialized) ? resultsCollation : CHARSET_BINARY,
    columnLength: length,
    type: field,
    flags,
    decimals,
  }
}

/** 3720: what NATIONAL, NCHAR and NVARCHAR draw, in a column or a CAST (8.4.11). */
export const NATIONAL_DEPRECATION =
  'NATIONAL/NCHAR/NVARCHAR implies the character set UTF8MB3, which will be replaced by UTF8MB4 in a future release. Please consider using CHAR(x) CHARACTER SET UTF8MB4 in order to be unambiguous.'
