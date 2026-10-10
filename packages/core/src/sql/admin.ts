// The statements that drive a session rather than its data: `SET`, system
// variables, and the stored programs M3.8 keeps but does not run.
//
// Moved here from M1's stub executor when M5 replaced it, rather than written
// again: what a driver sends on connect (`SET NAMES`, `SET sql_mode`,
// `SELECT @@version_comment`) worked before the executor existed and must keep
// working exactly as it did.
import { CHARSET_UTF8MB4_0900_AI_CI, messages, sqlError, type Session, type SqlValue } from '@myjs/protocol'
import {
  NODE,
  STATEMENT,
  DEFAULT_SQL_MODE,
  RESERVED_SQL_MODE_BITS,
  SQL_MODE_BITS,
  badMode,
  formatSqlMode,
  parseSqlMode,
  type CallStatementNode,
  type CreateEventNode,
  type CreateRoutineNode,
  type CreateTriggerNode,
  type DropNode,
  type Expression,
  type KeywordNode,
  type SetItem,
  type TableName,
} from '@myjs/parser'
import { COERCIBILITY, doubleValue, intValue, stringValue, toText, type Value } from '@myjs/types'
import type { StoreFigures, TrxStats } from '@myjs/engine'
import { OURS, systemVariableInfo, systemVariableNames, type SystemVariable } from './variables.ts'
import { DEFAULT_SERVER_VERSION } from '../connection.ts'
import { checkConnectionCharset, charsetVariables } from '../transcoder.ts'

export interface ServerOptions {
  readonly serverVersion?: string
  readonly versionComment?: string
  readonly systemVariables?: Readonly<Record<string, SqlValue>>
  /** The connections the embedding database has open, and has made: SHOW STATUS's `Threads_connected` and `Connections`. */
  readonly connections?: { open(): number; made(): number }
  /** The store's figures, for SHOW STATUS's `Innodb_*` and INNODB_METRICS; none without a store. */
  readonly engine?: () => (StoreFigures & TrxStats) | undefined
}

export type ProgramStatement = CreateRoutineNode | CreateTriggerNode | CreateEventNode | CallStatementNode | DropNode
type ProgramObject = 'PROCEDURE' | 'FUNCTION' | 'TRIGGER' | 'EVENT'

const EXISTS = {
  PROCEDURE: 'ER_SP_ALREADY_EXISTS',
  FUNCTION: 'ER_SP_ALREADY_EXISTS',
  TRIGGER: 'ER_TRG_ALREADY_EXISTS',
  EVENT: 'ER_EVENT_ALREADY_EXISTS',
} as const
const MISSING = {
  PROCEDURE: 'ER_SP_DOES_NOT_EXIST',
  FUNCTION: 'ER_SP_DOES_NOT_EXIST',
  TRIGGER: 'ER_TRG_DOES_NOT_EXIST',
  EVENT: 'ER_EVENT_DOES_NOT_EXIST',
} as const

export const PROGRAM_OBJECTS: ReadonlySet<string> = new Set(['PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT'])

/** `db.name`, in the session's database when unqualified. */
const qualified = (name: TableName, session: Session): string => `${name.schema ?? session.database ?? ''}.${name.name}`
/** Stored-program names are case-insensitive, as MySQL's are. */
const programKey = (object: string, name: TableName, session: Session): string => `${object}:${qualified(name, session).toLowerCase()}`

const MAX_SIGNED = (1n << 63n) - 1n

/** A `SqlValue` as an evaluation value, for a system variable: a DOUBLE for one that is, an unsigned integer past BIGINT's range. */
function fromSqlValue(v: SqlValue, info?: SystemVariable): Value {
  if (v === null) return null
  if (info?.kind === 'double' && (typeof v === 'number' || typeof v === 'bigint')) return doubleValue(Number(v))
  if (typeof v === 'number') return Number.isInteger(v) ? intValue(BigInt(v)) : doubleValue(v)
  if (typeof v === 'bigint') return intValue(v, v > MAX_SIGNED)
  if (typeof v === 'boolean') return intValue(v ? 1n : 0n)
  if (typeof v === 'string') return stringValue(v, CHARSET_UTF8MB4_0900_AI_CI, COERCIBILITY.SYSCONST)
  if (v instanceof Uint8Array) return { kind: 'bytes', v }
  return stringValue(String(v), CHARSET_UTF8MB4_0900_AI_CI, COERCIBILITY.SYSCONST)
}

