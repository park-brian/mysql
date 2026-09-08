// M1.12–M1.15 — the server side of the auth exchange.
//
// A small explicit state machine, because the exchange has real branches and
// the desynchronisation failures are all "we sent the right bytes in the wrong
// packet". It emits *packet payloads*; the connection frames them, so the
// sequence-id rule stays entirely in the framer (M1.2).

import { Writer } from '@myjs/bytes'
import { concat, rsaDecrypt, xorRotating, type RsaKeyPair } from '../crypto.ts'
import { messages } from '../errors/messages.ts'
import { errnoOf, sqlStateOf } from '../errors/index.ts'
import {
  SHA2,
  writeAuthMoreData,
  writeAuthSwitchRequest,
} from './framing.ts'
import {
  DUMMY_ACCOUNT_PASSWORD,
  isEmptyPasswordResponse,
  makeAccount,
  verifyCleartext,
  verifyNative,
  verifySha2Scramble,
  type Account,
  type AccountStore,
  type AuthPluginName,
} from './accounts.ts'
import type { HandshakeResponse41 } from '../packets/handshake.ts'
import { utf8 } from '../text.ts'

export type AuthStep =
  | { readonly status: 'continue'; readonly send: readonly Uint8Array[] }
  | { readonly status: 'success'; readonly send: readonly Uint8Array[]; readonly user: string }
  | {
      readonly status: 'failure'
      readonly errno: number
      readonly sqlState: string
      readonly message: string
    }

/**
 * Which accounts have authenticated at least once.
 *
 * This is what makes the fast path fast, and what makes M1.14 testable: a
 * fresh, uncached account must take the full path, so the cache has to be a
 * real thing that can be empty rather than an optimisation we skip.
 */
export class Sha2Cache {
  readonly #cached = new Set<string>()

  has(user: string): boolean {
    return this.#cached.has(user)
  }

  add(user: string): void {
    this.#cached.add(user)
  }

  clear(): void {
    this.#cached.clear()
  }

  get size(): number {
    return this.#cached.size
  }
}

/**
 * M1.15 — failure rate-limiting on the TCP path.
 *
 * MySQL blocks a host after `max_connect_errors`; this adds an escalating
 * delay first, because the delay is what actually costs an online guesser
 * anything. The clock and the sleep are injectable so the tests are not slow.
 */
export interface FailureLimiterOptions {
  readonly maxFailures?: number
  readonly windowMs?: number
  readonly delayStepMs?: number
  readonly maxDelayMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

export class FailureLimiter {
  readonly maxFailures: number
  readonly windowMs: number
  readonly delayStepMs: number
  readonly maxDelayMs: number
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>
  readonly #failures = new Map<string, number[]>()

  constructor(options: FailureLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 100
    this.windowMs = options.windowMs ?? 60_000
    this.delayStepMs = options.delayStepMs ?? 100
    this.maxDelayMs = options.maxDelayMs ?? 2_000
    this.#now = options.now ?? (() => Date.now())
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  #recent(key: string): number[] {
    const cutoff = this.#now() - this.windowMs
    const kept = (this.#failures.get(key) ?? []).filter((t) => t >= cutoff)
    this.#failures.set(key, kept)
    return kept
  }

  failureCount(key: string): number {
    return this.#recent(key).length
  }

  isBlocked(key: string): boolean {
    return this.#recent(key).length >= this.maxFailures
  }

  /** Delay in proportion to recent failures, before answering at all. */
  async gate(key: string): Promise<void> {
    const n = this.#recent(key).length
    if (n === 0) return
    await this.#sleep(Math.min(n * this.delayStepMs, this.maxDelayMs))
  }

  recordFailure(key: string): void {
    this.#recent(key).push(this.#now())
  }

  recordSuccess(key: string): void {
    this.#failures.delete(key)
  }
}

export interface AuthenticatorOptions {
  readonly accounts: AccountStore
  readonly scramble: Uint8Array
  /**
   * D-11: an in-process connection is treated as already secure, so the full
   * path degenerates to compare-and-go — no RSA, no key management. A `wss://`
   * bridge is secure at a lower layer too (doc 17). This is deliberately *not*
   * `CLIENT_SSL`: the flag describes the negotiation, this describes the
   * channel.
   */
  readonly secureChannel: boolean
  /** Required only for the RSA branch, which is the TCP listener's alone. */
  readonly rsa?: RsaKeyPair | null
  readonly cache?: Sha2Cache
  /**
   * Treat every known account as already cached, so the fast path always
   * applies and the full path is never entered.
   *
   * This is what makes D-11's "in-process connections ... never touch RSA"
   * true against a real client rather than only against our own. `mysql2`
   * decides whether a channel is secure from `config.ssl || config.socketPath`
   * (`lib/auth_plugins/caching_sha2_password.js`), and a stream-based
   * connection has neither — so on `0x04` it would request a public key and
   * encrypt, no matter what the server believes about the channel.
   *
   * It weakens nothing: the fast path still verifies the scramble against the
   * stored digest, so a wrong password fails exactly as before. All it skips
   * is "has this account connected once already", which is a round-trip
   * optimisation for a network and means nothing in-process.
   */
  readonly assumeCached?: boolean
  readonly limiter?: FailureLimiter
  /** Identifies the peer for rate-limiting and for the access-denied message. */
  readonly clientHost?: string
}

type State =
  | 'initial'
  | 'awaiting-switch-response'
  | 'awaiting-full-auth'
  | 'awaiting-encrypted-password'
  | 'done'

export class ServerAuthenticator {
  readonly #options: AuthenticatorOptions
  readonly #cache: Sha2Cache
  #state: State = 'initial'
  #account: Account | null = null
  #userExists = false
  #user = ''
  #plugin: AuthPluginName = 'caching_sha2_password'

