// M1.18, M1.22 — parsing the client's `COM_*` payloads.
//
// The dispatcher (M1.16) decides what to *do*; this file only decodes. Doc 14
// and doc 16 give the layouts.

import { Reader, bitmapGet, bitmapByteLength, PARAMETER_OFFSET } from '@myjs/bytes'
import { CLIENT, hasCap, type Capabilities } from './constants/capabilities.ts'
import { COM } from './constants/commands.ts'
import { paramIsUnsigned, paramType } from './constants/types.ts'
import { protocolError } from './errors/index.ts'
import { readBinaryValue, type BinaryValue } from './binary-values.ts'
import { fromUtf8 } from './text.ts'

export interface Parameter {
  /** Empty for a positional parameter; a name makes it a query attribute. */
  readonly name: string
  readonly type: number
  readonly unsigned: boolean
  readonly value: BinaryValue
}

export interface ParameterBinding {
  readonly types: ReadonlyArray<{ type: number; unsigned: boolean; name: string }>
  readonly parameters: readonly Parameter[]
}

export interface ReadParametersOptions {
  readonly count: number
  /** With `CLIENT_QUERY_ATTRIBUTES`, each parameter carries a name. */
  readonly named: boolean
  /**
   * Types from the previous execution of this statement.
   *
   * Doc 16's first pitfall: "`new_params_bind_flag` is stateful. When 0, the
   * types from the *previous* execution of this statement are reused and only
   * values are sent." `mysql2` always sends 1; the C client — and so the
   * `mysql` CLI — does not.
   */
  readonly previousTypes?: ReadonlyArray<{ type: number; unsigned: boolean; name: string }>
  /**
   * Parameter indexes already filled by `COM_STMT_SEND_LONG_DATA`.
   *
   * Doc 16's third pitfall: they are still present in the bitmap and are *not*
   * repeated in the values, so the reader must skip them and the caller must
   * merge the accumulated buffer.
   */
  readonly longData?: ReadonlySet<number>
}

/**
 * The parameter block shared by `COM_STMT_EXECUTE` and `COM_QUERY`'s query
 * attributes. The NULL bitmap here is at **offset 0**, unlike a binary
 * resultset row's offset 2.
 */
export function readParameters(r: Reader, options: ReadParametersOptions): ParameterBinding {
  const { count, named } = options
  if (count === 0) return { types: [], parameters: [] }

  const nullBitmap = r.bytes(bitmapByteLength(count, PARAMETER_OFFSET))
  const newParamsBindFlag = r.u8()

  let types: Array<{ type: number; unsigned: boolean; name: string }>
  if (newParamsBindFlag !== 0) {
    types = []
    for (let i = 0; i < count; i++) {
      const typeWord = r.u16()
      const name = named ? fromUtf8(r.lenEncBytes() ?? new Uint8Array(0)) : ''
      types.push({ type: paramType(typeWord), unsigned: paramIsUnsigned(typeWord), name })
    }
  } else {
    const previous = options.previousTypes
    if (previous === undefined || previous.length < count) {
      throw protocolError(
        'ER_MALFORMED_PACKET',
        'new_params_bind_flag is 0 but this statement has no previously bound types',
      )
    }
    types = previous.slice(0, count).map((t) => ({ ...t }))
  }

  const longData = options.longData ?? new Set<number>()
  const parameters: Parameter[] = []
  for (let i = 0; i < count; i++) {
    const spec = types[i] as { type: number; unsigned: boolean; name: string }
    if (bitmapGet(nullBitmap, i, PARAMETER_OFFSET)) {
      parameters.push({ name: spec.name, type: spec.type, unsigned: spec.unsigned, value: null })
      continue
    }
    if (longData.has(i)) {
      // Sent separately; the value is not in this packet at all.
      parameters.push({ name: spec.name, type: spec.type, unsigned: spec.unsigned, value: null })
      continue
    }
    parameters.push({
      name: spec.name,
      type: spec.type,
      unsigned: spec.unsigned,
      value: readBinaryValue(r, { type: spec.type, unsigned: spec.unsigned }),
    })
  }
  return { types, parameters }
}

export interface ComQuery {
  readonly sql: string
  /** Named attributes, when `CLIENT_QUERY_ATTRIBUTES` is negotiated. */
  readonly attributes: readonly Parameter[]
}

export function parseComQuery(payload: Uint8Array, caps: Capabilities): ComQuery {
  const r = new Reader(payload)
  const command = r.u8()
  if (command !== COM.QUERY) {
    throw protocolError('ER_MALFORMED_PACKET', `expected COM_QUERY, got 0x${command.toString(16)}`)
  }
  let attributes: readonly Parameter[] = []
  if (hasCap(caps, CLIENT.QUERY_ATTRIBUTES)) {
    const count = Number(r.lenEncInt() ?? 0n)
    const setCount = Number(r.lenEncInt() ?? 0n)
    if (setCount !== 1) {
      // The protocol reserves this for a future batch form; nothing sends
      // anything else today, and guessing would misalign every later field.
      throw protocolError('ER_MALFORMED_PACKET', `COM_QUERY parameter_set_count must be 1, got ${setCount}`)
    }
    if (count > 0) {
      attributes = readParameters(r, { count, named: true }).parameters
    }
  }
  return { sql: fromUtf8(r.restBytes()), attributes }
}

export function parseComInitDb(payload: Uint8Array): string {
  const r = new Reader(payload)
  r.u8()
  return fromUtf8(r.restBytes())
}