/**
 * A value as a `SET` gives it to a variable of `info`'s kind, as 8.4.11
 * takes it: a boolean is ON, OFF, 1 or 0 (1231 otherwise); an integer is an
 * integer (1232 for text or a fraction), clamped to the variable's range with
 * a 1292; a double is a number. A string variable takes its text; which
 * values an enumerated one allows is not known here, so none is refused.
 */
function assigned(info: SystemVariable, v: Value, warn: (code: number, message: string) => void): Value {
  if (v === null || info.kind === 'string') return v
  const text = toText(v)
  if (info.kind === 'bool') {
    const word = text.toUpperCase()
    if (word === '1' || word === 'ON' || word === 'TRUE') return intValue(1n)
    if (word === '0' || word === 'OFF' || word === 'FALSE') return intValue(0n)
    throw sqlError('ER_WRONG_VALUE_FOR_VAR', `Variable '${info.name}' can't be set to the value of '${text}'`)
  }
  if (v.kind !== 'int' && !(info.kind === 'double' && (v.kind === 'decimal' || v.kind === 'double'))) throw sqlError('ER_WRONG_TYPE_FOR_VAR', `Incorrect argument type to variable '${info.name}'`)
  if (info.kind === 'double') return doubleValue(Number(text))
  const n = (v as { v: bigint }).v
  const min = info.min ?? n
  const max = info.max ?? n
  if (n >= min && n <= max) return intValue(n, n > MAX_SIGNED)
  warn(1292, `Truncated incorrect ${info.name} value: '${text}'`)
  const clamped = n < min ? min : max
  return intValue(clamped, clamped > MAX_SIGNED)
}

/**
 * The server's global state: its system variables and its stored programs.
 * One per executor, shared by every session. A variable's global value is
 * what `SET GLOBAL` gave it, else this server's own (`OURS`, `serverVersion`,
 * the `systemVariables` option), else 8.4.11's default (`variables.ts`).
 */
export class ServerState {
  readonly serverVersion: string
  readonly vars: Map<string, SqlValue>
  readonly #connections: ServerOptions['connections']
  readonly engine: ServerOptions['engine']
  /** When the server started, which INNODB_METRICS dates its metrics from. */
  readonly started = Date.now()
  /** Statements clients have sent, for SHOW STATUS. */
  questions = 0
  /** M3.8: stored programs, accepted and kept, by `kind:schema.name`. Never run. */
  readonly #programs = new Set<string>()

  constructor(options: ServerOptions = {}) {
    this.serverVersion = options.serverVersion ?? DEFAULT_SERVER_VERSION
    this.#connections = options.connections
    this.engine = options.engine
    this.vars = new Map<string, SqlValue>([
      ...Object.entries(OURS),
      ['version', this.serverVersion],
      ['innodb_version', this.serverVersion.replace(/-.*$/, '')],
      ...(options.versionComment === undefined ? [] : [['version_comment', options.versionComment] as const]),
      ...Object.entries(options.systemVariables ?? {}),
    ])
  }

