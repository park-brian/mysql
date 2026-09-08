// A UTF-8 boundary, isomorphic by construction.
//
// Doc 11 is emphatic that there is no single connection charset: identifiers
// and error messages use `character_set_results`, and a text-resultset value
// uses the *column's* charset. The real charset registry is `@myjs/charsets`
// (M2). Until it exists, everything we emit is utf8mb4 — which is our default
// per D-10 — so this is the whole of the encoding layer, and it is one place
// to change when M2 lands.
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export function utf8(s: string): Uint8Array {
  return encoder.encode(s)
}

export function fromUtf8(b: Uint8Array): string {
  return decoder.decode(b)
}