export interface ComFieldList {
  readonly table: string
  readonly wildcard: string
}

export function parseComFieldList(payload: Uint8Array): ComFieldList {
  const r = new Reader(payload)
  r.u8()
  return { table: fromUtf8(r.nulString()), wildcard: fromUtf8(r.restBytes()) }
}

/** `0` *enables* `CLIENT_MULTI_STATEMENTS`, `1` disables it. */
export function parseComSetOption(payload: Uint8Array): number {
  const r = new Reader(payload)
  r.u8()
  return r.u16()
}

export interface ComStmtExecute {
  readonly statementId: number
  readonly flags: number
  readonly iterationCount: number
  /** Null when the packet carried no parameter block at all. */
  readonly binding: ParameterBinding | null
}

export interface ParseComStmtExecuteOptions {
  readonly paramCount: number
  readonly previousTypes?: ReadonlyArray<{ type: number; unsigned: boolean; name: string }>
  readonly longData?: ReadonlySet<number>
}

export function parseComStmtExecute(
  payload: Uint8Array,
  caps: Capabilities,
  options: ParseComStmtExecuteOptions,
): ComStmtExecute {
  const r = new Reader(payload)
  const command = r.u8()
  if (command !== COM.STMT_EXECUTE) {
    throw protocolError('ER_MALFORMED_PACKET', `expected COM_STMT_EXECUTE, got 0x${command.toString(16)}`)
  }
  const statementId = r.u32()
  const flags = r.u8()
  const iterationCount = r.u32()

  const queryAttrs = hasCap(caps, CLIENT.QUERY_ATTRIBUTES)
  // Doc 16's fourth pitfall: with query attributes, `parameter_count` may
  // exceed the statement's own `num_params`. The first `num_params` satisfy
  // the `?` placeholders positionally; the rest are named session attributes.
  let count = options.paramCount
  if (queryAttrs && r.remaining > 0) {
    count = Number(r.lenEncInt() ?? 0n)
  }
  if (count === 0 || r.remaining === 0) {
    return { statementId, flags, iterationCount, binding: null }
  }
  const binding = readParameters(r, {
    count,
    named: queryAttrs,
    ...(options.previousTypes === undefined ? {} : { previousTypes: options.previousTypes }),
    ...(options.longData === undefined ? {} : { longData: options.longData }),
  })
  return { statementId, flags, iterationCount, binding }
}

export interface ComStmtSendLongData {
  readonly statementId: number
  readonly parameterId: number
  readonly data: Uint8Array
}

export function parseComStmtSendLongData(payload: Uint8Array): ComStmtSendLongData {
  const r = new Reader(payload)
  r.u8()
  return { statementId: r.u32(), parameterId: r.u16(), data: r.restBytes() }
}

export interface ComStmtFetch {
  readonly statementId: number
  readonly numRows: number
}

export function parseComStmtFetch(payload: Uint8Array): ComStmtFetch {
  const r = new Reader(payload)
  r.u8()
  return { statementId: r.u32(), numRows: r.u32() }
}

/** `COM_STMT_CLOSE`, `COM_STMT_RESET` — a command byte and a statement id. */
export function parseStatementId(payload: Uint8Array): number {
  const r = new Reader(payload)
  r.u8()
  return r.u32()
}

export function parseComStmtPrepare(payload: Uint8Array): string {
  const r = new Reader(payload)
  r.u8()
  return fromUtf8(r.restBytes())
}

export interface ComChangeUser {
  readonly username: string
  readonly authResponse: Uint8Array
  readonly database: string | null
  readonly characterSet: number
  readonly clientPluginName: string
  readonly connectAttrs: ReadonlyMap<string, string>
}

/**
 * `COM_CHANGE_USER` — full re-authentication on an existing connection.
 *
 * It is shaped like the tail of `HandshakeResponse41`, and it re-enters the
 * connection phase: the auth exchange that follows continues from *this*
 * command's sequence 0 rather than resetting again (doc 12).
 */
export function parseComChangeUser(payload: Uint8Array, caps: Capabilities): ComChangeUser {
  const r = new Reader(payload)
  const command = r.u8()
  if (command !== COM.CHANGE_USER) {
    throw protocolError('ER_MALFORMED_PACKET', `expected COM_CHANGE_USER, got 0x${command.toString(16)}`)
  }
  const username = fromUtf8(r.nulString())
  const authResponse = hasCap(caps, CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA)
    ? (r.lenEncBytes() ?? new Uint8Array(0))
    : r.bytes(r.u8())
  const database = fromUtf8(r.nulString())
  const characterSet = r.remaining >= 2 ? r.u16() : 0
  const clientPluginName = hasCap(caps, CLIENT.PLUGIN_AUTH) && r.remaining > 0 ? fromUtf8(r.nulString()) : ''
  const connectAttrs = new Map<string, string>()
  if (hasCap(caps, CLIENT.CONNECT_ATTRS) && r.remaining > 0) {
    const total = Number(r.lenEncInt() ?? 0n)
    if (total > r.remaining) {
      throw protocolError('ER_MALFORMED_PACKET', 'connection attributes overrun the packet')
    }
    const end = r.position + total
    while (r.position < end) {
      const key = fromUtf8(r.lenEncBytes() ?? new Uint8Array(0))
      connectAttrs.set(key, fromUtf8(r.lenEncBytes() ?? new Uint8Array(0)))
    }
  }
  return {
    username,
    authResponse,
    database: database === '' ? null : database,
    characterSet,
    clientPluginName,
    connectAttrs,
  }
}
