// M0.6 — NULL bitmap helpers, with the offset parameter.
//
// Doc 11 gives the arithmetic:
//     bytes = floor((n + 7 + offset) / 8)
//     byte  = (i + offset) >> 3
//     bit   = (i + offset) & 7
//
// `offset` is **2** for a binary resultset row (the low two bits are reserved)
// and **0** for `COM_STMT_EXECUTE` parameters — and also 0 for `COM_QUERY`
// query attributes (doc 14). The asymmetry is documented but easy to miss, and
// it is a common interop bug, so both offsets are round-tripped in the tests
// rather than described in a comment.

import { ProtocolError } from './errors.ts'

/** Binary resultset rows reserve the low two bits of the first byte. */
export const RESULTSET_ROW_OFFSET = 2
/** `COM_STMT_EXECUTE` parameters and `COM_QUERY` attributes start at bit 0. */
export const PARAMETER_OFFSET = 0

export function bitmapByteLength(n: number, offset: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new ProtocolError('PROTOCOL_BAD_BITMAP', `bitmap length ${n} must be a non-negative integer`)
  }
  return Math.floor((n + 7 + offset) / 8)
}

export function bitmapGet(bitmap: Uint8Array, i: number, offset: number): boolean {
  const byte = (i + offset) >> 3
  if (byte >= bitmap.length) {
    throw new ProtocolError('PROTOCOL_BAD_BITMAP', `bit ${i} lies outside a ${bitmap.length}-byte bitmap`)
  }
  return ((bitmap[byte] as number) & (1 << ((i + offset) & 7))) !== 0
}

export function bitmapSet(bitmap: Uint8Array, i: number, offset: number): void {
  const byte = (i + offset) >> 3
  if (byte >= bitmap.length) {
    throw new ProtocolError('PROTOCOL_BAD_BITMAP', `bit ${i} lies outside a ${bitmap.length}-byte bitmap`)
  }
  bitmap[byte] = (bitmap[byte] as number) | (1 << ((i + offset) & 7))
}

/** Build a bitmap from a predicate over `n` positions. */
export function bitmapFrom(n: number, offset: number, isSet: (i: number) => boolean): Uint8Array {
  const out = new Uint8Array(bitmapByteLength(n, offset))
  for (let i = 0; i < n; i++) if (isSet(i)) bitmapSet(out, i, offset)
  return out
}
