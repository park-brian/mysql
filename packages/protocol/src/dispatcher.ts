// M1.16, M1.17, M1.18 — the `COM_*` dispatcher.
//
// Follows doc 14's skeleton. Two things are centralised here rather than left
// to each handler, because that is how they get forgotten:
//
//   The no-response set. `COM_STMT_SEND_LONG_DATA`, `COM_STMT_CLOSE` and
//   `COM_QUIT` write nothing at all — not even on error. A helpful OK
//   desynchronises every client.
//
//   Error conversion. Any `SqlError` a handler throws becomes an ERR packet
//   with its errno and SQLSTATE, so handlers throw and never format.

import { MyjsError, ProtocolError, Writer } from '@myjs/bytes'
import { CLIENT, SERVER_STATUS, hasCap, type Capabilities } from './constants/capabilities.ts'
import { COM, CURSOR_TYPE, NO_RESPONSE_COMMANDS, SET_OPTION, commandName } from './constants/commands.ts'
import { errnoOf, sqlError, sqlStateOf, SqlError } from './errors/index.ts'
import { messages } from './errors/messages.ts'
import {
  parseComFieldList,
  parseComInitDb,
  parseComQuery,
  parseComSetOption,
  parseComStmtExecute,
  parseComStmtFetch,
  parseComStmtPrepare,
  parseComStmtSendLongData,
  parseStatementId,
  type Parameter,
} from './commands.ts'
import { writeEof, writeErr, writeOk } from './packets/generic.ts'
import {
  binaryResultsetPackets,
  cursorOpenedPackets,
  fetchPackets,
  fieldListPackets,
  isResultSet,
  okResultPackets,
  preparePackets,
  responsePackets,
  statementResultPackets,
  type StatementResult,
} from './packets/resultset.ts'
import { utf8 } from './text.ts'
import type { Executor, Session } from './session.ts'
import type { SqlValue } from './values.ts'

export interface DispatchContext {
  readonly session: Session
  readonly executor: Executor
  readonly capabilities: Capabilities
  /** Abandoned cursors pin resources; time them out (doc 16). */
  readonly cursorTimeoutMs?: number
  readonly now?: () => number
}

export interface DispatchResult {
  readonly packets: readonly Uint8Array[]
  /** `COM_QUIT`: stop reading and close the socket. */
  readonly close?: boolean
  /** `COM_CHANGE_USER`: the connection re-enters the connection phase. */
  readonly changeUser?: Uint8Array
}

const NOTHING: DispatchResult = { packets: [] }

/**
 * A statement's bytes as text, in the session's own charset.
 *
 * Every SQL string a client sends arrives in the charset it named — in
 * `HandshakeResponse41`, or in the last `SET NAMES`. Decoding it as UTF-8
 * regardless is right for the default and silently wrong for the rest, which
 * is what this package used to do: `parseComQuery` called `fromUtf8` on the
 * body and the session's `Transcoder` was never consulted. A `latin1` client
 * sending `WHERE name = '<0x80>'` got U+FFFD, and the query ran against the
 * wrong value rather than failing.
 *
 * The default `utf8Transcoder` still refuses anything it cannot serve, so a
 * caller that has not injected a real one gets a typed error instead of the
 * mojibake it used to get (M2.18's posture, one layer up).
 */
function sqlText(session: Session, bytes: Uint8Array): string {
  return session.transcoder.decode(bytes, session.characterSet)
}

export async function dispatch(payload: Uint8Array, ctx: DispatchContext): Promise<DispatchResult> {
  if (payload.length === 0) {
    return errPackets(ctx, 'ER_MALFORMED_PACKET', messages.malformedPacket('empty command packet'))
  }
  const command = payload[0] as number
  try {
    return await handle(command, payload, ctx)
  } catch (err) {
    // A no-response command stays silent even when it fails. The error
    // surfaces on the next command that does answer.
    if (NO_RESPONSE_COMMANDS.has(command)) return NOTHING
    if (err instanceof SqlError) {
      return errPackets(ctx, err.code, err.sqlMessage)
    }
    if (err instanceof ProtocolError || err instanceof MyjsError) {
      const symbol = err.errno === undefined ? 'ER_MALFORMED_PACKET' : err.code
      return errPackets(ctx, symbol, err.message)
    }
    throw err
  }
}

function errPackets(ctx: DispatchContext, symbol: string, message: string): DispatchResult {
  const w = new Writer(64)
  writeErr(w, ctx.capabilities, {
    errno: errnoOf(symbol),
    sqlState: sqlStateOf(symbol),
    message,
  })
  return { packets: [w.toBytes()] }
}

function okPacket(ctx: DispatchContext, info?: string): Uint8Array {
  const w = new Writer(32)
  writeOk(w, ctx.capabilities, {
    statusFlags: ctx.session.statusFlags,
    ...(info === undefined ? {} : { info }),
  })
  return w.toBytes()
}

