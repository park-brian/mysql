// M5.1/M5.3 — an expression tree compiled to a closure, and the type it yields.
//
// One `switch` over the node kinds, run once per statement execution rather
// than once per row: the row loop then calls closures and never looks at the
// tree again (D-63). Each node answers two questions as it is compiled — how
// to evaluate it, and what `ResultType` it has — because a client receives the
// second before the first, in the column definitions.
//
// Recursion is safe: D-40 bounds a parsed tree at 1,000 levels.
//
// What is not here yet is refused by name rather than approximated: an
// unknown function is ER_SP_DOES_NOT_EXIST, as MySQL says it, and a builtin we
// have not written is ER_NOT_SUPPORTED_YET naming it (M5.10 owns the rest).
import { CHARSET_BINARY, COLUMN_FLAG, FIELD_TYPE, expectTyped, equalBytes } from '@myjs/bytes'
import { someNode } from './ast.ts'
import { collationInfoByName, decodeCollation, defaultCollationOf, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { LITERAL, NODE, TOKEN, deparse, lex, parseExpression, type CallNode, type CaseNode, type CastNode, type ConvertNode, type Expression, type LiteralNode, type MatchNode, type QueryExpression, type SubqueryNode, type VariableNode, quoteName } from '@myjs/parser'
import type { ColumnDef, Table, Trx } from '@myjs/engine'
import { sqlError, messages, type Session } from '@myjs/protocol'
import { promotedError } from './strict.ts'
import {
  COERCIBILITY,
  MAX_SIGNED,
  MAX_UNSIGNED,
  MIN_SIGNED,
  TypeError as ValueError,
  add,
  DERIVATION_NONE,
  aggregateCollation,
  aggregateDerivations,
  equalityKey,
  charsetOfCollation,
  bitNot,
  bitwise,
  bool,
  bytesValue,
  compareValues,
  textComparer,
  plainValue,
  withoutHex,
  decodeField,
  encodeField,
  decimalValue,
  dateOf,
  divide,
  decimalFractionCapacity,
  magnitudeDigits,
  doubleValue,
  intDivide,
  intValue,
  isText as isTextValue,
  jsonValue,
  modulo,
  negate,
  numericPrefix,
  integerPrefix,
  not,
  nullSafeEqual,
  parseDateTime,
  parseDecimal,
  parseTime,
  pow10,
  packTime,
  roundTime,
  rescale,
  stringValue,
  toDateTime,
  toDecimal,
  toDouble,
  toText,
  toTime,
  timeOrdinal,
  truth,
  valInt,
  type Condition,
  type DecimalValue,
  type Derived,
  type StringValue,
  type Value,
  valueOutOfRange,
  valueBytes,
  renderFloat,
  jsonTruth,
  numberToDateTime,
  toInteger,
  toJsonDoc,
  temporalDeprecation,
  mergeTypes,
  type MergeType,
} from '@myjs/types'
import {
  CHARSET_UTF8MB4_BIN,
  NATIONAL_DEPRECATION,
  NULL_TYPE,
  boolType,
  charWidth,
  datetimeType,
  decimalType,
  decimalCastShape,
  doubleType,
  fixedDouble,
  floatLength,
  intType,
  isNumber,
  jsonAsText,
  jsonType,
  stringType,
  stringResultType,
  type ResultType,
  type SourceColumn,
} from './meta.ts'
import { castAsJson } from './json.ts'
import { jsonPathFunction, memberOf, unquote } from './json-path.ts'
import { regexpLike } from './regexp.ts'
import { valueKey } from './keys.ts'
import { safeResolve, TableScope } from './scope.ts'
import { bitBytes } from './wire.ts'
import { badAgainst, booleanRank, Corpus, foldFor, fulltextOf, naturalRank, noExpansion, noIndex, parseBoolean, queryText, wordsOf, type Term } from './fulltext.ts'
import { windowNotAllowed } from './window.ts'
import { dateAdd, isInterval, onToday } from './interval.ts'
import { printString, printExpression, Unprintable } from './print.ts'
import { modeOf } from './mode.ts'
import { NOT_YET, VARIES_PER_EVALUATION, functionCompiler } from './registry.ts'
import { clock, escapedBytes, hexOf } from './builtins.ts'
import { systemVariableInfo } from './variables.ts'

/** One row as operators pass it: a value per column of the scope. */
export type Row = readonly Value[]

/** The row a statement is producing, 1-based, as a warning's "at row N" names it (`current_row_for_condition`). */
const ROW_NUMBERS = new WeakMap<object, number>()
export const rowNumber = (env: Env): number => ROW_NUMBERS.get(env) ?? 1
export const setRowNumber = (env: Env, n: number): void => {
  ROW_NUMBERS.set(env, n)
}

/** What evaluation may read beyond the row: the parameters, the clock, the session. */
export interface Env {
  readonly params: readonly Value[]
  /** The statement's start, which every `NOW()` in it returns. */
  readonly now: Date
  readonly session: Session
  readonly state: SessionValues
  /** The transaction a subquery reads in (M5.1). */
  readonly trx?: Trx | undefined
  /** The rows of the enclosing queries, innermost first: what a correlated reference reads (D-74). */
  readonly outer?: readonly Row[]
  /** One statement's memory: an uncorrelated subquery's answer, computed once. */
  readonly memo?: Map<unknown, unknown>
  /** The statement's conditions, as SHOW WARNINGS will list them. */
  readonly conditions?: Condition[] | undefined
}

/**
 * An operand read as a number, with its source reader's diagnostics. Text
 * normally draws 1292 for truncation. DECIMAL fields and function prefix readers
 * retain fatal invalid-prefix diagnostics; BLOB/TEXT and those functions discard
 * truncation status.
 * Field readers can suppress empty/whitespace warnings; INTEGER casts retain them.
 * ENUM indices and numeric hex literals are quiet. The value passes unchanged.
 */
export function asNumber(c: Compiled, kind: 'DOUBLE' | 'INTEGER' | 'DECIMAL', once: boolean | Expression = false, source: 'field' | 'cast' = 'field'): Compiled {
  if (kind === 'DECIMAL' && c.decimalOf !== undefined) return { type: c.type, eval: c.decimalOf(once) }
  if (c.type.kind === 'json') return jsonAsNumber(c, kind)
  // my_decimal's nine base-10^9 words hold 81 integer digits. Expanding a
  // DOUBLE beyond that buffer warns with its mantissa (double2decimal).
  if (c.type.kind === 'double' && kind === 'DECIMAL') return { ...c, eval: (r, env) => {
    const v = c.eval(r, env)
    if (v?.kind === 'double') {
      if (Math.abs(v.v) >= 1e81) {
        truncated(env, 'DECIMAL', toText(v).split(/[eE]/)[0] as string)
        return decimalValue((v.v < 0 ? -1n : 1n) * (pow10(81) - 1n), 0)
      }
      const d = toDecimal(v)
      const fraction = decimalFractionCapacity(magnitudeDigits(d.v).length - d.scale)
      if (d.scale > fraction) return decimalValue(d.v / pow10(d.scale - fraction), fraction)
    }
    return v
  } }
  if (!isText(c.type)) return c
  const column = c.type.column
  // Fixed CHAR/BINARY fields use ErrConvString, as explicit INTEGER casts do.
  const diagnosticKind = (source === 'cast' && kind === 'INTEGER') || (column && kind === 'DECIMAL' && c.type.field === FIELD_TYPE.STRING) ? c.type.kind : undefined
  // A TEXT or BLOB column reads as a double or an integer without a word
  // (`Field_blob::val_real` and `val_int` discard the error).
  const fieldRead = column && diagnosticKind === undefined && kind !== 'DECIMAL'
  if (fieldRead && c.type.field === FIELD_TYPE.BLOB) return c
  // A VARCHAR or VARBINARY column, read as a double or an integer, is quiet
  // when the bytes left unconverted are exactly twice its length bytes — 2
  // under 256 bytes, 4 from there (8.4.11: in a VARCHAR(10), `v + 0` warns
  // for '1x' and '12x' but not for '1xy', 'xy' or 'é'; in a VARCHAR(400),
  // for those three but not for '1abc' or '1.2.3.4'). A CHAR always warns.
  const quietTail = fieldRead && c.type.field === FIELD_TYPE.VAR_STRING ? (byteWidth(c.type) < 256 ? 2 : 4) : undefined
  // Once a statement, a constant: keyed by its node when it has one, so that
  // the optimizer's own evaluation of it and the plan's share the one warning (8.4.11).
  const key = typeof once === 'object' ? once : {}
  return {
    ...c,
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v === null) return v
      if (once !== false) {
        if (env.memo?.has(key)) return v
        env.memo?.set(key, true)
      }
      if (quietTail !== undefined && unconvertedBytes(v, kind) === quietTail) return v
      checkNumber(v, kind, env, c, diagnosticKind)
      return v
    },
  }
}

/** A comparison caches converted constants while resolving, before it reads any rows. */
const NUMBER_CONSTANTS = new WeakMap<Condition[], Map<Expression, Compiled>>()
export function numberConstant(c: Compiled, written: Expression, ctx: CompileContext, resolving = false): Compiled {
  const constant = constantNode(written)
  const read = asNumber(c, 'DOUBLE', constant && written)
  if (!constant || (!resolving && ctx.clause !== 'where clause' && ctx.clause !== 'on clause') || (written.kind === NODE.PLACEHOLDER && ctx.params === undefined)) return read
  let cache = ctx.conditions === undefined ? undefined : NUMBER_CONSTANTS.get(ctx.conditions)
  if (cache?.has(written)) return cache.get(written) as Compiled
  const value = resolveConstant(read, ctx)
  if (ctx.conditions !== undefined) {
    if (cache === undefined) { cache = new Map(); NUMBER_CONSTANTS.set(ctx.conditions, cache) }
    cache.set(written, value)
  }
  return value
}

function resolveConstant(c: Compiled, ctx: CompileContext): Compiled {
  return lit(c.eval([], { ...constantEnv(ctx), memo: new Map(), conditions: ctx.conditions }), c.type)
}

/** The bytes a number's reading leaves over: after the integer for an INTEGER (-1 when there is no digit), after the number for a DOUBLE (all of them, leading spaces too, when there is none). */
function unconvertedBytes(v: Exclude<Value, null>, kind: 'DOUBLE' | 'INTEGER' | 'DECIMAL'): number {
  if (!isTextValue(v)) return 0
  const text = toText(v)
  const m = (kind === 'INTEGER' ? /^[ \t\n\r]*[+-]?\d+/ : /^(?:[ \t\n\r]*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?/).exec(text)
  if (m === null) return -1
  const rest = text.slice(m[0].length)
  return v.kind === 'bytes' ? rest.length : new TextEncoder().encode(rest).length
}

/** Text on one side and a number on the other: a comparison of doubles. */
/**
 * An operand of NOT, AND, OR or XOR: text read as a double, warning once a
 * statement for a constant; JSON true unless it is a number that is zero (`jsonTruth`).
 */
export function logicalOperand(c: Compiled, written: Expression | false, ctx?: CompileContext): Compiled['eval'] {
  if (c.type.kind === 'json') {
    const message = 'Evaluating a JSON value in SQL boolean context does an implicit comparison against JSON integer 0; if this is not what you want, consider converting JSON to a SQL numeric type with JSON_VALUE RETURNING'
    if (ctx !== undefined) warnAtCompile(ctx, 3986, message)
    return (r, env) => {
      const v = c.eval(r, env)
      return v === null || v.kind !== 'json' ? v : bool(jsonTruth(v))
    }
  }
  return asNumber(c, 'DOUBLE', written !== false && constantNode(written) && written).eval
}

/**
 * A value's digits, as `Item::decimal_precision` counts them: an integer's or
 * a DECIMAL's own, a temporal's number's (YYYYMMDD, hhhmmss, and both, with its
 * fraction), and otherwise its text's width, at most 65.
 */
export function decimalPrecision(t: ResultType): number {
  if (t.literalInt !== undefined) return t.literalInt.digits
  if (t.kind === 'int') return Math.max(1, Math.min(t.length - (t.unsigned ? 0 : 1), 65))
  if (t.kind === 'decimal') return Math.max(1, Math.min(t.length, 65))
  if (t.kind === 'datetime') return t.scale + (t.field === FIELD_TYPE.DATE ? 8 : 14)
  if (t.kind === 'time') return t.scale + 7
  return Math.min(charWidth(t), 65)
}

/** A value's fixed decimals: an integer's none, a DECIMAL's and a temporal's scale, a double's when it has them; text has none to give. */
function fixedDecimals(t: ResultType): number | undefined {
  if (t.literalInt !== undefined || t.kind === 'int') return 0
  if (t.kind === 'decimal' || t.kind === 'datetime' || t.kind === 'time') return t.scale
  if (t.kind === 'double' && t.scale < 31) return t.scale
  return undefined
}

export function textVersusNumber(x: ResultType, y: ResultType): boolean {
  return isText(x) && isNumber(y)
}

/**
 * JSON read as a number: 3156 each row for what is no number — an array, an
 * object, `null`, a string that is not wholly one (8.4.11: `"10"` and `true`
 * are quiet, `"1x"` warns though it reads as 1).
 */
function jsonAsNumber(c: Compiled, kind: 'DOUBLE' | 'INTEGER' | 'DECIMAL'): Compiled {
  const name = c.type.column?.orgName ?? 'json'
  return {
    ...c,
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v === null || v.kind !== 'json') return v
      const d = v.v
      const number = d.t === 'int' || d.t === 'uint' || d.t === 'double' || d.t === 'decimal' || d.t === 'bool' || (d.t === 'string' && numericPrefix(d.v).complete)
      if (!number) raise(env, 3156, `Invalid JSON value for CAST to ${kind} from column ${name} at row ${rowNumber(env)}`)
      return v
    },
  }
}

/** `asNumber`'s check, for one value. */
function checkNumber(v: Exclude<Value, null>, kind: 'DOUBLE' | 'INTEGER' | 'DECIMAL', env: Env, c: Compiled, diagnosticKind?: ResultType['kind']): void {
  if (integerPrefix(v) === undefined) return
  const text = toText(v)
  const p = numericPrefix(text)
  const column = c.type.column
  // Field_blob and CONCAT's Item_str_func reader discard truncation status;
  // an invalid prefix still raises the decimal converter's fatal 1366.
  if (kind === 'DECIMAL') {
    if ((column || c.decimalPrefix) && !p.valid) raise(env, 1366, "Incorrect DECIMAL value: '0' for column '' at row -1")
    if (c.decimalPrefix || (column && c.type.field === FIELD_TYPE.BLOB)) return
  }
  // An integer past 64 bits is truncated too, to the largest there is.
  const overflow =
    kind === 'INTEGER'
      ? p.complete && !p.fractional && (BigInt(p.text) > MAX_UNSIGNED || BigInt(p.text) < MIN_SIGNED)
      : // And a double past the largest, which is read as it (8.4.11: `'1e400' + 0`).
        kind === 'DOUBLE' && p.complete && !Number.isFinite(Number(p.text))
  if (p.complete && !(kind === 'INTEGER' && p.fractional) && !overflow) return
  // INTEGER casts warn even for empty or whitespace-only strings and bytes.
  if (!p.complete && kind !== 'DECIMAL' && diagnosticKind === undefined && /^[ \t\n\r]*$/.test(text)) return
  let diagnostic: string
  if (diagnosticKind === 'bytes' && v.kind === 'bytes') diagnostic = escapedBytes(v.v.subarray(0, 128)).slice(0, 128)
  else if (diagnosticKind === 'string') diagnostic = fixedNumericText(v)
  else diagnostic = warnedText(v)
  truncated(env, kind, diagnostic)
}

/** A truncated conversion's message; each reader retains its text policy. */
function truncated(env: Env, kind: string, text: string): void {
  raise(env, 1292, `Truncated incorrect ${kind} value: '${text}'`)
}

/**
 * The default diagnostic text reader: up to the first NUL, the message
 * being a C string, and bytes read as UTF-8 (8.4.11: X'00FF' is quoted as
 * '', X'0A000509' as '\n', X'C3A9' as 'é').
 */
export function warnedText(v: Exclude<Value, null>): string {
  if (v.kind === 'bytes') {
    const nul = v.v.indexOf(0)
    return new TextDecoder().decode(nul === -1 ? v.v : v.v.subarray(0, nul))
  }
  const text = toText(v)
  const nul = text.indexOf('\0')
  return nul === -1 ? text : text.slice(0, nul)
}

/** utf8mb3 carries no character past the BMP. */
const bmpText = (text: string): string => text.replace(/[\u{10000}-\u{10FFFF}]/gu, '?')

/** INTEGER casts and fixed CHAR DECIMAL fields normalize before the UTF-8 byte cap. */
function fixedNumericText(v: Exclude<Value, null>): string {
  const text = bmpText(warnedText(v)).slice(0, 128)
  return new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, 128))
}

/** An invalid string argument: one 1411 warning for this evaluation, then NULL. */
export function invalidString(env: Env, text: string, fn: string): null {
  raise(env, 1411, `Incorrect string value: '${text}' for function ${fn}`)
  return null
}

/** An environment for evaluating a constant while compiling: no row, the statement's parameters. */
export const constantEnv = (ctx: CompileContext): Env => ({ params: ctx.params ?? [], now: ctx.state.clock?.() ?? new Date(), session: ctx.session, state: ctx.state })

/**
 * An argument as `Item::print` shows it in a message that quotes one —
 * INET_ATON's and INET_NTOA's 1411: a column as `schema`.`table`.`column`,
 * a string with its introducer if it was written with one (8.4.11).
 */
export function printedArgument(a: Expression, ctx: CompileContext): string {
  try {
    return printExpression(a, {
      column: (parts) => {
        let c: SourceColumn | undefined
        try {
          c = compile({ kind: NODE.COLUMN, parts, at: a.at }, ctx).type.column
        } catch (e) {
          expectTyped(e)
          // A column the clause cannot see by itself (an aggregate's, in HAVING) is named as written.
        }
        const q = quoteName
        return c === undefined ? parts.map(q).join('.') : `${q(c.schema)}.${q(c.table)}.${q(c.orgName === '' ? (parts[parts.length - 1] as string) : c.orgName)}`
      },
      string: printString,
      source: ctx.sql,
    })
  } catch (err) {
    if (err instanceof Unprintable) return deparse(a)
    throw err
  }
}

/**
 * An expression's text as the statement wrote it, from its start to the
 * parenthesis that closes it or the enclosing argument delimiter: what a
 * warning quoting it quotes.
 */
export function sourceText(sql: string | undefined, at: number): string | undefined {
  if (sql === undefined) return undefined
  let depth = 0
  for (const t of lex(sql)) {
    if (t.start < at || t.kind !== TOKEN.OPERATOR) continue
    if (depth === 0 && (t.text === ',' || t.text === ')')) return sql.slice(at, t.start).trimEnd()
    if (t.text === '(') depth++
    else if (t.text === ')' && --depth === 0) return sql.slice(at, t.start + 1)
  }
  return undefined
}

/**
 * CONVERT(x USING cs): text in cs's default collation, with the coercibility
 * of a column (2). Bytes, a BIT's included, are read as cs and are NULL with
 * 1300 when they are no text in it; text is carried over, '?' standing for a
 * character cs cannot hold; USING binary is the bytes (8.4.11).
 */
