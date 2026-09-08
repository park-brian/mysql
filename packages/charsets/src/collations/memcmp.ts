// M2.2 — the `memcmp` collations: `binary`, `utf8mb4_bin`, `latin1_bin`,
// `ascii_bin`.
//
// Doc 29 §Priorities: "`binary` and `utf8mb4_bin` — enough to build and test
// the entire B+tree, because ordering is `memcmp`." That is why these come
// first and why M4 does not wait on the UCA work: the tree only ever needs a
// `sortKey`, and here the sort key is the value.
//
// The one subtlety is `PAD SPACE`. `utf8mb4_bin`, `latin1_bin` and `ascii_bin`
// are all PAD SPACE collations in MySQL 8 (the registry says so — they predate
// the `_0900_` family), so `'a'` and `'a '` compare **equal** under them even
// though their bytes differ. `binary` (63) is NO PAD and does not. Getting
// this backwards makes a unique index accept rows MySQL would reject, so the
// padding is applied in `compare`, and `sortKey` documents why it cannot be.
import { requireCollationInfo, type Collation, type CollationInfo } from '../collation.ts'
import { unsupportedCollation } from '../errors.ts'

/** Unsigned byte comparison — the ordering every `*_bin` collation has. */
export function memcmp(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

/** The 0x20 that PAD SPACE pads with. */
const SPACE = 0x20

/** Length with trailing spaces ignored — what PAD SPACE comparison sees. */
function trimmedLength(bytes: Uint8Array): number {
  let n = bytes.length
  while (n > 0 && bytes[n - 1] === SPACE) n--
  return n
}

/**
 * `memcmp` with PAD SPACE semantics: trailing spaces do not affect the result,
 * so `'a' = 'a '` is true.
 *
 * MySQL implements this as "compare the common prefix, then treat the shorter
 * value as space-extended", which for a byte collation is the same as
 * comparing with trailing spaces stripped — except that a value whose next
 * byte is *below* 0x20 must still sort before one that ran out. Hence the
 * comparison against SPACE rather than an early return.
 */
export function memcmpPadSpace(a: Uint8Array, b: Uint8Array): number {
  const na = trimmedLength(a)
  const nb = trimmedLength(b)
  const n = Math.min(na, nb)
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  if (na === nb) return 0
  // The longer value continues past where the shorter one ended. Under PAD
  // SPACE the shorter one is padded with spaces, so the next byte of the
  // longer one decides against 0x20.
  const longer = na > nb ? a : b
  const next = longer[n] as number
  const sign = na > nb ? 1 : -1
  if (next === SPACE) return 0
  return next > SPACE ? sign : -sign
}

function binaryCollation(info: CollationInfo): Collation {
  const padded = info.padAttribute === 'PAD SPACE'
  return {
    ...info,
    // The sort key *is* the value. Note that it stays untrimmed even under PAD
    // SPACE: an index stores the value it was given, and two keys that compare
    // equal are allowed to have different bytes — that is what makes a unique
    // index on a PAD SPACE collation reject `'a '` when `'a'` is present. The
    // tree compares with `compare`, not by hashing the key.
    sortKey: (bytes: Uint8Array) => bytes,
    compare: padded ? memcmpPadSpace : memcmp,
  }
}

/** The collation ids this module implements. */
export const MEMCMP_COLLATION_IDS: readonly number[] = [
  63, // binary        — NO PAD
  46, // utf8mb4_bin   — PAD SPACE
  47, // latin1_bin    — PAD SPACE
  65, // ascii_bin     — PAD SPACE
  83, // utf8mb3_bin   — PAD SPACE
]

const cache = new Map<number, Collation>()

/**
 * Resolve a collation to something that can order values.
 *
 * Only the `memcmp` family exists so far; anything else raises a typed
 * "not implemented" naming what is missing, rather than silently falling back
 * to byte order and corrupting an index. The weight-table collations arrive in
 * M2.6 and M2.7.
 */
export function collation(id: number): Collation {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const info = requireCollationInfo(id)
  if (!MEMCMP_COLLATION_IDS.includes(id)) {
    throw unsupportedCollation(
      id,
      info.name,
      info.isBinary
        ? 'binary collations beyond the core set are not registered yet'
        : 'weight tables for this collation are not generated yet (M2.6, M2.7)',
    )
  }
  const c = binaryCollation(info)
  cache.set(id, c)
  return c
}

/** Whether `collation(id)` would succeed. */
export function hasCollation(id: number): boolean {
  return MEMCMP_COLLATION_IDS.includes(id)
}
