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
import { CHARSET_BINARY, FIELD_TYPE, concatBytes } from '@myjs/bytes'
import { encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { TableDef } from '@myjs/engine'
import { NODE, deparse, type CallNode, type Expression } from '@myjs/parser'
import { nativeCallName, someNode } from './ast.ts'
import { unknownColumnError } from './scope.ts'
import { clusteredIndex, indexParts } from './indexes.ts'
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
  valueBytes,
} from '@myjs/types'
import { AGGREGATE_NAMES, asNumber, compile, decimalField, readSlot, type CompileContext, type Compiled, type Env, type Row } from './compile.ts'
import { firstKey, rowKey, valueKey } from './keys.ts'
import { wrongParameterCount } from './registry.ts'
import { asJson } from './json.ts'
import { decimalType, doubleType, floatLength, intType, jsonType, stringType, type ResultType } from './meta.ts'
import type { SortKey } from './operators.ts'

export const isAggregate = (e: Expression): boolean => e.kind === NODE.CALL && e.over === undefined && AGGREGATE_NAMES.has(nativeCallName(e))

/** Whether `e` holds an aggregate of its own query — not one inside a subquery, which aggregates there. */
export function containsAggregate(e: unknown): boolean {
  return someNode(e, (value) => {
    const node = value as { kind?: string }
    if (node.kind === NODE.SUBQUERY) return false
    if (node.kind === NODE.CALL && isAggregate(node as Expression)) return true
    return undefined
  })
}

// --- types ------------------------------------------------------------------------

/** The precision and scale an argument has as a DECIMAL, or `undefined` for one that sums as a double. */
function exactShape(t: ResultType): { precision: number; scale: number } | undefined {
  // A hex literal sums as the unsigned integer it is.
  if (t.literalInt !== undefined) return { precision: t.literalInt.digits, scale: 0 }
  switch (t.kind) {
    case 'int':
      return { precision: t.length - (t.unsigned ? 0 : 1), scale: 0 }
    case 'decimal':
      return { precision: t.length, scale: t.scale }
    case 'datetime':
    case 'time': {
      const date = t.field === FIELD_TYPE.DATE || t.field === FIELD_TYPE.NEWDATE
      return { precision: date ? 8 : (t.kind === 'time' ? 7 : 14) + t.scale, scale: date ? 0 : t.scale }
    }
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
function aggregateType(name: string, args: readonly Compiled[], ctx: CompileContext): ResultType {
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
  /** A fresh accumulator; only the actual temporary-group writer requests stored state. */
  start(temporary?: boolean): AggregateState
}

export interface AggregateState {
  add(row: Row, env: Env): void
  result(): Value
}

type GroupSlot = AggregateSpec & Compiled

/**
 * Where a grouped query's aggregates are collected as its select list, HAVING
 * and ORDER BY compile. Each distinct call (by its text) gets one slot in the
 * grouped row; its arguments compile against the FROM row. The slot descriptor
 * owns both its accumulator definition and its unchanged result reader.
 */
export class AggregateSink {
  readonly specs: GroupSlot[] = []
  readonly #seen = new Map<string, GroupSlot>()
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
    let slot = this.#seen.get(key)
    if (slot === undefined) {
      const index = this.#base + this.specs.length
      const spec = this.#spec(e, ctx.clause)
      slot = Object.assign(spec, readSlot(index, spec.type))
      this.specs.push(slot)
      this.#seen.set(key, slot)
    }
    return slot
  }

  /** An aggregate's spec without a slot: a window's (window.ts), which runs it over each row's frame. */
  specFor(e: CallNode, clause: string, overGroups = false): AggregateSpec {
    return this.#spec(e, clause, overGroups)
  }

  /** `overGroups`: a window's over a grouped query, whose argument may be the group's own aggregate. */
  #spec(e: CallNode, clause: string, overGroups = false): AggregateSpec {
    const name = nativeCallName(e)
    const ctx: CompileContext = { ...this.#rowCtx, clause, ...(overGroups ? {} : { inAggregate: true }) }
    const star = e.args.length === 1 && e.args[0]?.kind === NODE.COLUMN && e.args[0].parts.length === 1 && e.args[0].parts[0] === '*'
    if (star && name !== 'COUNT') throw sqlError('ER_PARSE_ERROR', messages.parseError('*', 1))
    // The numeric aggregates read text as doubles, a warning each time one is not (1292).
    const numeric = name === 'SUM' || name === 'AVG' || /^(STD|STDDEV|STDDEV_POP|STDDEV_SAMP|VARIANCE|VAR_POP|VAR_SAMP)$/.test(name)
    const args = star ? [] : e.args.map((a) => (numeric ? asNumber(compile(a, ctx), 'DOUBLE') : compile(a, ctx)))
    const arity = name === 'COUNT' || name === 'GROUP_CONCAT' ? args.length >= 1 || star : name === 'JSON_OBJECTAGG' ? args.length === 2 : args.length === 1
    if (!arity) throw wrongParameterCount(e.name)
    const type = aggregateType(name, args, ctx)
    const distinct = e.distinct === true
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
                const vs = argumentValues(args, row, env)
                if (vs === undefined) return
                if (seen !== undefined && !firstKey(seen, rowKey(vs))) return
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
        const source = args[0] as Compiled
        // DISTINCT AVG copies its DECIMAL argument before either keying or addition.
        const arg = distinct && name === 'AVG' ? decimalField(source) : source
        return {
          name,
          type,
          start(temporary) {
            const acc = accumulator(name, arg.type, temporary)
            const seen = distinct ? new Set<string>() : undefined
            return {
              add(row, env) {
                const v = arg.eval(row, env)
                if (v === null) return
                if (seen !== undefined && !firstKey(seen, valueKey(v))) return
                acc.add(v)
              },
              result: acc.result,
            }
          },
        }
      }
    }
  }
}

