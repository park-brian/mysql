// Ground rule 5: a typed error, always.
import { MyjsError } from '@myjs/bytes'

/** An unknown collation id, or one we have no implementation for. */
export class CharsetError extends MyjsError {}

export function unknownCollation(id: number): CharsetError {
  return new CharsetError('ER_UNKNOWN_COLLATION', `unknown collation id ${id}`, {
    errno: 1273,
    sqlState: 'HY000',
  })
}

export function unsupportedCollation(id: number, name: string, why: string): CharsetError {
  return new CharsetError('ER_COLLATION_NOT_IMPLEMENTED', `collation ${name} (${id}) is not implemented: ${why}`, {
    errno: 1273,
    sqlState: 'HY000',
  })
}

export function unsupportedCharset(name: string): CharsetError {
  return new CharsetError('ER_UNKNOWN_CHARACTER_SET', `character set '${name}' has no decoder available here`, {
    errno: 1115,
    sqlState: '42000',
  })
}

/**
 * A collation whose tables exist but are not resident (D-36).
 *
 * Distinct from `unsupportedCollation` on purpose: that one means "we will
 * never order this", and this one means "call `loadCollation` first". Carrying
 * no errno, because it is a caller mistake rather than anything a SQL client
 * did — the tables load on the async edge, and something reached a synchronous
 * `sortKey` before that happened.
 */
export function collationNotLoaded(id: number, name: string): CharsetError {
  return new CharsetError(
    'ER_COLLATION_NOT_LOADED',
    `collation ${name} (${id}) has weight tables that are not loaded: await loadCollation(${id}) first`,
  )
}
