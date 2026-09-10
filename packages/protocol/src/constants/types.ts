// M1.19 / M1.21 — the wire-side type constants.
//
// The `enum_field_types` codes, the column flags and the binary collation id
// moved down to `@myjs/bytes` in D-37; what remains here is the part that is
// only meaningful on the wire.
// D-37: declared in `@myjs/bytes` so `@myjs/types` can name them too, and
// re-exported here because they are part of this package's published surface
// — the same shape `values.ts` and `binary-values.ts` already use for
// `SqlValue` and the temporal structs.
export { FIELD_TYPE, COLUMN_FLAG, CHARSET_BINARY } from '@myjs/bytes'
export type { FieldTypeCode } from '@myjs/bytes'

export const CHARSET_UTF8MB4_0900_AI_CI = 255

/** `utf8mb4_general_ci`, the highest id expressible in HandshakeV10's single byte. */
export const CHARSET_UTF8MB4_GENERAL_CI = 45

/**
 * In a parameter's `int<2>` type word, the low byte is the `enum_field_types`
 * code and bit 15 is the unsigned flag.
 *
 * E-06: doc 15 words this as "the high bit of the high byte (`0x80`)" while
 * docs 14 and 16 say `0x8000`. They describe the same bit; `0x8000` over the
 * whole word is the form that cannot be misread.
 */
export const PARAM_UNSIGNED = 0x8000

export function paramType(typeWord: number): number {
  return typeWord & 0xff
}

export function paramIsUnsigned(typeWord: number): boolean {
  return (typeWord & PARAM_UNSIGNED) !== 0
}
