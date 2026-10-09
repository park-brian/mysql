// A session's `sql_mode`, read once: the parser's flags and the ones the
// executor branches on, from one parse of the text.
//
// The text is what `SET sql_mode` stored, already validated and with its
// combination modes expanded (`formatSqlMode`), so a name test is exact. The
// executor used to test it with a regular expression wherever it asked, once
// per row in a division; a session holds one mode at a time, and a handful
// over its life, so each is parsed once and kept.
import { parseSqlMode, type SqlMode } from '@myjs/parser'

export interface Mode extends SqlMode {
  /** STRICT_TRANS_TABLES or STRICT_ALL_TABLES: a bad value is an error, not a warning, in a statement that changes data. */
  readonly strict: boolean
  readonly noZeroDate: boolean
  readonly noZeroInDate: boolean
  readonly errorForDivisionByZero: boolean
  readonly onlyFullGroupBy: boolean
}

const modes = new Map<string, Mode>()

export function modeOf(text: string): Mode {
  let mode = modes.get(text)
  if (mode === undefined) {
    const parsed = parseSqlMode(text)
    const has = (name: string): boolean => parsed.names.has(name)
    mode = {
      ...parsed,
      strict: has('STRICT_TRANS_TABLES') || has('STRICT_ALL_TABLES'),
      noZeroDate: has('NO_ZERO_DATE'),
      noZeroInDate: has('NO_ZERO_IN_DATE'),
      errorForDivisionByZero: has('ERROR_FOR_DIVISION_BY_ZERO'),
      onlyFullGroupBy: has('ONLY_FULL_GROUP_BY'),
    }
    // An expression can build any number of distinct texts; keep the cache small.
    if (modes.size >= 64) modes.clear()
    modes.set(text, mode)
  }
  return mode
}
