// M4.21 — read views, isolation, and the single writer, against models that
// know nothing about undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { ClusteredIndex, EngineError, ReadView, SecondaryIndex, Store, verifyStore, type FieldBytes, type KeyColumn, type RecordLayout, type Trx } from '@myjs/engine'

const PAGE = 1024
const RUNS = Number(process.env.ENGINE_RUNS ?? 40)
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const hex = (b: Uint8Array | null | undefined) => (b === null || b === undefined ? '-' : Buffer.from(b).toString('hex'))

// id INT PRIMARY KEY, val VARBINARY(8) NULL (indexed), body BLOB NULL
const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }, { nullable: true }]
const primary: KeyColumn[] = [{ field: 0, part: { kind: 'bytes', nullable: false } }]
const byVal: KeyColumn[] = [{ field: 1, part: { kind: 'bytes', nullable: true, width: 8 } }]

async function table(frames = 64) {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const files: [VfsFile, VfsFile] = [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
  const store = Store.create(...files, { frames })
  const clustered = ClusteredIndex.create(store, layout, primary)
  const secondary = SecondaryIndex.create(store, clustered, byVal)
  return { store, clustered, secondary }
}

const verify = (store: Store, clustered: ClusteredIndex) => verifyStore(store, { overflowRefs: (id, v) => (id === clustered.tree.indexId ? clustered.refsOf(v) : []) })
const busy = (e: unknown) => e instanceof EngineError && e.code === 'ENGINE_WRITER_BUSY'

test("M4.21: isVisible agrees with the history it summarises, for every combination doc 25's table names", () => {
  // A history of transactions beginning and committing in some order. A
  // version by trx x is visible to a view made at time t by creator c exactly
  // when x is c, or x committed before t. The view is built from what was
  // active at t — the formula's inputs — and must reproduce that answer.
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }), fc.nat(), fc.nat(), (events, at, who) => {
      let next = 1
      const active = new Set<number>()
      const committedAt = new Map<number, number>()
      const timeline: { t: number; next: number; active: number[] }[] = []
      events.forEach((begin, t) => {
        if (begin || active.size === 0) active.add(next++)
        else {
          const ids = [...active]
          const id = ids[t % ids.length] as number
          active.delete(id)
          committedAt.set(id, t)
        }
        timeline.push({ t, next, active: [...active] })
      })
      const moment = timeline[at % timeline.length] as { t: number; next: number; active: number[] }
      const creator = moment.active.length > 0 && who % 3 === 0 ? (moment.active[who % moment.active.length] as number) : 0
      const view = new ReadView(moment.next, moment.active.filter((id) => id !== creator), () => creator)
      for (let x = 1; x < next + 2; x++) {
        const committed = committedAt.has(x) && (committedAt.get(x) as number) <= moment.t
        assert.equal(view.isVisible(x), x === creator || committed, `trx ${x}, view at ${moment.t}, creator ${creator}`)
      }
    }),
    { numRuns: 500 },
  )
})

test('M4.21: REPEATABLE READ keeps its snapshot; READ COMMITTED takes a new one per statement', async () => {
  const { clustered } = await table()
  clustered.insert([be(1), Uint8Array.of(1), null])
  const rr = clustered.tree.space.transactions.begin('REPEATABLE READ')
  const rc = clustered.tree.space.transactions.begin('READ COMMITTED')
  assert.deepEqual(clustered.get(be(1), rr)?.[1], Uint8Array.of(1))
  assert.deepEqual(clustered.get(be(1), rc)?.[1], Uint8Array.of(1))
  clustered.update([be(1), Uint8Array.of(2), null])
  assert.deepEqual(clustered.get(be(1), rr)?.[1], Uint8Array.of(1), 'RR: the same answer')
  assert.deepEqual(clustered.get(be(1), rc)?.[1], Uint8Array.of(1), 'RC: the same answer within a statement')
  rc.statement()
  assert.deepEqual(clustered.get(be(1), rc)?.[1], Uint8Array.of(2), 'RC: the next statement sees the commit')
  rr.statement()
  assert.deepEqual(clustered.get(be(1), rr)?.[1], Uint8Array.of(1), 'RR: a statement boundary changes nothing')
})

