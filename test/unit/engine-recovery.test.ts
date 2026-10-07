// M4.15–M4.18 on disk: what a crash at a given write leaves, and what
// recovery makes of it. The crash suite (test/crash) runs a workload at
// thousands of crash points; these are the specific claims, one each.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { FaultInjectingVfs } from '@myjs/vfs/fault'
import { ClusteredIndex, LOG_BLOCK, Store, externalRefs, pageLsn, verifyStore, type FieldBytes, type RecordLayout, type StoreOptions } from '@myjs/engine'

const PAGE = 1024
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

async function open(vfs: FaultInjectingVfs | MemoryVfs): Promise<[VfsFile, VfsFile]> {
  return [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
}

const crashedError = (e: unknown) => (e as { code?: string }).code === 'VFS_CRASHED'

/** The tree's contents after recovery, checked for consistency on the way. */
async function recovered(vfs: FaultInjectingVfs, options: StoreOptions = {}): Promise<string[]> {
  const store = Store.open(...(await open(vfs)), { frames: 64, ...options })
  verifyStore(store)
  const [first] = [...store.trees()]
  if (first === undefined) return []
  return [...store.openTree(first.indexId).entries()].map(([k, v]) => hex(k) + ':' + hex(v))
}

/**
 * Run `steps` against a fault-injecting VFS armed to crash at `crashAt`, and
 * return it with the snapshot after each committed step. `steps[i]` returns
 * whether to snapshot.
 */
async function run(crashAt: number | undefined, seed: number, steps: ((s: Store) => void)[]) {
  const vfs = new FaultInjectingVfs({ pageSize: PAGE, seed, ...(crashAt === undefined ? {} : { crashAt }) })
  const states: string[][] = []
  const marks: number[] = []
  try {
    const store = Store.create(...(await open(vfs)), { frames: 64 })
    const tree = store.createTree()
    store.commit()
    states.push([])
    for (const step of steps) {
      step(store)
      store.commit()
      states.push([...tree.entries()].map(([k, v]) => hex(k) + ':' + hex(v)))
      marks.push(vfs.operations)
    }
  } catch (e) {
    if (!crashedError(e)) throw e
  }
  return { vfs, states, marks }
}

test('M4.15: a page split is never half-applied, whatever write a crash interrupts — and whether the power goes too', async () => {
  // Fill one leaf, then one put that splits it, then a checkpoint that writes
  // the split's three pages and both maps out: every write of all that, torn.
  const fill = (s: Store) => {
    const tree = s.openTree(1)
    for (let i = 0; i < 25; i++) tree.put(be(i), new Uint8Array(30).fill(i))
  }
  const split = (s: Store) => {
    s.openTree(1).put(be(1000), new Uint8Array(30).fill(9))
    s.checkpoint()
  }
  const clean = await run(undefined, 1, [fill, split])
  const [before, after] = [clean.states[1], clean.states[2]]
  const [from, to] = clean.marks as [number, number]
  assert.ok(to - from > 4, `the split's window has ${to - from} writes`)
  for (let k = from + 1; k <= to; k++) {
    for (const kind of ['process', 'power'] as const) {
      const { vfs, states } = await run(k, k, [fill, split])
      assert.equal(states.length, 2, 'the crash came inside the split')
      const got = await recovered(vfs.afterCrash({ kind, seed: k }))
      assert.ok([before, after].some((s) => JSON.stringify(s) === JSON.stringify(got)), `crash at write ${k} (${kind}): neither before nor after the split`)
    }
  }
})

test('M4.16: a torn data page is rebuilt from the log alone', async () => {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const [data, log] = await open(vfs)
  const store = Store.create(data, log, { frames: 64 })
  const tree = store.createTree()
  for (let i = 0; i < 300; i++) tree.put(be(i), new Uint8Array(20).fill(i))
  store.checkpoint()
  const want = [...tree.entries()].map(([k]) => hex(k))
  // One change after the checkpoint: its leaf goes from clean to dirty, so
  // the log holds it whole. The page is written out, and torn.
  tree.put(be(5), new Uint8Array(20).fill(0xee))
  store.commit()
  const dirty = store.pool.dirtyPages()
  assert.equal(dirty.length, 1, 'one leaf changed')
  const leaf = dirty[0] as number
  store.pool.flush()
  const torn = new Uint8Array(PAGE / 2).fill(0xaa)
  data.writeBytes(leaf * PAGE + PAGE / 2, torn)
  // A database whose data file has a torn page and nothing else to go on but the log.
  const reopened = Store.open(data, log, { frames: 64 })
  verifyStore(reopened)
  const again = reopened.openTree(tree.indexId)
  assert.deepEqual([...again.entries()].map(([k]) => hex(k)), want)
  assert.deepEqual(again.get(be(5)), new Uint8Array(20).fill(0xee))
})

test('M4.17: a crash at any write of a checkpoint leaves a superblock, and the log it points into', async () => {
  const work = (s: Store) => {
    const tree = s.openTree(1)
    for (let i = 0; i < 200; i++) tree.put(be((i * 7919) % 1000), new Uint8Array(40).fill(i))
  }
  const checkpoint = (s: Store) => s.checkpoint()
  const clean = await run(undefined, 1, [work, checkpoint, work, checkpoint])
  const want = clean.states[4]
  const [, from, , to] = clean.marks as number[]
  for (let k = (from as number) + 1; k <= (to as number); k++) {
    const { vfs } = await run(k, k, [work, checkpoint, work, checkpoint])
    assert.deepEqual(await recovered(vfs.afterCrash({ kind: 'power', seed: k })), want, `crash at write ${k}`)
  }
})

test('M4.18: recovery is idempotent — a crash during it, at any write, recovers again to the same place', async () => {
  const work = (s: Store) => {
    const tree = s.openTree(1)
    for (let i = 0; i < 150; i++) tree.put(be((i * 31) % 500), new Uint8Array(50).fill(i))
  }
  const { vfs: crashed, states } = await run(undefined, 1, [work, work])
  const want = states[2]
  // A clean count of what one recovery writes…
  const counter = crashed.afterCrash({ kind: 'process' })
  await recovered(counter)
  const writes = counter.operations
  assert.ok(writes > 10)
  // …then a crash at each of those writes, and a second recovery.
  for (let k = 1; k <= writes; k++) {
    const first = crashed.afterCrash({ kind: 'process', crashAt: k })
    await assert.rejects(recovered(first), crashedError)
    assert.deepEqual(await recovered(first.afterCrash({ kind: 'power', seed: k })), want, `a crash at recovery write ${k}`)
  }
})

test('D-25: the log carries every row change whole — replaying its ROW records rebuilds the table', async () => {
  const store = Store.create(...(await open(new MemoryVfs({ pageSize: PAGE }))), { frames: 64 })
  const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }, { nullable: true }]
  const table = ClusteredIndex.create(store, layout, [{ field: 0, part: { kind: 'bytes', nullable: false } }])
  for (let i = 0; i < 60; i++) table.insert([be(i), i % 5 === 0 ? null : Uint8Array.of(i), i % 7 === 0 ? new Uint8Array(3000).fill(i) : null])
  for (let i = 0; i < 60; i += 3) table.delete(be(i))
  store.sync()
  const replayed = new Map<string, readonly FieldBytes[]>()
  for (const group of store.history()) {
    for (const r of group.records) {
      if (r.type !== 'row' || r.indexId !== table.tree.indexId) continue
      if (r.before !== null) assert.ok(replayed.delete(hex(r.before[0] as Uint8Array)), 'a delete names a row that exists')
      if (r.after !== null) replayed.set(hex(r.after[0] as Uint8Array), r.after)
    }
  }
  const actual = new Map([...table.tree.entries()].map(([k]) => [hex(k), table.get(k) as FieldBytes[]]))
  assert.deepEqual(replayed, actual)
})

