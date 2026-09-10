// M2.7 — `utf8mb4_0900_ai_ci`, the MySQL 8.0 default collation (D-10).
//
// UCA 9.0.0, level 1 only. `_ai_ci` compares primary weights and nothing else,
// so this collation cannot tell 'a' from 'A' or from 'ä' — and, unlike every
// collation implemented before it, it *expands*: 'æ' weighs as 'a' then 'e',
// and 'ß' weighs as two 's'. That last one is the exact inverse of
// `utf8mb4_general_ci`, where doc 29 records that ß folds to a single 's' and
// so can never equal 'ss'.
//
// Two things follow from expansion, and both matter downstream:
//
//   A sort key is not one weight per character, so its length is not a
//   function of the value's length. Doc 29 warns about this under "Index size
//   depends on the collation"; D-35's declared key width is what absorbs it.
//
//   `padAttribute` is **NO PAD**. `'a' = 'a '` is *false* here and true under
//   every `*_ci` collation that came before — doc 29 calls it one of the most
//   common real-world surprises when upgrading MySQL. This is also the first
//   collation to exercise the NO PAD branch of D-35's key encoder, which pads
//   with NUL and appends a length suffix rather than padding with the
//   collation's own pad weight.
//
// The weights themselves are in the generated `uca900.ts`, reached only by
// `await import()` (D-36). Nothing in this module statically imports it, which
// is what keeps 50 KB of DUCET out of anyone's initial bundle.
import { requireCollationInfo, type Collation, type CollationInfo } from '../collation.ts'
import { memcmp } from './memcmp.ts'
import { utf8CodePoints } from './utf8.ts'

/**
 * The ids these tables serve.
 *
 * One, for now. The tables carry level 1 only, so `utf8mb4_0900_as_cs` (278)
 * and the language-specific `*_0900_*` variants cannot be served from them —
 * they need the secondary and tertiary weights this generator deliberately
 * drops, and doc 29 puts them in Layer 3 behind their own modules.
 *
 * Stated as a literal rather than derived from the registry because it must be
 * answerable *without* loading anything: `isUcaCollation` is how a caller
 * learns that `loadCollation` would help.
 */
export const UCA_COLLATION_IDS: readonly number[] = [255]

/** Whether this id is one the UCA tables can serve, once loaded. */
export function isUcaCollation(id: number): boolean {
  return UCA_COLLATION_IDS.includes(id)
}

/**
 * A page of level-1 weights: the first weight of each of 256 code points, plus
 * the extra weights of those that expand.
 */
interface Page {
  readonly first: Uint16Array
  readonly extras: Map<number, Uint16Array>
}

/**
 * Expand one delta-plus-run line.
 *
 * `[count*]delta`, signed hex, each delta against the **previous value** —
 * which is where this differs from `weighted.ts`'s `expandRuns`, whose deltas
 * are against the identity weight. The long stretches in a UCA page are runs
 * of ignorable code points, all weighing zero; previous-value deltas collapse
 * those to a single run, and identity-relative deltas would not.
 */
function expandDeltaRuns(spec: string, length: number): Uint16Array {
  const out = new Uint16Array(length)
  let at = 0
  let previous = 0
  for (const run of spec.split(',')) {
    const star = run.indexOf('*')
    const count = star === -1 ? 1 : Number(run.slice(0, star))
    const delta = Number.parseInt(star === -1 ? run : run.slice(star + 1), 16)
    for (let i = 0; i < count; i++) {
      previous += delta
      if (at >= length) throw new Error(`UCA page has more than ${length} entries`)
      out[at++] = previous
    }
  }
  if (at !== length) throw new Error(`UCA page has ${at} entries, not ${length}`)
  return out
}

function parsePage(spec: string): Page {
  const firstSpace = spec.indexOf(' ')
  const secondSpace = spec.indexOf(' ', firstSpace + 1)
  const runs = secondSpace === -1 ? spec.slice(firstSpace + 1) : spec.slice(firstSpace + 1, secondSpace)
  const first = expandDeltaRuns(runs, 256)
  const extras = new Map<number, Uint16Array>()
  if (secondSpace !== -1) {
    for (const entry of spec.slice(secondSpace + 1).split(';')) {
      const colon = entry.indexOf(':')
      const offset = Number.parseInt(entry.slice(0, colon), 16)
      const weights = entry
        .slice(colon + 1)
        .split(',')
        .map((h) => Number.parseInt(h, 16))
      extras.set(offset, Uint16Array.from(weights))
    }
  }
  return { first, extras }
}

// `page number -> its unparsed line`, and `page number -> the parsed page`.
// The line index is built once when the module loads; a page is expanded when
// something actually asks for a code point in it, so weighing an ASCII string
// does not expand 149 pages.
let lines: Map<number, string> | null = null
const parsed = new Map<number, Page>()

function pageFor(page: number): Page | undefined {
  if (lines === null) throw new Error('UCA tables are not loaded — call loadCollation() first')
  const already = parsed.get(page)
  if (already !== undefined) return already
  const line = lines.get(page)
  if (line === undefined) return undefined
  const expanded = parsePage(line)
  parsed.set(page, expanded)
  return expanded
}

/**
 * Decompose a Hangul syllable into its jamo, exactly as
 * `my_decompose_hangul_syllable` does.
 *
 * This is reachable because the syllable pages are absent from the weight
 * table while the jamo page is present: MySQL stores the parts and composes
 * the whole on demand. Note the upper bound is 0xD7AF and not the last
 * assigned syllable — matching MySQL matters more here than matching Unicode.
 */