test("M4.21: SELECT … FOR UPDATE sees the latest committed version under REPEATABLE READ — doc 25's current read", async () => {
  const { clustered } = await table()
  clustered.insert([be(1), Uint8Array.of(1), null])
  const r = clustered.tree.space.transactions.begin()
  assert.deepEqual(clustered.get(be(1), r)?.[1], Uint8Array.of(1))
  clustered.update([be(1), Uint8Array.of(2), null])
  assert.deepEqual(clustered.get(be(1), r, 'current')?.[1], Uint8Array.of(2), 'the current read sees the commit')
  assert.deepEqual(clustered.get(be(1), r)?.[1], Uint8Array.of(1), 'the consistent read still does not')
  // …and the locking read made it the writer, for the rest of its transaction.
  assert.throws(() => clustered.update([be(1), Uint8Array.of(3), null]), busy)
  r.commit()
  clustered.update([be(1), Uint8Array.of(3), null])
})

test('D-08: one writer — a second transaction that writes or locks is refused at once, and readers are not', async () => {
  const { clustered } = await table()
  clustered.insert([be(1), Uint8Array.of(1), null])
  const w = clustered.tree.space.transactions.begin()
  clustered.update([be(1), Uint8Array.of(2), null], w)
  const other = clustered.tree.space.transactions.begin()
  assert.throws(() => clustered.insert([be(2), null, null], other), busy)
  assert.throws(() => clustered.get(be(1), other, 'current'), busy)
  assert.throws(() => clustered.insert([be(2), null, null]), busy, 'an autocommit write too')
  assert.deepEqual(clustered.get(be(1), other)?.[1], Uint8Array.of(1), 'a reader sees the committed version')
  assert.deepEqual(clustered.get(be(1))?.[1], Uint8Array.of(1), 'so does an autocommit read')
  assert.deepEqual(clustered.get(be(1), w)?.[1], Uint8Array.of(2), 'the writer sees its own change')
  w.rollback()
  assert.deepEqual(clustered.get(be(1))?.[1], Uint8Array.of(1))
  other.commit()
})

test('M4.21: a secondary index answers each view through a key change, a delete and a re-insert', async () => {
  const { clustered, secondary } = await table()
  const sys = clustered.tree.space.transactions
  const row = (val: number) => [be(7), Uint8Array.of(val), null]
  const put = (r: FieldBytes[], t?: Trx) => secondary.insert(r, clustered.insert(r, t), t)
  put(row(1))
  const v1 = sys.begin()
  assert.equal(secondary.primaryKeys([Uint8Array.of(1)], v1).length, 1)
  // The key changes from 1 to 2.
  const w = sys.begin()
  secondary.delete(row(1), be(7), w)
  secondary.insert(row(2), be(7), w)
  clustered.update(row(2), w)
  w.commit()
  const v2 = sys.begin()
  assert.equal(secondary.primaryKeys([Uint8Array.of(1)], v2).length, 0)
  // The row goes, and comes back with key 1 — the old entry is taken back.
  const d = sys.begin()
  secondary.delete(row(2), be(7), d)
  clustered.delete(be(7), d)
  d.commit()
  const v3 = sys.begin()
  assert.equal(secondary.primaryKeys([Uint8Array.of(2)], v3).length, 0)
  put(row(1))
  const v4 = sys.begin()
  const seen = (v: Trx, key: number) => secondary.find([Uint8Array.of(key)], v).map((r) => r[1]?.[0])
  assert.deepEqual([seen(v1, 1), seen(v1, 2)], [[1], []], 'v1: before the key changed')
  assert.deepEqual([seen(v2, 1), seen(v2, 2)], [[], [2]], 'v2: after')
  assert.deepEqual([seen(v3, 1), seen(v3, 2)], [[], []], 'v3: deleted')
  assert.deepEqual([seen(v4, 1), seen(v4, 2)], [[1], []], 'v4: back')
  for (const v of [v1, v2, v3, v4]) v.commit()
})

// --- the model ----------------------------------------------------------------

type Rows = Map<number, FieldBytes[]>
const clone = (m: Rows): Rows => new Map(m)
const rowsOf = (m: Rows) => [...m.keys()].sort((a, b) => a - b).map((id) => (m.get(id) as FieldBytes[]).map(hex).join(','))
const scanned = (c: ClusteredIndex, t?: Trx) => [...c.scan({}, t)].map(([, r]) => r.map(hex).join(','))

