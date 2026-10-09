// M1.24 — the public surface, as far as M1 reaches.
//
// Doc 42's two design rules:
//   1. `execProtocol()` is the real API. Everything else is a convenience
//      built on it.
//   2. Existing MySQL drivers must work unmodified. If `mysql2` needs a patch,
//      we have failed.
//
// `query()`, `execute()`, `begin()` and `transaction()` (M5.36) are rule 1
// taken literally: a client in `client/` that speaks the protocol to a
// connection of this database, as `mysql2` would, and gives back what
// `mysql2/promise` gives. `mysql2.createConnection({ stream:
// db.createStream() })` remains doc 42's route for a driver or an ORM.

import { Catalog, Store } from '@myjs/engine'
import { MapAccountStore, Sha2Cache, type AccountStore, type Executor } from '@myjs/protocol'
import { MemoryVfs, type Lock, type Vfs } from '@myjs/vfs'
import { ProtocolConnection, type ConnectionOptions } from './connection.ts'
import { SqlExecutor } from './sql/executor.ts'
import { Connection, Transaction, inTransaction, type BeginOptions, type QueryOptions, type QueryResult, type TransactionOptions, type TypeOptions } from './client/api.ts'

/** Who `connect()` signs in as, and how its values are typed: `mysql2`'s option names. */
export interface ConnectionConfig extends TypeOptions {
  readonly user?: string
  readonly password?: string
  readonly database?: string
  readonly multipleStatements?: boolean
}

export interface MySQLOptions {
  /** Doc 42's options object. Only the ones M1 can honour are read. */
  readonly sqlMode?: string
  readonly characterSet?: string
  readonly collation?: string
  readonly timeZone?: string
  readonly maxAllowedPacket?: number
  readonly readOnly?: boolean
  /** D-13: off by default; it turns SQL injection into arbitrary execution. */
  readonly multipleStatements?: boolean
  /** An explicit VFS, as doc 42 documents. */
  readonly vfs?: Vfs
  /** Doc 42: the buffer pool, in bytes. Default 4 MiB. */
  readonly bufferPoolSize?: number
  /** Doc 41's knob: `1` makes every commit durable; `0` and `2` leave it to the once-a-second sync. */
  readonly flushLogAtTrxCommit?: 0 | 1 | 2
  /** Swap in another executor; the default is the SQL executor over this database's store. */
  readonly executor?: Executor
  readonly accounts?: AccountStore
  readonly serverVersion?: string
  /** Who `query()`, `execute()`, `begin()` and `transaction()` sign in as: root, with no password, unless said. */
  readonly user?: string
  readonly password?: string
  /** The database those connections start in. */
  readonly database?: string
}

/** A duplex a driver can be handed. Shape depends on the host (D-27). */
export interface DriverStream {
  readonly [key: string]: unknown
}

type StreamFactory = (connection: ProtocolConnection) => unknown

/** What the host adapter provides (D-27): the platform's stream, and the platform's storage for a path. */
interface Host {
  readonly createStream: StreamFactory
  readonly openPathVfs: (path: string) => Promise<{ vfs: Vfs; lock: Lock }>
}

export class MySQL {
  readonly path: string
  readonly vfs: Vfs
  readonly accounts: AccountStore
  readonly options: MySQLOptions

  readonly #executor: Executor
  /** The database, when this instance opened one (not with a custom executor). */
  readonly store: Store | undefined
  readonly catalog: Catalog | undefined
  #sync: ReturnType<typeof setInterval> | undefined
  /** The database directory's lock, held from open to `end()`. */
  #lock: Lock | undefined
  readonly #cache = new Sha2Cache()
  readonly #streamFactory: StreamFactory
  #nextConnectionId = 1
  #closed = false

  private constructor(
    path: string,
    vfs: Vfs,
    executor: Executor,
    accounts: AccountStore,
    options: MySQLOptions,
    streamFactory: StreamFactory,
    catalog: Catalog | undefined,
  ) {
    this.path = path
    this.vfs = vfs
    this.store = catalog?.store
    this.catalog = catalog
    this.#executor = executor
    this.accounts = accounts
    this.options = options
    this.#streamFactory = streamFactory
  }