function convertUsing(e: ConvertNode, ctx: CompileContext): Compiled {
  const x = compile(e.expr, ctx)
  const name = e.charset.toLowerCase() === 'utf8' ? 'utf8mb3' : e.charset.toLowerCase()
  const id = name === 'binary' ? CHARSET_BINARY : defaultCollationOf(name)?.id
  if (id === undefined) throw sqlError('ER_UNKNOWN_CHARACTER_SET', `Unknown character set: '${e.charset}'`)
  if (name === 'utf8mb3') warnAtCompile(ctx, 1287, "'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead")
  // Characters, or bytes as many as the text could take when the result is bytes.
  const width = x.type.kind === 'bytes' || isBits(x.type) ? bitsOrBytesWidth(x.type) : charWidth(x.type) * (id === CHARSET_BINARY && x.type.kind === 'string' ? requireCollationInfo(x.type.collationId).mbmaxlen : 1)
  return {
    eval: (r, env) => {
      const v = x.eval(r, env)
      if (v === null) return null
      const bytes = v.kind === 'bytes' ? v.v : v.kind === 'int' && isBits(x.type) ? bitBytes(v.v, x.type.length) : undefined
      if (id === CHARSET_BINARY) return bytesValue(bytes ?? valueBytes(v))
      let text = bytes === undefined ? decodeCollation(encodeCollation(toText(v), id), id) : textIn(bytes, id, env)
      if (bytes === undefined && name === 'utf8mb3' && text !== null) text = bmpText(text)
      return text === null ? null : stringValue(text, id, COERCIBILITY.IMPLICIT)
    },
    type: stringType(width, id, true),
    decimalPrefix: true,
  }
}

/** A condition raised while compiling, into the statement's diagnostics area. */
function warnAtCompile(ctx: CompileContext, code: number, message: string): void {
  ctx.conditions?.push({ level: 'Warning', code, message })
}

/** How many bytes a bytes-like type is wide: a BIT's are its bits over 8. */
const bitsOrBytesWidth = (t: ResultType): number => (isBits(t) ? Math.ceil(t.length / 8) : t.length)

/** A BIT column's value, or an expression's that keeps its type: bytes in a string context. */
export const isBits = (t: ResultType): boolean => t.field === FIELD_TYPE.BIT && t.kind === 'int'

/**
 * Bytes read as text in a collation's charset: NULL, with 1300 naming the
 * bytes from the first that is not text, when they are not (UTF-8 is checked;
 * a single-byte charset holds any byte).
 */
function textIn(bytes: Uint8Array, collationId: number, env: Env): string | null {
  const charset = requireCollationInfo(collationId).charset
  if (charset === 'utf8mb4' || charset === 'utf8mb3') {
    const bad = firstInvalidUtf8(bytes, charset === 'utf8mb4' ? 4 : 3)
    if (bad >= 0) {
      const rest = hexOf(bytes.subarray(bad, bad + 6))
      raise(env, 1300, `Invalid ${charset} character string: '${rest}'`)
      return null
    }
  }
  return decodeCollation(bytes, collationId)
}

/** Where a UTF-8 byte sequence stops being one, or -1; `longest` is 3 for utf8mb3. */
function firstInvalidUtf8(b: Uint8Array, longest: number): number {
  let i = 0
  while (i < b.length) {
    const c = b[i] as number
    const n = c < 0x80 ? 1 : c >= 0xc2 && c <= 0xdf ? 2 : c >= 0xe0 && c <= 0xef ? 3 : c >= 0xf0 && c <= 0xf4 ? 4 : 0
    if (n === 0 || n > longest || i + n > b.length) return i
    for (let k = 1; k < n; k++) if (((b[i + k] as number) & 0xc0) !== 0x80) return i
    // Overlong three- and four-byte forms, surrogates and past U+10FFFF.
    const d = b[i + 1] as number
    if ((c === 0xe0 && d < 0xa0) || (c === 0xed && d >= 0xa0) || (c === 0xf0 && d < 0x90) || (c === 0xf4 && d >= 0x90)) return i
    i += n
  }
  return -1
}

/** A division of either kind, with 1365 when the divisor is zero and the answer therefore NULL. */
function byZero(at: Compiled['eval'], bt: Compiled['eval'], op: (x: Value, y: Value, env: Env) => Value, shortCircuit = false): Compiled['eval'] {
  return (r, env) => {
    const x = at(r, env)
    if (x === null && shortCircuit) return null
    const y = bt(r, env)
    const v = op(x, y, env)
    // Only ERROR_FOR_DIVISION_BY_ZERO makes it a warning: without it the
    // answer is NULL and nothing is said (`signal_divide_by_null`, 8.4.11).
    if (v === null && x !== null && y !== null && modeOf(env.session.sqlMode).errorForDivisionByZero) raise(env, 1365, 'Division by 0')
    return v
  }
}

/** Records a condition in the statement's diagnostics area, for SHOW WARNINGS. */
export function raise(env: Env, code: number, message: string, level: Condition['level'] = 'Warning'): void {
  env.conditions?.push({ level, code, message })
}

/** Session state an expression can read: user variables and the last statement's counters. */
export interface SessionValues {
  readonly userVariables: Map<string, Value>
  lastInsertId: bigint
  /**
   * Whether the statement running has evaluated `LAST_INSERT_ID(expr)`
   * (MySQL's `arg_of_last_insert_id_function`): an INSERT or UPDATE then
   * reports that value as its `insertId`. Cleared as each one starts.
   */
  insertIdSet: boolean
  rowCount: bigint
  /** A system variable's value, as `@@name` reads it; `undefined` for one that does not exist. */
  systemVariable(name: string, scope: 'GLOBAL' | 'SESSION' | undefined, session: Session): Value | undefined
  /** The statement's clock: the session's `SET TIMESTAMP`, or the time now. */
  clock?(): Date
}

export interface Compiled {
  readonly eval: (row: Row, env: Env) => Value
  readonly type: ResultType
  /** This expression's DECIMAL reader accepts a numeric prefix quietly. */
  readonly decimalPrefix?: true
  /** Read the selected original branch as DECIMAL, before result-type merging. */
  readonly decimalOf?: (once: boolean | Expression) => Compiled['eval']
}

/** Read one immutable row slot with its declared metadata. */
export function readSlot(index: number, type: ResultType): Compiled {
  return { eval: (row) => row[index] ?? null, type }
}

/** Where names resolve: the columns of the tables in `FROM`, in row order. */
export interface Scope {
  /**
   * The slot a column reference reads and its type. ER_BAD_FIELD_ERROR or
   * ER_NON_UNIQ_ERROR when there is none or more than one. `depth` is how
   * many queries out the column lives, for a correlated reference: it reads
   * `env.outer[depth - 1]` rather than the row.
   */
  resolve(parts: readonly string[], clause: string): { readonly index: number; readonly type: ResultType; readonly depth?: number }
}

/** A subquery planned for an expression: its columns, and its rows under an environment that carries the outer row. */
export interface SubqueryPlan {
  readonly columns: readonly { readonly name: string; readonly type: ResultType }[]
  /** Whether it reads a column of an enclosing query, and must run again for each of its rows. */
  readonly correlated: boolean
  /** Whether it has a FROM: one without is a constant row, never empty. */
  readonly hasFrom: boolean
  rows(env: Env): Iterable<readonly Value[]>
}

export const EMPTY_SCOPE: Scope = {
  resolve(parts, clause) {
    throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(parts.join('.'), clause))
  },
}

export interface CompileContext {
  readonly scope: Scope
  /** `collation_connection`: what a string literal is in. */
  readonly connectionCollation: number
  /** The parameters' values when they are known (an execute), so `?` has a type. */
  readonly params?: readonly Value[] | undefined
  /** The clause being compiled, for "Unknown column 'x' in 'where clause'". */
  readonly clause: string
  readonly session: Session
  readonly state: SessionValues
  readonly serverVersion: string
  /**
   * Inside `ON DUPLICATE KEY UPDATE`: where `VALUES(c)` reads the row the
   * INSERT tried to write, and a count of the calls, each of which 8.4.11
   * answers with a deprecation warning (1287). Anywhere else `VALUES(c)` is
   * NULL.
   */
  readonly insertValues?: { readonly resolve: (column: string) => { readonly index: number; readonly type: ResultType }; calls: number }
  /**
   * In a grouped query's select list, HAVING and ORDER BY: where an aggregate
   * call is collected and given its slot in the grouped row (M5.5). Absent
   * everywhere an aggregate is not allowed — a WHERE, a GROUP BY key — where
   * one is ER_INVALID_GROUP_FUNC_USE.
   */
  readonly aggregates?: { register(e: CallNode, ctx: CompileContext): Compiled }
  /** Where a select list's window functions are collected (M5.6); absent where none may be. */
  readonly windows?: { register(e: CallNode): Compiled } | undefined
  /** Inside an aggregate's arguments, where another aggregate is 1111 too. */
  readonly inAggregate?: boolean
  /** Above a grouping: the expressions that are its keys, which read the key slot (NULL in a ROLLUP super-aggregate row). */
  readonly groupKeys?: GroupKeys
  /** Plan a subquery whose enclosing scope is `outer` (M5.1); absent where none is allowed. */
  readonly subquery?: (q: QueryExpression, outer: Scope) => SubqueryPlan
  /** A subquery compiled as `[NOT] IN`, `= ALL` and their like: how, for the plan EXPLAIN prints of it (M5.47). */
  readonly quantified?: (q: QueryExpression, how: QuantifiedSubquery) => void
  /** A base table by name, for what reads one whole: MATCH's statistics (M5.26). */
  readonly table?: (schema: string, name: string) => Table | undefined
  /** The statement's diagnostics area, for what resolving a constant warns (1292 at a constant position, say). */
  readonly conditions?: Condition[] | undefined
  /** The statement's text, which a warning that quotes an expression quotes from. */
  readonly sql?: string
}

/** A grouped query's keys, as the expressions above the grouping see them. */
export interface GroupKeys {
  /** The key `e` is, read from its slot, or `undefined` when it is not one. */
  match(e: Expression): Compiled | undefined
  /** `GROUPING(e, …)`: which of the named keys a ROLLUP row has rolled up, as bits. */
  grouping(args: readonly Expression[], ctx: CompileContext): Compiled
}

/** The aggregate functions, `Item_sum`'s subclasses that a select list can name (M5.5). */
export const AGGREGATE_NAMES: ReadonlySet<string> = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'BIT_AND', 'BIT_OR', 'BIT_XOR',
  'STD', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
  'JSON_ARRAYAGG', 'JSON_OBJECTAGG',
])

export const lit = (value: Value, type: ResultType): Compiled => ({ eval: () => value, type })

/** A string type's coercibility: a column's 2, a literal's 4. */
export const coercibilityOf = (t: ResultType): number => t.coercibility ?? COERCIBILITY.COERCIBLE

/** The collation a list of string-typed results aggregates to (`aggregateDerivations`, pairwise), or `fallback` with none. */
export function aggregateTypes(types: readonly ResultType[], fallback: number): number {
  let acc: Derived | undefined
  for (const t of types) {
    if (t.kind !== 'string') continue
    const next = { collationId: t.collationId, derivation: coercibilityOf(t) }
    // Where MySQL cannot decide, `aggregateCollations` has already refused the statement.
    acc = acc === undefined ? next : (aggregateDerivations(acc, next) ?? acc)
  }
  return acc?.collationId ?? fallback
}

// --- Collation aggregation for an operation, and its errors ---------------------
//
// The pairwise rule is `@myjs/types`' `aggregateDerivations`. What is the
// executor's is which arguments take part, and the error when the rule cannot
// decide: 1267, 1270 or 1271, naming every argument for two or three. 8.4.11
// names the operation as the parser spells it: '=', 'like', ' IN ', 'concat',
// 'case', 'UNION'.

const DERIVATION = ['EXPLICIT', 'NONE', 'IMPLICIT', 'SYSCONST', 'COERCIBLE', 'NUMERIC', 'IGNORABLE'] as const
const UNICODE = new Set(['utf8mb4', 'utf8mb3', 'ucs2', 'utf16', 'utf16le', 'utf32'])
/** latin1_swedish_ci, `my_charset_numeric`'s collation. */
const NUMERIC_COLLATION = 8

export const isText = (t: ResultType): boolean => t.kind === 'string' || t.kind === 'bytes'

/**
 * The collation and derivation the arguments aggregate to for `operation`,
 * or its error; `compare` for an operation that compares, which NONE cannot
 * serve. Undefined when no argument is a string, or when one does not say
 * its derivation and so cannot be held to one.
 */
export function aggregateCollations(types: readonly ResultType[], operation: string, compare: boolean, numbers = true): Derived | undefined {
  const items: Derived[] = []
  let known = true
  for (const t of types) {
    if (isText(t)) {
      if (t.coercibility === undefined) known = false
      items.push({ collationId: t.kind === 'string' ? t.collationId : CHARSET_BINARY, derivation: coercibilityOf(t) })
    } else if (t.kind === 'null') items.push({ collationId: CHARSET_BINARY, derivation: COERCIBILITY.IGNORABLE })
    else if (t.kind === 'json') items.push({ collationId: CHARSET_UTF8MB4_BIN, derivation: COERCIBILITY.IMPLICIT })
    else items.push({ collationId: NUMERIC_COLLATION, derivation: COERCIBILITY.NUMERIC })
  }
  if (!types.some(isText)) return undefined
  // Without MY_COLL_ALLOW_NUMERIC_CONV a number is not converted, and meeting text is the mix's error (MATCH's).
  if (!numbers && items.some((d) => d.derivation === COERCIBILITY.NUMERIC)) throw collationMix(items, operation)
  let acc: Derived | undefined = items[0] as Derived
  for (const dt of items.slice(1)) {
    acc = aggregateDerivations(acc, dt)
    if (acc === undefined) break
  }
  if (acc === undefined || (compare && acc.derivation === DERIVATION_NONE)) {
    if (known) throw collationMix(items, operation)
    return undefined
  }
  // A literal is converted into the collation chosen, and one that cannot be is the mix's error (`convert_const_strings`).
  if (acc.collationId !== CHARSET_BINARY) {
    const target = charsetOfCollation(acc.collationId)
    for (const t of types) {
      if (t.kind !== 'string' || t.literalText === undefined || charsetOfCollation(t.collationId) === target || UNICODE.has(target)) continue
      const back = decodeCollation(encodeCollation(t.literalText, acc.collationId), acc.collationId)
      if (back !== t.literalText) throw collationMix(items, operation)
    }
  }
  return acc
}

function collationMix(items: readonly Derived[], operation: string): unknown {
  const show = (d: Derived) => `(${d.collationId === CHARSET_BINARY ? 'binary' : requireCollationInfo(d.collationId).name},${DERIVATION[d.derivation] as string})`
  if (items.length === 2) return sqlError('ER_CANT_AGGREGATE_2COLLATIONS', `Illegal mix of collations ${show(items[0] as Derived)} and ${show(items[1] as Derived)} for operation '${operation}'`)
  if (items.length === 3) return sqlError('ER_CANT_AGGREGATE_3COLLATIONS', `Illegal mix of collations ${items.map(show).join(', ')} for operation '${operation}'`)
  return sqlError('ER_CANT_AGGREGATE_NCOLLATIONS', `Illegal mix of collations for operation '${operation}'`)
}

/** A type with no table column behind it: what a function of a column returns. */
export function expressionOf(t: ResultType): ResultType {
  const { column: _column, blobBytes: _blob, ...rest } = t
  return rest
}

/** `true` when `t` can never be NULL. */
const notNull = (...ts: ResultType[]): boolean => ts.every((t) => !t.nullable)

export function compile(e: Expression, ctx: CompileContext): Compiled {
  if (ctx.groupKeys !== undefined) {
    const key = ctx.groupKeys.match(e)
    if (key !== undefined) return key
  }
  switch (e.kind) {
    case NODE.LITERAL:
      return literal(e, ctx)

    case NODE.PLACEHOLDER: {
      const known = ctx.params?.[e.index]
      const index = e.index
      // Unbound — a prepare — `?` reports a 16,383-character string, as 8.4.11 does.
      return { eval: (_row, env) => env.params[index] ?? null, type: known === undefined ? stringType(16383, ctx.connectionCollation, true) : typeOfValue(known) }
    }

    case NODE.COLUMN: {
      const { index, type, depth } = ctx.scope.resolve(e.parts, ctx.clause)
      if (depth !== undefined && depth > 0) {
        // A correlated reference: a column of an enclosing query's current row.
        const d = depth - 1
        return { eval: (_row, env) => env.outer?.[d]?.[index] ?? null, type }
      }
      return readSlot(index, type)
    }

    case NODE.SUBQUERY:
      if (e.quantifier !== undefined) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.quantifier, 1))
      return scalarSubquery(e, ctx)

    case NODE.VARIABLE:
      return variable(e, ctx)

    case NODE.UNARY:
      if (e.op === 'EXISTS' && e.operand.kind === NODE.SUBQUERY) return exists(e.operand, ctx)
      return unary(e.op, compile(e.operand, ctx), e.op === 'EXISTS', constantNode(e.operand) && e.operand, ctx)

    case NODE.BINARY:
      return binary(e.op, e.left, e.right, e.extra, ctx)

    case NODE.CALL:
      return call(e, ctx)

    case NODE.CASE:
      return caseExpr(e, ctx)

    case NODE.CAST:
      return cast(e, ctx)

    case NODE.CONVERT:
      return convertUsing(e, ctx)

    case NODE.MATCH:
      return matchAgainst(e, ctx)

    case NODE.COLLATE: {
      const inner = compile(e.expr, ctx)
      // A number or a temporal becomes text in the collation's own charset; NULL and bytes are binary's.
      const t = inner.type
      const charset = isText(t) || t.kind === 'null' ? charsetOfCollation(t.collationId) : t.kind === 'json' ? 'utf8mb4' : undefined
      const id = collateTo(e.collation, charset)
      return {
        eval: (row, env) => {
          const v = inner.eval(row, env)
          if (v === null) return null
          return id === CHARSET_BINARY ? bytesValue(valueBytes(v)) : stringValue(toText(v), id, COERCIBILITY.EXPLICIT)
        },
        decimalPrefix: true,
        type: { ...stringResultType(charWidth(t), id === CHARSET_BINARY, id, COERCIBILITY.EXPLICIT), coercibility: COERCIBILITY.EXPLICIT },
      }
    }

    case NODE.ROW:
      if (e.items.length === 1) return compile(e.items[0] as Expression, ctx)
      throw sqlError('ER_OPERAND_COLUMNS', 'Operand should contain 1 column(s)')

    default:
      throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`This expression (${e.kind})`))
  }
}

/** The result type a value would have as a literal: what `?` reports once its value is bound. */
function typeOfValue(v: Value): ResultType {
  if (v === null) return NULL_TYPE
  switch (v.kind) {
    case 'int':
      return intType(magnitudeDigits(v.v).length + (v.unsigned ? 0 : 1), false, v.unsigned)
    case 'decimal':
      return decimalType(magnitudeDigits(v.v).length, v.scale, false)
    case 'double':
      return doubleType(false, 23)
    case 'string':
      return stringType([...v.v].length, v.collationId, false)
    case 'bytes':
      return stringType(v.v.length, CHARSET_BINARY, false)
    case 'datetime':
      return datetimeType(v.type === 'DATE' ? FIELD_TYPE.DATE : v.type === 'TIMESTAMP' ? FIELD_TYPE.TIMESTAMP : FIELD_TYPE.DATETIME, v.fsp, false)
    case 'time':
      return datetimeType(FIELD_TYPE.TIME, v.fsp, false)
    case 'json':
      return jsonType(false)
  }
}

