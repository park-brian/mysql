/** Two lowercase hexadecimal digits per byte, independent of text decoding. */
export function hex(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += byte.toString(16).padStart(2, '0')
  return text
}
