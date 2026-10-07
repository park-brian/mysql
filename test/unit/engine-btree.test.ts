// M4.8–M4.10 — the B+tree against a model, with the independent checker run
// after every operation. Small pages make deep trees cheap: at 1 KiB a few
// hundred keys reach four levels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { BTree, EngineError, Store, indexPage as ip, verifyStore, type TreeOptions } from '@myjs/engine'

const PAGE = 1024
const RUNS = Number(process.env.ENGINE_RUNS ?? 40)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const be = (n: number, width = 4) => {
  const out = new Uint8Array(width)
  for (let i = width - 1; i >= 0; i--) {
    out[i] = n & 0xff
    n = Math.floor(n / 256)
  }
  return out
}

async function freshFile(): Promise<VfsFile> {
  return new MemoryVfs({ pageSize: PAGE }).open('data', { create: true })
}

type Op =
  | { op: 'put'; key: Uint8Array; value: Uint8Array }
  | { op: 'delete'; key: Uint8Array }
  | { op: 'get'; key: Uint8Array }
  | { op: 'scan'; from?: Uint8Array; to?: Uint8Array; reverse: boolean }
  | { op: 'reopen' }

/** Keys from one of four regimes: random short, ascending, descending, or near the size limit. */
const keyOf = (mode: number, n: number, bytes: Uint8Array): Uint8Array => {
  if (mode === 0) return bytes
  if (mode === 1) return be(n)
  if (mode === 2) return be(0xffffffff - n)
  const big = new Uint8Array(BTree.maxKey(PAGE) - (n % 3))
  big.set(be(n))
  return big
}

const opArb = (mode: number): fc.Arbitrary<Op> =>
  fc.oneof(
    { weight: 6, arbitrary: fc.record({ n: fc.nat(400), bytes: fc.uint8Array({ maxLength: 10 }), value: fc.uint8Array({ maxLength: 60 }) }).map(({ n, bytes, value }) => ({ op: 'put' as const, key: keyOf(mode, n, bytes), value })) },
    { weight: 3, arbitrary: fc.record({ n: fc.nat(400), bytes: fc.uint8Array({ maxLength: 10 }) }).map(({ n, bytes }) => ({ op: 'delete' as const, key: keyOf(mode, n, bytes) })) },
    { weight: 1, arbitrary: fc.record({ n: fc.nat(400), bytes: fc.uint8Array({ maxLength: 10 }) }).map(({ n, bytes }) => ({ op: 'get' as const, key: keyOf(mode, n, bytes) })) },
    { weight: 1, arbitrary: fc.record({ a: fc.option(fc.uint8Array({ maxLength: 4 }), { nil: undefined }), b: fc.option(fc.uint8Array({ maxLength: 4 }), { nil: undefined }), reverse: fc.boolean() }).map(({ a, b, reverse }) => ({ op: 'scan' as const, ...(a === undefined ? {} : { from: a }), ...(b === undefined ? {} : { to: b }), reverse })) },
    { weight: 1, arbitrary: fc.constant({ op: 'reopen' as const }) },
  )

function check(ops: readonly Op[], file: VfsFile, options: TreeOptions = {}, upgradeFrom?: (s: Store) => void): void {
  let store = Store.create(file, { frames: 32 })
  let tree = store.createTree(options)
  upgradeFrom?.(store)
  const model = new Map<string, Uint8Array>()
  for (const o of ops) {
    if (o.op === 'put') {
      // A value too long to sit beside its key is refused, and changes nothing.
      if (ip.cellSize(o.key, o.value) > ip.maxCellSize(PAGE)) {
        assert.throws(() => tree.put(o.key, o.value), (e: EngineError) => e.code === 'ER_TOO_BIG_ROWSIZE')
      } else {
        tree.put(o.key, o.value)
        model.set(hex(o.key), o.value)
      }
    } else if (o.op === 'delete') {
      assert.equal(tree.delete(o.key), model.delete(hex(o.key)))
    } else if (o.op === 'get') {
      const got = tree.get(o.key)
      const want = model.get(hex(o.key))
      assert.equal(got === undefined ? undefined : hex(got), want === undefined ? undefined : hex(want))
    } else if (o.op === 'scan') {
      const want = [...model.keys()]
        .sort()
        .filter((k) => (o.from === undefined || k >= hex(o.from)) && (o.to === undefined || k < hex(o.to)))
      if (o.reverse) want.reverse()
      assert.deepEqual([...tree.entries(o)].map(([k]) => hex(k)), want)
    } else {
      store.flush()
      store = Store.open(file, { frames: 32 })
      tree = store.openTree(tree.indexId, options)
    }
    verifyStore(store, { schemaVersion: () => options.schemaVersion ?? 0 })
  }
  const all = [...tree.entries()].map(([k, v]) => [hex(k), hex(v)])
  assert.deepEqual(all, [...model].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, hex(v)]))
}

