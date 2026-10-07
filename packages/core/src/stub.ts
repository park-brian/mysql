// M1.24 — "and a stub executor".
//
// Its only job is the M1 exit criterion, and it is replaced wholesale by the
// real executor in M5. That means it answers what a client actually sends
// before it gets to `SELECT 1` — the `mysql` CLI issues
// `SELECT @@version_comment LIMIT 1` on connect, and a driver typically sends
// a `SET` or two — rather than only the query the criterion names.
//
// It is deliberately not a SQL engine: there is no parser until M3. It matches
// a small set of statement shapes and evaluates a select list of literals,
// system variables and niladic functions. Anything else gets a clear
// "not supported yet" rather than a wrong answer.

import {
  CHARSET_BINARY,
  CHARSET_UTF8MB4_0900_AI_CI,
  COLUMN_FLAG,
  FIELD_TYPE,
  sqlError,
  messages,
  type ColumnDefinition,
  type Executor,
  type Parameter,
  type PreparedInfo,
  type Session,
  type SqlValue,
  utf8Transcoder,
  type StatementResult,
} from '@myjs/protocol'
import {
  NODE,
  ParseError,
  STATEMENT,
  badMode,
  formatSqlMode,
  parseSqlMode,
  parseStatement,
  type CallStatementNode,
  type CreateEventNode,
  type CreateRoutineNode,
  type CreateTriggerNode,
  type DropNode,
  type SetItem,
  type TableName,
  type SetNode,
  type SetTransactionNode,
  type UseNode,
} from '@myjs/parser'
import { DEFAULT_SERVER_VERSION } from './connection.ts'
import { charsetChange, charsetVariables, ensureCollationResident } from './transcoder.ts'

export interface StubOptions {
  readonly serverVersion?: string
  readonly versionComment?: string
  readonly systemVariables?: Readonly<Record<string, SqlValue>>
}

interface Evaluated {
  readonly label: string
  readonly value: SqlValue
  readonly column: ColumnDefinition
}

const textColumn = (name: string, length = 1020): ColumnDefinition => ({
  name,
  orgName: '',
  type: FIELD_TYPE.VAR_STRING,
  characterSet: CHARSET_UTF8MB4_0900_AI_CI,
  columnLength: length,
  flags: 0,
  decimals: 0x1f,
})

const intColumn = (name: string): ColumnDefinition => ({
  name,
  orgName: '',
  type: FIELD_TYPE.LONGLONG,
  characterSet: CHARSET_BINARY,
  columnLength: 20,
  flags: COLUMN_FLAG.NOT_NULL | COLUMN_FLAG.NUM | COLUMN_FLAG.BINARY,
  decimals: 0,
})

const nullColumn = (name: string): ColumnDefinition => ({
  name,
  orgName: '',
  type: FIELD_TYPE.NULL,
  characterSet: CHARSET_BINARY,
  columnLength: 0,
  flags: 0,
  decimals: 0,
})

export class StubExecutor implements Executor {
  readonly #options: StubOptions
  readonly #vars: Map<string, SqlValue>
  /** M3.8: stored programs, accepted and kept, by `kind:schema.name`. Never run. */
  readonly #programs = new Set<string>()

