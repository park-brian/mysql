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
