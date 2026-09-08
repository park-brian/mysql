// M1.24 — one client connection, from HandshakeV10 to COM_QUIT.
//
// This is the object doc 43 §3's replay harness describes:
// `server.feed(bytes)` / `server.take()`, with a fixed nonce and user so a
// captured trace can be compared byte for byte. `execProtocol` (D-28) is that
// pair with a promise around it, so the public API and the test harness are
// the same object rather than two implementations that can drift.
//
// Deviation from doc 43 §3's snippet: `feed` is async, because authentication
// is. The snippet is illustrative JS in a design doc; the replay tests await.

import {
  CLIENT,
  MYSQL_NATIVE_PASSWORD,
  PacketFramer,
  SERVER_ADVERTISED_CAPABILITIES,
  SCRAMBLE_LENGTH,
  ServerAuthenticator,
  Session,
  Sha2Cache,
  capabilities,
  dispatch,
  errnoOf,
  hasCap,
  negotiate,
  parseComChangeUser,
  parseHandshakeResponse,
  sqlStateOf,
  webCryptoRandom,
  writeErr,
  writeHandshakeV10,
  writeOk,
  type AccountStore,
  type Capabilities,
  type Executor,
  type FailureLimiter,
  type HandshakeResponse41,
  type RandomSource,
  type RsaKeyPair,
} from '@myjs/protocol'
import { MyjsError, ProtocolError, Writer } from '@myjs/bytes'
import { charsetTranscoder } from './transcoder.ts'

export const DEFAULT_SERVER_VERSION = '8.4.0-myjs-0.1.0'

export interface ConnectionOptions {
  readonly executor: Executor
  readonly accounts: AccountStore
  readonly connectionId?: number
  readonly serverVersion?: string
  /**
   * D-11 / doc 17: in-process and `wss://` connections are already secure, so
   * the full auth path degenerates to compare-and-go. Deliberately not
   * `CLIENT_SSL` — that flag describes the negotiation, this describes the
   * channel.
   */
  readonly secureChannel?: boolean
  /** See `AuthenticatorOptions.assumeCached`. Defaults to `secureChannel`. */
  readonly assumeCached?: boolean
  readonly advertisedCapabilities?: Capabilities
  readonly random?: RandomSource
  readonly rsa?: RsaKeyPair | null
  readonly cache?: Sha2Cache
  readonly limiter?: FailureLimiter
  readonly clientHost?: string
  /** D-13: honoured only when the engine switch is on. Defaults off. */
  readonly multipleStatements?: boolean
  readonly maxAllowedPacket?: number
  readonly cursorTimeoutMs?: number
  readonly now?: () => number
}

type Phase = 'new' | 'awaiting-handshake-response' | 'authenticating' | 'command' | 'closed'

export class ProtocolConnection {
  readonly connectionId: number
  readonly scramble: Uint8Array

  readonly #options: ConnectionOptions
  readonly #framer: PacketFramer
  readonly #out: Uint8Array[] = []
  readonly #cache: Sha2Cache
  #phase: Phase = 'new'
  #capabilities: Capabilities = capabilities(0)
  #session: Session | null = null
  #auth: ServerAuthenticator | null = null

