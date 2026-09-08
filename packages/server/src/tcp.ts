// M1.24 — `serve()`.
//
// Doc 42: "`serve()` defaults to `127.0.0.1` and **requires** a configured
// user and password before it will bind to anything else. An embedded database
// that silently listens on `0.0.0.0` would be a vulnerability, not a feature."
//
// This is also the only transport where the RSA branch of
// `caching_sha2_password` is reachable: a plain TCP socket is not a secure
// channel, so D-11's compare-and-go shortcut does not apply (M1.14).

import net from 'node:net'
import {
  FailureLimiter,
  generateRsaKeyPair,
  Sha2Cache,
  type AccountStore,
  type RsaKeyPair,
} from '@myjs/protocol'
import type { MySQL } from '@myjs/core'

export interface ServeOptions {
  readonly port?: number
  readonly host?: string
  readonly accounts?: AccountStore
  /** Reused across connections; generated on first bind if absent. */
  readonly rsa?: RsaKeyPair
  readonly limiter?: FailureLimiter
  /**
   * Bind to a non-loopback address even though an account has no password.
   *
   * There is deliberately no way to do this by accident. Anyone setting it is
   * saying, in the code, that the network they are on makes it safe.
   */
  readonly allowInsecureBind?: boolean
  readonly cursorTimeoutMs?: number
}

export interface Server {
  readonly host: string
  readonly port: number
  readonly connections: number
  close(): Promise<void>
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'])

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host)
}

export class InsecureBindError extends Error {
  constructor(host: string, reason: string) {
    super(
      `refusing to bind to ${host}: ${reason}. ` +
        'Configure an account with a password, bind to 127.0.0.1, or pass allowInsecureBind.',
    )
    this.name = 'InsecureBindError'
  }
}

export async function serve(db: MySQL, options: ServeOptions = {}): Promise<Server> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3306
  const accounts = options.accounts ?? db.accounts

  if (!isLoopback(host) && options.allowInsecureBind !== true) {
    // The check is on the accounts themselves, not on whether the caller
    // remembered to pass an `accounts` option: a store full of passwordless
    // users is exactly as dangerous however it arrived.
    const listable = accounts.list?.()
    if (listable === undefined) {
      throw new InsecureBindError(host, 'this account store cannot be inspected for empty passwords')
    }
    const all = [...listable]
    if (all.length === 0) {
      throw new InsecureBindError(host, 'no accounts are configured')
    }
    const passwordless = all.filter((a) => a.emptyPassword).map((a) => a.user)
    if (passwordless.length > 0) {
      throw new InsecureBindError(host, `these accounts have no password: ${passwordless.join(', ')}`)
    }
  }

  // One key pair per listener, and only for this transport: an in-process
  // connection never reaches the RSA branch at all (D-11).
  const rsa = options.rsa ?? (await generateRsaKeyPair(2048))
  const cache = new Sha2Cache()
  const limiter = options.limiter ?? new FailureLimiter()

  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.setNoDelay(true)

    const connection = db.createConnection({
      accounts,
      // A plain TCP socket is not secure, so the full auth path really does
      // have to do RSA.
      secureChannel: false,
      rsa,
      cache,
      limiter,
      clientHost: socket.remoteAddress ?? 'unknown',
      ...(options.cursorTimeoutMs === undefined ? {} : { cursorTimeoutMs: options.cursorTimeoutMs }),
    })

    const flush = (): void => {
      const out = connection.take()
      if (out.length > 0) socket.write(Buffer.from(out))
      // COM_QUIT: the server just closes, having written nothing.
      if (connection.closed) socket.end()
    }

    connection.start()
    flush()

    socket.on('data', (chunk: Buffer) => {
      connection
        .feed(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        .then(flush)
        .catch(() => socket.destroy())
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const boundPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    host,
    port: boundPort,
    get connections() {
      return sockets.size
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