for (const [mode, name] of [[0, 'random'], [1, 'ascending'], [2, 'descending'], [3, 'maximum-size']] as const) {
  test(`M4.8/M4.9: the tree agrees with a Map, and verifies after every operation — ${name} keys`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb(mode), { minLength: 50, maxLength: 400 }), async (ops) => check(ops, await freshFile())),
      { numRuns: RUNS },
    )
  })
}

test('M4.8: descending the left spine of a four-level tree reaches the correct leaf', async () => {
  const store = Store.create(await freshFile(), { frames: 32 })
  const tree = store.createTree()
  const value = new Uint8Array(40)
  let n = 0
  while (tree.height() < 4) tree.put(be(1_000_000 - ++n), value)
  verifyStore(store)
  // Walk the left spine by hand: always the first child.
  let pageNo = tree.root
  for (;;) {
    const page = store.pool.fetch(pageNo)
    const next = ip.level(page) === 0 ? 0 : ip.childAt(page, 0)
    if (next === 0) {
      assert.equal(hex(ip.keyAt(page, 0)), hex(be(1_000_000 - n)), 'the smallest key is on the leftmost leaf')
      assert.equal(ip.leftSibling(page), 0)
      store.pool.release(page)
      break
    }
    store.pool.release(page)
    pageNo = next
  }
  assert.equal(hex([...tree.entries()][0]?.[0] as Uint8Array), hex(be(1_000_000 - n)))
})

/** Mean fill of the leaves, as a fraction of usable space. */
function leafFill(store: Store, tree: BTree): number {
  const leaves: number[] = []
  let pageNo = tree.root
  for (;;) {
    const page = store.pool.fetch(pageNo)
    const next = ip.level(page) === 0 ? 0 : ip.childAt(page, 0)
    store.pool.release(page)
    if (next === 0) break
    pageNo = next
  }
  for (let p = pageNo; p !== 0; ) {
    const page = store.pool.fetch(p)
    leaves.push(ip.usedSpace(page) / ip.usableSpace(PAGE))
    p = ip.rightSibling(page)
    store.pool.release(page)
  }
  // The last leaf of a sequential load is partly filled by definition.
  const full = leaves.length > 1 ? leaves.slice(0, -1) : leaves
  return full.reduce((a, b) => a + b, 0) / full.length
}

