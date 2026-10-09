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
import { DEFAULT_SERVER_VERSION } from '../connection.ts'
import { checkConnectionCharset, charsetVariables } from '../transcoder.ts'

export interface ServerOptions {
  readonly serverVersion?: string
  readonly versionComment?: string
  readonly systemVariables?: Readonly<Record<string, SqlValue>>
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

/** A `SqlValue` as an evaluation value, for a system variable. */
function fromSqlValue(v: SqlValue): Value {
  if (v === null) return null
  if (typeof v === 'number') return Number.isInteger(v) ? intValue(BigInt(v)) : doubleValue(v)
  if (typeof v === 'bigint') return intValue(v)
  if (typeof v === 'boolean') return intValue(v ? 1n : 0n)
  if (typeof v === 'string') return stringValue(v, CHARSET_UTF8MB4_0900_AI_CI, COERCIBILITY.SYSCONST)
  if (v instanceof Uint8Array) return { kind: 'bytes', v }
  return stringValue(String(v), CHARSET_UTF8MB4_0900_AI_CI, COERCIBILITY.SYSCONST)
}

/**
 * The server's global state: its system variables and its stored programs.
 * One per executor, shared by every session.
 */
export class ServerState {
  readonly serverVersion: string
  readonly vars: Map<string, SqlValue>
  /** M3.8: stored programs, accepted and kept, by `kind:schema.name`. Never run. */
  readonly #programs = new Set<string>()

  constructor(options: ServerOptions = {}) {
    this.serverVersion = options.serverVersion ?? DEFAULT_SERVER_VERSION
    this.vars = new Map<string, SqlValue>([
      ['version', this.serverVersion],
      ['version_comment', options.versionComment ?? 'myjs — an in-process MySQL for JavaScript'],
      ['sql_mode', 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'],
      ['autocommit', 1],
      ['time_zone', 'SYSTEM'],
      ['system_time_zone', 'UTC'],
      ['max_allowed_packet', 67108864],
      // Read by Rust's mysql_async (Prisma's engines) as it connects. There is
      // no socket in-process; this is MySQL's compiled-in default path.
      ['socket', '/tmp/mysql.sock'],
      ['wait_timeout', 28800],
      ['interactive_timeout', 28800],
      ['transaction_isolation', 'REPEATABLE-READ'],
      ['lower_case_table_names', 0],
      ['license', 'MIT'],
      ['have_ssl', 'DISABLED'],
      ['performance_schema', 0],
      ['innodb_lock_wait_timeout', 50],
      ['div_precision_increment', 4],
      ['auto_increment_increment', 1],
      ['auto_increment_offset', 1],
      ['default_storage_engine', 'InnoDB'],
      ['character_set_server', 'utf8mb4'],
      ['collation_server', 'utf8mb4_0900_ai_ci'],
      ['explicit_defaults_for_timestamp', 1],
      ...Object.entries(options.systemVariables ?? {}),
    ])
  }

  /**
   * A system variable as `@@name` reads it. The session's own values come
   * first — its `sql_mode`, its charset variables, anything it has `SET` —
   * then the global ones. `undefined` when there is no such variable.
   */
  systemVariable(name: string, scope: 'GLOBAL' | 'SESSION' | undefined, session: Session, own: ReadonlyMap<string, Value>): Value | undefined {
    if (scope !== 'GLOBAL') {
      if (name === 'sql_mode') return fromSqlValue(session.sqlMode)
      if (name === 'autocommit') return intValue(session.autocommit ? 1n : 0n)
      // M2.18: derived from the session, so `SET NAMES latin1` reads back.
      const charsetVar = charsetVariables(session.characterSet)[name]
      if (charsetVar !== undefined) return fromSqlValue(charsetVar)
      const set = own.get(name)
      if (set !== undefined) return set
    }
    const global = this.vars.get(name)
    return global === undefined ? undefined : fromSqlValue(global)
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

    let v: Value
    if (value.kind === NODE.KEYWORD) {
      const word = (value as KeywordNode).word.toUpperCase()
      v = word === 'DEFAULT' ? fromSqlValue(this.vars.get(name) ?? null) : stringValue(word, CHARSET_UTF8MB4_0900_AI_CI)
    } else if (value.kind === NODE.COLUMN && value.parts.length === 1) {
      // `SET autocommit = ON`, `SET time_zone = SYSTEM`: a bare word is its text.
      v = stringValue(value.parts[0] as string, CHARSET_UTF8MB4_0900_AI_CI)
    } else v = evaluate(value)

    if (name === 'autocommit') {
      const text = v === null ? '' : toText(v).toUpperCase()
      const on = text === '1' || text === 'ON' || text === 'TRUE'
      if (!on && text !== '0' && text !== 'OFF' && text !== 'FALSE') throw sqlError('ER_WRONG_VALUE_FOR_VAR', `Variable 'autocommit' can't be set to the value of '${text}'`)
      if (scope === 'GLOBAL' || scope === 'PERSIST') this.vars.set(name, on ? 1 : 0)
      else session.autocommit = on
      return undefined
    }
    if (scope === 'GLOBAL' || scope === 'PERSIST' || scope === 'PERSIST_ONLY') {
      if (scope !== 'PERSIST_ONLY') this.vars.set(name, v === null ? null : v.kind === 'int' ? Number(v.v) : toText(v))
      return undefined
    }
    own.set(name, v)
    return undefined
  }

  /** Whether the session's own `sql_mode` was assigned. */
  #setSqlMode(session: Session, scope: string | undefined, value: Expression | KeywordNode, evaluate: (e: Expression) => Value, warn: (code: number, message: string) => void): boolean {
    let text: string
    if (value.kind === NODE.LITERAL && value.type === 'string' && typeof value.value === 'string') text = value.value
    else if (value.kind === NODE.COLUMN && value.parts.length === 1) text = value.parts[0] as string
    // DEFAULT is the global value for a session, and the compiled-in default for the global itself.
    else if (value.kind === NODE.KEYWORD && value.word === 'DEFAULT') text = scope === 'GLOBAL' || scope === 'PERSIST' || scope === 'PERSIST_ONLY' ? DEFAULT_SQL_MODE : String(this.vars.get('sql_mode'))
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
