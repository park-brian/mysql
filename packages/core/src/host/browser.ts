// D-27 — the browser host adapter.
//
// Browsers have no Node streams, so this exposes the same connection through
// Web Streams. A bundler that polyfills `Buffer` for `mysql2` can still use
// the Node adapter; this is the dependency-free path for everything else,
// including the `wss://` bridge (doc 17), where the transport is secure at a
// lower layer and `CLIENT_SSL` stays off.
import type { ProtocolConnection } from '../connection.ts'

export interface WebDuplex {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
}

export function createWebStream(connection: ProtocolConnection): WebDuplex {
  let push: ((chunk: Uint8Array) => void) | null = null
  let close: (() => void) | null = null

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => controller.enqueue(chunk)
      close = () => {
        try {
          controller.close()
        } catch {
          // Already closed; closing twice is not an error worth surfacing.
        }
      }
      connection.start()
      const initial = connection.take()
      if (initial.length > 0) controller.enqueue(initial)
    },
  })

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      await connection.feed(chunk)
      const out = connection.take()
      if (out.length > 0) push?.(out)
      if (connection.closed) close?.()
    },
    close() {
      close?.()
    },
  })

  return { readable, writable }
}
