// M4.20 — roll pointers, undo records and version chains.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { ClusteredIndex, EngineError, Store, UndoLog, decodeUndo, encodeUndo, readRollPtr, readUndo, rollPtrBits, verifyStore, writeRollPtr, type RecordLayout, type UndoRecord } from '@myjs/engine'

const PAGE = 1024
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }]
const primary = [{ field: 0, part: { kind: 'bytes' as const, nullable: false } }]

async function files(): Promise<[VfsFile, VfsFile]> {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  return [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
}

test("M4.20: a roll pointer is doc 25's 56 bits — is_insert, undo space, page, offset — byte for byte", () => {
  fc.assert(
    fc.property(fc.boolean(), fc.integer({ min: 1, max: 0xffffffff }), fc.integer({ min: 0, max: 0xffff }), (isInsert, page, offset) => {
      const p = { isInsert, page, offset }
      const bytes = new Uint8Array(9)
      writeRollPtr(bytes, 1, p)
      // The seven bytes, read as one big-endian integer, are doc 25's expression.
      let n = 0n
      for (let i = 1; i < 8; i++) n = (n << 8n) | BigInt(bytes[i] as number)
      assert.equal(n, rollPtrBits(p))
      assert.equal(n >> 55n, isInsert ? 1n : 0n, 'bit 55 is is_insert')
      assert.equal((n >> 48n) & 0x7fn, 0n, 'bits 54–48 are the undo space, always 0')
      assert.deepEqual(readRollPtr(bytes, 1), p)
    }),
  )
  const none = new Uint8Array(7).fill(9)
  writeRollPtr(none, 0, null)
  assert.equal(readRollPtr(none, 0), null, 'all zero is no previous version')
})

test('M4.20: an undo record round-trips, and any bytes decode to one or to ENGINE_CORRUPT_UNDO', () => {
  const r: UndoRecord = { isInsert: false, purgeRemoves: true, indexId: 7, key: be(3), old: new Uint8Array(300).fill(4), freeOnPurge: [new Uint8Array(8).fill(1)], freeOnRollback: [new Uint8Array(8).fill(2), new Uint8Array(8).fill(3)] }
  const bytes = encodeUndo(r)
  assert.deepEqual(decodeUndo(bytes), r)
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.nat(bytes.length - 1), fc.nat(255)), { minLength: 1, maxLength: 4 }), fc.nat(bytes.length), (edits, cut) => {
      const mutated = bytes.slice(0, Math.max(1, cut))
      for (const [at, v] of edits) if (at < mutated.length) mutated[at] = v
      try {
        decodeUndo(mutated)
      } catch (e) {
        assert.ok(e instanceof EngineError && e.code === 'ENGINE_CORRUPT_UNDO', String(e))
      }
    }),
  )
})

test('M4.20: an undo log spans pages, reopens to the same records, and truncation frees what follows', async () => {
  const store = Store.create(...(await files()), { frames: 32 })
  const pages = store.trxTree.overflowPages()
  const log = store.atomically(() => UndoLog.create(pages))
  const records: UndoRecord[] = []
  for (let i = 0; i < 40; i++) {
    const r: UndoRecord = { isInsert: i % 3 === 0, purgeRemoves: i % 2 === 0, indexId: i, key: be(i), old: i % 3 === 0 ? null : new Uint8Array(37 * i).fill(i), freeOnPurge: [], freeOnRollback: [] }
    store.atomically(() => log.append(pages, r))
    records.push(r)
  }
  const reopened = UndoLog.open(store.pool, log.first, store.alloc.pageCount)
  assert.deepEqual(reopened.records, log.records)
  assert.deepEqual(log.records.map((at) => log.read(store.pool, at)), records)
  const before = store.alloc.usedPages().size
  store.atomically(() => log.truncate(pages, 5))
  assert.ok(store.alloc.usedPages().size < before, 'the pages after the cut are freed')
  assert.deepEqual(UndoLog.open(store.pool, log.first, store.alloc.pageCount).records, log.records.slice(0, 5))
  store.atomically(() => log.free(pages))
})

test('M4.20: an older version rebuilds correctly — ten transactions, ten views, each sees its own', async () => {
  const store = Store.create(...(await files()), { frames: 64 })
  const table = ClusteredIndex.create(store, layout, primary)
  const value = (n: number) => new Uint8Array(n === 7 ? 3000 : 10 + n).fill(n)
  // What view n sees: the ninth transaction deletes the row, so view 9 sees none.
  const seen = (n: number) => (n === 9 ? undefined : value(n))
  table.insert([be(1), value(0)])
  const readers = []
  for (let n = 1; n <= 10; n++) {
    const reader = store.begin()
    assert.deepEqual(table.get(be(1), reader)?.[1], seen(n - 1), 'the view is taken at the first read')
    readers.push(reader)
    // The ninth transaction deletes it, and the tenth puts it back.
    if (n === 9) table.delete(be(1))
    else if (n === 10) table.insert([be(1), value(n)])
    else table.update([be(1), value(n)])
  }
  readers.forEach((r, i) => assert.deepEqual(table.get(be(1), r)?.[1], seen(i), `view ${i}`))
  assert.equal(store.stats().historyLength, 10, 'every version is pinned by some view')
  for (const r of readers) r.commit()
  store.purge()
  assert.equal(store.stats().historyLength, 0)
  assert.deepEqual(table.get(be(1))?.[1], value(10))
  verifyStore(store, { overflowRefs: (id, v) => (id === table.tree.indexId ? table.refsOf(v) : []) })
})

test('M5.42: a corrupt undo length or a short roll pointer is ENGINE_CORRUPT_UNDO, not a raw RangeError or a 4 GB allocation', async () => {
  const store = Store.create(...(await files()), { frames: 32 })
  const pages = store.trxTree.overflowPages()
  const log = store.atomically(() => UndoLog.create(pages))
  store.atomically(() => log.append(pages, { isInsert: true, purgeRemoves: false, indexId: 1, key: be(1), old: null, freeOnPurge: [], freeOnRollback: [] }))
  const at = log.records[0] as { page: number; offset: number }
  // The length a record starts with, overwritten in the cached page as a torn write would leave it.
  store.pool.read(at.page, (p) => new DataView(p.buffer, p.byteOffset).setUint32(at.offset, 0xfffffff0))
  assert.throws(() => readUndo(store.pool, at), (e: unknown) => e instanceof EngineError && e.code === 'ENGINE_CORRUPT_UNDO')
  assert.throws(() => readRollPtr(new Uint8Array(10), 7), (e: unknown) => e instanceof EngineError && e.code === 'ENGINE_CORRUPT_UNDO')
})
