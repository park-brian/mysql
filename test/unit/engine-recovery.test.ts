// M4.15–M4.18 on disk: what a crash at a given write leaves, and what
// recovery makes of it. The crash suite (test/crash) runs a workload at
// thousands of crash points; these are the specific claims, one each.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { FaultInjectingVfs } from '@myjs/vfs/fault'
import { ClusteredIndex, EngineError, FIRST_USER_INDEX, LOG_BLOCK, Store, freeChain, indexPage, pageLsn, readChain, sealPage, setPageLsn, writeChain, verifyStore, type FieldBytes, type RecordLayout, type StoreOptions } from '@myjs/engine'

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
  const first = [...store.trees()].find((t) => t.indexId >= FIRST_USER_INDEX)
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
    const tree = s.openTree(FIRST_USER_INDEX)
    for (let i = 0; i < 25; i++) tree.put(be(i), new Uint8Array(30).fill(i))
  }
  const split = (s: Store) => {
    s.openTree(FIRST_USER_INDEX).put(be(1000), new Uint8Array(30).fill(9))
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
    const tree = s.openTree(FIRST_USER_INDEX)
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
    const tree = s.openTree(FIRST_USER_INDEX)
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

/**
 * A tree whose values are overflow references, written and freed directly.
 * These two rules govern page-level code, so they are tested with raw chains.
 * Rows never free a chain inside the mini-transaction that might reuse it:
 * deletes mark, and purge frees.
 */
async function chains(policy: 0 | 1, frames: number) {
  const [data, log] = await open(new MemoryVfs({ pageSize: PAGE }))
  const store = Store.create(data, log, { frames, flushLogAtTrxCommit: policy })
  const tree = store.createTree()
  const body = (n: number, pages = 30) => new Uint8Array(pages * PAGE).fill(n)
  const put = (n: number, pages: number) => store.atomically(() => tree.put(be(n), writeChain(tree.overflowPages(), body(n, pages))))
  const ref = (n: number) => tree.get(be(n)) as Uint8Array
  const chain = (n: number) => readChain(store.pool, ref(n))
  store.sync()
  return { data, log, store, tree, body, put, ref, chain }
}

test('M4.15: a page this mini-transaction freed is not fresh when it allocates it again — an abort finds it intact', async () => {
  const { store, tree, body, put, ref, chain } = await chains(1, 40)
  // Chain 1 is longer than the pool, so freeing it — which walks it — leaves
  // its first pages evicted: free, and not resident. Chain 3 is ballast.
  put(1, 60)
  put(3, 60)
  store.sync()
  assert.throws(
    () =>
      store.atomically(() => {
        freeChain(tree.overflowPages(), ref(1))
        // The next chain takes the freed pages. Reading the ballast churns the
        // pool, so any of them not held is written out — over the chain the
        // abort brings back, if a page freed here counted as fresh.
        writeChain(tree.overflowPages(), body(2))
        chain(3)
        throw new Error('abort')
      }),
    /abort/,
  )
  assert.ok(same(chain(1), body(1, 60)), 'chain 1 is whole')
  verifyStore(store, { overflowRefs: (id, v) => (id === tree.indexId ? [v] : []) })
})

test('M4.15: a fresh page is written only once every earlier mini-transaction is durable — one may have freed it', async () => {
  const { data, log, store, tree, body, put, ref } = await chains(0, 12)
  put(1, 30)
  store.sync()
  store.atomically(() => {
    freeChain(tree.overflowPages(), ref(1))
    tree.delete(be(1))
  })
  store.commit() // at setting 0: not durable
  try {
    store.atomically(() => {
      writeChain(tree.overflowPages(), body(2)) // reuses the freed chain, evicting as it goes
      throw new Error('the process dies here')
    })
  } catch {
    // and the files are all that is left
  }
  const reopened = Store.open(data, log, { frames: 64 })
  const again = reopened.openTree(tree.indexId)
  // Either the free is durable, or chain 1 is whole — never a chain 1 holding chain 2's bytes.
  const kept = again.get(be(1))
  if (kept !== undefined) assert.ok(same(readChain(reopened.pool, kept), body(1)), 'chain 1 is whole')
  verifyStore(reopened, { overflowRefs: (id, v) => (id === tree.indexId ? [v] : []) })
})

// --- M4.18's other half: the transaction a crash leaves open --------------------

const rowLayout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }]
const rowKey = [{ field: 0, part: { kind: 'bytes' as const, nullable: false } }]

/** A table's rows as an autocommit read sees them — consistency checked on the way. */
async function rowsAfter(vfs: FaultInjectingVfs): Promise<string> {
  const store = Store.open(...(await open(vfs)), { frames: 64 })
  const t = new ClusteredIndex(store.openTree(FIRST_USER_INDEX), rowLayout, rowKey)
  verifyStore(store, { overflowRefs: (id, v) => (id === t.tree.indexId ? t.refsOf(v) : []) })
  assert.equal(store.stats().writer, 0, 'nothing is left open')
  return JSON.stringify([...t.scan()].map(([, r]) => r.map((f) => (f === null ? '-' : hex(f)))))
}

/**
 * A table of ten rows, then one transaction of many mini-transactions — inserts,
 * updates with off-page values, deletes — that `finish` ends. Returns the
 * VFS, the write counts at the transaction's start and end, and the states
 * before and after it.
 */
