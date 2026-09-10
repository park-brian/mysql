// Resolving an id to something that can order values.
//
// Five outcomes, in this order: a `*_bin` collation is `memcmp` (M2.2), a
// collation the generated weight tables cover gets those weights (M2.6), a
// UCA collation gets the DUCET tables *if they have been loaded* (M2.7), and
// anything else either raises a typed "not implemented" naming what is
// missing, or — if the application has explicitly opted in — gets an
// `Intl.Collator` comparator that refuses to produce a sort key (M2.23).
//
// The refusal is the point. A silent fallback to byte order for
// `utf8mb4_0900_ai_ci` would build an index in the wrong order and surface
// years later as wrong query results — so the path that would produce those
// bytes refuses to run. That is also why M2.23's `Intl.Collator` fallback
// supplies `compare` but never `sortKey`.
//
// D-36 is why there are two entry points rather than one. `collation()` is
// synchronous, because `encodeKeyPart` calls it while building an index key
// and ground rule 3 forbids an `await` in there. The UCA tables are 50 KB
// gzipped and are reached by `await import()`, which cannot happen inside a
// synchronous call — so loading is a separate, explicit step, and a caller
// that skips it gets a typed error saying so rather than a wrong answer.
import { requireCollationInfo, type Collation } from '../collation.ts'
import { collationNotLoaded, unsupportedCollation } from '../errors.ts'
import { binaryCollationFor, isMemcmpCollation } from './memcmp.ts'
import { isWeightedCollation, weightedCollationFor } from './weighted.ts'
import { isUcaCollation, loadUcaTables, ucaCollationFor, ucaTablesLoaded } from './uca.ts'
import { intlCollationFor, isIntlFallbackEnabled } from './intl.ts'

/**
 * What `collation(id)` would do right now.
 *
 * The middle state is the one that matters: without it a caller cannot tell
 * "this will never be orderable" from "you have not loaded it yet", and the
 * two need completely different responses.
 */
export type CollationAvailability = 'resident' | 'loadable' | 'unsupported'

/** Whether a collation is resident, merely loadable, or neither. */
export function collationAvailability(id: number): CollationAvailability {
  if (isMemcmpCollation(id) || isWeightedCollation(id)) return 'resident'
  if (isUcaCollation(id)) return ucaTablesLoaded() ? 'resident' : 'loadable'
  return 'unsupported'
}

/** Resolve a collation to something that can order values. Never awaits. */
export function collation(id: number): Collation {
  if (isMemcmpCollation(id)) return binaryCollationFor(id)
  if (isWeightedCollation(id)) return weightedCollationFor(id)
  if (isUcaCollation(id)) {
    if (ucaTablesLoaded()) return ucaCollationFor(id)
    throw collationNotLoaded(id, requireCollationInfo(id).name)
  }
  // M2.23 / D-23: off by default, because a silent fallback turns "not
  // implemented" into "approximately ordered", which is far harder to notice.
  // Even switched on it supplies `compare` only — `sortKey` throws, so no
  // runtime-dependent bytes can reach an index.
  if (isIntlFallbackEnabled()) return intlCollationFor(id)
  const info = requireCollationInfo(id)
  throw unsupportedCollation(
    id,
    info.name,
    info.mbminlen > 1
      ? 'a multibyte-space charset needs its own pad unit, which is not generated yet'
      : 'UCA weight tables for this collation are not generated yet (doc 29 Layer 3)',
  )
}

/** Whether `collation(id)` would succeed right now, without loading anything. */
export function hasCollation(id: number): boolean {
  return collationAvailability(id) === 'resident'
}

/**
 * Resolve a collation, loading its tables first if they are not resident.
 *
 * The async half of D-36, and the only place `@myjs/charsets` awaits anything.
 * Call it on the async edge — a `SET NAMES`, opening a table — so that every
 * later `collation()` on the hot path can stay synchronous.
 */
export async function loadCollation(id: number): Promise<Collation> {
  if (collationAvailability(id) === 'loadable') await loadUcaTables()
  return collation(id)
}
