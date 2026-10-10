// M5.36 — the client end of the protocol, for doc 42's query API.
//
// Doc 42's first rule is that `execProtocol()` is the real API and everything
// else is a convenience built on it. This is that convenience's lower half: a
// client that speaks to one `ProtocolConnection` the way `execProtocol` does,
// bytes in and every response byte out, and reads what comes back into
// packets, OKs, errors and result sets. It knows nothing of JavaScript values;
// `values.ts` turns the bytes of a row into those, as `mysql2` would.
//
// It sends what `mysql2` 3.24.3 sends on connect (`connection_config.js`):
// the same capability flags, utf8mb4_unicode_ci as the connection's
// collation, and EOF packets rather than CLIENT_DEPRECATE_EOF. A session the
// API opens therefore behaves as one `mysql2` opens: FOUND_ROWS makes an
// UPDATE count the rows it matched, IGNORE_SPACE is in its sql_mode, and the
// same statement gives the same answer through either.
import {
  CACHING_SHA2_PASSWORD,
  CLIENT,
  COM,
  MYSQL_NATIVE_PASSWORD,
  PacketFramer,
  SERVER_STATUS,
  capabilities,
  hasCap,
  parseColumnDefinition41,
  parseEof,
  parseErr,
  parseHandshakeV10,
  parseOk,
  sha1,
  sha256,
  writeHandshakeResponse41,
  xor,
  type Capabilities,
  type ColumnDefinition,
  type ErrPacket,
  type OkPacket,
} from '@myjs/protocol'
import { MyjsError, ProtocolError, Reader, Writer, concatBytes } from '@myjs/bytes'

/** The packet a connection answers with: its first byte says which (doc 10). */
const OK = 0x00
const EOF = 0xfe
const ERR = 0xff
const LOCAL_INFILE = 0xfb

/** The largest packet a server may send: `max_allowed_packet`'s ceiling, 1 GiB. */
const MAX_PACKET = 1 << 30

/** `mysql2`'s default flags, `ConnectionConfig.getDefaultFlags`, as numbers. */
const CLIENT_FLAGS =
  CLIENT.LONG_PASSWORD |
  CLIENT.FOUND_ROWS |
  CLIENT.LONG_FLAG |
  CLIENT.CONNECT_WITH_DB |
  CLIENT.ODBC |
  CLIENT.LOCAL_FILES |
  CLIENT.IGNORE_SPACE |
  CLIENT.PROTOCOL_41 |
  CLIENT.IGNORE_SIGPIPE |
  CLIENT.TRANSACTIONS |
  CLIENT.RESERVED |
  CLIENT.RESERVED2 |
  CLIENT.MULTI_RESULTS |
  CLIENT.SESSION_TRACK |
  CLIENT.CONNECT_ATTRS |
  CLIENT.QUERY_ATTRIBUTES |
  CLIENT.PLUGIN_AUTH |
  CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA

/** utf8mb4_unicode_ci: `mysql2`'s connection collation unless told otherwise. */
const DEFAULT_CLIENT_COLLATION = 224

/** What the client needs of a server connection: `ProtocolConnection`'s byte pair. */
export interface ServerEnd {
  start(): void
  take(): Uint8Array
  feed(chunk: Uint8Array): Promise<void>
  close(): void
  /** Called as bytes are queued, so a stream reads them while its command runs (M5.40). */
  onOutput?(listener: (() => void) | undefined): void
}

export interface ConnectOptions {
  readonly user: string
  readonly password: string
  readonly database?: string
  /** The connection's collation id; utf8mb4_unicode_ci by default, as `mysql2`'s. */
  readonly collation?: number
  readonly multipleStatements?: boolean
}

/** A result set as it came off the wire: its columns, and each row's packet. */
export interface WireResultSet {
  readonly kind: 'rows'
  readonly columns: readonly ColumnDefinition[]
  readonly rows: readonly Uint8Array[]
}

export interface WireOk {
  readonly kind: 'ok'
  readonly ok: OkPacket
}

export type WireResult = WireResultSet | WireOk

/** A resultset read as the server sends it: its columns, then its rows' packets as they arrive (M5.40). */
export interface WireStream {
  readonly columns: readonly ColumnDefinition[]
  readonly rows: AsyncGenerator<readonly Uint8Array[], void, undefined>
}

