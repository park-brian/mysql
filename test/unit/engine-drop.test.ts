// M4.23 — trees as DDL makes and retires them: `dropTree`, the undo record
// that drops a tree on rollback or on purge, and the counters AUTO_INCREMENT
// and the hidden row id are taken from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FaultInjectingVfs } from '@myjs/vfs/fault'
import { MemoryVfs, type Vfs, type VfsFile } from '@myjs/vfs'
import { ClusteredIndex, EngineError, Store, decodeUndo, encodeUndo, verifyStore, type RecordLayout, type StoreOptions, type Trx } from '@myjs/engine'

const PAGE = 1024
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }]
const primary = [{ field: 0, part: { kind: 'bytes' as const, nullable: false } }]
const big = (n: number) => new Uint8Array(2500).fill(n)

const crashedError = (e: unknown) => (e as { code?: string }).code === 'VFS_CRASHED'
const files = async (vfs: Vfs): Promise<[VfsFile, VfsFile]> => [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]

async function fresh(options: StoreOptions = {}) {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const store = Store.create(...(await files(vfs)), { frames: 64, ...options })
  return { vfs, store }
}

/** A clustered table made the way CREATE TABLE makes one: its tree and the record that drops it on rollback, in one write. */
function create(store: Store, trx: Trx): ClusteredIndex {
  return trx.write(() => {
    const t = ClusteredIndex.create(store, layout, primary)
    trx.undo({ trees: { onRollback: [{ indexId: t.tree.indexId, layout }], onPurge: [] } })
    return t
  })
}

const refsOf = (t: ClusteredIndex) => (id: number, v: Uint8Array) => (id === t.tree.indexId ? t.refsOf(v) : [])

test('M4.23: a tree undo record round-trips, and a mangled one is a typed error', () => {
  const r = { trees: { onRollback: [{ indexId: 17, layout }], onPurge: [{ indexId: 18, layout: null }, { indexId: 2 ** 23, layout: [] }] } }
  assert.deepEqual(decodeUndo(encodeUndo(r)), r)
  const bytes = encodeUndo(r)
  for (let cut = 0; cut < bytes.length; cut++) {
    assert.throws(() => decodeUndo(bytes.subarray(0, cut)), (e: EngineError) => e.code === 'ENGINE_CORRUPT_UNDO')
  }
})

test('M4.23: dropTree gives back every page a tree held, its overflow chains included', async () => {
  const { store } = await fresh()
  const baseline = store.alloc.usedPages().size
  const t = ClusteredIndex.create(store, layout, primary)
  for (let i = 0; i < 40; i++) t.insert([be(i), i % 3 === 0 ? big(i) : Uint8Array.of(i)])
  store.purge()
  verifyStore(store, { overflowRefs: refsOf(t) })
  assert.ok(store.alloc.usedPages().size > baseline + 20)
  store.dropTree(t.tree.indexId, layout)
  assert.equal(store.hasTree(t.tree.indexId), false)
  verifyStore(store)
  assert.equal(store.alloc.usedPages().size, baseline)
  // The store's own trees are not its caller's to drop.
  assert.throws(() => store.dropTree(1), (e: EngineError) => e.code === 'ENGINE_MISUSE')
})

test('M4.23: a CREATE rolled back drops its tree — live, and after a crash at every write', async () => {
  const { store } = await fresh()
  const baseline = store.alloc.usedPages().size
  const trx = store.begin()
  const t = create(store, trx)
  t.insert([be(1), big(1)], trx)
  trx.rollback()
  assert.equal(store.hasTree(t.tree.indexId), false)
  verifyStore(store)
  assert.equal(store.alloc.usedPages().size, baseline)

  // Unfinished, then crashed at each write: reopening rolls it back, leaving
  // no tree that nothing would drop.
  const run = async (crashAt?: number) => {
    const vfs = new FaultInjectingVfs({ pageSize: PAGE, seed: crashAt ?? 1, ...(crashAt === undefined ? {} : { crashAt }) })
    let writes = 0
    let start = 0
    try {
      const s = Store.create(...(await files(vfs)), { frames: 64 })
      start = vfs.operations
      const trx = s.begin()
      const t = create(s, trx)
      for (let i = 0; i < 6; i++) t.insert([be(i), big(i)], trx)
      s.sync()
      writes = vfs.operations - start
    } catch (e) {
      if (!crashedError(e)) throw e
    }
    return { vfs, writes, start }
  }
  const { writes, start } = await run()
  assert.ok(writes > 5)
  for (let k = start + 1; k <= start + writes + 2; k++) {
    const { vfs } = await run(k)
    const s = Store.open(...(await files(vfs.afterCrash({ kind: 'power', seed: k }))), { frames: 64 })
    verifyStore(s)
    assert.deepEqual(
      [...s.trees()].map((t) => t.indexId),
      [1],
      `crash at write ${k}: only the counters tree is left`,
    )
  }
})

