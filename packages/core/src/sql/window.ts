// M5.6 begun — window functions: ROW_NUMBER, RANK and DENSE_RANK over a
// PARTITION BY and an ORDER BY.
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
//     peers, rows equal on the window's ORDER BY, one number.
//   - The result is a BIGINT, NOT NULL and UNSIGNED, without BINARY, and the
//     other columns are read through the window's temporary table, losing their
//     key flags.
//   - In WHERE, HAVING or an ON it is 3593.
import type { CallNode, WindowSpec } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { intValue, sortValues, type Value } from '@myjs/types'
import { compile, type CompileContext, type Compiled, type Env, type Row } from './compile.ts'
import { intType } from './meta.ts'

const FUNCTIONS = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK'])

interface WindowPlan {
  readonly fn: string
  readonly partition: readonly Compiled[]
  readonly order: readonly { readonly expr: Compiled; readonly desc: boolean }[]
  /** Where in the row its value is written. */
  readonly slot: number
}

/** The window functions of one query block, collected as its select list and ORDER BY compile. */
export class WindowSink {
  readonly windows: WindowPlan[] = []
  readonly #rowCtx: CompileContext
  readonly #base: number

  /** `rowCtx` compiles PARTITION BY and ORDER BY; `base` is the row slot of the first window's value. */
  constructor(rowCtx: CompileContext, base: number) {
    this.#rowCtx = rowCtx
    this.#base = base
  }

  register(e: CallNode): Compiled {
    const name = e.name.toUpperCase()
    if (typeof e.over === 'string' || (e.over as WindowSpec).base !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Named windows'))
    if (!FUNCTIONS.has(name)) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(`The window function ${name}`))
    if (e.args.length !== 0) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
    const spec = e.over as WindowSpec
    if (spec.frame !== undefined) throw sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('Window frames'))
    const ctx = { ...this.#rowCtx, clause: 'window order by' }
    const slot = this.#base + this.windows.length
    this.windows.push({
      fn: name,
      partition: (spec.partitionBy ?? []).map((p) => compile(p, ctx)),
      order: (spec.orderBy ?? []).map((o) => ({ expr: compile(o.expr, ctx), desc: o.desc === true })),
      slot,
    })
    // A field of the window's temporary table: a number there carries no BINARY.
    return { eval: (row) => row[slot] ?? null, type: { ...intType(21, false, true), temporary: 'stream' } }
  }
}

/** 3593, for a window function where none may be: WHERE, HAVING, an ON. */
export function windowNotAllowed(e: CallNode): never {
  throw sqlError('ER_WINDOW_INVALID_WINDOW_FUNC_USE', `You cannot use the window function '${e.name.toLowerCase()}' in this context.'`)
}

/**
 * The rows with every window's value written into its slot, in the order the
 * last window leaves them. `rows` are the query's rows after WHERE, each as wide
 * as the windows' slots need.
 */
export function applyWindows(rows: Row[], windows: readonly WindowPlan[], env: Env): Row[] {
  let current = rows
  for (const w of windows) {
    const keyed = current.map((row, at) => ({ row, at, partition: w.partition.map((p) => p.eval(row, env)), order: w.order.map((o) => o.expr.eval(row, env)) }))
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
    let n = 0
    let rank = 0
    let dense = 0
    keyed.forEach((k, i) => {
      const prev = keyed[i - 1]
      if (prev === undefined || !same(prev.partition, k.partition)) {
        n = 0
        rank = 0
        dense = 0
      }
      n++
      if (prev === undefined || n === 1 || !same(prev.order, k.order)) {
        rank = n
        dense++
      }
      const value = w.fn === 'ROW_NUMBER' ? n : w.fn === 'RANK' ? rank : dense
      ;(k.row as Value[])[w.slot] = intValue(BigInt(value), true)
    })
    current = keyed.map((k) => k.row)
  }
  return current
}


/** Whether `e` calls a window function outside its own subqueries. */
export function containsWindow(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const n = e as { kind?: string; over?: unknown }
  if (n.kind === 'subquery') return false
  if (n.kind === 'call' && n.over !== undefined) return true
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(containsWindow) : typeof v === 'object' && containsWindow(v)))
}
