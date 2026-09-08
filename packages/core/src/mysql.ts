// M1.24 — the public surface, as far as M1 reaches.
//
// Doc 42's two design rules:
//   1. `execProtocol()` is the real API. Everything else is a convenience
//      built on it.
//   2. Existing MySQL drivers must work unmodified. If `mysql2` needs a patch,
//      we have failed.
//
// `query()` and `execute()` are deliberately absent until 0.3. They need a
// client-side protocol implementation *and* a real executor, and the release
// plan is explicit that shipping a package named `myjs` that cannot open a
// database would be a worse first impression than shipping nothing. Until
// then the supported route is `mysql2.createConnection({ stream:
// db.createStream() })`, which is doc 42's own example.

import { MapAccountStore, Sha2Cache, type AccountStore, type Executor } from '@myjs/protocol'
import { MemoryVfs, type Vfs } from '@myjs/vfs'
import { ProtocolConnection, type ConnectionOptions } from './connection.ts'
import { StubExecutor } from './stub.ts'

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
  /** Swap in a real executor; M1 defaults to the stub. */
  readonly executor?: Executor
  readonly accounts?: AccountStore
  readonly serverVersion?: string
}

/** A duplex a driver can be handed. Shape depends on the host (D-27). */
export interface DriverStream {
  readonly [key: string]: unknown
}

type StreamFactory = (connection: ProtocolConnection) => unknown

export class MySQL {
  readonly path: string
  readonly vfs: Vfs
  readonly accounts: AccountStore
  readonly options: MySQLOptions

  readonly #executor: Executor
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
  ) {
    this.path = path
    this.vfs = vfs
    this.#executor = executor
    this.accounts = accounts
    this.options = options
    this.#streamFactory = streamFactory
  }

  /**
   * Doc 42: the URL scheme selects the VFS — `opfs://`, `file://` or a bare
   * path, `:memory:`. An explicit `vfs` option accepts a custom implementation.
   *
   * M1 has no storage engine, so every scheme resolves to the memory backend
   * and nothing is persisted. The VFS is wired up rather than stubbed out so
   * that M4 changes one line here, not the shape of the API.
   */
  static async open(path = ':memory:', options: MySQLOptions = {}): Promise<MySQL> {
    const vfs = options.vfs ?? new MemoryVfs()
    const executor =
      options.executor ??
      new StubExecutor(options.serverVersion === undefined ? {} : { serverVersion: options.serverVersion })
    const accounts = options.accounts ?? (await defaultAccounts())
    const streamFactory = await loadStreamFactory()
    return new MySQL(path, vfs, executor, accounts, options, streamFactory)
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
    return new ProtocolConnection({
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
    connection.start()
    const initial = connection.take()
    if (initial.length > 0) local.postMessage(initial, [initial.buffer])
    local.start?.()
    return channel.port2
  }

  async end(): Promise<void> {
    this.#closed = true
    this.#implicit = null
  }
}

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
async function loadStreamFactory(): Promise<StreamFactory> {
  const isNode =
    typeof globalThis.process !== 'undefined' &&
    typeof globalThis.process.versions?.node === 'string'
  if (isNode) return (await import('./host/node.ts')).createNodeStream as StreamFactory
  return (await import('./host/browser.ts')).createWebStream as StreamFactory
}
