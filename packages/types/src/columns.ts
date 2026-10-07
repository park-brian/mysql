// M4.23 — from a column's type to how it is stored and how it is keyed.
//
// The joins nothing made before the catalog: a record needs to know which
// fields are fixed-width (doc 23's null bitmap and length array skip them), and
// an index needs a `KeyPart` per column. Both follow from the type alone, and
// both live here because the rules are this package's — the per-type codecs
// already decide every width; this only asks them.
//
// One case is not what the type name suggests (doc 24): `CHAR(n)` is fixed
// only in a single-byte charset or `binary`. In a multi-byte charset COMPACT
// and DYNAMIC store it as variable-length, trailing spaces stripped.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import { decimalBinSize } from './decimal.ts'
import { TypeError_, unsupportedType } from './errors.ts'
import { declaredKeyWidth, type KeyPart } from './keys.ts'
import { bitBinSize, enumBinSize, setBinSize } from './strings.ts'
import { datetimeBinSize, timeBinSize, timestampBinSize } from './temporal.ts'
import type { ColumnMeta } from './values.ts'

/**
 * A column's type as the catalog keeps it: `ColumnMeta`, which says how to
 * decode a value, plus the declared length — characters for a string type,
 * which a key's width and a CHAR's width both depend on.
 */
export interface ColumnType extends ColumnMeta {
  readonly length?: number
}

const isBinary = (t: ColumnType): boolean => t.collationId === undefined || t.collationId === CHARSET_BINARY

const STRING_TYPES: ReadonlySet<number> = new Set([
  FIELD_TYPE.STRING,
  FIELD_TYPE.VAR_STRING,
  FIELD_TYPE.VARCHAR,
  FIELD_TYPE.TINY_BLOB,
  FIELD_TYPE.BLOB,
  FIELD_TYPE.MEDIUM_BLOB,
  FIELD_TYPE.LONG_BLOB,
])

const BLOB_TYPES: ReadonlySet<number> = new Set([FIELD_TYPE.TINY_BLOB, FIELD_TYPE.BLOB, FIELD_TYPE.MEDIUM_BLOB, FIELD_TYPE.LONG_BLOB])

/**
 * The bytes a value of this type always takes in a record, or `undefined` when
 * it varies. Every number comes from the codec that writes the value.
 */
export function storageWidth(t: ColumnType): number | undefined {
  switch (t.type) {
    case FIELD_TYPE.TINY:
      return 1
    case FIELD_TYPE.SHORT:
      return 2
    case FIELD_TYPE.INT24:
      return 3
    case FIELD_TYPE.LONG:
      return 4
    case FIELD_TYPE.LONGLONG:
      return 8
    case FIELD_TYPE.FLOAT:
      return 4
    case FIELD_TYPE.DOUBLE:
      return 8
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return decimalBinSize(t.precision ?? 10, t.scale ?? 0)
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.NEWDATE:
      return 3
    case FIELD_TYPE.YEAR:
      return 1
    case FIELD_TYPE.TIME:
    case FIELD_TYPE.TIME2:
      return timeBinSize(t.decimals ?? 0)
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.DATETIME2:
      return datetimeBinSize(t.decimals ?? 0)
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.TIMESTAMP2:
      return timestampBinSize(t.decimals ?? 0)
    case FIELD_TYPE.BIT:
      return bitBinSize(t.bits ?? 1)
    case FIELD_TYPE.ENUM:
      return enumBinSize(t.members?.length ?? 0)
    case FIELD_TYPE.SET:
      return setBinSize(t.members?.length ?? 0)
    case FIELD_TYPE.STRING:
      // doc 24: fixed `n` bytes only in a single-byte charset (or binary).
      if (isBinary(t) || requireCollationInfo(t.collationId as number).mbmaxlen === 1) return t.length ?? 1
      return undefined
    default:
      return undefined
  }
}

/** ER_BLOB_KEY_WITHOUT_LENGTH, 1170 / 42000. */
function blobKeyWithoutLength(): TypeError_ {
  return new TypeError_('ER_BLOB_KEY_WITHOUT_LENGTH', 'BLOB/TEXT column used in key specification without a key length', { errno: 1170, sqlState: '42000' })
}

/** ER_JSON_USED_AS_KEY, 3152 / 42000. */
function jsonUsedAsKey(): TypeError_ {
  return new TypeError_('ER_JSON_USED_AS_KEY', 'JSON column cannot be used in key specification', { errno: 3152, sqlState: '42000' })
}

/** ER_WRONG_SUB_KEY, 1089 / HY000: a prefix on a type that has none, or longer than the column. */
function wrongSubKey(): TypeError_ {
  return new TypeError_(
    'ER_WRONG_SUB_KEY',
    'Incorrect prefix key; the used key part isn\'t a string, the used length is longer than the key part, or the storage engine doesn\'t support unique prefix keys',
    { errno: 1089, sqlState: 'HY000' },
  )
}

export interface KeyPartOptions {
  /** A prefix: characters for a collated string, bytes for a binary one. */
  readonly prefix?: number
  readonly descending?: boolean
}

/**
 * How a column contributes to an index key (`keys.ts`). A collated string is a
 * `'text'` part of its collation's declared width; FLOAT and DOUBLE are
 * `'float'`; everything else is already `memcmp`-ordered bytes, padded to a
 * width where its length can vary (D-35). MySQL's refusals come with MySQL's
 * numbers.
 */
export function keyPartOf(t: ColumnType, nullable: boolean, options: KeyPartOptions = {}): KeyPart {
  const { prefix } = options
  const descending = options.descending === true ? { descending: true } : {}
  if (t.type === FIELD_TYPE.JSON) throw jsonUsedAsKey()
  if (t.type === FIELD_TYPE.GEOMETRY) throw unsupportedType('a spatial index')
  if (!STRING_TYPES.has(t.type)) {
    if (prefix !== undefined) throw wrongSubKey()
    return { kind: t.type === FIELD_TYPE.FLOAT || t.type === FIELD_TYPE.DOUBLE ? 'float' : 'bytes', nullable, ...descending }
  }
  const blob = BLOB_TYPES.has(t.type)
  if (blob && prefix === undefined) throw blobKeyWithoutLength()
  if (prefix !== undefined && (prefix <= 0 || (!blob && t.length !== undefined && prefix > t.length))) throw wrongSubKey()
  const length = prefix ?? t.length ?? 1
  const truncates = prefix !== undefined ? { prefix } : {}
  if (!isBinary(t)) {
    const collationId = t.collationId as number
    // A CHAR's trailing spaces are not its value; only a single-byte-minimum
    // charset spells a space 0x20 (the UTF-16 and UTF-32 ones are PAD SPACE).
    const trim = t.type === FIELD_TYPE.STRING && requireCollationInfo(collationId).mbminlen === 1 ? { trimSpaces: true } : {}
    // `declaredKeyWidth` asks the collation, so one with no sort key yet is
    // refused here, at definition, rather than at the first insert.
    return { kind: 'text', nullable, collationId, width: declaredKeyWidth(collationId, length), ...truncates, ...descending, ...trim }
  }
  // BINARY(n) without a prefix is fixed-width already; anything else may vary.
  if (t.type === FIELD_TYPE.STRING && prefix === undefined) return { kind: 'bytes', nullable, ...descending }
  return { kind: 'bytes', nullable, width: length, ...truncates, ...descending }
}
