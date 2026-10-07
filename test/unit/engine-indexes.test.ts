// M4.11 and M4.6 — clustered and secondary indexes, and the overflow pages a
// long column moves to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs } from '@myjs/vfs'
import { declaredKeyWidth, encodeInt } from '@myjs/types'
import { ClusteredIndex, EngineError, SecondaryIndex, Store, decodeRecord, externalRefs, verifyStore, type FieldBytes, type KeyColumn, type RecordLayout } from '@myjs/engine'

const PAGE = 1024
const utf8 = (s: string) => new TextEncoder().encode(s)
const int = (n: number) => encodeInt(BigInt(n), 4, false)
const UTF8MB4_BIN = 46

// id INT PRIMARY KEY, name VARCHAR(10) COLLATE utf8mb4_bin NULL, body BLOB NULL
const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }, { nullable: true }]
const primary: KeyColumn[] = [{ field: 0, part: { kind: 'bytes', nullable: false } }]
const byName: KeyColumn[] = [{ field: 1, part: { kind: 'text', nullable: true, collationId: UTF8MB4_BIN, width: declaredKeyWidth(UTF8MB4_BIN, 10) } }]

async function table(frames = 64) {
  const store = Store.create(await new MemoryVfs({ pageSize: PAGE }).open('d', { create: true }), { frames })
  const clustered = ClusteredIndex.create(store, layout, primary)
  return { store, clustered }
}

const verify = (store: Store, clustered: ClusteredIndex) =>
  verifyStore(store, { overflowRefs: (id, value) => (id === clustered.tree.indexId ? externalRefs(layout, value) : []) })

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
  const record = clustered.tree.get(key) as Uint8Array
  assert.ok(record.length < 40)
  assert.equal(externalRefs(layout, record).length, 1)
  assert.ok(!(decodeRecord(layout, record)[2] instanceof Uint8Array))
  const stored = store.alloc.usedPages().size
  assert.ok(stored - baseline >= (1 << 20) / PAGE, `${stored - baseline} pages hold 1 MiB`)
  verify(store, clustered)

  // Through a reopen, too.
  store.flush()
  const reopened = Store.open(store.file, { frames: 64 })
  const again = new ClusteredIndex(reopened.openTree(clustered.tree.indexId), layout, primary)
  const back = again.get(key) as FieldBytes[]
  assert.equal(back[2]?.length, 1 << 20)
  assert.ok((back[2] as Uint8Array).every((b, i) => b === ((i * 31) & 0xff)))

  assert.equal(again.delete(key), true)
  verify(reopened, again)
  assert.ok(reopened.alloc.usedPages().size <= baseline + 1, 'the chain is gone, page for page')
})