  constructor(options: AuthenticatorOptions) {
    this.#options = options
    this.#cache = options.cache ?? new Sha2Cache()
  }

  get state(): State {
    return this.#state
  }

  get user(): string {
    return this.#user
  }

  /** The scramble, plus the trailing NUL an AuthSwitchRequest carries. */
  #pluginData(): Uint8Array {
    return concat([this.#options.scramble, new Uint8Array([0])])
  }

  #denied(): AuthStep {
    this.#state = 'done'
    const host = this.#options.clientHost ?? 'localhost'
    this.#options.limiter?.recordFailure(host)
    // M1.15: identical bytes whether the user is unknown or the password is
    // wrong. The message names the user the client claimed, exactly as MySQL's
    // does, and says nothing about whether it exists.
    return {
      status: 'failure',
      errno: errnoOf('ER_ACCESS_DENIED_ERROR'),
      sqlState: sqlStateOf('ER_ACCESS_DENIED_ERROR'),
      message: messages.accessDenied(this.#user, host),
    }
  }

  #succeed(extra: readonly Uint8Array[] = []): AuthStep {
    this.#state = 'done'
    this.#options.limiter?.recordSuccess(this.#options.clientHost ?? 'localhost')
    if (this.#userExists) this.#cache.add(this.#user)
    return { status: 'success', send: extra, user: this.#user }
  }

  /**
   * Begin from the client's `HandshakeResponse41`.
   *
   * The unknown-user path computes against a dummy account rather than
   * returning early, so an attacker cannot enumerate usernames by timing
   * (M1.15).
   */
  async begin(response: HandshakeResponse41): Promise<AuthStep> {
    this.#user = response.username
    const host = this.#options.clientHost ?? 'localhost'
    if (this.#options.limiter?.isBlocked(host) === true) return this.#denied()
    await this.#options.limiter?.gate(host)

    const found = this.#options.accounts.get(response.username)
    this.#userExists = found !== undefined
    this.#account = found ?? (await makeAccount(response.username, DUMMY_ACCOUNT_PASSWORD))
    this.#plugin = this.#account.plugin

    if (response.clientPluginName !== this.#plugin) {
      // The client guessed a different plugin — switch it. This is the step
      // that, half-implemented, produces the classic out-of-order symptom.
      this.#state = 'awaiting-switch-response'
      const w = new Writer(64)
      writeAuthSwitchRequest(w, this.#plugin, this.#pluginData())
      return { status: 'continue', send: [w.toBytes()] }
    }
    return this.#verifyInitial(response.authResponse)
  }

  /** Feed the next client packet in the exchange. */
  async next(payload: Uint8Array): Promise<AuthStep> {
    switch (this.#state) {
      case 'awaiting-switch-response':
        // AuthSwitchResponse is raw plugin output with no header at all.
        return this.#verifyInitial(payload)
      case 'awaiting-full-auth':
        return this.#fullAuth(payload)
      case 'awaiting-encrypted-password':
        return this.#decryptAndVerify(payload)
      default:
        return this.#denied()
    }
  }

  async #verifyInitial(response: Uint8Array): Promise<AuthStep> {
    const account = this.#account
    if (account === null) return this.#denied()

    if (this.#plugin === 'mysql_native_password') {
      const ok = await verifyNative(account, this.#options.scramble, response)
      return ok && this.#userExists ? this.#succeed() : this.#denied()
    }

    // caching_sha2_password.

    // The empty-password short-circuit sends **no marker at all**. The C
    // client, having sent an empty response, returns from its plugin
    // immediately and expects the next packet to be the final OK or ERR — so a
    // `fast_auth_success` here is read as a malformed packet
    // (`ERROR 2027 (HY000)`) rather than as a step in the exchange. `mysql2`
    // happens to tolerate it, which is exactly why this needed a real C client
    // to find. Recorded as E-10.
    if (isEmptyPasswordResponse(response)) {
      if (!account.emptyPassword || !this.#userExists) return this.#denied()
      return this.#succeed()
    }

    if (this.#options.assumeCached === true || this.#cache.has(this.#user)) {
      const ok = await verifySha2Scramble(account, this.#options.scramble, response)
      if (!ok || !this.#userExists) return this.#denied()
      // M1.12: `0x03` is sent as its **own packet before** the OK. A client
      // expecting OK immediately would desync — and does not.
      return this.#succeed([fastAuthSuccess()])
    }

    // Cache miss: the client must prove the password itself.
    this.#state = 'awaiting-full-auth'
    return { status: 'continue', send: [performFullAuthentication()] }
  }

  async #fullAuth(payload: Uint8Array): Promise<AuthStep> {
    // A single 0x02 means "send me your public key" — the client was not
    // configured with it in advance.
    if (payload.length === 1 && payload[0] === SHA2.REQUEST_SERVER_KEY) {
      const rsa = this.#options.rsa
      if (rsa === undefined || rsa === null) {
        // Nothing to offer. Refusing beats hanging.
        return this.#denied()
      }
      this.#state = 'awaiting-encrypted-password'
      const w = new Writer(600)
      writeAuthMoreData(w, utf8(rsa.publicKeyPem))
      return { status: 'continue', send: [w.toBytes()] }
    }

    if (this.#options.secureChannel) {
      // D-11: already secure, so the client sent `password ‖ 0x00` in the
      // clear and this degenerates to compare-and-go.
      return this.#verifyCleartext(payload)
    }
    return this.#decryptAndVerify(payload)
  }

  async #decryptAndVerify(ciphertext: Uint8Array): Promise<AuthStep> {
    const rsa = this.#options.rsa
    if (rsa === undefined || rsa === null) return this.#denied()
    let obscured: Uint8Array
    try {
      obscured = await rsaDecrypt(rsa.privateKey, ciphertext)
    } catch {
      // A wrong key or corrupt ciphertext is a failed login, not a crash.
      return this.#denied()
    }
    // The client XORs the password with the nonce before encrypting, and the
    // nonce repeats because the password may be longer than 20 bytes.
    return this.#verifyCleartext(xorRotating(obscured, this.#options.scramble))
  }

  async #verifyCleartext(passwordWithNul: Uint8Array): Promise<AuthStep> {
    const account = this.#account
    if (account === null) return this.#denied()
    const ok = await verifyCleartext(account, passwordWithNul)
    if (!ok || !this.#userExists) return this.#denied()
    // No `0x03` here. `fast_auth_success` belongs to the *fast* path alone:
    // having completed full authentication, the client is in its final state
    // and expects the OK packet next. `mysql2` rejects a further AuthMoreData
    // outright ("Unexpected data in AuthMoreData packet ... in STATE_FINAL"),
    // and a real server sends only the OK.
    return this.#succeed()
  }
}

/** `AuthMoreData` carrying `0x03` — its own packet, before the OK. */
export function fastAuthSuccess(): Uint8Array {
  const w = new Writer(2)
  writeAuthMoreData(w, new Uint8Array([SHA2.FAST_AUTH_SUCCESS]))
  return w.toBytes()
}

/** `AuthMoreData` carrying `0x04`. */
export function performFullAuthentication(): Uint8Array {
  const w = new Writer(2)
  writeAuthMoreData(w, new Uint8Array([SHA2.PERFORM_FULL_AUTHENTICATION]))
  return w.toBytes()
}
