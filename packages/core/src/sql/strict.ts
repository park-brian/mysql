// A strict mode's other half: in a statement that changes data, the
// warnings that say a value was not what it should have been are errors.
//
// MySQL does this in one place, `Strict_error_handler` (sql/error_handler.cc),
// which every condition passes through on its way into the diagnostics area:
// under STRICT_TRANS_TABLES or STRICT_ALL_TABLES, in an INSERT, REPLACE,
// UPDATE, DELETE, CREATE TABLE, ALTER TABLE or index statement that does not
// say IGNORE, a warning of a generated strict code is raised as an error. So
// `'abc' + 1` stored, compared in an UPDATE's WHERE, or read in a subquery
// of an INSERT is 1292 and the statement fails (8.4.11), while the same
// expression in a SELECT is a warning. Here the statement's conditions are
// the one place too: a list whose `push` raises those codes as errors.
import { isStrictErrorCode, sqlError, symbolOf, type SqlError } from '@myjs/protocol'
import { STATEMENT, type Statement } from '@myjs/parser'
import type { Condition } from '@myjs/types'
import { modeOf } from './mode.ts'

/** A statement's conditions, where a warning of an escalated code is thrown rather than kept. */
class StrictConditions extends Array<Condition> {
  /** The promoted primary error, by identity, for publication after a later condition. */
  declare primary?: SqlError
  // `slice` and `map` make plain lists: only the statement's own list escalates.
  static override get [Symbol.species](): ArrayConstructor {
    return Array
  }

  override push(...items: Condition[]): number {
    for (const c of items) {
      if (c.level === 'Warning' && isStrictErrorCode(c.code)) {
        this.primary ??= sqlError(symbolOf(c.code) ?? 'ER_UNKNOWN_ERROR', c.message)
        super.push({ ...c, level: 'Error' })
        throw this.primary
      }
      super.push(c)
    }
    return this.length
  }
}

/** Whether this statement's strict handler already recorded this exact failure. */
export function promotedError(conditions: readonly Condition[] | undefined, error: unknown): boolean {
  return conditions instanceof StrictConditions && conditions.primary !== undefined && conditions.primary === error
}

/** Whether the handler applies: a strict mode, and a statement that changes data without IGNORE. */
function escalates(statement: Statement, sqlMode: string): boolean {
  if (!modeOf(sqlMode).strict) return false
  switch (statement.kind) {
    case STATEMENT.INSERT:
    case STATEMENT.UPDATE:
    case STATEMENT.DELETE:
      return statement.ignore !== true
    case STATEMENT.CREATE_TABLE:
    case STATEMENT.ALTER_TABLE:
      return true
    case STATEMENT.DROP:
      return statement.object === 'INDEX'
    default:
      return false
  }
}

/** The list a statement's conditions go into. */
export const conditionsFor = (statement: Statement, sqlMode: string): Condition[] => (escalates(statement, sqlMode) ? new StrictConditions() : [])

