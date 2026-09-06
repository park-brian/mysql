// M1.20 — the text resultset.
//
// Structure from doc 14:
//
//   [ if CLIENT_OPTIONAL_RESULTSET_METADATA: int<1> metadata_follows ]
//   int<lenenc>  column_count
//   [ column_count x ColumnDefinition41 ]
//   [ EOF ]                       only if !CLIENT_DEPRECATE_EOF
//   row *
//   terminator: ERR | OK-with-0xFE | EOF
//
// Everything here emits *packet payloads*; framing and sequence ids stay with
// the framer (M1.2).

import { Writer, bitmapFrom, RESULTSET_ROW_OFFSET } from '@myjs/bytes'
import { CLIENT, RESULTSET_METADATA, SERVER_STATUS, hasCap, type Capabilities } from '../constants/capabilities.ts'
import { renderTextValue, type SqlValue } from '../values.ts'
import { writeBinaryValue } from '../binary-values.ts'
import { CHARSET_BINARY, COLUMN_FLAG, FIELD_TYPE } from '../constants/types.ts'
import { writeColumnDefinition41, type ColumnDefinition } from './column.ts'
import { writeErr, writeOk, writeTerminator } from './generic.ts'

export interface ResultSet {
  readonly columns: readonly ColumnDefinition[]
  readonly rows: readonly (readonly SqlValue[])[]
}

export interface OkResult {
  readonly affectedRows?: number | bigint
  readonly insertId?: number | bigint
  readonly warnings?: number
  readonly info?: string
}

/** What the executor hands back for one statement. */
export type StatementResult = ResultSet | OkResult

export function isResultSet(result: StatementResult): result is ResultSet {
  return 'columns' in result
}

export interface ResultsetOptions {
  readonly statusFlags?: number
  readonly warnings?: number
  /** Sets `SERVER_MORE_RESULTS_EXISTS` on this resultset's terminator. */
  readonly moreResults?: boolean
}

export function columnCountPacket(caps: Capabilities, count: number): Uint8Array {
  const w = new Writer(16)
  // Doc 17 says to parse the flag from day one so we do not misread a client
  // that negotiated it, even though we always send full metadata for now.
  if (hasCap(caps, CLIENT.OPTIONAL_RESULTSET_METADATA)) w.u8(RESULTSET_METADATA.FULL)
  w.lenEncInt(count)
  return w.toBytes()
}

export function columnDefinitionPacket(column: ColumnDefinition, forFieldList = false): Uint8Array {
  const w = new Writer(96)
  writeColumnDefinition41(w, column, { forFieldList })
  return w.toBytes()
}

/** A row: values back to back as `string<lenenc>`, with `0xFB` for NULL. */
export function textRowPacket(columns: readonly ColumnDefinition[], row: readonly SqlValue[]): Uint8Array {
  const w = new Writer(64)
  for (let i = 0; i < columns.length; i++) {
    w.lenEncBytes(renderTextValue(row[i] ?? null, columns[i] as ColumnDefinition))
  }
  return w.toBytes()
}

function statusFor(options: ResultsetOptions): number {
  const base = options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT
  return options.moreResults === true ? base | SERVER_STATUS.MORE_RESULTS_EXISTS : base
}

/** The packets of one text resultset, in order. */
export function textResultsetPackets(
  caps: Capabilities,
  result: ResultSet,
  options: ResultsetOptions = {},
): Uint8Array[] {
  const packets: Uint8Array[] = [columnCountPacket(caps, result.columns.length)]
  for (const c of result.columns) packets.push(columnDefinitionPacket(c))
  if (!hasCap(caps, CLIENT.DEPRECATE_EOF)) {
    const w = new Writer(8)
    writeTerminator(w, caps, { statusFlags: options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT })
    packets.push(w.toBytes())
  }
  for (const row of result.rows) packets.push(textRowPacket(result.columns, row))
  const w = new Writer(16)
  writeTerminator(w, caps, { statusFlags: statusFor(options), warnings: options.warnings ?? 0 })
  packets.push(w.toBytes())
  return packets
}