  /**
   * The status variables this server keeps, by name, as SHOW STATUS lists
   * them (M5.13). Only what is counted is listed: of 8.4.11's 252, the
   * rest describe machinery this executor does not have.
   */
  status(scope: 'GLOBAL' | 'SESSION', questions: number): (readonly [string, string])[] {
    const uptime = String(Math.floor((Date.now() - this.started) / 1000))
    const rows: [string, string][] = [
      ['Connections', String(this.#connections?.made() ?? 0)],
      ['Queries', String(scope === 'GLOBAL' ? this.questions : questions)],
      ['Questions', String(scope === 'GLOBAL' ? this.questions : questions)],
      ['Threads_connected', String(this.#connections?.open() ?? 0)],
      ['Uptime', uptime],
      ['Uptime_since_flush_status', uptime],
    ]
    // The buffer pool's figures, under InnoDB's names: global, so a session sees them too.
    const e = this.engine?.()
    if (e !== undefined) {
      rows.push(
        ['Innodb_buffer_pool_pages_data', String(e.residentPages)],
        ['Innodb_buffer_pool_pages_dirty', String(e.dirtyPages)],
        ['Innodb_buffer_pool_pages_flushed', String(e.writes)],
        ['Innodb_buffer_pool_pages_free', String(e.poolFrames - e.residentPages)],
        // Pages held for the pool's own use: none.
        ['Innodb_buffer_pool_pages_misc', '0'],
        ['Innodb_buffer_pool_pages_total', String(e.poolFrames)],
        ['Innodb_buffer_pool_read_requests', String(e.fetches)],
        ['Innodb_buffer_pool_reads', String(e.reads)],
        ['Innodb_page_size', String(e.pageSize)],
      )
    }
    return rows.sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }

  /** Every variable's name: 8.4.11's, and any the embedding application declared, in SHOW VARIABLES' order. */
  systemVariableNames(): string[] {
    const names = new Set(systemVariableNames())
    for (const name of this.vars.keys()) names.add(name)
    return [...names].sort()
  }

  /** A variable's global value, or `undefined` for none. */
  global(name: string): SqlValue | undefined {
    return this.vars.has(name) ? this.vars.get(name) : systemVariableInfo(name)?.value
  }

  /**
   * A system variable as `@@name` reads it. The session's own values come
   * first — its `sql_mode`, its charset variables, anything it has `SET` —
   * then the global ones. `undefined` when there is no such variable.
   */
  systemVariable(name: string, scope: 'GLOBAL' | 'SESSION' | undefined, session: Session, own: ReadonlyMap<string, Value>): Value | undefined {
    const info = systemVariableInfo(name)
    // A name the server does not have is the caller's 1193; one an
    // application declared (`systemVariables`) is global, as SET GLOBAL makes it.
    if (info === undefined && !this.vars.has(name)) return undefined
    if (scope === 'SESSION' && info?.scope === 'global') throw sqlError('ER_INCORRECT_GLOBAL_LOCAL_VAR', `Variable '${name}' is a GLOBAL variable`)
    if (scope === 'GLOBAL' && info?.scope === 'session') throw sqlError('ER_INCORRECT_GLOBAL_LOCAL_VAR', `Variable '${name}' is a SESSION variable`)
    if (scope !== 'GLOBAL') {
      if (name === 'sql_mode') return fromSqlValue(session.sqlMode)
      if (name === 'autocommit') return intValue(session.autocommit ? 1n : 0n)
      // M2.18: derived from the session, so `SET NAMES latin1` reads back.
      const charsetVar = charsetVariables(session.characterSet)[name]
      if (charsetVar !== undefined) return fromSqlValue(charsetVar)
      const set = own.get(name)
      if (set !== undefined) return set
      if (name === 'pseudo_thread_id') return intValue(BigInt(session.connectionId))
      // The session's clock, to the microsecond, as `@@timestamp` reads it.
      if (name === 'timestamp') return doubleValue(Math.round(Date.now() * 1000) / 1e6)
    }
    const global = this.global(name)
    return global === undefined ? null : fromSqlValue(global, info)
  }

  /**
   * One `SET` item that is not a user variable. `evaluate` reads an
   * expression value; `own` is the session's store for what it sets.
   *
   * Three have an effect beyond being read back: the connection charset,
   * `sql_mode` (which decides how the session's next statement is parsed), and
   * `autocommit`, which the caller applies. Anything else is kept for
   * `@@name` to read back and otherwise changes nothing.
   */
  set(session: Session, item: SetItem, evaluate: (e: Expression) => Value, own: Map<string, Value>, warn: (code: number, message: string) => void = () => {}): 'sql_mode' | undefined {
    if (item.type === 'names' || item.type === 'charset') {
      session.characterSet = checkConnectionCharset(item).collationId
      return undefined
    }
    if (item.type === 'user') return undefined
    const name = (item.base === undefined ? item.name : `${item.base}.${item.name}`).toLowerCase()
    const scope = item.type === 'system' ? item.scope : undefined
    const value = item.value
    if (name === 'sql_mode') return this.#setSqlMode(session, scope, value, evaluate, warn) ? 'sql_mode' : undefined

    const global = scope === 'GLOBAL' || scope === 'PERSIST' || scope === 'PERSIST_ONLY'
    const info = systemVariableInfo(name)
    if (info === undefined && !this.vars.has(name)) throw sqlError('ER_UNKNOWN_SYSTEM_VARIABLE', `Unknown system variable '${name}'`)
    if (info?.readOnly === true) throw sqlError('ER_INCORRECT_GLOBAL_LOCAL_VAR', `Variable '${name}' is a read only variable`)
    if (!global && info?.scope === 'global') throw sqlError('ER_GLOBAL_VARIABLE', `Variable '${name}' is a GLOBAL variable and should be set with SET GLOBAL`)
    if (global && info?.scope === 'session') throw sqlError('ER_LOCAL_VARIABLE', `Variable '${name}' is a SESSION variable and can't be used with SET GLOBAL`)
    if (!global && info?.globalOnly === true) throw sqlError('ER_VARIABLE_IS_READONLY', `SESSION variable '${name}' is read-only. Use SET GLOBAL to assign the value`)

    let v: Value
    if (value.kind === NODE.KEYWORD) {
      const word = (value as KeywordNode).word.toUpperCase()
      // DEFAULT is the global value for a session, and the compiled-in default for the global itself.
      v = word !== 'DEFAULT' ? stringValue(word, CHARSET_UTF8MB4_0900_AI_CI) : !global && info?.zeroDefault === true ? intValue(0n) : fromSqlValue((global ? (OURS[name] ?? info?.value) : this.global(name)) ?? null, info)
    } else if (value.kind === NODE.COLUMN && value.parts.length === 1) {
      // `SET autocommit = ON`, `SET time_zone = SYSTEM`: a bare word is its text.
      v = stringValue(value.parts[0] as string, CHARSET_UTF8MB4_0900_AI_CI)
    } else v = evaluate(value)
    if (info !== undefined) v = assigned(info, v, warn)

    if (name === 'autocommit') {
      const text = v === null ? '' : toText(v).toUpperCase()
      const on = text === '1' || text === 'ON' || text === 'TRUE'
      if (!on && text !== '0' && text !== 'OFF' && text !== 'FALSE') throw sqlError('ER_WRONG_VALUE_FOR_VAR', `Variable 'autocommit' can't be set to the value of '${text}'`)
      if (scope === 'GLOBAL' || scope === 'PERSIST') this.vars.set(name, on ? 1 : 0)
      else session.autocommit = on
      return undefined
    }
    if (global) {
      if (scope !== 'PERSIST_ONLY') this.vars.set(name, v === null ? null : v.kind === 'int' || v.kind === 'double' ? v.v : toText(v))
      return undefined
    }
    // `SET TIMESTAMP = 0` or DEFAULT gives the session the time now again (8.4.11).
    if (name === 'timestamp' && (v === null || Number(toText(v)) === 0)) own.delete(name)
    else own.set(name, v)
    return undefined
  }

  /** Whether the session's own `sql_mode` was assigned. */
  #setSqlMode(session: Session, scope: string | undefined, value: Expression | KeywordNode, evaluate: (e: Expression) => Value, warn: (code: number, message: string) => void): boolean {
    let text: string
    if (value.kind === NODE.LITERAL && value.type === 'string' && typeof value.value === 'string') text = value.value
    else if (value.kind === NODE.COLUMN && value.parts.length === 1) text = value.parts[0] as string
    // DEFAULT is the global value for a session, and the compiled-in default for the global itself.
    else if (value.kind === NODE.KEYWORD && value.word === 'DEFAULT') text = scope === 'GLOBAL' || scope === 'PERSIST' || scope === 'PERSIST_ONLY' ? DEFAULT_SQL_MODE : String(this.global('sql_mode'))
    else if ((value.kind === NODE.LITERAL && value.type === 'null') || value.kind === NODE.KEYWORD) throw badMode(value.kind === NODE.KEYWORD ? value.word : 'NULL')
    // An expression is evaluated, as 8.4.11 evaluates it: an integer is the
    // modes' bits, any text their names (`CONCAT(@@sql_mode, ',ANSI')`, a
    // user variable, a subquery), and a DECIMAL or a DOUBLE neither (1232).
    // Until M5.36 an expression was accepted and changed nothing.
    else {
      const v = evaluate(value)
      if (v === null) throw badMode('NULL')
      if (v.kind === 'decimal' || v.kind === 'double') throw sqlError('ER_WRONG_TYPE_FOR_VAR', "Incorrect argument type to variable 'sql_mode'")
      text = v.kind === 'int' ? sqlModeOfBits(v.v) : toText(v)
    }
    // Validated even for `PERSIST_ONLY`, which stores without applying: an
    // unknown mode is ER_WRONG_VALUE_FOR_VAR whatever the scope.
    const parsed = parseSqlMode(text)
    // 3135, a warning: NO_ZERO_DATE, NO_ZERO_IN_DATE and
    // ERROR_FOR_DIVISION_BY_ZERO belong with a strict mode, all three or none
    // (8.4.11 warns for `STRICT_TRANS_TABLES` alone, and for `NO_ZERO_DATE` alone).
    const strict = parsed.names.has('STRICT_TRANS_TABLES') || parsed.names.has('STRICT_ALL_TABLES')
    const dates = ['NO_ZERO_DATE', 'NO_ZERO_IN_DATE', 'ERROR_FOR_DIVISION_BY_ZERO'].filter((m) => parsed.names.has(m)).length
    if (strict ? dates < 3 : dates > 0) warn(3135, "'NO_ZERO_DATE', 'NO_ZERO_IN_DATE' and 'ERROR_FOR_DIVISION_BY_ZERO' sql modes should be used with strict mode. They will be merged with strict mode in a future release.")
    // 3090 for every assignment that includes it, whatever the mode was, after 3135 (8.4.11).
    if (parsed.names.has('PAD_CHAR_TO_FULL_LENGTH')) warn(3090, "Changing sql mode 'PAD_CHAR_TO_FULL_LENGTH' is deprecated. It will be removed in a future release.")
    const mode = formatSqlMode(parsed)
    if (scope === 'GLOBAL' || scope === 'PERSIST') this.vars.set('sql_mode', mode)
    else if (scope !== 'PERSIST_ONLY') {
      session.sqlMode = mode
      return true
    }
    return false
  }

  /**
   * M3.8: `CREATE PROCEDURE` and its siblings store, `DROP` removes, and
   * `CALL` finds the procedure and says it cannot run it yet. The same errors
   * a server gives for a name that exists or does not.
   */
  program(session: Session, statement: ProgramStatement): void {
    if (statement.kind === STATEMENT.CALL) {
      if (!this.#programs.has(programKey('PROCEDURE', statement.name, session))) throw sqlError('ER_SP_DOES_NOT_EXIST', messages.objectMissing('PROCEDURE', qualified(statement.name, session)))
      throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('CALL'))
    }
    if (statement.kind === STATEMENT.DROP) {
      const object = statement.object as ProgramObject
      const name = statement.names[0] as TableName
      if (!this.#programs.delete(programKey(object, name, session)) && statement.ifExists !== true) {
        throw sqlError(MISSING[object], messages.objectMissing(object, qualified(name, session)))
      }
      return
    }
    const object = statement.kind === STATEMENT.CREATE_ROUTINE ? statement.object : statement.kind === STATEMENT.CREATE_TRIGGER ? 'TRIGGER' : 'EVENT'
    const key = programKey(object, statement.name, session)
    if (this.#programs.has(key)) {
      if (statement.ifNotExists === true) return
      throw sqlError(EXISTS[object], messages.objectExists(object, statement.name.name))
    }
    this.#programs.add(key)
  }
}

/** A `SET sql_mode = <integer>`'s modes, by name (8.4.11: past bit 32, or negative, is 1231). */
function sqlModeOfBits(bits: bigint): string {
  if (bits < 0n || bits >= 1n << BigInt(SQL_MODE_BITS.length)) throw badMode(String(bits))
  const reserved = bits & RESERVED_SQL_MODE_BITS
  if (reserved !== 0n) throw sqlError('ER_UNSUPPORTED_SQL_MODE', `sql_mode=0x${reserved.toString(16).padStart(8, '0')} is not supported.`)
  return SQL_MODE_BITS.filter((_, i) => (bits & (1n << BigInt(i))) !== 0n).join(',')
}
