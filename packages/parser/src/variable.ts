import { TOKEN } from './tokens.ts'
import type { Cursor } from './cursor.ts'

/** Components after @@, retaining dots inside quoted identifiers. */
export function systemVariableParts(c: Cursor, strings = false): string[] {
  const token = c.take()
  const name = token.text.slice(2)
  if (token.quote !== undefined) {
    if (token.quote !== '`' || c.atOp('.')) c.fail({ ...token, start: token.start + 2 })
    return [name]
  }
  const part = (): string => strings && c.peek().kind === TOKEN.STRING ? c.take().text : c.expectNamePart()
  const parts = name.split('.')
  if (parts.at(-1) === '') {
    parts.pop()
    parts.push(part())
  }
  while (parts.length < 3 && c.takeOp('.')) parts.push(part())
  return parts
}