function literal(e: LiteralNode, ctx: CompileContext): Compiled {
  const explicit = e.collation !== undefined
  const coercibility = explicit ? COERCIBILITY.EXPLICIT : COERCIBILITY.COERCIBLE
  const stringLiteralType = (length: number, id: number): ResultType =>
    ({ ...stringType(length, id, explicit), coercibility })
  // A number or NULL with COLLATE is the COLLATE of it: text in that collation, or 1253 for NULL's binary.
  if (e.collation !== undefined && e.type !== LITERAL.STRING && e.type !== LITERAL.HEX && e.type !== LITERAL.BIT) {
    const { collation, ...bare } = e
    return compile({ kind: NODE.COLLATE, expr: bare as LiteralNode, collation, at: e.at }, ctx)
  }
  // A hex or bit literal is bytes, unless an introducer names their charset:
  // `_latin1 x'E9'` is the string 'é' (8.4.11).
  const introduced = (b: Uint8Array): Compiled => {
    if (e.charset === undefined && !explicit) {
      // As a number, as many digits as its largest value has, to 20.
      const digits = Math.min(20, String((1n << BigInt(8 * b.length)) - 1n).length)
      return lit({ kind: 'bytes', v: b, hex: true }, { ...stringLiteralType(b.length, CHARSET_BINARY), literalInt: { digits, unsigned: e.type === LITERAL.HEX } })
    }
    const id = introducerCollation(e, ctx)
    if (id === CHARSET_BINARY) return lit(bytesValue(b), stringLiteralType(b.length, id))
    const info = requireCollationInfo(id)
    const decode = (bytes: Uint8Array): string => {
      try {
        return decodeCollation(bytes, id)
      } catch {
        return '\uFFFD'
      }
    }
    // A single-byte charset takes any byte, one it cannot map being '?';
    // bytes that are no text in a multi-byte one are refused (8.4.11: 1300).
    const singleByte = info.mbmaxlen === 1
    const text = singleByte ? [...b].map((x) => decode(Uint8Array.of(x)).replace('\uFFFD', '?')).join('') : decode(b)
    if (!singleByte) {
      const back = encodeCollation(text, id)
      if (!equalBytes(back, b)) {
        throw sqlError('ER_INVALID_CHARACTER_STRING', `Invalid ${info.charset} character string: '${hexOf(b)}'`)
      }
    }
    return lit(stringValue(text, id, coercibility), stringLiteralType(singleByte ? b.length : [...text].length, id))
  }
  switch (e.type) {
    case LITERAL.INT: {
      const n = e.value as bigint
      const unsigned = n > (1n << 63n) - 1n
      return lit(intValue(n, unsigned), intType(n.toString().length + (unsigned ? 0 : 1), false, unsigned))
    }
    case LITERAL.DECIMAL: {
      const d = parseDecimal(e.value as string)
      const digits = magnitudeDigits(d.v).length
      return lit(d, decimalType(Math.max(digits, d.scale + 1), d.scale, false))
    }
    case LITERAL.DOUBLE:
      return lit(doubleValue(e.value as number), { ...doubleType(false, (e.text ?? String(e.value).replace('+', '')).length), literalDouble: true })
    case LITERAL.STRING: {
      const id = introducerCollation(e, ctx)
      let text = e.value as string
      if (id === CHARSET_BINARY) {
        const bytes = encodeCollation(text, ctx.connectionCollation)
        return lit(bytesValue(bytes), stringLiteralType(bytes.length, id))
      }
      // An introducer names the charset of the literal's bytes as sent:
      // `_latin1'é'` from a utf8mb4 client is the two latin1 characters of
      // é's two bytes, 'Ã©' (8.4.11).
      if (e.charset !== undefined && requireCollationInfo(id).charset !== requireCollationInfo(ctx.connectionCollation).charset) {
        try {
          text = decodeCollation(encodeCollation(text, ctx.connectionCollation), id)
        } catch {
          // Bytes that are no text in the named charset stay as written.
        }
      }
      // With COLLATE it is nullable, as 8.4.11 reports `'abc' COLLATE utf8mb4_bin`.
      return lit(stringValue(text, id, coercibility), { ...stringLiteralType([...text].length, id), literalText: text })
    }
    case LITERAL.HEX:
      return introduced(e.value as Uint8Array)
    case LITERAL.BIT: {
      const n = e.value as bigint
      const width = Math.ceil((e.text ?? n.toString(2)).length / 8)
      const out = new Uint8Array(width)
      let v = n
      for (let i = width - 1; i >= 0; i--) {
        out[i] = Number(v & 0xffn)
        v >>= 8n
      }
      return introduced(out)
    }
    case LITERAL.NULL:
      return lit(null, NULL_TYPE)
    case LITERAL.BOOL:
      return lit(bool(e.value as boolean), boolType(false))
    case LITERAL.TEMPORAL: {
      const text = e.value as string
      if (e.unit === 'TIME') {
        const t = parseTime(text)
        const micros = t === undefined ? 0n : timeOrdinal(t.v)
        // Typed literals cannot truncate or clamp; rounding can also cross the limit.
        if (t === undefined || t.truncated || t.clamped || micros < -3_020_399_000_000n || micros > 3_020_399_000_000n) {
          throw sqlError('ER_WRONG_VALUE', `Incorrect TIME value: '${text}'`)
        }
        return lit({ kind: 'time', v: t.v, fsp: t.fsp }, datetimeType(FIELD_TYPE.TIME, t.fsp, false))
      }
      // Under the session's zero-date modes: DATE '0000-00-00' is 1525 by default (8.4.11).
      const p = parseDateTime(text, modeOf(ctx.session.sqlMode))
      const type = e.unit === 'DATE' ? 'DATE' : 'DATETIME'
      if (p === undefined) throw sqlError('ER_WRONG_VALUE', `Incorrect ${type} value: '${text}'`)
      const v = toDateTime({ kind: 'datetime', v: p.v, type: 'DATETIME', fsp: p.fsp }, type)
      return lit(v ?? null, datetimeType(type === 'DATE' ? FIELD_TYPE.DATE : FIELD_TYPE.DATETIME, type === 'DATE' ? 0 : p.fsp, false))
    }
  }
}

/**
 * A COLLATE's collation, which must be one of `charset`'s, else 1253
 * (8.4.11: `'a' COLLATE latin1_bin` from a utf8mb4 client, and anything of
 * binary's). `utf8_` names `utf8mb3_`.
 */
function collateTo(name: string, charset?: string): number {
  const lower = name.toLowerCase()
  const info = collationInfoByName(lower.startsWith('utf8_') ? `utf8mb3_${lower.slice(5)}` : lower)
  if (info === undefined) throw sqlError('ER_UNKNOWN_COLLATION', messages.unknownCollation(name))
  if (charset !== undefined && info.charset !== charset) throw sqlError('ER_COLLATION_CHARSET_MISMATCH', `COLLATION '${name}' is not valid for CHARACTER SET '${charset}'`)
  return info.id
}

/** A string literal's collation: its `COLLATE`, else its introducer's charset default, else the connection's. */
function introducerCollation(e: LiteralNode, ctx: CompileContext): number {
  if (e.collation !== undefined) {
    // A hex or bit literal with no introducer is binary's.
    const cs = e.charset?.toLowerCase() ?? (e.type === LITERAL.STRING ? undefined : 'binary')
    return collateTo(e.collation, cs === undefined ? requireCollationInfo(ctx.connectionCollation).charset : cs === 'utf8' ? 'utf8mb3' : cs)
  }
  if (e.charset !== undefined) {
    const cs = e.charset.toLowerCase()
    if (cs === 'binary') return CHARSET_BINARY
    const def = defaultCollationOf(cs === 'utf8' ? 'utf8mb3' : cs)
    if (def === undefined) throw sqlError('ER_UNKNOWN_CHARACTER_SET', messages.unsupportedCharset(0))
    return def.id
  }
  return ctx.connectionCollation
}

/** Resolve identity once for compilation and command admission. */
export function systemVariable(node: VariableNode, state: SessionValues, session: Session) {
  if (node.user || !node.name.startsWith('@@')) return undefined
  const parts = node.parts ?? node.name.slice(2).split('.')
  const first = parts[0]?.toLowerCase()
  const qualified = parts.length > 1 && (first === 'global' || first === 'session' || first === 'local')
  const scope: 'GLOBAL' | 'SESSION' | undefined = !qualified ? undefined : first === 'global' ? 'GLOBAL' : 'SESSION'
  const name = parts.slice(qualified ? 1 : 0).join('.').toLowerCase()
  const value = state.systemVariable(name, scope, session)
  if (value === undefined) throw sqlError('ER_UNKNOWN_SYSTEM_VARIABLE', `Unknown system variable '${name}'`)
  return { name, scope, value }
}

function variable(node: VariableNode, ctx: CompileContext): Compiled {
  const ref = systemVariable(node, ctx.state, ctx.session)
  if (ref !== undefined) {
    const { name, scope, value } = ref
    return { eval: (_row, env) => env.state.systemVariable(name, scope, env.session) ?? null, type: typeOfSystemVariable(name, value, ctx) }
  }
  const key = node.name.slice(1).toLowerCase()
  // A user variable's text is IMPLICIT, whatever it was set from (8.4.11).
  return {
    eval: (_row, env) => {
      const v = env.state.userVariables.get(key) ?? null
      return v !== null && v.kind === 'string' && v.coercibility !== COERCIBILITY.IMPLICIT ? stringValue(v.v, v.collationId, COERCIBILITY.IMPLICIT) : v
    },
    type: typeOfUserVariable(ctx.state.userVariables.get(key), ctx),
  }
}

/** As 8.4.11 reports them: a string is 21,845 characters, an integer a BIGINT UNSIGNED, a boolean one of width 1. */
function typeOfSystemVariable(name: string, v: Value, ctx: CompileContext): ResultType {
  if (v === null || isTextValue(v)) return stringType(21845, ctx.connectionCollation, true)
  if (v.kind === 'int') return systemVariableInfo(name)?.kind === 'bool' ? intType(1, true) : intType(21, true, true)
  return { ...typeOfValue(v), nullable: true }
}

/** A user variable: a BIGINT, a LONGTEXT for a string, a binary string with a whole-character VARCHAR byte limit when unset. */
function typeOfUserVariable(v: Value | undefined, ctx: CompileContext): ResultType {
  if (v === undefined || v === null) {
    const width = v === null ? 16777215 : 65535 - 65535 % requireCollationInfo(ctx.connectionCollation).mbmaxlen
    return { ...stringResultType(width, true, CHARSET_BINARY, COERCIBILITY.IMPLICIT), coercibility: COERCIBILITY.IMPLICIT }
  }
  if (v.kind === 'string') return { ...stringType(67108860, ctx.connectionCollation, true), field: FIELD_TYPE.LONG_BLOB }
  if (v.kind === 'int') return intType(21, true, v.unsigned)
  return { ...typeOfValue(v), nullable: true }
}

/** `5 / 10^(D+1)` when a comparison is of doubles and both sides have fixed decimals. */
function fixedTolerance(a: ResultType, b: ResultType): number | undefined {
  if (!(a.kind === 'double' || b.kind === 'double') || !isNumber(a) || !isNumber(b) || a.scale >= 31 || b.scale >= 31) return undefined
  return 5 / 10 ** (Math.max(a.scale, b.scale) + 1)
}

/**
 * How two operands compare: as `compareValues` does, except that two sides
 * with fixed decimals compare as doubles within half a unit of the next
 * digit (`compare_real_fixed`): a FLOAT(5,2) holding 0.1 equals 0.1, and
 * so do `<=>`, BETWEEN, NULLIF and a one-element IN (8.4.11).
 */
export function comparer(a: ResultType, b: ResultType): (x: Value, y: Value) => number | null {
  if (a.kind === 'json' || b.kind === 'json') {
    const jsonOperand = (v: Value, t: ResultType): Value => v !== null && isBits(t) && v.kind === 'int' ? jsonValue({ t: 'opaque', field: FIELD_TYPE.BIT, v: bitBytes(v.v, t.length) }) : v
    return (x, y) => compareValues(jsonOperand(x, a), jsonOperand(y, b))
  }
  if ((a.kind === 'time' && isText(b)) || (b.kind === 'time' && isText(a))) {
    return (x, y) => {
      if (x === null || y === null) return null
      if (x.kind === 'time' && (y.kind === 'string' || y.kind === 'bytes')) x = stringValue(toText(x), CHARSET_UTF8MB4_BIN, COERCIBILITY.NUMERIC)
      if (y.kind === 'time' && (x.kind === 'string' || x.kind === 'bytes')) y = stringValue(toText(y), CHARSET_UTF8MB4_BIN, COERCIBILITY.NUMERIC)
      return compareValues(x, y)
    }
  }
  const tolerance = fixedTolerance(a, b)
  // Text against text: the collation and a constant's encoding decided once for the site, not once a row.
  if (tolerance === undefined && a.kind === 'string' && b.kind === 'string') return textComparer()
  if (tolerance === undefined) return compareValues
  return (x, y) => {
    if (x === null || y === null) return null
    const p = toDouble(x)
    const q = toDouble(y)
    return p === q || Math.abs(p - q) < tolerance ? 0 : p < q ? -1 : 1
  }
}

/**
 * A division with a fixed-decimal double: the larger scale plus
 * div_precision_increment's 4, and the dividend's integer part
 * (`Item_func_div::resolve_type`).
 */
function divisionDouble(a: ResultType, b: ResultType): ResultType {
  const fixed = fixedDouble([a, b], true)
  if (fixed === undefined) return doubleType(true, 23)
  const scale = Math.min(31, Math.max(a.scale, b.scale) + 4)
  if (scale >= 31) return doubleType(true, 23)
  const width = (a.kind === 'decimal' ? charWidth(a) : a.length) - a.scale + scale
  return { ...doubleType(true, Math.min(width, 17 + scale)), scale }
}

/** Division with NULL keeps a DOUBLE result, but still resolves its scale and width. */
function nullDivision(a: ResultType, b: ResultType): ResultType {
  const other = a.kind === 'null' ? b : a
  const scale = Math.min(31, (other.kind === 'null' ? 0 : fixedDecimals(other) ?? 31) + 4)
  if (scale === 31) return doubleType(true, 23)
  // NULL's width is its resolved scale. A non-NULL dividend gains four
  // characters; DATETIME uses its numeric display width, 17 + fsp (8.4.11).
  const width = a.kind === 'null' ? scale : (a.kind === 'datetime' && a.field !== FIELD_TYPE.DATE ? 17 + a.scale : charWidth(a)) + 4
  return { ...doubleType(true, width), scale }
}