test('M4.21: one writer and several readers, interleaved with purge, agree with a model at every step', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.tuple(fc.nat(13), fc.nat(1000)), { minLength: 20, maxLength: 120 }), async (ops) => {
      const { store, clustered, secondary } = await table()
      const sys = store.transactions
      let committed: Rows = new Map()
      let writer: { trx: Trx; pending: Rows; savepoints: { at: number; rows: Rows }[] } | undefined
      const readers: { trx: Trx; snap?: Rows }[] = []
      const newRow = (id: number, n: number): FieldBytes[] => [be(id), n % 5 === 0 ? null : Uint8Array.of(n % 4), n % 7 === 0 ? new Uint8Array(1500 + n).fill(n & 0xff) : n % 2 === 0 ? null : Uint8Array.of(n & 0xff)]
      for (const [op, n] of ops) {
        const id = n % 12
        if (op === 0 && writer === undefined) writer = { trx: sys.begin(), pending: clone(committed), savepoints: [] }
        else if (op <= 3 && writer !== undefined) {
          const { trx, pending } = writer
          const old = pending.get(id)
          if (op === 1 && old === undefined) {
            const row = newRow(id, n)
            secondary.insert(row, clustered.insert(row, trx), trx)
            pending.set(id, row)
          } else if (op === 1) {
            assert.throws(() => clustered.insert(newRow(id, n), trx), (e: EngineError) => e.code === 'ER_DUP_ENTRY')
          } else if (op === 2 && old !== undefined) {
            const row = newRow(id, n)
            if (hex(old[1] as Uint8Array | null) !== hex(row[1] as Uint8Array | null)) {
              secondary.delete(old, be(id), trx)
              secondary.insert(row, be(id), trx)
            }
            clustered.update(row, trx)
            pending.set(id, row)
          } else if (op === 3 && old !== undefined) {
            secondary.delete(old, be(id), trx)
            clustered.delete(be(id), trx)
            pending.delete(id)
          }
        } else if (op === 4 && writer !== undefined) {
          writer.savepoints.push({ at: writer.trx.savepoint(), rows: clone(writer.pending) })
        } else if (op === 5 && writer !== undefined && writer.savepoints.length > 0) {
          const k = n % writer.savepoints.length
          const sp = writer.savepoints[k] as { at: number; rows: Rows }
          writer.trx.rollbackTo(sp.at)
          writer.pending = clone(sp.rows)
          writer.savepoints.length = k + 1
        } else if (op === 6 && writer !== undefined) {
          writer.trx.commit()
          committed = writer.pending
          writer = undefined
        } else if (op === 7 && writer !== undefined) {
          writer.trx.rollback()
          writer = undefined
        } else if (op === 8 && readers.length < 4) {
          readers.push({ trx: sys.begin('REPEATABLE READ') })
        } else if (op === 9 && readers.length > 0) {
          const r = readers[n % readers.length] as { trx: Trx; snap?: Rows }
          r.snap ??= clone(committed)
          assert.deepEqual(scanned(clustered, r.trx), rowsOf(r.snap), 'a reader sees its snapshot')
          const val = n % 4
          const want = [...r.snap.values()].filter((row) => row[1]?.[0] === val && row[1]?.length === 1).map((row) => hex(row[0] as Uint8Array)).sort()
          assert.deepEqual(secondary.primaryKeys([Uint8Array.of(val)], r.trx).map(hex).sort(), want, 'and so does the secondary index')
        } else if (op === 10 && readers.length > 0) {
          ;(readers.splice(n % readers.length, 1)[0] as { trx: Trx }).trx.commit()
        } else if (op === 11) {
          store.purge()
        } else if (op === 12 && writer !== undefined) {
          assert.deepEqual(scanned(clustered, writer.trx), rowsOf(writer.pending), 'the writer sees its own changes')
        } else if (op === 13) {
          assert.deepEqual(scanned(clustered), rowsOf(committed), 'an autocommit read sees what is committed')
        }
        verify(store, clustered)
      }
      writer?.trx.rollback()
      for (const r of readers) r.trx.commit()
      store.purge()
      assert.equal(store.stats().historyLength, 0, 'with no view open, purge empties the history')
      assert.deepEqual(scanned(clustered), rowsOf(committed))
      verify(store, clustered)
    }),
    { numRuns: RUNS },
  )
})
