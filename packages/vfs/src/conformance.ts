// M0.9 — "a conformance suite exists that any backend must pass".
//
// Doc 40 never enumerates one, so this is the definition. It is exported from
// the package rather than living under test/ for three reasons: doc 42 lets an
// application supply its own `vfs` implementation and it should be able to
// check it; doc 43 §5's `FaultInjectingVfs` decorator wraps an arbitrary VFS,
// so the suite has to be parameterised over a factory anyway; and the OPFS and
// Node backends (M6, M4) must run this identical body rather than a copy.
//
// It carries no test-runner dependency: each case is a plain async function
// that throws on failure, and the runner wraps them.

import { VfsError, type Vfs, type VfsFile } from './vfs.ts'

export type VfsFactory = () => Vfs | Promise<Vfs>

export interface ConformanceCase {
  readonly name: string
  run(make: VfsFactory): Promise<void>
}

class ConformanceFailure extends Error {}

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConformanceFailure(message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new ConformanceFailure(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function bytesEq(actual: Uint8Array, expected: Uint8Array, message: string): void {
  if (actual.length !== expected.length) {
    throw new ConformanceFailure(`${message}: length ${actual.length} !== ${expected.length}`)
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new ConformanceFailure(`${message}: byte ${i} is ${actual[i]}, expected ${expected[i]}`)
    }
  }
}

async function throwsCode(fn: () => unknown, code: string, message: string): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof VfsError && err.code === code) return
    throw new ConformanceFailure(`${message}: threw ${String(err)} rather than ${code}`)
  }
  throw new ConformanceFailure(`${message}: did not throw ${code}`)
}

/** A page filled with a recognisable, position-dependent pattern. */
function pattern(pageSize: number, seed: number): Uint8Array {
  const page = new Uint8Array(pageSize)
  for (let i = 0; i < pageSize; i++) page[i] = (i * 31 + seed * 7) & 0xff
  return page
}

async function withFile(
  make: VfsFactory,
  body: (file: VfsFile, vfs: Vfs) => Promise<void> | void,
): Promise<void> {
  const vfs = await make()
  const file = await vfs.open('/conformance.dat', { create: true })
  try {
    await body(file, vfs)
  } finally {
    file.close()
  }
}

