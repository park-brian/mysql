// M5.6 — window functions: the ranking functions, LAG and LEAD, FIRST_VALUE,
// LAST_VALUE and NTH_VALUE, NTILE, CUME_DIST and PERCENT_RANK, and the
// aggregates over a frame, with named windows.
//
// Drizzle's relational API is what asked for them first: it writes
// `(SELECT *, ROW_NUMBER() OVER (ORDER BY id DESC) FROM posts WHERE …)` inside
// its LATERAL derived table, not for the number but for the order — a window's
// rows come out sorted as the window sorts them, and the JSON_ARRAYAGG above it
// collects them in that order. The rules, read off 8.4.11:
//
//   - Windows run after WHERE, before ORDER BY, DISTINCT and LIMIT. Each sorts
//     the rows by its PARTITION BY and then its ORDER BY — NULL first, as an
//     ascending ORDER BY puts it — and the rows leave in the order of the last
//     window, which a later ORDER BY sorts stably.
//   - ROW_NUMBER counts the rows of a partition; RANK and DENSE_RANK give
//     peers, rows equal on the window's ORDER BY, one number. PERCENT_RANK is
//     (rank - 1) / (rows - 1), CUME_DIST the share of rows up to the last peer,
//     and NTILE(n) deals the rows into n buckets, the first ones a row larger.
//     LAG and LEAD read the row n before or after, or the default. These
//     ignore the frame.
//   - A frame is ROWS (positions) or RANGE (values of the one ORDER BY key,
//     NULLs their own peers). Without one, it runs from the partition's start
//     to the current row's last peer when there is an ORDER BY, and is the
//     whole partition when there is not. FIRST_VALUE, LAST_VALUE, NTH_VALUE
//     and the aggregates read it; an empty frame is NULL (COUNT 0).
//   - Types: the ranking numbers are BIGINT UNSIGNED NOT NULL, CUME_DIST and
//     PERCENT_RANK DOUBLE NOT NULL; LAG, LEAD and the value functions take
//     their argument's type, an integer as a BIGINT of its width, and may be
//     NULL; the aggregates their grouped type, MIN and MAX of an integer as a
//     BIGINT. Every other column is read through the window's temporary table.
//   - Refused as the server refuses them: a window function in WHERE, HAVING
//     or an ON (3593), DISTINCT in one (1235), GROUP_CONCAT as one (1235),
//     NTILE or NTH_VALUE of a count below 1 (1210), a frame that ends before it
//     starts (3586), RANGE n PRECEDING over anything but one numeric key (3587).
import { FIELD_TYPE } from '@myjs/bytes'
import { NODE, type CallNode, type Expression, type FrameBound, type WindowSpec } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { add, compareValues, doubleValue, intValue, sortValues, toInteger, type Value } from '@myjs/types'
import { AGGREGATE_NAMES, aggregate as resultTypeOf, compile, constantEnv, convertTo, type CompileContext, type Compiled, type Env, type Row } from './compile.ts'
import { AggregateSink, type AggregateSpec } from './group.ts'
import { warnNonScalar } from './operators.ts'
import { doubleType, intType, type ResultType } from './meta.ts'

const RANKING = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST', 'NTILE'])
const OFFSET = new Set(['LAG', 'LEAD'])
const VALUE = new Set(['FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE'])
/** The aggregates that run over a window: every one but GROUP_CONCAT, which is refused above. */
const windowAggregate = (name: string): boolean => name !== 'GROUP_CONCAT' && AGGREGATE_NAMES.has(name)

interface Frame {
  readonly units: 'ROWS' | 'RANGE'
  readonly start: Bound
  readonly end: Bound
}

/** A frame bound, its offset evaluated: `n` rows or values back (negative) or ahead (positive). */
type Bound = { readonly kind: 'unbounded-preceding' | 'unbounded-following' | 'current' } | { readonly kind: 'offset'; readonly by: Value; readonly following: boolean }

interface WindowPlan {
  readonly fn: string
  readonly args: readonly Compiled[]
  readonly partition: readonly Compiled[]
  readonly order: readonly { readonly expr: Compiled; readonly desc: boolean }[]
  readonly frame: Frame
  readonly aggregate?: AggregateSpec
  /** NTILE's buckets, NTH_VALUE's position, LAG's and LEAD's distance. */
  readonly count?: number
  /** Where in the row its value is written, past the sink's base. */
  readonly slot: number
}

