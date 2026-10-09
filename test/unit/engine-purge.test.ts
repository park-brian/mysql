// M4.22 — purge, the history it works through, and the bound on it (Q-09).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { errnoOf, sqlStateOf } from '@myjs/protocol'
import { ClusteredIndex, EngineError, Store, verifyStore, type FieldBytes, type RecordLayout, type StoreOptions } from '@myjs/engine'

const PAGE = 1024
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }]
const primary = [{ field: 0, part: { kind: 'bytes' as const, nullable: false } }]
const big = (n: number) => new Uint8Array(2500).fill(n)

async function table(options: StoreOptions = {}) {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const files: [VfsFile, VfsFile] = [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
  const store = Store.create(...files, { frames: 64, ...options })
  const t = ClusteredIndex.create(store, layout, primary)
  const verify = () => verifyStore(store, { overflowRefs: (id, v) => (id === t.tree.indexId ? t.refsOf(v) : []) })
  return { store, t, verify, sys: store.transactions }
}

test('M4.22: the history rises while a view pins it, and purge gives every page back once it closes', async () => {
  const { store, t, verify, sys } = await table()
  const baseline = store.alloc.usedPages().size
  const pin = sys.begin()
  t.get(be(0), pin) // the view is taken
  for (let i = 0; i < 20; i++) t.insert([be(i), big(i)])
  for (let i = 0; i < 20; i++) t.update([be(i), big(i + 100)])
  for (let i = 0; i < 20; i++) t.delete(be(i))
  assert.equal(store.stats().historyLength, 60, 'nothing a view might need is purged')
  verify()
  pin.commit()
  assert.equal(store.purge(), 60)
  assert.equal(store.stats().historyLength, 0)
  verify()
  assert.equal(store.alloc.usedPages().size, baseline, 'every row, version, chain and undo page is gone')
})

test('M4.22 / Q-09: a view that pins more history than maxHistory expires, and its next read is 1213', async () => {
  const { store, t, sys } = await table({ maxHistory: 5 })
  t.insert([be(1), null])
  const old = sys.begin()
  assert.ok(t.get(be(1), old) !== undefined)
  for (let i = 0; i < 10; i++) t.update([be(1), Uint8Array.of(i)])
  assert.ok(store.stats().historyLength <= 5, `history ${store.stats().historyLength}`)
  const e = (() => {
    try {
      t.get(be(1), old)
    } catch (err) {
      return err as EngineError
    }
    assert.fail('the expired view read')
  })()
  assert.equal(e.code, 'ER_LOCK_DEADLOCK')
  assert.equal(e.errno, errnoOf('ER_LOCK_DEADLOCK'))
  assert.equal(e.sqlState, sqlStateOf('ER_LOCK_DEADLOCK'))
  assert.equal(store.stats().expiredViews, 1)
  old.rollback()
  assert.equal(store.stats().expiredViews, 0)
})

test('M4.22: purge removes a delete-marked row only while the mark is still the purged transaction’s', async () => {
  const { store, t, verify, sys } = await table()
  t.insert([be(1), Uint8Array.of(0)])
  const hold = sys.begin()
  t.get(be(1), hold) // keeps T1 below from being purged at once
  t.delete(be(1)) // T1 marks it
  t.insert([be(1), Uint8Array.of(2)]) // T2 takes it back
  const v = sys.begin()
  assert.deepEqual(t.get(be(1), v)?.[1], Uint8Array.of(2), 'v sees T2')
  t.delete(be(1)) // T3 marks it again; v cannot see that
  hold.commit()
  store.purge() // T1 is purged; T3's mark is not T1's to remove
  assert.deepEqual(t.get(be(1), v)?.[1], Uint8Array.of(2), 'v still finds the row T3 deleted')
  v.commit()
  store.purge()
  assert.equal(t.tree.get(be(1)), undefined, 'and once no view needs it, T3’s purge removes it')
  verify()
})

test('M4.22: every chain is freed exactly once — updated twice and deleted in one transaction, or rolled back past', async () => {
  const { store, t, verify, sys } = await table()
  const baseline = store.alloc.usedPages().size
  t.insert([be(1), big(1)])
  const w = sys.begin()
  t.update([be(1), big(2)], w)
  const sp = w.savepoint()
  t.update([be(1), big(3)], w)
  w.rollbackTo(sp) // frees big(3)'s chain
  t.update([be(1), big(4)], w)
  t.delete(be(1), w)
  verify()
  w.commit()
  store.purge()
  verify()
  assert.equal(store.alloc.usedPages().size, baseline)
})

test('M4.20: rolling back a re-insert over a mark whose transaction is purged removes the entry, not a mark nothing would purge', async () => {
  const { store, t, verify, sys } = await table()
  const baseline = store.alloc.usedPages().size
  t.insert([be(1), big(1)])
  const w = sys.begin()
  t.delete(be(1)) // committed at once, and purged — no view needs it
  assert.equal(t.tree.get(be(1)), undefined)
  // Purge cannot run while a re-insert is open over the mark, so arrange it:
  t.insert([be(1), big(2)])
  const r = sys.begin()
  t.get(be(1), r)
  t.delete(be(1)) // T marks it; r pins T
  t.insert([be(1), big(3)], w) // w re-inserts over T's mark
  r.commit()
  store.purge() // T is purged under w's open re-insert
  w.rollback() // …so the mark w restores would never go
  assert.equal(t.tree.get(be(1)), undefined)
  store.purge()
  verify()
  assert.equal(store.alloc.usedPages().size, baseline)
})

test('M5.37: purge spends a budget of undo records, and a transaction it ends inside is finished by the next purge', async () => {
  const { store, t, verify, sys } = await table()
  const baseline = store.alloc.usedPages().size
  const pin = sys.begin()
  t.get(be(0), pin)
  // One transaction that deletes 300 rows: 300 undo records, more than one budget.
  const w = sys.begin()
  for (let i = 0; i < 300; i++) t.insert([be(i), Uint8Array.of(i & 0xff)], w)
  w.commit()
  const d = sys.begin()
  for (let i = 0; i < 300; i++) t.delete(be(i), d)
  d.commit()
  pin.commit()
  assert.equal(store.stats().historyLength, 2)
  // The insert's undo goes in one budget; the delete's runs past the next.
  assert.equal(store.purge(Infinity, 300), 1, 'the first transaction fits its budget')
  assert.equal(store.purge(Infinity, 100), 0, 'the second does not finish in 100 records')
  assert.equal(store.stats().historyLength, 1, 'and stays at the head of the history')
  verify()
  assert.equal(store.purge(Infinity, 100), 0)
  assert.equal(store.purge(), 1, 'the next purge goes on where the last one stopped')
  assert.equal(store.stats().historyLength, 0)
  verify()
  assert.equal(store.alloc.usedPages().size, baseline)
})

test('M5.38: a scan paused while purge frees the leaves ahead of it, and new rows take their pages, resumes with exactly the rows its view sees', async () => {
  const { store, t, verify, sys } = await table()
  const row = (i: number): [Uint8Array, Uint8Array] => [be(i), Uint8Array.of(i & 0xff, 0xaa, 0xbb, 0xcc)]
  // Seven leaves of small rows.
  for (let i = 0; i < 400; i += 2) t.insert(row(i))
  // Rows deleted before the reader's view: it cannot see them, so purge may
  // remove them while it reads. A view held across the delete keeps the
  // commit's own purge from doing it first.
  const pin = sys.begin()
  t.get(be(0), pin)
  const d = sys.begin()
  for (let i = 40; i < 390; i += 2) t.delete(be(i), d)
  d.commit()
  pin.commit()
  const reader = sys.begin()
  const key = (next: IteratorResult<[Uint8Array, FieldBytes[]]>): number => new DataView((next.value as [Uint8Array, FieldBytes[]])[0].buffer).getUint32(0)
  const scan = t.scan({}, reader)
  const seen: number[] = []
  for (let k = 0; k < 3; k++) seen.push(key(scan.next()))
  // While the scan is paused, after its first leaf: purge empties and frees
  // the leaves the sibling links lead through, and rows past the end take
  // those pages again, so a link followed now leads somewhere else.
  assert.equal(store.purge(), 1)
  const w = sys.begin()
  for (let i = 1001; i < 4000; i += 2) t.insert(row(i), w)
  w.commit()
  for (let next = scan.next(); next.done !== true; next = scan.next()) seen.push(key(next))
  reader.commit()
  const want = Array.from({ length: 200 }, (_, i) => i * 2).filter((i) => i < 40 || i >= 390)
  assert.deepEqual(seen, want, 'every key the view sees, once each, in order')
  verify()
})
