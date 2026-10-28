import { messages, sqlError, type SqlError } from '@myjs/protocol'

/** A named refusal; each caller still decides which feature is unavailable and when. */
export function notSupported(what: string): SqlError {
  return sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(what))
}

/** Both clauses keep their caller's spelling and validation order. */
export function wrongUsage(first: string, second: string): SqlError {
  return sqlError('ER_WRONG_USAGE', `Incorrect usage of ${first} and ${second}`)
}
