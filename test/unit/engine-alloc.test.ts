// M4.12 — the extent allocator: extent-granular growth, freed extents reused,
// segments that keep their pages together, and a view rebuilt from the maps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { Allocator, BufferPool, EXTENT, EngineError, FRAGMENT_LIMIT, Journal, Log, extentsPerMap } from '@myjs/engine'

const PAGE = 1024

/** A journal over `pool` with nothing outside pages to keep: the allocator alone. */
function journalFor(pool: BufferPool, logFile: VfsFile): Journal {
  const journal = new Journal(pool, { meta: () => ({ pageCount: 0, nextIndexId: 0, nextTrxId: 1 }), save: () => undefined, restore: () => {}, beforeMtr: () => {} })
  journal.log = Log.restart(logFile, 1024, 1, 0)
  return journal
}

/**
 * Every allocator change must sit in a mini-transaction (M4.15); here each
 * call is one, so the tests below read as calls on the allocator itself.
 */
function eachAtomic<T extends object>(journal: Journal, target: T): T {
  return new Proxy(target, {
    get(t, k) {
      const v = Reflect.get(t, k) as unknown
      return typeof v === 'function' ? (...args: unknown[]) => journal.atomically(() => (v as (...a: unknown[]) => unknown).apply(t, args)) : v
    },
  })
}

async function setup() {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const file = await vfs.open('data', { create: true })
  const logFile = await vfs.open('log', { create: true })
  const pool = new BufferPool(file, { frames: 16 })
  const journal = journalFor(pool, logFile)
  const reopen = (): Allocator => {
    const fresh = new BufferPool(file, { frames: 16 })
    const j = journalFor(fresh, logFile)
    return eachAtomic(j, Allocator.open(fresh, j, alloc.pageCount))
  }
  const alloc = eachAtomic(journal, journal.atomically(() => Allocator.format(pool, journal)))
  return { file, pool, alloc, reopen }
}

/** Allocate `n` pages for a segment, keeping its fragment count as a tree would. */
function take(alloc: Allocator, segment: number, n: number, counts: Map<number, number>): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const { page, fragment } = alloc.allocate(segment, counts.get(segment) ?? 0)
    if (fragment) counts.set(segment, (counts.get(segment) ?? 0) + 1)
    out.push(page)
  }
  return out
}

test('M4.12: a new file is one extent, with its system pages taken', async () => {
  const { alloc } = await setup()
  assert.equal(alloc.pageCount, EXTENT)
  assert.deepEqual([...alloc.usedPages()], [0, 1, 2])
  assert.throws(() => alloc.free(0), (e: EngineError) => e.code === 'ENGINE_MISUSE')
})

test('M4.12: a segment takes 32 fragment pages, then extents of its own', async () => {
  const { alloc } = await setup()
  const counts = new Map<number, number>()
  const small = take(alloc, 4, 5, counts)
  assert.deepEqual(small, [3, 4, 5, 6, 7], 'a small table lives in the shared extent beside the system pages')
  const big = take(alloc, 7, FRAGMENT_LIMIT + EXTENT, counts)
  assert.equal(counts.get(7), FRAGMENT_LIMIT)
  const own = big.slice(FRAGMENT_LIMIT)
  // After its fragments, every page is in one extent the segment owns outright.
  const extents = new Set(own.map((p) => Math.floor(p / EXTENT)))
  assert.equal(extents.size, 1)
  assert.equal(alloc.ownerOf(own[0] as number), 7)
  assert.deepEqual(own, [...own].sort((a, b) => a - b), 'and in physical order')
})

test('M4.12: growth is extent-granular and freed extents are reused before the file grows', async () => {
  const { alloc } = await setup()
  const counts = new Map([[10, FRAGMENT_LIMIT], [13, FRAGMENT_LIMIT]])
  const pages = take(alloc, 10, EXTENT * 3, counts)
  assert.equal(alloc.pageCount % EXTENT, 0)
  const grown = alloc.pageCount
  // Empty one of segment 10's extents completely: it returns to the free pool.
  const victim = Math.floor((pages[EXTENT] as number) / EXTENT)
  for (const p of pages.filter((p) => Math.floor(p / EXTENT) === victim)) alloc.free(p)
  assert.equal(alloc.ownerOf(victim * EXTENT), 'free')
  const next = take(alloc, 13, 1, counts)[0] as number
  assert.equal(Math.floor(next / EXTENT), victim, 'another segment gets the freed extent')
  assert.equal(alloc.pageCount, grown, 'and the file did not grow')
})

test('M4.12: crossing into a new group places its map page where it can be computed', async () => {
  const { alloc } = await setup()
  const group = extentsPerMap(PAGE) * EXTENT
  const pages = take(alloc, 4, group + 10, new Map([[4, FRAGMENT_LIMIT]]))
  assert.ok(alloc.pageCount > group)
  for (const system of [group, group + 1, group + 2]) {
    assert.ok(alloc.usedPages().has(system), `page ${system} is a system page of group 1`)
    assert.ok(!pages.includes(system))
  }
})

test('M4.12: the in-memory view is rebuilt from the maps on open', async () => {
  const { pool, alloc, reopen } = await setup()
  const counts = new Map<number, number>()
  const pages = take(alloc, 4, 200, counts)
  for (const p of pages.filter((_, i) => i % 3 === 0)) {
    if (alloc.free(p).fragment) counts.set(4, (counts.get(4) ?? 0) - 1)
  }
  pool.flush()
  const reopened = reopen()
  assert.deepEqual([...reopened.usedPages()].sort((a, b) => a - b), [...alloc.usedPages()].sort((a, b) => a - b))
  // …and allocates the same next page the original would have.
  assert.equal(reopened.allocate(4, counts.get(4) ?? 0).page, alloc.allocate(4, counts.get(4) ?? 0).page)
  assert.throws(() => alloc.free(pages[198] as number), (e: EngineError) => e.code === 'ENGINE_MISUSE', 'a double free is refused')
})

test('review: a map that frees a group\'s system pages is refused on open, not trusted', async () => {
  const { pool, reopen } = await setup()
  const page = pool.fetch(2)
  new DataView(page.buffer, page.byteOffset).setUint32(24 + 8, 0)
  pool.markDirty(page, 0)
  pool.release(page)
  pool.flush()
  assert.throws(reopen, (e: EngineError) => e.code === 'ENGINE_CORRUPT_PAGE')
})