export const vfsConformanceCases: readonly ConformanceCase[] = [
  {
    name: 'name and durability come from the declared unions',
    async run(make) {
      const vfs = await make()
      ok(['opfs', 'node', 'memory'].includes(vfs.name), `unexpected vfs name ${vfs.name}`)
      ok(
        vfs.durability === 'strong' || vfs.durability === 'best-effort',
        `unexpected durability ${vfs.durability}`,
      )
    },
  },
  {
    name: 'open without create fails on a missing file',
    async run(make) {
      const vfs = await make()
      await throwsCode(() => vfs.open('/absent.dat', {}), 'VFS_NOT_FOUND', 'open({})')
      await throwsCode(
        () => vfs.open('/absent.dat', { create: false }),
        'VFS_NOT_FOUND',
        'open({create:false})',
      )
    },
  },
  {
    name: 'a created file starts empty and reopens with its contents',
    async run(make) {
      const vfs = await make()
      const first = await vfs.open('/reopen.dat', { create: true })
      eq(first.size(), 0, 'a fresh file is empty')
      first.writeBytes(0, new Uint8Array([1, 2, 3]))
      first.flush()
      first.close()

      const again = await vfs.open('/reopen.dat', {})
      eq(again.size(), 3, 'size survives close and reopen')
      const into = new Uint8Array(3)
      eq(again.readBytes(0, into), 3, 'readBytes returns the count read')
      bytesEq(into, new Uint8Array([1, 2, 3]), 'contents survive close and reopen')
      again.close()
    },
  },
  {
    name: 'pages round-trip',
    async run(make) {
      await withFile(make, (file) => {
        const written = pattern(file.pageSize, 1)
        file.writePage(0, written)
        file.writePage(5, pattern(file.pageSize, 2))
        const into = new Uint8Array(file.pageSize)
        file.readPage(0, into)
        bytesEq(into, written, 'page 0')
        file.readPage(5, into)
        bytesEq(into, pattern(file.pageSize, 2), 'page 5')
      })
    },
  },
  {
    name: 'a hole reads as zeros',
    async run(make) {
      await withFile(make, (file) => {
        file.writePage(3, pattern(file.pageSize, 9))
        const into = new Uint8Array(file.pageSize).fill(0xaa)
        file.readPage(1, into)
        bytesEq(into, new Uint8Array(file.pageSize), 'unwritten page 1')
      })
    },
  },
  {
    name: 'writePage copies — the caller may reuse its buffer',
    async run(make) {
      await withFile(make, (file) => {
        const scratch = pattern(file.pageSize, 4)
        file.writePage(0, scratch)
        scratch.fill(0xff)
        const into = new Uint8Array(file.pageSize)
        file.readPage(0, into)
        bytesEq(into, pattern(file.pageSize, 4), 'stored page must not alias the caller buffer')
      })
    },
  },
  {
    name: 'a page buffer of the wrong size is rejected',
    async run(make) {
      await withFile(make, async (file) => {
        await throwsCode(
          () => file.writePage(0, new Uint8Array(file.pageSize - 1)),
          'VFS_BAD_PAGE_BUFFER',
          'short writePage buffer',
        )
        await throwsCode(
          () => file.readPage(0, new Uint8Array(file.pageSize + 1)),
          'VFS_BAD_PAGE_BUFFER',
          'long readPage buffer',
        )
      })
    },
  },
  {
    name: 'byte and page views of the same file are coherent',
    async run(make) {
      await withFile(make, (file) => {
        const page = pattern(file.pageSize, 6)
        file.writePage(1, page)
        // Read the same bytes through the byte interface.
        const viaBytes = new Uint8Array(file.pageSize)
        eq(file.readBytes(file.pageSize, viaBytes), file.pageSize, 'full page via readBytes')
        bytesEq(viaBytes, page, 'writePage then readBytes')

        // And the other way round.
        file.writeBytes(2 * file.pageSize + 4, new Uint8Array([9, 8, 7]))
        const viaPage = new Uint8Array(file.pageSize)
        file.readPage(2, viaPage)
        bytesEq(viaPage.subarray(4, 7), new Uint8Array([9, 8, 7]), 'writeBytes then readPage')
      })
    },
  },
  {
    name: 'byte access spans page boundaries',
    async run(make) {
      await withFile(make, (file) => {
        const span = new Uint8Array(file.pageSize + 16)
        for (let i = 0; i < span.length; i++) span[i] = (i * 13) & 0xff
        const offset = file.pageSize - 8
        file.writeBytes(offset, span)
        const into = new Uint8Array(span.length)
        eq(file.readBytes(offset, into), span.length, 'byte count across three pages')
        bytesEq(into, span, 'contents across a page boundary')
      })
    },
  },
  {
    name: 'readBytes is short at end of file and reports the count',
    async run(make) {
      await withFile(make, (file) => {
        file.writeBytes(0, new Uint8Array([1, 2, 3, 4]))
        const into = new Uint8Array(10).fill(0xcc)
        eq(file.readBytes(2, into), 2, 'only two bytes remain past offset 2')
        bytesEq(into.subarray(0, 2), new Uint8Array([3, 4]), 'the bytes that were read')
        eq(file.readBytes(file.size() + 100, new Uint8Array(4)), 0, 'reading past the end reads nothing')
      })
    },
  },
  {
    name: 'size reflects both page and byte writes',
    async run(make) {
      await withFile(make, (file) => {
        eq(file.size(), 0, 'starts empty')
        file.writeBytes(0, new Uint8Array(10))
        eq(file.size(), 10, 'after writeBytes')
        file.writePage(1, new Uint8Array(file.pageSize))
        eq(file.size(), 2 * file.pageSize, 'after writePage grows to the page boundary')
        file.writeBytes(0, new Uint8Array(4))
        eq(file.size(), 2 * file.pageSize, 'an interior write does not shrink the file')
      })
    },
  },
  {
    name: 'truncate shrinks, zeroes the tail, and can grow',
    async run(make) {
      await withFile(make, (file) => {
        file.writePage(0, pattern(file.pageSize, 3))
        file.writePage(1, pattern(file.pageSize, 4))

        file.truncate(file.pageSize + 4)
        eq(file.size(), file.pageSize + 4, 'size after shrink')
        const into = new Uint8Array(file.pageSize)
        file.readPage(1, into)
        bytesEq(into.subarray(0, 4), pattern(file.pageSize, 4).subarray(0, 4), 'kept bytes')
        bytesEq(into.subarray(4), new Uint8Array(file.pageSize - 4), 'tail is zeroed, not stale')

        file.truncate(0)
        eq(file.size(), 0, 'truncate to zero')
        file.readPage(0, into)
        bytesEq(into, new Uint8Array(file.pageSize), 'dropped page reads as zeros')

        file.truncate(64)
        eq(file.size(), 64, 'truncate may grow, producing a hole')
        const hole = new Uint8Array(64).fill(0xaa)
        eq(file.readBytes(0, hole), 64, 'the grown region is readable')
        bytesEq(hole, new Uint8Array(64), 'the grown region reads as zeros')
      })
    },
  },
  {
    name: 'flush is a durability barrier that never throws on an open file',
    async run(make) {
      await withFile(make, (file) => {
        file.writeBytes(0, new Uint8Array([1]))
        file.flush()
        file.flush()
      })
    },
  },
  {
    name: 'every VfsFile method is synchronous once open',
    async run(make) {
      // Doc 40: "All methods are SYNCHRONOUS once the file is open — this is
      // deliberate." No await inside a page split, so nothing here may return
      // a thenable.
      const vfs = await make()
      const file = await vfs.open('/sync.dat', { create: true })
      const page = new Uint8Array(file.pageSize)
      const results: unknown[] = [
        file.writePage(0, page),
        file.readPage(0, page),
        file.writeBytes(0, new Uint8Array([1])),
        file.readBytes(0, new Uint8Array(1)),
        file.size(),
        file.truncate(1),
        file.flush(),
        file.close(),
      ]
      for (const [i, r] of results.entries()) {
        ok(
          r === undefined || typeof (r as { then?: unknown } | null)?.then !== 'function',
          `VfsFile method ${i} returned a thenable`,
        )
      }
    },
  },
  {
    name: 'a closed file rejects every operation',
    async run(make) {
      const vfs = await make()
      const file = await vfs.open('/closed.dat', { create: true })
      const page = new Uint8Array(file.pageSize)
      file.close()
      await throwsCode(() => file.readPage(0, page), 'VFS_CLOSED', 'readPage after close')
      await throwsCode(() => file.writePage(0, page), 'VFS_CLOSED', 'writePage after close')
      await throwsCode(() => file.readBytes(0, new Uint8Array(1)), 'VFS_CLOSED', 'readBytes after close')
      await throwsCode(() => file.writeBytes(0, new Uint8Array(1)), 'VFS_CLOSED', 'writeBytes after close')
      await throwsCode(() => file.size(), 'VFS_CLOSED', 'size after close')
      await throwsCode(() => file.truncate(0), 'VFS_CLOSED', 'truncate after close')
      await throwsCode(() => file.flush(), 'VFS_CLOSED', 'flush after close')
      file.close() // idempotent
    },
  },
  {
    name: 'delete removes a file, and deleting a missing one is an error',
    async run(make) {
      const vfs = await make()
      const file = await vfs.open('/gone.dat', { create: true })
      file.close()
      await vfs.delete('/gone.dat')
      await throwsCode(() => vfs.open('/gone.dat', {}), 'VFS_NOT_FOUND', 'open after delete')
      await throwsCode(() => vfs.delete('/gone.dat'), 'VFS_NOT_FOUND', 'delete twice')
    },
  },
  {
    name: 'list returns the immediate children of a directory',
    async run(make) {
      const vfs = await make()
      for (const path of ['/db/a.dat', '/db/b.dat', '/db/sub/c.dat', '/other/d.dat']) {
        ;(await vfs.open(path, { create: true })).close()
      }
      const listed = (await vfs.list('/db')).slice().sort()
      eq(listed.join(','), 'a.dat,b.dat,sub', 'immediate children only')
      eq((await vfs.list('/empty')).length, 0, 'an unknown directory lists nothing')
    },
  },
  {
    name: 'lock excludes, releases, and re-acquires',
    async run(make) {
      const vfs = await make()
      const first = await vfs.lock('/db')
      ok(first.held, 'a fresh lock is held')
      eq(first.path, '/db', 'the lock names its path')

      let secondAcquired = false
      const second = vfs.lock('/db').then((l) => {
        secondAcquired = true
        return l
      })
      // Give the pending acquire a turn; it must not have been granted.
      await Promise.resolve()
      await Promise.resolve()
      ok(!secondAcquired, 'a second lock must wait while the first is held')

      first.release()
      ok(!first.held, 'a released lock reports itself released')
      first.release() // a second release is a no-op, not an error

      const held = await second
      ok(held.held, 'the waiter is granted the lock once it is free')
      held.release()

      // `using`-style disposal releases too.
      const disposable = await vfs.lock('/db')
      disposable[Symbol.dispose]()
      ok(!disposable.held, 'Symbol.dispose releases')
      ;(await vfs.lock('/db')).release()
    },
  },
]

/**
 * Run every case against a backend, collecting failures.
 * Returns the names that failed with their reasons; empty means conformant.
 */
export async function runVfsConformance(
  make: VfsFactory,
): Promise<Array<{ name: string; error: unknown }>> {
  const failures: Array<{ name: string; error: unknown }> = []
  for (const c of vfsConformanceCases) {
    try {
      await c.run(make)
    } catch (error) {
      failures.push({ name: c.name, error })
    }
  }
  return failures
}
