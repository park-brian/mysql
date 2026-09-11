// The UTF-8 walk both Unicode collations need.
//
// Shared rather than duplicated because the *stopping rule* is the subtle part
// and it must be identical in both: a sort key that invents a character the
// value did not contain is a sort key that orders rows wrongly, and it would
// be very easy for two copies of this to drift on what a malformed byte means.
/**
 * Walk UTF-8, yielding code points, stopping at the first malformed byte.
 *
 * Stopping rather than substituting is what MySQL does — `my_strnxfrm_unicode`
 * jumps straight to its pad loop when `mb_wc` returns `<= 0` — and it means a
 * sort key never invents a character that was not in the value.
 */
export function utf8CodePoints(bytes: Uint8Array): number[] {
  const out: number[] = []
  let at = 0
  while (at < bytes.length) {
    const b = bytes[at] as number
    let n: number
    let cp: number
    if (b < 0x80) {
      n = 1
      cp = b
    } else if (b >= 0xc2 && b <= 0xdf) {
      n = 2
      cp = b & 0x1f
    } else if (b >= 0xe0 && b <= 0xef) {
      n = 3
      cp = b & 0x0f
    } else if (b >= 0xf0 && b <= 0xf4) {
      n = 4
      cp = b & 0x07
    } else break
    if (at + n > bytes.length) break
    let ok = true
    for (let i = 1; i < n; i++) {
      const cont = bytes[at + i] as number
      if ((cont & 0xc0) !== 0x80) {
        ok = false
        break
      }
      cp = (cp << 6) | (cont & 0x3f)
    }
    if (!ok) break
    out.push(cp)
    at += n
  }
  return out
}
