// M5.36 — doc 42's query API: `query`, `execute`, `begin` and `transaction`,
// shaped like `mysql2/promise` and built on the protocol (doc 42, rule 1).
//
// A `Connection` is one session: a `WireClient` over one `ProtocolConnection`,
// with its commands queued so that two calls in flight never interleave their
// packets. `MySQL` keeps one for `db.query()` and `db.execute()`, and gives
// each `begin()` and `transaction()` a connection of its own, since a
// transaction is a session's state and two callers sharing one would share
// it.
import { CLIENT, hasCap, symbolOf } from '@myjs/protocol'
import { binaryRow, executePacket, fieldInfo, formatQuery, textRow, type FieldInfo, type TypeOptions } from './values.ts'
import { WireClient, WireError, type ConnectOptions, type PreparedOnWire, type ServerEnd, type WireResult } from './wire.ts'

export type { FieldInfo, TypeOptions }

/** What a statement that returns no rows answers: `mysql2`'s `ResultSetHeader`. */
export interface ResultSetHeader {
  readonly fieldCount: 0
  readonly affectedRows: number
  readonly insertId: number
  readonly info: string
  readonly serverStatus: number
  readonly warningStatus: number
  readonly changedRows: number
}

export interface QueryOptions extends TypeOptions {
  readonly sql: string
  readonly values?: readonly unknown[]
  /** Each row as an array rather than an object keyed by column name. */
  readonly rowsAsArray?: boolean
}

export type QueryResult = [unknown, FieldInfo[] | (FieldInfo[] | undefined)[] | undefined]

/** A failed statement, in `mysql2`'s shape: `code`, `errno`, `sqlState`, `sqlMessage`, `sql`. */
export class QueryError extends Error {
  readonly code: string | undefined
  readonly errno: number
  readonly sqlState: string
  readonly sqlMessage: string
  readonly sql: string
  constructor(e: WireError, sql: string) {
    super(e.sqlMessage)
    this.code = symbolOf(e.errno)
    this.errno = e.errno
    this.sqlState = e.sqlState
    this.sqlMessage = e.sqlMessage
    this.sql = sql
  }
}

export type IsolationLevel = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'

export interface BeginOptions {
  readonly isolation?: IsolationLevel
  readonly readOnly?: boolean
}

export interface TransactionOptions extends BeginOptions {
  /** How many times a transaction that failed with ER_LOCK_DEADLOCK (1213) runs again: 3 unless said. */
  readonly retries?: number
}

/** A prepared statement kept per connection, as `mysql2` keeps them, by text. */
const PREPARED_KEPT = 256

export class Connection {
  readonly #client: WireClient
  readonly #defaults: TypeOptions
  readonly #prepared = new Map<string, PreparedOnWire>()
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(client: WireClient, defaults: TypeOptions) {
    this.#client = client
    this.#defaults = defaults
  }

  static async open(server: ServerEnd, options: ConnectOptions, defaults: TypeOptions = {}): Promise<Connection> {
    try {
      return new Connection(await WireClient.connect(server, options), defaults)
    } catch (e) {
      throw e instanceof WireError ? new QueryError(e, '') : e
    }
  }

  get threadId(): number {
    return this.#client.connectionId
  }

