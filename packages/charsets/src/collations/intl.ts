// M2.23 / D-23 — the `Intl.Collator` fallback.
//
// It supplies `compare`. It never supplies `sortKey`, and that asymmetry is
// the entire design.
//
// Doc 29 gives three reasons `Intl.Collator` cannot be the *primary*
// implementation: ICU's tailorings are not MySQL's, it offers no sort key at
// all, and `localeCompare` semantics move with the engine version. The first
// two are inconvenient. The third is fatal for anything stored: a sort key is
// what goes into an index, so an index built through ICU would be ordered by
// whichever ICU the browser shipped that week, and a database written by one
// browser would be unreadable — silently, as wrong rows rather than as an
// error — by another.
//
// So `sortKey` throws. The path that would turn a runtime-dependent
// comparison into permanent bytes on disk refuses to run, which is M2.23's
// acceptance assertion stated as code rather than as a warning in a doc.
//
// And the fallback is off by default. A silent fallback is the failure mode
// `resolve.ts` exists to prevent: it turns "this collation is not implemented"
// into "your rows are in approximately the right order", which is much harder
// to notice and much worse to discover later.
import { requireCollationInfo, type Collation, type CollationInfo } from '../collation.ts'
import { CharsetError } from '../errors.ts'
import { canDecode, decodeCharset } from '../encoding.ts'

let enabled = false
const warned = new Set<number>()

/** Whether `collation()` may fall back to `Intl.Collator`. Off by default. */
export function isIntlFallbackEnabled(): boolean {
  return enabled
}

/**
 * Allow `collation()` to fall back to `Intl.Collator` for collations we have
 * no tables for.
 *
 * Opt-in, and worth opting into only with the consequence in mind: ordering
 * becomes correct-ish and runtime-dependent, and anything that needs a sort
 * key still fails. Turning it on is a statement that approximate `ORDER BY` is
 * better than an error *for this application*, which is a judgement the
 * application gets to make and the library does not.
 */
export function setIntlFallbackEnabled(on: boolean): void {
  enabled = on
}

/** A sort key was asked of a collation that only has a comparator. */
export function noSortKey(id: number, name: string): CharsetError {
  return new CharsetError(
    'ER_COLLATION_NO_SORT_KEY',
    `collation ${name} (${id}) is served by Intl.Collator, which has no sort key: ` +
      'index order would depend on the runtime ICU version, so it is refused rather than stored',
  )
}

/**
 * The locale to hand ICU, read out of the collation name.
 *
 * MySQL's language-specific collations are named `<charset>_<lang>_0900_...`
 * — `utf8mb4_tr_0900_ai_ci` is Turkish, where 'i' and 'I' are famously not a
 * case pair. Anything without a language segment gets the root locale, which
 * is the closest ICU has to DUCET.
 */
function localeOf(name: string): string {
  const m = /^[a-z0-9]+_([a-z]{2})_/.exec(name)
  // `und` is BCP 47's "undetermined", which ICU maps to root collation — a
  // fixed choice, rather than inheriting whatever locale the host defaults to.
  return m === null ? 'und' : (m[1] as string)
}

/**
 * ICU's nearest equivalent of MySQL's `_ai`/`_as` and `_ci`/`_cs` suffixes.
 *
 * "Nearest" is doing real work here — these are not the same taxonomy, which
 * is doc 29's first objection to `Intl.Collator` and the reason this is a
 * fallback rather than an implementation.
 */
function sensitivityOf(name: string): 'base' | 'accent' | 'case' | 'variant' {
  if (name.endsWith('_ai_ci')) return 'base'
  if (name.endsWith('_as_ci')) return 'accent'
  if (name.endsWith('_ai_cs')) return 'case'
  if (name.endsWith('_as_cs')) return 'variant'
  if (name.endsWith('_ci')) return 'base'
  return 'variant'
}

function intlCollation(info: CollationInfo): Collation {
  const collator = new Intl.Collator(localeOf(info.name), {
    sensitivity: sensitivityOf(info.name),
    numeric: false,
    caseFirst: 'false',
  })
  const padding = info.padAttribute === 'PAD SPACE'
  return {
    ...info,
    // A space in the collation's own charset, for the shape of the interface.
    // Nothing here can use it: padding happens on decoded text below, because
    // that is the level ICU compares at.
    padUnit: Uint8Array.of(0x20),
    sortKey(): Uint8Array {
      throw noSortKey(info.id, info.name)
    },
    compare(a: Uint8Array, b: Uint8Array): number {
      let x = decodeCharset(a, info.charset)
      let y = decodeCharset(b, info.charset)
      if (padding) {
        // PAD SPACE compares as though both values were extended to a common
        // length with spaces. Trimming trailing spaces is *not* the same rule
        // — that is exactly the inversion D-35 was written about — so both
        // sides are padded rather than trimmed.
        const width = Math.max(x.length, y.length)
        x = x.padEnd(width, ' ')
        y = y.padEnd(width, ' ')
      }
      const r = collator.compare(x, y)
      return r < 0 ? -1 : r > 0 ? 1 : 0
    },
  }
}

const cache = new Map<number, Collation>()

/**
 * A comparator-only `Collation` backed by `Intl.Collator`.
 *
 * Warns once per collation, per D-23's "with a loud warning". Once, because a
 * warning on every comparison is a warning nobody reads.
 */
export function intlCollationFor(id: number): Collation {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const info = requireCollationInfo(id)
  if (!canDecode(info.charset)) {
    throw new CharsetError(
      'ER_UNKNOWN_CHARACTER_SET',
      `collation ${info.name} (${id}) cannot use the Intl fallback: ` +
        `character set '${info.charset}' has no decoder available here`,
    )
  }
  if (!warned.has(id)) {
    warned.add(id)
    console.warn(
      `[myjs] collation ${info.name} (${id}) has no generated weight tables and is being ordered by ` +
        'Intl.Collator. Results approximate MySQL rather than matching it, and vary with the runtime ' +
        'ICU version. Indexes on this collation are refused, not approximated.',
    )
  }
  const c = intlCollation(info)
  cache.set(id, c)
  return c
}
