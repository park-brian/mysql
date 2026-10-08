// M5.5 — GROUP BY, the aggregate functions, HAVING and WITH ROLLUP.
//
// A grouped query runs in two halves. Below the grouping, every expression is
// compiled against the FROM row as usual; that is the WHERE, the GROUP BY keys
// and the arguments of every aggregate. Above it, the select list, HAVING and
// ORDER BY are compiled against a *grouped row*:
//
//     [ the group's first row (W) | its key values (K) | rollup level | aggregates… ]
//
// so a bare column reads the first row of its group (MySQL's choice, which
// ONLY_FULL_GROUP_BY makes safe by refusing a column that could differ within
// the group), a ROLLUP key reads its key slot (NULL in a super-aggregate row),
// and an aggregate reads its result. The row loop still never walks the tree
// (D-63).
//
// **How MySQL groups decides what a client sees**, both the order of the
// groups and their metadata, so the strategy is chosen as 8.4.11 chooses it
// (M5.18's probes):
//
//   - `index`: the keys are the leading columns of an index, in its order, on
//     a single table. The rows are read in that index's order and each group
//     streams out as it ends ("Group aggregate"). Columns keep their flags.
//   - `sort`: WITH ROLLUP, or a DISTINCT aggregate, without such an index.
//     The rows are sorted on the keys first, so the groups come out in key
//     order, NULL first.
//   - `temp`: anything else ("Aggregate using temporary table"). The groups
//     come out in the order their first rows arrived, and the columns go
//     through the temporary table, which costs them their key flags as it does
//     `SELECT DISTINCT`'s (E-17, E-19), and an expression everything but
//     NOT_NULL: `COUNT(*)` is 0x81 by index and 0x01 by temporary table.
//   - `implicit`: aggregates and no GROUP BY. One row, whatever the input.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { TableDef } from '@myjs/engine'
import { NODE, deparse, type CallNode, type Expression } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import {
  avgAccumulator,
  avgPrecision,
  bitAccumulator,
  bytesValue,
  extremeAccumulator,
  intValue,
  jsonObject,
  jsonValue,
  orderValues,
  sortValues,
  stringValue,
  sumAccumulator,
  sumPrecision,
  toInteger,
  toText,
  varianceAccumulator,
  type Accumulator,
  type JsonDoc,
  type Value,
} from '@myjs/types'
import { AGGREGATE_NAMES, asNumber, compile, type CompileContext, type Compiled, type Env, type Row } from './compile.ts'
import { rowKey, valueKey } from './keys.ts'
import { asJson } from './json.ts'
import { decimalType, doubleType, floatLength, intType, jsonType, stringType, type ResultType } from './meta.ts'
import type { SortKey } from './operators.ts'

export const isAggregate = (e: Expression): boolean => e.kind === NODE.CALL && e.over === undefined && AGGREGATE_NAMES.has(e.name.toUpperCase())

/** Whether `e` holds an aggregate of its own query — not one inside a subquery, which aggregates there. */
export function containsAggregate(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const node = e as { kind?: string }
  if (node.kind === NODE.SUBQUERY) return false
  if (node.kind === NODE.CALL && isAggregate(node as Expression)) return true
  for (const v of Object.values(e)) {
    if (Array.isArray(v)) {
      if (v.some((x) => containsAggregate(x))) return true
    } else if (typeof v === 'object' && containsAggregate(v)) return true
  }
  return false
}

// --- types ------------------------------------------------------------------------

/** The digits of an integer type, its sign aside. */
const intPrecision = (t: ResultType): number => (t.unsigned ? t.length : t.length - 1)

/** The digits a temporal is as a number: a DATE is 8, a DATETIME 14, a TIME 7, and each fractional digit one more. */
function temporalPrecision(t: ResultType): number {
  if (t.field === FIELD_TYPE.DATE || t.field === FIELD_TYPE.NEWDATE) return 8
  if (t.field === FIELD_TYPE.TIME) return 7 + t.scale
  if (t.field === FIELD_TYPE.YEAR) return 4
  return 14 + t.scale
}

