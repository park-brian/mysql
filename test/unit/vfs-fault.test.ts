// M4.25 — the fault-injecting VFS is itself an instrument, so it is checked
// before the crash suite trusts it: unarmed it is a conforming VFS, and armed
// it loses exactly what each kind of crash may lose.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runVfsConformance, type VfsError, type VfsFile } from '@myjs/vfs'
import { FaultInjectingVfs } from '@myjs/vfs/fault'

const bytes = (n: number, v: number) => new Uint8Array(n).fill(v)
const read = (f: VfsFile, offset: number, n: number) => {
  const out = new Uint8Array(n)
  f.readBytes(offset, out)
  return out
}

test('M4.25: with no crash armed, the fault-injecting VFS passes the conformance suite', async () => {
  const failures = await runVfsConformance(() => new FaultInjectingVfs({ pageSize: 4096 }))
  assert.deepEqual(failures, [], failures.map((f) => `${f.name}: ${String(f.error)}`).join('\n'))
})

test('M4.25: the crashing operation is the last to happen, and nothing after it does', async () => {
  const vfs = new FaultInjectingVfs({ pageSize: 512, crashAt: 3, tearWrites: false })
  const f = await vfs.open('a', { create: true })
  f.writeBytes(0, bytes(512, 1)) // 1
  f.flush() // 2
  assert.throws(() => f.writeBytes(512, bytes(512, 2)), (e: VfsError) => e.code === 'VFS_CRASHED') // 3
  assert.throws(() => f.size(), (e: VfsError) => e.code === 'VFS_CRASHED')
  assert.throws(() => f.flush(), (e: VfsError) => e.code === 'VFS_CRASHED')
  const after = await vfs.afterCrash({ kind: 'power' }).open('a', {})
  assert.equal(after.size(), 512)
  assert.deepEqual(read(after, 0, 512), bytes(512, 1))
})

test('M4.25: a process crash keeps every write, but not durably; power loss keeps only what was flushed, plus luck', async () => {
  const vfs = new FaultInjectingVfs({ pageSize: 512, crashAt: 4, tearWrites: false })
  const f = await vfs.open('a', { create: true })
  f.writeBytes(0, bytes(512, 1))
  f.flush()
  f.writeBytes(512, bytes(512, 2))
  assert.throws(() => f.writeBytes(1024, bytes(512, 3)))
  const process = vfs.afterCrash({ kind: 'process' })
  const p = await process.open('a', {})
  assert.deepEqual(read(p, 512, 512), bytes(512, 2), 'the OS still had the unflushed write')
  // …and a power cut after the process crash can still take it.
  const outcomes = new Set<number>()
  for (let seed = 1; seed < 40; seed++) {
    const g = await process.afterCrash({ kind: 'power', seed }).open('a', {})
    assert.deepEqual(read(g, 0, 512), bytes(512, 1), 'what was flushed survives every power cut')
    outcomes.add(read(g, 512, 1)[0] as number)
  }
  assert.deepEqual([...outcomes].sort(), [0, 2], 'an unflushed write sometimes survives and sometimes does not')
})

test('M4.25: a torn write lands some of its sectors and not others', async () => {
  let torn = false
  for (let seed = 1; seed < 20 && !torn; seed++) {
    const vfs = new FaultInjectingVfs({ pageSize: 4096, crashAt: 1, seed })
    const f = await vfs.open('a', { create: true })
    assert.throws(() => f.writePage(0, bytes(4096, 9)))
    const g = await vfs.afterCrash({ kind: 'process' }).open('a', {})
    const page = read(g, 0, 4096)
    const sectors = new Set(Array.from({ length: 8 }, (_, i) => page[i * 512]))
    torn ||= sectors.size === 2
  }
  assert.ok(torn, 'some seed tears a page into written and unwritten sectors')
})
