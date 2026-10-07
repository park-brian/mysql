// M3.3 — the deparser's round-trip, shared by the census and the unit tests.
//
// `parse(deparse(ast))` must be `ast` again, positions aside: the second parse
// reads the deparser's text, so every `at` differs, and nothing else may. The
// comparison is structural and strict — a `bigint` is not a `number`, and an
// absent field is not an `undefined` one — because the parser's convention is
// that an unset flag is *absent*, and a deparser that wrote `NULL` where the
// original said nothing would otherwise pass.
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { ParseError, deparse, parseStatement } from '@myjs/parser'

/** A copy of an AST with every `at` removed. */
export function withoutPositions(node) {
  if (Array.isArray(node)) return node.map(withoutPositions)
  if (node === null || typeof node !== 'object' || node instanceof Uint8Array) return node
  const out = {}
  for (const [key, value] of Object.entries(node)) if (key !== 'at') out[key] = withoutPositions(value)
  return out
}

/**
 * Deparse `ast`, parse the text again, and compare. Returns `null` on a
 * faithful round-trip, or what went wrong: the deparsed text and either the
 * error the reparse threw or the fact that the trees differ.
 */
export function roundTrip(ast, options = {}) {
  const sql = deparse(ast, options)
  let again
  try {
    again = parseStatement(sql, options)
  } catch (e) {
    return { sql, error: String(e?.message ?? e) }
  }
  return isDeepStrictEqual(withoutPositions(ast), withoutPositions(again)) ? null : { sql, error: 'tree differs' }
}

// --- for the parser's unit tests ----------------------------------------------

/** Parse one statement, asserting it survives the deparser — what the census checks at corpus scale. */
export function parsed(sql) {
  const node = parseStatement(sql)
  assert.equal(roundTrip(node), null, `${sql}\n${deparse(node)}`)
  return node
}

/** Assert two spellings parse to one tree. */
export function same(a, b) {
  assert.deepEqual(withoutPositions(parsed(a)), withoutPositions(parsed(b)), `${a}\n${b}`)
}

/** Assert each statement is a syntax error. */
export function refused(...sqls) {
  for (const sql of sqls) assert.throws(() => parseStatement(sql), (e) => e instanceof ParseError && e.code === 'ER_PARSE_ERROR', sql)
}
