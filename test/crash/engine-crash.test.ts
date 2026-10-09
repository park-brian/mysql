// M4.25 and M4.19 — the crash suite: doc 43 §5, and the guarantee doc 41
// states, checked rather than asserted.
//
// One deterministic workload, through the catalog and the `Table` interface: a
// table with a clustered and a secondary index, changed together in one
// mini-transaction per row, with values long enough to go off-page; a second
// table created, filled and dropped over and over, so DDL is crashed at every
// write too; a pool small enough that pages are evicted mid-workload, and a log
// small enough to wrap and checkpoint itself. It is run once to count its
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
import { FIELD_TYPE } from '@myjs/bytes'
import { Catalog, Store, pageLsn, type Table, type TableSpec, type Trx, verifyStore, type FieldBytes } from '@myjs/engine'

const POINTS = Number(process.env.CRASH_POINTS ?? 300)
const PAGE = 1024
const STEPS = 200
const OPTIONS = { frames: 32, logBlocks: 32 }

/** Short names: at 1 KiB pages a catalog row has 98 bytes before a name goes off-page. */
const spec = (name: string): TableSpec => ({
  name,
  columns: [
    { name: 'id', type: { type: FIELD_TYPE.LONG, unsigned: true }, nullable: false },
    { name: 'v', type: { type: FIELD_TYPE.VAR_STRING, length: 8, collationId: 63 }, nullable: true },
    { name: 'b', type: { type: FIELD_TYPE.BLOB, collationId: 63 }, nullable: true },
  ],
  indexes: [
    { name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] },
    { name: 'v', kind: 'index', parts: [{ column: 'v' }] },
  ],
})
const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
const hex = (b: Uint8Array | null) => (b === null ? '-' : Buffer.from(b).toString('hex'))

type Policy = 0 | 1 | 2
type Kind = 'process' | 'power'

/** A change to the main table, or a row for the second one while it exists. */
type Op = { insert: FieldBytes[] } | { update: FieldBytes[] } | { remove: number } | { extra: FieldBytes[] }

/**
 * One step: a transaction of several changes, or a DDL statement. Some
 * transactions roll their last change back to a savepoint, and some roll the
 * whole thing back; the plan knows which, so that later steps change only rows
 * that exist.
 */
type Step = { readonly ops: readonly Op[]; readonly undoLast: boolean; readonly abort: boolean } | { readonly ddl: 'create' | 'drop' }

/** The second table: created at step 40k + 10, dropped at 40k + 30. */
const EXTRA = 'x'
const extraExists = (s: number) => s % 40 > 10 && s % 40 <= 30

/** The workload's changes, fixed in advance so every run makes the same ones. */
function plan(): Step[] {
  let x = 0x2545f491
  const rnd = (n: number) => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) % n
  }
  let live: number[] = []
  let next = 0
  const row = (id: number): FieldBytes[] => {
    const val = rnd(5) === 0 ? null : new Uint8Array(1 + rnd(8)).fill(id & 0xff)
    const body = rnd(6) === 0 ? new Uint8Array(500 + rnd(3000)).fill((id * 7 + rnd(9)) & 0xff) : rnd(2) === 0 ? null : new Uint8Array(rnd(60)).fill(id & 0xff)
    return [be(id), val, body]
  }
  const steps: Step[] = []
  let extra = 0
  for (let s = 0; s < STEPS; s++) {
    if (s % 40 === 10 || s % 40 === 30) {
      steps.push({ ddl: s % 40 === 10 ? 'create' : 'drop' })
      continue
    }
    const ops: Op[] = []
    if (extraExists(s)) ops.push({ extra: row(1000 + extra++) })
    const before = [...live]
    for (let k = 1 + rnd(4); k > 0; k--) {
      const r = rnd(6)
      if (live.length > 0 && r === 0) ops.push({ remove: live.splice(rnd(live.length), 1)[0] as number })
      else if (live.length > 0 && r === 1) ops.push({ update: row(live[rnd(live.length)] as number) })
      else {
        live.push(next)
        ops.push({ insert: row(next++) })
      }
    }
    const abort = s % 11 === 5
    const undoLast = !abort && ops.length > 1 && s % 7 === 3
    if (abort) live = before
    else if (undoLast) {
      // The last change does not happen: put `live` back as it was before it.
      live = [...before]
      for (const op of ops.slice(0, -1)) {
        if ('extra' in op) continue
        if ('insert' in op) live.push(Number(new DataView((op.insert[0] as Uint8Array).buffer).getUint32(0)))
        else if ('remove' in op) live.splice(live.indexOf(op.remove), 1)
      }
    }
    steps.push({ ops, undoLast, abort })
  }
  return steps
}

const PLAN = plan()

/** One table as a string — and a check that its secondary index agrees with it. */
function contents(t: Table): string {
  const rows = [...t.scan()].map(([, r]) => r)
  const byIndex = [...t.indexScan('v')].map(([, r]) => r.map(hex).join(','))
  assert.deepEqual([...byIndex].sort(), rows.map((r) => r.map(hex).join(',')).sort(), 'the secondary index holds every row, once')
  return rows.map((r) => r.map(hex).join(',')).join(';')
}