  /** The text protocol. `values` fill the `?`s client-side, as `mysql2` fills them. */
  query(sql: string | QueryOptions, values?: readonly unknown[]): Promise<QueryResult> {
    const o = this.#options(sql, values)
    return this.#serial(async () => {
      const text = o.values === undefined ? o.sql : formatQuery(o.sql, o.values, this.#client.noBackslashEscapes, o.timezone)
      const results = await this.#run(text, () => this.#client.query(new TextEncoder().encode(text)))
      return shape(results, o, false)
    })
  }

  /** The binary protocol: prepared once per text, then executed with `values`. */
  execute(sql: string | QueryOptions, values?: readonly unknown[]): Promise<QueryResult> {
    const o = this.#options(sql, values)
    return this.#serial(async () => {
      const prepared = await this.#prepare(o.sql)
      // A count that does not match is the server's to refuse, as it is under `mysql2`.
      const params = o.values ?? []
      const packet = executePacket(prepared.id, params, hasCap(this.#client.capabilities, CLIENT.QUERY_ATTRIBUTES), o.timezone)
      const results = await this.#run(o.sql, () => this.#client.execute(packet))
      return shape(results, o, true)
    })
  }

  /** BEGIN on this connection, with the isolation level and access mode given. */
  async begin(options: BeginOptions = {}): Promise<void> {
    if (options.isolation !== undefined) await this.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation}`)
    await this.query(options.readOnly === true ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION')
  }

  async commit(): Promise<void> {
    await this.query('COMMIT')
  }

  async rollback(): Promise<void> {
    await this.query('ROLLBACK')
  }

  /** COM_QUIT: the session ends, and an open transaction is rolled back. */
  end(): Promise<void> {
    return this.#serial(async () => {
      this.#prepared.clear()
      await this.#client.quit()
    })
  }

  get closed(): boolean {
    return this.#client.closed
  }

  #options(sql: string | QueryOptions, values: readonly unknown[] | undefined): QueryOptions {
    const o = typeof sql === 'string' ? { sql } : sql
    return { ...this.#defaults, ...o, ...(values === undefined ? {} : { values }) }
  }

  async #prepare(sql: string): Promise<PreparedOnWire> {
    const kept = this.#prepared.get(sql)
    if (kept !== undefined) return kept
    const prepared = await this.#run(sql, () => this.#client.prepare(new TextEncoder().encode(sql)))
    if (this.#prepared.size >= PREPARED_KEPT) {
      const [oldest, statement] = this.#prepared.entries().next().value as [string, PreparedOnWire]
      this.#prepared.delete(oldest)
      await this.#client.closeStatement(statement.id)
    }
    this.#prepared.set(sql, prepared)
    return prepared
  }

  async #run<T>(sql: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (e) {
      throw e instanceof WireError ? new QueryError(e, sql) : e
    }
  }

  /** One call at a time: each waits for the one before it to finish, however that went. */
  #serial<T>(call: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(call, call)
    this.#queue = next.catch(() => undefined)
    return next
  }
}

/** The results as `mysql2` returns them: one, or several as arrays. */
function shape(results: readonly WireResult[], o: QueryOptions, binary: boolean): QueryResult {
  const each = results.map((r) => one(r, o, binary))
  if (each.length === 1) return each[0] as QueryResult
  return [each.map((r) => r[0]), each.map((r) => r[1] as FieldInfo[] | undefined)]
}

function one(r: WireResult, o: QueryOptions, binary: boolean): QueryResult {
  if (r.kind === 'ok') {
    const info = r.ok.info
    const changed = /\schanged:\s*(\d+)/i.exec(info)
    const header: ResultSetHeader = {
      fieldCount: 0,
      affectedRows: Number(r.ok.affectedRows),
      insertId: Number(r.ok.lastInsertId),
      info,
      serverStatus: r.ok.statusFlags,
      warningStatus: r.ok.warnings,
      changedRows: changed === null ? 0 : Number.parseInt(changed[1] as string, 10),
    }
    return [header, undefined]
  }
  const fields = r.columns.map(fieldInfo)
  const rows = r.rows.map((packet) => {
    const values = binary ? binaryRow(packet, r.columns, o) : textRow(packet, r.columns, o)
    if (o.rowsAsArray === true) return values
    const row: Record<string, unknown> = {}
    fields.forEach((f, i) => {
      row[f.name] = values[i]
    })
    return row
  })
  return [rows, fields]
}

/**
 * `fn` in a transaction on a connection of its own: committed when it
 * returns, rolled back when it throws, and run again from the start, after a
 * growing pause, when it failed with ER_LOCK_DEADLOCK, up to `retries` times.
 */
export async function inTransaction<T>(open: () => Promise<Connection>, fn: (tx: Connection) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  const retries = options.retries ?? 3
  for (let attempt = 0; ; attempt++) {
    const tx = await open()
    try {
      await tx.begin(options)
      const value = await fn(tx)
      await tx.commit()
      return value
    } catch (e) {
      if (!tx.closed) await tx.rollback().catch(() => undefined)
      if (!(e instanceof QueryError && e.errno === 1213) || attempt >= retries) throw e
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt))
    } finally {
      await tx.end().catch(() => undefined)
    }
  }
}

/**
 * `db.begin()`'s transaction: a connection of its own, already in a
 * transaction, which `commit()` or `rollback()` ends.
 */
export class Transaction {
  readonly #connection: Connection
  constructor(connection: Connection) {
    this.#connection = connection
  }

  query(sql: string | QueryOptions, values?: readonly unknown[]): Promise<QueryResult> {
    return this.#connection.query(sql, values)
  }

  execute(sql: string | QueryOptions, values?: readonly unknown[]): Promise<QueryResult> {
    return this.#connection.execute(sql, values)
  }

  async commit(): Promise<void> {
    try {
      await this.#connection.commit()
    } finally {
      await this.#connection.end()
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.#connection.rollback()
    } finally {
      await this.#connection.end()
    }
  }
}