/** The precision and scale an argument has as a DECIMAL, or `undefined` for one that sums as a double. */
function exactShape(t: ResultType): { precision: number; scale: number } | undefined {
  // A hex literal sums as the unsigned integer it is.
  if (t.literalInt !== undefined) return { precision: t.literalInt.digits, scale: 0 }
  switch (t.kind) {
    case 'int':
      return { precision: intPrecision(t), scale: 0 }
    case 'decimal':
      return { precision: t.length, scale: t.scale }
    case 'datetime':
    case 'time':
      return { precision: temporalPrecision(t), scale: t.field === FIELD_TYPE.DATE ? 0 : t.scale }
    default:
      return undefined
  }
}

/** `CONVERT_IF_BIGGER_TO_BLOB`, `sql/field.h`: a result wider than this many characters is a BLOB. */
const CONVERT_IF_BIGGER_TO_BLOB = 512

/**
 * The type an aggregate reports, as 8.4.11 reports it for an argument of
 * each type. `GROUP_CONCAT` is the strange one: `group_concat_max_len`
 * characters as a VARCHAR, or past 512 a BLOB (type 251) whose length is that
 * times the argument's `mbmaxlen` squared times the result's — 65,536 for the
 * default 1,024 over utf8mb4, 4,096 over latin1, and 1,024 over bytes.
 */
export function aggregateType(name: string, args: readonly Compiled[], ctx: CompileContext): ResultType {
  const t = args[0]?.type
  switch (name) {
    case 'COUNT':
      return intType(21, false)
    case 'SUM': {
      const shape = t === undefined ? undefined : exactShape(t)
      if (shape === undefined) return t?.kind === 'double' ? floatLength(t.scale, true) : doubleType(true, 23)
      return decimalType(sumPrecision(shape.precision), shape.scale, true)
    }
    case 'AVG': {
      const shape = t === undefined ? undefined : exactShape(t)
      // AVG of a FLOAT(M,D) keeps D + div_precision_increment decimals.
      if (shape === undefined) return { ...(t?.kind === 'double' ? floatLength(Math.min(31, t.scale + 4), true) : doubleType(true, 23)), ownInTemporary: true }
      const p = avgPrecision(shape.precision, shape.scale)
      return { ...decimalType(p.precision, p.scale, true), ownInTemporary: true }
    }
    case 'MIN':
    case 'MAX':
      return extremeType(t as ResultType)
    case 'BIT_AND':
    case 'BIT_OR':
    case 'BIT_XOR':
      return { ...intType(21, false, true), ownInTemporary: true }
    case 'JSON_ARRAYAGG':
    case 'JSON_OBJECTAGG':
      return jsonType(true)
    case 'GROUP_CONCAT': {
      const max = Number(maxLength(ctx))
      const binary = args.some((a) => a.type.kind === 'bytes')
      const collationId = binary ? CHARSET_BINARY : (args.find((a) => a.type.kind === 'string')?.type.collationId ?? ctx.connectionCollation)
      const argMb = binary ? 1 : requireCollationInfo(collationId).mbmaxlen
      if (max <= CONVERT_IF_BIGGER_TO_BLOB) return stringType(max, collationId, true)
      const resultMb = binary ? 1 : requireCollationInfo(ctx.session.characterSet).mbmaxlen
      return { ...stringType(max, collationId, true), field: FIELD_TYPE.LONG_BLOB, wireLength: Math.min(4294967295, max * argMb * argMb * resultMb) }
    }
    default:
      // The variance family.
      return { ...doubleType(true, 23), ownInTemporary: true }
  }
}

/**
 * `MIN` and `MAX` keep their argument's field type and width, as an
 * expression rather than a column, and nullable. A temporal is reported in
 * the result charset, 4 bytes a character, without BINARY — `MIN(date_col)`
 * is type DATE, utf8mb4, 40 wide on 8.4.11.
 */
