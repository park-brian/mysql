import { ParseError } from '@myjs/parser'
import { sqlStateOf, symbolOf } from '@myjs/protocol'

/** An annotated native error can be refused by the grammar only with matching facts. */
export function annotatedAdmission(error, expectedError) {
  if (!(error instanceof ParseError) || typeof expectedError !== 'string') return false
  if (symbolOf(error.errno) !== error.code || sqlStateOf(error.errno) !== error.sqlState) return false
  return expectedError.split(',').some((part) => {
    const label = part.trim()
    return label === error.code || (/^\d+$/.test(label) && Number(label) === error.errno)
  })
}