async function handle(command: number, payload: Uint8Array, ctx: DispatchContext): Promise<DispatchResult> {
  const { session, executor, capabilities: caps } = ctx

  switch (command) {
    // --- no response, ever (M1.17) ---------------------------------------
    case COM.QUIT:
      return { packets: [], close: true }

    case COM.STMT_CLOSE: {
      session.statements.close(parseStatementId(payload))
      return NOTHING
    }

    case COM.STMT_SEND_LONG_DATA: {
      const { statementId, parameterId, data } = parseComStmtSendLongData(payload)
      const stmt = session.statements.get(statementId)
      // An unknown statement here is silently ignored: there is no packet in
      // which to report it, and the next COM_STMT_EXECUTE will fail anyway.
      stmt?.appendLongData(parameterId, data, session.maxAllowedPacket)
      return NOTHING
    }

    // --- trivial -----------------------------------------------------------
    case COM.PING:
    case COM.DEBUG:
      return { packets: [okPacket(ctx)] }

    case COM.RESET_CONNECTION:
      session.reset()
      return { packets: [okPacket(ctx)] }

    case COM.CHANGE_USER:
      // Full re-authentication on an existing connection. The connection owns
      // that exchange, because it owns the authenticator.
      return { packets: [], changeUser: payload }

    // --- the three quirks (M1.18) -----------------------------------------
    case COM.STATISTICS: {
      // A bare string<EOF>, *not* an OK packet.
      const line = executor.statistics?.(session) ?? defaultStatistics(session)
      return { packets: [utf8(line)] }
    }

    case COM.SET_OPTION: {
      const option = parseComSetOption(payload)
      if (option === SET_OPTION.MULTI_STATEMENTS_ON) {
        // D-13: honour the request only if the engine switch allows it.
        session.multipleStatementsEnabled = hasCap(caps, CLIENT.MULTI_STATEMENTS)
          ? session.multipleStatementsEnabled
          : false
      } else if (option === SET_OPTION.MULTI_STATEMENTS_OFF) {
        session.multipleStatementsEnabled = false
      } else {
        return errPackets(ctx, 'ER_UNKNOWN_COM_ERROR', messages.unknownCommand())
      }
      // It answers with an EOF-shaped packet, not an OK — a quirk that has
      // broken more than one client.
      const w = new Writer(16)
      if (hasCap(caps, CLIENT.DEPRECATE_EOF)) {
        writeOk(w, caps, { asEof: true, statusFlags: session.statusFlags })
      } else {
        writeEof(w, caps, { statusFlags: session.statusFlags })
      }
      return { packets: [w.toBytes()] }
    }

    case COM.FIELD_LIST: {
      const { table, wildcard } = parseComFieldList(payload)
      const columns = (await executor.fieldList?.(session, table, wildcard)) ?? []
      // No column-count prefix: the one resultset-shaped response that does
      // not follow the usual framing.
      return { packets: fieldListPackets(caps, columns, { statusFlags: session.statusFlags }) }
    }

    // --- schema ------------------------------------------------------------
    case COM.INIT_DB: {
      const database = parseComInitDb(payload)
      if (executor.initDb === undefined) {
        session.database = database
      } else {
        await executor.initDb(session, database)
      }
      return { packets: [okPacket(ctx)] }
    }

    // --- text protocol -----------------------------------------------------
    case COM.QUERY: {
      const { sqlBytes, attributes } = parseComQuery(payload, caps)
      // The session decides the charset, not this package (D-33). `Session`
      // carries the `Transcoder` precisely so the decode can happen here,
      // where the session is in scope, rather than being guessed as UTF-8 in
      // the packet parser.
      const results = await executor.query(session, sqlText(session, sqlBytes), attributes)
      return { packets: responseFor(ctx, results, false) }
    }

    // --- prepared statements ----------------------------------------------
    case COM.STMT_PREPARE: {
      const sql = sqlText(session, parseComStmtPrepare(payload))
      const info = await executor.prepare(session, sql)
      const stmt = session.statements.create(sql, info.paramCount, info.columns)
      return { packets: preparePackets(caps, stmt.id, info.paramCount, info.columns) }
    }

    case COM.STMT_EXECUTE: {
      reclaimCursors(ctx)
      const head = parseStatementIdOfExecute(payload)
      const stmt = session.statements.get(head)
      if (stmt === undefined) {
        throw sqlError('ER_UNKNOWN_STMT_HANDLER', messages.unknownStatementHandler(String(head)))
      }
      if (stmt.longDataOverflow) {
        stmt.reset()
        throw sqlError('ER_NET_PACKET_TOO_LARGE', messages.packetTooLarge(session.maxAllowedPacket))
      }
      const parsed = parseComStmtExecute(payload, caps, {
        paramCount: stmt.paramCount,
        ...(stmt.lastBoundTypes === null ? {} : { previousTypes: stmt.lastBoundTypes }),
        longData: stmt.longDataIndexes(),
      })
      if (parsed.binding !== null) stmt.lastBoundTypes = parsed.binding.types

      // Merge the long-data buffers back in by index (doc 16's third pitfall).
      const parameters: Parameter[] = (parsed.binding?.parameters ?? []).map((p, i) => {
        const long = stmt.takeLongData(i)
        return long === undefined ? p : { ...p, value: long }
      })

      const results = await executor.execute(session, stmt.sql, parameters)
      const wantsCursor = (parsed.flags & CURSOR_TYPE.READ_ONLY) !== 0
      const single = Array.isArray(results) ? results[0] : results

      if (wantsCursor && single !== undefined && isResultSet(single)) {
        stmt.cursor = { rows: single.rows, position: 0, lastUsedAt: nowOf(ctx) }
        return {
          packets: cursorOpenedPackets(caps, single.columns, { statusFlags: session.statusFlags }),
        }
      }
      return { packets: responseFor(ctx, results, true) }
    }

    case COM.STMT_FETCH: {
      reclaimCursors(ctx)
      const { statementId, numRows } = parseComStmtFetch(payload)
      const stmt = session.statements.get(statementId)
      if (stmt === undefined || stmt.cursor === null) {
        throw sqlError('ER_UNKNOWN_STMT_HANDLER', messages.unknownStatementHandler(String(statementId)))
      }
      const cursor = stmt.cursor
      const slice: readonly (readonly SqlValue[])[] = cursor.rows.slice(
        cursor.position,
        cursor.position + numRows,
      )
      cursor.position += slice.length
      cursor.lastUsedAt = nowOf(ctx)
      const exhausted = cursor.position >= cursor.rows.length
      if (exhausted) stmt.cursor = null
      return {
        packets: fetchPackets(caps, stmt.columns, slice, exhausted, {
          statusFlags: session.statusFlags,
        }),
      }
    }

    case COM.STMT_RESET: {
      const stmt = session.statements.get(parseStatementId(payload))
      if (stmt === undefined) {
        throw sqlError('ER_UNKNOWN_STMT_HANDLER', messages.unknownStatementHandler('reset'))
      }
      stmt.reset()
      return { packets: [okPacket(ctx)] }
    }

    // --- commands a real MySQL refuses -------------------------------------
    case COM.CREATE_DB:
    case COM.DROP_DB:
    case COM.TIME:
      return errPackets(ctx, 'ER_UNKNOWN_COM_ERROR', messages.unknownCommand())

    default:
      return errPackets(
        ctx,
        'ER_UNKNOWN_COM_ERROR',
        `${messages.unknownCommand()} (${commandName(command)})`,
      )
  }
}

