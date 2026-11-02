import { collationInfoByName, defaultCollationOf } from '@myjs/charsets'
import { unknownCharset, unknownCollation } from './errors.ts'
import { TOKEN } from './tokens.ts'
import type { Cursor } from './cursor.ts'

/** A COLLATE name resolves during parsing, before later expression admission. */
export function collationName(c: Cursor, recoverable = false): string {
  const name = readName(c)
  if (collationInfoByName(name) === undefined) {
    const error = unknownCollation(name)
    if (!recoverable) throw error
    c.report(error)
  }
  return name
}

/** BINARY is also a charset keyword; unknown names are refused at their use. */
export function charsetName(c: Cursor): string {
  const name = readName(c)
  if (defaultCollationOf(name) === undefined) throw unknownCharset(name)
  return name
}

/** Written charset warnings retain failure prefixes and optionally isolated construction history. */
export function warnCharset(c: Cursor, name: string | undefined, construction = false): void {
  if (name === 'utf8') c.warn(3719, "'utf8' is currently an alias for the character set UTF8MB3, but will be an alias for UTF8MB4 in a future release. Please consider using UTF8MB4 in order to be unambiguous.", construction ? 'construction' : true)
  else if (name === 'utf8mb3') c.warn(1287, "'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead", construction ? 'construction' : true)
}

/** DDL permits BINARY as a collation name; expression COLLATE excludes it. */
function readName(c: Cursor): string {
  return c.peek().kind === TOKEN.STRING || c.atWord('BINARY') ? c.take().text : c.expectIdentifier()
}
