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
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false

  // Bytes are enqueued as the connection queues them, while the reader has
  // room; a full queue leaves them in the connection, where a streamed
  // resultset waits for the reader to pull (M5.40).
  function flush(): void {
    if (controller === null || closed) return
    if ((controller.desiredSize ?? 1) > 0) {
      const out = connection.take()
      if (out.length > 0) controller.enqueue(out)
    }
    if (connection.closed) close()
  }

  function close(): void {
    if (closed) return
    const out = connection.take()
    if (out.length > 0) controller?.enqueue(out)
    closed = true
    try {
      controller?.close()
    } catch {
      // Already closed; closing twice is not an error worth surfacing.
    }
  }

  const readable = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
        connection.onOutput(() => queueMicrotask(flush))
        connection.start()
        flush()
      },
      pull() {
        flush()
      },
      cancel() {
        closed = true
        connection.close()
      },
    },
    // Counted in bytes, so the reader's room is what a transport's would be.
    { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
  )

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      await connection.feed(chunk)
      flush()
    },
    close() {
      close()
      connection.close()
    },
    abort() {
      close()
      connection.close()
    },
  })

  return { readable, writable }
}

/** M6.1 will answer `opfs://` here; until then a path is refused rather than silently kept in memory. */
export async function openPathVfs(path: string): Promise<{ vfs: Vfs; lock: Lock }> {
  throw new VfsError('VFS_UNSUPPORTED', `${path}: persistent storage in the browser is M6's OPFS VFS; use ':memory:' until then`)
}