function parseStatementIdOfExecute(payload: Uint8Array): number {
  return parseStatementId(payload)
}

function nowOf(ctx: DispatchContext): number {
  return (ctx.now ?? Date.now)()
}

function reclaimCursors(ctx: DispatchContext): void {
  const timeout = ctx.cursorTimeoutMs
  if (timeout === undefined) return
  ctx.session.statements.reclaimIdleCursors(nowOf(ctx), timeout)
}

function responseFor(
  ctx: DispatchContext,
  results: StatementResult | StatementResult[],
  binary: boolean,
): Uint8Array[] {
  const { session, capabilities: caps } = ctx
  const list = Array.isArray(results) ? results : [results]
  if (list.length > 1 && !session.multipleStatementsEnabled) {
    // D-13's engine-level switch, enforced at the protocol boundary too: a
    // client that negotiated the capability still cannot get more than one
    // resultset out of us while the switch is off.
    const w = new Writer(64)
    writeErr(w, caps, {
      errno: errnoOf('ER_UNKNOWN_COM_ERROR'),
      sqlState: sqlStateOf('ER_UNKNOWN_COM_ERROR'),
      message: messages.multiStatementsDisabled(),
    })
    return [w.toBytes()]
  }
  if (!binary) {
    return responsePackets(caps, list, { statusFlags: session.statusFlags })
  }
  const packets: Uint8Array[] = []
  for (const [i, result] of list.entries()) {
    const options = {
      statusFlags: session.statusFlags,
      moreResults: i < list.length - 1,
    }
    packets.push(
      ...(isResultSet(result)
        ? binaryResultsetPackets(caps, result, options)
        : okResultPackets(caps, result, options)),
    )
  }
  return packets
}

function defaultStatistics(session: Session): string {
  return (
    `Uptime: 0  Threads: 1  Questions: 0  Slow queries: 0  Opens: 0  ` +
    `Flush tables: 1  Open tables: 0  Queries per second avg: 0.000  ` +
    `Connection: ${session.connectionId}`
  )
}

export { statementResultPackets, SERVER_STATUS }