function extremeType(t: ResultType): ResultType {
  const { column, blobBytes, temporary: _t, ...rest } = t
  const fieldFlags = column === undefined ? {} : { fieldFlags: column.flags }
  if (t.kind === 'datetime' || t.kind === 'time') return { ...rest, ...fieldFlags, nullable: true, asText: true }
  if (blobBytes !== undefined && t.kind === 'string') return { ...rest, ...fieldFlags, nullable: true, length: blobBytes * requireCollationInfo(t.collationId).mbmaxlen }
  return { ...rest, ...fieldFlags, nullable: true }
}

const maxLength = (ctx: CompileContext): bigint => {
  const v = ctx.state.systemVariable('group_concat_max_len', undefined, ctx.session)
  return v === undefined || v === null ? 1024n : toInteger(v)
}

// --- the aggregates in a statement ---------------------------------------------

export interface AggregateSpec {
  readonly name: string
  readonly type: ResultType
  /** A fresh accumulator, for one group. */
  start(): AggregateState
}

export interface AggregateState {
  add(row: Row, env: Env): void
  result(): Value
}

/**
 * Where a grouped query's aggregates are collected as its select list, HAVING
 * and ORDER BY compile. Each distinct call (by its text) gets one slot in the
 * grouped row; its arguments compile against the FROM row.
 */
export class AggregateSink {
  readonly specs: AggregateSpec[] = []
  readonly #seen = new Map<string, number>()
  readonly #rowCtx: CompileContext
  readonly #base: number

  /** `rowCtx` compiles arguments; `base` is the grouped-row slot of the first aggregate. */
  constructor(rowCtx: CompileContext, base: number) {
    this.#rowCtx = rowCtx
    this.#base = base
  }

