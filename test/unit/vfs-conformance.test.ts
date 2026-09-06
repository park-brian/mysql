// M0.10 — "memory passes the conformance suite".
//
// The suite itself lives in @myjs/vfs so that the Node backend (M4), the OPFS
// backend (M6), doc 43 §5's FaultInjectingVfs and any application-supplied VFS
// run this identical body. This file only wires it to the test runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, vfsConformanceCases, runVfsConformance, type Vfs, type VfsFile } from '@myjs/vfs'

for (const c of vfsConformanceCases) {
  test(`memory VFS: ${c.name}`, async () => {
    await c.run(() => new MemoryVfs())
  })
}

test('memory VFS passes the whole suite', async () => {
  const failures = await runVfsConformance(() => new MemoryVfs())
  assert.deepEqual(failures, [], failures.map((f) => `${f.name}: ${String(f.error)}`).join('\n'))
})

test('the suite has teeth — a deliberately broken backend fails it', async () => {
  // If the conformance suite passes anything, it is documentation, not a gate.
  class SilentTruncateVfs extends MemoryVfs {
    override async open(path: string, opts: { create?: boolean }): Promise<VfsFile> {
      const file = await super.open(path, opts)
      // The classic storage bug: truncate updates the size but leaves the
      // dropped bytes readable.
      return Object.create(file, { truncate: { value: () => {} } }) as VfsFile
    }
  }
  const failures = await runVfsConformance(() => new SilentTruncateVfs() as Vfs)
  assert.ok(failures.length > 0, 'a no-op truncate must be caught')
  assert.ok(
    failures.some((f) => f.name.includes('truncate')),
    `expected the truncate case to fail, got: ${failures.map((f) => f.name).join(', ')}`,
  )
})

test('a custom page size is honoured end to end', async () => {
  const vfs = new MemoryVfs({ pageSize: 512 })
  const file = await vfs.open('/small.dat', { create: true })
  assert.equal(file.pageSize, 512)
  file.writePage(2, new Uint8Array(512).fill(7))
  assert.equal(file.size(), 3 * 512)
  file.close()
  const failures = await runVfsConformance(() => new MemoryVfs({ pageSize: 512 }))
  assert.deepEqual(failures, [], 'the suite is page-size agnostic')
})
