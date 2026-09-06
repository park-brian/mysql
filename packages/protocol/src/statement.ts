// M1.23 — prepared-statement state.
//
// Doc 16 gives the field list as a class sketch; the behaviour is in its four
// pitfalls, each of which is a piece of state that has to live *somewhere*
// across packets:
//
//   1. `new_params_bind_flag === 0` reuses the previous execution's types, so
//      the statement remembers `lastBoundTypes`.
//   2. The NULL bitmap is at offset 0 here, not 2 (that is the parser's job).
//   3. `COM_STMT_SEND_LONG_DATA` parameters are in the bitmap but absent from
//      the values, so the accumulated buffers have to be merged in.
//   4. `parameter_count` may exceed `num_params` under query attributes.

import { concat } from './crypto.ts'
import { MAX_PREPARED_STMT_COUNT } from './constants/commands.ts'
import { messages } from './errors/messages.ts'
import { sqlError } from './errors/index.ts'
import type { ColumnDefinition } from './packets/column.ts'
import type { SqlValue } from './values.ts'

export interface BoundType {
  readonly type: number
  readonly unsigned: boolean
  readonly name: string
}

/** An open read-only cursor: rows still to send, and when it was last touched. */
export interface Cursor {
  readonly rows: readonly (readonly SqlValue[])[]
  position: number
  lastUsedAt: number
}

export class PreparedStatement {
  readonly id: number
  readonly sql: string
  readonly paramCount: number
  readonly columns: readonly ColumnDefinition[]

  /** Types from the last execution, for `new_params_bind_flag === 0`. */
  lastBoundTypes: readonly BoundType[] | null = null
  /** Accumulated `COM_STMT_SEND_LONG_DATA`, by parameter index. */
  readonly longData = new Map<number, Uint8Array[]>()
  cursor: Cursor | null = null

  constructor(id: number, sql: string, paramCount: number, columns: readonly ColumnDefinition[]) {
    this.id = id
    this.sql = sql
    this.paramCount = paramCount
    this.columns = columns
  }

  appendLongData(parameterId: number, data: Uint8Array, limit: number): void {
    const chunks = this.longData.get(parameterId) ?? []
    const size = chunks.reduce((n, c) => n + c.length, 0) + data.length
    // D-31: unbounded server-side allocation driven by a client that never has
    // to execute the statement. Cap it, and report at execute time — the
    // command itself must never produce a response (M1.17).
    if (size > limit) {
      chunks.length = 0
      this.longData.set(parameterId, chunks)
      this.longDataOverflow = true
      return
    }
    chunks.push(data)
    this.longData.set(parameterId, chunks)
  }

  /** Set when a long-data append exceeded the cap; surfaces at execute time. */
  longDataOverflow = false

  longDataIndexes(): ReadonlySet<number> {
    return new Set(this.longData.keys())
  }

  takeLongData(parameterId: number): Uint8Array | undefined {
    const chunks = this.longData.get(parameterId)
    return chunks === undefined ? undefined : concat(chunks)
  }

  /** `COM_STMT_RESET`: drop long data, close the cursor, keep the statement. */
  reset(): void {
    this.longData.clear()
    this.longDataOverflow = false
    this.cursor = null
  }
}

/**
 * The per-connection statement table.
 *
 * Statements belong to a *connection*, not the database, so
 * `COM_CHANGE_USER` and `COM_RESET_CONNECTION` destroy them all.
 */
export class StatementTable {
  readonly #statements = new Map<number, PreparedStatement>()
  readonly maxStatements: number
  #nextId = 1

  constructor(maxStatements = MAX_PREPARED_STMT_COUNT) {
    this.maxStatements = maxStatements
  }

  get size(): number {
    return this.#statements.size
  }

  create(sql: string, paramCount: number, columns: readonly ColumnDefinition[]): PreparedStatement {
    if (this.#statements.size >= this.maxStatements) {
      throw sqlError('ER_MAX_PREPARED_STMT_COUNT_REACHED', messages.maxPreparedStmtCount(this.maxStatements))
    }
    // A monotonically increasing 32-bit counter (doc 16).
    const id = this.#nextId
    this.#nextId = (this.#nextId + 1) >>> 0 || 1
    const stmt = new PreparedStatement(id, sql, paramCount, columns)
    this.#statements.set(id, stmt)
    return stmt
  }

  get(id: number): PreparedStatement | undefined {
    return this.#statements.get(id)
  }

  close(id: number): boolean {
    return this.#statements.delete(id)
  }

  clear(): void {
    this.#statements.clear()
  }

  /**
   * Reclaim cursors nobody has fetched from.
   *
   * An open cursor is an iterator plus a pinned read view, so an abandoned one
   * pins undo records once M4 exists. Timing them out is cheap now and load-
   * bearing later.
   */
  reclaimIdleCursors(now: number, timeoutMs: number): number {
    let reclaimed = 0
    for (const stmt of this.#statements.values()) {
      if (stmt.cursor !== null && now - stmt.cursor.lastUsedAt > timeoutMs) {
        stmt.cursor = null
        reclaimed++
      }
    }
    return reclaimed
  }

  [Symbol.iterator](): IterableIterator<PreparedStatement> {
    return this.#statements.values()
  }
}