  /** The slot of the aggregate `e`, collecting it if it is new. `ctx` is the caller's, which names the clause. */
  register(e: CallNode, ctx: CompileContext): Compiled {
    const key = deparse(e)
    let at = this.#seen.get(key)
    if (at === undefined) {
      at = this.specs.length
      this.specs.push(this.#spec(e, ctx.clause))
      this.#seen.set(key, at)
    }
    const slot = this.#base + at
    return { eval: (row) => row[slot] ?? null, type: (this.specs[at] as AggregateSpec).type }
  }

  #spec(e: CallNode, clause: string): AggregateSpec {
    const name = e.name.toUpperCase()
    const ctx: CompileContext = { ...this.#rowCtx, clause, inAggregate: true }
    const star = e.args.length === 1 && e.args[0]?.kind === NODE.COLUMN && e.args[0].parts.length === 1 && e.args[0].parts[0] === '*'
    if (star && name !== 'COUNT') throw sqlError('ER_PARSE_ERROR', messages.parseError('*', 1))
    // The numeric aggregates read text as doubles, a warning each time one is not (1292).
    const numeric = name === 'SUM' || name === 'AVG' || /^(STD|STDDEV|STDDEV_POP|STDDEV_SAMP|VARIANCE|VAR_POP|VAR_SAMP)$/.test(name)
    const args = star ? [] : e.args.map((a) => (numeric ? asNumber(compile(a, ctx), 'DOUBLE') : compile(a, ctx)))
    const arity = name === 'COUNT' || name === 'GROUP_CONCAT' ? args.length >= 1 || star : name === 'JSON_OBJECTAGG' ? args.length === 2 : args.length === 1
    if (!arity) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
    const type = aggregateType(name, args, ctx)
    const distinct = e.distinct === true
    const evalArgs = (row: Row, env: Env): Value[] | undefined => {
      const out: Value[] = []
      for (const a of args) {
        const v = a.eval(row, env)
        if (v === null) return undefined
        out.push(v)
      }
      return out
    }
    switch (name) {
      case 'COUNT':
        return {
          name,
          type,
          start() {
            let n = 0n
            const seen = distinct ? new Set<string>() : undefined
            return {
              add(row, env) {
                if (star) {
                  n++
                  return
                }
                const vs = evalArgs(row, env)
                if (vs === undefined) return
                if (seen !== undefined) {
                  const k = rowKey(vs)
                  if (seen.has(k)) return
                  seen.add(k)
                }
                n++
              },
              result: () => intValue(n),
            }
          },
        }
      case 'GROUP_CONCAT':
        return groupConcat(e, args, type, distinct, ctx)
      case 'JSON_ARRAYAGG':
      case 'JSON_OBJECTAGG':
        return jsonAggregate(name, args, type)
      default: {
        const arg = args[0] as Compiled
        const make = (): Accumulator => accumulator(name, arg.type)
        return {
          name,
          type,
          start() {
            const acc = make()
            const seen = distinct ? new Set<string>() : undefined
            return {
              add(row, env) {
                const v = arg.eval(row, env)
                if (v === null) return
                if (seen !== undefined) {
                  const k = valueKey(v)
                  if (seen.has(k)) return
                  seen.add(k)
                }
                acc.add(v)
              },
              result: () => acc.result(),
            }
          },
        }
      }
    }
  }
}

/**
 * `JSON_ARRAYAGG(x)` and `JSON_OBJECTAGG(k, v)` (M5.21): every row's value, a
 * NULL one as JSON null; the object refuses a NULL key (3158) and keeps the
 * last value of a key seen twice. Over no rows, NULL.
 */
function jsonAggregate(name: string, args: readonly Compiled[], type: ResultType): AggregateSpec {
  const [a, b] = args as [Compiled, Compiled | undefined]
  return {
    name,
    type,
    start() {
      const items: JsonDoc[] = []
      const members: [string, JsonDoc][] = []
      let rows = 0
      return {
        add(row, env) {
          rows++
          if (b === undefined) {
            items.push(asJson(a.eval(row, env), a.type))
            return
          }
          const k = a.eval(row, env)
          if (k === null) throw sqlError('ER_JSON_DOCUMENT_NULL_KEY', 'JSON documents may not contain NULL member names.')
          members.push([toText(k), asJson(b.eval(row, env), b.type)])
        },
        result: () => (rows === 0 ? null : jsonValue(b === undefined ? { t: 'array', v: items } : jsonObject(members))),
      }
    },
  }
}

function accumulator(name: string, t: ResultType): Accumulator {
  const shape = exactShape(t)
  switch (name) {
    case 'SUM':
      return sumAccumulator(shape !== undefined)
    case 'AVG':
      return avgAccumulator(shape !== undefined, shape?.scale ?? 0)
    case 'MIN':
      return extremeAccumulator(false)
    case 'MAX':
      return extremeAccumulator(true)
    case 'BIT_AND':
      return bitAccumulator('AND')
    case 'BIT_OR':
      return bitAccumulator('OR')
    case 'BIT_XOR':
      return bitAccumulator('XOR')
    case 'VAR_SAMP':
      return varianceAccumulator(true, false)
    case 'STDDEV_SAMP':
      return varianceAccumulator(true, true)
    case 'VARIANCE':
    case 'VAR_POP':
      return varianceAccumulator(false, false)
    default:
      // STD, STDDEV, STDDEV_POP.
      return varianceAccumulator(false, true)
  }
}

/**
 * `GROUP_CONCAT([DISTINCT] a, b … [ORDER BY …] [SEPARATOR s])`: each row's
 * arguments concatenated, the rows joined by the separator (`,`), a row with a
 * NULL argument skipped, and the result cut at `group_concat_max_len` bytes.
 */
function groupConcat(e: CallNode, args: readonly Compiled[], type: ResultType, distinct: boolean, ctx: CompileContext): AggregateSpec {
  const order: SortKey[] = (e.orderBy ?? []).map((o) => {
    // A position names an argument, as in `GROUP_CONCAT(a ORDER BY 1)`.
    if (o.expr.kind === NODE.LITERAL && o.expr.type === 'int') {
      const arg = args[Number(o.expr.value as bigint) - 1]
      if (arg === undefined) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(String(o.expr.value), 'order clause'))
      return { expr: arg, desc: o.desc === true }
    }
    return { expr: compile(o.expr, ctx), desc: o.desc === true }
  })
  const separator = e.separator ?? ','
  const binary = type.kind === 'bytes'
  const collationId = type.collationId
  const max = Number(maxLength(ctx))
  return {
    name: 'GROUP_CONCAT',
    type,
    start() {
      const entries: { text: string; keys: Value[]; at: number }[] = []
      const seen = distinct ? new Set<string>() : undefined
      return {
        add(row, env) {
          const vs: Value[] = []
          for (const a of args) {
            const v = a.eval(row, env)
            if (v === null) return
            vs.push(v)
          }
          if (seen !== undefined) {
            const k = rowKey(vs)
            if (seen.has(k)) return
            seen.add(k)
          }
          entries.push({ text: vs.map((v) => toText(v as Exclude<Value, null>)).join(''), keys: order.map((o) => o.expr.eval(row, env)), at: entries.length })
        },
        result() {
          if (entries.length === 0) return null
          if (order.length > 0) {
            entries.sort((a, b) => {
              for (let i = 0; i < order.length; i++) {
                const c = sortValues(a.keys[i] ?? null, b.keys[i] ?? null)
                if (c !== 0) return (order[i] as SortKey).desc ? -c : c
              }
              return a.at - b.at
            })
          }
          let text = entries.map((x) => x.text).join(separator)
          const bytes = encodeCollation(text, binary ? 63 : collationId)
          if (bytes.length > max) text = new TextDecoder().decode(bytes.subarray(0, max)).replace(/�$/, '')
          return binary ? bytesValue(encodeCollation(text, 63)) : stringValue(text, collationId)
        },
      }
    },
  }
}

