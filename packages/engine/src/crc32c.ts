// M4.1 — CRC32C (Castagnoli), table-driven.
//
// Erratum E-01: doc 26 once suggested `crypto.subtle.digest` "where a hardware
// path exists", but WebCrypto has no CRC of any kind, so there is no faster
// path to fall back from. Slicing-by-8 would be quicker; a byte-at-a-time table
// is the simplest correct thing, and a page is checksummed once per write.
//
// Polynomial 0x1EDC6F41, reflected as 0x82F63B78 — RFC 3720 §B.4, the iSCSI
// CRC. `crc32c.test.ts` holds that appendix's vectors.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** The CRC32C of `bytes[start, end)`, as an unsigned 32-bit number. */
export function crc32c(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = (TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
