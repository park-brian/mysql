// M4.25 and M4.19 — the crash suite: doc 43 §5, and the guarantee doc 41
// states, checked rather than asserted.
//
// One deterministic workload: a table with a clustered and a secondary index,
// changed together in one mini-transaction per step, with values long enough
// to go off-page, a pool small enough that pages are evicted mid-workload, and
// a log small enough to wrap and checkpoint itself. It is run once to count its
// writes, and then once per crash point: crashed at that write, the machine
// brought back (`process` keeps what the OS had; `power` keeps a random part of
// what was not flushed, some of it torn), recovered, verified, and compared
// with the model after every step. What may be lost depends on the setting:
//
//   flushLogAtTrxCommit = 1          nothing acknowledged, on any crash
//   flushLogAtTrxCommit = 2          nothing acknowledged on a process crash;
//                                    since the last sync() on power loss
//   flushLogAtTrxCommit = 0          since the last sync(), on any crash
//
// and in no case is the database inconsistent, or anything other than the
// state after some whole step. A sample of crash points also crashes the
// *recovery*, and recovers again. Every recovered store takes one more commit
// and reopens clean.
//
// CRASH_POINTS sets the count: a few hundred in `npm test`, 10,000 in CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { VfsFile } from '@myjs/vfs'
import { FaultInjectingVfs } from '@myjs/vfs/fault'
import { ClusteredIndex, SecondaryIndex, Store, externalRefs, pageLsn, verifyStore, type FieldBytes, type KeyColumn, type RecordLayout } from '@myjs/engine'

const POINTS = Number(process.env.CRASH_POINTS ?? 300)
const PAGE = 1024
const STEPS = 200
const OPTIONS = { frames: 16, logBlocks: 24 }

const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }, { nullable: true }]
const primary: KeyColumn[] = [{ field: 0, part: { kind: 'bytes', nullable: false } }]
const byVal: KeyColumn[] = [{ field: 1, part: { kind: 'bytes', nullable: true, width: 8 } }]
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const hex = (b: Uint8Array | null) => (b === null ? '-' : Buffer.from(b).toString('hex'))

type Policy = 0 | 1 | 2
type Kind = 'process' | 'power'

/** The workload's changes, fixed in advance so every run makes the same ones. */
function plan(): { insert?: FieldBytes[]; remove?: number }[][] {
  let x = 0x2545f491
  const rnd = (n: number) => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) % n
  }
  const live: number[] = []
  let next = 0
  const steps: { insert?: FieldBytes[]; remove?: number }[][] = []
  for (let s = 0; s < STEPS; s++) {
    const ops: { insert?: FieldBytes[]; remove?: number }[] = []
    for (let k = 1 + rnd(4); k > 0; k--) {
      if (live.length > 0 && rnd(3) === 0) {
        ops.push({ remove: live.splice(rnd(live.length), 1)[0] as number })
      } else {
        const id = next++
        live.push(id)
        const val = rnd(5) === 0 ? null : new Uint8Array(1 + rnd(8)).fill(id & 0xff)
        const body = rnd(6) === 0 ? new Uint8Array(500 + rnd(3000)).fill((id * 7) & 0xff) : rnd(2) === 0 ? null : new Uint8Array(rnd(60)).fill(id & 0xff)
        ops.push({ insert: [be(id), val, body] })
      }
    }
    steps.push(ops)
  }
  return steps
}

const PLAN = plan()

interface Table {
  readonly clustered: ClusteredIndex
  readonly secondary: SecondaryIndex
}

function tables(store: Store): Table {
  const [c, s] = [...store.trees()].map((t) => t.indexId)
  const clustered = new ClusteredIndex(store.openTree(c as number), layout, primary)
  return { clustered, secondary: new SecondaryIndex(store.openTree(s as number), clustered, byVal) }
}

/** The table as a string — and a check that the secondary index agrees with it. */
function snapshot(t: Table): string {
  const rows = [...t.clustered.tree.entries()].map(([k]) => t.clustered.get(k) as FieldBytes[])
  const derived = rows.map((r) => hex(r[1] as Uint8Array | null) + '/' + hex(r[0] as Uint8Array)).sort()
  const indexed = [...t.secondary.tree.entries()].length
  assert.equal(indexed, rows.length, 'the secondary index has one entry per row')
  for (const r of rows) assert.ok(t.secondary.primaryKeys([r[1] as FieldBytes]).some((pk) => hex(pk) === hex(r[0] as Uint8Array)), 'every row is in the secondary index')
  return derived.length + ':' + rows.map((r) => r.map(hex).join(',')).join(';')
}

const verify = (store: Store, t: Table) => verifyStore(store, { overflowRefs: (id, v) => (id === t.clustered.tree.indexId ? externalRefs(layout, v) : []) })

const files = async (vfs: FaultInjectingVfs): Promise<[VfsFile, VfsFile]> => [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]

interface Run {
  readonly vfs: FaultInjectingVfs
  /** Steps whose `commit()` returned; −1 if the database was never created. */
  readonly acked: number
  /** Steps whose `sync()` returned. */
  readonly synced: number
}