function unary(op: string, a: Compiled, exists: boolean, constant: false | Expression = false, ctx?: CompileContext): Compiled {
  if (exists) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('EXISTS'))
  const at = a.eval
  switch (op) {
    case '-': {
      const t = a.type
      // Negating an unsigned value needs room for the sign it gains.
      // A hex literal negated is a double, as its string self is (8.4.11: 17 wide, 0 decimals).
      // A temporal negated is a double with its fractional digits, through its number (8.4.11: `-dt` of a DATETIME(3) is 20 wide, 3 decimals).
      if (t.kind === 'datetime' || t.kind === 'time') {
        const type = floatLength(t.scale, t.nullable)
        return { eval: (r, env) => { const v = a.eval(r, env); return v === null ? null : doubleOf(doubleValue(-toDouble(v)), type) }, type }
      }
      // A constant integer whose negation may not fit a BIGINT, a negative one or one past 2^63, is negated as a DECIMAL (8.4.11: `--1` is DECIMAL(1,0)).
      if (t.kind === 'int' && t.literalInt === undefined && constant !== false && ctx !== undefined) {
        const v = a.eval([], constantEnv(ctx))
        // Not the literal 2^63, whose negation is BIGINT's least, `-9223372036854775808`.
        const least = v !== null && v.kind === 'int' && v.v === 2n ** 63n && constant.kind === NODE.LITERAL
        if (v !== null && v.kind === 'int' && (v.v < 0n || v.v >= 2n ** 63n) && !least) {
          const type = decimalType(v.v.toString().replace('-', '').length, 0, t.nullable)
          return { eval: (r, env) => { const x = at(r, env); return x === null ? null : negate(toDecimal(x)) }, type }
        }
      }
      // A boolean's one character gains room for the sign; NULL negated is a DOUBLE (8.4.11: `-FALSE` is 2 wide, `-NULL` DOUBLE(17,0)).
      const type = t.literalInt !== undefined ? floatLength(0, t.nullable) : t.kind === 'int' ? intType(Math.max(2, t.length + (t.unsigned ? 1 : 0)), t.nullable) : t.kind === 'decimal' ? decimalType(t.length, t.scale, t.nullable) : t.kind === 'null' ? floatLength(0, true) : t.kind === 'double' ? floatLength(t.scale, t.nullable) : doubleType(t.nullable)
      const operand = asNumber(a, 'DOUBLE').eval
      if (type.kind === 'double' && type.scale < 31) return { eval: (r, env) => doubleOf(negate(operand(r, env)), type), type }
      return { eval: (r, env) => negate(operand(r, env)), type }
    }
    case '+':
      return a
    case '~': {
      const x = asNumber(a, 'INTEGER').eval
      return { eval: (r, env) => bitNot(x(r, env)), type: intType(21, a.type.nullable, true) }
    }
    case '!':
    case 'NOT': {
      const x = logicalOperand(a, constant, ctx)
      return { eval: (r, env) => not(x(r, env)), type: boolType(a.type.nullable) }
    }
    case 'BINARY':
      return {
        eval: (r, env) => {
          const v = at(r, env)
          return v === null ? null : v.kind === 'bytes' ? v : bytesValue(valueBytes(v))
        },
        type: { ...stringType(byteWidth(a.type), CHARSET_BINARY, true), coercibility: COERCIBILITY.IMPLICIT },
      }
    case 'IS NULL':
      return { eval: (r, env) => bool(at(r, env) === null), type: boolType(false) }
    case 'IS NOT NULL':
      return { eval: (r, env) => bool(at(r, env) !== null), type: boolType(false) }
    case 'IS TRUE':
      return { eval: (r, env) => bool(truth(at(r, env)) === true), type: boolType(false) }
    case 'IS NOT TRUE':
      return { eval: (r, env) => bool(truth(at(r, env)) !== true), type: boolType(false) }
    case 'IS FALSE':
      return { eval: (r, env) => bool(truth(at(r, env)) === false), type: boolType(false) }
    case 'IS NOT FALSE':
      return { eval: (r, env) => bool(truth(at(r, env)) !== false), type: boolType(false) }
    case 'IS UNKNOWN':
      return { eval: (r, env) => bool(truth(at(r, env)) === null), type: boolType(false) }
    case 'IS NOT UNKNOWN':
      return { eval: (r, env) => bool(truth(at(r, env)) !== null), type: boolType(false) }
    default:
      throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The operator ${op}`))
  }
}

const COMPARISONS: Readonly<Record<string, (c: number) => boolean>> = {
  '=': (c) => c === 0,
  '<>': (c) => c !== 0,
  '!=': (c) => c !== 0,
  '<': (c) => c < 0,
  '<=': (c) => c <= 0,
  '>': (c) => c > 0,
  '>=': (c) => c >= 0,
}

/**
 * The width an integer `+` or `-` reports: its operands' wider digit count,
 * one more for a carry, and one more for a sign unless the result is unsigned
 * — `ti + 0` on a TINYINT is 5, `age - flag` with an unsigned flag is 11.
 */
const arithWidth = (a: ResultType, b: ResultType, unsigned: boolean): number => Math.max(intDigits(a), intDigits(b), 1) + 1 + (unsigned ? 0 : 1)

/** Digits before the point, for a DECIMAL or an integer operand. */
function intDigits(t: ResultType): number {
  if (t.literalInt !== undefined) return t.literalInt.digits
  if (t.kind === 'decimal') return t.length - t.scale
  if (t.kind === 'int') return Math.max(1, t.unsigned ? t.length : t.length - 1)
  // A temporal's number: YYYYMMDD, hhhmmss, or both (8.4.11: `d * 20200102` is 17 wide).
  if (t.kind === 'datetime') return t.field === FIELD_TYPE.DATE ? 8 : 14
  if (t.kind === 'time') return 7
  return 0
}

/** Whether an operand is unsigned as a number: an unsigned type, or a hex literal. */
const unsignedOf = (t: ResultType): boolean => t.unsigned || t.literalInt?.unsigned === true

const scaleOf = (t: ResultType): number => (t.kind === 'decimal' || t.kind === 'datetime' || t.kind === 'time' ? t.scale : 0)

/**
 * `+`, `-`, `*` or `%` with NULL: a DOUBLE as wide as the other operand, with
 * its decimals — an integer's none, text's and a double's unspecified, a
 * temporal's fraction (8.4.11: `NULL * de` of a DECIMAL(6,2) is DOUBLE(8,2), `NULL + dt` 23 wide with 3).
 */
function nullArithmetic(a: ResultType, b: ResultType): ResultType {
  const other = a.kind === 'null' ? b : a
  if (other.kind === 'null') return { ...doubleType(true, 0), scale: 0 }
  if (other.kind === 'int') return { ...doubleType(true, other.length), scale: 0 }
  if (other.kind === 'decimal') return { ...doubleType(true, charWidth(other)), scale: other.scale }
  if (other.kind === 'datetime' || other.kind === 'time') return { ...doubleType(true, 23), scale: other.scale }
  return doubleType(true, 23)
}

/** The numeric kind an arithmetic operator yields, chosen before evaluation as MySQL chooses it. */
function arithKind(a: ResultType, b: ResultType): 'int' | 'decimal' | 'double' | 'null' {
  if (a.kind === 'null' || b.kind === 'null') return 'null'
  const k = (t: ResultType): 'int' | 'decimal' | 'double' =>
    t.kind === 'int' || t.literalInt !== undefined ? 'int' : t.kind === 'decimal' ? 'decimal' : t.kind === 'datetime' || t.kind === 'time' ? (t.scale > 0 ? 'decimal' : 'int') : 'double'
  const x = k(a)
  const y = k(b)
  return x === 'double' || y === 'double' ? 'double' : x === 'decimal' || y === 'decimal' ? 'decimal' : 'int'
}

function binary(op: string, left: Expression, right: Expression, extra: Expression | readonly Expression[] | undefined, ctx: CompileContext): Compiled {
  // `d + INTERVAL n unit`, `INTERVAL n unit + d` and `d - INTERVAL n unit` (M5.10).
  if (op === '+' && isInterval(right)) return dateAdd(left, right.value, right.unit, false, ctx)
  if (op === '+' && isInterval(left)) return dateAdd(right, left.value, left.unit, false, ctx)
  if (op === '-' && isInterval(right)) return dateAdd(left, right.value, right.unit, true, ctx)
  if (op === 'IN' || op === 'NOT IN') return inList(op === 'NOT IN', left, right, ctx)
  if (op === 'MEMBER OF') return memberOf(compile(left, ctx), compile(right, ctx))
  // `a REGEXP p` is REGEXP_LIKE(a, p), and `RLIKE` is its other spelling.
  if (op === 'REGEXP' || op === 'RLIKE' || op === 'NOT REGEXP' || op === 'NOT RLIKE') {
    const a = compile(left, ctx)
    const p = compile(right, ctx)
    if (a.type.kind === 'string' && p.type.kind === 'string') aggregateCollations([a.type, p.type], 'regexp_like', true)
    const negated = op.startsWith('NOT')
    return {
      eval: (r, env) => {
        const m = regexpLike(a.eval(r, env), p.eval(r, env), undefined)
        return m === null ? null : bool(m !== negated)
      },
      type: boolType(!notNull(a.type, p.type)),
    }
  }
  // `c->'$.p'` is JSON_EXTRACT(c, '$.p'); `c->>'$.p'` unquotes it too.
  if (op === '->' || op === '->>') {
    const extracted = jsonPathFunction('JSON_EXTRACT', [compile(left, ctx), compile(right, ctx)], 'json_extract')
    return op === '->' ? extracted : unquote(extracted)
  }
  if (right.kind === NODE.SUBQUERY && right.quantifier !== undefined && COMPARISONS[op] !== undefined) return quantified(op, right.quantifier === 'ALL' ? 'ALL' : 'ANY', left, right, ctx)
  if ((COMPARISONS[op] !== undefined || op === '<=>') && (isRow(left) || isRow(right))) return rowComparison(op, left, right, ctx)
  const a = compile(left, ctx)
  if (op === 'BETWEEN' || op === 'NOT BETWEEN') {
    const a0 = a
    const lower = compile(right, ctx)
    const upper = compile(extra as Expression, ctx)
    const numeric = [a0, lower, upper].some((x) => isNumber(x.type))
    if (numeric && left.kind === NODE.COLUMN) {
      columnConstantDiagnostics(lower, right, a0, left, ctx)
      columnConstantDiagnostics(upper, extra as Expression, a0, left, ctx)
    }
    const hasDate = [a0, lower, upper].some((x) => x.type.kind === 'datetime')
    const lo0 = numeric || hasDate ? lower : timeConstant(a0, left, right, lower, false, ctx)
    const hi0 = numeric || hasDate ? upper : timeConstant(a0, left, extra as Expression, upper, false, ctx)
    // One comparison type for all three (`agg_cmp_type`): integers and
    // decimals stay exact; a number mixed with text or a temporal uses
    // doubles. With only dates and text, all are dates.
    const all = [a0, lo0, hi0]
    const exact = all.every((x) => x.type.kind === 'int' || x.type.kind === 'decimal' || x.type.kind === 'null')
    const json = all.some((x) => x.type.kind === 'json')
    if (json) warnAtCompile(ctx, 1235, "This version of MySQL doesn't yet support 'comparison of JSON in the BETWEEN operator'")
    const dateOf = all.find((x) => x.type.kind === 'datetime')
    const dated = !numeric && dateOf !== undefined
    const operand = (x: Compiled, written: Expression | false): Compiled => {
      // A constant bound warns each row it is compared, unlike `=`'s once (8.4.11: `tm BETWEEN 'a' AND db` warns for every row).
      if (numeric) {
        if (exact) return x
        const checked = a0.type.field === FIELD_TYPE.LONGLONG && left.kind === NODE.COLUMN && written !== false ? numberConstant(x, written, ctx, true) : asNumber(x, 'DOUBLE')
        return { eval: (r, env) => { const v = checked.eval(r, env); return v === null ? null : doubleValue(toDouble(v)) }, type: x.type }
      }
      if (dated && x.type.kind === 'time') return onStatementDate(x)
      const text = x.type.kind === 'json' ? comparisonText(x) : x
      if (dated && isText(text.type) && written !== false) return dateConstant(text, written, dateOf as Compiled, ctx, false)
      return !dated ? comparisonText(text) : text
    }
    const subject = operand(a0, left)
    const lo = operand(lo0, right)
    const hi = operand(hi0, extra as Expression)
    const negated = op === 'NOT BETWEEN'
    if (isText(a0.type) && isText(lo0.type) && isText(hi0.type)) aggregateCollations([a0.type, lo0.type, hi0.type], 'between', true)
    // Each bound is its own comparison, fixed decimals and all.
    const low = comparer(subject.type, lo.type)
    const high = comparer(subject.type, hi.type)
    const timeColumn = !numeric && !dated && a0.type.kind === 'time' && left.kind === NODE.COLUMN
    const intLo = asNumber(lo0, 'INTEGER')
    const intHi = asNumber(hi0, 'INTEGER')
    return {
      eval: (r, env) => {
        const v = subject.eval(r, env)
        if (v === null) return null
        if (timeColumn) {
          const lowerValue = lo0.eval(r, env)
          const upperValue = hi0.eval(r, env)
          const convertedLo = lo0 !== lower && lowerValue?.kind === 'time'
          const convertedHi = hi0 !== upper && upperValue?.kind === 'time'
          // A single converted TIME bound switches the server to val_int.
          // The replacement constant returns its packed integer; the TIME
          // column and unconverted bound return their ordinary integers.
          if ((convertedLo || convertedHi) && !(lowerValue?.kind === 'time' && upperValue?.kind === 'time')) {
            const integer = (w: Value): Value => w === null ? null : intValue(toInteger(w))
            const bound = (w: Value, converted: boolean): Value => converted && w?.kind === 'time' ? intValue(packTime(roundTime(w.v, a0.type.scale))) : integer(w)
            const subjectValue = integer(a0.eval(r, env))
            const x = compareValues(subjectValue, bound(intLo.eval(r, env), convertedLo))
            const y = compareValues(subjectValue, bound(intHi.eval(r, env), convertedHi))
            if ((x !== null && x < 0) || (y !== null && y > 0)) return bool(negated)
            return x === null || y === null ? null : bool(!negated)
          }
        }
        const x = low(v, lo.eval(r, env))
        const y = high(dated ? subject.eval(r, env) : v, hi.eval(r, env))
        // Three-valued: a known failure on either side decides it.
        if ((x !== null && x < 0) || (y !== null && y > 0)) return bool(negated)
        if (x === null || y === null) return null
        return bool(!negated)
      },
      type: boolType(!notNull(a.type, lo.type, hi.type)),
    }
  }
  if (op === 'LIKE' || op === 'NOT LIKE') return like(op === 'NOT LIKE', a, compile(right, ctx), extra === undefined ? undefined : compile(extra as Expression, ctx))

  const b = compile(right, ctx)
  const [ta, tb] = COMPARISONS[op] !== undefined || op === '<=>' ? temporalOperands(left, right, a, b, ctx) : [a, b]
  // A string constant compared with a date is read as one first, and one
  // that is not is the statement's error (8.4.11: `d = '00-00-00'` is 1525).
  const dated = COMPARISONS[op] !== undefined || op === '<=>'
  const ca = dated ? numberBesideDate(yearConstant(dateConstant(ta, left, tb, ctx), left, tb, ctx), left, tb, right, ctx) : ta
  const cb = dated ? numberBesideDate(yearConstant(dateConstant(tb, right, ta, ctx), right, ta, ctx), right, ta, left, ctx) : tb
  // A string in arithmetic is read as a double, with 1292 when it is not one.
  const arithmetic = op === '+' || op === '-' || op === '*' || op === '/' || op === '%' || op === 'MOD'
  // And in a comparison with a number, which is of doubles: a constant is
  // converted once a statement (`cache_converted_constant`), a column each row.
  const comparison = (COMPARISONS[op] !== undefined || op === '<=>') && (textVersusNumber(ca.type, cb.type) || textVersusNumber(cb.type, ca.type))
  // A logical operator reads its operands' truth as doubles, and a string that is not one warns as it would there.
  const logical = op === 'AND' || op === '&&' || op === 'OR' || op === '||' || op === 'XOR'
  const at = logical ? logicalOperand(ca, left, ctx) : comparison ? numberConstant(ca, left, ctx).eval : arithmetic ? asNumber(ca, 'DOUBLE').eval : ca.eval
  const bt = logical ? logicalOperand(cb, right, ctx) : comparison ? numberConstant(cb, right, ctx).eval : arithmetic ? asNumber(cb, 'DOUBLE').eval : cb.eval
  const nullable = !notNull(a.type, b.type)
  // What an overflow names, as MySQL's message does: the expression's text.
  // Printed only for an error's message: the printing compiles the columns it names.
  let printed: string | undefined
  const label = (): string => (printed ??= printedArgument({ kind: NODE.BINARY, op, left, right, at: left.at }, ctx))
  if (dated && isText(ca.type) && isText(cb.type)) aggregateCollations([ca.type, cb.type], op === '!=' ? '<>' : op, true)

  switch (op) {
    case 'AND':
    case '&&':
      return {
        eval: (r, env) => {
          const x = truth(at(r, env))
          if (x === false) return bool(false)
          const y = truth(bt(r, env))
          if (y === false) return bool(false)
          return x === null || y === null ? null : bool(true)
        },
        type: boolType(nullable),
      }
    case 'OR':
    case '||':
      return {
        eval: (r, env) => {
          const x = truth(at(r, env))
          if (x === true) return bool(true)
          const y = truth(bt(r, env))
          if (y === true) return bool(true)
          return x === null || y === null ? null : bool(false)
        },
        type: boolType(nullable),
      }
    case 'XOR':
      return {
        eval: (r, env) => {
          const x = truth(at(r, env))
          const y = truth(bt(r, env))
          return x === null || y === null ? null : bool(x !== y)
        },
        type: boolType(nullable),
      }
    case '<=>': {
      const tolerance = fixedTolerance(a.type, b.type)
      if (tolerance !== undefined) {
        const cmp = comparer(a.type, b.type)
        return {
          eval: (r, env) => {
            const x = at(r, env)
            const y = bt(r, env)
            return bool(x === null || y === null ? x === y : cmp(x, y) === 0)
          },
          type: boolType(false),
        }
      }
      return { eval: (r, env) => {
        const x = at(r, env)
        const y = bt(r, env)
        if (comparison && x !== null && y === null) at(r, env)
        return bool(nullSafeEqual(x, y))
      }, type: boolType(false) }
    }
    case '+':
    case '-':
    case '*': {
      const kind = arithKind(a.type, b.type)
      let type: ResultType
      const unsigned = unsignedOf(a.type) || unsignedOf(b.type)
      if (kind === 'int') type = intType(op === '*' ? intDigits(a.type) + intDigits(b.type) + (unsigned ? 0 : 1) : arithWidth(a.type, b.type, unsigned), nullable, unsigned)
      else if (kind === 'decimal') {
        const s = op === '*' ? scaleOf(a.type) + scaleOf(b.type) : Math.max(scaleOf(a.type), scaleOf(b.type))
        const digits = op === '*' ? intDigits(a.type) + intDigits(b.type) : Math.max(intDigits(a.type), intDigits(b.type)) + 1
        // A DECIMAL result is unsigned only when both sides are; an integer
        // one when either is (`Item_func_*::result_precision`).
        type = decimalType(digits + s, s, nullable, unsignedOf(a.type) && unsignedOf(b.type))
      } else if (kind === 'double') type = fixedDouble([a.type, b.type], nullable) ?? doubleType(nullable, 23)
      else type = nullArithmetic(a.type, b.type)
      if (type.kind === 'double' && type.scale < 31) {
        const fixed = type
        return { eval: (r, env) => doubleOf(add(at(r, env), bt(r, env), op, label), fixed), type }
      }
      return { eval: (r, env) => add(at(r, env), bt(r, env), op, label), type }
    }
    case '/': {
      const kind = arithKind(a.type, b.type)
      const s = Math.min(30, scaleOf(a.type) + 4)
      // NULL still inherits the other operand's numeric scale. Text and
      // unspecified doubles produce DOUBLE(23,31); fixed decimals add four.
      const type = kind === 'double' ? divisionDouble(a.type, b.type) : kind === 'null' ? nullDivision(a.type, b.type) : decimalType(intDigits(a.type) + scaleOf(b.type) + s, s, true, unsignedOf(a.type) && unsignedOf(b.type))
      const quotient = byZero(at, bt, (p, q) => divide(p, q, label))
      if (type.kind === 'double' && type.scale < 31) return { eval: (r, env) => doubleOf(quotient(r, env), type), type }
      return { eval: quotient, type }
    }
    case 'DIV': {
      // Digits: the dividend's integer digits and the divisor's decimals, or
      // all its digits when it has no fixed decimals, at most 21, and a sign
      // unless either is unsigned (`Item_func_div_int::result_precision`; 8.4.11:
      // `bi DIV vc` of a BIGINT and a VARCHAR(20) is 22, `yr DIV lt` 14).
      const unsigned = unsignedOf(a.type) || unsignedOf(b.type)
      const divisor = fixedDecimals(b.type) ?? decimalPrecision(b.type)
      // DIV fields are at least one character, including unsigned NULL results.
      const width = Math.max(1, Math.min(decimalPrecision(a.type) - (fixedDecimals(a.type) ?? 0) + divisor, 21) + (unsigned ? 0 : 1))
      // Its operands are read as DECIMALs, text warning each row (8.4.11: `lt DIV 10`).
      const x = asNumber(ca, 'DECIMAL').eval
      const y = asNumber(cb, 'DECIMAL').eval
      const decimal = a.type.kind !== 'int' || b.type.kind !== 'int'
      return { eval: byZero(x, y, (p, q, env) => {
        try { return intDivide(p, q, label) }
        catch (error) {
          if (decimal && error instanceof ValueError && error.integer !== undefined) {
            try { truncated(env, 'DECIMAL', String(error.integer)) }
            catch (primary) {
              if (promotedError(env.conditions, primary)) raise(env, error.errno!, error.message, 'Error')
              throw primary
            }
          }
          throw error
        }
      }, true), type: intType(width, true, unsigned) }
    }
    case '%':
    case 'MOD': {
      const kind = arithKind(a.type, b.type)
      // The wider operand's digits and a sign, unsigned or not: `flag % 3` on a TINYINT UNSIGNED is 4.
      // A double keeps the dividend's sign flag (8.4.11: `u % ch` of an INT UNSIGNED is unsigned).
      const type = kind === 'int' ? intType(Math.max(intDigits(a.type), intDigits(b.type), 1) + 1, true, unsignedOf(a.type)) : kind === 'decimal' ? decimalType(Math.max(decimalPrecision(a.type), decimalPrecision(b.type)), Math.max(scaleOf(a.type), scaleOf(b.type)), true) : kind === 'null' ? nullArithmetic(a.type, b.type) : { ...doubleType(true, 23), unsigned: unsignedOf(a.type) }
      return { eval: byZero(at, bt, (x, y) => modulo(x, y, label)), type }
    }
    case '|':
    case '&':
    case '^':
    case '<<':
    case '>>': {
      // Text is read as an unsigned integer, warning as it goes.
      const x = asNumber(ca, 'INTEGER').eval
      const y = asNumber(cb, 'INTEGER').eval
      return { eval: (r, env) => bitwise(x(r, env), y(r, env), op), type: intType(21, nullable, true) }
    }
    default: {
      const test = COMPARISONS[op]
      if (test === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The operator ${op}`))
      const cmp = comparer(a.type, b.type)
      return {
        // The right side is not read when the left is NULL, so its conversion
        // does not warn (8.4.11's comparators look at the left first).
        eval: (r, env) => {
          const x = at(r, env)
          if (x === null) return null
          const c = cmp(x, bt(r, env))
          return c === null ? null : bool(test(c))
        },
        type: boolType(nullable),
      }
    }
  }
}

