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
import { FIELD_TYPE, MyjsError } from '@myjs/bytes'
import { collationInfoByName, defaultCollationOf } from '@myjs/charsets'
import { collationsOf, type Catalog, type TableDef, type ViewDef } from '@myjs/engine'
import {
  NODE,
  ParseError,
  QUERY,
  REF,
  parseStatements,
  KEY,
  STATEMENT,
  TOKEN,
  lex,
  parseSqlMode,
  parseStatement,
  type CreateDatabaseNode,
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
  SqlError,
  messages,
  sqlError,
  type ColumnDefinition,
  type Executor,
  type OkResult,
  type Parameter,
  type PreparedInfo,
  type Session,
  type StatementResult,
} from '@myjs/protocol'
import { COERCIBILITY, doubleValue, intValue, parseDecimal, stringValue, toInteger, toText, type Value } from '@myjs/types'
import { charsetChange, ensureCollationResident } from '../transcoder.ts'
import { PROGRAM_OBJECTS, ServerState, type ProgramStatement, type ServerOptions } from './admin.ts'
import { compile, EMPTY_SCOPE, type Env } from './compile.ts'
import { alterTable } from './alter.ts'
import { checkClauses, withChecks } from './checks.ts'
import { showCreateTable } from './show-create.ts'
import { DEFAULT_COLLATION, createTableSpec, deprecationWarnings, resolveCollation } from './ddl.ts'
import { foreignKeyChecks, foreignKeyClause, referencingKeys, withForeignKeys } from './foreign-keys.ts'
import { checkDefaults, insert, remove, update } from './dml.ts'
import { columnDefinition, stringType } from './meta.ts'
import { columnsOf, compileContext, planQuery, resultSet, viewTable, type Run } from './query.ts'
import { SqlSession, isolationOf } from './session.ts'
import type { WireProtocol } from './wire.ts'

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
    return { kind: 'datetime', v: { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate(), hour: v.getUTCHours(), minute: v.getUTCMinutes(), second: v.getUTCSeconds(), microsecond: v.getUTCMilliseconds() * 1000 }, type: 'DATETIME', fsp: 6 }
  }
  if ('negative' in v) return { kind: 'time', v, fsp: v.microsecond === 0 ? 0 : 6 }
  const date = v.hour === 0 && v.minute === 0 && v.second === 0 && v.microsecond === 0 && p.type === FIELD_TYPE.DATE
  return { kind: 'datetime', v, type: date ? 'DATE' : 'DATETIME', fsp: v.microsecond === 0 ? 0 : 6 }
}

/** Every error a statement can raise, as the `SqlError` a client is sent: typed errors keep their number. */
const systemSchema = (name: string) => sqlError('ER_NO_SYSTEM_SCHEMA_ACCESS', `Access to system schema '${name}' is rejected.`)

/**
 * A text with no statement in it: `empty` when it is nothing but whitespace
 * and semicolons, `comment` when a comment is there too; `undefined` when
 * there is a statement.
 */
function emptyText(session: Session, sql: string): 'empty' | 'comment' | undefined {
  if (/^[\s;]*$/.test(sql)) return 'empty'
  let tokens
  try {
    tokens = lex(sql, { sqlMode: parseSqlMode(session.sqlMode) })
  } catch {
    return undefined
  }
  return tokens.every((t) => t.kind === TOKEN.EOF || (t.kind === TOKEN.OPERATOR && t.text === ';')) ? 'comment' : undefined
}

export function toSqlError(e: unknown): SqlError {
  if (e instanceof SqlError) return e
  if (e instanceof MyjsError && e.errno !== undefined) return new SqlError(e.code, e.message, { errno: e.errno, ...(e.sqlState === undefined ? {} : { sqlState: e.sqlState }) })
  // A fault that is not the client's: reported, never a crash of the connection (ground rule 5).
  const message = e instanceof Error ? e.message : String(e)
  return new SqlError('ER_INTERNAL_ERROR', `Internal error: ${message}`, { errno: 1815, sqlState: 'HY000' })
}

const codeOf = (e: unknown): string | undefined => (e instanceof MyjsError ? e.code : undefined)

