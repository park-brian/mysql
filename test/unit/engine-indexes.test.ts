// M4.11 and M4.6 — clustered and secondary indexes, and the overflow pages a
// long column moves to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { declaredKeyWidth, encodeInt } from '@myjs/types'
import { CLUSTERED_HEADER, ClusteredIndex, EngineError, SecondaryIndex, Store, decodeRecord, externalRefs, verifyStore, type FieldBytes, type KeyColumn, type RecordLayout } from '@myjs/engine'

const PAGE = 1024
const utf8 = (s: string) => new TextEncoder().encode(s)
const int = (n: number) => encodeInt(BigInt(n), 4, false)
const UTF8MB4_BIN = 46

/** A database's two files: data and log. */
async function files(pageSize: number): Promise<[VfsFile, VfsFile]> {
  const vfs = new MemoryVfs({ pageSize })
  return [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
}

// id INT PRIMARY KEY, name VARCHAR(10) COLLATE utf8mb4_bin NULL, body BLOB NULL
const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }, { nullable: true }]
const primary: KeyColumn[] = [{ field: 0, part: { kind: 'bytes', nullable: false } }]
const byName: KeyColumn[] = [{ field: 1, part: { kind: 'text', nullable: true, collationId: UTF8MB4_BIN, width: declaredKeyWidth(UTF8MB4_BIN, 10) } }]

async function table(frames = 64) {
  const store = Store.create(...(await files(PAGE)), { frames })
  const clustered = ClusteredIndex.create(store, layout, primary)
  return { store, clustered }
}

const verify = (store: Store, clustered: ClusteredIndex) =>
  verifyStore(store, { overflowRefs: (id, value) => (id === clustered.tree.indexId ? clustered.refsOf(value) : []) })

test('clustered UPDATE and delete-mark prepare after one descent and emit only actual row changes', async () => {
  const { store, clustered } = await table()
  for (let i = 0; i < 800; i++) clustered.insert([int(i), utf8('old'), null])
  const tree = clustered.tree
  const height = tree.height()
  assert.ok(height > 1)
  const upsert = tree.upsert.bind(tree)
  let preparations = 0
  tree.upsert = (key, prepare) => {
    const before = store.pool.stats.fetches
    const pins = store.pool.pinned()
    upsert(key, (current) => {
      preparations++
      assert.equal(store.pool.stats.fetches - before, height)
      assert.equal(store.pool.pinned(), pins, 'the leaf read adds no retained pin')
      return prepare(current)
    })
  }
  const get = tree.get.bind(tree)
  const put = tree.put.bind(tree)
  tree.get = () => { throw new Error('unexpected second descent through get') }
  tree.put = () => { throw new Error('unexpected second descent through put') }
  const writer = store.begin()
  assert.equal(clustered.update([int(400), utf8('new'), null], writer), true)
  assert.equal(clustered.delete(int(401), writer), true)
  const savepoint = writer.savepoint()
  for (const id of [401, 900]) {
    assert.equal(clustered.update([int(id), utf8('missing'), null], writer), false)
    assert.equal(clustered.delete(int(id), writer), false)
  }
  assert.equal(writer.savepoint(), savepoint, 'absent and marked rows append no undo')
  assert.equal(preparations, 6)
  tree.get = get
  tree.put = put
  writer.commit()
  const changes = [...store.history()].flatMap((g) => g.records).filter((r) => r.type === 'row' && r.trxId === writer.id)
  assert.deepEqual(changes, [
    { type: 'row', indexId: tree.indexId, trxId: writer.id, before: [int(400), utf8('old'), null], after: [int(400), utf8('new'), null] },
    { type: 'row', indexId: tree.indexId, trxId: writer.id, before: [int(401), utf8('old'), null], after: null },
  ])
  assert.deepEqual(clustered.get(int(400)), [int(400), utf8('new'), null])
  assert.equal(clustered.get(int(401)), undefined)
  verify(store, clustered)
})

test('prepared clustered mutations retain overflow history and roll back failed preparation', async () => {
  const { store, clustered } = await table(32)
  const inlinePages = store.alloc.usedPages().size
  const original: FieldBytes[] = [int(1), utf8('old'), new Uint8Array(8192).fill(0x81)]
  const replacement: FieldBytes[] = [int(1), utf8('new'), new Uint8Array(12288).fill(0x9f)]
  clustered.insert(original)
  const reader = store.begin()
  assert.deepEqual(clustered.get(int(1), reader), original)
  const writer = store.begin()
  clustered.insert([int(2), null, null], writer)
  const savepoint = writer.savepoint()
  const pages = store.alloc.usedPages().size
  const upsert = clustered.tree.upsert.bind(clustered.tree)
  const failure = new Error('fail after encoding overflow and undo')
  clustered.tree.upsert = (key, prepare) => upsert(key, (current) => {
    prepare(current)
    throw failure
  })
  for (const change of [() => clustered.update(replacement, writer), () => clustered.delete(int(1), writer)]) {
    assert.throws(change, (e) => e === failure)
    assert.equal(writer.savepoint(), savepoint)
    assert.equal(store.alloc.usedPages().size, pages, 'failed preparation frees its overflow and undo')
    assert.deepEqual(clustered.get(int(1), writer), original)
    verify(store, clustered)
  }
  clustered.tree.upsert = upsert
  assert.equal(clustered.update(replacement, writer), true)
  assert.deepEqual(clustered.get(int(1), writer), replacement)
  assert.deepEqual(clustered.get(int(1), reader), original)
  writer.commit()
  store.purge()
  assert.deepEqual(clustered.get(int(1), reader), original, 'the old overflow survives while its view needs it')
  assert.equal(clustered.delete(int(1)), true)
  assert.equal(clustered.get(int(1)), undefined)
  assert.deepEqual(clustered.get(int(1), reader), original, 'delete-mark retains the historical chain')
  verify(store, clustered)
  reader.commit()
  store.purge()
  assert.ok(store.alloc.usedPages().size <= inlinePages + 1, 'purge frees both overflow versions')
  verify(store, clustered)
})

