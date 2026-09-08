// D-33 — the two charset questions `@myjs/protocol` must answer alone.
//
// The release plan ships `@myjs/protocol` at 0.1 and `@myjs/charsets` at 0.2,
// so this package cannot depend on that one. It does not need to: both
// questions below need nothing but a collation's byte widths, and those are
// generated into `charset-metrics.ts` by the same parse that builds the full
// registry. There is no hand-maintained second copy — which matters, because
// the hand-written list this replaces had id 159 missing.
//
// Anything that needs a collation's *name*, its pad attribute or its weights
// belongs above this package, in `@myjs/charsets`.
import { PACKED_CHARSET_METRICS } from './charset-metrics.ts'

interface Widths {
  readonly mbminlen: number
  readonly mbmaxlen: number
}

let widths: Map<number, Widths> | null = null

/** `mbminlen mbmaxlen id,id-id,…` per line — expanded on first lookup. */
function expand(): Map<number, Widths> {
  if (widths !== null) return widths
  const table = new Map<number, Widths>()
  for (const line of PACKED_CHARSET_METRICS.split('\n')) {
    const [min, max, ids] = line.split(' ')
    const entry: Widths = { mbminlen: Number(min), mbmaxlen: Number(max) }
    for (const range of (ids as string).split(',')) {
      const dash = range.indexOf('-')
      if (dash === -1) {
        table.set(Number(range), entry)
      } else {
        const lo = Number(range.slice(0, dash))
        const hi = Number(range.slice(dash + 1))
        for (let id = lo; id <= hi; id++) table.set(id, entry)
      }
    }
  }
  widths = table
  return table
}

/** Bytes per character for a collation id, or `undefined` if MySQL has no such id. */
export function charsetWidths(collationId: number): Widths | undefined {
  return expand().get(collationId)
}

/** utf8mb4 is 4, so `VARCHAR(255)` reports 1020 (doc 15). Unknown ids assume 1. */
export function mbMaxLenOf(collationId: number): number {
  return expand().get(collationId)?.mbmaxlen ?? 1
}

/** How many collation ids the generated table covers — asserted by a test. */
export function charsetWidthTableSize(): number {
  return expand().size
}