function decomposeHangul(syllable: number): number[] | null {
  if (syllable < 0xac00 || syllable > 0xd7af) return null
  const index = syllable - 0xac00
  const combinations = 21 * 28
  const trailing = index % 28
  const jamo = [0x1100 + Math.floor(index / combinations), 0x1161 + Math.floor((index % combinations) / 28)]
  if (trailing !== 0) jamo.push(0x11a7 + trailing)
  return jamo
}

/**
 * The implicit weights of a code point with no entry in the table.
 *
 * Straight from `uca_scanner_900::next_implicit`. Two primary weights: a
 * leading weight that identifies the block, then the code point's own low 15
 * bits with the top bit set. Computing these is why 4,203 of 4,352 page slots
 * can be absent and the CJK ideographs still sort correctly.
 */
function implicitWeights(codePoint: number): number[] {
  let leading: number
  let trailing: number
  if (codePoint >= 0x17000 && codePoint <= 0x18aff) {
    // Tangut, given its own block so the Chinese collation has room to reorder.
    leading = 0xfb00
    trailing = (codePoint - 0x17000) | 0x8000
  } else {
    const plane = codePoint >> 15
    trailing = (codePoint & 0x7fff) | 0x8000
    if (
      (codePoint >= 0x3400 && codePoint <= 0x4db5) ||
      (codePoint >= 0x20000 && codePoint <= 0x2a6d6) ||
      (codePoint >= 0x2a700 && codePoint <= 0x2b734) ||
      (codePoint >= 0x2b740 && codePoint <= 0x2b81d) ||
      (codePoint >= 0x2b820 && codePoint <= 0x2cea1)
    ) {
      leading = plane + 0xfb80
    } else if ((codePoint >= 0x4e00 && codePoint <= 0x9fd5) || (codePoint >= 0xfa0e && codePoint <= 0xfa29)) {
      leading = plane + 0xfb40
    } else {
      leading = plane + 0xfbc0
    }
  }
  return [leading, trailing]
}

/**
 * Every level-1 weight of one code point, in order.
 *
 * The order of the three cases is MySQL's and is load-bearing: the page is
 * consulted *first*, so a Hangul syllable that happens to live in the one
 * present page in that range is read rather than decomposed.
 */
function weightsOf(codePoint: number, into: number[]): void {
  const page = pageFor(codePoint >> 8)
  if (page !== undefined) {
    const offset = codePoint & 0xff
    const first = page.first[offset] as number
    // Zero means ignorable — no level-1 weight at all. Every combining mark is
    // one, and that is exactly what makes this collation accent-insensitive.
    if (first === 0) return
    into.push(first)
    const extra = page.extras.get(offset)
    if (extra !== undefined) for (const w of extra) into.push(w)
    return
  }
  const jamo = decomposeHangul(codePoint)
  if (jamo !== null) {
    for (const j of jamo) weightsOf(j, into)
    return
  }
  for (const w of implicitWeights(codePoint)) into.push(w)
}


function ucaCollation(info: CollationInfo): Collation {
  const sortKey = (bytes: Uint8Array): Uint8Array => {
    const weights: number[] = []
    for (const cp of utf8CodePoints(bytes)) weightsOf(cp, weights)
    const out = new Uint8Array(weights.length * 2)
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number
      out[i * 2] = w >> 8
      out[i * 2 + 1] = w & 0xff
    }
    return out
  }
  const space: number[] = []
  weightsOf(0x20, space)
  return {
    ...info,
    // NO PAD never pads, so this is never used to compare. It is still the
    // honest value rather than an empty array, because `Collation` promises
    // "one character's worth of pad weight" and a lie here would be a trap for
    // whatever reads it next.
    padUnit: Uint8Array.of((space[0] as number) >> 8, (space[0] as number) & 0xff),
    sortKey,
    // NO PAD: a shorter weight string that is a prefix of a longer one sorts
    // first, which is exactly `memcmp`. No padding, and so `'a' < 'a '`.
    compare: (a, b) => memcmp(sortKey(a), sortKey(b)),
  }
}

const cache = new Map<number, Collation>()

/** Whether the weight tables are resident. */
export function ucaTablesLoaded(): boolean {
  return lines !== null
}

/**
 * Load the UCA weight tables (D-36).
 *
 * The one `await import()` in `@myjs/charsets`, and the reason the tables cost
 * nothing until a session actually asks for a `_0900_` collation. It has to be
 * a separate step rather than a lazy `sortKey`, because `sortKey` is
 * synchronous all the way down into `encodeKeyPart` — ground rule 3 says no
 * `await` inside a page split, and an index key is built inside one.
 */
export async function loadUcaTables(): Promise<void> {
  if (lines !== null) return
  const { PACKED_UCA900_LEVEL1 } = await import('./uca900.ts')
  const index = new Map<number, string>()
  for (const line of PACKED_UCA900_LEVEL1.split('\n')) {
    index.set(Number.parseInt(line.slice(0, line.indexOf(' ')), 16), line)
  }
  lines = index
}

/** The `Collation` for a UCA id, cached. Throws unless the tables are loaded. */
export function ucaCollationFor(id: number): Collation {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  if (!isUcaCollation(id)) throw new Error(`collation ${id} is not served by the UCA tables`)
  if (lines === null) throw new Error('UCA tables are not loaded — call loadCollation() first')
  const c = ucaCollation(requireCollationInfo(id))
  cache.set(id, c)
  return c
}