/** The database as a string: its tables, and what is in them. */
function snapshot(c: Catalog): string {
  return c
    .tables()
    .map((d) => `${d.name}=${contents(c.table('s', d.name))}`)
    .join('|')
}

const verify = (store: Store, c: Catalog) => verifyStore(store, c.verifyOptions())

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
    const c = Catalog.open(store)
    c.createSchema('s')
    c.createTable('s', spec('t'))
    const t = c.table('s', 't')
    store.sync()
    acked = synced = 0
    states?.push(snapshot(c))
    let reader: Trx | undefined
    let x: Table | undefined
    for (let s = 0; s < PLAN.length; s++) {
      const step = PLAN[s] as Step
      if ('ddl' in step) {
        if (step.ddl === 'create') {
          c.createTable('s', spec(EXTRA))
          x = c.table('s', EXTRA)
        } else c.dropTable('s', EXTRA)
      } else {
      const w = store.begin()
      let savepoint = 0
      step.ops.forEach((op, i) => {
        if (i === step.ops.length - 1) savepoint = w.savepoint()
        if ('extra' in op) x?.insert(op.extra, w)
        else if ('insert' in op) t.insert(op.insert, w)
        else if ('remove' in op) t.delete(be(op.remove), w)
        else t.update(op.update[0] as Uint8Array, op.update, w)
      })
      if (step.undoLast) w.rollbackTo(savepoint)
      if (step.abort) w.rollback()
      else w.commit()
      }
      acked = s + 1
      if (s % 25 === 24) {
        store.sync()
        synced = s + 1
      }
      if (s % 30 === 29) store.checkpoint()
      // A reader holds a view across a stretch of steps, so purge falls behind,
      // the history a crash leaves is long, and some DROPs wait for it.
      if (s === 40) t.get(be(0), (reader = store.begin()))
      if (s === 140) reader?.commit()
      // Between statements the executor purges a slice at a time (D-77):
      // budgets that end inside a transaction, and inside one step of it.
      if (s % 3 === 2 && store.purgeDue) store.purge(Infinity, 1 + (s % 41))
      states?.push(snapshot(c))
    }
    store.close()
  } catch (e) {
    if ((e as { code?: string }).code !== 'VFS_CRASHED') throw e
  }
  return { vfs, acked, synced }
}

/** Open what a crash left and return its state, or `null` for a database whose creation never finished. */
async function recover(vfs: FaultInjectingVfs): Promise<{ store: Store; c: Catalog; state: string } | null> {
  let store: Store
  try {
    store = Store.open(...(await files(vfs)), OPTIONS)
  } catch (e) {
    if ((e as { code?: string }).code === 'ENGINE_BAD_FORMAT') return null
    throw e
  }
  const c = Catalog.open(store)
  if (!c.tables().some((d) => d.name === 't')) return { store, c, state: 'empty' }
  verify(store, c)
  // The WAL rule, checked directly: no page on disk is ahead of the log that recovered it.
  for (const p of store.alloc.usedPages()) if (p > 1) assert.ok(store.pool.read(p, pageLsn) <= store.lsn, `page ${p} is ahead of the log`)
  return { store, c, state: snapshot(c) }
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

  const tally = { points: 0, lost: 0, recoveryCrashes: 0, unborn: 0, rolledBack: 0 }
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
    if (got !== null) tally.rolledBack += got.store.recovered.rolledBack
    if (got === null || got.state === 'empty') {
      assert.ok(acked <= 0, `${where}: the database is gone`)
      tally.unborn++
      continue
    }
    // A step that rolls back leaves the state as it was, so a state may be
    // the state after several steps: any of them in range will do.
    const floor = policy === 1 || (policy === 2 && kind === 'process') ? acked : synced
    const steps = model.flatMap((st, j) => (st === got.state ? [j] : []))
    assert.ok(steps.length > 0, `${where}: the recovered state is not the state after any step`)
    assert.ok(steps.some((j) => j >= floor && j <= acked + 1), `${where}: recovered the state of steps ${steps.join(',')}, outside ${floor}–${acked + 1}`)
    if (!steps.some((j) => j >= acked)) tally.lost++
    assert.equal(got.store.stats().writer, 0, `${where}: a transaction is left open`)
    // The recovered database goes on working, and closes clean.
    const more = got.store.begin()
    got.c.table('s', 't').insert([be(1e6), null, null], more)
    more.commit()
    got.store.purge()
    got.store.close()
    const reopened = await recover(after)
    assert.ok(reopened !== null && reopened.state !== 'empty')
    verify(reopened.store, reopened.c)
  }
  console.log(`# crash points ${tally.points}: ${tally.lost} lost commits that their setting allowed, ${tally.recoveryCrashes} recoveries crashed and were recovered, ${tally.unborn} before creation finished, ${tally.rolledBack} open transactions rolled back`)
})
