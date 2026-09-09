// M1.19 — `ColumnDefinition41`.
//
// Layout from docs/15-wire-types.md. Three fields carry more meaning than
// their names suggest:
//
//   `type` is the *wire* type, not necessarily the declared SQL type — ENUM
//   and SET arrive as STRING with a flag.
//
//   `character_set` == 63 (`binary`) means the value is bytes, not text. This
//   is the only thing distinguishing VARBINARY from VARCHAR and BLOB from
//   TEXT, because the type byte is identical.
//
//   `column_length` is in **bytes**, not characters, so a VARCHAR(255) in
//   utf8mb4 reports 1020.

import { Reader, Writer } from '@myjs/bytes'
import { CHARSET_BINARY, CHARSET_UTF8MB4_0900_AI_CI, COLUMN_FLAG, FIELD_TYPE } from '../constants/types.ts'
import { mbMaxLenOf } from '../constants/charset-widths.ts'
import { protocolError } from '../errors/index.ts'
import { fromUtf8, utf8 } from '../text.ts'

/** The fixed block after the six names is always 12 bytes. */
const FIXED_BLOCK_LENGTH = 0x0c

/** `decimals` for FLOAT/DOUBLE and dynamic strings (doc 15). */
export const DECIMALS_NOT_FIXED = 0x1f

export interface ColumnDefinition {
  readonly schema?: string
  /** The table as the query sees it — an alias, if there is one. */
  readonly table?: string
  readonly orgTable?: string
  readonly name: string
  readonly orgName?: string
  readonly characterSet: number
  readonly columnLength: number
  readonly type: number
  readonly flags: number
  readonly decimals: number
  /** Only present in a `COM_FIELD_LIST` response. */
  readonly defaultValue?: Uint8Array | null
}

export interface WriteColumnOptions {
  /** `COM_FIELD_LIST` appends a length-encoded default value; nothing else does. */
  readonly forFieldList?: boolean
}

export function writeColumnDefinition41(
  w: Writer,
  column: ColumnDefinition,
  options: WriteColumnOptions = {},
): void {
  w.lenEncBytes(utf8('def')) // catalog is always "def"
  w.lenEncBytes(utf8(column.schema ?? ''))
  w.lenEncBytes(utf8(column.table ?? ''))
  w.lenEncBytes(utf8(column.orgTable ?? column.table ?? ''))
  w.lenEncBytes(utf8(column.name))
  w.lenEncBytes(utf8(column.orgName ?? column.name))
  w.lenEncInt(FIXED_BLOCK_LENGTH)
  w.u16(column.characterSet)
  w.u32(column.columnLength)
  w.u8(column.type)
  w.u16(column.flags)
  w.u8(column.decimals)
  w.zeros(2) // reserved
  if (options.forFieldList === true) {
    w.lenEncBytes(column.defaultValue ?? null)
  }
}

export function parseColumnDefinition41(
  payload: Uint8Array,
  options: WriteColumnOptions = {},
): ColumnDefinition {
  const r = new Reader(payload)
  const catalog = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
  if (catalog !== 'def') {
    throw protocolError('ER_MALFORMED_PACKET', `ColumnDefinition41: catalog must be "def", got ${catalog}`)
  }
  const schema = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
  const table = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
  const orgTable = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
  const name = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
  const orgName = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
  const fixed = Number(r.lenEncInt() ?? 0n)
  if (fixed !== FIXED_BLOCK_LENGTH) {
    // A MariaDB server puts an extended metadata block before this marker when
    // MARIADB_CLIENT_EXTENDED_METADATA is negotiated. A MySQL server never
    // does, and neither do we (D-10).
    throw protocolError('ER_MALFORMED_PACKET', `ColumnDefinition41: expected a 0x0c fixed block, got 0x${fixed.toString(16)}`)
  }
  const characterSet = r.u16()
  const columnLength = r.u32()
  const type = r.u8()
  const flags = r.u16()
  const decimals = r.u8()
  r.skip(2)
  const defaultValue = options.forFieldList === true ? r.lenEncBytes() : undefined
  return {
    schema,
    table,
    orgTable,
    name,
    orgName,
    characterSet,
    columnLength,
    type,
    flags,
    decimals,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  }
}

/**
 * `column_length` for a character column: the declared character length times
 * the charset's maximum bytes per character.
 *
 * utf8mb4 is 4, so `VARCHAR(255)` reports 1020 — M1.19's acceptance assertion.
 *
 * M2.4: `mbMaxLen` is now looked up from the generated width table when a
 * collation id is given instead. The two-argument form stays, because a caller
 * that already knows the width should not have to invent an id for it.
 */
export function columnLengthForChars(charLength: number, mbMaxLen: number): number {
  return charLength * mbMaxLen
}

/** The same, from the collation id a `ColumnDefinition` actually carries. */
export function columnLengthForCollation(charLength: number, collationId: number): number {
  return charLength * mbMaxLenOf(collationId)
}

/** True when this column carries bytes rather than text. */
export function isBinaryColumn(column: Pick<ColumnDefinition, 'characterSet'>): boolean {
  return column.characterSet === CHARSET_BINARY
}

/**
 * Whether a column is a BLOB rather than a TEXT.
 *
 * The type byte is identical for both; only the charset separates them, which
 * is exactly how a client decides whether to hand back a string or bytes
 * (D-15).
 */
export function isBlob(column: Pick<ColumnDefinition, 'type' | 'characterSet'>): boolean {
  const blobTypes: number[] = [
    FIELD_TYPE.TINY_BLOB,
    FIELD_TYPE.MEDIUM_BLOB,
    FIELD_TYPE.LONG_BLOB,
    FIELD_TYPE.BLOB,
  ]
  return blobTypes.includes(column.type) && column.characterSet === CHARSET_BINARY
}

/** Convenience for building a column definition without repeating defaults. */
export function column(
  name: string,
  type: number,
  over: Partial<ColumnDefinition> = {},
): ColumnDefinition {
  const numeric =
    type === FIELD_TYPE.TINY ||
    type === FIELD_TYPE.SHORT ||
    type === FIELD_TYPE.LONG ||
    type === FIELD_TYPE.LONGLONG ||
    type === FIELD_TYPE.INT24 ||
    type === FIELD_TYPE.FLOAT ||
    type === FIELD_TYPE.DOUBLE ||
    type === FIELD_TYPE.NEWDECIMAL ||
    type === FIELD_TYPE.YEAR
  return {
    name,
    type,
    characterSet: numeric ? CHARSET_BINARY : CHARSET_UTF8MB4_0900_AI_CI,
    columnLength: 0,
    flags: numeric ? COLUMN_FLAG.NUM : 0,
    decimals: 0,
    ...over,
  }
}