/** An OK response for a statement that produced no resultset. */
export function okResultPackets(
  caps: Capabilities,
  result: OkResult,
  options: ResultsetOptions = {},
): Uint8Array[] {
  const w = new Writer(32)
  // Deliberately a plain OK (header 0x00): CLIENT_DEPRECATE_EOF replaces EOF
  // packets, not OK packets.
  writeOk(w, caps, {
    affectedRows: result.affectedRows ?? 0,
    lastInsertId: result.insertId ?? 0,
    statusFlags: statusFor(options),
    warnings: result.warnings ?? options.warnings ?? 0,
    ...(result.info === undefined ? {} : { info: result.info }),
  })
  return [w.toBytes()]
}

export function statementResultPackets(
  caps: Capabilities,
  result: StatementResult,
  options: ResultsetOptions = {},
): Uint8Array[] {
  return isResultSet(result)
    ? textResultsetPackets(caps, result, options)
    : okResultPackets(caps, result, options)
}

/**
 * A whole response, which may be several resultsets.
 *
 * M1.20's acceptance assertion: `SERVER_MORE_RESULTS_EXISTS` is set on **every
 * terminator but the last**, so the client keeps reading while the flag is
 * set. Doing this per-resultset rather than centrally is how it gets missed.
 */
export function responsePackets(
  caps: Capabilities,
  results: readonly StatementResult[],
  options: ResultsetOptions = {},
): Uint8Array[] {
  const packets: Uint8Array[] = []
  for (const [i, result] of results.entries()) {
    packets.push(
      ...statementResultPackets(caps, result, { ...options, moreResults: i < results.length - 1 }),
    )
  }
  return packets
}

/**
 * Abandon a resultset already in progress.
 *
 * Doc 14: "Our executor must be able to abandon a resultset in progress and
 * emit an ERR packet in the terminator position." The column definitions have
 * already gone out, so the ERR replaces the terminator rather than the
 * response.
 */
export function abandonResultset(
  caps: Capabilities,
  error: { errno: number; sqlState?: string; message: string },
): Uint8Array {
  const w = new Writer(64)
  writeErr(w, caps, error)
  return w.toBytes()
}

/**
 * `COM_FIELD_LIST`: column definitions terminated by EOF, with **no column
 * count prefix** — the one resultset-shaped response that does not follow the
 * usual framing (doc 14).
 */
export function fieldListPackets(
  caps: Capabilities,
  columns: readonly ColumnDefinition[],
  options: ResultsetOptions = {},
): Uint8Array[] {
  const packets = columns.map((c) => columnDefinitionPacket(c, true))
  const w = new Writer(16)
  writeTerminator(w, caps, { statusFlags: statusFor(options), warnings: options.warnings ?? 0 })
  packets.push(w.toBytes())
  return packets
}

// --- binary protocol (M1.21) ---------------------------------------------

/**
 * A binary resultset row: `0x00`, then a NULL bitmap at **offset 2** — the low
 * two bits of the first byte are reserved — then the non-NULL values.
 */
export function binaryRowPacket(
  columns: readonly ColumnDefinition[],
  row: readonly SqlValue[],
): Uint8Array {
  const w = new Writer(64)
  w.u8(0x00)
  w.bytes(
    bitmapFrom(columns.length, RESULTSET_ROW_OFFSET, (i) => (row[i] ?? null) === null),
  )
  for (let i = 0; i < columns.length; i++) {
    const value = row[i] ?? null
    if (value === null) continue
    const col = columns[i] as ColumnDefinition
    writeBinaryValue(w, value, { type: col.type, unsigned: (col.flags & COLUMN_FLAG.UNSIGNED) !== 0 })
  }
  return w.toBytes()
}

