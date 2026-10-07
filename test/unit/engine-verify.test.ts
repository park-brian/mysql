// The instrument, checked before it is trusted: each structural claim
// `verifyStore` makes is broken on purpose here, and it must notice. A checker
// that passes a corrupt store is worse than none, because it is believed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs } from '@myjs/vfs'
import { EngineError, Store, indexPage as ip, segmentId, verifyStore, writeChain, type BTree } from '@myjs/engine'

const PAGE = 1024
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)

async function built(): Promise<{ store: Store; tree: BTree }> {
  const store = Store.create(await new MemoryVfs({ pageSize: PAGE }).open('d', { create: true }), { frames: 32 })
  const tree = store.createTree()
  for (let i = 0; i < 2003; i++) tree.put(be(((i * 7919) % 2003) * 3), new Uint8Array(40))
  assert.ok(tree.height() >= 3)
  verifyStore(store)
  return { store, tree }
}

/** Change a page in place, as a bug would. */
function tamper(store: Store, pageNo: number, change: (page: Uint8Array) => void): void {
  const page = store.pool.fetch(pageNo)
  change(page)
  store.pool.markDirty(page, store.lsn.next())
  store.pool.release(page)
}

const read = <T>(store: Store, pageNo: number, use: (page: Uint8Array) => T): T => {
  const page = store.pool.fetch(pageNo)
  try {
    return use(page)
  } finally {
    store.pool.release(page)
  }
}

const caught = (store: Store, what: RegExp) =>
  assert.throws(() => verifyStore(store), (e: EngineError) => e instanceof EngineError && what.test(e.message), String(what))

/** The leftmost leaf, and the root's second child. */
function landmarks(store: Store, tree: BTree): { leaf: number; child: number } {
  let pageNo = tree.root
  while (read(store, pageNo, (p) => ip.level(p)) > 0) pageNo = read(store, pageNo, (p) => ip.childAt(p, 0))
  return { leaf: pageNo, child: read(store, tree.root, (p) => ip.childAt(p, 1)) }
}

test('verify: a separator off by one — a key below its bound — is caught', async () => {
  const { store, tree } = await built()
  // Raise the root's second separator past the first key it covers.
  tamper(store, tree.root, (p) => {
    const key = ip.keyAt(p, 1)
    key[3] = (key[3] as number) + 1
  })
  caught(store, /below its separator/)
})

test('verify: a leaked page is caught', async () => {
  const { store, tree } = await built()
  store.alloc.allocate(segmentId(tree.indexId, 0), 99)
  caught(store, /allocated but unreachable/)
})

test('verify: a page in use but free in the maps is caught', async () => {
  const { store, tree } = await built()
  store.alloc.free(landmarks(store, tree).child)
  caught(store, /reachable but free/)
})

test('verify: a stale sibling link is caught', async () => {
  const { store, tree } = await built()
  const { leaf } = landmarks(store, tree)
  tamper(store, leaf, (p) => ip.setRightSibling(p, ip.rightSibling(p) + 1))
  caught(store, /right link/)
})

test('verify: an unsorted slot is caught', async () => {
  const { store, tree } = await built()
  const { leaf } = landmarks(store, tree)
  tamper(store, leaf, (p) => {
    // Swap the first two slots.
    const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
    const a = v.getUint16(PAGE - 10)
    v.setUint16(PAGE - 10, v.getUint16(PAGE - 12))
    v.setUint16(PAGE - 12, a)
  })
  caught(store, /out of order/)
})

test('verify: a leaked overflow chain is caught', async () => {
  const { store, tree } = await built()
  writeChain(tree.overflowPages(), new Uint8Array(3000))
  // Two checks see it: the overflow segment's fragment count no longer matches
  // what is reachable, and neither do the maps. The first to run reports it.
  caught(store, /allocated but unreachable|fragment pages in segment 2/)
})

test('verify: a wrong fragment count is caught', async () => {
  const { store, tree } = await built()
  tamper(store, tree.root, (p) => ip.setFragments(p, 0, ip.fragments(p, 0) + 1))
  caught(store, /fragment pages/)
})

test('verify: a leaf ahead of its schema version is caught, as is a leaked pin', async () => {
  const { store, tree } = await built()
  tamper(store, landmarks(store, tree).leaf, (p) => ip.setSchemaVersion(p, 3))
  caught(store, /ahead of its index/)
  ip.setSchemaVersion(store.pool.fetch(landmarks(store, tree).leaf), 0)
  caught(store, /still pinned/)
})