  constructor(options: StubOptions = {}) {
    this.#options = options
    this.#vars = new Map<string, SqlValue>([
      ['version', options.serverVersion ?? DEFAULT_SERVER_VERSION],
      ['version_comment', options.versionComment ?? 'myjs — an in-process MySQL for JavaScript'],
      ['sql_mode', 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'],
      ['autocommit', 1],
      ['time_zone', 'SYSTEM'],
      ['system_time_zone', 'UTC'],
      ['max_allowed_packet', 67108864],
      ['transaction_isolation', 'REPEATABLE-READ'],
      ['lower_case_table_names', 0],
      ['license', 'MIT'],
      ['have_ssl', 'DISABLED'],
      ['performance_schema', 0],
      ...Object.entries(options.systemVariables ?? {}),
    ])
  }

  async query(session: Session, sql: string): Promise<StatementResult | StatementResult[]> {
    const statement = sessionStatement(session, sql)
    await preload(statement)
    return this.#run(session, sql, [], statement)
  }

  async prepare(_session: Session, sql: string): Promise<PreparedInfo> {
    const paramCount = countPlaceholders(sql)
    const select = matchSelect(sql)
    if (select === null) return { paramCount, columns: [] }
    // Parameters are placeholders here, so an expression containing one cannot
    // be evaluated yet; report it as a text column and let execute decide.
    const columns = splitSelectList(select.list).map((item) =>
      item.includes('?') ? textColumn(item.trim()) : this.#evaluate(item).column,
    )
    return { paramCount, columns }
  }

  async execute(
    session: Session,
    sql: string,
    parameters: readonly Parameter[],
  ): Promise<StatementResult | StatementResult[]> {
    const statement = sessionStatement(session, sql)
    await preload(statement)
    return this.#run(session, sql, parameters, statement)
  }

  async initDb(session: Session, database: string): Promise<void> {
    session.database = database
  }

  statistics(session: Session): string {
    return (
      `Uptime: 0  Threads: 1  Questions: 0  Slow queries: 0  Opens: 0  ` +
      `Flush tables: 1  Open tables: 0  Queries per second avg: 0.000  ` +
      `Connection: ${session.connectionId}`
    )
  }

  #run(session: Session, sql: string, parameters: readonly Parameter[] = [], statement: SessionStatement | null = null): StatementResult {
    const trimmed = stripTrailingSemicolon(sql.trim())
    const upper = trimmed.toUpperCase()

    if (upper === '' ) return { affectedRows: 0 }

    // M3.6: `SET` and `USE` arrive parsed, which is what lets `SET NAMES` sit
    // anywhere in a list and `SET sql_mode` reach the session.
    if (statement?.kind === STATEMENT.SET) {
      for (const item of statement.items) this.#set(session, item)
      return { affectedRows: 0 }
    }
    // Accepted and not applied: the stub has no transactions to characterise.
    if (statement?.kind === STATEMENT.SET_TRANSACTION) return { affectedRows: 0 }
    if (statement?.kind === STATEMENT.USE) {
      session.database = statement.database
      return { affectedRows: 0 }
    }
    if (statement !== null) return this.#program(session, statement)

    // Statements a client sends for their side effect. The stub has no state
    // to change, but answering OK is what keeps a session usable.
    if (/^(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|DO|FLUSH)\b/.test(upper)) return { affectedRows: 0 }

    if (/^SHOW\s+WARNINGS\b/.test(upper)) {
      return {
        columns: [textColumn('Level', 28), textColumn('Code', 4), textColumn('Message', 2048)],
        rows: [],
      }
    }

    const select = matchSelect(trimmed)
    if (select !== null) {
      const items = splitSelectList(select.list)
      const evaluated = items.map((item, i) => this.#evaluate(item, session, parameters[i]))
      return {
        columns: evaluated.map((e) => e.column),
        // LIMIT 0 is the shape ORMs use to fetch metadata without rows.
        rows: select.limitZero ? [] : [evaluated.map((e) => e.value)],
      }
    }

    throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`This statement (${firstWord(trimmed)})`))
  }

  /**
   * M3.8: `CREATE PROCEDURE` and its siblings store, `DROP` removes, and
   * `CALL` finds the procedure and says it cannot run it yet. The same errors
   * a server gives for a name that exists or does not.
   */
  #program(session: Session, statement: ProgramStatement): StatementResult {
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
      return { affectedRows: 0 }
    }
    const object = statement.kind === STATEMENT.CREATE_ROUTINE ? statement.object : statement.kind === STATEMENT.CREATE_TRIGGER ? 'TRIGGER' : 'EVENT'
    const key = programKey(object, statement.name, session)
    if (this.#programs.has(key)) {
      if (statement.ifNotExists === true) return { affectedRows: 0 }
      throw sqlError(EXISTS[object], messages.objectExists(object, statement.name.name))
    }
    this.#programs.add(key)
    return { affectedRows: 0 }
  }

  /**
   * One `SET` item. Two have an effect: the charset of the connection, and
   * `sql_mode`, which decides how every later statement on the session is
   * parsed. Anything else is accepted and not stored, as before M3.6; the
   * real variable system arrives with the executor.
   */
  #set(session: Session, item: SetItem): void {
    if (item.type === 'names' || item.type === 'charset') {
      const change = charsetChange(item)
      if (change === 'unknown') throw sqlError('ER_UNKNOWN_CHARACTER_SET', messages.unsupportedCharset(0))
      session.characterSet = change.collationId
      return
    }
    if (item.type === 'user' || item.base !== undefined || item.name.toLowerCase() !== 'sql_mode') return
    const scope = item.type === 'system' ? item.scope : undefined
    const value = item.value
    let text: string
    if (value.kind === NODE.LITERAL && typeof value.value === 'string') text = value.value
    else if (value.kind === NODE.COLUMN && value.parts.length === 1) text = value.parts[0] as string
    else if (value.kind === NODE.KEYWORD && value.word === 'DEFAULT') text = String(this.#vars.get('sql_mode'))
    else if ((value.kind === NODE.LITERAL && value.type === 'null') || value.kind === NODE.KEYWORD) throw badMode(value.kind === NODE.KEYWORD ? value.word : 'NULL')
    // An expression — `CONCAT(@@sql_mode, ',ANSI')`, `(SELECT REPLACE(…))`, a
    // bitmask — needs the executor to evaluate. Until then it is accepted and
    // changes nothing, as every `SET` did before M3.6, because drivers send
    // these on connect and refusing them breaks the session outright.
    else return
    // Validated even for `PERSIST_ONLY`, which stores without applying: an
    // unknown mode is ER_WRONG_VALUE_FOR_VAR whatever the scope.
    const mode = formatSqlMode(parseSqlMode(text))
    if (scope === 'GLOBAL' || scope === 'PERSIST') this.#vars.set('sql_mode', mode)
    else if (scope !== 'PERSIST_ONLY') session.sqlMode = mode
  }

  #evaluate(rawItem: string, session?: Session, parameter?: Parameter): Evaluated {
    const { expression, alias } = splitAlias(rawItem.trim())
    const label = alias ?? expression
    const value = this.#value(expression, session, parameter)

    if (value === null) return { label, value, column: nullColumn(label) }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return { label, value, column: intColumn(label) }
    }
    return { label, value, column: textColumn(label) }
  }

  #value(expression: string, session?: Session, parameter?: Parameter): SqlValue {
    const expr = expression.trim()

    if (expr === '?') {
      const v = parameter?.value ?? null
      return v instanceof Uint8Array || v === null || typeof v === 'object' ? decodeParam(v, session) : v
    }

    if (/^-?\d+$/.test(expr)) return Number(expr)
    if (/^-?\d*\.\d+$/.test(expr)) return Number(expr)
    if (/^NULL$/i.test(expr)) return null
    if (/^'.*'$/s.test(expr) || /^".*"$/s.test(expr)) return stripQuotes(expr)

    if (expr.startsWith('@@')) {
      const name = expr.replace(/^@@(session\.|local\.|global\.)?/i, '').toLowerCase()
      // M3.6: the session's own `sql_mode`, which `SET sql_mode` changes.
      if (name === 'sql_mode' && session !== undefined && !/^@@global\./i.test(expr)) return session.sqlMode
      // M2.18: the `character_set_*` and `collation_*` variables are derived
      // from the session rather than hardcoded, so a client that issues
      // `SET NAMES latin1` and then reads them back sees latin1.
      const charsetVar = session === undefined ? undefined : charsetVariables(session.characterSet)[name]
      if (charsetVar !== undefined) return charsetVar
      const found = this.#vars.get(name)
      if (found === undefined) {
        throw sqlError('ER_UNKNOWN_SYSTEM_VARIABLE', `Unknown system variable '${name}'`)
      }
      return found
    }

    const call = /^([A-Za-z_]+)\s*\(\s*\)$/.exec(expr)
    if (call !== null) {
      const fn = (call[1] as string).toUpperCase()
      switch (fn) {
        case 'VERSION':
          return this.#vars.get('version') ?? DEFAULT_SERVER_VERSION
        case 'DATABASE':
        case 'SCHEMA':
          return session?.database ?? null
        case 'USER':
        case 'CURRENT_USER':
        case 'SESSION_USER':
          return `${session?.user ?? ''}@localhost`
        case 'CONNECTION_ID':
          return session?.connectionId ?? 0
        case 'NOW':
        case 'CURRENT_TIMESTAMP':
          return new Date()
        default:
          throw sqlError('ER_SP_DOES_NOT_EXIST', `FUNCTION ${fn} does not exist`)
      }
    }

    throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The expression \`${expr}\``))
  }
}