/** Evaluate arguments in order, stopping at the first NULL. */
function argumentValues(args: readonly Compiled[], row: Row, env: Env): Value[] | undefined {
  const out: Value[] = []
  for (const a of args) {
    const v = a.eval(row, env)
    if (v === null) return undefined
    out.push(v)
  }
  return out
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
        // A copy: a window reads the result again after more rows are added.
        result: () => (rows === 0 ? null : jsonValue(b === undefined ? { t: 'array', v: items.slice() } : jsonObject(members.slice()))),
      }
    },
  }
}

function accumulator(name: string, t: ResultType, temporary?: boolean): Accumulator {
  switch (name) {
    case 'SUM':
      return sumAccumulator(exactShape(t) !== undefined)
    case 'AVG': {
      const shape = exactShape(t)
      return avgAccumulator(shape !== undefined, shape?.scale ?? 0, temporary ? shape?.scale : undefined)
    }
    case 'MIN':
    case 'MAX':
      return extremeAccumulator(name === 'MAX', t.kind === 'time')
    case 'BIT_AND':
    case 'BIT_OR':
    case 'BIT_XOR':
      return bitAccumulator(name.slice(4) as 'AND' | 'OR' | 'XOR')
    default:
      // The VAR/STD families share the sample suffix and standard-deviation prefix.
      return varianceAccumulator(name.endsWith('_SAMP'), name.startsWith('STD'))
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
      if (arg === undefined) throw unknownColumnError(String(o.expr.value), 'order clause')
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
      const entries: { text: string; bytes: Uint8Array | undefined; keys: Value[] }[] = []
      const seen = distinct ? new Set<string>() : undefined
      return {
        add(row, env) {
          const vs = argumentValues(args, row, env)
          if (vs === undefined) return
          if (seen !== undefined && !firstKey(seen, rowKey(vs))) return
          // A binary result joins bytes, which need not be text in any charset.
          const parts = vs as Exclude<Value, null>[]
          entries.push({ text: binary ? '' : parts.map(toText).join(''), bytes: binary ? concatBytes(parts.map(valueBytes)) : undefined, keys: order.map((o) => o.expr.eval(row, env)) })
        },
        result() {
          if (entries.length === 0) return null
          if (order.length > 0) {
            entries.sort((a, b) => {
              for (let i = 0; i < order.length; i++) {
                const c = sortValues(a.keys[i] ?? null, b.keys[i] ?? null)
                if (c !== 0) return (order[i] as SortKey).desc ? -c : c
              }
              return 0
            })
          }
          if (binary) {
            const sep = new TextEncoder().encode(separator)
            const all = concatBytes(entries.flatMap((x, i) => (i === 0 ? [x.bytes as Uint8Array] : [sep, x.bytes as Uint8Array])))
            return bytesValue(all.length > max ? all.slice(0, max) : all)
          }
          let text = entries.map((x) => x.text).join(separator)
          if (encodeCollation(text, collationId).length > max) {
            // Cut at the last whole character within `max` bytes, in the result's own charset.
            let cut = ''
            let used = 0
            for (const ch of text) {
              used += encodeCollation(ch, collationId).length
              if (used > max) break
              cut += ch
            }
            text = cut
          }
          return stringValue(text, collationId)
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

/** The rows of a grouped query, one per group (and per super-aggregate under ROLLUP). */
export function* groupRows(source: Iterable<{ readonly row: Row }>, plan: GroupPlan, env: Env): Generator<{ readonly row: Value[] }> {
  const K = plan.keys.length
  const compose = (first: Row | undefined, keys: readonly Value[], level: number, states: readonly AggregateState[]): { row: Value[] } => {
    const row: Value[] = first === undefined ? new Array<Value>(plan.width).fill(null) : first.slice(0, plan.width)
    for (let i = 0; i < K; i++) row.push(i < level ? (keys[i] ?? null) : null)
    row.push(intValue(BigInt(level)))
    for (const s of states) row.push(s.result())
    return { row }
  }
  const temporary = plan.strategy === 'temp' && !plan.rollup
  const start = (): AggregateState[] => plan.specs.map((s) => s.start(temporary))
  const keysOf = (row: Row): Value[] => plan.keys.map((k) => k.eval(row, env))

  if (plan.strategy === 'implicit') {
    const states = start()
    let first: Row | undefined
    for (const { row } of source) {
      if (first === undefined) first = row
      for (const s of states) s.add(row, env)
    }
    // No GROUP BY always emits one group. Pinned GROUP BY keys need input,
    // and are evaluated after accumulation; ROLLUP adds its super-aggregates.
    if (K > 0 && first === undefined) return
    const keys = first === undefined ? [] : keysOf(first)
    for (let level = K; level >= (plan.rollup ? 0 : K); level--) yield compose(first, keys, level, states)
    return
  }

  if (temporary) {
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
    // Stable: rows of one group keep the order they came in.
    const all = [...source].map(({ row }) => ({ row, keys: keysOf(row) }))
    all.sort((a, b) => {
      for (let i = 0; i < K; i++) {
        const c = sortValues(a.keys[i] ?? null, b.keys[i] ?? null)
        if (c !== 0) return c
      }
      return 0
    })
    input = all
  }
  const levelCount = plan.rollup ? K + 1 : 1
  let current: { keys: Value[]; firsts: Row[]; states: AggregateState[][] } | undefined
  const flush = function* (group: NonNullable<typeof current>, down: number): Generator<{ row: Value[] }> {
    // Active states are finest first: levels K, K-1, … down to `down`.
    for (let i = 0; i < group.states.length && K - i >= down; i++) {
      yield compose(group.firsts[i], group.keys, K - i, group.states[i] as AggregateState[])
    }
  }
  for (const { row, keys } of input) {
    if (!current) {
      current = { keys, firsts: new Array<Row>(levelCount).fill(row), states: Array.from({ length: levelCount }, start) }
    } else {
      let j = 0
      while (j < K && valueKey(keys[j] ?? null) === valueKey(current.keys[j] ?? null)) j++
      if (j < K) {
        // Levels deeper than j end here: emit them, then start them afresh.
        yield* flush(current, j + 1)
        for (let i = 0; i < current.states.length && K - i > j; i++) {
          current.firsts[i] = row
          current.states[i] = start()
        }
        current.keys = keys
      }
    }
    for (const states of current.states) for (const s of states) s.add(row, env)
  }
  // ROLLUP over no sorted groups has no grand total either (8.4.11).
  if (current) yield* flush(current, 0)
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
    // Match canonical names once; repeated grouping columns need one physical part.
    const normalized = keyColumns.map((column) => column.toLowerCase())
    const columns = rollup ? normalized : [...new Set(normalized)]
    const pk = clusteredIndex(def)
    const ordered = def.indexes.filter((i) => i.invisible !== true).sort((a, b) => (a === pk ? -1 : b === pk ? 1 : 0))
    for (const index of ordered) {
      // A secondary index carries the clustered key after its own parts.
      const parts = indexParts(def, index)
      if (columns.every((column, i) => {
        const part = parts[i]
        return part?.column.toLowerCase() === column && part.prefix === undefined && part.descending !== true
      })) {
        return { strategy: 'index', index: index.name }
      }
    }
  }
  if (rollup || distinctAggregate) return { strategy: 'sort' }
  return { strategy: 'temp' }
}
