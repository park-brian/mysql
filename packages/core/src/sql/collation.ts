import { collationInfoByName, defaultCollationOf } from '@myjs/charsets'
import { messages, sqlError } from '@myjs/protocol'

/** Resolve SQL charset and collation names for expressions, columns and schema options. */
export function resolveCollation(charset: string | undefined, collate: string | undefined, fallback: number): number {
  const def = charset === undefined ? undefined : defaultCollationOf(charset)
  if (collate !== undefined) {
    const info = collationInfoByName(collate)
    if (info === undefined) throw sqlError('ER_UNKNOWN_COLLATION', messages.unknownCollation(collate))
    if (charset !== undefined && info.charset !== def?.charset) {
      throw sqlError('ER_COLLATION_CHARSET_MISMATCH', `COLLATION '${collate.split('\0', 1)[0]}' is not valid for CHARACTER SET '${def?.charset ?? charset}'`)
    }
    return info.id
  }
  if (charset !== undefined && def === undefined) throw sqlError('ER_UNKNOWN_CHARACTER_SET', `Unknown character set: '${charset}'`)
  return def?.id ?? fallback
}