/** Whether a statement can change rows: the ones that may not simply be run again after failing part-way. */
const writes = (statement: Statement): boolean =>
  statement.kind === STATEMENT.INSERT || statement.kind === STATEMENT.UPDATE || statement.kind === STATEMENT.DELETE

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The tables a statement reads or writes, for loading their collations before it runs. */
function tablesOf(statement: Statement): TableName[] {
  const out: TableName[] = []
  const refs = (r: readonly TableReference[] | undefined): void => {
    for (const t of r ?? []) {
      if (t.kind === REF.TABLE) out.push(t.table)
      else if (t.kind === REF.JOIN) refs([t.left, t.right])
      else if (t.kind === REF.LIST) refs(t.items)
    }
  }
  switch (statement.kind) {
    case STATEMENT.QUERY:
      if (statement.body.kind === 'select') refs(statement.body.from)
      break
    case STATEMENT.INSERT:
      out.push(statement.table)
      break
    case STATEMENT.UPDATE:
    case STATEMENT.DELETE:
      refs(statement.tables)
      break
    default:
      break
  }
  return out
}

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

  constructor(options: SqlExecutorOptions = {}) {
    this.catalog = options.catalog
    this.server = new ServerState(options)
  }

  #state(session: Session): SqlSession {
    let s = this.#sessions.get(session)
    if (s === undefined) {
      s = new SqlSession(session, this.server)
      this.#sessions.set(session, s)
    }
    return s
  }

  async query(session: Session, sql: string): Promise<StatementResult | StatementResult[]> {
    return this.#statement(session, sql, [], undefined, 'text')
  }

  async execute(session: Session, sql: string, parameters: readonly Parameter[]): Promise<StatementResult | StatementResult[]> {
    const params = parameters.filter((p) => p.name === '').map((p) => parameterValue(p, session))
    return this.#statement(session, sql, params, params, 'binary')
  }

  async prepare(session: Session, sql: string): Promise<PreparedInfo> {
    let paramCount = 0
    try {
      paramCount = lex(sql, { sqlMode: parseSqlMode(session.sqlMode) }).filter((t) => t.kind === TOKEN.PLACEHOLDER).length
    } catch (e) {
      throw toSqlError(e)
    }
    // COM_STMT_PREPARE_OK counts them in two bytes (`sql_prepare.cc`: 1390).
    if (paramCount > 0xffff) throw sqlError('ER_PS_MANY_PARAM', 'Prepared statement contains too many placeholders')
    // The empty statement a comment makes is not one the protocol prepares.
    if (emptyText(session, sql) === 'comment') throw sqlError('ER_UNSUPPORTED_PS', 'This command is not supported in the prepared statement protocol yet')
    const statement = this.#parse(session, sql)
    if (statement === null) return { paramCount, columns: [] }
    await this.#preload(session, statement)
    if (statement.kind !== STATEMENT.QUERY) return { paramCount, columns: [] }
    try {
      const run = { ...this.#run(session, sql, [], undefined, 'binary'), preparing: true }
      return { paramCount, columns: columnsOf(run, planQuery(run, statement)) }
    } catch (e) {
      throw toSqlError(e)
    }
  }

  async initDb(session: Session, database: string): Promise<void> {
    if (this.catalog !== undefined && database.toLowerCase() !== 'information_schema') {
      try {
        this.catalog.schema(database)
      } catch (e) {
        throw toSqlError(e)
      }
    }
    // The system schema is named in lower case, however the client wrote it (8.4.11).
    session.database = database.toLowerCase() === 'information_schema' ? 'information_schema' : database
  }

  statistics(session: Session): string {
    return (
      `Uptime: 0  Threads: 1  Questions: 0  Slow queries: 0  Opens: 0  ` +
      `Flush tables: 1  Open tables: 0  Queries per second avg: 0.000  ` +
      `Connection: ${session.connectionId}`
    )
  }

  reset(session: Session): void {
    this.#sessions.get(session)?.rollback()
    this.#sessions.delete(session)
  }

  end(session: Session): void {
    this.#ended.add(session)
    this.reset(session)
  }

  /** ER_QUERY_INTERRUPTED, for a statement whose connection ended while it waited. */
  #alive(session: Session): void {
    if (this.#ended.has(session)) throw sqlError('ER_QUERY_INTERRUPTED', 'Query execution was interrupted')
  }

  /** Parse, or `null` for a statement that is answered OK without being run. */
  #parse(session: Session, sql: string): Statement | null {
    const empty = emptyText(session, sql)
    // The grammar's END_OF_INPUT: ER_EMPTY_QUERY, unless the text held a comment.
    if (empty === 'empty') throw sqlError('ER_EMPTY_QUERY', 'Query was empty')
    if (empty === 'comment') return null
    try {
      return parseStatement(sql, { sqlMode: parseSqlMode(session.sqlMode) })
    } catch (e) {
      if (e instanceof ParseError && e.code === 'ER_NOT_SUPPORTED_YET') {
        // A `SET` the parser names as not implemented (`SET RESOURCE GROUP`)
        // is answered OK, as it was before M3.6: a driver's connect sequence
        // must not fail on one. `FLUSH`, `SET PASSWORD` and `SET ROLE` parse
        // since M3.17 and are answered in `#dispatch`.
        if (/^\s*SET\b/i.test(sql)) return null
      }
      throw toSqlError(e)
    }
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
    if (catalog !== undefined) {
      for (const name of tablesOf(statement)) {
        const schema = name.schema ?? session.database
        if (schema === null) continue
        let def: TableDef
        try {
          def = catalog.definition(schema, name.name)
        } catch {
          continue
        }
        for (const id of collationsOf(def)) ids.add(id)
      }
      if (statement.kind === STATEMENT.CREATE_TABLE) {
        try {
          const schema = statement.table.schema ?? session.database
          const fallback = schema === null ? DEFAULT_COLLATION : (catalog.schema(schema).collationId ?? DEFAULT_COLLATION)
          ids.add(fallback)
          const spec = createTableSpec(statement, fallback)
          for (const c of spec.columns) if (c.type.collationId !== undefined) ids.add(c.type.collationId)
        } catch {
          // The statement itself will say what is wrong.
        }
      }
    }
    // Every collation the statement names itself — `COLLATE x`, `_latin1'…'`,
    // `CAST(… AS CHAR CHARACTER SET x)` — found by walking the tree for the
    // fields that carry one.
    const walk = (node: unknown, depth: number): void => {
      if (depth > 1200 || node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const n of node) walk(n, depth + 1)
        return
      }
      const o = node as Record<string, unknown>
      if (typeof o['collation'] === 'string') {
        const info = collationInfoByName((o['collation'] as string).toLowerCase())
        if (info !== undefined) ids.add(info.id)
      }
      if (typeof o['charset'] === 'string') {
        const info = defaultCollationOf((o['charset'] as string).toLowerCase())
        if (info !== undefined) ids.add(info.id)
      }
      for (const v of Object.values(o)) if (typeof v === 'object') walk(v, depth + 1)
    }
    walk(statement, 0)
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
    if (session.multipleStatementsEnabled && protocol === 'text' && !/^[\s;]*$/.test(sql)) {
      let statements: Statement[]
      try {
        statements = parseStatements(sql, { sqlMode: parseSqlMode(session.sqlMode) })
      } catch (e) {
        throw toSqlError(e)
      }
      if (statements.length > 1) {
        const results: StatementResult[] = []
        // All are parsed under the mode in force when the text arrives; MySQL
        // parses each as it reaches it, so a `SET sql_mode` inside the text
        // governs the rest there and not here — a recorded divergence.
        for (const statement of statements) results.push(await this.#one(session, sql, statement, params, known, protocol))
        return results
      }
    }
    const statement = this.#parse(session, sql)
    if (statement === null) return { affectedRows: 0 }
    return this.#one(session, sql, statement, params, known, protocol)
  }

  async #one(session: Session, sql: string, statement: Statement, params: readonly Value[], known: readonly Value[] | undefined, protocol: WireProtocol): Promise<StatementResult> {
    this.#alive(session)
    await this.#preload(session, statement)
    this.#alive(session)
    const state = this.#state(session)
    const started = Date.now()
    let wait = 1
    for (let attempt = 0; ; attempt++) {
      try {
        const run = this.#run(session, sql, params, known, protocol)
        return this.#dispatch(run, statement)
      } catch (e) {
        const code = codeOf(e)
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
        throw toSqlError(e)
      }
    }
  }

  #run(session: Session, sql: string, params: readonly Value[], known: readonly Value[] | undefined, protocol: WireProtocol): Run {
    const state = this.#state(session)
    const env: Env = { params, now: new Date(), session, state, memo: new Map() }
    return { catalog: this.catalog, state, env, sql, protocol, serverVersion: this.server.serverVersion, ...(known === undefined ? {} : { params: known }) }
  }

  #catalog(): Catalog {
    if (this.catalog === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('This statement without a database'))
    return this.catalog
  }

  /** The synchronous core: one parsed statement, run. */
  #dispatch(run: Run, statement: Statement): StatementResult {
    const { state } = run
    const session = run.env.session
    switch (statement.kind) {
      case STATEMENT.QUERY: {
        const plan = planQuery(run, statement)
        if (this.catalog === undefined) return resultSet(run, plan, undefined)
        return state.statement(this.catalog.store, plan.locking, (trx) => resultSet(run, plan, trx))
      }
      case STATEMENT.INSERT:
        return this.#counted(run, state.statement(this.#catalog().store, true, (trx) => insert(run, statement, trx)))
      case STATEMENT.UPDATE:
        return this.#counted(run, state.statement(this.#catalog().store, true, (trx) => update(run, statement, trx)))
      case STATEMENT.DELETE:
        return this.#counted(run, state.statement(this.#catalog().store, true, (trx) => remove(run, statement, trx)))

      case STATEMENT.CREATE_TABLE: {
        const catalog = this.#catalog()
        const schema = statement.table.schema ?? session.database
        if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
        state.commit()
        let spec = createTableSpec(statement, catalog.schema(schema).collationId ?? DEFAULT_COLLATION)
        // CHECK constraints are resolved first, IF NOT EXISTS or not (8.4.11: 3820 over a table that exists).
        spec = withChecks(catalog, schema, spec, run.sql, checkClauses(statement), session.characterSet)
        // A table that exists is 1050, or IF NOT EXISTS's note, whatever its keys would say.
        if (!catalog.tables(schema).some((t) => t.name === spec.name)) {
          spec = withForeignKeys(catalog, schema, spec, statement.keys.filter((k) => k.type === KEY.FOREIGN).map(foreignKeyClause), foreignKeyChecks(run))
        }
        const notes = checkDefaults(run, spec.columns)
        catalog.createTable(schema, spec, { ifNotExists: statement.ifNotExists === true })
        const warnings = deprecationWarnings(statement) + notes
        return { affectedRows: 0, ...(warnings > 0 ? { warnings } : {}) }
      }
      case STATEMENT.ALTER_TABLE:
        return alterTable(run, this.#catalog(), statement)
      case STATEMENT.CREATE_VIEW:
        state.commit()
        return this.#createView(run, statement)
      case STATEMENT.CREATE_DATABASE:
        // An implicit commit, as every DDL statement makes: without it the
        // session's own transaction holds the writer the catalog needs, and the
        // statement waits on itself (found by review).
        state.commit()
        return this.#createDatabase(statement)
      case STATEMENT.DROP:
        return this.#drop(run, statement)
      case STATEMENT.TRUNCATE: {
        // DDL: an implicit commit, then the table made again, empty and its
        // AUTO_INCREMENT from 1 (8.4.11; ER_NO_SUCH_TABLE for a missing one).
        const schema = statement.table.schema ?? session.database
        if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
        state.commit()
        if (foreignKeyChecks(run)) {
          const by = referencingKeys(this.#catalog(), schema, statement.table.name).find((r) => r.child.schema !== schema || r.child.name !== statement.table.name)
          if (by !== undefined) throw sqlError('ER_TRUNCATE_ILLEGAL_FK', `Cannot truncate a table referenced in a foreign key constraint (\`${by.child.schema}\`.\`${by.child.name}\`, CONSTRAINT \`${by.fk.name}\`)`)
        }
        this.#catalog().truncateTable(schema, statement.table.name)
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
        if (this.catalog !== undefined && statement.database.toLowerCase() !== 'information_schema') this.catalog.schema(statement.database)
        session.database = statement.database
        return { affectedRows: 0 }

      case STATEMENT.START_TRANSACTION:
        if (this.catalog !== undefined) state.begin(this.catalog.store, { readOnly: statement.access === 'READ ONLY', snapshot: statement.consistentSnapshot === true })
        return { affectedRows: 0 }
      case STATEMENT.COMMIT:
        state.commit()
        if (statement.chain === true && this.catalog !== undefined) state.begin(this.catalog.store)
        return { affectedRows: 0 }
      case STATEMENT.ROLLBACK:
        if (statement.savepoint !== undefined) state.rollbackTo(statement.savepoint)
        else {
          state.rollback()
          if (statement.chain === true && this.catalog !== undefined) state.begin(this.catalog.store)
        }
        return { affectedRows: 0 }
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
      case STATEMENT.TABLE_MAINTENANCE:
        if (statement.op !== 'ANALYZE') throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`${statement.op} TABLE`))
        return this.#analyze(run, statement.tables)

      // Answered OK and not run, as they were while the parser refused them:
      // drivers send them on connect, and there is no cache to flush and no
      // account store to change (M3.17).
      case STATEMENT.FLUSH:
      case STATEMENT.SET_PASSWORD:
      case STATEMENT.SET_ROLE:
      case STATEMENT.SET_DEFAULT_ROLE:
        return { affectedRows: 0 }

      default:
        throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`This statement (${statement.kind})`))
    }
  }

  /** A DML result's counters, recorded for `ROW_COUNT()` and the session's warning count. */
  #counted(run: Run, result: OkResult): OkResult {
    run.state.rowCount = BigInt(result.affectedRows ?? 0)
    run.env.session.warnings = result.warnings ?? 0
    return result
  }

  #createDatabase(statement: CreateDatabaseNode): StatementResult {
    const catalog = this.#catalog()
    const options = statement.options
    const pick = (...names: string[]): string | undefined => {
      for (const [k, v] of Object.entries(options)) if (names.includes(k.toUpperCase().replace(/^DEFAULT /, ''))) return v
      return undefined
    }
    const collationId = resolveCollation(pick('CHARACTER SET', 'CHARSET'), pick('COLLATE'), DEFAULT_COLLATION)
    // The data dictionary's own schema is refused by name (sql_db.cc), before anything else.
    if (statement.name === 'mysql' && statement.ifNotExists !== true) throw systemSchema(statement.name)
    const made = catalog.createSchema(statement.name, { ifNotExists: statement.ifNotExists === true, collationId })
    return { affectedRows: made === undefined ? 0 : 1 }
  }

  /**
   * CREATE VIEW: the query planned now, in the session's database, so what
   * would fail at its first use fails here (8.4.11: 1146, 1054, 1353, 1060 —
   * before 1050 for a name taken), and stored as its text with the names its
   * columns got now. A variable or parameter is 1351, an INTO 1350.
   */
  #createView(run: Run, statement: CreateViewNode): StatementResult {
    const session = run.env.session
    const schema = statement.view.schema ?? session.database
    if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
    if (findNode(statement.query, (n) => n.kind === QUERY.QUERY && (n as QueryExpression).into !== undefined)) throw sqlError('ER_VIEW_SELECT_CLAUSE', "View's SELECT contains a 'INTO' clause")
    if (findNode(statement.query, (n) => n.kind === NODE.VARIABLE || n.kind === NODE.PLACEHOLDER)) throw sqlError('ER_VIEW_SELECT_VARIABLE', "View's SELECT contains a variable or parameter")
    const catalog = this.#catalog()
    catalog.schema(schema)
    const def: ViewDef = {
      schema,
      name: statement.view.name,
      query: viewText(run, statement),
      ...(session.database === null ? {} : { database: session.database }),
      definer: `${session.user}@%`,
      collationConnection: session.characterSet,
      ...(statement.columns === undefined ? {} : { columns: statement.columns }),
      ...(statement.algorithm === undefined ? {} : { algorithm: statement.algorithm }),
      ...(statement.checkOption === undefined ? {} : { checkOption: statement.checkOption }),
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
    const catalog = this.#catalog()
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
      let notes = 0
      for (const schema of schemas as Set<string>) {
        const names = statement.names.filter((n) => (n.schema ?? session.database) === schema).map((n) => n.name)
        notes += catalog.dropViews(schema, names, { ifExists: statement.ifExists === true }).length
      }
      return { affectedRows: 0, ...(notes > 0 ? { warnings: notes } : {}) }
    }
    if (statement.object !== 'TABLE') throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`DROP ${statement.object}`))
    if (statement.temporary === true) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('DROP TEMPORARY TABLE'))
    const names = statement.names.map((n) => {
      const schema = n.schema ?? session.database
      if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
      return { schema, name: n.name }
    })
    // All or nothing, as 8.0's atomic DDL is: every missing table is named,
    // and nothing is dropped.
    if (statement.ifExists !== true) {
      const missing = names.filter((n) => !catalog.tables().some((t) => t.schema === n.schema && t.name === n.name))
      if (missing.length > 0) throw sqlError('ER_BAD_TABLE_ERROR', `Unknown table '${missing.map((m) => `${m.schema}.${m.name}`).join(',')}'`)
    }
    // A parent goes only with its children, or with the checks off (8.4.11: 3730).
    if (foreignKeyChecks(run)) {
      const dropping = (schema: string, name: string) => names.some((n) => n.schema === schema && n.name === name)
      for (const n of names) {
        const by = referencingKeys(catalog, n.schema, n.name).find((r) => !dropping(r.child.schema, r.child.name))
        if (by !== undefined) throw sqlError('ER_FK_CANNOT_DROP_PARENT', `Cannot drop table '${n.name}' referenced by a foreign key constraint '${by.fk.name}' on table '${by.child.name}'.`)
      }
    }
    run.state.commit()
    let notes = 0
    for (const n of names) if (!catalog.dropTable(n.schema, n.name, { ifExists: true })) notes++
    // IF EXISTS notes each name it did not find, a view's included (8.4.11: 1051).
    return { affectedRows: 0, ...(notes > 0 ? { warnings: notes } : {}) }
  }

  #set(run: Run, statement: SetNode): StatementResult {
    const { state } = run
    const session = run.env.session
    const evaluate = (e: Expression): Value => compile(e, compileContext(run, EMPTY_SCOPE, 'field list')).eval([], run.env)
    const wasAutocommit = session.autocommit
    let warnings = 0
    for (const item of statement.items) {
      if (item.type === 'user') {
        const v = evaluate(item.value)
        state.userVariables.set(item.name.replace(/^@/, '').toLowerCase(), v)
        continue
      }
      const changed = this.server.set(session, item, evaluate, state.ownVariables, () => warnings++)
      if (changed === 'sql_mode') state.sqlModeAssigned = true
      // `transaction_isolation` is what SET SESSION TRANSACTION sets too: one
      // setting, so the variable reaches the transactions (found by review).
      const sessionScoped = item.type === 'name' || (item.type === 'system' && (item.scope === undefined || item.scope === 'SESSION'))
      if (sessionScoped && /^(transaction_isolation|tx_isolation)$/i.test(item.name)) {
        const v = state.ownVariables.get(item.name.toLowerCase())
        state.ownVariables.delete(item.name.toLowerCase())
        if (v !== undefined && v !== null) state.setIsolation(toText(v))
      }
    }
    // `SET autocommit = 1` commits whatever the session had open.
    if (!wasAutocommit && session.autocommit) state.commit()
    return { affectedRows: 0, ...(warnings > 0 ? { warnings } : {}) }
  }

  /**
   * `ANALYZE TABLE`: there are no index statistics to refresh, since nothing
   * here costs a plan by them yet (M5.7), so it reports what MySQL reports —
   * `status OK` per table, or the error and `Operation failed` for one that
   * does not exist (8.4.11) — and changes nothing.
   */
  #analyze(run: Run, tables: readonly TableName[]): StatementResult {
    const coll = run.env.session.characterSet
    const text = (name: string, chars: number, field?: number): ColumnDefinition => columnDefinition(name, { ...stringType(chars, coll, false), ...(field === undefined ? {} : { field }) }, coll)
    const encode = (s: string) => run.env.session.transcoder.encode(s, coll)
    const rows: Uint8Array[][] = []
    for (const t of tables) {
      const schema = t.schema ?? run.env.session.database
      if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
      const name = `${schema}.${t.name}`
      const exists = this.catalog?.tables().some((x) => x.schema === schema && x.name === t.name) === true
      if (exists) rows.push([encode(name), encode('analyze'), encode('status'), encode('OK')])
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
        return { columns: [text('Level', 7), text('Code', 4), text('Message', 512)], rows: [] }
      case 'DATABASES': {
        const names = ['information_schema', ...(this.catalog?.schemas().map((s) => s.name) ?? [])].sort()
        return { columns: [text('Database', 64)], rows: names.filter((n) => statement.like === undefined || likeText(n, statement.like)).map((n) => [encode(n)]) }
      }
      case 'CREATE TABLE': {
        const name = statement.name as TableName
        const schema = name.schema ?? run.env.session.database
        if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
        const catalog = this.#catalog()
        if (catalog.view(schema, name.name) !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('SHOW CREATE TABLE of a view'))
        const def = catalog.definition(schema, name.name)
        const created = showCreateTable(run, def, catalog.table(schema, name.name))
        return { columns: [text('Table', 64), text('Create Table', 1024)], rows: [[encode(def.name), encode(created)]] }
      }
      case 'TABLES': {
        const schema = statement.database ?? run.env.session.database
        if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
        // Views beside tables, and under FULL, which is which (8.4.11).
        const catalog = this.#catalog()
        const tables = [...catalog.tables(schema).map((t) => [t.name, 'BASE TABLE']), ...catalog.views(schema).map((v) => [v.name, 'VIEW'])].sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1))
        const label = `Tables_in_${schema}${statement.like === undefined ? '' : ` (${statement.like})`}`
        const shown = tables.filter(([n]) => statement.like === undefined || likeText(n as string, statement.like))
        if (statement.full === true) return { columns: [text(label, 64), text('Table_type', 11)], rows: shown.map(([n, kind]) => [encode(n as string), encode(kind as string)]) }
        return { columns: [text(label, 64)], rows: shown.map(([n]) => [encode(n as string)]) }
      }
      default:
        throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`SHOW ${statement.what}`))
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

