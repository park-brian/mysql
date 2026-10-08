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
import { CHARSET_BINARY, FIELD_TYPE, type MysqlDateTime } from '@myjs/bytes'
import { collation, collationInfoByName, defaultCollationOf, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { LITERAL, NODE, deparse, type CallNode, type CaseNode, type CastNode, type Expression, type LiteralNode, type QueryExpression, type SubqueryNode } from '@myjs/parser'
import type { Trx } from '@myjs/engine'
import { sqlError, messages, type Session } from '@myjs/protocol'
import {
  COERCIBILITY,
  add,
  aggregateCollation,
  bitNot,
  bitwise,
  bool,
  bytesValue,
  commonCollation,
  compareValues,
  decimalValue,
  divide,
  doubleValue,
  intDivide,
  intValue,
  modulo,
  negate,
  not,
  nullSafeEqual,
  parseDateTime,
  parseDecimal,
  parseTime,
  rescale,
  stringValue,
  toDateTime,
  toDecimal,
  toDouble,
  toInteger,
  toText,
  toTime,
  truth,
  type StringValue,
  type Value,
} from '@myjs/types'
import {
  NULL_TYPE,
  boolType,
  charWidth,
  datetimeType,
  decimalType,
  doubleType,
  intType,
  stringType,
  type ResultType,
} from './meta.ts'

/** One row as operators pass it: a value per column of the scope. */
export type Row = readonly Value[]

/** What evaluation may read beyond the row: the parameters, the clock, the session. */
export interface Env {
  readonly params: readonly Value[]
  /** The statement's start, which every `NOW()` in it returns. */
  readonly now: Date
  readonly session: Session
  readonly state: SessionValues
  /** The transaction a subquery reads in (M5.1). */
  readonly trx?: Trx
  /** The rows of the enclosing queries, innermost first: what a correlated reference reads (D-73). */
  readonly outer?: readonly Row[]
  /** One statement's memory: an uncorrelated subquery's answer, computed once. */
  readonly memo?: Map<unknown, unknown>
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
}

export interface Compiled {
  readonly eval: (row: Row, env: Env) => Value
  readonly type: ResultType
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
  readonly params?: readonly Value[]
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
  /** Inside an aggregate's arguments, where another aggregate is 1111 too. */
  readonly inAggregate?: boolean
  /** Above a grouping: the expressions that are its keys, which read the key slot (NULL in a ROLLUP super-aggregate row). */
  readonly groupKeys?: GroupKeys
  /** Plan a subquery whose enclosing scope is `outer` (M5.1); absent where none is allowed. */
  readonly subquery?: (q: QueryExpression, outer: Scope) => SubqueryPlan
}

/** A grouped query's keys, as the expressions above the grouping see them. */
export interface GroupKeys {
  /** The key `e` is, read from its slot, or `undefined` when it is not one. */
  match(e: Expression): Compiled | undefined
  /** `GROUPING(e, …)`: which of the named keys a ROLLUP row has rolled up, as bits. */
  grouping(args: readonly Expression[]): Compiled
}

/** The aggregate functions, `Item_sum`'s subclasses that a select list can name (M5.5). */
export const AGGREGATE_NAMES: ReadonlySet<string> = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'BIT_AND', 'BIT_OR', 'BIT_XOR',
  'STD', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
])

const lit = (value: Value, type: ResultType): Compiled => ({ eval: () => value, type })

/** BIGINT's largest value, `LLONG_MAX` in `include/my_inttypes.h`. */
const MAX_SIGNED = 2n ** 63n - 1n

/** A string type's coercibility: a column's 2, a literal's 4. */
const coercibilityOf = (t: ResultType): number => t.coercibility ?? COERCIBILITY.COERCIBLE

/** The collation a list of string-typed results aggregates to (`aggregateCollation`, pairwise). */
export function aggregateTypes(types: readonly ResultType[], fallback: number): number {
  let acc: { collationId: number; coercibility: number } | undefined
  for (const t of types) {
    if (t.kind !== 'string') continue
    const next = { collationId: t.collationId, coercibility: coercibilityOf(t) }
    acc = acc === undefined ? next : { collationId: aggregateCollation(acc, next), coercibility: Math.min(acc.coercibility, next.coercibility) }
  }
  return acc?.collationId ?? fallback
}