/** An ERR packet, as the error a call rejects with. */
export class WireError extends MyjsError {
  declare readonly errno: number
  declare readonly sqlState: string
  readonly sqlMessage: string
  constructor(err: ErrPacket) {
    super('ER_SERVER', err.message, { errno: err.errno, sqlState: err.sqlState })
    this.sqlMessage = err.message
  }
}

export class WireClient {
  readonly #server: ServerEnd
  readonly #framer: PacketFramer
  readonly #caps: Capabilities
  readonly connectionId: number
  /** The status flags of the last OK or EOF: whether backslashes escape (SERVER_STATUS.NO_BACKSLASH_ESCAPES). */
  #status = 0
  #closed = false

  private constructor(server: ServerEnd, framer: PacketFramer, caps: Capabilities, connectionId: number) {
    this.#server = server
    this.#framer = framer
    this.#caps = caps
    this.connectionId = connectionId
  }

  get noBackslashEscapes(): boolean {
    return (this.#status & SERVER_STATUS.NO_BACKSLASH_ESCAPES) !== 0
  }

  get closed(): boolean {
    return this.#closed
  }

  /** Read the server's greeting, answer it, and see authentication through. */
  static async connect(server: ServerEnd, options: ConnectOptions): Promise<WireClient> {
    server.start()
    // One framer for the connection: the sequence runs on through the
    // handshake and authentication, and restarts at each command (doc 10).
    const framer = new PacketFramer({ maxAllowedPacket: MAX_PACKET })
    const [greeting] = received(framer, server.take())
    if (greeting === undefined) throw unexpected('the server sent no greeting')
    if (greeting[0] === ERR) throw new WireError(parseErr(greeting, capabilities(CLIENT.PROTOCOL_41)))
    const hello = parseHandshakeV10(greeting)
    let flags = CLIENT_FLAGS | (options.multipleStatements === true ? CLIENT.MULTI_STATEMENTS : 0)
    if (options.database === undefined) flags &= ~CLIENT.CONNECT_WITH_DB
    // What the server does not offer is not asked for.
    flags &= hello.capabilities
    const caps = capabilities(flags)
    const password = new TextEncoder().encode(options.password)
    const plugin = hello.authPluginName === MYSQL_NATIVE_PASSWORD ? MYSQL_NATIVE_PASSWORD : CACHING_SHA2_PASSWORD
    const w = new Writer(128)
    writeHandshakeResponse41(w, {
      capabilities: flags,
      characterSet: options.collation ?? DEFAULT_CLIENT_COLLATION,
      username: options.user,
      authResponse: await scramble(plugin, password, hello.scramble),
      ...(options.database === undefined ? {} : { database: options.database }),
      clientPluginName: plugin,
      connectAttrs: new Map([['_client_name', 'myjs']]),
    })
    let reply = await exchange(server, framer, w.toBytes())
    for (;;) {
      const packet = reply[0]
      if (packet === undefined) throw unexpected('the server sent nothing during authentication')
      if (packet[0] === OK) {
        const client = new WireClient(server, framer, caps, hello.connectionId)
        client.#status = parseOk(packet, caps).statusFlags
        return client
      }
      if (packet[0] === ERR) throw new WireError(parseErr(packet, caps))
      if (packet[0] === EOF) {
        // AuthSwitchRequest: the plugin name, NUL, and its data.
        const r = new Reader(packet, 1)
        const name = new TextDecoder().decode(r.nulString())
        const data = r.restBytes()
        const nonce = data[data.length - 1] === 0 ? data.subarray(0, data.length - 1) : data
        reply = await exchange(server, framer, await scramble(name, password, nonce))
        continue
      }
      if (packet[0] === 0x01 && packet[1] === 3) {
        // AuthMoreData 3: caching_sha2's fast path succeeded; its OK follows.
        reply = reply.slice(1)
        continue
      }
      if (packet[0] === 0x01 && packet[1] === 4) {
        // AuthMoreData 4: the password itself, which an in-process channel may carry.
        reply = await exchange(server, framer, concatBytes([password, new Uint8Array([0])]))
        continue
      }
      throw unexpected(`unexpected packet 0x${(packet[0] ?? 0).toString(16)} during authentication`)
    }
  }

  /** COM_QUERY: every result it produced, in order. */
  async query(sql: Uint8Array): Promise<WireResult[]> {
    return this.#results(await this.#command(this.#queryPacket(sql)))
  }

  #queryPacket(sql: Uint8Array): Uint8Array {
    const w = new Writer(sql.length + 3)
    w.u8(COM.QUERY)
    // CLIENT_QUERY_ATTRIBUTES: no attributes, in one set.
    if (hasCap(this.#caps, CLIENT.QUERY_ATTRIBUTES)) {
      w.lenEncInt(0)
      w.lenEncInt(1)
    }
    w.bytes(sql)
    return w.toBytes()
  }

  /**
   * A text query whose rows are read as the server sends them (M5.40), so a
   * large resultset is never held whole: the server waits while what it has
   * sent is unread. A statement that answers OK streams no rows. Ending the
   * rows before they are done closes the connection, which is what ends the
   * statement on the server and rolls back its transaction.
   */
  async stream(sql: Uint8Array): Promise<WireStream> {
    if (this.#closed) throw new MyjsError('CONNECTION_CLOSED', 'the connection is closed')
    const server = this.#server
    const framer = this.#framer
    const caps = this.#caps
    let wake: (() => void) | undefined
    let settled = false
    let failure: unknown
    server.onOutput?.(() => wake?.())
    framer.resetSequence()
    const running = server.feed(framer.encode(this.#queryPacket(sql))).then(
      () => void (settled = true),
      (e: unknown) => void ((settled = true), (failure = e)),
    ).finally(() => wake?.())
    let pending: Uint8Array[] = []
    let at = 0
    // Packets as they arrive: `next()` waits only when none are left.
    const next = async (): Promise<Uint8Array> => {
      for (;;) {
        if (at < pending.length) return pending[at++] as Uint8Array
        const bytes = server.take()
        if (bytes.length > 0) {
          framer.feed(bytes)
          pending = [...framer.drain()]
          at = 0
          continue
        }
        if (settled) throw failure ?? unexpected('the server ended a response early')
        await new Promise<void>((resolve) => (wake = resolve))
        wake = undefined
      }
    }
    const end = async (): Promise<void> => {
      server.onOutput?.(undefined)
      await running
    }
    const head = await next()
    if (head[0] === ERR || head[0] === OK) {
      await end()
      if (head[0] === ERR) throw new WireError(parseErr(head, caps))
      this.#status = parseOk(head, caps).statusFlags
      return { columns: [], rows: (async function* () {})() }
    }
    const count = Number(new Reader(head).lenEncInt() ?? 0n)
    const columns: ColumnDefinition[] = []
    for (let i = 0; i < count; i++) columns.push(parseColumnDefinition41(await next()))
    await next() // the EOF after the columns
    const client = this
    async function* rows(): AsyncGenerator<readonly Uint8Array[], void, undefined> {
      let answered = false
      try {
        for (;;) {
          // The rows already arrived, up to the terminator, as one batch.
          const batch: Uint8Array[] = [await next()]
          while (at < pending.length) batch.push(pending[at++] as Uint8Array)
          const last = batch.findIndex((row) => row[0] === ERR || (row[0] === EOF && row.length < 9))
          if (last === -1) {
            yield batch
            continue
          }
          answered = true
          const end = batch[last] as Uint8Array
          if (last > 0) yield batch.slice(0, last)
          if (end[0] === ERR) throw new WireError(parseErr(end, caps))
          client.#status = parseEof(end, caps).statusFlags
          return
        }
      } finally {
        if (!answered) {
          client.#closed = true
          server.close()
        }
        await end()
      }
    }
    return { columns, rows: rows() }
  }

  /** COM_STMT_PREPARE: the statement's id. Its definitions are not read; a result set carries its own. */
  async prepare(sql: Uint8Array): Promise<number> {
    const w = new Writer(sql.length + 1)
    w.u8(COM.STMT_PREPARE)
    w.bytes(sql)
    const head = (await this.#command(w.toBytes()))[0] as Uint8Array
    if (head[0] === ERR) throw new WireError(parseErr(head, this.#caps))
    return new Reader(head, 1).u32()
  }

  /** COM_STMT_EXECUTE, its parameters already written by the caller after the fixed head. */
  async execute(payload: Uint8Array): Promise<WireResult[]> {
    return this.#results(await this.#command(payload))
  }

  /** COM_STMT_CLOSE, which the server never answers. */
  async closeStatement(id: number): Promise<void> {
    const w = new Writer(5)
    w.u8(COM.STMT_CLOSE)
    w.u32(id)
    await this.#command(w.toBytes())
  }

  get capabilities(): Capabilities {
    return this.#caps
  }

  async quit(): Promise<void> {
    if (this.#closed) return
    try {
      await this.#command(new Uint8Array([COM.QUIT]))
    } finally {
      this.#closed = true
      this.#server.close()
    }
  }

  /** One command, its sequence from zero, and the packets of everything the server answered. */
  async #command(payload: Uint8Array): Promise<Uint8Array[]> {
    if (this.#closed) throw new MyjsError('CONNECTION_CLOSED', 'the connection is closed')
    this.#framer.resetSequence()
    return exchange(this.#server, this.#framer, payload)
  }

  #results(packets: readonly Uint8Array[]): WireResult[] {
    const out: WireResult[] = []
    let at = 0
    for (;;) {
      const head = packets[at++]
      if (head === undefined) throw unexpected('the server ended a response early')
      if (head[0] === ERR) throw new WireError(parseErr(head, this.#caps))
      if (head[0] === OK) {
        const ok = parseOk(head, this.#caps)
        this.#status = ok.statusFlags
        out.push({ kind: 'ok', ok })
        if ((ok.statusFlags & SERVER_STATUS.MORE_RESULTS_EXISTS) === 0) return out
        continue
      }
      if (head[0] === LOCAL_INFILE) throw new MyjsError('LOCAL_INFILE_REFUSED', 'LOAD DATA LOCAL is not served by this client')
      const count = Number(new Reader(head).lenEncInt() ?? 0n)
      const columns: ColumnDefinition[] = []
      for (let i = 0; i < count; i++) columns.push(parseColumnDefinition41(packets[at++] as Uint8Array))
      at++ // the EOF after the columns
      const rows: Uint8Array[] = []
      for (;;) {
        const row = packets[at++]
        if (row === undefined) throw unexpected('the server ended a result set early')
        if (row[0] === ERR) throw new WireError(parseErr(row, this.#caps))
        // An EOF is short; a text row that starts with 0xFE is a long length.
        if (row[0] === EOF && row.length < 9) {
          this.#status = parseEof(row, this.#caps).statusFlags
          out.push({ kind: 'rows', columns, rows })
          if ((this.#status & SERVER_STATUS.MORE_RESULTS_EXISTS) === 0) return out
          break
        }
        rows.push(row)
      }
    }
  }
}

/** Send one payload, and read the whole answer as payloads, each split at 16 MB joined again. */
async function exchange(server: ServerEnd, framer: PacketFramer, payload: Uint8Array): Promise<Uint8Array[]> {
  await server.feed(framer.encode(payload))
  return received(framer, server.take())
}

/**
 * Every packet in `bytes`. A connection answers a command whole, so bytes
 * left over that make no packet are a fault, not the start of the next one;
 * the framer refuses a packet out of sequence.
 */
function received(framer: PacketFramer, bytes: Uint8Array): Uint8Array[] {
  framer.feed(bytes)
  const out = [...framer.drain()]
  if (framer.buffered > 0 || framer.midMessage) throw unexpected('the server ended a packet early')
  return out
}

const unexpected = (message: string): ProtocolError => new ProtocolError('PROTOCOL_UNEXPECTED_PACKET', message)

/** The auth response for `plugin` (sql/auth/sha2_password_common.cc, password.cc). */
async function scramble(plugin: string, password: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  if (password.length === 0) return new Uint8Array(0)
  const seed = nonce.subarray(0, 20)
  if (plugin === MYSQL_NATIVE_PASSWORD) {
    // SHA1(password) XOR SHA1(nonce, SHA1(SHA1(password)))
    const stage1 = await sha1(password)
    return xor(stage1, await sha1(seed, await sha1(stage1)))
  }
  // SHA256(password) XOR SHA256(SHA256(SHA256(password)), nonce)
  const stage1 = await sha256(password)
  return xor(stage1, await sha256(await sha256(stage1), seed))
}
