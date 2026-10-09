// A strict mode's other half: in a statement that changes data, the
// warnings that say a value was not what it should have been are errors.
//
// MySQL does this in one place, `Strict_error_handler` (sql/error_handler.cc),
// which every condition passes through on its way into the diagnostics area:
// under STRICT_TRANS_TABLES or STRICT_ALL_TABLES, in an INSERT, REPLACE,
// UPDATE, DELETE, CREATE TABLE, ALTER TABLE or index statement that does not
// say IGNORE, a warning of one of the codes below is raised as an error. So
// `'abc' + 1` stored, compared in an UPDATE's WHERE, or read in a subquery
// of an INSERT is 1292 and the statement fails (8.4.11), while the same
// expression in a SELECT is a warning. Here the statement's conditions are
// the one place too: a list whose `push` raises those codes as errors.
import { errnoOf, sqlError, symbolOf } from '@myjs/protocol'
import { STATEMENT, type Statement } from '@myjs/parser'
import type { Condition } from '@myjs/types'
import { modeOf } from './mode.ts'

/** The codes `Strict_error_handler::handle_condition` raises as errors. */
const ESCALATED: ReadonlySet<number> = new Set(
  [
    'ER_TRUNCATED_WRONG_VALUE',
    'ER_WRONG_VALUE_FOR_TYPE',
    'ER_WARN_DATA_OUT_OF_RANGE',
    'ER_WARN_DATA_OUT_OF_RANGE_FUNCTIONAL_INDEX',
    'ER_DIVISION_BY_ZERO',
    'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
    'WARN_DATA_TRUNCATED',
    'ER_WARN_DATA_TRUNCATED_FUNCTIONAL_INDEX',
    'ER_DATA_TOO_LONG',
    'ER_BAD_NULL_ERROR',
    'ER_NO_DEFAULT_FOR_FIELD',
    'ER_TOO_LONG_KEY',
    'ER_NO_DEFAULT_FOR_VIEW_FIELD',
    'ER_WARN_NULL_TO_NOTNULL',
    'ER_CUT_VALUE_GROUP_CONCAT',
    'ER_DATETIME_FUNCTION_OVERFLOW',
    'ER_TEMPORAL_FUNCTION_OVERFLOW',
    'ER_WARN_TOO_FEW_RECORDS',
    'ER_WARN_TOO_MANY_RECORDS',
    'ER_INVALID_ARGUMENT_FOR_LOGARITHM',
    'ER_NUMERIC_JSON_VALUE_OUT_OF_RANGE',
    'ER_INVALID_JSON_VALUE_FOR_CAST',
    'ER_WARN_ALLOWED_PACKET_OVERFLOWED',
  ].map(errnoOf),
)

/** A statement's conditions, where a warning of an escalated code is thrown rather than kept. */
class StrictConditions extends Array<Condition> {
  // `slice` and `map` make plain lists: only the statement's own list escalates.
  static override get [Symbol.species](): ArrayConstructor {
    return Array
  }

  override push(...items: Condition[]): number {
    for (const c of items) {
      if (c.level === 'Warning' && ESCALATED.has(c.code)) throw sqlError(symbolOf(c.code) ?? 'ER_UNKNOWN_ERROR', c.message)
      super.push(c)
    }
    return this.length
  }
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