test('M4.23: a drop on purge waits for every view that might read the tree', async () => {
  const { store } = await fresh()
  const t = ClusteredIndex.create(store, layout, primary)
  const baseline = store.alloc.usedPages().size
  for (let i = 0; i < 10; i++) t.insert([be(i), big(i)])
  store.purge()
  const reader = store.begin()
  assert.ok(t.get(be(3), reader) !== undefined)
  const ddl = store.begin()
  ddl.write(() => ddl.undo({ trees: { onRollback: [], onPurge: [{ indexId: t.tree.indexId, layout }] } }))
  ddl.commit()
  assert.ok(store.hasTree(t.tree.indexId), 'the reader pins it')
  assert.deepEqual(t.get(be(3), reader)?.[1], big(3))
  verifyStore(store, { overflowRefs: refsOf(t) })
  reader.commit()
  store.purge()
  assert.equal(store.hasTree(t.tree.indexId), false)
  verifyStore(store)
  assert.ok(store.alloc.usedPages().size < baseline, 'the rows, chains and the tree itself are back')
})

test('M4.23: a rolled-back DROP keeps its tree; a committed CREATE keeps its tree through purge', async () => {
  const { store } = await fresh()
  const trx = store.begin()
  const t = create(store, trx)
  trx.commit()
  store.purge()
  assert.ok(store.hasTree(t.tree.indexId))
  t.insert([be(1), big(1)])
  const drop = store.begin()
  drop.write(() => drop.undo({ trees: { onRollback: [], onPurge: [{ indexId: t.tree.indexId, layout }] } }))
  drop.rollback()
  store.purge()
  assert.ok(store.hasTree(t.tree.indexId))
  assert.deepEqual(t.get(be(1))?.[1], big(1))
  verifyStore(store, { overflowRefs: refsOf(t) })
})

test('M4.23: an undo record for a tree that is gone is corruption, to purge and to verify', async () => {
  const { store } = await fresh()
  const t = ClusteredIndex.create(store, layout, primary)
  const pin = store.begin()
  pin.view
  t.insert([be(1), Uint8Array.of(1)])
  // Dropped out from under its own history — what a write into a dropped table would leave.
  store.dropTree(t.tree.indexId, layout)
  assert.throws(() => verifyStore(store), /names index/)
  pin.commit()
  assert.throws(() => store.purge(), (e: EngineError) => e.code === 'ENGINE_CORRUPT_UNDO')
})

test('M4.23: counters are taken in their own mini-transaction, survive a reopen, and go with their tree', async () => {
  const { vfs, store } = await fresh()
  const t = ClusteredIndex.create(store, layout, primary)
  const id = t.tree.indexId
  assert.equal(store.takeCounter(id, 0), 1n)
  assert.equal(store.takeCounter(id, 0, 5), 2n)
  assert.equal(store.takeCounter(id, 0), 7n)
  assert.equal(store.takeCounter(id, 1), 1n, 'a second slot counts apart')
  // Taken inside a write, an abort would give it back: refused.
  const trx = store.begin()
  assert.throws(() => trx.write(() => store.takeCounter(id, 0)), (e: EngineError) => e.code === 'ENGINE_MISUSE')
  // An explicit value past the counter moves it; one below does not.
  trx.write(() => store.raiseCounter(id, 0, 100n))
  trx.write(() => store.raiseCounter(id, 0, 50n))
  // A rollback does not give the raise back — it is not the row's to undo.
  trx.rollback()
  assert.equal(store.counter(id, 0), 101n)
  store.sync()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  assert.equal(reopened.takeCounter(id, 0), 101n)
  reopened.dropTree(id, layout)
  assert.equal(reopened.counter(id, 0), 1n)
  assert.equal(reopened.counter(id, 1), 1n)
})