  constructor(options: ConnectionOptions) {
    this.#options = options
    this.connectionId = options.connectionId ?? 1
    this.#cache = options.cache ?? new Sha2Cache()
    this.#framer = new PacketFramer(
      options.maxAllowedPacket === undefined ? {} : { maxAllowedPacket: options.maxAllowedPacket },
    )
    const random = options.random ?? webCryptoRandom
    this.scramble = random.getRandomValues(new Uint8Array(SCRAMBLE_LENGTH))
  }

  get closed(): boolean {
    return this.#phase === 'closed'
  }

  get session(): Session | null {
    return this.#session
  }

  get negotiatedCapabilities(): Capabilities {
    return this.#capabilities
  }

  /** Emit `HandshakeV10`. Must be called once, before any client bytes. */
  start(): void {
    if (this.#phase !== 'new') return
    const advertised = this.#options.advertisedCapabilities ?? SERVER_ADVERTISED_CAPABILITIES
    const w = new Writer(128)
    writeHandshakeV10(w, {
      serverVersion: this.#options.serverVersion ?? DEFAULT_SERVER_VERSION,
      connectionId: this.connectionId,
      scramble: this.scramble,
      capabilities: advertised,
    })
    this.#send(w.toBytes())
    this.#phase = 'awaiting-handshake-response'
  }

  /** Frame and queue one packet payload for sending. */
  #send(payload: Uint8Array): void {
    this.#out.push(this.#framer.encode(payload))
  }

  /** Everything queued for the client since the last call. */
  take(): Uint8Array {
    if (this.#out.length === 0) return new Uint8Array(0)
    let total = 0
    for (const chunk of this.#out) total += chunk.length
    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of this.#out) {
      out.set(chunk, at)
      at += chunk.length
    }
    this.#out.length = 0
    return out
  }

  /** Push client bytes; any complete packets they form are processed. */
  async feed(chunk: Uint8Array): Promise<void> {
    if (this.#phase === 'new') this.start()
    if (this.#phase === 'closed') return
    this.#framer.feed(chunk)
    await this.#pump()
  }

  /** D-28: bytes in, every response byte out. */
  async execProtocol(request: Uint8Array): Promise<Uint8Array> {
    await this.feed(request)
    return this.take()
  }

  async #pump(): Promise<void> {
    for (;;) {
      if (this.#phase === 'closed') return
      // The sequence resets per command, and runs continuously through the
      // whole connection phase (doc 10). Resetting here — before the framer
      // validates the header — is the entire rule.
      if (this.#phase === 'command') this.#framer.resetSequence()

      let payload: Uint8Array | null
      try {
        payload = this.#framer.next()
      } catch (err) {
        this.#fail(err)
        return
      }
      if (payload === null) return

      try {
        await this.#handle(payload)
      } catch (err) {
        this.#fail(err)
        return
      }
    }
  }

  async #handle(payload: Uint8Array): Promise<void> {
    switch (this.#phase) {
      case 'awaiting-handshake-response':
        return this.#onHandshakeResponse(payload)
      case 'authenticating':
        return this.#onAuthPacket(payload)
      case 'command':
        return this.#onCommand(payload)
      default:
        return
    }
  }

  async #onHandshakeResponse(payload: Uint8Array): Promise<void> {
    const parsed = parseHandshakeResponse(payload)
    if (parsed.kind === 'ssl-request') {
      // TLS is the TCP listener's business (D-12); a core connection has no
      // channel to secure, and saying so beats a hang.
      this.#writeErr('ER_NOT_SUPPORTED_YET', 'TLS is not available on this connection')
      this.#phase = 'closed'
      return
    }

    const advertised = this.#options.advertisedCapabilities ?? SERVER_ADVERTISED_CAPABILITIES
    this.#capabilities = negotiate(parsed.capabilities, advertised)
    this.#session = new Session({
      connectionId: this.connectionId,
      capabilities: this.#capabilities,
      user: parsed.username,
      database: parsed.database,
      characterSet: parsed.characterSet,
      // M2.18 / D-33: `@myjs/protocol` cannot depend on `@myjs/charsets`, so
      // the real transcoder is supplied from here, where both are available.
      transcoder: charsetTranscoder,
      // D-13: the negotiated flag AND the engine switch.
      multipleStatements:
        (this.#options.multipleStatements ?? false) && hasCap(this.#capabilities, CLIENT.MULTI_STATEMENTS),
      ...(this.#options.maxAllowedPacket === undefined
        ? {}
        : { maxAllowedPacket: this.#options.maxAllowedPacket }),
    })
    for (const [k, v] of parsed.connectAttrs) this.#session.connectAttrs.set(k, v)

    this.#auth = this.#makeAuthenticator()
    await this.#applyAuthStep(await this.#auth.begin(parsed))
  }

  #makeAuthenticator(): ServerAuthenticator {
    const o = this.#options
    return new ServerAuthenticator({
      accounts: o.accounts,
      scramble: this.scramble,
      secureChannel: o.secureChannel ?? true,
      // In-process and wss:// take the fast path outright, so RSA is never
      // reached (D-11). A TCP listener passes secureChannel: false and gets
      // the real cache, so M1.14's fresh-uncached-account path stays real.
      assumeCached: o.assumeCached ?? (o.secureChannel ?? true),
      cache: this.#cache,
      ...(o.rsa === undefined ? {} : { rsa: o.rsa }),
      ...(o.limiter === undefined ? {} : { limiter: o.limiter }),
      ...(o.clientHost === undefined ? {} : { clientHost: o.clientHost }),
    })
  }

  async #onAuthPacket(payload: Uint8Array): Promise<void> {
    const auth = this.#auth
    if (auth === null) {
      this.#writeErr('ER_ACCESS_DENIED_ERROR', 'authentication is not in progress')
      this.#phase = 'closed'
      return
    }
    await this.#applyAuthStep(await auth.next(payload))
  }

  async #applyAuthStep(step: Awaited<ReturnType<ServerAuthenticator['begin']>>): Promise<void> {
    if (step.status === 'failure') {
      const w = new Writer(96)
      writeErr(w, this.#capabilities, {
        errno: step.errno,
        sqlState: step.sqlState,
        message: step.message,
      })
      this.#send(w.toBytes())
      this.#phase = 'closed'
      return
    }

    for (const packet of step.send) this.#send(packet)

    if (step.status === 'continue') {
      this.#phase = 'authenticating'
      return
    }

    // Success. The OK is a *separate* packet after any AuthMoreData — M1.12's
    // whole point, and the reason `send` is a list.
    const session = this.#session
    if (session !== null) session.user = step.user
    const ok = new Writer(32)
    writeOk(ok, this.#capabilities, { statusFlags: session?.statusFlags ?? 0 })
    this.#send(ok.toBytes())
    this.#phase = 'command'
  }

  async #onCommand(payload: Uint8Array): Promise<void> {
    const session = this.#session
    if (session === null) {
      this.#phase = 'closed'
      return
    }
    const result = await dispatch(payload, {
      session,
      executor: this.#options.executor,
      capabilities: this.#capabilities,
      ...(this.#options.cursorTimeoutMs === undefined
        ? {}
        : { cursorTimeoutMs: this.#options.cursorTimeoutMs }),
      ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
    })

    for (const packet of result.packets) this.#send(packet)
    if (result.close === true) {
      this.#phase = 'closed'
      return
    }
    if (result.changeUser !== undefined) {
      await this.#onChangeUser(result.changeUser)
    }
  }

  /**
   * `COM_CHANGE_USER` re-enters the connection phase.
   *
   * Its auth exchange continues from *this command's* sequence 0 rather than
   * resetting again — the one place the per-command reset and the continuous
   * connection-phase numbering meet.
   */
  async #onChangeUser(payload: Uint8Array): Promise<void> {
    const changed = parseComChangeUser(payload, this.#capabilities)
    const session = this.#session
    if (session !== null) {
      session.reset()
      session.user = changed.username
      session.database = changed.database
      if (changed.characterSet !== 0) session.characterSet = changed.characterSet
      for (const [k, v] of changed.connectAttrs) session.connectAttrs.set(k, v)
    }
    const synthesised: HandshakeResponse41 = {
      kind: 'handshake-response',
      capabilities: this.#capabilities,
      maxPacketSize: session?.maxAllowedPacket ?? 0,
      characterSet: changed.characterSet,
      username: changed.username,
      authResponse: changed.authResponse,
      database: changed.database,
      clientPluginName: changed.clientPluginName === '' ? MYSQL_NATIVE_PASSWORD : changed.clientPluginName,
      connectAttrs: changed.connectAttrs,
      zstdLevel: null,
    }
    this.#auth = this.#makeAuthenticator()
    await this.#applyAuthStep(await this.#auth.begin(synthesised))
  }

  #writeErr(symbol: string, message: string): void {
    const w = new Writer(96)
    writeErr(w, this.#capabilities, {
      errno: errnoOf(symbol),
      sqlState: sqlStateOf(symbol),
      message,
    })
    this.#send(w.toBytes())
  }

  /** A framing or parse fault ends the connection, after saying why. */
  #fail(err: unknown): void {
    if (err instanceof ProtocolError || err instanceof MyjsError) {
      const w = new Writer(96)
      writeErr(w, this.#capabilities, {
        errno: err.errno ?? errnoOf('ER_MALFORMED_PACKET'),
        sqlState: err.sqlState ?? sqlStateOf('ER_MALFORMED_PACKET'),
        message: err.message,
      })
      this.#send(w.toBytes())
      this.#phase = 'closed'
      return
    }
    throw err
  }
}
