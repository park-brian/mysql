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

/** DDL permits BINARY as a collation name; expression COLLATE excludes it. */
function readName(c: Cursor): string {
  return c.peek().kind === TOKEN.STRING || c.atWord('BINARY') ? c.take().text : c.expectIdentifier()
}