test('M4.3: commits do not let dirty pages or the log run ahead — the checkpoint runs first', async () => {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const store = Store.create(...(await open(vfs)), { frames: 32, logBlocks: 8 })
  const tree = store.createTree()
  let worst = 0
  for (let i = 0; i < 3000; i++) {
    tree.put(be((i * 2654435761) >>> 0), new Uint8Array(40).fill(i))
    store.commit()
    worst = Math.max(worst, store.pool.dirtyCount)
  }
  // Three quarters of the pool, plus what one mini-transaction can add.
  assert.ok(worst <= 24 + 8, `${worst} dirty pages in a 32-frame pool`)
  assert.ok(store.logFile.size() <= 8 * LOG_BLOCK, 'the log stayed inside its ring')
  verifyStore(store)
})

/** Every allocated page's LSN — none may be ahead of the log that recovered it. */
function newestPage(store: Store): number {
  let newest = 0
  for (const p of store.alloc.usedPages()) if (p > 1) newest = Math.max(newest, store.pool.read(p, pageLsn))
  return newest
}

test('the WAL rule: no page reaches the data file ahead of its log, whatever the commit setting', async () => {
  const [data, log] = await open(new MemoryVfs({ pageSize: PAGE }))
  const store = Store.create(data, log, { frames: 64, flushLogAtTrxCommit: 0 })
  const tree = store.createTree()
  store.sync()
  tree.put(be(1), new Uint8Array(10).fill(1))
  store.commit() // writes nothing at setting 0
  store.pool.flush() // the leaf goes to disk — so its log must go first
  // A process crash: the files keep every write; the log's unwritten tail is gone.
  const reopened = Store.open(data, log, { frames: 64 })
  verifyStore(reopened)
  assert.ok(newestPage(reopened) <= reopened.lsn, `a page at ${newestPage(reopened)}, the log ends at ${reopened.lsn}`)
  assert.deepEqual(reopened.openTree(tree.indexId).get(be(1)), new Uint8Array(10).fill(1))
})