// --- Constants -------------------------------------------------------------------

/** The STRING comparison context renders temporals and JSON instead of comparing their native values. */
function comparisonText(c: Compiled): Compiled {
  if (c.type.kind !== 'json' && c.type.kind !== 'time' && c.type.kind !== 'datetime') return c
  return {
    eval: (r, env) => {
      const v = c.eval(r, env)
      return v === null ? null : stringValue(toText(v), CHARSET_UTF8MB4_BIN, COERCIBILITY.NUMERIC)
    },
    type: { ...c.type, kind: 'string', collationId: CHARSET_UTF8MB4_BIN },
  }
}

/** cmp_item_datetime's TIME reader keeps a parsed datetime's date in its packed comparison. */
function comparisonTime(c: Compiled, preserveDate = true): Compiled {
  return {
    type: c.type,
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v === null || v.kind === 'time') return v
      const text = toText(v)
      const p = parseTime(text)
      if (p === undefined || p.truncated || p.clamped) truncated(env, 'time', warnedText(v))
      if (preserveDate && p?.dateDropped) {
        const d = parseDateTime(text)
        if (d !== undefined) return { kind: 'datetime', v: d.v, type: 'DATETIME', fsp: d.fsp }
      }
      return p === undefined ? { ...NO_TIME } : { kind: 'time', v: p.v, fsp: p.fsp }
    },
  }
}

/** Statement-fixed inputs; a proved local read may permit its own row/aggregate inputs. */
export function constantNode(e: unknown, parameters = true, rowInputs = false): boolean {
  return !someNode(e, (value) => {
    const n = value as { kind?: unknown; name?: unknown; over?: unknown }
    if ((!rowInputs && n.kind === NODE.COLUMN) || n.kind === NODE.SUBQUERY || n.kind === NODE.VARIABLE || (!parameters && n.kind === NODE.PLACEHOLDER)) return true
    if (n.kind === NODE.CALL) {
      const name = String(n.name).toUpperCase()
      if (n.over !== undefined || VARIES_PER_EVALUATION.has(name) || (!rowInputs && (AGGREGATE_NAMES.has(name) || name === 'GROUPING'))) return true
    }
    return undefined
  })
}

// --- TIME against DATETIME --------------------------------------------------------

/**
 * A TIME compared with a DATETIME, as 8.4.11 compares them. A constant
 * against a TIME column is converted to the column's type
 * (`convert_constant_item`), so its date is dropped: Prisma binds a TIME as
 * a DATETIME on 1970-01-01, and \`tm = ?\` must find the row. Anything else
 * meets as DATETIME, the TIME added to the statement's date, as CURDATE has it.
 */
export function temporalOperands(left: Expression, right: Expression, a: Compiled, b: Compiled, ctx?: CompileContext): [Compiled, Compiled] {
  const ak = a.type.kind
  const bk = b.type.kind
  const yearDate = (c: Compiled): Compiled => ({
    type: c.type,
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v === null) return null
      const year = Number(toInteger(v))
      return { kind: 'datetime', type: 'DATE', fsp: 0, v: { year, month: year === 0 ? 0 : 1, day: year === 0 ? 0 : 1, hour: 0, minute: 0, second: 0, microsecond: 0 } }
    },
  })
  if (a.type.field === FIELD_TYPE.YEAR && bk === 'datetime') return [yearDate(a), b]
  if (b.type.field === FIELD_TYPE.YEAR && ak === 'datetime') return [a, yearDate(b)]
  // A string constant too: `tm = '1970-01-01 14:37:36'` finds 14:37:36.
  if (ak === 'time' && left.kind === NODE.COLUMN && constantNode(right) && (bk === 'datetime' || bk === 'string' || bk === 'bytes' || bk === 'int')) return [a, asTimeOfDay(b, left.parts, false, ctx)]
  if (bk === 'time' && right.kind === NODE.COLUMN && constantNode(left) && (ak === 'datetime' || ak === 'string' || ak === 'bytes' || ak === 'int')) return [asTimeOfDay(a, right.parts, false, ctx), b]
  if (!((ak === 'time' && bk === 'datetime') || (ak === 'datetime' && bk === 'time'))) return [a, b]
  return ak === 'time' ? [onStatementDate(a), b] : [a, onStatementDate(b)]
}

function asTimeOfDay(c: Compiled, column: readonly string[], list = false, ctx?: CompileContext): Compiled {
  const self: Compiled = {
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v === null || v.kind === 'time') return v
      // A datetime keeps its time of day; text is read as `str_to_time`
      // reads it, a datetime written out included ('1970-01-01 14:37' is
      // 14:37:00, '2020-01-01' is 00:20:20), and a number of 11 digits or
      // more as a datetime (8.4.11).
      if (isTextValue(v)) {
        // A failed conversion keeps the text for ordinary comparisons.
        // In a constant TIME list it prevents building the list, represented
        // by NO_TIME; the conversion warns once as storing into the column does.
        if (toText(v).trim() === '') return list ? NO_TIME : v
        const p = parseTime(toText(v))
        // str_to_time rejects exponent forms without setting a truncation
        // warning; Field_time's failed constant conversion is quiet too.
        if (p === undefined && numericPrefix(toText(v)).complete && /[eE]/.test(toText(v))) return list ? NO_TIME : v
        if (p !== undefined && !p.truncated) {
          if (p.dateDropped && env.memo?.has(self) !== true) {
            env.memo?.set(self, true)
            raise(env, 1292, `Incorrect time value: '${toText(v)}' for column '${column[column.length - 1] as string}' at row 1`, 'Note')
          }
          return { kind: 'time', v: p.v, fsp: p.fsp }
        }
        if (env.memo?.has(self) !== true) {
          env.memo?.set(self, true)
          raise(env, 1292, `Incorrect time value: '${toText(v)}' for column '${column[column.length - 1] as string}' at row 1`)
        }
        return list ? NO_TIME : v
      }
      const dt = v.kind === 'datetime' ? v : v.kind === 'int' && v.v >= 10_000_000_000n ? toDateTime(v, 'DATETIME') : undefined
      const parsed = dt === undefined ? parseTime(toText(v)) : undefined
      let t: ReturnType<typeof toTime>
      if (dt !== undefined) t = toTime(dt)
      else if (parsed !== undefined && !parsed.truncated && !parsed.clamped) t = { kind: 'time', v: parsed.v, fsp: parsed.fsp }
      // A number that is no time says so once, as storing it into the column would (8.4.11: `tm <= 20200102`).
      if (t === undefined && v.kind === 'int' && env.memo?.has(self) !== true) {
        env.memo?.set(self, true)
        raise(env, 1292, `Incorrect time value: '${toText(v)}' for column '${column[column.length - 1] as string}' at row 1`)
      }
      if (dt !== undefined && v.kind === 'int' && env.memo?.has(self) !== true) {
        env.memo?.set(self, true)
        raise(env, 1292, `Incorrect time value: '${toText(v)}' for column '${column[column.length - 1] as string}' at row 1`, 'Note')
      }
      return t ?? v
    },
    type: c.type,
  }
  return ctx === undefined ? self : resolveConstant(self, ctx)
}

/** The session's NO_ZERO_DATE and NO_ZERO_IN_DATE, as a scan's flags. */
/** A string constant compared with a date or datetime: that, or 1292 and then 1525. */
/**
 * `c`, text compared with the date or datetime `other`, read as one first: a
 * constant once, as a date or 1525; a column's each row, as a date or, with
 * 1292, the zero date (8.4.11: `dt > ch` with ch 'b' is 1). Otherwise `c`.
 */
export function dateConstant(c: Compiled, written: Expression, other: Compiled, ctx: CompileContext, strict = true): Compiled {
  const convert = dateConverter(c, written, other, ctx, strict)
  return convert === undefined ? c : { eval: (r, env) => convert(c.eval(r, env), env), type: c.type }
}

/**
 * `dateConstant`'s conversion of one value, for a caller that keeps the value
 * itself too (NULLIF returns it unconverted). A constant that is no date is
 * 1525 when the statement is prepared, rows or none (8.4.11: under `WHERE
 * NULL` too) — unless not `strict`, as in BETWEEN, where it is the zero date
 * with 1292 each row, as a column's text is.
 */
export function dateConverter(c: Compiled, written: Expression, other: Compiled, ctx: CompileContext, strict = true): ((v: Value, env: Env) => Value) | undefined {
  if (other.type.kind !== 'datetime' || !isText(c.type)) return undefined
  const flags = modeOf(ctx.session.sqlMode)
  const constant = strict && constantNode(written)
  let notedAtCompile = false
  const what = other.type.field === FIELD_TYPE.DATE || other.type.field === FIELD_TYPE.NEWDATE ? 'date' : 'datetime'
  if (constant && (written.kind !== NODE.PLACEHOLDER || ctx.params !== undefined)) {
    let v: Value = null
    try {
      v = c.eval([], constantEnv(ctx))
    } catch (e) {
      expectTyped(e)
    }
    if (isTextValue(v)) {
      const p = parseDateTime(toText(v), flags)
      if (p === undefined) throw sqlError('ER_WRONG_VALUE', `Incorrect ${what.toUpperCase()} value: '${warnedText(v)}'`)
      if (p.deprecation !== undefined) {
        const { code, message } = temporalDeprecation(p.deprecation, toText(v), 1)
        warnAtCompile(ctx, code, message)
        notedAtCompile = true
      }
    }
  }
  return (v, env) => {
    // Text or bytes, a hex or bit literal's included (8.4.11: `d <= b'1010'` is 1525).
    if (!isTextValue(v)) return v
    const p = parseDateTime(toText(v), flags)
    if (p !== undefined) {
      if (p.deprecation !== undefined && !notedAtCompile && (!constant || env.memo?.has(written) !== true)) {
        const { code, message } = temporalDeprecation(p.deprecation, toText(v), rowNumber(env))
        raise(env, code, message)
        if (constant) env.memo?.set(written, true)
      }
      return { kind: 'datetime', v: p.v, type: p.hasTime ? 'DATETIME' : 'DATE', fsp: p.fsp }
    }
    if (!constant) {
      // Beside a column the conversion says so plainly; beside a literal or an expression it is "truncated", in that one's own word (8.4.11).
      if (other.type.column !== undefined) raise(env, 1292, `Incorrect datetime value: '${warnedText(v)}'`)
      else truncated(env, what, warnedText(v))
      return ZERO_DATETIME
    }
    truncated(env, what, warnedText(v))
    throw sqlError('ER_WRONG_VALUE', `Incorrect ${what.toUpperCase()} value: '${warnedText(v)}'`)
  }
}

const ZERO_DATETIME: Value = { kind: 'datetime', v: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 }, type: 'DATETIME', fsp: 0 }

/**
 * `c`, a number constant compared with a DATE, DATETIME or TIMESTAMP column:
 * converted into the column's type to compare, and when it is no such value,
 * 1292 once a statement, naming the column, at row 1, as storing it into the
 * column says (8.4.11: `dt = 10`, `1e300 >= dt`). An invalid constant
 * retains its numeric value for the comparison.
 */
function numberBesideDate(c: Compiled, written: Expression, other: Compiled, otherWritten: Expression, ctx?: CompileContext): Compiled {
  if (other.type.kind !== 'datetime' || otherWritten.kind !== NODE.COLUMN || !isNumber(c.type) || !constantNode(written)) return c
  const what = other.type.field === FIELD_TYPE.DATE || other.type.field === FIELD_TYPE.NEWDATE ? 'date' : 'datetime'
  const column = otherWritten.parts[otherWritten.parts.length - 1] as string
  const key = written
  const self: Compiled = {
    type: c.type,
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v !== null && env.memo?.has(key) !== true) {
        env.memo?.set(key, true)
        const whole = v.kind === 'double' ? (Number.isInteger(v.v) && Math.abs(v.v) < 1e15 ? BigInt(v.v) : undefined) : v.kind === 'int' ? v.v : v.kind === 'decimal' ? toInteger(v) : undefined
        if (whole === undefined || numberToDateTime(whole) === undefined) raise(env, 1292, `Incorrect ${what} value: '${toText(v)}' for column '${column}' at row 1`)
        else if (what === 'date') {
          const t = toDateTime(v, 'DATETIME')
          if (t !== undefined && (t.v.hour !== 0 || t.v.minute !== 0 || t.v.second !== 0 || t.v.microsecond !== 0)) raise(env, 1292, `Incorrect date value: '${toText(v)}' for column '${column}' at row 1`, 'Note')
        }
      }
      return v === null ? null : toDateTime(v, what === 'date' ? 'DATE' : 'DATETIME') ?? v
    },
  }
  return ctx === undefined ? self : resolveConstant(self, ctx)
}

export function columnConstantDiagnostics(c: Compiled, written: Expression, other: Compiled, column: Expression, ctx: CompileContext): void {
  if (column.kind !== NODE.COLUMN || !constantNode(written) || (written.kind === NODE.PLACEHOLDER && ctx.params === undefined)) return
  if (other.type.kind === 'time') { asTimeOfDay(c, column.parts, false, ctx); return }
  if (other.type.kind !== 'datetime') return
  if (isNumber(c.type)) { numberBesideDate(c, written, other, column, ctx); return }
  const v = c.eval([], constantEnv(ctx))
  if (v !== null && isText(c.type) && toDateTime(v, 'DATETIME') === undefined) warnAtCompile(ctx, 1292, `Incorrect ${other.type.field === FIELD_TYPE.DATE ? 'date' : 'datetime'} value: '${warnedText(v)}' for column '${column.parts.at(-1) as string}' at row 1`)
}

/**
 * `c`, a text constant compared with a YEAR column, as the YEAR it would be
 * stored as, once: two digits are 2000 to 2069 or 1970 to 1999, `'0'` is 2000
 * (8.4.11: `y > '10:11:12'` compares with 2010). Text with no leading number
 * is left to compare as a double.
 */
function yearConstant(c: Compiled, written: Expression, other: Compiled, ctx: CompileContext): Compiled {
  if (other.type.field !== FIELD_TYPE.YEAR || other.type.column === undefined || !isText(c.type) || !constantNode(written)) return c
  if (written.kind === NODE.PLACEHOLDER && ctx.params === undefined) return c
  let v: Value = null
  try {
    v = c.eval([], constantEnv(ctx))
  } catch (e) {
    expectTyped(e)
    return c
  }
  if (!isTextValue(v)) return c
  const text = toText(v)
  if (!/^\s*[+-]?(\d|\.\d)/.test(text)) return c
  const n = Math.trunc(Number(numericPrefix(text).text))
  const year = n >= 0 && n < 70 ? 2000 + n : n >= 70 && n < 100 ? 1900 + n : n
  return lit(intValue(BigInt(year)), { ...intType(4, false, true), field: FIELD_TYPE.YEAR })
}

/** A constant compared with a TIME column, read as a time of day. */
const NO_TIME = { kind: 'time', v: { negative: true, days: 41, hour: 23, minute: 59, second: 59, microsecond: 999999 }, fsp: 0 } as const satisfies Value

function timeConstant(a: Compiled, left: Expression, e: Expression, c: Compiled, list = false, ctx?: CompileContext): Compiled {
  // In an IN list a TIMESTAMP literal compares as a datetime, the column on
  // today's date; a CAST to one is still read as a time of day (8.4.11).
  const kinds = (c.type.kind === 'datetime' && !(list && e.kind === NODE.LITERAL)) || c.type.kind === 'string' || c.type.kind === 'bytes' || c.type.kind === 'int'
  return a.type.kind === 'time' && left.kind === NODE.COLUMN && constantNode(e) && kinds ? asTimeOfDay(c, left.parts, list, ctx) : c
}

export function onStatementDate(c: Compiled): Compiled {
  return {
    eval: (r, env) => {
      const v = c.eval(r, env)
      if (v === null || v.kind !== 'time') return v
      const anchored = dateOf(v, {}, () => clock(env.now, 0))
      return anchored.v === null ? null : { kind: 'datetime', v: anchored.v, type: 'DATETIME', fsp: v.fsp }
    },
    type: c.type,
  }
}

// --- row constructors ------------------------------------------------------------

/** A row constructor of more than one value: `(a, b)`. `(a)` is `a`. */
const isRow = (e: Expression): boolean => e.kind === NODE.ROW && e.items.length !== 1

/** A row, compiled element by element, its elements rows in turn where they are. */
type Shape = Compiled | readonly Shape[]

function shapeOf(e: Expression, ctx: CompileContext): Shape {
  if (e.kind === NODE.ROW && e.items.length !== 1) return e.items.map((i) => shapeOf(i, ctx))
  return compile(e.kind === NODE.ROW ? (e.items[0] as Expression) : e, ctx)
}

const widthOf = (s: Shape): number => (Array.isArray(s) ? s.length : 1)

/** ER_OPERAND_COLUMNS unless the two shapes match, element by element, as the left one asks. */
function sameShape(a: Shape, b: Shape): void {
  if (widthOf(a) !== widthOf(b) || Array.isArray(a) !== Array.isArray(b)) throw sqlError('ER_OPERAND_COLUMNS', `Operand should contain ${widthOf(a)} column(s)`)
  if (Array.isArray(a)) a.forEach((x, i) => sameShape(x, (b as readonly Shape[])[i] as Shape))
}

/**
 * Two rows compared, as `Arg_comparator::compare_row` does. `equality`
 * (= and <>): any element that differs decides, and otherwise a NULL makes
 * the answer NULL. `order` (<, <=, >, >=): the first difference decides, and
 * a NULL met before it makes the answer NULL. `nullSafe` (<=>): equal only
 * where every element is, NULL equal to NULL.
 */
function compareShapes(a: Shape, b: Shape, row: Row, env: Env, mode: 'equality' | 'order' | 'nullSafe'): number | null {
  if (!Array.isArray(a)) {
    const x = (a as Compiled).eval(row, env)
    const y = (b as Compiled).eval(row, env)
    return mode === 'nullSafe' ? (nullSafeEqual(x, y) ? 0 : 1) : compareValues(x, y)
  }
  let sawNull = false
  for (let i = 0; i < a.length; i++) {
    const c = compareShapes(a[i] as Shape, (b as readonly Shape[])[i] as Shape, row, env, mode)
    if (c === null) {
      if (mode === 'order') return null
      sawNull = true
    } else if (c !== 0) return c
  }
  return sawNull ? null : 0
}

function rowComparison(op: string, left: Expression, right: Expression, ctx: CompileContext): Compiled {
  const a = shapeOf(left, ctx)
  const b = shapeOf(right, ctx)
  sameShape(a, b)
  if (op === '<=>') return { eval: (r, env) => bool(compareShapes(a, b, r, env, 'nullSafe') === 0), type: boolType(false) }
  const test = COMPARISONS[op] as (c: number) => boolean
  const mode = op === '=' || op === '<>' || op === '!=' ? 'equality' : 'order'
  return {
    eval: (r, env) => {
      const c = compareShapes(a, b, r, env, mode)
      return c === null ? null : bool(test(c))
    },
    type: boolType(true),
  }
}

/** An IN item that is the same for every row of one execution: a literal, a negated one, or a parameter. */
const constantItem = (e: Expression): boolean => e.kind === NODE.LITERAL || e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && e.operand.kind === NODE.LITERAL)

