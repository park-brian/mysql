// M2.2 — the `memcmp` collations: `binary`, plus every `*_bin`.
//
// Doc 29 §Priorities: "`binary` and `utf8mb4_bin` — enough to build and test
// the entire B+tree, because ordering is `memcmp`." That is why these come
// first and why M4 does not wait on the UCA work: the tree only ever needs a
// `sortKey`, and here the sort key is the value.
//
// The one subtlety is `PAD SPACE`. `utf8mb4_bin`, `latin1_bin` and the rest are
// PAD SPACE collations in MySQL 8 (the registry says so — they predate the
// `_0900_` family), so `'a'` and `'a '` compare **equal** under them even
// though their bytes differ. `binary` (63) is NO PAD and does not. Getting this
// backwards makes a unique index accept rows MySQL would reject.
//
// Where the padding lives changed in M2.6 (D-35). It used to be applied only in
// `compare`, with `sortKey` returning the value untouched — which made the two
// disagree: under PAD SPACE `'a' > 'a\x01'`, because the shorter value is
// extended with 0x20 and 0x20 > 0x01, while `memcmp` of the raw values says
// `'a' < 'a\x01'`. A B+tree ordered by the sort key would have placed the rows
// in an order its own comparator rejected. `sortKey` still cannot pad on its
// own — it does not know the column's width — so the key encoder does it, and
// `padUnit` is what it pads with.
import { allCollations, requireCollationInfo, type Collation, type CollationInfo } from '../collation.ts'

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

/** The space, as every single-byte-space charset encodes it. */
export const SPACE_UNIT: Uint8Array = Uint8Array.of(0x20)

/**
 * Compare two sort keys as though the shorter were extended with repetitions of
 * `unit` until the lengths matched — which is what `PAD SPACE` means, and what
 * MySQL's `my_strnncollsp_*` family implements.
 *
 * `unit` is one *character's* worth of pad, not one byte: a weight collation
 * emits two bytes per character, so padding a byte at a time would compare a
 * weight's low half against its high half. Both keys are a whole number of
 * units, so the tail is unit-aligned and the phase is `(i - n) % unit.length`.
 */
export function comparePadded(a: Uint8Array, b: Uint8Array, unit: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  if (a.length === b.length) return 0
  const longer = a.length > b.length ? a : b
  const sign = a.length > b.length ? 1 : -1
  for (let i = n; i < longer.length; i++) {
    const pad = unit[(i - n) % unit.length] as number
    const x = longer[i] as number
    if (x !== pad) return x > pad ? sign : -sign
  }
  return 0
}

/**
 * `memcmp` with PAD SPACE semantics, so `'a' = 'a '` is true.
 *
 * Kept under its own name because doc 29 and the M2.2 tests both talk about it,
 * but it is `comparePadded` with a one-byte space — which is why `mbminlen > 1`
 * collations are refused below rather than compared here with the wrong unit.
 */
export function memcmpPadSpace(a: Uint8Array, b: Uint8Array): number {
  return comparePadded(a, b, SPACE_UNIT)
}

/**
 * A collation whose sort key is the value.
 *
 * The key stays untrimmed even under PAD SPACE: an index stores the value it
 * was given. Two values that compare equal must produce the same *padded* key,
 * which is the key encoder's job (D-35), not this function's.
 */
function binaryCollation(info: CollationInfo): Collation {
  const padded = info.padAttribute === 'PAD SPACE'
  return {
    ...info,
    padUnit: SPACE_UNIT,
    sortKey: (bytes: Uint8Array) => bytes,
    compare: padded ? memcmpPadSpace : memcmp,
  }
}

/**
 * Every collation MySQL marks `MY_CS_BINSORT`, restricted to the charsets whose
 * space is one byte.
 *
 * Widened in M2.6 from a hardcoded five. Ordering under a binary collation is
 * byte order whatever the charset, so there was never a reason to refuse
 * `latin2_bin` while accepting `latin1_bin` — but `ucs2_bin` and the other
 * `mbminlen > 1` collations genuinely differ, because their pad character is
 * two or four bytes and `comparePadded` would need that unit. They keep the
 * typed refusal.
 */
export const MEMCMP_COLLATION_IDS: readonly number[] = allCollations()
  .filter((info) => info.isBinary && info.mbminlen === 1)
  .map((info) => info.id)

const cache = new Map<number, Collation>()

/** Whether `binaryCollationFor` would succeed. */
export function isMemcmpCollation(id: number): boolean {
  return MEMCMP_COLLATION_IDS.includes(id)
}

/** The `Collation` for a `*_bin` id, cached. */
export function binaryCollationFor(id: number): Collation {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const c = binaryCollation(requireCollationInfo(id))
  cache.set(id, c)
  return c
}