  /**
   * Doc 42: the URL scheme selects the VFS — `opfs://`, `file://` or a bare
   * path, `:memory:`. An explicit `vfs` option accepts a custom implementation.
   *
   * The database is two files in the VFS, `data` and `log` (D-41, D-45):
   * made on first open, recovered on every later one. `:memory:` is the
   * memory backend; a bare path or `file://` is a directory on disk through
   * the Node VFS (M4.26), taken for this instance until `end()`; `opfs://`
   * is M6's.
   */
  static async open(path = ':memory:', options: MySQLOptions = {}): Promise<MySQL> {
    const host = await loadHost()
    let vfs = options.vfs
    let lock: Lock | undefined
    if (vfs === undefined) {
      if (path === ':memory:') vfs = new MemoryVfs()
      else ({ vfs, lock } = await host.openPathVfs(path))
    }
    let catalog: Catalog | undefined
    let executor = options.executor
    if (executor === undefined) {
      try {
        catalog = await openCatalog(vfs, options)
      } catch (e) {
        lock?.release()
        throw e
      }
      executor = new SqlExecutor({ catalog, ...(options.serverVersion === undefined ? {} : { serverVersion: options.serverVersion }) })
    }
    const accounts = options.accounts ?? (await defaultAccounts())
    const db = new MySQL(path, vfs, executor, accounts, options, host.createStream, catalog)
    db.#lock = lock
    db.#startSync()
    return db
  }

  /**
   * D-49: with `flushLogAtTrxCommit` 0 or 2 a commit is not flushed, and
   * `Store.sync()` is the once-a-second flush that bounds what a crash can
   * lose. The synchronous core owns no timer (ground rule 3), so it is here.
   */
  #startSync(): void {
    const store = this.store
    if (store === undefined || (this.options.flushLogAtTrxCommit ?? 1) === 1) return
    this.#sync = setInterval(() => store.sync(), 1000)
    ;(this.#sync as { unref?: () => void }).unref?.()
  }

  get closed(): boolean {
    return this.#closed
  }