// --- the grouping itself ------------------------------------------------------------

export type GroupStrategy = 'implicit' | 'temp' | 'sort' | 'index'

export interface GroupPlan {
  /** The FROM row's width: the grouped row starts with the group's first row. */
  readonly width: number
  readonly keys: readonly Compiled[]
  readonly specs: readonly AggregateSpec[]
  readonly strategy: GroupStrategy
  readonly rollup: boolean
}

/** Where a grouped row keeps its rollup level: how many leading keys it still groups by. */
export const levelSlot = (plan: { readonly width: number; readonly keys: readonly unknown[] }): number => plan.width + plan.keys.length

/** The rows of a grouped query, one per group (and per super-aggregate under ROLLUP). */
export function* groupRows(source: Iterable<{ readonly row: Row }>, plan: GroupPlan, env: Env): Generator<{ readonly row: Row }> {
  const K = plan.keys.length
  const compose = (first: Row | undefined, keys: readonly Value[], level: number, states: readonly AggregateState[]): { row: Row } => {
    const row: Value[] = first === undefined ? new Array<Value>(plan.width).fill(null) : first.slice(0, plan.width)
    for (let i = 0; i < K; i++) row.push(i < level ? (keys[i] ?? null) : null)
    row.push(intValue(BigInt(level)))
    for (const s of states) row.push(s.result())
    return { row }
  }
  const start = (): AggregateState[] => plan.specs.map((s) => s.start())
  const keysOf = (row: Row): Value[] => plan.keys.map((k) => k.eval(row, env))

  if (plan.strategy === 'implicit') {
    const states = start()
    let first: Row | undefined
    for (const { row } of source) {
      if (first === undefined) first = row
      for (const s of states) s.add(row, env)
    }
    if (K === 0) {
      yield compose(first, [], 0, states)
      return
    }
    // A GROUP BY whose every key the WHERE pins is one group, with the
    // metadata of no grouping at all — but no rows in, no rows out, and ROLLUP
    // still adds its super-aggregates (8.4.11).
    if (first === undefined) return
    const keys = keysOf(first)
    for (let level = K; level >= (plan.rollup ? 0 : K); level--) yield compose(first, keys, level, states)
    return
  }

  if (plan.strategy === 'temp' && !plan.rollup) {
    const groups = new Map<string, { first: Row; keys: Value[]; states: AggregateState[] }>()
    for (const { row } of source) {
      const keys = keysOf(row)
      const k = rowKey(keys)
      let g = groups.get(k)
      if (g === undefined) {
        g = { first: row, keys, states: start() }
        groups.set(k, g)
      }
      for (const s of g.states) s.add(row, env)
    }
    for (const g of groups.values()) yield compose(g.first, g.keys, K, g.states)
    return
  }

  // Sorted input — by an index, or sorted here — streams: a group ends when
  // its keys change, and under ROLLUP so does every level below the first key
  // that changed.
  let input: Iterable<{ readonly row: Row; readonly keys: Value[] }>
  if (plan.strategy === 'index') input = (function* () {
    for (const { row } of source) yield { row, keys: keysOf(row) }
  })()
  else {
    const all = [...source].map(({ row }, at) => ({ row, keys: keysOf(row), at }))
    all.sort((a, b) => {
      for (let i = 0; i < K; i++) {
        const c = sortValues(a.keys[i] ?? null, b.keys[i] ?? null)
        if (c !== 0) return c
      }
      return a.at - b.at
    })
    input = all
  }
  const levels = plan.rollup ? K : 0
  let current: { keys: Value[]; firsts: Row[]; states: AggregateState[][] } | undefined
  const flush = function* (down: number): Generator<{ row: Row }> {
    if (current === undefined) return
    // Levels K, K-1, … down to `down`, finest first.
    for (let level = K; level >= down; level--) {
      const i = K - level
      if (level < K && !plan.rollup) break
      yield compose(current.firsts[i], current.keys, level, current.states[i] as AggregateState[])
    }
  }
  for (const item of input) {
    if (current === undefined) {
      current = { keys: item.keys, firsts: Array.from({ length: levels + 1 }, () => item.row), states: Array.from({ length: levels + 1 }, start) }
    } else {
      let j = 0
      while (j < K && valueKey(item.keys[j] ?? null) === valueKey(current.keys[j] ?? null)) j++
      if (j < K) {
        // Levels deeper than j end here: emit them, then start them afresh.
        yield* flush(j + 1)
        for (let level = K; level > j; level--) {
          const i = K - level
          if (i > levels) continue
          current.firsts[i] = item.row
          current.states[i] = start()
        }
        current.keys = item.keys
      }
    }
    for (const states of current.states) for (const s of states) s.add(item.row, env)
  }
  if (current !== undefined) yield* flush(plan.rollup ? 0 : K)
  else if (plan.rollup && K > 0) {
    // ROLLUP over no rows has no grand total either (8.4.11).
  }
}

