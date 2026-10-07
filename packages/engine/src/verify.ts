// The instrument: an independent walk that checks a store is well-formed.
//
// It reads pages through the same codecs and nothing else — not the tree's
// search, not its split logic — so a bug in the tree cannot hide in the check.
// It holds every structural claim the engine makes:
//
//   - every page is the type and level it should be and belongs to its index.
//     Its checksum is the pool's to check, on the read from storage; a page
//     already resident was checked then and is not re-checked here;
//   - keys are strictly ascending within a page, and every key lies within the
//     bounds its ancestors' separators set: at least the separator to its left,
//     below the separator to its right. Bounds, not equality, because deleting
//     a page's first key leaves the separator above it stale and still valid;
//   - every internal page starts with the empty key, and every leaf is at the
//     same depth;
//   - the leaves form one chain, linked both ways, in key order;
//   - a leaf never holds a schema version ahead of its tree, and nothing but a
//     leaf holds one at all;
//   - every page is reached exactly once — and **the pages the allocation maps
//     call used are exactly the pages reached**, overflow chains and system
//     pages included. A leaked page and a page in use but marked free are both
//     a difference between those two sets (M4.9);
//   - each tree's fragment counts match the pages it holds in shared extents,
//     and every page in an owned extent belongs to the segment owning it.
//
// `verify.test.ts` plants a defect for each of these and checks it is caught.
import { EngineError } from './errors.ts'
import { SEGMENT, segmentId } from './btree.ts'
import * as ip from './index-page.ts'
import { chainPages, decodeRef } from './overflow.ts'
import { extentsPerMap, EXTENT } from './alloc.ts'
import type { Store } from './store.ts'

export interface VerifyOptions {
  /** The off-page references in a leaf value of index `indexId`, for indexes that have any. */
  readonly overflowRefs?: (indexId: number, value: Uint8Array) => readonly Uint8Array[]
  /** The schema version each index is at; 0 when not given. */
  readonly schemaVersion?: (indexId: number) => number
}

const fail = (what: string): never => {
  throw new EngineError('ENGINE_VERIFY', what)
}

export function verifyStore(store: Store, options: VerifyOptions = {}): void {
  const pool = store.pool
  // Pages 0–2 of every group are the system's: the superblocks and the first
  // map in group 0, a map and two reserved pages in each group after.
  const reached = new Set<number>()
  const groupPages = extentsPerMap(pool.pageSize) * EXTENT
  for (let start = 0; start < store.alloc.pageCount; start += groupPages) for (let p = start; p < start + 3; p++) reached.add(p)

  const trees = [{ indexId: 0, root: store.directory.root }, ...store.trees()]
  for (const { indexId, root } of trees) verifyTree(store, indexId, root, reached, options)

  const used = store.alloc.usedPages()
  const leaked = [...used].filter((p) => !reached.has(p))
  const unallocated = [...reached].filter((p) => !used.has(p))
  if (leaked.length > 0) fail(`pages allocated but unreachable: ${leaked.slice(0, 10).join(', ')}`)
  if (unallocated.length > 0) fail(`pages reachable but free in the maps: ${unallocated.slice(0, 10).join(', ')}`)
  if (pool.pinned() !== 0) fail(`${pool.pinned()} buffer pool frame(s) still pinned`)
}

function verifyTree(store: Store, indexId: number, root: number, reached: Set<number>, options: VerifyOptions): void {
  const pool = store.pool
  const version = options.schemaVersion?.(indexId) ?? 0
  const leaves: number[] = []
  const shared = [0, 0, 0]
  const claim = (pageNo: number, segment: number): void => {
    if (reached.has(pageNo)) fail(`page ${pageNo} is reached twice`)
    reached.add(pageNo)
    const owner = store.alloc.ownerOf(pageNo)
    if (owner === 'shared') shared[segment] = (shared[segment] as number) + 1
    else if (owner !== segmentId(indexId, segment)) fail(`page ${pageNo} of index ${indexId} is in an extent owned by ${owner}`)
  }

  const walk = (pageNo: number, expectLevel: number | undefined, lo: Uint8Array | undefined, hi: Uint8Array | undefined): void => {
    const children: [number, Uint8Array | undefined, Uint8Array | undefined][] = []
    const level = pool.read(pageNo, (page) => {
      ip.validateIndexPage(page, pageNo)
      const level = ip.level(page)
      if (ip.indexIdOf(page) !== indexId) fail(`page ${pageNo} belongs to index ${ip.indexIdOf(page)}, reached from ${indexId}`)
      if (expectLevel !== undefined && level !== expectLevel) fail(`page ${pageNo} is at level ${level}, expected ${expectLevel}`)
      // The root is a leaf-segment page for life; every other page by level.
      claim(pageNo, pageNo === root || level === 0 ? SEGMENT.LEAF : SEGMENT.INTERNAL)
      const n = ip.cellCount(page)
      for (let i = 0; i < n; i++) {
        const { key, value } = ip.cell(page, i)
        // The empty first key of an internal page stands for the lower bound.
        const effective = level > 0 && i === 0 ? undefined : key
        if (effective !== undefined && lo !== undefined && ip.compareBytes(effective, lo) < 0) fail(`page ${pageNo}: a key below its separator`)
        if (effective !== undefined && hi !== undefined && ip.compareBytes(effective, hi) >= 0) fail(`page ${pageNo}: a key at or above the next separator`)
        if (level > 0) {
          const next = i + 1 < n ? ip.keyAt(page, i + 1).slice() : hi
          children.push([ip.childAt(page, i), i === 0 ? lo : key.slice(), next])
        } else if (options.overflowRefs !== undefined) {
          for (const ref of options.overflowRefs(indexId, value)) for (const p of chainPages(pool, decodeRef(ref))) claim(p, SEGMENT.OVERFLOW)
        }
      }
      const v = ip.schemaVersion(page)
      if (level > 0 && v !== 0) fail(`internal page ${pageNo} carries schema version ${v}`)
      if (level === 0 && v > version) fail(`leaf ${pageNo} is at schema version ${v}, ahead of its index's ${version}`)
      if (level === 0) leaves.push(pageNo)
      return level
    })
    for (const [child, childLo, childHi] of children) walk(child, level - 1, childLo, childHi)
  }

  walk(root, undefined, undefined, undefined)

  for (let i = 0; i < leaves.length; i++) {
    pool.read(leaves[i] as number, (page) => {
      if (ip.leftSibling(page) !== (leaves[i - 1] ?? 0)) fail(`leaf ${leaves[i]}'s left link is ${ip.leftSibling(page)}, not ${leaves[i - 1] ?? 0}`)
      if (ip.rightSibling(page) !== (leaves[i + 1] ?? 0)) fail(`leaf ${leaves[i]}'s right link is ${ip.rightSibling(page)}, not ${leaves[i + 1] ?? 0}`)
    })
  }

  pool.read(root, (page) => {
    for (let s = 0; s < 3; s++) {
      if (ip.fragments(page, s) !== shared[s]) fail(`index ${indexId} counts ${ip.fragments(page, s)} fragment pages in segment ${s}, holds ${shared[s]}`)
    }
  })
}