  /**
   * A fresh connection, each with its own framer, sequence counter, negotiated
   * capabilities and statement table (D-28).
   */
  createConnection(over: Partial<ConnectionOptions> = {}): ProtocolConnection {
    if (this.#closed) throw new Error('database is closed')
    const connection = new ProtocolConnection({
      executor: this.#executor,
      accounts: this.accounts,
      connectionId: this.#nextConnectionId++,
      // In-process is treated as already secure (D-11), so the full auth path
      // degenerates to compare-and-go and never touches RSA.
      secureChannel: true,
      cache: this.#cache,
      multipleStatements: this.options.multipleStatements ?? false,
      ...(this.options.maxAllowedPacket === undefined
        ? {}
        : { maxAllowedPacket: this.options.maxAllowedPacket }),
      ...(this.options.serverVersion === undefined ? {} : { serverVersion: this.options.serverVersion }),
      ...over,
    })
    this.#connections.add(connection)
    return connection
  }

  /** Every connection this instance made that has not closed, so `end()` can end their sessions. */
  readonly #connections = new Set<ProtocolConnection>()

  /** How many connections are still open. */
  get openConnections(): number {
    for (const c of this.#connections) if (c.closed) this.#connections.delete(c)
    return this.#connections.size
  }

  /**
   * D-28: bytes in, every response byte out.
   *
   * The database keeps one implicit connection for this method, because doc
   * 03 shows `execProtocol` on the database while `createPort()` and `serve()`
   * imply many. Anything wanting its own session uses `createStream()`,
   * `createPort()` or `createConnection()`.
   */
  #implicit: ProtocolConnection | null = null

  async execProtocol(request: Uint8Array): Promise<Uint8Array> {
    this.#implicit ??= this.createConnection()
    return this.#implicit.execProtocol(request)
  }

  /** A duplex stream of MySQL packets. Doc 42's driver-interop two-liner. */
  createStream(): DriverStream {
    return this.#streamFactory(this.createConnection()) as DriverStream
  }

  /** A `MessagePort` speaking MySQL packets, for a worker or another tab. */
  createPort(): MessagePort {
    const connection = this.createConnection()
    const channel = new MessageChannel()
    const local = channel.port1
    local.onmessage = (event: MessageEvent) => {
      const chunk = toBytes(event.data)
      if (chunk === null) return
      void connection.feed(chunk).then(() => {
        const out = connection.take()
        if (out.length > 0) local.postMessage(out, [out.buffer])
      })
    }
    // The peer closing its port is the connection going away (D-68): its
    // session ends, and an open transaction releases the writer.
    local.addEventListener('close', () => connection.close())
    connection.start()
    const initial = connection.take()
    if (initial.length > 0) local.postMessage(initial, [initial.buffer])
    local.start?.()
    return channel.port2
  }

  /** A session of its own through the query API, signed in as `config.user` (doc 42). */
  async connect(config: ConnectionConfig = {}): Promise<Connection> {
    const { user, password, database, multipleStatements, ...types } = config
    const db = database ?? this.options.database
    return Connection.open(
      this.createConnection(),
      {
        user: user ?? this.options.user ?? 'root',
        password: password ?? this.options.password ?? '',
        ...(db === undefined ? {} : { database: db }),
        ...(multipleStatements === undefined ? {} : { multipleStatements }),
      },
      types,
    )
  }

  /** The connection `query()` and `execute()` share, made on first use. */
  #shared: Promise<Connection> | null = null

  #connection(): Promise<Connection> {
    if (this.#shared === null) {
      const opening = this.connect()
      // A failed open is not kept: the next call tries again.
      opening.catch(() => {
        if (this.#shared === opening) this.#shared = null
      })
      this.#shared = opening
    }
    return this.#shared
  }

  /** Doc 42: the text protocol, `values` filling the `?`s as `mysql2` fills them. `[rows, fields]`, or `[header]`. */
  async query(sql: string | QueryOptions, values?: readonly unknown[]): Promise<QueryResult> {
    return (await this.#connection()).query(sql, values)
  }

  /** Doc 42: a prepared statement, run with `values` through the binary protocol. */
  async execute(sql: string | QueryOptions, values?: readonly unknown[]): Promise<QueryResult> {
    return (await this.#connection()).execute(sql, values)
  }

  /** Doc 42: a transaction on a connection of its own, which `commit()` or `rollback()` ends. */
  async begin(options: BeginOptions = {}): Promise<Transaction> {
    const connection = await this.connect()
    try {
      await connection.begin(options)
    } catch (e) {
      await connection.end()
      throw e
    }
    return new Transaction(connection)
  }

  /**
   * Doc 42: `fn` in a transaction, committed on return and rolled back on a
   * throw; one that fails with ER_LOCK_DEADLOCK (1213) runs again, up to
   * `options.retries` times (3), after a pause that doubles from 10 ms.
   */
  async transaction<T>(fn: (tx: Connection) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    return inTransaction(() => this.connect(), fn, options)
  }

  async end(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    // Every session ends before the store closes, rolling back what is open;
    // closing the store under a live transaction would leave its writer slot
    // and its undo to recovery for no reason.
    for (const c of this.#connections) c.close()
    this.#connections.clear()
    this.#implicit = null
    this.#shared = null
    if (this.#sync !== undefined) clearInterval(this.#sync)
    this.store?.close()
    this.#lock?.release()
  }
}

/** The store and its catalog, made if the VFS has none yet and recovered if it has. */
async function openCatalog(vfs: Vfs, options: MySQLOptions): Promise<Catalog> {
  const data = await vfs.open('data', { create: true })
  const log = await vfs.open('log', { create: true })
  const storeOptions = {
    ...(options.bufferPoolSize === undefined ? {} : { frames: Math.max(16, Math.floor(options.bufferPoolSize / data.pageSize)) }),
    ...(options.flushLogAtTrxCommit === undefined ? {} : { flushLogAtTrxCommit: options.flushLogAtTrxCommit }),
  }
  const store = data.size() === 0 ? Store.create(data, log, storeOptions) : Store.open(data, log, storeOptions)
  const catalog = Catalog.open(store)
  // The schemas a fresh 8.4.11 has, empty here: clients connect to `mysql`
  // to create their own database (Prisma's schema engine does).
  for (const name of SYSTEM_SCHEMAS) catalog.createSchema(name, { ifNotExists: true })
  return catalog
}

const SYSTEM_SCHEMAS = ['mysql', 'performance_schema', 'sys']

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

/**
 * The default account.
 *
 * An embedded database with no listener has no meaningful auth boundary — D-11
 * says as much: "auth is not the security boundary for an embedded database;
 * it exists so that drivers work." So the in-process default is a passwordless
 * `root`, and `serve()` refuses to bind anywhere but loopback without a real
 * one.
 */
async function defaultAccounts(): Promise<AccountStore> {
  const store = new MapAccountStore()
  await store.add('root', '')
  return store
}

/**
 * Pick the host adapter. D-27 confines `node:*` and `Buffer` to these two
 * files; this is the one place that chooses between them.
 */
async function loadHost(): Promise<Host> {
  const isNode =
    typeof globalThis.process !== 'undefined' &&
    typeof globalThis.process.versions?.node === 'string'
  if (isNode) {
    const node = await import('./host/node.ts')
    return { createStream: node.createNodeStream as StreamFactory, openPathVfs: node.openPathVfs }
  }
  const browser = await import('./host/browser.ts')
  return { createStream: browser.createWebStream as StreamFactory, openPathVfs: browser.openPathVfs }
}