/** A type with no table column behind it: what a function of a column returns. */
function expressionOf(t: ResultType): ResultType {
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
      return { eval: (row) => row[index] ?? null, type }
    }

    case NODE.SUBQUERY:
      if (e.quantifier !== undefined) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.quantifier, 1))
      return scalarSubquery(e, ctx)

    case NODE.VARIABLE:
      return variable(e.name, ctx)

    case NODE.UNARY:
      if (e.op === 'EXISTS' && e.operand.kind === NODE.SUBQUERY) return exists(e.operand, ctx)
      return unary(e.op, compile(e.operand, ctx), e.op === 'EXISTS')

    case NODE.BINARY:
      return binary(e.op, e.left, e.right, e.extra, ctx)

    case NODE.CALL:
      return call(e, ctx)

    case NODE.CASE:
      return caseExpr(e, ctx)

    case NODE.CAST:
      return cast(e, ctx)

    case NODE.COLLATE: {
      const inner = compile(e.expr, ctx)
      const info = collationInfoByName(e.collation.toLowerCase())
      if (info === undefined) throw sqlError('ER_UNKNOWN_COLLATION', messages.unknownCollation(e.collation))
      const id = info.id
      return {
        eval: (row, env) => {
          const v = inner.eval(row, env)
          return v === null ? null : stringValue(toText(v), id, COERCIBILITY.EXPLICIT)
        },
        type: stringType(charWidth(inner.type), id, inner.type.nullable),
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
export function typeOfValue(v: Value): ResultType {
  if (v === null) return NULL_TYPE
  switch (v.kind) {
    case 'int':
      return intType(v.v.toString().length + (v.unsigned ? 0 : 1) - (v.v < 0n ? 1 : 0), false, v.unsigned)
    case 'decimal':
      return decimalType(Math.max(1, (v.v < 0n ? -v.v : v.v).toString().length), v.scale, false)
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
  }
}

function literal(e: LiteralNode, ctx: CompileContext): Compiled {
  switch (e.type) {
    case LITERAL.INT: {
      const n = e.value as bigint
      const unsigned = n > (1n << 63n) - 1n
      return lit(intValue(n, unsigned), intType(n.toString().length + (unsigned ? 0 : 1), false, unsigned))
    }
    case LITERAL.DECIMAL: {
      const d = parseDecimal(e.value as string)
      const digits = (d.v < 0n ? -d.v : d.v).toString().length
      return lit(d, decimalType(Math.max(digits, d.scale + (digits > d.scale ? 0 : 1)), d.scale, false))
    }
    case LITERAL.DOUBLE:
      return lit(doubleValue(e.value as number), doubleType(false, String(e.value).replace('+', '').length))
    case LITERAL.STRING: {
      const id = introducerCollation(e, ctx)
      const coercibility = e.collation !== undefined ? COERCIBILITY.EXPLICIT : COERCIBILITY.COERCIBLE
      const text = e.value as string
      if (id === CHARSET_BINARY) {
        const bytes = encodeCollation(text, ctx.connectionCollation)
        return lit(bytesValue(bytes), stringType(bytes.length, CHARSET_BINARY, false))
      }
      return lit(stringValue(text, id, coercibility), stringType([...text].length, id, false))
    }
    case LITERAL.HEX:
      return lit(bytesValue(e.value as Uint8Array), stringType((e.value as Uint8Array).length, CHARSET_BINARY, false))
    case LITERAL.BIT: {
      const n = e.value as bigint
      const width = Math.max(1, Math.ceil(n.toString(2).length / 8))
      const out = new Uint8Array(width)
      let v = n
      for (let i = width - 1; i >= 0; i--) {
        out[i] = Number(v & 0xffn)
        v >>= 8n
      }
      return lit(bytesValue(out), stringType(width, CHARSET_BINARY, false))
    }
    case LITERAL.NULL:
      return lit(null, NULL_TYPE)
    case LITERAL.BOOL:
      return lit(bool(e.value as boolean), intType(1, false))
    case LITERAL.TEMPORAL: {
      const text = e.value as string
      if (e.unit === 'TIME') {
        const t = parseTime(text)
        if (t === undefined) throw sqlError('ER_WRONG_VALUE', `Incorrect TIME value: '${text}'`)
        return lit({ kind: 'time', v: t.v, fsp: t.fsp }, datetimeType(FIELD_TYPE.TIME, t.fsp, false))
      }
      const p = parseDateTime(text)
      const type = e.unit === 'DATE' ? 'DATE' : 'DATETIME'
      if (p === undefined) throw sqlError('ER_WRONG_VALUE', `Incorrect ${type} value: '${text}'`)
      const v = toDateTime({ kind: 'datetime', v: p.v, type: 'DATETIME', fsp: p.fsp }, type)
      return lit(v ?? null, datetimeType(type === 'DATE' ? FIELD_TYPE.DATE : FIELD_TYPE.DATETIME, type === 'DATE' ? 0 : p.fsp, false))
    }
  }
}

/** A string literal's collation: its `COLLATE`, else its introducer's charset default, else the connection's. */
function introducerCollation(e: LiteralNode, ctx: CompileContext): number {
  if (e.collation !== undefined) {
    const info = collationInfoByName(e.collation.toLowerCase())
    if (info === undefined) throw sqlError('ER_UNKNOWN_COLLATION', messages.unknownCollation(e.collation))
    return info.id
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

function variable(name: string, ctx: CompileContext): Compiled {
  if (name.startsWith('@@')) {
    const m = /^@@(?:(global|session|local)\.)?(.+)$/i.exec(name)
    const scope = m?.[1]?.toLowerCase() === 'global' ? 'GLOBAL' : m?.[1] === undefined ? undefined : 'SESSION'
    const varName = (m?.[2] ?? name.slice(2)).toLowerCase()
    const probe = ctx.state.systemVariable(varName, scope, ctx.session)
    if (probe === undefined) throw sqlError('ER_UNKNOWN_SYSTEM_VARIABLE', `Unknown system variable '${varName}'`)
    return { eval: (_row, env) => env.state.systemVariable(varName, scope, env.session) ?? null, type: typeOfSystemVariable(varName, probe, ctx) }
  }
  const key = name.slice(1).toLowerCase()
  const known = ctx.state.userVariables.get(key)
  return { eval: (_row, env) => env.state.userVariables.get(key) ?? null, type: typeOfUserVariable(known, ctx) }
}

/** The system variables that are booleans, which report a width of 1 rather than a BIGINT UNSIGNED's 21. */
const BOOLEAN_VARIABLES = new Set(['autocommit', 'foreign_key_checks', 'unique_checks', 'sql_safe_updates', 'explicit_defaults_for_timestamp', 'performance_schema'])

/** As 8.4.11 reports them: a string is 21,845 characters, an integer a BIGINT UNSIGNED. */
function typeOfSystemVariable(name: string, v: Value, ctx: CompileContext): ResultType {
  if (v === null || v.kind === 'string' || v.kind === 'bytes') return stringType(21845, ctx.connectionCollation, true)
  if (v.kind === 'int') return BOOLEAN_VARIABLES.has(name) ? intType(1, true) : intType(21, true, true)
  return { ...typeOfValue(v), nullable: true }
}

/** A user variable: a BIGINT, a LONGTEXT for a string, a 16,383-byte binary string when unset. */
function typeOfUserVariable(v: Value | undefined, ctx: CompileContext): ResultType {
  if (v === undefined || v === null) return stringType(16383, CHARSET_BINARY, true)
  if (v.kind === 'string') return { ...stringType(67108860, ctx.connectionCollation, true), field: FIELD_TYPE.LONG_BLOB }
  if (v.kind === 'int') return intType(21, true, v.unsigned)
  return { ...typeOfValue(v), nullable: true }
}

function unary(op: string, a: Compiled, exists: boolean): Compiled {
  if (exists) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('EXISTS'))
  const at = a.eval
  switch (op) {
    case '-': {
      const t = a.type
      // Negating an unsigned value needs room for the sign it gains.
      const type = t.kind === 'int' ? intType(t.length + (t.unsigned ? 1 : 0), t.nullable) : t.kind === 'decimal' ? decimalType(t.length, t.scale, t.nullable) : t.kind === 'null' ? NULL_TYPE : doubleType(t.nullable)
      return { eval: (r, env) => negate(at(r, env)), type }
    }
    case '+':
      return a
    case '~':
      return { eval: (r, env) => bitNot(at(r, env)), type: intType(21, a.type.nullable, true) }
    case '!':
    case 'NOT':
      return { eval: (r, env) => not(at(r, env)), type: boolType(a.type.nullable) }
    case 'BINARY':
      return {
        eval: (r, env) => {
          const v = at(r, env)
          return v === null ? null : v.kind === 'bytes' ? v : bytesValue(v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v)))
        },
        type: stringType(charWidth(a.type), CHARSET_BINARY, a.type.nullable),
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
  if (t.kind === 'decimal') return t.length - t.scale
  if (t.kind === 'int') return t.unsigned ? t.length : t.length - 1
  return 0
}

const scaleOf = (t: ResultType): number => (t.kind === 'decimal' ? t.scale : 0)

/** The numeric kind an arithmetic operator yields, chosen before evaluation as MySQL chooses it. */
function arithKind(a: ResultType, b: ResultType): 'int' | 'decimal' | 'double' | 'null' {
  if (a.kind === 'null' || b.kind === 'null') return 'null'
  const k = (t: ResultType): 'int' | 'decimal' | 'double' =>
    t.kind === 'int' ? 'int' : t.kind === 'decimal' ? 'decimal' : t.kind === 'datetime' || t.kind === 'time' ? (t.scale > 0 ? 'decimal' : 'int') : 'double'
  const x = k(a)
  const y = k(b)
  return x === 'double' || y === 'double' ? 'double' : x === 'decimal' || y === 'decimal' ? 'decimal' : 'int'
}

function binary(op: string, left: Expression, right: Expression, extra: Expression | readonly Expression[] | undefined, ctx: CompileContext): Compiled {
  if (op === 'IN' || op === 'NOT IN') return inList(op === 'NOT IN', left, right, ctx)
  if (right.kind === NODE.SUBQUERY && right.quantifier !== undefined && COMPARISONS[op] !== undefined) return quantified(op, right.quantifier === 'ALL' ? 'ALL' : 'ANY', left, right, ctx, op)
  const a = compile(left, ctx)
  if (op === 'BETWEEN' || op === 'NOT BETWEEN') {
    const lo = compile(right, ctx)
    const hi = compile(extra as Expression, ctx)
    const negated = op === 'NOT BETWEEN'
    return {
      eval: (r, env) => {
        const v = a.eval(r, env)
        const x = compareValues(v, lo.eval(r, env))
        const y = compareValues(v, hi.eval(r, env))
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
  const at = a.eval
  const bt = b.eval
  const nullable = !notNull(a.type, b.type)
  // What an overflow names, as MySQL's message does: the expression's text.
  const label = deparse({ kind: NODE.BINARY, op, left, right, at: 0 })

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
    case '<=>':
      return { eval: (r, env) => bool(nullSafeEqual(at(r, env), bt(r, env))), type: boolType(false) }
    case '+':
    case '-':
    case '*': {
      const kind = arithKind(a.type, b.type)
      let type: ResultType
      const unsigned = a.type.unsigned || b.type.unsigned
      if (kind === 'int') type = intType(op === '*' ? intDigits(a.type) + intDigits(b.type) + (unsigned ? 0 : 1) : arithWidth(a.type, b.type, unsigned), nullable, unsigned)
      else if (kind === 'decimal') {
        const s = op === '*' ? scaleOf(a.type) + scaleOf(b.type) : Math.max(scaleOf(a.type), scaleOf(b.type))
        const digits = op === '*' ? intDigits(a.type) + intDigits(b.type) : Math.max(intDigits(a.type), intDigits(b.type)) + 1
        // A DECIMAL result is unsigned only when both sides are; an integer
        // one when either is (`Item_func_*::result_precision`).
        type = decimalType(digits + s, s, nullable, a.type.unsigned === true && b.type.unsigned === true)
      } else if (kind === 'double') type = doubleType(nullable, 23)
      else type = NULL_TYPE
      return { eval: (r, env) => add(at(r, env), bt(r, env), op, label), type }
    }
    case '/': {
      const kind = arithKind(a.type, b.type)
      const s = Math.min(30, scaleOf(a.type) + 4)
      const type = kind === 'double' ? doubleType(true, 23) : kind === 'null' ? NULL_TYPE : decimalType(intDigits(a.type) + scaleOf(b.type) + s, s, true, a.type.unsigned === true && b.type.unsigned === true)
      return { eval: (r, env) => divide(at(r, env), bt(r, env)), type }
    }
    case 'DIV': {
      // The dividend's width: an integer's own (a TINYINT UNSIGNED is 3), a
      // DECIMAL's integer digits and a sign (`score DIV 0` on a DECIMAL(6,2)
      // is 5), a double's 22 — all read off 8.4.11.
      const t = a.type
      const width = t.kind === 'int' ? t.length : t.kind === 'decimal' ? intDigits(t) + 1 : 22
      return { eval: (r, env) => intDivide(at(r, env), bt(r, env), label), type: intType(width, true, t.unsigned || b.type.unsigned) }
    }
    case '%':
    case 'MOD': {
      const kind = arithKind(a.type, b.type)
      // The wider operand's digits and a sign, unsigned or not: `flag % 3` on a TINYINT UNSIGNED is 4.
      const type = kind === 'int' ? intType(Math.max(intDigits(a.type), intDigits(b.type), 1) + 1, true, a.type.unsigned) : kind === 'decimal' ? decimalType(Math.max(a.type.length, b.type.length), Math.max(scaleOf(a.type), scaleOf(b.type)), true) : doubleType(true, 23)
      return { eval: (r, env) => modulo(at(r, env), bt(r, env), label), type }
    }
    case '|':
    case '&':
    case '^':
    case '<<':
    case '>>':
      return { eval: (r, env) => bitwise(at(r, env), bt(r, env), op), type: intType(21, nullable, true) }
    default: {
      const test = COMPARISONS[op]
      if (test === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The operator ${op}`))
      return {
        eval: (r, env) => {
          const c = compareValues(at(r, env), bt(r, env))
          return c === null ? null : bool(test(c))
        },
        type: boolType(nullable),
      }
    }
  }
}

function inList(negated: boolean, left: Expression, right: Expression, ctx: CompileContext): Compiled {
  if (right.kind === NODE.SUBQUERY) return quantified(negated ? '<>' : '=', negated ? 'ALL' : 'ANY', left, right, ctx, negated ? 'NOT IN' : 'IN')
  const a = compile(left, ctx)
  const items = (right.kind === NODE.ROW ? right.items : [right]).map((i) => compile(i, ctx))
  return {
    eval: (r, env) => {
      const v = a.eval(r, env)
      if (v === null) return null
      let sawNull = false
      for (const item of items) {
        const c = compareValues(v, item.eval(r, env))
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
  return {
    eval: (r, env) => {
      const v = a.eval(r, env)
      const p = pattern.eval(r, env)
      if (v === null || p === null) return null
      const esc = escape === undefined ? '\\' : toText(escape.eval(r, env) ?? stringValue('\\', 255))
      const id = v.kind === 'string' && p.kind === 'string' ? commonCollation(v, p) : v.kind === 'string' ? v.collationId : p.kind === 'string' ? (p as StringValue).collationId : CHARSET_BINARY
      const m = matchLike([...toText(v)], [...toText(p)], esc, id)
      return bool(m !== negated)
    },
    type: boolType(!notNull(a.type, pattern.type)),
  }
}

function matchLike(s: readonly string[], p: readonly string[], escape: string, collationId: number): boolean {
  const c = collationId === CHARSET_BINARY ? undefined : collation(collationId)
  const same = (x: string, y: string): boolean =>
    x === y || (c !== undefined && c.compare(encodeCollation(x, collationId), encodeCollation(y, collationId)) === 0)
  // Memoised on (i, j): `%` backtracking is otherwise exponential in the pattern.
  const memo = new Map<number, boolean>()
  const go = (i: number, j: number): boolean => {
    const key = i * (p.length + 1) + j
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let out: boolean
    if (j === p.length) out = i === s.length
    else {
      const pc = p[j] as string
      if (pc === escape && j + 1 < p.length) out = i < s.length && same(s[i] as string, p[j + 1] as string) && go(i + 1, j + 2)
      else if (pc === '%') out = go(i, j + 1) || (i < s.length && go(i + 1, j))
      else if (pc === '_') out = i < s.length && go(i + 1, j + 1)
      else out = i < s.length && same(s[i] as string, pc) && go(i + 1, j + 1)
    }
    memo.set(key, out)
    return out
  }
  return go(0, 0)
}

/**
 * The type a set of alternatives aggregates to — `CASE`, `IF`, `COALESCE` —
 * as `Item_func::aggregate_type` picks it: a string if any is one, else a
 * double, else a decimal wide enough for every integer and scale, else an
 * integer. NULL branches take no part.
 */
function aggregate(types: readonly ResultType[], nullable: boolean, connectionCollation: number): ResultType {
  const live = types.filter((t) => t.kind !== 'null')
  if (live.length === 0) return NULL_TYPE
  if (live.some((t) => t.kind === 'string' || t.kind === 'bytes')) {
    const binary = live.some((t) => t.kind === 'bytes')
    return stringType(Math.max(...live.map(charWidth)), binary ? CHARSET_BINARY : aggregateTypes(live, connectionCollation), nullable)
  }
  const first = live[0] as ResultType
  if (live.every((t) => t.kind === first.kind && t.field === first.field) && (first.kind === 'datetime' || first.kind === 'time')) {
    return datetimeType(first.field, Math.max(...live.map((t) => t.scale)), nullable)
  }
  if (live.some((t) => t.kind === 'datetime' || t.kind === 'time')) return stringType(Math.max(...live.map(charWidth)), connectionCollation, nullable)
  if (live.some((t) => t.kind === 'double')) return doubleType(nullable, 23)
  if (live.some((t) => t.kind === 'decimal')) {
    const s = Math.max(...live.map(scaleOf))
    return decimalType(Math.max(...live.map(intDigits)) + s, s, nullable)
  }
  return intType(Math.max(...live.map((t) => t.length)), nullable, live.every((t) => t.unsigned))
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
      return v.kind === 'int' || v.kind === 'decimal' ? rescale(toDecimal(v), t.scale) : v
    case 'double':
      return v.kind === 'double' ? v : doubleValue(toDouble(v))
    case 'string':
      return v.kind === 'string' ? v : stringValue(toText(v), t.collationId)
    default:
      return v
  }
}

function caseExpr(e: CaseNode, ctx: CompileContext): Compiled {
  const operand = e.operand === undefined ? undefined : compile(e.operand, ctx)
  const whens = e.whens.map((w) => ({ when: compile(w.when, ctx), then: compile(w.then, ctx) }))
  const otherwise = e.else === undefined ? undefined : compile(e.else, ctx)
  const results = [...whens.map((w) => w.then.type), otherwise?.type ?? NULL_TYPE]
  const nullable = otherwise === undefined || results.some((t) => t.nullable)
  return {
    eval: (r, env) => {
      const subject = operand?.eval(r, env)
      for (const w of whens) {
        const hit = operand === undefined ? truth(w.when.eval(r, env)) === true : compareValues(subject ?? null, w.when.eval(r, env)) === 0
        if (hit) return w.then.eval(r, env)
      }
      return otherwise === undefined ? null : otherwise.eval(r, env)
    },
    type: aggregate(results, nullable, ctx.connectionCollation),
  }
}

/** The builtins this executor knows, beyond the ones written out below — refused by name until M5.10. */
const KNOWN_BUILTINS = new Set([
  'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'SUBSTRING', 'SUBSTR', 'TRIM', 'REPLACE', 'ROUND', 'FLOOR', 'CEIL',
  'CEILING', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'JSON_EXTRACT', 'JSON_OBJECT', 'JSON_ARRAY', 'UUID', 'RAND', 'LEFT',
  'RIGHT', 'LPAD', 'RPAD', 'REPEAT', 'REVERSE', 'LOCATE', 'INSTR', 'POSITION', 'GREATEST', 'LEAST', 'ROW_NUMBER', 'RANK',
])

/** Whether the columns `args` read, outside their own subqueries, are all an enclosing query's — and there is one. */
function outerOnly(args: readonly Expression[], ctx: CompileContext): boolean {
  let outer = 0
  let local = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(visit)
    const n = x as Expression
    if (n.kind === NODE.SUBQUERY) return
    if (n.kind === NODE.COLUMN) {
      try {
        if ((ctx.scope.resolve(n.parts, 'field list').depth ?? 0) > 0) outer++
        else local++
      } catch {
        local++
      }
      return
    }
    for (const v of Object.values(x)) visit(v)
  }
  visit(args)
  return outer > 0 && local === 0
}

function call(e: CallNode, ctx: CompileContext): Compiled {
  const name = e.name.toUpperCase()
  if (e.over !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Window functions'))
  const args = (): Compiled[] => e.args.map((a) => compile(a, ctx))
  const arity = (n: number): void => {
    if (e.args.length !== n) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
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
    return ctx.groupKeys.grouping(e.args)
  }
  const conn = ctx.connectionCollation
  const text = (value: (env: Env) => string | null, chars: number): Compiled => ({
    eval: (_r, env) => {
      const v = value(env)
      return v === null ? null : stringValue(v, conn, COERCIBILITY.SYSCONST)
    },
    type: stringType(chars, conn, false),
  })
  switch (name) {
    case 'IF': {
      arity(3)
      const [c, x, y] = args() as [Compiled, Compiled, Compiled]
      return { eval: (r, env) => (truth(c.eval(r, env)) === true ? x.eval(r, env) : y.eval(r, env)), type: aggregate([x.type, y.type], x.type.nullable || y.type.nullable, conn) }
    }
    case 'IFNULL': {
      arity(2)
      const [x, y] = args() as [Compiled, Compiled]
      const type = aggregate([x.type, y.type], x.type.nullable && y.type.nullable, conn)
      return { eval: (r, env) => convertTo(x.eval(r, env) ?? y.eval(r, env), type), type }
    }
    case 'COALESCE': {
      if (e.args.length === 0) arity(1)
      const xs = args()
      const type = aggregate(
        xs.map((x) => x.type),
        xs.every((x) => x.type.nullable),
        conn,
      )
      return {
        eval: (r, env) => {
          for (const x of xs) {
            const v = x.eval(r, env)
            if (v !== null) return convertTo(v, type)
          }
          return null
        },
        type,
      }
    }
    case 'ANY_VALUE': {
      // A value from the group, with ONLY_FULL_GROUP_BY's check switched off for it.
      arity(1)
      const [x] = args() as [Compiled]
      return { eval: x.eval, type: expressionOf(x.type) }
    }
    case 'NULLIF': {
      arity(2)
      const [x, y] = args() as [Compiled, Compiled]
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          return compareValues(v, y.eval(r, env)) === 0 ? null : v
        },
        type: { ...expressionOf(x.type), nullable: true },
      }
    }
    case 'CONCAT': {
      if (e.args.length === 0) arity(1)
      const xs = args()
      const binary = xs.some((x) => x.type.kind === 'bytes')
      const id = binary ? CHARSET_BINARY : aggregateTypes(xs.map((x) => x.type), conn)
      // A binary argument makes the result bytes: each argument contributes
      // its own bytes, a string in its own charset, and the width is counted
      // in bytes too (8.4.11).
      const width = binary ? xs.reduce((n, x) => n + charWidth(x.type) * (x.type.kind === 'string' ? requireCollationInfo(x.type.collationId).mbmaxlen : 1), 0) : xs.reduce((n, x) => n + charWidth(x.type), 0)
      return {
        eval: (r, env) => {
          const parts: Exclude<Value, null>[] = []
          for (const x of xs) {
            const v = x.eval(r, env)
            if (v === null) return null
            parts.push(v)
          }
          if (!binary) return stringValue(parts.map(toText).join(''), id)
          const chunks = parts.map((v) => (v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v))))
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
          let at = 0
          for (const c of chunks) {
            out.set(c, at)
            at += c.length
          }
          return bytesValue(out)
        },
        // Always nullable on 8.4.11, NOT NULL arguments or not: a result past
        // `max_allowed_packet` is NULL.
        type: { ...stringType(width, id, true), coercibility: Math.min(...xs.map((x) => coercibilityOf(x.type))) },
      }
    }
    case 'LENGTH':
    case 'OCTET_LENGTH':
    case 'CHAR_LENGTH':
    case 'CHARACTER_LENGTH': {
      arity(1)
      const [x] = args() as [Compiled]
      const chars = name.startsWith('CHAR')
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          if (v.kind === 'bytes') return intValue(BigInt(v.v.length))
          const s = toText(v)
          return intValue(BigInt(chars ? [...s].length : encodeCollation(s, v.kind === 'string' ? v.collationId : 255).length))
        },
        type: intType(10, x.type.nullable),
      }
    }
    case 'LOWER':
    case 'LCASE':
    case 'UPPER':
    case 'UCASE': {
      arity(1)
      const [x] = args() as [Compiled]
      const upper = name === 'UPPER' || name === 'UCASE'
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null || v.kind === 'bytes') return v
          const s = toText(v)
          return stringValue(upper ? s.toUpperCase() : s.toLowerCase(), v.kind === 'string' ? v.collationId : conn, v.kind === 'string' ? v.coercibility : COERCIBILITY.COERCIBLE)
        },
        // Nullable whatever the argument is, as 8.4.11 reports it.
        type: x.type.kind === 'bytes' ? { ...expressionOf(x.type), nullable: true } : { ...stringType(charWidth(x.type), x.type.kind === 'string' ? x.type.collationId : conn, true), coercibility: coercibilityOf(x.type) },
      }
    }
    case 'ABS': {
      arity(1)
      const [x] = args() as [Compiled]
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          const sign = compareValues(v, intValue(0n))
          return sign !== null && sign < 0 ? negate(v) : v.kind === 'string' || v.kind === 'bytes' ? doubleValue(Math.abs(toDouble(v))) : v
        },
        type: x.type.kind === 'string' || x.type.kind === 'bytes' || x.type.kind === 'double' ? doubleType(x.type.nullable) : x.type.kind === 'int' ? intType(x.type.length, x.type.nullable, x.type.unsigned) : expressionOf(x.type),
      }
    }
    case 'VERSION':
      arity(0)
      return text(() => ctx.serverVersion, ctx.serverVersion.length)
    case 'DATABASE':
    case 'SCHEMA':
      arity(0)
      return { ...text((env) => env.session.database, 34), type: stringType(34, conn, true) }
    case 'USER':
    case 'CURRENT_USER':
    case 'SESSION_USER':
    case 'SYSTEM_USER':
      arity(0)
      return text((env) => `${env.session.user}@localhost`, 288)
    case 'CONNECTION_ID':
      arity(0)
      return { eval: (_r, env) => intValue(BigInt(env.session.connectionId), true), type: intType(10, false, true) }
    case 'LAST_INSERT_ID': {
      // BIGINT UNSIGNED, 21 wide, as 8.4.11 reports both forms. With an
      // argument it sets the value and returns it, and the INSERT or UPDATE
      // that evaluates it reports it as its `insertId` (the `UPDATE t SET id =
      // LAST_INSERT_ID(id + 1)` sequence idiom). The value is the argument's
      // `val_int()`: an integer as it is, a negative wrapped to 64 bits; any
      // other number rounded and held to the signed range — past it, 2^63 - 1,
      // below it, 1690 (8.4.11, found by review); NULL as 0.
      if (e.args.length === 0) return { eval: (_r, env) => intValue(env.state.lastInsertId, true), type: intType(21, false, true) }
      arity(1)
      const [x] = args() as [Compiled]
      const self = deparse(e)
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          let n = v === null ? 0n : toInteger(v)
          // An integer past 64 bits is a DECIMAL to MySQL, so it saturates too.
          if (v !== null && (v.kind !== 'int' || n > 2n ** 64n - 1n || n < -MAX_SIGNED - 1n)) {
            if (n > MAX_SIGNED) n = MAX_SIGNED
            else if (n < -MAX_SIGNED - 1n) throw sqlError('ER_DATA_OUT_OF_RANGE', `BIGINT value is out of range in '${self}'`)
          }
          env.state.lastInsertId = BigInt.asUintN(64, n)
          env.state.insertIdSet = true
          return v === null ? null : intValue(env.state.lastInsertId, true)
        },
        type: intType(21, x.type.nullable, true),
      }
    }
    case 'VALUES': {
      // Deprecated in 8.4 in favour of the row alias, and still answered.
      arity(1)
      const target = e.args[0] as Expression
      if (target.kind !== NODE.COLUMN) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
      const iv = ctx.insertValues
      if (iv === undefined) return lit(null, NULL_TYPE)
      iv.calls++
      const { index, type } = iv.resolve(target.parts[target.parts.length - 1] as string)
      return { eval: (row) => row[index] ?? null, type }
    }
    case 'ROW_COUNT':
      arity(0)
      return { eval: (_r, env) => intValue(env.state.rowCount), type: intType(21, false) }
    case 'NOW':
    case 'CURRENT_TIMESTAMP':
    case 'LOCALTIME':
    case 'LOCALTIMESTAMP':
    case 'SYSDATE':
    case 'UTC_TIMESTAMP': {
      const fsp = fspArgument(e, ctx)
      return { eval: (_r, env) => ({ kind: 'datetime', v: clock(env.now, fsp), type: 'DATETIME', fsp }), type: datetimeType(FIELD_TYPE.DATETIME, fsp, false) }
    }
    case 'CURDATE':
    case 'CURRENT_DATE':
    case 'UTC_DATE':
      arity(0)
      return { eval: (_r, env) => ({ kind: 'datetime', v: { ...clock(env.now, 0), hour: 0, minute: 0, second: 0 }, type: 'DATE', fsp: 0 }), type: datetimeType(FIELD_TYPE.DATE, 0, false) }
    case 'CURTIME':
    case 'CURRENT_TIME':
    case 'UTC_TIME': {
      const fsp = fspArgument(e, ctx)
      return {
        eval: (_r, env) => {
          const d = clock(env.now, fsp)
          return { kind: 'time', v: { negative: false, days: 0, hour: d.hour, minute: d.minute, second: d.second, microsecond: d.microsecond }, fsp }
        },
        type: datetimeType(FIELD_TYPE.TIME, fsp, false),
      }
    }
    default:
      if (KNOWN_BUILTINS.has(name)) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The function ${name}`))
      throw sqlError('ER_SP_DOES_NOT_EXIST', `FUNCTION ${ctx.session.database ?? ''}.${e.name} does not exist`)
  }
}

function fspArgument(e: CallNode, ctx: CompileContext): number {
  if (e.args.length === 0) return 0
  const v = compile(e.args[0] as Expression, ctx).eval([], { params: ctx.params ?? [], now: new Date(0), session: ctx.session, state: ctx.state })
  const n = v === null ? 0 : Number(toInteger(v))
  if (n < 0 || n > 6) throw sqlError('ER_TOO_BIG_PRECISION', `Too-big precision ${n} specified for '${e.name}'. Maximum is 6.`)
  return n
}

/** The session's clock, in UTC (the `time_zone` this executor runs in). */
function clock(now: Date, fsp: number): MysqlDateTime {
  const us = (now.getUTCMilliseconds() * 1000)
  const unit = 10 ** (6 - fsp)
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
    second: now.getUTCSeconds(),
    microsecond: Math.floor(us / unit) * unit,
  }
}

function cast(e: CastNode, ctx: CompileContext): Compiled {
  const inner = compile(e.expr, ctx)
  const x = inner.eval
  const nullable = inner.type.nullable
  const t = e.type
  switch (t.name) {
    case 'CHAR':
    case 'NCHAR':
    case 'VARCHAR': {
      const id = t.charset === undefined ? ctx.connectionCollation : (defaultCollationOf(t.charset.toLowerCase())?.id ?? ctx.connectionCollation)
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          const s = toText(v)
          return stringValue(t.length === undefined ? s : [...s].slice(0, t.length).join(''), id, COERCIBILITY.IMPLICIT)
        },
        // Nullable whatever its argument, as 8.4.11 reports it.
        type: stringType(t.length ?? charWidth(inner.type), id, true),
      }
    }
    case 'BINARY':
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          const b = v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v))
          return bytesValue(t.length === undefined ? b : b.subarray(0, t.length))
        },
        type: stringType(t.length ?? charWidth(inner.type), CHARSET_BINARY, nullable),
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
          const n = toInteger(v)
          const mask = (1n << 64n) - 1n
          return unsigned ? intValue(n & mask, true) : intValue(n > (1n << 63n) - 1n ? n - (1n << 64n) : n)
        },
        type: intType(unsigned ? 20 : 21, nullable, unsigned),
      }
    }
    case 'DECIMAL': {
      const precision = t.length ?? 10
      const scale = t.scale ?? 0
      return {
        eval: (r, env) => {
          const v = x(r, env)
          return v === null ? null : rescale(toDecimal(v), scale)
        },
        type: decimalType(precision, scale, nullable),
      }
    }
    case 'DOUBLE':
    case 'FLOAT':
    case 'REAL':
      return { eval: (r, env) => { const v = x(r, env); return v === null ? null : doubleValue(toDouble(v)) }, type: doubleType(nullable) }
    case 'DATE':
    case 'DATETIME': {
      const type = t.name === 'DATE' ? 'DATE' : 'DATETIME'
      const fsp = type === 'DATE' ? 0 : (t.length ?? 0)
      return {
        eval: (r, env) => {
          const v = x(r, env)
          if (v === null) return null
          const d = toDateTime(v, type)
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

/** A subquery's plan, with the enclosing scope its correlated names resolve in. */
function planned(e: SubqueryNode, ctx: CompileContext): SubqueryPlan {
  if (ctx.subquery === undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Subqueries here'))
  return ctx.subquery(e.query, ctx.scope)
}

/** Its rows for this outer row: run again for each if correlated, else once per statement. */
function rowsOf(plan: SubqueryPlan, key: object, row: Row, env: Env): readonly (readonly Value[])[] {
  if (!plan.correlated && env.memo !== undefined) {
    const hit = env.memo.get(key) as (readonly Value[])[] | undefined
    if (hit !== undefined) return hit
    const all = [...plan.rows(env)]
    env.memo.set(key, all)
    return all
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
      return rows[0]?.[0] ?? null
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
function quantified(op: string, quantifier: 'ANY' | 'ALL', left: Expression, right: SubqueryNode, ctx: CompileContext, label: string): Compiled {
  void label
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
  return {
    eval: (row, env) => {
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
    },
    type: boolType(true),
  }
}

/** The collation a store into a column of `columnCollation` converts a string to. */
export function textForColumn(v: Value, columnCollation: number): Value {
  if (v === null || v.kind !== 'string' || v.collationId === columnCollation) return v
  return stringValue(v.v, columnCollation, COERCIBILITY.IMPLICIT)
}