function decodeParam(v: unknown, session?: Session): SqlValue {
  if (v === null) return null
  // M2.18: `readBinaryValue` hands back raw bytes for every length-encoded
  // type, so the charset decision belongs here — and it is the session's, not
  // a hardcoded UTF-8.
  if (v instanceof Uint8Array) {
    // No session only in a direct unit-test call; `utf8Transcoder` is the same
    // default `Session` would have installed.
    return session === undefined
      ? utf8Transcoder.decode(v, CHARSET_UTF8MB4_0900_AI_CI)
      : session.transcoder.decode(v, session.characterSet)
  }
  return v as SqlValue
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, '')
}

function firstWord(sql: string): string {
  return (/^\w+/.exec(sql.trim())?.[0] ?? sql).toUpperCase()
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) {
    return t.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"')
  }
  return t
}

interface SelectMatch {
  readonly list: string
  readonly limitZero: boolean
}

function matchSelect(sql: string): SelectMatch | null {
  const m = /^SELECT\s+([\s\S]+?)(?:\s+LIMIT\s+(\d+)(?:\s*,\s*(\d+))?)?$/i.exec(sql.trim())
  if (m === null) return null
  const list = (m[1] as string).trim()
  // A FROM clause means real tables, which the stub does not have.
  if (/\sFROM\s/i.test(` ${list} `)) return null
  const limit = m[3] ?? m[2]
  return { list, limitZero: limit === '0' }
}

