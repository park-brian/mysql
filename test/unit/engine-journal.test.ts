// M4.15 — a mini-transaction happens entirely or not at all. These tests
// cover the in-memory half: an error anywhere inside one puts every page, and
// the allocator, back. The on-disk half is engine-recovery.test.ts and the
// crash suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { ClusteredIndex, EngineError, Store, externalRefs, verifyStore, type BTree, type Redo, type RecordLayout } from '@myjs/engine'

const PAGE = 1024
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

async function files(): Promise<[VfsFile, VfsFile]> {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  return [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
}

/** Every allocated page's bytes but its checksum — sealed whenever the pool writes it — and the tree's entries: what an abort must leave exactly as it was. */
function state(store: Store, tree: BTree): { pages: Map<number, string>; entries: string[] } {
  const pages = new Map<number, string>()
  for (const p of [...store.alloc.usedPages()].sort((a, b) => a - b)) if (p > 1) pages.set(p, store.pool.read(p, (page) => hex(page.subarray(4))))
  return { pages, entries: [...tree.entries()].map(([k, v]) => hex(k) + ':' + hex(v)) }
}

async function filled(n = 300, frames = 64): Promise<{ store: Store; tree: BTree }> {
  const store = Store.create(...(await files()), { frames })
  const tree = store.createTree()
  for (let i = 0; i < n; i++) tree.put(be(i * 2), new Uint8Array(30).fill(i))
  return { store, tree }
}

test('M4.15: an error part-way through a mini-transaction of splits restores every page and the allocator', async () => {
  const { store, tree } = await filled()
  const before = state(store, tree)
  const boom = new Error('boom')
  assert.throws(
    () =>
      store.atomically(() => {
        // Enough to split leaves and an internal page, and to allocate.
        for (let i = 0; i < 200; i++) tree.put(be(i * 2 + 1), new Uint8Array(60).fill(7))
        throw boom
      }),
    (e) => e === boom,
  )
  assert.deepEqual(state(store, tree), before, 'byte for byte')
  verifyStore(store)
  // The store goes on as if nothing had happened, and allocates the same pages.
  tree.put(be(1), new Uint8Array(4))
  verifyStore(store)
})

test('M4.15: a row too big for any page leaves no overflow page behind', async () => {
  const store = Store.create(...(await files()), { frames: 64 })
  // A fixed field too wide for a record, and a long one that goes off-page
  // first: the chain is written before the record is refused.
  const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: false, fixed: 900 }, { nullable: false }]
  const table = ClusteredIndex.create(store, layout, [{ field: 0, part: { kind: 'bytes', nullable: false } }])
  const used = store.alloc.usedPages().size
  assert.throws(() => table.insert([be(1), new Uint8Array(900), new Uint8Array(5000)]), (e: EngineError) => e.code === 'ER_TOO_BIG_ROWSIZE')
  assert.equal(store.alloc.usedPages().size, used)
  verifyStore(store, { overflowRefs: (id, v) => (id === table.tree.indexId ? table.refsOf(v) : []) })
})

test('M4.15: an error caught inside a mini-transaction does not un-abort it', async () => {
  const { store, tree } = await filled(20)
  const before = state(store, tree)
  assert.throws(
    () =>
      store.atomically(() => {
        tree.put(be(1001), new Uint8Array(1))
        try {
          store.atomically(() => {
            throw new Error('inner')
          })
        } catch {
          // swallowed — and the outer one must not commit half of itself
        }
        tree.put(be(1003), new Uint8Array(1))
      }),
    (e: EngineError) => e.code === 'ENGINE_MISUSE',
  )
  assert.deepEqual(state(store, tree), before)
  assert.throws(() => store.alloc.allocate(9, 0), (e: EngineError) => e.code === 'ENGINE_MISUSE', 'and no page changes outside one')
})

test('M4.15: a mini-transaction that needs more frames than the pool has aborts cleanly', async () => {
  const { store, tree } = await filled(2000, 16)
  const before = state(store, tree)
  // Touching leaves all over a deep tree holds every one of them until commit.
  assert.throws(
    () =>
      store.atomically(() => {
        for (let i = 0; i < 2000; i += 37) tree.put(be(i * 2), new Uint8Array(30))
      }),
    (e: EngineError) => e.code === 'ENGINE_POOL_EXHAUSTED',
  )
  assert.deepEqual(state(store, tree), before)
  verifyStore(store)
})

test('M4.15: a 1 MiB value is one mini-transaction in a 32-frame pool: its fresh pages are written early', async () => {
  const store = Store.create(...(await files()), { frames: 32 })
  const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }]
  const table = ClusteredIndex.create(store, layout, [{ field: 0, part: { kind: 'bytes', nullable: false } }])
  const writes = store.pool.stats.writes
  const body = new Uint8Array(1 << 20).map((_, i) => i & 0xff)
  table.insert([be(1), body])
  assert.ok(store.pool.stats.writes - writes > 900, 'the chain went to disk before the mini-transaction committed')
  assert.deepEqual(table.get(be(1))?.[1], body)
  verifyStore(store, { overflowRefs: (id, v) => (id === table.tree.indexId ? table.refsOf(v) : []) })
})

test('D-46: a page clean since it was written logs an image; a dirty one logs a diff', async () => {
  const { store, tree } = await filled(10)
  store.checkpoint()
  tree.put(be(1), new Uint8Array(4))
  tree.put(be(3), new Uint8Array(4))
  store.sync()
  const pages = [...store.history()].map((g) => g.records.filter((r): r is Extract<Redo, { type: 'page' }> => r.type === 'page'))
  assert.equal(pages.length, 2)
  assert.deepEqual(pages.map((g) => g.map((r) => r.image)), [[true], [false]])
  const diff = (pages[1] as Extract<Redo, { type: 'page' }>[])[0] as Extract<Redo, { type: 'page' }>
  assert.ok(diff.runs.reduce((n, r) => n + r.bytes.length, 0) < 100, 'a diff is the change, not the page')
})
