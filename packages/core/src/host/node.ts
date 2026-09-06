// D-27 — the Node host adapter.
//
// This file is one of the three the isomorphic lint gate exempts, and the
// reason is concrete rather than a matter of taste: `mysql2`'s PacketParser
// calls `chunk.copy(...)` on the buffers it receives from a stream's `data`
// events, and `copy` is a `Buffer` method that `Uint8Array` does not have. A
// duplex that hands mysql2 plain `Uint8Array`s therefore cannot work, however
// carefully it duck-types the rest of the interface.
//
// Keeping that fact in one file behind a package export condition is what lets
// every other module stay provably portable.
import { Duplex } from 'node:stream'
import type { ProtocolConnection } from '../connection.ts'

/**
 * A duplex stream of MySQL packets, suitable for
 * `mysql2.createConnection({ stream })`.
 *
 * Doc 42: "`mysql2` does not know there is no socket."
 */
export function createNodeStream(connection: ProtocolConnection): Duplex {
  let ended = false

  const stream = new Duplex({
    read() {
      // Nothing to pull: bytes are pushed as the connection produces them.
    },
    write(chunk: Buffer | Uint8Array, _encoding, callback) {
      connection
        .feed(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        .then(() => {
          flush()
          callback()
        })
        .catch(callback)
    },
    final(callback) {
      finish()
      callback()
    },
  })

  function flush(): void {
    const out = connection.take()
    if (out.length > 0) stream.push(Buffer.from(out))
    if (connection.closed) finish()
  }

  function finish(): void {
    if (ended) return
    ended = true
    stream.push(null)
  }

  // The server speaks first: HandshakeV10 is queued before any client byte.
  connection.start()
  flush()
  return stream
}