async function transaction(crashAt: number | undefined, finish: 'commit' | 'rollback', tearWrites = true) {
  const vfs = new FaultInjectingVfs({ pageSize: PAGE, seed: crashAt ?? 1, tearWrites, ...(crashAt === undefined ? {} : { crashAt }) })
  const marks: number[] = []
  try {
    const store = Store.create(...(await open(vfs)), { frames: 32 })
    const t = ClusteredIndex.create(store, rowLayout, rowKey)
    for (let i = 0; i < 10; i++) t.insert([be(i), Uint8Array.of(i)])
    marks.push(vfs.operations)
    const w = store.begin()
    for (let i = 0; i < 10; i += 2) t.update([be(i), new Uint8Array(1500).fill(i)], w)
    for (let i = 1; i < 10; i += 3) t.delete(be(i), w)
    for (let i = 10; i < 14; i++) t.insert([be(i), null], w)
    marks.push(vfs.operations)
    if (finish === 'commit') w.commit()
    else {
      // Back two records at a time, each step made durable, so that crash
      // points land on a rollback that is part done — the case resuming is for.
      for (let at = w.savepoint() - 2; at > 0; at -= 2) {
        w.rollbackTo(at)
        store.sync()
      }
      w.rollback()
    }
    // A rollback need not be durable — one that is lost is redone on recovery —
    // so it writes nothing until something does; this checkpoint is that.
    store.checkpoint()
    marks.push(vfs.operations)
  } catch (e) {
    if ((e as { code?: string }).code !== 'VFS_CRASHED') throw e
  }
  return { vfs, marks }
}

test('M4.18: a crash at any write of a transaction recovers to before it or after it — never part of it', async () => {
  const clean = await transaction(undefined, 'commit')
  const before = await rowsAfter((await transaction(clean.marks[0], 'commit')).vfs.afterCrash({ kind: 'process' }))
  const after = await rowsAfter(clean.vfs.afterCrash({ kind: 'process' }))
  assert.notEqual(before, after)
  const [from, , to] = clean.marks as [number, number, number]
  for (let k = from + 1; k <= to; k++) {
    for (const kind of ['process', 'power'] as const) {
      const got = await rowsAfter((await transaction(k, 'commit')).vfs.afterCrash({ kind, seed: k }))
      assert.ok(got === before || got === after, `a ${kind} crash at write ${k}: part of a transaction`)
    }
  }
})

test('M4.18: a crash at any write of a rollback finishes the rollback on recovery', async () => {
  const clean = await transaction(undefined, 'rollback')
  const before = await rowsAfter(clean.vfs.afterCrash({ kind: 'process' }))
  const [, from, to] = clean.marks as [number, number, number]
  assert.ok(to - from > 10, `the rollback writes ${to - from} times`)
  for (let k = from + 1; k <= to; k++) {
    for (const kind of ['process', 'power'] as const) {
      const got = await rowsAfter((await transaction(k, 'rollback')).vfs.afterCrash({ kind, seed: k }))
      assert.equal(got, before, `a ${kind} crash at rollback write ${k}`)
    }
  }
})

test("M4.18: a crash at any write of recovery's own rollback is recovered again, to the same place", async () => {
  const clean = await transaction(undefined, 'commit')
  // Crash at the commit's first write, which does not land: the transaction is open.
  const open_ = await transaction((clean.marks[1] as number) + 1, 'commit', false)
  const want = await rowsAfter(open_.vfs.afterCrash({ kind: 'process' }))
  const counter = open_.vfs.afterCrash({ kind: 'process' })
  await rowsAfter(counter)
  for (let k = 1; k <= counter.operations; k++) {
    const first = open_.vfs.afterCrash({ kind: 'process', crashAt: k })
    await assert.rejects(rowsAfter(first), (e: { code?: string }) => e.code === 'VFS_CRASHED')
    assert.equal(await rowsAfter(first.afterCrash({ kind: 'power', seed: k })), want, `a crash at recovery write ${k}`)
  }
})

test('ground rule 5: a page redo makes unsound is refused with a typed error, not handed to the next insert', async () => {
  const [data, log] = await open(new MemoryVfs({ pageSize: PAGE }))
  const store = Store.create(data, log, { frames: 64 })
  const tree = store.createTree()
  for (let i = 0; i < 10; i++) tree.put(be(i), new Uint8Array(20).fill(i))
  store.checkpoint()
  tree.put(be(20), new Uint8Array(20)) // the leaf's first change since it was written: an image
  const imageEnd = store.lsn
  tree.put(be(21), new Uint8Array(20)) // and a diff on top of it
  store.sync()
  // Tamper with the leaf on disk: drop a cell, which leaves a sound page, and
  // stamp it with the image's LSN, re-sealed. Redo then skips the image and
  // applies the diff to bytes it was not written for. Only tampering does this:
  // a torn page fails its checksum and waits for its image.
  const page = new Uint8Array(PAGE)
  data.readPage(tree.root, page)
  indexPage.removeCell(page, 0)
  indexPage.validateIndexPage(page, tree.root)
  setPageLsn(page, imageEnd)
  sealPage(page)
  data.writePage(tree.root, page)
  assert.throws(() => Store.open(data, log, { frames: 64 }), (e: EngineError) => e instanceof EngineError && e.code === 'ENGINE_CORRUPT_PAGE')
})