/** The window functions of one query block, collected as its select list and ORDER BY compile. */
export class WindowSink {
  readonly windows: WindowPlan[] = []
  /**
   * The row slot of the first window's value. Over a grouped query it is
   * known only when every aggregate has been registered, so the caller may
   * set it after compiling and before any row is read.
   */
  base: number
  readonly #rowCtx: CompileContext
  readonly #named: ReadonlyMap<string, WindowSpec>
  readonly #aggregates: AggregateSink

  /** `rowCtx` compiles arguments, PARTITION BY and ORDER BY; `named` is the query's WINDOW clause. */
  constructor(rowCtx: CompileContext, base: number, named: readonly { readonly name: string; readonly spec: WindowSpec }[] = []) {
    this.#rowCtx = rowCtx
    this.base = base
    this.#named = new Map(named.map((w) => [w.name.toLowerCase(), w.spec]))
    this.#aggregates = new AggregateSink(rowCtx, 0)
  }

  register(e: CallNode): Compiled {
    const name = e.name.toUpperCase()
    const spec = this.#spec(e.over as string | WindowSpec)
    const ctx = { ...this.#rowCtx, clause: 'window order by' }
    if (e.distinct === true) throw sqlError('ER_NOT_SUPPORTED_YET', "This version of MySQL doesn't yet support '<window function>(DISTINCT ..)'")
    if (name === 'GROUP_CONCAT') throw sqlError('ER_NOT_SUPPORTED_YET', "This version of MySQL doesn't yet support 'group_concat as window function'")
    const known = RANKING.has(name) || OFFSET.has(name) || VALUE.has(name) || windowAggregate(name)
    if (!known) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The window function ${name}`))
    const order = (spec.orderBy ?? []).map((o) => ({ expr: compile(o.expr, ctx), desc: o.desc === true }))
    const frame = frameOf(spec, order, ctx)
    const slot = this.windows.length
    const constant = (x: Expression, fn: string): number => {
      const v = compile(x, ctx).eval([], constantEnv(ctx))
      const n = v === null || (v.kind !== 'int' && v.kind !== 'decimal' && v.kind !== 'double') ? undefined : Number(toInteger(v))
      if (n === undefined || n < (fn === 'LAG' || fn === 'LEAD' ? 0 : 1)) throw sqlError('ER_WRONG_ARGUMENTS', `Incorrect arguments to ${fn.toLowerCase()}`)
      return n
    }
    let type: ResultType
    let args: Compiled[] = []
    let count: number | undefined
    let aggregate: AggregateSpec | undefined
    let convert: ResultType | undefined
    if (RANKING.has(name)) {
      if (name === 'NTILE') {
        if (e.args.length !== 1) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
        count = constant(e.args[0] as Expression, name)
      } else if (e.args.length !== 0) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
      type = name === 'PERCENT_RANK' || name === 'CUME_DIST' ? doubleType(false) : intType(21, false, true)
    } else if (OFFSET.has(name) || VALUE.has(name)) {
      const arity = name === 'NTH_VALUE' ? [2] : OFFSET.has(name) ? [1, 2, 3] : [1]
      if (!arity.includes(e.args.length)) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
      args = [compile(e.args[0] as Expression, ctx)]
      if (name === 'NTH_VALUE') count = constant(e.args[1] as Expression, name)
      if (OFFSET.has(name)) {
        count = e.args.length >= 2 ? constant(e.args[1] as Expression, name) : 1
        if (e.args.length === 3) args.push(compile(e.args[2] as Expression, ctx))
      }
      // The argument's type, with a default's beside it, an integer a BIGINT
      // of its own width, and NULL when there is no row; none of a column's
      // own flags (8.4.11).
      const t = args.length === 2 ? resultTypeOf(args.map((a) => a.type), true, ctx.connectionCollation) : (args[0] as Compiled).type
      const { column: _column, ...plain } = t
      type = { ...plain, nullable: true, ...(t.kind === 'int' ? { field: FIELD_TYPE.LONGLONG } : {}) }
      if (args.length === 2) convert = type
    } else {
      // Over a grouped query its argument may be an aggregate itself: `SUM(SUM(v)) OVER …`.
      aggregate = this.#aggregates.specFor(e, 'window order by', this.#rowCtx.aggregates !== undefined)
      const t = aggregate.type
      type = (name === 'MIN' || name === 'MAX') && t.kind === 'int' ? { ...t, field: FIELD_TYPE.LONGLONG } : t
    }
    if (convert !== undefined) {
      const to = convert
      args = args.map((a) => ({ ...a, eval: (r: Row, env: Env) => convertTo(a.eval(r, env), to) }))
    }
    this.windows.push({ fn: name, args, partition: (spec.partitionBy ?? []).map((p) => compile(p, ctx)), order, frame, slot, ...(aggregate === undefined ? {} : { aggregate }), ...(count === undefined ? {} : { count }) })
    // A field of the window's temporary table: a number there carries no BINARY.
    return { eval: (row) => row[this.base + slot] ?? null, type: { ...type, temporary: 'stream' } }
  }

  /** The window a call names: its own, or a named one, or a named one it extends. */
  #spec(over: string | WindowSpec): WindowSpec {
    const named = (name: string): WindowSpec => {
      const found = this.#named.get(name.toLowerCase())
      if (found === undefined) throw sqlError('ER_WINDOW_NO_SUCH_WINDOW', `Window name '${name}' is not defined.`)
      return found.base === undefined ? found : { ...named(found.base), ...stripUndefined(found) }
    }
    if (typeof over === 'string') return named(over)
    if (over.base === undefined) return over
    return { ...named(over.base), ...stripUndefined(over) }
  }
}

/** What a constant argument or frame offset is evaluated in: no row, the statement's session. */

const stripUndefined = (spec: WindowSpec): WindowSpec => Object.fromEntries(Object.entries(spec).filter(([k, v]) => v !== undefined && k !== 'base')) as WindowSpec

/** The frame a window reads, its default made explicit and its offsets checked. */
function frameOf(spec: WindowSpec, order: readonly { readonly expr: Compiled }[], ctx: CompileContext): Frame {
  const f = spec.frame
  if (f === undefined) {
    // RANGE UNBOUNDED PRECEDING to the current row's peers, or the whole partition.
    return order.length > 0 ? { units: 'RANGE', start: { kind: 'unbounded-preceding' }, end: { kind: 'current' } } : { units: 'ROWS', start: { kind: 'unbounded-preceding' }, end: { kind: 'unbounded-following' } }
  }
  const illegal = () => sqlError('ER_WINDOW_FRAME_ILLEGAL', "Window '<unnamed window>': frame start or end is negative, NULL or of non-integral type")
  const bound = (b: FrameBound, start: boolean): Bound => {
    if (b.kind === 'current') return { kind: 'current' }
    if (b.kind === 'unbounded') return { kind: b.direction === 'FOLLOWING' ? 'unbounded-following' : 'unbounded-preceding' }
    const v = compile(b.value as Expression, ctx).eval([], constantEnv(ctx))
    if (f.units === 'RANGE') {
      // A value range needs one key it can add to (8.4.11: 3587).
      const key = order[0]?.expr.type.kind
      if (order.length !== 1 || !(key === 'int' || key === 'decimal' || key === 'double')) throw sqlError('ER_WINDOW_RANGE_FRAME_ORDER_TYPE', "Window '<unnamed window>' with RANGE N PRECEDING/FOLLOWING frame requires exactly one ORDER BY expression, of numeric or temporal type")
    }
    if (v === null || compareValues(v, intValue(0n)) === -1 || (f.units === 'ROWS' && v.kind !== 'int')) throw illegal()
    void start
    return { kind: 'offset', by: v, following: b.direction === 'FOLLOWING' }
  }
  const start = bound(f.start, true)
  const end = f.end === undefined ? ({ kind: 'current' } as Bound) : bound(f.end, false)
  // A frame that starts after it ends: FOLLOWING before PRECEDING, or a start of UNBOUNDED FOLLOWING (8.4.11: 3586).
  const rank = (b: Bound): number => (b.kind === 'unbounded-preceding' ? 0 : b.kind === 'offset' ? (b.following ? 3 : 1) : b.kind === 'current' ? 2 : 4)
  if (rank(start) > rank(end) || start.kind === 'unbounded-following' || end.kind === 'unbounded-preceding') throw illegal()
  return { units: f.units, start, end }
}

/** 3593, for a window function where none may be: WHERE, HAVING, an ON. */
export function windowNotAllowed(e: CallNode): never {
  throw sqlError('ER_WINDOW_INVALID_WINDOW_FUNC_USE', `You cannot use the window function '${e.name.toLowerCase()}' in this context.'`)
}

interface Keyed {
  readonly row: Row
  readonly at: number
  readonly partition: readonly Value[]
  readonly order: readonly Value[]
}

/**
 * The rows with every window's value written into its slot, in the order the
 * last window leaves them. `rows` are the query's rows after WHERE, each as wide
 * as the windows' slots need.
 */
export function applyWindows(rows: Row[], windows: readonly WindowPlan[], env: Env, base: number): Row[] {
  let current = rows
  for (const w of windows) {
    const keyed: Keyed[] = current.map((row, at) => ({ row, at, partition: w.partition.map((p) => p.eval(row, env)), order: w.order.map((o) => o.expr.eval(row, env)) }))
    warnNonScalar(keyed.map((k) => k.order), env)
    if (w.partition.length > 0 || w.order.length > 0) {
      keyed.sort((a, b) => {
        for (let i = 0; i < a.partition.length; i++) {
          const c = sortValues(a.partition[i] ?? null, b.partition[i] ?? null)
          if (c !== 0) return c
        }
        for (let i = 0; i < a.order.length; i++) {
          const c = sortValues(a.order[i] ?? null, b.order[i] ?? null)
          if (c !== 0) return (w.order[i] as { desc: boolean }).desc ? -c : c
        }
        return a.at - b.at
      })
    }
    const same = (x: readonly Value[], y: readonly Value[]): boolean => x.every((v, i) => sortValues(v, y[i] ?? null) === 0)
    for (let ps = 0; ps < keyed.length; ) {
      let pe = ps + 1
      while (pe < keyed.length && same((keyed[ps] as Keyed).partition, (keyed[pe] as Keyed).partition)) pe++
      partitionValues(w, keyed.slice(ps, pe), env, same, base)
      ps = pe
    }
    current = keyed.map((k) => k.row)
  }
  return current
}

/** One partition's values, written into each row's slot. */
function partitionValues(w: WindowPlan, part: readonly Keyed[], env: Env, same: (x: readonly Value[], y: readonly Value[]) => boolean, base: number): void {
  const n = part.length
  // Each row's peers: the first and last index of the rows equal to it on the ORDER BY.
  const firstPeer: number[] = []
  const lastPeer: number[] = []
  for (let i = 0; i < n; i++) firstPeer[i] = i > 0 && same((part[i - 1] as Keyed).order, (part[i] as Keyed).order) ? (firstPeer[i - 1] as number) : i
  for (let i = n - 1; i >= 0; i--) lastPeer[i] = i < n - 1 && same((part[i + 1] as Keyed).order, (part[i] as Keyed).order) ? (lastPeer[i + 1] as number) : i
  const set = (i: number, v: Value) => (((part[i] as Keyed).row as Value[])[base + w.slot] = v)
  let dense = 0
  switch (w.fn) {
    case 'ROW_NUMBER':
    case 'RANK':
    case 'DENSE_RANK':
      for (let i = 0; i < n; i++) {
        if (firstPeer[i] === i) dense++
        set(i, intValue(BigInt(w.fn === 'ROW_NUMBER' ? i + 1 : w.fn === 'RANK' ? (firstPeer[i] as number) + 1 : dense), true))
      }
      return
    case 'PERCENT_RANK':
      for (let i = 0; i < n; i++) set(i, doubleValue(n > 1 ? (firstPeer[i] as number) / (n - 1) : 0))
      return
    case 'CUME_DIST':
      for (let i = 0; i < n; i++) set(i, doubleValue(((lastPeer[i] as number) + 1) / n))
      return
    case 'NTILE': {
      // n rows into k buckets: the first n % k a row larger.
      const k = w.count as number
      const size = Math.floor(n / k)
      const larger = n % k
      for (let i = 0; i < n; i++) {
        const bucket = i < larger * (size + 1) ? Math.floor(i / (size + 1)) : larger + Math.floor((i - larger * (size + 1)) / Math.max(size, 1))
        set(i, intValue(BigInt(bucket + 1), true))
      }
      return
    }
    case 'LAG':
    case 'LEAD': {
      const by = (w.count as number) * (w.fn === 'LAG' ? -1 : 1)
      const [arg, fallback] = w.args as [Compiled, Compiled | undefined]
      for (let i = 0; i < n; i++) {
        const target = part[i + by]
        set(i, target !== undefined ? arg.eval(target.row, env) : fallback === undefined ? null : fallback.eval((part[i] as Keyed).row, env))
      }
      return
    }
  }
  // The rest read a frame.
  const frames = framesOf(w, part, firstPeer, lastPeer)
  if (w.aggregate !== undefined) {
    const spec = w.aggregate
    // A frame that starts at the partition and only grows is one running state.
    const running = frames.every(([lo]) => lo === 0) && frames.every(([, hi], i) => i === 0 || hi >= (frames[i - 1] as [number, number])[1])
    if (running) {
      const state = spec.start()
      let added = -1
      frames.forEach(([, hi], i) => {
        while (added < hi) state.add((part[++added] as Keyed).row, env)
        set(i, state.result())
      })
      return
    }
    frames.forEach(([lo, hi], i) => {
      const state = spec.start()
      for (let j = lo; j <= hi; j++) state.add((part[j] as Keyed).row, env)
      set(i, state.result())
    })
    return
  }
  const arg = w.args[0] as Compiled
  frames.forEach(([lo, hi], i) => {
    const at = w.fn === 'FIRST_VALUE' ? lo : w.fn === 'LAST_VALUE' ? hi : lo + (w.count as number) - 1
    set(i, lo > hi || at > hi ? null : arg.eval((part[at] as Keyed).row, env))
  })
}

/** Each row's frame as the first and last index it holds; empty when the first is past the last. */
function framesOf(w: WindowPlan, part: readonly Keyed[], firstPeer: readonly number[], lastPeer: readonly number[]): [number, number][] {
  const n = part.length
  const { units, start, end } = w.frame
  const desc = w.order[0]?.desc === true
  const position = (b: Bound, i: number, isStart: boolean): number => {
    if (b.kind === 'unbounded-preceding') return 0
    if (b.kind === 'unbounded-following') return n - 1
    if (b.kind === 'current') return units === 'ROWS' ? i : isStart ? (firstPeer[i] as number) : (lastPeer[i] as number)
    const off = b as Extract<Bound, { kind: 'offset' }>
    if (units === 'ROWS') return i + Number(toInteger(off.by as Exclude<Value, null>)) * (off.following ? 1 : -1)
    // RANGE: the rows whose key is within the offset of this row's; a NULL key's frame is its peers.
    const key = (part[i] as Keyed).order[0] ?? null
    if (key === null) return isStart ? (firstPeer[i] as number) : (lastPeer[i] as number)
    // Ahead in the window's order is up for ASC and down for DESC.
    const ahead = off.following !== desc
    const bound = add(key, off.by, ahead ? '+' : '-') as Value
    if (isStart) {
      for (let j = 0; j < n; j++) {
        const k = (part[j] as Keyed).order[0] ?? null
        if (k === null) continue
        const c = compareValues(k, bound) as number
        if (desc ? c <= 0 : c >= 0) return j
      }
      return n
    }
    for (let j = n - 1; j >= 0; j--) {
      const k = (part[j] as Keyed).order[0] ?? null
      if (k === null) continue
      const c = compareValues(k, bound) as number
      if (desc ? c >= 0 : c <= 0) return j
    }
    return -1
  }
  return part.map((_, i) => [Math.max(0, position(start, i, true)), Math.min(n - 1, position(end, i, false))])
}

/** Whether `e` calls a window function outside its own subqueries. */
export function containsWindow(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const n = e as { kind?: string; over?: unknown }
  if (n.kind === 'subquery') return false
  if (n.kind === NODE.CALL && n.over !== undefined) return true
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(containsWindow) : typeof v === 'object' && containsWindow(v)))
}