/**
 * A list of constants, sorted, where searching it gives exactly what
 * comparing item by item does: every non-NULL item of one kind, and one
 * collation and coercibility if strings, so `compareValues(v, item)` is
 * monotonic in the order. `undefined` where that does not hold.
 */
interface SortedItems {
  readonly kind: string
  readonly sorted: readonly Exclude<Value, null>[]
  readonly sawNull: boolean
  /** Strings: the list sorted in each collation a comparison with it has met. */
  readonly byCollation: Map<number, readonly Exclude<Value, null>[]>
  /** Strings: the items' sort keys in each collation met, or `null` where it has none. */
  readonly keysByCollation: Map<number, ReadonlySet<string> | null>
}

function sortItems(values: readonly Value[]): SortedItems | undefined {
  const present = values.filter((v): v is Exclude<Value, null> => v !== null)
  const first = present[0]
  if (first === undefined || !(first.kind === 'int' || first.kind === 'decimal' || first.kind === 'double' || first.kind === 'string')) return undefined
  for (const v of present) {
    if (v.kind !== first.kind) return undefined
    if (v.kind === 'string' && first.kind === 'string' && (v.collationId !== first.collationId || v.coercibility !== first.coercibility)) return undefined
  }
  const sorted = first.kind === 'string' ? present : [...present].sort((x, y) => compareValues(x, y) ?? 0)
  return { kind: first.kind, sorted, sawNull: present.length < values.length, byCollation: new Map(), keysByCollation: new Map() }
}

/** The searched path's answer for `v`, or `undefined` when `v` cannot be searched for. */
function searchItems(list: SortedItems, v: Exclude<Value, null>): boolean | null | undefined {
  const numeric = (k: string) => k === 'int' || k === 'decimal' || k === 'double'
  if (list.kind === 'string' ? v.kind !== 'string' : !numeric(v.kind)) return undefined
  let sorted = list.sorted
  if (v.kind === 'string') {
    // Every item meets `v` in one collation, the pair's aggregate; the list
    // is sorted in that one, which its items alone would not choose.
    const item = list.sorted[0] as StringValue
    const id = aggregateCollation(v, item)
    // Equality is all IN asks: the items' sort keys in a set, and the row's
    // key looked up, rather than a sort and a search that re-encode both
    // sides at every comparison (Prisma's chunks are 32,766 long).
    let keys = list.keysByCollation.get(id)
    if (keys === undefined) {
      try {
        keys = new Set(list.sorted.map((x) => equalityKey((x as StringValue).v, id)))
      } catch (e) {
        expectTyped(e)
        // A collation with no sort key (an `Intl` fallback) is searched as below.
        keys = null
      }
      list.keysByCollation.set(id, keys)
    }
    if (keys !== null) return keys.has(equalityKey(v.v, id)) ? true : list.sawNull ? null : false
    let inId = list.byCollation.get(id)
    if (inId === undefined) {
      const as = (x: Exclude<Value, null>): Value => ({ ...(x as StringValue), collationId: id })
      inId = [...list.sorted].sort((x, y) => compareValues(as(x), as(y)) ?? 0)
      list.byCollation.set(id, inId)
    }
    sorted = inId
  }
  let lo = 0
  let hi = sorted.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = compareValues(v, sorted[mid] as Value) as number
    if (c === 0) return true
    if (c < 0) hi = mid - 1
    else lo = mid + 1
  }
  return list.sawNull ? null : false
}

function inList(negated: boolean, left: Expression, right: Expression, ctx: CompileContext): Compiled {
  if (right.kind === NODE.SUBQUERY) return quantified(negated ? '<>' : '=', negated ? 'ALL' : 'ANY', left, right, ctx)
  const list = right.kind === NODE.ROW ? right.items : [right]
  if (isRow(left)) {
    // `(a, b) IN ((1, 2), (3, 4))`: = with each row, TRUE if any is.
    const lhs = shapeOf(left, ctx)
    const rows = list.map((i) => shapeOf(i, ctx))
    for (const r of rows) sameShape(lhs, r)
    return {
      eval: (r, env) => {
        let sawNull = false
        for (const item of rows) {
          const c = compareShapes(lhs, item, r, env, 'equality')
          if (c === 0) return bool(!negated)
          if (c === null) sawNull = true
        }
        return sawNull ? null : bool(negated)
      },
      type: boolType(true),
    }
  }
  const compiled = compile(left, ctx)
  const literalConstants = list.every(constantItem)
  const allConstant = literalConstants || list.every((e) => constantNode(e))
  const timeColumn = compiled.type.kind === 'time' && left.kind === NODE.COLUMN
  // One item is `=`, whose text constant beside a date must be one (1525); a list's need not (8.4.11).
  const entries = list.map((i) => compile(i, ctx))
  const timeConstants = timeColumn && (list.length === 1 || (allConstant && new Set(entries.filter((c) => c.type.kind !== 'null').map((c) => isNumber(c.type) ? 'number' : 'string')).size <= 1))
  let raw = timeConstants ? entries.map((c, i) => timeConstant(compiled, left, list[i] as Expression, c, true, ctx)) : entries
  if (list.length === 1) raw = raw.map((c, k) => yearConstant(dateConstant(c, list[k] as Expression, compiled, ctx), list[k] as Expression, compiled, ctx))
  if (allConstant && compiled.type.kind === 'datetime') raw = raw.map((c, i) => numberBesideDate(c, list[i] as Expression, compiled, left, ctx))
  // MySQL selects a datetime comparator for an all-STRING list containing
  // a date. JSON selects its comparator only through the first nonconstant
  // list item (the server stops its constant-list scan there).
  let json = compiled.type.kind === 'json'
  if (literalConstants) json ||= raw.some((c) => c.type.kind === 'json')
  else for (let i = 0; i < raw.length; i++) {
    json ||= (raw[i] as Compiled).type.kind === 'json'
    if (!constantNode(list[i])) break
  }
  const all = isNumber(compiled.type) ? [compiled] : [compiled, ...raw.filter((c, i) => !(timeConstants && c.type.kind === 'datetime' && timeColumn && constantNode(list[i]) && list[i]?.kind !== NODE.LITERAL))]
  const dateOf = !json && all.every((c) => !isNumber(c.type)) ? all.find((c) => c.type.kind === 'datetime') : undefined
  const dateItem = (c: Compiled, written: Expression): Compiled => {
    if (dateOf === undefined) {
      return !json && compiled.type.kind === 'datetime' && !isNumber(c.type) ? dateConstant(c.type.kind === 'json' ? comparisonText(c) : c, written, compiled, ctx, false) : c
    }
    if (c.type.kind === 'time') return onStatementDate(c)
    return dateConstant(c.type.kind === 'json' ? comparisonText(c) : c, written, dateOf, ctx, false)
  }
  if (dateOf !== undefined || compiled.type.kind === 'datetime' || compiled.type.kind === 'time') raw = raw.map((c, i) => dateOf === undefined && !json && list.length > 1 && compiled.type.kind === 'time' && !isNumber(c.type) ? comparisonTime(c) : dateItem(c, list[i] as Expression))
  // Text against numbers is read as doubles: the left side once a row, and
  // a text item each time it is compared (8.4.11: `id IN ('1x', 2)` warns a row).
  const a = dateOf !== undefined ? dateItem(compiled, left) : !json && raw.some((i) => textVersusNumber(compiled.type, i.type)) ? list.length === 1 ? numberConstant(compiled, left, ctx) : asNumber(compiled, 'DOUBLE') : compiled
  const items = raw.map((i) => (!json && (textVersusNumber(i.type, compiled.type) || (isNumber(compiled.type) && i.type.kind === 'json')) ? asNumber(i, 'DOUBLE') : i))
  // Strings throughout are compared in one collation; one item is `=`'s.
  if (isText(compiled.type) && raw.some((i) => isText(i.type))) aggregateCollations([compiled.type, ...raw.map((i) => i.type)], raw.length === 1 ? '=' : ' IN ', true)
  // A long list of constants is sorted once per execution and searched, as
  // MySQL's `in_vector` is: Prisma sends 65,535 of them.
  const searchable = !json && items.length >= 10 && literalConstants && !timeColumn
  // One element is `=`, which compares fixed decimals within a tolerance;
  // a list compares exactly (8.4.11: a FLOAT(3,1) is IN (1.2) and not IN (1.2, 1.3)).
  const compare = items.length === 1 ? comparer(a.type, (items[0] as Compiled).type) : compareValues
  const jsonOperand = (v: Value, t: ResultType): Value => v === null ? null : jsonValue(isBits(t) && v.kind === 'int' ? { t: 'opaque', field: FIELD_TYPE.BIT, v: bitBytes(v.v, t.length) } : toJsonDoc(v))
  const compareItem = (v: Value, w: Value, i: number): number | null => json ? compareValues(jsonOperand(v, compiled.type), jsonOperand(w, (items[i] as Compiled).type)) : compare(v, w)
  // Constant items: sorted once a statement, which a correlated subquery's per-row environments share the memo of.
  let sortedFor: object | undefined
  let sorted: SortedItems | undefined
  const timed = timeColumn
  const comparisonKind = (t: ResultType): string => {
    if (isNumber(compiled.type) || isNumber(t)) {
      if (compiled.type.kind === 'int' && t.kind === 'int') return 'int'
      if ((compiled.type.kind === 'int' || compiled.type.kind === 'decimal') && (t.kind === 'int' || t.kind === 'decimal')) return 'decimal'
      return 'double'
    }
    return 'string'
  }
  const cachedConstants = !searchable && !json && allConstant && new Set(items.filter((i) => i.type.kind !== 'null').map((i) => comparisonKind(i.type))).size <= 1
  const constantsKey = {}
  return {
    eval: (r, env) => {
      const constants = cachedConstants ? memoValue(env.memo, constantsKey, () => items.map((i) => i.eval(r, env))) : undefined
      const v = a.eval(r, env)
      if (compiled.type.kind === 'null') return null
      if (v === null && items.length === 1 && !cachedConstants) return null
      if (searchable) {
        if (sortedFor !== (env.memo ?? env)) {
          sorted = sortItems(items.map((i) => i.eval(r, env)))
          sortedFor = env.memo ?? env
        }
        if (v === null) return null
        const found = sorted === undefined ? undefined : searchItems(sorted, v)
        if (found !== undefined) return found === null ? null : bool(found !== negated)
      }
      let sawNull = false
      if (timed) {
        // One item that is no time and the TIME column is in none of them:
        // the server's list of times could not be built (8.4.11: `t IN
        // ('10:00:00', 'x')` is false for 10:00:00, NULL with a NULL item).
        const values = items.map((i) => i.eval(r, env))
        if (v === null) return null
        if (values.includes(NO_TIME)) return values.includes(null) ? null : bool(negated)
        for (let i = 0; i < values.length; i++) {
          const c = compareItem(v, values[i] as Value, i)
          if (c === 0) return bool(!negated)
          if (c === null) sawNull = true
        }
        return sawNull ? null : bool(negated)
      }
      for (let i = 0; i < items.length; i++) {
        const c = compareItem(v, constants === undefined ? (items[i] as Compiled).eval(r, env) : constants[i] as Value, i)
        if (c === 0) return bool(!negated)
        if (c === null) sawNull = true
      }
      return sawNull ? null : bool(negated)
    },
    type: boolType(!notNull(a.type, ...items.map((i) => i.type))),
  }
}

/**
 * `LIKE`, with the collation deciding what a character matches: under
 * `utf8mb4_0900_ai_ci`, `'Á' LIKE 'a'` is true. `%` matches any run, `_` one
 * character, and the escape (default `\`) makes either literal.
 */
function like(negated: boolean, a: Compiled, pattern: Compiled, escape: Compiled | undefined): Compiled {
  if (isText(a.type) && isText(pattern.type)) aggregateCollations([a.type, pattern.type], 'like', true)
  return {
    eval: (r, env) => {
      const v = a.eval(r, env)
      const p = pattern.eval(r, env)
      if (v === null || p === null) return null
      const esc = escape === undefined ? '\\' : toText(escape.eval(r, env) ?? stringValue('\\', 255))
      const id = v.kind === 'string' && p.kind === 'string' ? aggregateCollation(v, p) : v.kind === 'string' ? v.collationId : p.kind === 'string' ? (p as StringValue).collationId : CHARSET_BINARY
      const m = matchLike([...toText(v)], [...toText(p)], esc, id)
      return bool(m !== negated)
    },
    type: boolType(!notNull(a.type, pattern.type)),
  }
}

/**
 * Each character's equality key under a collation, kept across rows: two
 * characters are one to LIKE exactly when their keys are (`equalityKey`
 * drops only trailing pad weights, which for one character is a space's
 * own). Bounded, since a column's text has few distinct characters.
 */
const CHARACTER_KEYS = new Map<number, Map<string, string>>()

function characterKey(ch: string, collationId: number): string {
  let keys = CHARACTER_KEYS.get(collationId)
  if (keys === undefined) CHARACTER_KEYS.set(collationId, (keys = new Map()))
  let k = keys.get(ch)
  if (k === undefined) {
    if (keys.size >= 65536) keys.clear()
    k = equalityKey(ch, collationId)
    keys.set(ch, k)
  }
  return k
}

function matchLike(s: readonly string[], p: readonly string[], escape: string, collationId: number): boolean {
  const binary = collationId === CHARSET_BINARY
  const same = (x: string, y: string): boolean => x === y || (!binary && characterKey(x, collationId) === characterKey(y, collationId))
  // The pattern as tokens: `%`, `_`, or a character to match (escaped or not).
  const ANY = 0
  const ONE = 1
  const tokens: (string | typeof ANY | typeof ONE)[] = []
  for (let j = 0; j < p.length; j++) {
    const pc = p[j] as string
    if (pc === escape && j + 1 < p.length) tokens.push(p[++j] as string)
    else tokens.push(pc === '%' ? ANY : pc === '_' ? ONE : pc)
  }
  // Iterative, backtracking only to the last `%`: linear stack, and O(|s|·|p|)
  // time at worst, as the memoised recursion was without its stack depth.
  let i = 0
  let j = 0
  let star = -1
  let mark = 0
  while (i < s.length) {
    const t = tokens[j]
    if (t === ONE || (typeof t === 'string' && same(s[i] as string, t))) {
      i++
      j++
    } else if (t === ANY) {
      star = j++
      mark = i
    } else if (star >= 0) {
      j = star + 1
      i = ++mark
    } else return false
  }
  while (tokens[j] === ANY) j++
  return j === tokens.length
}

/**
 * The type a set of alternatives aggregates to — `CASE`, `IF`, `COALESCE` —
 * as `Item_func::aggregate_type` picks it: a string if any is one, else a
 * double, else a decimal wide enough for every integer and scale, else an
 * integer. NULL branches take no part.
 */
/**
 * The one type CASE, IF, IFNULL and COALESCE give values of several types.
 * Its field type is MySQL's pairwise merge of theirs (`type-merge.ts`,
 * captured from 8.4.11); its length, scale and collation are the holder's
 * (`holderOf`), which the merge then dresses: a CHAR among strings makes a
 * CHAR, a DATE beside a TIME a DATETIME, a YEAR beside an INT an INT.
 */
export function aggregate(types: readonly ResultType[], nullable: boolean, connectionCollation: number, operation?: string, compare = false): ResultType {
  const type = holderOf(types, nullable, connectionCollation, operation, compare)
  const live = types.filter((t) => t.kind !== 'null')
  if (live.length === 0) return type
  // JSON among other types is a LONGBLOB wherever it stands, which a left fold would lose (8.4.11: `COALESCE(js, tm, d)`).
  const json = live.some((t) => t.kind === 'json')
  const merged = signedness(live, json ? 'LONG_BLOB' : live.map(mergeTypeOf).reduce((a, b) => mergeTypes(a, b) as MergeType))
  const field = merged === 'VARCHAR' ? FIELD_TYPE.VAR_STRING : FIELD_TYPE[merged]
  switch (merged) {
    case 'DATE':
    case 'TIME':
    case 'DATETIME':
    case 'TIMESTAMP':
      // Reported in the connection's charset as text is, the field type kept (8.4.11).
      return { ...datetimeType(field, Math.max(...live.map((t) => (t.kind === 'datetime' || t.kind === 'time' ? t.scale : 0))), nullable), asText: true }
    case 'TINY':
    case 'SHORT':
    case 'INT24':
    case 'LONG':
    case 'LONGLONG':
    case 'YEAR':
      return type.kind === 'int' ? { ...type, field } : { ...intType(Math.max(...live.map((t) => t.length)), nullable, live.every((t) => t.unsigned)), field }
    case 'NEWDECIMAL':
      // BIGINT UNSIGNED beside a signed integer: a DECIMAL of as many digits as the widest (8.4.11: 21 wide).
      return type.kind === 'int' ? decimalType(Math.max(...live.map(intDigits)), 0, nullable) : type
    case 'FLOAT':
    case 'DOUBLE':
      return type.kind === 'double' ? { ...type, field } : type
    case 'STRING':
    case 'VARCHAR':
      // A BIT among temporals or numbers that merge to a string makes it a binary one, as wide as the widest (8.4.11: `COALESCE(tm, bt, 1.5)` is VARBINARY(10)).
      if (type.kind === 'string' && live.some(isBits)) return { ...stringType(Math.max(...live.map((t) => (isBits(t) ? t.length : charWidth(t)))), CHARSET_BINARY, nullable), field, coercibility: COERCIBILITY.IMPLICIT }
      return type.kind === 'string' || type.kind === 'bytes' ? { ...type, field } : type
    case 'ENUM':
    case 'SET':
    case 'LONG_BLOB':
      return type.kind === 'string' || type.kind === 'bytes' ? { ...type, field } : type
    default:
      return type
  }
}

const INTEGERS: readonly MergeType[] = ['TINY', 'SHORT', 'INT24', 'LONG', 'LONGLONG', 'NEWDECIMAL']

/**
 * The merge table's integers are signed ones. An unsigned one beside a signed
 * one needs the next larger type to hold both, BIGINT UNSIGNED a DECIMAL; and
 * a BIT, unsigned, beside only unsigned integers is a BIGINT rather than the
 * DECIMAL it is beside a signed one (8.4.11: TINYINT with TINYINT UNSIGNED is
 * SMALLINT, INT with INT UNSIGNED BIGINT). YEAR takes no part.
 */
function signedness(live: readonly ResultType[], merged: MergeType): MergeType {
  const ints = live.filter((t) => t.kind === 'int' && t.field !== FIELD_TYPE.YEAR && !isBits(t))
  if (live.some(isBits) && merged === 'NEWDECIMAL' && ints.length > 0 && ints.every((t) => t.unsigned) && live.every((t) => t.kind === 'int' || t.kind === 'null')) return 'LONGLONG'
  const rank = INTEGERS.indexOf(merged)
  if (rank === -1 || !ints.some((t) => t.unsigned) || !ints.some((t) => !t.unsigned)) return merged
  const promoted = Math.max(rank, ...ints.filter((t) => t.unsigned).map((t) => INTEGERS.indexOf(mergeTypeOf(t)) + 1))
  return INTEGERS[Math.min(promoted, INTEGERS.length - 1)] as MergeType
}

