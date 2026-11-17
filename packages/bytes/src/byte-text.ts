/** Map each byte to its code point from U+0000 through U+00FF without an argument limit. */
export function byteText(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}
