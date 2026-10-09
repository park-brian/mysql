// D-27 — the browser host adapter.
//
// Browsers have no Node streams, so this exposes the same connection through
// Web Streams. A bundler that polyfills `Buffer` for `mysql2` can still use
// the Node adapter; this is the dependency-free path for everything else,
// including the `wss://` bridge (doc 17), where the transport is secure at a
// lower layer and `CLIENT_SSL` stays off.
import { VfsError, type Lock, type Vfs } from '@myjs/vfs'
import type { ProtocolConnection } from '../connection.ts'

export interface WebDuplex {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
}

/** The stream `createStream()` returns on this host: a pair of Web Streams. */
export type DriverStream = WebDuplex

export function createStream(connection: ProtocolConnection): WebDuplex {
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
    cancel() {
      connection.close()
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
      connection.close()
    },
    abort() {
      close?.()
      connection.close()
    },
  })

  return { readable, writable }
}

/** M6.1 will answer `opfs://` here; until then a path is refused rather than silently kept in memory. */
export async function openPathVfs(path: string): Promise<{ vfs: Vfs; lock: Lock }> {
  throw new VfsError('VFS_UNSUPPORTED', `${path}: persistent storage in the browser is M6's OPFS VFS; use ':memory:' until then`)
}