/** A type's field type as the merge table names it: ENUM, SET and the TEXT sizes are read from the column. */
function mergeTypeOf(t: ResultType): MergeType {
  if (t.kind === 'null') return 'NULL'
  if (t.kind === 'json') return 'JSON'
  const flags = t.column?.flags ?? 0
  if ((flags & COLUMN_FLAG.ENUM) !== 0 || t.field === FIELD_TYPE.ENUM) return 'ENUM'
  if ((flags & COLUMN_FLAG.SET) !== 0 || t.field === FIELD_TYPE.SET) return 'SET'
  switch (t.field) {
    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.LONGLONG:
    case FIELD_TYPE.YEAR:
    case FIELD_TYPE.BIT:
    case FIELD_TYPE.NEWDECIMAL:
    case FIELD_TYPE.FLOAT:
    case FIELD_TYPE.DOUBLE:
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.TIME:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.STRING:
    case FIELD_TYPE.TINY_BLOB:
    case FIELD_TYPE.MEDIUM_BLOB:
    case FIELD_TYPE.LONG_BLOB:
      return MERGE_NAME[t.field] as MergeType
    case FIELD_TYPE.DECIMAL:
      return 'NEWDECIMAL'
    case FIELD_TYPE.NEWDATE:
      return 'DATE'
    case FIELD_TYPE.BLOB: {
      const bytes = t.blobBytes ?? 65535
      return bytes <= 255 ? 'TINY_BLOB' : bytes <= 65535 ? 'BLOB' : bytes <= 16777215 ? 'MEDIUM_BLOB' : 'LONG_BLOB'
    }
    default:
      return 'VARCHAR'
  }
}

const MERGE_NAME: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(FIELD_TYPE).map(([name, code]) => [code, name]))

/**
 * A branch's value as the merged type holds it: a DATE or a TIME where the
 * merge made a DATETIME is one, a TIME on today's date (8.4.11).
 */
export function asMerged(v: Value, result: ResultType, env: Env): Value {
  if (v === null || result.kind !== 'datetime' || result.field === FIELD_TYPE.DATE) return v
  if (v.kind === 'time') {
    if (result.field === FIELD_TYPE.TIME) return v
    const d = onToday(v.v, env)
    return d === undefined ? null : { kind: 'datetime', v: d, type: 'DATETIME', fsp: v.fsp }
  }
  if (v.kind === 'datetime' && v.type === 'DATE' && result.field !== FIELD_TYPE.TIME) return { ...v, type: 'DATETIME' }
  return v
}

function holderOf(types: readonly ResultType[], nullable: boolean, connectionCollation: number, operation?: string, compare = false): ResultType {
  let live = types.filter((t) => t.kind !== 'null')
  if (live.length === 0) return NULL_TYPE
  // JSON with JSON is JSON; JSON with anything else is its text, in JSON's
  // collation, utf8mb4_bin (8.4.11, M5.21).
  if (live.every((t) => t.kind === 'json')) return jsonType(nullable)
  if (live.some((t) => t.kind === 'json')) live = live.map((t) => (t.kind === 'json' ? jsonAsText(t.nullable) : t))
  if (live.some((t) => t.kind === 'string' || t.kind === 'bytes')) {
    // A BIT beside text is a binary string as wide as it has bits, a
    // column's, so its bytes decide the result (8.4.11: `IF(1, b, 'a')` of
    // a BIT(8) is VARBINARY(8)).
    if (live.some(isBits)) {
      const asBytes = (t: ResultType): ResultType => (isBits(t) ? { ...stringType(t.length, CHARSET_BINARY, t.nullable), coercibility: COERCIBILITY.IMPLICIT } : t)
      live = live.map(asBytes)
      types = types.map(asBytes)
    }
    // A binary string decides only at the lowest coercibility: a column's text
    // beats a hex literal (8.4.11: `LEAST(X'61', t)` is t's text). A binary
    // result is as wide as its widest argument's bytes; a TEXT among them
    // makes it a BLOB of its bytes.
    const texts = live.filter((t) => t.kind === 'string' || t.kind === 'bytes')
    const derived = operation === undefined ? undefined : aggregateCollations(types, operation, compare)
    const least = Math.min(...texts.map(coercibilityOf))
    const binary = derived !== undefined ? derived.collationId === CHARSET_BINARY : texts.some((t) => t.kind === 'bytes' && coercibilityOf(t) === least)
    const collation = binary ? CHARSET_BINARY : (derived?.collationId ?? aggregateTypes(live, connectionCollation))
    const tagged = (t: ResultType): ResultType => (derived === undefined || binary ? t : { ...t, coercibility: derived.derivation })
    // In a binary CASE, IF, IFNULL or COALESCE a DOUBLE literal is as wide as
    // it was written (8.4.11: `IF(c, 2.5e0, 0x61)` is VARBINARY(5)); in a text
    // one, and in GREATEST and LEAST, it is 22, as a computed double is.
    const holder = binary && (operation === 'case' || operation === 'if' || operation === 'ifnull' || operation === 'coalesce')
    const textWidth = (t: ResultType): number => (holder && t.literalDouble === true ? t.length : charWidth(t))
    const width = Math.max(...live.map((t) => (binary && t.kind === 'string' ? charWidth(t) * requireCollationInfo(t.collationId).mbmaxlen : textWidth(t))))
    const blob = Math.max(0, ...live.map((t) => t.blobBytes ?? 0))
    if (blob > 0 && !binary) return tagged({ ...stringType(width, collation, nullable), field: FIELD_TYPE.BLOB, blobBytes: blob * requireCollationInfo(collation).mbmaxlen })
    return tagged(stringType(width, collation, nullable))
  }
  const first = live[0] as ResultType
  if (live.every((t) => t.kind === first.kind && t.field === first.field) && (first.kind === 'datetime' || first.kind === 'time')) {
    return datetimeType(first.field, Math.max(...live.map((t) => t.scale)), nullable)
  }
  if (live.some((t) => t.kind === 'datetime' || t.kind === 'time')) return stringType(Math.max(...live.map(charWidth)), connectionCollation, nullable)
  // The merger owns FLOAT/DOUBLE field selection; the holder owns width and scale.
  if (live.some((t) => t.kind === 'double')) return fixedDouble(live, nullable) ?? doubleType(nullable)
  if (live.some((t) => t.kind === 'decimal')) {
    const s = Math.max(...live.map(scaleOf))
    return decimalType(Math.max(...live.map(intDigits)) + s, s, nullable)
  }
  // A BIT beside another integer is a DECIMAL of as many digits as it has
  // bits (`field_types_merge_rules`, 8.4.11: `IF(1, b, 0)` of a BIT(8) is
  // DECIMAL(8,0)).
  if (live.some(isBits) && !live.every(isBits)) return decimalType(Math.max(...live.map(intDigits)), 0, nullable)
  // Integers of one field type keep it (8.4.11: `GREATEST(NULL, id)` of an INT is an INT).
  const field = live.every((t) => t.field === first.field) ? first.field : FIELD_TYPE.LONGLONG
  return { ...intType(Math.max(...live.map((t) => t.length)), nullable, live.every((t) => t.unsigned)), field }
}

/** A value as a double of this type: a FLOAT's text, or a fixed number of decimals, or neither. */
export function doubleOf(v: Value, t: ResultType): Value {
  if (v === null) return null
  const n = v.kind === 'double' ? v.v : toDouble(v)
  const float = t.field === FIELD_TYPE.FLOAT
  const decimals = t.scale < 31 ? t.scale : undefined
  if (v.kind === 'double' && (v.float === true) === float && v.decimals === decimals) return v
  return { kind: 'double', v: n, ...(float ? { float: true as const } : {}), ...(decimals === undefined ? {} : { decimals }) }
}

/** Typed DECIMAL results discard expression-only display precision, even at equal scales. */
function decimalAt(v: Exclude<Value, null>, scale: number): DecimalValue {
  return decimalValue(rescale(toDecimal(v), scale).v, scale)
}

/**
 * A value brought to an aggregated result type, as `COALESCE` and `IFNULL`
 * return theirs: `COALESCE(1, 1.5)` is `1.0`. (`IF` and `CASE` do not — `IF(1, 1,
 * 0.5)` is `1` — which 8.4.11 settled, not the manual.)
 */
export function convertTo(v: Value, t: ResultType): Value {
  if (v === null) return null
  switch (t.kind) {
    case 'decimal':
      return v.kind === 'int' || v.kind === 'decimal' ? decimalAt(v, t.scale) : v
    case 'double':
      return doubleOf(v, t)
    case 'bytes':
      return withoutHex(v)
    case 'string':
      // A function's string is a string: an ENUM's index stays with the column.
      return v.kind === 'string' ? (v.ordinal === undefined ? v : stringValue(v.v, v.collationId, v.coercibility)) : stringValue(toText(v), t.collationId)
    default:
      return v
  }
}

/** A stored DECIMAL reads its declared value, not the original item's branch reader. */
export function decimalField(item: Compiled): Compiled {
  return item.type.kind === 'decimal' ? { type: item.type, eval: (row, env) => convertTo(item.eval(row, env), item.type) } : item
}

/** A value's text as its type shows it: a YEAR is four digits, `0000` for zero; a FLOAT has a float's digits (8.4.11). */
export function textOf(v: Exclude<Value, null>, t: ResultType): string {
  if (t.field === FIELD_TYPE.YEAR && t.column !== undefined && v.kind === 'int') return v.v.toString().padStart(4, '0')
  if (t.field === FIELD_TYPE.FLOAT && v.kind === 'double' && t.scale >= 31) return renderFloat(v.v)
  return toText(v)
}

/** Whether a branch of this type, in a string result, is text of its own kind rather than its value's (`textOf`). */
export const ownText = (t: ResultType): boolean => (t.field === FIELD_TYPE.YEAR && t.column !== undefined) || (t.field === FIELD_TYPE.FLOAT && t.scale >= 31)

/**
 * A branch's value as a binary result holds it: text in its own charset's
 * bytes (8.4.11: a latin1 'café' is 63 61 66 E9), a YEAR or FLOAT as its text.
 */
export function asBinary(v: Exclude<Value, null>, from: ResultType): Value {
  if (ownText(from)) return bytesValue(new TextEncoder().encode(textOf(v, from)))
  return v.kind === 'string' ? bytesValue(encodeCollation(v.v, v.collationId)) : v
}

/**
 * A branch of IF or CASE, as its result reads it: a BIT branch under a
 * DECIMAL, binary or BIT result is its own bytes, as wide as it is, which
 * is what `val_str` passes through (8.4.11: `IF(1, b, 0)` sends 0x05 as the
 * DECIMAL's text, and `IF(1, b8, b12)` one byte).
 */
export function branchOf(x: Compiled, result: ResultType): Compiled['eval'] {
  if (ownText(x.type) && result.kind === 'string') {
    const id = result.collationId
    return (r, env) => {
      const v = x.eval(r, env)
      return v === null ? null : stringValue(textOf(v, x.type), id)
    }
  }
  if (result.kind === 'bytes' && (ownText(x.type) || x.type.kind === 'string')) {
    return (r, env) => {
      const v = x.eval(r, env)
      return v === null ? null : asBinary(v, x.type)
    }
  }
  if (result.kind === 'datetime' && (x.type.kind === 'datetime' || x.type.kind === 'time') && x.type.field !== result.field) return (r, env) => asMerged(x.eval(r, env), result, env)
  if (!isBits(x.type) || !(result.kind === 'decimal' || result.kind === 'bytes' || isBits(result))) return x.eval
  const bits = x.type.length
  return (r, env) => {
    const v = x.eval(r, env)
    return v !== null && v.kind === 'int' ? { ...v, str: bitBytes(v.v, bits) } : v
  }
}

/** IF and CASE select once; each numeric reader retains the original branch's policy. */
export function choiceOf(xs: readonly Compiled[], select: (row: Row, env: Env) => number, type: ResultType): Compiled {
  const reader = (reads: readonly Compiled['eval'][]): Compiled['eval'] => (r, env) => (reads[select(r, env)] as Compiled['eval'])(r, env)
  const merged = reader(xs.map((x) => branchOf(x, type)))
  return {
    type,
    eval: type.kind === 'double' ? (r, env) => doubleOf(merged(r, env), type) : merged,
    decimalOf: (once) => reader(xs.map((x) => asNumber(x, 'DECIMAL', once).eval)),
  }
}

function caseExpr(e: CaseNode, ctx: CompileContext): Compiled {
  const given = e.operand === undefined ? undefined : compile(e.operand, ctx)
  const compiled = e.whens.map((w) => ({ when: compile(w.when, ctx), then: compile(w.then, ctx) }))
  // `CASE x WHEN y`: one comparison type for x and every y, text read as a
  // double beside a number (`agg_cmp_type`); a searched CASE reads each WHEN's truth as one.
  const ordinal = given?.type.column !== undefined && (given.type.column.flags & (COLUMN_FLAG.ENUM | COLUMN_FLAG.SET)) !== 0
  const numeric = given !== undefined && ([given, ...compiled.map((w) => w.when)].some((x) => isNumber(x.type)) || (ordinal && compiled.some((w) => w.when.type.literalInt !== undefined)))
  const exact = [given, ...compiled.map((w) => w.when)].every((c) => c === undefined || c.type.kind === 'int' || c.type.kind === 'decimal' || c.type.kind === 'null')
  const number = (c: Compiled): Compiled => {
    if (exact) return c
    const checked = asNumber(c, 'DOUBLE')
    return { type: c.type, eval: (r, env) => {
      const v = checked.eval(r, env)
      const numericValue = ordinal && c.type.literalInt !== undefined ? withoutHex(v) : v
      return numericValue === null ? null : doubleValue(toDouble(numericValue))
    } }
  }
  const jsonText = !numeric && [given, ...compiled.map((w) => w.when)].some((c) => c?.type.kind === 'json')
  const whenComparison = (c: Compiled, written: Expression): Compiled => {
    if (given?.type.kind === 'datetime' && !numeric) return c.type.kind === 'time' ? onStatementDate(c) : dateConstant(c.type.kind === 'json' ? comparisonText(c) : c, written, given, ctx, false)
    if (given?.type.kind === 'time' && !numeric) {
      // A prepared WHEN parameter inherits TIME; a written dated string keeps its date.
      return comparisonTime(c, written.kind !== NODE.PLACEHOLDER)
    }
    return jsonText ? comparisonText(c) : c
  }
  const operand = given === undefined ? undefined : numeric ? number(given) : jsonText ? comparisonText(given) : given
  const whens = compiled.map((w, i) => numeric ? number(w.when) : given === undefined ? asNumber(w.when, 'DOUBLE') : whenComparison(w.when, (e.whens[i] as CaseNode['whens'][number]).when))
  const otherwise = e.else === undefined ? lit(null, NULL_TYPE) : compile(e.else, ctx)
  const results = [...compiled.map((w) => w.then), otherwise]
  const type = aggregate(results.map((x) => x.type), results.some((x) => x.type.nullable), ctx.connectionCollation, 'case')
  // `CASE x WHEN y`: the operand and every WHEN compare in one collation.
  if (given !== undefined && isText(given.type) && compiled.every((w) => isText(w.when.type))) aggregateCollations([given.type, ...compiled.map((w) => w.when.type)], 'case', true)
  return choiceOf(results, (r, env) => {
    const subject = operand?.eval(r, env)
    for (let i = 0; i < whens.length; i++) {
      const w = whens[i] as (typeof whens)[number]
      const hit = operand === undefined ? truth(w.eval(r, env)) === true : subject !== null && compareValues(subject ?? null, w.eval(r, env)) === 0
      if (hit) return i
    }
    return whens.length
  }, type)
}

/** Whether the columns `args` read, outside their own subqueries, are all an enclosing query's — and there is one. */
function outerOnly(args: readonly Expression[], ctx: CompileContext): boolean {
  let outer = 0
  let local = 0
  someNode(args, (node) => {
    const n = node as Expression
    if (n.kind === NODE.SUBQUERY) return false
    if (n.kind === NODE.COLUMN) {
      if ((safeResolve(ctx.scope, n.parts, 'field list')?.depth ?? 0) > 0) outer++
      else local++
      return false
    }
    return undefined
  })
  return outer > 0 && local === 0
}