async function run(policy: Policy, crashAt: number | undefined, seed: number, states?: string[]): Promise<Run> {
  const vfs = new FaultInjectingVfs({ pageSize: PAGE, seed, ...(crashAt === undefined ? {} : { crashAt }) })
  let acked = -1
  let synced = -1
  try {
    const store = Store.create(...(await files(vfs)), { ...OPTIONS, flushLogAtTrxCommit: policy })
    const t = store.atomically(() => {
      const clustered = ClusteredIndex.create(store, layout, primary)
      return { clustered, secondary: SecondaryIndex.create(store, clustered, byVal) }
    })
    store.sync()
    acked = synced = 0
    states?.push(snapshot(t))
    for (let s = 0; s < PLAN.length; s++) {
      store.atomically(() => {
        for (const op of PLAN[s] as { insert?: FieldBytes[]; remove?: number }[]) {
          if (op.insert !== undefined) t.secondary.insert(op.insert, t.clustered.insert(op.insert))
          else {
            const key = be(op.remove as number)
            t.secondary.delete(t.clustered.get(key) as FieldBytes[], key)
            t.clustered.delete(key)
          }
        }
      })
      store.commit()
      acked = s + 1
      if (s % 25 === 24) {
        store.sync()
        synced = s + 1
      }
      if (s % 30 === 29) store.checkpoint()
      states?.push(snapshot(t))
    }
    store.close()
  } catch (e) {
    if ((e as { code?: string }).code !== 'VFS_CRASHED') throw e
  }
  return { vfs, acked, synced }
}

/** Open what a crash left and return its state, or `null` for a database whose creation never finished. */
async function recover(vfs: FaultInjectingVfs): Promise<{ store: Store; t: Table; state: string } | null> {
  let store: Store
  try {
    store = Store.open(...(await files(vfs)), OPTIONS)
  } catch (e) {
    if ((e as { code?: string }).code === 'ENGINE_BAD_FORMAT') return null
    throw e
  }
  if ([...store.trees()].length < 2) return { store, t: undefined as unknown as Table, state: 'empty' }
  const t = tables(store)
  verify(store, t)
  // The WAL rule, checked directly: no page on disk is ahead of the log that recovered it.
  for (const p of store.alloc.usedPages()) if (p > 1) assert.ok(store.pool.read(p, pageLsn) <= store.lsn, `page ${p} is ahead of the log`)
  return { store, t, state: snapshot(t) }
}

test(`M4.25: ${POINTS} crash points — every recovery consistent, no acknowledged commit lost beyond what its setting allows`, async () => {
  const states = new Map<Policy, string[]>()
  const writes = new Map<Policy, number>()
  for (const policy of [1, 2, 0] as const) {
    const s: string[] = []
    const { vfs, acked } = await run(policy, undefined, 1, s)
    assert.equal(acked, STEPS)
    states.set(policy, s)
    writes.set(policy, vfs.operations)
  }
  // The model does not depend on the setting.
  assert.deepEqual(states.get(2), states.get(1))
  assert.deepEqual(states.get(0), states.get(1))
  const model = states.get(1) as string[]
  console.log(`# writes per run: ${[...writes].map(([p, n]) => `policy ${p} ${n}`).join(", ")}`)

  const tally = { points: 0, lost: 0, recoveryCrashes: 0, unborn: 0 }
  for (let i = 0; i < POINTS; i++) {
    const policy = ([1, 2, 0] as const)[i % 3] as Policy
    const kind: Kind = Math.floor(i / 3) % 2 === 0 ? 'power' : 'process'
    const total = writes.get(policy) as number
    const crashAt = 1 + ((i * 7919) % total)
    const { vfs, acked, synced } = await run(policy, crashAt, i + 1)
    let after = vfs.afterCrash({ kind, seed: i + 1 })
    // One point in ten crashes the recovery too, early in it.
    if (i % 10 === 0) {
      const again = after.afterCrash({ kind: 'process', crashAt: 1 + (i % 13) })
      try {
        await recover(again)
      } catch (e) {
        if ((e as { code?: string }).code !== 'VFS_CRASHED') throw e
        tally.recoveryCrashes++
      }
      after = again.afterCrash({ kind, seed: i + 7 })
    }
    const where = `policy ${policy}, ${kind} crash at write ${crashAt} of ${total} (point ${i}): acked ${acked}, synced ${synced}`
    const got = await recover(after)
    tally.points++
    if (got === null || got.state === 'empty') {
      assert.ok(acked <= 0, `${where}: the database is gone`)
      tally.unborn++
      continue
    }
    const j = model.indexOf(got.state)
    assert.ok(j !== -1, `${where}: the recovered state is not the state after any step`)
    const floor = policy === 1 || (policy === 2 && kind === 'process') ? acked : synced
    assert.ok(j >= floor, `${where}: recovered step ${j}, below the ${floor} this setting guarantees`)
    assert.ok(j <= acked + 1, `${where}: recovered step ${j}, beyond anything attempted`)
    if (j < acked) tally.lost++
    // The recovered database goes on working, and closes clean.
    got.store.atomically(() => got.t.secondary.insert([be(1e6), null, null], got.t.clustered.insert([be(1e6), null, null])))
    got.store.commit()
    got.store.close()
    const reopened = await recover(after)
    assert.ok(reopened !== null && reopened.state !== 'empty')
    verify(reopened.store, reopened.t)
  }
  console.log(`# crash points ${tally.points}: ${tally.lost} lost commits that their setting allowed, ${tally.recoveryCrashes} recoveries crashed and were recovered, ${tally.unborn} before creation finished`)
})
