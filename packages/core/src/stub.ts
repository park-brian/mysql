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
import { DEFAULT_SERVER_VERSION } from './connection.ts'
import { charsetVariables, ensureCollationResident, parseSetNames } from './transcoder.ts'

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
    await this.#preload(session, sql)
    return this.#run(session, sql)
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
    await this.#preload(session, sql)
    return this.#run(session, sql, parameters)
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
  async #preload(session: Session | undefined, sql: string): Promise<void> {
    if (session === undefined) return
    const change = parseSetNames(sql)
    if (change !== null && change !== 'unknown') await ensureCollationResident(change.collationId)
  }

  #run(session: Session, sql: string, parameters: readonly Parameter[] = []): StatementResult {
    const trimmed = stripTrailingSemicolon(sql.trim())
    const upper = trimmed.toUpperCase()

    if (upper === '' ) return { affectedRows: 0 }

    // Statements a client sends for their side effect. The stub has no state
    // to change, but answering OK is what keeps a session usable.
    if (/^(SET|BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|USE|DO|FLUSH)\b/.test(upper)) {
      if (upper.startsWith('USE ')) {
        session.database = stripQuotes(trimmed.slice(4).trim())
      }
      // M2.18: `SET NAMES` is the only `SET` with a real effect here. Doc 29:
      // `HandshakeV10` carries one byte for the collation id, so a client
      // cannot reach `utf8mb4_0900_ai_ci` (255) any other way.
      const change = parseSetNames(trimmed)
      if (change === 'unknown') {
        throw sqlError('ER_UNKNOWN_CHARACTER_SET', messages.unsupportedCharset(0))
      }
      if (change !== null && session !== undefined) {
        session.characterSet = change.collationId
      }
      return { affectedRows: 0 }
    }

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
      const name = expr.replace(/^@@(session\.|global\.)?/i, '').toLowerCase()
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