test('M4.11: a non-covering secondary lookup costs exactly one extra descent, and the test proves it', async () => {
  const { store, clustered } = await table()
  const names = SecondaryIndex.create(store, clustered, byName)
  for (let i = 0; i < 2100; i++) {
    const row: FieldBytes[] = [int(i), utf8(`n${i % 700}`), null]
    names.insert(row, clustered.insert(row))
  }
  assert.ok(clustered.tree.height() >= 2 && names.tree.height() >= 2, "both trees have internal levels")
  verify(store, clustered)

  const fetches = () => store.pool.stats.fetches
  let before = fetches()
  const keys = names.primaryKeys([utf8('n123')])
  const covering = fetches() - before
  assert.equal(keys.length, 3, 'n123 names rows 123, 823 and 1523')

  before = fetches()
  const rows = names.find([utf8('n123')])
  const nonCovering = fetches() - before
  assert.deepEqual(rows.map((r) => new DataView((r[0] as Uint8Array).buffer).getInt32(0) ^ -0x80000000).sort((a, b) => a - b), [123, 823, 1523])
  // One clustered descent per row found: its height in pages, and nothing else.
  assert.equal(nonCovering - covering, rows.length * clustered.tree.height())
})

test('M4.11: a unique index refuses a duplicate key, never a NULL, and compares under its collation', async () => {
  const { store, clustered } = await table()
  const names = SecondaryIndex.create(store, clustered, byName, { unique: true, name: 'by_name' })
  const add = (id: number, name: string | null) => {
    const row: FieldBytes[] = [int(id), name === null ? null : utf8(name), null]
    // Uniqueness is checked before anything is written, as a transaction would need.
    names.insert(row, clustered.keyOf(row))
    clustered.insert(row)
  }
  add(1, 'a')
  add(2, null)
  add(3, null)
  assert.throws(() => add(4, 'a'), (e: EngineError) => e.code === 'ER_DUP_ENTRY' && e.errno === 1062 && /by_name/.test(e.message))
  // utf8mb4_bin is PAD SPACE: 'a' and 'a ' are the same key.
  assert.throws(() => add(5, 'a  '), (e: EngineError) => e.code === 'ER_DUP_ENTRY')
  assert.throws(() => clustered.insert([int(1), null, null]), (e: EngineError) => e.code === 'ER_DUP_ENTRY' && /PRIMARY/.test(e.message))
  assert.equal(names.find([null]).length, 2, 'two NULLs, both found')
  verify(store, clustered)
})

test('M4.11: a key too long for the page, or a variable part with no width, is refused when the index is defined', async () => {
  const { store, clustered } = await table()
  const wide: KeyColumn[] = [{ field: 1, part: { kind: 'text', nullable: true, collationId: UTF8MB4_BIN, width: declaredKeyWidth(UTF8MB4_BIN, 200) } }]
  assert.throws(() => SecondaryIndex.create(store, clustered, wide), (e: EngineError) => e.code === 'ER_TOO_LONG_KEY' && e.errno === 1071)
  const unbounded: KeyColumn[] = [{ field: 2, part: { kind: 'bytes', nullable: true } }]
  assert.throws(() => SecondaryIndex.create(store, clustered, unbounded), (e: EngineError) => e.code === 'ENGINE_MISUSE' && /declared width/.test(e.message))
  // Neither refusal left a tree behind.
  verify(store, clustered)
})

test('M4.6: a 1 MB value round-trips, and its pages are freed on delete', async () => {
  const { store, clustered } = await table()
  const body = Uint8Array.from({ length: 1 << 20 }, (_, i) => (i * 31) & 0xff)
  const baseline = store.alloc.usedPages().size
  const key = clustered.insert([int(1), utf8('big'), body])
  // Off-page with no local prefix: the record holds an 8-byte reference.
  const record = (clustered.tree.get(key) as Uint8Array).subarray(CLUSTERED_HEADER)
  assert.ok(record.length < 40)
  assert.equal(externalRefs(layout, record).length, 1)
  assert.ok(!(decodeRecord(layout, record)[2] instanceof Uint8Array))
  const stored = store.alloc.usedPages().size
  assert.ok(stored - baseline >= (1 << 20) / PAGE, `${stored - baseline} pages hold 1 MiB`)
  verify(store, clustered)

  // Through a reopen, too.
  store.checkpoint()
  const reopened = Store.open(store.file, store.logFile, { frames: 64 })
  const again = new ClusteredIndex(reopened.openTree(clustered.tree.indexId), layout, primary)
  const back = again.get(key) as FieldBytes[]
  assert.equal(back[2]?.length, 1 << 20)
  assert.ok((back[2] as Uint8Array).every((b, i) => b === ((i * 31) & 0xff)))

  assert.equal(again.delete(key), true)
  verify(reopened, again)
  assert.ok(reopened.alloc.usedPages().size <= baseline + 1, 'the chain is gone, page for page')
})