test('M4.10: sequential primary-key inserts fill pages ≥95%; random inserts do not', async () => {
  const value = new Uint8Array(30)
  const sequential = Store.create(await freshFile(), { frames: 64 })
  const seqTree = sequential.createTree()
  for (let i = 0; i < 3000; i++) seqTree.put(be(i), value)
  const descending = Store.create(await freshFile(), { frames: 64 })
  const descTree = descending.createTree()
  for (let i = 3000; i > 0; i--) descTree.put(be(i), value)
  const random = Store.create(await freshFile(), { frames: 64 })
  const randTree = random.createTree()
  const order = Array.from({ length: 3000 }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = (i * 7919 + 13) % (i + 1)
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  for (const i of order) randTree.put(be(i), value)
  for (const s of [sequential, descending, random]) verifyStore(s)
  const fills = { ascending: leafFill(sequential, seqTree), descending: leafFill(descending, descTree), random: leafFill(random, randTree) }
  assert.ok(fills.ascending >= 0.95, `ascending fill ${fills.ascending.toFixed(3)}`)
  assert.ok(fills.descending >= 0.95, `descending fill ${fills.descending.toFixed(3)}`)
  assert.ok(fills.random < 0.85, `random fill ${fills.random.toFixed(3)}`)
})

test('M4.9: a randomised insert/delete workload leaves no unreachable page, and emptying a tree returns its pages', async () => {
  const store = Store.create(await freshFile(), { frames: 32 })
  const tree = store.createTree()
  const keys = Array.from({ length: 2000 }, (_, i) => be((i * 2654435761) >>> 0))
  for (const k of keys) tree.put(k, new Uint8Array(20))
  const grown = store.alloc.usedPages().size
  for (const k of keys.filter((_, i) => i % 2 === 0)) tree.delete(k)
  verifyStore(store)
  for (const k of keys) tree.delete(k)
  verifyStore(store)
  assert.equal(tree.height(), 1, 'the root collapsed back to a leaf')
  assert.ok(store.alloc.usedPages().size < grown / 10, `${store.alloc.usedPages().size} pages still used of ${grown}`)
})

test('M4.4: a leaf behind the schema version is re-encoded before any write, through the insert path', async () => {
  const file = await freshFile()
  // Version 1 writes values of 10 bytes; version 2's upgrade doubles them, so
  // re-encoding cannot fit in place and must split.
  let store = Store.create(file, { frames: 32 })
  const v1 = store.createTree({ schemaVersion: 1, upgrade: (v) => v })
  for (let i = 0; i < 200; i++) v1.put(be(i), new Uint8Array(10).fill(1))
  store.flush()
  const upgrade = (v: Uint8Array, from: number) => {
    assert.equal(from, 1)
    const out = new Uint8Array(v.length * 2)
    out.set(v)
    return out
  }
  store = Store.open(file, { frames: 32 })
  const v2 = store.openTree(v1.indexId, { schemaVersion: 2, upgrade })
  const versions = { schemaVersion: () => 2 }
  verifyStore(store, versions)
  // A read upgrades without writing; the leaf stays at version 1.
  assert.equal(v2.get(be(5))?.length, 20)
  // A write to one leaf upgrades that leaf, splitting it.
  v2.put(be(5), new Uint8Array(20))
  verifyStore(store, versions)
  // Deleting everything else merges leaves of mixed versions; every value read
  // back is the upgraded one.
  for (let i = 0; i < 200; i += 2) v2.delete(be(i))
  verifyStore(store, versions)
  for (const [, v] of v2.entries()) assert.equal(v.length, 20)
})

test('review: an upgrade that makes records too big is refused with every row in place', async () => {
  const file = await freshFile()
  let store = Store.create(file, { frames: 32 })
  const v1 = store.createTree({ schemaVersion: 1, upgrade: (v) => v })
  for (let i = 0; i < 60; i++) v1.put(be(i), new Uint8Array(200))
  store.flush()
  store = Store.open(file, { frames: 32 })
  const grow = (v: Uint8Array) => new Uint8Array(Math.ceil(v.length * 1.8))
  const v2 = store.openTree(v1.indexId, { schemaVersion: 2, upgrade: grow })
  assert.throws(() => v2.put(be(1000), new Uint8Array(1)), (e: EngineError) => e.code === 'ER_TOO_BIG_ROWSIZE')
  assert.equal([...v2.entries()].length, 60)
  verifyStore(store, { schemaVersion: () => 2 })
})

test('review: deletes across leaves an upgrade has grown 2.5× rebalance only where the halves fit', async () => {
  const file = await freshFile()
  let store = Store.create(file, { frames: 32 })
  const v1 = store.createTree({ schemaVersion: 1, upgrade: (v) => v })
  for (let i = 0; i < 60; i++) v1.put(be(i), new Uint8Array(60))
  store.flush()
  store = Store.open(file, { frames: 32 })
  const v2 = store.openTree(v1.indexId, { schemaVersion: 2, upgrade: (v) => new Uint8Array(Math.ceil(v.length * 2.5)) })
  for (let i = 59; i >= 0; i--) {
    v2.delete(be(i))
    verifyStore(store, { schemaVersion: () => 2 })
  }
})

test('review: a tree opened at an older schema version than its leaves refuses them', async () => {
  const file = await freshFile()
  const store = Store.create(file, { frames: 32 })
  const v2 = store.createTree({ schemaVersion: 2, upgrade: (v) => v })
  v2.put(be(1), new Uint8Array(4))
  const stale = store.openTree(v2.indexId)
  assert.throws(() => stale.put(be(2), new Uint8Array(4)), (e: EngineError) => e.code === 'ENGINE_MISUSE')
  assert.throws(() => stale.get(be(1)), (e: EngineError) => e.code === 'ENGINE_MISUSE')
})

test('review: a file of more than one allocation group verifies', async () => {
  // At 512-byte pages a group is 40 extents, so a few thousand rows cross it.
  const file = await new MemoryVfs({ pageSize: 512 }).open('d', { create: true })
  const store = Store.create(file, { frames: 32 })
  const tree = store.createTree()
  for (let i = 0; store.alloc.pageCount <= 2560; i++) tree.put(be(i), new Uint8Array(100))
  verifyStore(store)
})