function call(e: CallNode, ctx: CompileContext): Compiled {
  const name = e.name.toUpperCase()
  // `NOW ()` with IGNORE_SPACE off names a stored function, which this
  // executor has none of (8.4.11's wording, M5.33).
  if (e.stored === true) throw sqlError('ER_FUNC_INEXISTENT_NAME_COLLISION', `FUNCTION ${ctx.session.database ?? ''}.${e.name} does not exist. Check the 'Function Name Parsing and Resolution' section in the Reference Manual`)
  if (e.over !== undefined) {
    if (ctx.windows !== undefined) return ctx.windows.register(e)
    if (/^(where|having|on) clause$/.test(ctx.clause)) windowNotAllowed(e)
    throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Window functions here'))
  }
  if (AGGREGATE_NAMES.has(name)) {
    // An aggregate of an enclosing query's columns alone is that query's, and
    // makes it aggregate (8.4.11: `SELECT (SELECT COUNT(t1.x) FROM t2) FROM
    // t1` is one row). Refused by name until the outer query can take it.
    if (outerOnly(e.args, ctx)) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported("An aggregate of an enclosing query's columns"))
    if (ctx.aggregates === undefined || ctx.inAggregate === true) throw sqlError('ER_INVALID_GROUP_FUNC_USE', 'Invalid use of group function')
    return ctx.aggregates.register(e, ctx)
  }
  if (name === 'GROUPING') {
    if (ctx.groupKeys === undefined || ctx.inAggregate === true) throw sqlError('ER_INVALID_GROUP_FUNC_USE', 'Invalid use of group function')
    return ctx.groupKeys.grouping(e.args, ctx)
  }
  if (name === 'DEFAULT' && e.args.length === 1) return defaultFunction(e, ctx)
  const compiler = functionCompiler(name)
  if (compiler !== undefined) return compiler(name, e, ctx)
  if (NOT_YET.has(name)) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The function ${name}`))
  throw sqlError('ER_SP_DOES_NOT_EXIST', `FUNCTION ${ctx.session.database ?? ''}.${e.name} does not exist`)
}

const FLT_MAX = 3.4028234663852886e38

function cast(e: CastNode, ctx: CompileContext): Compiled {
  const raw = compile(e.expr, ctx)
  if (e.type.national === true) warnAtCompile(ctx, 3720, NATIONAL_DEPRECATION)
  // What the target reads its argument as, warning as it goes (1292).
  const reads = e.type.name === 'DECIMAL' ? 'DECIMAL' : e.type.name === 'DOUBLE' || e.type.name === 'FLOAT' || e.type.name === 'REAL' ? 'DOUBLE' : ['SIGNED', 'UNSIGNED', 'INT', 'BIGINT'].includes(e.type.name) ? 'INTEGER' : undefined
  const inner = reads === undefined ? raw : asNumber(raw, reads, false, 'cast')
  const x = inner.eval
  const nullable = inner.type.nullable
  const t = e.type
  switch (t.name) {
    case 'CHAR':
    case 'NCHAR':
    case 'VARCHAR': {
      const id = (t.charset ? defaultCollationOf(t.charset.toLowerCase())?.id : undefined) ?? ctx.connectionCollation
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          // Bytes, a BIT's included, are read in the target charset: NULL and
          // 1300 when they are no text in it (8.4.11: CAST(X'C3A9' AS CHAR) is 'é').
          const bytes = v.kind === 'bytes' ? v.v : v.kind === 'int' && isBits(inner.type) ? bitBytes(v.v, inner.type.length) : undefined
          let read = bytes === undefined ? toText(v) : textIn(bytes, id, env)
          if (read === null) return null
          if (t.length !== undefined) {
            const characters = [...read]
            if (characters.length > t.length) {
              truncated(env, `CHAR(${t.length})`, read)
              characters.length = t.length
              read = characters.join('')
            }
          }
          return stringValue(read, id, COERCIBILITY.IMPLICIT)
        },
        decimalPrefix: true,
        // Nullable whatever its argument, as 8.4.11 reports it.
        type: stringType(t.length ?? charWidth(inner.type), id, true),
      }
    }
    case 'JSON':
      return castAsJson(inner)
    case 'BINARY':
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          const b = valueBytes(v)
          if (t.length === undefined) return bytesValue(b)
          // BINARY(N) is N bytes: cut, or padded with zero bytes (8.4.11).
          if (b.length > t.length) truncated(env, `BINARY(${t.length})`, toText(v))
          const out = new Uint8Array(t.length)
          out.set(b.subarray(0, t.length))
          return bytesValue(out)
        },
        decimalPrefix: true,
        // As wide as its argument's bytes, and nullable whatever it is (8.4.11).
        type: { ...stringType(t.length ?? byteWidth(inner.type), CHARSET_BINARY, true), coercibility: COERCIBILITY.IMPLICIT },
      }
    case 'SIGNED':
    case 'UNSIGNED':
    case 'INT':
    case 'BIGINT': {
      const unsigned = t.name === 'UNSIGNED' || t.unsigned === true
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          let n = valInt(v)
          // Complement warnings use the original integer range before saturation.
          const prefix = integerPrefix(v)
          if (prefix !== undefined) {
            const original = BigInt(prefix)
            // Native INTEGER casts accept leading spaces, but reject these controls.
            const complemented = !/[\t\n\r]/.test(prefix) && (unsigned ? original < 0n && original >= MIN_SIGNED : original > MAX_SIGNED && original <= MAX_UNSIGNED)
            if (complemented) raise(env, 1105, unsigned ? 'Cast to unsigned converted negative integer to its positive complement' : 'Cast to signed converted positive out-of-range integer to its negative complement')
          }
          if (unsigned) n &= MAX_UNSIGNED
          else if (n > MAX_SIGNED) n -= 1n << 64n
          return intValue(n, unsigned)
        },
        // 21 wide, unsigned or not (8.4.11).
        type: intType(21, nullable, unsigned),
      }
    }
    case 'DECIMAL': {
      const { precision, scale } = decimalCastShape(t)
      const limit = pow10(precision) - 1n
      const label = () => sourceText(ctx.sql, e.at) ?? deparse(e)
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          const d = decimalAt(v, scale)
          // Past DECIMAL(M,D)'s digits: the largest it holds, and 1264 (8.4.11).
          if (d.v <= limit && d.v >= -limit) return d
          raise(env, 1264, `Out of range value for column '${label()}' at row 1`)
          return decimalValue(d.v < 0n ? -limit : limit, scale)
        },
        type: decimalType(precision, scale, nullable),
      }
    }
    case 'FLOAT':
      // FLOAT, or FLOAT(p) to 24 bits, is a single: rounded to one, and past
      // the largest one it is 1690 rather than infinity (8.4.11). Wider is DOUBLE.
      if ((t.precision ?? 0) <= 24) {
        const printed = `cast(${printedArgument(e.expr, ctx)} as float)`
        return {
          eval: (r, env) => {
            const v = x(r, env)
            if (v === null) return null
            const n = toDouble(v)
            if (Math.abs(n) > FLT_MAX) throw valueOutOfRange('DOUBLE', printed)
            return { kind: 'double', v: Math.fround(n), float: true }
          },
          type: { ...doubleType(nullable), field: FIELD_TYPE.FLOAT },
        }
      }
    case 'DOUBLE':
    case 'REAL':
      return { eval: (r, env) => { const v = x(r, env); return v === null ? null : doubleValue(toDouble(v)) }, type: doubleType(nullable) }
    case 'DATE':
    case 'DATETIME': {
      const type = t.name === 'DATE' ? 'DATE' : 'DATETIME'
      const fsp = type === 'DATE' ? 0 : (t.length ?? 0)
      const flags = modeOf(ctx.session.sqlMode)
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          let input = v
          // Text is read under the session's zero-date modes; what is no
          // date is NULL with 1292 (8.4.11: CAST('0000-00-00' AS DATE)).
          if (v.kind === 'string' || (v.kind === 'bytes' && v.hex !== true)) {
            const p = parseDateTime(toText(v), flags)
            if (p === undefined) {
              raise(env, 1292, `Incorrect datetime value: '${toText(v)}'`)
              return null
            }
            input = { kind: 'datetime', v: p.v, type: p.hasTime ? 'DATETIME' : 'DATE', fsp: p.fsp }
          }
          const d = toDateTime(input, type)
          return d === undefined ? null : { ...d, fsp }
        },
        type: datetimeType(type === 'DATE' ? FIELD_TYPE.DATE : FIELD_TYPE.DATETIME, fsp, true),
      }
    }
    case 'TIME':
      return { eval: (r, env) => { const v = x(r, env); return v === null ? null : (toTime(v) ?? null) }, type: datetimeType(FIELD_TYPE.TIME, t.length ?? 0, true) }
    default:
      throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`CAST AS ${t.name}`))
  }
}

// --- subqueries (M5.1) --------------------------------------------------------------

/** A `[NOT] IN`, `= ALL` or `<> ANY` subquery as compiled: its comparison, and what EXPLAIN's choice of strategy turns on. */
export interface QuantifiedSubquery {
  readonly op: string
  readonly quantifier: 'ANY' | 'ALL'
  /** Whether the expression it is compared with can be NULL. */
  readonly outerNullable: boolean
  readonly correlated: boolean
}

/** A subquery's plan, with the enclosing scope its correlated names resolve in. */
function planned(e: SubqueryNode, ctx: CompileContext): SubqueryPlan {
  if (ctx.subquery === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Subqueries here'))
  return ctx.subquery(e.query, ctx.scope)
}

/** Reuse a statement-owned value; only successful initializers publish, and undefined remains a miss. */
export function memoValue<T>(memo: Map<unknown, unknown> | undefined, key: unknown, read: () => T): T {
  let value = memo?.get(key) as T | undefined
  if (value === undefined) {
    value = read()
    memo?.set(key, value)
  }
  return value
}

/** Its rows for this outer row: run again for each if correlated, else once per statement. */
function rowsOf(plan: SubqueryPlan, key: object, row: Row, env: Env): readonly (readonly Value[])[] {
  if (!plan.correlated && env.memo !== undefined) {
    return memoValue(env.memo, key, () => [...plan.rows(env)])
  }
  return [...plan.rows({ ...env, outer: [row, ...(env.outer ?? [])] })]
}

/**
 * `(SELECT …)` as a value: one column, at most one row (1242 otherwise —
 * raised only when it is evaluated, so an empty outer table raises nothing),
 * NULL for none. Its type is its item's as an expression, nullable unless it
 * has no FROM, as 8.4.11 reports `(SELECT 1)` NOT NULL.
 */
function scalarSubquery(e: SubqueryNode, ctx: CompileContext): Compiled {
  const plan = planned(e, ctx)
  if (plan.columns.length !== 1) throw sqlError('ER_OPERAND_COLUMNS', 'Operand should contain 1 column(s)')
  const t = (plan.columns[0] as { type: ResultType }).type
  const key = {}
  return {
    eval: (row, env) => {
      const rows = rowsOf(plan, key, row, env)
      if (rows.length > 1) throw sqlError('ER_SUBQUERY_NO_1_ROW', 'Subquery returns more than 1 row')
      // An ENUM's index is the column's, not the subquery's; a hex literal keeps its number (8.4.11).
      const v = rows[0]?.[0] ?? null
      return v !== null && v.kind === 'string' && v.ordinal !== undefined ? plainValue(v) : v
    },
    // Its own item, not its inner one: a MIN of a column inside keeps none of that column's flags here.
    type: (({ fieldFlags: _f, ownInTemporary: _o, ...rest }) => ({ ...rest, nullable: t.nullable || plan.hasFrom }))(expressionOf(t)),
  }
}

/** `EXISTS (SELECT …)`: whether it has a row. Never NULL. */
function exists(e: SubqueryNode, ctx: CompileContext): Compiled {
  const plan = planned(e, ctx)
  const key = {}
  return { eval: (row, env) => bool(rowsOf(plan, key, row, env).length > 0), type: boolType(false) }
}

/**
 * `x op ANY (SELECT …)`, `x op ALL (…)`, and `x IN`/`NOT IN (…)`, which are
 * `= ANY` and `<> ALL`. Three-valued as the standard has it: ANY is true if
 * one comparison is, else NULL if one was NULL, else false — false over no
 * rows; ALL is false if one comparison is, else NULL if one was, else true —
 * true over no rows. So `x NOT IN` a subquery with a NULL in it is never true.
 */
function quantified(op: string, quantifier: 'ANY' | 'ALL', left: Expression, right: SubqueryNode, ctx: CompileContext): Compiled {
  // MySQL's own limit, not ours: 8.4.11 refuses `a IN (SELECT … LIMIT 1)`,
  // though a LIMIT inside a derived table there is fine.
  if (right.query.limit !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', "This version of MySQL doesn't yet support 'LIMIT & IN/ALL/ANY/SOME subquery'")
  // `(a, b) IN (SELECT x, y …)`: a row is equal where every element is, and
  // unequal where any is not, whatever the others hold (8.4.11).
  const lefts = left.kind === NODE.ROW && left.items.length > 1 ? left.items : [left]
  if (lefts.length > 1 && op !== '=' && op !== '<>') throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`A row compared with ${op} ${quantifier}`))
  const as = lefts.map((l) => compile(l, ctx))
  const plan = planned(right, ctx)
  if (plan.columns.length !== as.length) throw sqlError('ER_OPERAND_COLUMNS', `Operand should contain ${as.length} column(s)`)
  if (as.length === 1) ctx.quantified?.(right.query, { op, quantifier, outerNullable: (as[0] as Compiled).type.nullable, correlated: plan.correlated })
  const test = COMPARISONS[op] as (c: number) => boolean
  const compareRow = (vs: readonly Value[], r: readonly Value[]): number | null => {
    if (vs.length === 1) return compareValues(vs[0] ?? null, r[0] ?? null)
    let unknown = false
    for (let i = 0; i < vs.length; i++) {
      const c = compareValues(vs[i] ?? null, r[i] ?? null)
      if (c === null) unknown = true
      else if (c !== 0) return 1
    }
    return unknown ? null : 0
  }
  const key = {}
  // IN and NOT IN over one column of an uncorrelated subquery: its values as
  // a set, built once a statement, where an equal comparison always means an
  // equal key — two exact numbers, or two strings under one collation (the
  // hash join's rule). The answer is the loop's: an equal value decides, and
  // otherwise a NULL on either side makes it NULL.
  const sub = (plan.columns[0] as { type: ResultType }).type
  const a0 = as[0] as Compiled
  const exactNumber = (k: string): boolean => k === 'int' || k === 'decimal'
  const keyed =
    as.length === 1 &&
    ((op === '=' && quantifier === 'ANY') || (op === '<>' && quantifier === 'ALL')) &&
    ((exactNumber(a0.type.kind) && exactNumber(sub.kind)) || (a0.type.kind === 'string' && sub.kind === 'string' && a0.type.collationId === sub.collationId))
  const setKey = {}
  if (keyed) {
    const membership = (env: Env): { readonly keys: ReadonlySet<string>; readonly empty: boolean; readonly sawNull: boolean } | undefined => {
      if (plan.correlated || env.memo === undefined) return undefined
      return memoValue(env.memo, setKey, () => {
        const keys = new Set<string>()
        let empty = true
        let sawNull = false
        for (const r of plan.rows(env)) {
          empty = false
          const x = r[0] ?? null
          if (x === null) sawNull = true
          else keys.add(valueKey(x))
        }
        return { keys, empty, sawNull }
      })
    }
    const loop = compareAll()
    return {
      eval: (row, env) => {
        const m = membership(env)
        if (m === undefined) return loop(row, env)
        if (m.empty) return bool(quantifier === 'ALL')
        const v = a0.eval(row, env)
        if (v !== null && m.keys.has(valueKey(v))) return bool(quantifier === 'ANY')
        return v === null || m.sawNull ? null : bool(quantifier === 'ALL')
      },
      type: boolType(true),
    }
  }
  return { eval: compareAll(), type: boolType(true) }

  /** Every subquery row compared in turn. */
  function compareAll(): Compiled['eval'] {
    return (row, env) => {
      const rows = rowsOf(plan, key, row, env)
      if (rows.length === 0) return bool(quantifier === 'ALL')
      const v = as.map((a) => a.eval(row, env))
      let sawNull = false
      for (const r of rows) {
        const c = compareRow(v, r)
        if (c === null) {
          sawNull = true
          continue
        }
        const hit = test(c)
        if (quantifier === 'ANY' && hit) return bool(true)
        if (quantifier === 'ALL' && !hit) return bool(false)
      }
      return sawNull ? null : bool(quantifier === 'ALL')
    }
  }
}

/** A result's width in bytes: a string's characters at its charset's widest, anything else its characters. */
export function byteWidth(t: ResultType): number {
  return charWidth(t) * (t.kind === 'string' ? requireCollationInfo(t.collationId).mbmaxlen : 1)
}

// --- MATCH … AGAINST (M5.26) -------------------------------------------------------

/**
 * DEFAULT(c): the column's literal default, as the column would store it;
 * NULL for a nullable column with none. A column with no default at all is
 * 1364 when a row asks, and one whose default is an expression is 3773 at
 * once (8.4.11).
 */
function defaultFunction(e: CallNode, ctx: CompileContext): Compiled {
  const arg = e.args[0] as Expression
  if (arg.kind !== NODE.COLUMN) throw sqlError('ER_PARSE_ERROR', messages.parseError(deparse(arg), 1))
  const scope = ctx.scope
  const r = scope.resolve(arg.parts, ctx.clause)
  const at = scope instanceof TableScope && (r.depth ?? 0) === 0 ? scope.columnAt(r.index) : undefined
  const def = at?.table.def
  const column = def?.columns.find((c) => c.name.toLowerCase() === (at?.column.name ?? '').toLowerCase())
  if (column === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('DEFAULT() of a column that is not a base table\'s'))
  const type = { ...r.type, nullable: true }
  const text = column.attributes?.['default']
  if (column.attributes?.['defaultExpression'] === true) throw sqlError('ER_DEFAULT_AS_VAL_GENERATED', 'DEFAULT function cannot be used with default value expressions')
  if (typeof text !== 'string') {
    if (column.nullable && column.attributes?.['noDefault'] !== true) return { eval: () => null, type }
    return {
      eval: () => {
        throw sqlError('ER_NO_DEFAULT_FOR_FIELD', messages.noDefaultForField(column.name))
      },
      type,
    }
  }
  const value = compile(parseExpression(text), { ...ctx, scope: EMPTY_SCOPE, clause: 'default' })
  return {
    eval: (_r, env) => {
      const v = value.eval([], env)
      return v === null ? null : decodeField(encodeField(v, column, { strict: false, row: 1, warnings: 0 }), column.type)
    },
    type,
  }
}

/** Whether an expression reads a column of the row, outside any subquery of its own. */
export function readsColumn(e: unknown): boolean {
  return someNode(e, (value) => {
    const n = value as { kind?: unknown }
    if (n.kind === NODE.COLUMN) return true
    if (n.kind === NODE.SUBQUERY) return false
    return undefined
  })
}

/**
 * MATCH: the columns of one FULLTEXT index of one base table, ranked against
 * a constant query (`fulltext.ts` has the rules). The table's words are read
 * once per statement, as the index's statistics.
 */
function matchAgainst(e: MatchNode, ctx: CompileContext): Compiled {
  if (e.modifier !== undefined && e.modifier.includes('EXPANSION')) throw noExpansion()
  const scope = ctx.scope
  const tables = scope instanceof TableScope ? scope.tables : (scope as { readonly tables?: TableScope['tables'] }).tables
  if (tables === undefined) throw noIndex()
  const slots = e.columns.map((c) => {
    if (c.kind !== NODE.COLUMN) throw noIndex()
    const r = scope.resolve(c.parts, ctx.clause)
    if ((r.depth ?? 0) > 0) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('MATCH on an outer query\'s columns'))
    return r.index
  })
  // Columns of more than one collation are a mix before they are an index (8.4.11: `MATCH(t, id)` is 1267).
  aggregateCollations(
    e.columns.map((c) => scope.resolve((c as { parts: readonly string[] }).parts, ctx.clause).type),
    'match',
    false,
    false,
  )
  const source = tables.find((t) => (slots[0] as number) >= t.offset && (slots[0] as number) < t.offset + t.columns.length)
  const def = source?.def
  if (source === undefined || def === undefined || slots.some((i) => i < source.offset || i >= source.offset + source.columns.length)) throw noIndex()
  const names = slots.map((i) => (source.columns[i - source.offset] as { name: string }).name.toLowerCase())
  const index = fulltextOf(def).find((f) => f.columns.length === names.length && f.columns.every((c) => names.includes(c.toLowerCase())))
  if (index === undefined) throw noIndex()
  // A row's own column is no query; a variable or a subquery is, read once
  // a statement (8.4.11: `AGAINST(@x)` and `AGAINST((SELECT 'apple'))`).
  if (readsColumn(e.against)) throw badAgainst()
  const against = compile(e.against, ctx)
  const fold = foldFor(def, index.columns)
  const boolean = e.modifier === 'IN BOOLEAN MODE'
  // A constant query is parsed before any row is read, so its errors come
  // from an empty table too (8.4.11: 33 nested groups is 209 there).
  if (boolean && constantNode(e.against)) parseBoolean(queryText(against.eval([], constantEnv(ctx))), fold)
  const positions = index.columns.map((c) => def.columns.findIndex((x) => x.name.toLowerCase() === c.toLowerCase()))
  const wordsIn = (values: readonly Value[], raw?: Map<string, string>) => values.flatMap((v) => (v === null ? [] : wordsOf(toText(v), fold, raw)))
  // Read once a statement: the query reads no row's column, so a correlated run shares it through the memo.
  let preparedFor: object | undefined
  let corpus: Corpus | undefined
  let query: { readonly natural: string[] } | { readonly terms: Term[] } = { natural: [] }
  return {
    eval: (row, env) => {
      if (preparedFor !== (env.memo ?? env) || corpus === undefined) {
        const text = queryText(against.eval(row, env))
        query = boolean ? { terms: parseBoolean(text, fold) } : { natural: wordsOf(text, fold) }
        const table = ctx.table?.(def.schema, def.name)
        const documents: string[][] = []
        const raw = new Map<string, string>()
        if (table !== undefined) for (const [, fields] of table.scan(undefined, env.trx)) documents.push(wordsIn(positions.map((p) => decodeField(fields[p] ?? null, (def.columns[p] as ColumnDef).type)), raw))
        corpus = new Corpus(documents, raw, fold)
        preparedFor = env.memo ?? env
      }
      const words = wordsIn(slots.map((i) => row[i] ?? null))
      if ('natural' in query) return doubleValue(naturalRank(corpus, query.natural, words))
      const answer = booleanRank(corpus, query.terms, words)
      return doubleValue(answer.matched ? answer.rank : 0)
    },
    type: doubleType(true),
  }
}
