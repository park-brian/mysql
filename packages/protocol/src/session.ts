// Per-connection state, and the seam the executor plugs into.
//
// Doc 03's diagram puts `session/` between `protocol/` and `sql/`, carrying
// "Statement + params ⇄ Resultset". That edge is the only thing the protocol
// layer needs to know about an executor, and it is defined here so that
// `@myjs/protocol` is genuinely usable on its own — a MySQL protocol server
// toolkit, with the engine supplied by the caller.

import { DEFAULT_MAX_ALLOWED_PACKET } from './constants/commands.ts'
import { CHARSET_UTF8MB4_0900_AI_CI } from './constants/types.ts'
import { SERVER_STATUS, type Capabilities } from './constants/capabilities.ts'
import { StatementTable } from './statement.ts'
import type { ColumnDefinition } from './packets/column.ts'
import type { StatementResult } from './packets/resultset.ts'
import type { Parameter } from './commands.ts'

export interface SessionOptions {
  readonly connectionId: number
  readonly capabilities: Capabilities
  readonly user?: string
  readonly database?: string | null
  readonly characterSet?: number
  readonly sqlMode?: string
  /**
   * D-13: `CLIENT_MULTI_STATEMENTS` is honoured when negotiated but gated
   * behind an engine-level switch defaulting **off** — it turns a SQL
   * injection point into arbitrary statement execution.
   */
  readonly multipleStatements?: boolean
  readonly maxAllowedPacket?: number
  readonly maxPreparedStmtCount?: number
}

export class Session {
  readonly connectionId: number
  readonly capabilities: Capabilities
  readonly maxAllowedPacket: number
  readonly statements: StatementTable

  user: string
  database: string | null
  characterSet: number
  sqlMode: string
  autocommit = true
  inTransaction = false
  warnings = 0
  /** The negotiated flag AND the engine switch, per D-13. */
  multipleStatementsEnabled: boolean
  readonly connectAttrs = new Map<string, string>()

  readonly #initial: {
    user: string
    database: string | null
    characterSet: number
    sqlMode: string
    multipleStatements: boolean
  }

  constructor(options: SessionOptions) {
    this.connectionId = options.connectionId
    this.capabilities = options.capabilities
    this.maxAllowedPacket = options.maxAllowedPacket ?? DEFAULT_MAX_ALLOWED_PACKET
    this.statements = new StatementTable(options.maxPreparedStmtCount)
    this.user = options.user ?? ''
    this.database = options.database ?? null
    this.characterSet = options.characterSet ?? CHARSET_UTF8MB4_0900_AI_CI
    this.sqlMode = options.sqlMode ?? 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'
    this.multipleStatementsEnabled = options.multipleStatements ?? false
    this.#initial = {
      user: this.user,
      database: this.database,
      characterSet: this.characterSet,
      sqlMode: this.sqlMode,
      multipleStatements: this.multipleStatementsEnabled,
    }
  }

  get statusFlags(): number {
    let flags = 0
    if (this.autocommit) flags |= SERVER_STATUS.AUTOCOMMIT
    if (this.inTransaction) flags |= SERVER_STATUS.IN_TRANS
    return flags
  }

  /**
   * Restore exactly the post-connect state.
   *
   * `COM_RESET_CONNECTION` and `COM_CHANGE_USER` both land here. Doc 12: "Both
   * must reset our session object to exactly the post-connect state, or pooled
   * connections will leak state between logical users. This is a correctness
   * *and* a security boundary."
   */
  reset(): void {
    this.statements.clear()
    this.user = this.#initial.user
    this.database = this.#initial.database
    this.characterSet = this.#initial.characterSet
    this.sqlMode = this.#initial.sqlMode
    this.multipleStatementsEnabled = this.#initial.multipleStatements
    this.autocommit = true
    this.inTransaction = false
    this.warnings = 0
    this.connectAttrs.clear()
  }
}

export interface PreparedInfo {
  readonly paramCount: number
  readonly columns: readonly ColumnDefinition[]
}

/**
 * What an engine must provide for `@myjs/protocol` to serve it.
 *
 * This is doc 03's `Statement + params ⇄ Resultset` edge, made concrete. M1
 * ships a stub implementation; M5's real executor replaces it without the
 * protocol layer changing.
 */
export interface Executor {
  /** Text protocol. Returning an array produces a multi-resultset response. */
  query(
    session: Session,
    sql: string,
    attributes: readonly Parameter[],
  ): Promise<StatementResult | StatementResult[]>

  /** `COM_STMT_PREPARE`. Parameter definitions are placeholders (doc 16). */
  prepare(session: Session, sql: string): Promise<PreparedInfo>

  /** Binary protocol. */
  execute(
    session: Session,
    sql: string,
    parameters: readonly Parameter[],
  ): Promise<StatementResult | StatementResult[]>

  /** `COM_FIELD_LIST`, deprecated but still used by old tools. */
  fieldList?(session: Session, table: string, wildcard: string): Promise<readonly ColumnDefinition[]>

  /** `COM_INIT_DB` / `USE`. Throw a `SqlError` to refuse. */
  initDb?(session: Session, database: string): Promise<void>

  /** `COM_STATISTICS` — a single human-readable line. */
  statistics?(session: Session): string
}
