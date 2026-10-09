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
  SERVER_STATUS,
  capabilities,
  concat,
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
import { Reader, Writer } from '@myjs/bytes'

/** The packet a connection answers with: its first byte says which (doc 10). */
const OK = 0x00
const EOF = 0xfe
const ERR = 0xff
const LOCAL_INFILE = 0xfb

/** Header of one packet on the wire: three bytes of length and a sequence number. */
const HEADER = 4
const MAX_PAYLOAD = 0xffffff

/** `mysql2`'s default flags, `ConnectionConfig.getDefaultFlags`, as numbers. */
export const CLIENT_FLAGS =
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
export const DEFAULT_CLIENT_COLLATION = 224

/** What the client needs of a server connection: `ProtocolConnection`'s byte pair. */
export interface ServerEnd {
  start(): void
  take(): Uint8Array
  feed(chunk: Uint8Array): Promise<void>
  close(): void
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

/** An ERR packet, as the error a call rejects with. */
export class WireError extends Error {
  readonly errno: number
  readonly sqlState: string
  readonly sqlMessage: string
  constructor(err: ErrPacket) {
    super(err.message)
    this.errno = err.errno
    this.sqlState = err.sqlState
    this.sqlMessage = err.message
  }
}

export class WireClient {
  readonly #server: ServerEnd
  readonly #caps: Capabilities
  readonly connectionId: number
  /** The status flags of the last OK or EOF: whether backslashes escape (SERVER_STATUS.NO_BACKSLASH_ESCAPES). */
  #status = 0
  #closed = false

  private constructor(server: ServerEnd, caps: Capabilities, connectionId: number) {
    this.#server = server
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
    const [greeting] = packetsOf(server.take())
    if (greeting === undefined) throw new Error('the server sent no greeting')
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
    let seq = 1
    let reply = await exchange(server, frame(w.toBytes(), seq++))
    for (;;) {
      const packet = reply[0]
      if (packet === undefined) throw new Error('the server sent nothing during authentication')
      seq++
      if (packet[0] === OK) {
        const client = new WireClient(server, caps, hello.connectionId)
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
        reply = await exchange(server, frame(await scramble(name, password, nonce), seq++))
        continue
      }
      if (packet[0] === 0x01 && packet[1] === 3) {
        // AuthMoreData 3: caching_sha2's fast path succeeded; its OK follows.
        reply = reply.slice(1)
        continue
      }
      if (packet[0] === 0x01 && packet[1] === 4) {
        // AuthMoreData 4: the password itself, which an in-process channel may carry.
        reply = await exchange(server, frame(concat([password, new Uint8Array([0])]), seq++))
        continue
      }
      throw new Error(`unexpected packet 0x${(packet[0] ?? 0).toString(16)} during authentication`)
    }
  }

  /** COM_QUERY: every result it produced, in order. */
  async query(sql: Uint8Array): Promise<WireResult[]> {
    const w = new Writer(sql.length + 3)
    w.u8(COM.QUERY)
    // CLIENT_QUERY_ATTRIBUTES: no attributes, in one set.
    if (hasCap(this.#caps, CLIENT.QUERY_ATTRIBUTES)) {
      w.lenEncInt(0)
      w.lenEncInt(1)
    }
    w.bytes(sql)
    return this.#results(await this.#command(w.toBytes()))
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
    if (this.#closed) throw new Error('the connection is closed')
    return exchange(this.#server, frame(payload, 0))
  }

  #results(packets: readonly Uint8Array[]): WireResult[] {
    const out: WireResult[] = []
    let at = 0
    for (;;) {
      const head = packets[at++]
      if (head === undefined) throw new Error('the server ended a response early')
      if (head[0] === ERR) throw new WireError(parseErr(head, this.#caps))
      if (head[0] === OK) {
        const ok = parseOk(head, this.#caps)
        this.#status = ok.statusFlags
        out.push({ kind: 'ok', ok })
        if ((ok.statusFlags & SERVER_STATUS.MORE_RESULTS_EXISTS) === 0) return out
        continue
      }
      if (head[0] === LOCAL_INFILE) throw new Error('LOAD DATA LOCAL is not served by this client')
      const count = Number(new Reader(head).lenEncInt() ?? 0n)
      const columns: ColumnDefinition[] = []
      for (let i = 0; i < count; i++) columns.push(parseColumnDefinition41(packets[at++] as Uint8Array))
      at++ // the EOF after the columns
      const rows: Uint8Array[] = []
      for (;;) {
        const row = packets[at++]
        if (row === undefined) throw new Error('the server ended a result set early')
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

/** One payload as packets on the wire, split at 16 MB, from sequence `seq`. */
function frame(payload: Uint8Array, seq: number): Uint8Array {
  const parts: Uint8Array[] = []
  let offset = 0
  for (;;) {
    const chunk = Math.min(MAX_PAYLOAD, payload.length - offset)
    const out = new Uint8Array(HEADER + chunk)
    out[0] = chunk & 0xff
    out[1] = (chunk >> 8) & 0xff
    out[2] = (chunk >> 16) & 0xff
    out[3] = seq++ & 0xff
    out.set(payload.subarray(offset, offset + chunk), HEADER)
    parts.push(out)
    offset += chunk
    if (chunk < MAX_PAYLOAD) break
  }
  return parts.length === 1 ? (parts[0] as Uint8Array) : concat(parts)
}

/** Send, and split the whole answer into payloads, joining any split at 16 MB. */
async function exchange(server: ServerEnd, bytes: Uint8Array): Promise<Uint8Array[]> {
  await server.feed(bytes)
  return packetsOf(server.take())
}

function packetsOf(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = []
  let pending: Uint8Array[] = []
  let at = 0
  while (at + HEADER <= bytes.length) {
    const length = (bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16)
    const body = bytes.subarray(at + HEADER, at + HEADER + length)
    at += HEADER + length
    pending.push(body)
    if (length === MAX_PAYLOAD) continue
    out.push(pending.length === 1 ? (pending[0] as Uint8Array) : concat(pending))
    pending = []
  }
  return out
}

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