/** Whether any node under `root` — expression or query — satisfies `test`. */
function findNode(root: unknown, test: (n: { readonly kind: string }) => boolean): boolean {
  if (root === null || typeof root !== 'object') return false
  if (Array.isArray(root)) return root.some((x) => findNode(x, test))
  const n = root as { kind?: unknown }
  if (typeof n.kind === 'string' && test(n as { kind: string })) return true
  return Object.values(root).some((v) => typeof v === 'object' && findNode(v, test))
}

/**
 * A view's query as written: from its first token to the end of the
 * statement, less a trailing `WITH … CHECK OPTION`. The text, not a deparse,
 * since an unaliased column is named by its text (`c*2`).
 */
function viewText(run: Run, statement: CreateViewNode): string {
  const tokens = lex(run.sql, { sqlMode: parseSqlMode(run.env.session.sqlMode) })
  const first = tokens.findIndex((t) => t.start === statement.query.at)
  let last = tokens.findIndex((t, i) => i >= first && (t.kind === TOKEN.EOF || (t.kind === TOKEN.OPERATOR && t.text === ';'))) - 1
  if (statement.checkOption !== undefined) {
    while (last > first && (tokens[last] as Token).text.toUpperCase() !== 'WITH') last--
    last--
  }
  return run.sql.slice((tokens[first] as Token).start, (tokens[last] as Token).end)
}