/**
 * The strategy 8.4.11 uses for a GROUP BY over one table: an index whose
 * leading columns are the keys in order, if one exists; a sort for ROLLUP, a
 * DISTINCT aggregate or a GROUP_CONCAT, none of which an aggregating
 * temporary table can hold; a temporary table otherwise.
 */
export function chooseStrategy(def: TableDef | undefined, keyColumns: readonly (string | undefined)[], rollup: boolean, distinctAggregate: boolean): { strategy: GroupStrategy; index?: string } {
  if (keyColumns.length === 0) return { strategy: 'implicit' }
  if (def !== undefined && keyColumns.every((c) => c !== undefined)) {
    const pk = def.indexes.find((i) => i.kind === 'primary' || i.name === def.clustered)
    const ordered = def.indexes.filter((i) => i.invisible !== true).sort((a, b) => (a === pk ? -1 : b === pk ? 1 : 0))
    for (const index of ordered) {
      // A secondary index carries the clustered key after its own parts.
      const parts = [...index.parts, ...(index === pk || pk === undefined ? [] : pk.parts.filter((p) => !index.parts.some((q) => q.column === p.column)))]
      if (parts.length < keyColumns.length) continue
      if (parts.slice(0, keyColumns.length).every((p, i) => p.prefix === undefined && p.descending !== true && p.column.toLowerCase() === (keyColumns[i] as string).toLowerCase())) {
        return { strategy: 'index', index: index.name }
      }
    }
  }
  if (rollup || distinctAggregate) return { strategy: 'sort' }
  return { strategy: 'temp' }
}