/** The packets of one binary resultset, in order. */
export function binaryResultsetPackets(
  caps: Capabilities,
  result: ResultSet,
  options: ResultsetOptions = {},
): Uint8Array[] {
  const packets: Uint8Array[] = [columnCountPacket(caps, result.columns.length)]
  for (const c of result.columns) packets.push(columnDefinitionPacket(c))
  if (!hasCap(caps, CLIENT.DEPRECATE_EOF)) {
    const w = new Writer(8)
    writeTerminator(w, caps, { statusFlags: options.statusFlags ?? SERVER_STATUS.AUTOCOMMIT })
    packets.push(w.toBytes())
  }
  for (const row of result.rows) packets.push(binaryRowPacket(result.columns, row))
  const w = new Writer(16)
  writeTerminator(w, caps, { statusFlags: statusFor(options), warnings: options.warnings ?? 0 })
  packets.push(w.toBytes())
  return packets
}

/**
 * A cursor was opened: definitions, then a terminator carrying
 * `SERVER_STATUS_CURSOR_EXISTS` and **no rows**. The rows arrive from
 * `COM_STMT_FETCH` (doc 16).
 */
export function cursorOpenedPackets(
  caps: Capabilities,
  columns: readonly ColumnDefinition[],
  options: ResultsetOptions = {},
): Uint8Array[] {
  const packets: Uint8Array[] = [columnCountPacket(caps, columns.length)]
  for (const c of columns) packets.push(columnDefinitionPacket(c))
  const w = new Writer(16)
  writeTerminator(w, caps, {
    statusFlags: statusFor(options) | SERVER_STATUS.CURSOR_EXISTS,
    warnings: options.warnings ?? 0,
  })
  packets.push(w.toBytes())
  return packets
}

/** `COM_STMT_FETCH`: rows, then a terminator that says whether more remain. */
export function fetchPackets(
  caps: Capabilities,
  columns: readonly ColumnDefinition[],
  rows: readonly (readonly SqlValue[])[],
  exhausted: boolean,
  options: ResultsetOptions = {},
): Uint8Array[] {
  const packets = rows.map((row) => binaryRowPacket(columns, row))
  const w = new Writer(16)
  const status =
    statusFor(options) | (exhausted ? SERVER_STATUS.LAST_ROW_SENT : SERVER_STATUS.CURSOR_EXISTS)
  writeTerminator(w, caps, { statusFlags: status, warnings: options.warnings ?? 0 })
  packets.push(w.toBytes())
  return packets
}

/** `COM_STMT_PREPARE` response: the OK, then parameter and column definitions. */
export function preparePackets(
  caps: Capabilities,
  statementId: number,
  paramCount: number,
  columns: readonly ColumnDefinition[],
  warnings = 0,
): Uint8Array[] {
  const head = new Writer(16)
  head.u8(0x00)
  head.u32(statementId)
  head.u16(columns.length)
  head.u16(paramCount)
  head.u8(0x00) // reserved
  head.u16(warnings)
  if (hasCap(caps, CLIENT.OPTIONAL_RESULTSET_METADATA)) head.u8(RESULTSET_METADATA.FULL)
  const packets: Uint8Array[] = [head.toBytes()]

  // Parameter definitions are placeholders: MySQL reports every `?` as
  // VAR_STRING with charset 63, and clients do not expect inferred types.
  for (let i = 0; i < paramCount; i++) packets.push(columnDefinitionPacket(placeholderParameter()))
  if (paramCount > 0 && !hasCap(caps, CLIENT.DEPRECATE_EOF)) {
    const w = new Writer(8)
    writeTerminator(w, caps)
    packets.push(w.toBytes())
  }
  for (const c of columns) packets.push(columnDefinitionPacket(c))
  if (columns.length > 0 && !hasCap(caps, CLIENT.DEPRECATE_EOF)) {
    const w = new Writer(8)
    writeTerminator(w, caps)
    packets.push(w.toBytes())
  }
  return packets
}

function placeholderParameter(): ColumnDefinition {
  return {
    name: '?',
    orgName: '',
    type: FIELD_TYPE.VAR_STRING,
    characterSet: CHARSET_BINARY,
    columnLength: 0,
    flags: 0,
    decimals: 0,
  }
}
