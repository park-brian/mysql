// M5 — the executor: what answers `Executor` once there is a database behind it.
//
// Ground rule 3 decides its shape. Everything that waits happens here, on the
// async edge, *before* a statement runs: loading the collation tables its
// tables and literals need (D-36), and waiting for the single writer slot
// (D-53). The statement itself then runs synchronously from parse tree to
// result, and nothing inside it awaits.
//
// Waiting for the writer is a retry, and that is sound because a statement
// that would write takes the slot before it does anything else (`SqlSession.
// statement`): a busy slot is found with nothing yet changed, so running the
// statement again later is the same as having waited. Past
// `innodb_lock_wait_timeout` the answer is ER_LOCK_WAIT_TIMEOUT (1205), which
// rolls back the statement and not the transaction, as InnoDB's does.
import { notSupported, tableExistsError, unknownTableError } from './errors.ts'
import { requireSchema } from './scope.ts'
import { FIELD_TYPE, MyjsError, expectTyped } from '@myjs/bytes'
import { someNode } from './ast.ts'
import { collationInfoByName, defaultCollationOf, requireCollationInfo } from '@myjs/charsets'
import { EngineError, tooLongIdent, wrongDbName, collationsOf, type Catalog, type TableDef, type ViewDef } from '@myjs/engine'
import {
  NODE,
  QUERY,
  REF,
  parseStatementSequence,
  ParseError,
  Cursor,
  BINARY_DEPRECATION,
  KEY,
  STATEMENT,
  TOKEN,
  lex,
  parseStatement,
  type CreateDatabaseNode,
  type ColumnDefinition as ParsedColumnDefinition,
  type CreateTableNode,
  type ExplainNode,
  type InsertNode,
  type UpdateNode,
  type DeleteNode,
  type ParseCondition,
  type CreateViewNode,
  type DropNode,
  type Expression,
  type QueryExpression,
  type SetNode,
  type ShowNode,
  type Statement,
  type TableName,
  type TableReference,
  type Token,
} from '@myjs/parser'
import {
  CHARSET_UTF8MB4_0900_AI_CI,
  defaultStatistics,
  dateToMysql,
  SqlError,
  messages,
  sqlError,
  type ColumnDefinition,
  type Executor,
  type OkResult,
  type Parameter,
  type PreparedInfo,
  type Session,
  type ResultSet,
  type RowValue,
  type StatementResult,
  type StreamedResultSet,
} from '@myjs/protocol'
import { conditionsFor, promotedError } from './strict.ts'
import { renameTables } from './rename.ts'
import { showCreateView, showQuery, shownColumns, tableStatusQuery, variablesColumns, variablesQuery } from './show.ts'
import { COERCIBILITY, doubleValue, intValue, parseDecimal, plainValue, stringValue, toInteger, toText, type Condition, type Value } from '@myjs/types'
import { charsetChange, ensureCollationResident } from '../transcoder.ts'
import { PROGRAM_OBJECTS, ServerState, type ProgramStatement, type ServerOptions } from './admin.ts'
import { systemVariable, compile, EMPTY_SCOPE, raise, type Env } from './compile.ts'
import { renderTree } from './explain.ts'
import { analyze, keepShown } from './stats.ts'
import { alterTable } from './alter.ts'
import { checkClauses, checkForeignKeyActions, withChecks } from './checks.ts'
import { showCreateTable } from './show-create.ts'
import { DEFAULT_COLLATION, createTableSpec, deprecationWarnings, duplicateKeys, duplicateKeyText, resolveCollation, resolveOptionsCollation } from './ddl.ts'
import { foreignKeyChecks, foreignKeyClause, foreignKeysOf, referencingKeys, withForeignKeys } from './foreign-keys.ts'
import { checkDefaultAdmission, checkDefaults, insert, remove, update } from './dml.ts'
import { fulltextOf } from './fulltext.ts'
import { columnDefinition, intType, stringType } from './meta.ts'
import { columnsOf, compileContext, planQuery, resultSet, resultSteps, viewTable, type Run } from './query.ts'
import { SqlSession, finish, isolationOf } from './session.ts'
import { dropOrphans, sessionCatalog, TemporaryTables, type CatalogApi } from './temporary.ts'
import { likeSpec, mergedColumns, selectColumns, withCollations } from './create-select.ts'
import { checkGeneratedAdmission, checkGeneratedDefault, stampGenerated } from './generated.ts'
import type { WireProtocol } from './wire.ts'
import { modeOf } from './mode.ts'

export interface SqlExecutorOptions extends ServerOptions {
  /** The database. Without one the executor still answers what needs no table — `SET`, `SELECT 1` — as M1's stub did. */
  readonly catalog?: Catalog
}

const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true })

/** A wire parameter as a value: a string in the client's charset, unless its bytes are not text, in which case they are bytes. */
function parameterValue(p: Parameter, session: Session): Value {
  const v = p.value
  if (v === null) return null
  if (v instanceof Uint8Array) {
    if (p.type === FIELD_TYPE.NEWDECIMAL || p.type === FIELD_TYPE.DECIMAL) return parseDecimal(new TextDecoder().decode(v))
    let text: string
    try {
      text = session.characterSet === CHARSET_UTF8MB4_0900_AI_CI || session.transcoder === undefined ? UTF8_FATAL.decode(v) : session.transcoder.decode(v, session.characterSet)
    } catch {
      return { kind: 'bytes', v }
    }
    return stringValue(text, session.characterSet, COERCIBILITY.COERCIBLE)
  }
  if (typeof v === 'bigint') return intValue(v, p.unsigned)
  if (typeof v === 'number') return Number.isInteger(v) && p.type !== FIELD_TYPE.DOUBLE && p.type !== FIELD_TYPE.FLOAT ? intValue(BigInt(v), p.unsigned) : doubleValue(v)
  if (typeof v === 'boolean') return intValue(v ? 1n : 0n)
  if (typeof v === 'string') return stringValue(v, session.characterSet)
  if (v instanceof Date) {
    return { kind: 'datetime', v: dateToMysql(v), type: 'DATETIME', fsp: 6 }
  }
  if ('negative' in v) return { kind: 'time', v, fsp: v.microsecond === 0 ? 0 : 6 }
  const date = v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0 && p.type === FIELD_TYPE.DATE
  return { kind: 'datetime', v, type: date ? 'DATE' : 'DATETIME', fsp: v.microsecond === 0 ? 0 : 6 }
}

/** 3554: a system schema a statement may not touch. */
const systemSchema = (name: string) => sqlError('ER_NO_SYSTEM_SCHEMA_ACCESS', `Access to system schema '${name}' is rejected.`)

/** Every error a statement can raise, as the `SqlError` a client is sent: typed errors keep their number. */
export function toSqlError(e: unknown): SqlError {
  if (e instanceof MyjsError && e.errno !== undefined) return e instanceof SqlError ? e : new SqlError(e.code, e.message, e)
  // A fault that is not the client's: reported, never a crash of the connection (ground rule 5).
  return new SqlError('ER_INTERNAL_ERROR', `Internal error: ${e instanceof Error ? e.message : String(e)}`)
}

/** Whether a statement can change rows: the ones that may not simply be run again after failing part-way. */
const writes = (statement: Statement): statement is InsertNode | UpdateNode | DeleteNode =>
  statement.kind === STATEMENT.INSERT || statement.kind === STATEMENT.UPDATE || statement.kind === STATEMENT.DELETE

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How long a statement runs before it pauses to let other connections in (D-77). */
const SLICE_MS = 10

/** Parameters enough that decoding them was a slice of its own. */
const MANY_PARAMETERS = 4096

/** Undo records the background purge takes a turn: about as long as a slice. */
const PURGE_SLICE_RECORDS = 512

/** One turn of the event loop: whatever was waiting runs before a paused statement resumes. */
const pause = (): Promise<void> => sleep(0)

const isSteps = <T>(x: T | Generator<void, T>): x is Generator<void, T> => typeof (x as { next?: unknown }).next === 'function' && typeof (x as { throw?: unknown }).throw === 'function'

/**
 * Which of a query's columns are made as a literal's are, rather than a
 * function's: a literal select item, or any column of a set operation,
 * whose result is a holder of the types it meets (`Item_type_holder`).
 */
function literalColumns(q: QueryExpression): (i: number) => boolean {
  const body = q.body
  if (body.kind !== QUERY.SELECT) return () => true
  // A `*` expands to columns, which are copied whatever their place: past one, places no longer match items.
  if (body.items.some((item) => !('expr' in item))) return () => false
  return (i) => {
    const item = body.items[i]
    return item !== undefined && 'expr' in item && item.expr.kind === NODE.LITERAL
  }
}

