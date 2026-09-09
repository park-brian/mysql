// Resolving an id to something that can order values.
//
// Three outcomes, in this order: a `*_bin` collation is `memcmp` (M2.2), a
// collation the generated weight tables cover gets those weights (M2.6), and
// anything else raises a typed "not implemented" naming what is missing.
//
// The refusal is the point. A silent fallback to byte order for
// `utf8mb4_0900_ai_ci` would build an index in the wrong order and surface
// years later as wrong query results — so the path that would produce those
// bytes refuses to run. That is also why M2.23's `Intl.Collator` fallback,
// when it lands, may supply `compare` but never `sortKey`.
import { requireCollationInfo, type Collation } from '../collation.ts'
import { unsupportedCollation } from '../errors.ts'
import { binaryCollationFor, isMemcmpCollation } from './memcmp.ts'
import { isWeightedCollation, weightedCollationFor } from './weighted.ts'

/** Resolve a collation to something that can order values. */
export function collation(id: number): Collation {
  if (isMemcmpCollation(id)) return binaryCollationFor(id)
  if (isWeightedCollation(id)) return weightedCollationFor(id)
  const info = requireCollationInfo(id)
  throw unsupportedCollation(
    id,
    info.name,
    info.mbminlen > 1
      ? 'a multibyte-space charset needs its own pad unit, which is not generated yet'
      : 'UCA weight tables for this collation are not generated yet (M2.7, M2.20)',
  )
}

/** Whether `collation(id)` would succeed. */
export function hasCollation(id: number): boolean {
  return isMemcmpCollation(id) || isWeightedCollation(id)
}
