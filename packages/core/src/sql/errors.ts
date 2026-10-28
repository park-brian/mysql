import { messages, sqlError, type SqlError } from '@myjs/protocol'

/** A named refusal; each caller still decides which feature is unavailable and when. */
export function notSupported(what: string): SqlError {
  return sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(what))
}