/** Diagnostic SHOW statements retain the area they inspect and cannot be prepared. */
function isDiagnostic(statement: Statement): boolean {
  return statement.kind === STATEMENT.SHOW && (statement.what === 'WARNINGS' || statement.what === 'ERRORS')
}

/** Constructor failures retain grammar warnings; publication appends the primary error. */
const grammarFailures = new WeakMap<MyjsError, readonly ParseCondition[]>()

function conditionLimit(state: SqlSession): number {
  // The compiled system-variable registry supplies this nonnullable integer.
  return Number(toInteger(state.systemVariable('max_error_count', undefined, state.session)!))
}

/** One owner for the kept condition prefix and the command's complete counters. */
function recordDiagnostics(state: SqlSession, conditions: readonly Condition[], limit: number, warnings = 0): number {
  warnings = Math.max(warnings, conditions.length)
  let errors = 0
  for (const condition of conditions) if (condition.level === 'Error') errors++
  state.diagnostics = { conditions: conditions.slice(0, limit), warnings, errors }
  return warnings
}

/** Translate parser conditions once, retaining order and their warning/error distinction. */
function appendConditions(conditions: Condition[] | undefined, parsed: readonly ParseCondition[]): void {
  for (const c of parsed) conditions?.push({ level: c.level ?? 'Error', code: c.errno, message: c.message })
}

/** Protocol admission without a SQL condition area clears diagnostics. */
function recordFailure(state: SqlSession, conditions: Condition[] | undefined, failure: unknown, limit = conditionLimit(state)): SqlError {
  const error = toSqlError(failure)
  if (!promotedError(conditions, error)) {
    if (failure instanceof EngineError && failure.readIndex !== undefined) {
      conditions?.push({ level: 'Warning', code: 159, message: `InnoDB: insufficient history for index ${failure.readIndex}` })
    }
    let parsing: readonly ParseCondition[] | undefined
    if (failure instanceof ParseError) parsing = failure.conditions ?? [error]
    else if (failure instanceof MyjsError) {
      const warnings = grammarFailures.get(failure)
      if (warnings !== undefined) parsing = [...warnings, error]
    }
    // A full parser prefix may contain only warnings even when it returns ERR.
    const kept: readonly ParseCondition[] = parsing?.slice(0, limit) ?? [error]
    appendConditions(conditions, kept)
  }
  recordDiagnostics(state, conditions ?? [], limit)
  return error
}

/** Reference parts share cardinality; invalid names retain their database/routine identity. */
function functionIdentifierError(name: string, kind: 'database' | 'routine'): MyjsError | undefined {
  if (name === '' || name.endsWith(' ')) {
    if (kind === 'database') return wrongDbName(name)
    return sqlError('ER_SP_WRONG_NAME', `Incorrect routine name '${name}'`)
  }
  if (/^.{65}/su.test(name)) return tooLongIdent(name)
  return undefined
}

/** Own complete source-free BINARY declarations; mixed histories and charset conversion keep their publishers. */
function binaryDeclarations(statement: Statement, conditions: Condition[], limit: number): void {
  if (statement.kind !== STATEMENT.QUERY) return
  const grammar = Cursor.conditions(statement)
  if (grammar === undefined || !grammar.every(c => c.errno === 1287 && c.message === BINARY_DEPRECATION)) return
  if (someNode(statement, n => {
    const kind = (n as { kind?: string }).kind
    return kind === REF.TABLE || kind === NODE.CONVERT || undefined
  })) return
  appendConditions(conditions, grammar.slice(0, limit))
}

/** How many parsed statements `SqlExecutor` keeps. */
const PARSED_KEPT = 16

export class SqlExecutor implements Executor {
  readonly catalog: Catalog | undefined
  readonly server: ServerState
  readonly #sessions = new WeakMap<Session, SqlSession>()
  /**
   * Sessions whose connection has gone. A statement that was waiting at an
   * await — for the writer, for a collation — when its connection closed must
   * not run afterwards: `end()` has already rolled its transaction back, and
   * running it then would commit a write from an abandoned transaction, or
   * open one nothing will ever end (found by review).
   */
  readonly #ended = new WeakSet<Session>()
  /**
   * The prepared statements parsed last, by sql_mode and text: one is parsed
   * when prepared and again each time it runs. A text query is parsed once
   * and not kept, since a bulk INSERT's tree can run to megabytes. A statement is never
   * changed after parsing (the suites, the fuzzer and both ORMs ran with every
   * one frozen), so one can be handed out twice.
   */
  readonly #parsed = new Map<string, Statement>()
  /** Each session's temporary tables, dropped when it ends or is reset. */
  readonly #temporary = new WeakMap<Session, TemporaryTables>()
  #temporaries = 0

  constructor(options: SqlExecutorOptions = {}) {
    this.catalog = options.catalog
    this.server = new ServerState({ engine: () => this.catalog?.store.stats(), ...options })
    if (this.catalog !== undefined) dropOrphans(this.catalog)
  }

