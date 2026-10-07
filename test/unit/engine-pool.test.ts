// M4.3 — the buffer pool: young/old LRU, dirty pages in first-dirtied order,
// pins that cannot be evicted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { BufferPool, EngineError, PAGE_TYPE, initPage, sealPage } from '@myjs/engine'

const PAGE = 1024

/** A file of `n` valid pages, so `fetch` can read any of them. */
async function fileOf(n: number): Promise<VfsFile> {
  const file = await new MemoryVfs({ pageSize: PAGE }).open('data', { create: true })
  const page = new Uint8Array(PAGE)
  for (let i = 0; i < n; i++) {
    initPage(page, i, PAGE_TYPE.INDEX)
    sealPage(page)
    file.writePage(i, page)
  }
  return file
}

const touch = (pool: BufferPool, pageNo: number) => pool.release(pool.fetch(pageNo))

test('M4.3: scanning 10× the pool does not evict the working set', async () => {
  const frames = 64
  const file = await fileOf(1000)
  const pool = new BufferPool(file, { frames, promoteAfter: 8 })
  const working = [1, 2, 3, 4, 5, 6, 7, 8]
  // A working set becomes young the way one does in use: touched, then touched
  // again later, after other work.
  for (const p of working) touch(pool, p)
  for (let p = 900; p < 920; p++) touch(pool, p)
  for (const p of working) touch(pool, p)
  for (const p of working) assert.equal(pool.residency(p), 'young', `page ${p}`)

  // A scan of 640 pages, each touched three times in a row, as a cursor visits
  // a leaf one record at a time.
  for (let p = 100; p < 100 + frames * 10; p++) for (let k = 0; k < 3; k++) touch(pool, p)

  const hits = pool.stats.hits
  for (const p of working) touch(pool, p)
  assert.equal(pool.stats.hits - hits, working.length, 'every working-set page is still resident')
  assert.equal(pool.pinned(), 0)
})

test('M4.3: a pool that promoted on any second access would have lost the working set — the test above can fail', async () => {
  // The same workload with promotion on every re-access: the scan's repeated
  // touches promote each scanned page, and they push the working set out.
  const frames = 64
  const pool = new BufferPool(await fileOf(1000), { frames, promoteAfter: 0 })
  const working = [1, 2, 3, 4, 5, 6, 7, 8]
  for (const p of working) touch(pool, p)
  for (const p of working) touch(pool, p)
  for (let p = 100; p < 100 + frames * 10; p++) for (let k = 0; k < 3; k++) touch(pool, p)
  const hits = pool.stats.hits
  for (const p of working) touch(pool, p)
  assert.ok(pool.stats.hits - hits < working.length, 'the instrument detects a scan that promotes')
})

test('M4.3: dirty pages flush in first-dirtied order, and re-dirtying does not move one', async () => {
  const file = await fileOf(10)
  const pool = new BufferPool(file, { frames: 8 })
  let lsn = 0
  const dirty = (p: number) => {
    const page = pool.fetch(p)
    pool.markDirty(page, ++lsn)
    pool.release(page)
  }
  dirty(3)
  dirty(1)
  dirty(2)
  dirty(3) // a later change to the oldest dirty page
  assert.deepEqual(pool.dirtyPages(), [3, 1, 2])
  const written: number[] = []
  const recording = new BufferPool(file, { frames: 8, beforeWrite: (l) => written.push(l) })
  for (const p of [5, 4]) {
    const page = recording.fetch(p)
    recording.markDirty(page, p * 10)
    recording.release(page)
  }
  recording.flush()
  assert.deepEqual(written, [50, 40], 'beforeWrite sees each page LSN, in flush order')
  assert.deepEqual(recording.dirtyPages(), [])
  pool.flush()
  // What was written verifies: the pool seals on the way out.
  touch(new BufferPool(file, { frames: 4 }), 3)
})

test('M4.3: a pinned page is never evicted; a pool with every frame pinned refuses', async () => {
  const pool = new BufferPool(await fileOf(10), { frames: 4 })
  const held = [0, 1, 2, 3].map((p) => pool.fetch(p))
  assert.throws(() => pool.fetch(4), (e: EngineError) => e.code === 'ENGINE_POOL_EXHAUSTED')
  pool.release(held[0] as Uint8Array)
  touch(pool, 4)
  assert.equal(pool.residency(0), undefined, 'the one unpinned page was the one evicted')
  for (const p of held.slice(1)) pool.release(p)
  assert.throws(() => pool.release(held[1] as Uint8Array), (e: EngineError) => e.code === 'ENGINE_MISUSE')
})

test('M4.3: a dirty page is written before its frame is reused, and reads back', async () => {
  const file = await fileOf(10)
  const pool = new BufferPool(file, { frames: 4 })
  const page = pool.fetch(0)
  page[100] = 7
  pool.markDirty(page, 1)
  pool.release(page)
  for (let p = 1; p < 10; p++) touch(pool, p)
  const again = pool.fetch(0)
  assert.equal(again[100], 7)
  pool.release(again)
})
