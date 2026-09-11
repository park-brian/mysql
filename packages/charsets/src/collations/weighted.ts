// M2.6 — the weight-table collations: `latin1_swedish_ci`,
// `utf8mb4_general_ci` and the other 42 simple ones.
//
// Two shapes, because MySQL has two, and the generated tables (M2.5) keep them
// apart:
//
//   An 8-bit collation weighs one byte per byte, through a flat 256-entry
//   table. `latin1_swedish_ci` is the historical MySQL default and the reason
//   `'ä'` sorts *after* `'z'` in so many old schemas.
//
//   `utf8mb3_general_ci` and `utf8mb4_general_ci` weigh one 16-bit weight per
//   character, through `my_unicase_default`'s two-level pages. This is where
//   doc 29's two named quirks live: `'ä' = 'a'` because U+00E4 weighs 0x0041,
//   and `'ß' ≠ 'ss'` because U+00DF weighs a single 0x0053 — a fold, never an
//   expansion. Every simple collation is like that: one weight in, one weight
//   out, which is exactly what makes them small and what makes them wrong for
//   languages that need contractions. That is UCA's job (M2.7).
//
// The sort key is the weight string, big-endian, matching MySQL's
// `my_strnxfrm_unicode` — `store16be` per character. `compare` is then padded
// `memcmp` over sort keys, so
// `sign(compare(a, b)) === sign(memcmp(sortKey(a), sortKey(b)))` holds by
// construction rather than by luck.
import { requireCollationInfo, type Collation, type CollationInfo } from '../collation.ts'
import { comparePadded, memcmp } from './memcmp.ts'
import { utf8CodePoints } from './utf8.ts'
import { expandRuns } from '../runs.ts'
import { PACKED_BYTE_WEIGHTS, PACKED_UNICASE_WEIGHTS, PACKED_WEIGHTED_COLLATIONS } from './weights.ts'

/** Code points above `my_unicase_default`'s `maxchar` all weigh this. */
const REPLACEMENT_WEIGHT = 0xfffd


let byteTables: Map<string, Uint8Array> | null = null
function byteWeightTable(name: string): Uint8Array {
  if (byteTables === null) {
    byteTables = new Map()
    for (const line of PACKED_BYTE_WEIGHTS.split('\n')) {
      const at = line.indexOf(' ')
      byteTables.set(line.slice(0, at), Uint8Array.from(expandRuns(line.slice(at + 1), 0, 256)))
    }
  }
  const table = byteTables.get(name)
  if (table === undefined) throw new Error(`no weight table named ${name}`)
  return table
}

let unicasePages: Map<number, Uint16Array> | null = null
function unicaseWeight(codePoint: number): number {
  if (unicasePages === null) {
    unicasePages = new Map()
    for (const line of PACKED_UNICASE_WEIGHTS.split('\n')) {
      const at = line.indexOf(' ')
      const page = Number.parseInt(line.slice(0, at), 16)
      unicasePages.set(page, Uint16Array.from(expandRuns(line.slice(at + 1), page << 8, 256)))
    }
  }
  if (codePoint > 0xffff) return REPLACEMENT_WEIGHT
  const page = unicasePages.get(codePoint >> 8)
  // An absent page is identity — 245 of the 256 pages, and the whole reason
  // this table is kilobytes rather than a megabyte (Q-04).
  return page === undefined ? codePoint : (page[codePoint & 0xff] as number)
}

/** `id -> weight table name`, `-` meaning the unicase pages. */
let weighted: Map<number, string> | null = null
function weightSource(id: number): string | undefined {
  if (weighted === null) {
    weighted = new Map()
    for (const line of PACKED_WEIGHTED_COLLATIONS.split('\n')) {
      const at = line.indexOf(' ')
      weighted.set(Number(line.slice(0, at)), line.slice(at + 1))
    }
  }
  return weighted.get(id)
}


function byteWeightCollation(info: CollationInfo, table: Uint8Array): Collation {
  const padUnit = Uint8Array.of(table[0x20] as number)
  const sortKey = (bytes: Uint8Array): Uint8Array => {
    const out = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) out[i] = table[bytes[i] as number] as number
    return out
  }
  return {
    ...info,
    padUnit,
    sortKey,
    compare:
      info.padAttribute === 'PAD SPACE'
        ? (a, b) => comparePadded(sortKey(a), sortKey(b), padUnit)
        : (a, b) => memcmp(sortKey(a), sortKey(b)),
  }
}

function unicaseCollation(info: CollationInfo): Collation {
  const spaceWeight = unicaseWeight(0x20)
  const padUnit = Uint8Array.of(spaceWeight >> 8, spaceWeight & 0xff)
  const sortKey = (bytes: Uint8Array): Uint8Array => {
    const points = utf8CodePoints(bytes)
    const out = new Uint8Array(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      const w = unicaseWeight(points[i] as number)
      out[i * 2] = w >> 8
      out[i * 2 + 1] = w & 0xff
    }
    return out
  }
  return {
    ...info,
    padUnit,
    sortKey,
    compare:
      info.padAttribute === 'PAD SPACE'
        ? (a, b) => comparePadded(sortKey(a), sortKey(b), padUnit)
        : (a, b) => memcmp(sortKey(a), sortKey(b)),
  }
}

const cache = new Map<number, Collation>()

/** Whether `weightedCollationFor` would succeed. */
export function isWeightedCollation(id: number): boolean {
  return weightSource(id) !== undefined
}

/** The ids the generated weight tables serve, in id order. */
export function weightedCollationIds(): readonly number[] {
  weightSource(0)
  return [...(weighted as Map<number, string>).keys()]
}

/** The `Collation` for a weight-table id, cached. */
export function weightedCollationFor(id: number): Collation {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const source = weightSource(id)
  if (source === undefined) throw new Error(`collation ${id} has no weight table`)
  const info = requireCollationInfo(id)
  const c = source === '-' ? unicaseCollation(info) : byteWeightCollation(info, byteWeightTable(source))
  cache.set(id, c)
  return c
}
