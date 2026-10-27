import { collationInfoByName, defaultCollationOf } from '@myjs/charsets'
import { unknownCharset, unknownCollation } from './errors.ts'
import { TOKEN } from './tokens.ts'
import type { Cursor } from './cursor.ts'

/** A COLLATE name resolves during parsing, before later expression admission. */
export function collationName(c: Cursor): string {
  const name = c.peek().kind === TOKEN.STRING ? c.take().text : c.expectIdentifier()
  if (collationInfoByName(name) === undefined) throw unknownCollation(name)
  return name
}

/** BINARY is also a charset keyword; unknown names are refused at their use. */
export function charsetName(c: Cursor): string {
  const name = c.peek().kind === TOKEN.STRING || c.atWord('BINARY') ? c.take().text : c.expectIdentifier()
  if (defaultCollationOf(name) === undefined) throw unknownCharset(name)
  return name
}