function countPlaceholders(sql: string): number {
  let count = 0
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '?') count++
  }
  return count
}

/** Split on top-level commas, respecting quotes and parentheses. */
function splitSelectList(list: string): string[] {
  const items: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as string
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      items.push(list.slice(start, i))
      start = i + 1
    }
  }
  items.push(list.slice(start))
  return items.map((s) => s.trim()).filter((s) => s !== '')
}

function splitAlias(item: string): { expression: string; alias: string | null } {
  const as = /^([\s\S]+?)\s+AS\s+(`[^`]+`|'[^']+'|"[^"]+"|\w+)$/i.exec(item)
  if (as !== null) return { expression: (as[1] as string).trim(), alias: stripQuotes(as[2] as string) }
  // A bare trailing identifier is an alias only when the expression is not
  // itself a bare identifier — `SELECT 1 x` aliases, `SELECT x` does not.
  const bare = /^([\s\S]*[)'"\d@])\s+(\w+)$/.exec(item)
  if (bare !== null && !/^\w+$/.test(item)) {
    return { expression: (bare[1] as string).trim(), alias: bare[2] as string }
  }
  return { expression: item, alias: null }
}

type ProgramStatement = CreateRoutineNode | CreateTriggerNode | CreateEventNode | CallStatementNode | DropNode
type SessionStatement = SetNode | SetTransactionNode | UseNode | ProgramStatement

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

/** `db.name`, in the session's database when unqualified. */
const qualified = (name: TableName, session: Session): string => `${name.schema ?? session.database ?? ''}.${name.name}`
/** Stored-program names are case-insensitive, as MySQL's are. */
const programKey = (object: string, name: TableName, session: Session): string => `${object}:${qualified(name, session).toLowerCase()}`

const PROGRAM_OBJECTS: ReadonlySet<string> = new Set(['PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT'])

/**
 * The statements this stub reads with the parser: `SET` and `USE`, parsed
 * with the session's own `sql_mode` — so a session that has run
 * `SET sql_mode = 'NO_BACKSLASH_ESCAPES'` reads its next statement that way —
 * and the stored-program statements M3.8 stores. Everything else stays with
 * the regexes above until the executor replaces this file.
 */
function sessionStatement(session: Session | undefined, sql: string): SessionStatement | null {
  if (session === undefined || !/^\s*(SET|USE|CREATE|DROP|CALL)\b/i.test(sql)) return null
  let node
  try {
    node = parseStatement(sql, { sqlMode: parseSqlMode(session.sqlMode) })
  } catch (e) {
    // `SET PASSWORD`, `SET ROLE` and the other `SET`s the parser names as not
    // implemented were answered OK before M3.6, and still are: a driver's
    // connect sequence must not fail on them. A syntax error stays an error.
    if (e instanceof ParseError && e.code === 'ER_NOT_SUPPORTED_YET' && /^\s*SET\b/i.test(sql)) {
      return { kind: STATEMENT.SET, items: [], at: 0 }
    }
    throw e
  }
  switch (node.kind) {
    case STATEMENT.SET:
    case STATEMENT.SET_TRANSACTION:
    case STATEMENT.USE:
    case STATEMENT.CREATE_ROUTINE:
    case STATEMENT.CREATE_TRIGGER:
    case STATEMENT.CREATE_EVENT:
    case STATEMENT.CALL:
      return node
    case STATEMENT.DROP:
      return PROGRAM_OBJECTS.has(node.object) ? node : null
    default:
      return null
  }
}

/**
 * The async half of D-36, on the one statement that can reach a collation
 * whose tables are not resident.
 *
 * `SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci` is how a client reaches the
 * 8.0 default at all — `HandshakeV10` carries one byte for the collation id,
 * so 255 cannot be negotiated. Loading here, on the async edge, is what lets
 * every later `collation()` on the hot path stay synchronous.
 *
 * `#run` itself stays synchronous, which is the point: an executor is not
 * allowed to need an `await` in the middle of ordering rows.
 */
async function preload(statement: SessionStatement | null): Promise<void> {
  if (statement?.kind !== STATEMENT.SET) return
  for (const item of statement.items) {
    if (item.type !== 'names' && item.type !== 'charset') continue
    const change = charsetChange(item)
    if (change !== 'unknown') await ensureCollationResident(change.collationId)
  }
}
