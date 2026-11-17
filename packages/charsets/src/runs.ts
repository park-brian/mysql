// The run codec shared by the generated weight and encoding tables.
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

import { corruptTable } from './errors.ts'

/**
 * Expand one delta-plus-run line.
 *
 * A run is `[count*]delta`, the delta signed hex and relative to the identity
 * value — so an unfolded stretch of Unicode is one run of zeros, a 26-letter
 * case fold is one run of `-20`, and `128*0` encodes an identity ASCII half.
 * Charset encoding tables can also use `[count]=` for absolute zeroes.
 */
export function expandRuns(spec: string, base: number, length: number): number[] {
  const out: number[] = []
  for (const run of spec.split(',')) {
    const zero = run.endsWith('=')
    const end = zero ? run.length - 1 : run.indexOf('*')
    const count = end <= 0 ? 1 : Number(run.slice(0, end))
    const delta = zero ? 0 : Number.parseInt(run.slice(end + 1), 16)
    for (let i = 0; i < count; i++) out.push(zero ? 0 : base + out.length + delta)
  }
  if (out.length !== length) throw corruptTable(`packed table has ${out.length} entries, not ${length}`)
  return out
}