/** Byte equality, without the 30 KB diff `deepEqual` would build on failure. */
const same = (a: Uint8Array | null | undefined, b: Uint8Array) => a instanceof Uint8Array && hex(a) === hex(b)

/** A table whose one row carries a 30-page body. */
async function chains(policy: 0 | 1, frames: number) {
  const [data, log] = await open(new MemoryVfs({ pageSize: PAGE }))
  const store = Store.create(data, log, { frames, flushLogAtTrxCommit: policy })
  const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }]
  const table = ClusteredIndex.create(store, layout, [{ field: 0, part: { kind: 'bytes', nullable: false } }])
  const body = (n: number, pages = 30) => new Uint8Array(pages * PAGE).fill(n)
  table.insert([be(1), body(1)])
  store.sync()
  return { data, log, store, table, body }
}

test('M4.15: a page this mini-transaction freed is not fresh when it allocates it again — an abort finds it intact', async () => {
  const { store, table, body } = await chains(1, 40)
  // Row 1's chain is longer than the pool, so deleting it — which reads it —
  // leaves its first pages evicted: free, and not resident. Row 3 is ballast.
  table.delete(be(1))
  table.insert([be(1), body(1, 60)])
  table.insert([be(3), body(3, 60)])
  store.sync()
  assert.throws(
    () =>
      store.atomically(() => {
        table.delete(be(1))
        // The next chain takes the freed pages. Reading the ballast churns the
        // pool, so any of them not held is written out — over the row the
        // abort brings back, if a page freed here counted as fresh.
        table.insert([be(2), body(2)])
        table.get(be(3))
        throw new Error('abort')
      }),
    /abort/,
  )
  assert.ok(same(table.get(be(1))?.[1], body(1, 60)), 'row 1 is whole')
  verifyStore(store, { overflowRefs: (id, v) => (id === table.tree.indexId ? externalRefs(table.layout, v) : []) })
})

test('M4.15: a fresh page is written only once every earlier mini-transaction is durable — one may have freed it', async () => {
  const { data, log, store, table, body } = await chains(0, 12)
  table.delete(be(1))
  store.commit() // at setting 0: not durable
  try {
    store.atomically(() => {
      table.insert([be(2), body(2)]) // reuses the freed chain, evicting as it goes
      throw new Error('the process dies here')
    })
  } catch {
    // and the files are all that is left
  }
  const reopened = Store.open(data, log, { frames: 64 })
  const again = new ClusteredIndex(reopened.openTree(table.tree.indexId), table.layout, table.primary)
  // Either the delete is durable, or row 1 is whole — never a row 1 whose chain holds row 2.
  const row = again.get(be(1))
  if (row !== undefined) assert.ok(same(row[1], body(1)), 'row 1 is whole')
  verifyStore(reopened, { overflowRefs: (id, v) => (id === table.tree.indexId ? externalRefs(table.layout, v) : []) })
})