  /** The catalog as `session` sees it: its temporary tables over everyone's. */
  #catalogOf(session: Session): CatalogApi | undefined {
    if (this.catalog === undefined) return undefined
    let temporary = this.#temporary.get(session)
    if (temporary === undefined) this.#temporary.set(session, (temporary = new TemporaryTables(this.catalog, ++this.#temporaries, () => this.#sessions.get(session)?.trx)))
    return sessionCatalog(this.catalog, temporary)
  }

  #state(session: Session, defaults?: ReadonlyMap<string, Value>): SqlSession {
    let s = this.#sessions.get(session)
    if (s === undefined) {
      s = new SqlSession(session, this.server, defaults)
      this.#sessions.set(session, s)
    }
    return s
  }

  /** Capture globals independently of the later authentication and first query. */
  openSession(reset = false): (session: Session) => void {
    const defaults = this.server.snapshotSession()
    return (session) => {
      this.#alive(session)
      this.#state(session, defaults)
      // RESET uses server defaults; an initial/change-user handshake supplies its charset.
      if (reset) {
        const collation = defaults.get('collation_connection')
        session.characterSet = (collation == null ? undefined : collationInfoByName(toText(collation))?.id) ?? CHARSET_UTF8MB4_0900_AI_CI
      }
    }
  }

  async query(session: Session, sql: string): Promise<StatementResult | StatementResult[]> {
    return this.#statement(session, sql, [], undefined, 'text')
  }

  async execute(session: Session, sql: string, parameters: readonly Parameter[]): Promise<StatementResult | StatementResult[]> {
    const params = parameters.filter((p) => p.name === '').map((p) => parameterValue(p, session))
    // Thousands of parameters took a slice to decode before this ran: the
    // other connections go next, before the statement does (D-77).
    if (params.length >= MANY_PARAMETERS) await pause()
    return this.#statement(session, sql, params, params, 'binary')
  }

  async prepare(session: Session, sql: string): Promise<PreparedInfo> {
    this.#alive(session)
    const state = this.#state(session)
    const limit = conditionLimit(state)
    let conditions: Condition[] | undefined = []
    try {
      let started = performance.now()
      const tokens = lex(sql, { sqlMode: modeOf(session.sqlMode) })
      const paramCount = tokens.filter((t) => t.kind === TOKEN.PLACEHOLDER).length
      // COM_STMT_PREPARE_OK counts them in two bytes (`sql_prepare.cc`: 1390).
      if (paramCount > 0xffff) {
        conditions = undefined
        throw sqlError('ER_PS_MANY_PARAM', 'Prepared statement contains too many placeholders')
      }
      // Lexing and parsing are separate slices; do not join their pauses into
      // one long stall before PREPARE's metadata delivery can yield.
      if (performance.now() - started > SLICE_MS) await pause()
      this.#alive(session)
      started = performance.now()
      const statement = this.#parse(session, sql, 'binary', tokens) as Statement | null
      // Parsing a statement of 32,000 placeholders is a slice and more on its
      // own: the other connections go next, before its EXECUTE does (D-77).
      if (performance.now() - started > SLICE_MS) await pause()
      this.#alive(session)
      // Admit the AST before metadata or diagnostic-count PREPARE refusal.
      const diagnostic = statement !== null && this.#admitStatement(statement, state, session)
      if (statement === null || diagnostic || isDiagnostic(statement)) throw sqlError('ER_UNSUPPORTED_PS', 'This command is not supported in the prepared statement protocol yet')
      binaryDeclarations(statement, conditions, limit)
      await this.#preload(session, statement)
      this.#alive(session)
      let columns: PreparedInfo['columns'] = []
      if (statement.kind === STATEMENT.QUERY) {
        const run = { ...this.#run(session, sql, [], undefined, 'binary', conditions), preparing: true }
        columns = columnsOf(run, planQuery(run, statement).columns)
      }
      // Every supported statement may have a large parameter response.
      if (paramCount >= MANY_PARAMETERS) await pause()
      this.#alive(session)
      return { paramCount, columns, warnings: recordDiagnostics(state, conditions, limit) }
    } catch (e) {
      throw recordFailure(state, conditions, e, limit)
    }
  }

  /** Ordered AST admission before effects; return whether diagnostic counters are read. */
  #admitStatement(statement: Statement, state: SqlSession, session: Session): boolean {
    const view = statement.kind === STATEMENT.CREATE_VIEW
    if (view && someNode(statement.query, (n) => ((n as QueryExpression).kind === QUERY.QUERY && (n as QueryExpression).into !== undefined) || undefined)) throw sqlError('ER_VIEW_SELECT_CLAUSE', "View's SELECT contains a 'INTO' clause")
    let diagnostic = false
    const bind = (node: object): undefined => {
      const e = node as Expression
      if (view && (e.kind === NODE.VARIABLE || e.kind === NODE.PLACEHOLDER)) throw sqlError('ER_VIEW_SELECT_VARIABLE', "View's SELECT contains a variable or parameter")
      if (e.kind === NODE.CALL) {
        const error = (e.schema === undefined ? undefined : functionIdentifierError(e.schema, 'database'))
          ?? functionIdentifierError(e.name, 'routine')
        if (error !== undefined) {
          // Only typed constructor refusals carry the retained grammar snapshot.
          grammarFailures.set(error, Cursor.conditions(statement) ?? [])
          throw error
        }
      }
      if (e.kind === NODE.VARIABLE) {
        const name = systemVariable(e, state, session)?.name
        if (name === 'warning_count' || name === 'error_count') diagnostic = true
      }
      return undefined
    }
    const admitColumn = (column: ParsedColumnDefinition): void => {
      checkGeneratedDefault(column)
      resolveCollation(column.type.charset, column.type.collation, DEFAULT_COLLATION)
      const { generated, default: value, ...remaining } = column
      const expression = generated?.expr ?? value
      if (expression !== undefined) someNode(expression, bind)
      if (generated !== undefined) checkGeneratedAdmission(generated.expr, column.name, modeOf(session.sqlMode))
      else if (column.defaultExpression === true && value !== undefined) checkDefaultAdmission(value, column.name, modeOf(session.sqlMode))
      someNode(remaining, bind)
    }
    if (statement.kind === STATEMENT.CREATE_TABLE) {
      requireSchema(statement.table.schema ?? session.database)
      for (const column of statement.columns) admitColumn(column)
      const { columns: _columns, ...remaining } = statement
      someNode(remaining, bind)
    } else if (statement.kind === STATEMENT.ALTER_TABLE) {
      requireSchema(statement.table.schema ?? session.database)
      for (const action of statement.actions) {
        if (action.type === 'addColumn' || action.type === 'changeColumn') admitColumn(action.column)
        else someNode(action, bind)
      }
    } else someNode(statement, bind)
    if (statement.kind === STATEMENT.SET) for (const item of statement.items) {
      if (item.type === 'system' || item.type === 'name') this.server.assignment(item)
    }
    return diagnostic
  }

  async initDb(session: Session, database: string): Promise<void> {
    if (this.catalog !== undefined && database.toLowerCase() !== 'information_schema') {
      try {
        this.#catalogOf(session)?.schema(database)
      } catch (e) {
        throw toSqlError(e)
      }
    }
    // The system schema is named in lower case, however the client wrote it (8.4.11).
    session.database = database.toLowerCase() === 'information_schema' ? 'information_schema' : database
  }

  statistics(session: Session): string {
    return defaultStatistics(session)
  }

  reset(session: Session): void {
    this.#sessions.get(session)?.rollback()
    this.#sessions.delete(session)
    // A session's temporary tables end with it, and with a reset (COM_RESET_CONNECTION).
    this.#temporary.get(session)?.dropAll()
    this.#temporary.delete(session)
  }

  end(session: Session): void {
    this.#ended.add(session)
    this.reset(session)
  }

  /** Refuse an ended session, throwing into active steps so they can roll back. */
  #alive(session: Session, steps?: Generator<void, unknown>): void {
    if (this.#ended.has(session)) {
      const error = sqlError('ER_QUERY_INTERRUPTED', 'Query execution was interrupted')
      if (steps === undefined) throw error
      steps.throw(error)
    }
  }

  /** Protocol-aware parsing; comment-only text is answered OK without running. */
  #parse(session: Session, sql: string, protocol: WireProtocol, tokens?: Token[]): Statement | ReturnType<typeof parseStatementSequence> | null {
    const key = protocol === 'binary' ? `${session.sqlMode}\n${sql}` : undefined
    if (key !== undefined) {
      const cached = this.#parsed.get(key)
      if (cached !== undefined) return cached
    }
    const options = { sqlMode: modeOf(session.sqlMode), parameters: protocol === 'binary' }
    tokens ??= lex(sql, options)
    if (tokens.every((t) => t.kind === TOKEN.EOF || (t.kind === TOKEN.OPERATOR && t.text === ';'))) {
      if (/^[\s;]*$/.test(sql)) throw sqlError('ER_EMPTY_QUERY', 'Query was empty')
      return null
    }
    const parsing = { ...options, tokens }
    if (protocol === 'text' && session.multipleStatementsEnabled) return parseStatementSequence(sql, parsing)
    const statement = parseStatement(sql, parsing)
    if (key !== undefined) {
      if (this.#parsed.size >= PARSED_KEPT) this.#parsed.delete(this.#parsed.keys().next().value as string)
      this.#parsed.set(key, statement)
    }
    return statement
  }

  /** The async half: every collation the statement can reach, resident before it runs (D-36). */
  async #preload(session: Session, statement: Statement): Promise<void> {
    const ids = new Set<number>([session.characterSet, DEFAULT_COLLATION])
    if (statement.kind === STATEMENT.SET) {
      for (const item of statement.items) {
        if (item.type !== 'names' && item.type !== 'charset') continue
        const change = charsetChange(item)
        if (change !== 'unknown') ids.add(change.collationId)
      }
    }
    const catalog = this.catalog
    // Every source, including nested query blocks, contributes its field collations.
    const tableCollations = (name: TableName): void => {
      const schema = name.schema ?? session.database
      if (catalog === undefined || schema === null) return
      try {
        for (const id of collationsOf(catalog.definition(schema, name.name))) ids.add(id)
      } catch (e) {
        expectTyped(e)
        // The statement itself will report a missing source.
      }
    }
    if (statement.kind === STATEMENT.INSERT) tableCollations(statement.table)
    if (catalog !== undefined && statement.kind === STATEMENT.CREATE_TABLE) {
      try {
        const schema = statement.table.schema ?? session.database
        if (schema !== null) ids.add(resolveOptionsCollation(statement.options, catalog.schema(schema).collationId ?? DEFAULT_COLLATION))
      } catch (e) {
        expectTyped(e)
        // The DDL writer owns complete table-spec validation.
      }
    }
    // Every collation the statement names itself — `COLLATE x`, `_latin1'…'`,
    // `CAST(… AS CHAR CHARACTER SET x)` — found by walking the tree for the
    // fields that carry one.
    someNode(statement, (node) => {
      const o = node as Record<string, unknown>
      const ref = node as TableReference
      if (ref.kind === REF.TABLE) tableCollations(ref.table)
      if (typeof o['collation'] === 'string') {
        const info = collationInfoByName(o['collation'])
        if (info !== undefined) ids.add(info.id)
      }
      if (typeof o['charset'] === 'string') {
        const info = defaultCollationOf(o['charset'])
        if (info !== undefined) ids.add(info.id)
      }
      return undefined
    })
    for (const id of ids) {
      try {
        await ensureCollationResident(id)
      } catch {
        // An unknown or unsupported id is the statement's error to report.
      }
    }
  }

  /**
   * One `COM_QUERY` or `COM_STMT_EXECUTE`. With D-13's switch on and the
   * capability negotiated, the text may hold several statements, run in turn
   * and answered as several results; the first error stops the rest, as it
   * does on MySQL.
   */
  async #statement(session: Session, sql: string, params: readonly Value[], known: readonly Value[] | undefined, protocol: WireProtocol): Promise<StatementResult | StatementResult[]> {
    this.#alive(session)
    const state = this.#state(session)
    let parsed: Statement | ReturnType<typeof parseStatementSequence> | null
    try {
      // Multi-statements still share the initial sql_mode: a recorded divergence.
      parsed = this.#parse(session, sql, protocol)
    } catch (e) {
      throw recordFailure(state, [], e)
    }
    if (parsed !== null && 'next' in parsed) {
      const results: StatementResult[] = []
      try {
        for (const { statement, more } of parsed) {
          // A checked final boundary proves this is a single streaming result.
          if (!more && results.length === 0) return this.#one(session, sql, statement, params, known, protocol)
          const result = await this.#one(session, sql, statement, params, known, protocol, false)
          Object.defineProperty(result, 'statusFlags', { value: session.statusFlags })
          results.push(result)
        }
      } catch (e) {
        // Iterator failures have no statement condition area. #one owns its failures.
        const error = e instanceof ParseError ? recordFailure(state, [], e) : toSqlError(e)
        throw Object.defineProperty(error, 'completed', { value: results })
      }
      return results
    }
    if (parsed === null) {
      recordDiagnostics(state, [], conditionLimit(state))
      return { affectedRows: 0 }
    }
    // Keep the single result streaming, including a multi-enabled connection.
    return this.#one(session, sql, parsed, params, known, protocol)
  }

  /**
   * One statement. With `stream`, a resultset larger than a batch is answered
   * as a `StreamedResultSet` (M5.40), and its end recorded when it comes.
   */
  async #one(session: Session, sql: string, statement: Statement, params: readonly Value[], known: readonly Value[] | undefined, protocol: WireProtocol, stream = true): Promise<StatementResult> {
    const began = performance.now()
    this.#alive(session)
    await this.#preload(session, statement)
    this.#alive(session)
    const state = this.#state(session)
    const limit = conditionLimit(state)
    state.question()
    // SHOW WARNINGS, SHOW ERRORS and their counts read the diagnostics area
    // and leave it; every other statement starts a new one (8.4.11).
    const diagnostic = isDiagnostic(statement)
    if (!diagnostic) state.previous = state.diagnostics
    const started = Date.now()
    let wait = 1
    for (let attempt = 0; ; attempt++) {
      const conditions = conditionsFor(statement, session.sqlMode)
      const settle = <R extends StatementResult>(result: R): R => {
        this.#purgeLater()
        if (diagnostic) return result
        // A count no condition stands for is still the count (`warning_count`).
        const warnings = recordDiagnostics(state, conditions, limit, result.warnings)
        return warnings === (result.warnings ?? 0) ? result : { ...result, warnings }
      }
      // The error is a condition too, after any the statement raised first.
      const failed = (e: unknown): SqlError => diagnostic ? toSqlError(e) : recordFailure(state, conditions, e, limit)
      try {
        this.#admitStatement(statement, state, session)
        if (protocol === 'text') binaryDeclarations(statement, conditions, limit)
        const run = this.#run(session, sql, params, known, protocol, conditions)
        const batches: ResultSet[] | undefined = stream ? [] : undefined
        const dispatched = this.#dispatch(run, statement, batches === undefined ? undefined : (batch) => batches.push(batch))
        if (!isSteps(dispatched)) return settle(dispatched)
        if (batches === undefined) return settle(await this.#drive(session, dispatched, began))
        return await this.#streamed(session, dispatched, batches, began, settle, failed)
      } catch (e) {
        const code = e instanceof MyjsError ? e.code : undefined
        if (code === 'ENGINE_WRITER_BUSY') {
          const timeout = Number(toInteger(state.systemVariable('innodb_lock_wait_timeout', undefined, session) ?? intValue(50n)))
          if (Date.now() - started >= timeout * 1000) throw sqlError('ER_LOCK_WAIT_TIMEOUT', messages.lockWaitTimeout())
          await sleep(wait)
          this.#alive(session)
          wait = Math.min(wait * 2, 50)
          continue
        }
        // A collation the preload could not see is loaded and the statement
        // run again — but only a statement that cannot have written, since a
        // memory table keeps whatever rows a failed statement wrote before it
        // failed, and running it again would write them twice.
        if (code === 'ER_COLLATION_NOT_LOADED' && attempt < 4 && !writes(statement)) {
          const id = /\((\d+)\)/.exec((e as Error).message)?.[1]
          if (id !== undefined) {
            await ensureCollationResident(Number(id))
            this.#alive(session)
            continue
          }
        }
        throw failed(e)
      }
    }
  }

  /** Statements running their steps now, so the database can wait for them before it closes. */
  readonly #running = new Set<Promise<unknown>>()

  /**
   * A statement's steps, run with a pause every `SLICE_MS` (D-77), so that
   * other connections are answered while a bulk statement runs. A pause falls
   * only between mini-transactions, with the writer slot held. A session
   * that ended during a pause gets ER_QUERY_INTERRUPTED thrown in at it, and
   * the statement rolls back as it would on any other error.
   */
  #drive<T>(session: Session, steps: Generator<void, T>, started = performance.now()): Promise<T> {
    return this.#tracked((async () => {
      let since = started
      for (;;) {
        const step = steps.next()
        if (step.done === true) return step.value
        if (performance.now() - since < SLICE_MS) continue
        await pause()
        this.#alive(session, steps)
        since = performance.now()
      }
    })())
  }

  /**
   * A statement's steps, driven as `#drive` drives them until a first batch
   * of rows is out (M5.40). A statement that ends first is answered whole,
   * as before; a larger resultset is answered as a stream, whose later
   * batches are read only as the dispatcher pulls them, so that what is held
   * is a batch, not the result. It pauses as `#drive` does, and a stream
   * abandoned (`return()`) or interrupted rolls its statement back. `settle`
   * and `failed` record its end in the diagnostics area when that comes.
   */
  async #streamed(
    session: Session,
    steps: Generator<void, StatementResult>,
    batches: ResultSet[],
    started: number,
    settle: <R extends StatementResult>(result: R) => R,
    failed: (e: unknown) => SqlError,
  ): Promise<StatementResult> {
    let since = started
    const step = async (): Promise<StatementResult | undefined> => {
      for (;;) {
        const next = steps.next()
        if (next.done === true) return next.value
        // Every pause hands out a batch, so the clock is read before it is.
        if (performance.now() - since >= SLICE_MS) {
          await pause()
          this.#alive(session, steps)
          since = performance.now()
        }
        if (batches.length > 0) return undefined
      }
    }
    // A failure after rows were read is answered after them, as a stream.
    let failure: unknown
    let first: StatementResult | undefined
    try {
      first = await this.#tracked(step())
    } catch (e) {
      if (batches.length === 0) throw e
      failure = e
    }
    if (first !== undefined) return settle(first)
    const columns = (batches[0] as ResultSet).columns
    let warnings = 0
    // The stream is running until it ends or is abandoned: `stop()` waits.
    let ended!: () => void
    void this.#tracked(new Promise<void>((resolve) => (ended = resolve)))
    async function* rest(): AsyncGenerator<readonly (readonly RowValue[])[]> {
      let done = failure !== undefined
      try {
        for (;;) {
          while (batches.length > 0) yield (batches.shift() as ResultSet).rows
          if (failure !== undefined) throw failure
          if (done) return
          let last: StatementResult | undefined
          try {
            last = await step()
          } catch (e) {
            // Its rows first: the loop sends what is held, then throws.
            failure = e
            done = true
            continue
          }
          if (last === undefined) continue
          done = true
          const result = settle(last as ResultSet)
          warnings = result.warnings ?? 0
          batches.push(result)
        }
      } catch (e) {
        throw failed(e)
      } finally {
        if (!done) steps.return(undefined as never)
        ended()
      }
    }
    const streamed: StreamedResultSet = {
      columns,
      batches: rest(),
      get warnings() {
        return warnings
      },
    }
    return streamed
  }

  /** `running`, counted among the statements `stop()` waits for. */
  #tracked<T>(running: Promise<T>): Promise<T> {
    this.#running.add(running)
    const done = (): void => void this.#running.delete(running)
    running.then(done, done)
    return running
  }

  #stopping = false
  #purging = false

  /**
   * What a commit left for purge (D-77: it purges at most a slice), purged a
   * slice a turn while no writer holds the slot. A purge that fails stops
   * here; the next commit's own purge meets the same fault, and reports it.
   */
  #purgeLater(): void {
    const store = this.catalog?.store
    if (store === undefined || this.#purging || this.#stopping || !store.purgeDue) return
    this.#purging = true
    void this.#tracked((async () => {
      try {
        while (!this.#stopping && store.purgeDue) {
          await pause()
          if (this.#stopping || !store.purgeDue) break
          store.purge(Infinity, PURGE_SLICE_RECORDS)
        }
      } catch {
        // Left for the next commit's purge to report.
      } finally {
        this.#purging = false
      }
    })())
  }

  /**
   * Start nothing new in the background, and resolve when nothing is
   * running: no statement between its steps, no purge. What `MySQL.end()`
   * waits for before it closes the store.
   */
  async stop(): Promise<void> {
    this.#stopping = true
    while (this.#running.size > 0) await Promise.allSettled([...this.#running])
  }

  #run(session: Session, sql: string, params: readonly Value[], known: readonly Value[] | undefined, protocol: WireProtocol, conditions: Condition[] = []): Run {
    const state = this.#state(session)
    const env: Env = { params, now: state.clock(), session, state, memo: new Map(), conditions }
    return { catalog: this.#catalogOf(session), state, env, sql, protocol, serverVersion: this.server.serverVersion, ...(known === undefined ? {} : { params: known }) }
  }

  #catalog(run: Run): CatalogApi {
    if (run.catalog === undefined) throw notSupported('This statement without a database')
    return run.catalog
  }

  /**
   * The synchronous core: one parsed statement, run — or, for a statement
   * that may run long (INSERT, UPDATE, DELETE), its steps, which `#drive`
   * runs with pauses between them (D-77).
   */
  #dispatch(run: Run, statement: Statement, emit?: (batch: ResultSet) => void): StatementResult | Generator<void, StatementResult> {
    const { state } = run
    const session = run.env.session
    if (writes(statement)) return this.#write(run, statement)
    switch (statement.kind) {
      case STATEMENT.QUERY: {
        const plan = planQuery(run, statement)
        if (this.catalog === undefined) return resultSet(run, plan, undefined)
        return state.steps(this.catalog.store, plan.locking, (trx) => resultSteps(run, plan, trx, emit))
      }
      case STATEMENT.CREATE_TABLE: {
        const catalog = this.#catalog(run)
        const schema = requireSchema(statement.table.schema ?? session.database)
        const temporary = statement.temporary === true ? catalog.temporary : undefined
        // CREATE TEMPORARY TABLE does not commit (8.4.11).
        if (temporary === undefined) state.commit()
        if (statement.like !== undefined) return this.#createLike(run, statement, schema)
        // … SELECT: the query is planned first, so its errors come before any table (8.4.11: 1052).
        const selected = statement.query === undefined ? undefined : selectColumns(run, planQuery(run, statement.query).columns, literalColumns(statement.query))
        const { query: _query, ...declared } = statement
        const node: CreateTableNode = selected === undefined ? statement : { ...declared, columns: mergedColumns(statement.columns, selected.columns) }
        let spec = createTableSpec(node, catalog.schema(schema).collationId ?? DEFAULT_COLLATION, modeOf(session.sqlMode))
        if (selected !== undefined) spec = withCollations(spec, selected.collations, statement.columns)
        spec = { ...spec, columns: stampGenerated(spec.columns, requireCollationInfo(session.characterSet).charset) }
        // CHECK constraints are resolved first, IF NOT EXISTS or not (8.4.11: 3820 over a table that exists).
        spec = withChecks(catalog, schema, spec, run.sql, checkClauses(statement), session.characterSet, modeOf(session.sqlMode))
        // A table that exists is 1050, or IF NOT EXISTS's note, whatever its keys would say; a
        // temporary one meets only the session's others.
        const exists = temporary !== undefined ? temporary.has(schema, spec.name) : catalog.tables(schema).some((t) => t.name === spec.name)
        if (temporary !== undefined && !exists) {
          if (statement.keys.some((k) => k.type === KEY.FOREIGN)) throw sqlError('ER_CANNOT_ADD_FOREIGN', 'Cannot add foreign key constraint')
          if (fulltextOf(spec).length > 0 && spec.engine !== 'memory') throw sqlError('ER_INNODB_NO_FT_TEMP_TABLE', 'Cannot create FULLTEXT index on temporary InnoDB table')
        }
        if (!exists) {
          spec = withForeignKeys(catalog, schema, spec, statement.keys.filter((k) => k.type === KEY.FOREIGN).map(foreignKeyClause), foreignKeyChecks(run))
          checkForeignKeyActions(spec, foreignKeysOf({ ...spec, schema, options: spec.options ?? {} } as TableDef))
        }
        if (run.protocol === 'text') for (const d of deprecationWarnings(statement)) raise(run.env, d.code, d.message)
        checkDefaults(run, spec.columns)
        if (temporary !== undefined) {
          if (exists && statement.ifNotExists !== true) throw tableExistsError(spec.name)
          if (!exists) {
            // Under autocommit = 0 the creation belongs to the transaction the session is in, begun here if nothing has begun it.
            if (!session.autocommit && state.trx === undefined) state.begin(catalog.store)
            temporary.create(schema, spec)
          }
        } else catalog.createTable(schema, spec, { ifNotExists: statement.ifNotExists === true })
        if (exists) {
          raise(run.env, 1050, `Table '${spec.name}' already exists`, 'Note')
          return { affectedRows: 0 }
        }
        // AUTO_INCREMENT = n starts the counter there (8.4.11: the first row is n).
        const counter = Object.entries(statement.options).find(([k]) => k.toUpperCase() === 'AUTO_INCREMENT')?.[1]
        if (counter !== undefined && /^\d+$/.test(counter)) catalog.table(schema, spec.name).raiseAutoIncrement(BigInt(counter))
        for (const key of duplicateKeys(spec.indexes ?? [], fulltextOf(spec))) raise(run.env, 1831, duplicateKeyText(key, schema, spec.name))
        if (statement.query === undefined || selected === undefined) return { affectedRows: 0 }
        // The rows are the INSERT … SELECT of them; a failure takes the table with it (8.4.11: 1062 leaves none).
        const fill: InsertNode = {
          kind: STATEMENT.INSERT,
          table: statement.table,
          columns: selected.columns.map((c) => ({ kind: NODE.COLUMN, parts: [c.name], at: statement.at })),
          query: statement.query,
          ...(statement.duplicates === 'IGNORE' ? { ignore: true } : {}),
          ...(statement.duplicates === 'REPLACE' ? { replace: true } : {}),
          at: statement.at,
        }
        // A table everyone sees is filled, though the session has a temporary one of its name (8.4.11).
        const base = this.catalog
        const target = temporary === undefined && catalog.temporary?.has(schema, spec.name) === true && base !== undefined
        const filling: Run = !target
          ? run
          : {
              ...run,
              catalog: {
                ...catalog,
                definition: (s, n) => (s === schema && n === spec.name ? base.definition(s, n) : catalog.definition(s, n)),
                table: (s, n) => (s === schema && n === spec.name ? base.table(s, n) : catalog.table(s, n)),
              },
            }
        try {
          return state.statement(catalog.store, true, (trx) => finish(insert(filling, fill, trx)))
        } catch (e) {
          if (temporary !== undefined) temporary.drop(schema, spec.name)
          else catalog.dropTable(schema, spec.name, { ifExists: true })
          throw e
        }
      }
      case STATEMENT.ALTER_TABLE:
        return alterTable(run, this.#catalog(run), statement)
      case STATEMENT.RENAME_TABLE:
        // DDL: the open transaction commits first (8.4.11).
        state.commit()
        return renameTables(this.#catalog(run), statement, session.database)
      case STATEMENT.CREATE_VIEW:
        state.commit()
        return this.#createView(run, statement)
      case STATEMENT.CREATE_DATABASE:
        // An implicit commit, as every DDL statement makes: without it the
        // session's own transaction holds the writer the catalog needs, and the
        // statement waits on itself (found by review).
        state.commit()
        return this.#createDatabase(run, statement)
      case STATEMENT.DROP:
        return this.#drop(run, statement)
      case STATEMENT.TRUNCATE: {
        // DDL: an implicit commit, then the table made again, empty and its
        // AUTO_INCREMENT from 1 (8.4.11; ER_NO_SUCH_TABLE for a missing one).
        const schema = requireSchema(statement.table.schema ?? session.database)
        state.commit()
        const checks = foreignKeyChecks(run)
        const catalog = this.#catalog(run)
        if (checks) {
          const by = referencingKeys(catalog, schema, statement.table.name).find((r) => r.child.schema !== schema || r.child.name !== statement.table.name)
          if (by !== undefined) throw sqlError('ER_TRUNCATE_ILLEGAL_FK', `Cannot truncate a table referenced in a foreign key constraint (\`${by.child.schema}\`.\`${by.child.name}\`, CONSTRAINT \`${by.fk.name}\`)`)
        }
        const before = catalog.definition(schema, statement.table.name).id
        const truncated = catalog.truncateTable(schema, statement.table.name)
        keepShown(catalog.store, before, truncated.id)
        // An emptied table's statistics are an empty table's, until it is analysed again (M5.45).
        if (truncated.options['stats'] !== undefined) {
          const { stats: _stats, ...options } = truncated.options
          catalog.setTableOptions(schema, statement.table.name, options)
        }
        return { affectedRows: 0 }
      }
      case STATEMENT.CREATE_ROUTINE:
      case STATEMENT.CREATE_TRIGGER:
      case STATEMENT.CREATE_EVENT:
      case STATEMENT.CALL:
        this.server.program(session, statement as ProgramStatement)
        return { affectedRows: 0 }

      case STATEMENT.SET:
        return this.#set(run, statement)
      case STATEMENT.SET_TRANSACTION: {
        if (statement.isolation !== undefined) {
          const level = isolationOf(statement.isolation)
          const name = statement.isolation.replace(' ', '-')
          if (statement.scope === 'GLOBAL' || statement.scope === 'PERSIST') this.server.vars.set('transaction_isolation', name)
          else if (statement.scope === 'SESSION') state.setIsolation(name)
          else {
            if (state.trx !== undefined) throw sqlError('ER_CANT_CHANGE_TX_CHARACTERISTICS', 'Transaction characteristics can\'t be changed while a transaction is in progress')
            state.nextIsolation = level
          }
        }
        return { affectedRows: 0 }
      }
      case STATEMENT.USE:
        if (this.catalog !== undefined && statement.database.toLowerCase() !== 'information_schema') run.catalog?.schema(statement.database)
        session.database = statement.database
        return { affectedRows: 0 }

      case STATEMENT.START_TRANSACTION:
        if (this.catalog !== undefined) state.begin(this.catalog.store, { readOnly: statement.access === 'READ ONLY', snapshot: statement.consistentSnapshot === true })
        return { affectedRows: 0 }
      case STATEMENT.COMMIT:
        state.commit()
        run.catalog?.temporary?.committed()
        if (statement.chain === true && this.catalog !== undefined) state.begin(this.catalog.store)
        return { affectedRows: 0 }
      case STATEMENT.ROLLBACK: {
        const rolledBack = state.trx
        if (statement.savepoint !== undefined) state.rollbackTo(statement.savepoint)
        else state.rollback()
        // What the rollback took of the session's temporary tables is put back, with a warning (8.4.11: 1751, 1752).
        const restored = run.catalog?.temporary?.reconcile(rolledBack)
        if (restored?.made === true) {
          raise(run.env, 1751, 'The creation of some temporary tables could not be rolled back.')
        }
        if (restored?.dropped === true) {
          raise(run.env, 1752, 'Some temporary tables were dropped, but these operations could not be rolled back.')
        }
        if (statement.savepoint === undefined && statement.chain === true && this.catalog !== undefined) state.begin(this.catalog.store)
        return { affectedRows: 0 }
      }
      case STATEMENT.SAVEPOINT:
        state.savepoint(statement.name)
        return { affectedRows: 0 }
      case STATEMENT.RELEASE_SAVEPOINT:
        state.release(statement.name)
        return { affectedRows: 0 }

      case STATEMENT.DO:
        for (const e of statement.exprs) compile(e, compileContext(run, EMPTY_SCOPE, 'field list')).eval([], run.env)
        return { affectedRows: 0 }
      case STATEMENT.SHOW:
        return this.#show(run, statement)
      case STATEMENT.DESCRIBE:
        // DESCRIBE t [column] is SHOW COLUMNS FROM t [LIKE 'column'].
        return this.#show(run, { kind: STATEMENT.SHOW, what: 'COLUMNS', name: statement.table, ...(statement.column === undefined ? {} : { like: statement.column }), at: statement.at })
      case STATEMENT.EXPLAIN:
        return this.#explain(run, statement)
      case STATEMENT.TABLE_MAINTENANCE:
        if (statement.op !== 'ANALYZE') throw notSupported(`${statement.op} TABLE`)
        return this.#analyze(run, statement.tables)

      default:
        throw notSupported(`This statement (${statement.kind})`)
    }
  }

  /** Row writers share one transaction and completed-counter boundary. */
  *#write(run: Run, statement: InsertNode | UpdateNode | DeleteNode): Generator<void, OkResult> {
    const result = yield* run.state.steps(this.#catalog(run).store, true, (trx) => {
      if (statement.kind === STATEMENT.INSERT) return insert(run, statement, trx)
      if (statement.kind === STATEMENT.UPDATE) return update(run, statement, trx)
      return remove(run, statement, trx)
    })
    run.state.rowCount = BigInt(result.affectedRows ?? 0)
    run.env.session.warnings = result.warnings ?? 0
    return result
  }

  #createDatabase(run: Run, statement: CreateDatabaseNode): StatementResult {
    const catalog = this.#catalog(run)
    const collationId = resolveOptionsCollation(statement.options, DEFAULT_COLLATION)
    // The data dictionary's own schema is refused by name (sql_db.cc), before anything else.
    if (statement.name === 'mysql' && statement.ifNotExists !== true) throw systemSchema(statement.name)
    const made = catalog.createSchema(statement.name, { ifNotExists: statement.ifNotExists === true, collationId })
    // One that exists is a note under IF NOT EXISTS, and still "1 row affected" (8.4.11).
    if (made === undefined) raise(run.env, 1007, `Can't create database '${statement.name}'; database exists`, 'Note')
    return { affectedRows: 1 }
  }

  /**
   * CREATE VIEW: the query planned now, in the session's database, so what
   * would fail at its first use fails here (8.4.11: 1146, 1054, 1353, 1060 —
   * before 1050 for a name taken), and stored as its text with the names its
   * columns got now. A variable or parameter is 1351, an INTO 1350.
   */
  /** CREATE TABLE … LIKE: the source's definition copied (`likeSpec`), temporary or not. */
  #createLike(run: Run, statement: CreateTableNode, schema: string): StatementResult {
    const catalog = this.#catalog(run)
    const { state } = run
    const session = run.env.session
    const like = statement.like as TableName
    const source = catalog.definition(like.schema ?? session.database ?? schema, like.name)
    const temporary = statement.temporary === true ? catalog.temporary : undefined
    const name = statement.table.name
    const exists = temporary !== undefined ? temporary.has(schema, name) : catalog.tables(schema).some((t) => t.name === name)
    if (exists) {
      if (statement.ifNotExists !== true) throw tableExistsError(name)
      raise(run.env, 1050, `Table '${name}' already exists`, 'Note')
      return { affectedRows: 0 }
    }
    const spec = likeSpec(source, name)
    if (temporary !== undefined) {
      if (fulltextOf(spec).length > 0 && spec.engine !== 'memory') throw sqlError('ER_INNODB_NO_FT_TEMP_TABLE', 'Cannot create FULLTEXT index on temporary InnoDB table')
      if (!session.autocommit && state.trx === undefined) state.begin(catalog.store)
      temporary.create(schema, spec)
    } else catalog.createTable(schema, spec)
    return { affectedRows: 0 }
  }

  #createView(run: Run, statement: CreateViewNode): StatementResult {
    const session = run.env.session
    const schema = requireSchema(statement.view.schema ?? session.database)
    const catalog = this.#catalog(run)
    catalog.schema(schema)
    // A view may not read a temporary table (8.4.11: 1352).
    someNode(statement.query, (node) => {
      const ref = node as TableReference
      if (ref.kind === REF.TABLE) {
        const schema = ref.table.schema ?? session.database
        if (schema !== null && catalog.temporary?.has(schema, ref.table.name) === true) throw sqlError('ER_VIEW_SELECT_TMPTABLE', `View's SELECT refers to a temporary table '${ref.table.name}'`)
      }
      return undefined
    })
    const def: ViewDef = {
      schema,
      name: statement.view.name,
      query: viewText(run, statement),
      ...(session.database === null ? {} : { database: session.database }),
      definer: `${session.user}@%`,
      collationConnection: session.characterSet,
      ...(statement.columns === undefined ? {} : { columns: statement.columns, listed: true as const }),
      ...(statement.algorithm === undefined ? {} : { algorithm: statement.algorithm }),
      ...(statement.checkOption === undefined ? {} : { checkOption: statement.checkOption }),
      ...(statement.security === undefined ? {} : { security: statement.security }),
    }
    const planned = viewTable(run, { schema, name: def.name }, def.name, def)
    const columns = planned?.source.columns.map((c) => c.name) ?? def.columns
    catalog.createView({ ...def, ...(columns === undefined ? {} : { columns }) }, { orReplace: statement.orReplace === true })
    return { affectedRows: 0 }
  }

  #drop(run: Run, statement: DropNode): StatementResult {
    const session = run.env.session
    if (PROGRAM_OBJECTS.has(statement.object)) {
      this.server.program(session, statement)
      return { affectedRows: 0 }
    }
    const catalog = this.#catalog(run)
    if (statement.object === 'DATABASE') {
      const name = (statement.names[0] as TableName).name
      if (name === 'mysql') throw systemSchema(name)
      // A table another schema's key references holds the whole schema (8.4.11: 3730).
      if (foreignKeyChecks(run) && catalog.schemas().some((s) => s.name === name)) {
        for (const t of catalog.tables(name)) {
          const by = referencingKeys(catalog, name, t.name).find((r) => r.child.schema !== name)
          if (by !== undefined) throw sqlError('ER_FK_CANNOT_DROP_PARENT', `Cannot drop table '${t.name}' referenced by a foreign key constraint '${by.fk.name}' on table '${by.child.name}'.`)
        }
      }
      run.state.commit()
      if (!catalog.schemas().some((s) => s.name === name) && statement.ifExists === true) {
        raise(run.env, 1008, `Can't drop database '${name}'; database doesn't exist`, 'Note')
        return { affectedRows: 0 }
      }
      const tables = catalog.dropSchema(name, { ifExists: statement.ifExists === true })
      if (session.database === name) session.database = null
      return { affectedRows: tables.length }
    }
    if (statement.object === 'VIEW') {
      const schemas = new Set(statement.names.map((n) => n.schema ?? session.database))
      if (schemas.has(null)) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
      run.state.commit()
      // One schema at a time, as the names are given; MySQL checks every name
      // first, and so does each call.
      for (const schema of schemas as Set<string>) {
        const names = statement.names.filter((n) => (n.schema ?? session.database) === schema).map((n) => n.name)
        const missing = catalog.dropViews(schema, names, { ifExists: statement.ifExists === true })
        for (const name of missing) raise(run.env, 1051, `Unknown table '${schema}.${name}'`, 'Note')
      }
      return { affectedRows: 0 }
    }
    // `DROP INDEX i ON t` is `ALTER TABLE t DROP INDEX i`, as MySQL runs it.
    if (statement.object === 'INDEX' && statement.on !== undefined) {
      const name = (statement.names[0] as TableName).name
      return alterTable(run, catalog, { kind: STATEMENT.ALTER_TABLE, table: statement.on, actions: [{ type: 'drop', what: 'INDEX', name }], options: {}, at: statement.at })
    }
    if (statement.object !== 'TABLE') throw notSupported(`DROP ${statement.object}`)
    const names = statement.names.map((n) => {
      const schema = requireSchema(n.schema ?? session.database)
      return { schema, name: n.name }
    })
    // DROP TEMPORARY TABLE drops the session's own and nothing else, and does not commit (8.4.11).
    const temporary = catalog.temporary
    if (statement.temporary === true) {
      const missing = names.filter((n) => temporary?.has(n.schema, n.name) !== true)
      if (missing.length > 0 && statement.ifExists !== true) throw unknownTableError(missing.map((m) => `${m.schema}.${m.name}`).join(','))
      for (const n of names) temporary?.drop(n.schema, n.name)
      for (const m of missing) raise(run.env, 1051, `Unknown table '${m.schema}.${m.name}'`, 'Note')
      return { affectedRows: 0 }
    }
    const held = (n: { schema: string; name: string }) => temporary?.has(n.schema, n.name) === true || catalog.tables().some((t) => t.schema === n.schema && t.name === n.name)
    // All or nothing, as 8.0's atomic DDL is: every missing table is named,
    // and nothing is dropped.
    if (statement.ifExists !== true) {
      const missing = names.filter((n) => !held(n))
      if (missing.length > 0) throw unknownTableError(missing.map((m) => `${m.schema}.${m.name}`).join(','))
    }
    // A parent goes only with its children, or with the checks off (8.4.11: 3730).
    if (foreignKeyChecks(run)) {
      const dropping = (schema: string, name: string) => names.some((n) => n.schema === schema && n.name === name)
      for (const n of names) {
        if (temporary?.has(n.schema, n.name) === true) continue
        const by = referencingKeys(catalog, n.schema, n.name).find((r) => !dropping(r.child.schema, r.child.name))
        if (by !== undefined) throw sqlError('ER_FK_CANNOT_DROP_PARENT', `Cannot drop table '${n.name}' referenced by a foreign key constraint '${by.fk.name}' on table '${by.child.name}'.`)
      }
    }
    run.state.commit()
    for (const n of names) {
      if (catalog.dropTable(n.schema, n.name, { ifExists: true })) continue
      raise(run.env, 1051, `Unknown table '${n.schema}.${n.name}'`, 'Note')
    }
    // IF EXISTS notes each name it did not find, a view's included (8.4.11: 1051).
    return { affectedRows: 0 }
  }

  #set(run: Run, statement: SetNode): StatementResult {
    const { state } = run
    const session = run.env.session
    const evaluate = (e: Expression): Value => compile(e, compileContext(run, EMPTY_SCOPE, 'field list')).eval([], run.env)
    const wasAutocommit = session.autocommit
    for (const item of statement.items) {
      if (item.type === 'user') {
        state.userVariables.set(item.name.toLowerCase(), plainValue(evaluate(item.value)))
        continue
      }
      const changed = this.server.set(session, item, evaluate, state.ownVariables, (code, message) => {
        raise(run.env, code, message)
      })
      if (changed === 'sql_mode') state.sqlModeAssigned = true
      // `transaction_isolation` is what SET SESSION TRANSACTION sets too: one
      // setting, so the variable reaches the transactions (found by review).
      const sessionScoped = item.type === 'name' || (item.type === 'system' && (item.scope === undefined || item.scope === 'SESSION'))
      if (sessionScoped && /^(transaction_isolation|tx_isolation)$/i.test(item.name)) {
        const name = item.name.toLowerCase()
        const v = state.ownVariables.get(name)
        state.ownVariables.delete(name)
        if (v !== undefined && v !== null) state.setIsolation(toText(v))
      }
    }
    // `SET autocommit = 1` commits whatever the session had open.
    if (!wasAutocommit && session.autocommit) state.commit()
    return { affectedRows: 0 }
  }

  /**
   * `ANALYZE TABLE`: there are no index statistics to refresh, since nothing
   * here costs a plan by them yet (M5.7), so it reports what MySQL reports —
   * `status OK` per table, or the error and `Operation failed` for one that
   * does not exist (8.4.11) — and changes nothing.
   */
  /**
   * EXPLAIN FORMAT=TREE of a query (M5.44): the plan it would run, as one
   * VAR_STRING row (8.4.11: `EXPLAIN`, 78 characters, NOT NULL). Other
   * formats, ANALYZE, and the plan of a write are refused by name.
   */
  #explain(run: Run, statement: ExplainNode): StatementResult {
    const target = statement.statement
    if (statement.format !== 'TREE' || statement.analyze === true || statement.into !== undefined || statement.schema !== undefined || target === undefined || target.kind !== STATEMENT.QUERY) {
      throw notSupported(statement.format === 'TREE' ? 'EXPLAIN of this statement' : `EXPLAIN FORMAT=${statement.format ?? 'TRADITIONAL'}`)
    }
    const roots = planQuery(run, target).explain?.()
    if (roots === undefined) throw notSupported('EXPLAIN of this query')
    const coll = run.env.session.characterSet
    return { columns: [columnDefinition('EXPLAIN', stringType(78, coll, false), coll)], rows: [[run.env.session.transcoder.encode(renderTree(roots), coll)]] }
  }

  #analyze(run: Run, tables: readonly TableName[]): StatementResult {
    const coll = run.env.session.characterSet
    // Nullable, as 8.4.11 reports them.
    const text = (name: string, chars: number, field?: number): ColumnDefinition => columnDefinition(name, { ...stringType(chars, coll, true), ...(field === undefined ? {} : { field }) }, coll)
    const encode = (s: string) => run.env.session.transcoder.encode(s, coll)
    const rows: Uint8Array[][] = []
    for (const t of tables) {
      const schema = requireSchema(t.schema ?? run.env.session.database)
      const name = `${schema}.${t.name}`
      const catalog = this.catalog
      if (catalog?.tables().some((x) => x.schema === schema && x.name === t.name) === true) {
        // ANALYZE commits, as DDL does, and keeps what it counted in the table's definition (M5.45).
        run.state.commit()
        const def = catalog.definition(schema, t.name)
        catalog.setTableOptions(schema, t.name, { ...def.options, stats: analyze(def, catalog.table(schema, t.name)) })
        rows.push([encode(name), encode('analyze'), encode('status'), encode('OK')])
      }
      else {
        rows.push([encode(name), encode('analyze'), encode('Error'), encode(`Table '${name}' doesn't exist`)])
        rows.push([encode(name), encode('analyze'), encode('status'), encode('Operation failed')])
      }
    }
    return { columns: [text('Table', 128), text('Op', 10), text('Msg_type', 10), text('Msg_text', 393216, FIELD_TYPE.MEDIUM_BLOB)], rows }
  }

  #show(run: Run, statement: ShowNode): StatementResult {
    const coll = run.env.session.characterSet
    const text = (name: string, chars: number): ColumnDefinition => columnDefinition(name, stringType(chars, coll, false), coll)
    const encode = (s: string) => run.env.session.transcoder.encode(s, coll)
    switch (statement.what) {
      case 'WARNINGS':
      case 'ERRORS': {
        // The last statement's conditions — SHOW ERRORS only its errors — or
        // how many, under COUNT(*), as `@@session.warning_count` (8.4.11).
        const d = run.state.diagnostics
        if (statement.count === true) {
          const name = `@@session.${statement.what === 'WARNINGS' ? 'warning' : 'error'}_count`
          const n = statement.what === 'WARNINGS' ? d.warnings : d.errors
          return { columns: [columnDefinition(name, intType(21, true, true), coll)], rows: [[encode(String(n))]] }
        }
        let listed = statement.what === 'WARNINGS' ? d.conditions : d.conditions.filter((c) => c.level === 'Error')
        if (statement.limit !== undefined) {
          const value = (x: Expression | undefined) => (x === undefined ? 0 : Number(toInteger(compile(x, compileContext(run, EMPTY_SCOPE, 'limit')).eval([], run.env) ?? intValue(0n))))
          const offset = value(statement.limit.offset)
          listed = listed.slice(offset, offset + value(statement.limit.count))
        }
        const code = { ...intType(5, false, true), field: FIELD_TYPE.LONG }
        return {
          columns: [text('Level', 7), columnDefinition('Code', code, coll), text('Message', 512)],
          rows: listed.map((c) => [encode(c.level), encode(String(c.code)), encode(c.message)]),
        }
      }
      case 'DATABASES': {
        const names = ['information_schema', ...(run.catalog?.schemas().map((s) => s.name) ?? [])].sort()
        return { columns: [text('Database', 64)], rows: names.filter((n) => statement.like === undefined || likeText(n, statement.like)).map((n) => [encode(n)]) }
      }
      case 'CREATE TABLE': {
        const name = statement.name as TableName
        const schema = requireSchema(name.schema ?? run.env.session.database)
        const catalog = this.#catalog(run)
        // A view's SHOW CREATE TABLE is its SHOW CREATE VIEW (8.4.11).
        if (catalog.temporary?.has(schema, name.name) !== true && catalog.view(schema, name.name) !== undefined) return this.#show(run, { ...statement, what: 'CREATE VIEW' })
        const def = catalog.definition(schema, name.name)
        const created = showCreateTable(run, def, catalog.table(schema, name.name))
        return { columns: [text('Table', 64), text('Create Table', 1024)], rows: [[encode(def.name), encode(created)]] }
      }
      case 'CREATE VIEW': {
        const name = statement.name as TableName
        const schema = requireSchema(name.schema ?? run.env.session.database)
        const catalog = this.#catalog(run)
        const view = catalog.view(schema, name.name)
        if (view === undefined) {
          // A table is 1347; nothing at all, 1146 (8.4.11).
          catalog.definition(schema, name.name)
          throw sqlError('ER_WRONG_OBJECT', `'${schema}.${name.name}' is not VIEW`)
        }
        const collation = view.collationConnection ?? DEFAULT_COLLATION
        return {
          columns: [text('View', 64), text('Create View', 1024), text('character_set_client', 32), text('collation_connection', 32)],
          rows: [[encode(view.name), encode(showCreateView(run, catalog, view)), encode(requireCollationInfo(collation).charset), encode(requireCollationInfo(collation).name)]],
        }
      }
      case 'TABLES': {
        const schema = requireSchema(statement.database ?? run.env.session.database)
        // Views beside tables, and under FULL, which is which (8.4.11).
        const catalog = this.#catalog(run)
        const tables = [...catalog.tables(schema).map((t) => [t.name, 'BASE TABLE']), ...catalog.views(schema).map((v) => [v.name, 'VIEW'])].sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1))
        const label = `Tables_in_${schema}${statement.like === undefined ? '' : ` (${statement.like})`}`
        const shown = tables.filter(([n]) => statement.like === undefined || likeText(n as string, statement.like))
        if (statement.full === true) return { columns: [text(label, 64), text('Table_type', 11)], rows: shown.map(([n, kind]) => [encode(n as string), encode(kind as string)]) }
        return { columns: [text(label, 64)], rows: shown.map(([n]) => [encode(n as string)]) }
      }
      case 'TABLE STATUS': {
        // A query over INFORMATION_SCHEMA.TABLES, as the server runs it (show.ts).
        const plan = planQuery(run, tableStatusQuery(run, this.#catalog(run), statement))
        return run.state.statement(this.#catalog(run).store, false, (trx) => resultSet(run, plan, trx))
      }
      case 'ENGINES': {
        // A query over INFORMATION_SCHEMA.ENGINES, its columns renamed (8.4.11).
        const plan = planQuery(run, parseStatement('SELECT ENGINE AS Engine, SUPPORT AS Support, COMMENT AS Comment, TRANSACTIONS AS Transactions, XA, SAVEPOINTS AS Savepoints FROM information_schema.ENGINES') as QueryExpression)
        return resultSet(run, plan, undefined)
      }
      case 'VARIABLES':
      case 'STATUS': {
        // A query over PERFORMANCE_SCHEMA, as the server runs it (show.ts).
        const { query, table } = variablesQuery(statement)
        const plan = planQuery(run, query)
        const result = this.catalog === undefined ? resultSet(run, plan, undefined) : run.state.statement(this.catalog.store, false, (trx) => resultSet(run, plan, trx))
        return { ...result, columns: variablesColumns(table, coll, requireCollationInfo(coll).mbmaxlen) }
      }
      case 'COLUMNS':
      case 'INDEX': {
        // A query over INFORMATION_SCHEMA, as the server runs it (show.ts).
        const plan = planQuery(run, showQuery(run, this.#catalog(run), statement))
        const result = run.state.statement(this.#catalog(run).store, false, (trx) => resultSet(run, plan, trx))
        return { ...result, columns: shownColumns(statement, plan.columns.map((c) => c.name), coll, requireCollationInfo(coll).mbmaxlen) }
      }
      default:
        throw notSupported(`SHOW ${statement.what}`)
    }
  }
}

/**
 * `SHOW … LIKE 'pattern'`, case-insensitive as `SHOW` matches names. A
 * backslash makes the next character literal, so `'user\\_roles'` — what
 * mysqldump sends — matches `user_roles` and not `userXroles`.
 */
function likeText(name: string, pattern: string): boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '\\' && i + 1 < pattern.length) re += (pattern[++i] as string).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    else if (c === '%') re += '.*'
    else if (c === '_') re += '.'
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'is').test(name)
}

/**
 * A view's query as written: from its first token to the end of the
 * statement, less a trailing `WITH … CHECK OPTION`. The text, not a deparse,
 * since an unaliased column is named by its text (`c*2`).
 */
function viewText(run: Run, statement: CreateViewNode): string {
  const tokens = lex(run.sql, { sqlMode: modeOf(run.env.session.sqlMode) })
  const first = tokens.findIndex((t) => t.start === statement.query.at)
  let last = tokens.findIndex((t, i) => i >= first && (t.kind === TOKEN.EOF || (t.kind === TOKEN.OPERATOR && t.text === ';'))) - 1
  if (statement.checkOption !== undefined) {
    while (last > first && (tokens[last] as Token).text.toUpperCase() !== 'WITH') last--
    last--
  }
  return run.sql.slice((tokens[first] as Token).start, (tokens[last] as Token).end)
}
