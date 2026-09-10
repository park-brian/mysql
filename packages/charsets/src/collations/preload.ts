// D-36's async edge, in the one module that can be reached without paying for
// weight tables.
//
// This exists as its own file for a reason worth writing down. `resolve.ts`
// can return a weighted `Collation` *synchronously*, so it must statically
// contain the weight tables — all 42 legacy 8-bit ones included, which is 21 KB
// raw. Anything that imports `collationAvailability` to ask "would this need
// loading?" therefore pays for every table in the package, which is exactly
// backwards for a caller whose whole purpose is to avoid loading things.
//
// So the question is asked here instead, against `uca.ts` alone: it is the
// only module with tables behind an `await import()`, so it is the only module
// that can answer "is there anything to load?". `@myjs/core` imports this and
// nothing else from the collation machinery, and its bundle is unchanged as a
// result. (Q-13 is the other half of that observation, and belongs to M6.9:
// the legacy 8-bit tables are 7.9 KB gzipped that almost nobody uses, and the
// boundary built here is the shape of the answer.)
import { isUcaCollation, loadUcaTables, ucaTablesLoaded } from './uca.ts'

/**
 * Load a collation's weight tables if they are not resident, so that a later
 * synchronous `collation(id)` will succeed.
 *
 * Call it on the async edge — a `SET NAMES`, opening a table — because
 * `collation()` and `sortKey()` are synchronous the whole way down into
 * `encodeKeyPart`, and ground rule 3 forbids an `await` inside a page split.
 *
 * A no-op for every collation whose tables are already resident, which today
 * is all of them except the `_0900_` family. Deliberately silent about a
 * collation we do not implement at all: refusing that belongs to the code that
 * tries to *use* it, where the error can name what was being ordered.
 */
export async function preloadCollation(id: number): Promise<void> {
  if (isUcaCollation(id) && !ucaTablesLoaded()) await loadUcaTables()
}
