// M4.18 — recovery: replay the log from the checkpoint (doc 26 §Our log).
//
// One forward pass. Each whole group's page records are applied through the
// buffer pool, guarded by the page's LSN: a page already at or past a group's
// end LSN has that change and skips it, which is what makes a replay — or a
// replay interrupted by another crash and run again — idempotent.
//
// The guard needs the page, and a page torn on its way to disk has no LSN to
// trust. Such a page is skipped until the log offers its image: a page is only
// ever written while dirty, and the change that made it dirty logged it whole
// (D-46), before the page could be written (the WAL rule). So a torn page that
// is still in use always has an image ahead of it in the log, and one that
// never gets one must be free — which the store checks once the allocator is
// open.
//
// Undo-based rollback is the other half of M4.18 and waits for M4.20: until
// there are transactions longer than a mini-transaction, a group that is not
// whole is all there is to roll back, and it is never applied.
import type { VfsFile } from '@myjs/vfs'
import { EngineError, corruptLog } from './errors.ts'
import { pageLsn } from './page.ts'
import type { BufferPool } from './pool.ts'
import { applyPage, type Meta } from './redo.ts'
import type { Superblock } from './superblock.ts'
import { scanLog } from './wal.ts'

export interface Recovered {
  /** Where the log's last whole group ends: the LSN the store goes on from. */
  readonly end: number
  readonly meta: Meta
  /** Pages torn on disk and never rebuilt. They must be free. */
  readonly unreadable: ReadonlySet<number>
  readonly groups: number
}

export function recover(pool: BufferPool, logFile: VfsFile, s: Superblock): Recovered {
  // A process crash can leave log blocks in the OS's cache. Nothing on disk
  // may come to depend on them until they are durable too.
  logFile.flush()
  let meta: Meta = { pageCount: s.pageCount, nextIndexId: s.nextIndexId }
  let end = s.checkpointLsn
  let groups = 0
  const unreadable = new Set<number>()
  for (const group of scanLog(logFile, { salt: s.salt, blocks: s.logBlocks, block: s.checkpointBlock, lsn: s.checkpointLsn })) {
    let next = meta
    for (const r of group.records) if (r.type === 'meta') next = { pageCount: r.pageCount, nextIndexId: r.nextIndexId }
    for (const r of group.records) {
      if (r.type !== 'page') continue
      if (r.pageNo < 2 || r.pageNo >= next.pageCount) throw corruptLog(`a record for page ${r.pageNo} of a ${next.pageCount}-page file`)
      if (r.image) {
        const lsn = unreadable.has(r.pageNo) ? undefined : lsnOf(pool, r.pageNo)
        if (lsn !== undefined && lsn >= group.end) continue
        const page = pool.create(r.pageNo)
        try {
          applyPage(page, r, r.pageNo)
          pool.markDirty(page, group.end)
        } finally {
          pool.release(page)
        }
        unreadable.delete(r.pageNo)
        continue
      }
      if (unreadable.has(r.pageNo)) continue
      const page = fetch(pool, r.pageNo)
      if (page === undefined) {
        unreadable.add(r.pageNo)
        continue
      }
      try {
        if (pageLsn(page) >= group.end) continue
        applyPage(page, r, r.pageNo)
        pool.markDirty(page, group.end)
      } finally {
        pool.release(page)
      }
    }
    meta = next
    end = group.end
    groups++
  }
  return { end, meta, unreadable, groups }
}

/** A page from storage, or `undefined` if it does not verify. */
function fetch(pool: BufferPool, pageNo: number): Uint8Array | undefined {
  try {
    return pool.fetch(pageNo)
  } catch (e) {
    if (e instanceof EngineError && e.code === 'ENGINE_CORRUPT_PAGE') return undefined
    throw e
  }
}

function lsnOf(pool: BufferPool, pageNo: number): number | undefined {
  const page = fetch(pool, pageNo)
  if (page === undefined) return undefined
  try {
    return pageLsn(page)
  } finally {
    pool.release(page)
  }
}
