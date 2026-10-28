import { messages, sqlError, type SqlError } from '@myjs/protocol'

/** A named refusal; each caller still decides which feature is unavailable and when. */
export function notSupported(what: string): SqlError {
  return sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(what))
}

/** Both clauses keep their caller's spelling and validation order. */
export function wrongUsage(first: string, second: string): SqlError {
  return sqlError('ER_WRONG_USAGE', `Incorrect usage of ${first} and ${second}`)
}

/** Callers decide existence and retain the spelling of the table they report. */
export function tableExistsError(name: string): SqlError {
  return sqlError('ER_TABLE_EXISTS_ERROR', `Table '${name}' already exists`)
}

/** A qualified list or an unresolved table alias, already formatted by its caller. */
export function unknownTableError(name: string): SqlError {
  return sqlError('ER_BAD_TABLE_ERROR', `Unknown table '${name}'`)
}

/** The caller retains native spelling and decides when argument validation has failed. */
export function wrongArgumentsError(name: string): SqlError {
  return sqlError('ER_WRONG_ARGUMENTS', `Incorrect arguments to ${name}`)
}
