// The delta-plus-run codec every generated table in this package uses.
//
// Shared rather than duplicated for the same reason `collations/utf8.ts` is:
// three generated files are encoded with it, and a second copy would
// eventually disagree with the generator about what a run means — which would
// not crash, it would silently produce different weights or different
// characters.
//
// It also has to live apart from `collations/weighted.ts`, where it used to.
// That module carries all 42 legacy 8-bit weight tables, so importing it to
// get a decoder would pull 21 KB of weights into anything that merely wanted
// to decode a string — the same mistake D-36 records for `preloadCollation`.

/**
 * Expand one delta-plus-run line.
 *
 * A run is `[count*]delta`, the delta signed hex and relative to the identity
 * value — so an unfolded stretch of Unicode is one run of zeros, a 26-letter
 * case fold is one run of `-20`, and the ASCII half of a charset table is a
 * single `128*0`.
 */
export function expandRuns(spec: string, base: number, length: number): number[] {
  const out: number[] = []
  for (const run of spec.split(',')) {
    const star = run.indexOf('*')
    const count = star === -1 ? 1 : Number(run.slice(0, star))
    const delta = Number.parseInt(star === -1 ? run : run.slice(star + 1), 16)
    for (let i = 0; i < count; i++) out.push(base + out.length + delta)
  }
  if (out.length !== length) throw new Error(`packed table has ${out.length} entries, not ${length}`)
  return out
}
